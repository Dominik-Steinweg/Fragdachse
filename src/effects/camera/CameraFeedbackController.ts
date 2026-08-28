import type * as Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config';
import {
  CAMERA_FEEDBACK_LIMITS,
  CameraFeedbackModel,
  type CameraFeedbackOutput,
  type CameraFeedbackRequest,
} from './CameraFeedbackModel';

export interface CameraFeedbackDeps {
  /** Bezugspunkt der Distanzdämpfung – normalerweise der lokale Spieler. */
  readonly getListener: () => { x: number; y: number } | null;
  /** Aus dem Grafikprofil; skaliert alle Amplituden gleichmäßig. */
  readonly getMotionScale: () => number;
}

/**
 * Einziger Besitzer der spielrelevanten Kamerabewegung. Alle Systeme fordern Effekte hier an,
 * statt selbst `cameras.main.shake()` zu rufen.
 *
 * Der Versatz wird auf `camera.scrollX/scrollY` geschrieben, nicht über Phasers Shake-Effekt:
 *
 * - Amplituden bleiben damit in Designpixeln und sind unabhängig von der Renderauflösung.
 * - Die Lichtkarte ist bildschirmfest, stempelt ihre Lichter aber bei `x - camera.scrollX`.
 *   Ein Scroll-Versatz bewegt deshalb die Lichter mit der Welt, während die Lichtkarte selbst
 *   stehen bleibt – die früher nötige Overscan-Reserve gegen unbeleuchtete Randstreifen
 *   entfällt vollständig.
 * - Bildschirmfeste Elemente (HUD, Overlays) wackeln nicht mehr mit.
 *
 * Aufrufreihenfolge ist bindend: `applyToCamera()` läuft in `scene.update`, direkt nach der
 * Kameraverfolgung und **vor** der Lichtberechnung. Nur so stempelt die Lichtkarte mit
 * demselben Scroll, mit dem die Welt anschließend gezeichnet wird.
 */
export class CameraFeedbackController {
  private readonly model: CameraFeedbackModel;
  private lastOutput: CameraFeedbackOutput = {
    offsetX: 0,
    offsetY: 0,
    zoomScale: 1,
    activeSources: 0,
    droppedSources: 0,
    clamped: false,
  };

  private zoomPulseEnabled = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: CameraFeedbackDeps,
  ) {
    this.model = new CameraFeedbackModel(CAMERA_FEEDBACK_LIMITS);
  }

  request(req: CameraFeedbackRequest): void {
    this.model.request(req, this.scene.time.now);
  }

  release(id: string, releaseMs?: number): void {
    this.model.release(id, this.scene.time.now, releaseMs);
  }

  /**
   * @param baseScrollX Kameraposition **ohne** Feedback. Der Aufrufer muss diesen Wert selbst
   *   führen; ein Rücklesen von `camera.scrollX` würde den Versatz in die Kameraverfolgung
   *   zurückkoppeln und die Kamera langsam abdriften lassen.
   */
  applyToCamera(
    camera: Phaser.Cameras.Scene2D.Camera,
    baseScrollX: number,
    baseScrollY: number,
    deltaMs: number,
  ): void {
    const listener = this.deps.getListener();
    const listenerX = listener?.x ?? baseScrollX + GAME_WIDTH * 0.5;
    const listenerY = listener?.y ?? baseScrollY + GAME_HEIGHT * 0.5;

    const output = this.model.step(
      deltaMs,
      this.scene.time.now,
      listenerX,
      listenerY,
      Math.max(0, this.deps.getMotionScale()),
    );
    this.lastOutput = output;

    camera.scrollX = baseScrollX + output.offsetX;
    camera.scrollY = baseScrollY + output.offsetY;

    // Zoom bleibt in Stufe 1 bewusst ungenutzt: bei `origin = (0, 0)` skaliert er um die
    // Bildschirmecke, und das bildschirmfeste HUD liegt noch auf derselben Kamera. Erst mit
    // der Klarheitskamera aus Stufe 2 lässt sich das sauber trennen.
    if (this.zoomPulseEnabled && output.zoomScale !== 1) {
      void output.zoomScale;
    }
  }

  setZoomPulseEnabled(enabled: boolean): void {
    this.zoomPulseEnabled = enabled;
  }

  /** World-Teardown: alle laufenden Quellen fallen lassen, damit nichts in die nächste World überläuft. */
  reset(): void {
    this.model.clear();
    this.lastOutput = { ...this.lastOutput, offsetX: 0, offsetY: 0, zoomScale: 1, activeSources: 0 };
  }

  destroy(): void {
    this.model.clear();
  }

  getMetrics(): { activeSources: number; offsetPx: number; clamped: boolean } {
    return {
      activeSources: this.lastOutput.activeSources,
      offsetPx: Math.hypot(this.lastOutput.offsetX, this.lastOutput.offsetY),
      clamped: this.lastOutput.clamped,
    };
  }
}
