import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)) } }));
import { PlasmaBurnerRuntime } from '../src/world/PlasmaBurnerRuntime';
import { PlayerWeaponActivationRuntime } from '../src/world/PlayerWeaponActivationRuntime';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { burnerRules, target } from './PlasmaBurnerTestFixture';
import type { PlasmaBurnerPulseOutcome, PlasmaBurnerPulseRequest } from '../src/combat/plasmaBurner/PlasmaBurnerContracts';
const config={...WEAPON_CONFIGS.PLASMA_BURNER, cooldown:100, plasmaBurner:burnerRules};
function harness() {
  let outcome:PlasmaBurnerPulseOutcome={accepted:true,contacts:[{target:target('a'),effectiveAmount:1,fx:1}],chainMemberKeys:['a'],lock:'a'};
  const resolvePlasmaBurnerPulse=vi.fn((_req:PlasmaBurnerPulseRequest)=>outcome);
  const spawnProjectile=vi.fn(()=>1);
  const runtime=new PlasmaBurnerRuntime({resolvePlasmaBurnerPulse},{spawnProjectile});
  const fire=(nowMs:number)=>runtime.firePulse({playerId:'p',config,nowMs,x:0,y:0,angle:0,targetX:100,targetY:0});
  return {runtime,fire,resolvePlasmaBurnerPulse,spawnProjectile,setOutcome:(next:PlasmaBurnerPulseOutcome)=>outcome=next};
}
describe('PlasmaBurnerRuntime',()=>{
  it('gates credit by paid pulse interval, uses pre-credit Q and never catches up delayed pulses',()=>{
    const h=harness();h.fire(0);expect(h.resolvePlasmaBurnerPulse.mock.calls[0][0].multiplier).toBe(1);
    expect(h.fire(50)).toBe(false);expect(h.runtime.getState('p')?.q).toBeCloseTo(10/3);
    h.fire(100);expect(h.resolvePlasmaBurnerPulse.mock.calls[1][0].multiplier).toBeCloseTo(1+1/30);
    h.fire(10000);expect(h.resolvePlasmaBurnerPulse).toHaveBeenCalledTimes(3);
    expect(h.runtime.getState('p')?.q).toBeCloseTo(10/3);
    expect(h.resolvePlasmaBurnerPulse.mock.calls[2][0]).toMatchObject({chainMemberKeys:[],lock:null});
  });
  it('counts real mutations only, including a final partial heal and half-weight secondaries',()=>{
    const h=harness();h.setOutcome({accepted:true,chainMemberKeys:[],lock:null,contacts:[
      {target:target('full'),effectiveAmount:0,fx:0},
      {target:target('heal'),effectiveAmount:.1,fx:2},
      {target:target('rock',40,{category:'environment'}),effectiveAmount:100,fx:1}]});
    h.fire(0);expect(h.runtime.getState('p')?.q).toBeCloseTo(5/3);
    h.setOutcome({accepted:true,contacts:[],chainMemberKeys:[],lock:null});h.fire(100);h.runtime.update(110);
    expect(h.runtime.getState('p')?.q).toBeCloseTo(5/3-.25);
  });
  it('clears gesture progress on timeout/mount and clears all state on resets and destroy',()=>{
    const h=harness();for(let t=0;t<700;t+=100)h.fire(t);
    expect(h.spawnProjectile).not.toHaveBeenCalled();
    h.runtime.endGesture('p',650);h.fire(700);
    expect(h.resolvePlasmaBurnerPulse.mock.calls.at(-1)?.[0]).toMatchObject({chainMemberKeys:[],lock:null});
    expect(h.runtime.getState('p')!.q).toBeGreaterThan(0);
    h.runtime.resetPlayer('p');expect(h.runtime.getState('p')).toBeUndefined();
    h.fire(1000);expect(h.resolvePlasmaBurnerPulse.mock.calls.at(-1)?.[0].multiplier).toBe(1);
    h.runtime.clearAll();expect(h.runtime.getState('p')).toBeUndefined();
    h.runtime.destroy();expect(h.fire(2000)).toBe(false);
  });
  it('spawns immutable support payloads, with secondary attenuation but no M damage',()=>{
    const h=harness();h.setOutcome({accepted:true,chainMemberKeys:['b'],lock:null,contacts:[
      {target:target('a'),effectiveAmount:1,fx:1},{target:target('b'),effectiveAmount:1,fx:1}]});
    for(let t=0;t<2500;t+=100)h.fire(t);
    expect(h.spawnProjectile.mock.calls.length).toBeGreaterThan(2);
    for(const [request] of h.spawnProjectile.mock.calls) {
      const payload=request.interaction.support.plasmaBurnerCharge;
      expect(payload.damage).toBeCloseTo(12*(payload.sourceSlot===0?1:.7));
      expect(payload.heal).toBeCloseTo(24*(payload.sourceSlot===0?1:.7));
      expect(request.provenance.lineage.originTarget).toEqual({kind:'player',id:payload.sourceSlot===0?'a':'b'});
      expect(request.flight.homing).toMatchObject({targetPolicy:'plasma_burner',acquireDelayMs:120});
    }
  });
  it('charges adrenaline and commits cooldown for accepted misses, never for a gated duplicate',()=>{
    const h=harness();h.setOutcome({accepted:true,contacts:[],chainMemberKeys:[],lock:null});
    const drain=vi.fn(),recordWeaponUse=vi.fn();
    const activation=new PlayerWeaponActivationRuntime({
      playerManager:{getPlayer:()=>({x:0,y:0,color:1})},
      loadout:{isWeaponOnCooldown:()=>false,getDynamicSpread:()=>0,addWeaponSpread:vi.fn(),recordWeaponUse,noteWeaponUsed:vi.fn()},
      resourceSystem:{captureAdrenalineGainBasis:()=>null,resolveAdrenalineCost:(_id,c)=>c,getAdrenaline:()=>100,drainAdrenaline:drain,pauseAdrenalineRegen:vi.fn()},
      weaponExecution:{fire:()=>{throw new Error('generic path');}},plasmaBurner:h.runtime,
      specializedWeaponExecution:{fire:()=>false},broadcastShotFx:vi.fn(),registerWeaponFired:vi.fn(),getRuntimeDamageMultiplier:()=>1,
    } as never);
    const request={playerId:'p',slot:'weapon2' as const,config,x:0,y:0,angle:0,targetX:100,targetY:0,nowMs:1000};
    expect(activation.activateWeapon(request)).toEqual({ok:true});
    expect(drain).toHaveBeenCalledExactlyOnceWith('p',config.adrenalinCost,1000);
    expect(recordWeaponUse).toHaveBeenCalledOnce();
    activation.activateWeapon({...request,nowMs:1050});expect(drain).toHaveBeenCalledOnce();
  });
});
