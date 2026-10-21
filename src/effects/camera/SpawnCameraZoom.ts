/**
 * Kamera-Inszenierung des eigenen Spawns: Schnitt auf eine Nahaufnahme der eigenen Figur, kurzes
 * Heranfahren mit dem sich sammelnden Licht des Spawn-Effekts, dann ein schnelles, weich
 * auslaufendes Herausfahren auf die Spielansicht. Der Tod fährt bereits auf das Zoomniveau heran,
 * mit dem der Respawn beginnt; der Respawn setzt dort ohne Sprung an.
 *
 * Bewusst ohne Phaser-Import und ohne eigene Uhr: Der Besitzer der Kameraverfolgung fragt den
 * Faktor pro Frame mit der Scene-Zeit ab. Mehrfache Abfragen im selben Frame sind deshalb
 * idempotent, und eine pausierte Scene hält die Fahrt an.
 *
 * Der Faktor multipliziert den Designzoom; 1 ist die normale Spielansicht. Zoomwerte werden im
 * Logarithmus interpoliert, damit die Fahrt über den ganzen Bereich gleichmäßig wirkt.
 */
export interface SpawnCameraZoomTuning {
  /** Zoom im Moment des Schnitts auf die Figur; auch das Ziel der Fahrt beim Tod. */
  readonly cutZoom: number;
  /** Heranfahren an die gefallene Figur bis auf das Startniveau des Respawns. */
  readonly deathMs: number;
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
  deathMs: 900,
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

function easeInOutSine(u: number): number {
  const t = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

function easeOutCubic(u: number): number {
  const v = 1 - (u <= 0 ? 0 : u >= 1 ? 1 : u);
  return 1 - v * v * v;
}

/** Interpolation im Logarithmus: gleiche Fortschritte wirken wie gleiche Zoomschritte. */
function logLerp(from: number, to: number, t: number): number {
  return from * Math.pow(to / from, t);
}

type Phase = 'idle' | 'death' | 'spawn' | 'release';

export class SpawnCameraZoom {
  private phase: Phase = 'idle';
  private hold = false;
  private startedMs = 0;
  /** Zoom, von dem die laufende Fahrt ausgeht. */
  private from = 1;

  constructor(private readonly tuning: SpawnCameraZoomTuning = SPAWN_CAMERA_ZOOM) {}

  /**
   * Ein neuer Spawn. Nach einem Tod setzt er beim erreichten Todeszoom an, sonst schneidet er auf
   * die Nahaufnahme. Mit `hold` bleibt sie stehen, bis `release()` sie freigibt.
   */
  begin(nowMs: number, hold: boolean): void {
    this.from = this.phase === 'idle' ? this.tuning.cutZoom : this.sample(nowMs);
    this.phase = 'spawn';
    this.hold = hold;
    this.startedMs = nowMs;
  }

  /** Die eigene Figur ist gefallen: Heranfahren bis auf das Startniveau des Respawns, dann halten. */
  death(nowMs: number): void {
    this.from = this.sample(nowMs);
    this.phase = 'death';
    this.startedMs = nowMs;
  }

  /** Beendet eine gehaltene Nahaufnahme mit dem Herausfahren ab dem aktuellen Zoom. */
  release(nowMs: number): void {
    if (!this.holding) return;
    this.startRelease(nowMs, this.approach(nowMs));
  }

  /** Bricht ohne Fahrt ab, etwa ohne darstellbare Figur. */
  cancel(): void {
    this.phase = 'idle';
    this.hold = false;
  }

  get holding(): boolean { return this.phase === 'spawn' && this.hold; }

  /** Aktueller Zoomfaktor (>= 1); nach dem Herausfahren wieder genau 1. */
  sample(nowMs: number): number {
    const { cutZoom, deathMs, pushInMs, dwellMs, releaseMs } = this.tuning;
    if (this.phase === 'idle') return 1;
    if (this.phase === 'death') {
      return logLerp(this.from, cutZoom, easeInOutSine((nowMs - this.startedMs) / Math.max(1, deathMs)));
    }
    if (this.phase === 'spawn') {
      if (this.hold || nowMs - this.startedMs < pushInMs + dwellMs) return this.approach(nowMs);
      this.startRelease(this.startedMs + pushInMs + dwellMs, this.approach(this.startedMs + pushInMs + dwellMs));
    }
    const u = (nowMs - this.startedMs) / Math.max(1, releaseMs);
    if (u >= 1) {
      this.cancel();
      return 1;
    }
    return logLerp(this.from, 1, spawnZoomReleaseCurve(u));
  }

  private startRelease(atMs: number, from: number): void {
    this.phase = 'release';
    this.hold = false;
    this.from = from;
    this.startedMs = atMs;
  }

  /** Heranfahren vom Ausgangszoom zum Höhepunkt, gehalten mit langsamem Weiterfahren. */
  private approach(nowMs: number): number {
    const { peakZoom, pushInMs, holdCreep, holdCreepMs } = this.tuning;
    const elapsed = Math.max(0, nowMs - this.startedMs);
    if (elapsed < pushInMs) return logLerp(this.from, peakZoom, easeOutCubic(elapsed / Math.max(1, pushInMs)));
    if (!this.hold) return peakZoom;
    const creep = Math.min(1, (elapsed - pushInMs) / Math.max(1, holdCreepMs));
    return peakZoom * (1 + holdCreep * Math.sin(creep * Math.PI * 0.5));
  }
}
