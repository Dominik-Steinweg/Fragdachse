/** Shared Tesla material for the electrical body and its persistent ground trace. */
export const ZEUS_FX = {
  palette: { bed: 0x174baf, glow: 0x398bff, filament: 0x88dcff, core: 0xe5faff },
  strandIntervalMs: 70,
  strandLifeMs: 150,
  bedIntervalMs: 130,
  bedLifeMs: 300,
  fadeOutMs: 400,
  sampleSpacing: 12,
  maxGroundSamples: 1024,
  groundCapacity: 16384,
  bodyCapacity: 4096,
  coreReserve: 4096,
  shellPoints: 20,
  branchEvery: 4,
} as const;
