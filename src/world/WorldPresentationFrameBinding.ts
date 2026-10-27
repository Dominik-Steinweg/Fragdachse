import { loadingTimeline } from '../diagnostics/LoadingTimeline';
import { ReactivePropRenderer, type ReactivePropZoneSink } from '../effects/reactiveProps/ReactivePropRenderer';
import { resolveReactivePropPose } from '../effects/reactiveProps/ReactivePropVisualModel';
import { BeeSwarmRenderer, type BeeSwarmAudio } from '../effects/beeSwarm/BeeSwarmRenderer';
import type { BeeHivePresentation } from '../effects/beeSwarm/BeeFlockModel';
import type { SyncedBeeSwarm } from '../types';
import type { ReactivePropRuntime } from './reactiveProps/ReactivePropRuntime';
import type { EntityBurnGpuController } from '../effects/EntityBurnGpuController';
import { FireControlRenderer, type FireControlOriginalVisual } from '../effects/fireControl/FireControlRenderer';
import type { FireControlSnapshot } from '../systems/fireControl/FireControlSnapshot';
import type { BomberSquadronSnapshot } from '../systems/bomberSquadron/BomberSquadronSnapshot';
import { bomberWorldBoundsFromMetrics } from '../systems/bomberSquadron/BomberSquadronPlan';
import { BomberSquadronRenderer, type BomberSquadronPresentationPorts } from '../effects/bomberSquadron/BomberSquadronRenderer';
import type { FireControlCopyShotSource } from '../projectile/ProjectilePresentationRuntime';
import type { WorldSunlightPresentation } from '../effects/sunlight/WorldSunlightPresentation';
import type { WorldHealthBarRenderer } from '../effects/health/WorldHealthBarRenderer';
import type { GroundFogSystem } from '../effects/groundFog/GroundFogSystem';
import { createMovementVisualSample, type MovementVisualSource } from '../effects/MovementStepSampler';
import type { BaseManager } from '../entities/BaseManager';
import type { ProjectilePresentationRuntime } from '../projectile/ProjectilePresentationRuntime';
import type { EffectSystem } from '../effects/EffectSystem';
import { getGraphicsQualityController } from '../graphics/GraphicsQuality';
import { WorldGroundFogBinding } from './WorldGroundFogBinding';
import { WILDLIFE_DISTURBANCE_MARGIN_PX, type WildlifeMover } from '../arena/AmbientWildlifeModel';
import { AMBIENT_WILDLIFE } from '../arena/AmbientWildlifeConfig';
import type { MovementEffectsRenderer } from '../effects/MovementEffectsRenderer';
import type { BurrowGpuRenderer } from '../effects/BurrowGpuRenderer';
import * as Phaser from 'phaser';
import { ArenaBuilder, type ArenaBuilderResult } from '../arena/ArenaBuilder';
import {
  ACTIVE_ARENA_METRICS_PROFILE,
  ARENA_MAX_X, ARENA_MAX_Y, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_VIEWPORT_HEIGHT, ARENA_VIEWPORT_WIDTH, GAME_HEIGHT, GAME_WIDTH,
  NET_SMOOTH_TIME_MS, PLAYER_SIZE,
} from '../config';
import { setCameraBaseScroll } from '../graphics/cameraBaseScroll';
import { getCameraFocusOverride, resolveCameraFocusZoom, setAppliedStagedZoom } from '../graphics/cameraFocusOverride';
import { SpawnCameraZoom } from '../effects/camera/SpawnCameraZoom';
import { playerCameraZoomFor } from '../effects/camera/PlayerCameraZoom';
import type { ArenaSpectatorCameraInput } from '../scenes/arena/ArenaInputBindings';
import { advanceSpectatorCameraScroll } from '../scenes/arena/SpectatorCameraModel';
import { getVisibleWorldView, type WorldViewRect } from '../ui/HostileBaseIndicator';
import { ConstructionOwnershipGpuSystem } from '../effects/ConstructionOwnershipGpuSystem';
import type { ConstructionOwnershipMoteRenderer } from '../effects/ConstructionOwnershipMoteRenderer';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type { InputSystem } from '../systems/InputSystem';
import { allowsWorldPresentationSurface, type WorldPresentationRequirement } from './WorldPresentation';
import type {
  ArenaLayout,
  PlayerNetState,
  SyncedAirstrikeStrike,
  SyncedBurningGroundSnapshot,
  SyncedEnergyShield,
  SyncedGuardianSpirit,
  SyncedMeteorStrike,
  SyncedNukeStrike,
  SyncedPlaceableRock,
  SyncedPowerUp,
  SyncedPowerUpPedestal,
  SyncedRepairDrone,
  SyncedAttackDrone,
  SyncedAttackDroneBomb,
  SyncedSlimeTrailSnapshot,
  SyncedTeslaDome,
  SyncedTimeBubble,
  SyncedTrainState,
} from '../types';
import type { LightingSystem } from '../effects/LightingSystem';
import {
  getProjectileLightSpec,
  LIGHT_PRESETS,
  type ProjectileLightSample,
} from '../effects/LightingConfig';
import { mixColors } from '../effects/EffectUtils';
import type { ShadowSystem } from '../effects/ShadowSystem';
import type { ShadowProjectileSample } from '../effects/ShadowConfig';
import type { PlayerEntity } from '../entities/PlayerEntity';
import { TRAIN } from '../train/TrainConfig';
import { TrainLightOccluderSource, type TrainSegmentRect } from '../train/TrainLightOccluderSource';
import type { TrainRenderer } from '../train/TrainRenderer';
import type { WorldMetrics } from './WorldMetrics';
import type { FogSurfaceStamp } from '../effects/groundFog/FogSurfaceMask';
import type { StructureRect } from '../arena/StructureOutline';
import type { WorldPersistentBaseSite } from './WorldRuntimeContext';
import {
  toPersistentBaseGravelZone,
  type PersistentBaseVisualSite,
} from '../persistentBase/PersistentBasePresentation';

const TRAIN_LIGHT_SIDES = [-1, 1] as const;

export type FireControlSnapshotSource = (now: number) => FireControlSnapshot;
/** Bestätigte Bomberstaffeln (Slice `bq`); Host und Client lesen dieselbe Quelle. */
export type BomberSquadronSnapshotSource = () => BomberSquadronSnapshot;
/** Explosion, audio and camera ports the squadron presentation borrows from the scene. */
export type BomberSquadronEffectPorts = Pick<BomberSquadronPresentationPorts, 'explode' | 'playSound' | 'cameraFeedback' | 'navLights'>;

export interface WorldPresentationPersistentBaseVisuals {
  sync(site: WorldPersistentBaseSite | null, metrics: WorldMetrics | null, showOverlay: boolean): void;
}

export interface WorldPresentationPersistentBasePreview {
  syncLights(inArena: boolean): void;
}

export interface WorldPresentationRenderWork {
  readonly pending: number;
  readonly resident: number;
  readonly renderReady: boolean;
}

/** Der generische, replizierte World-Anteil des Client-Snapshots. */
/** Ports of the bee presentation: game audio and drawn enemy positions (dive targets). */
export interface BeeSwarmPorts {
  readonly audio: BeeSwarmAudio | null;
  /** Host: swarms straight from the host owner (the host never reads its own replicated slice). */
  readonly hostSwarms: () => readonly SyncedBeeSwarm[] | null;
  readonly enemyPosition: (id: string) => { x: number; y: number } | null;
}

export interface WorldClientPresentationState {
  readonly earthbreak?: readonly import('../systems/BurrowEarthbreakRuntime').SyncedBurrowEarthbreak[];
  readonly players: Record<string, PlayerNetState>;
  readonly placeableRocks: SyncedPlaceableRock[];
  readonly timeBubbles: SyncedTimeBubble[];
  readonly teslaDomes: SyncedTeslaDome[];
  readonly energyShields: SyncedEnergyShield[];
  readonly guardianSpirits: SyncedGuardianSpirit[];
  readonly repairDrones: SyncedRepairDrone[];
  readonly attackDrones?: SyncedAttackDrone[];
  readonly attackDroneBombs?: SyncedAttackDroneBomb[];
  readonly beeSwarms?: SyncedBeeSwarm[];
  readonly slimeTrail: SyncedSlimeTrailSnapshot;
  readonly burningGround: SyncedBurningGroundSnapshot;
  readonly train: SyncedTrainState | null;
  readonly powerups: SyncedPowerUp[];
  readonly pedestals: SyncedPowerUpPedestal[];
  readonly nukes: SyncedNukeStrike[];
  readonly airstrikes: SyncedAirstrikeStrike[];
  readonly meteors: SyncedMeteorStrike[];
}

/** Kleine Renderer-Ports fuer die World-Projektion. */
export interface WorldClientPresentationRenderers {
  readonly timeBubble: { syncVisuals(snapshots: readonly SyncedTimeBubble[]): void };
  readonly teslaDome: { syncVisuals(domes: SyncedTeslaDome[], audioScope?: unknown): void };
  readonly energyShield: { syncVisuals(shields: SyncedEnergyShield[]): void };
  readonly guardianSpirit: { syncVisuals(snapshots: readonly SyncedGuardianSpirit[]): void };
  readonly repairDrone: {
    syncVisuals(snapshots: readonly SyncedRepairDrone[], constructions: readonly SyncedPlaceableRock[]): void;
  };
  readonly slimeTrail: { syncVisuals(snapshot: SyncedSlimeTrailSnapshot): void };
  readonly attackDrone?: {
    syncVisuals(drones: readonly SyncedAttackDrone[], bombs: readonly SyncedAttackDroneBomb[], constructions: readonly SyncedPlaceableRock[], now: number): void;
  };
  readonly flamethrowerUpgrades: {
    syncGround(snapshot: SyncedBurningGroundSnapshot, now: number): void;
    syncRings(players: Readonly<Record<string, PlayerNetState>>): void;
  };
  /** Der World-eigene Zug-Renderer entsteht erst nach dem Frame-Binding. */
  readonly getTrain: () => {
    setTarget(state: SyncedTrainState | null): void;
    render(lerpFactor: number): void;
  } | null;
  readonly powerUp: {
    syncPedestals(pedestals: SyncedPowerUpPedestal[]): void;
    sync(powerups: SyncedPowerUp[]): void;
    updatePedestals(now: number): void;
    updatePresentation(presentationTimeMs: number): void;
  };
  readonly nuke: { sync(nukes: SyncedNukeStrike[]): void };
  readonly airstrike: { sync(strikes: SyncedAirstrikeStrike[], hostNowMs: number): void };
  readonly meteor: { sync(meteors: SyncedMeteorStrike[], hostNowMs: number): void };
}

