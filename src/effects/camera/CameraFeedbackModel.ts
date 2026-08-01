/**
 * Zentrales Modell für alle spielrelevanten Kamerabewegungen. Bewusst ohne Phaser-Import,
 * damit Zusammenführung, Begrenzung und Abklingen deterministisch testbar bleiben.
 *
 * Warum ein eigenes Modell statt `camera.shake()`:
 *
 * 1. Phasers `Shake.start(duration, intensity, force = false)` bricht ab, sobald bereits ein
 *    Shake läuft. Im Projekt feuern mehrere Quellen pro Frame (Airstrike-Rampe, Nuke-Countdown,
 *    BFG im Flug, Ladephase). Ein dauerhaft laufendes schwaches Rumpeln blockierte damit die
 *    starke Detonation vollständig.
 * 2. Phasers Shake-Offset wird vor der Kameramatrix zusätzlich mit `camera.zoom` multipliziert
 *    und skaliert deshalb quadratisch mit der Renderauflösung. Amplituden hier stehen dagegen
 *    in Designpixeln und sind auflösungsunabhängig.
 * 3. Es gibt keine Kombination, keine Priorisierung, keine Richtung und keine Distanzdämpfung.
 *
 * Es werden bewusst **keine Tweens** verwendet: ein Besitzer sampelt jeden Frame alle lebenden
 * Quellen. Damit kann es keine konkurrierenden oder verwaisten Tweens geben, und eine per
 * `id` wiederholt angeforderte Dauerquelle wird aktualisiert statt neu gestartet.
 */

export type FeedbackChannel = 'rumble' | 'impact' | 'kick' | 'zoom';
export type FeedbackDecay = 'linear' | 'expo' | 'impulse';

export interface CameraFeedbackRequest {
  /**
   * Stabile Kennung. Wird sie erneut angefordert, aktualisiert das die vorhandene Quelle und
   * behält ihre Rauschphase bei – genau das brauchen die Pro-Frame-Sender. Ohne `id` gilt die
   * Anforderung als Einzelereignis und stapelt sich mit anderen.
   */
  readonly id?: string;
  readonly channel: FeedbackChannel;
  /** Spitzenamplitude in Designpixeln bei Distanz 0. */
  readonly amplitudePx: number;
  readonly durationMs: number;
  /** 0..100. Steuert Gewichtung beim Rumpeln, Verdrängung und die Zoom-Sperre. */
  readonly priority: number;
  readonly dirX?: number;
  readonly dirY?: number;
  /** Weltposition der Quelle. Fehlt sie, wirkt die Quelle ungedämpft. */
  readonly sourceX?: number;
  readonly sourceY?: number;
  readonly falloffPx?: number;
  readonly frequencyHz?: number;
  /** Nur Kanal `zoom`: positiver Wert zoomt hinein. */
  readonly zoomDelta?: number;
  readonly decay?: FeedbackDecay;
}

export interface CameraFeedbackOutput {
  /** Designpixel, bereits weich geklemmt. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** 1 = neutral. */
  readonly zoomScale: number;
  readonly activeSources: number;
  readonly droppedSources: number;
  readonly clamped: boolean;
}

export interface CameraFeedbackLimits {
  readonly maxOffsetPx: number;
  readonly maxZoomScale: number;
  readonly maxSources: number;
  readonly minPriorityForZoom: number;
}

/**
 * `maxOffsetPx` ist zugleich das Budget, um das `ArenaScene.syncMainCameraBounds()` die
 * Kameragrenzen erweitert. Ohne diese Erweiterung frisst Phasers `clampX/clampY` den Offset.
 */
export const CAMERA_FEEDBACK_LIMITS: CameraFeedbackLimits = {
  maxOffsetPx: 48,
  maxZoomScale: 1.012,
  maxSources: 12,
  minPriorityForZoom: 80,
};

const DEFAULT_FALLOFF_PX = 900;
const DEFAULT_FREQUENCY_HZ = 18;
const DEFAULT_RELEASE_MS = 240;
const IMPULSE_ATTACK_MS = 8;
const IMPACT_LATERAL_RATIO = 0.45;
/** Unterhalb davon wird eine Quelle als still betrachtet und ausgefiltert. */
const NEGLIGIBLE_PX = 0.01;

