import { describe, expect, it } from 'vitest';
import { molotovLevels, resolvedMolotov } from '../MolotovTestHelper';
import { getCoopDefenseUpgradeDefinition } from '../../src/utils/coopDefenseUpgrades';

describe('Molotov approved follow-up progression', () => {
  it('provides two chunks and one second per level across three levels', () => {
    for (const id of ['molotov_wildfire_chunks', 'molotov_firewalker'])
      expect(getCoopDefenseUpgradeDefinition(id)?.maxLevel).toBe(3);
    for (let level = 0; level <= 3; level++) {
      const cfg = resolvedMolotov({ ...molotovLevels, molotov_wildfire_chunks: level, molotov_firewalker: level });
      expect(cfg.wildfireChunkCount).toBe(level * 2);
      expect(cfg.firewalkerDurationMs).toBe(level * 1000);
      expect(cfg.wildfireChunkRadius).toBe(96);
      expect(cfg.wildfireChunkFlightMs).toBe(320);
    }
  });
});
