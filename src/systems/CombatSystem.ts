import * as Phaser from 'phaser';
import type { RockPhysicsProxy } from '../arena/rocks/RockPhysicsProxy';
import type { BaseManager } from '../entities/BaseManager';
import type { EnemyDeathInfo, EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager }     from '../entities/PlayerManager';
import type { NetworkBridge }     from '../network/NetworkBridge';
import type { PlayerCombatResourcePort } from '../world/PlayerCombatIntegrationPort';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { DetonationSystem }  from './DetonationSystem';
import type { EnergyShieldSystem } from './EnergyShieldSystem';
import type { DecoySystem, DecoyTargetSnapshot } from './DecoySystem';
import type { BurnOnHitConfig, BurnOrigin, ChainLightningConfig, CombatDamageKind, CombatDamageTargetType, GroundFireVisualStyle, HitscanSupportEffect, HitscanVisualPreset, LoadoutSlot, MeleeDamageTarget, MeleeVisualPreset, ProjectileSpawnConfig, RadialDamageFalloffConfig, ShieldBlockCategory, ShotAudioKey, SyncedDeathEffect, SyncedHitEffect, SyncedHitscanTrace, SyncedMeleeSwing, DetonatorConfig, ProjectileExplosionConfig, WeaponSlot } from '../types';
import {
  type GeometryHit,
} from '../utils/geometry';
import {
  ArenaObstacleIndex,
  OBSTACLE_ROCK,
  type ObstacleCircleVisitor,
  type ObstacleCircleBody,
  type ObstacleRectBody,
} from './ArenaObstacleIndex';
import { CombatGeometry } from './CombatGeometry';
import { resolveProjectileTargetImpact } from '../combat/rules/ProjectileImpactResolver';
import {
  resolveChainLightning as resolveChainLightningTraversal,
  type ChainLightningTarget,
} from '../combat/rules/ChainLightningResolver';
import {
  ARMOR_MAX,
  BURN_TICK_INTERVAL_MS,
  COLORS,
  COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID,
  HP_MAX, RESPAWN_DELAY_MS,
  DEFAULT_ARENA_HEIGHT,
  DEFAULT_ARENA_OFFSET_X,
  DEFAULT_ARENA_OFFSET_Y,
  DEFAULT_ARENA_WIDTH,
  HITSCAN_FAVOR_THE_SHOOTER_MAX_OFFSET,
  HITSCAN_FAVOR_THE_SHOOTER_MS,
  PLAYER_SIZE,
  RAGE_PER_DAMAGE,
  type MuzzleOrigin,
} from '../config';
import { TRAIN } from '../train/TrainConfig';
import type {
  ProjectileBarrierRequest,
  ProjectileBarrierResolution,
} from '../projectile/ProjectileInteractionPorts';
import type {
  ProjectileAk47DirectImpact,
  ProjectileAk47HitContext,
  ProjectileCombatPort,
  ProjectileDirectImpactRequest,
  ProjectileDirectImpactOutcome,
  ProjectileEnergyInjectorAugment,
  ProjectileEnergyInjectorImpact,
  ProjectilePlasmaSwarmImpact,
} from '../projectile/ProjectileCombatPort';
import type {
  ProjectileCombatExplosionOutcome,
  ProjectileCombatExplosionRequest,
} from '../projectile/ProjectileExplosionPort';
import type { ProjectileCollisionTargetSink } from '../projectile/ProjectileTargetPort';
import { computeProjectileExplosionDamage, computeRadialDamage } from '../utils/radialDamage';
import { getRageGeneratingDamage } from '../utils/rageDamage';
import {
  PLASMA_SWARM_BASE_EXPLOSION_DAMAGE,
  PLASMA_SWARM_BASE_EXPLOSION_RADIUS,
  PLASMA_SWARM_BASE_PROJECTILE_COUNT,
  type PlasmaSwarmMechanicPort,
  shouldIgnorePlasmaSwarmOriginHit,
} from './PlasmaCharge';
import type { TargetStatusTarget } from './TargetStatusSystem';
import type { Ak47BehaviorPort } from '../loadout/Ak47BehaviorPort';
import type { ProjectileDetonableReadPort, ProjectileImpactSource } from '../projectile/ProjectileGameplayPort';
import { PlayerVitalsOwner } from '../combat/PlayerVitalsOwner';
import { PlayerLifeRuntime } from '../world/PlayerLifeRuntime';
import type { CombatScope, CombatSource, CombatTargetRef } from '../combat/CombatScope';
import { isSameCombatScope, isSameCombatTargetInstance } from '../combat/CombatScope';
import { applyCombatDamage, applyCombatSupport, resolveCombatDamageModifiers, type CombatResolutionContext } from '../combat/CombatResolution';
import { resolveCombatRelationship } from '../combat/CombatRelationshipPolicy';
import type { CombatDamageBasis, CombatDamageRequest, CombatDamageMutationOutcome, CombatSupportRequest, CombatSupportMutationOutcome } from '../combat/CombatMutation';
import { freezeTargetMutationOutcome } from '../combat/CombatMutation';
import { CombatBurnStatusOwner } from '../combat/CombatBurnStatusOwner';
import type { CombatMovementStatusPort } from '../combat/CombatCapabilities';

type Ak47DirectEnemyHitImpact = ProjectileAk47DirectImpact;

/** Installed by the active World composition; no rule owns a clock or RNG fallback. */
export interface CombatHostExecutionSources {
  readonly nowMs: () => number;
  readonly random: () => number;
}

// Hitscan-Traces und Melee-Swings werden jetzt per RPC statt State gesendet

/** Für Abfragen, die nur Rechteck-Hindernisse auswerten (Baumstämme nehmen keinen Schaden). */
const IGNORE_CIRCLE_OBSTACLES: ObstacleCircleVisitor = () => false;
const HITSCAN_MUZZLE_EPSILON = 0.25;

// Zirkuläre Abhängigkeiten vermeiden: nur Typ-Imports
type BurrowSystemType    = { isBurrowed(id: string): boolean };
type LoadoutManagerType  = {
  getDamageMultiplier(id: string, now: number): number;
  getWeaponDamageMultiplier(id: string, slot: WeaponSlot, now: number): number;
};
type PowerUpSystemType   = { getDamageMultiplier(id: string): number; removePlayer(id: string): void };
type StinkCloudSystemType = { hostDeactivateForPlayer(id: string): void };

interface AoeDamageOptions {
  category?: ShieldBlockCategory;
  allowTeamDamage?: boolean;
  sourceId?: string;
  sourceSlot?: LoadoutSlot;
  damageFalloff?: RadialDamageFalloffConfig;
  baseDamageMult?: number;
  selfDamageMult?: number;
  enemySlowFraction?: number;
  enemySlowDurationMs?: number;
  skipEnemies?: boolean;
  /** Explosionen können ihr direkt getroffenes Primärziel ausdrücklich ausnehmen. */
  excludeTargetId?: string;
  /** The supplied damage already contains the originating direct-hit multipliers. */
  damageAlreadyScaled?: boolean;
  killSource?: KillSourceContext;
}

export type { ProjectileAk47DirectImpact as Ak47DirectEnemyHitImpact } from '../projectile/ProjectileCombatPort';

/**
 * Begleitdaten eines Schadensereignisses.
 *
 * `sourceSlot` und `damageKind` beschreiben die Quelle. Fehlen sie, gilt ein direkter Treffer
 * ohne bekannten Slot – damit bleiben Aufrufer gueltig, die nur Schaden zufuegen wollen.
 *
 * Wer "direkter Primaerwaffentreffer" pruefen will, muss deshalb **beides** pruefen
 * (`damageKind === 'direct' && sourceSlot === 'weapon1'`). Der Slot allein reicht nicht, weil
 * auch Explosionen ihn tragen; `damageKind` allein reicht nicht, weil Quellen ohne Waffenbezug
 * – Gegnerfaehigkeiten, Dash-Aufprall, Umgebungsschaden – auf dem Default stehen bleiben.
 */
interface DamageApplicationOptions {
  allowTeamDamage?: boolean;
  allowCritical?: boolean;
  sourceSlot?: LoadoutSlot;
  damageKind?: CombatDamageKind;
  /** P7–P10 migrate legacy callers to these fully resolved facts. */
  source?: CombatSource;
  basis?: CombatDamageBasis;
  /**
   * Interner Schalter fuer den Hinrichtungsschlag: Er soll den Gegner toeten, aber keinen
   * Lifeleech und keine schadensabhaengigen Folgeeffekte ausloesen.
   */
  skipLifeLeech?: boolean;
}

/** Passiver, autoritativer Messpunkt nach tatsaechlich verlorenem HP/Armor. */
export interface CombatDamageObservation {
  readonly targetFaction?: 'hostile' | 'allied';
  readonly targetType: CombatDamageTargetType;
  readonly targetId: string;
  readonly attackerId: string | undefined;
  readonly damage: number;
  readonly damageKind: CombatDamageKind;
  readonly sourceSlot: LoadoutSlot | undefined;
  readonly isCritical: boolean;
}

interface DamageVisualContext {
  sourceX?: number;
  sourceY?: number;
  dirX?: number;
  dirY?: number;
  projectileColor?: number;
  shotgunLightningGeneration?: number;
}

export interface KillSourceContext {
  dirX?: number;
  dirY?: number;
  projectileColor?: number;
  shotgunLightningGeneration?: number;
  enemyXp?: number;
  readonly enemyKind?: EnemyDeathInfo['kind'];
  readonly victimFaction?: EnemyDeathInfo['faction'];
  readonly victimKind?: 'player' | 'enemy';
  readonly provenance?: CombatSource;
  readonly damageOrigin?: { readonly kind: CombatDamageKind; readonly slot?: LoadoutSlot };
  readonly outcomeId?: string;
  readonly nowMs?: number;
}

/**
 * Uebersetzt Flaechenschadens-Optionen in die Begleitdaten des Schadenstrichters. Bisher wurde
 * `AoeDamageOptions` direkt weitergereicht; dabei fiel `sourceSlot` unter den Tisch, weil der
 * Trichter das Feld gar nicht kannte.
 */
function toDamageOptions(
  options: AoeDamageOptions | undefined,
  damageKind: CombatDamageKind,
): DamageApplicationOptions {
  return {
    allowTeamDamage: options?.allowTeamDamage,
    sourceSlot: options?.sourceSlot,
    damageKind,
  };
}


import type { ActiveBurnSource } from '../combat/rules/BurnStateMachine';

export interface HitscanTraceResult {
  readonly endX: number;
  readonly endY: number;
  readonly distance: number;
  readonly hitPlayerId: string | null;
  readonly hitEnemyId: string | null;
  readonly hitDecoyId: number | null;
  readonly hitObstacle: boolean;
  readonly hitObstacleKind?: HitscanObstacleKind;
  readonly hitObstacleIndex?: number;
}

export interface HitscanTraceOptions {
  readonly shooterId: string;
  readonly startX: number;
  readonly startY: number;
  readonly angle: number;
  readonly range: number;
  readonly traceThickness: number;
  readonly applyFavorTheShooter: boolean;
  readonly includeShooter?: boolean;
}

export type HitscanObstacleKind = 'arena' | 'rock' | 'base' | 'barrier' | 'trunk' | 'train';

/**
 * Optionen der Schusslinienprüfung.
 *
 * Dieselben drei Freiheitsgrade wie bei {@link CombatSystem.hasLineOfSight}, nur gebündelt:
 * `hasClearLineOfFire` reicht sie an den statischen Hinderniskern **und** an die beweglichen
 * Blocker weiter, deshalb wären drei optionale Positionsparameter an der Aufrufstelle nicht
 * mehr lesbar.
 */
export interface LineOfFireOptions {
  /** Dieser Fels blockiert nicht (z. B. der Fels, in dem das Geschütz steht). */
  readonly skipRockIndex?: number;
  /** Coop-Defense-Basen ignorieren (Quellen oberhalb der eigenen Basisfläche). */
  readonly ignoreBaseObstacles?: boolean;
  /** Korridorbreite für Körper, die breiter als die Linie sind (Wurfgeschosse, Translocator-Puck). */
  readonly clearanceRadius?: number;
}

export interface HitscanSupportImpact {
  readonly targetType: 'player' | 'rock' | 'base';
  readonly targetId: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Trefferziel eines Hitscans: kanonische Position und Trefferradius.
 *
 * Frueher stand hier ein Sprite, aus dessen Anzeigemass der Radius abgeleitet wurde - damit
 * haette die Darstellung ueber Treffer entschieden. Der Radius kommt jetzt von der Runtime.
 */
interface HitscanTarget {
  readonly x: number;
  readonly y: number;
  /** Trefferradius in Weltpixeln. */
  readonly hitRadius: number;
  readonly body: { velocity: { x: number; y: number } } | null;
}

/**
 * Trefferziel eines noch sprite-gefuehrten Gegners oder Koeders.
 *
 * Bewusst genau eine Stelle: solange Gegner ihren Radius aus dem Anzeigemass ableiten, steht
 * diese Ableitung hier und nicht verstreut an jedem Aufruf.
 */
function toSpriteHitscanTarget(
  sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Arc,
): HitscanTarget {
  return {
    x: sprite.x,
    y: sprite.y,
    hitRadius: Math.max(sprite.displayWidth, sprite.displayHeight) * 0.5,
    body: sprite.body as { velocity: { x: number; y: number } } | null,
  };
}

type SweptProjectileHit =
  | { kind: 'player'; playerId: string; distance: number; x: number; y: number }
  | { kind: 'enemy'; enemyId: string; distance: number; x: number; y: number }
  | { kind: 'decoy'; decoyId: number; distance: number; x: number; y: number };

export class CombatSystem implements ProjectileCombatPort {
  private playerVitals: PlayerVitalsOwner;
  private playerLife: PlayerLifeRuntime;
  private burnStatus = new CombatBurnStatusOwner();
  private movementStatus: CombatMovementStatusPort | null = null;
  private plasmaSwarmMechanic: PlasmaSwarmMechanicPort | null = null;
  private readonly hitscanLine       = new Phaser.Geom.Line();
  /** Scratch-Segment der Projectile-Blockerabfrage. */
  private readonly projectileBlockerLine = new Phaser.Geom.Line();
  private readonly chainScanLine     = new Phaser.Geom.Line();  // Scratch-Linie für Kettenblitz-Sichtlinienprüfung
  private readonly meleeLine         = new Phaser.Geom.Line();  // Scratch-Linie für Melee-Hindernisprüfung
  private readonly lineOfFireLine    = new Phaser.Geom.Line();  // Scratch-Linie für die Blockerprüfung der Schusslinie
  private readonly obstacleBounds = {
    offsetX: DEFAULT_ARENA_OFFSET_X,
    offsetY: DEFAULT_ARENA_OFFSET_Y,
    width: DEFAULT_ARENA_WIDTH,
    height: DEFAULT_ARENA_HEIGHT,
  };
  private readonly arenaBounds = new Phaser.Geom.Rectangle(
    DEFAULT_ARENA_OFFSET_X,
    DEFAULT_ARENA_OFFSET_Y,
    DEFAULT_ARENA_WIDTH,
    DEFAULT_ARENA_HEIGHT,
  );
  private readonly scratchTrainRect  = new Phaser.Geom.Rectangle();
  /** Aufgeblasene Kopie der Zug-Bounds; die Quelle darf für den Korridor nicht verändert werden. */
  private readonly scratchLineOfFireRect = new Phaser.Geom.Rectangle();
  /**
   * Räumliche Vorauswahl für alle segmentbasierten Hindernisprüfungen (Sichtlinie,
   * Hitscan, Melee, Projektilpfad). Liest dieselben Arrays, die `setArenaObstacles` und
   * `setBaseObstacles` setzen – es gibt keinen zweiten Bestand.
   */
  /** Einziger Index; WorldGeometryBinding übernimmt seine Lifetime-Bindung pro World. */
  private readonly obstacleIndex = new ArenaObstacleIndex({
    bounds: () => this.obstacleBounds,
    rocks:  () => this.rockObjects,
    trunks: () => this.trunkObjects,
    bases:  () => this.baseObstacles,
    barriers: () => this.barrierObstacles,
  });
  private activeGeometryBinding: object | null = null;
  /**
   * Gemeinsamer mathematischer Kern aller Segmentprüfungen. Die gebundene World nutzt dieselbe
   * Geometrie für Sichtlinie, Hitscan und Melee-Bogen; die Klasse hält nur den Rechenkern.
   */
  private geometry = new CombatGeometry(this.obstacleIndex);
  private meleeSwingIdCounter = 0;
  private effectSeedCounter = 1;

  // Kill-Tracking: letzter Angreifer & Waffe pro Ziel (für Frag-Vergabe)
  private lastAttacker: Map<string, string> = new Map();  // victimId → attackerId
  private lastWeapon:   Map<string, string> = new Map();  // victimId → sourceId
  private lastKillSource: Map<string, KillSourceContext> = new Map();
  private lastSource = new Map<string, CombatSource>();
  private attributionTargets = new Map<string, CombatTargetRef>();
  private reactionGeneration = 0;
  /**
   * Herkunft des toedlichen Treffers. Getrennt von {@link lastKillSource}, weil dieser Kontext
   * an die Clients repliziert wird und rein visuell ist – die Quelle ist reine Host-Regel.
   */
  private lastDamageOrigin: Map<string, { kind: CombatDamageKind; slot?: LoadoutSlot }> = new Map();

  // Callback: (killerId, victimId, sourceId) – Host-only
  private onKillCb: ((killerId: string, victimId: string, sourceId: string, x: number, y: number, source?: KillSourceContext) => void) | null = null;
  private onDeathCb: ((playerId: string, x: number, y: number) => void) | null = null;
  private onEnemyDeathCb: ((enemyId: string, x: number, y: number, burnSources: readonly ActiveBurnSource[], death: EnemyDeathInfo | undefined, target: CombatTargetRef) => boolean | void) | null = null;
  private onAk47DirectEnemyHit: ((context: ProjectileAk47HitContext, enemyId: string, nowMs: number) => ProjectileAk47DirectImpact | null) | null = null;

  // Optionale Referenzen – werden nach Konstruktion gesetzt
  private burrowSystem:     BurrowSystemType    | null  = null;
  private resourceSystem:   PlayerCombatResourcePort | null  = null;
  private loadoutManager:   LoadoutManagerType  | null  = null;
  private ak47Behavior:     Pick<Ak47BehaviorPort, 'registerProjectileHit' | 'resetPlayer'> | null = null;
  private energyShieldSystem: EnergyShieldSystem | null = null;
  private powerUpSystem:    PowerUpSystemType   | null  = null;
  private detonationSystem: DetonationSystem    | null  = null;  private stinkCloudSystem: StinkCloudSystemType | null = null;  private rockObjects: readonly (RockPhysicsProxy | null)[] | null = null;
  private decoySystem:      DecoySystem | null = null;
  private enemyManager:     EnemyManager | null = null;
  private projectileDetonableReadPort: ProjectileDetonableReadPort | null = null;
  private baseManager:      BaseManager | null = null;
  private baseDamageCallback: ((baseId: string, damage: number, attackerId: string, sourceSlot?: LoadoutSlot) => void) | null = null;
  private trunkObjects: readonly ObstacleCircleBody[] | null = null;
  /**
   * Coop-Defense-Basen als rechteckige LoS-/Hitscan-/Melee-Blocker.
   * Direkter Schaden läuft über den zentralen Basisschadenspfad; die Rechtecke wirken
   * außerdem als physische Wände, hinter denen Spieler nicht getroffen werden.
   */
  private baseObstacles: readonly Phaser.GameObjects.Rectangle[] | null = null;
  private barrierObstacles: readonly ObstacleRectBody[] | null = null;
  private trainSegObjects: readonly Phaser.GameObjects.Rectangle[] | null = null;
  /** Client-seitiger Fallback: vorberechnete Zug-Bounds aus SyncedTrainState */
  private clientTrainBounds: Phaser.Geom.Rectangle | null = null;

  // Callbacks für Objekt-Schaden (gesetzt von ArenaScene)
  private onRockDamage:  ((rockIndex: number, damage: number, attackerId: string) => void) | null = null;
  private onTrainDamage: ((damage: number, attackerId: string) => void) | null = null;
  private onPlayerImpulse: ((playerId: string, vx: number, vy: number, durationMs: number, sourcePlayerId?: string) => void) | null = null;
  private onEnemyImpulse: ((enemyId: string, vx: number, vy: number, durationMs: number, sourcePlayerId?: string) => void) | null = null;
  private playerMaxHpResolver: ((playerId: string) => number) | null = null;
  private playerDamageReductionResolver: ((playerId: string, nowMs: number) => number) | null = null;
  private playerHpRegenPerSecondResolver: ((playerId: string, nowMs: number) => number) | null = null;
  private playerMaxArmorResolver: ((playerId: string) => number) | null = null;
  private playerArmorGainMultiplierResolver: ((playerId: string) => number) | null = null;
  private playerArmorDamageGrantsRageResolver: ((playerId: string) => boolean) | null = null;
  private playerLifeLeechFractionResolver: ((playerId: string) => number) | null = null;
  private playerArmorRegenPerSecondResolver: ((playerId: string) => number) | null = null;
  private playerOutgoingDamageResolver: ((
    attackerId: string | undefined,
    targetId: string,
    amount: number,
    allowCritical: boolean,
    sourceSlot: LoadoutSlot | undefined,
    nowMs: number,
    random: () => number,
  ) => { amount: number; isCritical: boolean }) | null = null;
  private playerBonusArmorRegenPerSecondResolver: ((playerId: string, nowMs: number) => number) | null = null;
  private enemyIncomingDamageMultiplierResolver: ((enemyId: string, nowMs: number) => number) | null = null;
  /** Gemeinsamer zielseitiger Multiplikator fuer Gegner und hostautoritäre Strukturen. */
  private targetIncomingDamageMultiplierResolver: ((target: TargetStatusTarget, nowMs: number) => number) | null = null;
  private onEnergyInjectorTargetHit: ((impact: ProjectileEnergyInjectorImpact) => void) | null = null;
  private onPlasmaSwarmReaction: ((impact: ProjectilePlasmaSwarmImpact) => void) | null = null;
  private hostExecutionSources: CombatHostExecutionSources | null = null;
  private currentHostExecution: { readonly sources: CombatHostExecutionSources; readonly nowMs: number } | null = null;

