/**
 * Vom Spieler per Mausrad gewählter Zoom der Weltkamera. 1 ist die Standardansicht und zugleich
 * die Untergrenze: Weiter heraus als die Standardsicht darf niemand sehen, sonst verschöben sich
 * Sichtweite und Spielbalance. Inszenierte Zooms (Spawn, Tod, Boss-Intro) setzen auf diesem Wert auf.
 *
 * Bewusst ohne Phaser-Import und ohne eigene Uhr: Die Eingabe setzt nur das Ziel, die
 * Kameraverfolgung fragt den geglätteten Wert pro Frame mit der Scene-Zeit ab. Mehrfache Abfragen
 * im selben Frame sind idempotent. Der Wert lebt mit der Scene, nicht mit einer World.
 */
export interface PlayerCameraZoomTuning {
  /** Höchster wählbarer Zoom relativ zur Standardansicht. */
  readonly max: number;
  /** Zoomschritt einer Mausrad-Raste (100 px Scrollweg) als Faktor. */
  readonly notchFactor: number;
  /** Zeitkonstante, mit der der Zoom seinem Ziel folgt. */
  readonly smoothingMs: number;
}

export const PLAYER_CAMERA_ZOOM: PlayerCameraZoomTuning = { max: 1.8, notchFactor: 1.12, smoothingMs: 110 };

/** Pixel eines Mausrad-Ereignisses, auch wenn der Browser in Zeilen oder Seiten zählt. */
export function wheelDeltaPixels(deltaY: number, deltaMode = 0): number {
  return deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY;
}

export class PlayerCameraZoom {
  private target = 1;
  private value = 1;
  private sampledAtMs: number | null = null;

  constructor(private readonly tuning: PlayerCameraZoomTuning = PLAYER_CAMERA_ZOOM) {}

  get targetZoom(): number { return this.target; }

  /** Mausrad: nach oben (negativ) heran, nach unten heraus; höchstens eine Raste pro Ereignis. */
  nudge(deltaPixels: number): void {
    if (!Number.isFinite(deltaPixels) || deltaPixels === 0) return;
    const notches = Math.max(-1, Math.min(1, deltaPixels / 100));
    const next = this.target * Math.pow(this.tuning.notchFactor, -notches);
    this.target = Math.max(1, Math.min(this.tuning.max, next));
  }

  /** Geglätteter Zoom (>= 1) zum Zeitpunkt `nowMs`. */
  sample(nowMs: number): number {
    if (this.sampledAtMs !== null && this.value !== this.target) {
      const decay = Math.exp(-Math.max(0, nowMs - this.sampledAtMs) / Math.max(1, this.tuning.smoothingMs));
      this.value = this.target * Math.pow(this.value / this.target, decay);
      if (Math.abs(Math.log(this.value / this.target)) < 1e-4) this.value = this.target;
    }
    this.sampledAtMs = nowMs;
    return this.value;
  }
}

const zoomByScene = new WeakMap<object, PlayerCameraZoom>();

/** Der Spielerzoom einer Scene; Eingabe und Kameraverfolgung teilen ihn, ohne einander zu kennen. */
export function playerCameraZoomFor(scene: object): PlayerCameraZoom {
  let zoom = zoomByScene.get(scene);
  if (!zoom) { zoom = new PlayerCameraZoom(); zoomByScene.set(scene, zoom); }
  return zoom;
}
