import type * as Phaser from 'phaser';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { CameraFeedbackController } from './camera/CameraFeedbackController';
import { CameraPostFxController } from './postfx/CameraPostFxController';
import { LocalDistortionComposer } from './distortion/LocalDistortionComposer';
import {
  NUKE_VARIANT_PROFILES,
  NukeChoreography,
  type NukeChoreographyFrame,
  type NukeVariant,
  resolveNukeCountdownFrame,
} from './nuke/NukeChoreography';

interface NukeSequenceEntry {
  readonly sequence: NukeChoreography;
  readonly onSkyFlash?: (alpha: number) => void;
  readonly onFinished?: () => void;
}
import type { PostFxEvent } from './postfx/postFxPresets';
import { resolveBaseGrade, type WorldGradeInputs } from './postfx/worldGrade';
import { EntityJoltRegistry } from './EntityJoltRegistry';
import { LowHealthBloodOverlay } from './LowHealthBloodOverlay';
import {
  HitFeedbackRenderer,
  type HitTargetSilhouetteProvider,
} from './HitFeedbackRenderer';

export interface VisualFeedbackDeps {
  /** Bezugspunkt der Distanzdämpfung – normalerweise der lokale Spieler. */
  readonly getListener: () => { x: number; y: number } | null;
  readonly getLocalPlayerId: () => string;
  /** Eingaben der Basis-Bildkomposition. Werden pro Frame gelesen. */
  readonly getGradeInputs: () => WorldGradeInputs;
}

/**
 * Schmale Fassade über die Systeme der visuellen Regie. Sie existiert, damit `ArenaScene` nicht
 * mit Einzelheiten überladen wird: die Scene kennt nur `update`, `applyToCamera`, `reset` und
 * `destroy`.
 *
 * Szenenlebensdauer. Rundenwechsel laufen über {@link reset}, nicht über Neuaufbau – die
 * Systeme selbst halten keinen Rundenzustand.
 */
export class VisualFeedbackDirector {
  readonly camera: CameraFeedbackController;
  readonly jolt: EntityJoltRegistry;
  readonly hitFeedback: HitFeedbackRenderer;
  readonly postFx: CameraPostFxController;
  readonly distortion: LocalDistortionComposer;
  readonly lowHealthBlood: LowHealthBloodOverlay;
  private lastBossPhase = 0;
  private nextNukeSequenceId = 1;
  private readonly nukeSequences: NukeSequenceEntry[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: VisualFeedbackDeps,
  ) {
    this.camera = new CameraFeedbackController(scene, {
      getListener: deps.getListener,
      getMotionScale: () => getGraphicsQualityProfile(scene).cameraMotionScale,
    });
    this.jolt = new EntityJoltRegistry(scene.game);
    this.hitFeedback = new HitFeedbackRenderer(scene, this.jolt);
    this.hitFeedback.generateTextures();
    this.hitFeedback.setCameraFeedback(this.camera);
    this.hitFeedback.setLocalPlayerIdProvider(deps.getLocalPlayerId);
    this.postFx = new CameraPostFxController(scene, scene.cameras.main);
    this.hitFeedback.setPostFx(this.postFx);
    this.lowHealthBlood = new LowHealthBloodOverlay(scene);
    this.distortion = new LocalDistortionComposer(scene);
    this.distortion.setTextureRebuiltHandler(() => {
      this.postFx.rebindDistortionTexture(this.distortion.getTextureKey());
    });
    // Erst mit der Klarheitskamera aus Stufe 2 ist ein Zoom-Puls unbedenklich: vorher zöge er
    // das bildschirmfeste HUD aus der Bildecke.
    this.camera.setZoomPulseEnabled(this.postFx.isActive());
  }

  /** Kurzzeitige globale Reaktion. Nur die Ereignisse aus der Whitelist sind erlaubt. */
  pulsePostFx(event: PostFxEvent): void {
    this.postFx.pulseEvent(event);
  }

  /**
   * Startet die mehrphasige Nuke-Regie.
   *
   * @returns `false`, wenn keine Bildkomposition verfügbar ist (kein WebGL, Qualitätsstufe
   *   `low`). Der Aufrufer fällt dann auf seine bisherigen Einzeleffekte zurück – die Sequenz
   *   ersetzt sie, sie ergänzt sie nicht.
   */
  startNukeSequence(options: {
    variant: NukeVariant;
    x: number;
    y: number;
    radiusPx: number;
    onSkyFlash?: (alpha: number) => void;
    onFinished?: () => void;
  }): boolean {
    if (!this.postFx.isActive()) return false;
    const id = this.nextNukeSequenceId++;
    const sequence = new NukeChoreography(
      NUKE_VARIANT_PROFILES[options.variant],
      id,
      options.x,
      options.y,
      options.radiusPx,
    );
    const entry = { sequence, onSkyFlash: options.onSkyFlash, onFinished: options.onFinished };
    this.nukeSequences.push(entry);
    this.consumeNukeFrame(sequence.start(), entry);
    return true;
  }

