import { DEPTH, DEPTH_LIGHTING } from '../config';

/**
 * Depth bands of a lying power-up.
 *
 * Shadow and token are ground material: lit by sun, clouds and the light map, below figures.
 * The emissive parts (ring, channel, halo, hovering symbol, glint) sit just above the light map
 * and below the canopy (band E), so a pickup reads at night and through ground fog. The symbol
 * belongs there too: it is the pickup's meaning and must not drown in either.
 */
export const POWERUP_ITEM_DEPTH = {
  shadow: DEPTH.PLAYERS - 0.8,
  token: DEPTH.PLAYERS - 0.78,
  glow: DEPTH_LIGHTING + 0.07,
  symbolShadow: DEPTH_LIGHTING + 0.08,
  symbol: DEPTH_LIGHTING + 0.09,
  glint: DEPTH_LIGHTING + 0.1,
} as const;
