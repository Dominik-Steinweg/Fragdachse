/** Versioned load choices. Change SCENARIO_VERSION after calibrating any of these values. */
export const PERFORMANCE_FIXTURE = {
  targetHp: 100_000,
  weaponEnemyCount: 16,
  enemyKinds: ['rabid-badger', 'thrower-badger', 'alien-badger', 'pyro-badger'],
  enemySpawnRadius: { min: 230, max: 650 },
  minimumGlobalRocks: 3500,
  remainingGlobalRocks: 1500,
  minimumDestructionFieldRocks: 200,
  combatWaveIntervalMs: 7500,
  observationIntervalMs: 100,
  resourceRefillIntervalMs: 250,
  // Map 14's final firefront footprint; freeze the load independently of campaign tuning.
  voidFire: {
    area: { type: 'rectangle', gridX: 35, gridY: 40, widthCells: 59, heightCells: 42, baseClearanceCells: 0 },
    spread: { direction: 'left-to-right', durationMs: 5000, roughnessCells: 3, warningLeadMs: 1000 },
    effect: { visualStyle: 'void', burnDurationMs: 2000, burnDamagePerTick: 0.5, sourceId: 'ground_fire.void_hunter' },
    preparationTimeoutMs: 30_000,
  },
} as const;
