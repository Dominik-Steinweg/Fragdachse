import { expect, it } from 'vitest';
import { getCoopDefenseMapConfig } from '../../src/config/coopDefenseMaps';
import { getDawnEnemyThreatCost, getDawnSchedule, getDawnWaveBlock } from '../../src/config/dawn/dawnContent';
import { composeDawnRoundPlans } from '../../src/dawn/composition/DawnRoundComposition';
import { getDawnPhaseStartMs, resolveDawnPhase } from '../../src/dawn/rules/DawnPhase';

const isSpecial = (kind: string) => !['zombie-badger', 'demon-badger', 'rabid-rabbit'].includes(kind);

it('anchors entry pressure and specialists to campaign endgame and escalates actual composed pressure', () => {
  const campaign = ['18', '19'].map(id => {
    const map = getCoopDefenseMapConfig(id);
    const groups = map.encounters!.flatMap(encounter => encounter.groups);
    const count = groups.reduce((sum, group) => sum + group.count, 0);
    return {
      costPerMinute: groups.reduce((sum, group) => sum + group.count * getDawnEnemyThreatCost(group.enemyKind), 0)
        / (map.balanceReferenceDurationSec! / 60),
      specialShare: groups.filter(group => isSpecial(group.enemyKind)).reduce((sum, group) => sum + group.count, 0) / count,
    };
  });
  // Map 20's Kraken is not assigned an invented wave cost: its support alone is no pressure anchor.
  expect(getCoopDefenseMapConfig('20').objective).toBe('defeat-boss');
  let previousPressure = 0;
  for (let threat = 1; threat <= 10; threat++) {
    let cost = 0, enemies = 0, special = 0, minutes = 0;
    for (let seed = 0; seed < 512; seed++) {
      const { activity } = composeDawnRoundPlans({ seed, threat, dayNumber: 1 });
      const schedule = getDawnSchedule(activity.scheduleId);
      const window = resolveDawnPhase(schedule, getDawnPhaseStartMs(schedule, 'night'));
      minutes += (window.phaseEndMs - window.phaseStartMs) / 60000;
      for (const wave of activity.waves) {
        if ('siteId' in wave || resolveDawnPhase(schedule, wave.atMs).phase !== 'night') continue;
        const block = getDawnWaveBlock(wave.blockId);
        cost += block.cost;
        for (const group of block.groups) {
          enemies += group.count;
          if (isSpecial(group.enemyKind)) special += group.count;
        }
      }
    }
    const pressure = cost / minutes;
    if (threat === 1) {
      const reference = campaign.reduce((sum, map) => sum + map.costPerMinute, 0) / campaign.length;
      expect(pressure).toBeGreaterThan(reference * 0.8);
      expect(pressure).toBeLessThan(reference * 1.3);
      expect(special / enemies).toBeGreaterThan(Math.min(...campaign.map(map => map.specialShare)) * 0.6);
    } else expect(pressure).toBeGreaterThan(previousPressure * 1.1);
    previousPressure = pressure;
  }
}, 30000);
