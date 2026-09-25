/**
 * Railway ballast bed (TrackGravelField): dense ballast below the sleepers, a ragged shoulder
 * where the stones thin out into a dark, compacted soil bed, and the surrounding organic soil
 * margin of the map. All widths are world pixels.
 */
export const TRACK_GRAVEL_CONFIG = {
  // Visible sleeper footprint in the unchanged 64x32 BahnstreckeSchienen.png.
  sleeperLeftPx: 6,
  sleeperRightPx: 58,
  /** Dense ballast reaches this far beyond the sleeper ends, varying along the line. */
  minCoreOverhangPx: 1,
  maxCoreOverhangPx: 5,
  /** Shoulder beyond the dense core where stones thin out, varying along the line. */
  minShoulderPx: 10,
  maxShoulderPx: 34,
  /** Stone clump size of the thinning shoulder, and the softness of each stone edge. */
  stoneClumpPx: 5,
  stoneSoftness: 0.12,
  /** Opacity and darkening of the compacted soil bed below the ballast. */
  soilBedAlpha: 0.75,
  soilBedDarken: 0.45,
  /** Grey ballast from the gravel material: share of desaturation and overall gain. */
  ballastDesaturate: 0.4,
  ballastGain: 0.62,
  /** Stone threshold inside the dense core: the darkest gaps show the soil bed between stones. */
  coreGapThreshold: 0.2,
} as const;

/** Maximum visual reach of the ballast bed beyond a column's sleeper footprint. */
export const TRACK_BALLAST_REACH_PX = TRACK_GRAVEL_CONFIG.maxCoreOverhangPx + TRACK_GRAVEL_CONFIG.maxShoulderPx;
