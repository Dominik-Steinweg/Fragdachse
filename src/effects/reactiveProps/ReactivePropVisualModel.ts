import type { ReactivePropPhase } from '../../world/reactiveProps/ReactivePropRuntime';

/** Reine Darstellungsableitung eines reaktiven Map-Objekts; kein Gameplay-Zustand. */
export interface ReactivePropVisualState {
  readonly visible: boolean;
  /** Brandstacks für den geteilten Entity-Brand (0 = kein Feuer). */
  readonly burnStacks: number;
  /** 0..1: Deckkraft des roten Telegraph-Rings („gleich knallt es“; Rot = Telegraph). */
  readonly warning: number;
  /** Ringradius relativ zur Fassgröße; er zieht sich mit sinkenden HP zusammen. */
  readonly warningScale: number;
}

export const REACTIVE_PROP_VISUAL = Object.freeze({
  /** Ab diesem HP-Anteil pulsiert ein brennendes Fass rot. */
  warningBelow: 0.3,
  // Wenige Stacks: sichtbare Flammen auf dem Deckel statt eines überstrahlten Glühens.
  minBurnStacks: 1,
  maxBurnStacks: 2,
  warningPulseHz: { slow: 2.2, fast: 9 },
  warningScale: { far: 1.75, near: 1.12 },
  warningColor: 0xff2a14,
  hitFlashMs: 90,
  hitFlashTint: 0x5c5c5c,
});

export function resolveReactivePropVisual(phase: ReactivePropPhase, progress: number, nowMs: number): ReactivePropVisualState {
  const c = REACTIVE_PROP_VISUAL;
  if (phase === 'destroyed') return { visible: false, burnStacks: 0, warning: 0, warningScale: c.warningScale.far };
  if (phase === 'idle' || phase === 'recharging') return { visible: true, burnStacks: 0, warning: 0, warningScale: c.warningScale.far };
  if (phase === 'triggered') {
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 1000 * Math.PI * 2 * c.warningPulseHz.fast);
    return { visible: true, burnStacks: c.maxBurnStacks, warning: 0.65 + 0.35 * pulse, warningScale: c.warningScale.near };
  }
  const damage = 1 - Math.max(0, Math.min(1, progress));
  const burnStacks = Math.round(c.minBurnStacks + (c.maxBurnStacks - c.minBurnStacks) * damage);
  if (progress >= c.warningBelow) return { visible: true, burnStacks, warning: 0, warningScale: c.warningScale.far };
  // Je weniger HP, desto enger, schneller und kräftiger pulsiert der Ring.
  const urgency = 1 - progress / c.warningBelow;
  const hz = c.warningPulseHz.slow + (c.warningPulseHz.fast - c.warningPulseHz.slow) * urgency;
  const pulse = 0.5 + 0.5 * Math.sin(nowMs / 1000 * Math.PI * 2 * hz);
  return { visible: true, burnStacks, warning: (0.35 + 0.5 * urgency) * (0.55 + 0.45 * pulse),
    warningScale: c.warningScale.far + (c.warningScale.near - c.warningScale.far) * urgency };
}
