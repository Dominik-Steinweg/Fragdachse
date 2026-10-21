/**
 * Kamera-Inszenierung des eigenen Spawns: Schnitt auf eine Nahaufnahme der eigenen Figur, kurzes
 * Heranfahren mit dem sich sammelnden Licht des Spawn-Effekts, dann ein schnelles, weich
 * auslaufendes Herausfahren auf die Spielansicht.
 *
 * Bewusst ohne Phaser-Import und ohne eigene Uhr: Der Besitzer der Kameraverfolgung fragt den
 * Faktor pro Frame mit der Scene-Zeit ab. Mehrfache Abfragen im selben Frame sind deshalb
 * idempotent, und eine pausierte Scene hält die Fahrt an.
 *
 * Der Faktor multipliziert den Designzoom; 1 ist die normale Spielansicht. Zoomwerte werden im
 * Logarithmus interpoliert, damit die Fahrt über den ganzen Bereich gleichmäßig wirkt.
 */
export interface SpawnCameraZoomTuning {
  /** Zoom im Moment des Schnitts auf die Figur. */
  readonly cutZoom: number;
  /** Höhepunkt der Nahaufnahme nach dem Heranfahren. */
  readonly peakZoom: number;
  readonly pushInMs: number;
  /** Respawn: Verweildauer auf dem Höhepunkt, bis der Materialisierungsblitz gelesen ist. */
  readonly dwellMs: number;
  /** Gehaltene Nahaufnahme (Countdown): langsames Weiterfahren, relativ zum Höhepunkt. */
  readonly holdCreep: number;
  readonly holdCreepMs: number;
  /** Herausfahren auf die Spielansicht. */
  readonly releaseMs: number;
}

export const SPAWN_CAMERA_ZOOM: SpawnCameraZoomTuning = {
  cutZoom: 1.34,
  peakZoom: 1.62,
  pushInMs: 260,
  dwellMs: 220,
  holdCreep: 0.05,
  holdCreepMs: 3000,
  releaseMs: 1150,
};

/**
 * Schnell anlaufend, lang und weich auslaufend: `1 - (1-u)^3 (1+3u)` hat bei 0 und 1 die Steigung
 * null und die größte Geschwindigkeit bei einem Drittel der Fahrt.
 */
export function spawnZoomReleaseCurve(u: number): number {
  const t = u <= 0 ? 0 : u >= 1 ? 1 : u;
  const v = 1 - t;
  return 1 - v * v * v * (1 + 3 * t);
}

function easeOutCubic(u: number): number {
  const v = 1 - (u <= 0 ? 0 : u >= 1 ? 1 : u);
  return 1 - v * v * v;
}

/** Interpolation im Logarithmus: gleiche Fortschritte wirken wie gleiche Zoomschritte. */
function logLerp(from: number, to: number, t: number): number {
  return from * Math.pow(to / from, t);
}

export class SpawnCameraZoom {
  private active = false;
  private hold = false;
  private startedMs = 0;
  private releaseStartMs: number | null = null;
  private releaseFrom = 1;

  constructor(private readonly tuning: SpawnCameraZoomTuning = SPAWN_CAMERA_ZOOM) {}

  /** Ein neuer Spawn. Mit `hold` bleibt die Nahaufnahme stehen, bis `release()` sie freigibt. */
  begin(nowMs: number, hold: boolean): void {
    this.active = true;
    this.hold = hold;
    this.startedMs = nowMs;
    this.releaseStartMs = null;
  }

  /** Beendet eine gehaltene Nahaufnahme mit dem Herausfahren ab dem aktuellen Zoom. */
  release(nowMs: number): void {
    if (!this.active || !this.hold || this.releaseStartMs !== null) return;
    this.releaseFrom = this.approach(nowMs);
    this.releaseStartMs = nowMs;
  }

  /** Bricht ohne Fahrt ab, etwa beim Tod oder ohne darstellbare Figur. */
  cancel(): void {
    this.active = false;
    this.hold = false;
    this.releaseStartMs = null;
  }

  get holding(): boolean { return this.active && this.hold && this.releaseStartMs === null; }

  /** Aktueller Zoomfaktor (>= 1); nach dem Herausfahren wieder genau 1. */
  sample(nowMs: number): number {
    if (!this.active) return 1;
    const { pushInMs, dwellMs, releaseMs } = this.tuning;
    if (!this.hold && this.releaseStartMs === null && nowMs - this.startedMs >= pushInMs + dwellMs) {
      this.releaseFrom = this.approach(this.startedMs + pushInMs + dwellMs);
      this.releaseStartMs = this.startedMs + pushInMs + dwellMs;
    }
    if (this.releaseStartMs === null) return this.approach(nowMs);
    const u = (nowMs - this.releaseStartMs) / Math.max(1, releaseMs);
    if (u >= 1) {
      this.cancel();
      return 1;
    }
    return logLerp(this.releaseFrom, 1, spawnZoomReleaseCurve(u));
  }

  /** Heranfahren vom Schnitt zum Höhepunkt, gehalten mit langsamem Weiterfahren. */
  private approach(nowMs: number): number {
    const { cutZoom, peakZoom, pushInMs, holdCreep, holdCreepMs } = this.tuning;
    const elapsed = Math.max(0, nowMs - this.startedMs);
    if (elapsed < pushInMs) return logLerp(cutZoom, peakZoom, easeOutCubic(elapsed / Math.max(1, pushInMs)));
    if (!this.hold) return peakZoom;
    const creep = Math.min(1, (elapsed - pushInMs) / Math.max(1, holdCreepMs));
    return peakZoom * (1 + holdCreep * Math.sin(creep * Math.PI * 0.5));
  }
}
