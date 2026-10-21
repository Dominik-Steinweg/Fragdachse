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
 * Draft stockpile of the Dawn demolition cache (96 px): crates on a pallet under a weathered tarp.
 * An authored asset loaded under the same key takes precedence.
 */
export function ensureDemolitionCacheTexture(textures: Phaser.Textures.TextureManager, key: string): void {
  ensureCanvasTexture(textures, key, 96, 96, ctx => {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath(); ctx.ellipse(50, 52, 40, 34, 0, 0, Math.PI * 2); ctx.fill();
    // Pallet boards.
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#5d4934' : '#66503a';
      ctx.fillRect(16, 18 + i * 10, 64, 8);
      ctx.fillStyle = 'rgba(255,230,190,0.08)'; ctx.fillRect(16, 18 + i * 10, 64, 1);
    }
    const crate = (x: number, y: number, w: number, h: number, angle: number) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-w / 2 + 2, -h / 2 + 3, w, h);
      ctx.fillStyle = '#6f553c'; ctx.fillRect(-w / 2, -h / 2, w, h);
      for (let yy = -h / 2 + 2; yy < h / 2 - 2; yy += 6) { ctx.fillStyle = 'rgba(255,232,190,0.1)'; ctx.fillRect(-w / 2 + 2, yy, w - 4, 1); }
      ctx.fillStyle = '#8a2b20'; ctx.fillRect(-w / 2 + 2, -3, w - 4, 6);
      ctx.fillStyle = 'rgba(232,200,150,0.5)';
      for (let xx = -w / 2 + 4; xx < w / 2 - 4; xx += 6) ctx.fillRect(xx, -3, 2, 6);
      ctx.strokeStyle = '#3a2c1f'; ctx.lineWidth = 2; ctx.strokeRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
      ctx.fillStyle = '#5f6466';
      for (const [cx, cy] of [[-w / 2, -h / 2], [w / 2 - 5, -h / 2], [-w / 2, h / 2 - 5], [w / 2 - 5, h / 2 - 5]]) ctx.fillRect(cx!, cy!, 5, 5);
      ctx.restore();
    };
    crate(34, 36, 26, 22, -0.06);
    crate(62, 34, 24, 22, 0.08);
    crate(40, 62, 24, 20, 0.04);
    // Loose sticks and a coil of fuse beside the stack.
    ctx.fillStyle = '#7d2a1f';
    for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(68 + i * 3, 64 + i * 4); ctx.rotate(0.5); ctx.fillRect(-7, -2, 14, 4); ctx.restore(); }
    ctx.strokeStyle = '#3b3027'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(74, 76, 5, 0, Math.PI * 1.7); ctx.stroke();
    // Weathered tarp over the back crate.
    ctx.fillStyle = 'rgba(86,92,70,0.92)';
    ctx.beginPath(); ctx.moveTo(48, 20); ctx.lineTo(78, 18); ctx.lineTo(80, 40); ctx.lineTo(70, 46); ctx.lineTo(52, 44); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(40,44,32,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(52, 24); ctx.lineTo(74, 40); ctx.moveTo(60, 20); ctx.lineTo(78, 32); ctx.stroke();
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
