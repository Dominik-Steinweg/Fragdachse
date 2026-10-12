import { describe, expect, it, vi } from 'vitest';
import { KrakenSnapshotReceiver } from '../src/network/KrakenSnapshotReceiver';
import { encodeKrakenSnapshot, decodeKrakenSnapshot, readAreaClawImpact } from '../src/network/krakenSnapshotCodec';
import { encodeEnemyUpsert, decodeEnemyUpserts } from '../src/network/enemySnapshotCodec';
import { enemies, event, kraken, packet, phases } from './krakenNetworkFixtures';

describe('Kraken wire cutover', () => {
  it('roundtrips an active spine volley and partial regrowth losslessly for late join', () => {
    const state = kraken({ kind: 'surfaced', startedAt: 0, nextDiveAt: 10000 });
    state.bodyAction = { kind: 'spines', castId: 'volley', startedAt: 100, raiseAt: 200,
      releaseAt: [300, 400, 500, 600, 700, 800], endsAt: 900 };
    state.spines = [{ index: 0, castId: 'volley', firedAt: 300, regrowStartsAt: 1000, readyAt: 3000 },
      { index: 1, castId: 'volley', firedAt: 400, regrowStartsAt: 1100, readyAt: 3100 }];
    const original = packet(state);
    const copy = decodeKrakenSnapshot(JSON.parse(JSON.stringify(encodeKrakenSnapshot(original))));
    expect(copy).toEqual(original);
    state.spines.push({ ...state.spines[0] }); expect(decodeKrakenSnapshot(packet(state))).toBeUndefined();
  });
  it.each(phases)('preserves the complete $kind baseline, exact poses and absolute host anchors', phase => {
    const original = packet(kraken(phase));
    expect(decodeKrakenSnapshot(JSON.parse(JSON.stringify(encodeKrakenSnapshot(original))))).toEqual(original);
  });
  it('distinguishes absent, clear and malformed packets and rejects mismatched scopes', () => {
    expect(decodeKrakenSnapshot(undefined)).toBeUndefined();
    expect(decodeKrakenSnapshot(packet(null))?.kraken).toBeNull();
    expect(decodeKrakenSnapshot({ ...packet(), activityRevision: 7 })).toBeUndefined();
    expect(decodeKrakenSnapshot({ ...packet(), kraken: {} })).toBeUndefined();
    expect(() => encodeEnemyUpsert([], { id: 'e1', areaClaw: event().state })).toThrow(/body/);
  });
  it('preserves existing action codes and roundtrips all Kraken actions plus sector/lane body slots', () => {
    const actions = ['none', 'gauss-charge', 'phase-nuke', 'armageddon', 'timebomb-chase', 'timebomb-fuse',
      'void-molotov-windup', 'kraken-ink', 'kraken-eggs', 'kraken-dive', 'kraken-submerged',
      'kraken-surface', 'kraken-ashore', 'kraken-slam', 'kraken-spines'] as const;
    for (const [code, specialAction] of actions.entries()) {
      const u: (number | string)[] = [];
      encodeEnemyUpsert(u, { id: 'e1', specialAction });
      expect(u[2]).toBe(code);
      expect(decodeEnemyUpserts(u)[0].specialAction).toBe(specialAction);
    }
    for (const presentation of ['ink', 'slam'] as const) {
      const state = event().state;
      state.attack!.presentation = presentation;
      if (presentation === 'ink') state.attack!.pose.geometry = { kind: 'sector', range: 200, arcDegrees: 63 };
      const u: (number | string)[] = [];
      encodeEnemyUpsert(u, { id: 'e1', areaClaw: state, entityGeneration: 4 });
      encodeEnemyUpsert(u, { id: 'e2', areaClaw: { revision: 9, attack: null } });
      expect(decodeEnemyUpserts(u).map(e => e.areaClaw)).toEqual([state, { revision: 9, attack: null }]);
    }
  });
});

