import { describe, expect, it, vi } from 'vitest';
import { TranslocatorTeleportRenderer, translocatorPortalViews } from '../src/effects/TranslocatorTeleportRenderer';
import type { PortalPresentation } from '../src/effects/portal/PortalPresentation';
import type { PortalPair } from '../src/systems/PortalTraversal';

const pair: PortalPair = { id: 'pair', ownerId: 'owner', a: { x: 100, y: 100 }, b: { x: 400, y: 100 },
  radius: 16, reentryDistance: 40, damageBonus: 0, createdAt: 0, expiresAt: 15000 };

function portals() {
  return { submit: vi.fn(), clear: vi.fn(), playTransfer: vi.fn(), playFlashAt: vi.fn(), playCollapse: vi.fn() };
}

describe('translocator pairs in the shared portal look', () => {
  it('shows both ends with their own colour, the partner, the destination ground and the shared lifetime', () => {
    const [a, b] = translocatorPortalViews([pair], 7500);
    expect(a).toMatchObject({ key: 'pair:a', x: 100, y: 100, radius: 16, style: 'translocator-a', partner: pair.b, ground: 1 });
    expect(b).toMatchObject({ key: 'pair:b', x: 400, y: 100, style: 'translocator-b', partner: pair.a });
    expect(a.meter).toBeCloseTo(0.5);
    expect(a.open).toBe(1);
  });

  it('opens from nothing and closes before it expires', () => {
    expect(translocatorPortalViews([pair], 0)[0].open).toBe(0);
    expect(translocatorPortalViews([pair], 90)[0].open).toBeGreaterThan(0.5);
    expect(translocatorPortalViews([pair], 15000)[0].open).toBe(0);
  });

  it('announces a new pair once, forwards transport events and clears its ends on teardown', () => {
    const shared = portals();
    const renderer = new TranslocatorTeleportRenderer(shared as unknown as PortalPresentation);
    renderer.syncPortals([pair], 100);
    renderer.syncPortals([pair], 120);
    expect(shared.playTransfer).toHaveBeenCalledTimes(2);
    expect(shared.submit).toHaveBeenLastCalledWith('translocator', expect.arrayContaining([expect.objectContaining({ key: 'pair:a' })]));
    // A pair first seen late (join, hitch) appears without a burst.
    renderer.syncPortals([{ ...pair, id: 'late', createdAt: 0 }], 5000);
    expect(shared.playTransfer).toHaveBeenCalledTimes(2);
    renderer.playFlash(100, 100, 0x4fb4ff, 'start');
    expect(shared.playFlashAt).toHaveBeenCalledWith(100, 100, 0x4fb4ff, 'start');
    renderer.playCollapse(pair.a, pair.b, 16);
    expect(shared.playCollapse.mock.calls.map(call => call[2])).toEqual(['translocator-a', 'translocator-b']);
    renderer.destroy(); renderer.destroy();
    expect(shared.clear).toHaveBeenCalledTimes(1);
    renderer.syncPortals([pair], 200);
    expect(shared.submit).toHaveBeenCalledTimes(3);
  });
});
