import * as Phaser from 'phaser';
import {
  ENEMY_NET_REFRESH_CYCLE_TICKS,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  ENEMY_NET_ACTIVE_LIST_INTERVAL_TICKS,
  ENEMY_NET_POSITION_DELTA_PX,
  ENEMY_NET_REMOVAL_RESEND_TICKS,
  ENEMY_NET_ROTATION_DELTA_RAD,
} from '../config';
import { EnemyFlowFieldService } from '../systems/EnemyFlowFieldService';
import { GROUND_FIRE_CELL_SIZE, type FireSystem, type WildfireSourceInfo } from '../effects/FireSystem';
import type { CoopDefenseEnemyTrainAwarenessSystem } from '../systems/CoopDefenseEnemyTrainAwarenessSystem';
import type { SyncedEnemyDeltaState, SyncedEnemySnapshot, SyncedEnemyState } from '../types';
import {
  decodeEnemyUpserts,
  encodeEnemyUpsert,
  enemyIdToNum,
  enemyNumToId,
} from '../network/enemySnapshotCodec';
import { EnemyEntity, type EnemyFaction } from './EnemyEntity';
import {
  resolveCoopDefenseEnemyConfigs,
  type CoopDefenseEnemyKind,
  type ResolvedCoopDefenseEnemyConfigs,
} from '../config/coopDefenseEnemies';

const STEER_RESPONSIVENESS = 8;
const SPAWN_LANE_JITTER_PX = CELL_SIZE * 0.3;
const SEPARATION_RADIUS_PX = CELL_SIZE * 2;
const SEPARATION_STRENGTH = 0.6;

export interface EnemyDeathInfo {
  readonly id: string;
  readonly kind: CoopDefenseEnemyKind;
  readonly x: number;
  readonly y: number;
  readonly faction: EnemyFaction;
  readonly ownerId?: string;
}

interface WildfirePanicState extends WildfireSourceInfo {
  directionX: number;
  directionY: number;
  lastTrailCellKey: string | null;
  lastTrailX: number;
  lastTrailY: number;
}

export class EnemyManager {
  private readonly scene: Phaser.Scene;
  private readonly resolvedConfigs: ResolvedCoopDefenseEnemyConfigs;
  private readonly enemies = new Map<string, EnemyEntity>();
  private readonly netSnapshotCache = new Map<string, SyncedEnemyState>();
  // id -> verbleibende Anzahl Delta-Snapshots, in denen die Removal noch mitgesendet wird.
  private readonly pendingRemovals = new Map<string, number>();
  private nextEnemyIdSeq = 1;
  // Sendet die aktive ID-Liste sofort beim ersten Snapshot (Bootstrap), danach periodisch.
  private ticksSinceActiveList = ENEMY_NET_ACTIVE_LIST_INTERVAL_TICKS;
  private refreshCursor = 0;
  private readonly wildfirePanicStates = new Map<string, WildfirePanicState>();

  constructor(scene: Phaser.Scene, resolvedConfigs: ResolvedCoopDefenseEnemyConfigs = resolveCoopDefenseEnemyConfigs(1)) {
    this.scene = scene;
    this.resolvedConfigs = resolvedConfigs;
  }

  hostSpawnDummyAt(gridX: number, gridY: number, kind: CoopDefenseEnemyKind = 'zombie-badger'): EnemyEntity {
    const world = this.gridToWorld(gridX, gridY);
    const x = world.x + Phaser.Math.RND.realInRange(-SPAWN_LANE_JITTER_PX, SPAWN_LANE_JITTER_PX);
    const y = world.y + Phaser.Math.RND.realInRange(-SPAWN_LANE_JITTER_PX, SPAWN_LANE_JITTER_PX);
    return this.hostSpawnAtWorld(x, y, kind);
  }

  hostSpawnAtWorld(x: number, y: number, kind: CoopDefenseEnemyKind): EnemyEntity {
    return this.hostSpawnUnitAtWorld(x, y, kind, 'hostile');
  }

  hostSpawnAllyAtWorld(
    x: number,
    y: number,
    kind: CoopDefenseEnemyKind,
    ownerId: string,
    ownerColor: number,
    hpMultiplier: number,
  ): EnemyEntity {
    const enemy = this.hostSpawnUnitAtWorld(x, y, kind, 'allied', ownerId, ownerColor);
    const maxHp = Math.max(1, Math.round(enemy.getMaxHp() * Math.max(1, hpMultiplier)));
    enemy.setHp(maxHp, maxHp);
    return enemy;
  }

