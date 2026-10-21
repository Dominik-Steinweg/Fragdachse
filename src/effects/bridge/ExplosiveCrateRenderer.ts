import type * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import type { SyncedCoopDefenseCarryItem } from '../../types';
import { ensureCanvasTexture } from '../EffectUtils';

const CRATE_KEY = 'bridge-explosive-crate';
const CRATE_SIZE = 18;

/** Small dynamite crate: battered planks, iron corners and a red warning band, no lettering. */
function ensureExplosiveCrateTexture(textures: Phaser.Textures.TextureManager): void {
  ensureCanvasTexture(textures, CRATE_KEY, 36, 36, ctx => {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(3, 4, 32, 31);
    ctx.fillStyle = '#5c4632';
    ctx.fillRect(2, 2, 32, 32);
    for (let y = 4; y < 32; y += 7) {
      ctx.fillStyle = y % 2 ? '#7a5e43' : '#6f553c';
      ctx.fillRect(4, y, 28, 6);
      ctx.fillStyle = 'rgba(255,232,190,0.12)';
      ctx.fillRect(4, y, 28, 1);
    }
    // Faded red warning band across the lid.
    ctx.fillStyle = '#8c2a1f';
    ctx.fillRect(4, 15, 28, 6);
    ctx.fillStyle = 'rgba(232,200,150,0.55)';
    for (let x = 6; x < 32; x += 6) { ctx.beginPath(); ctx.moveTo(x, 21); ctx.lineTo(x + 3, 15); ctx.lineTo(x + 5, 15); ctx.lineTo(x + 2, 21); ctx.fill(); }
    ctx.strokeStyle = '#3a2c1f'; ctx.lineWidth = 2; ctx.strokeRect(3, 3, 30, 30);
    ctx.fillStyle = '#62686b';
    for (const [x, y] of [[2, 2], [28, 2], [2, 28], [28, 28]]) {
      ctx.fillRect(x!, y!, 6, 6);
      ctx.fillStyle = '#2f3335'; ctx.fillRect(x! + 2, y! + 2, 2, 2); ctx.fillStyle = '#62686b';
    }
  });
}

/**
 * Explosive cargo on the ground and in a carrier's arms. Reads the replicated carry slice; the
 * carry owner decides pickup, drops and consumption.
 */
export class ExplosiveCrateRenderer {
  private readonly crates = new Map<string, Phaser.GameObjects.Image>();
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    ensureExplosiveCrateTexture(scene.textures);
  }

  sync(items: readonly SyncedCoopDefenseCarryItem[]): void {
    if (this.destroyed) return;
    const seen = new Set<string>();
    for (const item of items) {
      const carried = item.holderId !== null;
      let crate = this.crates.get(item.id);
      if (!crate) {
        crate = this.scene.add.image(item.x, item.y, CRATE_KEY);
        this.crates.set(item.id, crate);
      }
      crate.setDisplaySize(CRATE_SIZE, CRATE_SIZE).setRotation(carried ? -0.18 : 0)
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
