import { describe, expect, it, vi } from 'vitest';
import { WorldPortalTransport, type PortalActor, type PortalPairSource,
  type PortalTransportWorldPort } from '../src/systems/portal/WorldPortalTransport';
import type { PortalPair, PortalPoint } from '../src/systems/PortalTraversal';

const pair = (id: string, ownerId: string, a: PortalPoint, b: PortalPoint): PortalPair => ({
  id, ownerId, a, b, radius: 16, reentryDistance: 48, damageBonus: 0, createdAt: 0, expiresAt: Infinity,
});

function source(pairs: readonly PortalPair[], extra: Partial<PortalPairSource> = {}) {
  let view = pairs;
  return {
    getPortalPairs: () => view,
    replace(next: readonly PortalPair[]) { view = next; },
    isPortalFriendly: vi.fn(() => true),
    transferFlash: { start: 0x111111, end: 0x222222 },
    ...extra,
  };
}

function harness() {
  const actors = new Map<string, PortalActor>();
  const add = (id: string, x: number, y: number, extra: Partial<PortalActor> = {}) => actors.set(id, {
    id, x, y, kind: id.startsWith('enemy') ? 'enemy' : 'player', radius: 10, alive: true, surface: true, revision: 0, ...extra,
  });
  const world: PortalTransportWorldPort = {
    getActors: () => [...actors.values()],
    canOccupy: vi.fn(() => true),
    transferActor: vi.fn((actor: PortalActor, x: number, y: number) => {
      const current = actors.get(actor.id)!;
      actors.set(actor.id, { ...current, x, y, revision: current.revision + 1 });
    }),
    collapseEnemy: vi.fn(),
  };
  const network = { broadcastTranslocatorFlash: vi.fn() };
  const combat = { isAlive: (id: string) => actors.get(id)?.alive ?? false, applyDamage: vi.fn() };
  const transport = new WorldPortalTransport(combat as never, network);
  transport.bindWorld(world);
  return { transport, actors, add, world, network };
}