  private hostSpawnUnitAtWorld(
    x: number,
    y: number,
    kind: CoopDefenseEnemyKind,
    faction: EnemyFaction,
    ownerId?: string,
    ownerColor?: number,
  ): EnemyEntity {
    const id = this.generateEnemyId(kind);
    const enemy = new EnemyEntity(this.scene, id, x, y, true, kind, this.resolvedConfigs[kind], faction, ownerId, ownerColor);
    this.enemies.set(id, enemy);
    return enemy;
  }

  hostUpdateMovement(
    baseFlowFieldService: EnemyFlowFieldService | null,
    playerFlowFieldService: EnemyFlowFieldService | null,
    bossFlowFieldService: EnemyFlowFieldService | null,
    movementLocked: boolean,
    now: number,
    deltaMs: number,
    fireSystem?: FireSystem | null,
    activeBurnSourceResolver?: ((enemyId: string, now: number) => ReadonlyArray<{ sourceId: string }>) | null,
    trainAwarenessSystem?: CoopDefenseEnemyTrainAwarenessSystem | null,
  ): void {
    const lerpT = 1 - Math.exp(-STEER_RESPONSIVENESS * (deltaMs / 1000));
    const separationGrid = this.buildSeparationGrid();

    for (const enemy of this.enemies.values()) {
      if (enemy.faction === 'allied') continue;
      const config = this.resolvedConfigs[enemy.kind];
      const flowFieldService = config.isBoss
        ? bossFlowFieldService ?? baseFlowFieldService
        : config.movementTarget === 'players'
          ? playerFlowFieldService ?? baseFlowFieldService
          : baseFlowFieldService;

      if (movementLocked) {
        enemy.stopMovement();
        continue;
      }

      const wildfirePanic = this.updateWildfirePanicState(
        enemy,
        fireSystem ?? null,
        activeBurnSourceResolver ?? null,
        now,
      );
      if (wildfirePanic) {
        const speed = enemy.getMoveSpeed() * wildfirePanic.speedMultiplier;
        const targetVx = wildfirePanic.directionX * speed;
        const targetVy = wildfirePanic.directionY * speed;
        const current = enemy.getDesiredVelocity();
        const decision = trainAwarenessSystem?.resolveMovement(enemy, targetVx, targetVy, now);
        enemy.setDesiredVelocity(
          decision?.override ? decision.vx : Phaser.Math.Linear(current.vx, targetVx, lerpT),
          decision?.override ? decision.vy : Phaser.Math.Linear(current.vy, targetVy, lerpT),
        );
        continue;
      }

      if (!flowFieldService) {
        enemy.stopMovement();
        continue;
      }

      if (enemy.isAttackMovementPaused(now)) {
        const current = enemy.getDesiredVelocity();
        const trainDecision = trainAwarenessSystem?.resolveMovement(enemy, current.vx, current.vy, now);
        if (trainDecision?.override && trainAwarenessSystem?.blocksRegularAttacks(enemy.id)) {
          enemy.setDesiredVelocity(trainDecision.vx, trainDecision.vy);
        } else {
          enemy.stopMovement();
        }
        continue;
      }

      const gridCell = flowFieldService.worldToGrid(enemy.sprite.x, enemy.sprite.y);
      if (!gridCell) {
        enemy.stopMovement();
        continue;
      }

      const integrationValue = flowFieldService.getIntegrationValueAt(gridCell.gridX, gridCell.gridY);
      if (integrationValue >= EnemyFlowFieldService.INTEGRATION_INFINITY) {
        const recoveryTarget = config.isBoss
          ? flowFieldService.findNearestReachableWorldPosition(gridCell.gridX, gridCell.gridY)
          : null;
        if (!recoveryTarget) {
          enemy.stopMovement();
          continue;
        }

        this.steerEnemyTowards(enemy, recoveryTarget.x, recoveryTarget.y, lerpT, now, trainAwarenessSystem);
        continue;
      }

      if (integrationValue <= 0) {
        if (!this.applyTrainAwarenessOverride(enemy, 0, 0, now, trainAwarenessSystem)) enemy.stopMovement();
        continue;
      }

      const vector = flowFieldService.getVectorAt(gridCell.gridX, gridCell.gridY);
      if (vector.x === 0 && vector.y === 0) {
        if (!this.applyTrainAwarenessOverride(enemy, 0, 0, now, trainAwarenessSystem)) enemy.stopMovement();
        continue;
      }

      const speed = enemy.getMoveSpeed();
      // Der einzelne Boss braucht keine Separation. Sie kann den grossen Body
      // seitlich aus seinem Clearance-Korridor in eine Wand druecken.
      const separation = config.isBoss ? { x: 0, y: 0 } : this.computeSeparation(enemy, separationGrid);
      const bossWaypoint = config.isBoss
        ? flowFieldService.getNextCellWorldPosition(gridCell.gridX, gridCell.gridY)
        : null;
      const waypointDirection = bossWaypoint
        ? this.normalizeDirection(bossWaypoint.x - enemy.sprite.x, bossWaypoint.y - enemy.sprite.y)
        : vector;
      let targetVx = waypointDirection.x * speed + separation.x * SEPARATION_STRENGTH * speed;
      let targetVy = waypointDirection.y * speed + separation.y * SEPARATION_STRENGTH * speed;

      const targetSpeed = Math.hypot(targetVx, targetVy);
      if (targetSpeed > speed) {
        const scale = speed / targetSpeed;
        targetVx *= scale;
        targetVy *= scale;
      }

      const current = enemy.getDesiredVelocity();
      const decision = trainAwarenessSystem?.resolveMovement(enemy, targetVx, targetVy, now);
      if (decision?.override) {
        enemy.setDesiredVelocity(decision.vx, decision.vy);
      } else {
        enemy.setDesiredVelocity(
          Phaser.Math.Linear(current.vx, targetVx, lerpT),
          Phaser.Math.Linear(current.vy, targetVy, lerpT),
        );
      }
    }
  }

