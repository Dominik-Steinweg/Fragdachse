import { describe, expect, it, vi } from 'vitest';
import {
  AdrenalineEssencePresentation,
  EssenceArrivalBurst,
  EssenceVisualSlots,
  essenceDropletCount,
  sampleEssenceFlight,
} from '../src/adrenalineEssence/AdrenalineEssencePresentation';
import type { EssenceState, EssenceTransferReceipt, EssenceTransferSnapshot } from '../src/adrenalineEssence/AdrenalineEssenceTypes';

const transfer: EssenceTransferSnapshot = {
  id: 'transfer', clusterId: 'cluster', accessGroup: { kind: 'coop' }, playerId: 'local',
  lifeRevision: 1, participationRevision: 1, sourceX: 0, sourceY: 0,
  targetX: 100, targetY: 0, value: 0.125, startedAt: 0, arrivalAt: 200, seed: 42,
};
const state: EssenceState = { worldRevision: 1, activityRevision: 2, revision: 1, clusters: [], transfers: [transfer] };
function receipt(overrides: Partial<EssenceTransferReceipt> = {}): EssenceTransferReceipt {
  return {
    worldRevision: 1, activityRevision: 2, id: 'transfer', playerId: 'local',
    lifeRevision: 1, participationRevision: 1, accessGroup: { kind: 'coop' },
    status: 'committed', creditedValue: 0.125, returnedValue: 0, expiredValue: 0,
    resourceRevision: 5, completedAt: 200, sourceX: 0, sourceY: 0, targetX: 100, targetY: 0,
    ...overrides,
  };
}

describe('explicit essence HUD presentation', () => {
  function setup() {
    const hud = { setEssenceIncoming: vi.fn(), notifyEssenceArrival: vi.fn() };
    return { hud, presentation: new AdrenalineEssencePresentation(hud) };
  }

  it('shows incoming without interpreting it as gain, then accepts a tiny confirmed arrival exactly once', () => {
    const { hud, presentation } = setup();
    presentation.sync(state, [], 50, 'local');
    expect(hud.setEssenceIncoming).toHaveBeenLastCalledWith(transfer.value);
    presentation.update(201);
    expect(hud.notifyEssenceArrival).not.toHaveBeenCalled();
    presentation.sync(state, [receipt()], 205, 'local');
    presentation.sync(state, [receipt()], 206, 'local');
    expect(hud.notifyEssenceArrival).toHaveBeenCalledExactlyOnceWith(0.125, 5);
    expect(hud.setEssenceIncoming).toHaveBeenLastCalledWith(0);
  });

  it('bundles simultaneous actual commits and never celebrates the returned portion', () => {
    const { hud, presentation } = setup();
    presentation.sync(state, [receipt({ creditedValue: 0.2, returnedValue: 0.3 }),
      receipt({ id: 'another', creditedValue: 0.4 })], 200, 'local');
    expect(hud.notifyEssenceArrival).toHaveBeenCalledTimes(1);
    expect(hud.notifyEssenceArrival.mock.calls[0][0]).toBeCloseTo(0.6);
  });

  it('does not infer a burst from cancellation, state removal, a resync or an old receipt', () => {
    const { hud, presentation } = setup();
    presentation.sync(state, [], 0, 'local');
    presentation.sync({ ...state, revision: 2, transfers: [] },
      [receipt({ status: 'returned', creditedValue: 0, returnedValue: 0.125 })], 200, 'local');
    presentation.sync(state, [receipt({ id: 'history' })], 201, 'local', { historical: true });
    presentation.sync(state, [receipt({ id: 'late' })], 5_000, 'local');
    expect(hud.notifyEssenceArrival).not.toHaveBeenCalled();
    expect(hud.setEssenceIncoming).toHaveBeenLastCalledWith(0);
  });

  it('clears incoming on scope detach and ignores receipts belonging to a different activity/player', () => {
    const { hud, presentation } = setup();
    presentation.sync(state, [], 0, 'local');
    presentation.sync({ ...state, activityRevision: 3, transfers: [] }, [receipt()], 200, 'local');
    presentation.sync(state, [receipt({ playerId: 'other', id: 'other' })], 200, 'local');
    presentation.clear();
    expect(hud.setEssenceIncoming).toHaveBeenLastCalledWith(0);
    expect(hud.notifyEssenceArrival).not.toHaveBeenCalled();
  });
});

