import { loadingTimeline } from '../diagnostics/LoadingTimeline';
import { observeLoaderProcessing } from '../ui/BootLoaderProgress';
import { UPGRADE_HEADER, UPGRADE_CONTROLS } from '../ui/UpgradeForestAssets';
import { PERSISTENT_BASE_HEADER } from '../ui/PersistentBaseAssets';
import type * as Phaser from 'phaser';
import { LOADING_FOREST } from '../ui/LoadingScreenAssets';
import { getMusicAssetPath } from '../audio/AudioCatalog';
import { MATCH_RESULTS_BANNER, MATCH_RESULTS_BACKGROUND, MATCH_RESULTS_TITLE } from '../ui/MatchResultsAssets';

/** Only assets unnecessary for revealing the lobby belong here. Required assets fail closed. */
export interface DeferredAsset {
  readonly key: string;
  readonly type: 'audio' | 'image' | 'spritesheet';
  readonly url: string;
  readonly optional: boolean;
  /** Spritesheet layout, exactly as the original preload declared it. */
  readonly frameConfig?: Phaser.Types.Loader.FileTypes.ImageFrameConfig;
}

/** Files one deferred batch may queue: uploads after the reveal stay spread over frames. */
const DEFERRED_BATCH_FILES = 16;

export const DEFERRED_ASSETS: readonly DeferredAsset[] = [
  ...UPGRADE_CONTROLS.map(asset => ({ ...asset, type: 'image' as const, optional: true })),
  { ...UPGRADE_HEADER, type: 'image', optional: true },
  { ...PERSISTENT_BASE_HEADER, type: 'image', optional: true },
  { ...LOADING_FOREST, type: 'image', optional: true },
  { ...MATCH_RESULTS_TITLE, type: 'image', optional: true },
  { ...MATCH_RESULTS_BANNER, type: 'image', optional: true },
  { ...MATCH_RESULTS_BACKGROUND, type: 'image', optional: true },
  { key: 'music_lobby', type: 'audio', url: getMusicAssetPath('music_lobby'), optional: true },
  { key: 'music_arena', type: 'audio', url: getMusicAssetPath('music_arena'), optional: true },
];

type RecordedFile = string | { key: string; url?: string; frameConfig?: Phaser.Types.Loader.FileTypes.ImageFrameConfig };

/**
 * The files an existing preload function queues, as deferred entries: keys, paths and layouts
 * keep a single owner. Only images and spritesheets are recorded; any other file type fails loudly.
 */
export function recordDeferredFiles(preload: (loader: Phaser.Loader.LoaderPlugin) => void, optional: boolean): DeferredAsset[] {
  const assets = new Map<string, DeferredAsset>();
  const add = (type: 'image' | 'spritesheet', file: RecordedFile, url?: string,
    frameConfig?: Phaser.Types.Loader.FileTypes.ImageFrameConfig): void => {
    const entry = typeof file === 'string' ? { key: file, url: url!, frameConfig } : { ...file, url: file.url! };
    if (!assets.has(entry.key)) assets.set(entry.key, { key: entry.key, type, url: entry.url, optional,
      ...(type === 'spritesheet' ? { frameConfig: entry.frameConfig } : {}) });
  };
  const recorder = {
    image(file: RecordedFile, url?: string) { add('image', file, url); return recorder; },
    spritesheet(file: RecordedFile, url?: string, frameConfig?: Phaser.Types.Loader.FileTypes.ImageFrameConfig) {
      add('spritesheet', file, url, frameConfig); return recorder;
    },
  };
  preload(recorder as unknown as Phaser.Loader.LoaderPlugin);
  return [...assets.values()];
}

export interface DeferredAssetState {
  readonly status: 'idle' | 'loading' | 'complete' | 'error';
  /** Actual byte progress, or null when totals are unknown / processing is still pending. */
  readonly progress: number | null;
  readonly ready: boolean;
  readonly failedKeys: readonly string[];
}

type Listener = (state: DeferredAssetState) => void;
type Entry = { asset: DeferredAsset; attempts: number; done: boolean; failed: boolean;
  total: number; loaded: number; cached: boolean };

/** One second-phase load per persistent Scene; consumers never enqueue individual assets. */
export class DeferredAssets {
  private readonly listeners = new Set<Listener>();
  private readonly entries: Entry[];
  private state: DeferredAssetState = { status: 'idle', progress: null, ready: false, failedKeys: [] };
  private highWater = 0;
  private reliableTotals = true;
  private destroyed = false;
  private stopTiming: (() => void) | null = null;

  constructor(private readonly scene: Phaser.Scene, assets: readonly DeferredAsset[] = DEFERRED_ASSETS,
    private readonly batchFiles = DEFERRED_BATCH_FILES) {
    this.entries = assets.map(asset => ({ asset, attempts: 0, done: false, failed: false,
      total: 0, loaded: 0, cached: false }));
  }

  getState(): DeferredAssetState { return this.state; }

