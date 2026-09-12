import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../config';
import type { WaterCell } from '../types';
import { ARENA_RENDER_CHUNK_SIZE, ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX, ARENA_RENDER_CHUNK_RELEASE_MARGIN_PX,
  type ChunkWorldFrame, type ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { WaterSurfaceModel, WATER_MASK_HALO } from './WaterSurfaceModel';
import { WATER_FRAGMENT, WATER_SHADER_NAME } from './waterSurfaceShader';

let nextWaterSurfaceId = 0;
interface WaterChunk { x: number; y: number; quad: Phaser.GameObjects.Shader; key: string }

/** One quad and one immutable packed mask per resident water chunk, owned by World presentation. */
export class WaterSurfaceRenderer {
  private readonly id = nextWaterSurfaceId++;
  private readonly model: WaterSurfaceModel;
  private readonly occupied = new Set<string>();
  private readonly chunks = new Map<string, WaterChunk>();
  constructor(private readonly scene: Phaser.Scene, private readonly frame: ChunkWorldFrame,
    water: readonly WaterCell[], private readonly seed: number) {
    this.model = new WaterSurfaceModel(water);
    for (const cell of water) this.occupied.add(`${Math.floor(cell.gridX * CELL_SIZE / ARENA_RENDER_CHUNK_SIZE)},${Math.floor(cell.gridY * CELL_SIZE / ARENA_RENDER_CHUNK_SIZE)}`);
  }

  updateResidency(view: ChunkWorldRect): void {
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
      if (!this.occupied.has(id) || this.chunks.has(id)) continue;
      const mask = this.model.bake(cx * size, cy * size, size);
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
    for (const chunk of this.chunks.values()) { chunk.quad.destroy(); this.scene.textures.remove(chunk.key); }
    this.chunks.clear();
  }
}