interface ActiveSource {
  id: string | null;
  channel: FeedbackChannel;
  amplitudePx: number;
  durationMs: number;
  priority: number;
  dirX: number;
  dirY: number;
  /** Falsch, wenn der Aufrufer keine echte Richtung kennt – dann schlägt der Einschlag radial aus. */
  hasDirection: boolean;
  sourceX: number | null;
  sourceY: number | null;
  falloffPx: number;
  frequencyHz: number;
  zoomDelta: number;
  decay: FeedbackDecay;
  startedMs: number;
  /** Rauschphase. Bleibt bei erneuter Anforderung derselben `id` erhalten. */
  phase: number;
  releaseStartedMs: number | null;
  releaseMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Normalisiert eine Richtung. Ohne brauchbare Richtung zeigt der Vektor nach rechts, damit
 * ein Kick nie zu einem Nullvektor kollabiert.
 */
function normalizeDirection(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= 1e-6) return { x: 1, y: 0 };
  return { x: x / length, y: y / length };
}

/**
 * Hüllkurven. Alle erreichen bei `t = 1` **exakt** 0 – die exponentiellen Varianten werden dafür
 * um ihren Endwert verschoben und neu normiert. Ohne das bliebe die Kamera mit einem winzigen
 * Restoffset dauerhaft am Leben, und das Abklingen wäre nicht prüfbar.
 */
export function feedbackEnvelope(decay: FeedbackDecay, t: number, durationMs: number): number {
  if (t <= 0) return decay === 'impulse' ? 0 : 1;
  if (t >= 1) return 0;

  if (decay === 'linear') return 1 - t;

  if (decay === 'impulse') {
    const attackFraction = clamp(IMPULSE_ATTACK_MS / Math.max(1, durationMs), 0, 0.25);
    if (t < attackFraction) return t / attackFraction;
    const u = (t - attackFraction) / (1 - attackFraction);
    return (Math.exp(-5 * u) - Math.exp(-5)) / (1 - Math.exp(-5));
  }

  return (Math.exp(-3 * t) - Math.exp(-3)) / (1 - Math.exp(-3));
}

/** Quadratischer Abfall auf 0 am Rand des Wirkradius. */
export function feedbackAttenuation(distance: number, falloffPx: number): number {
  if (falloffPx <= 0) return 1;
  const linear = clamp(1 - distance / falloffPx, 0, 1);
  return linear * linear;
}

function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}

/** Value-Noise mit weicher Interpolation. Deterministisch, ohne eigenen Zustand. */
function valueNoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const smooth = f * f * (3 - 2 * f);
  const a = hash01(i + seed);
  const b = hash01(i + 1 + seed);
  return (a + (b - a) * smooth) * 2 - 1;
}

/** Zwei Oktaven: die zweite gibt dem Rumpeln Textur, ohne die Amplitude zu verdoppeln. */
function rumbleNoise(timeSec: number, frequencyHz: number, seed: number): number {
  const base = valueNoise(timeSec * frequencyHz, seed);
  const detail = valueNoise(timeSec * frequencyHz * 2.37, seed + 91.7);
  return (base + detail * 0.5) / 1.5;
}

export class CameraFeedbackModel {
  private readonly sources: ActiveSource[] = [];
  private readonly limits: CameraFeedbackLimits;
  private readonly rng: () => number;
  private droppedSinceStep = 0;

  constructor(limits: CameraFeedbackLimits = CAMERA_FEEDBACK_LIMITS, rng: () => number = Math.random) {
    this.limits = limits;
    this.rng = rng;
  }

