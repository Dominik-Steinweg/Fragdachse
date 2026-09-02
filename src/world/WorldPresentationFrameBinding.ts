import * as Phaser from 'phaser';
import { ArenaBuilder, type ArenaBuilderResult } from '../arena/ArenaBuilder';
import {
  ACTIVE_ARENA_METRICS_PROFILE,
  ARENA_MAX_X, ARENA_MAX_Y, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_VIEWPORT_HEIGHT, ARENA_VIEWPORT_WIDTH,
} from '../config';
import { setCameraBaseScroll } from '../graphics/cameraBaseScroll';
import type { ArenaSpectatorCameraInput } from '../scenes/arena/ArenaInputBindings';
import { advanceSpectatorCameraScroll } from '../scenes/arena/SpectatorCameraModel';
import { getVisibleWorldView, type WorldViewRect } from '../ui/HostileBaseIndicator';
import { allowsWorldPresentationSurface, type WorldPresentationRequirement } from './WorldPresentation';
import type { ArenaLayout, SyncedTrainState } from '../types';
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
import type { WorldPersistentBaseSite } from './WorldRuntimeContext';
import {
  toPersistentBaseGravelZone,
  type PersistentBaseVisualSite,
} from '../persistentBase/PersistentBasePresentation';

const TRAIN_LIGHT_SIDES = [-1, 1] as const;

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
export interface WorldPresentationFrameBindingInput {
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
  /** Der gebaute World-Zustand, dessen residente Render-Chunks der Residency-Sync angleicht. */
  readonly getArenaResult: () => ArenaBuilderResult | null;
  /** Statische/dynamische Schatten gehoeren zur aktiven World-Presentation. */
  readonly shadow: ShadowSystem;
  /** Lightmap und ihre World-Occluder-Verdrahtung gehoeren zur aktiven World-Presentation. */
  readonly lighting: LightingSystem;
  readonly getWorldLayout: () => ArenaLayout | null;
  readonly getWorldMetrics: () => WorldMetrics | null;
  readonly getPersistentBaseSite: () => WorldPersistentBaseSite | null;
  readonly getPersistentBaseVisualSite: () => PersistentBaseVisualSite | null;
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
  readonly getTrainVisual: () => Pick<TrainRenderer, 'computeSegYs'> | null;
  readonly syncTurretLights: (inArena: boolean) => void;
  readonly syncBaseLights: (inArena: boolean) => void;
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
  private destroyed = false;
  private lastCameraScrollX = 0;
  private lastCameraScrollY = 0;
  private spectatorCameraScrollX = 0;
  private spectatorCameraScrollY = 0;

  constructor(private readonly input: WorldPresentationFrameBindingInput) {
    this.input.lighting.setDynamicOccluderSource(this.trainLightOccluders);
  }

  isDestroyed(): boolean {
    return this.destroyed;
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
    const camera = this.input.scene.cameras.main;

    const spectator = showWorld && this.input.isLocalPlayerSpectator();
    const arenaWidth = Math.max(0, ARENA_MAX_X - ARENA_OFFSET_X);
    const arenaHeight = Math.max(0, ARENA_MAX_Y - ARENA_OFFSET_Y);
    const canSpectatorPanX = arenaWidth > ARENA_VIEWPORT_WIDTH;
    const canSpectatorPanY = arenaHeight > ARENA_VIEWPORT_HEIGHT;
    const canSpectatorPan = canSpectatorPanX || canSpectatorPanY;
    // Die Weltkamera ist World-Presentation: ohne lokale Darstellung dieser World gibt es sie
    // nicht, auch wenn die Simulation weiterlaeuft.
    const worldCamera = allowsWorldPresentationSurface(this.input.getLocalWorldPresentation(), 'worldCamera');
    if (!showWorld || !worldCamera
      || (!ACTIVE_ARENA_METRICS_PROFILE.usesDynamicCamera && !(spectator && canSpectatorPan))) {
      this.lastCameraScrollX = 0;
      this.lastCameraScrollY = 0;
      this.spectatorCameraScrollX = 0;
      this.spectatorCameraScrollY = 0;
      resetWorldCameraBase(this.input.scene);
      return;
    }

    if (spectator) {
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
      setCameraBaseScroll(this.input.scene, this.spectatorCameraScrollX, this.spectatorCameraScrollY);
      return;
    }

    const localSprite = this.input.getLocalPlayerSprite();
    const preparedStartFocus = this.input.isArenaLoading() || this.input.isArenaCountdownActive();
    if (!localSprite?.active || (!this.input.isLocalPlayerAlive() && !preparedStartFocus)) {
      camera.scrollX = this.lastCameraScrollX;
      camera.scrollY = this.lastCameraScrollY;
      setCameraBaseScroll(this.input.scene, this.lastCameraScrollX, this.lastCameraScrollY);
      return;
    }

    const maxScrollX = Math.max(0, ARENA_MAX_X - (ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH));
    const maxScrollY = Math.max(0, ARENA_MAX_Y - (ARENA_OFFSET_Y + ARENA_VIEWPORT_HEIGHT));
    const focusScreenX = ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH * 0.5;
    const focusScreenY = ARENA_OFFSET_Y + ARENA_VIEWPORT_HEIGHT * 0.5;
    const targetScrollX = Phaser.Math.Clamp(localSprite.x - focusScreenX, 0, maxScrollX);
    const targetScrollY = Phaser.Math.Clamp(localSprite.y - focusScreenY, 0, maxScrollY);
    // The first local spawn is already known during loading; snap once so the startup working
    // set is not invalidated by a camera glide while the barrier is being evaluated.
    const followLerp = this.input.isArenaLoading() ? 1 : 1 - Math.exp(-deltaMs / 120);
    this.lastCameraScrollX = Phaser.Math.Linear(this.lastCameraScrollX, targetScrollX, followLerp);
    this.lastCameraScrollY = Phaser.Math.Linear(this.lastCameraScrollY, targetScrollY, followLerp);
    camera.scrollX = this.lastCameraScrollX;
    camera.scrollY = this.lastCameraScrollY;
    setCameraBaseScroll(this.input.scene, this.lastCameraScrollX, this.lastCameraScrollY);
  }

