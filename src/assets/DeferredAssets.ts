import { UPGRADE_HEADER, UPGRADE_CONTROLS } from '../ui/UpgradeForestAssets';
import { PERSISTENT_BASE_HEADER } from '../ui/PersistentBaseAssets';
import type * as Phaser from 'phaser';
import { LOADING_FOREST } from '../ui/LoadingScreenAssets';
import { getMusicAssetPath } from '../audio/AudioCatalog';
import { MATCH_RESULTS_BANNER, MATCH_RESULTS_BACKGROUND, MATCH_RESULTS_TITLE } from '../ui/MatchResultsAssets';

/** Only assets unnecessary for revealing the lobby belong here. Required assets fail closed. */
export interface DeferredAsset {
  readonly key: string;
  readonly type: 'audio' | 'image';
  readonly url: string;
  readonly optional: boolean;
}

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

  constructor(private readonly scene: Phaser.Scene, assets = DEFERRED_ASSETS) {
    this.entries = assets.map(asset => ({ asset, attempts: 0, done: false, failed: false,
      total: 0, loaded: 0, cached: false }));
  }

  getState(): DeferredAssetState { return this.state; }

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
    this.publish();
    this.queueBatch();
  }

  private isCached(asset: DeferredAsset): boolean {
    return asset.type === 'audio' ? this.scene.cache.audio.exists(asset.key) : this.scene.textures.exists(asset.key);
  }

  private queueBatch(): void {
    const pending = this.entries.filter(entry => !entry.done && !entry.failed);
    if (pending.length === 0) { this.finish(); return; }
    const loader = this.scene.load;
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
export function getDeferredAssets(scene: Phaser.Scene): DeferredAssets {
  let owner = owners.get(scene);
  if (!owner) {
    owner = new DeferredAssets(scene);
    owners.set(scene, owner);
    const created = owner;
    scene.events.once('shutdown', () => { created.destroy(); owners.delete(scene); });
  }
  return owner;
}