  isEnemyPanicking(enemyId: string): boolean {
    return this.wildfirePanicStates.has(enemyId);
  }

  private updateWildfirePanicState(
    enemy: EnemyEntity,
    fireSystem: FireSystem | null,
    activeBurnSourceResolver: ((enemyId: string, now: number) => ReadonlyArray<{ sourceId: string }>) | null,
    now: number,
  ): WildfirePanicState | null {
    if (!fireSystem || !activeBurnSourceResolver) {
      this.wildfirePanicStates.delete(enemy.id);
      return null;
    }

    const activeBurns = activeBurnSourceResolver(enemy.id, now);
    const activeSourceIds = new Set(activeBurns.map(source => source.sourceId));
    let state = this.wildfirePanicStates.get(enemy.id) ?? null;
    if (state && !activeSourceIds.has(state.sourceId)) {
      this.wildfirePanicStates.delete(enemy.id);
      state = null;
    }

    if (!state) {
      const candidates = [...activeSourceIds].sort();
      for (const sourceId of candidates) {
        const info = fireSystem.getWildfireSourceInfo(sourceId);
        const direction = fireSystem.getWildfireEscapeVector(
          sourceId,
          enemy.sprite.x,
          enemy.sprite.y,
          enemy.getCollisionRadius(),
        );
        if (!info || !direction) continue;
        state = {
          ...info,
          directionX: direction.x,
          directionY: direction.y,
          lastTrailCellKey: null,
          lastTrailX: enemy.sprite.x,
          lastTrailY: enemy.sprite.y,
        };
        this.wildfirePanicStates.set(enemy.id, state);
        break;
      }
    }
    if (!state) return null;

    const updatedDirection = fireSystem.getWildfireEscapeVector(
      state.sourceId,
      enemy.sprite.x,
      enemy.sprite.y,
      enemy.getCollisionRadius(),
    );
    if (updatedDirection) {
      state.directionX = updatedDirection.x;
      state.directionY = updatedDirection.y;
    }

    const trailGridX = Math.floor(enemy.sprite.x / GROUND_FIRE_CELL_SIZE);
    const trailGridY = Math.floor(enemy.sprite.y / GROUND_FIRE_CELL_SIZE);
    const trailCellKey = `${trailGridX}:${trailGridY}`;
    if (state.trailDurationMs > 0 && trailCellKey !== state.lastTrailCellKey) {
      state.lastTrailCellKey = trailCellKey;
      fireSystem.hostRefreshGroundCellsAlongSegment(
        state.lastTrailX,
        state.lastTrailY,
        enemy.sprite.x,
        enemy.sprite.y,
        {
          // Pro Besitzer und Rasterzelle teilen sich alle Gegner eine auffrischbare
          // Quelle. So waechst die Feuerspur mit belegten Zellen statt mit der
          // Anzahl Gegner und bleibt auch bei grossen Horden begrenzt.
          sourceKey: `wildfire-trail:${state.ownerId}`,
          ownerId: state.ownerId,
          durationMs: state.trailDurationMs,
          damagePerTick: state.trailDamagePerTick,
          burn: state.burn,
          weaponName: 'Lauffeuer',
        },
        now,
      );
      state.lastTrailX = enemy.sprite.x;
      state.lastTrailY = enemy.sprite.y;
    }

    return state;
  }

