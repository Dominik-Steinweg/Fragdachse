import { describe, expect, it, vi } from 'vitest';
import {
  ArenaBaseEditorPreparation,
  BASE_EDITOR_PREPARE_SETTLE_MS,
  type BaseEditorPreparationFrame,
} from '../src/scenes/arena/ArenaBaseEditorPreparation';

function fakeStage() {
  let ready = false;
  return { isReady: () => ready, setUrgent: vi.fn(), setCalm: vi.fn(), closeSession: vi.fn(), finish: () => { ready = true; } };
}

function harness() {
  const added: ReturnType<typeof fakeStage>[] = [];
  const removed: unknown[] = [];
  const preparation = new ArenaBaseEditorPreparation({
    add: () => { const stage = fakeStage(); added.push(stage); return stage as never; },
    remove: (stage) => { removed.push(stage); },
  });
  const tick = (now: number, key: string | null | undefined, frame: Partial<BaseEditorPreparationFrame> = {}) =>
    preparation.tick({ now, key, eligible: true, busy: false, near: false, calm: true, options: () => ({}) as never, ...frame });
  return { preparation, added, removed, tick };
}

describe('Bauhof stage preparation', () => {
  it('builds the first terrain after entering the lobby at once, in the background, and keeps it', () => {
    const { preparation, added, removed, tick } = harness();
    tick(0, 'map18');
    expect(added).toHaveLength(1);
    expect(added[0].setUrgent).toHaveBeenLastCalledWith(false);
    expect(preparation.isPreparing()).toBe(true);
    expect(preparation.readyStage('map18')).toBeNull();
    added[0].finish();
    tick(16, 'map18');
    expect(preparation.readyStage('map18')).toBe(added[0]);
    expect(preparation.readyStage('map13')).toBeNull();
    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(0);
  });

  it('drops a stale stage at once and builds the changed terrain after quiet time, or at once near the Bauhof', () => {
    const { added, removed, tick } = harness();
    tick(0, 'map18');
    tick(1000, 'map13');
    expect(removed).toEqual([added[0]]);
    expect(added).toHaveLength(1);
    tick(1000 + BASE_EDITOR_PREPARE_SETTLE_MS - 1, 'map13');
    expect(added).toHaveLength(1);
    tick(1000 + BASE_EDITOR_PREPARE_SETTLE_MS, 'map13');
    expect(added).toHaveLength(2);
    tick(5000, 'map10', { near: true });
    expect(added).toHaveLength(3);
  });

  it('keeps out of an open session and keeps the stage while the next terrain is still generated', () => {
    const { added, removed, tick } = harness();
    tick(0, 'map18');
    tick(10, 'map13', { busy: true });
    tick(20, undefined);
    expect(removed).toHaveLength(0);
    expect(added).toHaveLength(1);
  });

  it('releases the stage outside the lobby and starts at once again after returning', () => {
    const { added, removed, tick, preparation } = harness();
    tick(0, 'map18');
    tick(10, 'map18', { eligible: false });
    expect(removed).toEqual([added[0]]);
    tick(20, 'map13');
    expect(added).toHaveLength(2);
    preparation.release();
    expect(removed).toEqual([added[0], added[1]]);
  });

  it('hurries a stage a player waits for, keeps a terrain stage after the session and drops the draft-only one', () => {
    const { preparation, added, removed, tick } = harness();
    tick(0, 'map18');
    const stage = preparation.acquire('map18', () => ({}) as never, true);
    expect(stage).toBe(added[0]);
    expect(added[0].setUrgent).toHaveBeenLastCalledWith(true);
    preparation.endSession(stage);
    expect(added[0].closeSession).toHaveBeenCalledOnce();
    expect(added[0].setUrgent).toHaveBeenLastCalledWith(false);
    expect(removed).toHaveLength(0);
    const personal = preparation.acquire(null, () => ({}) as never, true);
    expect(removed).toEqual([added[0]]);
    preparation.endSession(personal);
    expect(removed).toEqual([added[0], personal]);
  });
});
