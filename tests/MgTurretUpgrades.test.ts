import { describe, expect, it } from 'vitest';
import { getCoopDefenseUpgradeDefinition, getCoopDefenseResolvedEffectTotals } from '../src/utils/coopDefenseUpgrades';
import { resolveMgTurretStats } from '../src/config/mgTurret';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';

const ids = ['mg_attrition','mg_calibration','mg_optics','mg_fire_superiority','mg_fire_control_network','mg_bleed','mg_handoff'];
describe('authored personal MG upgrades',()=>{
  it('uses both level-one branches for the boss and separates normal points from boss points',()=>{
    const boss=getCoopDefenseUpgradeDefinition('mg_fire_control_network')!;
    expect(boss.requires).toEqual([{upgradeId:'mg_calibration',minLevel:1},{upgradeId:'mg_fire_superiority',minLevel:1}]);
    expect(boss.costPerLevel).toBe(0);expect(boss.bossPointCostPerLevel).toBe(1);
    for(const id of ids.filter(id=>id!==boss.id)) {
      const node=getCoopDefenseUpgradeDefinition(id)!;expect(node.costPerLevel).toBe(1);
      expect(node.requires!.every(r=>r.minLevel===1)).toBe(true);
    }
  });
  it('resolves missing saved nodes to the new baseline and applies class-specific authored effects',()=>{
    const old={upgrades:{unlock_machine_gun_turret:{unlocked:true,level:1}}};
    const all={upgrades:Object.fromEntries(['unlock_machine_gun_turret',...ids].map(id=>[id,{unlocked:true,level:getCoopDefenseUpgradeDefinition(id)!.maxLevel}]))};
    const resolve=(profile:typeof old|typeof all,classId:'inspector_gadachs'|'dachs_of_steel'='inspector_gadachs')=>{
      const totals=getCoopDefenseResolvedEffectTotals(profile,classId);
      return resolveMgTurretStats(stat=>totals.additive[stat]??0,stat=>totals.percentage[stat]??0);
    };
    const baseline=resolve(old), upgraded=resolve(all);
    expect(baseline.network).toBe(false); expect(baseline.perHitPercent).toBe(0); expect(baseline.bleedLevel).toBe(0);
    expect(upgraded.damage).toBe(baseline.damage);
    expect(upgraded.targetRange/baseline.targetRange).toBeCloseTo(upgraded.projectileRange/baseline.projectileRange);
    expect(upgraded.targetRange).toBeGreaterThan(baseline.targetRange);
    expect(upgraded.cooldownMs).toBeLessThan(baseline.cooldownMs);
    expect(upgraded.maximumPercent).toBeGreaterThan(baseline.maximumPercent);
    expect(upgraded.network).toBe(true); expect(upgraded.bleedLevel).toBeGreaterThan(0); expect(upgraded.transferFraction).toBeGreaterThan(0);
    expect(resolve(all,'dachs_of_steel')).toEqual(baseline);
  });
  it.each(['de','en'] as const)('resolves descriptions in %s without missing placeholders',locale=>{
    for(const id of ['unlock_machine_gun_turret',...ids])expect(getUpgradeDescription(id,locale)).not.toMatch(/[{}⟦⟧]/);
  });
});
