import * as Phaser from 'phaser';
import type { RockPhysicsProxy } from '../arena/rocks/RockPhysicsProxy';
import type { BaseManager } from '../entities/BaseManager';
import type { EnemyDeathInfo, EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { NetworkBridge }     from '../network/NetworkBridge';
import type { PlayerCombatResourcePort } from '../world/PlayerCombatIntegrationPort';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { DetonationSystem }  from './DetonationSystem';
import type { EnergyShieldSystem, ReflectDomeInfo } from './EnergyShieldSystem';
import type { DecoySystem, DecoyTargetSnapshot } from './DecoySystem';
import type { BurnOnHitConfig, BurnOrigin, ChainLightningConfig, CombatDamageKind, CombatDamageTargetType, GroundFireVisualStyle, HitscanSupportEffect, HitscanVisualPreset, LoadoutSlot, MeleeDamageTarget, MeleeVisualPreset, ProjectileSpawnConfig, RadialDamageFalloffConfig, ShieldBlockCategory, ShotAudioKey, SyncedDeathEffect, SyncedHitEffect, SyncedHitscanTrace, SyncedMeleeSwing, DetonatorConfig, ProjectileExplosionConfig, TrackedProjectile, WeaponSlot } from '../types';
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
  COOP_DEFENSE_BASE_TURRET_OWNER_ID,
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
import { isCoopDefenseMode } from '../gameModes';
import { getCoopDefenseEnemyXp } from '../config/coopDefenseEnemies';
import { computeProjectileExplosionDamage, computeRadialDamage } from '../utils/radialDamage';
import { getRageGeneratingDamage } from '../utils/rageDamage';
import { mergeEnemySlow, type EnemySlowState } from '../utils/enemySlow';
import {
  canTriggerPlasmaSwarm,
  PLASMA_SWARM_BASE_EXPLOSION_DAMAGE,
  PLASMA_SWARM_BASE_EXPLOSION_RADIUS,
  PLASMA_SWARM_BASE_PROJECTILE_COUNT,
  PLASMA_SWARM_EXPLOSION_DURATION_MS,
  PLASMA_SWARM_CHANCE_PER_STACK_PERCENT,
  PlasmaChargeTracker,
  resolvePlasmaSwarmProjectileCount,
  resolvePlasmaSwarmProjectileProfile,
  resolvePlasmaSwarmRadialAngles,
  resolvePlasmaSwarmHoming,
  shouldIgnorePlasmaSwarmOriginHit,
} from './PlasmaCharge';
import type { TargetStatusTarget } from './TargetStatusSystem';
import type { Ak47BehaviorPort } from '../loadout/Ak47BehaviorPort';

// Hitscan-Traces und Melee-Swings werden jetzt per RPC statt State gesendet

/** Für Abfragen, die nur Rechteck-Hindernisse auswerten (Baumstämme nehmen keinen Schaden). */
const IGNORE_CIRCLE_OBSTACLES: ObstacleCircleVisitor = () => false;
const HITSCAN_MUZZLE_EPSILON = 0.25;

// Zirkuläre Abhängigkeiten vermeiden: nur Typ-Imports
type BurrowSystemType    = { isBurrowed(id: string): boolean };
type LoadoutManagerType  = {
  getDamageMultiplier(id: string): number;
  getWeaponDamageMultiplier(id: string, slot: WeaponSlot, now?: number): number;
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

export interface Ak47DirectEnemyHitImpact {
  readonly damageMultiplier: number;
  readonly explosionRadius?: number;
  readonly explosionDamageFraction?: number;
}

/**
 * Herkunft eines Schadensereignisses.
 *
 * `direct` ist der unmittelbare Treffer einer Waffe – Projektil, Hitscan oder Nahkampf. Alles
 * andere ist Folgeschaden und darf trefferabhaengige Effekte nicht erneut ausloesen. Die
 * Unterscheidung ist nicht aus `sourceId` ableitbar: das ist ein Anzeigetext.
 */
export type { CombatDamageKind, CombatDamageTargetType };

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
  /**
   * Interner Schalter fuer den Hinrichtungsschlag: Er soll den Gegner toeten, aber keinen
   * Lifeleech und keine schadensabhaengigen Folgeeffekte ausloesen.
   */
  skipLifeLeech?: boolean;
}

/** Passiver, autoritativer Messpunkt nach tatsaechlich verlorenem HP/Armor. */
export interface CombatDamageObservation {
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


import { BurnStateMachine, type ActiveBurnSource } from '../combat/rules/BurnStateMachine';
export type { ActiveBurnSource };

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

export class CombatSystem {
  private hp:            Map<string, number>                           = new Map();
  private maxHp:         Map<string, number>                           = new Map();
  private armor:         Map<string, number>                           = new Map();
  private alive:         Map<string, boolean>                          = new Map();
  private respawnTimers: Map<string, ReturnType<typeof setTimeout>>    = new Map();
  private readonly burnStateMachine = new BurnStateMachine();
  private enemySlowStates: Map<string, EnemySlowState> = new Map();
  private readonly plasmaChargeTracker = new PlasmaChargeTracker();
  private readonly hitscanLine       = new Phaser.Geom.Line();
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
  private readonly obstacleIndex = new ArenaObstacleIndex({
    bounds: () => this.obstacleBounds,
    rocks:  () => this.rockObjects,
    trunks: () => this.trunkObjects,
    bases:  () => this.baseObstacles,
    barriers: () => this.barrierObstacles,
  });
  /**
   * Gemeinsamer mathematischer Kern aller Segmentprüfungen. Die gebundene World nutzt dieselbe
   * Geometrie für Sichtlinie, Hitscan und Melee-Bogen; die Klasse hält nur den Rechenkern.
   */
  private readonly geometry = new CombatGeometry(this.obstacleIndex);
  private meleeSwingIdCounter = 0;
  private effectSeedCounter = 1;

  // Kill-Tracking: letzter Angreifer & Waffe pro Ziel (für Frag-Vergabe)
  private lastAttacker: Map<string, string> = new Map();  // victimId → attackerId
  private lastWeapon:   Map<string, string> = new Map();  // victimId → sourceId
  private lastKillSource: Map<string, KillSourceContext> = new Map();
  /**
   * Herkunft des toedlichen Treffers. Getrennt von {@link lastKillSource}, weil dieser Kontext
   * an die Clients repliziert wird und rein visuell ist – die Quelle ist reine Host-Regel.
   */
  private lastDamageOrigin: Map<string, { kind: CombatDamageKind; slot?: LoadoutSlot }> = new Map();

  // Callback: (killerId, victimId, sourceId) – Host-only
  private onKillCb: ((killerId: string, victimId: string, sourceId: string, x: number, y: number, source?: KillSourceContext) => void) | null = null;
  private onDeathCb: ((playerId: string, x: number, y: number) => void) | null = null;
  private onEnemyDeathCb: ((enemyId: string, x: number, y: number, burnSources: readonly ActiveBurnSource[], death?: EnemyDeathInfo) => boolean | void) | null = null;
  private onAk47DirectEnemyHit: ((projectile: TrackedProjectile, enemyId: string, nowMs: number) => Ak47DirectEnemyHitImpact | null) | null = null;

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
  private onProjectileImpact: ((projectileId: number, x: number, y: number) => void) | null = null;
  private onPlayerImpulse: ((playerId: string, vx: number, vy: number, durationMs: number, sourcePlayerId?: string) => void) | null = null;
  private onEnemyImpulse: ((enemyId: string, vx: number, vy: number, durationMs: number, sourcePlayerId?: string) => void) | null = null;
  private playerMaxHpResolver: ((playerId: string) => number) | null = null;
  private playerDamageReductionResolver: ((playerId: string) => number) | null = null;
  private playerHpRegenPerSecondResolver: ((playerId: string) => number) | null = null;
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
  ) => { amount: number; isCritical: boolean }) | null = null;
  private playerBonusArmorRegenPerSecondResolver: ((playerId: string) => number) | null = null;
  private enemyIncomingDamageMultiplierResolver: ((enemyId: string) => number) | null = null;
  /** Gemeinsamer zielseitiger Multiplikator fuer Gegner und hostautoritäre Strukturen. */
  private targetIncomingDamageMultiplierResolver: ((target: TargetStatusTarget) => number) | null = null;
  private onEnergyInjectorTargetHit: ((
    targetType: 'player' | 'enemy',
    targetId: string,
    x: number,
    y: number,
    projectile: TrackedProjectile,
  ) => void) | null = null;
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
  private onAuthoritativePositionReset: ((playerId: string, x: number, y: number) => void) | null = null;
  private playerActionAllowedResolver: ((playerId: string) => boolean) | null = null;
  private onDirectPrimaryHit: ((
    attackerId: string,
    enemyId: string,
    remainingHp: number,
    maxHp: number,
    isBoss: boolean,
  ) => void) | null = null;
  /** Setzt die zentrale Verwundbarkeit auf einem Ziel; ohne Handler bleibt der Treffereffekt aus. */
  private onApplyVulnerability: ((target: TargetStatusTarget, durationMs: number) => void) | null = null;
  private onPlayerDamageTaken: ((
    playerId: string,
    attackerId: string | undefined,
    hpLost: number,
    armorLost: number,
    damageKind: CombatDamageKind,
  ) => void) | null = null;
  private onDamageDealt: ((
    targetType: CombatDamageTargetType,
    targetId: string,
    attackerId: string | undefined,
    damage: number,
    damageKind: CombatDamageKind,
  ) => void) | null = null;
  private readonly damageDealtObservers = new Set<(event: CombatDamageObservation) => void>();
  private onHealingReceived: ((playerId: string, amount: number) => void) | null = null;
  private onArmorReceived: ((playerId: string, amount: number) => void) | null = null;

  constructor(
    private playerManager:     PlayerManager,
    private projectileManager: ProjectileManager,
    private bridge:            NetworkBridge,
  ) {}

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
  setStinkCloudSystem(sc: StinkCloudSystemType | null): void { this.stinkCloudSystem = sc; }
  setDecoySystem(ds: DecoySystem | null): void { this.decoySystem = ds; }
  setEnemyManager(manager: EnemyManager | null): void {
    this.enemyManager = manager;
    if (!manager) this.plasmaChargeTracker.clearAll();
  }
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
  setPlayerDamageReductionResolver(resolver: ((playerId: string) => number) | null): void { this.playerDamageReductionResolver = resolver; }
  setPlayerHpRegenPerSecondResolver(resolver: ((playerId: string) => number) | null): void { this.playerHpRegenPerSecondResolver = resolver; }
  setPlayerMaxArmorResolver(resolver: ((playerId: string) => number) | null): void { this.playerMaxArmorResolver = resolver; }
  setPlayerArmorGainMultiplierResolver(resolver: ((playerId: string) => number) | null): void { this.playerArmorGainMultiplierResolver = resolver; }
  setPlayerArmorDamageGrantsRageResolver(resolver: ((playerId: string) => boolean) | null): void { this.playerArmorDamageGrantsRageResolver = resolver; }
  setPlayerLifeLeechFractionResolver(resolver: ((playerId: string) => number) | null): void { this.playerLifeLeechFractionResolver = resolver; }
  setPlayerArmorRegenPerSecondResolver(resolver: ((playerId: string) => number) | null): void { this.playerArmorRegenPerSecondResolver = resolver; }
  /** Zusatzregeneration aus bedingten Quellen (Notfallreparatur); addiert sich auf den Grundwert. */
  setPlayerBonusArmorRegenPerSecondResolver(resolver: ((playerId: string) => number) | null): void { this.playerBonusArmorRegenPerSecondResolver = resolver; }
  /** Zielseitiger Schadensmultiplikator eines Gegners (Verwundbarkeit); 1 = unveraendert. */
  setEnemyIncomingDamageMultiplierResolver(resolver: ((enemyId: string) => number) | null): void { this.enemyIncomingDamageMultiplierResolver = resolver; }
  /** Gemeinsamer Zielstatus-Trichter; ersetzt den alten Gegner-only-Resolver, falls gesetzt. */
  setTargetIncomingDamageMultiplierResolver(resolver: ((target: TargetStatusTarget) => number) | null): void {
    this.targetIncomingDamageMultiplierResolver = resolver;
  }
  setEnergyInjectorTargetHitCallback(handler: ((
    targetType: 'player' | 'enemy',
    targetId: string,
    x: number,
    y: number,
    projectile: TrackedProjectile,
  ) => void) | null): void {
    this.onEnergyInjectorTargetHit = handler;
  }
  setHitscanSupportImpactCallback(handler: ((
    impact: HitscanSupportImpact,
    effect: HitscanSupportEffect,
    attackerId: string,
    sourceSlot?: LoadoutSlot,
  ) => void) | null): void {
    this.onHitscanSupportImpact = handler;
  }
  getTargetIncomingDamageMultiplier(target: TargetStatusTarget): number {
    return Math.max(0, this.targetIncomingDamageMultiplierResolver?.(target) ?? 1);
  }
  setRespawnAllowedResolver(resolver: ((playerId: string) => boolean) | null): void { this.respawnAllowedResolver = resolver; }
  setInitialSpawnAllowedResolver(resolver: ((playerId: string) => boolean) | null): void {
    this.initialSpawnAllowedResolver = resolver;
  }
  setRespawnCallback(cb: ((playerId: string) => boolean | void) | null): void {
    this.onRespawnCb = cb;
  }
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
  setDirectPrimaryHitHandler(handler: ((attackerId: string, enemyId: string, remainingHp: number, maxHp: number, isBoss: boolean) => void) | null): void {
    this.onDirectPrimaryHit = handler;
  }
  /** Uebergibt die zentrale Verwundbarkeit an den Host, wenn ein Projektil sie auf Treffer setzt. */
  setApplyVulnerabilityHandler(handler: ((target: TargetStatusTarget, durationMs: number) => void) | null): void {
    this.onApplyVulnerability = handler;
  }
  /** Meldung ueber tatsaechlich verlorene HP/Ruestung eines Spielers, nach der Verteilung. */
  setPlayerDamageTakenHandler(handler: ((playerId: string, attackerId: string | undefined, hpLost: number, armorLost: number, damageKind: CombatDamageKind) => void) | null): void {
    this.onPlayerDamageTaken = handler;
  }
  /** Meldet nach der Zielverteilung nur tatsächlich verlorene HP/Rüstung bzw. Gegner-HP. */
  setDamageDealtHandler(handler: ((targetType: CombatDamageTargetType, targetId: string, attackerId: string | undefined, damage: number, damageKind: CombatDamageKind) => void) | null): void {
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
    );
    for (const observer of this.damageDealtObservers) observer(event);
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

  setProjectileImpactCallback(cb: ((projectileId: number, x: number, y: number) => void) | null): void {
    this.onProjectileImpact = cb;
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

  setEnemyDeathCallback(cb: ((enemyId: string, x: number, y: number, burnSources: readonly ActiveBurnSource[], death?: EnemyDeathInfo) => boolean | void) | null): void {
    this.onEnemyDeathCb = cb;
  }

  setAk47DirectEnemyHitHandler(handler: ((projectile: TrackedProjectile, enemyId: string, nowMs: number) => Ak47DirectEnemyHitImpact | null) | null): void {
    this.onAk47DirectEnemyHit = handler;
  }

  // ── Spieler-Lifecycle ──────────────────────────────────────────────────────

  initPlayer(id: string): void {
    if (this.initialSpawnAllowedResolver && !this.initialSpawnAllowedResolver(id)) return;
    const maxHp = this.resolvePlayerMaxHp(id);
    this.maxHp.set(id, maxHp);
    this.hp.set(id, maxHp);
    this.armor.set(id, 0);
    this.alive.set(id, true);
    this.clearBurnForPlayer(id);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
    this.lastKillSource.delete(id);
    this.lastDamageOrigin.delete(id);
  }

  /** Host-only reconnect after a registered death; consumes through the normal respawn callback. */
  spawnPlayerAfterReconnect(id: string): boolean {
    if (!this.playerManager.getPlayer(id)) return false;
    if (this.respawnAllowedResolver && !this.respawnAllowedResolver(id)) return false;
    if (this.onRespawnCb && this.onRespawnCb(id) === false) return false;

    this.hp.set(id, this.getMaxHp(id));
    this.armor.set(id, 0);
    this.alive.set(id, true);
    this.clearBurnForPlayer(id);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
    this.lastKillSource.delete(id);
    this.lastDamageOrigin.delete(id);
    this.resourceSystem?.resetAdrenalineForSpawn(id);

    const player = this.playerManager.getPlayer(id)!;
    player.body.enable = true;
    const spawn = this.playerManager.getWorldSpawnPoint(id);
    const spawnX = spawn.x;
    const spawnY = spawn.y;
    player.setPosition(spawnX, spawnY);
    this.onAuthoritativePositionReset?.(id, spawnX, spawnY);
    return true;
  }

  removePlayer(id: string): void {
    this.clearBurnForPlayer(id);
    this.clearBurnByAttacker(id);
    this.hp.delete(id);
    this.maxHp.delete(id);
    this.armor.delete(id);
    this.alive.delete(id);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
    this.lastKillSource.delete(id);
    this.lastDamageOrigin.delete(id);
    const t = this.respawnTimers.get(id);
    if (t) { clearTimeout(t); this.respawnTimers.delete(id); }
  }

  // ── Abfragen ───────────────────────────────────────────────────────────────

  getHP(id: string):    number  { return this.hp.get(id)    ?? this.getMaxHp(id); }
  getMaxHp(id: string): number  { return this.maxHp.get(id) ?? this.resolvePlayerMaxHp(id); }
  getArmor(id: string): number  { return this.armor.get(id) ?? 0;      }

  /**
   * Reconciles live build-derived caps without recreating the player runtime. This is used when
   * a World-only Coop build changes while the player is already in the test area.
   */
  reconcilePlayerRuntimeState(id: string): void {
    if (!this.hp.has(id) && !this.armor.has(id)) return;
    const maxHp = this.resolvePlayerMaxHp(id);
    this.maxHp.set(id, maxHp);
    const currentHp = this.hp.get(id);
    if (currentHp !== undefined && currentHp > maxHp) this.hp.set(id, maxHp);

    const maxArmor = Math.max(0, this.playerMaxArmorResolver?.(id) ?? ARMOR_MAX);
    const currentArmor = this.armor.get(id);
    if (currentArmor !== undefined && currentArmor > maxArmor) this.armor.set(id, maxArmor);
  }

  isAlive(id: string):  boolean { return (this.alive.get(id) ?? false) || this.enemyManager?.hasEnemy(id) === true; }
  isBurrowed(id: string): boolean {
    const enemy = this.enemyManager?.getEnemy(id);
    if (enemy) return enemy.isBurrowed();
    return this.burrowSystem?.isBurrowed(id) ?? false;
  }
  getBurnVisualState(
    id: string,
    now = Date.now(),
  ): { stackCount: number; visualStyle: GroundFireVisualStyle } {
    return this.burnStateMachine.getVisualState(id, now);
  }

  getBurnStackCount(id: string): number {
    return this.getBurnVisualState(id).stackCount;
  }

  getActiveBurnSources(id: string, now = Date.now()): ActiveBurnSource[] {
    return this.burnStateMachine.getActiveSources(id, now);
  }

  // ── Öffentliche Schadens-Methode ───────────────────────────────────────────

  /**
   * Fügt einem Spieler Schaden zu. Burrowed-Spieler sind unverwundbar
   * (Ausnahme: Stuck-Schaden über skipBurrowCheck=true).
   * attackerId/sourceId werden für die Kill-Zuordnung getrackt.
   */
  applyDamage(
    targetId:        string,
    amount:          number,
    skipBurrowCheck  = false,
    attackerId?:     string,
    sourceId?:     string,
    visualContext?:  DamageVisualContext,
    options?:        DamageApplicationOptions,
  ): void {
    if (this.enemyManager?.hasEnemy(targetId)) {
      this.applyEnemyDamage(targetId, amount, attackerId, sourceId, visualContext, options);
      return;
    }

    if (!this.isAlive(targetId)) return;
    if (amount <= 0) return;
    if (!this.canDamageTarget(attackerId, targetId, options?.allowTeamDamage)) return;
    if (!skipBurrowCheck && this.burrowSystem?.isBurrowed(targetId)) return;
    this.decoySystem?.breakStealth(targetId, Date.now());
    const outgoing = this.playerOutgoingDamageResolver?.(
      attackerId,
      targetId,
      amount,
      options?.allowCritical ?? true,
      options?.sourceSlot,
    ) ?? { amount, isCritical: false };
    amount = outgoing.amount;
    // Allgemeine Zielstatus wirken auch auf Spieler, damit der Energieinjektor im PvP und
    // kuenftige offensive Statusquellen denselben eingehenden Schadenspfad verwenden.
    amount *= this.getTargetIncomingDamageMultiplier({ targetType: 'player', targetId });

    // Letzten Angreifer tracken (Selbstschaden ausgenommen)
    if (attackerId && attackerId !== targetId) {
      this.lastAttacker.set(targetId, attackerId);
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

    // Energie-Kuppel: Liegt der Schadenspunkt in einer verbündeten Kuppel, wird der Schaden
    // vollständig abgewehrt (jeder abdeckende Kuppel-Besitzer erhält den Schadensbonus).
    if (this.energyShieldSystem?.tryDomeProtect(x, y, targetId, amount, Date.now())) return;

    const damageReduction = Phaser.Math.Clamp(this.playerDamageReductionResolver?.(targetId) ?? 0, 0, 1);
    const reducedAmount = amount * (1 - damageReduction);
    const currentArmor = this.armor.get(targetId) ?? 0;
    const absorbedByArmor = Math.min(currentArmor, reducedAmount);
    const overflowDamage = Math.max(0, reducedAmount - absorbedByArmor);
    const newArmor = Math.max(0, currentArmor - absorbedByArmor);
    const currentHp = this.hp.get(targetId) ?? this.getMaxHp(targetId);
    const newHp = Math.max(0, currentHp - overflowDamage);
    const armorLost = currentArmor - newArmor;
    const hpLost = currentHp - newHp;
    const totalDamage = armorLost + hpLost;
    this.armor.set(targetId, newArmor);
    this.hp.set(targetId, newHp);

    // Armor-Schaden zaehlt nur mit dem passenden Coop-Defense-Upgrade als Rage-Quelle.
    const rageDamage = getRageGeneratingDamage(
      hpLost,
      armorLost,
      this.playerArmorDamageGrantsRageResolver?.(targetId) ?? false,
    );
    if (rageDamage > 0) {
      this.resourceSystem?.addRage(targetId, rageDamage * RAGE_PER_DAMAGE);
    }

    if (totalDamage > 0) {
      // Nach der Verteilung, damit Verbraucher den *tatsaechlichen* Verlust sehen: vollstaendig
      // abgewehrter Schaden, Schaden von null und reine Rueckstoss-Effekte melden hier nichts.
      this.onPlayerDamageTaken?.(
        targetId,
        attackerId,
        hpLost,
        armorLost,
        options?.damageKind ?? 'direct',
      );
      this.notifyDamageDealt({
        targetType: 'player',
        targetId,
        attackerId: this.resolveDamageOwner(attackerId),
        damage: totalDamage,
        damageKind: options?.damageKind ?? 'direct',
        sourceSlot: options?.sourceSlot,
        isCritical: outgoing.isCritical,
      });
      this.applyLifeLeech(attackerId, targetId, totalDamage);
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
        outgoing.isCritical,
      ));
    }

    if (newHp === 0) {
      const deathSeed = this.nextEffectSeed();
      const deathDirection = this.resolveDamageDirection(targetId, attackerId, visualContext, deathSeed, x, y);
      this.handleDeath(targetId, x, y, deathSeed, deathDirection);
    }
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
    if (!this.isAlive(targetId)) return;
    if (!this.canDamageTarget(attackerId, targetId)) return;
    if (durationMs <= 0 || damagePerTick <= 0 || !sourceId) return;

    this.burnStateMachine.applyHit({
      targetId,
      attackerId,
      durationMs,
      damagePerTick,
      sourceKey,
      sourceId,
      origin,
      visualStyle,
      now: Date.now(),
    });
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

  /**
   * Brennende Treffer aus den Burn-Feldern eines Projektils (z.B. brennende
   * Kugeln der Glock/Negev oder Flammenwerfer-Hitbox). No-op ohne Burn-Felder.
   */
  /** true, wenn das Projektil eine aktive "nur bei Gegner-Treffern"-Explosion besitzt. */
  private hasEnemyHitExplosion(proj: TrackedProjectile | undefined): boolean {
    const e = proj?.enemyHitExplosion;
    return !!e && e.radius > 0 && e.maxDamage > 0;
  }

  private applyProjectileBurn(targetId: string, proj: TrackedProjectile | undefined): void {
    if (!proj) return;
    this.applyBurnHit(
      targetId,
      proj.ownerId,
      proj.burnDurationMs ?? 0,
      proj.burnDamagePerTick ?? 0,
      `weapon:${proj.sourceId}`,
      proj.sourceId,
      proj.isFlame ? 'flamethrower_direct' : 'generic',
      proj.projectileBurnVisualStyle,
    );
    const supplemental = proj.supplementalBurnOnHit;
    if (supplemental) {
      this.applyBurnHit(
        targetId,
        proj.ownerId,
        supplemental.durationMs,
        supplemental.damagePerTick,
        `imbued-projectile:${proj.sourceId}`,
        `${proj.sourceId}:imbued`,
      );
    }
  }

  updateBurnEffects(now: number): void {
    const isTargetValid = (targetId: string) => this.isAlive(targetId) && !this.isBurrowed(targetId);
    const contributions = this.burnStateMachine.advanceTo(now, isTargetValid);

    for (const contribution of contributions) {
      if (!this.isAlive(contribution.targetId)) continue;
      const attacker = this.playerManager.getPlayer(contribution.attackerId);
      this.applyDamage(
        contribution.targetId,
        contribution.damage,
        false,
        contribution.attackerId,
        contribution.sourceId,
        attacker ? { sourceX: attacker.x, sourceY: attacker.y } : undefined,
        { allowCritical: false, damageKind: 'burn' },
      );
    }
  }

  /**
   * Flächenschaden um einen Punkt (z.B. Granaten-Explosion).
   * Burrowed-Spieler sind immun (skipBurrowCheck=false).
   */
  applyAoeDamage(
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

  getEnemyMovementFactor(enemyId: string, now = Date.now()): number {
    const state = this.enemySlowStates.get(enemyId);
    let movementFactor = 1;
    if (state) {
      if (now >= state.expiresAt) {
        this.enemySlowStates.delete(enemyId);
      } else {
        movementFactor = state.movementFactor;
      }
    }

    const enemy = this.enemyManager?.getEnemy(enemyId);
    if (!enemy) {
      this.plasmaChargeTracker.clear(enemyId);
      return movementFactor;
    }

    const plasmaState = this.plasmaChargeTracker.getState(enemyId, now);
    const plasmaStacks = plasmaState?.stacks ?? 0;
    if (enemy.getPlasmaChargeStacks() !== plasmaStacks) {
      enemy.updatePlasmaChargeStacks(plasmaStacks);
    }
    return movementFactor;
  }

  /**
   * Verlangsamt einen Gegner. Es gibt bewusst nur einen Slot je Gegner statt einer Liste je
   * Quelle: der staerkere Faktor und der spaetere Ablauf gewinnen.
   *
   * Die Dauer wird **nicht** mehr bedingungslos ueberschrieben. Sonst koennte eine schwache
   * spaete Anwendung – etwa Unterdrueckungsmunition neben einer ausgebauten Bremsladung – einen
   * starken laufenden Slow verkuerzen.
   */
  applyEnemySlow(enemyId: string, slowFraction: number, durationMs: number, now = Date.now()): void {
    if (slowFraction <= 0 || durationMs <= 0 || !this.enemyManager?.hasEnemy(enemyId)) return;
    this.enemySlowStates.set(
      enemyId,
      mergeEnemySlow(this.enemySlowStates.get(enemyId), slowFraction, durationMs, now),
    );
  }

  applyExplosionDamage(
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
    if (attackerId === COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID) {
      return targetEnemy ? targetEnemy.faction !== 'hostile' : true;
    }
    if (allowTeamDamage) return true;
    // Eingebuddelte Gegner sind – wie eingebuddelte Spieler – weder Ziel noch Angreifer.
    if (targetEnemy?.isBurrowed() || attackerEnemy?.isBurrowed()) return false;
    if (attackerEnemy && targetEnemy) return attackerEnemy.faction !== targetEnemy.faction;
    if (attackerEnemy) return attackerEnemy.faction === 'hostile';
    if (targetEnemy) return targetEnemy.faction === 'hostile';
    return !this.bridge.areTeammates(attackerId, targetId);
  }

  private shouldBlockWithShield(
    targetId: string,
    category: ShieldBlockCategory,
    damage: number,
    sourceX: number,
    sourceY: number,
  ): boolean {
    if (!this.energyShieldSystem) return false;
    return this.energyShieldSystem.tryBlockDamage({
      targetId,
      category,
      damage,
      sourceX,
      sourceY,
      now: Date.now(),
    });
  }

  // ── Host-Update: Projektil-Spieler-Kollisionserkennung ────────────────────

  /**
   * Jeden Frame auf dem Host aufrufen.
   * Prüft Überschneidungen zwischen Projektilen und Spielern.
   * Selbst-Treffer, Granaten und burrowed Spieler werden ignoriert.
   */
  update(nowMs: number = Date.now()): void {
    if (!this.bridge.isHost()) return;

    this.applyDomeProjectileBarrier();
    this.applyLeafBlowerProjectileDeflection();

    for (const proj of this.projectileManager.getActiveProjectiles()) {
      if (proj.isGrenade) continue;  // Granaten treffen nicht direkt, nur AoE
      if (proj.miniRocketDeferredExplosion) continue;
      if (proj.miniRocketSpent) continue;

      if (this.shouldUseContinuousProjectileCollision(proj)) {
        const travelDistance = Phaser.Math.Distance.Between(proj.lastX, proj.lastY, proj.sprite.x, proj.sprite.y);
        if (travelDistance > 0.5) {
          this.tryResolveContinuousProjectileHit(proj, nowMs);
          continue;
        }
      }

      const projBounds = proj.sprite.getBounds();
      if (this.resolveProjectilePlayerHits(proj, projBounds, nowMs)) continue;
      if (this.resolveProjectileEnemyHits(proj, projBounds, nowMs)) continue;
      this.resolveProjectileDecoyHits(proj, projBounds, nowMs);
    }
  }

  /**
   * Energie-Kuppel-Projektilbarriere: Gegnerische Projektile innerhalb einer Kuppel werden
   * absorbiert (a1) oder nach außen abgeprallt (d2). Abgeprallte Projektile gelten danach als
   * Projektile des Kuppel-Besitzers und treffen Gegner. In beiden Fällen lädt der Schadensbonus.
   */
  private applyDomeProjectileBarrier(): void {
    const domes = this.energyShieldSystem?.getReflectDomes();
    if (!domes || domes.length === 0) return;
    const now = Date.now();

    for (const proj of this.projectileManager.getActiveProjectiles()) {
      // Geworfene Utilities fliegen weiterhin durch die Kuppel. Einzige Ausnahme sind
      // Brut-Wurfgeschosse: die faengt die Kuppel ab, damit ihr Besitzer die Brut uebernimmt.
      const isCapturableGrenade = proj.grenadeEffect?.type === 'spawn_enemy';
      if (proj.isGrenade && !isCapturableGrenade) continue;
      if (proj.miniRocketDeferredExplosion || proj.miniRocketSpent) continue;

      for (const dome of domes) {
        if (proj.ownerId === dome.ownerId) continue;
        // Nur feindliche Projektile abwehren – eigene/verbündete Geschosse passieren die Kuppel.
        if (!this.canDamageTarget(proj.ownerId, dome.ownerId, proj.allowTeamDamage)) continue;

        const dx = proj.sprite.x - dome.x;
        const dy = proj.sprite.y - dome.y;
        if (dx * dx + dy * dy > dome.radius * dome.radius) continue;

        const blockedDamage = this.computeProjectileDamage(proj);
        this.energyShieldSystem?.onDomeAbsorb(dome.ownerId, blockedDamage, now);

        if (!dome.reflect) {
          // Reine Absorptionskuppel: das Geschoss verschwindet folgenlos, bei Brutbomben
          // schluepft also gar nichts.
          this.projectileManager.destroyProjectile(proj.id);
        } else if (isCapturableGrenade) {
          this.captureSpawnGrenadeFromDome(proj, dome, now);
        } else {
          this.reflectProjectileFromDome(proj, dome, now);
        }
        break; // Projektil ist behandelt
      }
    }
  }

  /**
   * Laubbläser-Gegenwind: Ein Luftstoß mit `leafBlowerDeflectsProjectiles` fängt gegnerische
   * Projektile ab und schleudert sie in Stoßrichtung zurück. Das zurückgeschleuderte Geschoss
   * gehört danach dem Schützen und trifft dessen Gegner – analog zur Reflexkuppel (d2).
   */
  private applyLeafBlowerProjectileDeflection(): void {
    const blowers: TrackedProjectile[] = [];
    for (const proj of this.projectileManager.getActiveProjectiles()) {
      if (proj.leafBlowerDeflectsProjectiles && proj.projectileStyle === 'leaf_blower') blowers.push(proj);
    }
    if (blowers.length === 0) return;
    const now = Date.now();

    for (const target of this.projectileManager.getActiveProjectiles()) {
      if (target.projectileStyle === 'leaf_blower') continue;
      // Geworfene Utilities fliegen weiter; nur echte Geschosse werden umgelenkt.
      if (target.isGrenade) continue;
      if (target.miniRocketDeferredExplosion || target.miniRocketSpent) continue;

      const targetBounds = target.sprite.getBounds();
      for (const blower of blowers) {
        if (blower.ownerId === target.ownerId) continue;
        if (!this.canDamageTarget(target.ownerId, blower.ownerId, target.allowTeamDamage)) continue;
        if (!Phaser.Geom.Intersects.RectangleToRectangle(targetBounds, blower.sprite.getBounds())) continue;

        this.deflectProjectileFromLeafBlower(target, blower, now);
        break; // Projektil ist behandelt
      }
    }
  }

  /** Übergibt ein abgefangenes Geschoss an den Laubbläser-Schützen und dreht es in Stoßrichtung. */
  private deflectProjectileFromLeafBlower(
    proj: TrackedProjectile,
    blower: TrackedProjectile,
    now: number,
  ): void {
    const blowLen = Math.hypot(blower.body.velocity.x, blower.body.velocity.y);
    const angle = blowLen > 0.001
      ? Math.atan2(blower.body.velocity.y, blower.body.velocity.x)
      : Math.atan2(-proj.body.velocity.y, -proj.body.velocity.x);
    const speed = Math.hypot(proj.body.velocity.x, proj.body.velocity.y) || 400;

    this.projectileManager.spawnProjectile(proj.sprite.x, proj.sprite.y, angle, blower.ownerId, {
      ...this.inheritedProjectileEffects(proj),
      speed,
      size: Math.max(1, proj.sprite.displayWidth),
      damage: proj.damage,
      color: proj.color,
      ownerColor: blower.ownerColor ?? proj.color,
      lifetime: Math.max(1, proj.lifetime - (now - proj.createdAt)),
      maxBounces: 0,
      isGrenade: false,
      adrenalinGain: 0,
      sourceId: 'weapon.leaf_blower_deflect',
      projectileStyle: proj.projectileStyle,
      bulletVisualPreset: proj.bulletVisualPreset,
      tracerConfig: proj.tracerConfig,
      reflected: true,
      sourceSlot: 'weapon1',
    });
    this.projectileManager.destroyProjectile(proj.id);
  }

  /**
   * Trägt die Trefferwirkungen eines Projektils (Boden-DoT-Wolken, Explosionen, Brand, Debuffs)
   * in ein neu gespawntes Projektil weiter, damit sie nach einem Abprall/einer Reflexion
   * weiterhin ausgelöst werden, statt beim Reflect stillschweigend verloren zu gehen.
   */
  private inheritedProjectileEffects(proj: TrackedProjectile): Partial<ProjectileSpawnConfig> {
    return {
      explosion:            proj.explosion,
      enemyHitExplosion:    proj.enemyHitExplosion,
      impactCloud:          proj.impactCloud,
      grenadeEffect:        proj.grenadeEffect,
      burnDurationMs:       proj.burnDurationMs,
      burnDamagePerTick:    proj.burnDamagePerTick,
      projectileBurnVisualStyle: proj.projectileBurnVisualStyle,
      supplementalBurnOnHit: proj.supplementalBurnOnHit,
      canReceiveFireImbue:  proj.canReceiveFireImbue,
      fireTrail:            proj.fireTrail,
      detonable:            proj.detonable,
      detonator:            proj.detonator,
      proximityPulse:       proj.proximityPulse,
      rockDamageMult:       proj.rockDamageMult,
      trainDamageMult:      proj.trainDamageMult,
      baseDamageMult:       proj.baseDamageMult,
      hitSlowFraction:      proj.hitSlowFraction,
      hitSlowDurationMs:    proj.hitSlowDurationMs,
      hitVulnerabilityDurationMs: proj.hitVulnerabilityDurationMs,
      hitKnockback:         proj.hitKnockback,
      hitKnockbackDurationMs: proj.hitKnockbackDurationMs,
    };
  }

  /** Schleudert ein gegnerisches Projektil radial aus der Kuppel und übergibt es an den Besitzer. */
  private reflectProjectileFromDome(proj: TrackedProjectile, dome: ReflectDomeInfo, now: number): void {
    const dirX = proj.sprite.x - dome.x;
    const dirY = proj.sprite.y - dome.y;
    const angle = (dirX === 0 && dirY === 0)
      ? Math.atan2(-proj.body.velocity.y, -proj.body.velocity.x)
      : Math.atan2(dirY, dirX);
    const speed = Math.hypot(proj.body.velocity.x, proj.body.velocity.y) || 400;

    this.projectileManager.spawnProjectile(proj.sprite.x, proj.sprite.y, angle, dome.ownerId, {
      ...this.inheritedProjectileEffects(proj),
      speed,
      size: Math.max(1, proj.sprite.displayWidth),
      damage: proj.damage,
      color: proj.color,
      ownerColor: dome.color,
      lifetime: Math.max(1, proj.lifetime - (now - proj.createdAt)),
      maxBounces: 0,
      isGrenade: false,
      adrenalinGain: 0,
      sourceId: 'environment.reflector_dome',
      projectileStyle: proj.projectileStyle,
      bulletVisualPreset: proj.bulletVisualPreset,
      tracerConfig: proj.tracerConfig,
      reflected: true,
      sourceSlot: 'weapon2',
    });
    this.projectileManager.destroyProjectile(proj.id);
  }

  /**
   * Übernimmt ein Brut-Wurfgeschoss an der Kuppelgrenze: Es bleibt eine Granate mit Restzündzeit,
   * prallt nach außen ab und gehört danach dem Kuppel-Besitzer. Die schlüpfende Brut spawnt
   * dadurch als sein Verbündeter (siehe HostUpdateCoordinator.spawnEnemiesFromGrenade).
   */
  private captureSpawnGrenadeFromDome(proj: TrackedProjectile, dome: ReflectDomeInfo, now: number): void {
    const dirX = proj.sprite.x - dome.x;
    const dirY = proj.sprite.y - dome.y;
    const angle = (dirX === 0 && dirY === 0)
      ? Math.atan2(-proj.body.velocity.y, -proj.body.velocity.x)
      : Math.atan2(dirY, dirX);
    const speed = Math.hypot(proj.body.velocity.x, proj.body.velocity.y) || 400;
    const remainingFuse = Math.max(1, (proj.fuseTime ?? proj.lifetime) - (now - proj.createdAt));

    this.projectileManager.spawnProjectile(proj.sprite.x, proj.sprite.y, angle, dome.ownerId, {
      ...this.inheritedProjectileEffects(proj),
      speed,
      size: Math.max(1, proj.sprite.displayWidth),
      damage: 0,
      color: dome.color,
      ownerColor: dome.color,
      lifetime: remainingFuse,
      fuseTime: remainingFuse,
      maxBounces: proj.maxBounces,
      isGrenade: true,
      adrenalinGain: 0,
      sourceId: 'environment.reflector_dome',
      projectileStyle: proj.projectileStyle,
      grenadeVisualPreset: proj.grenadeVisualPreset,
      frictionDelayMs: proj.frictionDelayMs,
      airFrictionDecayPerSec: proj.airFrictionDecayPerSec,
      bounceFrictionMultiplier: proj.bounceFrictionMultiplier,
      stopSpeedThreshold: proj.stopSpeedThreshold,
      reflected: true,
      sourceSlot: 'weapon2',
    });
    this.projectileManager.destroyProjectile(proj.id);
  }

  /** Schützen-Damage-Multiplikator (Loadout/Ultimate + PowerUp) auf den Projektil-Basisschaden anwenden. */
  private computeProjectileWeaponDamage(proj: TrackedProjectile): number {
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
        proj.sprite.x,
        proj.sprite.y,
      );
      const closeness = Phaser.Math.Clamp(1 - distance / (proj.shotgunResolvedRange ?? 1), 0, 1);
      projectileMultiplier *= 1 + closeness * (proj.shotgunProximityMaxDamageBonus ?? 0);
    }
    return proj.damage * projectileMultiplier;
  }

  getPlayerRuntimeDamageMultiplier(playerId: string, sourceSlot?: LoadoutSlot): number {
    const loadoutMult = sourceSlot === 'weapon1' || sourceSlot === 'weapon2'
      ? (this.loadoutManager?.getWeaponDamageMultiplier(playerId, sourceSlot, Date.now()) ?? 1)
      : (this.loadoutManager?.getDamageMultiplier(playerId) ?? 1);
    const powerUpMult = this.powerUpSystem?.getDamageMultiplier(playerId) ?? 1;
    return loadoutMult * powerUpMult;
  }

  private computeProjectileDamage(proj: TrackedProjectile): number {
    return this.computeProjectileWeaponDamage(proj)
      * this.getPlayerRuntimeDamageMultiplier(proj.ownerId, proj.sourceSlot);
  }

  /**
   * Wendet einen Projektiltreffer auf eine Basis an. Die Berechnung bleibt identisch zum
   * Projektiltreffer gegen Spieler/Gegner; der anschließende Basistrichter ergänzt die
   * strukturspezifischen Coop-Modifikatoren.
   */
  applyProjectileBaseDamage(baseId: string, projectile: TrackedProjectile): void {
    this.applyBaseDamage(
      baseId,
      this.computeProjectileWeaponDamage(projectile),
      projectile.ownerId,
      projectile.sourceSlot,
      projectile.baseDamageMult,
    );
  }

  private registerAk47Hit(proj: TrackedProjectile, nowMs: number): void {
    if (proj.ak47ShotId === undefined || proj.ak47HitConfirmed) return;
    this.ak47Behavior?.registerProjectileHit(proj, nowMs);
  }

  private resolveAk47DirectEnemyHit(proj: TrackedProjectile, enemyId: string, nowMs: number): Ak47DirectEnemyHitImpact {
    if (proj.ak47ShotId === undefined || proj.sourceSlot !== 'weapon2') {
      return { damageMultiplier: 1 };
    }
    return this.onAk47DirectEnemyHit?.(proj, enemyId, nowMs) ?? { damageMultiplier: 1 };
  }

  private applyAk47TargetExplosion(
    proj: TrackedProjectile,
    enemyId: string,
    directDamage: number,
    impact: Ak47DirectEnemyHitImpact,
  ): void {
    const radius = impact.explosionRadius ?? 0;
    const fraction = impact.explosionDamageFraction ?? 0;
    if (radius <= 0 || fraction <= 0 || directDamage <= 0) return;
    this.applyAoeDamage(
      proj.sprite.x,
      proj.sprite.y,
      radius,
      directDamage * fraction,
      proj.ownerId,
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

  /** AABB-Treffer gegen Spieler (Shield/Piercing/Flammen-Burn/Standard). Liefert true, wenn das Projektil verbraucht ist. */
  private resolveProjectilePlayerHits(proj: TrackedProjectile, projBounds: Phaser.Geom.Rectangle, nowMs: number): boolean {
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isAlive(player.id))                     continue;
      if (proj.ownerId === player.id)                   continue;
      if (this.burrowSystem?.isBurrowed(player.id))     continue;
      if (proj.multiExplosionExcludedTargetKeys?.has(`players:${player.id}`)) continue;

      if (Phaser.Geom.Intersects.RectangleToRectangle(projBounds, player.getBounds())) {
        const actualDamage = this.computeProjectileDamage(proj);
        const canDealDamage = this.canDamageTarget(proj.ownerId, player.id, proj.allowTeamDamage);
        if (!canDealDamage) continue;

        if (proj.energyInjectorPayload) {
          this.onEnergyInjectorTargetHit?.('player', player.id, player.x, player.y, proj);
          this.projectileManager.destroyProjectile(proj.id);
          return true;
        }

        if (canDealDamage && this.shouldBlockWithShield(player.id, 'projectile', actualDamage, proj.sprite.x, proj.sprite.y)) {
          const reflectionFactor = proj.reflected ? 0 : (this.energyShieldSystem?.getReflectionDamageFactor(player.id) ?? 0);
          if (reflectionFactor > 0) {
            const speed = Math.hypot(proj.body.velocity.x, proj.body.velocity.y);
            const angle = Math.atan2(-proj.body.velocity.y, -proj.body.velocity.x);
            this.projectileManager.spawnProjectile(player.x, player.y, angle, player.id, {
              ...this.inheritedProjectileEffects(proj),
              speed,
              size: Math.max(1, proj.sprite.displayWidth),
              damage: proj.damage * reflectionFactor,
              color: proj.color,
              ownerColor: proj.ownerColor,
              lifetime: Math.max(1, proj.lifetime - (Date.now() - proj.createdAt)),
              maxBounces: 0,
              isGrenade: false,
              adrenalinGain: 0,
              sourceId: 'environment.reflector',
              projectileStyle: proj.projectileStyle,
              bulletVisualPreset: proj.bulletVisualPreset,
              tracerConfig: proj.tracerConfig,
              reflected: true,
              sourceSlot: 'weapon2',
            });
          }
          this.projectileManager.destroyProjectile(proj.id);
          return true;
        }

        if (canDealDamage) this.registerAk47Hit(proj, nowMs);

        if (proj.penetrationHitIds) {
          if (proj.penetrationHitIds.has(player.id)) continue;
          proj.penetrationHitIds.add(player.id);
          if (canDealDamage) {
            this.applyDamage(player.id, actualDamage, false, proj.ownerId, proj.sourceId, { sourceX: proj.sprite.x, sourceY: proj.sprite.y, dirX: proj.body.velocity.x, dirY: proj.body.velocity.y }, { allowTeamDamage: proj.allowTeamDamage, sourceSlot: proj.sourceSlot, damageKind: 'direct' });
            this.applyProjectileBurn(player.id, proj);
          }
          if ((proj.penetrationRemaining ?? 0) > 0) {
            proj.penetrationRemaining = (proj.penetrationRemaining ?? 0) - 1;
            proj.damage *= proj.penetrationDamageRetention ?? 1;
            continue;
          }
          this.projectileManager.destroyProjectile(proj.id);
          return true;
        }

        if (proj.piercesTargets) {
          // Wie gegen Gegner: jeder Spieler zählt genau einmal, das Projektil fliegt weiter.
          if (!proj.piercingHitIds) proj.piercingHitIds = new Set();
          if (proj.piercingHitIds.has(player.id)) continue;
          proj.piercingHitIds.add(player.id);
          if (canDealDamage) {
            this.applyDamage(player.id, actualDamage, false, proj.ownerId, proj.sourceId, {
              sourceX: proj.sprite.x,
              sourceY: proj.sprite.y,
              dirX: proj.body.velocity.x,
              dirY: proj.body.velocity.y,
            }, {
              allowTeamDamage: proj.allowTeamDamage,
              sourceSlot: proj.sourceSlot,
              damageKind: 'direct',
            });
            this.applyProjectileBurn(player.id, proj);
          }
          continue;
        }

        if (proj.isBfg || proj.projectileStyle === 'gauss') {
          // Piercing-Projektile: Spieler nur 1x treffen, Projektil fliegt weiter.
          if (!proj.bfgHitPlayers) proj.bfgHitPlayers = new Set();
          if (proj.projectileStyle === 'gauss') {
            if (!proj.gaussHitPlayers) proj.gaussHitPlayers = new Set();
            if (proj.gaussHitPlayers.has(player.id)) continue;
            proj.gaussHitPlayers.add(player.id);
          } else {
            if (proj.bfgHitPlayers.has(player.id)) continue;
            proj.bfgHitPlayers.add(player.id);
          }
          this.applyDamage(player.id, actualDamage, false, proj.ownerId, proj.sourceId, {
            sourceX: proj.sprite.x,
            sourceY: proj.sprite.y,
            dirX: proj.body.velocity.x,
            dirY: proj.body.velocity.y,
          }, {
            allowTeamDamage: proj.allowTeamDamage,
            sourceSlot: proj.sourceSlot,
            damageKind: 'direct',
          });
          if (proj.projectileStyle === 'gauss') this.resolveGaussDischarge(proj, player.id, undefined, actualDamage);
          continue; // kein break, kein destroyProjectile
        }

        if (proj.isFlame && proj.flamePierceHitIds !== undefined) {
          if (proj.flamePierceHitIds.has(player.id)) continue;
          proj.flamePierceHitIds.add(player.id);
          if (canDealDamage) {
            this.applyBurnHit(
              player.id,
              proj.ownerId,
              proj.burnDurationMs ?? 0,
              proj.burnDamagePerTick ?? 0,
              `weapon:${proj.sourceId}`,
              proj.sourceId,
              'flamethrower_direct',
            );
            this.applyDamage(player.id, actualDamage, false, proj.ownerId, proj.sourceId, { sourceX: proj.sprite.x, sourceY: proj.sprite.y, dirX: proj.body.velocity.x, dirY: proj.body.velocity.y }, { allowTeamDamage: proj.allowTeamDamage, sourceSlot: proj.sourceSlot, damageKind: 'direct' });
          }
          continue;
        }

        // Brennende Treffer (Flammenwerfer-Hitbox, brennende Kugeln, …) werden
        // zentral in handleHit aus den Burn-Feldern des Projektils angewendet.
        this.handleHit(proj.id, player.id, actualDamage, proj.ownerId, proj.adrenalinGain, proj.sourceId, canDealDamage);
        return true;  // Projektil trifft maximal einen Spieler pro Frame
      }
    }
    return false;
  }

  /** AABB-Treffer gegen Gegner (Coop-Defense). Liefert true, wenn das Projektil verbraucht ist. */
  private resolveProjectileEnemyHits(proj: TrackedProjectile, projBounds: Phaser.Geom.Rectangle, nowMs: number): boolean {
    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      if (proj.ownerId === enemy.id) continue;
      if (proj.multiExplosionExcludedTargetKeys?.has(`enemies:${enemy.id}`)) continue;

      const enemyBounds = enemy.sprite.getBounds();
      if (proj.plasmaSwarmOriginEnemyId === enemy.id) {
        const stillInsideOrigin = Phaser.Geom.Intersects.RectangleToRectangle(projBounds, enemyBounds);
        if (shouldIgnorePlasmaSwarmOriginHit(
          proj,
          proj.plasmaSwarmOriginEnemyId,
          enemy.id,
          !stillInsideOrigin,
        )) {
          continue;
        }
        if (!stillInsideOrigin) proj.plasmaSwarmOriginEnemyId = undefined;
      }

      if (!this.canDamageTarget(proj.ownerId, enemy.id, proj.allowTeamDamage)) continue;

      if (Phaser.Geom.Intersects.RectangleToRectangle(projBounds, enemyBounds)) {
        if (proj.energyInjectorPayload) {
          this.onEnergyInjectorTargetHit?.('enemy', enemy.id, enemy.sprite.x, enemy.sprite.y, proj);
          this.projectileManager.destroyProjectile(proj.id);
          return true;
        }
        const actualDamage = this.computeProjectileDamage(proj);
        const enemyKey = `enemy_${enemy.id}`;

        if (proj.penetrationHitIds) {
          if (proj.penetrationHitIds.has(enemyKey)) continue;
          proj.penetrationHitIds.add(enemyKey);
          const impact = this.resolveAk47DirectEnemyHit(proj, enemy.id, nowMs);
          const impactDamage = actualDamage * impact.damageMultiplier;
          this.registerAk47Hit(proj, nowMs);
          this.applyProjectileBurn(enemy.id, proj);
          this.applyDamage(enemy.id, impactDamage, false, proj.ownerId, proj.sourceId, { sourceX: proj.sprite.x, sourceY: proj.sprite.y, dirX: proj.body.velocity.x, dirY: proj.body.velocity.y }, { allowTeamDamage: proj.allowTeamDamage, sourceSlot: proj.sourceSlot, damageKind: 'direct' });
          this.applyAk47TargetExplosion(proj, enemy.id, impactDamage, impact);
          if ((proj.penetrationRemaining ?? 0) > 0) {
            proj.penetrationRemaining = (proj.penetrationRemaining ?? 0) - 1;
            proj.damage *= proj.penetrationDamageRetention ?? 1;
            continue;
          }
          this.projectileManager.destroyProjectile(proj.id);
          return true;
        }

        const asmdProximityPiercing = proj.projectileStyle === 'energy_ball'
          && (proj.proximityPulse?.radius ?? 0) > 0
          && (proj.proximityPulse?.damage ?? 0) > 0;
        if (proj.piercesTargets || asmdProximityPiercing) {
          // Durchschlag gilt nur gegen logische Kampfziele. Felsen und Zug bleiben in
          // ProjectileManager normale Weltblocker und verbrauchen das Projektil dort
          // weiterhin – das gilt für ASMD_SEC ebenso wie für die Gewitterentladung.
          if (!proj.piercingHitIds) proj.piercingHitIds = new Set();
          if (proj.piercingHitIds.has(enemy.id)) continue;
          proj.piercingHitIds.add(enemy.id);
          this.applyDamage(enemy.id, actualDamage, false, proj.ownerId, proj.sourceId, {
            sourceX: proj.sprite.x,
            sourceY: proj.sprite.y,
            dirX: proj.body.velocity.x,
            dirY: proj.body.velocity.y,
          }, {
            sourceSlot: proj.sourceSlot,
            damageKind: 'direct',
          });
          continue;
        }

        if (proj.isBfg || proj.projectileStyle === 'gauss') {
          this.registerAk47Hit(proj, nowMs);
          if (!proj.bfgHitPlayers) proj.bfgHitPlayers = new Set();
          if (proj.projectileStyle === 'gauss') {
            if (!proj.gaussHitPlayers) proj.gaussHitPlayers = new Set();
            if (proj.gaussHitPlayers.has(enemyKey)) continue;
            proj.gaussHitPlayers.add(enemyKey);
          } else {
            if (proj.bfgHitPlayers.has(enemyKey)) continue;
            proj.bfgHitPlayers.add(enemyKey);
          }
          this.applyDamage(enemy.id, actualDamage, false, proj.ownerId, proj.sourceId, {
            sourceX: proj.sprite.x,
            sourceY: proj.sprite.y,
            dirX: proj.body.velocity.x,
            dirY: proj.body.velocity.y,
          }, {
            allowTeamDamage: proj.allowTeamDamage,
            sourceSlot: proj.sourceSlot,
            damageKind: 'direct',
          });
          if (proj.projectileStyle === 'gauss') this.resolveGaussDischarge(proj, undefined, enemy.id, actualDamage);
          continue;
        }

        if (proj.isFlame && proj.flamePierceHitIds !== undefined) {
          this.registerAk47Hit(proj, nowMs);
          const enemyKey = `enemy_${enemy.id}`;
          if (proj.flamePierceHitIds.has(enemyKey)) continue;
          proj.flamePierceHitIds.add(enemyKey);
          this.applyBurnHit(
            enemy.id,
            proj.ownerId,
            proj.burnDurationMs ?? 0,
            proj.burnDamagePerTick ?? 0,
            `weapon:${proj.sourceId}`,
            proj.sourceId,
            'flamethrower_direct',
          );
          this.applyDamage(enemy.id, actualDamage, false, proj.ownerId, proj.sourceId, { sourceX: proj.sprite.x, sourceY: proj.sprite.y, dirX: proj.body.velocity.x, dirY: proj.body.velocity.y }, { allowTeamDamage: proj.allowTeamDamage, sourceSlot: proj.sourceSlot, damageKind: 'direct' });
          continue;
        }

        // Brennende Treffer werden zentral in handleEnemyHit angewendet.
        const impact = this.resolveAk47DirectEnemyHit(proj, enemy.id, nowMs);
        this.registerAk47Hit(proj, nowMs);
        this.handleEnemyHit(proj.id, enemy.id, actualDamage * impact.damageMultiplier, proj.ownerId, proj.adrenalinGain, proj.sourceId, impact);
        return true;
      }
    }
    return false;
  }

  /** AABB-Treffer gegen Decoys. Liefert true, wenn das Projektil verbraucht ist. */
  private resolveProjectileDecoyHits(proj: TrackedProjectile, projBounds: Phaser.Geom.Rectangle, nowMs: number): boolean {
    for (const decoy of this.decoySystem?.getHostTargets() ?? []) {
      if (proj.ownerId === decoy.ownerId) continue;

      if (Phaser.Geom.Intersects.RectangleToRectangle(projBounds, decoy.sprite.getBounds())) {
        const actualDamage = this.computeProjectileDamage(proj);
        const decoyKey = `decoy_${decoy.id}`;
        this.registerAk47Hit(proj, nowMs);

        if (proj.penetrationHitIds) {
          if (proj.penetrationHitIds.has(decoyKey)) continue;
          proj.penetrationHitIds.add(decoyKey);
          this.decoySystem?.applyDamage(decoy.id, actualDamage, proj.ownerId, proj.sourceId, { sourceX: proj.sprite.x, sourceY: proj.sprite.y, dirX: proj.body.velocity.x, dirY: proj.body.velocity.y });
          if ((proj.penetrationRemaining ?? 0) > 0) {
            proj.penetrationRemaining = (proj.penetrationRemaining ?? 0) - 1;
            proj.damage *= proj.penetrationDamageRetention ?? 1;
            continue;
          }
          this.projectileManager.destroyProjectile(proj.id);
          return true;
        }

        if (proj.isBfg || proj.projectileStyle === 'gauss') {
          if (!proj.bfgHitPlayers) proj.bfgHitPlayers = new Set();
          if (proj.projectileStyle === 'gauss') {
            if (!proj.gaussHitPlayers) proj.gaussHitPlayers = new Set();
            if (proj.gaussHitPlayers.has(decoyKey)) continue;
            proj.gaussHitPlayers.add(decoyKey);
          } else {
            if (proj.bfgHitPlayers.has(decoyKey)) continue;
            proj.bfgHitPlayers.add(decoyKey);
          }

          const hit = this.decoySystem?.applyDamage(decoy.id, actualDamage, proj.ownerId, proj.sourceId, {
            sourceX: proj.sprite.x,
            sourceY: proj.sprite.y,
            dirX: proj.body.velocity.x,
            dirY: proj.body.velocity.y,
          }) ?? false;
          if (hit && proj.adrenalinGain > 0) {
            this.resourceSystem?.addAdrenaline(proj.ownerId, proj.adrenalinGain);
          }
          continue;
        }

        this.handleDecoyHit(proj.id, decoy.id, actualDamage, proj.ownerId, proj.adrenalinGain, proj.sourceId);
        return true;
      }
    }
    return false;
  }

  private shouldUseContinuousProjectileCollision(proj: TrackedProjectile): boolean {
    return proj.projectileStyle === 'bullet' || proj.projectileStyle === 'awp';
  }

  private resolveGaussDischarge(proj: TrackedProjectile, hitPlayerId: string | undefined, hitEnemyId: string | undefined, damage: number): void {
    const radius = proj.gaussChainRadius ?? 0;
    const factor = proj.gaussChainDamageFactor ?? 0;
    if (radius <= 0 || factor <= 0) return;
    this.resolveChainLightning({
      shooterId: proj.ownerId,
      originX: proj.sprite.x,
      originY: proj.sprite.y,
      baseDamage: damage,
      chainCfg: { maxJumps: 1, searchRadius: radius, damageFalloffPerJump: 1 - factor, targetPlayers: true, targetEnemies: true, targetDecoys: false },
      sourceId: 'weapon.gauss.discharge',
      adrenalinGain: 0,
      playerColor: proj.ownerColor ?? proj.color,
      visualPreset: 'asmd_primary',
      baseThickness: 2,
      visitedPlayers: new Set(hitPlayerId ? [hitPlayerId] : []),
      visitedEnemies: new Set(hitEnemyId ? [hitEnemyId] : []),
      visitedDecoys: new Set(),
    });
  }

  private tryResolveContinuousProjectileHit(proj: TrackedProjectile, nowMs: number): boolean {
    const line = new Phaser.Geom.Line(proj.lastX, proj.lastY, proj.sprite.x, proj.sprite.y);
    const travelDistance = Phaser.Geom.Line.Length(line);
    if (travelDistance <= 0.5) return false;

    const blockerDistance = this.findNearestProjectilePathBlockerDistance(line, proj.penetratesRocks === true);
    const projectileRadius = Math.max(proj.sprite.displayWidth, proj.sprite.displayHeight) * 0.5;
    let bestHit: SweptProjectileHit | null = null;

    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isAlive(player.id)) continue;
      if (proj.ownerId === player.id) continue;
      if (this.burrowSystem?.isBurrowed(player.id)) continue;
      if (proj.penetrationHitIds?.has(player.id)) continue;
      if (!this.canDamageTarget(proj.ownerId, player.id, proj.allowTeamDamage)) continue;

       const hit = resolveProjectileTargetImpact({
         startX: line.x1,
         startY: line.y1,
         endX: line.x2,
         endY: line.y2,
         targetX: player.x,
         targetY: player.y,
         radius: PLAYER_SIZE * 0.5 + projectileRadius,
         ignoreStartingOverlap: true,
       });
      if (!hit) continue;
      if (blockerDistance !== null && blockerDistance < hit.distance - 0.75) continue;
      if (!bestHit || hit.distance < bestHit.distance) {
        bestHit = { kind: 'player', playerId: player.id, distance: hit.distance, x: hit.x, y: hit.y };
      }
    }

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      if (proj.ownerId === enemy.id) continue;
      if (proj.penetrationHitIds?.has(`enemy_${enemy.id}`)) continue;
      if (!this.canDamageTarget(proj.ownerId, enemy.id, proj.allowTeamDamage)) continue;

      const enemyRadius = Math.max(enemy.sprite.displayWidth, enemy.sprite.displayHeight) * 0.5 + projectileRadius;
       const hit = resolveProjectileTargetImpact({
         startX: line.x1,
         startY: line.y1,
         endX: line.x2,
         endY: line.y2,
         targetX: enemy.sprite.x,
         targetY: enemy.sprite.y,
         radius: enemyRadius,
         ignoreStartingOverlap: true,
       });
      if (!hit) continue;
      if (blockerDistance !== null && blockerDistance < hit.distance - 0.75) continue;
      if (!bestHit || hit.distance < bestHit.distance) {
        bestHit = { kind: 'enemy', enemyId: enemy.id, distance: hit.distance, x: hit.x, y: hit.y };
      }
    }

    for (const decoy of this.decoySystem?.getHostTargets() ?? []) {
      if (proj.ownerId === decoy.ownerId) continue;
      if (proj.penetrationHitIds?.has(`decoy_${decoy.id}`)) continue;

      const decoyRadius = Math.max(decoy.sprite.displayWidth, decoy.sprite.displayHeight) * 0.5 + projectileRadius;
       const hit = resolveProjectileTargetImpact({
         startX: line.x1,
         startY: line.y1,
         endX: line.x2,
         endY: line.y2,
         targetX: decoy.sprite.x,
         targetY: decoy.sprite.y,
         radius: decoyRadius,
         ignoreStartingOverlap: true,
       });
      if (!hit) continue;
      if (blockerDistance !== null && blockerDistance < hit.distance - 0.75) continue;
      if (!bestHit || hit.distance < bestHit.distance) {
        bestHit = { kind: 'decoy', decoyId: decoy.id, distance: hit.distance, x: hit.x, y: hit.y };
      }
    }

    if (!bestHit) return false;

    const vx = proj.body.velocity.x;
    const vy = proj.body.velocity.y;
    proj.body.reset(bestHit.x, bestHit.y);
    proj.body.setVelocity(vx, vy);

    const actualDamage = this.computeProjectileDamage(proj);

    if (bestHit.kind === 'player') {
      const canDealDamage = this.canDamageTarget(proj.ownerId, bestHit.playerId, proj.allowTeamDamage);

      if (canDealDamage && this.shouldBlockWithShield(bestHit.playerId, 'projectile', actualDamage, bestHit.x, bestHit.y)) {
        const reflectionFactor = proj.reflected ? 0 : (this.energyShieldSystem?.getReflectionDamageFactor(bestHit.playerId) ?? 0);
        if (reflectionFactor > 0) {
          const speed = Math.hypot(proj.body.velocity.x, proj.body.velocity.y);
          const angle = Math.atan2(-proj.body.velocity.y, -proj.body.velocity.x);
          this.projectileManager.spawnProjectile(bestHit.x, bestHit.y, angle, bestHit.playerId, {
            ...this.inheritedProjectileEffects(proj),
            speed,
            size: Math.max(1, proj.sprite.displayWidth),
            damage: proj.damage * reflectionFactor,
            color: proj.color,
            ownerColor: proj.ownerColor,
            lifetime: Math.max(1, proj.lifetime - (Date.now() - proj.createdAt)),
            maxBounces: 0,
            isGrenade: false,
            adrenalinGain: 0,
            sourceId: 'environment.reflector',
            projectileStyle: proj.projectileStyle,
            bulletVisualPreset: proj.bulletVisualPreset,
            tracerConfig: proj.tracerConfig,
            reflected: true,
            sourceSlot: 'weapon2',
          });
        }
        this.projectileManager.destroyProjectile(proj.id);
        return true;
      }

      if (canDealDamage) this.registerAk47Hit(proj, nowMs);

      if (proj.penetrationHitIds) {
        proj.penetrationHitIds.add(bestHit.playerId);
        if (canDealDamage) {
          this.applyDamage(bestHit.playerId, actualDamage, false, proj.ownerId, proj.sourceId, { sourceX: bestHit.x, sourceY: bestHit.y, dirX: vx, dirY: vy }, { allowTeamDamage: proj.allowTeamDamage, sourceSlot: proj.sourceSlot, damageKind: 'direct' });
          this.applyProjectileBurn(bestHit.playerId, proj);
        }
        if ((proj.penetrationRemaining ?? 0) > 0) {
          proj.penetrationRemaining = (proj.penetrationRemaining ?? 0) - 1;
          proj.damage *= proj.penetrationDamageRetention ?? 1;
          return true;
        }
        this.projectileManager.destroyProjectile(proj.id);
        return true;
      }

      this.handleHit(proj.id, bestHit.playerId, actualDamage, proj.ownerId, proj.adrenalinGain, proj.sourceId, canDealDamage);
      return true;
    }

    if (bestHit.kind === 'enemy') {
      if (proj.penetrationHitIds) {
        const enemyKey = `enemy_${bestHit.enemyId}`;
        if (proj.penetrationHitIds.has(enemyKey)) return true;
        proj.penetrationHitIds.add(enemyKey);
        const impact = this.resolveAk47DirectEnemyHit(proj, bestHit.enemyId, nowMs);
        const impactDamage = actualDamage * impact.damageMultiplier;
        this.registerAk47Hit(proj, nowMs);
        this.applyDamage(bestHit.enemyId, impactDamage, false, proj.ownerId, proj.sourceId, { sourceX: bestHit.x, sourceY: bestHit.y, dirX: vx, dirY: vy }, { allowTeamDamage: proj.allowTeamDamage, sourceSlot: proj.sourceSlot, damageKind: 'direct' });
        this.applyProjectileBurn(bestHit.enemyId, proj);
        this.applyAk47TargetExplosion(proj, bestHit.enemyId, impactDamage, impact);
        if ((proj.penetrationRemaining ?? 0) > 0) {
          proj.penetrationRemaining = (proj.penetrationRemaining ?? 0) - 1;
          proj.damage *= proj.penetrationDamageRetention ?? 1;
          return true;
        }
        this.projectileManager.destroyProjectile(proj.id);
        return true;
      }
      const impact = this.resolveAk47DirectEnemyHit(proj, bestHit.enemyId, nowMs);
      this.registerAk47Hit(proj, nowMs);
      this.handleEnemyHit(proj.id, bestHit.enemyId, actualDamage * impact.damageMultiplier, proj.ownerId, proj.adrenalinGain, proj.sourceId, impact);
      return true;
    }

    this.registerAk47Hit(proj, nowMs);
    if (proj.penetrationHitIds) {
      proj.penetrationHitIds.add(`decoy_${bestHit.decoyId}`);
      this.decoySystem?.applyDamage(bestHit.decoyId, actualDamage, proj.ownerId, proj.sourceId, { sourceX: bestHit.x, sourceY: bestHit.y, dirX: vx, dirY: vy });
      if ((proj.penetrationRemaining ?? 0) > 0) {
        proj.penetrationRemaining = (proj.penetrationRemaining ?? 0) - 1;
        proj.damage *= proj.penetrationDamageRetention ?? 1;
        return true;
      }
      this.projectileManager.destroyProjectile(proj.id);
      return true;
    }
    this.handleDecoyHit(proj.id, bestHit.decoyId, actualDamage, proj.ownerId, proj.adrenalinGain, proj.sourceId);
    return true;
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

  resolveHitscanShot(
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
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
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
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
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
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      const hit = this.decoySystem?.applyDamage(trace.hitDecoyId, actualDamage, shooterId, sourceId, {
        sourceX: startX,
        sourceY: startY,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      }) ?? false;

      if (hit && adrenalinGain > 0) {
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
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
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
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
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
      const friendly = targetId === shooterId || !this.canDamageTarget(shooterId, targetId);
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
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
      const powerUpMult = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = effect.damagePerHit * loadoutMult * powerUpMult;
      if (actualDamage <= 0) return;
      const hit = this.decoySystem?.applyDamage(trace.hitDecoyId, actualDamage, shooterId, sourceId, {
        sourceX: startX,
        sourceY: startY,
        dirX,
        dirY,
      }) ?? false;
      if (hit && adrenalinGain > 0) this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
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
          for (const proj of this.projectileManager.getActiveProjectiles()) {
            if (!proj.detonable || !detonableTags.includes(proj.detonable.tag)) continue;
            if (!proj.detonable.allowCrossTeam && proj.ownerId !== opts.shooterId) continue;
            candidates.push({
              id: `detonable:${proj.id}`,
              kind: 'detonable',
              x: proj.sprite.x,
              y: proj.sprite.y,
            });
          }
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
  resolveMeleeSwing(
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
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
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
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
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
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      const hit = this.decoySystem?.applyDamage(decoy.id, actualDamage, shooterId, sourceId, {
        sourceX: x,
        sourceY: y,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      }) ?? false;
      if (!hit) continue;

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
  applyBaseDamage(
    baseId: string,
    damage: number,
    attackerId: string,
    sourceSlot?: LoadoutSlot,
    baseDamageMult = 1,
  ): void {
    if (damage <= 0 || baseDamageMult <= 0) return;
    const runtimeDamage = damage * baseDamageMult
      * this.getPlayerRuntimeDamageMultiplier(attackerId, sourceSlot);
    const outgoing = this.playerOutgoingDamageResolver?.(
      attackerId,
      `base:${baseId}`,
      runtimeDamage,
      true,
      sourceSlot,
    ) ?? { amount: runtimeDamage, isCritical: false };
    const resolvedDamage = Math.max(0, outgoing.amount)
      * this.getTargetIncomingDamageMultiplier({ targetType: 'base', targetId: baseId });
    if (resolvedDamage <= 0) return;
    if (this.baseDamageCallback) this.baseDamageCallback(baseId, resolvedDamage, attackerId, sourceSlot);
    else this.baseManager?.applyDamage(baseId, resolvedDamage);
  }

  /**
   * Wendet ausgehenden und zielseitigen Schaden auf eine hostautoritäre Struktur an, ohne
   * den konkreten Lifecycle des Objekts in den CombatSystem zu ziehen. Der Aufrufer entscheidet
   * anschliessend, ob es ein Fels, Konstrukt, Aussenposten oder eine andere Struktur war.
   */
  resolveExternalTargetDamage(
    target: TargetStatusTarget,
    damage: number,
    attackerId: string,
    sourceSlot?: LoadoutSlot,
  ): number {
    if (damage <= 0) return 0;
    const outgoing = this.playerOutgoingDamageResolver?.(
      attackerId,
      `${target.targetType}:${target.targetId}`,
      damage,
      false,
      sourceSlot,
    ) ?? { amount: damage, isCritical: false };
    return Math.max(0, outgoing.amount) * this.getTargetIncomingDamageMultiplier(target);
  }

  /**
   * Radialschaden auf feindliche Basen. Nur Spieler-Quellen treffen hier; Zombie-Luftangriffe
   * laufen weiter ueber ihren eigenen, auf eigene Basen begrenzten Pfad.
   */
  applyRadialHostileBaseDamage(
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
        && this.energyShieldSystem?.tryDomeProtect(targetX, targetY, null, actualDamage, Date.now())
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

  private handleHit(
    projectileId:  number,
    playerId:      string,
    damage:        number,
    shooterId:     string,
    adrenalinGain: number,
    sourceId:    string,
    allowDamage = true,
  ): void {
    const projectile = this.projectileManager.getProjectileById(projectileId);
    const leafBlowerImpulse = projectile ? this.createLeafBlowerImpulse(projectile, playerId) : null;
    const visualContext: DamageVisualContext | undefined = projectile
      ? {
          sourceX: projectile.sprite.x,
          sourceY: projectile.sprite.y,
          dirX: projectile.body.velocity.x,
          dirY: projectile.body.velocity.y,
          projectileColor: projectile.color,
        }
      : undefined;
    if (projectile?.impactCloud) {
      this.onProjectileImpact?.(projectileId, projectile.sprite.x, projectile.sprite.y);
    }
    if (allowDamage && this.hasEnemyHitExplosion(projectile)) {
      // Explosion nur bei tatsächlichem Treffer auf einen gültigen Gegner (z.B. XXX-BOW Explosivbolzen).
      this.projectileManager.triggerEnemyImpactExplosion(projectileId);
    } else if (projectile?.explosion) {
      this.projectileManager.triggerProjectileExplosion(projectileId, `players:${playerId}`);
    } else {
      this.projectileManager.destroyProjectile(projectileId);
    }
    if (allowDamage) {
      this.applyProjectileBurn(playerId, projectile);
      this.applyProjectileVulnerability({ targetType: 'player', targetId: playerId }, projectile);
      this.applyDamage(playerId, damage, false, shooterId, sourceId, visualContext, {
        sourceSlot: projectile?.sourceSlot,
        damageKind: 'direct',
      });
      if (leafBlowerImpulse && this.isAlive(playerId)) {
        this.onPlayerImpulse?.(playerId, leafBlowerImpulse.vx, leafBlowerImpulse.vy, leafBlowerImpulse.durationMs, shooterId);
      }
    }

    // Adrenalin-Belohnung für den Schützen
    if (allowDamage && adrenalinGain > 0) {
      this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
    }
  }

  private handleEnemyHit(
    projectileId: number,
    enemyId: string,
    damage: number,
    shooterId: string,
    adrenalinGain: number,
    sourceId: string,
    ak47Impact?: Ak47DirectEnemyHitImpact,
  ): void {
    const projectile = this.projectileManager.getProjectileById(projectileId);
    const leafBlowerImpulse = projectile ? this.createLeafBlowerImpulse(projectile, enemyId) : null;
    const projectileHitImpulse = projectile ? this.createProjectileHitImpulse(projectile, enemyId) : null;
    const visualContext = projectile
      ? {
          sourceX: projectile.sprite.x,
          sourceY: projectile.sprite.y,
          dirX: projectile.body.velocity.x,
          dirY: projectile.body.velocity.y,
          projectileColor: projectile.color,
        }
      : undefined;
    if (projectile?.impactCloud) {
      this.onProjectileImpact?.(projectileId, projectile.sprite.x, projectile.sprite.y);
    }
    // Plasma-Aufladung und Schwarm werden vor dem Cleanup des Primärprojektils aufgelöst,
    // damit die aktuell aufgelösten Visual-/Homing-/Projektilwerte noch live verfügbar sind.
    if (projectile && canTriggerPlasmaSwarm(projectile)) {
      this.applyPlasmaChargeAndSpawnSwarm(projectile, enemyId);
    }
    if (this.hasEnemyHitExplosion(projectile)) {
      // Explosion nur bei Gegner-Treffer (z.B. XXX-BOW Explosivbolzen).
      this.projectileManager.triggerEnemyImpactExplosion(projectileId);
    } else if (projectile?.explosion) {
      this.projectileManager.triggerProjectileExplosion(projectileId, `enemies:${enemyId}`);
    } else {
      this.projectileManager.destroyProjectile(projectileId);
    }

    const slowFraction = projectile?.hitSlowFraction ?? projectile?.shotgunSlowFraction ?? 0;
    const slowDurationMs = projectile?.hitSlowDurationMs ?? projectile?.shotgunSlowDurationMs ?? 0;
    if (slowFraction > 0 && slowDurationMs > 0) {
      this.applyEnemySlow(enemyId, slowFraction, slowDurationMs);
    }
    this.applyProjectileVulnerability({ targetType: 'enemy', targetId: enemyId }, projectile);
    this.applyProjectileBurn(enemyId, projectile);
    this.applyDamage(enemyId, damage, false, shooterId, sourceId, visualContext, {
      sourceSlot: projectile?.sourceSlot,
      damageKind: 'direct',
    });
    if (projectile && ak47Impact) {
      this.applyAk47TargetExplosion(projectile, enemyId, damage, ak47Impact);
    }
    if (leafBlowerImpulse && this.enemyManager?.hasEnemy(enemyId)) {
      this.onEnemyImpulse?.(enemyId, leafBlowerImpulse.vx, leafBlowerImpulse.vy, leafBlowerImpulse.durationMs, shooterId);
    }
    if (projectileHitImpulse && this.enemyManager?.hasEnemy(enemyId)) {
      this.onEnemyImpulse?.(enemyId, projectileHitImpulse.vx, projectileHitImpulse.vy, projectileHitImpulse.durationMs, shooterId);
    }

    if (adrenalinGain > 0) {
      this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
    }
  }

  private applyPlasmaChargeAndSpawnSwarm(projectile: TrackedProjectile, enemyId: string): void {
    const enemy = this.enemyManager?.getEnemy(enemyId);
    if (!enemy) return;

    const charge = this.plasmaChargeTracker.addHit(enemyId, Date.now());
    enemy.updatePlasmaChargeStacks(charge.stacks);

    const procCount = resolvePlasmaSwarmProjectileCount(
      charge.stacks * PLASMA_SWARM_CHANCE_PER_STACK_PERCENT,
    );
    if (procCount <= 0) return;

    const normalSpeed = Math.max(1, projectile.initialSpeed ?? projectile.body.velocity.length());
    const normalSize = Math.max(1, projectile.sprite.displayWidth);
    const normalDamage = Math.max(0, projectile.damage);
    const normalRange = Math.max(1, (projectile.lifetime * normalSpeed) / 1000);
    const explosionRadius = Math.max(
      1,
      projectile.plasmaSwarmExplosionRadius ?? PLASMA_SWARM_BASE_EXPLOSION_RADIUS,
    );
    const explosionDamage = Math.max(
      0,
      projectile.plasmaSwarmExplosionDamage ?? PLASMA_SWARM_BASE_EXPLOSION_DAMAGE,
    );
    const explosionSlowFraction = Math.max(0, projectile.plasmaSwarmExplosionSlowFraction ?? 0);

    this.projectileManager.queueStandaloneExplosion(
      enemy.sprite.x,
      enemy.sprite.y,
      projectile.ownerId,
      {
        radius: explosionRadius,
        maxDamage: explosionDamage,
        minDamage: explosionDamage,
        knockback: 0,
        selfDamageMult: 0,
        damageTarget: 'enemies',
        enemySlowFraction: explosionSlowFraction,
        enemySlowDurationMs: PLASMA_SWARM_EXPLOSION_DURATION_MS,
        baseDamageMult: 1,
        rockDamageMult: 1,
        trainDamageMult: 0,
        color: projectile.color,
        visualStyle: 'energy',
      },
      projectile.sourceSlot ?? 'weapon1',
      `${projectile.sourceId}:swarm-explosion`,
    );

    const projectileCount = Math.max(
      PLASMA_SWARM_BASE_PROJECTILE_COUNT,
      Math.floor(projectile.plasmaSwarmProjectileCount ?? PLASMA_SWARM_BASE_PROJECTILE_COUNT),
    );
    const swarmProfile = resolvePlasmaSwarmProjectileProfile({
      damage: normalDamage,
      size: normalSize,
      speed: normalSpeed,
      range: normalRange,
    });
    const swarmSpeed = Math.max(1, swarmProfile.speed);
    const swarmSize = Math.max(1, swarmProfile.size);
    const swarmDamage = swarmProfile.damage;
    const swarmLifetime = Math.max(1, (swarmProfile.range / swarmSpeed) * 1000);
    const angles = resolvePlasmaSwarmRadialAngles(projectileCount);

    for (const angle of angles) {
      this.projectileManager.spawnProjectile(enemy.sprite.x, enemy.sprite.y, angle, projectile.ownerId, {
        speed: swarmSpeed,
        size: swarmSize,
        damage: swarmDamage,
        color: projectile.color,
        ownerColor: projectile.ownerColor,
        projectileVisualScale: projectile.projectileVisualScale,
        lifetime: swarmLifetime,
        remainingRangePx: swarmProfile.range,
        maxBounces: 0,
        isGrenade: false,
        adrenalinGain: 0,
        sourceId: 'weapon.plasma.swarm',
        homing: resolvePlasmaSwarmHoming(projectile.homing),
        projectileStyle: projectile.projectileStyle,
        energyBallVariant: projectile.energyBallVariant,
        tracerConfig: projectile.tracerConfig,
        allowTeamDamage: projectile.allowTeamDamage,
        baseDamageMult: projectile.baseDamageMult,
        suppressSpawnFx: true,
        plasmaSwarmProjectile: true,
        plasmaSwarmOriginEnemyId: enemyId,
        sourceSlot: projectile.sourceSlot ?? 'weapon1',
      });
    }
  }

  private handleDecoyHit(
    projectileId: number,
    decoyId: number,
    damage: number,
    shooterId: string,
    adrenalinGain: number,
    sourceId: string,
  ): void {
    const projectile = this.projectileManager.getProjectileById(projectileId);
    const visualContext = projectile
      ? {
          sourceX: projectile.sprite.x,
          sourceY: projectile.sprite.y,
          dirX: projectile.body.velocity.x,
          dirY: projectile.body.velocity.y,
        }
      : undefined;
    if (projectile?.impactCloud) {
      this.onProjectileImpact?.(projectileId, projectile.sprite.x, projectile.sprite.y);
    }
    if (projectile?.explosion) {
      this.projectileManager.triggerProjectileExplosion(projectileId);
    } else {
      this.projectileManager.destroyProjectile(projectileId);
    }
    this.decoySystem?.applyDamage(decoyId, damage, shooterId, sourceId, visualContext);

    if (adrenalinGain > 0) {
      this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
    }
  }

  /** Setzt die zentrale Verwundbarkeit, wenn das treffende Projektil sie mitfuehrt. */
  private applyProjectileVulnerability(
    target: TargetStatusTarget,
    projectile: TrackedProjectile | undefined,
  ): void {
    const durationMs = projectile?.hitVulnerabilityDurationMs ?? 0;
    if (durationMs > 0) this.onApplyVulnerability?.(target, durationMs);
  }

  private createLeafBlowerImpulse(
    projectile: TrackedProjectile,
    targetId: string,
  ): { vx: number; vy: number; durationMs: number } | null {
    const minKnockback = projectile.leafBlowerMinKnockback;
    const maxKnockback = projectile.leafBlowerMaxKnockback;
    if (minKnockback === undefined || maxKnockback === undefined || maxKnockback <= 0) return null;

    const startSize = projectile.body.width;
    const maxSize = projectile.hitboxMaxSize ?? startSize;
    const spread = Math.max(maxSize - startSize, 0.0001);
    const progress = Phaser.Math.Clamp((projectile.sprite.displayWidth - startSize) / spread, 0, 1);
    const magnitude = Phaser.Math.Linear(maxKnockback, minKnockback, progress);
    if (magnitude <= 0) return null;

    const player = this.playerManager.getPlayer(targetId);
    const enemy = this.enemyManager?.getEnemy(targetId);
    const targetX = player?.x ?? enemy?.sprite.x ?? projectile.sprite.x;
    const targetY = player?.y ?? enemy?.sprite.y ?? projectile.sprite.y;
    const fallbackDx = targetX - projectile.sprite.x;
    const fallbackDy = targetY - projectile.sprite.y;
    const velocityLen = Math.hypot(projectile.body.velocity.x, projectile.body.velocity.y);
    const fallbackLen = Math.hypot(fallbackDx, fallbackDy);
    const dirX = velocityLen > 0.001
      ? projectile.body.velocity.x / velocityLen
      : (fallbackLen > 0.001 ? fallbackDx / fallbackLen : 0);
    const dirY = velocityLen > 0.001
      ? projectile.body.velocity.y / velocityLen
      : (fallbackLen > 0.001 ? fallbackDy / fallbackLen : -1);

    return {
      vx: dirX * magnitude,
      vy: dirY * magnitude,
      durationMs: 220,
    };
  }

  private createProjectileHitImpulse(
    projectile: TrackedProjectile,
    targetId: string,
  ): { vx: number; vy: number; durationMs: number } | null {
    const magnitude = projectile.hitKnockback ?? 0;
    if (magnitude <= 0) return null;

    const enemy = this.enemyManager?.getEnemy(targetId);
    const fallbackDx = (enemy?.sprite.x ?? projectile.sprite.x) - projectile.sprite.x;
    const fallbackDy = (enemy?.sprite.y ?? projectile.sprite.y) - projectile.sprite.y;
    const velocityLength = Math.hypot(projectile.body.velocity.x, projectile.body.velocity.y);
    const fallbackLength = Math.hypot(fallbackDx, fallbackDy);
    const dirX = velocityLength > 0.001
      ? projectile.body.velocity.x / velocityLength
      : (fallbackLength > 0.001 ? fallbackDx / fallbackLength : 0);
    const dirY = velocityLength > 0.001
      ? projectile.body.velocity.y / velocityLength
      : (fallbackLength > 0.001 ? fallbackDy / fallbackLength : -1);

    return {
      vx: dirX * magnitude,
      vy: dirY * magnitude,
      durationMs: Math.max(1, projectile.hitKnockbackDurationMs ?? 180),
    };
  }

  private applyEnemyDamage(
    targetId: string,
    amount: number,
    attackerId?: string,
    sourceId?: string,
    visualContext?: DamageVisualContext,
    options?: DamageApplicationOptions,
  ): void {
    const enemy = this.enemyManager?.getEnemy(targetId);
    if (!enemy) return;
    if (amount <= 0) return;
    if (enemy.isBurrowed()) return;
    if (!this.canDamageTarget(attackerId, targetId, options?.allowTeamDamage)) return;

    const outgoing = this.playerOutgoingDamageResolver?.(
      attackerId,
      targetId,
      amount,
      options?.allowCritical ?? true,
      options?.sourceSlot,
    ) ?? { amount, isCritical: false };
    // Zielseitiger Multiplikator (Verwundbarkeit). Bewusst hier und nicht im ausgehenden
    // Resolver: er gilt fuer *jede* Schadensquelle gegen dieses Ziel, auch fuer Verbuendete,
    // Tuerme und Basen, die gar keinen Angreifer-Modifikator haben.
    const incomingMultiplier = this.targetIncomingDamageMultiplierResolver?.({
      targetType: 'enemy',
      targetId,
    }) ?? this.enemyIncomingDamageMultiplierResolver?.(targetId) ?? 1;
    amount = outgoing.amount * Math.max(0, incomingMultiplier);

    if (attackerId && attackerId !== targetId) {
      this.lastAttacker.set(targetId, attackerId);
      if (sourceId) this.lastWeapon.set(targetId, sourceId);
      if (visualContext) this.lastKillSource.set(targetId, {
        dirX: visualContext.dirX,
        dirY: visualContext.dirY,
        projectileColor: visualContext.projectileColor,
        shotgunLightningGeneration: visualContext.shotgunLightningGeneration,
      });
      this.rememberDamageOrigin(targetId, options);
    }

    const x = enemy.sprite.x;
    const y = enemy.sprite.y;

    // Energie-Kuppel schützt auch verbündete Gegner (Nekromantie), wenn sie in der Kuppel stehen.
    if (enemy.faction === 'allied' && this.energyShieldSystem?.tryDomeProtect(x, y, null, amount, Date.now())) return;

    const previousHp = enemy.getHp();
    const result = this.enemyManager?.applyDamage(targetId, amount);
    if (!result) return;

    const hpLost = previousHp - result.remainingHp;
    if (hpLost <= 0) return;
    this.notifyDamageDealt({
      targetType: 'enemy',
      targetId,
      attackerId: this.resolveDamageOwner(attackerId),
      damage: hpLost,
      damageKind: options?.damageKind ?? 'direct',
      sourceSlot: options?.sourceSlot,
      isCritical: outgoing.isCritical,
    });
    if (!options?.skipLifeLeech) this.applyLifeLeech(attackerId, targetId, hpLost);

    // Trefferabhaengige Primaerwaffen-Affixe. Erst hier, damit sie nur bei einem Treffer
    // ausloesen, der tatsaechlich Schaden gemacht hat – und nach dem Schaden, damit ein
    // Debuff nicht rueckwirkend auf den ausloesenden Treffer wirkt.
    if (
      attackerId
      && !result.died
      && options?.damageKind === 'direct'
      && options.sourceSlot === 'weapon1'
    ) {
      this.onDirectPrimaryHit?.(attackerId, targetId, result.remainingHp, enemy.getMaxHp(), enemy.isBoss());
    }

    const hitSeed = this.nextEffectSeed();
    const direction = this.resolveDamageDirection(targetId, attackerId, visualContext, hitSeed, x, y);
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
      isCritical: outgoing.isCritical,
      dirX: direction.dirX,
      dirY: direction.dirY,
      seed: hitSeed,
    });

    if (result.died) {
      this.enemySlowStates.delete(targetId);
      this.plasmaChargeTracker.clear(targetId);
      const suppressStandardDeathEffect = this.onEnemyDeathCb?.(
        targetId,
        x,
        y,
        this.getActiveBurnSources(targetId),
        result.death,
      ) === true;
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

      const killerId = this.lastAttacker.get(targetId);
      if (killerId && killerId !== targetId) {
        const killerEnemy = this.enemyManager?.getEnemy(killerId);
        const effectiveKillerId = killerEnemy?.faction === 'allied' ? killerEnemy.ownerId : killerId;
        const killedByPlayer = effectiveKillerId ? this.bridge.getPlayerProfile(effectiveKillerId) !== undefined : false;
        const killedByBaseTurret = killerId === COOP_DEFENSE_BASE_TURRET_OWNER_ID;
        if (killedByPlayer) {
          this.bridge.incrementPlayerFrags(effectiveKillerId as string);
        }
        const enemyXp = getCoopDefenseEnemyXp(enemy.kind);
        const xpSourceIsEligible = killedByPlayer
          ? this.bridge.canPlayerReceiveRoundRewards(effectiveKillerId as string)
          : killedByBaseTurret && this.bridge.getRoundResultEligiblePlayerIds().length > 0;
        if (xpSourceIsEligible
          && isCoopDefenseMode(this.bridge.getActiveGameMode())) {
          if (enemyXp > 0) {
            this.bridge.addCoopDefenseRoundXp(enemyXp);
            this.bridge.broadcastCoopDefenseXpPopup(x, y, enemyXp);
          }
        }
        const killSourceId = this.lastWeapon.get(targetId) ?? sourceId ?? 'source.unknown';
        this.onKillCb?.(effectiveKillerId ?? killerId, targetId, killSourceId, x, y, {
          ...this.lastKillSource.get(targetId),
          enemyXp,
        });
      }

      // Erst nach `onKillCb`/`onEnemyDeathCb` aufraeumen: Kill-Handler duerfen die Herkunft des
      // toedlichen Treffers noch lesen.
      this.lastAttacker.delete(targetId);
      this.lastWeapon.delete(targetId);
      this.lastKillSource.delete(targetId);
      this.lastDamageOrigin.delete(targetId);
    }
  }

  private handleDeath(
    playerId: string,
    x: number,
    y: number,
    seed: number,
    direction?: { dirX: number; dirY: number },
  ): void {
    this.alive.set(playerId, false);
    this.armor.set(playerId, 0);
    this.clearBurnForPlayer(playerId);
    // Capture the current animation frame before any death callback hides or changes the Sprite.
    const deathEffect = this.buildDeathEffect(playerId, x, y, seed, direction);
    this.onDeathCb?.(playerId, x, y);

    // Aktive Duration-Buffs (z.B. Adrenalinspritze) beim Tod entfernen
    this.powerUpSystem?.removePlayer(playerId);
    // Stinkwolke beim Tod sofort deaktivieren
    this.stinkCloudSystem?.hostDeactivateForPlayer(playerId);
    this.decoySystem?.clearPlayer(playerId);
    this.ak47Behavior?.resetPlayer(playerId);

    const player = this.playerManager.getPlayer(playerId);
    if (player) player.body.enable = false;

    this.bridge.broadcastEffect(deathEffect);

    // Kill-Callback auslösen (Host-only, kein Selbstkill)
    const killerId = this.lastAttacker.get(playerId);
    if (killerId && killerId !== playerId) {
      const weapon = this.lastWeapon.get(playerId) ?? 'Waffe';
      this.onKillCb?.(killerId, playerId, weapon, x, y, this.lastKillSource.get(playerId));
    }

    if (this.respawnAllowedResolver && !this.respawnAllowedResolver(playerId)) return;
    const timer = setTimeout(() => this.respawn(playerId), RESPAWN_DELAY_MS);
    this.respawnTimers.set(playerId, timer);
  }

  private resolveDamageOwner(attackerId: string | undefined): string | undefined {
    if (!attackerId) return undefined;
    const attackerEnemy = this.enemyManager?.getEnemy(attackerId);
    return attackerEnemy?.faction === 'allied' ? attackerEnemy.ownerId : attackerId;
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
    const current = this.getHP(playerId);
    const next = Math.min(this.getMaxHp(playerId), this.getHP(playerId) + amount);
    this.hp.set(playerId, next);
    if (next > current) this.onHealingReceived?.(playerId, next - current);
    return next;
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
    const adjustedAmount = amount > 0
      ? amount * Math.max(0, this.playerArmorGainMultiplierResolver?.(playerId) ?? 1)
      : amount;
    const maxArmor = Math.max(0, this.playerMaxArmorResolver?.(playerId) ?? ARMOR_MAX);
    const currentArmor = this.getArmor(playerId);
    const newArmor = Phaser.Math.Clamp(currentArmor + adjustedAmount, 0, maxArmor);
    this.armor.set(playerId, newArmor);
    if (newArmor > currentArmor) this.onArmorReceived?.(playerId, newArmor - currentArmor);
    return newArmor;
  }

  private respawn(playerId: string): void {
    this.respawnTimers.delete(playerId);
    if (this.respawnAllowedResolver && !this.respawnAllowedResolver(playerId)) return;
    if (this.onRespawnCb && this.onRespawnCb(playerId) === false) return;
    this.hp.set(playerId, this.getMaxHp(playerId));
    this.armor.set(playerId, 0);
    this.alive.set(playerId, true);
    this.clearBurnForPlayer(playerId);
    this.lastAttacker.delete(playerId);
    this.lastWeapon.delete(playerId);
    this.lastKillSource.delete(playerId);
    this.lastDamageOrigin.delete(playerId);

    this.resourceSystem?.resetAdrenalineForSpawn(playerId);

    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    player.body.enable = true;
    const spawn = this.playerManager.getWorldSpawnPoint(playerId);
    const spawnX = spawn.x;
    const spawnY = spawn.y;
    player.setPosition(spawnX, spawnY);
    this.onAuthoritativePositionReset?.(playerId, spawnX, spawnY);
  }

  hpRegenTick(playerId: string, deltaMs: number): void {
    if (!(this.alive.get(playerId) ?? false)) return;
    const regenPerSecond = this.playerHpRegenPerSecondResolver?.(playerId) ?? 0;
    if (regenPerSecond <= 0) return;
    const current = this.hp.get(playerId) ?? 0;
    const max = this.getMaxHp(playerId);
    if (current >= max) return;
    const next = Math.min(max, current + regenPerSecond * deltaMs / 1000);
    this.hp.set(playerId, next);
    if (next > current) this.onHealingReceived?.(playerId, next - current);
  }

  armorRegenTick(playerId: string, deltaMs: number): void {
    if (!(this.alive.get(playerId) ?? false)) return;
    // Der Bonus wird *vor* dem Frueh-Ausstieg addiert: sonst wirkte die Notfallreparatur nicht
    // bei einem Spieler ohne jede Grund-Ruestungsregeneration.
    const regenPerSecond = (this.playerArmorRegenPerSecondResolver?.(playerId) ?? 0)
      + Math.max(0, this.playerBonusArmorRegenPerSecondResolver?.(playerId) ?? 0);
    if (regenPerSecond <= 0) return;
    const current = this.armor.get(playerId) ?? 0;
    const max = Math.max(0, this.playerMaxArmorResolver?.(playerId) ?? ARMOR_MAX);
    if (current >= max) return;
    // Exakt der konfigurierte Regenerationswert; player.armorGain skaliert andere Ruestungsquellen.
    const next = Math.min(max, current + regenPerSecond * deltaMs / 1000);
    this.armor.set(playerId, next);
    if (next > current) this.onArmorReceived?.(playerId, next - current);
  }

  private resolvePlayerMaxHp(playerId: string): number {
    const resolved = this.playerMaxHpResolver?.(playerId) ?? HP_MAX;
    return Math.max(1, Math.floor(resolved));
  }

  private clearBurnForPlayer(playerId: string): void {
    this.burnStateMachine.clearTarget(playerId);
  }

  private clearBurnByAttacker(attackerId: string): void {
    this.burnStateMachine.clearByAttacker(attackerId);
  }
}
