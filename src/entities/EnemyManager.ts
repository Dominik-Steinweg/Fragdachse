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
import type { BurrowPhase, SpawnFront, SyncedEnemyDeltaState, SyncedEnemySnapshot, SyncedEnemyState } from '../types';
import {
  decodeEnemyUpserts,
  encodeEnemyUpsert,
  enemyIdToNum,
  enemyNumToId,
} from '../network/enemySnapshotCodec';
import { EnemyEntity, type EnemyFaction } from './EnemyEntity';
import type { LightingSystem } from '../effects/LightingSystem';
import {
  resolveCoopDefenseEnemyConfigs,
  type CoopDefenseEnemyKind,
  type ResolvedCoopDefenseEnemyConfigs,
} from '../config/coopDefenseEnemies';

const STEER_RESPONSIVENESS = 8;
const SPAWN_LANE_JITTER_PX = CELL_SIZE * 0.3;
const SEPARATION_RADIUS_PX = CELL_SIZE * 2;
const SEPARATION_RADIUS_SQ = SEPARATION_RADIUS_PX * SEPARATION_RADIUS_PX;
const SEPARATION_STRENGTH = 0.6;
const WALL_ADJACENT_SEPARATION_MULTIPLIER = 0.1;
const NO_SEPARATION = { x: 0, y: 0 } as const;

export interface EnemyDeathInfo {
  readonly id: string;
  readonly kind: CoopDefenseEnemyKind;
  readonly x: number;
  readonly y: number;
  /** Volle Kantenlänge des gestorbenen Gegners – Maßstab für Leichen-Visuals. */
  readonly size: number;
  readonly faction: EnemyFaction;
  readonly ownerId?: string;
}

/**
 * Letzte Instanz vor dem Tod eines Gegners. Gibt der Wächter `true` zurück, hat er den Gegner
 * bereits wieder mit HP versorgt und der Tod entfällt – genutzt von der Nekromantie, damit die
 * stärksten Wiederbelebten einen tödlichen Treffer überstehen.
 */
export type EnemyLethalDamageGuard = (enemy: EnemyEntity) => boolean;

/**
 * Minimal-Schnittstelle des Gegner-Einbuddel-Systems für die Bewegung – als lokaler Typ gehalten,
 * damit der EnemyManager nicht auf das System zurück-importieren muss.
 */
export interface EnemyBurrowMovementSource {
  isBurrowed(enemyId: string): boolean;
  /** Erzwungene Grabrichtung während der Einbuddel-Anfahrt; null = normale Wegfindung. */
  getForcedDirection(enemyId: string): { x: number; y: number } | null;
  getSpeedFactor(enemyId: string): number;
}

/**
 * Minimal-Schnittstelle des Gefechtsabstand-Systems – strukturell erfüllt vom
 * CoopDefenseEnemyCombatPositioningSystem. Liefert für Fernkämpfer eine Wunschgeschwindigkeit,
 * die die Wegfindung ersetzt (Rückzug oder Stehenbleiben auf dem gewünschten Abstand).
 */
export interface EnemyCombatPositioningSource {
  getMovementOverride(enemyId: string): { vx: number; vy: number } | null;
}

/** Exklusive Spezialbewegung, die normale KI-Zweige fuer diesen Frame ersetzt. */
export interface EnemySpecialMovementSource {
  getMovementOverride(enemy: EnemyEntity, now: number): { vx: number; vy: number } | null;
}

/**
 * Gegner-Visuals, die nicht an der Entity selbst hängen: Buddel-Partikel und der Spawn-Effekt.
 * Strukturell erfüllt vom EffectSystem, das dieselben Effekte für Spieler zeichnet – als lokaler
 * Typ gehalten, damit der EnemyManager nicht auf die Effekt-Schicht importieren muss.
 */
export interface EnemyVisualSink {
  syncBurrowState(id: string, phase: BurrowPhase, sprite?: Phaser.GameObjects.Image): void;
  clearBurrowState(id: string): void;
  playBurrowPhaseEffect(x: number, y: number, phase: BurrowPhase): void;
  playEnemySpawnEffect(x: number, y: number, colorHex: number): void;
}