  request(req: CameraFeedbackRequest, nowMs: number): void {
    const amplitudePx = finiteOr(req.amplitudePx, 0);
    const durationMs = finiteOr(req.durationMs, 0);
    if (durationMs <= 0) return;
    if (req.channel !== 'zoom' && amplitudePx <= 0) return;

    const rawDirX = finiteOr(req.dirX, 0);
    const rawDirY = finiteOr(req.dirY, 0);
    const hasDirection = Math.hypot(rawDirX, rawDirY) > 1e-6;
    const direction = normalizeDirection(rawDirX, rawDirY);
    const existing = req.id ? this.sources.find((source) => source.id === req.id) : undefined;

    if (existing) {
      // Aktualisieren statt neu starten: die Rauschphase bleibt erhalten, deshalb erzeugt eine
      // pro Frame wiederholte Anforderung ein nahtloses Dauerrumpeln statt eines Neustartsturms.
      existing.channel = req.channel;
      existing.amplitudePx = amplitudePx;
      existing.durationMs = durationMs;
      existing.priority = finiteOr(req.priority, 0);
      existing.dirX = direction.x;
      existing.dirY = direction.y;
      existing.hasDirection = hasDirection;
      existing.sourceX = typeof req.sourceX === 'number' ? req.sourceX : null;
      existing.sourceY = typeof req.sourceY === 'number' ? req.sourceY : null;
      existing.falloffPx = finiteOr(req.falloffPx, DEFAULT_FALLOFF_PX);
      existing.frequencyHz = finiteOr(req.frequencyHz, DEFAULT_FREQUENCY_HZ);
      existing.zoomDelta = finiteOr(req.zoomDelta, 0);
      existing.decay = req.decay ?? existing.decay;
      existing.startedMs = nowMs;
      existing.releaseStartedMs = null;
      return;
    }

    this.sources.push({
      id: req.id ?? null,
      channel: req.channel,
      amplitudePx,
      durationMs,
      priority: finiteOr(req.priority, 0),
      dirX: direction.x,
      dirY: direction.y,
      hasDirection,
      sourceX: typeof req.sourceX === 'number' ? req.sourceX : null,
      sourceY: typeof req.sourceY === 'number' ? req.sourceY : null,
      falloffPx: finiteOr(req.falloffPx, DEFAULT_FALLOFF_PX),
      frequencyHz: finiteOr(req.frequencyHz, DEFAULT_FREQUENCY_HZ),
      zoomDelta: finiteOr(req.zoomDelta, 0),
      decay: req.decay ?? (req.channel === 'rumble' ? 'linear' : 'impulse'),
      startedMs: nowMs,
      phase: this.rng() * 1000,
      releaseStartedMs: null,
      releaseMs: DEFAULT_RELEASE_MS,
    });

    this.evictWeakest(nowMs);
  }

  /** Dauerquellen laufen aus, statt hart abzureißen. */
  release(id: string, nowMs: number, releaseMs: number = DEFAULT_RELEASE_MS): void {
    const source = this.sources.find((entry) => entry.id === id);
    if (!source || source.releaseStartedMs !== null) return;
    source.releaseStartedMs = nowMs;
    source.releaseMs = Math.max(1, releaseMs);
  }