  private get hostFrameNowMs(): number {
    if (!this.currentHostExecution || this.currentHostExecution.sources !== this.hostExecutionSources) {
      throw new Error('[CombatSystem] Missing active Host execution context');
    }
    return this.currentHostExecution.nowMs;
  }

  private get hostRandom(): () => number {
    if (!this.currentHostExecution || this.currentHostExecution.sources !== this.hostExecutionSources) {
      throw new Error('[CombatSystem] Missing active Host execution context');
    }
    return this.currentHostExecution.sources.random;
  }
  private onHitscanSupportImpact: ((
    impact: HitscanSupportImpact,
    effect: HitscanSupportEffect,
    attackerId: string,
    sourceSlot?: LoadoutSlot,
  ) => void) | null = null;
  /** Host-authoritative gate for actual post-death respawns. */
  private respawnAllowedResolver: ((playerId: string) => boolean) | null = null;
  /** Initialspawn has intentionally different semantics from a post-death respawn. */
  private initialSpawnAllowedResolver: ((playerId: string) => boolean) | null = null;
  /** Called exactly once after the respawn gate passes and a real respawn is committed. */
  private onRespawnCb: ((playerId: string) => boolean | void) | null = null;
  private onRespawnCommitted: ((playerId: string) => void) | null = null;
  private onAuthoritativePositionReset: ((playerId: string, x: number, y: number) => void) | null = null;
  private playerActionAllowedResolver: ((playerId: string) => boolean) | null = null;
  private onDirectPrimaryHit: ((
    attackerId: string,
    enemyId: string,
    remainingHp: number,
    maxHp: number,
    isBoss: boolean,
    target: CombatTargetRef,
  ) => void) | null = null;
  private onPlayerLifeEnded: ((target: CombatTargetRef) => void) | null = null;
  /** Setzt die zentrale Verwundbarkeit auf einem Ziel; ohne Handler bleibt der Treffereffekt aus. */
  private onApplyVulnerability: ((target: TargetStatusTarget, durationMs: number, nowMs: number) => void) | null = null;
  private onPlayerDamageTaken: ((
    playerId: string,
    attackerId: string | undefined,
    hpLost: number,
    armorLost: number,
    damageKind: CombatDamageKind,
    target: CombatTargetRef,
  ) => void) | null = null;
  private onDamageDealt: ((
    targetType: CombatDamageTargetType,
    targetId: string,
    attackerId: string | undefined,
    damage: number,
    damageKind: CombatDamageKind,
    targetFaction?: 'hostile' | 'allied',
  ) => void) | null = null;
  private readonly damageDealtObservers = new Set<(event: CombatDamageObservation) => void>();
  private onHealingReceived: ((playerId: string, amount: number) => void) | null = null;
  private onArmorReceived: ((playerId: string, amount: number) => void) | null = null;
  private mutationOutcomeSequence = 0;

  getTargetIncomingDamageMultiplier(...args: Parameters<CombatSystem['getTargetIncomingDamageMultiplierAtHostTime']>): ReturnType<CombatSystem['getTargetIncomingDamageMultiplierAtHostTime']> {
    return this.runHostExecution(() => this.getTargetIncomingDamageMultiplierAtHostTime(...args));
  }

  applyDamage(...args: Parameters<CombatSystem['applyDamageAtHostTime']>): ReturnType<CombatSystem['applyDamageAtHostTime']> {
    return this.runHostExecution(() => this.applyDamageAtHostTime(...args));
  }

  applyAoeDamage(...args: Parameters<CombatSystem['applyAoeDamageAtHostTime']>): ReturnType<CombatSystem['applyAoeDamageAtHostTime']> {
    return this.runHostExecution(() => this.applyAoeDamageAtHostTime(...args));
  }

  applyExplosionDamage(...args: Parameters<CombatSystem['applyExplosionDamageAtHostTime']>): ReturnType<CombatSystem['applyExplosionDamageAtHostTime']> {
    return this.runHostExecution(() => this.applyExplosionDamageAtHostTime(...args));
  }

  getPlayerRuntimeDamageMultiplier(...args: Parameters<CombatSystem['getPlayerRuntimeDamageMultiplierAtHostTime']>): ReturnType<CombatSystem['getPlayerRuntimeDamageMultiplierAtHostTime']> {
    return this.runHostExecution(() => this.getPlayerRuntimeDamageMultiplierAtHostTime(...args));
  }

  resolveDirectImpact(...args: Parameters<CombatSystem['resolveDirectImpactAtHostTime']>): ReturnType<CombatSystem['resolveDirectImpactAtHostTime']> {
    return this.runHostExecution(() => this.resolveDirectImpactAtHostTime(...args));
  }

  resolveExplosionCombat(...args: Parameters<CombatSystem['resolveExplosionCombatAtHostTime']>): ReturnType<CombatSystem['resolveExplosionCombatAtHostTime']> {
    return this.runHostExecution(() => this.resolveExplosionCombatAtHostTime(...args));
  }

  resolveHitscanShot(...args: Parameters<CombatSystem['resolveHitscanShotAtHostTime']>): ReturnType<CombatSystem['resolveHitscanShotAtHostTime']> {
    return this.runHostExecution(() => this.resolveHitscanShotAtHostTime(...args));
  }

  resolveMeleeSwing(...args: Parameters<CombatSystem['resolveMeleeSwingAtHostTime']>): ReturnType<CombatSystem['resolveMeleeSwingAtHostTime']> {
    return this.runHostExecution(() => this.resolveMeleeSwingAtHostTime(...args));
  }

  applyBaseDamage(...args: Parameters<CombatSystem['applyBaseDamageAtHostTime']>): ReturnType<CombatSystem['applyBaseDamageAtHostTime']> {
    return this.runHostExecution(() => this.applyBaseDamageAtHostTime(...args));
  }

  resolveExternalTargetDamage(...args: Parameters<CombatSystem['resolveExternalTargetDamageAtHostTime']>): ReturnType<CombatSystem['resolveExternalTargetDamageAtHostTime']> {
    return this.runHostExecution(() => this.resolveExternalTargetDamageAtHostTime(...args));
  }

  applyRadialHostileBaseDamage(...args: Parameters<CombatSystem['applyRadialHostileBaseDamageAtHostTime']>): ReturnType<CombatSystem['applyRadialHostileBaseDamageAtHostTime']> {
    return this.runHostExecution(() => this.applyRadialHostileBaseDamageAtHostTime(...args));
  }

  hpRegenTick(...args: Parameters<CombatSystem['hpRegenTickAtHostTime']>): ReturnType<CombatSystem['hpRegenTickAtHostTime']> {
    return this.runHostExecution(() => this.hpRegenTickAtHostTime(...args));
  }

  armorRegenTick(...args: Parameters<CombatSystem['armorRegenTickAtHostTime']>): ReturnType<CombatSystem['armorRegenTickAtHostTime']> {
    return this.runHostExecution(() => this.armorRegenTickAtHostTime(...args));
  }

  applySupport(...args: Parameters<CombatSystem['applySupportAtHostTime']>): ReturnType<CombatSystem['applySupportAtHostTime']> {
    return this.runHostExecution(() => this.applySupportAtHostTime(...args));
  }

  constructor(
    private playerManager:     PlayerManager,
    private bridge:            NetworkBridge,
  ) {
    this.playerVitals = this.createPlayerVitalsOwner({ worldRevision: 1, runtimeGeneration: 1 });
    this.playerLife = this.createPlayerLifeRuntime(this.playerVitals);
  }

  /** World composition replaces the empty fallback owner before attaching any Player. */
  bindPlayerVitalsScope(scope: CombatScope): { destroy(): void } {
    if (this.playerVitals.hasAttachedPlayers()) {
      throw new Error('[CombatSystem] Cannot replace Player vitals while Players are attached');
    }
    this.playerVitals.destroy();
    this.playerLife.destroy();
    this.burnStatus.destroy();
    const owner = this.createPlayerVitalsOwner(scope);
    const burnStatus = new CombatBurnStatusOwner();
    this.playerVitals = owner;
    const playerLife = this.createPlayerLifeRuntime(owner);
    this.playerLife = playerLife;
    this.burnStatus = burnStatus;
    return {
      destroy: () => {
        if (this.playerVitals === owner) {
          this.reactionGeneration += 1;
          this.lastSource.clear(); this.attributionTargets.clear();
          this.lastAttacker.clear(); this.lastWeapon.clear(); this.lastKillSource.clear(); this.lastDamageOrigin.clear();
        }
        playerLife.destroy();
        if (this.playerVitals === owner) owner.destroy();
        if (this.burnStatus === burnStatus) burnStatus.destroy();
      },
    };
  }

  /** Bindet Kollisions- und Spatial-Index-Bounds an genau eine World-Instanz. */
  setWorldMetrics(metrics: WorldMetrics | null): void {
    const resolved = metrics ?? {
      offsetX: DEFAULT_ARENA_OFFSET_X,
      offsetY: DEFAULT_ARENA_OFFSET_Y,
      widthPx: DEFAULT_ARENA_WIDTH,
      heightPx: DEFAULT_ARENA_HEIGHT,
    };
    this.obstacleBounds.offsetX = resolved.offsetX;
    this.obstacleBounds.offsetY = resolved.offsetY;
    this.obstacleBounds.width = resolved.widthPx;
    this.obstacleBounds.height = resolved.heightPx;
    this.arenaBounds.setTo(resolved.offsetX, resolved.offsetY, resolved.widthPx, resolved.heightPx);
    this.obstacleIndex.markDirty();
  }

  // ── Referenz-Injection ────────────────────────────────────────────────────

  setBurrowSystem(bs: BurrowSystemType | null): void     { this.burrowSystem   = bs; }
  setResourceSystem(rs: PlayerCombatResourcePort | null): void     { this.resourceSystem = rs; }
  setLoadoutManager(lm: LoadoutManagerType | null): void { this.loadoutManager = lm; }
  setAk47Behavior(behavior: Pick<Ak47BehaviorPort, 'registerProjectileHit' | 'resetPlayer'> | null): void {
    this.ak47Behavior = behavior;
  }
  setEnergyShieldSystem(es: EnergyShieldSystem | null): void { this.energyShieldSystem = es; }
  setPowerUpSystem(ps: PowerUpSystemType | null): void   { this.powerUpSystem  = ps; }
  setDetonationSystem(ds: DetonationSystem | null): void { this.detonationSystem = ds; }
  setProjectileDetonableReadPort(port: ProjectileDetonableReadPort | null): void {
    this.projectileDetonableReadPort = port;
  }
  setStinkCloudSystem(sc: StinkCloudSystemType | null): void { this.stinkCloudSystem = sc; }
  setDecoySystem(ds: DecoySystem | null): void { this.decoySystem = ds; }
  setEnemyManager(manager: EnemyManager | null): void {
    if (manager !== this.enemyManager) {
      for (const [id, target] of this.attributionTargets) if (target.kind === 'enemy') this.clearAttribution(id);
    }
    this.enemyManager = manager;
    if (!manager) this.plasmaSwarmMechanic?.clear();
  }
  setMovementStatusPort(port: CombatMovementStatusPort | null): void { this.movementStatus = port; }
  setPlasmaSwarmMechanicPort(port: PlasmaSwarmMechanicPort | null): void { this.plasmaSwarmMechanic = port; }
  setBaseManager(manager: BaseManager | null): void { this.baseManager = manager; }
  /**
   * Einziger Trichter fuer Basisschaden. Wie `setRockDamageCallback` verdrahtet, damit der
   * Schaden durch `resolveOutgoingDamage` laeuft und Klassen-, Item- sowie optionale
   * Quell-Slot-Modifikatoren sieht.
   */
  setBaseDamageCallback(cb: ((baseId: string, damage: number, attackerId: string, sourceSlot?: LoadoutSlot) => void) | null): void {
    this.baseDamageCallback = cb;
  }
  setPlayerMaxHpResolver(resolver: ((playerId: string) => number) | null): void { this.playerMaxHpResolver = resolver; }
  setPlayerDamageReductionResolver(resolver: ((playerId: string, nowMs: number) => number) | null): void { this.playerDamageReductionResolver = resolver; }
  setPlayerHpRegenPerSecondResolver(resolver: ((playerId: string, nowMs: number) => number) | null): void { this.playerHpRegenPerSecondResolver = resolver; }
  setPlayerMaxArmorResolver(resolver: ((playerId: string) => number) | null): void { this.playerMaxArmorResolver = resolver; }
  setPlayerArmorGainMultiplierResolver(resolver: ((playerId: string) => number) | null): void { this.playerArmorGainMultiplierResolver = resolver; }
  setPlayerArmorDamageGrantsRageResolver(resolver: ((playerId: string) => boolean) | null): void { this.playerArmorDamageGrantsRageResolver = resolver; }
  setPlayerLifeLeechFractionResolver(resolver: ((playerId: string) => number) | null): void { this.playerLifeLeechFractionResolver = resolver; }
  setPlayerArmorRegenPerSecondResolver(resolver: ((playerId: string) => number) | null): void { this.playerArmorRegenPerSecondResolver = resolver; }
  /** Zusatzregeneration aus bedingten Quellen (Notfallreparatur); addiert sich auf den Grundwert. */
  setPlayerBonusArmorRegenPerSecondResolver(resolver: ((playerId: string, nowMs: number) => number) | null): void { this.playerBonusArmorRegenPerSecondResolver = resolver; }
  /** Zielseitiger Schadensmultiplikator eines Gegners (Verwundbarkeit); 1 = unveraendert. */
  setEnemyIncomingDamageMultiplierResolver(resolver: ((enemyId: string, nowMs: number) => number) | null): void { this.enemyIncomingDamageMultiplierResolver = resolver; }
  /** Gemeinsamer Zielstatus-Trichter; ersetzt den alten Gegner-only-Resolver, falls gesetzt. */
  setTargetIncomingDamageMultiplierResolver(resolver: ((target: TargetStatusTarget, nowMs: number) => number) | null): void {
    this.targetIncomingDamageMultiplierResolver = resolver;
  }
  setEnergyInjectorTargetHitCallback(handler: ((impact: ProjectileEnergyInjectorImpact) => void) | null): void {
    this.onEnergyInjectorTargetHit = handler;
  }
  setPlasmaSwarmReactionHandler(handler: ((impact: ProjectilePlasmaSwarmImpact) => void) | null): void {
    this.onPlasmaSwarmReaction = handler;
  }
  setHitscanSupportImpactCallback(handler: ((
    impact: HitscanSupportImpact,
    effect: HitscanSupportEffect,
    attackerId: string,
    sourceSlot?: LoadoutSlot,
  ) => void) | null): void {
    this.onHitscanSupportImpact = handler;
  }
  private getTargetIncomingDamageMultiplierAtHostTime(target: TargetStatusTarget): number {
    return Math.max(0, this.targetIncomingDamageMultiplierResolver?.(target, this.hostFrameNowMs) ?? 1);
  }
  setRespawnAllowedResolver(resolver: ((playerId: string) => boolean) | null): void { this.respawnAllowedResolver = resolver; }
  setInitialSpawnAllowedResolver(resolver: ((playerId: string) => boolean) | null): void {
    this.initialSpawnAllowedResolver = resolver;
  }
  setRespawnCallback(cb: ((playerId: string) => boolean | void) | null): void {
    this.onRespawnCb = cb;
  }
  setRespawnCommittedCallback(cb: ((playerId: string) => void) | null): void { this.onRespawnCommitted = cb; }
  setAuthoritativePositionResetCallback(
    cb: ((playerId: string, x: number, y: number) => void) | null,
  ): void {
    this.onAuthoritativePositionReset = cb;
  }
  setPlayerActionAllowedResolver(resolver: ((playerId: string) => boolean) | null): void { this.playerActionAllowedResolver = resolver; }
  /**
   * Meldung ueber einen direkten Primaerwaffentreffer, der den Gegner nicht getoetet hat.
   * Ausschliesslich `damageKind === 'direct'` und `sourceSlot === 'weapon1'`.
   */
  setDirectPrimaryHitHandler(handler: ((attackerId: string, enemyId: string, remainingHp: number, maxHp: number, isBoss: boolean, target: CombatTargetRef) => void) | null): void {
    this.onDirectPrimaryHit = handler;
  }
  setPlayerLifeEndedHandler(handler: ((target: CombatTargetRef) => void) | null): void {
    this.onPlayerLifeEnded = handler;
  }
  /** Uebergibt die zentrale Verwundbarkeit an den Host, wenn ein Projektil sie auf Treffer setzt. */
  setApplyVulnerabilityHandler(handler: ((target: TargetStatusTarget, durationMs: number, nowMs: number) => void) | null): void {
    this.onApplyVulnerability = handler;
  }
  /** Meldung ueber tatsaechlich verlorene HP/Ruestung eines Spielers, nach der Verteilung. */
  setPlayerDamageTakenHandler(handler: ((playerId: string, attackerId: string | undefined, hpLost: number, armorLost: number, damageKind: CombatDamageKind, target: CombatTargetRef) => void) | null): void {
    this.onPlayerDamageTaken = handler;
  }
  /** Meldet nach der Zielverteilung nur tatsächlich verlorene HP/Rüstung bzw. Gegner-HP. */
  setDamageDealtHandler(handler: ((targetType: CombatDamageTargetType, targetId: string, attackerId: string | undefined, damage: number, damageKind: CombatDamageKind, targetFaction?: 'hostile' | 'allied') => void) | null): void {
    this.onDamageDealt = handler;
  }
  /** Diagnosebeobachter laufen zusaetzlich zum regulaeren Raumstatistik-Handler. */
  addDamageDealtObserver(observer: (event: CombatDamageObservation) => void): () => void {
    this.damageDealtObservers.add(observer);
    return () => { this.damageDealtObservers.delete(observer); };
  }
  private notifyDamageDealt(event: CombatDamageObservation): void {
    this.onDamageDealt?.(
      event.targetType,
      event.targetId,
      event.attackerId,
      event.damage,
      event.damageKind,
      event.targetFaction,
    );
    for (const observer of this.damageDealtObservers) {
      try { observer(Object.freeze({ ...event })); }
      catch (error) { console.error('[CombatSystem] Passive damage observer failed', error); }
    }
  }
  setHealingReceivedHandler(handler: ((playerId: string, amount: number) => void) | null): void {
    this.onHealingReceived = handler;
  }
  setArmorReceivedHandler(handler: ((playerId: string, amount: number) => void) | null): void {
    this.onArmorReceived = handler;
  }
  /**
   * `sourceSlot` reicht die Herkunft des Treffers durch, damit slot-gebundene Angreifer-Boni
   * (Kreuzfeuer) im selben Bucket landen wie alle anderen Schadensmodifikatoren.
   */
  setPlayerOutgoingDamageResolver(
    resolver: ((
      attackerId: string | undefined,
      targetId: string,
      amount: number,
      allowCritical: boolean,
      sourceSlot: LoadoutSlot | undefined,
      nowMs: number,
      random: () => number,
    ) => { amount: number; isCritical: boolean }) | null,
  ): void {
    this.playerOutgoingDamageResolver = resolver;
  }
  setArenaObstacles(
    rockObjects: readonly (RockPhysicsProxy | null)[] | null,
    trunkObjects: readonly ObstacleCircleBody[] | null,
  ): void {
    this.rockObjects = rockObjects;
    this.trunkObjects = trunkObjects;
    this.obstacleIndex.markDirty();
  }

  /** Transfers the existing single index to the current World binding; no parallel index is made. */
  claimObstacleIndex(bindingToken?: object): ArenaObstacleIndex {
    if (bindingToken) this.activeGeometryBinding = bindingToken;
    return this.obstacleIndex;
  }

  /** Clears the shared index only for the binding that currently owns it. */
  releaseGeometryBinding(bindingToken: object): boolean {
    if (this.activeGeometryBinding !== bindingToken) return false;
    this.activeGeometryBinding = null;
    return true;
  }

  /**
   * Nach jeder Änderung der Hindernis-*Geometrie* aufrufen – also wenn ein Fels gesetzt
   * oder entfernt wurde. Der `active`-Zustand allein braucht das nicht: den liest der
   * Index bei jeder Abfrage direkt am Objekt.
   */
  invalidateObstacleIndex(): void {
    this.obstacleIndex.markDirty();
  }

  /**
   * Gibt den Hindernis-Index zur Mitbenutzung frei. Bewusst dieselbe Instanz statt eines
   * zweiten Index: sie hängt an denselben Arrays und an derselben Invalidierung, damit
   * Sichtlinie und Projektil-Kollision nie auseinanderlaufen können.
   */
  /** @deprecated World-bound consumers receive geometry queries; retained for legacy P10 cutover. */
  getObstacleIndex(): ArenaObstacleIndex {
    return this.obstacleIndex;
  }

  /**
   * Coop-Defense-Basen als Hitscan-/LoS-/Melee-Blocker registrieren. null
   * deaktiviert die Blocker (Lobby-Teardown).
   */
  setBaseObstacles(
    baseObstacles: readonly Phaser.GameObjects.Rectangle[] | null,
  ): void {
    this.baseObstacles = baseObstacles;
    this.obstacleIndex.markDirty();
  }

  setBarrierObstacles(barriers: readonly ObstacleRectBody[] | null): void {
    this.barrierObstacles = barriers;
    this.obstacleIndex.markDirty();
  }

  setTrainSegments(segments: readonly Phaser.GameObjects.Rectangle[] | null): void {
    this.trainSegObjects = segments;
  }

