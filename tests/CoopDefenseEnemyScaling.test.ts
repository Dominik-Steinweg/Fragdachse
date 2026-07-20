import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_ENEMY_CONFIGS,
  resolveCoopDefenseEnemyConfigs,
} from '../src/config/coopDefenseEnemies';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  resolveCoopDefenseMapWaveConfigs,
} from '../src/config/coopDefenseMaps';

describe('Coop defense multiplayer scaling', () => {
  it('scales only enemy HP linearly with the human player count', () => {
    for (const playerCount of [1, 2, 3, 4]) {
      const resolved = resolveCoopDefenseEnemyConfigs(playerCount);
      for (const [kind, base] of Object.entries(COOP_DEFENSE_ENEMY_CONFIGS)) {
        expect(base.playerScaling?.moveSpeedFactorPerAdditionalPlayer).toBeUndefined();
        expect(base.spawnScaling).toBeUndefined();
        const hpFactor = base.playerScaling?.maxHpFactorPerAdditionalPlayer ?? 0;
        const expectedMaxHp = Math.max(1, Math.round(base.maxHp * (1 + hpFactor * (playerCount - 1))));
        expect(resolved[kind].maxHp).toBe(expectedMaxHp);
        expect(resolved[kind].moveSpeed).toBe(base.moveSpeed);
        expect(resolved[kind].xp).toBe(base.xp);
      }
    }
  });

  it('keeps every map wave unchanged as players join', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      expect(resolveCoopDefenseMapWaveConfigs(map, 4)).toEqual(
        resolveCoopDefenseMapWaveConfigs(map, 1),
      );
    }
  });
});
