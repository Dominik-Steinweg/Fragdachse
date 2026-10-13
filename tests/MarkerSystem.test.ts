import { describe, expect, it, vi } from 'vitest';
import { MarkerSystem, NullMarkerRenderer } from '../src/effects/markers/MarkerSystem';
import type { MarkerLayoutInput } from '../src/effects/markers/MarkerLayoutModel';
import type { MarkerDescriptor, MarkerFrame, MarkerSource } from '../src/effects/markers/MarkerTypes';

const marker = (key: string, extra: Partial<MarkerDescriptor> = {}): MarkerDescriptor => ({
  key, kind: 'site', state: 'dormant', glyph: 'site-wreck', x: 400, y: 300,
  targetHalfHeight: 20, visibility: 'world-and-edge', ...extra,
});
const frameInput: Omit<MarkerLayoutInput, 'descriptors'> = {
  camera: { worldView: { centerX: 400, centerY: 300 }, zoom: 1, viewport: { x: 0, y: 0, width: 800, height: 600 } },
  localPlayer: { x: 400, y: 300 }, reservedHudRects: [], nowMs: 0, lowQuality: false,
};
function setup() {
  const renderer = { sync: vi.fn(), destroy: vi.fn() };
  const system = new MarkerSystem(renderer);
  const source = (id: string, descriptors = [marker(id)]): MarkerSource => ({
    id, collect: vi.fn((out: MarkerDescriptor[]) => out.push(...descriptors)),
  });
  const rendered = (): MarkerFrame => renderer.sync.mock.calls.at(-1)![0];
  return { renderer, system, source, rendered };
}