  /** Resolves once the phase ended, ready or with failed files; starting it stays with its owners. */
  whenSettled(): Promise<void> {
    return new Promise(resolve => {
      const unsubscribe = this.subscribe(state => {
        if (state.status !== 'complete' && state.status !== 'error') return;
        queueMicrotask(() => unsubscribe());
        resolve();
      });
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.destroyed || this.state.status !== 'idle') return;
    for (const entry of this.entries) entry.done = entry.cached = this.isCached(entry.asset);
    this.scene.load.on('fileprogress', this.onProgress);
    this.scene.load.on('filecomplete', this.onFileComplete);
    this.scene.load.on('complete', this.onBatchComplete);
    loadingTimeline.begin('deferred', String(performance.now()));
    this.publish();
    this.queueBatch();
  }

  private isCached(asset: DeferredAsset): boolean {
    return asset.type === 'audio' ? this.scene.cache.audio.exists(asset.key) : this.scene.textures.exists(asset.key);
  }

  private queueBatch(): void {
    const pending = this.entries.filter(entry => !entry.done && !entry.failed).slice(0, this.batchFiles);
    if (pending.length === 0) { this.finish(); return; }
    const loader = this.scene.load;
    this.stopTiming?.();
    this.stopTiming = observeLoaderProcessing(loader);
    // This owner retries both download and decode failures, after Phaser releases its queue.
    const previousRetries = loader.maxRetries;
    loader.maxRetries = 0;
    try {
      for (const entry of pending) {
        entry.attempts++;
        const xhrSettings: Phaser.Types.Loader.XHRSettingsObject = {
          responseType: entry.asset.type === 'audio' ? 'arraybuffer' : 'blob', timeout: 120_000,
        };
        const config = { key: entry.asset.key, url: entry.asset.url, xhrSettings };
        if (entry.asset.type === 'audio') loader.audio(config);
        else if (entry.asset.type === 'spritesheet') loader.spritesheet({ ...config, frameConfig: entry.asset.frameConfig });
        else loader.image(config);
      }
    } finally { loader.maxRetries = previousRetries; }
    if (!loader.isLoading()) loader.start();
  }

  private readonly onProgress = (file: Phaser.Loader.File): void => {
    const entry = this.entries.find(value => value.asset.key === file.key && value.asset.type === file.type);
    if (!entry || file.bytesTotal <= 0 || !Number.isFinite(file.bytesTotal)) return;
    // A changed response size on retry invalidates the denominator; prefer activity to a false percentage.
    if (entry.total > 0 && entry.total !== file.bytesTotal) this.reliableTotals = false;
    entry.total = file.bytesTotal;
    entry.loaded = Math.max(entry.loaded, Math.min(file.bytesLoaded, file.bytesTotal));
    this.publish();
  };

  private readonly onFileComplete = (key: string, type: string): void => {
    const entry = this.entries.find(value => value.asset.key === key && value.asset.type === type);
    if (!entry || !this.isCached(entry.asset)) return;
    // AudioFile caches only the decoded AudioBuffer, never the downloaded ArrayBuffer.
    entry.done = true;
    entry.loaded = entry.total;
    this.publish();
  };

  private readonly onBatchComplete = (): void => {
    for (const entry of this.entries) {
      entry.done = this.isCached(entry.asset);
      if (!entry.done && entry.attempts >= 3) entry.failed = true;
    }
    // Do not re-enter Loader.start() inside Phaser's completion event dispatch.
    queueMicrotask(() => { if (!this.destroyed) this.queueBatch(); });
  };

  private publish(terminal = false): void {
    const transferred = this.entries.filter(entry => !entry.cached);
    const known = this.reliableTotals && transferred.length > 0
      && transferred.every(entry => entry.total > 0 && !entry.failed);
    const ratio = known ? transferred.reduce((sum, entry) => sum + entry.loaded, 0)
      / transferred.reduce((sum, entry) => sum + entry.total, 0) : null;
    if (ratio !== null) this.highWater = Math.max(this.highWater, ratio);
    const blocked = this.entries.some(entry => entry.failed && !entry.asset.optional);
    this.state = {
      status: terminal ? (blocked ? 'error' : 'complete') : 'loading',
      progress: terminal && !blocked ? 1 : ratio !== null && ratio < 1 ? this.highWater : null,
      ready: terminal && !blocked,
      failedKeys: this.entries.filter(entry => entry.failed).map(entry => entry.asset.key),
    };
    for (const listener of this.listeners) listener(this.state);
  }

  private finish(): void {
    this.detachLoader();
    this.publish(true);
  }

  private detachLoader(): void {
    this.stopTiming?.(); this.stopTiming = null;
    loadingTimeline.get('deferred')?.finish(this.destroyed ? 'cancelled' : 'ready');
    this.scene.load.off('fileprogress', this.onProgress);
    this.scene.load.off('filecomplete', this.onFileComplete);
    this.scene.load.off('complete', this.onBatchComplete);
  }

  destroy(): void {
    this.destroyed = true;
    this.detachLoader();
    this.listeners.clear();
  }
}

const owners = new WeakMap<Phaser.Scene, DeferredAssets>();
/** The Scene's preload decides the second phase's content once, before any lookup. */
export function createDeferredAssets(scene: Phaser.Scene, assets: readonly DeferredAsset[]): DeferredAssets {
  return owners.get(scene) ?? getDeferredAssets(scene, assets);
}
export function getDeferredAssets(scene: Phaser.Scene, assets: readonly DeferredAsset[] = DEFERRED_ASSETS): DeferredAssets {
  let owner = owners.get(scene);
  if (!owner) {
    owner = new DeferredAssets(scene, assets);
    owners.set(scene, owner);
    const created = owner;
    scene.events.once('shutdown', () => { created.destroy(); owners.delete(scene); });
  }
  return owner;
}
