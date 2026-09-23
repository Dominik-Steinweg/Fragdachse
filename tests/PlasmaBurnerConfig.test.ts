import { describe, expect, it } from 'vitest';
import { resolvePlasmaBurnerStats, validatePlasmaBurnerConfig } from '../src/loadout/PlasmaBurnerConfig';
import { burnerRules } from './PlasmaBurnerTestFixture';
describe('PlasmaBurnerConfig',()=>{
  it('resolves base-indexed and unlock-indexed tables without treating level zero as an unlock',()=>{
    const off=resolvePlasmaBurnerStats({...burnerRules,overloadEnabled:0,chainEnabled:0,chargesLevel:0,targetLockLevel:0});
    expect(off).toMatchObject({qMax:0,maxJumps:0,chargeIntervalSeconds:0,lockToleranceDegrees:0});
    const active=resolvePlasmaBurnerStats({...burnerRules,capacitorLevel:3,cascadeLevel:3,chargesLevel:3,targetLockLevel:3});
    expect(active.qMax).toBe(burnerRules.qMaxByLevel[3]);
    expect(active.chargeIntervalSeconds).toBe(burnerRules.intervalSecondsByLevel[2]);
    expect(active.lockToleranceDegrees).toBe(burnerRules.toleranceDegreesByLevel[2]);
  });
  it('validates discrete flags and every table level including boundaries',()=>{
    expect(validatePlasmaBurnerConfig(burnerRules)).toEqual([]);
    for(const key of ['overloadEnabled','chainEnabled']) for(const value of [-1,.5,2,true,NaN]) {
      expect(validatePlasmaBurnerConfig({...burnerRules,[key]:value}).length).toBeGreaterThan(0);
    }
    for(const key of ['capacitorLevel','retentionLevel','cascadeLevel','couplingLevel','chargesLevel','targetLockLevel']) {
      for(const value of [-1,.5,4,NaN]) expect(validatePlasmaBurnerConfig({...burnerRules,[key]:value}).length).toBeGreaterThan(0);
      for(const value of [0,3]) expect(validatePlasmaBurnerConfig({...burnerRules,[key]:value})).toEqual([]);
    }
  });
});
