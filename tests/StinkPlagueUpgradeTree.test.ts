import { describe, expect, it } from 'vitest';
import { getCoopDefenseUpgradeDefinition, getCoopDefenseResolvedEffectTotals } from '../src/utils/coopDefenseUpgrades';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { validateResolvedUtility } from '../src/loadout/content/LoadoutSchemas';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';
import { plagueHarness, plagueTarget } from './StinkPlagueTestHelper';

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
  it('resolves every nested field and reduces base cooldown without changing the cloud radius',()=>{
    const profile={upgrades:Object.fromEntries(['unlock_stink_cloud',...ids].map(id=>[id,{unlocked:true,level:getCoopDefenseUpgradeDefinition(id)!.maxLevel}]))};
    const base=UTILITY_CONFIGS.STINK_CLOUD;
    const config=applyCoopDefenseModifiersToUtilityConfig(base,getCoopDefenseResolvedEffectTotals(profile,'dachs_of_steel'));
    if(base.type!=='stinkcloud'||config.type!=='stinkcloud')throw Error('config');
    const r1=getCoopDefenseUpgradeDefinition('stink_cloud_spread')!;
    expect(config.cooldown).toBeCloseTo(base.cooldown*(1+r1.effects[0].value*r1.maxLevel));
    expect(config.cloudRadius).toBe(base.cloudRadius);
    expect(config.cloudDamagePerTick).toBe(base.cloudDamagePerTick);
    for(const id of ids.filter(id=>id!=='stink_cloud_spread'))for(const effect of getCoopDefenseUpgradeDefinition(id)!.effects) {
      const key=effect.stat.split('.').at(-1)! as keyof NonNullable<typeof config.plague>;
      expect(config.plague![key]).toBeCloseTo(base.plague![key]+effect.value*getCoopDefenseUpgradeDefinition(id)!.maxLevel);
    }
    expect(validateResolvedUtility(config)).toEqual([]);
    expect(validateResolvedUtility({...config,plague:{...config.plague,spreadIntervalMs:0}}).length).toBeGreaterThan(0);
    expect(validateResolvedUtility({...config,plague:{...config.plague,pursuitMoveSpeedBonus:NaN}}).length).toBeGreaterThan(0);
    for(const generationDurationFactor of [0,-.5,1.1,NaN]) {
      expect(validateResolvedUtility({...config,plague:{...config.plague,generationDurationFactor}}).length).toBeGreaterThan(0);
    }
  });
  it('unlocks and scales duration per level with fixed tick damage and proportional Pandemic generations',()=>{
    const base=UTILITY_CONFIGS.STINK_CLOUD;
    if(base.type!=='stinkcloud'||!base.plague)throw Error('config');
    const upgrade=getCoopDefenseUpgradeDefinition('stink_cloud_infection')!;
    const durationPerLevel=upgrade.effects.find(effect=>effect.stat==='utility.STINK_CLOUD.plague.directDurationMs')!.value;
    for(let level=0;level<=upgrade.maxLevel;level++) {
      const profile={upgrades:{unlock_stink_cloud:{unlocked:true,level:1},stink_cloud_infection:{unlocked:level>0,level}}};
      const resolved=applyCoopDefenseModifiersToUtilityConfig(base,getCoopDefenseResolvedEffectTotals(profile,'dachs_of_steel'));
      if(resolved.type!=='stinkcloud'||!resolved.plague)throw Error('config');
      const config=resolved.plague;
      expect(config.directDurationMs).toBe(durationPerLevel*level);
      expect(config.damagePerTick).toBe(base.plague.damagePerTick);
      expect(config.tickIntervalMs).toBe(base.plague.tickIntervalMs);
      const {runtime,damage}=plagueHarness();
      const spacing=config.contactGap+20;
      const targets=[0,1,2].map(i=>plagueTarget('g'+i,spacing*i));
      runtime.applyDirect(targets[0],{ownerId:'p1',config:{...config,pandemicEnabled:1},damageMultiplier:1},0);
      if(level===0) {
        runtime.advance(targets,config.tickIntervalMs);
        expect(runtime.getSnapshot(0).targets).toEqual([]);
        expect(damage).not.toHaveBeenCalled();
        continue;
      }
      // Late transmission must use full authored duration, not the carrier's remaining time.
      const firstContact=config.directDurationMs*.75;
      runtime.advance(targets,firstContact);
      expect(damage.mock.calls.every(([,source])=>source.config.damagePerTick===base.plague!.damagePerTick)).toBe(true);
      expect(damage).toHaveBeenCalledTimes(Math.floor(firstContact/config.tickIntervalMs));
      runtime.spread(targets,firstContact);
      const secondContact=firstContact+config.spreadIntervalMs;
      runtime.spread(targets,secondContact);
      const snapshot=runtime.getSnapshot(secondContact).targets;
      const g1Duration=config.directDurationMs*config.generationDurationFactor;
      const g2Duration=g1Duration*config.generationDurationFactor;
      expect(snapshot.find(t=>t.enemyId==='g0')?.expiresAt).toBe(config.directDurationMs);
      expect(snapshot.find(t=>t.enemyId==='g1')?.expiresAt).toBe(firstContact+g1Duration);
      expect(snapshot.find(t=>t.enemyId==='g2')?.expiresAt).toBe(secondContact+g2Duration);
      runtime.advance(targets,secondContact+g2Duration);
      expect(runtime.isInfected(targets[2].ref,secondContact+g2Duration)).toBe(false);
      const g2Ticks=damage.mock.calls.filter(([target])=>target.id==='g2');
      expect(g2Ticks).toHaveLength(Math.floor(g2Duration/config.tickIntervalMs));
    }
  });
  it.each(['de','en'] as const)('resolves all description values in %s',locale=>{
    for(const id of ['unlock_stink_cloud',...ids])expect(getUpgradeDescription(id,locale)).not.toMatch(/[{}⟦⟧]/);
  });
});
