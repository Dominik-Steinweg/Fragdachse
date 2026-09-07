export interface AdrenalineEssenceConfig {
  readonly landingMinMs: number;
  readonly landingMaxMs: number;
  readonly groundLifetimeMs: number;
  readonly mergeWindowMs: number;
  readonly mergeRadius: number;
  readonly magnetRadius: number;
  readonly transferMinMs: number;
  readonly transferMaxMs: number;
  readonly dedupeRetentionMs: number;
  readonly fragmentsPerReward: number;
  readonly scatterAngleJitterDegrees: number;
  readonly scatterMinRadius: number;
  readonly scatterMaxRadius: number;
  readonly groundClearance: number;
}

export const ADRENALINE_ESSENCE_CONFIG: AdrenalineEssenceConfig = Object.freeze({
  landingMinMs: 150,
  landingMaxMs: 250,
  groundLifetimeMs: 8_000,
  mergeWindowMs: 150,
  mergeRadius: 32,
  magnetRadius: 160,
  transferMinMs: 120,
  transferMaxMs: 300,
  dedupeRetentionMs: 30_000,
  fragmentsPerReward: 3,
  scatterAngleJitterDegrees: 10,
  scatterMinRadius: 30,
  scatterMaxRadius: 45,
  groundClearance: 3,
});