interface WildfirePanicState extends WildfireSourceInfo {
  directionX: number;
  directionY: number;
  lastTrailCellKey: string | null;
  lastTrailX: number;
  lastTrailY: number;
}

export interface EnemySpawnOptions {
  /** Spawn visual is represented by the burrow effect instead of the normal materialization burst. */
  readonly spawnBurrowed?: boolean;
  /** Authored edge for generic edge-burrow spawns; legacy callers default to west. */
  readonly spawnFront?: SpawnFront;
  /** Host-only generic provenance, e.g. the owning encounter id. */
  readonly originId?: string;
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
  private forceFullNetSnapshot = false;
  private refreshCursor = 0;
  private readonly wildfirePanicStates = new Map<string, WildfirePanicState>();
  private readonly separationVector = { x: 0, y: 0 };
  private onEnemySpawned: ((enemy: EnemyEntity, options?: EnemySpawnOptions) => void) | null = null;
  private lethalDamageGuard: EnemyLethalDamageGuard | null = null;
  private visualSink: EnemyVisualSink | null = null;
  private lighting: LightingSystem | null = null;
  /**
   * True, sobald der erste Snapshot verarbeitet wurde. Die Gegner daraus existieren beim Host
   * bereits seit Längerem – ein Client, der mitten in die Runde kommt, würde sonst für das
   * gesamte laufende Feld gleichzeitig Spawn-Effekte zünden.
   */
  private remoteSnapshotSeen = false;

  constructor(scene: Phaser.Scene, resolvedConfigs: ResolvedCoopDefenseEnemyConfigs = resolveCoopDefenseEnemyConfigs(1)) {
    this.scene = scene;
    this.resolvedConfigs = resolvedConfigs;
  }

