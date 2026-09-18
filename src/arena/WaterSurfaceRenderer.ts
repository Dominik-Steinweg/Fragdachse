import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { WaterCell } from '../types';
import { ARENA_RENDER_CHUNK_SIZE, ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX, ARENA_RENDER_CHUNK_RELEASE_MARGIN_PX,
  type ChunkWorldFrame, type ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { WaterSurfaceModel, WATER_MASK_HALO, type WaterMask, type WaterMaskView } from './WaterSurfaceModel';
import { WATER_FRAGMENT, WATER_SHADER_NAME } from './waterSurfaceShader';

let nextWaterSurfaceId = 0;
interface WaterChunk { x: number; y: number; quad: Phaser.GameObjects.Shader; key: string }

/** World-lifetime CPU masks; only camera-resident chunks own textures and shaders. */
export class WaterSurfaceRenderer {
  private readonly id = nextWaterSurfaceId++;
  private preparation: Generator<void, void> | null = null;
  private readonly masks = new Map<string, WaterMask>();
  private readonly totalMasks: number;
  private destroyed = false;
  private readonly chunks = new Map<string, WaterChunk>();
  constructor(private readonly scene: Phaser.Scene, private readonly frame: ChunkWorldFrame,
    water: readonly WaterCell[], private readonly seed: number) {
    const model = new WaterSurfaceModel(water, frame);
    const origins = model.getChunkOrigins(ARENA_RENDER_CHUNK_SIZE, frame.width, frame.height);
    this.totalMasks = origins.length;
    if (origins.length) this.preparation = this.bakeMasks(model, origins);
  }

  private *bakeMasks(model: WaterSurfaceModel, origins: { x: number; y: number }[]): Generator<void, void> {
    for (const { x, y } of origins) {
      const mask = yield* model.bakeSteps(x, y, ARENA_RENDER_CHUNK_SIZE);
      this.masks.set(`${x / ARENA_RENDER_CHUNK_SIZE},${y / ARENA_RENDER_CHUNK_SIZE}`, mask);
      yield;
    }
  }

  /** Called once per presentation frame before residency, while the load barrier is closed.
   * Returning to the scene loop gives the loading UI an actual rendered frame between batches.
   * No callbacks survive teardown; a handoff holds (and later resumes) this same owner.
   */
  prepareMasks(budgetMs = 4): void {
    if (this.destroyed || !this.preparation) return;
    const deadline = performance.now() + budgetMs;
    do {
      if (this.preparation.next().done) {
        this.preparation = null;
        return;
      }
    } while (performance.now() < deadline);
  }

  isPrepared(): boolean { return !this.destroyed && this.preparation === null; }

  /** Borrow the immutable CPU masks. The presentation owner retains their lifetime. */
  *getPreparedMasks(): Generator<{ readonly x: number; readonly y: number; readonly mask: WaterMaskView }> {
    if (!this.isPrepared()) throw new Error('[WaterSurfaceRenderer] Masks are not prepared');
    for (const [key, mask] of this.masks) {
      const [cx, cy] = key.split(',').map(Number);
      yield { x: cx * ARENA_RENDER_CHUNK_SIZE, y: cy * ARENA_RENDER_CHUNK_SIZE, mask };
    }
  }

  getPreparationState(): { pending: number; completed: number; bytes: number } {
    const bytes = this.masks.size * (this.masks.values().next().value?.data.byteLength ?? 0);
    return { pending: this.destroyed ? 0 : this.totalMasks - this.masks.size, completed: this.masks.size, bytes };
  }

  updateResidency(view: ChunkWorldRect): void {
    if (!this.isPrepared()) return;
    const size = ARENA_RENDER_CHUNK_SIZE;
    const intersects = (x: number, y: number, margin: number): boolean => x + size >= view.x - margin
      && y + size >= view.y - margin && x <= view.x + view.width + margin && y <= view.y + view.height + margin;
    for (const [id, chunk] of this.chunks) {
      if (intersects(chunk.x, chunk.y, ARENA_RENDER_CHUNK_RELEASE_MARGIN_PX)) continue;
      chunk.quad.destroy(); this.scene.textures.remove(chunk.key); this.chunks.delete(id);
    }
    const margin = ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX;
    const minX = Math.max(0, Math.floor((view.x - margin - this.frame.offsetX) / size));
    const minY = Math.max(0, Math.floor((view.y - margin - this.frame.offsetY) / size));
    const maxX = Math.min(Math.ceil(this.frame.width / size) - 1, Math.floor((view.x + view.width + margin - this.frame.offsetX) / size));
    const maxY = Math.min(Math.ceil(this.frame.height / size) - 1, Math.floor((view.y + view.height + margin - this.frame.offsetY) / size));
    for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
      const id = `${cx},${cy}`;
      if (this.chunks.has(id)) continue;
      const mask = this.masks.get(id);
      if (!mask) continue;
      const key = `__water_${this.id}_${id}`;
      const texture = this.scene.textures.createCanvas(key, mask.size, mask.size);
      if (!texture) throw new Error('[WaterSurfaceRenderer] Cannot allocate mask');
      const pixels = texture.context.createImageData(mask.size, mask.size);
      pixels.data.set(mask.data); texture.context.putImageData(pixels, 0, 0); texture.refresh();
      texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      const x = this.frame.offsetX + cx * size, y = this.frame.offsetY + cy * size;
      const origin = new Float32Array([cx * size, cy * size]);
      const quad = new Phaser.GameObjects.Shader(this.scene, {
        name: WATER_SHADER_NAME, shaderName: WATER_SHADER_NAME, fragmentSource: WATER_FRAGMENT,
        setupUniforms: (set: (name: string, value: unknown) => void) => {
          set('uMask', 0); set('uOrigin', origin); set('uSize', size); set('uHalo', WATER_MASK_HALO);
          set('uTime', this.scene.time.now / 1000); set('uSeed', (this.seed >>> 0) % 997);
        },
      }, x + size / 2, y + size / 2, size, size, [key]);
      quad.setDepth(DEPTH.WATER).setBlendMode(Phaser.BlendModes.NORMAL);
      this.scene.add.existing(quad);
      this.chunks.set(id, { x, y, quad, key });
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.preparation?.return();
    this.preparation = null;
    this.masks.clear();
    for (const chunk of this.chunks.values()) { chunk.quad.destroy(); this.scene.textures.remove(chunk.key); }
    this.chunks.clear();
  }
}
