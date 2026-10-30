/**
 * Authored look of the slam and the stomp: the Rabid Rabbit's void haze (`PounceWindupGpuRenderer`,
 * the same smoke frame above the light map) in grave-light green, pushed out as a pressure wave.
 */
export const GRAVE_TITAN_IMPACT = {
  color: 0x36c95a,
  /** Where the body's edge and the slam's landing paws lie (world px from the centre). */
  bodyEdgePx: 96, pawReachPx: 138,
  /** A thin front rushes from the body edge to the struck rim, stretched along the wave. */
  front: { perRadian: 30, lifeMinMs: 440, lifeMaxMs: 580, diameterMin: 11, diameterMax: 17, growth: 1.9, stretch: 3.4,
    alpha: 0.27, overshoot: 1.03 },
  /** ...followed by a little slower haze that thins out inside the struck area. */
  trail: { perRadian: 5, travelMin: 0.4, travelMax: 0.95, lifeMinMs: 650, lifeMaxMs: 950, diameterMin: 10, diameterMax: 18,
    growth: 2.2, stretch: 1.8, alpha: 0.11 },
} as const;

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