/**
 * Der world-scoped Owner der aktiven World-Presentation-Verdrahtung.
 *
 * `WorldPresentationBinding` ist die handoffbare Darstellung selbst – Layout und gebauter Baum,
 * die einen World-Wechsel ueberleben koennen. Dieser Owner ist etwas anderes: die laufende
 * Verdrahtung, die diese Darstellung mit den scene-langlebigen Renderern und Consumern der
 * *aktuellen* World verbindet. Er gehoert genau einer `WorldRuntime` und faellt vor deren
 * handoffbarer Darstellung – sonst saehe ein bereits uebergebener oder gerade uebergehender
 * Handoff noch aktive world-scoped Verdrahtung.
 *
 * Deshalb landet er **nie** im `WorldPresentationHandoff`: Was dort liegt, steht nur noch da und
 * wird von niemandem mehr getaktet oder verdrahtet.
 *
 * Phase 6A zieht die World-Display-Synchronisation schrittweise hierher. Diese Arbeit ist reine
 * Presentation-Infrastruktur ohne Gameplay-Zustand, deshalb darf dieser Owner Phaser-Objekte
 * direkt halten – er ist ausdruecklich kein Service-Locator und kennt die Scene nur ueber die
 * schmalen, benannten Ports dieses Inputs. Activity-Presentation bleibt ausserhalb dieses Owners.
 */
/** Allocation-free enemy iteration (EnemyManager); wildlife reads only each displayed pose. */
export interface WildlifeEnemySource {
  forEachEnemy(visitor: (enemy: MovementVisualSource) => void): void;
}

export interface WorldPresentationFrameBindingInput {
  readonly getLobbyStructures?: () => Pick<import('../arena/lobbyStructures/LobbyStructureRenderer').LobbyStructureRenderer, 'update'> | null;
  readonly getLobbyInteractionMenu?: () => import('../config/authoring/lobbyBuildings').LobbyMenu | null;
  readonly enemyEyes?: import('../effects/EnemyEyeGlowRenderer').EnemyEyeGlowRenderer;
  readonly groundFog?: {
    readonly getSystem: () => GroundFogSystem | null;
    /** Activity overlay; undefined restores the borrowed World strength. */
    readonly getActivityStrength?: () => number | undefined;
    /** Activity colour of the same fog; undefined = neutral. */
    readonly getActivityTint?: () => readonly [number, number, number] | undefined;
    readonly getBases: () => BaseManager | null;
    readonly getProjectiles: () => ProjectilePresentationRuntime | null;
    readonly effects: Pick<EffectSystem, 'bindExplosionObserver' | 'bindGroundFogCombat'>;
  };
  /** Destructive explosions disturb this World's wildlife, independent of the ground fog. */
  readonly explosions?: Pick<EffectSystem, 'bindExplosionObserver'>;
  /** Positional bird sounds; absent in previews and editors without game audio. */
  readonly wildlifeAudio?: import('../arena/AmbientWildlifeAudio').WildlifeAudioPort;
  /** Activity moonlight for the World's sun owner (Dawn blood moon); undefined = the World sky. */
  readonly getActivityMoonlight?: () => import('../effects/sunlight/WorldSunlightPresentation').ActivityMoonlight | undefined;
  /** Activity share of the void danger (permanent hazards, presence); null = the World's own. */
  readonly getActivityVoidDanger?: () => import('../arena/VoidDangerField').ActivityVoidDanger | null;
  readonly constructionOwnership?: {
    readonly motes: Pick<ConstructionOwnershipMoteRenderer, 'openWorld' | 'closeWorld' | 'captureFrame'>;
    readonly getPlacement: () => Pick<PlacementSystem, 'getAllRuntimeRocks' | 'getOwnedConstructions' | 'getRuntimeRock'> | null;
    readonly getLocalPlayerId: () => string;
    readonly interaction: Pick<InputSystem, 'isConstructionPlacementActive' | 'isDismantlePlacementActive'
      | 'isGlobalDismantleHoldActive' | 'isPersistentRewardPlacementActive' | 'isRepositionActive'>;
  };
  readonly movementEffects?: MovementEffectsRenderer;
  /** Shared portal look; fire-control portals submit their ends to it. */
  readonly portals?: import('../effects/portal/PortalPresentation').PortalPresentation;
  readonly burrowEffects?: BurrowGpuRenderer;
  readonly healthBars?: WorldHealthBarRenderer;
  readonly healthBarScope?: object;
  /** Die Scene, deren Hauptkamera diese World-Instanz waehrend ihrer Lebenszeit positioniert. */
  readonly scene: Phaser.Scene;
  /** Wie dieser Peer die World lokal darstellt; die Weltkamera ist eine ihrer Flaechen. */
  readonly getLocalWorldPresentation: () => WorldPresentationRequirement;
  /** A/D- bzw. Pfeiltasten-Eingabe der freien Zuschauerkamera. */
  readonly getSpectatorCameraInput: () => ArenaSpectatorCameraInput | undefined;
  /** Die Spielfigur, der die Kamera folgt; `null` ohne lokal sichtbare Figur. */
  readonly getLocalPlayerSprite: () => Phaser.GameObjects.Sprite | null;
  /** Zuschauerrolle dieser Runde; ein Spectator fuehrt die freie Kamera statt der Verfolgung. */
  readonly isLocalPlayerSpectator: () => boolean;
  /** Ob die lokale Spielfigur gerade lebt; tot ohne vorbereiteten Startfokus haelt die Kamera an. */
  readonly isLocalPlayerAlive: () => boolean;
  /** Die Arena laedt noch; der erste bekannte Spawn ist bereits ein gueltiger Kamerafokus. */
  readonly isArenaLoading: () => boolean;
  /** Der Countdown laeuft; wie beim Laden gilt der vorbereitete Startfokus bereits. */
  readonly isArenaCountdownActive: () => boolean;
  /** Ob diese World Spawn und Tod der eigenen Figur mit der Kamera inszeniert; die LobbyWorld nicht. */
  readonly stagesLocalSpawn?: boolean;
  /**
   * Der lokale Ladeschleier deckt die World noch ab. Er kann laenger stehen als die gemeinsame
   * Ladephase; was nur fuer die Augen inszeniert ist, beginnt erst, wenn er aufgeht.
   */
  readonly isLoadingVeilShown?: () => boolean;
  /** Der gebaute World-Zustand, dessen residente Render-Chunks der Residency-Sync angleicht. */
  readonly getArenaResult: () => ArenaBuilderResult | null;
  readonly clientWorldPresentation: WorldClientPresentationRenderers;
  /** Statische/dynamische Schatten gehoeren zur aktiven World-Presentation. */
  readonly shadow: ShadowSystem;
  /** Lightmap und ihre World-Occluder-Verdrahtung gehoeren zur aktiven World-Presentation. */
  readonly lighting: LightingSystem;
  readonly getWorldLayout: () => ArenaLayout | null;
  readonly getWorldMetrics: () => WorldMetrics | null;
  readonly getPersistentBaseSite: () => WorldPersistentBaseSite | null;
  readonly getPersistentBaseVisualSite: () => PersistentBaseVisualSite | null;
  /** The World's bases; their grounding follows the base-site gravel below them. */
  readonly getBases?: () => BaseManager | null;
  readonly isPersistentBasePlacementOverlayActive: () => boolean;
  readonly persistentBaseVisuals: WorldPresentationPersistentBaseVisuals;
  readonly persistentBasePreview: WorldPresentationPersistentBasePreview;
  readonly setLocalPlayerStatusRingActive: (active: boolean) => void;
  readonly setLocalPlayerWorldBarsVisible: (visible: boolean) => void;
  readonly isLocalPlayerAttachedToWorld: () => boolean;
  readonly getPlayers: () => readonly PlayerEntity[];
  readonly getProjectileShadowSamples: () => readonly ShadowProjectileSample[];
  readonly getProjectileLightSamples: () => readonly ProjectileLightSample[];
  readonly getTrainState: (inRoundWorld: boolean) => SyncedTrainState | null;
  readonly getLiveTrainSegments: (inRoundWorld: boolean) => readonly TrainSegmentRect[] | null;
  readonly getTrainVisual: () => Pick<TrainRenderer, 'computeSegYs' | 'getShadowState'> | null;
  readonly syncTurretLights: (inArena: boolean) => void;
  readonly syncBaseLights: (inArena: boolean) => void;
  /** Raised base cells: tile images and spawn-structure walls cast footprints, fort cells (`footprint: false`) only receive. */
  readonly getBaseShadowCells: () => Iterable<{ readonly x: number; readonly y: number; readonly active: boolean;
    readonly visible: boolean; readonly footprint?: boolean }>;
  /** Geometry above the walkable ground on which the fog is cut; shadows keep `getBaseShadowCells`. */
  readonly getFogSurfaceStamps: () => Iterable<FogSurfaceStamp>;
  /** World-pixel outline rects of live structures; figure shadows are not received on their roofs. */
  readonly getStructureRects: () => readonly StructureRect[];
  readonly getSynchronizedNow: () => number;
}

