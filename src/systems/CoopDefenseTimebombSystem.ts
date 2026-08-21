import {
  getCoopDefenseEnemyConfig,
  type CoopDefenseEnemyTimebombConfig,
} from '../config/coopDefenseEnemies';
import type { BaseManager } from '../entities/BaseManager';
import type { EnemyDeathInfo, EnemyManager, EnemySpecialMovementSource } from '../entities/EnemyManager';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { PlayerManager } from '../entities/PlayerManager';
import type { FlamethrowerUpgradeSystem } from './FlamethrowerUpgradeSystem';
import type { CombatSystem } from './CombatSystem';
import type { PlacementSystem } from './PlacementSystem';
import type { DecoySystem } from './DecoySystem';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';
import {
  EnemyStrategicTargetService,
  type EnemyStrategicTargetRef,
} from './EnemyStrategicTargetService';

const TIMEBOMB_REPATH_INTERVAL_MS = 250;
const TIMEBOMB_MIN_TICK_INTERVAL_MS = 90;
const TIMEBOMB_MAX_TICK_INTERVAL_MS = 360;

export type TimebombSoundEventType =
  | 'timebomb-activate'
  | 'timebomb-fuse-start'
  | 'timebomb-fuse-tick'
  | 'timebomb-detonate'
  | 'timebomb-killed-pop';

export interface TimebombSoundEvent {
  readonly type: TimebombSoundEventType;
  readonly enemyId: string;
  readonly x: number;
  readonly y: number;
}

interface TimebombState {
  phase: 'approach' | 'chase' | 'fuse';
  target: EnemyStrategicTargetRef | null;
  lastTargetX: number;
  lastTargetY: number;
  lineOfSightSince: number;
  fuseEndsAt: number;
  nextTickAt: number;
  repathAt: number;
  waypoint: { x: number; y: number } | null;
  directPathClear: boolean | null;
  directPathCheckAt: number;
  directPathFromGridX: number;
  directPathFromGridY: number;
  directPathTargetGridX: number;
  directPathTargetGridY: number;
}

export interface CoopDefenseTimebombHooks {
  readonly playExplosion: (x: number, y: number, radius: number, style: 'timebomb' | 'timebomb_pop') => void;
  readonly applyRadialImpulse: (x: number, y: number, radius: number, force: number, ownerId: string) => void;
  readonly damageConstruction: (id: number, damage: number, attackerId: string) => void;
  readonly onSelfDetonated?: (enemyId: string) => void;
  readonly sound?: (event: TimebombSoundEvent) => void;
}

