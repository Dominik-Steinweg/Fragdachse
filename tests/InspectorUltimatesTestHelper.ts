import type { BomberSquadronUltimateConfig, HoloOffensiveUltimateConfig } from '../src/loadout/LoadoutTypes';

// Contract inputs while authored content is integrated by lane A; expectations derive from these configs.
export const holoConfig: HoloOffensiveUltimateConfig = {
  id: 'HOLO_OFFENSIVE', type: 'holo_offensive', cooldown: 0, rageRequired: 300,
  ragePerSpawnSecond: 50, spawnIntervalMs: 750, copyLifetimeMs: 6000, materializeMs: 400,
  spawnRingRadiiPx: [120, 80, 160], spawnRingSlots: 12, clearanceRadiusPx: 16,
  minCopySpacingPx: 32, injectorProjectionEnabled: 0,
};
export const bomberConfig: BomberSquadronUltimateConfig = {
  id: 'BOMBER_SQUADRON', type: 'bomber_squadron', cooldown: 0, rageRequired: 300, rageCost: 300,
  droneCount: 8, bombsPerPass: 6, secondPassEnabled: 0, launchIntervalMs: 250,
  approachMs: 600, approachDistancePx: 240, runSpeedPxPerSec: 400,
  corridorLeadPx: 48, corridorLengthPx: 640, corridorWidthPx: 560,
  turnMs: 1000, departureMs: 600, bombFallMs: 250,
  explosionRadius: 72, maxDamage: 24, minDamage: 8, fireChunksPerBomb: 0,
};
