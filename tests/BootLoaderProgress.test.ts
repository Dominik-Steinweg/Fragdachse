import { EventEmitter } from 'node:events';
import type * as Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { observeBootLoader } from '../src/ui/BootLoaderProgress';

function fixture() {
  const loader = Object.assign(new EventEmitter(), {
    totalToLoad: 2, totalFailed: 0, list: new Set(), inflight: new Set<unknown>(), queue: new Set<unknown>(),
  });
  const progress = vi.fn(), complete = vi.fn();
  const dispose = observeBootLoader(loader as unknown as Phaser.Loader.LoaderPlugin, progress, complete);
  return { loader, progress, complete, dispose };
}

describe('boot download and processing accounting', () => {
  it('includes concurrent decode work and samples after Phaser mutates its queues', async () => {
    const { loader, progress, complete } = fixture();
    const image = { type: 'image', key: 'leaves' }, audio = { type: 'audio', key: 'music' };
    loader.inflight.add(image); loader.inflight.add(audio);
    loader.inflight.delete(image);
    loader.emit('progress', .5); // Phaser emits this BEFORE queue.add()
    loader.queue.add(image); loader.emit('load', image);
    await Promise.resolve();
    expect(progress).toHaveBeenLastCalledWith({ total: 2, downloaded: 1, processed: 0, failed: 0, processing: ['image:leaves'] });
    loader.inflight.delete(audio); loader.emit('progress', 1);
    loader.queue.add(audio); loader.emit('load', audio);
    loader.emit('filecomplete', 'leaves', 'image'); // BEFORE queue.delete()
    loader.queue.delete(image);
    await Promise.resolve();
    expect(progress).toHaveBeenLastCalledWith({ total: 2, downloaded: 2, processed: 1, failed: 0, processing: ['audio:music'] });
    expect(complete).not.toHaveBeenCalled();
    loader.emit('filecomplete', 'music', 'audio'); loader.queue.delete(audio);
    loader.emit('complete');
    await Promise.resolve();
    expect(progress).toHaveBeenLastCalledWith({ total: 2, downloaded: 2, processed: 2, failed: 0, processing: [] });
    expect(complete).toHaveBeenCalledOnce();
    expect(loader.eventNames()).toEqual([]);
  });

  it('does not overcount MultiFile completion events and preserves failed-file diagnostics', async () => {
    const { loader, progress } = fixture();
    loader.totalFailed = 1;
    loader.emit('loaderror');
    loader.emit('filecomplete', 'atlas'); loader.emit('filecomplete', 'atlas-json'); loader.emit('filecomplete', 'atlas-image');
    await Promise.resolve();
    expect(progress.mock.lastCall?.[0]).toMatchObject({ total: 2, processed: 2, failed: 1 });
    expect(progress).toHaveBeenCalledOnce();
  });

  it('ignores queued microtasks and subsequent deferred loading after disposal', async () => {
    const { loader, progress, complete, dispose } = fixture();
    loader.emit('progress'); dispose();
    await Promise.resolve(); loader.emit('complete'); loader.emit('start');
    expect(progress).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
    expect(loader.eventNames()).toEqual([]);
  });
});
