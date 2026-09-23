import { describe, expect, it } from 'vitest';
import { advance, creditPulse, multiplier, type PlasmaBurnerOverloadState } from '../src/combat/plasmaBurner/PlasmaBurnerOverload';
const rules = { qMax: 100, buildPerSecond: 100/3, decayPerSecond: 25, contactToleranceMs: 50 };
const state = (): PlasmaBurnerOverloadState => ({ q: 0, coverageEndMs: 0, decayedUntilMs: 0 });
describe('PlasmaBurnerOverload', () => {
  it('credits thirty accepted primary contacts, using the old multiplier for the current contact', () => {
    const s = state(); expect(multiplier(s)).toBe(1);
    for (let i=0;i<30;i++) { advance(s,i*100,rules); creditPulse(s,i*100,100,1,rules); }
    expect(s.q).toBeCloseTo(100); expect(multiplier(s)).toBeCloseTo(2);
    creditPulse(s,3000,100,3,rules); expect(s.q).toBe(100);
    const authored = state();
    for(let i=0;i<30;i++) creditPulse(authored,i*100,100,1,{...rules,buildPerSecond:33.3333});
    expect(authored.q).toBeCloseTo(100,3); expect(authored.q).toBeLessThan(100);
  });
  it('weights four secondary contacts at half each', () => {
    const one=state(),five=state();
    creditPulse(one,0,100,1,rules); creditPulse(five,0,100,3,rules);
    expect(five.q).toBeCloseTo(one.q*3);
  });
  it('integrates the same decay across frame sizes, including retrospective jitter decay', () => {
    const run=(step:number)=>{ const s=state();s.q=100;creditPulse(s,0,100,1,rules);
      for(let now=step;now<1000;now+=step)advance(s,now,rules);advance(s,1000,rules);return s.q; };
    expect(run(10)).toBeCloseTo(run(157));expect(run(1000)).toBeCloseTo(77.5);
    const s={q:100,coverageEndMs:100,decayedUntilMs:0};
    advance(s,150,rules);expect(s.q).toBe(100);
    advance(s,151,rules);expect(s.q).toBeCloseTo(98.725);
  });
  it('bridges a timely pulse without free decay time; zero contact decays immediately', () => {
    const s={q:50,coverageEndMs:100,decayedUntilMs:0};
    advance(s,140,rules);creditPulse(s,140,100,1,rules);expect(s.q).toBeCloseTo(50+10/3);
    creditPulse(s,150,100,0,rules);advance(s,160,rules);expect(s.q).toBeCloseTo(50+10/3-.25);
    advance(s,10000,rules);expect(s.q).toBe(0);
  });
});
