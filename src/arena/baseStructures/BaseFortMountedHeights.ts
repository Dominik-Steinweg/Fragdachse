import * as Phaser from 'phaser';
import { getEnemyMeshAssets, type EnemyMeshData } from '../../assets/EnemyMeshAssets';
import { getPipelineAssetForTexture } from '../../config/pipelineAssets';
import type { MeshShadowCaster } from '../../effects/EnemyMeshShadowRenderer';
import { enemyMeshPose } from '../../effects/EnemyMeshShadowModel';

/** Stamp height range: turret shadows stand well below one and a half metres above their deck. */
export const MOUNTED_HEIGHT_RANGE_PX = 48;
const STAMP_SIZE = 64;
const maxBlends = new WeakMap<Phaser.Renderer.WebGL.WebGLRenderer, number>();

/** A MAX blend: overlapping turrets keep the taller height, as one height field. */
export function maxBlend(scene: Phaser.Scene): number {
  const renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  let mode = maxBlends.get(renderer);
  if (mode === undefined) {
    const gl = renderer.gl as WebGL2RenderingContext;
    mode = renderer.addBlendMode([gl.ONE, gl.ONE], gl.MAX);
    maxBlends.set(renderer, mode);
  }
  return mode;
}

/**
 * Texture keys are game-wide; the lobby fort and the base editor's fort live at the same time, so
 * every grid and stamp gets a key no other instance uses.
 */
let nextMountedTextureId = 0;

/**
 * Heights of the turrets mounted on a base structure, in the structure's caster grid: each turret's
 * own shadow mesh, rasterised once per pose from above and stamped with the sprite's displayed
 * transform. The structure's height-field shadow reads it beside its own caster heights, so a turret
 * on a deck casts one shadow with the walls below it, offset by the deck height and never doubled.
 */
export class BaseFortMountedHeights {
  private readonly stamps = new Map<string, string>();
  private readonly brush: Phaser.GameObjects.Image;
  private readonly blend: number;

  constructor(private readonly scene: Phaser.Scene) {
    this.blend = maxBlend(scene);
    this.brush = new Phaser.GameObjects.Image(scene, 0, 0, '__WHITE').setBlendMode(this.blend);
  }

  /** A height grid of `texels` square over a canvas; cleared to ground. */
  createTarget(texels: number): Phaser.Textures.DynamicTexture {
    const target = this.scene.textures.addDynamicTexture(`base-fort-mounted-${++nextMountedTextureId}`, texels, texels)!;
    target.clear().render();
    return target;
  }

  /**
   * Redraws the grid from the casters standing on the structure. Returns whether any stamp landed;
   * a caster whose mesh is not loaded yet is skipped and appears with its mesh.
   */
  draw(target: Phaser.Textures.DynamicTexture, left: number, top: number, texelPx: number,
    casters: readonly MeshShadowCaster[]): boolean {
    target.clear();
    let any = false;
    for (const caster of casters) {
      const sprite = caster.sprite;
      const asset = getPipelineAssetForTexture(caster.getImageKey());
      const mesh = asset ? getEnemyMeshAssets(this.scene).ready.get(asset.id) : undefined;
      if (!mesh || mesh.asset.revision !== asset!.revision) continue;
      const pose = enemyMeshPose(sprite.frame.name, mesh);
      if (pose < 0) continue;
      this.brush.setTexture(this.stamp(mesh, pose)).setOrigin(sprite.originX, sprite.originY)
        .setRotation(sprite.rotation).setFlip(sprite.flipX, sprite.flipY)
        .setDisplaySize(sprite.displayWidth / texelPx, sprite.displayHeight / texelPx)
        .setPosition((sprite.x - left) / texelPx, (sprite.y - top) / texelPx);
      // Queued commands read the brush when rendered: execute each stamp before moving the brush on.
      target.draw(this.brush).render();
      any = true;
    }
    if (!any) target.render();
    return any;
  }

  /** Top-down maximum height of one mesh pose over its sprite canvas; R holds height / range. */
  private stamp(mesh: EnemyMeshData, pose: number): string {
    const id = `${mesh.asset.id}:${pose}`;
    const existing = this.stamps.get(id);
    if (existing) return existing;
    const size = STAMP_SIZE, canvas = mesh.asset.coordinates.canvasWorldPx, heights = new Float32Array(size * size);
    const count = mesh.asset.mesh.vertexCount, base = pose * count * 3, p = mesh.positions, idx = mesh.indices;
    const px = (i: number) => (p[base + i * 3] / canvas + .5) * size, py = (i: number) => (p[base + i * 3 + 1] / canvas + .5) * size;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ax = px(a), ay = py(a), bx = px(b), by = py(b), cx = px(c), cy = py(c);
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      const az = p[base + a * 3 + 2], bz = p[base + b * 3 + 2], cz = p[base + c * 3 + 2];
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const sx = x + .5, sy = y + .5;
        const w0 = ((bx - sx) * (cy - sy) - (by - sy) * (cx - sx)) / area;
        const w1 = ((cx - sx) * (ay - sy) - (cy - sy) * (ax - sx)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * az + w1 * bz + w2 * cz, i = y * size + x;
        if (z > heights[i]) heights[i] = z;
      }
    }
    const key = `base-fort-mounted-stamp-${++nextMountedTextureId}`;
    const texture = this.scene.textures.createCanvas(key, size, size)!;
    const image = texture.context.createImageData(size, size);
    for (let i = 0; i < heights.length; i++) {
      if (heights[i] <= 0) continue;
      const value = Math.round(Math.min(1, heights[i] / MOUNTED_HEIGHT_RANGE_PX) * 255);
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = Math.max(1, value);
      image.data[i * 4 + 3] = 255;
    }
    texture.context.putImageData(image, 0, 0);
    texture.refresh();
    this.stamps.set(id, key);
    return key;
  }

  destroy(): void {
    this.brush.destroy();
    for (const key of this.stamps.values()) this.scene.textures.remove(key);
    this.stamps.clear();
  }
}