  /**
   * Gleicht die residenten Render-Chunks dieser World an den sichtbaren Ausschnitt an. Gehoert
   * in den Arena-Update-Pfad, direkt nachdem die Kamera ihren finalen Scroll fuer diesen
   * Zeitpunkt hat (siehe `syncCamera`), mit Sicherheitsrand vor dem spaeteren Kamera-Feedback.
   *
   * Laeuft ausschliesslich, waehrend diese World dargestellt wird – ohne Darstellung bleibt der
   * zuletzt residente Stand unangetastet stehen, die Welt verschwindet also nicht, sie waechst
   * nur nicht mit. Nach `destroy()` wirkungslos.
   */
  syncSurfaceResidency(showWorld: boolean): void {
    if (this.destroyed || !showWorld) return;
    const worldView = getVisibleWorldView(this.input.scene.cameras.main);
    ArenaBuilder.updateSurfaceResidency(this.input.getArenaResult(), worldView);
    this.input.shadow.updateStaticResidency(worldView);
  }

  /** View-bezogene World-Readiness fuer Ladebarriere und Boot-Reveal. */
  getWorldRenderWork(view: WorldViewRect): WorldPresentationRenderWork {
    if (this.destroyed) return { pending: 0, resident: 0, renderReady: false };
    const arenaResult = this.input.getArenaResult();
    const groundWork = arenaResult?.groundSurface?.getWorkingSet(view, true) ?? null;
    const rockOverlayWork = arenaResult?.rockOverlaySurface?.getWorkingSet(view, true) ?? null;
    const shadowWork = this.input.shadow.getStaticSurfaceWorkingSet(view, true);
    return {
      pending: (groundWork?.pendingWork ?? 0)
        + (rockOverlayWork?.pendingWork ?? 0)
        + (shadowWork?.pendingWork ?? 0),
      resident: (groundWork?.residentChunks ?? 0)
        + (rockOverlayWork?.residentChunks ?? 0)
        + (shadowWork?.residentChunks ?? 0),
      // Surface-Readiness bleibt die Authority; Working-Set-Daten liefern nur den
      // view-bezogenen Fortschritt.
      renderReady: ArenaBuilder.isSurfaceWorkingSetReady(arenaResult, view)
        && this.input.shadow.isStaticReadyForView(view, true),
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
  }

  /** World-lokale Gravel-/Baustellenprojektion der persistenten Basis. */
  syncPersistentBasePresentation(showWorld: boolean, spectator: boolean): void {
    if (this.destroyed) return;
    const arenaResult = this.input.getArenaResult();
    const layout = this.input.getWorldLayout();
    const visualSite = showWorld ? this.input.getPersistentBaseVisualSite() : null;
    arenaResult?.groundSurface?.setPersistentBaseGravel(
      visualSite && layout ? toPersistentBaseGravelZone(visualSite, layout.seed) : null,
    );
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
  }

  /**
   * Idempotent; danach sind alle Methoden wirkungslos. Es raeumt bewusst nichts auf – insbesondere
   * bleibt `camera.scrollX/Y` unveraendert stehen, der erste Frame der naechsten World ueberschreibt
   * ihn ohnehin ueber `syncCamera()`.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
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