describe('MarkerSystem source ownership', () => {
  it('collects every source before globally selecting markers and forwards time/quality', () => {
    const { system, renderer, source } = setup();
    const world = system.bindWorld(1);
    const low = source('low', Array.from({ length: 20 }, (_, i) => marker(`low-${i}`, { kind: 'utility' })));
    const high = source('high', [marker('main', { kind: 'main-objective' })]);
    world.register(low);
    system.bindActivity(1).register(high);
    const frame = system.update({ ...frameInput, nowMs: 42, lowQuality: true });
    expect(frame.worldBadges[0].key).toBe('main');
    expect(low.collect).toHaveBeenCalledTimes(1);
    expect(high.collect).toHaveBeenCalledTimes(1);
    expect(renderer.sync).toHaveBeenLastCalledWith(frame, 42, true);
  });

  it('releases activity and round sources immediately, retaining lobby/world sources without recollecting', () => {
    const { system, source, rendered } = setup();
    const worldSource = source('world'), activitySource = source('activity'), roundSource = source('round');
    system.bindWorld('world-1').register(worldSource);
    const activity = system.bindActivity('activity-1');
    activity.register(activitySource);
    const round = system.bindRound(1);
    round.register(roundSource);
    system.update(frameInput);
    activity.release();
    expect(rendered().worldBadges.map((b) => b.key)).toEqual(['world']);
    expect(worldSource.collect).toHaveBeenCalledTimes(1);
    system.update(frameInput);
    expect(activitySource.collect).toHaveBeenCalledTimes(1);
    expect(roundSource.collect).toHaveBeenCalledTimes(1);
    expect(() => round.register(source('stale'))).toThrow('released');
  });

  it('invalidates all old bindings on world replacement even when child revisions repeat', () => {
    const { system, source, rendered } = setup();
    const world = system.bindWorld(1), activity = system.bindActivity(1), round = system.bindRound(1);
    world.register(source('world')); activity.register(source('activity')); round.register(source('round'));
    system.update(frameInput);
    const replacement = system.bindWorld(2);
    expect(rendered()).toEqual({ worldBadges: [], edgeBadges: [], groundRings: [] });
    replacement.register(source('world'));
    system.bindActivity(1).register(source('activity'));
    system.bindRound(1).register(source('round'));
    world.release(); activity.release(); round.release();
    expect(system.update(frameInput).worldBadges).toHaveLength(3);
    expect(() => world.register(source('old'))).toThrow('released');
  });

  it('replaces only round sources on a round revision change and treats equal revisions as idempotent', () => {
    const { system, source, rendered } = setup();
    const world = system.bindWorld(1), activity = system.bindActivity(1), round = system.bindRound(1);
    world.register(source('world')); activity.register(source('activity')); round.register(source('round'));
    expect(system.bindWorld(1)).toBe(world);
    expect(system.bindActivity(1)).toBe(activity);
    expect(system.bindRound(1)).toBe(round);
    system.update(frameInput);
    const next = system.bindRound(2);
    expect(rendered().worldBadges.map((b) => b.key).sort()).toEqual(['activity', 'world']);
    next.register(source('round'));
    round.release();
    expect(system.update(frameInput).worldBadges).toHaveLength(3);
  });

  it('makes source disposers idempotent and unable to remove a replacement with the same ID', () => {
    const { system, source, rendered } = setup();
    const world = system.bindWorld(1);
    const remove = world.register(source('a', [marker('a', { groundRing: { radiusPx: 50 } })]));
    system.update(frameInput);
    remove();
    expect(rendered().worldBadges).toHaveLength(0);
    expect(rendered().groundRings).toHaveLength(0);
    world.register(source('a'));
    remove();
    expect(system.update(frameInput).worldBadges).toHaveLength(1);
  });

  it('recalculates bundles when one contributing source is detached', () => {
    const { system, source, rendered } = setup();
    const world = system.bindWorld(1);
    world.register(source('a', [marker('a', { x: 2000, bundleKey: 'x' })]));
    const activity = system.bindActivity(1);
    activity.register(source('b', [marker('b', { x: 2100, bundleKey: 'x' })]));
    expect(system.update(frameInput).edgeBadges[0].count).toBe(2);
    activity.release();
    expect(rendered().edgeBadges).toHaveLength(1);
    expect(rendered().edgeBadges[0].count).toBeUndefined();
  });

  it('clears animation history before a same-key source is rebound', () => {
    const { system, source } = setup();
    const world = system.bindWorld(1);
    const remove = world.register(source('a'));
    system.update(frameInput);
    remove();
    world.register(source('a', [marker('a', { state: 'active', stateChangedAtMs: 100 })]));
    expect(system.update({ ...frameInput, nowMs: 100 }).worldBadges[0].scale).toBe(1);
  });

  it('does not revive a source or call its siblings if collection synchronously ends their scope', () => {
    const { system, source } = setup();
    const world = system.bindWorld(1);
    const activity = system.bindActivity(1);
    world.register(source('world'));
    activity.register({ id: 'ending', collect(out) { out.push(marker('ending')); activity.release(); } });
    const stale = source('stale');
    activity.register(stale);
    expect(system.update(frameInput).worldBadges.map((b) => b.key)).toEqual(['world']);
    expect(stale.collect).not.toHaveBeenCalled();
  });

  it('supports world presentation with no activity and enforces parent scopes', () => {
    const { system, source } = setup();
    expect(() => system.bindActivity(1)).toThrow('world');
    expect(() => system.bindRound(1)).toThrow('world');
    const world = system.bindWorld(1);
    expect(() => system.bindRound(1)).toThrow('activity');
    world.register(source('lobby'));
    expect(system.update(frameInput).worldBadges).toHaveLength(1);
    world.release();
    expect(system.update(frameInput).worldBadges).toHaveLength(0);
  });

  it('rejects duplicate source IDs and globally conflicting descriptor keys', () => {
    const { system, source } = setup();
    const world = system.bindWorld(1);
    world.register(source('a'));
    const activity = system.bindActivity(1);
    expect(() => activity.register(source('a'))).toThrow('Duplicate marker source');
    activity.register(source('b', [marker('a')]));
    expect(() => system.update(frameInput)).toThrow('Duplicate marker key');
  });

  it('destroys renderer once and severs all callbacks, including stale disposers', () => {
    const { system, renderer, source } = setup();
    const world = system.bindWorld(1);
    const remove = world.register(source('a'));
    system.update(frameInput);
    const syncCount = renderer.sync.mock.calls.length;
    system.destroy(); system.destroy(); world.release(); remove();
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
    expect(renderer.sync).toHaveBeenCalledTimes(syncCount);
    expect(() => system.update(frameInput)).toThrow('destroyed');
    expect(() => world.register(source('b'))).toThrow('destroyed');
  });

  it('provides a no-resource null renderer and can run without injected rendering', () => {
    const nullRenderer = new NullMarkerRenderer();
    nullRenderer.sync({ worldBadges: [], edgeBadges: [], groundRings: [] }, 0, false);
    nullRenderer.destroy();
    const system = new MarkerSystem();
    system.bindWorld(1).register({ id: 'a', collect: (out) => out.push(marker('a')) });
    expect(system.update(frameInput).worldBadges).toHaveLength(1);
    system.destroy();
  });
});
