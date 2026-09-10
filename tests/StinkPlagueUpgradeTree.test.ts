import { describe, expect, it } from 'vitest';
import { getCoopDefenseUpgradeDefinition, getCoopDefenseResolvedEffectTotals } from '../src/utils/coopDefenseUpgrades';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { validateResolvedUtility } from '../src/loadout/content/LoadoutSchemas';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';

const ids=['stink_cloud_infection','stink_cloud_life_leech','stink_cloud_spread','stink_cloud_combat_mode',
  'stink_cloud_pandemic','stink_cloud_septic_shock','stink_cloud_slime_plague'];
describe('stink plague authored tree',()=>{
  it('requires both pre-boss branches and permits independent normal-point post-boss branches',()=>{
    const boss=getCoopDefenseUpgradeDefinition('stink_cloud_pandemic')!;
    expect(boss.requires).toEqual([{upgradeId:'stink_cloud_life_leech',minLevel:1},{upgradeId:'stink_cloud_combat_mode',minLevel:1}]);
    expect(boss.costPerLevel).toBe(0);expect(boss.bossPointCostPerLevel).toBe(1);
    for(const id of ids.slice(-2)) {
      const node=getCoopDefenseUpgradeDefinition(id)!; expect(node.requires).toEqual([{upgradeId:boss.id,minLevel:1}]);
      expect(node.costPerLevel).toBe(1);
    }
    for(const old of ['stink_cloud_radius','stink_cloud_damage','stink_cloud_aftercloud'])expect(getCoopDefenseUpgradeDefinition(old)).toBeNull();
  });
  it('resolves every nested field and scales cooldown/radius from base values',()=>{
    const profile={upgrades:Object.fromEntries(['unlock_stink_cloud',...ids].map(id=>[id,{unlocked:true,level:getCoopDefenseUpgradeDefinition(id)!.maxLevel}]))};
    const base=UTILITY_CONFIGS.STINK_CLOUD;
    const config=applyCoopDefenseModifiersToUtilityConfig(base,getCoopDefenseResolvedEffectTotals(profile,'dachs_of_steel'));
    if(base.type!=='stinkcloud'||config.type!=='stinkcloud')throw Error('config');
    const r1=getCoopDefenseUpgradeDefinition('stink_cloud_spread')!;
    expect(config.cooldown).toBeCloseTo(base.cooldown*(1+r1.effects[0].value*r1.maxLevel));
    expect(config.cloudRadius).toBeCloseTo(base.cloudRadius*(1+r1.effects[1].value*r1.maxLevel));
    expect(config.cloudDamagePerTick).toBe(base.cloudDamagePerTick);
    for(const id of ids.filter(id=>id!=='stink_cloud_spread'))for(const effect of getCoopDefenseUpgradeDefinition(id)!.effects) {
      const key=effect.stat.split('.').at(-1)! as keyof NonNullable<typeof config.plague>;
      expect(config.plague![key]).toBeCloseTo(base.plague![key]+effect.value*getCoopDefenseUpgradeDefinition(id)!.maxLevel);
    }
    expect(validateResolvedUtility(config)).toEqual([]);
    expect(validateResolvedUtility({...config,plague:{...config.plague,spreadIntervalMs:0}}).length).toBeGreaterThan(0);
  });
  it.each(['de','en'] as const)('resolves all description values in %s',locale=>{
    for(const id of ['unlock_stink_cloud',...ids])expect(getUpgradeDescription(id,locale)).not.toMatch(/[{}⟦⟧]/);
  });
});
