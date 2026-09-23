import { describe, expect, it } from 'vitest';
import { canHoldPlasmaBurnerLock } from '../src/combat/plasmaBurner/PlasmaBurnerTargetLock';
import { target } from './PlasmaBurnerTestFixture';
describe('PlasmaBurnerTargetLock',()=>{
  const t=target('a',100);
  const options={x:0,y:0,angle:0,range:300,toleranceDegrees:6,firstTargetAt:()=>t.key};
  it('holds only within angle, range and its own first-hit line',()=>{
    expect(canHoldPlasmaBurnerLock(t,options)).toBe(true);
    expect(canHoldPlasmaBurnerLock(t,{...options,angle:7*Math.PI/180})).toBe(false);
    expect(canHoldPlasmaBurnerLock({...t,x:301},options)).toBe(false);
    expect(canHoldPlasmaBurnerLock(t,{...options,firstTargetAt:()=> 'rock:1'})).toBe(false);
    expect(canHoldPlasmaBurnerLock({...t,alive:false},options)).toBe(false);
  });
  it('releases healed allies and handles angle wrapping',()=>{
    expect(canHoldPlasmaBurnerLock({...t,hp:100,damageable:false,supportable:true},options)).toBe(false);
    expect(canHoldPlasmaBurnerLock({...t,x:-100},{...options,angle:-Math.PI+.01})).toBe(true);
  });
});