  /** Client-only: setzt vorberechnete Zug-Bounds direkt (ohne Segment-Objekte). */
  setClientTrainBounds(state: { x: number; y: number; dir: 1 | -1 } | null): void {
    if (!state) { this.clientTrainBounds = null; return; }
    const rearExtent = TRAIN.LOCO_HEIGHT / 2 + TRAIN.WAGON_COUNT * (TRAIN.SEGMENT_GAP + TRAIN.WAGON_HEIGHT);
    const minY = state.dir === 1 ? state.y - rearExtent : state.y - TRAIN.LOCO_HEIGHT / 2;
    const maxY = state.dir === 1 ? state.y + TRAIN.LOCO_HEIGHT / 2 : state.y + rearExtent;
    this.clientTrainBounds = new Phaser.Geom.Rectangle(
      state.x - TRAIN.HITBOX_WIDTH / 2,
      minY,
      TRAIN.HITBOX_WIDTH,
      maxY - minY,
    );
  }

  setRockDamageCallback(cb: ((rockIndex: number, damage: number, attackerId: string) => void) | null): void {
    this.onRockDamage = cb;
  }

  setTrainDamageCallback(cb: ((damage: number, attackerId: string) => void) | null): void {
    this.onTrainDamage = cb;
  }

  setPlayerImpulseCallback(cb: ((playerId: string, vx: number, vy: number, durationMs: number, sourcePlayerId?: string) => void) | null): void {
    this.onPlayerImpulse = cb;
  }

  setEnemyImpulseCallback(cb: ((enemyId: string, vx: number, vy: number, durationMs: number, sourcePlayerId?: string) => void) | null): void {
    this.onEnemyImpulse = cb;
  }

  /** Setzt den Kill-Callback (Host-only). */
  setKillCallback(cb: (killerId: string, victimId: string, sourceId: string, x: number, y: number, source?: KillSourceContext) => void): void {
    this.onKillCb = cb;
  }

  setDeathCallback(cb: ((playerId: string, x: number, y: number) => void) | null): void {
    this.onDeathCb = cb;
  }

  setEnemyDeathCallback(cb: ((enemyId: string, x: number, y: number, burnSources: readonly ActiveBurnSource[], death: EnemyDeathInfo | undefined, target: CombatTargetRef) => boolean | void) | null): void {
    this.onEnemyDeathCb = cb;
  }

  setAk47DirectEnemyHitHandler(handler: ((context: ProjectileAk47HitContext, enemyId: string, nowMs: number) => Ak47DirectEnemyHitImpact | null) | null): void {
    this.onAk47DirectEnemyHit = handler;
  }

  bindHostExecutionSources(sources: CombatHostExecutionSources): { destroy(): void } {
    const binding = Object.freeze({ ...sources });
    this.hostExecutionSources = binding;
    return { destroy: () => {
      if (this.hostExecutionSources === binding) this.hostExecutionSources = null;
    } };
  }

  /** A regular Host frame supplies nowMs; an immediate outer entry samples the bound Host clock. */
  runHostExecution<T>(work: () => T, nowMs?: number): T {
    const sources = this.hostExecutionSources;
    if (!sources) throw new Error('[CombatSystem] Host execution sources are not bound to a World');
    const previous = this.currentHostExecution;
    if (previous?.sources === sources) return work();
    const now = nowMs ?? sources.nowMs();
    if (!Number.isFinite(now)) throw new RangeError('Combat Host time must be finite');
    this.currentHostExecution = { sources, nowMs: now };
    try { return work(); }
    finally { this.currentHostExecution = previous; }
  }

  // ── Spieler-Lifecycle ──────────────────────────────────────────────────────

  initPlayer(id: string): void {
    if (this.initialSpawnAllowedResolver && !this.initialSpawnAllowedResolver(id)) return;
    if (this.playerVitals.getTargetRef(id)) return;
    this.playerVitals.attachAndBeginInitialLife(id);
    this.clearAttribution(id);
    this.clearBurnForPlayer(id);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
    this.lastKillSource.delete(id);
    this.lastDamageOrigin.delete(id);
  }

  /** Host-only reconnect after a registered death; consumes through the normal respawn callback. */
  spawnPlayerAfterReconnect(id: string): boolean {
    return this.bridge.isHost() && this.playerLife.reconnect(id);
  }

  advancePlayerLifecycle(nowMs: number): void {
    if (this.bridge.isHost()) this.playerLife.advance(nowMs);
  }

  invalidatePlayerLifecyclePolicy(): void {
    this.reactionGeneration += 1;
    this.playerLife.invalidatePolicy();
  }

  private captureReactionValidity(): () => boolean {
    const generation = this.reactionGeneration;
    const sources = this.hostExecutionSources;
    return () => generation === this.reactionGeneration && sources === this.hostExecutionSources;
  }

  getHostTime(): number { return this.hostFrameNowMs; }

  removePlayer(id: string): void {
    this.clearAttribution(id);
    this.clearBurnForPlayer(id);
    this.clearBurnByAttacker(id);
    this.playerVitals.detachCurrentPlayer(id);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
    this.lastKillSource.delete(id);
    this.lastDamageOrigin.delete(id);
    this.playerLife.removePlayer(id);
  }

  // ── Abfragen ───────────────────────────────────────────────────────────────

  getHP(id: string): number { return this.playerVitals.readCurrent(id)?.hp ?? this.resolvePlayerMaxHp(id); }
  getMaxHp(id: string): number { return this.playerVitals.readCurrent(id)?.maxHp ?? this.resolvePlayerMaxHp(id); }
  getArmor(id: string): number { return this.playerVitals.readCurrent(id)?.armor ?? 0; }

  getPlayerCombatTarget(id: string): CombatTargetRef | null {
    return this.playerVitals.getTargetRef(id);
  }

  /**
   * Reconciles live build-derived caps without recreating the player runtime. This is used when
   * a World-only Coop build changes while the player is already in the test area.
   */
  reconcilePlayerRuntimeState(id: string): void {
    const target = this.playerVitals.getTargetRef(id);
    if (!target) return;
    this.playerVitals.commitSupport({
      outcomeId: this.nextMutationOutcomeId('cap', id),
      target,
      source: this.createLegacyMutationSource(id, 'combat.cap-adjustment', 'support'),
      supportKind: 'cap-adjustment',
      amount: 0,
    });
  }

  isAlive(id: string): boolean { return (this.playerVitals.readCurrent(id)?.alive ?? false) || this.enemyManager?.hasEnemy(id) === true; }
  isBurrowed(id: string): boolean {
    const enemy = this.enemyManager?.getEnemy(id);
    if (enemy) return enemy.isBurrowed();
    return this.burrowSystem?.isBurrowed(id) ?? false;
  }
  getBurnVisualState(
    id: string,
    now: number,
  ): { stackCount: number; visualStyle: GroundFireVisualStyle } {
    const target = this.resolveCurrentCombatantTarget(id);
    return target
      ? this.burnStatus.getVisualState(target, now)
      : { stackCount: 0, visualStyle: 'normal' };
  }

  getBurnStackCount(id: string, now: number): number {
    return this.getBurnVisualState(id, now).stackCount;
  }

  getActiveBurnSources(id: string, now: number): ActiveBurnSource[] {
    const target = this.resolveCurrentCombatantTarget(id);
    return target ? this.burnStatus.getActiveSources(target, now) : [];
  }

  // ── Öffentliche Schadens-Methode ───────────────────────────────────────────

  /**
   * Fügt einem Spieler Schaden zu. Burrowed-Spieler sind unverwundbar
   * (Ausnahme: Stuck-Schaden über skipBurrowCheck=true).
   * attackerId/sourceId werden für die Kill-Zuordnung getrackt.
   */
  private applyDamageAtHostTime(
    targetId:        string,
    amount:          number,
    skipBurrowCheck  = false,
    attackerId?:     string,
    sourceId?:     string,
    visualContext?:  DamageVisualContext,
    options?:        DamageApplicationOptions,
  ): CombatDamageMutationOutcome | null {
    if (this.enemyManager?.hasEnemy(targetId)) {
      return this.applyEnemyDamage(targetId, amount, attackerId, sourceId, visualContext, options);
    }
    const target = this.playerVitals.getTargetRef(targetId);
    if (!target) return null;
    this.prepareAttributionTarget(target);
    const request = this.createDamageRequest(target, amount, attackerId, sourceId, options, skipBurrowCheck);
    const worldCurrent = this.captureReactionValidity();
    const current = () => {
      const life = this.playerVitals.getTargetRef(targetId);
      return worldCurrent() && life !== null && isSameCombatTargetInstance(life, target);
    };
    const outcome = applyCombatDamage(request, this.combatResolutionContext(), this.playerVitals);
    // Eligible incoming damage reveals stealth even when a Dome/reduction absorbs the loss.
    if (outcome.kind !== 'damage-applied') {
      if (outcome.kind !== 'rejected' && amount > 0) this.decoySystem?.breakStealth(targetId, this.hostFrameNowMs);
      return outcome;
    }
    if (!current()) return outcome;
    const damageKind = request.damageKind;
    const isCritical = outcome.damage.isCritical;

    // Attribution is updated only by a confirmed mutation, not a fully blocked candidate.
    if (attackerId && attackerId !== targetId) {
      this.lastAttacker.set(targetId, attackerId);
      this.lastSource.set(targetId, outcome.source);
      if (sourceId) this.lastWeapon.set(targetId, sourceId);
      if (visualContext) this.lastKillSource.set(targetId, {
        dirX: visualContext.dirX,
        dirY: visualContext.dirY,
        projectileColor: visualContext.projectileColor,
      });
      this.rememberDamageOrigin(targetId, options);
    }

    const player = this.playerManager.getPlayer(targetId);
    const x = player?.x ?? 0;
    const y = player?.y ?? 0;

    const { armorLost, hpLost, actualDamage: totalDamage } = outcome;
    const finish = () => {
      // A new life stops old-life gameplay, not observation of the committed parent.
      if (worldCurrent()) this.notifyDamageDealt({
        targetType: 'player', targetId, attackerId: outcome.source.attribution.id,
        damage: totalDamage, damageKind, sourceSlot: request.source.sourceSlot, isCritical,
      });
      return outcome;
    };
    const newHp = outcome.resultingState.kind === 'combatant' ? outcome.resultingState.hp : 0;
    const terminalSource = this.captureKillSource(targetId, outcome);
    const creditedSource = this.lastSource.get(targetId);
    const killerId = creditedSource?.attribution.id ?? this.lastAttacker.get(targetId);
    const killWeapon = this.lastWeapon.get(targetId) ?? sourceId ?? 'source.unknown';
    const deathSeed = outcome.transition.kind === 'dead' ? this.nextEffectSeed() : 0;
    const deathDirection = outcome.transition.kind === 'dead'
      ? this.resolveDamageDirection(targetId, attackerId, visualContext, deathSeed, x, y) : undefined;
    const deathEffect = outcome.transition.kind === 'dead'
      ? this.buildDeathEffect(targetId, x, y, deathSeed, deathDirection) : undefined;

    // Facts are secured; end old-life status before hooks can create a new life/status.
    if (outcome.transition.kind === 'dead') {
      this.onPlayerLifeEnded?.(target);
      if (!current()) return finish();
    }
    if (amount > 0) this.decoySystem?.breakStealth(targetId, this.hostFrameNowMs);
    if (!current()) return finish();

    // Armor-Schaden zaehlt nur mit dem passenden Coop-Defense-Upgrade als Rage-Quelle.
    const rageDamage = getRageGeneratingDamage(
      hpLost,
      armorLost,
      this.playerArmorDamageGrantsRageResolver?.(targetId) ?? false,
    );
    if (rageDamage > 0) {
      this.resourceSystem?.addRage(targetId, rageDamage * RAGE_PER_DAMAGE);
      if (!current()) return finish();
    }

    if (totalDamage > 0) {
      // Nach der Verteilung, damit Verbraucher den *tatsaechlichen* Verlust sehen: vollstaendig
      // abgewehrter Schaden, Schaden von null und reine Rueckstoss-Effekte melden hier nichts.
      this.onPlayerDamageTaken?.(
        targetId,
        attackerId,
        hpLost,
        armorLost,
        damageKind,
        target,
      );
      if (!current()) return finish();
      this.applyLifeLeech(attackerId, targetId, totalDamage);
      if (!current()) return finish();
      const hitSeed = this.nextEffectSeed();
      this.bridge.broadcastEffect(this.buildHitEffect(
        targetId,
        x,
        y,
        attackerId,
        totalDamage,
        hpLost,
        armorLost,
        newHp === 0,
        visualContext,
        hitSeed,
        isCritical,
      ));
    }

    if (outcome.transition.kind === 'dead') {
      this.handleDeath(targetId, x, y, deathSeed, deathDirection, true, {
        killerId, weapon: killWeapon, source: terminalSource, effect: deathEffect!, target,
      });
    }
    return finish();
  }

  applyBurnHit(
    targetId: string,
    attackerId: string,
    durationMs: number,
    damagePerTick: number,
    sourceKey: string,
    sourceId: string,
    origin: BurnOrigin = 'generic',
    visualStyle: GroundFireVisualStyle = 'normal',
  ): void {
    this.runHostExecution(() => this.applyBurnHitAtHostTime(
      targetId,
      attackerId,
      durationMs,
      damagePerTick,
      sourceKey,
      sourceId,
      origin,
      visualStyle,
    ));
  }

  private applyBurnHitAtHostTime(
    targetId: string,
    attackerId: string,
    durationMs: number,
    damagePerTick: number,
    sourceKey: string,
    sourceId: string,
    origin: BurnOrigin,
    visualStyle: GroundFireVisualStyle,
  ): void {
    if (!this.isAlive(targetId)) return;
    if (!this.canDamageTarget(attackerId, targetId)) return;
    if (durationMs <= 0 || damagePerTick <= 0 || !sourceId) return;

    const target = this.resolveCurrentCombatantTarget(targetId);
    if (!target) return;
    this.burnStatus.applyBurn({
      target,
      source: this.createLegacyMutationSource(attackerId, sourceId, 'burn'),
      durationMs,
      damagePerTick,
      tickIntervalMs: BURN_TICK_INTERVAL_MS,
      nowMs: this.hostFrameNowMs,
    }, { stackKey: sourceKey, origin, visualStyle });
  }

  /**
   * Wendet eine BurnOnHitConfig auf ein Ziel an (Projektil/Hitscan/Melee/Explosion).
   * No-op, wenn keine Config vorhanden oder deaktiviert (damagePerTick/durationMs = 0).
   */
  private applyBurnOnHit(
    targetId:   string,
    attackerId: string,
    burn:       BurnOnHitConfig | undefined,
    sourceId: string,
    origin: BurnOrigin = 'generic',
  ): void {
    if (!burn) return;
    this.applyBurnHit(
      targetId,
      attackerId,
      burn.durationMs,
      burn.damagePerTick,
      `weapon:${sourceId}`,
      sourceId,
      origin,
    );
  }

  /** Future frame port: P11 replaces the existing Burn-only stage with this combined advance. */
  advanceStatuses(now: number): void {
    this.movementStatus?.prune(now);
    this.plasmaSwarmMechanic?.advance(now);
    this.updateBurnEffects(now);
  }

  /** Existing PreCombat Burn stage retained until the P11 frame-port cutover. */
  updateBurnEffects(now: number): void {
    const contributions = this.burnStatus.advance(now, (target) => (
      this.isCurrentCombatantTarget(target)
      && this.isAlive(String(target.id))
      && !this.isBurrowed(String(target.id))
    ));

    for (const contribution of contributions) {
      const targetId = String(contribution.target.id);
      if (!this.isCurrentCombatantTarget(contribution.target) || !this.isAlive(targetId)) continue;
      this.applyDamage(
        targetId,
        contribution.damage,
        false,
        contribution.attackerId,
        contribution.sourceId,
        undefined,
        {
          allowCritical: false, damageKind: 'burn', source: contribution.source,
          basis: { kind: 'source-resolved', amount: contribution.damage, sourceFactors: [] },
        },
      );
    }
  }

  /**
   * Flächenschaden um einen Punkt (z.B. Granaten-Explosion).
   * Burrowed-Spieler sind immun (skipBurrowCheck=false).
   */
  private applyAoeDamageAtHostTime(
    x: number,
    y: number,
    radius: number,
    damage: number,
    ownerId: string,
    includeSelf = false,
    options?: AoeDamageOptions,
  ): void {
    const runtimeDamage = options?.damageAlreadyScaled
      ? damage
      : damage * this.getPlayerRuntimeDamageMultiplier(ownerId, options?.sourceSlot);
    for (const player of this.playerManager.getAllPlayers()) {
      if (options?.excludeTargetId === player.id) continue;
      if (!includeSelf && player.id === ownerId) continue;
      if (!this.isAlive(player.id)) continue;
      if (!this.canDamageTarget(ownerId, player.id, options?.allowTeamDamage)) continue;
      const dist = Phaser.Math.Distance.Between(x, y, player.x, player.y);
      if (dist > radius) continue;

      let appliedDamage = computeRadialDamage(dist, radius, runtimeDamage, options?.damageFalloff);
      if (player.id === ownerId) {
        appliedDamage *= options?.selfDamageMult ?? 1;
      }

      const roundedDamage = Math.round(appliedDamage);
      if (roundedDamage <= 0) continue;

      const category = options?.category ?? 'explosion';
      if (this.shouldBlockWithShield(player.id, category, roundedDamage, x, y)) continue;
      this.applyDamage(player.id, roundedDamage, false, ownerId, options?.sourceId ?? 'weapon.grenade', {
        sourceX: x,
        sourceY: y,
        ...options?.killSource,
      }, toDamageOptions(options, 'explosion'));
    }

    this.applyRadialHostileBaseDamage(
      x, y, radius, damage, ownerId, options?.damageFalloff, options?.sourceSlot,
      options?.baseDamageMult,
    );

    if (options?.skipEnemies) return;

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      if (options?.excludeTargetId === enemy.id) continue;
      if (!includeSelf && enemy.id === ownerId) continue;
      if (!this.canDamageTarget(ownerId, enemy.id, options?.allowTeamDamage)) continue;
      const dist = Phaser.Math.Distance.Between(x, y, enemy.sprite.x, enemy.sprite.y);
      if (dist > radius) continue;

      const roundedDamage = Math.round(computeRadialDamage(dist, radius, runtimeDamage, options?.damageFalloff));
      if (roundedDamage <= 0) continue;
      if ((options?.enemySlowFraction ?? 0) > 0 && (options?.enemySlowDurationMs ?? 0) > 0) {
        this.applyEnemySlow(enemy.id, options?.enemySlowFraction ?? 0, options?.enemySlowDurationMs ?? 0);
      }
      this.applyDamage(enemy.id, roundedDamage, false, ownerId, options?.sourceId ?? 'weapon.grenade', {
        sourceX: x,
        sourceY: y,
        ...options?.killSource,
      }, toDamageOptions(options, 'explosion'));
    }
  }

  /** Passive movement projection; expiry cleanup belongs to the explicit status advance. */
  getEnemyMovementFactor(enemyId: string, now: number): number {
    const target = this.enemyManager?.getCombatTargetRef(enemyId);
    return target ? (this.movementStatus?.getMovementFactor(target, now) ?? 1) : 1;
  }

  /**
   * Verlangsamt einen Gegner. Es gibt bewusst nur einen Slot je Gegner statt einer Liste je
   * Quelle: der staerkere Faktor und der spaetere Ablauf gewinnen.
   *
   * Die Dauer wird **nicht** mehr bedingungslos ueberschrieben. Sonst koennte eine schwache
   * spaete Anwendung – etwa Unterdrueckungsmunition neben einer ausgebauten Bremsladung – einen
   * starken laufenden Slow verkuerzen.
   */
  applyEnemySlow(enemyId: string, slowFraction: number, durationMs: number, now?: number): void {
    this.runHostExecution(() => this.applyEnemySlowAtHostTime(enemyId, slowFraction, durationMs), now);
  }

  private applyEnemySlowAtHostTime(enemyId: string, slowFraction: number, durationMs: number): void {
    if (slowFraction <= 0 || durationMs <= 0 || !this.enemyManager?.hasEnemy(enemyId)) return;
    const target = this.enemyManager.getCombatTargetRef(enemyId);
    if (!target) return;
    this.movementStatus?.applySlow({
      target,
      source: this.createLegacyMutationSource(undefined, 'status.enemy-slow', 'support'),
      factor: 1 - slowFraction,
      durationMs,
      nowMs: this.hostFrameNowMs,
    });
  }

  private applyExplosionDamageAtHostTime(
    x: number,
    y: number,
    effect: ProjectileExplosionConfig,
    ownerId: string,
    sourceSlot?: LoadoutSlot,
    sourceId = 'environment.explosion',
  ): string[] {
    const damagedTargetKeys: string[] = [];
    const damagePlayers = effect.damageTarget === undefined
      || effect.damageTarget === 'all'
      || effect.damageTarget === 'players'
      || effect.damageTarget === 'player-side';
    const damageHostileEnemies = effect.damageTarget === undefined
      || effect.damageTarget === 'all'
      || effect.damageTarget === 'enemies';
    const damageAlliedEnemies = damageHostileEnemies || effect.damageTarget === 'player-side';

    for (const player of damagePlayers ? this.playerManager.getAllPlayers() : []) {
      if (!this.isAlive(player.id)) continue;

      const dist = Phaser.Math.Distance.Between(x, y, player.x, player.y);
      if (dist > effect.radius) continue;

      let damage = computeProjectileExplosionDamage(dist, effect)
        * this.getPlayerRuntimeDamageMultiplier(ownerId, sourceSlot);
      if (player.id === ownerId) {
        damage *= effect.selfDamageMult;
      }
      if (!this.canDamageTarget(ownerId, player.id, effect.allowTeamDamage)) continue;

      const roundedDamage = Math.round(damage);
      if (roundedDamage <= 0) continue;
      if (this.shouldBlockWithShield(player.id, 'explosion', roundedDamage, x, y)) continue;
      if (player.id !== ownerId) this.applyBurnOnHit(player.id, ownerId, effect.burnOnHit, sourceId, effect.burnOrigin);
      this.applyDamage(player.id, roundedDamage, false, ownerId, sourceId, { sourceX: x, sourceY: y }, {
        allowTeamDamage: effect.allowTeamDamage,
        sourceSlot,
        damageKind: 'explosion',
      });
      damagedTargetKeys.push(`players:${player.id}`);
    }

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      if (enemy.faction === 'hostile' ? !damageHostileEnemies : !damageAlliedEnemies) continue;
      const dist = Phaser.Math.Distance.Between(x, y, enemy.sprite.x, enemy.sprite.y);
      if (dist > effect.radius) continue;

      const roundedDamage = Math.round(
        computeProjectileExplosionDamage(dist, effect)
        * this.getPlayerRuntimeDamageMultiplier(ownerId, sourceSlot),
      );
      if (roundedDamage <= 0) continue;
      if ((effect.enemySlowFraction ?? 0) > 0 && (effect.enemySlowDurationMs ?? 0) > 0) {
        this.applyEnemySlow(enemy.id, effect.enemySlowFraction ?? 0, effect.enemySlowDurationMs ?? 0);
      }
      this.applyBurnOnHit(enemy.id, ownerId, effect.burnOnHit, sourceId, effect.burnOrigin);
      this.applyDamage(enemy.id, roundedDamage, false, ownerId, sourceId, { sourceX: x, sourceY: y }, {
        allowTeamDamage: effect.allowTeamDamage,
        sourceSlot,
        damageKind: 'explosion',
      });
      damagedTargetKeys.push(`enemies:${enemy.id}`);
    }

