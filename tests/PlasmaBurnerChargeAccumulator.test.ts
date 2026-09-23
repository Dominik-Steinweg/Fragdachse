import { describe, expect, it } from 'vitest';
import { accumulatePlasmaBurnerCharges as credit } from '../src/combat/plasmaBurner/PlasmaBurnerChargeAccumulator';
describe('PlasmaBurnerChargeAccumulator',()=>{
  it('does not stockpile empty slots or eject immediately on first contact',()=>{
    const p:number[]=[];for(let i=0;i<100;i++)expect(credit(p,[false,false],100,2,1)).toEqual([]);
    expect(credit(p,[true,true],100,1,1)).toEqual([]);expect(p).toEqual([.1,.1]);
    credit(p,[false],100,1,1);expect(p).toEqual([0]);
  });
  it('keeps fractional slot progress across an effective target switch, with at most one spawn per pulse',()=>{
    const p=[.85,.2];expect(credit(p,[true,true],100,2,1)).toEqual([0]);expect(p[0]).toBeCloseTo(.05);
    expect(credit(p,[true,false],100,20,1)).toEqual([0]);expect(p[0]).toBeCloseTo(.05);expect(p[1]).toBe(0);
    credit(p,[],100,1,1);expect(p).toEqual([]);
  });
});
