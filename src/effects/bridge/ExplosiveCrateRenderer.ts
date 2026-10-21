import type * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { getPipelineAsset } from '../../config/pipelineAssets';
import type { SyncedCoopDefenseCarryItem } from '../../types';
import { BRIDGE_PIPELINE_ASSET_IDS } from './BridgeTextures';

/** The crate fills about 80 % of its authored 20 px canvas; shown slightly larger than authored. */
const CRATE_DISPLAY_SIZE = 22;

/**
 * Explosive cargo on the ground and in a carrier's arms. Reads the replicated carry slice; the
 * carry owner decides pickup, drops and consumption.
 */
export class ExplosiveCrateRenderer {
  private readonly crates = new Map<string, Phaser.GameObjects.Image>();
  private readonly textureKey = getPipelineAsset(BRIDGE_PIPELINE_ASSET_IDS.crate).textureKey;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {}

  sync(items: readonly SyncedCoopDefenseCarryItem[]): void {
    if (this.destroyed) return;
    const seen = new Set<string>();
    for (const item of items) {
      const carried = item.holderId !== null;
      let crate = this.crates.get(item.id);
      if (!crate) {
        crate = this.scene.add.image(item.x, item.y, this.textureKey);
        this.crates.set(item.id, crate);
      }
      crate.setDisplaySize(CRATE_DISPLAY_SIZE, CRATE_DISPLAY_SIZE).setRotation(carried ? -0.18 : 0)
        .setPosition(item.x, item.y - (carried ? 10 : 0)).setDepth(carried ? DEPTH.PLAYERS + 0.2 : DEPTH.BASES + 1);
      seen.add(item.id);
    }
    for (const [id, crate] of this.crates) {
      if (seen.has(id)) continue;
      crate.destroy();
      this.crates.delete(id);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const crate of this.crates.values()) crate.destroy();
    this.crates.clear();
  }
}
