import type { ReactivePropPhase } from '../../world/reactiveProps/ReactivePropRuntime';

/** Reine Darstellungsableitung eines reaktiven Map-Objekts; kein Gameplay-Zustand. */
export interface ReactivePropVisualState {
  readonly visible: boolean;
  /** Brandstacks für den geteilten Entity-Brand (0 = kein Feuer). */
  readonly burnStacks: number;
  /** 0..1: Stärke des roten „gleich knallt es“-Pulses (Rot = Telegraph). */
  readonly warning: number;
}

export const REACTIVE_PROP_VISUAL = Object.freeze({
  /** Ab diesem HP-Anteil pulsiert ein brennendes Fass rot. */
  warningBelow: 0.3,
  minBurnStacks: 2,
  maxBurnStacks: 9,
  warningPulseHz: { slow: 2.2, fast: 9 },
  hitFlashMs: 90,
  hitFlashTint: 0x5c5c5c,
  warningTint: 0xa8280c,
});

export function resolveReactivePropVisual(phase: ReactivePropPhase, progress: number, nowMs: number): ReactivePropVisualState {
  if (phase === 'destroyed') return { visible: false, burnStacks: 0, warning: 0 };
  if (phase === 'idle' || phase === 'recharging') return { visible: true, burnStacks: 0, warning: 0 };
  const c = REACTIVE_PROP_VISUAL;
  if (phase === 'triggered') {
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 1000 * Math.PI * 2 * c.warningPulseHz.fast);
    return { visible: true, burnStacks: c.maxBurnStacks, warning: 0.6 + 0.4 * pulse };
  }
  const damage = 1 - Math.max(0, Math.min(1, progress));
  const burnStacks = Math.round(c.minBurnStacks + (c.maxBurnStacks - c.minBurnStacks) * damage);
  if (progress >= c.warningBelow) return { visible: true, burnStacks, warning: 0 };
  // Je weniger HP, desto schneller und kräftiger der Puls.
  const urgency = 1 - progress / c.warningBelow;
  const hz = c.warningPulseHz.slow + (c.warningPulseHz.fast - c.warningPulseHz.slow) * urgency;
  const pulse = 0.5 + 0.5 * Math.sin(nowMs / 1000 * Math.PI * 2 * hz);
  return { visible: true, burnStacks, warning: (0.25 + 0.55 * urgency) * pulse };
}
