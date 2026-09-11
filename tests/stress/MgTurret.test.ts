import { describe, expect, it } from 'vitest';
import { mgHarness, mgOwner, mgTarget } from '../MgTurretTestHelper';
import { resolveMgTurretStats } from '../../src/config/mgTurret';
import { getCoopDefenseUpgradeDefinition, getCoopDefenseResolvedEffectTotals } from '../../src/utils/coopDefenseUpgrades';
import { MG_TURRET_RULES } from '../../src/config/mgTurretRules';

const upgrades=['unlock_machine_gun_turret','mg_attrition','mg_calibration','mg_optics','mg_fire_superiority','mg_fire_control_network','mg_bleed','mg_handoff'];
const totals=getCoopDefenseResolvedEffectTotals({upgrades:Object.fromEntries(upgrades.map(id=>[id,{unlocked:true,level:getCoopDefenseUpgradeDefinition(id)!.maxLevel}]))},'inspector_gadachs');
const stats=resolveMgTurretStats(stat=>totals.additive[stat]??0,stat=>totals.percentage[stat]??0);
describe('MG battery scenarios',()=>{
  it.each([1,5,10])('measures buildup, direct damage and bleeding for %i MGs shared by multiple players',count=>{
    const owners=[0,1,2].map(i=>mgOwner('p'+i,stats)),h=mgHarness(owners);
    let direct=0,firstMaximum:number|undefined,shots=0,last=0;
    for(let frame=0;frame<200;frame++) {
      const now=frame*stats.cooldownMs;h.runtime.advance(now);
      for(let t=0;t<count;t++) {
        const owner=owners[t%owners.length];
        direct+=stats.damage*(1+h.runtime.getPercent(owner.id,'t'+t,h.target.ref,now)/100);shots++;
        h.runtime.hit(owner.id,'t'+t,h.target,now);
      }
      if(firstMaximum===undefined&&h.runtime.getPercent('p0','t0',h.target.ref,now)===stats.maximumPercent)firstMaximum=now;
      last=now;
    }
    const expectedShots=Math.ceil(stats.maximumPercent/stats.perHitPercent),expectedTime=(Math.ceil(expectedShots/count)-1)*stats.cooldownMs;
    expect(firstMaximum).toBeCloseTo(expectedTime);
    expect(direct).toBeGreaterThan(shots*stats.damage);expect(direct).toBeLessThanOrEqual(shots*stats.damage*(1+stats.maximumPercent/100));
    expect(h.total()).toBeGreaterThan(0);
    expect(h.total()).toBeLessThanOrEqual(last/1000*stats.maximumPercent/100*stats.bleedLevel);
    h.runtime.advance(last+MG_TURRET_RULES.durationMs);expect(h.runtime.snapshot(last+MG_TURRET_RULES.durationMs).targets).toEqual([]);
    console.info(JSON.stringify({scenario:'MG battery',turrets:count,players:owners.length,buildupMs:firstMaximum,shots,directDamage:direct,bleedDamage:h.total()}));
  });
  it('settles a 600-target network once per target and tick without multiplying damage by turret count',()=>{
    const h=mgHarness([mgOwner('p1',stats),mgOwner('p2',stats)]),targets=Array.from({length:600},(_,i)=>mgTarget('e'+i,i*300));
    h.setTargets(targets);
    for(const target of targets)for(let t=0;t<10;t++)h.runtime.hit(t%2?'p1':'p2','t'+t,target,0);
    h.runtime.advance(MG_TURRET_RULES.bleedTickMs);
    expect(h.damage).toHaveLength(targets.length);
    expect(h.total()).toBeCloseTo(targets.length*10*stats.perHitPercent/100*stats.bleedLevel*MG_TURRET_RULES.bleedTickMs/1000);
    h.runtime.advance(MG_TURRET_RULES.durationMs);expect(h.runtime.snapshot(MG_TURRET_RULES.durationMs).targets).toEqual([]);
  });
  it('produces identical chain damage in coarse and fine simulation steps',()=>{
    const run=(step:number)=>{
      const h=mgHarness([mgOwner('p1',{...stats,perHitPercent:30})]),targets=[h.target,mgTarget('e2',30),mgTarget('e3',60)];
      h.setTargets(targets);h.runtime.hit('p1','t',h.target,0);
      const remaining=new Map(targets.map(t=>[String(t.ref.id),.15]));
      h.setDamageHandler((id,at)=>{
        const amount=h.damage.at(-1)!.amount,left=remaining.get(id)!-amount;remaining.set(id,left);
        if(left<=0){const target=targets.find(t=>t.ref.id===id)!;h.setTargets(targets.filter(t=>remaining.get(String(t.ref.id))!>0));h.runtime.death(target,at);}
      });
      for(let time=step;time<=2000;time+=step)h.runtime.advance(time);
      return {damage:h.damage,transfers:h.runtime.snapshot(2000).transferSequence};
    };
    const coarse=run(2000),fine=run(50);
    expect(coarse.transfers).toBe(fine.transfers);expect(coarse.damage).toHaveLength(fine.damage.length);
    coarse.damage.forEach((hit,i)=>{expect(hit.target).toBe(fine.damage[i].target);expect(hit.at).toBe(fine.damage[i].at);expect(hit.amount).toBeCloseTo(fine.damage[i].amount,10);});
  });
});