/**
 * Der neutrale Kamerastand ohne aktive World-Presentation.
 *
 * Gilt fuer beide Faelle, die dasselbe bedeuten: Diese World stellt keine Weltkamera dar, oder es
 * gibt gerade ueberhaupt keine World-Runtime (zwischen zwei Instanzen, vor der ersten). Beide
 * Wege muessen denselben Stand hinterlassen, sonst rechnet das Kamera-Feedback am Frame-Ende auf
 * einer veralteten Basis der vorherigen World weiter.
 */
export function resetWorldCameraBase(scene: Phaser.Scene): void {
  const camera = scene.cameras.main;
  camera.scrollX = 0;
  camera.scrollY = 0;
  setCameraBaseScroll(scene, 0, 0);
}

export class WorldPresentationFrameBinding {
  private fireControl: FireControlRenderer | null = null;
  private releaseFireControlCopyShots: (() => void) | null = null;
  private fireControlPorts: {
    snapshot: FireControlSnapshotSource;
    original: (id: number) => FireControlOriginalVisual | undefined;
  } | null = null;

  /** Bound once by World composition; the frame owner releases all filters, sprites and lights. */
  bindFireControl(snapshot: FireControlSnapshotSource,
    original: (id: number) => FireControlOriginalVisual | undefined,
    shots: FireControlCopyShotSource): void {
    if (this.destroyed) return;
    if (this.fireControlPorts) throw new Error('Fire control presentation is already bound');
    this.fireControlPorts = { snapshot, original };
    if (this.input.getLocalWorldPresentation().required) this.createFireControl();
    this.releaseFireControlCopyShots = shots.bindFireControlCopyShots(id => this.fireControl?.onShot(id));
  }

  private beeSwarmPorts: BeeSwarmPorts | null = null;
  private beeSwarmRenderer: BeeSwarmRenderer | null = null;
  private latestBeeSwarms: readonly SyncedBeeSwarm[] = [];
  private readonly beeHives = new Map<number, BeeHivePresentation>();

  /** Bound once by World composition; the frame owner draws hive bees and swarms and plays their buzz. */
  bindBeeSwarms(ports: BeeSwarmPorts): void {
    if (this.destroyed) return;
    if (this.beeSwarmPorts) throw new Error('Bee swarm presentation is already bound');
    this.beeSwarmPorts = ports;
  }

  /** Hive entrances from the drawn hive pose; swarms from the replicated slice. Free on maps without hives. */
  private syncBeeSwarms(showWorld: boolean): void {
    const runtime = this.reactiveProps, ports = this.beeSwarmPorts;
    this.beeHives.clear();
    if (runtime && ports && showWorld && this.input.getLocalWorldPresentation().required) {
      const layoutCells = this.input.getWorldLayout()?.reactiveProps ?? [];
      runtime.forEachPresentationState(state => {
        if (state.kind.visual.presentation !== 'hive' || state.phase === 'destroyed') return;
        const position = runtime.getPosition(state.obstacleId);
        if (!position) return;
        const pose = resolveReactivePropPose(state.index, layoutCells);
        // The entrance faces the sprite's south, about 10 px from the skep centre.
        const reach = 10;
        this.beeHives.set(state.index, { index: state.index, phase: state.phase, progress: state.progress,
          centerX: position.x + pose.offsetX, centerY: position.y + pose.offsetY, rotation: pose.rotation,
          entranceX: position.x + pose.offsetX - reach * Math.sin(pose.rotation),
          entranceY: position.y + pose.offsetY + reach * Math.cos(pose.rotation) });
      });
    }
    if (!ports || (this.beeHives.size === 0 && (ports.hostSwarms() ?? this.latestBeeSwarms).length === 0)) {
      this.beeSwarmRenderer?.destroy();
      this.beeSwarmRenderer = null;
      return;
    }
    this.beeSwarmRenderer ??= new BeeSwarmRenderer(this.input.scene, ports.audio, this.input.lighting);
    const players = this.input.getPlayers();
    this.beeSwarmRenderer.sync({
      swarms: ports.hostSwarms() ?? this.latestBeeSwarms, hives: this.beeHives, syncNow: this.input.getSynchronizedNow(),
      timeMs: this.input.scene.time.now, quality: getGraphicsQualityController(this.input.scene)?.getLevel() ?? 'high',
      shadowStrength: Math.max(.15, 1 - this.input.lighting.getArtificialLightFactor()),
      targetPosition: (kind, id) => {
        if (kind === 'enemy') return ports.enemyPosition(id);
        const player = players.find(entry => entry.id === id);
        return player?.active ? { x: player.x, y: player.y } : null;
      },
    });
  }

  private reactiveProps: ReactivePropRuntime | null = null;
  private reactivePropBurnGpu: EntityBurnGpuController | null = null;
  private reactivePropZoneSink: ReactivePropZoneSink | null = null;
  private reactivePropRenderer: ReactivePropRenderer | null = null;

  /** Bound once by World composition; the frame owner owns the barrel sprites, glow, burn and warning zone. */
  bindReactiveProps(runtime: ReactivePropRuntime, burnGpu: EntityBurnGpuController | null, zoneSink: ReactivePropZoneSink | null): void {
    if (this.destroyed) return;
    if (this.reactiveProps) throw new Error('Reactive prop presentation is already bound');
    this.reactiveProps = runtime;
    this.reactivePropBurnGpu = burnGpu;
    this.reactivePropZoneSink = zoneSink;
  }

  private syncReactiveProps(showWorld: boolean): void {
    if (!this.reactiveProps || !showWorld || !this.input.getLocalWorldPresentation().required) {
      this.reactivePropRenderer?.destroy();
      this.reactivePropRenderer = null;
      return;
    }
    this.reactivePropRenderer ??= new ReactivePropRenderer(this.input.scene, this.input.lighting, this.reactivePropBurnGpu,
      this.reactivePropZoneSink, this.beeSwarmPorts?.audio ?? null);
    this.reactivePropRenderer.sync(this.reactiveProps, this.input.getWorldLayout()?.reactiveProps ?? [],
      this.input.scene.time.now, this.input.getSynchronizedNow());
    this.syncBeeSwarms(showWorld);
  }

  private *reactivePropShadowCells(): Iterable<{ index: number; x: number; y: number; alive: boolean }> {
    const runtime = this.reactiveProps;
    if (!runtime) return;
    const cells: { index: number; x: number; y: number; alive: boolean }[] = [];
    const layoutCells = this.input.getWorldLayout()?.reactiveProps ?? [];
    runtime.forEachPresentationState(state => {
      const position = runtime.getPosition(state.obstacleId);
      if (!position) return;
      // The contact shadow sits under the drawn barrel, including its group pose.
      const pose = resolveReactivePropPose(state.index, layoutCells);
      cells.push({ index: state.index, x: position.x + pose.offsetX, y: position.y + pose.offsetY, alive: state.phase !== 'destroyed' });
    });
    yield* cells;
  }

  private bomberSquadronSnapshot: BomberSquadronSnapshotSource | null = null;
  private bomberSquadronEffects: BomberSquadronEffectPorts | null = null;
  private bomberSquadron: BomberSquadronRenderer | null = null;

  /**
   * Bound once by World composition. The frame owner owns the squadron renderer (drone flight,
   * bomb fall, shadows, bundled explosions) and releases it with the World presentation.
   */
  bindBomberSquadron(snapshot: BomberSquadronSnapshotSource, effects: BomberSquadronEffectPorts): void {
    if (this.destroyed) return;
    if (this.bomberSquadronSnapshot) throw new Error('Bomber squadron presentation is already bound');
    this.bomberSquadronSnapshot = snapshot;
    this.bomberSquadronEffects = effects;
  }

  private syncBomberSquadron(showWorld: boolean): void {
    if (!showWorld || !this.input.getLocalWorldPresentation().required) {
      this.bomberSquadron?.destroy();
      this.bomberSquadron = null;
      return;
    }
    const snapshot = this.bomberSquadronSnapshot, effects = this.bomberSquadronEffects;
    if (!snapshot || !effects) return;
    this.bomberSquadron ??= new BomberSquadronRenderer(this.input.scene, {
      ...effects,
      worldBounds: () => {
        const metrics = this.input.getWorldMetrics();
        return metrics ? bomberWorldBoundsFromMetrics(metrics) : null;
      },
      tintAt: (x, y) => this.input.lighting.resolveCanopyTint(x, y),
    });
    this.bomberSquadron.update(snapshot(), this.input.getSynchronizedNow());
  }

  private createFireControl(): void {
    if (!this.fireControlPorts || this.fireControl) return;
    this.fireControl = new FireControlRenderer(this.input.scene, this.fireControlPorts.original,
      'A', this.input.lighting, ownerId => {
        const player = this.input.getPlayers().find(p => p.id === ownerId);
        const sprite = player?.active ? player.displayObject : undefined;
        return sprite?.visible ? { x: sprite.x, y: sprite.y } : undefined;
      }, this.input.portals);
  }

  private syncFireControl(showWorld: boolean): void {
    if (!showWorld || !this.input.getLocalWorldPresentation().required) {
      // An empty snapshot fades removed copies; presentation loss must release them immediately.
      this.fireControl?.destroy();
      this.fireControl = null;
      return;
    }
    this.createFireControl();
    if (!this.fireControl || !this.fireControlPorts) return;
    const now = this.input.getSynchronizedNow();
    this.fireControl.update(this.fireControlPorts.snapshot(now), now);
  }

