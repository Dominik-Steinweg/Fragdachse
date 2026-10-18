import { loadingTimeline } from '../diagnostics/LoadingTimeline';
import * as Phaser from 'phaser';
import { disposeShaderWarmupNode } from '../graphics/disposeShaderWarmupNode';
import { CELL_SIZE, DEPTH } from '../config';
import type { WaterCell } from '../types';
import { ARENA_RENDER_CHUNK_SIZE, ARENA_RENDER_CHUNK_ACQUIRE_MARGIN_PX, ARENA_RENDER_CHUNK_RELEASE_MARGIN_PX,
  type ChunkWorldFrame, type ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { WaterSurfaceModel, WATER_MASK_HALO, type WaterMask, type WaterMaskView } from './WaterSurfaceModel';
import { WATER_FRAGMENT, WATER_SHADER_NAME } from './waterSurfaceShader';
import { WATER_SUN_FRAGMENT, setWaterNightUniforms, setWaterSunUniforms, setWaterVoidStainUniforms, type WaterNightLight,
  type WaterVoidStainUniforms } from './WaterSunlight';
import type { VoidWaterStain } from './VoidWaterStain';
import { createSurfaceLightFrame } from '../effects/SurfaceLocalLights';
import type { SunCloudState } from '../effects/sunlight/cloudShadow';
import { WaterDisturbanceField } from './WaterDisturbanceField';


let nextWaterSurfaceId = 0;
interface WaterChunk { x: number; y: number; quad: Phaser.GameObjects.Shader; key: string }

/** World-lifetime CPU masks; only camera-resident chunks own textures and shaders. */
/** World-space state of the void bloom spreading through a water body (see waterSurfaceShader). */
export interface WaterVoidBloom {
  /** Origin of the bloom in world space. */
  readonly x: number; readonly y: number;
  /** Radius the bloom has reached; water beyond it stays natural. */
  readonly frontPx: number;
  /** 0..1 overall strength (fades the whole effect in and out). */
  readonly grade: number;
  /** 0..1 extra luminance, e.g. the boss's roar. */
  readonly pulse: number;
}

const instances = new WeakMap<Phaser.Scene, WaterSurfaceRenderer>();

export class WaterSurfaceRenderer {
  /** The scene's current water surface; presentation owners borrow it for transient grading. */
  static for(scene: Phaser.Scene): WaterSurfaceRenderer | null { return instances.get(scene) ?? null; }
  private readonly id = nextWaterSurfaceId++;
  /** Local bloom centre x/y, front radius and grade; pulse separately. All zero leaves the water untouched. */
  private readonly voidBloom = new Float32Array(4);
  private voidPulse = 0;
  private preparation: Generator<void, void> | null = null;
  private readonly masks = new Map<string, WaterMask>();
  private readonly totalMasks: number;
  private destroyed = false;
  private readonly chunks = new Map<string, WaterChunk>();
  private sunlight: SunCloudState | undefined;
  private nightLight: WaterNightLight | null = null;
  /** Void stain texture of the sunlight owner's lily pads; this renderer owns the texture. */
  private voidStain: (WaterVoidStainUniforms & { readonly key: string }) | null = null;
  /** Reused per draw: each chunk pulls the lamps meeting its own rectangle. */
  private readonly nightLamps = createSurfaceLightFrame();
  private readonly worldOffset: Float32Array;
  /** Surface disturbance field over the water's bounds, allocated when something first disturbs the water. */
  private disturbance: WaterDisturbanceField | null = null;
  private readonly disturbBounds: { x: number; y: number; width: number; height: number } | null;
  private readonly releaseDisturbance: () => void;
  private readonly disturbRect = new Float32Array(4);
  private readonly disturbTexel = new Float32Array(2);
  constructor(private readonly scene: Phaser.Scene, private readonly frame: ChunkWorldFrame,
    water: readonly WaterCell[], private readonly seed: number) {
    this.worldOffset = new Float32Array([frame.offsetX, frame.offsetY]);
    if (water.length) {
      const xs = water.map(c => c.gridX), ys = water.map(c => c.gridY), margin = 2, size = CELL_SIZE;
      const left = (Math.min(...xs) - margin) * size, top = (Math.min(...ys) - margin) * size;
      const width = (Math.max(...xs) - Math.min(...xs) + 1 + margin * 2) * size;
      const height = (Math.max(...ys) - Math.min(...ys) + 1 + margin * 2) * size;
      this.disturbBounds = { x: frame.offsetX + left, y: frame.offsetY + top, width, height };
      this.disturbRect.set([left, top, width, height]);
    } else this.disturbBounds = null;
    this.releaseDisturbance = WaterDisturbanceField.provide(scene, () => this.ensureDisturbance());
    instances.set(scene, this);
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
    const measuredAt = loadingTimeline.start();
    try {
    const deadline = performance.now() + budgetMs;
    do {
      if (this.preparation.next().done) {
        this.preparation = null;
        return;
      }
    } while (performance.now() < deadline);
    } finally { loadingTimeline.end('water/mask-slice', measuredAt); }
  }

  private ensureDisturbance(): WaterDisturbanceField | null {
    if (this.destroyed || !this.disturbBounds) return null;
    if (this.disturbance) return this.disturbance;
    this.disturbance = new WaterDisturbanceField(this.scene, this.disturbBounds);
    this.disturbTexel.set([1 / this.disturbance.width, 1 / this.disturbance.height]);
    // Resident quads bind their samplers at creation; rebuild them once with the field attached.
    for (const chunk of this.chunks.values()) { chunk.quad.destroy(); chunk.quad = this.createQuad(chunk.x, chunk.y, chunk.key); }
    return this.disturbance;
  }

  isPrepared(): boolean { return !this.destroyed && this.preparation === null; }

  getPresentationTime(): number { return this.sunlight?.timeSec ?? this.scene.time.now/1000; }

  /** Only program/borrowed sampler changes; resident CPU/GPU masks are retained. */
  setSunlight(state?: SunCloudState): void {
    const variantChanged=!!state!==!!this.sunlight;
    this.sunlight=state;
    if(this.destroyed||!variantChanged)return;
    for(const chunk of this.chunks.values()) {
      chunk.quad.destroy();
      chunk.quad=this.createQuad(chunk.x,chunk.y,chunk.key);
    }
  }

  /** Night material input of the sunlight owner; only the sunlit program reads it. Null releases it. */
  setNightLight(night: WaterNightLight | null): void { this.nightLight = night; }

  /**
   * Void stain around infested lily pads (GDD Nachtsicht N-6); only the sunlit program reads it.
   * Uploaded once per World; null releases the texture. Resident chunks rebind their samplers.
   */
  setVoidStain(stain: VoidWaterStain | null): void {
    if (this.destroyed || (!stain && !this.voidStain)) return;
    // Quads borrow the texture: drop them before the old texture, rebuild after the new one.
    for (const chunk of this.chunks.values()) chunk.quad.destroy();
    if (this.voidStain) { this.scene.textures.remove(this.voidStain.key); this.voidStain = null; }
    if (stain) {
      const key = `__water_void_stain_${this.id}`;
      const texture = this.scene.textures.createCanvas(key, stain.width, stain.height);
      if (!texture) throw new Error('[WaterSurfaceRenderer] Cannot allocate void stain');
      const pixels = texture.context.createImageData(stain.width, stain.height);
      for (let i = 0; i < stain.data.length; i++) {
        pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = stain.data[i]; pixels.data[i * 4 + 3] = 255;
      }
      texture.context.putImageData(pixels, 0, 0); texture.refresh();
      texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.voidStain = { key, origin: new Float32Array([stain.offsetX - this.frame.offsetX, stain.offsetY - this.frame.offsetY]),
        size: new Float32Array([stain.width * stain.texelPx, stain.height * stain.texelPx]) };
    }
    for (const chunk of this.chunks.values()) chunk.quad = this.createQuad(chunk.x, chunk.y, chunk.key);
  }

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
      const quad = this.createQuad(x,y,key);
      this.chunks.set(id, { x, y, quad, key });
    }
  }

  private createQuad(x:number,y:number,key:string): Phaser.GameObjects.Shader {
      const size=ARENA_RENDER_CHUNK_SIZE;
      const origin = new Float32Array([x-this.frame.offsetX, y-this.frame.offsetY]);
      const sun=!!this.sunlight, name=WATER_SHADER_NAME+(sun?'Sunlight':'');
      const quad = new Phaser.GameObjects.Shader(this.scene, {
        name, shaderName: name, fragmentSource: sun?WATER_SUN_FRAGMENT:WATER_FRAGMENT,
        setupUniforms: (set: (name: string, value: unknown) => void) => {
          set('uMask', 0); set('uOrigin', origin); set('uSize', size); set('uHalo', WATER_MASK_HALO);
          set('uTime', this.getPresentationTime()); set('uSeed', (this.seed >>> 0) % 997);
          set('uDisturb', 1); set('uDisturbOn', Number(!!this.disturbance?.active));
          set('uDisturbRect', this.disturbRect); set('uDisturbTexel', this.disturbTexel);
          set('uVoid', this.voidBloom); set('uVoidPulse', this.voidPulse);
          if(sun) {
            set('uWorldOffset',this.worldOffset);setWaterSunUniforms(set,this.sunlight);
            const night=this.nightLight&&this.nightLight.night>0?this.nightLight:null;
            setWaterNightUniforms(set,night,night?night.lights(x,y,size,size,this.nightLamps):null);
            setWaterVoidStainUniforms(set,this.voidStain);
          }
        },
      }, x + size / 2, y + size / 2, size, size,
      // The stain rides as a third sampler on both programs, so the variants keep one sampler list.
      this.voidStain ? [key, this.disturbance?.textureKey ?? '__DEFAULT', this.voidStain.key]
        : [key, this.disturbance?.textureKey ?? '__DEFAULT']);
      const node = quad.renderNode;
      if (node) quad.once('destroy', () => disposeShaderWarmupNode(node));
      quad.setDepth(DEPTH.WATER).setBlendMode(Phaser.BlendModes.NORMAL);
      this.scene.add.existing(quad);
      return quad;
  }

  /** Pure presentation grade, re-set every frame by its owner; null restores natural water. */
  setVoidBloom(bloom: WaterVoidBloom | null): void {
    if (!bloom || bloom.grade <= 0) { this.voidBloom.fill(0); this.voidPulse = 0; return; }
    this.voidBloom[0] = bloom.x - this.frame.offsetX; this.voidBloom[1] = bloom.y - this.frame.offsetY;
    this.voidBloom[2] = Math.max(0, bloom.frontPx); this.voidBloom[3] = Math.min(1, bloom.grade);
    this.voidPulse = Math.max(0, Math.min(1, bloom.pulse));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (instances.get(this.scene) === this) instances.delete(this.scene);
    this.releaseDisturbance(); this.disturbance?.destroy(); this.disturbance = null;
    this.preparation?.return();
    this.preparation = null;
    this.masks.clear();
    for (const chunk of this.chunks.values()) { chunk.quad.destroy(); this.scene.textures.remove(chunk.key); }
    this.chunks.clear();
    if (this.voidStain) { this.scene.textures.remove(this.voidStain.key); this.voidStain = null; }
  }
}