describe('Kraken snapshot/event ordering', () => {
  function receiver() { const deliver = vi.fn(), r = new KrakenSnapshotReceiver(deliver); r.setScope(2, 5); return { r, deliver }; }
  it('buffers parts until both owner generation and part baseline exist; newer clears survive an older baseline', () => {
    const { r, deliver } = receiver();
    r.receiveEvent({ ...event(), state: { revision: 2, attack: null } });
    r.receiveEvent(event('right'));
    r.applySnapshot(packet());
    expect(r.getState()).toBeNull(); expect(deliver).not.toHaveBeenCalled();
    r.applyEnemies(enemies());
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(r.getState()!.tentacles.map(t => t.claw.attack?.attackId ?? null)).toEqual([null, 'right:slam']);
    r.applySnapshot(packet({ ...kraken(), revision: 7 }, 2));
    expect(r.getState()!.tentacles[0].claw).toEqual({ revision: 2, attack: null });
    r.receiveEvent(event()); expect(deliver).toHaveBeenCalledTimes(2);
  });
  it('reconciles body starts and clears ahead of enemy baselines independently of part slots', () => {
    const { r, deliver } = receiver();
    const body = { ...event(), slot: { kind: 'body' as const }, state: { revision: 3, attack: null } };
    r.receiveEvent(body);
    const baseline = enemies();
    const u: (number | string)[] = [];
    encodeEnemyUpsert(u, { id: 'e1', entityGeneration: 4, areaClaw: { revision: 1, attack: null } });
    const merged = r.applyEnemies({ ...baseline, u });
    expect(decodeEnemyUpserts(merged!.u)[0].areaClaw).toEqual(body.state);
    expect(deliver).toHaveBeenCalledOnce();
  });
  it('fences null clears, old revisions, removed parts and previous activities without replaying impacts', () => {
    const { r, deliver } = receiver(); r.applyEnemies(enemies()); r.applySnapshot(packet());
    const e = event(), impact = readAreaClawImpact({ ...e, state: undefined, revision: 1, attack: e.state.attack });
    expect(impact).toBeUndefined(); // Strict contract rejects the extra event-state field.
    const { state, ...address } = e;
    const validImpact = readAreaClawImpact({ ...address, revision: state.revision, attack: state.attack })!;
    expect(r.acceptImpact(validImpact)).toBe(true); expect(r.acceptImpact(validImpact)).toBe(false);
    r.receiveEvent({ ...e, state: { revision: 2, attack: null } });
    expect(r.acceptImpact(validImpact)).toBe(false);
    r.applySnapshot(packet({ ...kraken(), revision: 7, tentacles: [], eggs: [] }, 2));
    r.receiveEvent({ ...e, state: { ...state, revision: 9 } });
    expect(r.getState()!.tentacles).toEqual([]);
    r.applySnapshot(packet(null, 3)); r.applySnapshot(packet(kraken(), 2)); r.applySnapshot(undefined);
    expect(r.getState()).toBeNull();
    r.setScope(2, 6); r.applySnapshot(packet()); r.receiveEvent(e);
    expect(r.getState()).toBeNull(); expect(deliver).toHaveBeenCalledOnce();
  });
  it('keeps terminal presentation after combat removal and clears it on scope reset', () => {
    const { r } = receiver(); r.applySnapshot(packet(kraken(phases[8])));
    r.applyEnemies({ c: 0, u: [], r: [1], a: [] });
    expect(r.getState()?.phase).toEqual(phases[8]);
    r.reset(2, 5); expect(r.getState()).toBeNull();
  });
  it('rejects stale owner generations, targetability revisions and foreign scopes', () => {
    const { r, deliver } = receiver(); r.applyEnemies(enemies()); r.applySnapshot(packet());
    r.receiveEvent({ ...event(), entityGeneration: 3, state: { revision: 100, attack: null } });
    r.receiveEvent({ ...event(), worldRevision: 1, state: { revision: 100, attack: null } });
    const stale = kraken(); stale.revision++; stale.bodyTargetability.revision--;
    r.applySnapshot(packet(stale, 2));
    const oldBoss = kraken(); oldBoss.tentacles = [];
    oldBoss.boss = { ...oldBoss.boss, instance: { ...oldBoss.boss.instance, entityGeneration: 3 } };
    oldBoss.eggs = [];
    r.applySnapshot(packet(oldBoss, 3));
    expect(r.getState()).toEqual(kraken()); expect(deliver).not.toHaveBeenCalled();
    r.setScope(3, 5); r.applyEnemies(enemies()); r.applySnapshot(packet());
    expect(r.getState()).toBeNull();
  });
});
