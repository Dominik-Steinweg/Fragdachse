import { describe, expect, it } from 'vitest';
import { DAWN_PLAN_VERSION, parseDawnActivityPlan, parseDawnWorldPlan } from '../src/dawn/contracts/DawnPlans';

const hash = '0123456789abcdef';
const world = { version: DAWN_PLAN_VERSION, templateId: 'clearing', contentHash: hash,
  sites: [{ slotId: 'nw-near', archetypeId: 'wreck', tier: 2 }] };
const activity = { version: DAWN_PLAN_VERSION, contentHash: hash, threat: 3, dayNumber: 1, scheduleId: 'standard', waves: [] };

describe('Dawn plan M3 fields', () => {
  it('keeps optional site variants, hidden sites and the night modifier', () => {
    const site = { slotId: 'nw-near', archetypeId: 'wreck', tier: 2, variant: 'tractor', hidden: true };
    expect(parseDawnWorldPlan({ ...world, sites: [site] })?.sites[0]).toEqual(site);
    expect(parseDawnActivityPlan({ ...activity, nightModifierId: 'blood-moon' })?.nightModifierId).toBe('blood-moon');
  });

  it('omits absent optional fields and rejects malformed ones', () => {
    expect(parseDawnWorldPlan(world)?.sites[0]).toEqual({ slotId: 'nw-near', archetypeId: 'wreck', tier: 2 });
    expect(parseDawnActivityPlan(activity)).not.toHaveProperty('nightModifierId');
    for (const extra of [{ variant: 'Tractor!' }, { hidden: false }, { hidden: 'yes' }]) {
      expect(parseDawnWorldPlan({ ...world, sites: [{ ...world.sites[0], ...extra }] })).toBeNull();
    }
    expect(parseDawnActivityPlan({ ...activity, nightModifierId: 7 })).toBeNull();
  });
});