    // Basen erhalten denselben zentralen Schadenstrichter wie direkte Treffer; die
    // Oberflächenprüfung berücksichtigt dabei auch große oder konkave Formen.
    for (const base of this.baseManager?.getBasesByFaction('hostile') ?? []) {
      if ((base.isInert?.() ?? false) || base.getHp() <= 0) continue;
      const surface = base.getNearestSurfacePoint(x, y);
      if (!surface || surface.distance > effect.radius) continue;
      if (this.enemyManager?.hasEnemy(ownerId)) continue;
      const damage = Math.round(computeProjectileExplosionDamage(surface.distance, effect));
      if (damage <= 0) continue;
      this.applyBaseDamage(base.id, damage, ownerId, sourceSlot, effect.baseDamageMult);
      damagedTargetKeys.push(`bases:${base.id}`);
    }
    return damagedTargetKeys;
  }

  canDamageTarget(attackerId: string | undefined, targetId: string, allowTeamDamage = false): boolean {
    if (!attackerId) return true;
    if (this.playerActionAllowedResolver
      && this.bridge.getPlayerProfile(attackerId)
      && !this.playerActionAllowedResolver(attackerId)) return false;
    if (attackerId === targetId) return true;
    const attackerEnemy = this.enemyManager?.getEnemy(attackerId);
    const targetEnemy = this.enemyManager?.getEnemy(targetId);
    const source = {
      allegiance: { ownerId: attackerId, factionId: attackerEnemy?.faction },
      actor: attackerEnemy ? { kind: 'enemy' as const, id: attackerId } : undefined,
    };
    if (attackerId === COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID) {
      return this.relationshipForSource(source, targetId).canDamage;
    }
    if (allowTeamDamage) return true;
    // Eingebuddelte Gegner sind – wie eingebuddelte Spieler – weder Ziel noch Angreifer.
    if (targetEnemy?.isBurrowed() || attackerEnemy?.isBurrowed()) return false;
    return this.relationshipForSource(source, targetId).canDamage;
  }

  private shouldBlockWithShield(
    targetId: string,
    category: ShieldBlockCategory,
    damage: number,
    sourceX: number,
    sourceY: number,
    now = this.hostFrameNowMs,
  ): boolean {
    if (!this.energyShieldSystem) return false;
    return this.energyShieldSystem.tryBlockDamage({
      targetId,
      category,
      damage,
      sourceX,
      sourceY,
      now,
    });
  }

  // ── Projectile-Collision-Grenzen ──────────────────────────────────────────

  /**
   * Frame-Sicht der kollidierbaren Kampfziele für die Projectile-Runtime.
   *
   * Die Reihenfolge ist fachlich: lebende, nicht vergrabene Spieler vor Gegnern vor Ködern. Dieser
   * Owner iteriert dabei keine Projectiles.
   */
  readCollisionTargets(sink: ProjectileCollisionTargetSink): void {
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isAlive(player.id)) continue;
      if (this.burrowSystem?.isBurrowed(player.id)) continue;
      const bounds = player.getBounds();
      sink(
        'player', player.id, player.id,
        player.x, player.y, PLAYER_SIZE * 0.5,
        bounds.left, bounds.top, bounds.right, bounds.bottom,
      );
    }
    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      if (!enemy.sprite.active || !this.isAlive(enemy.id)) continue;
      const bounds = enemy.sprite.getBounds();
      sink(
        'enemy', enemy.id, enemy.id,
        enemy.sprite.x, enemy.sprite.y,
        Math.max(enemy.sprite.displayWidth, enemy.sprite.displayHeight) * 0.5,
        bounds.left, bounds.top, bounds.right, bounds.bottom,
      );
    }
    for (const decoy of this.decoySystem?.getHostTargets() ?? []) {
      if (!decoy.sprite.active) continue;
      const bounds = decoy.sprite.getBounds();
      sink(
        'decoy', decoy.id, decoy.ownerId,
        decoy.sprite.x, decoy.sprite.y,
        Math.max(decoy.sprite.displayWidth, decoy.sprite.displayHeight) * 0.5,
        bounds.left, bounds.top, bounds.right, bounds.bottom,
      );
    }
  }

  /** Nächster Weltblocker entlang eines Travel-Segments; derselbe Index wie beim Hitscan. */
  getNearestProjectileBlockerDistance(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    ignoreRocks: boolean,
  ): number | null {
    this.projectileBlockerLine.setTo(startX, startY, endX, endY);
    return this.findNearestProjectilePathBlockerDistance(this.projectileBlockerLine, ignoreRocks);
  }

  /**
   * World-space Barriere der Energiekuppel vor jeder normalen Target-Interaction.
   *
   * Sie entscheidet ausschließlich über Absorption, Reflexion und Übernahme; die Projectile-
   * Mutation bleibt beim Projectile-Owner.
   */
  resolveProjectileBarrier(request: ProjectileBarrierRequest): ProjectileBarrierResolution {
    const domes = this.energyShieldSystem?.getReflectDomes();
    if (!domes || domes.length === 0) return { kind: 'passed' };
    const attackerId = request.provenance.allegiance.ownerId;

    for (const dome of domes) {
      if (attackerId === dome.ownerId) continue;
      // Nur feindliche Projektile abwehren – eigene/verbündete Geschosse passieren die Kuppel.
      if (!this.canDamageTarget(attackerId, dome.ownerId, request.allowTeamDamage)) continue;

      const dx = request.x - dome.x;
      const dy = request.y - dome.y;
      if (dx * dx + dy * dy > dome.radius * dome.radius) continue;

      const blockedDamage = request.damage ?? 0;
      this.energyShieldSystem?.onDomeAbsorb(dome.ownerId, blockedDamage, request.nowMs);

      // Reine Absorptionskuppel: das Geschoss verschwindet folgenlos, bei Brutbomben
      // schluepft also gar nichts.
      if (!dome.reflect) return { kind: 'absorbed' };

      const angle = (dx === 0 && dy === 0)
        ? Math.atan2(-request.velocityY, -request.velocityX)
        : Math.atan2(dy, dx);
      return {
        kind: 'reflected',
        attributionId: dome.ownerId,
        allegiance: { ownerId: dome.ownerId },
        angle,
        sourceId: 'environment.reflector_dome',
        sourceSlot: 'weapon2',
        ownerColor: dome.color,
        // Übernommene Brut-Granate: Granatensemantik und Restzündzeit bleiben erhalten.
        keepGrenade: request.capturable,
      };
    }
    return { kind: 'passed' };
  }
  /** Schützen-Damage-Multiplikator (Loadout/Ultimate + PowerUp) auf den Projektil-Basisschaden anwenden. */
  private computeProjectileWeaponDamage(proj: ProjectileImpactSource): number {
    let projectileMultiplier = proj.ak47DamageMultiplier ?? 1;
    if (
      (proj.shotgunProximityMaxDamageBonus ?? 0) > 0
      && proj.shotgunOriginX !== undefined
      && proj.shotgunOriginY !== undefined
      && (proj.shotgunResolvedRange ?? 0) > 0
    ) {
      const distance = Phaser.Math.Distance.Between(
        proj.shotgunOriginX,
        proj.shotgunOriginY,
        proj.x,
        proj.y,
      );
      const closeness = Phaser.Math.Clamp(1 - distance / (proj.shotgunResolvedRange ?? 1), 0, 1);
      projectileMultiplier *= 1 + closeness * (proj.shotgunProximityMaxDamageBonus ?? 0);
    }
    return proj.damage * projectileMultiplier;
  }

  private getPlayerRuntimeDamageMultiplierAtHostTime(playerId: string, sourceSlot?: LoadoutSlot): number {
    const loadoutMult = sourceSlot === 'weapon1' || sourceSlot === 'weapon2'
      ? (this.loadoutManager?.getWeaponDamageMultiplier(playerId, sourceSlot, this.hostFrameNowMs) ?? 1)
      : (this.loadoutManager?.getDamageMultiplier(playerId, this.hostFrameNowMs) ?? 1);
    const powerUpMult = this.powerUpSystem?.getDamageMultiplier(playerId) ?? 1;
    return loadoutMult * powerUpMult;
  }

  /**
   * Wendet einen Projektiltreffer auf eine Basis an. Die Berechnung bleibt identisch zum
   * Projektiltreffer gegen Spieler/Gegner; der anschließende Basistrichter ergänzt die
   * strukturspezifischen Coop-Modifikatoren.
   */
  applyProjectileBaseDamage(baseId: string, projectile: ProjectileImpactSource): void {
    this.applyBaseDamage(
      baseId,
      this.computeProjectileWeaponDamage(projectile),
      projectile.ownerId,
      projectile.sourceSlot,
      projectile.baseDamageMult,
    );
  }

  private registerAk47Hit(context: ProjectileAk47HitContext | undefined): void {
    if (!context) return;
    this.ak47Behavior?.registerProjectileHit(context, this.hostFrameNowMs);
  }

  private resolveAk47DirectEnemyHit(
    request: ProjectileDirectImpactRequest,
    enemyId: string,
  ): ProjectileAk47DirectImpact {
    const shotId = request.provenance.correlation?.ak47ShotId;
    const fireSuperiorityShot = request.directHit.ak47?.fireSuperiorityShot === true;
    if (shotId === undefined || request.provenance.sourceSlot !== 'weapon2') {
      return { damageMultiplier: 1 };
    }
    const context: ProjectileAk47HitContext = {
      ownerId: request.provenance.allegiance.ownerId,
      shotId,
      fireSuperiorityShot,
    };
    this.registerAk47Hit(context);
    return this.onAk47DirectEnemyHit?.(context, enemyId, this.hostFrameNowMs) ?? { damageMultiplier: 1 };
  }

  private applyAk47TargetExplosion(
    x: number,
    y: number,
    ownerId: string,
    enemyId: string,
    directDamage: number,
    impact: ProjectileAk47DirectImpact,
  ): void {
    const radius = impact.explosionRadius ?? 0;
    const fraction = impact.explosionDamageFraction ?? 0;
    if (radius <= 0 || fraction <= 0 || directDamage <= 0) return;
    this.applyAoeDamage(
      x,
      y,
      radius,
      directDamage * fraction,
      ownerId,
      false,
      {
        category: 'explosion',
        allowTeamDamage: false,
        sourceId: 'weapon.ak47.explosive',
        sourceSlot: 'weapon2',
        excludeTargetId: enemyId,
        damageAlreadyScaled: true,
      },
    );
  }

  /**
   * Direct-Impact-Grenze der Projectile-Collision (Zielcontract: `ProjectileCombatPort`, Phase 7).
   *
   * Der Kandidat kommt fertig aufgelöst aus der Projectile-Runtime: Geometrie, Reihenfolge,
   * Kontaktgedächtnis und Verbrauch liegen dort. Hier entstehen nur Schaden, Brand, Kettenwirkung
   * und die target-lokale Defense-Entscheidung.
   */
  private resolveDirectImpactAtHostTime(request: ProjectileDirectImpactRequest): ProjectileDirectImpactOutcome {
    if (request.target.kind === 'player') return this.applyDirectPlayerImpact(request, request.target.id);
    if (request.target.kind === 'enemy') return this.applyDirectEnemyImpact(request, request.target.id);
    return this.applyDirectDecoyImpact(request, request.target.id);
  }

  /** Combat-only explosion resolution; Environment and World Effects are host-domain concerns. */
  private resolveExplosionCombatAtHostTime(request: ProjectileCombatExplosionRequest): ProjectileCombatExplosionOutcome {
    return {
      damagedTargetKeys: this.applyExplosionDamage(
        request.x,
        request.y,
        request.effect,
        request.provenance.allegiance.ownerId,
        request.provenance.sourceSlot,
        request.provenance.weaponSourceId ?? 'environment.explosion',
      ),
    };
  }

  /** Trefferwirkung gegen einen Spieler inklusive Schild-Auflösung. */
  private applyDirectPlayerImpact(
    request: ProjectileDirectImpactRequest,
    playerId: string,
  ): ProjectileDirectImpactOutcome {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return { accepted: false };
    const actualDamage = this.computeDirectDamage(request);
    const impactSource = {
      sourceX: request.impact.x,
      sourceY: request.impact.y,
      dirX: request.velocity.x,
      dirY: request.velocity.y,
    };
    const damageOptions = {
      allowTeamDamage: request.provenance.allegiance.allowTeamDamage,
      sourceSlot: request.provenance.sourceSlot,
      damageKind: 'direct' as const,
    };

    const energyInjector = findEnergyInjector(request);
    if (energyInjector) {
      this.onEnergyInjectorTargetHit?.({
        projectileId: request.projectileId,
        ownerId: request.provenance.allegiance.ownerId,
        provenance: energyInjector.provenance,
        payload: energyInjector.payload,
        targetType: 'player',
        targetId: playerId,
        x: player.x,
        y: player.y,
      });
      return { accepted: true, actualDamage: 0 };
    }

    if (this.shouldBlockWithShield(playerId, 'projectile', actualDamage, request.impact.x, request.impact.y, this.hostFrameNowMs)) {
      const reflectionFactor = request.provenance.lineage?.reflected
        ? 0
        : (this.energyShieldSystem?.getReflectionDamageFactor(playerId) ?? 0);
      if (reflectionFactor <= 0) return { accepted: true, blocked: true, actualDamage: 0, defense: { kind: 'absorbed' } };
      return {
        accepted: true,
        blocked: true,
        defense: {
          kind: 'reflected',
          damageFactor: reflectionFactor,
          attributionId: playerId,
          allegiance: { ownerId: playerId },
          originX: request.impact.x,
          originY: request.impact.y,
          sourceId: 'environment.reflector',
          sourceSlot: 'weapon2',
        },
      };
    }

    const ownerId = request.provenance.allegiance.ownerId;
    const sourceId = request.provenance.weaponSourceId ?? 'weapon.projectile';
    this.registerAk47Hit(createAk47Context(request));
    this.applyProjectileBurnAugments(playerId, request);
    const before = this.getHP(playerId) + this.getArmor(playerId);
    this.applyDamage(playerId, actualDamage, false, ownerId, sourceId, impactSource, damageOptions);
    const dealt = Math.max(0, before - this.getHP(playerId) - this.getArmor(playerId));
    if (dealt > 0 && request.directHit.adrenalinGain && request.directHit.adrenalinGain > 0) {
      this.resourceSystem?.addAdrenaline(ownerId, request.directHit.adrenalinGain);
    }
    this.resolveGaussDischarge(request, playerId, undefined, dealt);
    return {
      accepted: true,
      actualDamage: dealt,
      becameDead: !this.isAlive(playerId),
      reaction: createReactionMetadata(request),
    };
  }

  /** Trefferwirkung gegen einen Gegner inklusive AK47-Fokus und Gauss-Entladung. */
  private applyDirectEnemyImpact(
    request: ProjectileDirectImpactRequest,
    enemyId: string,
  ): ProjectileDirectImpactOutcome {
    const enemy = this.enemyManager?.getEnemy(enemyId);
    if (!enemy) return { accepted: false };
    const ak47Impact = this.resolveAk47DirectEnemyHit(request, enemyId);
    const actualDamage = this.computeDirectDamage(request) * Math.max(0, ak47Impact.damageMultiplier);
    const plasmaSwarm = this.resolvePlasmaSwarmReaction(request, enemyId, enemy.sprite.x, enemy.sprite.y);
    if (plasmaSwarm) this.onPlasmaSwarmReaction?.(plasmaSwarm);
    const impactSource = {
      sourceX: request.impact.x,
      sourceY: request.impact.y,
      dirX: request.velocity.x,
      dirY: request.velocity.y,
    };
    const energyInjector = findEnergyInjector(request);
    if (energyInjector) {
      this.onEnergyInjectorTargetHit?.({
        projectileId: request.projectileId,
        ownerId: request.provenance.allegiance.ownerId,
        provenance: energyInjector.provenance,
        payload: energyInjector.payload,
        targetType: 'enemy',
        targetId: enemyId,
        x: enemy.sprite.x,
        y: enemy.sprite.y,
      });
      return { accepted: true, actualDamage: 0, reaction: createReactionMetadata(request, ak47Impact, plasmaSwarm) };
    }
    const ownerId = request.provenance.allegiance.ownerId;
    const sourceId = request.provenance.weaponSourceId ?? 'weapon.projectile';
    const before = typeof enemy.getHp === 'function' ? enemy.getHp() : undefined;
    this.applyEnemySlowFromDirectHit(enemyId, request);
    this.applyProjectileVulnerability({ targetType: 'enemy', targetId: enemyId }, request.directHit.vulnerabilityDurationMs ?? 0);
    this.applyProjectileBurnAugments(enemyId, request);
    this.applyDamage(enemyId, actualDamage, false, ownerId, sourceId, impactSource, {
      allowTeamDamage: request.provenance.allegiance.allowTeamDamage,
      sourceSlot: request.provenance.sourceSlot,
      damageKind: 'direct',
    });
    const dealt = before === undefined ? actualDamage : Math.max(0, before - enemy.getHp());
    this.applyAk47TargetExplosion(request.impact.x, request.impact.y, ownerId, enemyId, dealt, ak47Impact);
    this.resolveGaussDischarge(request, undefined, enemyId, dealt);
    if (dealt > 0 && request.directHit.adrenalinGain && request.directHit.adrenalinGain > 0) {
      this.resourceSystem?.addAdrenaline(ownerId, request.directHit.adrenalinGain);
    }
    return {
      accepted: true,
      actualDamage: dealt,
      becameDead: before !== undefined && enemy.getHp() <= 0,
      reaction: createReactionMetadata(request, ak47Impact, plasmaSwarm),
    };
  }

  /** Trefferwirkung gegen einen Köder. */
  private applyDirectDecoyImpact(
    request: ProjectileDirectImpactRequest,
    decoyId: number,
  ): ProjectileDirectImpactOutcome {
    const actualDamage = this.computeDirectDamage(request);
    const impactSource = {
      sourceX: request.impact.x,
      sourceY: request.impact.y,
      dirX: request.velocity.x,
      dirY: request.velocity.y,
    };
    const ownerId = request.provenance.allegiance.ownerId;
    const sourceId = request.provenance.weaponSourceId ?? 'weapon.projectile';
    const outcome = this.decoySystem?.applyDamage(decoyId, actualDamage, ownerId, sourceId, impactSource) ?? null;
    const appliedDamage = outcome?.kind === 'damage-applied' ? outcome.actualDamage : 0;
    if (appliedDamage > 0 && request.directHit.adrenalinGain && request.directHit.adrenalinGain > 0) {
      this.resourceSystem?.addAdrenaline(ownerId, request.directHit.adrenalinGain);
    }
    return { accepted: outcome?.kind !== 'rejected' && outcome !== null, actualDamage: appliedDamage, reaction: createReactionMetadata(request) };
  }

  private computeDirectDamage(request: ProjectileDirectImpactRequest): number {
    const directHit = request.directHit;
    let multiplier = directHit.ak47?.damageMultiplier ?? 1;
    if (
      directHit.shotgun?.proximityMaxDamageBonus && directHit.shotgun.resolvedRange > 0
    ) {
      const distance = Phaser.Math.Distance.Between(
        directHit.shotgun.originX,
        directHit.shotgun.originY,
        request.impact.x,
        request.impact.y,
      );
      const closeness = Phaser.Math.Clamp(1 - distance / directHit.shotgun.resolvedRange, 0, 1);
      multiplier *= 1 + closeness * directHit.shotgun.proximityMaxDamageBonus;
    }
    return Math.max(0, directHit.damage * multiplier)
      * this.getPlayerRuntimeDamageMultiplier(
        request.provenance.allegiance.ownerId,
        request.provenance.sourceSlot,
      );
  }

  private applyProjectileBurnAugments(targetId: string, request: ProjectileDirectImpactRequest): void {
    const sourceId = request.provenance.weaponSourceId ?? 'weapon.projectile';
    for (const augment of request.augments) {
      if (!('burn' in augment)) continue;
      const burn = augment.burn;
      this.applyBurnHit(
        targetId,
        augment.provenance.allegiance.ownerId,
        burn.durationMs,
        burn.damagePerTick,
        `weapon:${sourceId}`,
        augment.provenance.weaponSourceId ?? sourceId,
        'generic',
      );
    }
  }

  private applyEnemySlowFromDirectHit(enemyId: string, request: ProjectileDirectImpactRequest): void {
    const slowFraction = request.directHit.slowFraction ?? request.directHit.shotgun?.slowFraction ?? 0;
    const slowDurationMs = request.directHit.slowDurationMs ?? request.directHit.shotgun?.slowDurationMs ?? 0;
    if (slowFraction > 0 && slowDurationMs > 0) this.applyEnemySlow(enemyId, slowFraction, slowDurationMs);
  }

  private resolvePlasmaSwarmReaction(
    request: ProjectileDirectImpactRequest,
    enemyId: string,
    x: number,
    y: number,
  ): ProjectilePlasmaSwarmImpact | undefined {
    const spec = request.directHit.plasmaSwarm;
    if (!spec || request.provenance.lineage?.plasmaSwarmChild === true) return undefined;
    const enemy = this.enemyManager?.getEnemy(enemyId);
    const target = this.enemyManager?.getCombatTargetRef(enemyId);
    if (!enemy || !target || !this.plasmaSwarmMechanic) return undefined;
    const source = this.createLegacyMutationSource(
      request.provenance.allegiance.ownerId,
      request.provenance.weaponSourceId ?? 'weapon.plasma',
      'direct',
    );
    const contact = this.plasmaSwarmMechanic.registerDirectContact({
      target,
      source: {
        ...source,
        lineage: request.provenance.lineage ? { ...request.provenance.lineage } : undefined,
        correlation: { projectileId: request.projectileId },
      },
      nowMs: this.hostFrameNowMs,
      random: this.hostRandom,
    });
    if (!contact?.shouldProc) return undefined;

    const normalSpeed = Math.max(1, Math.hypot(request.velocity.x, request.velocity.y));
    return {
      projectileId: request.projectileId,
      provenance: request.provenance,
      enemyId,
      x,
      y,
      projectileCount: Math.max(PLASMA_SWARM_BASE_PROJECTILE_COUNT, Math.floor(spec.projectileCount ?? PLASMA_SWARM_BASE_PROJECTILE_COUNT)),
      normalDamage: Math.max(0, request.directHit.damage),
      normalSize: 1,
      normalSpeed,
      normalRange: normalSpeed,
      explosionRadius: Math.max(1, spec.explosionRadius ?? PLASMA_SWARM_BASE_EXPLOSION_RADIUS),
      explosionDamage: Math.max(0, spec.explosionDamage ?? PLASMA_SWARM_BASE_EXPLOSION_DAMAGE),
      explosionSlowFraction: Math.max(0, spec.explosionSlowFraction ?? 0),
      color: COLORS.GREEN_2,
      ownerColor: COLORS.GREEN_2,
      baseDamageMult: request.directHit.baseDamageMult,
    };
  }

  private resolveGaussDischarge(
    request: ProjectileDirectImpactRequest,
    hitPlayerId: string | undefined,
    hitEnemyId: string | undefined,
    damage: number,
  ): void {
    const radius = request.directHit.gaussChain?.radius ?? 0;
    const factor = request.directHit.gaussChain?.damageFactor ?? 0;
    if (radius <= 0 || factor <= 0) return;
    this.resolveChainLightning({
      shooterId: request.provenance.allegiance.ownerId,
      originX: request.impact.x,
      originY: request.impact.y,
      baseDamage: damage,
      chainCfg: { maxJumps: 1, searchRadius: radius, damageFalloffPerJump: 1 - factor, targetPlayers: true, targetEnemies: true, targetDecoys: false },
      sourceId: 'weapon.gauss.discharge',
      adrenalinGain: 0,
      playerColor: COLORS.GREEN_2,
      visualPreset: 'asmd_primary',
      baseThickness: 2,
      visitedPlayers: new Set(hitPlayerId ? [hitPlayerId] : []),
      visitedEnemies: new Set(hitEnemyId ? [hitEnemyId] : []),
      visitedDecoys: new Set(),
    });
  }

  private findNearestProjectilePathBlockerDistance(
    line: Phaser.Geom.Line,
    ignoreRocks = false,
  ): number | null {
    let bestDistance: number | null = null;

    this.obstacleIndex.querySegment(
      line.x1, line.y1, line.x2, line.y2,
      (kind, _rockIndex, left, top, right, bottom) => {
        if (ignoreRocks && kind === OBSTACLE_ROCK) return false;
        const hit = this.findNearestRectangleHit(line, this.obstacleRect(left, top, right, bottom));
        if (hit && (bestDistance === null || hit.distance < bestDistance)) {
          bestDistance = hit.distance;
        }
        return false;
      },
      (centerX, centerY, radius) => {
        const hit = this.findNearestCircleHit(line, centerX, centerY, radius);
        if (hit && (bestDistance === null || hit.distance < bestDistance)) {
          bestDistance = hit.distance;
        }
        return false;
      },
    );

    const trainBounds = this.computeTrainBounds();
    if (trainBounds) {
      const hit = this.findNearestRectangleHit(line, trainBounds);
      if (hit && (bestDistance === null || hit.distance < bestDistance)) {
        bestDistance = hit.distance;
      }
    }

    return bestDistance;
  }

  /**
   * Verschiebt einen gewünschten Gameplay-Hitscanstart nur bis unmittelbar vor den ersten
   * Umweltblocker. Die eigentliche Hitscan-Linie und ihr Winkel bleiben unverändert.
   */
  resolveSafeHitscanStart(
    shooterX: number,
    shooterY: number,
    desiredMuzzleX: number,
    desiredMuzzleY: number,
  ): MuzzleOrigin {
    const dx = desiredMuzzleX - shooterX;
    const dy = desiredMuzzleY - shooterY;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.0001) return { x: desiredMuzzleX, y: desiredMuzzleY };

    this.hitscanLine.setTo(shooterX, shooterY, desiredMuzzleX, desiredMuzzleY);
    const obstacleHit = this.findNearestObstacleHit(this.hitscanLine);
    if (!obstacleHit) return { x: desiredMuzzleX, y: desiredMuzzleY };

    const safeDistance = Math.max(0, obstacleHit.distance - HITSCAN_MUZZLE_EPSILON);
    return {
      x: shooterX + (dx / distance) * safeDistance,
      y: shooterY + (dy / distance) * safeDistance,
    };
  }

  private resolveHitscanShotAtHostTime(
    shooterId: string,
    startX: number,
    startY: number,
    angle: number,
    range: number,
    damage: number,
    traceThickness: number,
    playerColor: number,
    adrenalinGain: number,
    sourceId: string,
    visualPreset: HitscanVisualPreset = 'default',
    shotAudioKey?: ShotAudioKey,
    sourceSlot?: WeaponSlot,
    shotId?: number,
    detonatorCfg?: DetonatorConfig,
    rockDamageMult = 1,
    trainDamageMult = 1,
    chainCfg?: ChainLightningConfig,
    burnOnHit?: BurnOnHitConfig,
    supportEffect?: HitscanSupportEffect,
    visualMuzzleOrigin?: { x: number; y: number },
    baseDamageMult = 1,
  ): boolean {
    if (!this.bridge.isHost()) return false;

    const trace = this.traceHitscan({
      shooterId,
      startX,
      startY,
      angle,
      range,
      traceThickness,
      applyFavorTheShooter: true,
      includeShooter: Boolean(supportEffect),
    });

    this.queueHitscanTrace({
      startX: Math.round(startX),
      startY: Math.round(startY),
      endX: Math.round(trace.endX),
      endY: Math.round(trace.endY),
      color: supportEffect?.beamColor ?? playerColor,
      thickness: traceThickness,
      impactKind: (trace.hitPlayerId || trace.hitEnemyId) ? 'player' : (trace.hitObstacle ? 'environment' : 'none'),
      visualPreset,
      shooterId,
      shotId,
      shotAudioKey,
      visualStartX: visualMuzzleOrigin?.x,
      visualStartY: visualMuzzleOrigin?.y,
    });

    // Hitscan-Detonation prüfen (z.B. ASMD Primary zündet ASMD Secondary-Ball)
    if (detonatorCfg) {
      this.detonationSystem?.checkHitscanDetonations(
        startX, startY, trace.endX, trace.endY, shooterId, detonatorCfg,
        sourceSlot,
      );
    }

    if (supportEffect) {
      this.resolveHitscanSupportImpact(
        trace,
        supportEffect,
        shooterId,
        startX,
        startY,
        angle,
        sourceId,
        sourceSlot,
        adrenalinGain,
      );
      return true;
    }

    if (trace.hitPlayerId) {
      const loadoutMult  = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, this.hostFrameNowMs) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId, this.hostFrameNowMs) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      const canDealDamage = this.canDamageTarget(shooterId, trace.hitPlayerId);
      if (canDealDamage && this.shouldBlockWithShield(trace.hitPlayerId, 'hitscan', actualDamage, startX, startY)) return true;
      this.applyDamage(trace.hitPlayerId, actualDamage, false, shooterId, sourceId, {
        sourceX: startX,
        sourceY: startY,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      }, { sourceSlot, damageKind: 'direct' });

      if (canDealDamage) this.applyBurnOnHit(trace.hitPlayerId, shooterId, burnOnHit, sourceId);

      if (canDealDamage && adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
    } else if (trace.hitEnemyId) {
      const loadoutMult  = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, this.hostFrameNowMs) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId, this.hostFrameNowMs) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      this.applyDamage(trace.hitEnemyId, actualDamage, false, shooterId, sourceId, {
        sourceX: startX,
        sourceY: startY,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      }, { sourceSlot, damageKind: 'direct' });

      this.applyBurnOnHit(trace.hitEnemyId, shooterId, burnOnHit, sourceId);

      if (adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
    } else if (trace.hitDecoyId !== null) {
      const loadoutMult  = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, this.hostFrameNowMs) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId, this.hostFrameNowMs) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      const outcome = this.decoySystem?.applyDamage(trace.hitDecoyId, actualDamage, shooterId, sourceId, {
        sourceX: startX,
        sourceY: startY,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      }) ?? null;

      if (outcome?.kind === 'damage-applied' && outcome.actualDamage > 0 && adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
    } else {
      // Kein Spieler getroffen → prüfen ob Fels oder Zug getroffen wurde
      this.applyHitscanObjectDamage(
        startX, startY, trace.endX, trace.endY,
        damage, rockDamageMult, trainDamageMult, shooterId, sourceSlot, baseDamageMult,
      );
    }

    // Kettenblitz: vom Einschlagspunkt aus auf weitere Ziele überspringen.
    if (chainCfg && chainCfg.maxJumps > 0) {
      const loadoutMult = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, this.hostFrameNowMs) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId, this.hostFrameNowMs) ?? 1);
      const powerUpMult = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const baseChainDamage = damage * loadoutMult * powerUpMult;

      const visitedPlayers = new Set<string>();
      const visitedEnemies = new Set<string>();
      const visitedDecoys  = new Set<number>();
      if (trace.hitPlayerId)         visitedPlayers.add(trace.hitPlayerId);
      if (trace.hitEnemyId)          visitedEnemies.add(trace.hitEnemyId);
      if (trace.hitDecoyId !== null) visitedDecoys.add(trace.hitDecoyId);

      this.resolveChainLightning({
        shooterId,
        originX:       trace.endX,
        originY:       trace.endY,
        baseDamage:    baseChainDamage,
        chainCfg,
        sourceId,
        adrenalinGain,
        playerColor,
        visualPreset,
        baseThickness: traceThickness,
        visitedPlayers,
        visitedEnemies,
        visitedDecoys,
      });
    }

    return true;
  }

  /**
   * Kontextabhaengiger Hitscan-Treffer des Plasmabrenners. Die Zielentscheidung bleibt im
   * CombatSystem, waehrend Reparaturen an hostautoritaeren Strukturen beim Host-Update liegen.
   * Feindlicher Schaden nutzt bewusst denselben Schadenstrichter wie jede andere Hitscan-Waffe.
   */
  private resolveHitscanSupportImpact(
    trace: HitscanTraceResult,
    effect: HitscanSupportEffect,
    shooterId: string,
    startX: number,
    startY: number,
    angle: number,
    sourceId: string,
    sourceSlot?: WeaponSlot,
    adrenalinGain = 0,
  ): void {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    const damageTarget = (targetId: string): void => {
      const loadoutMult = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, this.hostFrameNowMs) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId, this.hostFrameNowMs) ?? 1);
      const powerUpMult = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = effect.damagePerHit * loadoutMult * powerUpMult;
      if (actualDamage <= 0) return;
      if (this.shouldBlockWithShield(targetId, 'hitscan', actualDamage, startX, startY)) return;
      this.applyDamage(
        targetId,
        actualDamage,
        false,
        shooterId,
        sourceId,
        { sourceX: startX, sourceY: startY, dirX, dirY },
        { sourceSlot, damageKind: 'direct' },
      );
      if (adrenalinGain > 0) this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
    };

    if (trace.hitPlayerId) {
      const targetId = trace.hitPlayerId;
      const friendly = this.relationshipForSource(
        this.createLegacyMutationSource(shooterId, sourceId, 'support'), targetId,
      ).canSupport;
      if (friendly) {
        const before = this.getHP(targetId);
        const after = this.heal(targetId, effect.healPerHit);
        if (after > before) {
          this.onHitscanSupportImpact?.(
            { targetType: 'player', targetId, x: trace.endX, y: trace.endY },
            effect,
            shooterId,
            sourceSlot,
          );
        }
      } else {
        damageTarget(targetId);
      }
      return;
    }

    if (trace.hitEnemyId) {
      damageTarget(trace.hitEnemyId);
      return;
    }

    if (trace.hitDecoyId !== null) {
      const loadoutMult = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, this.hostFrameNowMs) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId, this.hostFrameNowMs) ?? 1);
      const powerUpMult = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = effect.damagePerHit * loadoutMult * powerUpMult;
      if (actualDamage <= 0) return;
      const outcome = this.decoySystem?.applyDamage(trace.hitDecoyId, actualDamage, shooterId, sourceId, {
        sourceX: startX,
        sourceY: startY,
        dirX,
        dirY,
      }) ?? null;
      if (outcome?.kind === 'damage-applied' && outcome.actualDamage > 0 && adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
      return;
    }

    if (!trace.hitObstacle) return;
    if (trace.hitObstacleKind === 'rock' && trace.hitObstacleIndex !== undefined) {
      this.onHitscanSupportImpact?.(
        {
          targetType: 'rock',
          targetId: String(trace.hitObstacleIndex),
          x: trace.endX,
          y: trace.endY,
        },
        effect,
        shooterId,
        sourceSlot,
      );
      return;
    }

    if (trace.hitObstacleKind === 'base') {
      const targetId = this.resolveHitscanBaseId(trace.endX, trace.endY, dirX, dirY);
      if (!targetId) return;
      this.onHitscanSupportImpact?.(
        { targetType: 'base', targetId, x: trace.endX, y: trace.endY },
        effect,
        shooterId,
        sourceSlot,
      );
    }
  }

  private resolveHitscanBaseId(endX: number, endY: number, dirX: number, dirY: number): string | undefined {
    const direct = this.baseManager?.getBaseIdAtWorldPoint(endX, endY);
    if (direct) return direct;
    for (const backtrack of [0.5, 1, 2, 4, 8]) {
      const id = this.baseManager?.getBaseIdAtWorldPoint(endX - dirX * backtrack, endY - dirY * backtrack);
      if (id) return id;
    }
    return undefined;
  }

  // ── Kettenblitz ────────────────────────────────────────────────────────────

  /**
   * Lässt einen Hitscan-Treffer als Kettenblitz von Ziel zu Ziel überspringen.
   * Ausgangspunkt jedes Sprungs ist der letzte Einschlag; pro Sprung wird das
   * nächstgelegene noch nicht getroffene Ziel mit freier Sichtlinie gewählt.
   * Detonierbare Ziele (z.B. ASMD-Bälle) lösen ihre Detonation aus statt
   * direkten Schaden zu nehmen.
   */
  private resolveChainLightning(opts: {
    shooterId:      string;
    originX:        number;
    originY:        number;
    baseDamage:     number;   // Primärschaden inkl. Multiplikatoren
    chainCfg:       ChainLightningConfig;
    sourceId:      string;
    adrenalinGain:  number;
    playerColor:    number;
    visualPreset:   HitscanVisualPreset;
    baseThickness:  number;
    visitedPlayers: Set<string>;
    visitedEnemies: Set<string>;
    visitedDecoys:  Set<number>;
  }): void {
    const { chainCfg } = opts;
    const thicknessFalloff = chainCfg.thicknessFalloffPerJump ?? 0.2;
    const detonableTags = chainCfg.detonableTags ?? [];
    const visitedTargetIds = new Set<string>([
      ...[...opts.visitedEnemies].map((id) => `enemy:${id}`),
      ...[...opts.visitedPlayers].map((id) => `player:${id}`),
      ...[...opts.visitedDecoys].map((id) => `decoy:${id}`),
    ]);

    resolveChainLightningTraversal({
      originX: opts.originX,
      originY: opts.originY,
      baseDamage: opts.baseDamage,
      config: chainCfg,
      visitedTargetIds,
      getCandidates: () => {
        const candidates: ChainLightningTarget[] = [];
        if (chainCfg.targetEnemies) {
          for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
            if (enemy.id === opts.shooterId) continue;
            if (!this.canDamageTarget(opts.shooterId, enemy.id)) continue;
            candidates.push({
              id: `enemy:${enemy.id}`,
              kind: 'enemy',
              x: enemy.sprite.x,
              y: enemy.sprite.y,
            });
          }
        }
        if (chainCfg.targetPlayers) {
          for (const player of this.playerManager.getAllPlayers()) {
            if (player.id === opts.shooterId) continue;
            if (!this.isAlive(player.id) || this.burrowSystem?.isBurrowed(player.id)) continue;
            if (!this.canDamageTarget(opts.shooterId, player.id)) continue;
            candidates.push({
              id: `player:${player.id}`,
              kind: 'player',
              x: player.x,
              y: player.y,
            });
          }
        }
        if (chainCfg.targetDecoys) {
          for (const decoy of this.decoySystem?.getHostTargets() ?? []) {
            if (decoy.ownerId === opts.shooterId) continue;
            candidates.push({
              id: `decoy:${decoy.id}`,
              kind: 'decoy',
              x: decoy.sprite.x,
              y: decoy.sprite.y,
            });
          }
        }
        if (detonableTags.length > 0) {
          this.projectileDetonableReadPort?.readDetonableProjectiles((proj) => {
            if (!detonableTags.includes(proj.tag)) return;
            if (!proj.allowCrossTeam && proj.ownerId !== opts.shooterId) return;
            candidates.push({
              id: `detonable:${proj.projectileId}`,
              kind: 'detonable',
              x: proj.x,
              y: proj.y,
            });
          });
        }
        return candidates;
      },
      hasLineOfSight: (originX, originY, targetX, targetY) => (
        this.hasChainLineOfSight(originX, originY, targetX, targetY)
      ),
      onJump: (jump) => {
        // Tracer wie die Hitscan-Linie, je Sprung etwas schmaler.
        const thickness = Math.max(1, opts.baseThickness * Math.max(0.15, 1 - thicknessFalloff * jump.jump));
        this.queueHitscanTrace({
          startX: Math.round(jump.originX),
          startY: Math.round(jump.originY),
          endX: Math.round(jump.target.x),
          endY: Math.round(jump.target.y),
          color: opts.playerColor,
          thickness,
          impactKind: 'player',
          visualPreset: opts.visualPreset,
          shooterId: opts.shooterId,
        });

        const runtimeId = jump.target.id.slice(jump.target.id.indexOf(':') + 1);
        const visualContext: DamageVisualContext = { sourceX: jump.originX, sourceY: jump.originY };
        if (jump.target.kind === 'enemy') {
          opts.visitedEnemies.add(runtimeId);
          this.applyDamage(runtimeId, jump.damage, false, opts.shooterId, opts.sourceId, visualContext, { damageKind: 'chain' });
          if (opts.adrenalinGain > 0) this.resourceSystem?.addAdrenaline(opts.shooterId, opts.adrenalinGain);
        } else if (jump.target.kind === 'player') {
          opts.visitedPlayers.add(runtimeId);
          const canDeal = this.canDamageTarget(opts.shooterId, runtimeId);
          if (!(canDeal && this.shouldBlockWithShield(runtimeId, 'hitscan', jump.damage, jump.originX, jump.originY))) {
            this.applyDamage(runtimeId, jump.damage, false, opts.shooterId, opts.sourceId, visualContext, { damageKind: 'chain' });
            if (canDeal && opts.adrenalinGain > 0) this.resourceSystem?.addAdrenaline(opts.shooterId, opts.adrenalinGain);
          }
        } else if (jump.target.kind === 'decoy') {
          const decoyId = Number(runtimeId);
          opts.visitedDecoys.add(decoyId);
          this.decoySystem?.applyDamage(decoyId, jump.damage, opts.shooterId, opts.sourceId, visualContext);
          if (opts.adrenalinGain > 0) this.resourceSystem?.addAdrenaline(opts.shooterId, opts.adrenalinGain);
        } else {
          // Detonierbares Ziel (z.B. ASMD-Ball) → Detonation auslösen; Projektil wird zerstört.
          this.detonationSystem?.detonateProjectile(Number(runtimeId), opts.shooterId);
        }
      },
    });
  }
  /**
   * Sichtlinie für Kettenblitz-Sprünge: blockiert durch Felsen, Baumstämme,
   * Basen und den Zug – analog zur normalen Hitscan-/Projektil-Hindernislogik.
   */
  private hasChainLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    this.chainScanLine.setTo(x1, y1, x2, y2);
    const dist = Phaser.Geom.Line.Length(this.chainScanLine);
    if (dist <= 0.0001) return true;
    const blockerDistance = this.findNearestProjectilePathBlockerDistance(this.chainScanLine);
    return blockerDistance === null || blockerDistance >= dist - 1;
  }

  /**
   * Prüft, ob der Hitscan-Endpunkt einen Fels oder Zug trifft, und wendet Schaden an.
   */
  private applyHitscanObjectDamage(
    startX: number, startY: number, endX: number, endY: number,
    damage: number, rockMult: number, trainMult: number, shooterId: string,
    sourceSlot?: WeaponSlot,
    baseDamageMult = 1,
  ): void {
    const hitLine = new Phaser.Geom.Line(startX, startY, endX, endY);
    const endDist = Phaser.Geom.Line.Length(hitLine);
    const EPSILON = 2; // Toleranz in px

    // Nächsten Fels am Endpunkt suchen
    if (rockMult !== 0 && this.rockObjects && this.onRockDamage) {
      let bestRockIdx = -1;
      let bestRockDist = Infinity;
      this.obstacleIndex.querySegment(
        startX, startY, endX, endY,
        (kind, rockIndex, left, top, right, bottom) => {
          if (kind !== OBSTACLE_ROCK) return false;
          const hit = this.findNearestRectangleHit(hitLine, this.obstacleRect(left, top, right, bottom));
          if (hit && Math.abs(hit.distance - endDist) < EPSILON && hit.distance < bestRockDist) {
            bestRockDist = hit.distance;
            bestRockIdx = rockIndex;
          }
          return false;
        },
        IGNORE_CIRCLE_OBSTACLES,
      );
      if (bestRockIdx >= 0) {
        this.onRockDamage(bestRockIdx, damage * rockMult, shooterId);
        return; // Fels blockiert – kein Zug dahinter
      }
    }

    // Feindliche Basis am Endpunkt: dieselbe Reihenfolge wie bei Felsen und Zug, damit ein
    // getroffenes Hindernis den Schuss beendet.
    if (this.baseManager && !this.enemyManager?.hasEnemy(shooterId)) {
      const baseId = this.baseManager.getBaseIdAtWorldPoint(endX, endY);
      const base = baseId ? this.baseManager.getBase(baseId) : undefined;
      if (base && base.faction === 'hostile' && !(base.isInert?.() ?? false) && base.getHp() > 0) {
        this.applyBaseDamage(base.id, damage, shooterId, sourceSlot, baseDamageMult);
        return;
      }
    }

    // Zug-Bounding-Box am Endpunkt suchen (gesamter Zug als ein Block, keine Lücken)
    if (trainMult !== 0 && this.trainSegObjects && this.onTrainDamage) {
      const trainBounds = this.computeTrainBounds();
      if (trainBounds) {
        const hit = this.findNearestRectangleHit(hitLine, trainBounds);
        if (hit && Math.abs(hit.distance - endDist) < EPSILON) {
          this.onTrainDamage(damage * trainMult, shooterId);
        }
      }
    }
  }

  // collectReplicatedHitscanTraces entfernt – Traces werden per RPC gesendet

  // ── Melee-Angriff ─────────────────────────────────────────────────────────

  /**
   * Löst einen Melee-Angriff aus.
   * Trifft ALLE Gegner, die sich im Trefferbereich befinden (Fächerform).
   * Hindernisse (Felsen, Baumstämme) blockieren den Angriff auf dahinter stehende Ziele.
   * Gibt true zurück wenn der Angriff verarbeitet wurde (Host-only).
   */
  private resolveMeleeSwingAtHostTime(
    shooterId:     string,
    x:             number,
    y:             number,
    angle:         number,
    range:         number,
    arcDegrees:    number,
    damage:        number,
    adrenalinGain: number,
    sourceId:    string,
    playerColor:   number,
    sourceSlot?:   WeaponSlot,
    rockDamageMult  = 1,
    trainDamageMult = 1,
    visualPreset: MeleeVisualPreset = 'default',
    shotAudioKey?: string,
    burnOnHit?: BurnOnHitConfig,
    chain?: { count: number; radius: number; damageFactor: number },
    hitHeal = 0,
    hitAdrenaline = 0,
    bloodEffectMultiplier = 1,
    damageTargets?: readonly MeleeDamageTarget[],
    baseDamageMult = 1,
  ): boolean {
    if (!this.bridge.isHost()) return false;

    const halfArcRad = (arcDegrees * Math.PI / 180) / 2;
    let hitPlayer = false;
    let nearestHitDistance = Number.POSITIVE_INFINITY;
    let impactX: number | undefined;
    let impactY: number | undefined;
    const meleeHitIds = new Set<string>();
    const damageTargetSet = damageTargets ? new Set<MeleeDamageTarget>(damageTargets) : null;
    const canDamageKind = (kind: MeleeDamageTarget): boolean => damageTargetSet?.has(kind) ?? true;

    for (const player of canDamageKind('players') ? this.playerManager.getAllPlayers() : []) {
      if (!this.isMeleeTargetCandidate(player.id, shooterId)) continue;

      const dx   = player.x - x;
      const dy   = player.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Reichweite – Spieler-Radius als Toleranz hinzurechnen
      if (dist > range + PLAYER_SIZE * 0.5) continue;

      // Winkelprüfung: liegt das Ziel innerhalb des Trefferbogens?
      if (!CombatGeometry.isWithinArc(dx, dy, angle, halfArcRad)) continue;

      // Hindernischeck: liegt ein Fels/Stamm zwischen Schütze und Ziel?
      this.meleeLine.setTo(x, y, player.x, player.y);
      if (this.isMeleePathBlocked(dist - PLAYER_SIZE * 0.5)) continue;

      const loadoutMult  = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, this.hostFrameNowMs) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId, this.hostFrameNowMs) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      const canDealDamage = this.canDamageTarget(shooterId, player.id);
      if (canDealDamage && this.shouldBlockWithShield(player.id, 'melee', actualDamage, x, y)) continue;
      this.applyDamage(player.id, actualDamage, false, shooterId, sourceId, {
        sourceX: x,
        sourceY: y,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      }, { sourceSlot, damageKind: 'direct' });
      this.applyBurnOnHit(player.id, shooterId, burnOnHit, sourceId);
      meleeHitIds.add(player.id);
      hitPlayer = true;
      if (dist < nearestHitDistance) {
        nearestHitDistance = dist;
        impactX = player.x;
        impactY = player.y;
      }

      if (canDealDamage && adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
      if (canDealDamage) this.applyMeleeHitRewards(shooterId, hitHeal, hitAdrenaline);
    }

    for (const enemy of canDamageKind('enemies') ? (this.enemyManager?.getAllEnemies() ?? []) : []) {
      if (enemy.id === shooterId) continue;

      const enemyRadius = Math.max(enemy.sprite.displayWidth, enemy.sprite.displayHeight) * 0.5;
      const dx   = enemy.sprite.x - x;
      const dy   = enemy.sprite.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > range + enemyRadius) continue;

      if (!CombatGeometry.isWithinArc(dx, dy, angle, halfArcRad)) continue;

      this.meleeLine.setTo(x, y, enemy.sprite.x, enemy.sprite.y);
      if (this.isMeleePathBlocked(dist - enemyRadius)) continue;

      const loadoutMult  = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, this.hostFrameNowMs) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId, this.hostFrameNowMs) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      this.applyDamage(enemy.id, actualDamage, false, shooterId, sourceId, {
        sourceX: x,
        sourceY: y,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      }, { sourceSlot, damageKind: 'direct' });
      this.applyBurnOnHit(enemy.id, shooterId, burnOnHit, sourceId);
      meleeHitIds.add(enemy.id);
      hitPlayer = true;
      if (dist < nearestHitDistance) {
        nearestHitDistance = dist;
        impactX = enemy.sprite.x;
        impactY = enemy.sprite.y;
      }

      if (adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
      this.applyMeleeHitRewards(shooterId, hitHeal, hitAdrenaline);
    }

    for (const decoy of canDamageKind('decoys') ? (this.decoySystem?.getHostTargets() ?? []) : []) {
      if (decoy.ownerId === shooterId) continue;

      const dx   = decoy.sprite.x - x;
      const dy   = decoy.sprite.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > range + PLAYER_SIZE * 0.5) continue;

      if (!CombatGeometry.isWithinArc(dx, dy, angle, halfArcRad)) continue;

      this.meleeLine.setTo(x, y, decoy.sprite.x, decoy.sprite.y);
      if (this.isMeleePathBlocked(dist - PLAYER_SIZE * 0.5)) continue;

      const loadoutMult  = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, this.hostFrameNowMs) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId, this.hostFrameNowMs) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      const outcome = this.decoySystem?.applyDamage(decoy.id, actualDamage, shooterId, sourceId, {
        sourceX: x,
        sourceY: y,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      }) ?? null;
      if (outcome?.kind !== 'damage-applied' || outcome.actualDamage <= 0) continue;

      hitPlayer = true;
      if (dist < nearestHitDistance) {
        nearestHitDistance = dist;
        impactX = decoy.sprite.x;
        impactY = decoy.sprite.y;
      }

      if (adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
    }

    if (
      chain
      && (canDamageKind('players') || canDamageKind('enemies'))
      && chain.count > 0
      && chain.radius > 0
      && impactX !== undefined
      && impactY !== undefined
    ) {
      let chainX = impactX;
      let chainY = impactY;
      let chainDamage = damage;
      for (let jump = 0; jump < chain.count; jump += 1) {
        let next: { id: string; x: number; y: number } | null = null;
        let best = chain.radius;
        const candidates = [
          ...(canDamageKind('players')
            ? this.playerManager.getAllPlayers().map(player => ({ id: player.id, x: player.x, y: player.y }))
            : []),
          ...(canDamageKind('enemies')
            ? (this.enemyManager?.getAllEnemies() ?? []).map(enemy => ({ id: enemy.id, x: enemy.sprite.x, y: enemy.sprite.y }))
            : []),
        ];
        for (const candidate of candidates) {
          if (candidate.id === shooterId || meleeHitIds.has(candidate.id) || !this.isAlive(candidate.id) || !this.canDamageTarget(shooterId, candidate.id)) continue;
          const distance = Phaser.Math.Distance.Between(chainX, chainY, candidate.x, candidate.y);
          if (distance > best) continue;
          best = distance;
          next = candidate;
        }
        if (!next) break;
        meleeHitIds.add(next.id);
        chainDamage *= chain.damageFactor;
        this.applyDamage(next.id, chainDamage, false, shooterId, sourceId, { sourceX: chainX, sourceY: chainY }, { damageKind: 'chain' });
        chainX = next.x;
        chainY = next.y;
      }
    }

    if (canDamageKind('bases')) {
      const baseHit = this.applyMeleeBaseDamage(
        x,
        y,
        angle,
        range,
        halfArcRad,
        damage,
        shooterId,
        sourceId,
        sourceSlot,
        baseDamageMult,
      );
      if (baseHit.hit && baseHit.distance < nearestHitDistance) {
        nearestHitDistance = baseHit.distance;
        impactX = baseHit.impactX;
        impactY = baseHit.impactY;
      }
    }

    // Melee-Objektschaden: Felsen und Zug im Trefferbogen prüfen
    this.applyMeleeObjectDamage(
      x,
      y,
      angle,
      range,
      halfArcRad,
      damage,
      canDamageKind('rocks') ? rockDamageMult : 0,
      canDamageKind('train') ? trainDamageMult : 0,
      shooterId,
    );

    // Swing-VFX für alle Clients in die Replikations-Queue einreihen
    this.queueMeleeSwing({ x, y, angle, arcDegrees, range, color: playerColor, shooterId, visualPreset, hitPlayer, impactX, impactY, bloodEffectMultiplier, shotAudioKey });
    return true;
  }

  // collectReplicatedMeleeSwings entfernt – Swings werden per RPC gesendet

  private applyMeleeHitRewards(shooterId: string, hitHeal: number, hitAdrenaline: number): void {
    if (hitHeal > 0) this.heal(shooterId, hitHeal);
    if (hitAdrenaline > 0) this.resourceSystem?.addAdrenaline(shooterId, hitAdrenaline);
  }

  /**
   * Prüft, ob Felsen oder Zug-Segmente im Melee-Trefferbogen liegen, und wendet Schaden an.
   */
  private applyMeleeObjectDamage(
    x: number, y: number, angle: number, range: number, halfArcRad: number,
    damage: number, rockMult: number, trainMult: number, shooterId: string,
  ): void {
    // Felsschaden
    if (rockMult !== 0 && this.rockObjects && this.onRockDamage) {
      for (let i = 0; i < this.rockObjects.length; i++) {
        const rock = this.rockObjects[i];
        if (!rock?.active) continue;
        const dx   = rock.x - x;
        const dy   = rock.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > range) continue;
        let ad = Math.atan2(dy, dx) - angle;
        while (ad >  Math.PI) ad -= 2 * Math.PI;
        while (ad < -Math.PI) ad += 2 * Math.PI;
        if (Math.abs(ad) > halfArcRad) continue;
        this.onRockDamage(i, damage * rockMult, shooterId);
      }
    }

    // Zugschaden
    if (trainMult !== 0 && this.trainSegObjects && this.onTrainDamage) {
      for (const seg of this.trainSegObjects) {
        if (!seg.active) continue;
        const closestX = Phaser.Math.Clamp(x, seg.x - seg.displayWidth * 0.5, seg.x + seg.displayWidth * 0.5);
        const closestY = Phaser.Math.Clamp(y, seg.y - seg.displayHeight * 0.5, seg.y + seg.displayHeight * 0.5);
        const dx   = closestX - x;
        const dy   = closestY - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > range) continue;
        let ad = Math.atan2(dy, dx) - angle;
        while (ad >  Math.PI) ad -= 2 * Math.PI;
        while (ad < -Math.PI) ad += 2 * Math.PI;
        if (Math.abs(ad) > halfArcRad) continue;
        this.onTrainDamage(damage * trainMult, shooterId);
        break; // Nur einmal pro Swing den Zug treffen
      }
    }
  }

  /**
   * Host-only: Basisschaden ueber den gemeinsamen Trichter. Ohne verdrahteten Callback faellt es
   * auf den direkten Weg zurueck, damit ein fehlendes Setup keinen Schaden verschluckt.
   */
  private applyBaseDamageAtHostTime(
    baseId: string,
    damage: number,
    attackerId: string,
    sourceSlot?: LoadoutSlot,
    baseDamageMult = 1,
  ): void {
    if (!this.bridge.isHost() || !Number.isFinite(damage) || !Number.isFinite(baseDamageMult) || damage <= 0 || baseDamageMult <= 0) return;
    const runtimeDamage = damage * baseDamageMult
      * this.getPlayerRuntimeDamageMultiplier(attackerId, sourceSlot);
    const resolvedDamage = this.resolveLegacyWorldModifiers(
      { targetType: 'base', targetId: baseId }, runtimeDamage, attackerId, sourceSlot, true,
    );
    if (resolvedDamage <= 0) return;
    if (this.baseDamageCallback) this.baseDamageCallback(baseId, resolvedDamage, attackerId, sourceSlot);
    else this.baseManager?.applyDamage(baseId, resolvedDamage);
  }

  /**
   * Wendet ausgehenden und zielseitigen Schaden auf eine hostautoritäre Struktur an, ohne
   * den konkreten Lifecycle des Objekts in den CombatSystem zu ziehen. Der Aufrufer entscheidet
   * anschliessend, ob es ein Fels, Konstrukt, Aussenposten oder eine andere Struktur war.
   */
  private resolveExternalTargetDamageAtHostTime(
    target: TargetStatusTarget,
    damage: number,
    attackerId: string,
    sourceSlot?: LoadoutSlot,
  ): number {
    return this.resolveLegacyWorldModifiers(target, damage, attackerId, sourceSlot, false);
  }

  private resolveLegacyWorldModifiers(
    target: TargetStatusTarget, amount: number, attackerId: string,
    sourceSlot: LoadoutSlot | undefined, allowCritical: boolean,
  ): number {
    if (!this.bridge.isHost()) return 0;
    return resolveCombatDamageModifiers({
      amount, sourceFactors: [], allowCritical, nowMs: this.hostFrameNowMs, random: this.hostRandom,
      outgoing: (value, critical, nowMs, random) => this.playerOutgoingDamageResolver?.(
        attackerId, `${target.targetType}:${target.targetId}`, value, critical, sourceSlot, nowMs, random,
      ) ?? { amount: value, isCritical: false },
      incoming: nowMs => this.targetIncomingDamageMultiplierResolver?.(target, nowMs) ?? 1,
    })?.amount ?? 0;
  }

  /**
   * Radialschaden auf feindliche Basen. Nur Spieler-Quellen treffen hier; Zombie-Luftangriffe
   * laufen weiter ueber ihren eigenen, auf eigene Basen begrenzten Pfad.
   */
  private applyRadialHostileBaseDamageAtHostTime(
    x: number,
    y: number,
    radius: number,
    maxDamage: number,
    attackerId: string | undefined,
    falloff?: RadialDamageFalloffConfig,
    sourceSlot?: LoadoutSlot,
    baseDamageMult = 1,
  ): void {
    if (!attackerId || radius <= 0 || maxDamage <= 0) return;
    if (this.enemyManager?.hasEnemy(attackerId)) return;

    for (const base of this.baseManager?.getBasesByFaction('hostile') ?? []) {
      if ((base.isInert?.() ?? false) || base.getHp() <= 0) continue;
      const surface = base.getNearestSurfacePoint(x, y);
      if (!surface || surface.distance > radius) continue;
      const damage = computeRadialDamage(surface.distance, radius, maxDamage, falloff);
      this.applyBaseDamage(base.id, damage, attackerId, sourceSlot, baseDamageMult);
    }
  }

  private applyMeleeBaseDamage(
    x: number,
    y: number,
    angle: number,
    range: number,
    halfArcRad: number,
    damage: number,
    shooterId: string,
    sourceId: string,
    sourceSlot?: WeaponSlot,
    baseDamageMult = 1,
  ): { hit: boolean; distance: number; impactX?: number; impactY?: number } {
    let hit = false;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let impactX: number | undefined;
    let impactY: number | undefined;

    // Gegner schlagen ausschliesslich auf eigene Basen ein, Spieler ausschliesslich auf
    // feindliche. Damit bleibt das bisherige Verhalten unveraendert und niemand kann die
    // Basis der eigenen Seite beschaedigen.
    const shooterIsEnemy = this.enemyManager?.hasEnemy(shooterId) === true;
    const targetFaction = shooterIsEnemy ? 'friendly' : 'hostile';

    for (const base of this.baseManager?.getBasesByFaction(targetFaction) ?? []) {
      if ((base.isInert?.() ?? false) || base.getHp() <= 0) continue;

      const surface = base.getNearestSurfacePoint(x, y);
      if (!surface) continue;
      const targetX = surface.x;
      const targetY = surface.y;
      const dx = targetX - x;
      const dy = targetY - y;
      const dist = surface.distance;

      if (dist > range) continue;

      if (!CombatGeometry.isWithinArc(dx, dy, angle, halfArcRad)) continue;

      this.meleeLine.setTo(x, y, targetX, targetY);
      if (this.isMeleePathBlocked(Math.max(0, dist - 0.5))) continue;

      const actualDamage = damage * baseDamageMult;
      // Energie-Kuppel: schützt die getroffene Basisstelle, wenn sie in einer Kuppel liegt.
      // Nur eigene Basen – eine Spielerkuppel darf die Gegnerbasis nicht abschirmen.
      if (
        base.faction === 'friendly'
        && this.energyShieldSystem?.tryDomeProtect(targetX, targetY, null, actualDamage, this.hostFrameNowMs)
      ) {
        hit = true;
        continue;
      }
      this.applyBaseDamage(base.id, damage, shooterId, sourceSlot, baseDamageMult);
      hit = true;

      if (dist < nearestDistance) {
        nearestDistance = dist;
        impactX = targetX;
        impactY = targetY;
      }
    }

    return { hit, distance: nearestDistance, impactX, impactY };
  }

  traceHitscan(options: HitscanTraceOptions): HitscanTraceResult {
    const { shooterId, startX, startY, angle, range, traceThickness, applyFavorTheShooter, includeShooter = false } = options;

    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const maxEndX = startX + dirX * range;
    const maxEndY = startY + dirY * range;
    this.hitscanLine.setTo(startX, startY, maxEndX, maxEndY);

    let closestDistance = Phaser.Geom.Line.Length(this.hitscanLine);
    const obstacleHit = this.findNearestObstacleHit(this.hitscanLine);
    if (obstacleHit) closestDistance = obstacleHit.distance;

    let hitPlayerId: string | null = null;
    let hitEnemyId: string | null = null;
    let hitDecoyId: number | null = null;
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isHitscanTargetCandidate(player.id, shooterId, includeShooter)) continue;

      const hitDistance = this.getHitscanTargetHitDistance(
        this.hitscanLine,
        { x: player.x, y: player.y, hitRadius: player.getHitRadius(), body: player.body },
        traceThickness,
        // Support-Hitscans duerfen den Schuetzen als Heilziel einbeziehen. Seine eigene
        // Lag-Kompensation darf die Trefferkapsel beim Rueckwaertslaufen jedoch nicht vor
        // die Muendung zurueckspulen und den Strahl nach wenigen Pixeln abschneiden.
        applyFavorTheShooter && player.id !== shooterId,
      );
      if (hitDistance === null || hitDistance > closestDistance) continue;

      closestDistance = hitDistance;
      hitPlayerId = player.id;
      hitEnemyId = null;
      hitDecoyId = null;
    }

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      if (enemy.id === shooterId) continue;
      if (!this.canDamageTarget(shooterId, enemy.id)) continue;

      const hitDistance = this.getHitscanTargetHitDistance(
        this.hitscanLine,
        toSpriteHitscanTarget(enemy.sprite),
        traceThickness,
        applyFavorTheShooter,
      );
      if (hitDistance === null || hitDistance > closestDistance) continue;

      closestDistance = hitDistance;
      hitPlayerId = null;
      hitEnemyId = enemy.id;
      hitDecoyId = null;
    }

    for (const decoy of this.decoySystem?.getHostTargets() ?? []) {
      if (decoy.ownerId === shooterId) continue;

      const hitDistance = this.getHitscanTargetHitDistance(
        this.hitscanLine,
        toSpriteHitscanTarget(decoy.sprite),
        traceThickness,
        applyFavorTheShooter,
      );
      if (hitDistance === null || hitDistance > closestDistance) continue;

      closestDistance = hitDistance;
      hitPlayerId = null;
      hitEnemyId = null;
      hitDecoyId = decoy.id;
    }

    const hitObstacle = obstacleHit !== null && closestDistance >= obstacleHit.distance;
    return {
      endX: startX + dirX * closestDistance,
      endY: startY + dirY * closestDistance,
      distance: closestDistance,
      hitPlayerId,
      hitEnemyId,
      hitDecoyId,
      hitObstacle,
      hitObstacleKind: hitObstacle ? obstacleHit?.kind : undefined,
      hitObstacleIndex: hitObstacle ? obstacleHit?.index : undefined,
    };
  }

  // ── LoS-Check (für BFG-Laser) ──────────────────────────────────────────────

  /**
   * Prüft, ob eine direkte Sichtlinie zwischen zwei Punkten besteht.
   * Felsen, Baumstämme und Basen blockieren die Sichtlinie; Basen können für Quellen
   * oberhalb ihrer eigenen Fläche gezielt ausgenommen werden.
   */
  hasLineOfSight(
    startX: number, startY: number,
    endX: number, endY: number,
    skipRockIndex?: number,
    ignoreBaseObstacles = false,
    // Optional corridor radius for bodies such as the translocator puck.
    clearanceRadius = 0,
  ): boolean {
    // Heißester Pfad des Host-Frames (zielsuchende Projektile prüfen pro Kandidat eine
    // Sichtlinie), deshalb über den Hindernis-Index statt über alle Felsen der Karte.
    return this.geometry.hasLineOfSight(startX, startY, endX, endY, {
      skipRockIndex,
      ignoreBases: ignoreBaseObstacles,
      clearanceRadius,
    });
  }

  /**
   * Freie **Schusslinie** zwischen zwei Punkten: die statische Sichtlinie plus alle beweglichen
   * physischen Blocker – zurzeit ausschließlich der Zug.
   *
   * Abgrenzung zu {@link hasLineOfSight}: dort geht es um echtes Sehen (Zielerfassung aus der
   * Ferne, Spawn-Bewertung, Wegewahl), hier um die Frage, ob ein Schuss oder Wurf das Ziel
   * tatsächlich erreichen kann. Jede Entscheidung, die ein Projektil oder einen Hitscan auslöst,
   * gehört deshalb hierher; ein Ziel hinter dem Zug ist sichtbar, aber nicht beschießbar.
   *
   * Der Zug selbst wird über diese Prüfung nicht anvisiert: wer ihn angreifen will, fragt weiter
   * die Sichtlinie ab, sonst würde er sich selbst verdecken.
   */
  hasClearLineOfFire(
    startX: number, startY: number,
    endX: number, endY: number,
    options: LineOfFireOptions = {},
  ): boolean {
    const { skipRockIndex, ignoreBaseObstacles = false, clearanceRadius = 0 } = options;
    if (!this.hasLineOfSight(startX, startY, endX, endY, skipRockIndex, ignoreBaseObstacles, clearanceRadius)) {
      return false;
    }
    return !this.isDynamicBlockerOnPath(startX, startY, endX, endY, clearanceRadius);
  }

  /**
   * Liegt ein beweglicher physischer Blocker auf dem Segment? Der Zug ist der einzige solche
   * Körper und wird über dieselben Bounds gelesen wie beim Hitscan – es gibt keine zweite
   * Zug-Geometrie.
   */
  private isDynamicBlockerOnPath(
    startX: number, startY: number,
    endX: number, endY: number,
    clearanceRadius: number,
  ): boolean {
    const trainBounds = this.computeTrainBounds();
    if (!trainBounds) return false;

    const line = this.lineOfFireLine.setTo(startX, startY, endX, endY);
    // Dieselbe 2-px-Toleranz wie in CombatGeometry.hasLineOfSight: ein Körper direkt hinter dem
    // Ziel sperrt die Linie nicht.
    const blockDistance = Phaser.Geom.Line.Length(line) - 2;
    if (blockDistance <= 0) return false;

    const clearance = Math.max(0, clearanceRadius);
    const rect = this.scratchLineOfFireRect.setTo(
      trainBounds.x - clearance,
      trainBounds.y - clearance,
      trainBounds.width + clearance * 2,
      trainBounds.height + clearance * 2,
    );
    const hit = this.findNearestRectangleHit(line, rect);
    return hit !== null && hit.distance < blockDistance;
  }

  // ── Privat: Treffer, Tod, Respawn ──────────────────────────────────────────

  private queueHitscanTrace(trace: SyncedHitscanTrace): void {
    // Direkt per RPC an alle Clients senden (einmalig, statt per-frame in GameState)
    this.bridge.broadcastHitscanTracer(
      trace.startX, trace.startY, trace.endX, trace.endY,
      trace.color, trace.thickness, trace.impactKind, trace.visualPreset, trace.shooterId, trace.shotId, trace.shotAudioKey,
      trace.visualStartX, trace.visualStartY,
    );
    // Lokale Wiedergabe auf dem Host (EffectSystem bekommt das RPC auch)
  }

  private queueMeleeSwing(swing: Omit<SyncedMeleeSwing, 'swingId'>): void {
    const fullSwing: SyncedMeleeSwing = { ...swing, swingId: ++this.meleeSwingIdCounter };
    // Direkt per RPC an alle Clients senden
    this.bridge.broadcastMeleeSwing(fullSwing);
  }

  /**
   * Prüft, ob ein Hindernis (Fels oder Baumstamm) die aktuelle meleeLine
   * vor der angegebenen Distanz blockiert (Arena-Außenwände werden ignoriert,
   * da Ziele immer innerhalb der Arena stehen).
   */
  private isMeleePathBlocked(maxDist: number): boolean {
    return this.geometry.isPathBlocked(this.meleeLine, maxDist);
  }

  private isMeleeTargetCandidate(playerId: string, shooterId: string): boolean {
    if (playerId === shooterId) return false;
    if (!this.isAlive(playerId)) return false;
    if (this.burrowSystem?.isBurrowed(playerId)) return false;
    return true;
  }

  private isHitscanTargetCandidate(playerId: string, shooterId: string, includeShooter = false): boolean {
    if (playerId === shooterId && !includeShooter) return false;
    if (!this.isHitscanTargetAlive(playerId)) return false;
    if (this.isHitscanTargetBurrowed(playerId)) return false;
    return true;
  }

  private isHitscanTargetAlive(playerId: string): boolean {
    if (this.bridge.isHost()) return this.isAlive(playerId);
    return this.bridge.getLatestGameState()?.players[playerId]?.alive ?? true;
  }

  private isHitscanTargetBurrowed(playerId: string): boolean {
    if (this.burrowSystem) return this.burrowSystem.isBurrowed(playerId);
    return this.bridge.getLatestGameState()?.players[playerId]?.isBurrowed ?? false;
  }

  private getHitscanTargetHitDistance(
    line: Phaser.Geom.Line,
    target: HitscanTarget,
    traceThickness: number,
    applyFavorTheShooter: boolean,
  ): number | null {
    if (applyFavorTheShooter) {
      return this.getFavorTheShooterHitDistance(line, target, traceThickness);
    }

    const baseRadius = target.hitRadius + traceThickness * 0.5;
    return this.findNearestCircleHit(line, target.x, target.y, baseRadius)?.distance ?? null;
  }

  private findNearestObstacleHit(
    line: Phaser.Geom.Line,
  ): (GeometryHit & { kind: HitscanObstacleKind; index?: number }) | null {
    // Arena-Außenwand und Zug sind Gameplay-Sonderkörper und stehen deshalb nicht im
    // gemeinsamen Hindernis-Kern; sie werden hier gegen dessen Ergebnis verglichen.
    const arenaHit = this.findNearestRectangleHit(line, this.arenaBounds);
    let bestHit: (GeometryHit & { kind: HitscanObstacleKind; index?: number }) | null = arenaHit
      ? { ...arenaHit, kind: 'arena' }
      : null;

    const obstacleHit = this.geometry.nearestObstacleHit(line);
    if (obstacleHit && (!bestHit || obstacleHit.distance < bestHit.distance)) bestHit = obstacleHit;

    const trainBounds = this.computeTrainBounds();
    if (trainBounds) {
      const hit = this.findNearestRectangleHit(line, trainBounds);
      if (hit && (!bestHit || hit.distance < bestHit.distance)) bestHit = { ...hit, kind: 'train' };
    }

    return bestHit;
  }

  private getFavorTheShooterHitDistance(
    line: Phaser.Geom.Line,
    target: HitscanTarget,
    traceThickness: number,
  ): number | null {
    const baseRadius = target.hitRadius + traceThickness * 0.5;
    const velocity = target.body?.velocity ?? { x: 0, y: 0 };
    return this.geometry.sweptCircleHitDistance(
      line,
      target.x, target.y,
      velocity.x, velocity.y,
      baseRadius,
      HITSCAN_FAVOR_THE_SHOOTER_MS,
      HITSCAN_FAVOR_THE_SHOOTER_MAX_OFFSET,
    );
  }

  /**
   * Berechnet die kombinierte Bounding-Box aller aktiven Zug-Segmente.
   * Behandelt den gesamten Zug (inkl. Lücken) als ein zusammenhängendes Hindernis.
   * Gibt null zurück wenn kein aktives Segment vorhanden.
   *
   * Maßgeblich ist der Static-Body: der `TrainManager` schaltet ihn beim Verlassen der Arena und
   * bei der Zerstörung ab, während die Rechtecke selbst bis zum Rundenende bestehen bleiben. Ohne
   * diese Prüfung bliebe ein zerstörter Zug als unsichtbarer Blocker auf dem Gleis stehen.
   *
   * Die Kanten werden wie im `TrainManager` direkt aus Position und Anzeigemaß gerechnet statt über
   * `getBounds()`: die Schusslinienprüfung läuft in den Ziel-Schleifen des Host-Frames, und
   * `getBounds()` legt pro Segment ein neues Rechteck an.
   */
  private computeTrainBounds(): Phaser.Geom.Rectangle | null {
    if (!this.trainSegObjects || this.trainSegObjects.length === 0) return this.clientTrainBounds;
    let minY = Infinity, maxY = -Infinity;
    let trainX = 0, trainW = 0;
    let anyActive = false;
    for (const seg of this.trainSegObjects) {
      if (!seg.active) continue;
      const body = seg.body as Phaser.Physics.Arcade.StaticBody | null;
      if (body && !body.enable) continue;
      anyActive = true;
      const halfWidth = seg.displayWidth * 0.5;
      const halfHeight = seg.displayHeight * 0.5;
      if (seg.y - halfHeight < minY) minY = seg.y - halfHeight;
      if (seg.y + halfHeight > maxY) maxY = seg.y + halfHeight;
      trainX = seg.x - halfWidth;
      trainW = seg.displayWidth;
    }
    if (!anyActive) return null;
    return this.scratchTrainRect.setTo(trainX, minY, trainW, maxY - minY);
  }

  private findNearestRectangleHit(
    line: Phaser.Geom.Line,
    rect: Phaser.Geom.Rectangle,
  ): GeometryHit | null {
    return this.geometry.nearestRectangleHit(line, rect);
  }

  /** Übernimmt die vom Hindernis-Index gelieferten Kanten in das Scratch-Rechteck. */
  private obstacleRect(left: number, top: number, right: number, bottom: number): Phaser.Geom.Rectangle {
    return this.geometry.obstacleRect(left, top, right, bottom);
  }

  private findNearestCircleHit(
    line: Phaser.Geom.Line,
    centerX: number,
    centerY: number,
    radius: number,
  ): GeometryHit | null {
    return this.geometry.nearestCircleHit(line, centerX, centerY, radius);
  }

  private nextEffectSeed(): number {
    const seed = Math.imul(this.effectSeedCounter++, 0x9e3779b1);
    return seed >>> 0;
  }

  private buildHitEffect(
    targetId: string,
    x: number,
    y: number,
    attackerId: string | undefined,
    totalDamage: number,
    hpLost: number,
    armorLost: number,
    isKill: boolean,
    visualContext: DamageVisualContext | undefined,
    seed: number,
    isCritical = false,
  ): SyncedHitEffect {
    const target = this.playerManager.getPlayer(targetId);
    const direction = this.resolveDamageDirection(targetId, attackerId, visualContext, seed, x, y);

    return {
      type: 'hit',
      x,
      y,
      targetId,
      shooterId: attackerId,
      targetColor: target?.color,
      totalDamage,
      hpLost,
      armorLost,
      isKill,
      isCritical,
      dirX: direction.dirX,
      dirY: direction.dirY,
      seed,
    };
  }

  private buildDeathEffect(
    playerId: string,
    x: number,
    y: number,
    seed: number,
    direction?: { dirX: number; dirY: number },
  ): SyncedDeathEffect {
    const player = this.playerManager.getPlayer(playerId);
    const visual = player?.getDeathVisual();
    const textureKey = visual?.textureKey;
    const frame = visual?.frame;
    return {
      type: 'death',
      x,
      y,
      targetId: playerId,
      targetColor: player?.color,
      rotation: visual?.rotation ?? 0,
      seed,
      ...(textureKey && frame != null ? {
        textureKey,
        frame,
        displayWidth: visual!.displayWidth,
        displayHeight: visual!.displayHeight,
        tint: visual!.tint,
      } : {}),
      ...(direction ? { dirX: direction.dirX, dirY: direction.dirY } : {}),
    };
  }

  private resolveDamageDirection(
    targetId: string,
    attackerId: string | undefined,
    visualContext: DamageVisualContext | undefined,
    seed: number,
    targetX: number,
    targetY: number,
  ): { dirX: number; dirY: number } {
    let dirX = visualContext?.dirX ?? 0;
    let dirY = visualContext?.dirY ?? 0;

    if (Math.hypot(dirX, dirY) <= 0.0001 && visualContext?.sourceX !== undefined && visualContext?.sourceY !== undefined) {
      dirX = targetX - visualContext.sourceX;
      dirY = targetY - visualContext.sourceY;
    }

    if (Math.hypot(dirX, dirY) <= 0.0001 && attackerId) {
      const attacker = this.playerManager.getPlayer(attackerId);
      const enemyAttacker = this.enemyManager?.getEnemy(attackerId);
      if (attacker) {
        dirX = targetX - attacker.x;
        dirY = targetY - attacker.y;
      } else if (enemyAttacker) {
        dirX = targetX - enemyAttacker.sprite.x;
        dirY = targetY - enemyAttacker.sprite.y;
      }
    }

    const len = Math.hypot(dirX, dirY);
    if (len > 0.0001) {
      return { dirX: dirX / len, dirY: dirY / len };
    }

    return this.fallbackDamageDirection(targetX, targetY, seed);
  }

  private fallbackDamageDirection(targetX: number, targetY: number, seed: number): { dirX: number; dirY: number } {
    const centerX = this.arenaBounds.x + this.arenaBounds.width / 2;
    const centerY = this.arenaBounds.y + this.arenaBounds.height / 2;
    const baseAngle = Math.atan2(targetY - centerY, targetX - centerX);
    const jitterDeg = ((seed >>> 5) % 41) - 20;
    const angle = Number.isFinite(baseAngle)
      ? baseAngle + jitterDeg * (Math.PI / 180)
      : (seed % 360) * (Math.PI / 180);
    return { dirX: Math.cos(angle), dirY: Math.sin(angle) };
  }

  /** Setzt die zentrale Verwundbarkeit, wenn das treffende Projektil sie mitfuehrt. */
  private applyProjectileVulnerability(
    target: TargetStatusTarget,
    durationOrProjectile: number | undefined,
  ): void {
    const durationMs = durationOrProjectile ?? 0;
    if (durationMs > 0) this.onApplyVulnerability?.(target, durationMs, this.hostFrameNowMs);
  }

  private applyEnemyDamage(
    targetId: string,
    amount: number,
    attackerId?: string,
    sourceId?: string,
    visualContext?: DamageVisualContext,
    options?: DamageApplicationOptions,
  ): CombatDamageMutationOutcome | null {
    const enemy = this.enemyManager?.getEnemy(targetId);
    const target = this.enemyManager?.getCombatTargetRef(targetId);
    if (!enemy || !target || !this.enemyManager) return null;
    this.prepareAttributionTarget(target);
    const x = enemy.sprite.x;
    const y = enemy.sprite.y;
    const maxHp = enemy.getMaxHp();
    const isBoss = options?.damageKind === 'direct' && options.sourceSlot === 'weapon1' ? enemy.isBoss() : false;
    const targetFaction = enemy.faction;
    const worldCurrent = this.captureReactionValidity();
    const activeBurnSources = this.burnStatus.getActiveSources(target, this.hostFrameNowMs);
    const request = this.createDamageRequest(target, amount, attackerId, sourceId, options);
    const outcome = applyCombatDamage(request, this.combatResolutionContext(), this.enemyManager);
    if (outcome.kind !== 'damage-applied') return outcome;
    // Terminal consequences and passive observation belong to the committed receipt.
    // Immediate children additionally require the original live target incarnation.
    const current = worldCurrent;
    if (!current()) return outcome;
    const result = {
      died: outcome.transition.kind === 'dead',
      remainingHp: outcome.resultingState.kind === 'combatant' ? outcome.resultingState.hp : 0,
      death: outcome.transition.kind === 'dead'
        ? outcome.transition.facts.presentation as unknown as EnemyDeathInfo : undefined,
    };
    const isCritical = outcome.damage.isCritical;

    if (attackerId && attackerId !== targetId) {
      this.lastAttacker.set(targetId, attackerId);
      this.lastSource.set(targetId, outcome.source);
      if (sourceId) this.lastWeapon.set(targetId, sourceId);
      if (visualContext) this.lastKillSource.set(targetId, {
        dirX: visualContext.dirX,
        dirY: visualContext.dirY,
        projectileColor: visualContext.projectileColor,
        shotgunLightningGeneration: visualContext.shotgunLightningGeneration,
      });
      this.rememberDamageOrigin(targetId, options);
    }

    const hpLost = outcome.hpLost;
    const terminalSource = this.captureKillSource(targetId, outcome, result.death);
    const creditedSource = this.lastSource.get(targetId);
    const killerId = creditedSource?.attribution.id ?? this.lastAttacker.get(targetId);
    const killSourceId = this.lastWeapon.get(targetId) ?? sourceId ?? 'source.unknown';
    const hitSeed = this.nextEffectSeed();
    const direction = this.resolveDamageDirection(targetId, attackerId, visualContext, hitSeed, x, y);
    if (!options?.skipLifeLeech) this.applyLifeLeech(attackerId, targetId, hpLost);
    if (!current()) return outcome;

    // Trefferabhaengige Primaerwaffen-Affixe. Erst hier, damit sie nur bei einem Treffer
    // ausloesen, der tatsaechlich Schaden gemacht hat – und nach dem Schaden, damit ein
    // Debuff nicht rueckwirkend auf den ausloesenden Treffer wirkt.
    if (
      attackerId
      && !options?.skipLifeLeech
      && !result.died
      && options?.damageKind === 'direct'
      && options.sourceSlot === 'weapon1'
      && this.isCurrentCombatantTarget(target)
    ) {
      this.onDirectPrimaryHit?.(attackerId, targetId, result.remainingHp, maxHp, isBoss, target);
      if (!current()) return outcome;
    }

    this.bridge.broadcastEffect({
      type: 'hit',
      x,
      y,
      targetId,
      shooterId: attackerId,
      targetColor: COLORS.RED_2,
      totalDamage: hpLost,
      hpLost,
      armorLost: 0,
      isKill: result.died,
      isCritical,
      dirX: direction.dirX,
      dirY: direction.dirY,
      seed: hitSeed,
    });
    if (!current()) return outcome;

    if (result.died) {
      const deadTarget = outcome.target;
      this.movementStatus?.clearMovementStatus(deadTarget);
      this.plasmaSwarmMechanic?.clearTarget(deadTarget);
      this.burnStatus.clearBurn(deadTarget);
      this.enemyManager?.completeCombatDeath(outcome);
      if (!current()) return outcome;
      const suppressStandardDeathEffect = this.onEnemyDeathCb?.(
        targetId,
        x,
        y,
        activeBurnSources,
        result.death,
        deadTarget,
      ) === true;
      if (!current()) return outcome;
      if (!suppressStandardDeathEffect) {
        this.bridge.broadcastEffect({
          type: 'death',
          x,
          y,
          targetId,
          targetColor: COLORS.RED_2,
          rotation: result.death?.rotation ?? 0,
          seed: this.nextEffectSeed(),
          ...(result.death ? {
            textureKey: result.death.textureKey,
            frame: result.death.frame,
            displayWidth: result.death.displayWidth,
            displayHeight: result.death.displayHeight,
            tint: result.death.tint,
            dirX: direction.dirX,
            dirY: direction.dirY,
          } : {}),
        });
      }

      if (killerId && killerId !== targetId) {
        this.onKillCb?.(killerId, targetId, killSourceId, x, y, terminalSource);
        if (!current()) return outcome;
      }

      // Erst nach `onKillCb`/`onEnemyDeathCb` aufraeumen: Kill-Handler duerfen die Herkunft des
      // toedlichen Treffers noch lesen.
      const attributedTarget = this.attributionTargets.get(targetId);
      if (attributedTarget && isSameCombatTargetInstance(attributedTarget, outcome.target)) {
        this.clearAttribution(targetId);
      }
    }
    if (current()) this.notifyDamageDealt({
      targetType: 'enemy', targetId, attackerId: outcome.source.attribution.id,
      targetFaction, damage: hpLost, damageKind: request.damageKind,
      sourceSlot: request.source.sourceSlot, isCritical,
    });
    return outcome;
  }

  private captureKillSource(
    targetId: string, outcome: CombatDamageMutationOutcome, death?: EnemyDeathInfo,
  ): KillSourceContext {
    return Object.freeze({
      ...this.lastKillSource.get(targetId),
      provenance: this.lastSource.get(targetId) ?? outcome.source,
      damageOrigin: Object.freeze({ kind: outcome.kind === 'damage-applied' ? outcome.damage.damageKind : 'direct', slot: outcome.source.sourceSlot }),
      outcomeId: outcome.outcomeId,
      nowMs: this.hostFrameNowMs,
      victimKind: outcome.target.kind === 'player' ? 'player' : 'enemy',
      ...(death ? { enemyKind: death.kind, victimFaction: death.faction } : {}),
    });
  }

  private clearAttribution(id: string): void {
    this.lastSource.delete(id); this.attributionTargets.delete(id);
    this.lastAttacker.delete(id); this.lastWeapon.delete(id);
    this.lastKillSource.delete(id); this.lastDamageOrigin.delete(id);
  }

  private prepareAttributionTarget(target: CombatTargetRef): void {
    const id = String(target.id), previous = this.attributionTargets.get(id);
    if (previous && !isSameCombatTargetInstance(previous, target)) this.clearAttribution(id);
    this.attributionTargets.set(id, target);
  }

  private handleDeath(
    playerId: string,
    x: number,
    y: number,
    seed: number,
    direction?: { dirX: number; dirY: number },
    transitionCommitted = false,
    terminal?: { killerId?: string; weapon: string; source: KillSourceContext; effect: SyncedDeathEffect; target: CombatTargetRef },
  ): void {
    if (!transitionCommitted) {
      if (!this.isAlive(playerId) || !this.playerVitals.endCurrentLife(playerId)) return;
    }
    const worldCurrent = this.captureReactionValidity();
    const deadLife = terminal?.target ?? this.playerVitals.getTargetRef(playerId);
    const current = () => {
      const life = this.playerVitals.getTargetRef(playerId);
      return worldCurrent() && !!life && !!deadLife && isSameCombatTargetInstance(life, deadLife);
    };
    if (!current()) return;
    if (!transitionCommitted && deadLife) {
      this.onPlayerLifeEnded?.(deadLife);
      if (!current()) return;
    }
    this.clearBurnForPlayer(playerId);
    // Capture the current animation frame before any death callback hides or changes the Sprite.
    const deathEffect = terminal?.effect ?? this.buildDeathEffect(playerId, x, y, seed, direction);
    const killerId = terminal?.killerId ?? this.lastSource.get(playerId)?.attribution.id ?? this.lastAttacker.get(playerId);
    const weapon = terminal?.weapon ?? this.lastWeapon.get(playerId) ?? 'Waffe';
    const killSource = terminal?.source ?? this.lastKillSource.get(playerId);

    // Aktive Duration-Buffs (z.B. Adrenalinspritze) beim Tod entfernen
    this.powerUpSystem?.removePlayer(playerId);
    if (!current()) return;
    // Stinkwolke beim Tod sofort deaktivieren
    this.stinkCloudSystem?.hostDeactivateForPlayer(playerId);
    if (!current()) return;
    this.decoySystem?.clearPlayer(playerId);
    if (!current()) return;
    this.ak47Behavior?.resetPlayer(playerId);

    const player = this.playerManager.getPlayer(playerId);
    if (player) player.body.enable = false;

    this.onDeathCb?.(playerId, x, y);
    if (!current()) return;

    this.bridge.broadcastEffect(deathEffect);

    // Kill-Callback auslösen (Host-only, kein Selbstkill)
    if (killerId && killerId !== playerId) {
      this.onKillCb?.(killerId, playerId, weapon, x, y, killSource);
      if (!current()) return;
    }

    if (this.respawnAllowedResolver && !this.respawnAllowedResolver(playerId)) return;
    const life = this.playerVitals.getTargetRef(playerId);
    if (life) this.playerLife.schedule(life, this.hostFrameNowMs + RESPAWN_DELAY_MS);
  }

  /** Heilt den Spieler vollständig auf HP_MAX (nur wenn lebendig). */
  healToFull(playerId: string): number {
    if (!this.isAlive(playerId)) return 0;
    const current = this.getHP(playerId);
    this.heal(playerId, this.getMaxHp(playerId) - current);
    return this.getHP(playerId) - current;
  }

  heal(playerId: string, amount: number): number {
    if (!this.isAlive(playerId) || amount <= 0) return this.getHP(playerId);
    const target = this.playerVitals.getTargetRef(playerId);
    if (!target) return this.getHP(playerId);
    const outcome = this.applySupport({
      outcomeId: this.nextMutationOutcomeId('heal', playerId),
      target,
      source: this.createLegacyMutationSource(playerId, 'combat.heal', 'support'),
      supportKind: 'heal',
      amount,
    });
    if (outcome.kind === 'support-applied') this.onHealingReceived?.(playerId, outcome.actualAmount);
    return outcome.kind === 'rejected'
      ? this.getHP(playerId)
      : outcome.resultingState.kind === 'combatant' ? outcome.resultingState.hp : this.getHP(playerId);
  }

  /**
   * Merkt sich, woher der letzte Treffer auf dieses Ziel kam. Ohne Angabe gilt ein direkter
   * Treffer ohne bekannten Slot – dieselbe Vorgabe wie beim Lesen der Optionen.
   */
  private rememberDamageOrigin(targetId: string, options?: DamageApplicationOptions): void {
    this.lastDamageOrigin.set(targetId, {
      kind: options?.damageKind ?? 'direct',
      slot: options?.sourceSlot,
    });
  }

  /**
   * Herkunft des Treffers, der dieses Ziel zuletzt getroffen hat.
   *
   * Gemeint ist der Treffer, nicht der Schadensanteil: die Kill-Zuordnung folgt im ganzen
   * `CombatSystem` dem letzten Treffer, nicht der Schadensverteilung.
   */
  getLastDamageOrigin(targetId: string): { kind: CombatDamageKind; slot?: LoadoutSlot } | undefined {
    return this.lastDamageOrigin.get(targetId);
  }

  private applyLifeLeech(attackerId: string | undefined, targetId: string, actualDamage: number): void {
    if (!attackerId || attackerId === targetId || actualDamage <= 0) return;
    if (!this.playerManager.getPlayer(attackerId)) return;
    const fraction = Phaser.Math.Clamp(this.playerLifeLeechFractionResolver?.(attackerId) ?? 0, 0, 1);
    if (fraction <= 0) return;
    this.heal(attackerId, actualDamage * fraction);
  }

  addArmor(playerId: string, amount: number): number {
    if (!this.isAlive(playerId)) return this.getArmor(playerId);
    const target = this.playerVitals.getTargetRef(playerId);
    if (!target) return this.getArmor(playerId);
    const outcome = this.applySupport({
      outcomeId: this.nextMutationOutcomeId('armor', playerId),
      target,
      source: this.createLegacyMutationSource(playerId, 'combat.armor', 'support'),
      supportKind: amount >= 0 ? 'armor' : 'armor-loss',
      amount: Math.abs(amount),
    });
    if (outcome.kind === 'support-applied' && amount > 0) {
      this.onArmorReceived?.(playerId, outcome.actualAmount);
    }
    return outcome.kind === 'rejected'
      ? this.getArmor(playerId)
      : outcome.resultingState.kind === 'combatant' ? outcome.resultingState.armor : this.getArmor(playerId);
  }

  /** Transitional composition adapter; state and deadline ownership belong to this World's life owner. */
  private createPlayerLifeRuntime(vitals: PlayerVitalsOwner): PlayerLifeRuntime {
    return new PlayerLifeRuntime({
      readLife: (id) => {
        const target = vitals.getTargetRef(id);
        const state = target && vitals.readVitals(target);
        return target && state ? { target, alive: state.alive } : null;
      },
      canRespawn: (id) => this.respawnAllowedResolver?.(id) ?? true,
      consumeRespawn: (id) => this.onRespawnCb?.(id) !== false,
      commitVitals: (target) => !!vitals.commitRespawn(String(target.id), target.instance.lifeRevision ?? 0),
      prepareActor: (id) => {
        const player = this.playerManager.getPlayer(id);
        if (!player?.body) return null;
        const spawn = this.playerManager.getWorldSpawnPoint(id);
        if (!Number.isFinite(spawn.x) || !Number.isFinite(spawn.y)) return null;
        return {
          isCurrent: () => this.playerManager.getPlayer(id) === player,
          activate: () => {
            player.setPosition(spawn.x, spawn.y);
            player.body.enable = true;
          },
          publish: () => this.onAuthoritativePositionReset?.(id, spawn.x, spawn.y),
        };
      },
      resetLifeResources: (id) => {
        this.clearAttribution(id);
        this.clearBurnForPlayer(id);
        this.lastAttacker.delete(id);
        this.lastWeapon.delete(id);
        this.lastKillSource.delete(id);
        this.lastDamageOrigin.delete(id);
        this.resourceSystem?.resetAdrenalineForSpawn(id);
      },
      publishRespawn: (id) => this.onRespawnCommitted?.(id),
    });
  }

  private hpRegenTickAtHostTime(playerId: string, deltaMs: number): void {
    if (!(this.playerVitals.readCurrent(playerId)?.alive ?? false)) return;
    const regenPerSecond = this.playerHpRegenPerSecondResolver?.(playerId, this.hostFrameNowMs) ?? 0;
    if (regenPerSecond <= 0) return;
    const current = this.getHP(playerId);
    const max = this.getMaxHp(playerId);
    if (current >= max) return;
    const target = this.playerVitals.getTargetRef(playerId);
    if (!target) return;
    const outcome = this.applySupport({
      outcomeId: this.nextMutationOutcomeId('hp-regen', playerId),
      target,
      source: this.createLegacyMutationSource(playerId, 'combat.hp-regeneration', 'support'),
      supportKind: 'hp-regeneration',
      amount: regenPerSecond * Math.max(0, deltaMs) / 1000,
    });
    if (outcome.kind === 'support-applied') this.onHealingReceived?.(playerId, outcome.actualAmount);
  }

  private armorRegenTickAtHostTime(playerId: string, deltaMs: number): void {
    if (!(this.playerVitals.readCurrent(playerId)?.alive ?? false)) return;
    // Der Bonus wird *vor* dem Frueh-Ausstieg addiert: sonst wirkte die Notfallreparatur nicht
    // bei einem Spieler ohne jede Grund-Ruestungsregeneration.
    const regenPerSecond = (this.playerArmorRegenPerSecondResolver?.(playerId) ?? 0)
      + Math.max(0, this.playerBonusArmorRegenPerSecondResolver?.(playerId, this.hostFrameNowMs) ?? 0);
    if (regenPerSecond <= 0) return;
    const current = this.getArmor(playerId);
    const max = Math.max(0, this.playerMaxArmorResolver?.(playerId) ?? ARMOR_MAX);
    if (current >= max) return;
    // Exakt der konfigurierte Regenerationswert; player.armorGain skaliert andere Ruestungsquellen.
    const target = this.playerVitals.getTargetRef(playerId);
    if (!target) return;
    const outcome = this.applySupport({
      outcomeId: this.nextMutationOutcomeId('armor-regen', playerId),
      target,
      source: this.createLegacyMutationSource(playerId, 'combat.armor-regeneration', 'support'),
      supportKind: 'armor-regeneration',
      amount: regenPerSecond * Math.max(0, deltaMs) / 1000,
    });
    if (outcome.kind === 'support-applied') this.onArmorReceived?.(playerId, outcome.actualAmount);
  }

  private resolvePlayerMaxHp(playerId: string): number {
    const resolved = this.playerMaxHpResolver?.(playerId) ?? HP_MAX;
    return Math.max(1, Math.floor(resolved));
  }

  /** Shared Support entry; Damage eligibility is deliberately not its inverse. */
  private applySupportAtHostTime(request: CombatSupportRequest): CombatSupportMutationOutcome {
    const mutation = request.target.kind === 'player' ? this.playerVitals
      : request.target.kind === 'enemy' ? this.enemyManager : null;
    if (!mutation) return freezeTargetMutationOutcome({
      kind: 'rejected', outcomeId: request.outcomeId, target: request.target,
      source: request.source, reason: 'target-missing',
    });
    return applyCombatSupport(request, {
      ...this.combatResolutionContext(),
      armorGainMultiplier: target => this.playerArmorGainMultiplierResolver?.(String(target.id)) ?? 1,
    }, mutation);
  }

  private combatResolutionContext(): CombatResolutionContext {
    return {
      nowMs: this.hostFrameNowMs,
      random: this.hostRandom,
      authorized: this.bridge.isHost(),
      acceptsScope: target => target.kind === 'enemy'
        ? this.enemyManager?.getCombatTargetRef(target.id)?.scope !== undefined
          && isSameCombatScope(target.scope, this.enemyManager.getCombatTargetRef(target.id)!.scope)
        : isSameCombatScope(target.scope, this.playerVitals.scope),
      resolveTarget: (target, source) => {
        const state = target.kind === 'player' ? this.playerVitals.readVitals(target)
          : target.kind === 'enemy' ? this.enemyManager?.readCombatVitals(target) : null;
        if (!state) return null;
        const entity = target.kind === 'player' ? this.playerManager.getPlayer(target.id) : undefined;
        const enemy = target.kind === 'enemy' ? this.enemyManager?.getEnemy(target.id) : undefined;
        return {
          snapshot: { target, state, position: { x: entity?.x ?? enemy?.sprite.x ?? 0, y: entity?.y ?? enemy?.sprite.y ?? 0 } },
          relationship: this.relationshipForSource(source, String(target.id)),
          burrowed: target.kind === 'player' ? this.burrowSystem?.isBurrowed(target.id) : enemy?.isBurrowed(),
        };
      },
      resolveOutgoing: (request, amount, allowCritical, nowMs, random) => this.playerOutgoingDamageResolver?.(
        request.source.allegiance.ownerId === 'world' ? undefined : request.source.allegiance.ownerId,
        String(request.target.id), amount, allowCritical, request.source.sourceSlot, nowMs, random,
      ) ?? { amount, isCritical: false },
      incomingMultiplier: (target, nowMs) => {
        if (target.kind !== 'player' && target.kind !== 'enemy') return 1;
        const statusTarget: TargetStatusTarget = { targetType: target.kind, targetId: String(target.id) };
        return this.targetIncomingDamageMultiplierResolver?.(statusTarget, nowMs)
          ?? (target.kind === 'enemy' ? this.enemyIncomingDamageMultiplierResolver?.(target.id, nowMs) : undefined) ?? 1;
      },
      blockAtTarget: (request, amount, nowMs) => {
        const target = request.target;
        const player = target.kind === 'player' ? this.playerManager.getPlayer(target.id) : undefined;
        const enemy = target.kind === 'enemy' ? this.enemyManager?.getEnemy(target.id) : undefined;
        if (target.kind !== 'player' && enemy?.faction !== 'allied') return false;
        return this.energyShieldSystem?.tryDomeProtect(
          player?.x ?? enemy?.sprite.x ?? 0, player?.y ?? enemy?.sprite.y ?? 0,
          target.kind === 'player' ? target.id : null, amount, nowMs,
        ) ?? false;
      },
      damageReduction: (target, nowMs) => target.kind === 'player' ? this.playerDamageReductionResolver?.(target.id, nowMs) ?? 0 : 0,
    };
  }

  private relationshipForSource(source: Pick<CombatSource, 'allegiance' | 'actor'> & Partial<Pick<CombatSource, 'gameplaySource'>>, targetId: string) {
    const sourceId = source.allegiance.ownerId;
    const targetEnemy = this.enemyManager?.getEnemy(targetId);
    const sourceEnemy = source.actor?.kind === 'enemy' || source.gameplaySource?.kind === 'enemy';
    const sourceFaction = source.allegiance.factionId === 'hostile'
      || sourceId === COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID ? 'hostile' : 'players';
    const result = resolveCombatRelationship({
      sameActor: sourceId === targetId,
      sourceFaction,
      targetFaction: targetEnemy?.faction === 'hostile' ? 'hostile' : 'players',
      bothPlayers: !sourceEnemy && !targetEnemy && sourceFaction === 'players',
      playerPairAreTeammates: sourceId !== targetId && sourceId !== 'world' && !sourceEnemy && !targetEnemy
        ? this.bridge.areTeammates(sourceId, targetId) : false,
      allowTeamDamage: source.allegiance.allowTeamDamage === true,
    });
    // Explicit environmental damage is admitted independently of friendship/support.
    return sourceId === 'world' ? { relationship: 'neutral' as const, canDamage: true, canSupport: false } : result;
  }

  private createDamageRequest(
    target: CombatTargetRef, amount: number, attackerId?: string, sourceId?: string,
    options?: DamageApplicationOptions, skipBurrowCheck = false,
  ): CombatDamageRequest {
    const damageKind = options?.damageKind ?? 'direct'; // Legacy default ends at this adapter (P7–P10).
    const legacySource = options?.source ?? this.createLegacyMutationSource(attackerId, sourceId, damageKind);
    const source = options?.source ?? {
      ...legacySource,
      sourceSlot: options?.sourceSlot,
      allegiance: { ...legacySource.allegiance, allowTeamDamage: options?.allowTeamDamage },
    };
    const common = {
      outcomeId: this.nextMutationOutcomeId('damage', String(target.id)), target, source,
      targetScaling: 'pending' as const, allowCritical: options?.allowCritical ?? true,
      burrowException: skipBurrowCheck ? 'burrow-stuck' as const : undefined,
    };
    if (options?.basis?.kind === 'derived-outcome' && (damageKind === 'chain' || damageKind === 'reflect')) {
      return { ...common, entry: 'derived-reaction', damageKind, basis: options.basis };
    }
    // Old entry paths have already applied their P/falloff/object factors. Never add P here.
    const basis = options?.basis?.kind === 'source-resolved' ? options.basis
      : { kind: 'source-resolved' as const, amount, sourceFactors: [] };
    return { ...common, entry: 'automated', damageKind, basis };
  }

  private createPlayerVitalsOwner(scope: CombatScope): PlayerVitalsOwner {
    return new PlayerVitalsOwner(Object.freeze({ ...scope }), {
      resolveMaxHp: (playerId) => this.resolvePlayerMaxHp(playerId),
      resolveMaxArmor: (playerId) => Math.max(0, this.playerMaxArmorResolver?.(playerId) ?? ARMOR_MAX),
      captureTerminalFacts: (target) => {
        const player = this.playerManager.getPlayer(String(target.id));
        return {
          target,
          position: { x: player?.x ?? 0, y: player?.y ?? 0 },
          targetCategory: 'player',
        };
      },
    });
  }

  private nextMutationOutcomeId(kind: string, targetId: string): string {
    this.mutationOutcomeSequence += 1;
    return `legacy:${kind}:${targetId}:${this.mutationOutcomeSequence}`;
  }

  /** Legacy source adapter for callers migrating to explicit saved facts in P7–P10. */
  private createLegacyMutationSource(
    actorId: string | undefined,
    authoredSourceId: string | undefined,
    origin: CombatDamageKind | 'support',
  ): CombatSource {
    const actorIsEnemy = actorId ? this.enemyManager?.hasEnemy(actorId) === true : false;
    const actorIsPlayer = actorId ? this.playerManager.getPlayer(actorId) !== undefined : false;
    const gameplaySource = actorIsEnemy
      ? { kind: 'enemy' as const, id: actorId as string }
      : actorIsPlayer
        ? { kind: 'player' as const, id: actorId as string }
        : { kind: 'environment' as const, id: actorId ?? authoredSourceId ?? 'legacy-combat' };
    const enemy = actorIsEnemy ? this.enemyManager?.getEnemy(actorId!) : undefined;
    const attribution = actorIsEnemy
      ? enemy?.faction === 'allied' && enemy.ownerId
        ? { kind: 'player' as const, id: enemy.ownerId }
        : { kind: 'enemy' as const, id: actorId as string }
      : actorIsPlayer
        ? { kind: 'player' as const, id: actorId as string }
        : { kind: 'world' as const, id: actorId ?? authoredSourceId ?? 'legacy-combat' };
    return {
      gameplaySource,
      actor: gameplaySource,
      attribution,
      allegiance: { ownerId: actorId ?? 'world', factionId: enemy?.faction },
      authoredSourceId,
      origin,
    };
  }

  private clearBurnForPlayer(playerId: string): void {
    const target = this.playerVitals.getTargetRef(playerId);
    if (target) this.burnStatus.clearBurn(target);
  }

  private clearBurnByAttacker(attackerId: string): void {
    this.burnStatus.clearSource(attackerId);
  }

  private resolveCurrentCombatantTarget(id: string): CombatTargetRef | null {
    return this.enemyManager?.getCombatTargetRef(id) ?? this.playerVitals.getTargetRef(id);
  }

  isCurrentCombatantTarget(target: CombatTargetRef): boolean {
    const current = this.resolveCurrentCombatantTarget(String(target.id));
    return current !== null && isSameCombatTargetInstance(current, target);
  }
}

function createAk47Context(request: ProjectileDirectImpactRequest): ProjectileAk47HitContext | undefined {
  const shotId = request.provenance.correlation?.ak47ShotId;
  if (shotId === undefined) return undefined;
  return {
    ownerId: request.provenance.allegiance.ownerId,
    shotId,
    fireSuperiorityShot: request.directHit.ak47?.fireSuperiorityShot === true,
  };
}

function createReactionMetadata(
  request: ProjectileDirectImpactRequest,
  _ak47Impact?: ProjectileAk47DirectImpact,
  plasmaSwarm?: ProjectilePlasmaSwarmImpact,
): { readonly ak47?: ProjectileAk47HitContext; readonly plasmaSwarm?: ProjectilePlasmaSwarmImpact } | undefined {
  const ak47 = createAk47Context(request);
  return ak47 || plasmaSwarm ? { ak47, plasmaSwarm } : undefined;
}

function findEnergyInjector(
  request: ProjectileDirectImpactRequest,
): ProjectileEnergyInjectorAugment | undefined {
  for (const augment of request.augments) {
    if ('kind' in augment && augment.kind === 'energy-injector') return augment;
  }
  return undefined;
}
