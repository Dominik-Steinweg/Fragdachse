import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_ENEMY_CONFIGS,
  MAX_REGULAR_ENEMY_SIZE_PX,
  resolveCoopDefenseEnemyConfigs,
} from '../src/config/coopDefenseEnemies';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  resolveCoopDefenseMapPersistentSpawnConfigs,
} from '../src/config/coopDefenseMaps';
import { scaleByCoopDefenseHumanPlayers } from '../src/config/coopDefenseScaling';

describe('Coop defense multiplayer scaling', () => {
  it('keeps every regular enemy at or below the shared 30px size limit', () => {
    for (const [kind, config] of Object.entries(COOP_DEFENSE_ENEMY_CONFIGS)) {
      if (config.isBoss) continue;
      expect(config.size, kind).toBeLessThanOrEqual(MAX_REGULAR_ENEMY_SIZE_PX);
    }
  });

  it('keeps boss sizes exempt from the regular enemy limit', () => {
    const bossSizes = Object.values(COOP_DEFENSE_ENEMY_CONFIGS)
      .filter((config) => config.isBoss)
      .map((config) => config.size);
    expect(bossSizes.some((size) => size > MAX_REGULAR_ENEMY_SIZE_PX)).toBe(true);
  });

  it('keeps the tested boss and medic tuning in the enemy registry', () => {
    expect(COOP_DEFENSE_ENEMY_CONFIGS['grave-titan'].maxHp).toBe(Math.round(750 * 1.25));
    expect(COOP_DEFENSE_ENEMY_CONFIGS['inferno-colossus'].moveSpeed).toBe(185);
    expect(COOP_DEFENSE_ENEMY_CONFIGS['inferno-colossus'].moveSpeed).toBeLessThan(200);
    expect(COOP_DEFENSE_ENEMY_CONFIGS['plague-medic'].maxHp).toBe(100);
  });

  it('scales only enemy HP linearly with the human player count', () => {
    for (const playerCount of [1, 2, 3, 4]) {
      const resolved = resolveCoopDefenseEnemyConfigs(playerCount);
      for (const [kind, base] of Object.entries(COOP_DEFENSE_ENEMY_CONFIGS)) {
        expect(base.playerScaling?.moveSpeedFactorPerAdditionalPlayer).toBeUndefined();
        expect(base.spawnScaling).toBeUndefined();
        if (base.playerScaling) {
          expect(Number.isFinite(base.playerScaling.maxHpFactorPerAdditionalPlayer)).toBe(true);
        }
        const hpFactor = base.playerScaling?.maxHpFactorPerAdditionalPlayer ?? 0;
        const expectedMaxHp = Math.max(1, Math.round(base.maxHp * (1 + hpFactor * (playerCount - 1))));
        expect(resolved[kind].maxHp).toBe(expectedMaxHp);
        expect(resolved[kind].moveSpeed).toBe(base.moveSpeed);
        expect(resolved[kind].xp).toBe(base.xp);
      }
    }
  });

  it('keeps every persistent source unchanged as players join when no enemy scaling is configured', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      expect(resolveCoopDefenseMapPersistentSpawnConfigs(map, 4)).toEqual(
        resolveCoopDefenseMapPersistentSpawnConfigs(map, 1),
      );
    }
  });

  it('applies the player formula to artificial positive and negative factors', () => {
    const baseValue = 100;
    expect(scaleByCoopDefenseHumanPlayers(baseValue, 0.25, 1)).toBe(baseValue);
    expect(scaleByCoopDefenseHumanPlayers(baseValue, 0.25, 3)).toBe(150);
    expect(scaleByCoopDefenseHumanPlayers(baseValue, -0.25, 3)).toBeCloseTo(100 / 1.5);
  });
});