/** Hostautoritative Dreiphasen-Logik des Zeitbombendachses. */
export class CoopDefenseTimebombSystem implements EnemySpecialMovementSource {
  private readonly states = new Map<string, TimebombState>();

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly playerManager: PlayerManager,
    private readonly baseManager: BaseManager,
    private readonly placementSystem: PlacementSystem,
    private readonly combatSystem: CombatSystem,
    private readonly strategicTargets: EnemyStrategicTargetService,
    private readonly strategicFlowField: EnemyFlowFieldService,
    private readonly fireChunks: FlamethrowerUpgradeSystem | null,
    private readonly hooks: CoopDefenseTimebombHooks,
    private readonly decoySystem: DecoySystem | null = null,
  ) {}

  hostUpdate(now: number): void {
    const active = new Set<string>();
    for (const enemy of this.enemyManager.getHostileEnemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).timebomb;
      if (!config || !enemy.sprite.active || enemy.getHp() <= 0) continue;
      active.add(enemy.id);
      const state = this.states.get(enemy.id) ?? this.createState(enemy);
      this.states.set(enemy.id, state);

      if (state.phase === 'approach') this.updateApproach(enemy, state, config, now);
      else if (state.phase === 'chase') this.updateChase(enemy, state, config, now);
      else this.updateFuse(enemy, state, config, now);
    }

    for (const enemyId of this.states.keys()) {
      if (!active.has(enemyId)) this.states.delete(enemyId);
    }
  }

  getMovementOverride(enemy: EnemyEntity, now: number): { vx: number; vy: number } | null {
    const state = this.states.get(enemy.id);
    const config = getCoopDefenseEnemyConfig(enemy.kind).timebomb;
    if (!state || !config || state.phase === 'approach') return null;
    if (state.phase === 'fuse') return { vx: 0, vy: 0 };

    const targetPosition = state.target
      ? this.strategicTargets.getPosition(state.target, enemy.sprite.x, enemy.sprite.y)
      : null;
    if (targetPosition) {
      state.lastTargetX = targetPosition.x;
      state.lastTargetY = targetPosition.y;
    }

    const targetX = state.lastTargetX;
    const targetY = state.lastTargetY;
    let steerX = targetX;
    let steerY = targetY;
    const from = this.strategicFlowField.worldToGrid(enemy.sprite.x, enemy.sprite.y);
    const to = this.strategicFlowField.worldToGrid(targetX, targetY);
    const hasDirectPath = this.hasCachedDirectPath(enemy, state, targetX, targetY, from, to, now);
    if (hasDirectPath) {
      // Ein alter Umwegpunkt darf nicht wieder greifen, falls die direkte Linie am Rand eines
      // Hindernisses im naechsten Frame erneut blockiert ist. Sonst liegt er oft bereits hinter
      // dem schnellen Dachs und dreht dessen Geschwindigkeit fuer einen kurzen Moment um.
      state.waypoint = null;
      state.repathAt = 0;
    } else {
      const waypointCell = state.waypoint
        ? this.strategicFlowField.worldToGrid(state.waypoint.x, state.waypoint.y)
        : null;
      const enteredWaypointCell = Boolean(
        from
        && waypointCell
        && from.gridX === waypointCell.gridX
        && from.gridY === waypointCell.gridY,
      );
      if (now >= state.repathAt || !state.waypoint || enteredWaypointCell) {
        state.waypoint = from && to
          ? this.strategicFlowField.findNextWorldPositionTowards(from.gridX, from.gridY, to.gridX, to.gridY)
          : null;
        state.repathAt = now + TIMEBOMB_REPATH_INTERVAL_MS;
      }
      if (state.waypoint) {
        steerX = state.waypoint.x;
        steerY = state.waypoint.y;
      }
    }

    const dx = steerX - enemy.sprite.x;
    const dy = steerY - enemy.sprite.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0.001) return { vx: 0, vy: 0 };
    const speed = enemy.getMoveSpeed() * config.chaseSpeedMultiplier;
    return { vx: dx / length * speed, vy: dy / length * speed };
  }

  blocksRegularBehavior(enemyId: string): boolean {
    const phase = this.states.get(enemyId)?.phase;
    return phase === 'chase' || phase === 'fuse';
  }

  handleKilled(death: EnemyDeathInfo, now = Date.now()): boolean {
    const config = getCoopDefenseEnemyConfig(death.kind).timebomb;
    if (!config || death.faction !== 'hostile') return false;
    this.states.delete(death.id);
    this.damagePlayers(death.id, death.x, death.y, config.killedPopRadiusPx, config.killedPopDamage, 'Zeitbomben-Verpuffung');
    this.damageDecoys(death.id, death.x, death.y, config.killedPopRadiusPx, config.killedPopDamage, 'Zeitbomben-Verpuffung');
    this.hooks.playExplosion(death.x, death.y, config.killedPopRadiusPx, 'timebomb_pop');
    this.emitSound('timebomb-killed-pop', death.id, death.x, death.y);
    return true;
  }

  clear(): void {
    for (const enemyId of this.states.keys()) {
      this.enemyManager.getEnemy(enemyId)?.setSpecialAction('none');
    }
    this.states.clear();
  }

  private createState(enemy: EnemyEntity): TimebombState {
    return {
      phase: 'approach',
      target: null,
      lastTargetX: enemy.sprite.x,
      lastTargetY: enemy.sprite.y,
      lineOfSightSince: 0,
      fuseEndsAt: 0,
      nextTickAt: 0,
      repathAt: 0,
      waypoint: null,
      directPathClear: null,
      directPathCheckAt: 0,
      directPathFromGridX: -1,
      directPathFromGridY: -1,
      directPathTargetGridX: -1,
      directPathTargetGridY: -1,
    };
  }

  private hasCachedDirectPath(
    enemy: EnemyEntity,
    state: TimebombState,
    targetX: number,
    targetY: number,
    from: { gridX: number; gridY: number } | null,
    to: { gridX: number; gridY: number } | null,
    now: number,
  ): boolean {
    // Test doubles und alte Aufrufer koennen nur den zellbasierten Check anbieten. Der echte
    // Service nutzt darunter den radiusabhaengigen Sonderbewegungs-Helper.
    if (typeof this.strategicFlowField.hasWalkableCircleLine !== 'function') {
      return this.strategicFlowField.hasWalkableLine(enemy.sprite.x, enemy.sprite.y, targetX, targetY);
    }

    const changedCell = state.directPathFromGridX !== (from?.gridX ?? -1)
      || state.directPathFromGridY !== (from?.gridY ?? -1)
      || state.directPathTargetGridX !== (to?.gridX ?? -1)
      || state.directPathTargetGridY !== (to?.gridY ?? -1);
    if (
      state.directPathClear === null
      || changedCell
      || now >= state.directPathCheckAt
    ) {
      state.directPathFromGridX = from?.gridX ?? -1;
      state.directPathFromGridY = from?.gridY ?? -1;
      state.directPathTargetGridX = to?.gridX ?? -1;
      state.directPathTargetGridY = to?.gridY ?? -1;
      state.directPathClear = Boolean(from && to) && this.strategicFlowField.hasWalkableCircleLine(
        enemy.sprite.x,
        enemy.sprite.y,
        targetX,
        targetY,
        enemy.getCollisionRadius(),
      );
      state.directPathCheckAt = now + TIMEBOMB_REPATH_INTERVAL_MS;
    }
    return state.directPathClear === true;
  }

  private updateApproach(
    enemy: EnemyEntity,
    state: TimebombState,
    config: CoopDefenseEnemyTimebombConfig,
    now: number,
  ): void {
    // Sobald dieser Dachs eine gueltige Sichtpruefung begonnen hat, bleibt deren Ziel fuer die
    // volle Haltezeit gebunden. Aendert das gemeinsame Flow Field zwischenzeitlich seine konkrete
    // Praeferenz, setzt das nicht mehr den individuellen Aktivierungstimer zurueck.
    const target = state.target
      ?? this.strategicTargets.selectTarget('players-and-armed-constructs', enemy.sprite.x, enemy.sprite.y);
    if (!target) {
      this.resetLineOfSight(state);
      return;
    }
    const targetPosition = this.strategicTargets.getPosition(target, enemy.sprite.x, enemy.sprite.y);
    if (!targetPosition) {
      this.resetLineOfSight(state);
      return;
    }
    const distance = Math.hypot(targetPosition.x - enemy.sprite.x, targetPosition.y - enemy.sprite.y);
    const skipRockIndex = target.kind === 'armed-construct' ? Number(target.id) : undefined;
    const visible = distance <= config.activationRadiusPx && this.combatSystem.hasLineOfSight(
      enemy.sprite.x,
      enemy.sprite.y,
      targetPosition.x,
      targetPosition.y,
      skipRockIndex,
    );
    if (!visible) {
      this.resetLineOfSight(state);
      return;
    }
    if (!state.target) {
      state.target = { kind: target.kind, id: target.id };
      state.lineOfSightSince = now;
      return;
    }
    if (now - state.lineOfSightSince < config.lineOfSightDurationMs) return;

    state.phase = 'chase';
    state.target = { kind: target.kind, id: target.id };
    state.lastTargetX = targetPosition.x;
    state.lastTargetY = targetPosition.y;
    state.repathAt = 0;
    enemy.setSpecialAction('timebomb-chase');
    this.emitSound('timebomb-activate', enemy.id, enemy.sprite.x, enemy.sprite.y);
  }

  private updateChase(
    enemy: EnemyEntity,
    state: TimebombState,
    config: CoopDefenseEnemyTimebombConfig,
    now: number,
  ): void {
    const targetPosition = state.target
      ? this.strategicTargets.getPosition(state.target, enemy.sprite.x, enemy.sprite.y)
      : null;
    if (targetPosition) {
      state.lastTargetX = targetPosition.x;
      state.lastTargetY = targetPosition.y;
    } else if (state.target) {
      // Das gebundene Ziel ist weg: kein Retargeting. Der naechste sichere Rasterpunkt wird zum
      // festen Zuendort, damit die Jagd nicht in einen anderen Spieler umspringt.
      state.target = null;
      const cell = this.strategicFlowField.worldToGrid(enemy.sprite.x, enemy.sprite.y);
      const fallback = cell
        ? this.strategicFlowField.findNearestReachableWorldPosition(cell.gridX, cell.gridY)
        : null;
      state.lastTargetX = fallback?.x ?? enemy.sprite.x;
      state.lastTargetY = fallback?.y ?? enemy.sprite.y;
    }

    const distance = Math.hypot(state.lastTargetX - enemy.sprite.x, state.lastTargetY - enemy.sprite.y);
    if (distance > config.fuseDistancePx) return;
    this.startFuse(enemy, state, config, now);
  }

  private startFuse(
    enemy: EnemyEntity,
    state: TimebombState,
    config: CoopDefenseEnemyTimebombConfig,
    now: number,
  ): void {
    state.phase = 'fuse';
    state.fuseEndsAt = now + config.fuseDurationMs;
    state.nextTickAt = now;
    state.waypoint = null;
    enemy.stopMovement();
    enemy.setSpecialAction('timebomb-fuse', state.fuseEndsAt);
    this.emitSound('timebomb-fuse-start', enemy.id, enemy.sprite.x, enemy.sprite.y);
  }

  private updateFuse(
    enemy: EnemyEntity,
    state: TimebombState,
    config: CoopDefenseEnemyTimebombConfig,
    now: number,
  ): void {
    enemy.stopMovement();
    const progress = Math.max(0, Math.min(1, 1 - (state.fuseEndsAt - now) / config.fuseDurationMs));
    enemy.setSpecialAction('timebomb-fuse', state.fuseEndsAt, progress);
    if (now >= state.fuseEndsAt) {
      this.detonate(enemy, config, now);
      return;
    }
    if (now < state.nextTickAt) return;
    const remainingFraction = Math.max(0, (state.fuseEndsAt - now) / config.fuseDurationMs);
    const interval = TIMEBOMB_MIN_TICK_INTERVAL_MS
      + (TIMEBOMB_MAX_TICK_INTERVAL_MS - TIMEBOMB_MIN_TICK_INTERVAL_MS) * remainingFraction;
    state.nextTickAt = now + interval;
    this.emitSound('timebomb-fuse-tick', enemy.id, enemy.sprite.x, enemy.sprite.y);
  }

  private detonate(enemy: EnemyEntity, config: CoopDefenseEnemyTimebombConfig, now: number): void {
    const x = enemy.sprite.x;
    const y = enemy.sprite.y;
    this.states.delete(enemy.id);
    this.damagePlayers(enemy.id, x, y, config.explosionRadiusPx, config.explosionDamage, 'Zeitbombendachs');
    this.damageDecoys(enemy.id, x, y, config.explosionRadiusPx, config.explosionDamage, 'Zeitbombendachs');
    this.damageConstructions(enemy.id, x, y, config.explosionRadiusPx, config.explosionDamage);
    this.damageArmedOutposts(enemy.id, x, y, config.explosionRadiusPx, config.explosionDamage);
    this.hooks.applyRadialImpulse(x, y, config.explosionRadiusPx, config.explosionKnockback, enemy.id);
    this.hooks.playExplosion(x, y, config.explosionRadiusPx, 'timebomb');
    this.fireChunks?.hostCreateFireChunkBurst(
      enemy.id,
      x,
      y,
      config.fireChunks,
      `timebomb:${enemy.id}:${now}`,
      now,
    );
    this.emitSound('timebomb-detonate', enemy.id, x, y);
    // Bis hier bleibt der Gegner registriert, damit Schadensregeln seine feindliche Fraktion
    // erkennen. Erst nach allen synchronen Explosionswirkungen folgt die belohnungsfreie Entfernung.
    this.enemyManager.hostRemoveWithoutKill(enemy.id);
    this.hooks.onSelfDetonated?.(enemy.id);
  }

  private damagePlayers(
    attackerId: string,
    x: number,
    y: number,
    radius: number,
    maxDamage: number,
    sourceId: string,
  ): void {
    if (maxDamage <= 0) return;
    for (const player of this.playerManager.getAllPlayers()) {
      if (!player.sprite.active || !this.combatSystem.isAlive(player.id) || this.combatSystem.isBurrowed(player.id)) continue;
      const distance = Math.hypot(player.sprite.x - x, player.sprite.y - y);
      if (distance > radius) continue;
      const damage = Math.round(maxDamage * (0.2 + 0.8 * (1 - distance / radius)));
      this.combatSystem.applyDamage(player.id, damage, false, attackerId, sourceId, { sourceX: x, sourceY: y });
    }
  }

  private damageDecoys(
    attackerId: string,
    x: number,
    y: number,
    radius: number,
    maxDamage: number,
    sourceId: string,
  ): void {
    if (!this.decoySystem || maxDamage <= 0) return;
    for (const decoy of this.decoySystem.getHostTargets()) {
      if (!decoy.sprite.active) continue;
      const distance = Math.hypot(decoy.sprite.x - x, decoy.sprite.y - y);
      if (distance > radius) continue;
      const damage = Math.round(maxDamage * (0.2 + 0.8 * (1 - distance / radius)));
      this.decoySystem.applyDamage(decoy.id, damage, attackerId, sourceId, { sourceX: x, sourceY: y });
    }
  }

  private damageConstructions(attackerId: string, x: number, y: number, radius: number, maxDamage: number): void {
    for (const construction of this.placementSystem.getAllRuntimeRocks()) {
      if (construction.hp <= 0 || construction.kind !== 'turret') continue;
      const world = this.strategicFlowField.gridToWorld(construction.gridX, construction.gridY);
      if (!world) continue;
      const distance = Math.hypot(world.x - x, world.y - y);
      if (distance > radius) continue;
      const damage = Math.round(maxDamage * (0.2 + 0.8 * (1 - distance / radius)));
      this.hooks.damageConstruction(construction.id, damage, attackerId);
    }
  }

  private damageArmedOutposts(attackerId: string, x: number, y: number, radius: number, maxDamage: number): void {
    for (const base of this.baseManager.getBasesByFaction('friendly')) {
      if (base.role !== 'outpost' || (base.isInert?.() ?? false) || base.getHp() <= 0 || base.getTurrets().length === 0) continue;
      const surface = base.getNearestSurfacePoint(x, y);
      if (!surface || surface.distance > radius) continue;
      const damage = Math.round(maxDamage * (0.2 + 0.8 * (1 - surface.distance / radius)));
      // Auch Gegner-Spezialschaden laeuft durch den zentralen Zielstatuspfad, damit Matrixschutz
      // und Verwundbarkeit auf Basen fuer jede Schadensquelle gleich gelten. Der ausgehende
      // Spielerresolver bleibt fuer die feindliche Angreifer-ID neutral.
      this.combatSystem.applyBaseDamage(base.id, damage, attackerId);
    }
  }

  private resetLineOfSight(state: TimebombState): void {
    state.target = null;
    state.lineOfSightSince = 0;
  }

  private emitSound(type: TimebombSoundEventType, enemyId: string, x: number, y: number): void {
    this.hooks.sound?.({ type, enemyId, x, y });
  }
}
