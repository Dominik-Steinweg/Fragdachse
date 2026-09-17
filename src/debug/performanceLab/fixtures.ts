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
} as const;
