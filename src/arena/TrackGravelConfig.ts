/**
 * Railway bed (TrackGravelField): a raised ballast bed with wooden sleepers and their tie
 * plates, a shoulder that slopes down to a ragged foot, loose stones beyond it and grass
 * growing back over the foot. The rails themselves are a separate, sharper sprite
 * (TRACK_RAIL_TEXTURE). All widths are world pixels, measured from the column's left edge.
 */
export const TRACK_GRAVEL_CONFIG = {
  /** Mean sleeper footprint across the 64 px column; each sleeper varies its ends. */
  sleeperLeftPx: 6,
  sleeperRightPx: 58,
  /** Independent jitter of each sleeper end and of its position along the line. */
  sleeperEndJitterPx: 1.6,
  sleeperShiftJitterPx: 1.4,
  /** Sleeper pitch along the line and the sleeper's own thickness (both along the line). */
  sleeperPitchPx: 16,
  sleeperWidthPx: 6.2,
  sleeperWidthJitterPx: 0.8,
  /** Maximum skew of a sleeper, as the slope of its long axis. */
  sleeperSkew: 0.035,
  /** Rail centre lines; the rail sprite is drawn on these and the tie plates sit below them. */
  railCentersPx: [13.5, 50.5] as const,
  /** Half extents of the steel tie plate under each rail, across and along the line. */
  tiePlateHalfLengthPx: 4.6,
  tiePlateHalfWidthPx: 2.3,
  /** Flat crest of the bed beyond the sleeper ends, varying along the line. */
  minCrestOverhangPx: 1,
  maxCrestOverhangPx: 6,
  /** Sloped shoulder from the crest to the foot of the bed, varying along the line. */
  minSlopePx: 4,
  maxSlopePx: 14,
  /** Loose stones spill this far beyond the foot; often almost nothing, sometimes a fan. */
  maxSpillPx: 16,
  /** Two-dimensional meander of the shoulder: bays and tongues of ballast at the foot. */
  footWarpPx: 8,
  /** Grey ballast from the gravel material: share of desaturation and overall gain. */
  ballastDesaturate: 0.5,
  ballastGain: 0.66,
  /** Darkening of the bed towards its foot (fraction lost at the foot). */
  footShade: 0.3,
  /** Contact shade of the ballast right next to a sleeper. */
  sleeperContactShade: 0.3,
  /** Brown rust and brake dust in the crib around the rails, and dust over the whole crib. */
  rustStrength: 0.32,
  cribDust: 0.3,
  /** Stone threshold on the crest: the darkest gaps show the dark bed between stones. */
  crestGapThreshold: 0.1,
  stoneSoftness: 0.12,
} as const;

/** Maximum visual reach of the bed beyond either edge of its 64 px column. */
export const TRACK_BALLAST_REACH_PX = Math.ceil(
  TRACK_GRAVEL_CONFIG.maxCrestOverhangPx + TRACK_GRAVEL_CONFIG.maxSlopePx + TRACK_GRAVEL_CONFIG.maxSpillPx
  + TRACK_GRAVEL_CONFIG.footWarpPx * 0.73 + TRACK_GRAVEL_CONFIG.sleeperEndJitterPx - TRACK_GRAVEL_CONFIG.sleeperLeftPx,
);

/** Rails only: two steel rails on transparent ground, at twice the world resolution. */
export const TRACK_RAIL_TEXTURE = {
  key: 'bg_tracks',
  path: './assets/sprites/track_rails.png',
  /** Texture pixels per world pixel; the column TileSprite uses the inverse as tile scale. */
  scale: 2,
  /** Texture pixels; one repeat covers 256 world pixels of line, with a rail joint per rail. */
  width: 128,
  height: 512,
} as const;
