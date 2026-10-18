import * as Phaser from 'phaser';
import { EnemyEyeBatch } from './EnemyEyeBatch';
import { registerGraphicsObject } from './EffectUtils';

/** Fixed canvas: the GPU layer keeps the frame size it was created with. Trunk centre = canvas centre. */
const SIZE = 256;
const HALF = SIZE / 2;
let nextId = 0;

/** One soft layer of a grounded circular caster: stadium hull of the trunk and its offset copy. */
export interface TrunkShadowLayer { readonly radius: number; readonly alpha: number }

/**
 * Continuous trunk shadows as one baked stamp plus a quad per visible tree. All trunks share the
 * sun direction and profile, so the former per-tree layered polygons (re-tessellated by Phaser in
 * every frame, about 5,000 path commands) collapse into a texture rebaked only when that shared
 * shape changes. Drawn with the same MULTIPLY blend; the shadow colour is near black, so the
 * pre-composited layers multiply the ground exactly like the sequential ones (within 0.2 %).
 */
export class ShadowTrunkStamp {
  private readonly batch: EnemyEyeBatch;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private signature = '';
  private writes = 0;

  constructor(scene: Phaser.Scene, depth: number) {
    const key = `__shadow_trunk_stamp_${nextId++}`;
    this.texture = scene.textures.createCanvas(key, SIZE, SIZE)!;
    this.batch = new EnemyEyeBatch(scene, key, 64, depth);
    this.batch.layer.setBlendMode(Phaser.BlendModes.MULTIPLY).setName('trunk-shadows');
    registerGraphicsObject(scene, 'dynamicShadows', this.batch.layer);
  }

  /**
   * Bakes the shared shape when it changed. Returns false when the shadow would not fit the
   * stamp (extreme evening lengths); the caller then keeps drawing that frame's polygons.
   */
  prepare(layers: readonly TrunkShadowLayer[], dx: number, dy: number, color: number): boolean {
    const reach = Math.hypot(dx, dy) + Math.max(0, ...layers.map(layer => layer.radius)) + 2;
    if (reach > HALF) return false;
    const signature = `${layers.map(layer => `${layer.radius.toFixed(2)}/${layer.alpha.toFixed(4)}`).join(',')}:${dx.toFixed(2)},${dy.toFixed(2)}:${color}`;
    if (signature === this.signature) return true;
    this.signature = signature;
    // Black stamp with alpha scaled by the colour's darkness reproduces dst * (1 - a * (1 - c)).
    const darkness = 1 - (0.299 * ((color >> 16) & 255) + 0.587 * ((color >> 8) & 255) + 0.114 * (color & 255)) / 255;
    const ctx = this.texture.context;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const angle = Math.atan2(dy, dx), still = dx * dx + dy * dy < 0.25;
    for (const { radius, alpha } of layers) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, alpha * darkness)})`;
      ctx.beginPath();
      if (still) ctx.arc(HALF, HALF, radius, 0, Math.PI * 2);
      else {
        // Convex stadium: back half around the trunk, front half around its offset copy.
        ctx.arc(HALF, HALF, radius, angle + Math.PI / 2, angle + Math.PI * 1.5);
        ctx.arc(HALF + dx, HALF + dy, radius, angle - Math.PI / 2, angle + Math.PI / 2);
        ctx.closePath();
      }
      ctx.fill();
    }
    this.texture.refresh();
    return true;
  }

  begin(capacity: number): void { this.writes = 0; this.batch.begin(capacity); }
  write(x: number, y: number): void { this.writes++; this.batch.write(x, y, SIZE, SIZE, 0, 0xffffff, 1); }
  /** `begin` reserved an upper bound; only written trunks count for visibility. */
  end(): void { this.batch.layer.setVisible(this.writes > 0); }
  hide(): void { this.writes = 0; this.batch.begin(0); }

  destroy(): void {
    this.batch.destroy();
    this.texture.destroy();
  }
}
