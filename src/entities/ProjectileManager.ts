import * as Phaser from 'phaser';
import type { RockPhysicsProxy } from '../arena/rocks/RockPhysicsProxy';
import {
  DEPTH,
  MUZZLE_PROJECTILE_FALLBACK_BACKTRACK,
  PROJECTILE_NET_LONG_LIVED_AGE_MS,
  PROJECTILE_NET_REFRESH_CYCLE_TICKS,
  PROJECTILE_NET_STATIC_RESEND_TICKS,
  getTopDownMuzzleOrigin,
  getTopDownMuzzleOriginFromVector,
} from '../config';
import { encodeProjectileDynamic, encodeProjectileStatic } from '../network/projectileSnapshotCodec';
import type { ShadowProjectileSample } from '../effects/ShadowConfig';
import type { ProjectileLightSample } from '../effects/LightingConfig';
import type { BulletVisualPreset, GrenadeVisualPreset, GroundFireVisualStyle, PlaceableKind, TrackedProjectile, SyncedProjectile, SyncedProjectileSnapshot, ExplodedGrenade, ExplodedProjectile, ProjectileSpawnConfig, ProjectileHomingConfig, EnergyBallVariant, ProjectileStyle, SupportProjectileImpact, ProjectileCollisionMode } from '../types';
import type {
  HomingLineOfFireChecker,
  HomingTargetProvider,
  HomingTargetValidityChecker,
  LineOfFireReadPort,
  ProjectileHomingRequest,
  ProjectileTargetQueryPort,
  ProjectileTargetabilityPort,
} from './ProjectileHomingController';
import { OBSTACLE_ROCK, type ArenaObstacleIndex } from '../systems/ArenaObstacleIndex';
import { CombatGeometry } from '../systems/CombatGeometry';
import {
  LEAF_BLOWER_OBSTACLE_BODY_SCALE,
  MIN_BODY_LEN,
  resolveProjectileBodyProfile,
  resolveSafeMuzzleSpawn,
} from '../systems/ProjectileSpawnResolver';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { type GeometryHit, findNearestRectangleHit as geomNearestRectangleHit } from '../utils/geometry';
import type { BulletRenderer }  from '../effects/BulletRenderer';
import type { FlameRenderer }   from '../effects/FlameRenderer';
import type { ProjectileBurnRenderer } from '../effects/ProjectileBurnRenderer';
import type { LeafBlowerRenderer } from '../effects/LeafBlowerRenderer';
import type { BfgRenderer }     from '../effects/BfgRenderer';
import type { EnergyBallRenderer } from '../effects/EnergyBallRenderer';
import type { GaussRenderer }   from '../effects/GaussRenderer';
import type { GrenadeRenderer } from '../effects/GrenadeRenderer';
import type { HydraRenderer } from '../effects/HydraRenderer';
import type { HolyGrenadeRenderer } from '../effects/HolyGrenadeRenderer';
import type { MuzzleFlashRenderer } from '../effects/MuzzleFlashRenderer';
import type { RocketRenderer }  from '../effects/RocketRenderer';
import type { FireballRenderer } from '../effects/FireballRenderer';
import type { SporeRenderer }  from '../effects/SporeRenderer';
import type { TracerRenderer }  from '../effects/TracerRenderer';
import { getMiniRocketCascadeMultiplier } from '../utils/miniRocketCascade';
import { registerGraphicsObject } from '../effects/EffectUtils';
import type {
  LegacyProjectileHostSimulation,
  ProjectileHostStageResult,
  ProjectileOwnerSeam,
} from '../projectile/WorldProjectileRuntime';
import {
  effectiveAirFrictionDecay,
  type ProjectileCoreStageResult,
} from '../projectile/ProjectileFlightProcessor';
import type { ProjectileTimeFieldPort } from '../projectile/ProjectileTimeFieldPort';
import type {
  LegacyProjectileExternalInteractionAccess,
  ProjectileDetonationOutcome,
  ProjectileDetonationSearchRequest,
  ProjectileDetonationTarget,
} from '../projectile/ProjectileExternalInteractionPort';
import type { ProjectileBurnAugment } from '../projectile/ProjectileTravelPort';
import type { ProjectileProvenance } from '../projectile/ProjectileSpawnRequest';
import type {
  ProjectileCombatTargetRef,
  ProjectileDirectImpactOutcome,
  ProjectilePlasmaSwarmImpact,
} from '../projectile/ProjectileCombatPort';
import {
  PLASMA_SWARM_EXPLOSION_DURATION_MS,
  resolvePlasmaSwarmProjectileProfile,
  resolvePlasmaSwarmRadialAngles,
  resolvePlasmaSwarmHoming,
} from '../systems/PlasmaCharge';

/** Client-seitiger Projektil-State für Extrapolation zwischen Netzwerk-Ticks. */
interface ClientProjectileState {
  serverX: number;
  serverY: number;
  vx: number;
  vy: number;
  size: number;
  color: number;
  receivedAt: number;
  style?: string;
  bulletVisualPreset?: BulletVisualPreset;
  grenadeVisualPreset?: GrenadeVisualPreset;
  energyBallVariant?: EnergyBallVariant;
  sporeVisualVariant?: 'spore' | 'spore_void';
  ownerColor?: number;
  projectileVisualScale?: number;
  isDecaying: boolean;
  velocityDecay: number;
  miniRocketPhase?: import('../types').MiniRocketFlightPhase;
  miniRocketCascadeStage?: number;
  projectileBurnVisualStyle?: GroundFireVisualStyle;
  burning: boolean;
}

function resolveBulletVisualPreset(style?: string, preset?: BulletVisualPreset): BulletVisualPreset {
  if (preset) return preset;
  if (style === 'gauss') return 'gauss';
  return style === 'awp' ? 'awp' : 'default';
}

const NO_PROJECTILE_RECORDS: readonly TrackedProjectile[] = [];
const NO_ACTIVE_PROJECTILES: ReadonlySet<TrackedProjectile> = new Set<TrackedProjectile>();

export class ProjectileManager implements LegacyProjectileHostSimulation {
  private scene:       Phaser.Scene;
  /**
   * §5.1-Seam auf die kanonische Registry der laufenden World.
   *
   * Der Owner bindet ihn beim World-Aufbau und löst ihn beim Teardown wieder; ohne World gibt es
   * keine Host-Projectiles zu verarbeiten. Es ist derselbe Store, keine Kopie.
   */
  private owner: ProjectileOwnerSeam | null = null;
  private readonly activeBurningProjectileIds = new Set<number>();
  private readonly shadowSamples: ShadowProjectileSample[] = [];
  private readonly lightSamples: ProjectileLightSample[] = [];
  private clientVisuals = new Map<number, Phaser.GameObjects.Shape>(); // Client: Visuals (ball-Stil)
  private readonly scratchPoints: Phaser.Math.Vector2[] = [];

  // ── Host-Netzwerk-Snapshot ────────────────────────────────────────────────
  // Nur die Statik ist zustandsbehaftet, und zwar bewusst ohne Wertecache: die Werte sind
  // unveraenderlich und werden bei jedem Senden frisch aus dem TrackedProjectile gebaut. Der Eintrag
  // haelt lediglich fest, wie oft der Block noch wiederholt werden muss; seine blosse Existenz
  // bedeutet "Client kennt die Statik bereits".
  private readonly netStaticResendLeft = new Map<number, number>();
  /** Wiederverwendetes Scratch-Set der IDs des laufenden Snapshots. */
  private readonly netSeenIds = new Set<number>();
  private netRefreshCursor = 0;
  private forceFullNetSnapshot = false;

  // ── Client-Extrapolation ──────────────────────────────────────────────────
  private clientProjStates = new Map<number, ClientProjectileState>();

  // ── Bullet-Renderer (Enhanced Bullet Visuals) ─────────────────────────────
  private bulletRenderer: BulletRenderer | null = null;

  // ── Flame-Renderer (Flammenwerfer-Partikel) ───────────────────────────────
  private flameRenderer: FlameRenderer | null = null;
  private projectileBurnRenderer: ProjectileBurnRenderer | null = null;

  // ── Leaf-Blower-Renderer (Luftstrom + Blätter) ────────────────────────────
  private leafBlowerRenderer: LeafBlowerRenderer | null = null;

  // ── BFG-Renderer (BFG-Partikel) ─────────────────────────────────────────
  private bfgRenderer: BfgRenderer | null = null;

  // ── Energy-Ball-Renderer (ASMD Secondary) ───────────────────────────────
  private energyBallRenderer: EnergyBallRenderer | null = null;

  // ── Hydra-Renderer (split-bounce energy projectile) ─────────────────────
  private hydraRenderer: HydraRenderer | null = null;

  // ── Gauss-Renderer (elektrische Overlay-Visuals) ───────────────────────
  private gaussRenderer: GaussRenderer | null = null;

  // ── Grenade-Renderer (HE/Smoke/Molotov) ────────────────────────────────
  private grenadeRenderer: GrenadeRenderer | null = null;

  // ── Holy-Grenade-Renderer (goldene Granate mit Kreuzstift) ─────────────
  private holyGrenadeRenderer: HolyGrenadeRenderer | null = null;

  // ── Rocket-Renderer (Raketenkörper + Rauchspur) ────────────────────────
  private rocketRenderer: RocketRenderer | null = null;
  private fireballRenderer: FireballRenderer | null = null;

  // ── Spore-Renderer (organische Cluster + toxische Spur) ────────────────
  private sporeRenderer: SporeRenderer | null = null;

  // ── Translocator-Puck-Renderer ──────────────────────────────────────────
  private translocatorPuckRenderer: import('../effects/TranslocatorPuckRenderer').TranslocatorPuckRenderer | null = null;
  private teslaBoltRenderer: import('../effects/TeslaBoltRenderer').TeslaBoltRenderer | null = null;


  // ── Tracer-Renderer (data-driven Leuchtlinien, alle Projektilstile) ───────
  private tracerRenderer: TracerRenderer | null = null;

  // ── MuzzleFlash-Renderer (lokales Schuss-Feedback, kein Netzstate) ───────
  private muzzleFlashRenderer: MuzzleFlashRenderer | null = null;
  private audioSystem: GameAudioSystem | null = null;
  private ownerPositionProvider: ((ownerId: string) => { x: number; y: number } | null) | null = null;
  private timeBubbleFactorProvider: ((x: number, y: number, now: number, ownerId?: string) => number) | null = null;
  private timeFieldPort: ProjectileTimeFieldPort | null = null;
  private hostFrameNowMs: number | null = null;

  /** Semantische Brücke für den world-owned External-Interaction-Port. */
  readonly externalInteraction: LegacyProjectileExternalInteractionAccess = {
    searchDetonableProjectiles: (detonableIds, request) => (
      this.searchDetonableProjectiles(detonableIds, request)
    ),
    detonateProjectile: (projectileId, detonatorOwnerId) => (
      this.detonateProjectile(projectileId, detonatorOwnerId)
    ),
    detonateOverlappingProjectiles: (detonatorIds, detonableIds) => (
      this.detonateOverlappingProjectiles(detonatorIds, detonableIds)
    ),
  };

  // ── Radialer Projektil-Puls (Host-only, injiziert von ArenaScene) ────────
  private proximityPulseCallback: ((proj: TrackedProjectile) => void) | null = null;
  private naturalFlameExpiryCallback: ((proj: TrackedProjectile, x: number, y: number) => void) | null = null;

  // ── Homing-Port-Kompatibilität (die Verarbeitung liegt im World-Owner) ───
  private homingTargetProvider: HomingTargetProvider | null = null;
  private homingLineOfFireChecker: HomingLineOfFireChecker | null = null;
  private homingTargetValidityChecker: HomingTargetValidityChecker | null = null;

  // ── Host: gepufferte Explosionen explosiver Projektile ──────────────────
  private pendingProjectileExplosions: ExplodedProjectile[] = [];
  private projectileImpactCallback: ((proj: TrackedProjectile, x: number, y: number) => void) | null = null;
  private projectileResolvedCallback: ((proj: TrackedProjectile) => void) | null = null;
  private miniRocketCollectedCallback: ((proj: TrackedProjectile, x: number, y: number) => void) | null = null;
  private miniRocketDestroyedCallback: ((proj: TrackedProjectile, x: number, y: number) => void) | null = null;

  // ── Obstacle-Gruppen (werden nach Arena-Aufbau injiziert) ─────────────────
  private rockGroup:   Phaser.Physics.Arcade.StaticGroup | null = null;
  private rockObjects: (RockPhysicsProxy | null)[] | null = null;
  private trunkGroup:  Phaser.Physics.Arcade.StaticGroup | null = null;
  /** Geteilte räumliche Vorauswahl aus dem `CombatSystem` (siehe `setObstacleIndex`). */
  private obstacleIndex: ArenaObstacleIndex | null = null;
  /** Gemeinsame Segmentgeometrie über demselben Index; kein eigener Spatial Index. */
  private obstacleGeometry: CombatGeometry | null = null;
  /** Ziel der Kandidaten-Bounds bzw. des bislang besten Treffers (keine Allokation pro Fels). */
  private readonly scratchObstacleRect = new Phaser.Geom.Rectangle();
  private readonly scratchLine = new Phaser.Geom.Line();
  private readonly bestRockRect        = new Phaser.Geom.Rectangle();
  private readonly scratchTrainBounds  = new Phaser.Geom.Rectangle();
  /**
   * Coop-Defense-Basis-Gruppe. Wird vom ProjectileManager wie trunkGroup
   * behandelt: physische Kollision/Impact; direkter Schaden wird über den
   * zentralen Basistreffer-Callback weitergeleitet.
   */
  private baseGroup:   Phaser.Physics.Arcade.StaticGroup | null = null;
  private onRockHit:   ((rockId: number, damage: number, attackerId: string) => void) | null = null;
  private obstacleKindResolver: ((rockId: number) => PlaceableKind | undefined) | null = null;
  private onBaseHit:   ((baseId: string, damage: number, attackerId: string, projectile?: TrackedProjectile) => void) | null = null;
  private onSupportImpact: ((proj: TrackedProjectile, impact: SupportProjectileImpact) => void) | null = null;

  // ── Zug-Kollision ─────────────────────────────────────────────────────────
  private trainGroup:  Phaser.Physics.Arcade.StaticGroup | null = null;
  private onTrainHit:  ((damage: number, attackerId: string) => void) | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Der world-owned Owner bindet und löst diese Verarbeitung mit seiner eigenen Lifetime. */
  bindProjectileOwner(owner: ProjectileOwnerSeam | null): void {
    this.owner = owner;
    owner?.setProjectileTimeFieldPort?.(this.timeFieldPort);
    owner?.setProjectileTargetQueryPort?.(
      this.homingTargetProvider ? { queryTargets: this.homingTargetProvider } : null,
    );
    owner?.setLineOfFireReadPort?.(
      this.homingLineOfFireChecker
        ? { hasClearLineOfFire: this.homingLineOfFireChecker }
        : null,
    );
    if (this.hostFrameNowMs !== null) owner?.setHostFrameTime?.(this.hostFrameNowMs);
  }

  /** Host: Verarbeitungsreihenfolge der laufenden World; außerhalb einer World leer. */
  private get projectiles(): readonly TrackedProjectile[] {
    return this.owner?.store.stepOrder ?? NO_PROJECTILE_RECORDS;
  }

  /** Host: wirksame Projectiles der laufenden World; außerhalb einer World leer. */
  private get activeProjectiles(): ReadonlySet<TrackedProjectile> {
    return this.owner?.store.activeRecords ?? NO_ACTIVE_PROJECTILES;
  }

  // ── Gruppen injizieren (nach buildDynamic) ─────────────────────────────────

  /**
   * Setzt die Kollisions-Gruppen für Felsen und Trunks.
   * Wird nach World-Aufbau aufgerufen; bei null (World-Teardown) alles leeren.
   */
  setRockGroup(
    group:      Phaser.Physics.Arcade.StaticGroup | null,
    objects:    (RockPhysicsProxy | null)[] | null,
    trunkGroup: Phaser.Physics.Arcade.StaticGroup | null,
  ): void {
    this.rockGroup   = group;
    this.rockObjects = objects;
    this.trunkGroup  = trunkGroup;
  }

  /**
   * Übernimmt den Hindernis-Index des `CombatSystem` für die kontinuierliche
   * Fels-Kollision. Ohne Index fällt die Prüfung auf den vollständigen Scan zurück.
   */
  setObstacleIndex(index: ArenaObstacleIndex | null): void {
    this.obstacleIndex = index;
    this.obstacleGeometry = index ? new CombatGeometry(index) : null;
  }

  /**
   * Setzt die Coop-Defense-Basis-Gruppe. Geschosse reagieren physisch (Impact, Explosion,
   * Bounce) wie bei Felsen; direkter Schaden entsteht ausschliesslich ueber
   * {@link setBaseHitCallback}, dessen Empfaenger die Fraktion prueft.
   */
  setBaseGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void {
    this.baseGroup = group;
  }

  /**
   * Registriert den Empfaenger fuer Projektil-Basis-Treffer (Host). Analog zu
   * {@link setRockHitCallback}: nur der Collider weiss, welche Basiszelle getroffen wurde.
   * Das optionale Projektil wird mitgereicht, damit der Empfaenger denselben effektiven
   * Projektilschaden wie beim Gegner-Treffer berechnen kann.
   */
  setBaseHitCallback(cb: ((baseId: string, damage: number, attackerId: string, projectile?: TrackedProjectile) => void) | null): void {
    this.onBaseHit = cb;
  }

  /**
   * Meldet einen Basistreffer genau einmal je Projektil und Basis.
   *
   * Die Entprellung ist Pflicht: Overlap-Waffen wie BFG und Gauss beruehren jede Zelle einer
   * Basis einzeln und wuerden eine 17-Zellen-Basis sonst pro Schuss 17-mal treffen – dasselbe
   * Problem, das fuer Felsen bereits ueber `bfgHitRocks` geloest ist.
   */
  private applyBaseHit(tracked: TrackedProjectile, baseObject: Phaser.GameObjects.GameObject): void {
    if (!this.onBaseHit || tracked.damage <= 0) return;
    const baseId = baseObject.getData('baseId') as string | undefined;
    if (!baseId) return;
    tracked.hitBaseIds ??= new Set<string>();
    if (tracked.hitBaseIds.has(baseId)) return;
    tracked.hitBaseIds.add(baseId);
    this.onBaseHit(baseId, tracked.damage, tracked.ownerId, tracked);
  }

  /**
   * Registriert einen Callback, der bei jedem Projektil-Felsen-Treffer (Host)
   * aufgerufen wird. Gibt den Index in layout.rocks[] weiter.
   */
  setRockHitCallback(cb: (rockId: number, damage: number, attackerId: string) => void): void {
    this.onRockHit = cb;
  }

  /** Resolves dynamic obstacle kinds without coupling projectile logic to loadout IDs. */
  setObstacleKindResolver(resolver: ((rockId: number) => PlaceableKind | undefined) | null): void {
    this.obstacleKindResolver = resolver;
  }

  /**
   * Registriert den Empfaenger fuer Hindernistreffer von kontextabhaengigen
   * Unterstuetzungsprojektilen (derzeit Energieinjektor). Diese Projektile richten keinen
   * direkten Schaden an; ihre
   * Wirkung entsteht ausschliesslich hier, weil nur der Collider weiss, welcher Fels bzw.
   * welche Basiszelle getroffen wurde.
   */
  setSupportImpactCallback(
    cb: ((proj: TrackedProjectile, impact: SupportProjectileImpact) => void) | null,
  ): void {
    this.onSupportImpact = cb;
  }

  /**
   * Setzt die StaticGroup des Zugs für Projektil-Kollision (Host-only).
   * null = kein Zug aktiv (deaktiviert die Kollision).
   */
  setTrainGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void {
    this.trainGroup = group;
  }

  /** Liefert die bereits für Projektilpfade relevante, aktive Gesamtfläche des Zugs. */
  private getActiveTrainBounds(): Phaser.Geom.Rectangle | null {
    if (!this.trainGroup) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const child of this.trainGroup.getChildren()) {
      const segment = child as Phaser.GameObjects.Rectangle;
      if (!segment.active) continue;
      const body = segment.body as Phaser.Physics.Arcade.StaticBody | null;
      if (body && !body.enable) continue;

      const halfWidth = segment.displayWidth * 0.5;
      const halfHeight = segment.displayHeight * 0.5;
      minX = Math.min(minX, segment.x - halfWidth);
      maxX = Math.max(maxX, segment.x + halfWidth);
      minY = Math.min(minY, segment.y - halfHeight);
      maxY = Math.max(maxY, segment.y + halfHeight);
    }

