/**
 * Authored look of the slam and the stomp: the Rabid Rabbit's void haze (`PounceAuraGpuRenderer`,
 * the same smoke frame above the light map) in grave-light green, pushed out as a pressure wave.
 * Every puff stays inside the announced danger zone: a sector's haze is inset from its flanks by
 * the puff's own half length, so the fan and its warning share one outline.
 */
export const GRAVE_TITAN_IMPACT = {
  color: 0x36c95a,
  /** Where the body's edge and the slam's landing paws lie (world px from the centre). */
  bodyEdgePx: 100, pawReachPx: 138,
  /** Puff counts are authored per radian at this radius; a wider wave keeps the same spacing. */
  referencePx: 300,
  /** Stomp: a thin front rushes from the body edge to the struck rim, stretched along the wave... */
  front: { perRadian: 30, lifeMinMs: 460, lifeMaxMs: 600, diameterMin: 12, diameterMax: 18, growth: 1.9, stretch: 3.4,
    alpha: 0.28, overshoot: 1 },
  /** ...followed by a little slower haze that thins out inside the struck area. */
  trail: { perRadian: 5, travelMin: 0.4, travelMax: 0.95, lifeMinMs: 650, lifeMaxMs: 950, diameterMin: 10, diameterMax: 18,
    growth: 2.2, stretch: 1.8, alpha: 0.11 },
  /** Slam: a thick billow where the paws come down, then a dense fan rolling out to the rim. */
  slamBillow: { count: 28, travelMin: 18, travelMax: 64, lifeMinMs: 900, lifeMaxMs: 1300, diameterMin: 26, diameterMax: 40,
    growth: 2, stretch: 1.3, alpha: 0.3 },
  slamFront: { perRadian: 44, lifeMinMs: 520, lifeMaxMs: 680, diameterMin: 18, diameterMax: 26, growth: 1.8, stretch: 2.6,
    alpha: 0.36 },
  slamFill: { perRadian: 22, travelMin: 0.25, travelMax: 0.9, lifeMinMs: 800, lifeMaxMs: 1150, diameterMin: 18, diameterMax: 30,
    growth: 2.1, stretch: 1.6, alpha: 0.2 },
  /**
   * Salvo gather: haze is drawn in from around the body to the crown and vanishes in it, thicker
   * the further the gather has come (puffs per second at its start and on top at its end).
   */
  inhale: { rateBase: 18, rateGain: 70, startMin: 95, startMax: 175, endMin: 10, endMax: 28, lifeMinMs: 520, lifeMaxMs: 800,
    diameterMin: 13, diameterMax: 22, growth: 0.55, stretch: 2.2, alphaBase: 0.1, alphaGain: 0.2 },
} as const;

/** Half the length a puff of `diameter` reaches at the end of its life (grown and stretched). */
export function graveHazeHalfLength(diameter: number, growth: number, stretch: number): number {
  return diameter * growth * (1 + (stretch - 1) * 0.4) * 0.5;
}

/** Where one confirmed swing struck: its centre (the paws of a slam, the body of a stomp) and reach. */
export interface GraveTitanImpact {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly stomp: boolean;
}

/** A stomp strikes all around its body; a slam lands its paws ahead and strikes the sector beyond. */
export function graveTitanImpact(x: number, y: number, angle: number, arcDegrees: number, range: number): GraveTitanImpact {
  const fx = GRAVE_TITAN_IMPACT, stomp = arcDegrees >= 300;
  const reach = stomp ? 0 : Math.min(fx.pawReachPx, range);
  return { x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach, radius: stomp ? range : Math.max(48, range - reach), stomp };
}

/**
 * Directions a sector's haze may take at `radius` so that a puff of the given half length stays
 * inside the sector; a full circle has no flanks.
 */
export function graveHazeSpan(angle: number, arc: number, radius: number, halfLength: number): { from: number; span: number } {
  if (arc >= Math.PI * 2 - 1e-3) return { from: angle - Math.PI, span: Math.PI * 2 };
  const inset = Math.min(arc * 0.45, halfLength / Math.max(1, radius));
  return { from: angle - arc / 2 + inset, span: arc - 2 * inset };
}