  private presentationTimeMs=0;
  private sunlightOwner: WorldSunlightPresentation | null = null;
  get sunlight(): WorldSunlightPresentation | null { return this.sunlightOwner; }
  bindSunlight(create: () => WorldSunlightPresentation): void {
    if(this.destroyed)return;
    this.cancelRenderRelease();
    this.releasedView = null;
    this.sunlightOwner?.destroy();this.sunlightOwner=null;
    const owner=create();this.sunlightOwner=owner;
    try {this.syncSunlight();}
    catch(error){owner.destroy();this.sunlightOwner=null;throw error;}
  }
  private syncSunlight():void {
    this.sunlightOwner?.setActivityMoonlight(this.input.getActivityMoonlight?.() ?? null);
    this.sunlightOwner?.setActivityVoidDanger(this.input.getActivityVoidDanger?.() ?? null);
    this.sunlightOwner?.update(this.input.lighting.getTimeOfDayMinutes(),this.presentationTimeMs,this.input.getSynchronizedNow());
  }
  private fogBinding: WorldGroundFogBinding | null = null;
  private ownershipMarkers: ConstructionOwnershipGpuSystem | null = null;
  private ownershipScope: object | null = null;
  private readonly ownedConstructionIds = new Set<number>();
  private destroyed = false;
  /** Displayed bodies handed to wildlife this frame; entries are pooled and mutated in place. */
  private readonly wildlifeMovers: WildlifeMover[] = [];
  private readonly wildlifeMoverPool: { id: string; x: number; y: number; radius: number }[] = [];
  private readonly wildlifeSample = createMovementVisualSample();
  private wildlifeView: WorldViewRect | null = null;
  private readonly releaseWildlifeExplosions: (() => void) | null;
  /** Created once: an enemy visitor that reads the displayed pose, never the simulation. */
  private readonly collectWildlifeEnemy = (enemy: MovementVisualSource): void => {
    const view = this.wildlifeView, sample = this.wildlifeSample;
    if (!view) return;
    enemy.readMovementVisualSample(sample);
    if (!sample.visible || sample.isBurrowDash || !Number.isFinite(sample.x + sample.y + sample.size)) return;
    const margin = WILDLIFE_DISTURBANCE_MARGIN_PX;
    if (sample.x < view.x - margin || sample.y < view.y - margin
      || sample.x > view.x + view.width + margin || sample.y > view.y + view.height + margin) return;
    this.pushWildlifeMover(sample.id, sample.x, sample.y, Math.max(0, (sample.size - PLAYER_SIZE) / 2));
  };
  private lastCameraScrollX = 0;
  private focusZoomApplied = false;
  private focusZoomBoundsWereUsed = true;
  /** Zuletzt angewandter Zusatzzoom ueber dem Designzoom (Spieler, Spawn, Tod, Boss-Intro). */
  private focusZoomFactor = 1;
  /** Nahaufnahme des eigenen Spawns; die Figur, fuer die sie zuletzt begonnen hat. */
  private readonly spawnZoom = new SpawnCameraZoom();
  private spawnZoomSprite: Phaser.GameObjects.Sprite | null = null;
  /** Wo die eigene Figur gefallen ist, solange die Kamera dort auf den Respawn wartet. */
  private deathFocus: { x: number; y: number } | null = null;
  /**
   * Der geglaettete Weltpunkt, den die Kamera zeigt. Geglaettet wird nur er, nie der geklemmte
   * Ausschnitt: Der Ausschnitt entsteht jeden Frame exakt aus Punkt, Zoom und Klemmung. Am
   * Arenarand verschiebt sich die Klemmung mit dem Zoom; eine geglaettete Scroll-Position liefe
   * ihr hinterher und zoege nach jeder Zoomfahrt nach.
   */
  private followFocusX = 0;
  private followFocusY = 0;
  private followFocusValid = false;
  private lastCameraScrollY = 0;
  private spectatorCameraScrollX = 0;
  private spectatorCameraScrollY = 0;