  hasActiveNukeSequence(): boolean {
    return this.nukeSequences.length > 0;
  }

  /**
   * Phase A der Nuke: anschwellendes Rumpeln, leichte Entsättigung und – entscheidend – ein
   * Telegraph-Boost, der die Warnzone **stärker** vom sicheren Bereich abhebt, statt sie mit
   * zu entsättigen.
   *
   * @returns Faktor 0..1, mit dem der Aufrufer Alpha und Emission seiner Warnringe anhebt.
   */
  driveNukeCountdown(nukeId: number, countdownProgress: number, x: number, y: number): number {
    if (!this.postFx.isActive()) return 0;
    const frame = resolveNukeCountdownFrame(nukeId, countdownProgress, x, y);
    for (const request of frame.cameraRequests) this.camera.request(request);
    for (const pulse of frame.postFxPulses) this.postFx.pulse(pulse);
    return frame.telegraphBoost;
  }

  releaseNukeCountdown(nukeId: number): void {
    this.camera.release(`nuke:${nukeId}`, 260);
    this.postFx.release(`nukeTension:${nukeId}`);
  }

  setSilhouetteProvider(provider: HitTargetSilhouetteProvider | null): void {
    this.hitFeedback.setSilhouetteProvider(provider);
  }

  /**
   * Reihenfolge ist bindend: erst das Abklingen der Impulse fortschreiben, dann die Blitze
   * nachführen – nur so sitzt eine Trefferkopie auf dem gezuckten Körper und nicht daneben.
   *
   * Aufruf gehört zu den anderen Pro-Frame-Visuals, also **nach** dem Positionsabgleich der
   * Entities.
   */
  update(deltaMs: number): void {
    this.jolt.setEnabled(getGraphicsQualityProfile(this.scene).entityJolt);
    this.jolt.step(deltaMs);
    this.hitFeedback.update(deltaMs);

    const inputs = this.deps.getGradeInputs();
    // Der Bossphasenwechsel ist ein Ereignis, die Basis kennt nur einen Zustand. Die Flanke
    // wird deshalb hier erkannt – so braucht das Gegnersystem keine eigene Meldung.
    if (inputs.bossPhase > this.lastBossPhase) this.pulsePostFx('bossPhaseChange');
    this.lastBossPhase = inputs.bossPhase;

    this.stepNukeSequences(deltaMs);
    this.postFx.setBaseGrade(resolveBaseGrade(inputs));
    this.postFx.update(deltaMs);
    // Niedrige Gesundheit spricht am Bildrand über Blut, nicht über zunehmende Dunkelheit.
    this.lowHealthBlood.update(inputs.localHpFraction, deltaMs);
  }

  private stepNukeSequences(deltaMs: number): void {
    for (let i = this.nukeSequences.length - 1; i >= 0; i -= 1) {
      const entry = this.nukeSequences[i];
      const frame = entry.sequence.step(deltaMs);
      this.consumeNukeFrame(frame, entry);
      if (entry.sequence.isFinished()) {
        this.nukeSequences.splice(i, 1);
        entry.onFinished?.();
      }
    }
  }

  private consumeNukeFrame(frame: NukeChoreographyFrame, entry: NukeSequenceEntry): void {
    for (const request of frame.cameraRequests) this.camera.request(request);
    for (const id of frame.cameraReleases) this.camera.release(id, 320);
    for (const pulse of frame.postFxPulses) this.postFx.pulse(pulse);
    if (frame.distortion) this.distortion.submit(frame.distortion);
    entry.onSkyFlash?.(Math.max(0, frame.skyFlashAlpha));
  }

  applyToCamera(
    camera: Phaser.Cameras.Scene2D.Camera,
    baseScrollX: number,
    baseScrollY: number,
    deltaMs: number,
  ): void {
    this.camera.applyToCamera(camera, baseScrollX, baseScrollY, deltaMs);
    // Erst **nach** dem Kameraversatz: der steckt in `camera.scrollX`, und die Karte wird in
    // Bildschirmkoordinaten aufgebaut. Andersherum liefe die Verzerrung gegen die Welt.
    const plan = this.distortion.update(camera);
    this.postFx.setDistortion(this.distortion.getTextureKey(), plan.amount);
  }

  /** Rundenende: laufende Kameraquellen und Trefferkopien fallen lassen. */
  reset(): void {
    this.camera.reset();
    this.jolt.reset();
    this.hitFeedback.clear();
    this.postFx.reset();
    this.distortion.reset();
    this.lowHealthBlood.reset();
    // Laufende Sequenzen dürfen eine Rundengrenze nicht überleben – sonst hinge der
    // Bildschirmblitz einer Nuke noch in der Lobby.
    for (const entry of this.nukeSequences) entry.onFinished?.();
    this.nukeSequences.length = 0;
    this.lastBossPhase = 0;
  }

  destroy(): void {
    this.hitFeedback.destroyAll();
    this.jolt.destroy();
    this.camera.destroy();
    this.postFx.destroy();
    this.distortion.destroy();
    this.lowHealthBlood.destroy();
  }
}
