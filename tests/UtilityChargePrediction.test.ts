import { describe, expect, it } from 'vitest';
import { UtilityChargePrediction } from '../src/loadout/UtilityChargePrediction';
import { getUtilityChargeReadyAt, getUtilityRechargeFraction, parseUtilityChargeState } from '../src/loadout/UtilityChargeState';

const full = { utilityId: 'HE_GRENADE', revision: 1, availableCharges: 3, maxCharges: 3,
  rechargeIntervalMs: 2000, nextChargeAt: null, lockoutUntil: 0 };

describe('HE charge projection and attempts', () => {
  it('keeps burst availability separate from refill progress and rolls back a rejected attempt', () => {
    const view = new UtilityChargePrediction();
    view.observe(full);
    view.predict(full.utilityId, 'one', 0, 100);
    expect(view.project(full.utilityId, 50)).toMatchObject({ availableCharges: 2, nextChargeAt: 2000 });
    expect(getUtilityChargeReadyAt(view.project(full.utilityId, 50)!)).toBe(100);
    expect(getUtilityRechargeFraction(view.project(full.utilityId, 500)!, 500)).toBe(0.75);
    view.predict(full.utilityId, 'two', 400, 100);
    view.acknowledge('two');
    expect(view.project(full.utilityId, 500)?.availableCharges).toBe(2);
  });

  it('reconciles a reliable state before its reply without spending twice or overwriting newer state', () => {
    const view = new UtilityChargePrediction();
    view.observe(full);
    view.predict(full.utilityId, 'one', 0, 100);
    view.predict(full.utilityId, 'two', 400, 100);
    view.observe({ ...full, revision: 3, availableCharges: 1, nextChargeAt: 2000, lockoutUntil: 500, lastCommittedAttemptId: 'two' });
    view.acknowledge('one', { ...full, revision: 2, availableCharges: 2, nextChargeAt: 2000, lastCommittedAttemptId: 'one' });
    view.acknowledge('two');
    view.observe(full);
    expect(view.project(full.utilityId, 600)).toMatchObject({ revision: 3, availableCharges: 1, nextChargeAt: 2000 });
    expect(view.project(full.utilityId, 2000)?.availableCharges).toBe(2);
    expect(view.project(full.utilityId, 9999)).toMatchObject({ availableCharges: 3, nextChargeAt: null });
  });

  it('accepts a reply before player state, handles empty stock, and clears world-local revisions', () => {
    const view = new UtilityChargePrediction();
    view.observe({ ...full, availableCharges: 1 });
    view.predict(full.utilityId, 'one', 0, 100);
    expect(getUtilityChargeReadyAt(view.project(full.utilityId, 100)!)).toBe(2000);
    view.acknowledge('one', { ...full, revision: 2, availableCharges: 0, nextChargeAt: 2000, lastCommittedAttemptId: 'one' });
    view.clear();
    view.acknowledge('one', { ...full, revision: 99 });
    expect(view.project(full.utilityId, 100)).toBeNull();
    view.observe(full);
    expect(view.project(full.utilityId, 100)).toMatchObject(full);
  });

  it('validates the reliable wire projection', () => {
    expect(parseUtilityChargeState(full)).toEqual(full);
    expect(parseUtilityChargeState({ ...full, availableCharges: -1 })).toBeNull();
    expect(parseUtilityChargeState({ ...full, availableCharges: 4 })).toBeNull();
    expect(parseUtilityChargeState({ ...full, nextChargeAt: NaN })).toBeNull();
  });
});