describe('essence/generic burst consolidation', () => {
  it('does not replay an already-finished generic gain when its receipt arrives late', () => {
    const burst = new EssenceArrivalBurst(320);
    burst.recordGenericGain(10, 1_000);
    burst.recordArrival(10, 1_500, 500);
    expect(burst.until).toBeLessThanOrEqual(1_500);
  });

  it('continues the currently visible generic envelope without extending it', () => {
    const burst = new EssenceArrivalBurst(320);
    burst.recordGenericGain(10, 1_000);
    burst.recordArrival(10, 1_100, 100);
    expect(burst.until).toBe(1_320);
    expect(burst.value).toBe(10);
  });

  it('preserves genuine later fractional arrivals and any unmatched part of a gain', () => {
    const burst = new EssenceArrivalBurst(320);
    burst.recordGenericGain(10, 1_000);
    burst.recordArrival(0.125, 1_500, 0);
    expect(burst.until).toBeGreaterThan(1_500);
    expect(burst.value).toBe(0.125);
    burst.clear();
    burst.recordGenericGain(1, 2_000);
    burst.recordArrival(1.25, 2_500, 500);
    expect(burst.value).toBeCloseTo(0.25);
    expect(burst.until).toBeGreaterThan(2_500);
  });

  it('batches explicit arrivals without consuming the same generic amount twice', () => {
    const burst = new EssenceArrivalBurst(320);
    burst.recordGenericGain(1, 1_000);
    burst.recordArrival(1, 1_400, 400);
    burst.recordArrival(0.25, 1_400, 400);
    burst.recordArrival(0.125, 1_450, 0);
    expect(burst.value).toBeCloseTo(0.375);
    expect(burst.until).toBeGreaterThan(1_450);
  });
});

describe('reconstructable essence visuals', () => {
  it('retains a core under every quality/density and scales value through bounded local density', () => {
    for (const quality of ['high', 'medium', 'low'] as const) {
      expect(essenceDropletCount(0.01, quality, 2_000)).toBeGreaterThanOrEqual(1);
      expect(essenceDropletCount(25, quality, 10)).toBeGreaterThanOrEqual(essenceDropletCount(0.01, quality, 10));
    }
    expect(essenceDropletCount(30, 'low', 10)).toBeLessThan(essenceDropletCount(30, 'high', 10));
    expect(essenceDropletCount(30, 'high', 2_000)).toBeLessThan(essenceDropletCount(30, 'high', 10));
  });

  it('keeps live slots stable and reuses released slots without shifting other owners', () => {
    const slots = new EssenceVisualSlots();
    const first = slots.acquire('first');
    const second = slots.acquire('second');
    expect(slots.acquire('first')).toBe(first);
    slots.release('first');
    expect(slots.acquire('third')).toBe(first);
    expect(slots.acquire('second')).toBe(second);
    slots.clear();
    expect(slots.acquire('new-activity')).toBe(first);
  });

  it('accelerates and follows the current target; late state starts at its host-time position', () => {
    const pose = { x: 0, y: 0, angle: 0, progress: 0 };
    const early = sampleEssenceFlight(transfer, 50, null, pose).x;
    const middle = sampleEssenceFlight(transfer, 100, null, pose).x;
    const late = sampleEssenceFlight(transfer, 150, null, pose).x;
    expect(late - middle).toBeGreaterThan(middle - early);
    sampleEssenceFlight(transfer, 200, { x: 175, y: 30 }, pose);
    expect(pose.x).toBeCloseTo(175);
    expect(pose.y).toBeCloseTo(30);
    expect(pose.progress).toBe(1);
    sampleEssenceFlight(transfer, 5_000, { x: 180, y: 40 }, pose);
    expect(pose.x).toBeCloseTo(180);
    expect(pose.y).toBeCloseTo(40);
    expect(pose.progress).toBe(1);
  });
});