  private steerEnemyTowards(
    enemy: EnemyEntity,
    targetX: number,
    targetY: number,
    lerpT: number,
    now: number,
    trainAwarenessSystem?: CoopDefenseEnemyTrainAwarenessSystem | null,
  ): void {
    const direction = this.normalizeDirection(targetX - enemy.sprite.x, targetY - enemy.sprite.y);
    const speed = enemy.getMoveSpeed();
    const targetVx = direction.x * speed;
    const targetVy = direction.y * speed;
    const decision = trainAwarenessSystem?.resolveMovement(enemy, targetVx, targetVy, now);
    if (decision?.override) {
      enemy.setDesiredVelocity(decision.vx, decision.vy);
      return;
    }
    const current = enemy.getDesiredVelocity();
    enemy.setDesiredVelocity(
      Phaser.Math.Linear(current.vx, targetVx, lerpT),
      Phaser.Math.Linear(current.vy, targetVy, lerpT),
    );
  }

  private applyTrainAwarenessOverride(
    enemy: EnemyEntity,
    intendedVx: number,
    intendedVy: number,
    now: number,
    trainAwarenessSystem?: CoopDefenseEnemyTrainAwarenessSystem | null,
  ): boolean {
    const decision = trainAwarenessSystem?.resolveMovement(enemy, intendedVx, intendedVy, now);
    if (!decision?.override) return false;
    enemy.setDesiredVelocity(decision.vx, decision.vy);
    return true;
  }

  private normalizeDirection(x: number, y: number): { x: number; y: number } {
    const length = Math.hypot(x, y);
    if (length <= 0.001) return { x: 0, y: 0 };
    return { x: x / length, y: y / length };
  }

  /**
   * Baut ein Spatial-Hash-Grid mit Zellengröße = Separations-Radius.
   * Dadurch wird die Nachbarsuche in {@link computeSeparation} von O(N²) auf ~O(N) reduziert:
   * Nur die 3×3 umliegenden Zellen können Gegner innerhalb des Radius enthalten.
   */
  private buildSeparationGrid(): Map<number, EnemyEntity[]> {
    const grid = new Map<number, EnemyEntity[]>();
    for (const enemy of this.enemies.values()) {
      const key = this.separationCellKey(enemy.sprite.x, enemy.sprite.y);
      const bucket = grid.get(key);
      if (bucket) {
        bucket.push(enemy);
      } else {
        grid.set(key, [enemy]);
      }
    }
    return grid;
  }

  private separationCellKey(x: number, y: number): number {
    const cellX = Math.floor(x / SEPARATION_RADIUS_PX);
    const cellY = Math.floor(y / SEPARATION_RADIUS_PX);
    // Cantor-artige Paarung in eine einzelne Number-Key (vermeidet String-Allokationen).
    return (cellX + 0x8000) * 0x10000 + (cellY + 0x8000);
  }

