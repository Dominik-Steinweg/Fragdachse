import type * as Phaser from 'phaser';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { CameraFeedbackController } from './camera/CameraFeedbackController';
import { CameraPostFxController } from './postfx/CameraPostFxController';
import type { PostFxEvent } from './postfx/postFxPresets';
import { resolveBaseGrade, type WorldGradeInputs } from './postfx/worldGrade';
import { EntityJoltRegistry } from './EntityJoltRegistry';
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
  private lastBossPhase = 0;

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
    // Erst mit der Klarheitskamera aus Stufe 2 ist ein Zoom-Puls unbedenklich: vorher zöge er
    // das bildschirmfeste HUD aus der Bildecke.
    this.camera.setZoomPulseEnabled(this.postFx.isActive());
  }

  /** Kurzzeitige globale Reaktion. Nur die Ereignisse aus der Whitelist sind erlaubt. */
  pulsePostFx(event: PostFxEvent): void {
    this.postFx.pulseEvent(event);
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

    this.postFx.setBaseGrade(resolveBaseGrade(inputs));
    this.postFx.update(deltaMs);
  }

  applyToCamera(
    camera: Phaser.Cameras.Scene2D.Camera,
    baseScrollX: number,
    baseScrollY: number,
    deltaMs: number,
  ): void {
    this.camera.applyToCamera(camera, baseScrollX, baseScrollY, deltaMs);
  }

  /** Rundenende: laufende Kameraquellen und Trefferkopien fallen lassen. */
  reset(): void {
    this.camera.reset();
    this.jolt.reset();
    this.hitFeedback.clear();
    this.postFx.reset();
    this.lastBossPhase = 0;
  }

  destroy(): void {
    this.hitFeedback.destroyAll();
    this.jolt.destroy();
    this.camera.destroy();
    this.postFx.destroy();
  }
}