  step(
    deltaMs: number,
    nowMs: number,
    listenerX: number,
    listenerY: number,
    motionScale: number,
  ): CameraFeedbackOutput {
    void deltaMs;

    let offsetX = 0;
    let offsetY = 0;
    let zoomScale = 1;
    let maxPriority = 0;

    for (const source of this.sources) {
      if (source.priority > maxPriority) maxPriority = source.priority;
    }

    for (let i = this.sources.length - 1; i >= 0; i -= 1) {
      const source = this.sources[i];
      const elapsedMs = nowMs - source.startedMs;
      const t = source.durationMs > 0 ? elapsedMs / source.durationMs : 1;

      if (t >= 1) {
        this.sources.splice(i, 1);
        continue;
      }

      let gain = feedbackEnvelope(source.decay, Math.max(0, t), source.durationMs);

      if (source.releaseStartedMs !== null) {
        const releaseProgress = (nowMs - source.releaseStartedMs) / source.releaseMs;
        if (releaseProgress >= 1) {
          this.sources.splice(i, 1);
          continue;
        }
        gain *= 1 - clamp(releaseProgress, 0, 1);
      }

      if (source.sourceX !== null && source.sourceY !== null) {
        const distance = Math.hypot(source.sourceX - listenerX, source.sourceY - listenerY);
        gain *= feedbackAttenuation(distance, source.falloffPx);
      }

      if (gain <= 0) continue;

      if (source.channel === 'zoom') {
        if (source.priority < this.limits.minPriorityForZoom) continue;
        zoomScale += source.zoomDelta * gain * motionScale;
        continue;
      }

      const contribution = source.amplitudePx * gain * motionScale;
      if (contribution <= NEGLIGIBLE_PX) continue;

      if (source.channel === 'kick') {
        offsetX += source.dirX * contribution;
        offsetY += source.dirY * contribution;
        continue;
      }

      if (source.channel === 'impact') {
        const angle = (elapsedMs / 1000) * source.frequencyHz * Math.PI * 2 + source.phase;
        if (!source.hasDirection) {
          // Ohne bekannte Richtung – etwa bei einer Explosion, deren Lage zur Kamera der
          // Aufrufer nicht kennt – schlägt der Einschlag radial aus, statt eine willkürliche
          // Vorzugsrichtung zu erfinden.
          offsetX += Math.cos(angle) * contribution;
          offsetY += Math.sin(angle * 1.31 + 1.7) * contribution;
          continue;
        }
        const lateral = contribution * IMPACT_LATERAL_RATIO * Math.sin(angle);
        offsetX += source.dirX * contribution - source.dirY * lateral;
        offsetY += source.dirY * contribution + source.dirX * lateral;
        continue;
      }

      // Rumpeln wird nach Priorität gewichtet. Damit kann ein laufendes schwaches Dauerrumpeln
      // einen gleichzeitigen Einschlag hoher Priorität nicht mehr überdecken – der eigentliche
      // Grund, aus dem `camera.shake()` hier abgelöst wurde.
      const weight = maxPriority > 0 ? source.priority / maxPriority : 1;
      const weighted = contribution * weight;
      const timeSec = elapsedMs / 1000;
      offsetX += rumbleNoise(timeSec, source.frequencyHz, source.phase) * weighted;
      offsetY += rumbleNoise(timeSec, source.frequencyHz, source.phase + 313.7) * weighted;
    }

    const magnitude = Math.hypot(offsetX, offsetY);
    let clamped = false;
    if (magnitude > 0) {
      // Weiche Klemmung: stetig und beschränkt, also kein Sprung, wenn eine Quelle wegfällt.
      const limited = this.limits.maxOffsetPx * Math.tanh(magnitude / this.limits.maxOffsetPx);
      clamped = magnitude - limited > 0.001;
      const scale = limited / magnitude;
      offsetX *= scale;
      offsetY *= scale;
    }

    const maxZoom = this.limits.maxZoomScale;
    const limitedZoom = clamp(zoomScale, 2 - maxZoom, maxZoom);
    const droppedSources = this.droppedSinceStep;
    this.droppedSinceStep = 0;

    return {
      offsetX,
      offsetY,
      zoomScale: limitedZoom,
      activeSources: this.sources.length,
      droppedSources,
      clamped: clamped || limitedZoom !== zoomScale,
    };
  }

  clear(): void {
    this.sources.length = 0;
    this.droppedSinceStep = 0;
  }

  getDebugSnapshot(): readonly { id: string | null; channel: FeedbackChannel; priority: number }[] {
    return this.sources.map((source) => ({
      id: source.id,
      channel: source.channel,
      priority: source.priority,
    }));
  }

  /** Verdrängt die schwächste Quelle, sobald das Limit überschritten ist. */
  private evictWeakest(nowMs: number): void {
    while (this.sources.length > this.limits.maxSources) {
      let weakestIndex = 0;
      let weakestWeight = Number.POSITIVE_INFINITY;
      for (let i = 0; i < this.sources.length; i += 1) {
        const source = this.sources[i];
        const t = source.durationMs > 0 ? (nowMs - source.startedMs) / source.durationMs : 1;
        // Bewusst die verbleibende Laufzeit und nicht die Hüllkurve: `impulse` steht zum
        // Startzeitpunkt auf null, damit wären beim Verdrängen alle Quellen gleich schwach und
        // es fiele die erstbeste statt der tatsächlich unwichtigsten.
        const remaining = 1 - clamp(t, 0, 1);
        const weight = Math.max(0, source.priority) * source.amplitudePx * remaining;
        if (weight < weakestWeight) {
          weakestWeight = weight;
          weakestIndex = i;
        }
      }
      this.sources.splice(weakestIndex, 1);
      this.droppedSinceStep += 1;
    }
  }
}