  private computeSeparation(enemy: EnemyEntity, grid: Map<number, EnemyEntity[]>): { x: number; y: number } {
    let pushX = 0;
    let pushY = 0;

    const cellX = Math.floor(enemy.sprite.x / SEPARATION_RADIUS_PX);
    const cellY = Math.floor(enemy.sprite.y / SEPARATION_RADIUS_PX);

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const bucket = grid.get(((cellX + offsetX) + 0x8000) * 0x10000 + ((cellY + offsetY) + 0x8000));
        if (!bucket) continue;

        for (const other of bucket) {
          if (other === enemy) continue;
          const dx = enemy.sprite.x - other.sprite.x;
          const dy = enemy.sprite.y - other.sprite.y;
          const distance = Math.hypot(dx, dy);
          if (distance <= 0 || distance >= SEPARATION_RADIUS_PX) continue;

          const weight = (1 - distance / SEPARATION_RADIUS_PX) / distance;
          pushX += dx * weight;
          pushY += dy * weight;
        }
      }
    }

    return { x: pushX, y: pushY };
  }

  getNetSnapshot(): SyncedEnemySnapshot {
    // Kein schwerer Full-Snapshot mehr: Neue/geänderte Gegner gehen als Delta, unveränderte Gegner
    // werden rollierend (Refresh-Zyklus) binnen ~2 s einmal voll nachgesendet. Periodisch trägt der
    // Snapshot zusätzlich die vollständige aktive ID-Liste zur Phantom-Reconciliation.
    const sendActiveList = this.ticksSinceActiveList >= ENEMY_NET_ACTIVE_LIST_INTERVAL_TICKS;
    const currentIds = new Set<string>();
    const upserts: SyncedEnemyDeltaState[] = [];

    const sortedEnemies = [...this.enemies.values()]
      .sort((left, right) => left.id.localeCompare(right.id));
    const refreshIds = this.collectRefreshIds(sortedEnemies);

    for (const enemy of sortedEnemies) {
      const current = this.buildNetState(enemy);
      currentIds.add(current.id);
      const previous = this.netSnapshotCache.get(current.id);

      if (!previous) {
        upserts.push(current);
        this.netSnapshotCache.set(current.id, current);
        continue;
      }

      const delta = this.buildDeltaState(previous, current);
      if (delta) {
        upserts.push(delta);
        this.netSnapshotCache.set(current.id, {
          ...previous,
          ...delta,
        });
        continue;
      }

      if (!refreshIds.has(current.id)) continue;

      upserts.push(current);
      this.netSnapshotCache.set(current.id, current);
    }

    // Removals werden über mehrere Delta-Snapshots wiederholt (siehe ENEMY_NET_REMOVAL_RESEND_TICKS),
    // damit ein verlorenes unreliable-Paket nicht zu dauerhaft sichtbaren toten Gegnern führt.
    const removals = [...this.pendingRemovals.keys()].sort();
    for (const id of removals) {
      const remaining = (this.pendingRemovals.get(id) ?? 1) - 1;
      if (remaining <= 0) {
        this.pendingRemovals.delete(id);
      } else {
        this.pendingRemovals.set(id, remaining);
      }
    }

    const encodedUpserts: Array<number | string> = [];
    for (const entry of upserts) {
      encodeEnemyUpsert(encodedUpserts, entry);
    }

    const snapshot: SyncedEnemySnapshot = {
      c: currentIds.size,
      u: encodedUpserts,
      r: removals.map(enemyIdToNum),
    };

    if (sendActiveList) {
      // Cache-Einträge entfernter Gegner aufräumen und die aktive ID-Liste als Reconciliation-Backstop
      // anhängen. Der Client löscht lokal jeden Gegner, dessen ID hier fehlt (Phantom-Bereinigung).
      for (const id of [...this.netSnapshotCache.keys()]) {
        if (!currentIds.has(id)) this.netSnapshotCache.delete(id);
      }
      snapshot.a = [...currentIds].map(enemyIdToNum).sort((left, right) => left - right);
      this.ticksSinceActiveList = 0;
    } else {
      this.ticksSinceActiveList += 1;
    }

    return snapshot;
  }

  getEnemy(id: string): EnemyEntity | undefined {
    return this.enemies.get(id);
  }

  getAllEnemies(): EnemyEntity[] {
    return [...this.enemies.values()];
  }

  getHostileEnemies(): EnemyEntity[] {
    return [...this.enemies.values()].filter((enemy) => enemy.faction === 'hostile');
  }

  getAlliedEnemies(ownerId?: string): EnemyEntity[] {
    return [...this.enemies.values()].filter((enemy) => enemy.faction === 'allied' && (ownerId === undefined || enemy.ownerId === ownerId));
  }

  hasEnemy(id: string): boolean {
    return this.enemies.has(id);
  }

  hasEnemyKind(kind: CoopDefenseEnemyKind): boolean {
    for (const enemy of this.enemies.values()) {
      if (enemy.faction === 'hostile' && enemy.kind === kind) return true;
    }
    return false;
  }

  applyDamage(id: string, damage: number): { died: boolean; remainingHp: number; death?: EnemyDeathInfo } | null {
    const enemy = this.enemies.get(id);
    if (!enemy || damage <= 0) return null;

    const remainingHp = Math.max(0, enemy.getHp() - damage);
    enemy.setHp(remainingHp);
    if (remainingHp > 0) {
      return { died: false, remainingHp };
    }

    const deathX = enemy.sprite.x;
    const deathY = enemy.sprite.y;
    const death: EnemyDeathInfo = {
      id: enemy.id,
      kind: enemy.kind,
      x: deathX,
      y: deathY,
      faction: enemy.faction,
      ownerId: enemy.ownerId,
    };
    const deathSpawns = enemy.faction === 'hostile' ? (this.resolvedConfigs[enemy.kind].deathSpawns ?? []) : [];
    this.pendingRemovals.set(id, ENEMY_NET_REMOVAL_RESEND_TICKS);
    this.netSnapshotCache.delete(id);
    enemy.destroy();
    this.enemies.delete(id);
    this.wildfirePanicStates.delete(id);
    for (const spawnConfig of deathSpawns) {
      const baseAngle = Phaser.Math.RND.realInRange(0, Math.PI * 2);
      for (let index = 0; index < spawnConfig.count; index += 1) {
        const angle = baseAngle + index * (Math.PI * 2 / Math.max(1, spawnConfig.count));
        this.hostSpawnAtWorld(
          deathX + Math.cos(angle) * spawnConfig.offsetPx,
          deathY + Math.sin(angle) * spawnConfig.offsetPx,
          spawnConfig.enemyKind,
        );
      }
    }
    return { died: true, remainingHp: 0, death };
  }

  hostRemoveEnemy(id: string): void {
    const enemy = this.enemies.get(id);
    if (!enemy) return;
    this.pendingRemovals.set(id, ENEMY_NET_REMOVAL_RESEND_TICKS);
    this.netSnapshotCache.delete(id);
    enemy.destroy();
    this.enemies.delete(id);
    this.wildfirePanicStates.delete(id);
  }

  syncHostVisuals(): void {
    for (const enemy of this.enemies.values()) {
      enemy.syncBar();
    }
  }

  applySnapshot(snapshot: SyncedEnemySnapshot | null): void {
    if (!snapshot) return;

    const upserts = decodeEnemyUpserts(snapshot.u);

    // Periodische Reconciliation: liegt die vollständige aktive ID-Liste vor, lösche jeden lokalen
    // Gegner, dessen ID darin fehlt (Backstop gegen verpasste Removals = "Phantom"-Gegner).
    if (snapshot.a) {
      const activeIds = new Set(snapshot.a);
      for (const [id, enemy] of this.enemies) {
        if (activeIds.has(enemyIdToNum(id))) continue;
        enemy.destroy();
        this.enemies.delete(id);
      }
    }

    for (const idNum of snapshot.r) {
      const id = enemyNumToId(idNum);
      const enemy = this.enemies.get(id);
      if (!enemy) continue;
      enemy.destroy();
      this.enemies.delete(id);
    }

    for (const remote of upserts) {
      this.applyRemoteSnapshot(remote);
    }
  }

  updateClientInterpolation(factor: number): void {
    for (const enemy of this.enemies.values()) {
      enemy.lerpStep(factor);
    }
  }

  destroy(): void {
    for (const enemy of this.enemies.values()) {
      enemy.destroy();
    }
    this.enemies.clear();
    this.wildfirePanicStates.clear();
    this.netSnapshotCache.clear();
    this.pendingRemovals.clear();
    this.nextEnemyIdSeq = 1;
    this.ticksSinceActiveList = ENEMY_NET_ACTIVE_LIST_INTERVAL_TICKS;
    this.refreshCursor = 0;
  }

  private collectRefreshIds(sortedEnemies: EnemyEntity[]): Set<string> {
    if (sortedEnemies.length === 0) {
      this.refreshCursor = 0;
      return new Set<string>();
    }

    const refreshCount = Math.max(1, Math.ceil(sortedEnemies.length / ENEMY_NET_REFRESH_CYCLE_TICKS));
    const ids = new Set<string>();

    for (let offset = 0; offset < refreshCount; offset += 1) {
      const enemy = sortedEnemies[(this.refreshCursor + offset) % sortedEnemies.length];
      ids.add(enemy.id);
    }

    this.refreshCursor = (this.refreshCursor + refreshCount) % sortedEnemies.length;
    return ids;
  }

  private buildNetState(enemy: EnemyEntity): SyncedEnemyState {
    const snapshot = enemy.getNetSnapshot();
    return {
      ...snapshot,
      x: Math.round(snapshot.x),
      y: Math.round(snapshot.y),
      rot: Math.round(snapshot.rot * 100) / 100,
      faction: snapshot.faction,
      ownerId: snapshot.ownerId,
      ownerColor: snapshot.ownerColor,
    };
  }

  private buildDeltaState(previous: SyncedEnemyState, current: SyncedEnemyState): SyncedEnemyDeltaState | null {
    const delta: SyncedEnemyDeltaState = { id: current.id };

    if (current.kind !== previous.kind) {
      delta.kind = current.kind;
    }

    if (
      Math.abs(current.x - previous.x) >= ENEMY_NET_POSITION_DELTA_PX
      || Math.abs(current.y - previous.y) >= ENEMY_NET_POSITION_DELTA_PX
    ) {
      delta.x = current.x;
      delta.y = current.y;
    }

    if (Math.abs(Phaser.Math.Angle.Wrap(current.rot - previous.rot)) >= ENEMY_NET_ROTATION_DELTA_RAD) {
      delta.rot = current.rot;
    }

    if (current.hp !== previous.hp || current.maxHp !== previous.maxHp) {
      delta.hp = current.hp;
      delta.maxHp = current.maxHp;
    }

    if (current.burnStacks !== previous.burnStacks) {
      delta.burnStacks = current.burnStacks;
    }
    if (current.faction !== previous.faction || current.ownerId !== previous.ownerId || current.ownerColor !== previous.ownerColor) {
      delta.faction = current.faction;
      delta.ownerId = current.ownerId;
      delta.ownerColor = current.ownerColor;
    }

    return Object.keys(delta).length > 1 ? delta : null;
  }

  private applyRemoteSnapshot(remote: SyncedEnemyDeltaState): void {
    let enemy = this.enemies.get(remote.id);
    if (!enemy) {
      if (remote.kind === undefined || remote.x === undefined || remote.y === undefined) return;
      enemy = new EnemyEntity(
        this.scene,
        remote.id,
        remote.x,
        remote.y,
        false,
        remote.kind,
        this.resolvedConfigs[remote.kind],
        remote.faction ?? 'hostile',
        remote.ownerId,
        remote.ownerColor,
      );
      const rotation = remote.rot ?? 0;
      enemy.faceAngle(rotation);
      enemy.setTargetRotation(rotation);
      enemy.setHp(remote.hp ?? remote.maxHp ?? 1, remote.maxHp ?? remote.hp ?? 1);
      enemy.updateBurnStacks(remote.burnStacks ?? 0);
      this.enemies.set(remote.id, enemy);
      return;
    }

    if (remote.hp !== undefined || remote.maxHp !== undefined) {
      enemy.setHp(remote.hp ?? enemy.getHp(), remote.maxHp ?? enemy.getMaxHp());
    }
    if (remote.burnStacks !== undefined) enemy.updateBurnStacks(remote.burnStacks);
    if (remote.x !== undefined || remote.y !== undefined) {
      enemy.setTargetPosition(remote.x ?? enemy.sprite.x, remote.y ?? enemy.sprite.y);
    }
    if (remote.rot !== undefined) {
      enemy.setTargetRotation(remote.rot);
    }
  }

  private generateEnemyId(_kind: CoopDefenseEnemyKind): string {
    return `e${(this.nextEnemyIdSeq++).toString(36)}`;
  }

  private gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE * 0.5,
      y: ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE * 0.5,
    };
  }
}
