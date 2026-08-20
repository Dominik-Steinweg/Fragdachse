/**
 * Stable seed derivation for benchmark concerns.
 *
 * Layout and weapon randomness deliberately use different streams.  The constants are part of
 * the benchmark contract: changing the layout generator must not shift ShotPlan RNG rolls.
 */
export interface DerivedBenchmarkSeeds {
  readonly benchmarkSeed: number;
  readonly layoutSeed: number;
  readonly weaponSeed: number;
}

function mixSeed(seed: number, salt: number): number {
  let value = (seed >>> 0) ^ (salt >>> 0);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

/** Derives independent deterministic streams from one public benchmark seed. */
export function deriveBenchmarkSeeds(benchmarkSeed: number): DerivedBenchmarkSeeds {
  const normalized = benchmarkSeed >>> 0;
  return {
    benchmarkSeed: normalized,
    layoutSeed: mixSeed(normalized, 0x4c41594f), // "LAYO"
    weaponSeed: mixSeed(normalized, 0x57454150), // "WEAP"
  };
}