  /** Reicht die scene-lifetime Beleuchtung an neue und bestehende Gegner durch. */
  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
    for (const enemy of this.enemies.values()) enemy.setLightingSystem(lighting);
  }

  /**
   * Host-Callback fuer jeden neu erzeugten Gegner – unabhaengig davon, ob er aus einer Welle,
   * einem Death-Spawn oder einer Gegner-Faehigkeit stammt.
   */
  setEnemySpawnedCallback(callback: ((enemy: EnemyEntity, options?: EnemySpawnOptions) => void) | null): void {
    this.onEnemySpawned = callback;
  }

  /** Host-seitiger Wächter, der einen tödlichen Treffer abfangen darf. */
  setLethalDamageGuard(guard: EnemyLethalDamageGuard | null): void {
    this.lethalDamageGuard = guard;
  }

  /** Registriert die Effekt-Schicht für Buddel- und Spawn-Visuals (Host wie Client). */
  setVisualSink(sink: EnemyVisualSink | null): void {
    this.visualSink = sink;
  }

  /**
   * Einziger Weg, den Einbuddel-Zustand eines Gegners zu setzen – hier hängen die Buddel-Visuals
   * dran. Der Host ruft das aus dem Burrow-System, der Client beim Anwenden des Snapshots, so dass
   * beide Seiten dieselbe Darstellung wie bei eingebuddelten Spielern zeigen.
   */
  setEnemyBurrowed(enemyId: string, burrowed: boolean): void {
    const enemy = this.enemies.get(enemyId);
    if (!enemy || !enemy.setBurrowed(burrowed)) return;

    const sink = this.visualSink;
    if (!sink) return;
    sink.playBurrowPhaseEffect(enemy.sprite.x, enemy.sprite.y, burrowed ? 'windup' : 'recovery');
    if (burrowed) sink.syncBurrowState(enemyId, 'underground', enemy.sprite);
    else sink.clearBurrowState(enemyId);
  }

  hostSpawnDummyAt(
    gridX: number,
    gridY: number,
    kind: CoopDefenseEnemyKind = 'zombie-badger',
    options: EnemySpawnOptions = {},
  ): EnemyEntity {
    const world = this.gridToWorld(gridX, gridY);
    const x = world.x + Phaser.Math.RND.realInRange(-SPAWN_LANE_JITTER_PX, SPAWN_LANE_JITTER_PX);
    const y = world.y + Phaser.Math.RND.realInRange(-SPAWN_LANE_JITTER_PX, SPAWN_LANE_JITTER_PX);
    return this.hostSpawnAtWorld(x, y, kind, options);
  }

  hostSpawnAtWorld(
    x: number,
    y: number,
    kind: CoopDefenseEnemyKind,
    options: EnemySpawnOptions = {},
  ): EnemyEntity {
    return this.hostSpawnUnitAtWorld(x, y, kind, 'hostile', undefined, undefined, options);
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
    options: EnemySpawnOptions = {},
  ): EnemyEntity {
    const id = this.generateEnemyId(kind);
    const enemy = new EnemyEntity(
      this.scene,
      id,
      x,
      y,
      true,
      kind,
      this.resolvedConfigs[kind],
      faction,
      ownerId,
      ownerColor,
      options.originId,
    );
    enemy.setLightingSystem(this.lighting);
    this.enemies.set(id, enemy);
    this.playSpawnEffect(enemy, options);
    this.onEnemySpawned?.(enemy, options);
    return enemy;
  }

  /**
   * Spawn-Effekt am Erscheinungsort. Host und Client zünden ihn jeweils lokal beim Anlegen der
   * Entity – derselbe Weg wie bei den Buddel-Visuals, also ohne eigenen Netzwerkpfad.
   *
   * Gegner, die eingebuddelt am Spielfeldrand starten, bleiben aussen vor: sie sind beim Spawn
   * unsichtbar, und ihr Auftauchen hat mit dem Buddel-Effekt bereits seine eigene Ankündigung.
   */
  private playSpawnEffect(enemy: EnemyEntity, options: EnemySpawnOptions): void {
    if (options.spawnBurrowed || this.resolvedConfigs[enemy.kind]?.burrow?.spawnBurrowedAtEdge) return;
    this.visualSink?.playEnemySpawnEffect(enemy.sprite.x, enemy.sprite.y, enemy.getSpawnEffectColor());
  }

  hostUpdateMovement(
    baseFlowFieldService: EnemyFlowFieldService | null,
    playerFlowFieldService: EnemyFlowFieldService | null,
    strategicFlowFieldService: EnemyFlowFieldService | null,
    bossFlowFieldService: EnemyFlowFieldService | null,
    movementLocked: boolean,
    now: number,
    deltaMs: number,
    fireSystem?: FireSystem | null,
    activeBurnSourceResolver?: ((enemyId: string, now: number) => ReadonlyArray<{ sourceId: string }>) | null,
    trainAwarenessSystem?: CoopDefenseEnemyTrainAwarenessSystem | null,
    burrowSystem?: EnemyBurrowMovementSource | null,
    combatPositioningSystem?: EnemyCombatPositioningSource | null,
    specialMovementSource?: EnemySpecialMovementSource | null,
  ): void {
    const lerpT = 1 - Math.exp(-STEER_RESPONSIVENESS * (deltaMs / 1000));
    const separationGrid = this.buildSeparationGrid();

    for (const enemy of this.enemies.values()) {
      if (enemy.faction === 'allied') continue;
      // Standardfall: der Gegner hat eine Route. Nur die Zweige, die ihn wirklich ohne Weg
      // stehen lassen, setzen die Markierung – daran erkennt das Angriffssystem, dass ein
      // reglos stehender Gegner festhängt und einen Felsen wegbeißen darf.
      enemy.setPathBlocked(false);
      const config = this.resolvedConfigs[enemy.kind];
      const isBurrowed = burrowSystem?.isBurrowed(enemy.id) ?? false;
      const burrowSpeedFactor = isBurrowed ? (burrowSystem?.getSpeedFactor(enemy.id) ?? 1) : 1;
      // Unter der Erde ist der Zug keine Gefahr – die Gleis-KI bleibt dann komplett aussen vor.
      const activeTrainAwareness = isBurrowed ? null : trainAwarenessSystem;
      const primaryFlowFieldService = config.movementTarget === 'players-and-armed-constructs'
        ? strategicFlowFieldService ?? playerFlowFieldService ?? baseFlowFieldService
        : config.isBoss
          ? bossFlowFieldService ?? baseFlowFieldService
          : config.movementTarget === 'players'
          ? playerFlowFieldService ?? baseFlowFieldService
          : baseFlowFieldService;

      if (movementLocked) {
        enemy.stopMovement();
        continue;
      }

      // Einbuddel-Anfahrt: der Gegner graebt sich stur in die vorgegebene Richtung, bis das
      // Burrow-System ein freies Feld meldet. Wegfindung, Separation und Gleis-KI ruhen solange.
      const forcedBurrowDirection = burrowSystem?.getForcedDirection(enemy.id) ?? null;
      if (forcedBurrowDirection) {
        const burrowSpeed = enemy.getMoveSpeed() * burrowSpeedFactor;
        enemy.setDesiredVelocity(
          forcedBurrowDirection.x * burrowSpeed,
          forcedBurrowDirection.y * burrowSpeed,
        );
        continue;
      }

      const specialMovement = specialMovementSource?.getMovementOverride(enemy, now) ?? null;
      if (specialMovement) {
        enemy.setDesiredVelocity(specialMovement.vx, specialMovement.vy);
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
        const decision = activeTrainAwareness?.resolveMovement(enemy, targetVx, targetVy, now);
        enemy.setDesiredVelocity(
          decision?.override ? decision.vx : Phaser.Math.Linear(current.vx, targetVx, lerpT),
          decision?.override ? decision.vy : Phaser.Math.Linear(current.vy, targetVy, lerpT),
        );
        continue;
      }

      if (!primaryFlowFieldService) {
        enemy.stopMovement();
        continue;
      }

      if (enemy.isAttackMovementPaused(now)) {
        const current = enemy.getDesiredVelocity();
        const trainDecision = activeTrainAwareness?.resolveMovement(enemy, current.vx, current.vy, now);
        if (trainDecision?.override && activeTrainAwareness?.blocksRegularAttacks(enemy.id)) {
          enemy.setDesiredVelocity(trainDecision.vx, trainDecision.vy);
        } else {
          enemy.stopMovement();
        }
        continue;
      }

      // Gefechtsabstand: Fernkämpfer halten ihren Wunschabstand, statt der Wegfindung bis in den
      // Nahkampf zu folgen. Die Vorgabe greift erst hinter der Angriffspause, damit ein Gegner
      // während seines Schusses stehen bleibt.
      const positioningOverride = combatPositioningSystem?.getMovementOverride(enemy.id) ?? null;
      if (positioningOverride) {
        const decision = activeTrainAwareness?.resolveMovement(
          enemy,
          positioningOverride.vx,
          positioningOverride.vy,
          now,
        );
        enemy.setDesiredVelocity(
          decision?.override ? decision.vx : positioningOverride.vx,
          decision?.override ? decision.vy : positioningOverride.vy,
        );
        continue;
      }

      const gridCell = primaryFlowFieldService.worldToGrid(enemy.sprite.x, enemy.sprite.y);
      if (!gridCell) {
        enemy.setPathBlocked(true);
        enemy.stopMovement();
        continue;
      }

      let flowFieldService = primaryFlowFieldService;
      let integrationValue = flowFieldService.getIntegrationValueAt(gridCell.gridX, gridCell.gridY);
      if (
        config.isBoss
        && flowFieldService !== baseFlowFieldService
        && baseFlowFieldService
        && integrationValue >= EnemyFlowFieldService.INTEGRATION_INFINITY
      ) {
        flowFieldService = baseFlowFieldService;
        integrationValue = flowFieldService.getIntegrationValueAt(gridCell.gridX, gridCell.gridY);
      }

      // Steht ein Gegner auf einer Zelle ohne Route – etwa weil ihn Kollisionsauflösung,
      // Rückstoß oder ein Ausweichschritt mit dem Mittelpunkt in eine Felszelle geschoben hat –,
      // steuert er zur nächsten erreichbaren Zelle zurück. Ohne diese Rückholung bliebe er dort
      // für immer stehen: keine Bewegung heißt auch keine neue Zelle.
      if (integrationValue >= EnemyFlowFieldService.INTEGRATION_INFINITY) {
        const recoveryTarget = flowFieldService.findNearestReachableWorldPosition(gridCell.gridX, gridCell.gridY);
        if (!recoveryTarget) {
          enemy.setPathBlocked(true);
          enemy.stopMovement();
          continue;
        }

        this.steerEnemyTowards(enemy, recoveryTarget.x, recoveryTarget.y, lerpT, now, activeTrainAwareness);
        continue;
      }

      if (integrationValue <= 0) {
        if (!this.applyTrainAwarenessOverride(enemy, 0, 0, now, activeTrainAwareness)) enemy.stopMovement();
        continue;
      }

      const vector = flowFieldService.getVectorAt(gridCell.gridX, gridCell.gridY);
      if (vector.x === 0 && vector.y === 0) {
        enemy.setPathBlocked(true);
        if (!this.applyTrainAwarenessOverride(enemy, 0, 0, now, activeTrainAwareness)) enemy.stopMovement();
        continue;
      }

      const speed = enemy.getMoveSpeed() * burrowSpeedFactor;
      // Der grobe Zellvektor reicht auf freier Flaeche. Direkt an einer Basiswand nicht: Der Gegner
      // steht durch Kollisionsaufloesung und Separation meist am Zellrand, und ein achsenparalleler
      // Vektor druckt ihn von dort in die Wand statt an ihr vorbei. Zusaetzlich springt die
      // Vektorrichtung beim Wechsel zwischen zwei Randzellen, was ihn an Ort und Stelle zappeln
      // laesst. In Wandnaehe wird deshalb – wie beim Boss – der Mittelpunkt der naechsten Zelle
      // angesteuert; der liegt garantiert eine halbe Zelle von jedem Hindernis entfernt.
      const useWaypointSteering = config.isBoss
        || flowFieldService.isWallAdjacentAt(gridCell.gridX, gridCell.gridY);
      // Der einzelne Boss braucht keine Separation. Bei normalen Gegnern bleibt sie in
      // Wandnaehe fast wirkungslos, damit der Wegpunkt nicht seitlich in die Wand gedrueckt wird.
      const separation = config.isBoss ? NO_SEPARATION : this.computeSeparation(enemy, separationGrid);
      const separationMultiplier = useWaypointSteering ? WALL_ADJACENT_SEPARATION_MULTIPLIER : 1;
      const waypoint = useWaypointSteering
        ? flowFieldService.getNextCellWorldPosition(gridCell.gridX, gridCell.gridY)
        : null;
      const steerDirection = waypoint
        ? this.normalizeDirection(waypoint.x - enemy.sprite.x, waypoint.y - enemy.sprite.y)
        : vector;
      // Steht der Gegner exakt auf dem Wegpunkt, liefert die Normalisierung 0/0. Dann traegt der
      // Zellvektor weiter, statt die Bewegung fuer einen Frame auf die Separation zu reduzieren.
      const waypointDirection = steerDirection.x === 0 && steerDirection.y === 0 ? vector : steerDirection;
      let targetVx = waypointDirection.x * speed
        + separation.x * SEPARATION_STRENGTH * separationMultiplier * speed;
      let targetVy = waypointDirection.y * speed
        + separation.y * SEPARATION_STRENGTH * separationMultiplier * speed;

      const targetSpeed = Math.hypot(targetVx, targetVy);
      if (targetSpeed > speed) {
        const scale = speed / targetSpeed;
        targetVx *= scale;
        targetVy *= scale;
      }

      const current = enemy.getDesiredVelocity();
      const decision = activeTrainAwareness?.resolveMovement(enemy, targetVx, targetVy, now);
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
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq <= 0 || distanceSq >= SEPARATION_RADIUS_SQ) continue;

          const distance = Math.sqrt(distanceSq);

          const weight = (1 - distance / SEPARATION_RADIUS_PX) / distance;
          pushX += dx * weight;
          pushY += dy * weight;
        }
      }
    }

    this.separationVector.x = pushX;
    this.separationVector.y = pushY;
    return this.separationVector;
  }

  getNetSnapshot(): SyncedEnemySnapshot {
    // Kein schwerer Full-Snapshot mehr: Neue/geänderte Gegner gehen als Delta, unveränderte Gegner
    // werden rollierend (Refresh-Zyklus) binnen ~2 s einmal voll nachgesendet. Periodisch trägt der
    // Snapshot zusätzlich die vollständige aktive ID-Liste zur Phantom-Reconciliation.
    const sendActiveList = this.forceFullNetSnapshot
      || this.ticksSinceActiveList >= ENEMY_NET_ACTIVE_LIST_INTERVAL_TICKS;
    const currentIds = new Set<string>();
    const upserts: SyncedEnemyDeltaState[] = [];

    const sortedEnemies = [...this.enemies.values()]
      .sort((left, right) => left.id.localeCompare(right.id));
    const refreshIds = this.collectRefreshIds(sortedEnemies);

    for (const enemy of sortedEnemies) {
      const current = this.buildNetState(enemy);
      currentIds.add(current.id);
      const previous = this.netSnapshotCache.get(current.id);

      if (this.forceFullNetSnapshot) {
        upserts.push(current);
        this.netSnapshotCache.set(current.id, current);
        continue;
      }

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
      this.forceFullNetSnapshot = false;
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

  /** Naechster Netzwerk-Snapshot enthaelt jeden aktuellen Gegner vollstaendig. */
  requestFullNetSnapshot(): void {
    this.forceFullNetSnapshot = true;
  }

  /**
   * Höchste aktive Bossphase im Feld. Ohne Allokation, weil das pro Frame für die
   * Bildkomposition abgefragt wird.
   */
  getMaxBossPhase(): number {
    let phase = 0;
    for (const enemy of this.enemies.values()) {
      const enemyPhase = enemy.getBossPhase();
      if (enemyPhase > phase) phase = enemyPhase;
    }
    return phase;
  }

  getHostileEnemies(): EnemyEntity[] {
    return [...this.enemies.values()].filter((enemy) => enemy.faction === 'hostile');
  }

  getAlliedEnemies(ownerId?: string): EnemyEntity[] {
    return [...this.enemies.values()].filter((enemy) => enemy.faction === 'allied' && (ownerId === undefined || enemy.ownerId === ownerId));
  }

  hasActiveEnemyOrigin(originId: string): boolean {
    return this.getActiveEnemyIdsForOrigin(originId).length > 0;
  }

  getActiveEnemyIdsForOrigin(originId: string): string[] {
    return [...this.enemies.values()]
      .filter((enemy) => enemy.faction === 'hostile' && enemy.sprite.active && enemy.originId === originId)
      .map((enemy) => enemy.id);
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

  /** Host-only: autoritative Entfernung ohne Killbelohnung, Todeseffekt oder Death-Spawns. */
  hostRemoveWithoutKill(id: string): EnemyDeathInfo | null {
    const enemy = this.enemies.get(id);
    if (!enemy) return null;
    const death: EnemyDeathInfo = {
      id: enemy.id,
      kind: enemy.kind,
      x: enemy.sprite.x,
      y: enemy.sprite.y,
      size: enemy.getSize(),
      faction: enemy.faction,
      ownerId: enemy.ownerId,
    };
    this.pendingRemovals.set(id, ENEMY_NET_REMOVAL_RESEND_TICKS);
    this.netSnapshotCache.delete(id);
    this.destroyEnemyEntity(id, enemy);
    this.wildfirePanicStates.delete(id);
    return death;
  }

  applyDamage(id: string, damage: number): { died: boolean; remainingHp: number; death?: EnemyDeathInfo } | null {
    const enemy = this.enemies.get(id);
    if (!enemy || damage <= 0) return null;

    const remainingHp = Math.max(0, enemy.getHp() - damage);
    enemy.setHp(remainingHp);
    if (remainingHp > 0) {
      return { died: false, remainingHp };
    }

    // Der Wächter setzt die HP selbst neu. Zurückgemeldet wird trotzdem der tatsächlich
    // zugefügte Schaden (`remainingHp` 0), denn die Rettung ist eine eigene Heilung – sonst
    // fiele der Treffer für Trefferfeedback und Lifeleech ersatzlos aus.
    if (this.lethalDamageGuard?.(enemy)) {
      return { died: false, remainingHp: 0 };
    }

    const deathX = enemy.sprite.x;
    const deathY = enemy.sprite.y;
    const death: EnemyDeathInfo = {
      id: enemy.id,
      kind: enemy.kind,
      x: deathX,
      y: deathY,
      size: enemy.getSize(),
      faction: enemy.faction,
      ownerId: enemy.ownerId,
    };
    const deathSpawns = enemy.faction === 'hostile' ? (this.resolvedConfigs[enemy.kind].deathSpawns ?? []) : [];
    this.pendingRemovals.set(id, ENEMY_NET_REMOVAL_RESEND_TICKS);
    this.netSnapshotCache.delete(id);
    this.destroyEnemyEntity(id, enemy);
    this.wildfirePanicStates.delete(id);
    for (const spawnConfig of deathSpawns) {
      const baseAngle = Phaser.Math.RND.realInRange(0, Math.PI * 2);
      for (let index = 0; index < spawnConfig.count; index += 1) {
        const angle = baseAngle + index * (Math.PI * 2 / Math.max(1, spawnConfig.count));
        this.hostSpawnAtWorld(
          deathX + Math.cos(angle) * spawnConfig.offsetPx,
          deathY + Math.sin(angle) * spawnConfig.offsetPx,
          spawnConfig.enemyKind,
          { originId: enemy.originId },
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
    this.destroyEnemyEntity(id, enemy);
    this.wildfirePanicStates.delete(id);
  }

  /**
   * Entfernt einen Gegner samt seiner Buddel-Partikel. Die Emitter folgen dem Sprite, deshalb
   * müssen sie vor dessen Zerstörung abgeräumt werden.
   */
  private destroyEnemyEntity(id: string, enemy: EnemyEntity): void {
    this.visualSink?.clearBurrowState(id);
    enemy.destroy();
    this.enemies.delete(id);
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
        this.destroyEnemyEntity(id, enemy);
      }
    }

    for (const idNum of snapshot.r) {
      const id = enemyNumToId(idNum);
      const enemy = this.enemies.get(id);
      if (!enemy) continue;
      this.destroyEnemyEntity(id, enemy);
    }

    for (const remote of upserts) {
      this.applyRemoteSnapshot(remote);
    }
    this.remoteSnapshotSeen = true;
  }

  updateClientInterpolation(factor: number): void {
    for (const enemy of this.enemies.values()) {
      enemy.lerpStep(factor);
    }
  }

  destroy(): void {
    for (const [id, enemy] of this.enemies) {
      this.visualSink?.clearBurrowState(id);
      enemy.destroy();
    }
    this.enemies.clear();
    this.wildfirePanicStates.clear();
    this.netSnapshotCache.clear();
    this.pendingRemovals.clear();
    this.nextEnemyIdSeq = 1;
    this.remoteSnapshotSeen = false;
    this.ticksSinceActiveList = ENEMY_NET_ACTIVE_LIST_INTERVAL_TICKS;
    this.forceFullNetSnapshot = false;
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
      burrowed: snapshot.burrowed,
      dashPhase: snapshot.dashPhase,
      specialAction: snapshot.specialAction,
      specialActionEndsAt: snapshot.specialActionEndsAt,
      gaussChargeProgress: Math.round(snapshot.gaussChargeProgress * 1000) / 1000,
      gaussAimAngle: Math.round(snapshot.gaussAimAngle * 100) / 100,
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

    if (
      current.burnStacks !== previous.burnStacks
      || current.burnVisualStyle !== previous.burnVisualStyle
    ) {
      delta.burnStacks = current.burnStacks;
      delta.burnVisualStyle = current.burnVisualStyle;
    }
    if (current.faction !== previous.faction || current.ownerId !== previous.ownerId || current.ownerColor !== previous.ownerColor) {
      delta.faction = current.faction;
      delta.ownerId = current.ownerId;
      delta.ownerColor = current.ownerColor;
    }

    if (current.burrowed !== previous.burrowed) {
      delta.burrowed = current.burrowed;
    }

    if (current.dashPhase !== previous.dashPhase) {
      delta.dashPhase = current.dashPhase;
    }
    if (
      current.specialAction !== previous.specialAction
      || current.specialActionEndsAt !== previous.specialActionEndsAt
      || current.gaussChargeProgress !== previous.gaussChargeProgress
      || current.gaussAimAngle !== previous.gaussAimAngle
    ) {
      delta.specialAction = current.specialAction;
      delta.specialActionEndsAt = current.specialActionEndsAt;
      delta.gaussChargeProgress = current.gaussChargeProgress;
      delta.gaussAimAngle = current.gaussAimAngle;
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
      enemy.setLightingSystem(this.lighting);
      const rotation = remote.rot ?? 0;
      enemy.faceAngle(rotation);
      enemy.setTargetRotation(rotation);
      enemy.setHp(remote.hp ?? remote.maxHp ?? 1, remote.maxHp ?? remote.hp ?? 1);
      enemy.updateBurnStacks(remote.burnStacks ?? 0, remote.burnVisualStyle ?? 'normal');
      enemy.setDashPhase(remote.dashPhase ?? 0);
      enemy.setSpecialAction(
        remote.specialAction ?? 'none',
        remote.specialActionEndsAt ?? 0,
        remote.gaussChargeProgress ?? 0,
        remote.gaussAimAngle ?? rotation,
      );
      this.enemies.set(remote.id, enemy);
      if (this.remoteSnapshotSeen && !remote.burrowed) this.playSpawnEffect(enemy, {});
      // Nach dem Registrieren, damit die Buddel-Visuals den Gegner bereits finden.
      if (remote.burrowed) this.setEnemyBurrowed(remote.id, true);
      return;
    }

    if (remote.burrowed !== undefined) this.setEnemyBurrowed(remote.id, remote.burrowed);

    if (remote.hp !== undefined || remote.maxHp !== undefined) {
      enemy.setHp(remote.hp ?? enemy.getHp(), remote.maxHp ?? enemy.getMaxHp());
    }
    if (remote.burnStacks !== undefined || remote.burnVisualStyle !== undefined) {
      const currentBurn = enemy.getNetSnapshot();
      enemy.updateBurnStacks(
        remote.burnStacks ?? currentBurn.burnStacks,
        remote.burnVisualStyle ?? currentBurn.burnVisualStyle ?? 'normal',
      );
    }
    if (remote.dashPhase !== undefined) enemy.setDashPhase(remote.dashPhase);
    if (remote.specialAction !== undefined) {
      const current = enemy.getNetSnapshot();
      enemy.setSpecialAction(
        remote.specialAction,
        remote.specialActionEndsAt ?? current.specialActionEndsAt,
        remote.gaussChargeProgress ?? current.gaussChargeProgress,
        remote.gaussAimAngle ?? current.gaussAimAngle,
      );
    }
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