  constructor(private readonly input: WorldPresentationFrameBindingInput) {
    this.input.enemyEyes?.openWorld(this, () => !this.destroyed && this.input.getLocalWorldPresentation().required);
    this.input.movementEffects?.openWorld(this);
    this.input.burrowEffects?.openWorld(this, () => !this.destroyed && this.input.getLocalWorldPresentation().required,
      (x, y) => {
        const view = getVisibleWorldView(this.input.scene.cameras.main);
        return x >= view.x - 100 && y >= view.y - 100 && x <= view.x + view.width + 100 && y <= view.y + view.height + 100;
      });
    this.input.lighting.setDynamicOccluderSource(this.trainLightOccluders);
    this.releaseWildlifeExplosions = input.explosions?.bindExplosionObserver((x, y, radius) => {
      if (!this.destroyed && this.input.getLocalWorldPresentation().required)
        this.input.getArenaResult()?.wildlife?.notifyImpulse('explosion', x, y, radius);
    }) ?? null;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Capture after input and replica/host state, before the shared GPU retire/emission tick. */
  syncConstructionOwnership(showWorld: boolean): void {
    if (this.destroyed) return;
    const ownership = this.input.constructionOwnership;
    if (!ownership) return;
    const presentation = this.input.getLocalWorldPresentation();
    const metrics = this.input.getWorldMetrics();
    const placement = ownership.getPlacement();
    if (!allowsWorldPresentationSurface(presentation, 'worldOverlays') || !metrics || !placement) {
      this.clearConstructionOwnership();
      return;
    }
    if (!this.ownershipMarkers) {
      this.ownershipMarkers = new ConstructionOwnershipGpuSystem(this.input.scene);
      this.ownershipScope = {};
      ownership.motes.openWorld(this.ownershipScope);
    }
    const interaction = ownership.interaction;
    const active = showWorld && presentation.mode === 'interactive'
      && this.input.isLocalPlayerAttachedToWorld() && this.input.isLocalPlayerAlive()
      && !this.input.isLocalPlayerSpectator() && (interaction.isConstructionPlacementActive()
        || interaction.isDismantlePlacementActive() || interaction.isGlobalDismantleHoldActive()
        || interaction.isPersistentRewardPlacementActive() || interaction.isRepositionActive());
    this.ownedConstructionIds.clear();
    for (const rock of placement.getOwnedConstructions(ownership.getLocalPlayerId())) {
      if (rock.ownership !== 'base-owned') this.ownedConstructionIds.add(rock.id);
    }
    const targets = this.ownershipMarkers.sync(placement.getAllRuntimeRocks(), this.ownedConstructionIds, metrics, showWorld, active);
    ownership.motes.captureFrame(this.ownershipScope!, active, targets, getVisibleWorldView(this.input.scene.cameras.main));
  }

  private clearConstructionOwnership(): void {
    this.ownershipMarkers?.destroy();
    this.ownershipMarkers = null;
    if (this.ownershipScope) this.input.constructionOwnership?.motes.closeWorld(this.ownershipScope);
    this.ownershipScope = null;
    this.ownedConstructionIds.clear();
  }

  /**
   * Setzt die Hauptkamera auf ihre **unversetzte** Basisposition. Der visuelle Versatz des
   * Kamera-Feedbacks kommt erst am Frame-Ende ueber `applyCameraFeedback()` in der Scene dazu.
   *
   * Laeuft pro Frame zweimal – einmal vor der Simulation, weil das Startbild das Working Set
   * definiert, auf das die Ladebarriere wartet, und einmal danach auf die finale Spielerposition.
   * Die Verfolgung lerpt bewusst aus `lastCameraScrollX/Y` und nicht aus `camera.scrollX/Y`: Zu
   * Beginn eines Frames traegt die Kamera noch den Versatz des Vorframes, und ein Ruecklesen
   * wuerde das Rumpeln in die Verfolgung zurueckkoppeln und die Kamera abdriften lassen.
   *
   * Nach `destroy()` wirkungslos: ein stale Aufruf darf die Kamera einer nachfolgenden World
   * nicht mehr bewegen.
   */
  syncCamera(deltaMs: number, showWorld: boolean): void {
    if (this.destroyed) return;
    const scene = this.input.scene;
    const camera = scene.cameras.main;

    const spectator = showWorld && this.input.isLocalPlayerSpectator();
    const arenaWidth = Math.max(0, ARENA_MAX_X - ARENA_OFFSET_X);
    const arenaHeight = Math.max(0, ARENA_MAX_Y - ARENA_OFFSET_Y);
    const canSpectatorPanX = arenaWidth > ARENA_VIEWPORT_WIDTH;
    const canSpectatorPanY = arenaHeight > ARENA_VIEWPORT_HEIGHT;
    const canSpectatorPan = canSpectatorPanX || canSpectatorPanY;
    // Die Weltkamera ist World-Presentation: ohne lokale Darstellung dieser World gibt es sie
    // nicht, auch wenn die Simulation weiterlaeuft.
    const worldCamera = allowsWorldPresentationSurface(this.input.getLocalWorldPresentation(), 'worldCamera');
    const localSprite = this.input.getLocalPlayerSprite();
    const following = showWorld && worldCamera && !spectator;
    const spawn = this.syncSpawnZoom(following, localSprite);
    // Der Spieler waehlt per Mausrad seine Grundsicht; Spawn und Tod setzen darauf auf.
    const requestedZoom = (following ? playerCameraZoomFor(scene).sample(scene.time.now) : 1) * spawn.factor;
    // Eine feste Arenakamera folgt der Figur nur, solange gezoomt ist. Bei Zoom 1 faellt die
    // Klemmung auf genau den festen Ausschnitt zurueck, der Uebergang ist nahtlos.
    const fixedCameraFollows = !ACTIVE_ARENA_METRICS_PROFILE.usesDynamicCamera && requestedZoom > 1.0005;
    if (!showWorld || !worldCamera
      || (!ACTIVE_ARENA_METRICS_PROFILE.usesDynamicCamera && !fixedCameraFollows && !(spectator && canSpectatorPan))) {
      // Zoom gilt nur in der normalen Spielerverfolgung.
      this.syncFocusZoom(1);
      this.lastCameraScrollX = 0;
      this.lastCameraScrollY = 0;
      this.spectatorCameraScrollX = 0;
      this.spectatorCameraScrollY = 0;
      resetWorldCameraBase(scene);
      this.holdFollowFocus();
      return;
    }

    if (spectator) {
      this.syncFocusZoom(1);
      const spectatorInput = this.input.getSpectatorCameraInput();
      this.spectatorCameraScrollX = advanceSpectatorCameraScroll({
        currentScrollX: this.spectatorCameraScrollX,
        deltaMs,
        moveLeft: spectatorInput?.left === true,
        moveRight: spectatorInput?.right === true,
        arenaWidth,
        viewportWidth: ARENA_VIEWPORT_WIDTH,
      });
      this.spectatorCameraScrollY = advanceSpectatorCameraScroll({
        currentScrollX: this.spectatorCameraScrollY,
        deltaMs,
        moveLeft: spectatorInput?.up === true,
        moveRight: spectatorInput?.down === true,
        arenaWidth: arenaHeight,
        viewportWidth: ARENA_VIEWPORT_HEIGHT,
      });
      this.lastCameraScrollX = this.spectatorCameraScrollX;
      this.lastCameraScrollY = this.spectatorCameraScrollY;
      camera.scrollX = this.spectatorCameraScrollX;
      camera.scrollY = this.spectatorCameraScrollY;
      setCameraBaseScroll(scene, this.spectatorCameraScrollX, this.spectatorCameraScrollY);
      this.holdFollowFocus();
      return;
    }

    // Laden und Countdown zeigen bereits den vorbereiteten Startpunkt der Figur.
    const alive = this.input.isLocalPlayerAlive() || this.input.isArenaLoading() || this.input.isArenaCountdownActive();
    // Ohne Figur, oder tot ohne inszenierte Todesnahaufnahme, haelt die Kamera ihren Punkt.
    const holding = !localSprite?.active || (!alive && !this.deathFocus);
    if (holding && !this.followFocusValid) this.holdFollowFocus();
    // Ein inszenierter Fokus (Boss-Intro) blendet das Spielerziel weich zu seinem Punkt über.
    const focus = holding || !alive || this.input.isArenaLoading() ? null : getCameraFocusOverride(scene);
    let followX = this.followFocusX, followY = this.followFocusY;
    if (!holding && localSprite) {
      const target = !alive && this.deathFocus ? this.deathFocus : localSprite;
      const focusWeight = focus?.weight ?? 0;
      followX = focus ? Phaser.Math.Linear(target.x, focus.x, focusWeight) : target.x;
      followY = focus ? Phaser.Math.Linear(target.y, focus.y, focusWeight) : target.y;
    }

    const maxScrollX = Math.max(0, ARENA_MAX_X - (ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH));
    const maxScrollY = Math.max(0, ARENA_MAX_Y - (ARENA_OFFSET_Y + ARENA_VIEWPORT_HEIGHT));
    const focusScreenX = ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH * 0.5;
    const focusScreenY = ARENA_OFFSET_Y + ARENA_VIEWPORT_HEIGHT * 0.5;
    // Die Kamera hat ihren Ursprung oben links; unter Zoom zeigt Bildschirmpunkt s die Welt bei
    // scroll + s / zoom. Ziel und Klemmung rechnen deshalb im gezoomten Sichtfeld.
    const zoom = this.syncFocusZoom(Math.max(resolveCameraFocusZoom(focus), requestedZoom));
    const minScrollX = ARENA_OFFSET_X * (1 - 1 / zoom);
    const minScrollY = ARENA_OFFSET_Y * (1 - 1 / zoom);
    const zoomedMaxScrollX = zoom > 1 ? Math.max(minScrollX, ARENA_MAX_X - (ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH) / zoom) : maxScrollX;
    const zoomedMaxScrollY = zoom > 1 ? Math.max(minScrollY, ARENA_MAX_Y - (ARENA_OFFSET_Y + ARENA_VIEWPORT_HEIGHT) / zoom) : maxScrollY;
    // The first local spawn is already known during loading; snap once so the startup working
    // set is not invalidated by a camera glide while the barrier is being evaluated. A spawn
    // close-up cuts onto the figure. Otherwise the followed point glides; the view is then
    // derived exactly, so any zoom change (staged or by wheel) and its clamp stay one motion.
    const followLerp = this.input.isArenaLoading() || spawn.cut || !this.followFocusValid ? 1 : 1 - Math.exp(-deltaMs / 120);
    this.followFocusX = Phaser.Math.Linear(this.followFocusX, followX, followLerp);
    this.followFocusY = Phaser.Math.Linear(this.followFocusY, followY, followLerp);
    this.followFocusValid = true;
    this.lastCameraScrollX = Phaser.Math.Clamp(this.followFocusX - focusScreenX / zoom, minScrollX, zoomedMaxScrollX);
    this.lastCameraScrollY = Phaser.Math.Clamp(this.followFocusY - focusScreenY / zoom, minScrollY, zoomedMaxScrollY);
    camera.scrollX = this.lastCameraScrollX;
    camera.scrollY = this.lastCameraScrollY;
    setCameraBaseScroll(scene, this.lastCameraScrollX, this.lastCameraScrollY);
  }

  /** Der gezeigte Punkt wird die Mitte des aktuellen Ausschnitts; eine spaetere Verfolgung setzt dort an. */
  private holdFollowFocus(): void {
    this.followFocusX = this.lastCameraScrollX + (ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH * 0.5) / this.focusZoomFactor;
    this.followFocusY = this.lastCameraScrollY + (ARENA_OFFSET_Y + ARENA_VIEWPORT_HEIGHT * 0.5) / this.focusZoomFactor;
    this.followFocusValid = true;
  }

  /**
   * Multipliziert den Designzoom der Hauptkamera mit `factor` und gibt den angewandten Faktor
   * zurueck. Lichtkarte und andere bildschirmfeste Ebenen skalieren um denselben Ursprung (0,0)
   * mit und bleiben deshalb deckungsgleich. Waehrend des Zooms klemmt die Verfolgung selbst;
   * Phasers Bounds sind auf den Designzoom zugeschnitten und werden so lange ausgesetzt.
   */
  private syncFocusZoom(factor: number): number {
    const zoom = factor > 1.0005 ? factor : 1;
    if (zoom !== this.focusZoomFactor) {
      this.focusZoomFactor = zoom;
      setAppliedStagedZoom(this.input.scene, zoom);
    }
    if (zoom === 1 && !this.focusZoomApplied) return 1;
    const scene = this.input.scene;
    const camera = scene.cameras.main;
    camera.setZoom(scene.scale.width / GAME_WIDTH * zoom, scene.scale.height / GAME_HEIGHT * zoom);
    if (zoom > 1 && !this.focusZoomApplied) {
      this.focusZoomBoundsWereUsed = camera.useBounds;
      camera.useBounds = false;
    } else if (zoom === 1 && this.focusZoomApplied) {
      camera.useBounds = this.focusZoomBoundsWereUsed;
    }
    this.focusZoomApplied = zoom > 1;
    return zoom;
  }

  /**
   * Fuehrt die Inszenierung von Spawn und Tod der eigenen Figur. Jede neu darstellbare lebende
   * Figur ist ein Spawn: der erste nach dem Ladeschleier (gehalten, bis der Countdown endet), jeder
   * Respawn und der Eintritt in eine Runden-World. Faellt die Figur, faehrt die Kamera an die
   * Stelle heran bis auf das Zoomniveau, mit dem der Respawn beginnt. Die LobbyWorld inszeniert
   * nichts. `cut` meldet den Frame, in dem die Kamera auf die Figur springt.
   */
  private syncSpawnZoom(enabled: boolean, localSprite: Phaser.GameObjects.Sprite | null): { factor: number; cut: boolean } {
    const staged = enabled && this.input.stagesLocalSpawn !== false && !this.input.isArenaLoading()
      && !this.input.isLoadingVeilShown?.() && !!localSprite?.active;
    if (!staged || !localSprite) {
      this.spawnZoom.cancel();
      this.spawnZoomSprite = null;
      this.deathFocus = null;
      return { factor: 1, cut: false };
    }
    const now = this.input.scene.time.now;
    const countdown = this.input.isArenaCountdownActive();
    if (!countdown && !this.input.isLocalPlayerAlive()) {
      // Nur eine Figur, die hier lebte, faellt sichtbar; wer tot beitritt, wartet ohne Fahrt.
      if (this.spawnZoomSprite && !this.deathFocus) {
        this.deathFocus = { x: localSprite.x, y: localSprite.y };
        this.spawnZoom.death(now);
      }
      this.spawnZoomSprite = null;
      return { factor: this.deathFocus ? this.spawnZoom.sample(now) : 1, cut: false };
    }
    let cut = false;
    if (localSprite !== this.spawnZoomSprite) {
      this.spawnZoomSprite = localSprite;
      this.deathFocus = null;
      this.spawnZoom.begin(now, countdown);
      cut = true;
    } else if (!countdown && this.spawnZoom.holding) {
      this.spawnZoom.release(now);
    }
    return { factor: this.spawnZoom.sample(now), cut };
  }

  /**
   * Gleicht die residenten Render-Chunks dieser World an den sichtbaren Ausschnitt an. Gehoert
   * in den Arena-Update-Pfad, direkt nachdem die Kamera ihren finalen Scroll fuer diesen
   * Zeitpunkt hat (siehe `syncCamera`), mit Sicherheitsrand vor dem spaeteren Kamera-Feedback.
   *
   * Laeuft auch verdeckt waehrend des Ladens der lokalen Presentation. Ohne Presentation bleibt der
   * zuletzt residente Stand unangetastet stehen, die Welt verschwindet also nicht, sie waechst
   * nur nicht mit. Nach `destroy()` wirkungslos.
   */
  syncSurfaceResidency(showWorld: boolean, deltaMs = 0, enemies: WildlifeEnemySource | null = null): void {
    if (this.destroyed) return;
    this.syncSunlight();
    const fog = this.prepareGroundFog();
    if (fog) {
      const quality = getGraphicsQualityController(this.input.scene);
      fog.enabled = quality?.getGroundFogEnabled() ?? true; fog.quality = quality?.getLevel() ?? 'high';
      fog.setSurfaceStamps([...this.input.getFogSurfaceStamps()]);
      fog.setRockCoverage(this.input.getArenaResult()?.rockVisualSystem?.getFormationCoverage ?? null);
      this.input.getArenaResult()?.rockVisualSystem?.flush();
      fog.prepare(this.input.lighting.getTimeOfDayMinutes(), getVisibleWorldView(this.input.scene.cameras.main));
    }
    if (!showWorld) {
      this.input.getArenaResult()?.wildlife?.clearLights();
      return;
    }
    const worldView = getVisibleWorldView(this.input.scene.cameras.main);
    const residencyView = this.resolveResidencyView(worldView);
    this.input.getArenaResult()?.waterSurface?.prepareMasks();
    ArenaBuilder.updateSurfaceResidency(this.input.getArenaResult(), residencyView);
    const wildlife = this.input.getArenaResult()?.wildlife;
    if (wildlife) {
      this.collectWildlifeMovers(worldView, enemies);
      wildlife.update(deltaMs, this.wildlifeMovers, worldView,
        this.input.lighting.getTimeOfDayMinutes(), this.input.lighting, this.input.wildlifeAudio);
    }
    this.input.shadow.updateStaticResidency(residencyView);
  }

  /**
   * Waehrend einer Nahaufnahme bleibt die Spielansicht um dieselbe Mitte resident: Das
   * Herausfahren deckt dann fertig gebackene Flaechen auf, statt sie an den Raendern nachzuladen.
   */
  private resolveResidencyView(view: WorldViewRect): WorldViewRect {
    const zoom = this.focusZoomFactor;
    if (zoom <= 1) return view;
    const width = view.width * zoom, height = view.height * zoom;
    const x = view.centerX - width * 0.5, y = view.centerY - height * 0.5;
    return { ...view, x, y, width, height, right: x + width, bottom: y + height } as WorldViewRect;
  }

  /** Reconcile local terrain before preparation or simulation of this World. */
  private prepareGroundFog(): GroundFogSystem | null {
    const input = this.input.groundFog, fog = input?.getSystem() ?? null;
    const arena = this.input.getArenaResult(), layout = this.input.getWorldLayout();
    if (fog && input && arena && layout) {
      if (this.fogBinding?.fog !== fog) {
        this.fogBinding?.destroy();
        this.fogBinding = new WorldGroundFogBinding(this.input.scene, fog, layout, arena, input.effects);
      }
      this.fogBinding.sync(this.input.constructionOwnership?.getPlacement() ?? null, input.getBases(), input.getProjectiles());
    }
    return fog;
  }

  /** Displayed players first, then enemies near the view, up to the wildlife's mover capacity. */
  private collectWildlifeMovers(view: WorldViewRect, enemies: WildlifeEnemySource | null): void {
    this.wildlifeMovers.length = 0;
    for (const player of this.input.getPlayers()) {
      const sprite = player.displayObject;
      if (player.active && sprite?.visible && sprite.alpha > .1) this.pushWildlifeMover(player.id, sprite.x, sprite.y, 0);
    }
    if (!enemies) return;
    this.wildlifeView = view;
    enemies.forEachEnemy(this.collectWildlifeEnemy);
    this.wildlifeView = null;
  }

  private pushWildlifeMover(id: string, x: number, y: number, radius: number): void {
    const index = this.wildlifeMovers.length;
    if (index >= AMBIENT_WILDLIFE.disturbance.moverCapacity) return;
    const mover = this.wildlifeMoverPool[index] ??= { id: '', x: 0, y: 0, radius: 0 };
    mover.id = id; mover.x = x; mover.y = y; mover.radius = radius;
    this.wildlifeMovers.push(mover);
  }

  /** Runs after host/client pose presentation; independent of footprint budgets. */
  syncGroundFog(deltaMs: number, showWorld: boolean, enemies: readonly MovementVisualSource[]): void {
    if (this.destroyed) return;
    this.presentationTimeMs+=Math.max(0,deltaMs);
    this.input.clientWorldPresentation.powerUp.updatePresentation(this.presentationTimeMs);
    this.syncSunlight();
    const fog = this.prepareGroundFog();
    if (!fog) { this.sunlightOwner?.setFogAir(null); this.sunlightOwner?.setFogShape(null); return; }
    this.syncActivityFogStrength(fog);
    const quality = getGraphicsQualityController(this.input.scene);
    fog.enabled = quality?.getGroundFogEnabled() ?? true; fog.quality = quality?.getLevel() ?? 'high';
    const view = getVisibleWorldView(this.input.scene.cameras.main);
    fog.captureMotion(deltaMs, showWorld ? this.input.getPlayers() : [], showWorld ? enemies : [], view);
    const trainRenderer = showWorld ? this.input.getTrainVisual() : null;
    const train = trainRenderer?.getShadowState() ?? null;
    fog.captureTrain(deltaMs, train, train && trainRenderer ? trainRenderer.computeSegYs(train.y, train.dir) : []);
    fog.setSurfaceStamps([...this.input.getFogSurfaceStamps()]);
    fog.setRockCoverage(this.input.getArenaResult()?.rockVisualSystem?.getFormationCoverage ?? null);
    // Publish dirty geometry/GPU repair before the fog samples the borrowed field.
    this.input.getArenaResult()?.rockVisualSystem?.flush();
    fog.update(deltaMs, this.input.lighting.getTimeOfDayMinutes(), view, showWorld);
    // The void motes borrow the air only after the step: it swaps textures and may release them.
    this.sunlightOwner?.setFogAir(fog.getAirBinding());
    this.sunlightOwner?.setFogShape(fog.getShapeBinding());
  }

  private activityFogBaseline: { fog: GroundFogSystem; strength: number } | null = null;

  private syncActivityFogStrength(fog: GroundFogSystem): void {
    fog.setTint(this.input.groundFog?.getActivityTint?.() ?? null);
    const strength = this.input.groundFog?.getActivityStrength?.();
    if (this.activityFogBaseline && (strength === undefined || this.activityFogBaseline.fog !== fog)) {
      this.activityFogBaseline.fog.strength = this.activityFogBaseline.strength;
      this.activityFogBaseline = null;
    }
    if (strength !== undefined) {
      this.activityFogBaseline ??= { fog, strength: fog.strength };
      fog.strength = strength;
    }
  }

  /** Shot feedback observes only this World's displayed players and ends before handoff. */
  notifyWildlifeShot(shooterId: string): void {
    if (this.destroyed || !this.input.getLocalWorldPresentation().required) return;
    const player = this.input.getPlayers().find(p => p.id === shooterId);
    const sprite = player?.displayObject;
    if (player?.active && sprite?.visible && sprite.alpha > .1)
      this.input.getArenaResult()?.wildlife?.notifyImpulse('shot', sprite.x, sprite.y);
  }

  /** Projiziert den allgemeinen replizierten World-Zustand fuer Clients, auch ohne Activity. */
  syncClientWorldPresentation(
    state: WorldClientPresentationState | undefined,
    delta: number,
    countdownActive: boolean,
    countdownGround: SyncedBurningGroundSnapshot,
    countdownPedestals: SyncedPowerUpPedestal[],
  ): void {
    if (this.destroyed || !this.input.getLocalWorldPresentation().required) return;
    const renderers = this.input.clientWorldPresentation;
    const train = renderers.getTrain();
    const now = this.input.getSynchronizedNow();

    if (state) {
      this.input.burrowEffects?.syncEarthbreak(state.earthbreak ?? [], now);
      renderers.timeBubble.syncVisuals(state.timeBubbles);
      renderers.teslaDome.syncVisuals(state.teslaDomes, this);
      renderers.energyShield.syncVisuals(state.energyShields);
      renderers.guardianSpirit.syncVisuals(state.guardianSpirits);
      renderers.repairDrone.syncVisuals(state.repairDrones, state.placeableRocks);
      renderers.attackDrone?.syncVisuals(state.attackDrones ?? [], state.attackDroneBombs ?? [], state.placeableRocks, now);
      this.latestBeeSwarms = state.beeSwarms ?? [];
      renderers.slimeTrail.syncVisuals(state.slimeTrail);
      renderers.flamethrowerUpgrades.syncGround(
        countdownActive && state.burningGround.cells.length === 0
          ? countdownGround
          : state.burningGround,
        now,
      );
      renderers.flamethrowerUpgrades.syncRings(state.players);
      train?.setTarget(state.train);
      renderers.powerUp.syncPedestals(
        countdownActive && state.pedestals.length === 0
          ? countdownPedestals
          : state.pedestals,
      );
      renderers.powerUp.sync(state.powerups);
      renderers.nuke.sync(state.nukes);
      renderers.airstrike.sync(state.airstrikes, now);
      renderers.meteor.sync(state.meteors, now);
    } else if (countdownActive) {
      renderers.flamethrowerUpgrades.syncGround(countdownGround, now);
      renderers.powerUp.syncPedestals(countdownPedestals);
      renderers.powerUp.sync([]);
    }

    renderers.powerUp.updatePedestals(now);
    train?.render(1 - Math.exp(-delta / NET_SMOOTH_TIME_MS));
  }

  private renderGeneration = 0;
  private releaseView: string | null = null;
  private releasedView: string | null = null;
  private releaseListener: (() => void) | null = null;
  private sceneRenderListener: (() => void) | null = null;
  private lightingPublished = false;
  private canopyPublished = false;

  private renderViewKey(view: WorldViewRect): string {
    return `${view.x},${view.y},${view.width},${view.height}`;
  }

  private cancelRenderRelease(): void {
    this.renderGeneration++;
    if (this.releaseListener) this.input.scene.game.events.off(Phaser.Core.Events.POST_RENDER, this.releaseListener);
    if (this.sceneRenderListener) this.input.scene.events.off(Phaser.Scenes.Events.RENDER, this.sceneRenderListener);
    this.releaseListener = null;
    this.sceneRenderListener = null;
    this.releaseView = null;
  }

  /** Fatal preparation is observed by the World owner, never acted on by a render/read query. */
  getPreparationError(): string | null {
    if (this.destroyed) return null;
    return this.input.getArenaResult()?.rockVisualSystem?.getPreparationState().error ?? null;
  }

  /** One local World gate shared by boot reveal and replicated World readiness.
   * Two actual renders let dependent receivers consume the last published worker/mask result.
   * No timer, Round resource or callback can survive this active World owner. */
  getWorldRenderWork(view: WorldViewRect): WorldPresentationRenderWork {
    const work = this.collectWorldRenderWork(view);
    const key = this.renderViewKey(view);
    if (!work.renderReady) {
      this.cancelRenderRelease();
      this.releasedView = null;
    } else if (this.releasedView !== key && this.releaseView !== key) {
      this.cancelRenderRelease();
      this.releasedView = null;
      this.releaseView = key;
      const generation = this.renderGeneration;
      let frames = 0, sceneRendered = false;
      this.sceneRenderListener = () => { sceneRendered = true; };
      this.releaseListener = () => {
        if (this.destroyed || generation !== this.renderGeneration) return;
        const currentView = getVisibleWorldView(this.input.scene.cameras.main);
        if (this.renderViewKey(currentView) !== key || !this.collectWorldRenderWork(currentView).renderReady) {
          this.cancelRenderRelease();
          return;
        }
        if (!sceneRendered) return;
        sceneRendered = false;
        if (++frames < 2) return;
        this.cancelRenderRelease();
        this.releasedView = key;
      };
      this.input.scene.events.on(Phaser.Scenes.Events.RENDER, this.sceneRenderListener);
      this.input.scene.game.events.on(Phaser.Core.Events.POST_RENDER, this.releaseListener);
    }
    const renderReady = work.renderReady && this.releasedView === key;
    loadingTimeline.get('world')?.gate('final-world-frame', renderReady);
    return { ...work, pending: work.pending + (work.renderReady && !renderReady ? 1 : 0), renderReady };
  }

  /** CPU/GPU publications for the start view plus each surface's residency halo. */
  private collectWorldRenderWork(view: WorldViewRect): WorldPresentationRenderWork {
    if (this.destroyed) return { pending: 0, resident: 0, renderReady: false };
    const arenaResult = this.input.getArenaResult();
    const groundWork = arenaResult?.groundSurface?.getWorkingSet(view, true) ?? null;
    const rockOverlayWork = arenaResult?.rockOverlaySurface?.getWorkingSet(view, true) ?? null;
    const shadowWork = this.input.shadow.getStaticSurfaceWorkingSet(view, true);
    const waterWork = arenaResult?.waterSurface?.getPreparationState();
    const rockWork = arenaResult?.rockVisualSystem?.getPreparationState();
    const sunlightReady = this.sunlightOwner?.isPrepared() ?? true;
    const framePublished = this.lightingPublished && this.canopyPublished;
    const run = loadingTimeline.get('world');
    if (run && run.endedAt === null) {
      run.gate('ground-chunks', groundWork?.ready === true);
      run.gate('rock-overlay-chunks', rockOverlayWork?.ready === true);
      run.gate('shadow-chunks', shadowWork?.ready === true);
      run.gate('water-masks', !arenaResult?.waterSurface || arenaResult.waterSurface.isPrepared());
      run.gate('fog-field', this.input.groundFog?.getSystem()?.getDiagnostics().status !== 'preparing');
      run.gate('rock-formation-publication', rockWork?.ready ?? true);
      run.gate('sun-vegetation-publication', sunlightReady);
      run.gate('lightmap-canopy-publication', framePublished);
    }
    return {
      pending: (groundWork?.pendingWork ?? 0)
        + (rockOverlayWork?.pendingWork ?? 0)
        + (shadowWork?.pendingWork ?? 0)
        + (waterWork?.pending ?? 0) + (rockWork?.pending ?? 0)
        + (sunlightReady ? 0 : 1) + (framePublished ? 0 : 1),
      resident: (groundWork?.residentChunks ?? 0)
        + (rockOverlayWork?.residentChunks ?? 0)
        + (shadowWork?.residentChunks ?? 0)
        + (waterWork?.completed ?? 0) + (rockWork?.resident ?? 0),
      // Surface-Readiness bleibt die Authority; Working-Set-Daten liefern nur den
      // view-bezogenen Fortschritt.
      renderReady: ArenaBuilder.isSurfaceWorkingSetReady(arenaResult, view)
        && (rockWork?.ready ?? true) && sunlightReady && framePublished
        && this.input.shadow.isStaticReadyForView(view, true)
        && this.input.groundFog?.getSystem()?.getDiagnostics().status !== 'preparing',
    };
  }

  /** Aktualisiert die Transparenz der World-Kronen ueber dem lokalen World-Sprite. */
  syncCanopyTransparency(showWorld: boolean): void {
    if (this.destroyed || !showWorld) return;
    const arenaResult = this.input.getArenaResult();
    if (!arenaResult) return;
    ArenaBuilder.updateCanopyTransparency(
      arenaResult.canopyObjects,
      this.input.getLocalPlayerSprite(),
      (worldX, worldY) => this.input.lighting.resolveCanopyTint(worldX, worldY),
    );
    this.canopyPublished = true;
  }

  /** World-lokale Spieler-HUD-Darstellung; Bars bleiben ausserhalb des Arena-Feldes sichtbar. */
  syncLocalPlayerPresentation(showWorld: boolean, spectator: boolean): void {
    if (this.destroyed) return;
    const localPlayerVisuals = allowsWorldPresentationSurface(
      this.input.getLocalWorldPresentation(),
      'localPlayerVisuals',
    ) && this.input.isLocalPlayerAttachedToWorld();
    this.input.setLocalPlayerStatusRingActive(localPlayerVisuals && !spectator);
    this.input.setLocalPlayerWorldBarsVisible(!showWorld);
    const player = showWorld && localPlayerVisuals && !spectator ? this.input.getLocalPlayerSprite() : null;
    this.input.getLobbyStructures?.()?.update(player?.active ? player : null,
      this.input.getLobbyInteractionMenu?.() ?? null, showWorld ? this.input.lighting : null, this.input.shadow);
  }

  /** World-lokale Gravel-/Baustellenprojektion der persistenten Basis. */
  syncPersistentBasePresentation(showWorld: boolean, spectator: boolean): void {
    if (this.destroyed) return;
    const arenaResult = this.input.getArenaResult();
    const layout = this.input.getWorldLayout();
    const visualSite = showWorld ? this.input.getPersistentBaseVisualSite() : null;
    const gravel = visualSite && layout ? toPersistentBaseGravelZone(visualSite, layout.seed) : null;
    arenaResult?.groundSurface?.setPersistentBaseGravel(gravel);
    this.input.getBases?.()?.setPersistentBaseGravel(gravel);
    this.input.persistentBaseVisuals.sync(
      showWorld ? this.input.getPersistentBaseSite() : null,
      showWorld ? this.input.getWorldMetrics() : null,
      showWorld
        && !spectator
        && this.input.isPersistentBasePlacementOverlayActive(),
    );
  }

  /** Merkt einen Uhrzeitwechsel fuer den naechsten statischen Shadow-Bake vor. */
  requestStaticShadowBake(force: boolean): void {
    if (this.destroyed || !force) return;
    this.forceStaticShadowBake = true;
  }

  /** Debug-Uhrzeit: derselbe statische Profil-Sync wie im regulären World-Frame. */
  syncStaticShadowProfile(force: boolean): void {
    if (this.destroyed) return;
    this.input.shadow.syncStaticProfile(this.input.getSynchronizedNow(), force);
  }

  /** Synchronisiert die statischen und dynamischen World-Schatten. */
  syncWorldShadows(shadowArenaActive: boolean, inRoundWorld: boolean): void {
    if (this.destroyed) return;
    const layout = this.input.getWorldLayout();
    const arenaResult = this.input.getArenaResult();
    if (!shadowArenaActive || !layout || !arenaResult) {
      this.forceStaticShadowBake = false;
      this.input.shadow.clear();
      return;
    }

    this.input.shadow.syncBaseShadows(this.input.getBaseShadowCells());
    this.input.shadow.syncStructureReceiverRects(this.input.getStructureRects());
    this.input.shadow.syncReactivePropShadows(this.reactivePropShadowCells());
    this.input.shadow.syncStaticProfile(
      this.input.getSynchronizedNow(),
      this.forceStaticShadowBake,
    );
    this.forceStaticShadowBake = false;
    this.input.shadow.syncDynamicShadows(
      this.input.getPlayers(),
      this.input.getProjectileShadowSamples(),
      inRoundWorld ? this.input.getTrainState(true) : null,
    );
  }

  /** Synchronisiert World-Lichtquellen und komponiert die aktuelle Lightmap. */
  syncWorldLighting(inArena: boolean, inRoundWorld: boolean): void {
    if (this.destroyed) return;
    this.syncFireControl(inArena);
    this.syncBomberSquadron(inArena);
    this.syncReactiveProps(inArena);
    const lighting = this.input.lighting;
    const artificialFactor = inArena ? lighting.getArtificialLightFactor() : 0;
    const artificialLights = artificialFactor > 0;
    const trainState = inRoundWorld ? this.input.getTrainState(true) : null;
    const liveTrainSegments = trainState?.alive
      ? this.input.getLiveTrainSegments(true)
      : null;
    this.trainLightOccluders.setTrain(liveTrainSegments, trainState);

    this.syncTrainLights(artificialLights, artificialFactor, trainState);

    if (artificialLights) {
      for (const player of this.input.getPlayers()) {
        const key = `flashlight:${player.id}`;
        const sprite = player.displayObject;
        const burrowPhase = player.getBurrowPhase();
        // Exakt dieselben Sichtbarkeitsbedingungen wie beim dynamischen Schatten: wer
        // nicht sichtbar auf dem Feld steht, leuchtet auch nicht.
        const visible = sprite !== null
          && sprite.active
          && sprite.visible
          && !player.isDecoyStealthedVisual()
          && burrowPhase !== 'underground'
          && burrowPhase !== 'trapped';

        const spillKey = `flashlightspill:${player.id}`;
        if (!visible) {
          lighting.releaseLight(key);
          lighting.releaseLight(spillKey);
          continue;
        }
        lighting.setLight(key, 'flashlight', sprite.x, sprite.y, {
          angle: player.getAimAngle(),
          intensity: LIGHT_PRESETS.flashlight.intensity * artificialFactor,
        });
        lighting.setLight(spillKey, 'flashlightSpill', sprite.x, sprite.y, {
          intensity: LIGHT_PRESETS.flashlightSpill.intensity * artificialFactor,
        });
      }
      this.flashlightsActive = true;
    } else if (this.flashlightsActive) {
      // Ausdrueckliche Freigabe blendet die vorherigen World-Lampen sauber aus.
      for (const player of this.input.getPlayers()) {
        lighting.releaseLight(`flashlight:${player.id}`);
        lighting.releaseLight(`flashlightspill:${player.id}`);
      }
      this.flashlightsActive = false;
    }

    this.syncProjectileLights(inArena);
    this.input.syncTurretLights(inArena);
    this.input.syncBaseLights(inArena);
    this.input.persistentBasePreview.syncLights(inArena);
    lighting.update();
    // Lighting.update synchronously refreshes the World occluder index and submits the lightmap.
    this.lightingPublished = true;
  }

  /**
   * Idempotent; loest die aktiven HP-Bindings und Light-Occluder dieser World vor dem Handoff.
   * Danach sind alle Methoden wirkungslos. `camera.scrollX/Y` bleibt unveraendert stehen;
   * der erste Frame der naechsten World ueberschreibt ihn ueber `syncCamera()`.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Eine laufende Nahaufnahme (Spawn, Boss-Intro) darf nicht in die naechste World ueberlaufen.
    const camera = this.focusZoomApplied ? this.input.scene.cameras?.main : null;
    if (camera) {
      camera.setZoom(this.input.scene.scale.width / GAME_WIDTH, this.input.scene.scale.height / GAME_HEIGHT);
      camera.useBounds = this.focusZoomBoundsWereUsed;
    }
    this.focusZoomApplied = false;
    if (this.focusZoomFactor !== 1) setAppliedStagedZoom(this.input.scene, 1);
    this.focusZoomFactor = 1;
    this.spawnZoom.cancel();
    this.deathFocus = null;
    if (this.activityFogBaseline) {
      this.activityFogBaseline.fog.strength = this.activityFogBaseline.strength;
      this.activityFogBaseline = null;
    }
    this.input.getLobbyStructures?.()?.update(null);
    this.releaseFireControlCopyShots?.(); this.releaseFireControlCopyShots = null;
    this.fireControl?.destroy(); this.fireControl = null;
    this.fireControlPorts = null;
    this.bomberSquadron?.destroy(); this.bomberSquadron = null;
    this.bomberSquadronSnapshot = null; this.bomberSquadronEffects = null;
    this.reactivePropRenderer?.destroy(); this.reactivePropRenderer = null;
    this.beeSwarmRenderer?.destroy(); this.beeSwarmRenderer = null; this.beeSwarmPorts = null;
    this.reactiveProps = null; this.reactivePropBurnGpu = null; this.reactivePropZoneSink = null;
    this.cancelRenderRelease();
    this.releasedView = null;
    this.sunlightOwner?.destroy();this.sunlightOwner=null;
    this.fogBinding?.destroy(); this.fogBinding = null;
    this.releaseWildlifeExplosions?.();
    this.wildlifeMovers.length = 0;
    this.input.getArenaResult()?.wildlife?.clearLights();
    this.clearConstructionOwnership();
    if (this.input.healthBarScope) this.input.healthBars?.closeWorld(this.input.healthBarScope);
    this.input.movementEffects?.closeWorld(this);
    this.input.burrowEffects?.closeWorld(this);
    this.input.enemyEyes?.closeWorld(this);
    this.trainLightOccluders.clear();
    this.input.lighting.clearDynamicOccluderSource(this.trainLightOccluders);
  }

  private forceStaticShadowBake = false;
  private trainLightPlan: TrainLightPlan | null = null;
  private trainLightsActive = false;
  private readonly trainLightOccluders = new TrainLightOccluderSource();
  private flashlightsActive = false;
  private activeProjectileLightIds = new Set<number>();
  private projectileLightScratch = new Set<number>();

  private syncProjectileLights(inArena: boolean): void {
    const lighting = this.input.lighting;
    const active = this.activeProjectileLightIds;
    if (!inArena) {
      for (const id of active) lighting.releaseLight(`proj:${id}`);
      active.clear();
      return;
    }

    const seen = this.projectileLightScratch;
    seen.clear();
    for (const sample of this.input.getProjectileLightSamples()) {
      const spec = getProjectileLightSpec(
        sample.style,
        sample.energyBallVariant,
        sample.grenadeVisualPreset,
        sample.color,
      );
      if (!spec) continue;
      lighting.setLight(`proj:${sample.id}`, spec.preset, sample.x, sample.y, {
        radiusPx: spec.baseRadiusPx + sample.size * spec.radiusPerSizePx,
        color: spec.whitenFromColor === undefined
          ? undefined
          : mixColors(sample.color, 0xffffff, spec.whitenFromColor),
      });
      seen.add(sample.id);
    }
    for (const id of active) {
      if (!seen.has(id)) lighting.releaseLight(`proj:${id}`);
    }
    this.activeProjectileLightIds = seen;
    this.projectileLightScratch = active;
  }

  private syncTrainLights(
    artificialLights: boolean,
    artificialFactor: number,
    trainState: SyncedTrainState | null,
  ): void {
    const lighting = this.input.lighting;
    const trainRenderer = this.input.getTrainVisual();
    const train = artificialLights ? trainState : null;
    if (!train?.alive || !trainRenderer) {
      if (this.trainLightsActive) {
        const plan = this.getTrainLightPlan();
        for (const lamp of plan.headlights) lighting.releaseLight(lamp.key);
        for (const lamp of plan.windows) lighting.releaseLight(lamp.key);
        this.trainLightsActive = false;
      }
      return;
    }

    const segmentYs = trainRenderer.computeSegYs(train.y, train.dir);
    const beamAngle = train.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
    const noseY = segmentYs[0] + train.dir * TRAIN.HEADLIGHT_OFFSET_Y;
    const plan = this.getTrainLightPlan();
    for (const lamp of plan.headlights) {
      lighting.setLight(lamp.key, 'trainHeadlight', train.x + lamp.offsetX, noseY, {
        angle: beamAngle,
        intensity: LIGHT_PRESETS.trainHeadlight.intensity * artificialFactor,
      });
    }
    for (const lamp of plan.windows) {
      const offsetY = lamp.frontRelative ? train.dir * lamp.offsetY : lamp.offsetY;
      lighting.setLight(
        lamp.key,
        'trainWindow',
        train.x + lamp.offsetX,
        segmentYs[lamp.segment] + offsetY,
        { intensity: LIGHT_PRESETS.trainWindow.intensity * artificialFactor },
      );
    }
    this.trainLightsActive = true;
  }

  private getTrainLightPlan(): TrainLightPlan {
    if (this.trainLightPlan) return this.trainLightPlan;
    const headlights: TrainLamp[] = [];
    const windows: TrainLamp[] = [];
    for (const side of TRAIN_LIGHT_SIDES) {
      headlights.push({
        key: `trainheadlight:${side}`,
        offsetX: side * TRAIN.HEADLIGHT_OFFSET_X,
        offsetY: 0,
        segment: 0,
      });
      windows.push({
        key: `trainlocowindow:${side}`,
        offsetX: side * TRAIN.LOCO_WINDOW_LIGHT_OFFSET_X,
        offsetY: TRAIN.LOCO_WINDOW_LIGHT_OFFSET_Y,
        segment: 0,
        frontRelative: true,
      });
      for (let wagon = 1; wagon <= TRAIN.WAGON_COUNT; wagon += 1) {
        for (let slot = 0; slot < TRAIN.WINDOW_LIGHT_OFFSETS_Y.length; slot += 1) {
          windows.push({
            key: `trainwindow:${wagon}:${side}:${slot}`,
            offsetX: side * TRAIN.WINDOW_LIGHT_OFFSET_X,
            offsetY: TRAIN.WINDOW_LIGHT_OFFSETS_Y[slot],
            segment: wagon,
          });
        }
      }
    }
    this.trainLightPlan = { headlights, windows };
    return this.trainLightPlan;
  }
}

interface TrainLamp {
  readonly key: string;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly segment: number;
  readonly frontRelative?: boolean;
}

interface TrainLightPlan {
  readonly headlights: readonly TrainLamp[];
  readonly windows: readonly TrainLamp[];
}