    if (!Number.isFinite(minX)) return null;
    return this.scratchTrainBounds.setTo(minX, minY, maxX - minX, maxY - minY);
  }

  /**
   * Registriert einen Callback, der bei jedem Projektil-Zug-Treffer aufgerufen wird.
   * null = kein Handler (deaktiviert den Callback ohne die Kollision zu entfernen).
   */
  setTrainHitCallback(cb: ((damage: number, attackerId: string) => void) | null): void {
    this.onTrainHit = cb;
  }

  /**
   * Injiziert den BulletRenderer für verbesserte Bullet-Darstellung.
   * null = deaktiviert (Fallback auf einfache Shapes).
   */
  setBulletRenderer(renderer: BulletRenderer | null): void {
    this.bulletRenderer = renderer;
  }

  /**
   * Injiziert den FlameRenderer für Flammenwerfer-Darstellung.
   * null = deaktiviert.
   */
  setFlameRenderer(renderer: FlameRenderer | null): void {
    this.flameRenderer = renderer;
  }

  setProjectileBurnRenderer(renderer: ProjectileBurnRenderer | null): void {
    this.projectileBurnRenderer = renderer;
  }

  setNaturalFlameExpiryCallback(
    callback: ((proj: TrackedProjectile, x: number, y: number) => void) | null,
  ): void {
    this.naturalFlameExpiryCallback = callback;
  }

  /** Injiziert den LeafBlowerRenderer fuer Luftstrom-Projektile. */
  setLeafBlowerRenderer(renderer: LeafBlowerRenderer | null): void {
    this.leafBlowerRenderer = renderer;
  }

  /** Injiziert den BfgRenderer für BFG-Projektil-Darstellung. */
  setBfgRenderer(renderer: BfgRenderer | null): void {
    this.bfgRenderer = renderer;
  }

  /** Injiziert den EnergyBallRenderer fuer ASMD-Energieprojektile. */
  setEnergyBallRenderer(renderer: EnergyBallRenderer | null): void {
    this.energyBallRenderer = renderer;
  }

  /** Injiziert den HydraRenderer fuer Hydra-Projektile. */
  setHydraRenderer(renderer: HydraRenderer | null): void {
    this.hydraRenderer = renderer;
  }

  /** Injiziert den GaussRenderer fuer elektrische Projektil-Overlays. */
  setGaussRenderer(renderer: GaussRenderer | null): void {
    this.gaussRenderer = renderer;
  }

  /** Injiziert den GrenadeRenderer fuer klassische Granaten. */
  setGrenadeRenderer(renderer: GrenadeRenderer | null): void {
    this.grenadeRenderer = renderer;
  }

  /** Injiziert den HolyGrenadeRenderer fuer die Heilige Handgranate. */
  setHolyGrenadeRenderer(renderer: HolyGrenadeRenderer | null): void {
    this.holyGrenadeRenderer = renderer;
  }

  /** Injiziert den RocketRenderer fuer Raketen-Visualisierung. */
  setRocketRenderer(renderer: RocketRenderer | null): void {
    this.rocketRenderer = renderer;
  }

  setFireballRenderer(renderer: FireballRenderer | null): void {
    this.fireballRenderer = renderer;
  }

  /** Injiziert den SporeRenderer fuer Sporen-Projektile. */
  setSporeRenderer(renderer: SporeRenderer | null): void {
    this.sporeRenderer = renderer;
  }

  /** Injiziert den TranslocatorPuckRenderer. */
  setTranslocatorPuckRenderer(renderer: import('../effects/TranslocatorPuckRenderer').TranslocatorPuckRenderer | null): void {
    this.translocatorPuckRenderer = renderer;
  }

  /** Injiziert den TeslaBoltRenderer für die Gewitterentladung der Tesla-Kuppel. */
  setTeslaBoltRenderer(renderer: import('../effects/TeslaBoltRenderer').TeslaBoltRenderer | null): void {
    this.teslaBoltRenderer = renderer;
  }

  /** Injiziert den TracerRenderer für data-driven Leuchtlinien. */
  setTracerRenderer(renderer: TracerRenderer | null): void {
    this.tracerRenderer = renderer;
  }

  /** Injiziert den MuzzleFlashRenderer fuer lokale Spawn-Effekte. */
  setMuzzleFlashRenderer(renderer: MuzzleFlashRenderer | null): void {
    this.muzzleFlashRenderer = renderer;
  }

  setAudioSystem(system: GameAudioSystem | null): void {
    this.audioSystem = system;
  }

  setOwnerPositionProvider(provider: ((ownerId: string) => { x: number; y: number } | null) | null): void {
    this.ownerPositionProvider = provider;
  }

  setTimeBubbleFactorProvider(provider: ((x: number, y: number, now: number, ownerId?: string) => number) | null): void {
    this.timeBubbleFactorProvider = provider;
    this.timeFieldPort = provider
      ? {
        getMovementFactor: (x, y, nowMs, provenance) => provider(
          x,
          y,
          nowMs,
          provenance.allegiance.ownerId,
        ),
      }
      : null;
    this.owner?.setProjectileTimeFieldPort?.(this.timeFieldPort);
  }

  setProjectileTimeFieldPort(port: ProjectileTimeFieldPort | null): void {
    this.timeFieldPort = port;
  }

  setHostFrameTime(nowMs: number): void {
    this.hostFrameNowMs = nowMs;
  }

  /** Registriert den gemeinsamen radialen Projektil-Puls (Host-only). */
  setProximityPulseCallback(cb: ((proj: TrackedProjectile) => void) | null): void {
    this.proximityPulseCallback = cb;
  }

  setProjectileImpactCallback(cb: ((proj: TrackedProjectile, x: number, y: number) => void) | null): void {
    this.projectileImpactCallback = cb;
  }

  /**
   * Completes the owner-side lifecycle after Combat has accepted a semantic direct outcome.
   * Combat never receives this record or calls these legacy lifecycle operations itself.
   */
  finalizeDirectImpact(
    projectile: TrackedProjectile,
    target: ProjectileCombatTargetRef,
    impact: { readonly x: number; readonly y: number },
    outcome: ProjectileDirectImpactOutcome,
  ): boolean {
    if (!outcome.accepted || projectile.pendingDestroy) return false;
    if (projectile.impactCloud) this.emitProjectileImpact(projectile, impact.x, impact.y);

    const impactTargetKey = target.kind === 'player'
      ? `players:${target.id}`
      : target.kind === 'enemy'
        ? `enemies:${target.id}`
        : undefined;
    const queuedExplosion = projectile.enemyHitExplosion
      ? this.triggerEnemyImpactExplosion(projectile.id)
      : projectile.explosion
        ? this.triggerProjectileExplosion(projectile.id, impactTargetKey)
        : false;
    if (!queuedExplosion) this.queueDestroyProjectile(projectile);
    return !projectile.pendingDestroy;
  }

  /** Applies the semantic Plasma reaction through the normal world-owned spawn path. */
  applyPlasmaSwarmImpact(impact: ProjectilePlasmaSwarmImpact): void {
    this.queueStandaloneExplosion(
      impact.x,
      impact.y,
      impact.ownerId,
      {
        radius: impact.explosionRadius,
        maxDamage: impact.explosionDamage,
        minDamage: impact.explosionDamage,
        knockback: 0,
        selfDamageMult: 0,
        damageTarget: 'enemies',
        enemySlowFraction: impact.explosionSlowFraction,
        enemySlowDurationMs: PLASMA_SWARM_EXPLOSION_DURATION_MS,
        baseDamageMult: 1,
        rockDamageMult: 1,
        trainDamageMult: 0,
        color: impact.color,
        visualStyle: 'energy',
      },
      impact.sourceSlot ?? 'weapon1',
      `${impact.sourceId}:swarm-explosion`,
    );

    const profile = resolvePlasmaSwarmProjectileProfile({
      damage: impact.normalDamage,
      size: impact.normalSize,
      speed: impact.normalSpeed,
      range: impact.normalRange,
    });
    const speed = Math.max(1, profile.speed);
    const lifetime = Math.max(1, (profile.range / speed) * 1000);
    for (const angle of resolvePlasmaSwarmRadialAngles(impact.projectileCount)) {
      this.spawnProjectile(impact.x, impact.y, angle, impact.ownerId, {
        speed,
        size: Math.max(1, profile.size),
        damage: profile.damage,
        color: impact.color,
        ownerColor: impact.ownerColor ?? impact.color,
        lifetime,
        remainingRangePx: profile.range,
        maxBounces: 0,
        isGrenade: false,
        adrenalinGain: 0,
        sourceId: 'weapon.plasma.swarm',
        homing: resolvePlasmaSwarmHoming(impact.homing),
        projectileStyle: impact.projectileStyle,
        energyBallVariant: impact.energyBallVariant,
        tracerConfig: impact.tracerConfig,
        allowTeamDamage: impact.allowTeamDamage,
        baseDamageMult: impact.baseDamageMult,
        suppressSpawnFx: true,
        plasmaSwarmProjectile: true,
        plasmaSwarmOriginEnemyId: impact.enemyId,
        sourceSlot: impact.sourceSlot ?? 'weapon1',
      });
    }
  }

  setProjectileResolvedCallback(cb: ((proj: TrackedProjectile) => void) | null): void {
    this.projectileResolvedCallback = cb;
  }

  setMiniRocketCollectedCallback(cb: ((proj: TrackedProjectile, x: number, y: number) => void) | null): void {
    this.miniRocketCollectedCallback = cb;
  }

  setMiniRocketDestroyedCallback(cb: ((proj: TrackedProjectile, x: number, y: number) => void) | null): void {
    this.miniRocketDestroyedCallback = cb;
  }

  /** Registriert die Host-seitige Zielquelle für Homing-Projektile. */
  setHomingTargetProvider(cb: HomingTargetProvider | null): void {
    this.homingTargetProvider = cb;
    this.owner?.setProjectileTargetQueryPort?.(cb ? { queryTargets: cb } : null);
  }

  /** Registriert die Host-seitige Line-of-Fire-Prüfung für Homing-Projektile. */
  setHomingLineOfFireChecker(cb: ((sx: number, sy: number, ex: number, ey: number) => boolean) | null): void {
    this.homingLineOfFireChecker = cb;
    this.owner?.setLineOfFireReadPort?.(cb ? { hasClearLineOfFire: cb } : null);
  }

  // ── Host ──────────────────────────────────────────────────────────────────

  /**
   * Spawnt ein Projektil mit der übergebenen Konfiguration.
   * Granaten (isGrenade=true) haben keine Welt-/Hindernis-Kollision
   * und explodieren nach fuseTime ms.
   */
  /**
   * Erstellt – abhängig vom Projektilstil – das spezialisierte Renderer-Visual und blendet
   * den reinen Kollisions-Sprite aus (Rendering übernimmt der jeweilige Renderer auf Client/Host).
   * Stile ohne Renderer (z. B. 'ball') behalten den sichtbaren Sprite.
   */
  private createSpawnRendererVisuals(
    id: number,
    sprite: Phaser.GameObjects.Shape,
    x: number,
    y: number,
    cfg: ProjectileSpawnConfig,
  ): void {
    const style = cfg.projectileStyle;

    if (style === 'bullet' && this.bulletRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.bulletRenderer.createVisual(
        id,
        x,
        y,
        cfg.size,
        cfg.color,
        resolveBulletVisualPreset(cfg.projectileStyle, cfg.bulletVisualPreset),
        cfg.ownerColor ?? cfg.color,
      );
    }

    // AWP-Projektile sind unsichtbar (Rendering übernimmt BulletRenderer mit AWP-Stil)
    if ((style === 'awp' || style === 'gauss') && this.bulletRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.bulletRenderer.createVisual(
        id,
        x,
        y,
        cfg.size,
        cfg.color,
        resolveBulletVisualPreset(cfg.projectileStyle, cfg.bulletVisualPreset),
        cfg.ownerColor ?? cfg.color,
      );
    }

    if (style === 'gauss' && this.gaussRenderer) {
      this.gaussRenderer.createVisual(id, x, y, cfg.size, cfg.color);
    }

    if (style === 'rocket' && this.rocketRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.rocketRenderer.createVisual(
        id,
        x,
        y,
        cfg.size,
        cfg.color,
        cfg.ownerColor ?? cfg.color,
        cfg.smokeTrailColor ?? cfg.color,
        cfg.projectileVisualScale,
      );
    }

    if (style === 'fireball' && this.fireballRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.fireballRenderer.createVisual(id, x, y, cfg.size);
    }

    if (style === 'spore' && this.sporeRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.sporeRenderer.createVisual(id, x, y, cfg.size, cfg.color, cfg.sporeVisualVariant);
    }

    if (style === 'energy_ball' && this.energyBallRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.energyBallRenderer.createVisual(id, x, y, cfg.size, cfg.color, cfg.energyBallVariant);
    }

    if (style === 'hydra' && this.hydraRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.hydraRenderer.createVisual(id, x, y, cfg.size, cfg.color);
    }

    if (style === 'grenade' && this.grenadeRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.grenadeRenderer.createVisual(id, x, y, cfg.size, cfg.grenadeVisualPreset ?? 'he', cfg.ownerColor ?? cfg.color);
    }

    if (style === 'holy_grenade' && this.holyGrenadeRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.holyGrenadeRenderer.createVisual(id, x, y, cfg.size);
    }

    if (style === 'translocator_puck' && this.translocatorPuckRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.translocatorPuckRenderer.createVisual(id, x, y, cfg.ownerColor ?? cfg.color);
    }

    if (style === 'tesla_bolt' && this.teslaBoltRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.teslaBoltRenderer.createVisual(id, x, y, cfg.size, cfg.color);
    }

    // Flame-Hitboxen sind unsichtbar (Rendering übernimmt FlameRenderer auf Client)
    if (style === 'flame' || style === 'leaf_blower') {
      sprite.setVisible(false);
      sprite.setAlpha(0);
    }

    // BFG-Projektile sind unsichtbar (Rendering übernimmt BfgRenderer)
    if (style === 'bfg') {
      sprite.setVisible(false);
      sprite.setAlpha(0);
    }
  }

  /**
   * §5.1-Seam: Spawn im Legacy-Payload-Shape der noch nicht migrierten Host-Quellen.
   *
   * Identity, Registry und Lifetime gehören dem world-owned Owner; dieser Aufruf reicht den
   * Auftrag nur an ihn weiter. Ohne gebundene World entsteht kein Projectile.
   */
  spawnProjectile(
    x:       number,
    y:       number,
    angle:   number,
    ownerId: string,
    cfg:     ProjectileSpawnConfig,
  ): number {
    return this.owner?.spawnLegacyProjectile(x, y, angle, ownerId, cfg) ?? -1;
  }

  /**
   * Baut Physics-Handle, Collider, Spawn-Darstellung und Runtime-Record zu einer bereits vom
   * Owner vergebenen Identity. Die Aufnahme in die Registry macht der Owner.
   */
  createProjectile(
    id:      number,
    x:       number,
    y:       number,
    angle:   number,
    ownerId: string,
    cfg:     ProjectileSpawnConfig,
    hostNowMs: number,
    provenance: ProjectileProvenance,
  ): TrackedProjectile {
    // Style-Flags, die im weiteren Spawn-Ablauf (Shape, Anti-Tunneling, Body-Größe) gebraucht werden.
    // Die renderer- und collider-spezifische Style-Auswertung passiert in den jeweiligen Helfern.
    const isBall   = cfg.projectileStyle === 'ball';
    const isEnergyBall = cfg.projectileStyle === 'energy_ball';
    const isHydra = cfg.projectileStyle === 'hydra';
    const isSpore = cfg.projectileStyle === 'spore';
    const bodyProfile = resolveProjectileBodyProfile(cfg, angle);
    const resolvedSpawn = cfg.gameplayMuzzleOrigin
      ? resolveSafeMuzzleSpawn(
        x,
        y,
        cfg.gameplayMuzzleOrigin,
        angle,
        cfg,
        {
          geometry: this.obstacleGeometry,
          trainBounds: this.getActiveTrainBounds(),
          worldBounds: this.scene.physics.world.bounds,
        },
        bodyProfile,
      )
      : { x, y };

    // Physik-Shape: für 'bullet'/'flame'/'awp' unsichtbar (nur Kollisions-Body)
    const sprite: Phaser.GameObjects.Shape = (isBall || isEnergyBall || isHydra || isSpore)
      ? this.scene.add.circle(resolvedSpawn.x, resolvedSpawn.y, cfg.size / 2, cfg.color)
      : this.scene.add.rectangle(resolvedSpawn.x, resolvedSpawn.y, cfg.size, cfg.size, cfg.color);
    sprite.setDepth(DEPTH.PROJECTILES);

    this.createSpawnRendererVisuals(id, sprite, resolvedSpawn.x, resolvedSpawn.y, cfg);
    // Renderer-übernommene Hitbox-Shapes sind bereits unsichtbar und werden nicht attribuiert.
    // Sichtbare Host-Fallbacks (z. B. Ball/Shape ohne Spezialrenderer) bleiben messbar.
    if (sprite.visible !== false && sprite.alpha !== 0) {
      registerGraphicsObject(this.scene, 'projectileShapes', sprite);
    }

    this.scene.physics.add.existing(sprite);

    const body = sprite.body as Phaser.Physics.Arcade.Body;

    body.setVelocity(
      Math.cos(angle) * cfg.speed,
      Math.sin(angle) * cfg.speed,
    );

    const spawnProvenance = provenance;
    const initialTimeBubbleFactor = this.timeBubbleFactorProvider?.(
      resolvedSpawn.x,
      resolvedSpawn.y,
      hostNowMs,
      ownerId,
    ) ?? this.timeFieldPort?.getMovementFactor(
      resolvedSpawn.x,
      resolvedSpawn.y,
      hostNowMs,
      spawnProvenance,
    ) ?? 1;
    if (initialTimeBubbleFactor < 0.999) {
      body.setVelocity(body.velocity.x * initialTimeBubbleFactor, body.velocity.y * initialTimeBubbleFactor);
    }

    // Body-Profil und Safe-Muzzle verwenden dieselben Maße, bevor der Body existiert.
    body.setSize(bodyProfile.width, bodyProfile.height);
    body.setOffset(bodyProfile.offsetX, bodyProfile.offsetY);

    const tracked: TrackedProjectile = {
      id,
      sprite,
      body,
      lastX:          resolvedSpawn.x,
      lastY:          resolvedSpawn.y,
      bounceCount:    cfg.initialBounceCount ?? 0,
      createdAt:      hostNowMs,
      ownerId,
      provenance,
      collisionMode:  resolveProjectileCollisionMode(cfg),
      ignoreBaseCollisions: cfg.ignoreBaseCollisions,
      ignoreRockIndex: cfg.ignoreRockIndex,
      color:          cfg.color,
      allowTeamDamage: cfg.allowTeamDamage,
      ownerColor:     cfg.ownerColor,
      visualMuzzleOrigin: cfg.visualMuzzleOrigin,
      boundsListener: () => {},
      colliders:      [],
      damage:         cfg.damage,
      lifetime:       cfg.lifetime,
      maxBounces:     cfg.maxBounces,
      isGrenade:      cfg.isGrenade,
      isTranslocatorPuck: cfg.isTranslocatorPuck,
      adrenalinGain:  cfg.adrenalinGain,
      sourceId:     cfg.sourceId ?? 'weapon.unknown',
      plasmaSwarmEnabled: cfg.plasmaSwarmEnabled,
      plasmaSwarmProjectile: cfg.plasmaSwarmProjectile,
      plasmaSwarmOriginEnemyId: cfg.plasmaSwarmOriginEnemyId,
      plasmaSwarmProjectileCount: cfg.plasmaSwarmProjectileCount,
      plasmaSwarmExplosionRadius: cfg.plasmaSwarmExplosionRadius,
      plasmaSwarmExplosionDamage: cfg.plasmaSwarmExplosionDamage,
      plasmaSwarmExplosionSlowFraction: cfg.plasmaSwarmExplosionSlowFraction,
      explosion:      cfg.explosion,
      enemyHitExplosion: cfg.enemyHitExplosion,
      impactCloud:    cfg.impactCloud,
      sporeVisualVariant: cfg.sporeVisualVariant,
      homing:         cfg.homing,
      energyInjectorPayload: cfg.energyInjectorPayload,
      sourceTurretId: cfg.sourceTurretId,
      projectileVisualScale: cfg.projectileVisualScale,
      smokeTrailColor: cfg.smokeTrailColor,
      lockedTargetId: null,
      homingState: cfg.homing ? { lockedTargetId: null } : undefined,
      fuseTime:        cfg.fuseTime,
      grenadeEffect:   cfg.grenadeEffect,
      projectileStyle: cfg.projectileStyle,
      bulletVisualPreset: cfg.bulletVisualPreset,
      grenadeVisualPreset: cfg.grenadeVisualPreset,
      energyBallVariant: cfg.energyBallVariant,
      tracerConfig:    cfg.tracerConfig,
      detonable:       cfg.detonable,
      detonator:       cfg.detonator,
      rockDamageMult:  cfg.rockDamageMult,
      trainDamageMult: cfg.trainDamageMult,
      baseDamageMult:   cfg.baseDamageMult,
      sourceSlot:      cfg.sourceSlot,
      shotAudioKey:    cfg.shotAudioKey,
      splitCount:      cfg.splitCount,
      splitSpread:     cfg.splitSpread,
      splitFactor:     cfg.splitFactor,
      splitHoming:     cfg.splitHoming,
      remainingRangePx: cfg.remainingRangePx,
      suppressSpawnFx: cfg.suppressSpawnFx,
      penetrationRemaining: cfg.penetrationCount,
      penetrationDamageRetention: cfg.penetrationDamageRetention,
      penetrationHitIds: (cfg.penetrationCount ?? 0) > 0 ? new Set<string>() : undefined,
      piercesTargets:  cfg.piercesTargets,
      piercingHitIds: (cfg.isBfg || cfg.piercesTargets
        || ((cfg.proximityPulse?.radius ?? 0) > 0 && (cfg.proximityPulse?.damage ?? 0) > 0))
        ? new Set<string>() : undefined,
      penetratesRocks: cfg.penetratesRocks,
      penetratedRockIds: cfg.penetratesRocks ? new Set<number>() : undefined,
      reflected: cfg.reflected,
      gaussChainRadius: cfg.gaussChainRadius,
      gaussChainDamageFactor: cfg.gaussChainDamageFactor,
      multiExplosionsRemaining: Math.max(1, Math.floor(cfg.multiExplosionCount ?? 1)),
      multiExplosionExcludedTargetKeys: (cfg.multiExplosionCount ?? 1) > 1
        ? new Set<string>()
        : undefined,
      multiExplosionCoastMs: cfg.multiExplosionCoastMs,
      miniRocketStageRangePx: cfg.miniRocketStageRangePx,
      miniRocketPhase: cfg.miniRocketStageRangePx !== undefined ? 'attack' : undefined,
      miniRocketCoastUntilAgeMs: undefined,
      miniRocketNextExplosionAtAgeMs: undefined,
      miniRocketDeferredExplosion: false,
      miniRocketDeferredExplosionStopsAtObstacle: false,
      miniRocketSpent: false,
      miniRocketDestructionFxEmitted: false,
      miniRocketHasExploded: false,
      miniRocketReturnEnabled: cfg.miniRocketReturnEnabled,
      miniRocketReturnRangeBuffer: cfg.miniRocketReturnRangeBuffer,
      miniRocketReturnReserveGranted: false,
      miniRocketPickupRadius: cfg.miniRocketPickupRadius,
      miniRocketPickupAdrenalineRefundFraction: cfg.miniRocketPickupAdrenalineRefundFraction,
      miniRocketPickupArmor: cfg.miniRocketPickupArmor,
      miniRocketAdrenalineCostPaid: cfg.miniRocketAdrenalineCostPaid,
      miniRocketSafetyLifetimeMs: cfg.miniRocketSafetyLifetimeMs,
      miniRocketCascadeDamageBonusPerExplosion: cfg.miniRocketCascadeDamageBonusPerExplosion,
      miniRocketExplosionIndex: 0,
      ak47ShotId: cfg.ak47ShotId,
      ak47HitConfirmed: false,
      ak47DamageMultiplier: cfg.ak47DamageMultiplier,
      ak47FireSuperiorityShot: cfg.ak47FireSuperiorityShot,
      shotgunOriginX: cfg.shotgunOriginX,
      shotgunOriginY: cfg.shotgunOriginY,
      shotgunResolvedRange: cfg.shotgunResolvedRange,
      shotgunProximityMaxDamageBonus: cfg.shotgunProximityMaxDamageBonus,
      shotgunSlowFraction: cfg.shotgunSlowFraction,
      shotgunSlowDurationMs: cfg.shotgunSlowDurationMs,
      hitSlowFraction: cfg.hitSlowFraction,
      hitSlowDurationMs: cfg.hitSlowDurationMs,
      hitVulnerabilityDurationMs: cfg.hitVulnerabilityDurationMs,
      hitKnockback: cfg.hitKnockback,
      hitKnockbackDurationMs: cfg.hitKnockbackDurationMs,
      // Flammenwerfer-Felder
      isFlame:         cfg.isFlame,
      hitboxGrowRate:  cfg.hitboxGrowRate,
      hitboxMaxSize:   cfg.hitboxMaxSize,
      hitboxSize:      cfg.size,
      velocityDecay:   cfg.velocityDecay,
      burnDurationMs:    cfg.burnDurationMs,
      burnDamagePerTick: cfg.burnDamagePerTick,
      projectileBurnVisualStyle: cfg.projectileBurnVisualStyle,
      flamePierceHitIds: cfg.isFlame && cfg.flamePiercing ? new Set<string>() : undefined,
      hitObstacleIds: cfg.isFlame ? new Set<number>() : undefined,
      canReceiveFireImbue: cfg.canReceiveFireImbue,
      supplementalBurnOnHit: cfg.supplementalBurnOnHit,
      supplementalBurnProvenance: cfg.supplementalBurnProvenance,
      fireTrail: cfg.fireTrail,
      pathEffectKind: cfg.pathEffectKind,
      lastFireTrailCellKey: undefined,
      fireTrailHalfWidthCells: cfg.fireTrailHalfWidthCells,
      awpCorridorHalfWidth: cfg.awpCorridorHalfWidth,
      awpCorridorDamage: cfg.awpCorridorDamage,
      awpCorridorDotDurationMs: cfg.awpCorridorDotDurationMs,
      awpCorridorDotTickIntervalMs: cfg.awpCorridorDotTickIntervalMs,
      awpCorridorKnockback: cfg.awpCorridorKnockback,
      awpCorridorKnockbackDurationMs: cfg.awpCorridorKnockbackDurationMs,
      awpCorridorHitIds: cfg.awpCorridorHalfWidth !== undefined ? new Set<string>() : undefined,
      leafBlowerMinKnockback: cfg.leafBlowerMinKnockback,
      leafBlowerMaxKnockback: cfg.leafBlowerMaxKnockback,
      leafBlowerSelfPush: cfg.leafBlowerSelfPush,
      leafBlowerDeflectsProjectiles: cfg.leafBlowerDeflectsProjectiles,
      initialSpeed:    cfg.speed,
      // Granaten-Countdown
      lastCountdownEmitted: null,
      // BFG-Felder
      isBfg:            cfg.isBfg,
      proximityPulse: cfg.proximityPulse,
      // Die Pulsphase beginnt pro Projektil beim Spawn. Dadurch wartet der
      // erste Puls das konfigurierte Intervall ab, statt bei jedem neuen
      // Projektil sofort auf dem gemeinsamen Host-Frame auszulösen.
      lastProximityPulseAt: (cfg.proximityPulse?.radius ?? 0) > 0
        && (cfg.proximityPulse?.damage ?? 0) > 0 ? 0 : undefined,
      // Anti-Tunneling
      originalBodySize: cfg.size < MIN_BODY_LEN
        && cfg.isFlame !== true
        && !hasLeafBlowerCapability(cfg)
        && cfg.isBfg !== true
        && !hasGaussDischarge(cfg)
        && !cfg.isGrenade
        ? cfg.size : undefined,

      // Erweiterte Flugphysik
      frictionDelayMs: cfg.frictionDelayMs,
      airFrictionDecayPerSec: cfg.airFrictionDecayPerSec,
      bounceFrictionMultiplier: cfg.bounceFrictionMultiplier,
      stopSpeedThreshold: cfg.stopSpeedThreshold,
      frictionActivated: false,
      simulatedAgeMs: 0,
      appliedAirFrictionDecay: undefined,
      timeBubbleFactor: initialTimeBubbleFactor,
    };

    // Phaser-Damping für Air-Friction vorbereiten
    if (cfg.airFrictionDecayPerSec !== undefined) {
      body.useDamping = true;
      // Drag erst nach frictionDelayMs aktivieren; bis dahin kein Luftwiderstand (Faktor 1)
      if (!cfg.frictionDelayMs || cfg.frictionDelayMs <= 0) {
        const effectiveDecay = effectiveAirFrictionDecay(cfg.airFrictionDecayPerSec, initialTimeBubbleFactor);
        body.setDrag(effectiveDecay, effectiveDecay);
        tracked.frictionActivated = true;
        tracked.appliedAirFrictionDecay = effectiveDecay;
      } else {
        body.setDrag(1, 1);
      }
    }

    this.setupProjectileColliders(id, resolvedSpawn.x, resolvedSpawn.y, sprite, body, tracked, cfg);

    // Tracer-Leuchtlinie (optional, data-driven via tracerConfig)
    if (cfg.tracerConfig && this.tracerRenderer) {
      this.tracerRenderer.createTracer(
        id,
        resolvedSpawn.x,
        resolvedSpawn.y,
        cfg.tracerConfig,
        cfg.ownerColor ?? cfg.color,
      );
    }

    if (!cfg.suppressSpawnFx) {
      const muzzleOrigin = cfg.visualMuzzleOrigin ?? getTopDownMuzzleOrigin(x, y, angle);
      this.muzzleFlashRenderer?.playProjectileFlash(
        muzzleOrigin.x,
        muzzleOrigin.y,
        Math.cos(angle) * cfg.speed,
        Math.sin(angle) * cfg.speed,
        cfg.projectileStyle,
        cfg.bulletVisualPreset,
        cfg.energyBallVariant,
        cfg.ownerColor ?? cfg.color,
      );
      this.audioSystem?.playSound(cfg.shotAudioKey, muzzleOrigin.x, muzzleOrigin.y, ownerId);
    }

    return tracked;
  }

  /** Placeable turret shots ignore only their own supporting runtime rock. */
  private canCollideWithRockIndex(tracked: TrackedProjectile, rockIndex: number): boolean {
    return tracked.ignoreRockIndex === undefined || rockIndex !== tracked.ignoreRockIndex;
  }

  private canCollideWithRock(tracked: TrackedProjectile, rockGO: Phaser.GameObjects.GameObject): boolean {
    const rockIndex = this.rockObjects?.indexOf(rockGO as RockPhysicsProxy) ?? -1;
    return this.canCollideWithRockIndex(tracked, rockIndex);
  }

  /**
   * Richtet je nach Projektiltyp die Welt-Bounds-/Hindernis-Collider ein:
   * BFG/Gauss durchdringen (Overlap-Schaden), Impact-Cloud/Explosion zerstören bei Kontakt,
   * Flamme/Leaf-Blower stoppen, normale Projektile abprallen, Granaten ohne Bounce bleiben liegen.
   */
  private setupProjectileColliders(
    id: number,
    x: number,
    y: number,
    sprite: Phaser.GameObjects.Shape,
    body: Phaser.Physics.Arcade.Body,
    tracked: TrackedProjectile,
    cfg: ProjectileSpawnConfig,
  ): void {
    const isBfg = cfg.isBfg === true;
    const isGauss = hasGaussDischarge(cfg)
      || (cfg.collisionMode === 'overlap' && cfg.piercesTargets === true && cfg.isBfg !== true
        && cfg.isFlame !== true && !hasLeafBlowerCapability(cfg));
    const isFlame = cfg.isFlame === true;
    const isLeafBlower = hasLeafBlowerCapability(cfg);

    if (isBfg || isGauss) {
      // BFG: Welt-Bounds zerstören das Projektil; Felsen/Zug werden per Overlap beschädigt,
      // das Projektil fliegt aber durch alles durch (kein physischer Stopp).
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      const bfgBoundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        tracked.bounceCount = tracked.maxBounces + 1; // zum Entfernen markieren
      };
      tracked.boundsListener = bfgBoundsListener;
      this.scene.physics.world.on('worldbounds', bfgBoundsListener);

      // Felsen: Overlap → beschädigt Fels, Projektil fliegt weiter
      if (this.rockGroup) {
        const rockObjects = this.rockObjects;
        const onHit       = this.onRockHit;
        const c = this.scene.physics.add.overlap(sprite, this.rockGroup, (_proj, rockGO) => {
          if (!rockObjects || !onHit) return;
            if (isGauss && !tracked.gaussHitRocks) tracked.gaussHitRocks = new Set();
            if (!isGauss && !tracked.bfgHitRocks) tracked.bfgHitRocks = new Set();
          const idx = rockObjects.indexOf(rockGO as RockPhysicsProxy);
          const hitSet = isGauss ? tracked.gaussHitRocks : tracked.bfgHitRocks;
          if (idx !== -1 && hitSet && !hitSet.has(idx)) {
            hitSet.add(idx);
            const rockMult = tracked.rockDamageMult ?? 1;
            onHit(idx, tracked.damage * rockMult, tracked.ownerId);
          }
        }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
        tracked.colliders.push(c);
      }

      // Zug: Overlap → beschädigt Zug, Projektil fliegt weiter
      if (this.trainGroup) {
        const onTrainHit = this.onTrainHit;
        const c = this.scene.physics.add.overlap(sprite, this.trainGroup, () => {
          if (isGauss ? tracked.gaussHitTrain : tracked.bfgHitTrain) return;
          if (isGauss) tracked.gaussHitTrain = true;
          else tracked.bfgHitTrain = true;
          const trainMult = tracked.trainDamageMult ?? 1;
          onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
        });
        tracked.colliders.push(c);
      }
      // Trunks: kein Collider/Overlap – Projektil fliegt einfach durch

      // BfgRenderer-Visual erstellen (Host rendert ebenfalls)
      if (isBfg && this.bfgRenderer) {
        this.bfgRenderer.createVisual(id, x, y, cfg.size);
      }
    } else if (cfg.impactCloud && cfg.maxBounces === 0) {
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      body.setBounce(0, 0);
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        this.emitProjectileImpact(tracked, tracked.sprite.x, tracked.sprite.y);
        this.queueDestroyProjectile(tracked);
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      if (this.rockGroup) {
        const c = this.scene.physics.add.collider(sprite, this.rockGroup, () => {
          this.emitProjectileImpact(tracked, tracked.sprite.x, tracked.sprite.y);
          this.queueDestroyProjectile(tracked);
        }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
        tracked.colliders.push(c);
      }
      if (this.trunkGroup) {
        const c = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
          this.emitProjectileImpact(tracked, tracked.sprite.x, tracked.sprite.y);
          this.queueDestroyProjectile(tracked);
        });
        tracked.colliders.push(c);
      }
      if (this.baseGroup && !tracked.ignoreBaseCollisions) {
        const c = this.scene.physics.add.collider(sprite, this.baseGroup, (_proj, baseGO) => {
          this.applyBaseHit(tracked, baseGO as Phaser.GameObjects.GameObject);
          this.emitProjectileImpact(tracked, tracked.sprite.x, tracked.sprite.y);
          this.queueDestroyProjectile(tracked);
        });
        tracked.colliders.push(c);
      }
      if (this.trainGroup) {
        const onTrainHit = this.onTrainHit;
        const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
          const trainMult = tracked.trainDamageMult ?? 1;
          if (trainMult !== 0 && tracked.damage > 0) {
            onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
          }
          this.emitProjectileImpact(tracked, tracked.sprite.x, tracked.sprite.y);
          this.queueDestroyProjectile(tracked);
        });
        tracked.colliders.push(c);
      }
    } else if (cfg.explosion && cfg.maxBounces === 0) {
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      body.setBounce(0, 0);
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        this.queueProjectileExplosion(tracked, false, true);
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      if (this.rockGroup) {
        const c = this.scene.physics.add.collider(sprite, this.rockGroup, () => {
          this.queueProjectileExplosion(tracked, false, true);
        }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
        tracked.colliders.push(c);
      }
      if (this.trunkGroup) {
        const c = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
          this.queueProjectileExplosion(tracked, false, true);
        });
        tracked.colliders.push(c);
      }
      if (this.baseGroup && !tracked.ignoreBaseCollisions) {
        // Explosionsprojektile richten ihren Basisschaden ueber die Explosion selbst an
        // (`applyExplosionDamage`); ein direkter Treffer wuerde ihn sonst doppelt zaehlen.
        const c = this.scene.physics.add.collider(sprite, this.baseGroup, () => {
          this.queueProjectileExplosion(tracked, false, true);
        });
        tracked.colliders.push(c);
      }
      if (this.trainGroup) {
        const onTrainHit = this.onTrainHit;
        const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
          const trainMult = tracked.trainDamageMult ?? 1;
          if (!tracked.miniRocketSpent && trainMult !== 0 && tracked.damage > 0) {
            onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
          }
          this.queueProjectileExplosion(tracked, false, true);
        });
        tracked.colliders.push(c);
      }
    } else if (isFlame) {
      // Flammen: kein Bounce, Arena-Bounds und Hindernisse stoppen die Hitbox;
      // sie verweilt dann für die restliche Lifetime an der Aufprallstelle.
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        // Flamme an Wand → anhalten (Lifetime bestimmt weiterlaufend die Lebensdauer)
        body.setVelocity(0, 0);
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      this.setupFlameColliders(sprite, body, tracked);
    } else if (isLeafBlower) {
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        this.queueDestroyProjectile(tracked);
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      this.setupLeafBlowerColliders(sprite, body, tracked);
    } else if (!cfg.isGrenade || cfg.maxBounces > 0) {
      // Bounce-Physik: für normale Projektile immer; für Granaten nur wenn maxBounces > 0
      this.setupBouncePhysics(sprite, body, tracked, !cfg.isGrenade);
    } else if (cfg.isGrenade && cfg.maxBounces === 0) {
      // Granate ohne Bounces (z.B. Heilige Handgranate): Wand-Kollision, aber kein Abprallen.
      // Bleibt an der Aufprallstelle liegen und explodiert nach fuseTime.
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      body.setBounce(0, 0);
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        body.setVelocity(0, 0);
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      // Fels-/Trunk-/Zug-Kollision: Granate bleibt stecken
      if (this.rockGroup) {
        const c = this.scene.physics.add.collider(sprite, this.rockGroup, () => {
          body.setVelocity(0, 0);
        }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
        tracked.colliders.push(c);
      }
      if (this.trunkGroup) {
        const c = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
          body.setVelocity(0, 0);
        });
        tracked.colliders.push(c);
      }
      if (this.baseGroup && !tracked.ignoreBaseCollisions) {
        const c = this.scene.physics.add.collider(sprite, this.baseGroup, () => {
          body.setVelocity(0, 0);
        });
        tracked.colliders.push(c);
      }
      if (this.trainGroup) {
        const onTrainHit = this.onTrainHit;
        const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
          body.setVelocity(0, 0);
          const trainMult = tracked.trainDamageMult ?? 1;
          if (trainMult !== 0) onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
        });
        tracked.colliders.push(c);
      }
    }
  }

  /**
   * Richtet Fels-/Trunk-/Basis-/Zug-Kollision für Flammen-Hitboxen ein.
   * Felsen, Trunks und Basen stoppen die Flamme physisch (collider, kein Bounce);
   * Basen erhalten dabei direkten Schaden, die Flamme verweilt dann für ihre restliche Lifetime
   * an der Aufprallstelle.
   * Der Zug zerstört die Flamme sofort und erhält Schaden.
   */
  private setupFlameColliders(
    sprite:  Phaser.GameObjects.Shape,
    body:    Phaser.Physics.Arcade.Body,
    tracked: TrackedProjectile,
  ): void {
    // Kein Abprallen: Flamme bleibt an der Aufprallstelle stehen
    body.setBounce(0, 0);

    if (this.rockGroup) {
      // collider statt overlap: Phaser stoppt den Body physisch am Felsen. Der
      // Callback meldet den Treffer nur einmal pro Flamme; Lebensdauer und
      // Zerstörung der Flamme bleiben vom Hindernis unabhängig.
      const rockObjects = this.rockObjects;
      const onHit = this.onRockHit;
      const c = this.scene.physics.add.collider(sprite, this.rockGroup, (_proj, rockGO) => {
        if (tracked.pendingDestroy) return;
        const idx = rockObjects?.indexOf(rockGO as RockPhysicsProxy) ?? -1;
        if (idx < 0) return;
        tracked.hitObstacleIds ??= new Set<number>();
        if (tracked.hitObstacleIds.has(idx)) return;
        tracked.hitObstacleIds.add(idx);

        const obstacleKind = this.obstacleKindResolver?.(idx);
        const damage = obstacleKind !== undefined && obstacleKind !== 'rock'
          ? tracked.damage
          : tracked.damage * (tracked.rockDamageMult ?? 1);
        if (damage !== 0) onHit?.(idx, damage, tracked.ownerId);
      }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
      tracked.colliders.push(c);
    }
    if (this.trunkGroup) {
      const c = this.scene.physics.add.collider(sprite, this.trunkGroup);
      tracked.colliders.push(c);
    }
    if (this.baseGroup && !tracked.ignoreBaseCollisions) {
      const c = this.scene.physics.add.collider(sprite, this.baseGroup, (_proj, baseGO) => {
        this.applyBaseHit(tracked, baseGO as Phaser.GameObjects.GameObject);
        // A base blocks the flame physically, but the flame remains alive until its lifetime ends.
        body.setVelocity(0, 0);
      });
      tracked.colliders.push(c);
    }
    if (this.trainGroup) {
      // Zug: Flamme verursacht genau einmal Schaden und verschwindet sofort.
      const onTrainHit = this.onTrainHit;
      const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
        if (tracked.pendingDestroy) return;
        const trainMult = tracked.trainDamageMult ?? 1;
        if (trainMult !== 0) onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
        this.queueDestroyProjectile(tracked);
      });
      tracked.colliders.push(c);
    }
  }

  private setupLeafBlowerColliders(
    sprite:  Phaser.GameObjects.Shape,
    body:    Phaser.Physics.Arcade.Body,
    tracked: TrackedProjectile,
  ): void {
    body.setBounce(0, 0);

    if (this.rockGroup) {
      const c = this.scene.physics.add.collider(sprite, this.rockGroup, () => {
        this.queueDestroyProjectile(tracked);
      }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
      tracked.colliders.push(c);
    }
    if (this.trunkGroup) {
      const c = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
        this.queueDestroyProjectile(tracked);
      });
      tracked.colliders.push(c);
    }
    if (this.baseGroup && !tracked.ignoreBaseCollisions) {
      const c = this.scene.physics.add.collider(sprite, this.baseGroup, (_proj, baseGO) => {
        this.applyBaseHit(tracked, baseGO as Phaser.GameObjects.GameObject);
        this.queueDestroyProjectile(tracked);
      });
      tracked.colliders.push(c);
    }
    if (this.trainGroup) {
      const onTrainHit = this.onTrainHit;
      const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
        if (tracked.pendingDestroy) return;
        const trainMult = tracked.trainDamageMult ?? 1;
        if (trainMult !== 0 && tracked.damage > 0) {
          onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
        }
        this.queueDestroyProjectile(tracked);
      });
      tracked.colliders.push(c);
    }
  }

  /**
   * Richtet Welt- und Hindernis-Kollision mit physikalischem Abprallen ein.
   * Wird von normalen Projektilen und bouncenden Granaten (maxBounces > 0) genutzt.
   *
   * @param applyRockDamage – true für normale Projektile (Felstreffer-Schaden);
   *                          false für Granaten (kein Felstrefferschaden beim Abprallen)
   */
  private setupBouncePhysics(
    sprite:          Phaser.GameObjects.Shape,
    body:            Phaser.Physics.Arcade.Body,
    tracked:         TrackedProjectile,
    applyRockDamage: boolean,
  ): void {
    body.setCollideWorldBounds(true);
    body.onWorldBounds = true;
    // Elastischer Bounce (Richtungsumkehr durch Phaser); Geschwindigkeitsreduktion
    // erfolgt manuell über applyBounceFriction, damit die GESAMTE Geschwindigkeit
    // (nicht nur die Normalkomponente) mit dem Multiplikator reduziert wird.
    body.setBounce(1, 1);

    const isTranslocatorPuck = tracked.isTranslocatorPuck === true;

    // Hilfsfunktion: reduziert bei jedem Abprallen die Gesamtgeschwindigkeit
    const applyBounceFriction = () => {
      const mult = tracked.bounceFrictionMultiplier;
      if (mult !== undefined && mult < 1) {
        body.velocity.x *= mult;
        body.velocity.y *= mult;
      }
    };

    const isBullet     = tracked.projectileStyle === 'bullet';
    const isAwp        = tracked.projectileStyle === 'awp';
    const isGauss      = tracked.projectileStyle === 'gauss';
    const renderer     = this.bulletRenderer;

    const playImpact = (bx: number, by: number, bvx: number, bvy: number, col: number) => {
      if ((isBullet || isAwp || isGauss) && renderer) renderer.playImpactSparks(tracked.id, bx, by, bvx, bvy, col);
    };

    const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
      if (hitBody !== body) return;
      applyBounceFriction();
      const impact = this.getProjectileBodyCenter(tracked);
      if (hasHydraSplitCapability(tracked)) {
        if (this.trySplitHydraProjectile(tracked, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
        tracked.bounceCount = tracked.maxBounces + 1;
        body.reset(impact.x, impact.y);
        this.queueDestroyProjectile(tracked);
        return;
      }
      tracked.bounceCount++;
      // Funken an Arena-Wand: Velocity ist nach Bounce bereits reflektiert
      if (isBullet || isAwp || isGauss) {
        playImpact(
          body.x + body.halfWidth, body.y + body.halfHeight,
          body.velocity.x, body.velocity.y,
          tracked.color,
        );
      }
      // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
      if (tracked.bounceCount > tracked.maxBounces) {
        body.setVelocity(0, 0);
        body.enable = false;
      }
    };
    tracked.boundsListener = boundsListener;
    this.scene.physics.world.on('worldbounds', boundsListener);

    if (this.rockGroup) {
      const rockObjects = this.rockObjects;
      const onHit       = this.onRockHit;
      if (tracked.penetratesRocks) {
        const rockOverlap = this.scene.physics.add.overlap(sprite, this.rockGroup, (_proj, rockGO) => {
          const idx = rockObjects?.indexOf(rockGO as RockPhysicsProxy) ?? -1;
          if (idx < 0 || tracked.penetratedRockIds?.has(idx)) return;
          tracked.penetratedRockIds?.add(idx);
          const obstacleKind = this.obstacleKindResolver?.(idx);
          const obstacleMult = obstacleKind !== undefined && obstacleKind !== 'rock'
            ? 1
            : tracked.rockDamageMult ?? 1;
          if (applyRockDamage && obstacleMult !== 0) {
            onHit?.(idx, tracked.damage * obstacleMult, tracked.ownerId);
          }
          const impact = this.resolveObstacleImpactPoint(tracked, rockGO as Phaser.GameObjects.GameObject);
          playImpact(impact.x, impact.y, body.velocity.x, body.velocity.y, tracked.color);
        }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
        tracked.colliders.push(rockOverlap);
      } else {
      const rockCollider = this.scene.physics.add.collider(sprite, this.rockGroup, (_proj, rockGO) => {
        const idx = rockObjects?.indexOf(rockGO as RockPhysicsProxy) ?? -1;
        if (this.tryResolveSupportImpact(tracked, rockGO as Phaser.GameObjects.GameObject, idx)) return;
        if (tracked.bounceProcessedThisStep) {
          // Phasers zweite Velocity-Spiegelung rückgängig machen, damit keine Doppelumkehr entsteht
          if (tracked.velocityAfterFirstBounce) {
            body.velocity.x = tracked.velocityAfterFirstBounce.x;
            body.velocity.y = tracked.velocityAfterFirstBounce.y;
          }
          return;
        }
        tracked.bounceProcessedThisStep = true;
        applyBounceFriction();
        tracked.velocityAfterFirstBounce = { x: body.velocity.x, y: body.velocity.y };
        const impact = this.resolveObstacleImpactPoint(tracked, rockGO as Phaser.GameObjects.GameObject);
        // Funken bei Fels-Aufprall
        if (isBullet || isAwp || isGauss) {
          playImpact(
            body.x + body.halfWidth, body.y + body.halfHeight,
            body.velocity.x, body.velocity.y,
            tracked.color,
          );
        }
        if (applyRockDamage && rockObjects && onHit) {
          const obstacleKind = idx !== -1 ? this.obstacleKindResolver?.(idx) : undefined;
          const obstacleMult = obstacleKind !== undefined && obstacleKind !== 'rock'
            ? 1
            : tracked.rockDamageMult ?? 1;
          if (obstacleMult !== 0 && idx !== -1) {
            onHit(idx, tracked.damage * obstacleMult, tracked.ownerId);
          }
        }
        if (hasHydraSplitCapability(tracked)) {
          if (this.trySplitHydraProjectile(tracked, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
          tracked.bounceCount = tracked.maxBounces + 1;
          body.reset(impact.x, impact.y);
          this.queueDestroyProjectile(tracked);
          return;
        }
        tracked.bounceCount++;
        // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
        if (tracked.bounceCount > tracked.maxBounces) {
          body.setVelocity(0, 0);
          body.enable = false;
        }
      }, (_proj, rockGO) => this.canCollideWithRock(tracked, rockGO as Phaser.GameObjects.GameObject));
      tracked.colliders.push(rockCollider);
      }
    }

    if (this.trunkGroup) {
      const trunkCollider = this.scene.physics.add.collider(sprite, this.trunkGroup, (_proj, trunkGO) => {
        if (tracked.bounceProcessedThisStep) {
          if (tracked.velocityAfterFirstBounce) {
            body.velocity.x = tracked.velocityAfterFirstBounce.x;
            body.velocity.y = tracked.velocityAfterFirstBounce.y;
          }
          return;
        }
        tracked.bounceProcessedThisStep = true;
        applyBounceFriction();
        tracked.velocityAfterFirstBounce = { x: body.velocity.x, y: body.velocity.y };
        const impact = this.resolveObstacleImpactPoint(tracked, trunkGO as Phaser.GameObjects.GameObject);
        // Funken bei Baumstamm-Aufprall
        if (isBullet || isAwp || isGauss) {
          playImpact(
            body.x + body.halfWidth, body.y + body.halfHeight,
            body.velocity.x, body.velocity.y,
            tracked.color,
          );
        }
        if (hasHydraSplitCapability(tracked)) {
          if (this.trySplitHydraProjectile(tracked, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
          tracked.bounceCount = tracked.maxBounces + 1;
          body.reset(impact.x, impact.y);
          this.queueDestroyProjectile(tracked);
          return;
        }
        tracked.bounceCount++;
        // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
        if (tracked.bounceCount > tracked.maxBounces) {
          body.setVelocity(0, 0);
          body.enable = false;
        }
      });
      tracked.colliders.push(trunkCollider);
    }

    if (this.baseGroup && !tracked.ignoreBaseCollisions) {
      const baseCollider = this.scene.physics.add.collider(sprite, this.baseGroup, (_proj, baseGO) => {
        if (this.tryResolveSupportImpact(tracked, baseGO as Phaser.GameObjects.GameObject, -1)) return;
        // Explosionsprojektile melden Basisschaden ausschließlich über ihre Explosion;
        // ein direkter Treffer würde bei bouncenden Varianten doppelt zählen.
        if (!tracked.explosion) {
          // Vor dem Bounce-Early-Return: sonst zaehlte ein Treffer im selben Schritt nicht.
          this.applyBaseHit(tracked, baseGO as Phaser.GameObjects.GameObject);
        }
        if (tracked.bounceProcessedThisStep) {
          if (tracked.velocityAfterFirstBounce) {
            body.velocity.x = tracked.velocityAfterFirstBounce.x;
            body.velocity.y = tracked.velocityAfterFirstBounce.y;
          }
          return;
        }
        tracked.bounceProcessedThisStep = true;
        applyBounceFriction();
        tracked.velocityAfterFirstBounce = { x: body.velocity.x, y: body.velocity.y };
        const impact = this.resolveObstacleImpactPoint(tracked, baseGO as Phaser.GameObjects.GameObject);
        if (isBullet || isAwp || isGauss) {
          playImpact(
            body.x + body.halfWidth, body.y + body.halfHeight,
            body.velocity.x, body.velocity.y,
            tracked.color,
          );
        }
        if (hasHydraSplitCapability(tracked)) {
          if (this.trySplitHydraProjectile(tracked, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
          tracked.bounceCount = tracked.maxBounces + 1;
          body.reset(impact.x, impact.y);
          this.queueDestroyProjectile(tracked);
          return;
        }
        tracked.bounceCount++;
        if (tracked.bounceCount > tracked.maxBounces) {
          body.setVelocity(0, 0);
          body.enable = false;
        }
      });
      tracked.colliders.push(baseCollider);
    }

    if (this.trainGroup) {
      const onTrainHit = this.onTrainHit;
      const trainCollider = this.scene.physics.add.collider(sprite, this.trainGroup, (_proj, trainGO) => {
        if (tracked.bounceProcessedThisStep) {
          if (tracked.velocityAfterFirstBounce) {
            body.velocity.x = tracked.velocityAfterFirstBounce.x;
            body.velocity.y = tracked.velocityAfterFirstBounce.y;
          }
          return;
        }
        tracked.bounceProcessedThisStep = true;
        const impact = this.resolveObstacleImpactPoint(tracked, trainGO as Phaser.GameObjects.GameObject);
        // Translocator prallt am Zug ab ohne Schaden
        if (!isTranslocatorPuck) {
          const trainMult = tracked.trainDamageMult ?? 1;
          if (trainMult !== 0) {
            onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
          }
        }
        // Funken bei Zug-Aufprall
        if (isBullet || isAwp || isGauss) {
          playImpact(
            body.x + body.halfWidth, body.y + body.halfHeight,
            body.velocity.x, body.velocity.y,
            tracked.color,
          );
        }
        applyBounceFriction();
        tracked.velocityAfterFirstBounce = { x: body.velocity.x, y: body.velocity.y };
        if (hasHydraSplitCapability(tracked)) {
          if (this.trySplitHydraProjectile(tracked, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
          tracked.bounceCount = tracked.maxBounces + 1;
          body.reset(impact.x, impact.y);
          this.queueDestroyProjectile(tracked);
          return;
        }
        tracked.bounceCount++;
        // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
        if (tracked.bounceCount > tracked.maxBounces) {
          body.setVelocity(0, 0);
          body.enable = false;
        }
      });
      tracked.colliders.push(trainCollider);
    }
  }

  private shouldUseContinuousRockCollision(proj: TrackedProjectile): boolean {
    return proj.collisionMode === 'sweep'
      && !proj.isGrenade
      && !proj.isFlame
      && !proj.isBfg
      && !proj.pendingDestroy
      && !proj.bounceProcessedThisStep
      && !proj.penetratesRocks
      && !!this.rockObjects;
  }

  private resolveContinuousRockCollision(proj: TrackedProjectile): void {
    if (!this.rockObjects) return;

    const line = new Phaser.Geom.Line(proj.lastX, proj.lastY, proj.sprite.x, proj.sprite.y);
    const segmentLength = Phaser.Geom.Line.Length(line);
    if (segmentLength <= 0.5) return;

    // Als Objekt statt als lokale Variablen: der Besucher unten ist eine Closure, und
    // TypeScript verfolgt Zuweisungen aus einer Closure heraus nicht für die Narrowing-
    // Analyse – über Objektfelder bleiben die Typen nach der Abfrage erhalten.
    const best: {
      rockIndex: number;
      hit: GeometryHit | null;
    } = { rockIndex: -1, hit: null };

    const scanRock = (rockIndex: number, left: number, top: number, right: number, bottom: number): void => {
      if (!this.canCollideWithRockIndex(proj, rockIndex)) return;
      const rect = this.scratchObstacleRect.setTo(left, top, right - left, bottom - top);
      const hit = this.findNearestRectangleHit(line, rect);
      if (!hit) return;
      if (!best.hit || hit.distance < best.hit.distance) {
        best.hit = hit;
        best.rockIndex = rockIndex;
        // Das Scratch-Rechteck wird beim nächsten Kandidaten überschrieben, der
        // Aufprallwinkel braucht die Kanten aber noch – deshalb eine eigene Kopie.
        this.bestRockRect.setTo(left, top, right - left, bottom - top);
      }
    };

    if (this.obstacleIndex) {
      this.obstacleIndex.querySegment(
        line.x1, line.y1, line.x2, line.y2,
        (kind, rockIndex, left, top, right, bottom) => {
          if (kind === OBSTACLE_ROCK) scanRock(rockIndex, left, top, right, bottom);
          return false;
        },
        () => false,
      );
    } else {
      for (let i = 0; i < this.rockObjects.length; i++) {
        if (!this.canCollideWithRockIndex(proj, i)) continue;
        const rock = this.rockObjects[i];
        if (!rock?.active) continue;
        const bounds = rock.getBounds();
        scanRock(i, bounds.left, bounds.top, bounds.right, bounds.bottom);
      }
    }

    const bestHit = best.hit;
    const bestRockIndex = best.rockIndex;
    if (!bestHit || bestRockIndex < 0) return;
    const bestRect = this.bestRockRect;

    let nextVx = proj.body.velocity.x;
    let nextVy = proj.body.velocity.y;
    const normal = this.getRectangleImpactNormal(bestRect, bestHit.x, bestHit.y);

    if (Math.abs(normal.x) > 0.001) nextVx *= -1;
    if (Math.abs(normal.y) > 0.001) nextVy *= -1;

    const frictionMultiplier = proj.bounceFrictionMultiplier;
    if (frictionMultiplier !== undefined && frictionMultiplier < 1) {
      nextVx *= frictionMultiplier;
      nextVy *= frictionMultiplier;
    }

    proj.bounceCount++;

    const obstacleKind = this.obstacleKindResolver?.(bestRockIndex);
    const obstacleMult = obstacleKind !== undefined && obstacleKind !== 'rock'
      ? 1
      : proj.rockDamageMult ?? 1;
    if (obstacleMult !== 0) {
      this.onRockHit?.(bestRockIndex, proj.damage * obstacleMult, proj.ownerId);
    }

    this.bulletRenderer?.playImpactSparks(proj.id, bestHit.x, bestHit.y, nextVx, nextVy, proj.color);

    if (proj.bounceCount > proj.maxBounces) {
      proj.body.reset(bestHit.x, bestHit.y);
      proj.body.setVelocity(0, 0);
      proj.body.enable = false;
      return;
    }

    const normalLength = Math.hypot(normal.x, normal.y) || 1;
    const offsetDistance = Math.max(proj.sprite.displayWidth * 0.5 + 0.5, 1);
    const resolvedX = bestHit.x + (normal.x / normalLength) * offsetDistance;
    const resolvedY = bestHit.y + (normal.y / normalLength) * offsetDistance;

    proj.body.reset(resolvedX, resolvedY);
    proj.body.setVelocity(nextVx, nextVy);
  }

  private getRectangleImpactNormal(
    rect: Phaser.Geom.Rectangle,
    x: number,
    y: number,
  ): { x: number; y: number } {
    const distances = [
      { axis: 'left', value: Math.abs(x - rect.left) },
      { axis: 'right', value: Math.abs(x - rect.right) },
      { axis: 'top', value: Math.abs(y - rect.top) },
      { axis: 'bottom', value: Math.abs(y - rect.bottom) },
    ] as const;

    const minDistance = Math.min(...distances.map((entry) => entry.value));
    const epsilon = 0.75;
    let nx = 0;
    let ny = 0;

    for (const entry of distances) {
      if (entry.value > minDistance + epsilon) continue;
      switch (entry.axis) {
        case 'left':
          nx -= 1;
          break;
        case 'right':
          nx += 1;
          break;
        case 'top':
          ny -= 1;
          break;
        case 'bottom':
          ny += 1;
          break;
      }
    }

    if (nx === 0 && ny === 0) {
      nx = projFallbackSign(x - rect.centerX);
      ny = projFallbackSign(y - rect.centerY);
    }

    return { x: nx, y: ny };
  }

  private findNearestRectangleHit(
    line: Phaser.Geom.Line,
    rect: Phaser.Geom.Rectangle,
  ): GeometryHit | null {
    return geomNearestRectangleHit(line, rect, this.scratchPoints);
  }

  private getProjectileBodyCenter(proj: TrackedProjectile): { x: number; y: number } {
    return {
      x: proj.body.x + proj.body.halfWidth,
      y: proj.body.y + proj.body.halfHeight,
    };
  }

  private resolveObstacleImpactPoint(
    proj: TrackedProjectile,
    obstacle?: Phaser.GameObjects.GameObject | null,
  ): { x: number; y: number } {
    const fallback = this.getProjectileBodyCenter(proj);
    if (!obstacle || !('getBounds' in obstacle) || typeof obstacle.getBounds !== 'function') {
      return fallback;
    }

    const line = new Phaser.Geom.Line(proj.lastX, proj.lastY, proj.sprite.x, proj.sprite.y);
    const hit = this.findNearestRectangleHit(line, obstacle.getBounds());
    return hit ? { x: hit.x, y: hit.y } : fallback;
  }

  private getHydraSplitAngles(baseAngle: number, splitCount: number, splitSpreadDeg: number): number[] {
    if (splitCount <= 0) return [];

    const half = Math.floor(splitCount / 2);
    const offsets: number[] = [];
    if (splitCount % 2 === 1) {
      for (let index = -half; index <= half; index++) {
        offsets.push(index * splitSpreadDeg);
      }
    } else {
      for (let index = -half; index <= -1; index++) {
        offsets.push(index * splitSpreadDeg);
      }
      for (let index = 1; index <= half; index++) {
        offsets.push(index * splitSpreadDeg);
      }
    }

    return offsets.map((offsetDeg) => baseAngle + Phaser.Math.DegToRad(offsetDeg));
  }

  private getRemainingRangeAfterImpact(proj: TrackedProjectile, impactX: number, impactY: number): number {
    const baseRange = proj.remainingRangePx ?? (Math.max(proj.initialSpeed ?? proj.body.velocity.length(), 0) * proj.lifetime) / 1000;
    const impactDistance = Phaser.Math.Distance.Between(proj.lastX, proj.lastY, impactX, impactY);
    return Math.max(0, baseRange - impactDistance);
  }

  private trySplitHydraProjectile(
    proj: TrackedProjectile,
    impactX: number,
    impactY: number,
    outgoingVx: number,
    outgoingVy: number,
  ): boolean {
    const splitCount = Math.max(0, Math.floor(proj.splitCount ?? 0));
    if (splitCount <= 0) return false;

    const nextBounceCount = proj.bounceCount + 1;
    if (nextBounceCount > proj.maxBounces) return false;

    const outgoingSpeed = Math.hypot(outgoingVx, outgoingVy);
    if (outgoingSpeed <= 0.001) return false;

    const spawnTimeBubbleFactor = Phaser.Math.Clamp(
      this.timeBubbleFactorProvider?.(impactX, impactY, this.hostFrameNowMs ?? proj.createdAt, proj.ownerId)
        ?? (proj.timeBubbleFactor ?? 1),
      0.0001,
      1,
    );
    const childBaseSpeed = outgoingSpeed / spawnTimeBubbleFactor;

    const remainingRangePx = this.getRemainingRangeAfterImpact(proj, impactX, impactY);
    if (remainingRangePx <= 0.5) return false;

    const splitSpread = proj.splitSpread ?? 0;
    const childAngles = this.getHydraSplitAngles(Math.atan2(outgoingVy, outgoingVx), splitCount, splitSpread);
    if (childAngles.length === 0) return false;

    const splitFactor = proj.splitFactor ?? 1;
    const childSize = Math.max(4, (proj.sprite.displayWidth / splitCount) * splitFactor);
    const childDamage = Math.max(1, (proj.damage / splitCount) * splitFactor);
    const childAdrenalinGain = Math.max(0, (proj.adrenalinGain / splitCount) * splitFactor);
    const childLifetime = (remainingRangePx / childBaseSpeed) * 1000;

    proj.pendingHydraSplit = {
      x: impactX,
      y: impactY,
      angles: childAngles,
    };
    this.queueDestroyProjectile(proj);

    for (const childAngle of childAngles) {
      this.spawnProjectile(impactX, impactY, childAngle, proj.ownerId, {
        speed: childBaseSpeed,
        size: childSize,
        damage: childDamage,
        color: proj.color,
        allowTeamDamage: proj.allowTeamDamage,
        ignoreBaseCollisions: proj.ignoreBaseCollisions,
        ownerColor: proj.ownerColor,
        lifetime: childLifetime,
        maxBounces: proj.maxBounces,
        isGrenade: proj.isGrenade,
        isTranslocatorPuck: proj.isTranslocatorPuck,
        collisionMode: proj.collisionMode,
        adrenalinGain: childAdrenalinGain,
        sourceId: proj.sourceId,
        explosion: proj.explosion,
        impactCloud: proj.impactCloud,
        sporeVisualVariant: proj.sporeVisualVariant,
        homing: proj.splitHoming ?? proj.homing,
        projectileVisualScale: proj.projectileVisualScale,
        smokeTrailColor: proj.smokeTrailColor,
        fuseTime: proj.fuseTime,
        grenadeEffect: proj.grenadeEffect,
        projectileStyle: proj.projectileStyle,
        bulletVisualPreset: proj.bulletVisualPreset,
        grenadeVisualPreset: proj.grenadeVisualPreset,
        energyBallVariant: proj.energyBallVariant,
        tracerConfig: proj.tracerConfig,
        detonable: proj.detonable,
        detonator: proj.detonator,
        rockDamageMult: proj.rockDamageMult,
        trainDamageMult: proj.trainDamageMult,
        baseDamageMult: proj.baseDamageMult,
        isFlame: proj.isFlame,
        hitboxGrowRate: proj.hitboxGrowRate,
        hitboxMaxSize: proj.hitboxMaxSize,
        velocityDecay: proj.velocityDecay,
        burnDurationMs: proj.burnDurationMs,
        burnDamagePerTick: proj.burnDamagePerTick,
        projectileBurnVisualStyle: proj.projectileBurnVisualStyle,
        leafBlowerMinKnockback: proj.leafBlowerMinKnockback,
        leafBlowerMaxKnockback: proj.leafBlowerMaxKnockback,
        leafBlowerSelfPush: proj.leafBlowerSelfPush,
        isBfg: proj.isBfg,
        piercesTargets: proj.piercesTargets,
        penetrationCount: proj.penetrationRemaining,
        penetrationDamageRetention: proj.penetrationDamageRetention,
        penetratesRocks: proj.penetratesRocks,
        flamePiercing: proj.flamePierceHitIds !== undefined,
        leafBlowerDeflectsProjectiles: proj.leafBlowerDeflectsProjectiles,
        proximityPulse: proj.proximityPulse,
        gaussChainRadius: proj.gaussChainRadius,
        gaussChainDamageFactor: proj.gaussChainDamageFactor,
        frictionDelayMs: proj.frictionDelayMs,
        airFrictionDecayPerSec: proj.airFrictionDecayPerSec,
        bounceFrictionMultiplier: proj.bounceFrictionMultiplier,
        stopSpeedThreshold: proj.stopSpeedThreshold,
        sourceSlot: proj.sourceSlot,
        shotAudioKey: proj.shotAudioKey,
        splitCount: proj.splitCount,
        splitSpread: proj.splitSpread,
        splitFactor: proj.splitFactor,
        splitHoming: proj.splitHoming,
        initialBounceCount: nextBounceCount,
        remainingRangePx,
        suppressSpawnFx: true,
      });
    }

    return true;
  }

  /**
   * Meldet den Hindernistreffer eines Unterstuetzungsprojektils und verbraucht es dabei.
   * Gibt `true` zurueck, wenn der Aufrufer die normale Abpraller-Behandlung ueberspringen soll.
   *
   * `rockId < 0` kennzeichnet eine Basiszelle: die Basis wird ueber den Einschlagspunkt
   * aufgeloest, weil der Collider nur die einzelne Zelle kennt.
   */
  private tryResolveSupportImpact(
    proj: TrackedProjectile,
    obstacle: Phaser.GameObjects.GameObject,
    rockId: number,
  ): boolean {
    if (!proj.energyInjectorPayload) return false;
    if (proj.supportConsumed) return true;
    proj.supportConsumed = true;
    const impact = this.resolveObstacleImpactPoint(proj, obstacle);
    this.onSupportImpact?.(
      proj,
      rockId >= 0
        ? { kind: 'rock', rockId, x: impact.x, y: impact.y }
        : { kind: 'base', x: impact.x, y: impact.y },
    );
    this.queueDestroyProjectile(proj);
    return true;
  }

  /**
   * Markiert ein Projektil zur sofortigen Entfernung aus Host-Logik und Phaser-Kollision.
   * Das eigentliche Cleanup erfolgt gesammelt im nächsten hostUpdate().
   */
  private queueDestroyProjectile(proj: TrackedProjectile): void {
    if (proj.pendingDestroy) return;
    proj.pendingDestroy = true;
    proj.body.setVelocity(0, 0);
    proj.body.enable = false;
    this.removeActiveProjectile(proj);
  }

  /** Beendet Identity und Aktivmenge über den Owner und gibt danach die Ressourcen frei. */
  private destroyTrackedProjectile(proj: TrackedProjectile): void {
    if (this.owner) {
      this.owner.releaseProjectile(proj);
      return;
    }
    this.releaseProjectileResources(proj);
  }

  /**
   * Gibt Physics-, Collider- und Darstellungsressourcen eines vom Owner entfernten Records frei.
   * Registry und Identity sind zu diesem Zeitpunkt bereits beendet.
   */
  releaseProjectileResources(proj: TrackedProjectile): void {
    proj.hitObstacleIds?.clear();
    proj.hitBaseIds?.clear();
    this.projectileResolvedCallback?.(proj);
    const destroyX = proj.pendingHydraSplit?.x ?? proj.sprite.x;
    const destroyY = proj.pendingHydraSplit?.y ?? proj.sprite.y;
    const destroyScale = proj.sprite.displayWidth / 16;
    this.scene.physics.world.off('worldbounds', proj.boundsListener);
    for (const c of proj.colliders) c.destroy();
    proj.sprite.destroy();
    this.bulletRenderer?.destroyVisual(proj.id);
    this.tracerRenderer?.destroyTracer(proj.id);
    this.flameRenderer?.destroyVisual(proj.id);
    this.projectileBurnRenderer?.destroyVisual(proj.id);
    this.leafBlowerRenderer?.destroyVisual(proj.id);
    this.bfgRenderer?.destroyVisual(proj.id);
    this.gaussRenderer?.destroyVisual(proj.id);
    if (proj.projectileStyle === 'energy_ball') {
      this.energyBallRenderer?.playImpact(destroyX, destroyY, proj.color, proj.energyBallVariant, destroyScale);
    }
    if (proj.projectileStyle === 'hydra') {
      if (proj.pendingHydraSplit) {
        this.hydraRenderer?.playSplitImpact(destroyX, destroyY, proj.color, proj.pendingHydraSplit.angles, destroyScale);
      } else {
        this.hydraRenderer?.playImpact(destroyX, destroyY, proj.color, Math.max(destroyScale, 0.95));
      }
    }
    if (proj.projectileStyle === 'spore') {
      this.sporeRenderer?.playImpact(
        destroyX,
        destroyY,
        proj.color,
        Math.max(destroyScale, 0.9),
        proj.sporeVisualVariant,
      );
    }
    if (proj.projectileStyle === 'tesla_bolt') {
      this.teslaBoltRenderer?.playImpact(destroyX, destroyY, proj.sprite.displayWidth, proj.color);
    }
    this.hydraRenderer?.destroyVisual(proj.id);
    this.energyBallRenderer?.destroyVisual(proj.id);
    this.grenadeRenderer?.destroyVisual(proj.id);
    this.holyGrenadeRenderer?.destroyVisual(proj.id);
    this.rocketRenderer?.destroyVisual(proj.id);
    this.fireballRenderer?.destroyVisual(proj.id);
    this.sporeRenderer?.destroyVisual(proj.id);
    this.translocatorPuckRenderer?.destroyVisual(proj.id);
    this.teslaBoltRenderer?.destroyVisual(proj.id);
  }

  private removeActiveProjectile(proj: TrackedProjectile): void {
    this.owner?.store.deactivate(proj);
  }

  private queueProjectileExplosion(
    proj: TrackedProjectile,
    allowMultiContinue = false,
    stopMultiContinuationAtObstacle = false,
  ): void {
    if (proj.pendingExplosion) return;
    if (!proj.explosion) {
      if (proj.miniRocketSpent) this.queueSpentMiniRocketDestruction(proj);
      return;
    }
    const simulatedAge = proj.simulatedAgeMs ?? 0;
    const nextExplosionAt = proj.miniRocketNextExplosionAtAgeMs ?? 0;
    if (proj.miniRocketStageRangePx !== undefined && simulatedAge < nextExplosionAt) {
      const velocityLength = proj.body.velocity.length();
      if (velocityLength > 0.001) {
        proj.miniRocketContinuationVx = proj.body.velocity.x;
        proj.miniRocketContinuationVy = proj.body.velocity.y;
      }
      proj.miniRocketDeferredExplosion = true;
      proj.miniRocketDeferredExplosionStopsAtObstacle =
        (proj.miniRocketDeferredExplosionStopsAtObstacle ?? false) || stopMultiContinuationAtObstacle;
      proj.body.setVelocity(0, 0);
      proj.body.enable = false;
      return;
    }
    proj.miniRocketDeferredExplosion = false;
    const stopsAtObstacle = (proj.miniRocketDeferredExplosionStopsAtObstacle ?? false)
      || stopMultiContinuationAtObstacle;
    proj.miniRocketDeferredExplosionStopsAtObstacle = false;
    const remaining = Math.max(1, proj.multiExplosionsRemaining ?? 1);
    const explosionIndex = Math.max(0, proj.miniRocketExplosionIndex ?? 0);
    const cascadeMultiplier = getMiniRocketCascadeMultiplier(
      explosionIndex,
      proj.miniRocketCascadeDamageBonusPerExplosion ?? 0,
    );
    const cascadeColor = proj.explosion.color === undefined
      ? undefined
      : this.resolveMiniRocketCascadeColor(proj.explosion.color, explosionIndex);
    const resolvedEffect = cascadeMultiplier > 1.0001
      ? {
          ...proj.explosion,
          radius: proj.explosion.radius * cascadeMultiplier,
          maxDamage: proj.explosion.maxDamage * cascadeMultiplier,
          minDamage: proj.explosion.minDamage === undefined
            ? undefined
            : proj.explosion.minDamage * cascadeMultiplier,
          color: cascadeColor,
          visualStyle: proj.explosion.visualStyle === 'mini_rocket'
            ? 'mini_rocket_cascade' as const
            : proj.explosion.visualStyle,
        }
      : proj.explosion;
    if (proj.miniRocketStageRangePx !== undefined) {
      proj.miniRocketExplosionIndex = explosionIndex + 1;
    }
    const isExtendedMiniRocket = proj.miniRocketStageRangePx !== undefined;
    const continuesChainAfterExplosion = !stopsAtObstacle
      && (allowMultiContinue || isExtendedMiniRocket)
      && remaining > 1;
    const returnsSpentAfterExplosion = isExtendedMiniRocket
      && proj.miniRocketReturnEnabled === true
      && !continuesChainAfterExplosion;
    const resumesAfterExplosion = continuesChainAfterExplosion || returnsSpentAfterExplosion;
    if (resumesAfterExplosion && isExtendedMiniRocket) {
      const velocityLength = proj.body.velocity.length();
      if (velocityLength > 0.001) {
        proj.miniRocketContinuationVx = proj.body.velocity.x;
        proj.miniRocketContinuationVy = proj.body.velocity.y;
      } else {
        const dx = proj.sprite.x - proj.lastX;
        const dy = proj.sprite.y - proj.lastY;
        const distance = Math.hypot(dx, dy);
        const fallbackSpeed = Math.max(1, (proj.initialSpeed ?? 1) * (proj.timeBubbleFactor ?? 1));
        if (distance > 0.001) {
          proj.miniRocketContinuationVx = (dx / distance) * fallbackSpeed;
          proj.miniRocketContinuationVy = (dy / distance) * fallbackSpeed;
        }
      }
    }
    proj.multiExplosionsRemaining = returnsSpentAfterExplosion ? 0 : remaining - 1;
    proj.miniRocketSpent = returnsSpentAfterExplosion;
    proj.pendingExplosion = true;
    this.pendingProjectileExplosions.push({
      x: proj.sprite.x,
      y: proj.sprite.y,
      ownerId: proj.ownerId,
      effect: resolvedEffect,
      sourceSlot: proj.sourceSlot,
      sourceTurretId: proj.sourceTurretId,
      sourceId: proj.sourceId,
      projectileId: proj.id,
      continuesAfterExplosion: resumesAfterExplosion,
    });
    if (resumesAfterExplosion) {
      this.resetHomingState(proj);
      proj.body.setVelocity(0, 0);
      proj.body.enable = false;
    } else {
      this.queueDestroyProjectile(proj);
    }
  }

  private emitProjectileImpact(proj: TrackedProjectile, x: number, y: number): void {
    this.projectileImpactCallback?.(proj, x, y);
  }

  /** Host: stabile, allokationsfreie Sicht für Kollisionen und Host-Systeme. */
  getActiveProjectiles(): ReadonlySet<TrackedProjectile> {
    return this.activeProjectiles;
  }

  getDebugActiveProjectileCount(): number {
    return Math.max(
      this.activeProjectiles.size,
      this.clientProjStates.size,
      this.clientVisuals.size,
    );
  }

  /**
   * Host: Gibt ein aktives Projektil anhand seiner ID zurück.
   */
  getProjectileById(id: number): TrackedProjectile | undefined {
    const projectile = this.owner?.store.getById(id);
    return projectile?.pendingDestroy ? undefined : projectile;
  }

  /** Applies a travel-acquired burn to the canonical record; callers never receive that record. */
  applyProjectileBurnAugment(id: number, augment: ProjectileBurnAugment): boolean {
    const projectile = this.getActiveProjectileById(id);
    if (!projectile?.canReceiveFireImbue || projectile.isGrenade || projectile.isFlame) return false;
    if (projectile.supplementalBurnOnHit
      && augment.burn.damagePerTick <= projectile.supplementalBurnOnHit.damagePerTick) return false;
    projectile.supplementalBurnOnHit = { ...augment.burn };
    projectile.supplementalBurnProvenance = augment.provenance;
    return true;
  }

  private searchDetonableProjectiles(
    detonableIds: ReadonlySet<number>,
    request: ProjectileDetonationSearchRequest,
  ): readonly ProjectileDetonationTarget[] {
    this.scratchLine.setTo(request.startX, request.startY, request.endX, request.endY);
    const targets: ProjectileDetonationTarget[] = [];
    for (const projectileId of detonableIds) {
      const projectile = this.getActiveProjectileById(projectileId);
      if (!projectile?.detonable) continue;
      if (!request.detonator.triggerTags.includes(projectile.detonable.tag)) continue;
      if (!projectile.detonable.allowCrossTeam && projectile.ownerId !== request.shooterId) continue;
      if (!Phaser.Geom.Intersects.LineToRectangle(this.scratchLine, projectile.sprite.getBounds())) continue;
      targets.push(createDetonationTarget(projectile));
    }
    return targets;
  }

  private detonateProjectile(
    projectileId: number,
    detonatorOwnerId: string,
  ): ProjectileDetonationOutcome | null {
    const projectile = this.getActiveProjectileById(projectileId);
    if (!projectile?.detonable) return null;
    const target = createDetonationTarget(projectile);
    this.destroyProjectile(projectileId);
    return { ...target, detonatorOwnerId };
  }

  private detonateOverlappingProjectiles(
    detonatorIds: ReadonlySet<number>,
    detonableIds: ReadonlySet<number>,
  ): readonly ProjectileDetonationOutcome[] {
    const outcomes: ProjectileDetonationOutcome[] = [];
    const destroyedIds = new Set<number>();
    const active = this.activeProjectiles;
    for (const detonator of active) {
      if (!detonatorIds.has(detonator.id) || destroyedIds.has(detonator.id)) continue;
      for (const target of active) {
        if (!detonableIds.has(target.id) || destroyedIds.has(target.id)) continue;
        if (detonator.id === target.id || !target.detonable) continue;
        if (!detonator.detonator?.triggerTags.includes(target.detonable.tag)) continue;
        if (!target.detonable.allowCrossTeam && target.ownerId !== detonator.ownerId) continue;
        if (!Phaser.Geom.Intersects.RectangleToRectangle(
          detonator.sprite.getBounds(),
          target.sprite.getBounds(),
        )) continue;

        destroyedIds.add(target.id);
        const detonation = this.detonateProjectile(target.id, detonator.ownerId);
        if (detonation) outcomes.push(detonation);
      }
    }
    return outcomes;
  }

  private getActiveProjectileById(id: number): TrackedProjectile | undefined {
    const projectile = this.owner?.store.getById(id);
    if (!projectile || projectile.pendingDestroy || !this.owner?.store.activeRecords.has(projectile)) return undefined;
    return projectile;
  }

  getShadowSamples(): readonly ShadowProjectileSample[] {
    const samples = this.shadowSamples;
    samples.length = 0;
    if (this.activeProjectiles.size > 0) {
      for (const projectile of this.activeProjectiles) {
        if (!projectile.sprite.active) continue;
        samples.push({
          id: projectile.id,
          x: projectile.sprite.x,
          y: projectile.sprite.y,
          size: Math.max(projectile.sprite.displayWidth, projectile.sprite.displayHeight),
          style: projectile.projectileStyle,
        });
      }
      return samples;
    }

    const now = performance.now();
    for (const [id, state] of this.clientProjStates) {
      const extrapolated = this.extrapolateClientProjectileState(state, now);
      if (!extrapolated) continue;
      samples.push({
        id,
        x: extrapolated.x,
        y: extrapolated.y,
        size: state.size,
        style: state.style as ProjectileStyle | undefined,
      });
    }
    return samples;
  }

  /**
   * Projektile, die selbst leuchten könnten – die Auswahl trifft der Aufrufer über
   * `getProjectileLightSpec()`.
   *
   * Aufbau bewusst identisch zu `getShadowSamples()`: auf dem Host stammen die Werte aus
   * den Physik-Bodies, auf Clients aus den extrapolierten Snapshots. Damit ist der
   * Lichtpfad ohne eine zweite Fallunterscheidung auf beiden Seiten gleich.
   */
  getLightSamples(): readonly ProjectileLightSample[] {
    const samples = this.lightSamples;
    samples.length = 0;
    if (this.activeProjectiles.size > 0) {
      for (const projectile of this.activeProjectiles) {
        if (!projectile.sprite.active) continue;
        samples.push({
          id: projectile.id,
          x: projectile.sprite.x,
          y: projectile.sprite.y,
          size: Math.max(projectile.sprite.displayWidth, projectile.sprite.displayHeight),
          color: projectile.color,
          style: projectile.projectileStyle,
          energyBallVariant: projectile.energyBallVariant,
          grenadeVisualPreset: projectile.grenadeVisualPreset,
        });
      }
      return samples;
    }

    const now = performance.now();
    for (const [id, state] of this.clientProjStates) {
      const extrapolated = this.extrapolateClientProjectileState(state, now);
      if (!extrapolated) continue;
      samples.push({
        id,
        x: extrapolated.x,
        y: extrapolated.y,
        size: state.size,
        color: state.color,
        style: state.style as ProjectileStyle | undefined,
        energyBallVariant: state.energyBallVariant,
        grenadeVisualPreset: state.grenadeVisualPreset,
      });
    }
    return samples;
  }

  /**
   * §5.1-Seam: einzelnes Projektil sofort zerstören (z.B. nach Spielertreffer).
   *
   * Die Entfernung selbst verantwortet der world-owned Owner; unbekannte Ids sind wirkungslos.
   */
  destroyProjectile(id: number): void {
    this.owner?.destroyProjectile(id);
  }

  triggerProjectileExplosion(id: number, impactTargetKey?: string): boolean {
    const proj = this.getProjectileById(id);
    if (!proj?.explosion) return false;
    // Nur das Ziel, das die aktuelle Explosion ausgeloest hat, wird waehrend der
    // anschliessenden Geradeausphase ignoriert. Andere Ziele und alle Phaser-
    // Hinderniscollider bleiben aktiv. Nach der Coast-Phase darf dasselbe Ziel
    // wieder gewaehlt und getroffen werden.
    proj.multiExplosionExcludedTargetKeys?.clear();
    if (impactTargetKey) proj.multiExplosionExcludedTargetKeys?.add(impactTargetKey);
    this.queueProjectileExplosion(proj, true);
    return true;
  }

  /** Host: queue an explosion that is not attached to a projectile (e.g. Plasma Swarm). */
  queueStandaloneExplosion(
    x: number,
    y: number,
    ownerId: string,
    effect: import('../types').ProjectileExplosionConfig,
    sourceSlot?: import('../types').LoadoutSlot,
    sourceId?: string,
  ): void {
    this.pendingProjectileExplosions.push({ x, y, ownerId, effect, sourceSlot, sourceId });
  }

  resumeMultiExplosionProjectile(id: number, excludedTargetKeys: readonly string[]): void {
    const proj = this.getProjectileById(id);
    if (!proj || ((proj.multiExplosionsRemaining ?? 0) <= 0 && !proj.miniRocketSpent)) return;
    void excludedTargetKeys;
    proj.pendingExplosion = false;
    this.resetHomingState(proj);
    if (proj.miniRocketStageRangePx !== undefined) {
      proj.miniRocketHasExploded = true;
      if (proj.miniRocketSpent) {
        // Die letzte Detonation ist verbraucht: Der Rueckflug bleibt als
        // einsammelbares Objekt bestehen, darf aber weder Ziele suchen noch
        // Direkttreffer oder weitere Explosionen ausloesen.
        proj.explosion = undefined;
        proj.multiExplosionExcludedTargetKeys?.clear();
        proj.body.enable = true;
        const vx = proj.miniRocketContinuationVx ?? proj.body.velocity.x;
        const vy = proj.miniRocketContinuationVy ?? proj.body.velocity.y;
        this.setMiniRocketVelocityFromDirection(proj, vx, vy);
        this.enterMiniRocketReturn(proj);
        return;
      }
      proj.miniRocketPhase = 'coast';
      proj.miniRocketCoastUntilAgeMs = (proj.simulatedAgeMs ?? 0) + Math.max(0, proj.multiExplosionCoastMs ?? 0);
      proj.miniRocketNextExplosionAtAgeMs = proj.miniRocketCoastUntilAgeMs;
      proj.miniRocketReturnReserveGranted = false;
      proj.remainingRangePx = proj.miniRocketStageRangePx;
      proj.lastX = proj.sprite.x;
      proj.lastY = proj.sprite.y;
      const vx = proj.miniRocketContinuationVx ?? proj.body.velocity.x;
      const vy = proj.miniRocketContinuationVy ?? proj.body.velocity.y;
      if (Math.hypot(vx, vy) > 0.001) {
        proj.body.enable = true;
        this.setMiniRocketVelocityFromDirection(proj, vx, vy);
      }
    }
  }

  /**
   * Löst die "nur bei Gegner-Treffern"-Explosion eines Projektils aus (z.B. XXX-BOW
   * Explosivbolzen). Nutzt denselben Explosions-Pfad wie reguläre Projektil-Explosionen.
   */
  triggerEnemyImpactExplosion(id: number): boolean {
    const proj = this.getProjectileById(id);
    if (!proj?.enemyHitExplosion || proj.pendingExplosion) return false;
    proj.pendingExplosion = true;
    this.pendingProjectileExplosions.push({
      x: proj.sprite.x,
      y: proj.sprite.y,
      ownerId: proj.ownerId,
      effect: proj.enemyHitExplosion,
      sourceSlot: proj.sourceSlot,
      sourceTurretId: proj.sourceTurretId,
      sourceId: proj.sourceId,
    });
    this.queueDestroyProjectile(proj);
    return true;
  }

  /**
   * Räumt beim World-Teardown den registry-fremden Rest ab: Renderer, Snapshot-Zustand und
   * Client-Visuals. Records und Identity hat der Owner zu diesem Zeitpunkt bereits entfernt.
   */
  releaseWorldProjectileState(): void {
    this.activeBurningProjectileIds.clear();
    // Ohne diesen Reset traegt der Statik-Zustand der Vorrunde in die neue hinein und der Client
    // bekaeme fuer wiederverwendete Snapshot-Slots nie wieder einen Statik-Block.
    this.netStaticResendLeft.clear();
    this.netSeenIds.clear();
    this.netRefreshCursor = 0;
    this.forceFullNetSnapshot = false;
    this.shadowSamples.length = 0;
    this.lightSamples.length = 0;
    this.bulletRenderer?.destroyAll();
    this.tracerRenderer?.destroyAll();
    this.flameRenderer?.destroyAll();
    this.projectileBurnRenderer?.destroyAll();
    this.leafBlowerRenderer?.destroyAll();
    this.bfgRenderer?.destroyAll();
    this.gaussRenderer?.destroyAll();
    this.energyBallRenderer?.destroyAll();
    this.hydraRenderer?.destroyAll();
    this.grenadeRenderer?.destroyAll();
    this.holyGrenadeRenderer?.destroyAll();
    this.rocketRenderer?.destroyAll();
    this.fireballRenderer?.destroyAll();
    this.sporeRenderer?.destroyAll();
    this.translocatorPuckRenderer?.destroyAll();
    this.teslaBoltRenderer?.destroyAll();
    this.pendingProjectileExplosions = [];
    for (const sprite of this.clientVisuals.values()) sprite.destroy();
    this.clientVisuals.clear();
    this.clientProjStates.clear();
  }

  /**
   * Host: Abgelaufene/explodierte Projektile entfernen, aktuelle Positionen zurückgeben.
   * Granaten die ihre fuseTime erreicht haben werden als ExplodedGrenade zurückgegeben.
   */
  hostUpdate(deltaMs = 16.67, nowMs?: number): ProjectileHostStageResult {
    const now = nowMs ?? this.resolveLegacyHostNow(deltaMs);
    this.setHostFrameTime(now);
    return this.owner?.runHostProjectileStage?.(deltaMs, now) ?? {
      explodedProjectiles: [],
      explodedGrenades: [],
      countdownEvents: [],
    };
  }

  /** Executes the Manager remainder after the World-owned Flight/Lifetime core. */
  runLegacyProjectileStage(
    _deltaMs: number,
    nowMs: number,
    coreStage: ProjectileCoreStageResult,
  ): ProjectileHostStageResult {
    this.setHostFrameTime(nowMs);
    const explodedProjectiles = this.pendingProjectileExplosions.splice(0);
    const explodedGrenades: ExplodedGrenade[] = [];
    const countdownEvents = coreStage.countdownEvents;
    for (const projectile of this.projectiles) {
      if ((projectile.isFlame || hasLeafBlowerCapability(projectile))
        && projectile.hitboxSize !== undefined
        && Math.abs(projectile.sprite.displayWidth - projectile.hitboxSize) > 0.0001) {
        projectile.sprite.setDisplaySize(projectile.hitboxSize, projectile.hitboxSize);
      }
    }
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      if (!this.stepLegacyProjectile(this.projectiles[index], coreStage, explodedProjectiles, explodedGrenades)) {
        this.owner?.store.dropStepEntryAt(index);
      }
    }
    this.syncHostRenderers();
    return { explodedProjectiles, explodedGrenades, countdownEvents };
  }

  /**
   * Pro-Projektil-Schritt der verbleibenden Legacy-Stufe: Kollision, Wirkung und
   * Spezialausgänge. Flight, Lifetime und Homing werden zuvor vom World-Owner verarbeitet.
   */
  private stepLegacyProjectile(
    proj: TrackedProjectile,
    coreStage: ProjectileCoreStageResult,
    explodedProjectiles: ExplodedProjectile[],
    explodedGrenades: ExplodedGrenade[],
  ): boolean {
    if (proj.pendingDestroy) {
      this.destroyTrackedProjectile(proj);
      return false;
    }

    if (proj.isGrenade) {
      if (coreStage.grenadeExpiredIds.has(proj.id) && proj.grenadeEffect) {
        explodedGrenades.push({
          x: proj.sprite.x,
          y: proj.sprite.y,
          ownerId: proj.ownerId,
          effect: proj.grenadeEffect,
        });
        this.destroyTrackedProjectile(proj);
        return false;
      }
      proj.bounceProcessedThisStep = false;
      proj.velocityAfterFirstBounce = undefined;
      return true;
    }

    const awaitingContinuation = proj.pendingExplosion
      && (proj.multiExplosionsRemaining ?? 0) > 0;
    if (awaitingContinuation) {
      proj.lastX = proj.sprite.x;
      proj.lastY = proj.sprite.y;
      return true;
    }

    if (proj.miniRocketDeferredExplosion) {
      if ((proj.simulatedAgeMs ?? 0) >= (proj.miniRocketNextExplosionAtAgeMs ?? 0)) {
        this.queueProjectileExplosion(
          proj,
          true,
          proj.miniRocketDeferredExplosionStopsAtObstacle ?? false,
        );
      }
      proj.lastX = proj.sprite.x;
      proj.lastY = proj.sprite.y;
      return true;
    }

    if (coreStage.miniRocketSafetyExpiredIds.has(proj.id)) {
      this.destroyTrackedProjectile(proj);
      return false;
    }

    if (coreStage.lifetimeExpiredIds.has(proj.id) && proj.explosion) {
      explodedProjectiles.push({
        x: proj.sprite.x,
        y: proj.sprite.y,
        ownerId: proj.ownerId,
        effect: proj.explosion,
        sourceSlot: proj.sourceSlot,
        sourceTurretId: proj.sourceTurretId,
        sourceId: proj.sourceId,
      });
      this.destroyTrackedProjectile(proj);
      return false;
    }

    if (coreStage.lifetimeExpiredIds.has(proj.id) && proj.impactCloud) {
      this.emitProjectileImpact(proj, proj.sprite.x, proj.sprite.y);
      this.destroyTrackedProjectile(proj);
      return false;
    }

    if (this.shouldUseContinuousRockCollision(proj)) {
      this.resolveContinuousRockCollision(proj);
      if (proj.pendingDestroy) {
        this.destroyTrackedProjectile(proj);
        return false;
      }
    }

    if (coreStage.rangeDepletedIds.has(proj.id)
      && proj.miniRocketStageRangePx !== undefined
      && proj.explosion) {
      this.queueProjectileExplosion(proj, true);
      return true;
    }

    const dead = !awaitingContinuation
      && (coreStage.lifetimeExpiredIds.has(proj.id)
        || coreStage.rangeDepletedIds.has(proj.id)
        || coreStage.bounceLimitReachedIds.has(proj.id));
    if (dead) {
      if (proj.isFlame && coreStage.lifetimeExpiredIds.has(proj.id)) {
        this.naturalFlameExpiryCallback?.(proj, proj.sprite.x, proj.sprite.y);
      }
      if (proj.miniRocketSpent && coreStage.rangeDepletedIds.has(proj.id)) {
        this.emitSpentMiniRocketDestruction(proj);
      }
      this.destroyTrackedProjectile(proj);
    } else if (proj.homing) {
      const simulatedAge = proj.simulatedAgeMs ?? 0;
      if (proj.miniRocketStageRangePx !== undefined) {
        if (this.updateMiniRocketFlight(proj, simulatedAge)) {
          this.destroyTrackedProjectile(proj);
          return false;
        }
      } else {
        this.owner?.resolveProjectileHoming?.(this.createHomingRequest(proj), simulatedAge);
      }
    }

    const proximityPulse = proj.proximityPulse;
    if (proximityPulse && proximityPulse.radius > 0 && proximityPulse.damage > 0) {
      const interval = Math.max(50, proximityPulse.scanIntervalMs);
      const simulatedAge = proj.simulatedAgeMs ?? 0;
      if (proj.lastProximityPulseAt === undefined || simulatedAge - proj.lastProximityPulseAt >= interval) {
        proj.lastProximityPulseAt = simulatedAge;
        this.proximityPulseCallback?.(proj);
      }
    }

    proj.lastX = proj.sprite.x;
    proj.lastY = proj.sprite.y;
    proj.bounceProcessedThisStep = false;
    proj.velocityAfterFirstBounce = undefined;
    return !dead;
  }

  private createHomingRequest(proj: TrackedProjectile): ProjectileHomingRequest {
    if (proj.homingRequest) return proj.homingRequest;
    const state = proj.homingState ??= {
      lockedTargetId: proj.lockedTargetId ?? null,
      lockedTargetType: proj.lockedTargetType,
      lastSearchAtSimulatedMs: proj.lastHomingSearchAt,
    };
    const request: ProjectileHomingRequest = {
      ownerId: proj.ownerId,
      homing: proj.homing!,
      kinematics: {
        get x() { return proj.sprite.x; },
        get y() { return proj.sprite.y; },
        get velocityX() { return proj.body.velocity.x; },
        get velocityY() { return proj.body.velocity.y; },
        setVelocity: (x, y) => proj.body.setVelocity(x, y),
      },
      state,
      excludedTargetKeys: proj.multiExplosionExcludedTargetKeys,
    };
    proj.homingRequest = request;
    return request;
  }

  private resetHomingState(proj: TrackedProjectile): void {
    const state = proj.homingState ??= { lockedTargetId: null };
    state.lockedTargetId = null;
    state.lockedTargetType = undefined;
    state.lastSearchAtSimulatedMs = undefined;
    proj.lockedTargetId = null;
    proj.lockedTargetType = undefined;
    proj.lastHomingSearchAt = undefined;
  }

  private updateProjectileHoming(
    proj: TrackedProjectile,
    simulatedAgeMs: number,
    forceSearch = false,
  ): boolean {
    const foundTarget = this.owner?.resolveProjectileHoming?.(
      this.createHomingRequest(proj),
      simulatedAgeMs,
      forceSearch,
    ) ?? false;
    const state = proj.homingState;
    if (state) {
      proj.lockedTargetId = state.lockedTargetId;
      proj.lockedTargetType = state.lockedTargetType;
      proj.lastHomingSearchAt = state.lastSearchAtSimulatedMs;
    }
    return foundTarget;
  }

  private resolveLegacyHostNow(deltaMs: number): number {
    if (this.hostFrameNowMs !== null) return this.hostFrameNowMs + Math.max(0, deltaMs);
    let latestCreatedAt = 0;
    for (const projectile of this.projectiles) latestCreatedAt = Math.max(latestCreatedAt, projectile.createdAt);
    return latestCreatedAt + Math.max(0, deltaMs);
  }

  /**
   * Steuert die erweiterten Mini-Raketen-Phasen. Die Geradeausphase deaktiviert
   * ausschliesslich Zielsuche/Lenkung; Phaser-Collider bleiben durchgehend aktiv.
   */
  private updateMiniRocketFlight(proj: TrackedProjectile, simulatedAge: number): boolean {
    if (!proj.homing || proj.miniRocketStageRangePx === undefined) return false;

    if (proj.miniRocketSpent && proj.miniRocketPhase !== 'return') {
      this.enterMiniRocketReturn(proj);
    }

    if (proj.miniRocketPhase === 'coast') {
      if (simulatedAge < (proj.miniRocketCoastUntilAgeMs ?? 0)) return false;
      proj.miniRocketPhase = 'attack';
      proj.multiExplosionExcludedTargetKeys?.clear();
      this.resetHomingState(proj);
      const foundTarget = this.updateProjectileHoming(proj, simulatedAge, true);
      if (!foundTarget && proj.miniRocketReturnEnabled && proj.miniRocketHasExploded) {
        this.enterMiniRocketReturn(proj);
      }
      return false;
    }

    if (proj.miniRocketPhase === 'return') {
      if (proj.miniRocketSpent) {
        const owner = this.ownerPositionProvider?.(proj.ownerId) ?? null;
        if (!owner) return false;
        const distance = Phaser.Math.Distance.Between(proj.sprite.x, proj.sprite.y, owner.x, owner.y);
        if (distance <= Math.max(1, proj.miniRocketPickupRadius ?? 32)) {
          this.miniRocketCollectedCallback?.(proj, owner.x, owner.y);
          return true;
        }
        const steerInterval = Math.max(1, proj.homing.retargetIntervalMs);
        if (
          proj.lastHomingSearchAt === undefined
          || simulatedAge - proj.lastHomingSearchAt >= steerInterval
        ) {
          proj.lastHomingSearchAt = simulatedAge;
          this.steerMiniRocketTowards(proj, owner.x, owner.y);
        }
        return false;
      }
      const previousSearchAt = proj.lastHomingSearchAt;
      const foundTarget = this.updateProjectileHoming(proj, simulatedAge);
      if (foundTarget) {
        // Das vorhandene Restbudget laeuft unveraendert weiter: kein Reset, keine Pause.
        proj.miniRocketPhase = 'attack';
        return false;
      }

      const owner = this.ownerPositionProvider?.(proj.ownerId) ?? null;
      if (!owner) return false;
      const distance = Phaser.Math.Distance.Between(proj.sprite.x, proj.sprite.y, owner.x, owner.y);
      if (distance <= Math.max(1, proj.miniRocketPickupRadius ?? 32)) {
        this.miniRocketCollectedCallback?.(proj, owner.x, owner.y);
        return true;
      }

      // Auf demselben Takt wie die gegnerische Zielsuche lenken, damit die Rakete
      // auf dem Rueckweg nicht implizit wendiger wird.
      if (proj.lastHomingSearchAt !== previousSearchAt) {
        this.steerMiniRocketTowards(proj, owner.x, owner.y);
      }
      return false;
    }

    const foundTarget = this.updateProjectileHoming(proj, simulatedAge);
    if (foundTarget || !proj.miniRocketReturnEnabled) return false;

    const mayReturn = proj.miniRocketHasExploded
      || (proj.remainingRangePx ?? Number.POSITIVE_INFINITY) <= Math.max(1, proj.homing.searchRadius);
    if (mayReturn) this.enterMiniRocketReturn(proj);
    return false;
  }

  private enterMiniRocketReturn(proj: TrackedProjectile): void {
    const owner = this.ownerPositionProvider?.(proj.ownerId) ?? null;
    if (!owner) return;

    proj.miniRocketPhase = 'return';
    this.resetHomingState(proj);

    if (!proj.miniRocketReturnReserveGranted) {
      const ownerDistance = Phaser.Math.Distance.Between(proj.sprite.x, proj.sprite.y, owner.x, owner.y);
      const buffer = Math.max(0, proj.miniRocketReturnRangeBuffer ?? 0.5);
      const requiredReturnRange = ownerDistance * (1 + buffer);
      proj.remainingRangePx = Math.max(proj.remainingRangePx ?? 0, requiredReturnRange);
      proj.miniRocketReturnReserveGranted = true;
    }

    // Der Rueckflug erhaelt keinen Tempobonus, uebernimmt aber auch keine durch
    // Kollisionen oder einen kurz deaktivierten Body entstandene Restgeschwindigkeit.
    // Direkt beim Phasenwechsel auf das normale, von der Time-Bubble beeinflusste
    // Projektiltempo normalisieren.
    this.steerMiniRocketTowards(proj, owner.x, owner.y);
  }

  private steerMiniRocketTowards(proj: TrackedProjectile, targetX: number, targetY: number): void {
    const velocitySpeed = proj.body.velocity.length();
    const normalFlightSpeed = this.getMiniRocketFlightSpeed(proj);
    const currentSpeed = normalFlightSpeed > 0.001 ? normalFlightSpeed : velocitySpeed;
    if (currentSpeed <= 0.001) return;

    const targetAngle = Phaser.Math.Angle.Between(proj.sprite.x, proj.sprite.y, targetX, targetY);
    const currentAngle = velocitySpeed > 0.001
      ? Math.atan2(proj.body.velocity.y, proj.body.velocity.x)
      : targetAngle;
    const maxTurn = Phaser.Math.DegToRad(proj.homing?.maxTurnDegreesPerStep ?? 0);
    const angleDelta = Phaser.Math.Angle.Wrap(targetAngle - currentAngle);
    const nextAngle = currentAngle + Phaser.Math.Clamp(angleDelta, -maxTurn, maxTurn);
    proj.body.setVelocity(Math.cos(nextAngle) * currentSpeed, Math.sin(nextAngle) * currentSpeed);
  }

  private getMiniRocketFlightSpeed(proj: TrackedProjectile): number {
    const completedExplosions = Math.max(0, proj.miniRocketExplosionIndex ?? 0);
    const explosionSpeedFactor = Math.max(0.1, 1 - completedExplosions * 0.2);
    return (proj.initialSpeed ?? 0) * (proj.timeBubbleFactor ?? 1) * explosionSpeedFactor;
  }

  private resolveMiniRocketCascadeColor(baseColor: number, explosionIndex: number): number {
    // Index 0 ist die urspruengliche Detonation. Die beiden anschliessenden
    // Kaskaden werden zunehmend rot, bleiben aber klar in derselben Palette.
    const redBlend = explosionIndex <= 0 ? 0 : explosionIndex === 1 ? 0.28 : 0.68;
    if (redBlend <= 0) return baseColor;
    return this.mixHexColor(baseColor, 0xff2418, redBlend);
  }

  private mixHexColor(source: number, target: number, amount: number): number {
    const t = Phaser.Math.Clamp(amount, 0, 1);
    const sourceR = (source >> 16) & 0xff;
    const sourceG = (source >> 8) & 0xff;
    const sourceB = source & 0xff;
    const targetR = (target >> 16) & 0xff;
    const targetG = (target >> 8) & 0xff;
    const targetB = target & 0xff;
    return Phaser.Display.Color.GetColor(
      Math.round(Phaser.Math.Linear(sourceR, targetR, t)),
      Math.round(Phaser.Math.Linear(sourceG, targetG, t)),
      Math.round(Phaser.Math.Linear(sourceB, targetB, t)),
    );
  }

  private setMiniRocketVelocityFromDirection(proj: TrackedProjectile, vx: number, vy: number): void {
    const directionLength = Math.hypot(vx, vy);
    const speed = this.getMiniRocketFlightSpeed(proj);
    if (directionLength <= 0.001 || speed <= 0.001) return;
    proj.body.setVelocity((vx / directionLength) * speed, (vy / directionLength) * speed);
  }

  private emitSpentMiniRocketDestruction(proj: TrackedProjectile): void {
    if (proj.miniRocketDestructionFxEmitted) return;
    proj.miniRocketDestructionFxEmitted = true;
    this.miniRocketDestroyedCallback?.(proj, proj.sprite.x, proj.sprite.y);
  }

  private queueSpentMiniRocketDestruction(proj: TrackedProjectile): void {
    if (proj.pendingDestroy) return;
    this.emitSpentMiniRocketDestruction(proj);
    this.queueDestroyProjectile(proj);
  }

  /**
   * Host: alle aktiven Projektil-Renderer an die Physik-Bodies synchronisieren.
   *
   * Ein einziger Durchlauf über die Projektilliste statt eines Durchlaufs pro Renderer-Typ:
   * Jedes Projektil hat genau einen `projectileStyle`, daher wird pro Projektil nur der
   * passende Renderer angesprochen. Style-unabhängige Renderer (Burn, Tracer) und der
   * Bullet-Body-Sync für die kugelartigen Stile laufen im selben Durchlauf mit. `gauss` wird
   * bewusst weiterhin sowohl vom BulletRenderer (Body-Sync) als auch vom GaussRenderer bedient.
   */
  private syncHostRenderers(): void {
    const bulletR = this.bulletRenderer;
    const flames = this.flameRenderer;
    const leafBlowers = this.leafBlowerRenderer;
    const bfgR = this.bfgRenderer;
    const gaussR = this.gaussRenderer;
    const energyBallR = this.energyBallRenderer;
    const hydraR = this.hydraRenderer;
    const holyGrenadeR = this.holyGrenadeRenderer;
    const rocketR = this.rocketRenderer;
    const fireballR = this.fireballRenderer;
    const sporeR = this.sporeRenderer;
    const grenadeR = this.grenadeRenderer;
    const tlPuckR = this.translocatorPuckRenderer;
    const teslaBoltR = this.teslaBoltRenderer;
    const tracerR = this.tracerRenderer;
    const burnR = this.projectileBurnRenderer;

    const burningProjectiles = this.activeBurningProjectileIds;
    burningProjectiles.clear();

    for (const proj of this.projectiles) {
      const id = proj.id;
      const x = proj.sprite.x;
      const y = proj.sprite.y;
      const w = proj.sprite.displayWidth;
      const vx = proj.body.velocity.x;
      const vy = proj.body.velocity.y;
      const style = proj.projectileStyle;

      // Burn läuft style-unabhängig für jedes Projektil.
      const burning = this.hasVisibleProjectileBurn(proj);
      burnR?.sync(id, x, y, w, burning, true, proj.projectileBurnVisualStyle);
      if (burning) burningProjectiles.add(id);

      // Tracer hängt an der tracerConfig, nicht am Style.
      if (proj.tracerConfig) tracerR?.updateTracer(id, x, y, vx, vy);

      // Kugelartige Stile werden zusätzlich per Body-Sync bewegt (inkl. gauss).
      if (style === 'bullet' || style === 'awp' || style === 'gauss') {
        bulletR?.syncToBody(id, x, y, vx, vy);
      }

      switch (style) {
        case 'flame':
          if (flames) {
            // Der Kettenschluessel trennt Straehle *einer* Quelle: zwei Tuerme desselben
            // Besitzers duerfen nicht miteinander verkettet werden.
            if (!flames.has(id)) {
              flames.createVisual(id, x, y, w, proj.color, proj.sourceTurretId ?? proj.ownerId);
            }
            flames.updateVisual(id, x, y, w, vx, vy);
          }
          break;
        case 'leaf_blower':
          if (leafBlowers) {
            if (!leafBlowers.has(id)) leafBlowers.createVisual(id, x, y, w);
            leafBlowers.updateVisual(id, x, y, w, vx, vy);
          }
          break;
        case 'bfg':
          if (bfgR) {
            if (!bfgR.has(id)) bfgR.createVisual(id, x, y, w);
            bfgR.updateVisual(id, x, y, w);
          }
          break;
        case 'gauss':
          if (gaussR) {
            if (!gaussR.has(id)) gaussR.createVisual(id, x, y, w, proj.color);
            gaussR.updateVisual(id, x, y, w, vx, vy, proj.color);
          }
          break;
        case 'energy_ball':
          if (energyBallR) {
            if (!energyBallR.has(id)) energyBallR.createVisual(id, x, y, w, proj.color, proj.energyBallVariant);
            energyBallR.updateVisual(id, x, y, w, vx, vy, proj.color, proj.energyBallVariant);
          }
          break;
        case 'hydra':
          if (hydraR) {
            if (!hydraR.has(id)) hydraR.createVisual(id, x, y, w, proj.color);
            hydraR.updateVisual(id, x, y, w, vx, vy, proj.color);
          }
          break;
        case 'holy_grenade':
          if (holyGrenadeR) {
            if (!holyGrenadeR.has(id)) holyGrenadeR.createVisual(id, x, y, w);
            holyGrenadeR.updateVisual(id, x, y, w, vx, vy);
          }
          break;
        case 'rocket':
          if (rocketR) {
            if (!rocketR.has(id)) {
              rocketR.createVisual(id, x, y, w, proj.color, proj.ownerColor ?? proj.color, proj.smokeTrailColor ?? proj.color);
            }
            rocketR.updateVisual(
              id, x, y, w, vx, vy,
              proj.miniRocketPhase,
              (proj.miniRocketCascadeDamageBonusPerExplosion ?? 0) > 0 ? proj.miniRocketExplosionIndex : undefined,
            );
          }
          break;
        case 'fireball':
          if (fireballR) {
            if (!fireballR.has(id)) fireballR.createVisual(id, x, y, w);
            fireballR.updateVisual(id, x, y, w, vx, vy);
          }
          break;
        case 'spore':
          if (sporeR) {
            if (!sporeR.has(id)) sporeR.createVisual(id, x, y, w, proj.color, proj.sporeVisualVariant);
            sporeR.updateVisual(id, x, y, w, vx, vy, proj.color, proj.sporeVisualVariant);
          }
          break;
        case 'grenade':
          if (grenadeR) {
            if (!grenadeR.has(id)) grenadeR.createVisual(id, x, y, w, proj.grenadeVisualPreset ?? 'he', proj.ownerColor ?? proj.color);
            grenadeR.updateVisual(id, x, y, w, vx, vy);
          }
          break;
        case 'translocator_puck':
          if (tlPuckR) {
            if (!tlPuckR.has(id)) tlPuckR.createVisual(id, x, y, proj.ownerColor ?? proj.color);
            tlPuckR.updateVisual(id, x, y, proj.ownerColor ?? proj.color);
          }
          break;
        case 'tesla_bolt':
          if (teslaBoltR) {
            if (!teslaBoltR.has(id)) teslaBoltR.createVisual(id, x, y, w, proj.color);
            teslaBoltR.updateVisual(id, x, y, w, vx, vy, proj.color);
          }
          break;
        default:
          break;
      }
    }

    burnR?.retain(burningProjectiles);
  }

  /** Host-only: der naechste Netzwerk-Snapshot traegt die Statik aller aktiven Projektile. */
  requestFullNetSnapshot(): void {
    this.forceFullNetSnapshot = true;
  }

  /**
   * Host: kompakten Netzwerk-Snapshot nur bei einem tatsächlichen Network-Tick bauen.
   *
   * Der Dynamik-Strom `u` enthält IMMER jedes aktive Projektil vollständig; nur der Statik-Strom `s`
   * ist selektiv. Daraus folgen zwei Invarianten, auf die sich der Client verlässt:
   *  - Solange irgendein Projektil aktiv ist, ist `u` nicht leer. `null` heisst deshalb eindeutig
   *    "keine aktiven Projektile" und nicht "kein Update" – exakt die frühere Semantik, in der
   *    `payload.j` bei leerer Liste wegfiel.
   *  - Bei `f === 1` deckt `s` jede ID in `u` ab. Ein Latejoiner kann den Bootstrap damit ohne
   *    jeden Vorzustand auflösen; die Statiken kommen aus dem lebenden TrackedProjectile, nie aus
   *    einem Host-Cache.
   */
  getNetSnapshot(): SyncedProjectileSnapshot | null {
    const full = this.forceFullNetSnapshot;
    this.forceFullNetSnapshot = false;

    const refreshIds = full ? null : this.collectStaticRefreshIds();
    const s: Array<number | string> = [];
    const u: Array<number | string> = [];
    const seen = this.netSeenIds;
    seen.clear();

    for (const p of this.activeProjectiles) {
      seen.add(p.id);
      const resendLeft = this.netStaticResendLeft.get(p.id);
      if (resendLeft === undefined) {
        // Erstes Auftauchen: Statik senden und für die nächsten Ticks zur Wiederholung vormerken.
        this.netStaticResendLeft.set(p.id, PROJECTILE_NET_STATIC_RESEND_TICKS - 1);
        this.encodeStaticFor(s, p);
      } else if (resendLeft > 0) {
        this.netStaticResendLeft.set(p.id, resendLeft - 1);
        this.encodeStaticFor(s, p);
      } else if (full || refreshIds?.has(p.id)) {
        this.encodeStaticFor(s, p);
      }

      encodeProjectileDynamic(u, {
        id:   p.id,
        x:    Math.round(p.sprite.x),
        y:    Math.round(p.sprite.y),
        vx:   Math.round(p.body.velocity.x),
        vy:   Math.round(p.body.velocity.y),
        size: Math.round(p.sprite.displayWidth),
        miniRocketPhase: p.miniRocketPhase,
        miniRocketCascadeStage: (p.miniRocketCascadeDamageBonusPerExplosion ?? 0) > 0
          ? p.miniRocketExplosionIndex
          : undefined,
        projectileBurnVisualStyle: p.projectileBurnVisualStyle,
        burning: this.hasVisibleProjectileBurn(p) || undefined,
      });
    }

    // Despawn laeuft ueber Abwesenheit aus `u`; das hier ist der einzige Aufraeumpfad fuer den
    // Statik-Zustand und braucht deshalb keinen Hook in removeActiveProjectile(). Massgeblich ist
    // `activeProjectiles`, nicht `projectilesById`: ein zum Abbau vorgemerktes Projektil verlaesst
    // die Aktivmenge sofort, bleibt aber bis zum verzoegerten Cleanup in der Id-Map.
    if (this.netStaticResendLeft.size > seen.size) {
      for (const id of this.netStaticResendLeft.keys()) {
        if (!seen.has(id)) this.netStaticResendLeft.delete(id);
      }
    }

    if (u.length === 0 && !full) return null;
    return full ? { s, u, f: 1 } : { s, u };
  }

  private encodeStaticFor(out: Array<number | string>, p: TrackedProjectile): void {
    encodeProjectileStatic(out, {
      id:      p.id,
      ownerId: p.ownerId,
      color:   p.color,
      allowTeamDamage: p.allowTeamDamage,
      ownerColor: p.ownerColor,
      visualMuzzleOrigin: p.visualMuzzleOrigin,
      projectileVisualScale: p.projectileVisualScale,
      smokeTrailColor: p.smokeTrailColor,
      style:   p.projectileStyle,
      sporeVisualVariant: p.sporeVisualVariant,
      bulletVisualPreset: p.bulletVisualPreset,
      grenadeVisualPreset: p.grenadeVisualPreset,
      energyBallVariant: p.energyBallVariant,
      velocityDecay: p.velocityDecay,
      tracer:  p.tracerConfig,
      shotAudioKey: p.shotAudioKey,
      suppressSpawnFx: p.suppressSpawnFx,
    });
  }

  /**
   * Rollierender Statik-Refresh: pro Tick ein Bruchteil der langlebigen Projektile. Kurzlebige
   * bleiben aussen vor – sie sterben vor dem naechsten Zyklus, und ein kurz fehlendes Bullet ist
   * kosmetisch, waehrend eine sekundenlang unsichtbare Granate ein echter Fehler waere.
   */
  private collectStaticRefreshIds(): Set<number> | null {
    const now = Date.now();
    const candidates: number[] = [];
    for (const p of this.activeProjectiles) {
      if (now - p.createdAt >= PROJECTILE_NET_LONG_LIVED_AGE_MS) candidates.push(p.id);
    }
    if (candidates.length === 0) {
      this.netRefreshCursor = 0;
      return null;
    }
    const perTick = Math.ceil(candidates.length / PROJECTILE_NET_REFRESH_CYCLE_TICKS);
    const ids = new Set<number>();
    for (let i = 0; i < perTick; i++) {
      ids.add(candidates[(this.netRefreshCursor + i) % candidates.length]);
    }
    this.netRefreshCursor = (this.netRefreshCursor + perTick) % candidates.length;
    return ids;
  }

  // ── Client ────────────────────────────────────────────────────────────────

  /**
   * Client: Empfängt neue Server-Snapshots und speichert den State für Extrapolation.
   * Erstellt/entfernt visuelle Sprites. Positionsupdate passiert in clientExtrapolate().
   */
  clientSyncVisuals(data: SyncedProjectile[], localPlayerId?: string): void {
    const now       = performance.now();
    const activeIds = new Set(data.map(d => d.id));
    const renderer  = this.bulletRenderer;
    const flames    = this.flameRenderer;
    const leafBlowers = this.leafBlowerRenderer;
    const rockets   = this.rocketRenderer;
    const fireballs = this.fireballRenderer;
    const spores = this.sporeRenderer;
    const energyBalls = this.energyBallRenderer;
    const hydras = this.hydraRenderer;
    const grenades = this.grenadeRenderer;
    const holyGrenades = this.holyGrenadeRenderer;
    const tlPucks = this.translocatorPuckRenderer;
    const teslaBolts = this.teslaBoltRenderer;
    const bfgR = this.bfgRenderer;
    const tracerRc = this.tracerRenderer;
    const burningIds = new Set<number>();

    this.cleanupOrphanedClientVisuals(data, activeIds);

    // Server-State aktualisieren und neue Visuals erstellen
    for (const proj of data) {
      const isBullet = proj.style === 'bullet';
      const isFlame  = proj.style === 'flame';
      const isLeafBlower = proj.style === 'leaf_blower';
      const isEnergyBallP = proj.style === 'energy_ball';
      const isHydraP = proj.style === 'hydra';
      const isSporeP = proj.style === 'spore';
      const isBfgP   = proj.style === 'bfg';
      const isHolyGrenadeP = proj.style === 'holy_grenade';
      const isAwpP   = proj.style === 'awp';
      const isGaussP = proj.style === 'gauss';
      const isRocket = proj.style === 'rocket';
      const isFireball = proj.style === 'fireball';
      const isGrenadeP = proj.style === 'grenade';
      const bulletPreset = resolveBulletVisualPreset(proj.style, proj.bulletVisualPreset);

      // Bounce-Erkennung: Velocity-Richtungswechsel zwischen zwei Server-Snapshots
      const prev = this.clientProjStates.get(proj.id);
      const velocityFlipped = prev && (isBullet || isAwpP || isGaussP) &&
        (prev.vx * proj.vx < -1 || prev.vy * proj.vy < -1);
      // Tracer-Spawn nach Abpraller zurücksetzen (vor dem Tracer-Update weiter unten)
      if (velocityFlipped && tracerRc && tracerRc.has(proj.id)) {
        tracerRc.notifyBounce(proj.id, proj.x, proj.y);
      }

      // Extrapolations-State speichern/aktualisieren
      this.clientProjStates.set(proj.id, {
        serverX: proj.x,
        serverY: proj.y,
        vx: proj.vx,
        vy: proj.vy,
        size: proj.size,
        color: proj.color,
        receivedAt: now,
        style: proj.style,
        bulletVisualPreset: proj.bulletVisualPreset,
        grenadeVisualPreset: proj.grenadeVisualPreset,
        energyBallVariant: proj.energyBallVariant,
        sporeVisualVariant: proj.sporeVisualVariant,
        ownerColor: proj.ownerColor,
        projectileVisualScale: proj.projectileVisualScale,
        isDecaying: isFlame || isLeafBlower,
        velocityDecay: proj.velocityDecay ?? 1,
        miniRocketPhase: proj.miniRocketPhase,
        miniRocketCascadeStage: proj.miniRocketCascadeStage,
        projectileBurnVisualStyle: proj.projectileBurnVisualStyle,
        burning: proj.burning === true,
      });

      if (!prev && !proj.suppressSpawnFx) {
        const ownerPos = this.ownerPositionProvider?.(proj.ownerId) ?? null;
        const flashOrigin = proj.visualMuzzleOrigin
          ?? (ownerPos
          ? getTopDownMuzzleOriginFromVector(ownerPos.x, ownerPos.y, proj.vx, proj.vy)
          : getTopDownMuzzleOriginFromVector(
              proj.x - (Math.hypot(proj.vx, proj.vy) > 0.0001 ? (proj.vx / Math.hypot(proj.vx, proj.vy)) * MUZZLE_PROJECTILE_FALLBACK_BACKTRACK : 0),
              proj.y - (Math.hypot(proj.vx, proj.vy) > 0.0001 ? (proj.vy / Math.hypot(proj.vx, proj.vy)) * MUZZLE_PROJECTILE_FALLBACK_BACKTRACK : 0),
              proj.vx,
              proj.vy,
            ));
        this.muzzleFlashRenderer?.playProjectileFlash(
          flashOrigin.x,
          flashOrigin.y,
          proj.vx,
          proj.vy,
          proj.style as ProjectileStyle | undefined,
          proj.bulletVisualPreset,
          proj.energyBallVariant,
          proj.ownerColor ?? proj.color,
        );
        // Kein Audio für eigene Waffen-Projektile – Prediction in ClientUpdateCoordinator hat es schon abgespielt.
        // Granaten haben keine Prediction, daher hier immer abspielen.
        // Utility-Projektile haben keine Prediction → Audio immer abspielen.
        const isUtilityProjectile = proj.style === 'grenade' || proj.style === 'holy_grenade' || proj.style === 'bfg';
        if (proj.ownerId !== localPlayerId || isUtilityProjectile) {
          this.audioSystem?.playSound(proj.shotAudioKey, flashOrigin.x, flashOrigin.y, proj.ownerId);
        }
      }

      if (isBfgP && bfgR) {
        if (!bfgR.has(proj.id)) {
          bfgR.createVisual(proj.id, proj.x, proj.y, proj.size);
        }
        bfgR.updateVisual(proj.id, proj.x, proj.y, proj.size);
      } else if (isHolyGrenadeP && holyGrenades) {
        if (!holyGrenades.has(proj.id)) {
          holyGrenades.createVisual(proj.id, proj.x, proj.y, proj.size);
        }
        holyGrenades.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (isEnergyBallP && energyBalls) {
        if (!energyBalls.has(proj.id)) {
          energyBalls.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color, proj.energyBallVariant);
        }
        energyBalls.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy, proj.color, proj.energyBallVariant);
      } else if (isHydraP && hydras) {
        if (!hydras.has(proj.id)) {
          hydras.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color);
        }
        hydras.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy, proj.color);
      } else if (isSporeP && spores) {
        if (!spores.has(proj.id)) {
          spores.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color, proj.sporeVisualVariant);
        }
        spores.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy, proj.color, proj.sporeVisualVariant);
      } else if (isGrenadeP && grenades) {
        if (!grenades.has(proj.id)) {
          grenades.createVisual(proj.id, proj.x, proj.y, proj.size, proj.grenadeVisualPreset ?? 'he', proj.ownerColor ?? proj.color);
        }
        grenades.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (proj.style === 'translocator_puck' && tlPucks) {
        if (!tlPucks.has(proj.id)) {
          tlPucks.createVisual(proj.id, proj.x, proj.y, proj.ownerColor ?? proj.color);
        }
        tlPucks.updateVisual(proj.id, proj.x, proj.y, proj.ownerColor ?? proj.color);
      } else if (proj.style === 'tesla_bolt' && teslaBolts) {
        if (!teslaBolts.has(proj.id)) {
          teslaBolts.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color);
        }
        teslaBolts.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy, proj.color);
      } else if (isFireball && fireballs) {
        if (!fireballs.has(proj.id)) fireballs.createVisual(proj.id, proj.x, proj.y, proj.size);
        fireballs.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (isRocket && rockets) {
        if (!rockets.has(proj.id)) {
          rockets.createVisual(
            proj.id,
            proj.x,
            proj.y,
            proj.size,
            proj.color,
            proj.ownerColor ?? proj.color,
            proj.smokeTrailColor ?? proj.color,
            proj.projectileVisualScale,
          );
        }
        rockets.updateVisual(
          proj.id,
          proj.x,
          proj.y,
          proj.size,
          proj.vx,
          proj.vy,
          proj.miniRocketPhase,
          proj.miniRocketCascadeStage,
        );
      } else if (isLeafBlower && leafBlowers) {
        if (!leafBlowers.has(proj.id)) {
          leafBlowers.createVisual(proj.id, proj.x, proj.y, proj.size);
        }
        leafBlowers.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (isFlame && flames) {
        if (!flames.has(proj.id)) {
          // Der Client kennt keine Turm-Id; der Abstandsdeckel der Verkettung faengt zwei
          // gleichzeitig feuernde Quellen desselben Besitzers ab.
          flames.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color, proj.ownerId);
        }
        flames.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if ((isAwpP || isGaussP) && renderer) {
        if (!renderer.has(proj.id)) {
          renderer.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color, bulletPreset, proj.ownerColor ?? proj.color);
        }
        renderer.syncToBody(proj.id, proj.x, proj.y, proj.vx, proj.vy);
        if (velocityFlipped) {
          renderer.playImpactSparks(proj.id, proj.x, proj.y, proj.vx, proj.vy, proj.color);
        }
      } else if (isBullet && renderer) {
        if (!renderer.has(proj.id)) {
          renderer.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color, bulletPreset, proj.ownerColor ?? proj.color);
        }
        renderer.updatePosition(proj.id, proj.x, proj.y, proj.vx, proj.vy);
        if (velocityFlipped) {
          renderer.playImpactSparks(proj.id, proj.x, proj.y, proj.vx, proj.vy, proj.color);
        }
      } else {
        const existing = this.clientVisuals.get(proj.id);
        if (!existing) {
          const isBall = proj.style === 'ball' || proj.style === 'hydra';
          const sprite: Phaser.GameObjects.Shape = isBall
            ? this.scene.add.circle(proj.x, proj.y, proj.size / 2, proj.color)
            : this.scene.add.rectangle(proj.x, proj.y, proj.size, proj.size, proj.color);
          sprite.setDepth(DEPTH.PROJECTILES);
          registerGraphicsObject(this.scene, 'projectileShapes', sprite);
          this.clientVisuals.set(proj.id, sprite);
        } else {
          existing.setPosition(proj.x, proj.y);
        }
      }

      // Tracer (unabhängig vom Renderer-Typ, data-driven via proj.tracer)
      if (proj.tracer && tracerRc) {
        if (!tracerRc.has(proj.id)) {
          tracerRc.createTracer(proj.id, proj.x, proj.y, proj.tracer, proj.ownerColor ?? proj.color);
        }
        tracerRc.updateTracer(proj.id, proj.x, proj.y, proj.vx, proj.vy);
      }

      this.projectileBurnRenderer?.sync(
        proj.id,
        proj.x,
        proj.y,
        proj.size,
        proj.burning === true,
        false,
        proj.projectileBurnVisualStyle,
      );
      if (proj.burning) burningIds.add(proj.id);
    }
    this.projectileBurnRenderer?.retain(burningIds);
  }

  /**
   * Client: entfernt Visuals + Extrapolations-States für Projektile, die im neuen Server-Snapshot
   * nicht mehr enthalten sind. Spielt dabei (wo vorhanden) Impact-Effekte ab – für Hydra inkl.
   * Split-Erkennung anhand neu eingetroffener, unterdrückter Kind-Projektile gleicher Farbe/Nähe.
   */
  private cleanupOrphanedClientVisuals(data: SyncedProjectile[], activeIds: Set<number>): void {
    const renderer  = this.bulletRenderer;
    const flames    = this.flameRenderer;
    const leafBlowers = this.leafBlowerRenderer;
    const rockets   = this.rocketRenderer;
    const fireballs = this.fireballRenderer;
    const spores = this.sporeRenderer;
    const energyBalls = this.energyBallRenderer;
    const hydras = this.hydraRenderer;
    const grenades = this.grenadeRenderer;
    const holyGrenades = this.holyGrenadeRenderer;
    const tlPucks = this.translocatorPuckRenderer;
    const teslaBolts = this.teslaBoltRenderer;
    const bfgR = this.bfgRenderer;
    const tracerRc = this.tracerRenderer;
    const incomingHydras = data.filter((proj) => proj.style === 'hydra');
    const newIncomingHydraIds = new Set(
      incomingHydras
        .filter((proj) => !this.clientProjStates.has(proj.id))
        .map((proj) => proj.id),
    );

    for (const [id, sprite] of this.clientVisuals) {
      if (!activeIds.has(id)) {
        sprite.destroy();
        this.clientVisuals.delete(id);
        this.clientProjStates.delete(id);
      }
    }
    if (renderer) {
      for (const id of renderer.getActiveIds()) {
        if (!activeIds.has(id)) {
          renderer.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (flames) {
      for (const id of flames.getActiveIds()) {
        if (!activeIds.has(id)) {
          flames.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (leafBlowers) {
      for (const id of leafBlowers.getActiveIds()) {
        if (!activeIds.has(id)) {
          leafBlowers.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (rockets) {
      for (const id of rockets.getActiveIds()) {
        if (!activeIds.has(id)) {
          rockets.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (fireballs) {
      for (const id of fireballs.getActiveIds()) {
        if (!activeIds.has(id)) {
          fireballs.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (spores) {
      for (const id of spores.getActiveIds()) {
        if (!activeIds.has(id)) {
          const state = this.clientProjStates.get(id);
          if (state?.style === 'spore') {
            spores.playImpact(state.serverX, state.serverY, state.color, Math.max(state.size / 16, 0.9));
          }
          spores.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (energyBalls) {
      for (const id of energyBalls.getActiveIds()) {
        if (!activeIds.has(id)) {
          const state = this.clientProjStates.get(id);
          if (state?.style === 'energy_ball') {
            energyBalls.playImpact(state.serverX, state.serverY, state.color, state.energyBallVariant, state.size / 16);
          }
          energyBalls.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (hydras) {
      for (const id of hydras.getActiveIds()) {
        if (!activeIds.has(id)) {
          const state = this.clientProjStates.get(id);
          if (state?.style === 'hydra') {
            const splitChildren = incomingHydras
              .filter((proj) => newIncomingHydraIds.has(proj.id) && proj.suppressSpawnFx)
              .filter((proj) => proj.color === state.color)
              .filter((proj) => Phaser.Math.Distance.Between(state.serverX, state.serverY, proj.x, proj.y) <= Math.max(state.size * 1.5, 22))
              .map((proj) => Math.atan2(proj.vy, proj.vx));
            if (splitChildren.length > 0) {
              hydras.playSplitImpact(state.serverX, state.serverY, state.color, splitChildren, Math.max(state.size / 16, 0.95));
            } else {
              hydras.playImpact(state.serverX, state.serverY, state.color, Math.max(state.size / 16, 0.95));
            }
          }
          hydras.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (grenades) {
      for (const id of grenades.getActiveIds()) {
        if (!activeIds.has(id)) {
          grenades.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (holyGrenades) {
      for (const id of holyGrenades.getActiveIds()) {
        if (!activeIds.has(id)) {
          holyGrenades.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (tlPucks) {
      for (const id of tlPucks.getActiveIds()) {
        if (!activeIds.has(id)) {
          tlPucks.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (teslaBolts) {
      for (const id of teslaBolts.getActiveIds()) {
        if (!activeIds.has(id)) {
          const state = this.clientProjStates.get(id);
          if (state?.style === 'tesla_bolt') {
            teslaBolts.playImpact(state.serverX, state.serverY, state.size, state.color);
          }
          teslaBolts.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (bfgR) {
      for (const id of bfgR.getActiveIds()) {
        if (!activeIds.has(id)) {
          bfgR.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (tracerRc) {
      for (const id of tracerRc.getActiveIds()) {
        if (!activeIds.has(id)) tracerRc.destroyTracer(id);
      }
    }
  }

  /**
   * Client: Extrapoliert Projektil-Positionen zwischen Netzwerk-Ticks.
   * Wird jeden Render-Frame aufgerufen (unabhängig von der Netzwerk-Tick-Rate).
   *
   * Bullets/Balls: Lineare Extrapolation (konstante Velocity).
   * Flames: Exponentielle Velocity-Decay (gleiche Formel wie Host).
   */
  clientExtrapolate(): void {
    const now      = performance.now();
    const renderer = this.bulletRenderer;
    const flames   = this.flameRenderer;
    const leafBlowers = this.leafBlowerRenderer;

    for (const [id, state] of this.clientProjStates) {
      const extrapolated = this.extrapolateClientProjectileState(state, now);
      if (!extrapolated) continue;

      const { x: ex, y: ey, velocityX, velocityY } = extrapolated;

      const bfgRe = this.bfgRenderer;
      if (state.style === 'bfg' && bfgRe && bfgRe.has(id)) {
        bfgRe.updateVisual(id, ex, ey, state.size);
      } else if (state.style === 'gauss' && this.gaussRenderer?.has(id)) {
        this.gaussRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY, state.color);
      } else if (state.style === 'grenade' && this.grenadeRenderer?.has(id)) {
        this.grenadeRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY);
      } else if (state.style === 'holy_grenade' && this.holyGrenadeRenderer?.has(id)) {
        this.holyGrenadeRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY);
      } else if (state.style === 'energy_ball' && this.energyBallRenderer?.has(id)) {
        this.energyBallRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY, state.color, state.energyBallVariant);
      } else if (state.style === 'hydra' && this.hydraRenderer?.has(id)) {
        this.hydraRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY, state.color);
      } else if (state.style === 'spore' && this.sporeRenderer?.has(id)) {
        this.sporeRenderer.updateVisual(
          id,
          ex,
          ey,
          state.size,
          velocityX,
          velocityY,
          state.color,
          state.sporeVisualVariant,
        );
      } else if (state.style === 'translocator_puck' && this.translocatorPuckRenderer?.has(id)) {
        this.translocatorPuckRenderer.updateVisual(id, ex, ey, state.ownerColor ?? state.color);
      } else if (state.style === 'tesla_bolt' && this.teslaBoltRenderer?.has(id)) {
        this.teslaBoltRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY, state.color);
      } else if (state.style === 'rocket' && this.rocketRenderer?.has(id)) {
        this.rocketRenderer.updateVisual(
          id,
          ex,
          ey,
          state.size,
          velocityX,
          velocityY,
          state.miniRocketPhase,
          state.miniRocketCascadeStage,
        );
      } else if (state.style === 'fireball' && this.fireballRenderer?.has(id)) {
        this.fireballRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY);
      } else if (state.style === 'leaf_blower' && leafBlowers?.has(id)) {
        leafBlowers.updateVisual(id, ex, ey, state.size, velocityX, velocityY);
      } else if (state.style === 'flame' && flames && flames.has(id)) {
        flames.updateVisual(id, ex, ey, state.size, velocityX, velocityY);
      } else if ((state.style === 'awp' || state.style === 'gauss') && renderer && renderer.has(id)) {
        renderer.syncToBody(id, ex, ey, velocityX, velocityY);
      } else if (state.style === 'bullet' && renderer && renderer.has(id)) {
        renderer.updatePosition(id, ex, ey, velocityX, velocityY);
      } else {
        const sprite = this.clientVisuals.get(id);
        if (sprite) sprite.setPosition(ex, ey);
      }

      // Tracer: unabhängig vom Renderer, wenn vorhanden
      const tracerRe = this.tracerRenderer;
      if (tracerRe && tracerRe.has(id)) {
        tracerRe.updateTracer(id, ex, ey, velocityX, velocityY);
      }
      this.projectileBurnRenderer?.sync(id, ex, ey, state.size, state.burning, true, state.projectileBurnVisualStyle);
    }
  }

  private hasVisibleProjectileBurn(proj: TrackedProjectile): boolean {
    if (proj.isFlame || proj.isGrenade) return false;
    return ((proj.burnDurationMs ?? 0) > 0 && (proj.burnDamagePerTick ?? 0) > 0)
      || ((proj.supplementalBurnOnHit?.durationMs ?? 0) > 0
        && (proj.supplementalBurnOnHit?.damagePerTick ?? 0) > 0);
  }

  private extrapolateClientProjectileState(
    state: ClientProjectileState,
    now: number,
  ): { x: number; y: number; velocityX: number; velocityY: number } | null {
    const dt = (now - state.receivedAt) / 1000;
    if (dt <= 0) return null;

    if (state.isDecaying) {
      const decay = Phaser.Math.Clamp(state.velocityDecay, 0.001, 1);
      const lnDecay = Math.log(decay);
      const integralFactor = (1 - Math.pow(decay, dt)) / (-lnDecay);
      const decayFactor = Math.pow(decay, dt);
      return {
        x: state.serverX + state.vx * integralFactor,
        y: state.serverY + state.vy * integralFactor,
        velocityX: state.vx * decayFactor,
        velocityY: state.vy * decayFactor,
      };
    }

    return {
      x: state.serverX + state.vx * dt,
      y: state.serverY + state.vy * dt,
      velocityX: state.vx,
      velocityY: state.vy,
    };
  }
}

function resolveProjectileCollisionMode(cfg: ProjectileSpawnConfig): ProjectileCollisionMode {
  if (cfg.collisionMode) return cfg.collisionMode;
  if (cfg.isGrenade) return 'physics';
  if (cfg.isFlame === true || hasLeafBlowerCapability(cfg) || cfg.isBfg === true) return 'overlap';
  if ((cfg.proximityPulse?.radius ?? 0) > 0 && (cfg.proximityPulse?.damage ?? 0) > 0) return 'overlap';
  if (hasGaussDischarge(cfg)) return 'overlap';
  return 'sweep';
}

function hasLeafBlowerCapability(
  projectile: Pick<ProjectileSpawnConfig, 'leafBlowerMinKnockback' | 'leafBlowerMaxKnockback' | 'leafBlowerDeflectsProjectiles'>,
): boolean {
  return projectile.leafBlowerMinKnockback !== undefined
    || projectile.leafBlowerMaxKnockback !== undefined
    || projectile.leafBlowerDeflectsProjectiles === true;
}

function hasGaussDischarge(
  projectile: Pick<ProjectileSpawnConfig, 'gaussChainRadius' | 'gaussChainDamageFactor'>,
): boolean {
  return (projectile.gaussChainRadius ?? 0) > 0
    && (projectile.gaussChainDamageFactor ?? 0) > 0;
}

function hasHydraSplitCapability(projectile: Pick<TrackedProjectile, 'splitCount'>): boolean {
  return (projectile.splitCount ?? 0) > 0;
}

function createDetonationTarget(projectile: TrackedProjectile): ProjectileDetonationTarget {
  return {
    id: projectile.id,
    x: projectile.sprite.x,
    y: projectile.sprite.y,
    projectileOwnerId: projectile.ownerId,
    effect: projectile.detonable!,
    sourceId: projectile.sourceId,
    sourceSlot: projectile.sourceSlot,
  };
}

function projFallbackSign(value: number): number {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}
