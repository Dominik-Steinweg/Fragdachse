/**
 * Führt die Basis-Bildkomposition mit kurzzeitigen Ereignispulsen zusammen. Ohne Phaser-Import,
 * damit Priorisierung, Ausklingen und die Rückkehr auf Normalwerte prüfbar bleiben.
 *
 * Der Vertrag lautet: nach Ablauf aller Pulse steht wieder exakt die Basis. Ein Ereignis darf
 * niemals einen dauerhaften Rest an Sättigung, Kontrast, Vignette oder Verzerrung hinterlassen.
 */

import { NEUTRAL_WORLD_GRADE, type WorldGrade, WORLD_GRADE_CLAMPS } from './worldGrade';

export type PostFxEase = 'impulse' | 'linear' | 'expo';

export interface PostFxPulse {
  /** Stabile Kennung: erneutes Anfordern aktualisiert den Puls, statt ihn zu stapeln. */
  readonly id?: string;
  readonly priority: number;
  readonly durationMs: number;
  /** Deltas auf die Basis, nicht Absolutwerte. */
  readonly grade?: Partial<WorldGrade>;
  /** Nur für außergewöhnliche Ereignisse; 1 = neutral. */
  readonly barrel?: number;
  readonly ease?: PostFxEase;
}

export interface ResolvedPostFxState extends WorldGrade {
  readonly barrel: number;
  /** Wahr, wenn die gesamte Kette abgeschaltet werden kann. */
  readonly neutral: boolean;
  readonly activePulses: number;
}

interface ActivePulse {
  id: string | null;
  priority: number;
  durationMs: number;
  startedMs: number;
  grade: Partial<WorldGrade>;
  barrel: number;
  ease: PostFxEase;
}

/** Felder, die ein Puls als Delta auf die Basis legen darf. */
const ADDITIVE_FIELDS = [
  'saturation',
  'contrast',
  'brightness',
  'temperature',
  'tintStrength',
  'vignetteStrength',
  'bloomAmount',
] as const;

type AdditiveField = (typeof ADDITIVE_FIELDS)[number];

/** Absolute Felder – hier gewinnt der Puls mit der höchsten Priorität. */
const OVERRIDE_FIELDS = ['tint', 'vignetteRadius', 'bloomThreshold'] as const;

type OverrideField = (typeof OVERRIDE_FIELDS)[number];

export function postFxEnvelope(ease: PostFxEase, t: number): number {
  if (t <= 0) return ease === 'impulse' ? 0 : 1;
  if (t >= 1) return 0;
  if (ease === 'linear') return 1 - t;
  if (ease === 'expo') return (Math.exp(-3 * t) - Math.exp(-3)) / (1 - Math.exp(-3));
  // impulse: sehr kurzer Anstieg, dann zügiger Abfall – der Belichtungsstoß eines Ereignisses.
  const attack = 0.08;
  if (t < attack) return t / attack;
  const u = (t - attack) / (1 - attack);
  return (Math.exp(-4 * u) - Math.exp(-4)) / (1 - Math.exp(-4));
}

function clampField(field: keyof WorldGrade, value: number): number {
  const range = (WORLD_GRADE_CLAMPS as Partial<Record<string, readonly [number, number]>>)[field];
  if (!range) return value;
  return value < range[0] ? range[0] : value > range[1] ? range[1] : value;
}

/**
 * @param pulseClamps Erlaubt es, während eines Ereignisses über die Basisgrenzen hinauszugehen.
 *   Die Grenzen aus {@link WORLD_GRADE_CLAMPS} schützen die Dauerdarstellung; ein
 *   Nuke-Belichtungsstoß darf kurzzeitig deutlicher ausschlagen.
 */
