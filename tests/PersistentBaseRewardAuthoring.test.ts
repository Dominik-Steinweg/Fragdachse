import { describe, expect, it } from 'vitest';
import {
  normalizeCoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import rawMap16 from '../src/config/coopDefenseMaps/16-zeitzuender.json';
import rawMap1 from '../src/config/coopDefenseMaps/01-feuertaufe.json';
import rawMap4 from '../src/config/coopDefenseMaps/04-adrenalinrausch.json';
import rawMap6 from '../src/config/coopDefenseMaps/06-sporenfront.json';
import rawMap7 from '../src/config/coopDefenseMaps/07-medic.json';
import rawMap8 from '../src/config/coopDefenseMaps/08-dimensionsbruch.json';
import rawMap9 from '../src/config/coopDefenseMaps/09-ueberleben.json';
import rawMap12 from '../src/config/coopDefenseMaps/12-gegenschlag.json';
import type { CoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import {
  toAuthoredScenario,
  toCoopDefenseMapConfig,
  toCoopMissionDefinition,
} from '../src/config/authoring/coopDefenseAuthoringAdapter';

describe('Persistent-Base-Reward-Authoring', () => {
  it('normalizes map and secondary-objective reward IDs and preserves the adapter round trip', () => {
    const source = rawMap16 as unknown as CoopDefenseMapConfig;
    const firstObjective = source.secondaryObjectives?.[0];
    const authored = normalizeCoopDefenseMapConfig({
      ...source,
      persistentBaseRewardsOnVictory: ['base_spore_turret'],
      secondaryObjectives: firstObjective
        ? [{
          ...firstObjective,
          rewards: {
            ...firstObjective.rewards,
            persistentBaseRewardsOnComplete: ['base_health_pedestal'],
          },
        }, ...(source.secondaryObjectives?.slice(1) ?? [])]
        : source.secondaryObjectives,
    });
    expect(authored.persistentBaseRewardsOnVictory).toEqual(['base_spore_turret']);
    expect(authored.secondaryObjectives?.[0]?.rewards?.persistentBaseRewardsOnComplete)
      .toEqual(['base_health_pedestal']);
    expect(toCoopMissionDefinition(authored).persistentBaseRewardsOnVictory)
      .toEqual(['base_spore_turret']);
    expect(toCoopDefenseMapConfig(toAuthoredScenario(authored))).toEqual(authored);
  });

  it('rejects unknown and duplicate stable reward IDs', () => {
    const source = rawMap1 as unknown as CoopDefenseMapConfig;
    expect(() => normalizeCoopDefenseMapConfig({
      ...source,
      persistentBaseRewardsOnVictory: ['not-a-reward'] as never,
    })).toThrow(/persistentBaseRewardsOnVictory/);
    expect(() => normalizeCoopDefenseMapConfig({
      ...source,
      persistentBaseRewardsOnVictory: ['base_health_pedestal', 'base_health_pedestal'],
    })).toThrow(/persistentBaseRewardsOnVictory/);
  });

  it('authors the campaign victory rewards and leaves Map 9 without one', () => {
    const authoredRewards = [
      [rawMap4, 'base_adrenaline_pedestal'],
      [rawMap6, 'base_spore_turret'],
      [rawMap7, 'base_health_pedestal'],
      [rawMap8, 'base_rocket_turret'],
    ] as const;
    for (const [rawMap, rewardId] of authoredRewards) {
      expect(normalizeCoopDefenseMapConfig(rawMap as unknown as CoopDefenseMapConfig)
        .persistentBaseRewardsOnVictory).toEqual([rewardId]);
    }
    expect(normalizeCoopDefenseMapConfig(rawMap9 as unknown as CoopDefenseMapConfig)
      .persistentBaseRewardsOnVictory).toBeUndefined();
  });

  it('restores Map 12 supply-base authoring with a permanent HHG reward', () => {
    const map = normalizeCoopDefenseMapConfig(rawMap12 as unknown as CoopDefenseMapConfig);
    const objective = map.secondaryObjectives?.find((entry) => entry.id === 'hold-supply-base');

    expect(map.bases.find((base) => base.id === 'supply-base')).toMatchObject({
      role: 'outpost',
      dormant: true,
      startHpFactor: 0.35,
      hpMax: 1400,
    });
    expect(map.encounters?.map((encounter) => encounter.id)).toEqual(['reveal', 'defend', 'closing']);
    expect(objective).toMatchObject({
      type: 'hold',
      start: { type: 'after-encounter', encounterId: 'reveal' },
      holdUntil: { type: 'after-encounter', encounterId: 'defend' },
      targets: ['supply-base'],
      targetGoal: 1,
      rewards: {
        repairTargetOnComplete: false,
        persistentBaseRewardsOnComplete: ['base_holy_hand_grenade_pedestal'],
      },
    });
    expect(objective?.rewards?.placeablePedestalOnComplete).toBeUndefined();
    expect(map.powerUps.some((powerUp) => powerUp.defId === 'HOLY_HAND_GRENADE')).toBe(false);
  });
});
