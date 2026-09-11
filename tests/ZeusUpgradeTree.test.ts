import { describe, expect, it } from 'vitest';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals, getCoopDefenseUpgradeDefinition, getCoopDefenseUpgradeTextureKey } from '../src/utils/coopDefenseUpgrades';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';
import { validateResolvedUtility } from '../src/loadout/content/LoadoutSchemas';

const ids = ['zeus_dynamo', 'zeus_nerve_shock', 'zeus_ball_lightning', 'zeus_electric_ground',
  'zeus_thunderfront', 'zeus_lightning_flood', 'zeus_breakthrough'];
describe('Zeus authored upgrade tree', () => {
  it('resolves every authored level through the existing utility modifier path', () => {
    const base = UTILITY_CONFIGS.ZEUS_TASER;
    if (base.type !== 'taser') throw new Error('Zeus config');
    const nodes = ids.map(id => getCoopDefenseUpgradeDefinition(id)!);
    const profile = { upgrades: { ...Object.fromEntries(nodes.map(n => [n.id, { unlocked: true, level: n.maxLevel }])),
      unlock_zeus_taser: { unlocked: true, level: 1 } } };
    const totals = getCoopDefenseResolvedEffectTotals(profile, 'dachs_nukem');
    const result = applyCoopDefenseModifiersToUtilityConfig(base, totals);
    if (result.type !== 'taser') throw new Error('Zeus config');
    expect(validateResolvedUtility(result)).toEqual([]);
    for (const node of nodes) for (const effect of node.effects) {
      if (effect.stat.startsWith('utility.ZEUS_TASER.zeus.')) {
        const field = effect.stat.split('.').at(-1)! as keyof typeof base.zeus;
        expect(result.zeus[field]).toBe((base.zeus[field] as number) + effect.value * node.maxLevel);
      } else {
        expect(totals.percentage[effect.stat]).toBeCloseTo(effect.value * node.maxLevel);
      }
      expect(getCoopDefenseUpgradeTextureKey(node.id)).toBeTruthy();
      for (const locale of ['de', 'en'] as const) expect(getUpgradeDescription(node.id, locale)).not.toMatch(/[{}⟦⟧]/);
    }
    const boss = getCoopDefenseUpgradeDefinition('zeus_thunderfront')!;
    expect(boss.requires).toEqual([{ upgradeId: 'zeus_nerve_shock', minLevel: 1 }, { upgradeId: 'zeus_electric_ground', minLevel: 1 }]);
    expect(boss.costPerLevel).toBe(0); expect(boss.bossPointCostPerLevel).toBe(1);
  });
  it('scales body duration at every level without modifying dash range', () => {
    const ball = getCoopDefenseUpgradeDefinition('zeus_ball_lightning')!;
    const dash = getCoopDefenseUpgradeDefinition('dash_range')!;
    const duration = ball.effects.find(e => e.stat === 'utility.ZEUS_TASER.zeus.ballDurationMs')!;
    const general = dash.effects.find(e => e.stat === 'player.dashRange')!;
    for (let level = 1; level <= ball.maxLevel; level++) {
      const totals = getCoopDefenseResolvedEffectTotals({ upgrades: {
        unlock_zeus_taser: { unlocked: true, level: 1 },
        [ball.id]: { unlocked: true, level },
        [dash.id]: { unlocked: true, level: dash.maxLevel },
      } }, 'dachs_nukem');
      const config = applyCoopDefenseModifiersToUtilityConfig(UTILITY_CONFIGS.ZEUS_TASER, totals);
      if (config.type !== 'taser') throw new Error('Zeus config');
      expect(config.zeus.ballDurationMs).toBe(duration.value * level);
      expect(validateResolvedUtility(config)).toEqual([]);
      expect(totals.percentage[general.stat]).toBeCloseTo(general.value * dash.maxLevel);
    }
  });
  it('rejects malformed counts, flags, speed and homing timing', () => {
    const base = UTILITY_CONFIGS.ZEUS_TASER;
    if (base.type !== 'taser') throw new Error('Zeus config');
    for (const zeus of [{ ...base.zeus, boltCount: 2.5 }, { ...base.zeus, ballDurationMs: -1 }, { ...base.zeus, groundEnabled: 2 },
      { ...base.zeus, boltSpeed: 0 }, { ...base.zeus, boltHoming: { ...base.zeus.boltHoming, retargetIntervalMs: NaN } }]) {
      expect(validateResolvedUtility({ ...base, zeus }).length).toBeGreaterThan(0);
    }
  });
});