export function composePostFx(
  base: WorldGrade,
  pulses: readonly ActivePulse[],
  nowMs: number,
  pulseClamps = true,
): ResolvedPostFxState {
  const result: Record<string, number> = {
    saturation: base.saturation,
    contrast: base.contrast,
    brightness: base.brightness,
    temperature: base.temperature,
    tintStrength: base.tintStrength,
    vignetteStrength: base.vignetteStrength,
    bloomAmount: base.bloomAmount,
  };
  let tint = base.tint;
  let vignetteRadius = base.vignetteRadius;
  let bloomThreshold = base.bloomThreshold;
  let barrel = 1;
  let activePulses = 0;
  let topPriority = -1;

  for (const pulse of pulses) {
    const t = pulse.durationMs > 0 ? (nowMs - pulse.startedMs) / pulse.durationMs : 1;
    if (t >= 1 || t < 0) continue;
    const gain = postFxEnvelope(pulse.ease, t);
    if (gain <= 0) continue;
    activePulses += 1;

    for (const field of ADDITIVE_FIELDS) {
      const delta = pulse.grade[field as AdditiveField];
      if (typeof delta === 'number') result[field] += delta * gain;
    }

    barrel += (pulse.barrel - 1) * gain;

    // Absolute Felder gehören dem wichtigsten laufenden Ereignis: zwei Farbprofile zu mitteln
    // ergäbe eine dritte Farbe, die keines der beiden Ereignisse meint.
    if (pulse.priority > topPriority) {
      topPriority = pulse.priority;
      for (const field of OVERRIDE_FIELDS) {
        const value = pulse.grade[field as OverrideField];
        if (typeof value !== 'number') continue;
        if (field === 'tint') tint = value;
        else if (field === 'vignetteRadius') vignetteRadius = value;
        else bloomThreshold = value;
      }
    }
  }

  if (pulseClamps) {
    for (const field of ADDITIVE_FIELDS) {
      result[field] = clampField(field, result[field]);
    }
    vignetteRadius = clampField('vignetteRadius', vignetteRadius);
    bloomThreshold = clampField('bloomThreshold', bloomThreshold);
  }

  const state: WorldGrade = {
    saturation: result.saturation,
    contrast: result.contrast,
    brightness: result.brightness,
    temperature: result.temperature,
    tint,
    tintStrength: result.tintStrength,
    vignetteRadius,
    vignetteStrength: result.vignetteStrength,
    bloomThreshold,
    bloomAmount: result.bloomAmount,
  };

  const neutral = activePulses === 0
    && barrel === 1
    && state.saturation === NEUTRAL_WORLD_GRADE.saturation
    && state.contrast === NEUTRAL_WORLD_GRADE.contrast
    && state.brightness === NEUTRAL_WORLD_GRADE.brightness
    && state.tintStrength === 0
    && state.vignetteStrength === 0
    && state.bloomAmount === 0;

  return { ...state, barrel, neutral, activePulses };
}

/** Verwaltet die laufenden Pulse. Reine Buchführung, kein Phaser. */
export class PostFxPulseSet {
  private readonly pulses: ActivePulse[] = [];

  request(pulse: PostFxPulse, nowMs: number): void {
    if (pulse.durationMs <= 0) return;
    const existing = pulse.id ? this.pulses.find((entry) => entry.id === pulse.id) : undefined;
    const next: ActivePulse = {
      id: pulse.id ?? null,
      priority: pulse.priority,
      durationMs: pulse.durationMs,
      startedMs: nowMs,
      grade: pulse.grade ?? {},
      barrel: pulse.barrel ?? 1,
      ease: pulse.ease ?? 'impulse',
    };
    if (existing) Object.assign(existing, next);
    else this.pulses.push(next);
  }

  release(id: string): void {
    const index = this.pulses.findIndex((entry) => entry.id === id);
    if (index >= 0) this.pulses.splice(index, 1);
  }

  /** Entfernt abgelaufene Pulse und liefert die noch laufenden. */
  prune(nowMs: number): readonly ActivePulse[] {
    for (let i = this.pulses.length - 1; i >= 0; i -= 1) {
      const pulse = this.pulses[i];
      if (pulse.durationMs <= 0 || nowMs - pulse.startedMs >= pulse.durationMs) {
        this.pulses.splice(i, 1);
      }
    }
    return this.pulses;
  }

  clear(): void {
    this.pulses.length = 0;
  }

  get size(): number {
    return this.pulses.length;
  }
}
