import type * as Phaser from 'phaser';
import { getDeferredAssets, type DeferredAsset } from '../assets/DeferredAssets';
import { runtimeAssetUrl } from '../assets/RuntimeAssetUrls';
import { COOP_DEFENSE_ITEM_ART_LEVELS, COOP_DEFENSE_ITEM_ART_SLOTS,
  getCoopDefenseItemArtKey, getCoopDefenseItemEmptyArtKey } from './coopDefenseItemIcons';
import { UPGRADE_CONTROLS, UPGRADE_HEADER } from './UpgradeForestAssets';
import { MATCH_RESULTS_BACKGROUND } from './MatchResultsAssets';

export type OverlayAssetGroup = 'items' | 'upgrades';
export const ITEM_VIEW_ASSETS: readonly DeferredAsset[] = COOP_DEFENSE_ITEM_ART_SLOTS.flatMap(slot =>
  [getCoopDefenseItemEmptyArtKey(slot), ...COOP_DEFENSE_ITEM_ART_LEVELS.map(level => getCoopDefenseItemArtKey(slot, level))]
    .map(key => ({ key, type: 'image' as const, url: `./assets/sprites/coop-defense/${key}.png`, optional: false })));
const UPGRADE_VIEW_ASSETS: readonly DeferredAsset[] = [...UPGRADE_CONTROLS, UPGRADE_HEADER, MATCH_RESULTS_BACKGROUND]
  .map(asset => ({ ...asset, type: 'image', optional: false }));
const assetsFor = (group: OverlayAssetGroup) => group === 'items' ? ITEM_VIEW_ASSETS : UPGRADE_VIEW_ASSETS;

/** UI-only queue, after the existing second phase. Never publishes network/World Ready.
 * The Scene's Loader is shared, so batches are serialized and use normal image processing.
 */
export class OverlayAssets {
  private readonly pending = new Map<OverlayAssetGroup, Promise<void>>();
  private tail: Promise<void> = Promise.resolve();
  private destroyed = false;
  private prefetchScheduled = false;
  private readonly aborts = new Set<() => void>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once('shutdown', this.destroy, this);
  }

  ready(group: OverlayAssetGroup): boolean {
    return assetsFor(group).every(asset => this.scene.textures.exists(asset.key));
  }

  ensure(group: OverlayAssetGroup): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('Overlay assets closed'));
    if (this.ready(group)) return Promise.resolve();
    const existing = this.pending.get(group);
    if (existing) return existing;
    const work = this.tail.then(async () => {
      await this.waitForDeferred();
      for (let attempt = 0; attempt < 3 && !this.ready(group); attempt++) {
        const missing = assetsFor(group).filter(asset => !this.scene.textures.exists(asset.key));
        // Small batches keep the background prefetch from filling the entire Loader queue.
        for (let index = 0; index < missing.length; index += 4) await this.loadBatch(missing.slice(index, index + 4));
      }
      if (!this.ready(group)) throw new Error('Overlay images could not be loaded');
    });
    this.pending.set(group, work);
    this.tail = work.then(() => { this.pending.delete(group); }, () => { this.pending.delete(group); });
    return work;
  }

  /** Called only after Lobby reveal. It never builds overlays or holds up Ready. */
  prefetch(): void {
    if (this.destroyed || this.prefetchScheduled) return;
    this.prefetchScheduled = true;
    const timer = setTimeout(() => { this.aborts.delete(cancel); void this.ensure('items').catch(() => {}); }, 1500);
    const cancel = () => clearTimeout(timer);
    this.aborts.add(cancel);
  }

  private waitForDeferred(): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('Overlay assets closed'));
    const owner = getDeferredAssets(this.scene);
    owner.start();
    return new Promise((resolve, reject) => {
      if (this.destroyed) { reject(new Error('Overlay assets closed')); return; }
      let unsubscribe: (() => void) | undefined;
      const finish = (error?: Error) => {
        unsubscribe?.(); this.aborts.delete(cancel);
        if (error) reject(error); else resolve();
      };
      const cancel = () => finish(new Error('Overlay assets closed'));
      this.aborts.add(cancel);
      const state = owner.getState();
      if (state.status === 'complete' || state.status === 'error') { finish(); return; }
      unsubscribe = owner.subscribe(state => {
        if (state.status === 'complete' || state.status === 'error') finish();
      });
    });
  }

  private async loadBatch(assets: readonly DeferredAsset[]): Promise<void> {
    if (this.destroyed) throw new Error('Overlay assets closed');
    const loader = this.scene.load;
    if (loader.isLoading()) {
      await this.loaderComplete(false);
      return this.loadBatch(assets.filter(asset => !this.scene.textures.exists(asset.key)));
    }
    if (!assets.length) return;
    const completed = this.loaderComplete(true);
    try {
      for (const asset of assets) loader.image({ key: asset.key, url: runtimeAssetUrl(asset.url),
        xhrSettings: { responseType: 'blob', timeout: 15000 } });
      loader.start();
    } catch (error) {
      // Cancel all waits if the Loader itself cannot enqueue; no orphaned promises.
      this.destroy();
      await completed.catch(() => {});
      throw error;
    }
    await completed;
  }

  private loaderComplete(owned: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const loader = this.scene.load;
      const finish = (error?: Error) => {
        loader.off('complete', complete); this.aborts.delete(cancel);
        if (error) reject(error); else resolve();
      };
      // Leave Phaser's completion dispatch before issuing another batch.
      const complete = () => queueMicrotask(() => finish());
      const cancel = () => finish(new Error(owned ? 'Overlay load cancelled' : 'Scene load cancelled'));
      this.aborts.add(cancel);
      loader.once('complete', complete);
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off('shutdown', this.destroy, this);
    for (const cancel of [...this.aborts]) cancel();
    this.aborts.clear();
  }
}

const owners = new WeakMap<Phaser.Scene, OverlayAssets>();
export function getOverlayAssets(scene: Phaser.Scene): OverlayAssets {
  let owner = owners.get(scene);
  if (!owner) {
    owner = new OverlayAssets(scene); owners.set(scene, owner);
    scene.events.once('shutdown', () => owners.delete(scene));
  }
  return owner;
}