describe('WorldPortalTransport', () => {
  it('moves actors through the pairs of every source and chains a hop across sources', () => {
    const h = harness();
    const first = source([pair('one', 'owner-1', { x: 0, y: 0 }, { x: 100, y: 0 })]);
    const second = source([pair('two', 'portal-link:two', { x: 100, y: 0 }, { x: 300, y: 0 })],
      { transferFlash: { start: 0x333333, end: 0x444444 } });
    h.transport.register(first); h.transport.register(second);
    h.add('p', 0, 0);
    h.transport.transferActors(10);
    expect(h.actors.get('p')).toMatchObject({ x: 300, y: 0, revision: 2 });
    expect(h.network.broadcastTranslocatorFlash.mock.calls.map(call => call[2]))
      .toEqual([0x111111, 0x222222, 0x333333, 0x444444]);
  });

  it('lets a source refuse bodies without affecting the pairs of other sources', () => {
    const h = harness();
    const filtered = source([pair('gate', 'portal-link:gate', { x: 0, y: 0 }, { x: 200, y: 0 })],
      { admitsActor: (_pair, actor) => !actor.boss && !actor.fixed });
    const open = source([pair('open', 'owner', { x: 0, y: 400 }, { x: 200, y: 400 })]);
    h.transport.register(filtered); h.transport.register(open);
    h.add('enemy-boss', 0, 0, { boss: true }); h.add('enemy-fixed', 0, 0, { fixed: true });
    h.add('enemy-small', 0, 0); h.add('enemy-boss-2', 0, 400, { boss: true });
    h.transport.transferActors(10);
    expect(h.actors.get('enemy-boss')).toMatchObject({ x: 0, y: 0, revision: 0 });
    expect(h.actors.get('enemy-fixed')).toMatchObject({ x: 0, y: 0, revision: 0 });
    expect(h.actors.get('enemy-small')).toMatchObject({ x: 200, y: 0 });
    expect(h.actors.get('enemy-boss-2')).toMatchObject({ x: 200, y: 400 });
  });

  it('keeps the merged view stable by identity and drops a source on unregister', () => {
    const h = harness();
    const pairs = [pair('one', 'owner', { x: 0, y: 0 }, { x: 100, y: 0 })];
    const only = source(pairs);
    const empty = source([]);
    const unregisterOnly = h.transport.register(only);
    h.transport.register(empty);
    expect(h.transport.getPortalPairs()).toBe(pairs);
    const other = source([pair('two', 'owner-2', { x: 0, y: 300 }, { x: 100, y: 300 })]);
    const unregisterOther = h.transport.register(other);
    const merged = h.transport.getPortalPairs();
    expect(merged.map(p => p.id)).toEqual(['one', 'two']);
    expect(h.transport.getPortalPairs()).toBe(merged);
    only.replace([...pairs]);
    expect(h.transport.getPortalPairs()).not.toBe(merged);
    unregisterOnly(); unregisterOther();
    expect(h.transport.getPortalPairs()).toHaveLength(0);
    h.add('p', 0, 0);
    h.transport.transferActors(10);
    expect(h.world.transferActor).not.toHaveBeenCalled();
  });

  it('routes friendliness to the source that owns the pair', () => {
    const h = harness();
    const friendly = source([pair('one', 'owner', { x: 0, y: 0 }, { x: 100, y: 0 })]);
    const hostile = source([pair('two', 'portal-link:two', { x: 0, y: 300 }, { x: 100, y: 300 })],
      { isPortalFriendly: vi.fn(() => false) });
    h.transport.register(friendly); h.transport.register(hostile);
    expect(h.transport.isPortalFriendly('owner', 'p')).toBe(true);
    expect(h.transport.isPortalFriendly('portal-link:two', 'p')).toBe(false);
    expect(hostile.isPortalFriendly).toHaveBeenCalledWith('portal-link:two', 'p');
    expect(h.transport.isPortalFriendly('nobody', 'p')).toBe(false);
  });

  it('throttles flashes per endpoint for a crowd crossing', () => {
    const h = harness();
    h.transport.register(source([pair('crowd', 'portal-link:crowd', { x: 0, y: 0 }, { x: 200, y: 0 })],
      { transferFlash: { start: 1, end: 2, throttleMs: 200 } }));
    h.add('enemy-1', 0, 0); h.add('enemy-2', 2, 0);
    h.transport.transferActors(1000);
    expect(h.world.transferActor).toHaveBeenCalledTimes(2);
    expect(h.network.broadcastTranslocatorFlash).toHaveBeenCalledTimes(2);
    h.add('enemy-3', 0, 0);
    h.transport.transferActors(1100);
    expect(h.network.broadcastTranslocatorFlash).toHaveBeenCalledTimes(2);
    h.add('enemy-4', 0, 0);
    h.transport.transferActors(1200);
    expect(h.network.broadcastTranslocatorFlash).toHaveBeenCalledTimes(4);
  });

  it.each([[undefined, 100], [900, 0]] as const)('releases an exit gate by time only when the source asks (%s ms)',
    (gateReleaseMs, endX) => {
      const h = harness();
      h.transport.register(source([pair('link', 'portal-link:link', { x: 0, y: 0 }, { x: 100, y: 0 })],
        { gateReleaseMsFor: () => gateReleaseMs }));
      h.add('enemy', 0, 0);
      h.transport.transferActors(1000);
      expect(h.actors.get('enemy')).toMatchObject({ x: 100, y: 0 });
      h.transport.transferActors(1100);
      expect(h.actors.get('enemy')).toMatchObject({ x: 100, y: 0 });
      h.transport.transferActors(1900);
      expect(h.actors.get('enemy')).toMatchObject({ x: endX, y: 0 });
    });

  it('collapses only enemies that the caller counts as affected and that stand near an endpoint', () => {
    const h = harness();
    const collapsing = pair('link', 'portal-link:link', { x: 0, y: 0 }, { x: 500, y: 0 });
    h.add('enemy-near-b', 560, 0); h.add('enemy-far', 250, 0); h.add('enemy-ally', 10, 0); h.add('p', 0, 0);
    const config = { collapseRadius: 100, collapseSlowFraction: 0.5, collapseSlowDurationMs: 3000,
      collapsePullSpeed: 900, collapsePullDurationMs: 300 };
    h.transport.collapse(collapsing, config, 'portal-link:link', actor => actor.id !== 'enemy-ally', 7);
    expect(h.world.collapseEnemy).toHaveBeenCalledTimes(1);
    expect(h.world.collapseEnemy).toHaveBeenCalledWith(expect.objectContaining({ id: 'enemy-near-b' }),
      collapsing.b, config, 'portal-link:link', 7);
  });
});
