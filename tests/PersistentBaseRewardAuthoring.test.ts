import { describe, expect, it } from 'vitest';
import {
  normalizeCoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import rawMap16 from '../src/config/coopDefenseMaps/16-zeitzuender.json';
import rawMap1 from '../src/config/coopDefenseMaps/01-feuertaufe.json';
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
});
