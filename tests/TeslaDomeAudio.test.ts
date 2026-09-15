import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
import { TeslaDomeRenderer } from '../src/effects/TeslaDomeRenderer';
import type { SyncedTeslaDome } from '../src/types';

describe('Tesla activation feedback', () => {
  it('baselines initial domes and keeps activation identity across visual teardown and repeated snapshots', () => {
    const renderer = new TeslaDomeRenderer({} as never);
    const playSound = vi.fn();
    renderer.setAudioSystem({ playSound } as never);
    // Allocate no GPU objects: the real snapshot consumer and its lifetime are under test.
    vi.spyOn(renderer as any, 'createVisual').mockImplementation(() => ({ targets: [], lastPulseSequence: 0 }));
    vi.spyOn(renderer as any, 'destroyVisual').mockImplementation(() => {});
    const dome = { ownerId: 'p1', x: 10, y: 20, radius: 30, alpha: 1, color: 1, targets: [], activationSequence: 1 } as SyncedTeslaDome;
    renderer.syncVisuals([dome], 1);
    renderer.destroyAll(); renderer.syncVisuals([dome], 1);
    expect(playSound).not.toHaveBeenCalled();
    renderer.syncVisuals([{ ...dome, activationSequence: 2 }], 1);
    renderer.syncVisuals([{ ...dome, activationSequence: 2 }], 1);
    renderer.syncVisuals([dome], 1);
    renderer.destroyAll(); renderer.syncVisuals([{ ...dome, activationSequence: 2 }], 1);
    expect(playSound).toHaveBeenCalledExactlyOnceWith('sfx_tesla_activate', 10, 20, 'p1');
    renderer.syncVisuals([{ ...dome, activationSequence: 3 }], 2);
    expect(playSound).toHaveBeenCalledOnce();
    renderer.syncVisuals([], 2);
    renderer.syncVisuals([{ ...dome, activationSequence: 4 }], 2);
    expect(playSound).toHaveBeenCalledTimes(2);
  });
});
