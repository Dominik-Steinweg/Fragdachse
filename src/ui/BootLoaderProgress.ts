import type * as Phaser from 'phaser';

/** Phaser PROGRESS excludes its processing queue (image decode, audio decode, cache upload).
 * Read after the loader event stack: FILE_COMPLETE fires before queue deletion, and
 * PROGRESS fires before a downloaded file is added to the processing queue.
 */
export function observeBootLoader(
  loader: Phaser.Loader.LoaderPlugin,
  onProgress: (state: BootLoaderState) => void,
  onComplete: () => void,
): () => void {
  let disposed = false;
  let queued = false;
  const sample = () => {
    if (disposed) return;
    const total = loader.totalToLoad;
    const downloaded = Math.max(0, total - loader.list.size - loader.inflight.size);
    const processed = Math.max(0, downloaded - loader.queue.size);
    onProgress({ total, downloaded, processed, failed: loader.totalFailed,
      processing: Array.from(loader.queue, file => `${file.type}:${file.key}`) });
  };
  const schedule = () => {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => { queued = false; sample(); });
  };
  const complete = () => { sample(); dispose(); onComplete(); };
  const events = ['start', 'progress', 'load', 'filecomplete', 'loaderror'];
  const dispose = () => {
    disposed = true;
    for (const event of events) loader.off(event, schedule);
    loader.off('complete', complete);
  };
  for (const event of events) loader.on(event, schedule);
  loader.once('complete', complete);
  return dispose;
}

export interface BootLoaderState {
  total: number;
  downloaded: number;
  processed: number;
  failed: number;
  processing: string[];
}
