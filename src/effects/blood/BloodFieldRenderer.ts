import * as Phaser from 'phaser';
import { BLOOD_HIT_VFX, DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../../config';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { disposeShaderWarmupNode } from '../../graphics/disposeShaderWarmupNode';
import type { FormationCoverageBinding } from '../../arena/rocks/RockFormationLighting';
import type { SunCloudState } from '../sunlight/cloudShadow';
import { createSurfaceLightFrame, setSurfaceLightUniforms, type SurfaceLightFrame } from '../SurfaceLocalLights';
import { registerGraphicsObject } from '../EffectUtils';
import type { ShaderWarmupProbe } from '../../graphics/ShaderWarmupProbe';
import { BLOOD_FIELD_VERTICES, BLOOD_FIELD_WORDS, BloodChannel, BloodFieldModel } from './BloodFieldModel';
import {
  BLOOD_ACCUMULATION_FRAGMENT, BLOOD_ACCUMULATION_VERTEX, BLOOD_GROUND_FRAGMENT, BLOOD_MAX_DECKS, BLOOD_ROCK_FRAGMENT,
  BloodReceiverLayer, BloodReceiverPass,
} from './bloodFieldShaders';

/** Ground blood lies with the other grounded decals: under water, rocks, their shadows and every figure. */
export const BLOOD_GROUND_DEPTH = DEPTH.WATER - 0.06;
/** Blood on standing bridge planks, just above the deck. */
export const BLOOD_DECK_DEPTH = DEPTH.WATER + 0.405;
/** Blood on rock: over the rock decals, under the formation light that carries the relief. */
export const BLOOD_ROCK_DEPTH = DEPTH.ROCK_DECALS + 0.005;
export const BLOOD_GROUND_SHADER_NAME = 'BloodFieldGround';
export const BLOOD_ROCK_SHADER_NAME = 'BloodFieldRock';

type Set = (name: string, value: unknown) => void;
/** One receiver: the soaked stain (MULTIPLY, the ground shows through) and the wet film above it (NORMAL). */
interface ReceiverPair { readonly stain: Phaser.GameObjects.Shader; readonly film: Phaser.GameObjects.Shader }
/** The film sits just above its stain. */
const FILM_DEPTH_OFFSET = 0.002;
type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** Night inputs like the water's: night weight and the lamps meeting a rectangle. */
export interface BloodNightLight {
  readonly night: number;
  lights(x: number, y: number, width: number, height: number, out: SurfaceLightFrame): SurfaceLightFrame;
}

/** Per-frame receivers of the current World. */
export interface BloodFieldSurfaces {
  readonly rockCoverage: FormationCoverageBinding | null;
  readonly decks: readonly Rect[];
  readonly sunlight: SunCloudState | undefined;
  readonly night: BloodNightLight | null;
}

const additiveModes = new WeakMap<Phaser.Renderer.WebGL.WebGLRenderer, number>();
/** Pure sum on every channel, alpha included (Phaser's ADD weights by destination alpha). */
/** Densities add up (RGB); the liveliness in alpha takes the maximum where the GPU offers it. */
function additiveMode(renderer: Phaser.Renderer.WebGL.WebGLRenderer): number {
  let mode = additiveModes.get(renderer);
  if (mode === undefined) {
    const gl = renderer.gl;
    const maximum = maxEquation(renderer);
    // 4.2.1 addBlendMode returns (inserted index - 1); use the appended slot itself.
    mode = renderer.blendModes.length;
    renderer.addBlendMode([gl.ONE, gl.ONE], gl.FUNC_ADD);
    renderer.updateBlendMode(mode, [gl.ONE, gl.ONE, gl.ONE, gl.ONE],
      maximum === null ? gl.FUNC_ADD : [gl.FUNC_ADD, maximum] as unknown as number);
    // removeBlendMode would shift other owners' indices: keep one slot per renderer.
    additiveModes.set(renderer, mode);
  }
  return mode;
}

/** The MAX blend equation (WebGL2 or EXT_blend_minmax), or null. */
function maxEquation(renderer: Phaser.Renderer.WebGL.WebGLRenderer): number | null {
  const gl = renderer.gl as WebGLRenderingContext & { MAX?: number };
  return gl.MAX ?? gl.getExtension('EXT_blend_minmax')?.MAX_EXT ?? null;
}

const maxModes = new WeakMap<Phaser.Renderer.WebGL.WebGLRenderer, number | null>();
/** Per-channel maximum (WebGL2 or EXT_blend_minmax); null where neither exists. */
function maximumMode(renderer: Phaser.Renderer.WebGL.WebGLRenderer): number | null {
  if (maxModes.has(renderer)) return maxModes.get(renderer)!;
  const gl = renderer.gl;
  const equation = maxEquation(renderer);
  let mode: number | null = null;
  if (equation !== null) {
    mode = renderer.blendModes.length;
    renderer.addBlendMode([gl.ONE, gl.ONE], equation);
    renderer.updateBlendMode(mode, [gl.ONE, gl.ONE, gl.ONE, gl.ONE], equation);
  }
  maxModes.set(renderer, mode);
  return mode;
}

let nextId = 0;

/**
 * GPU side of the blood field: draws the marks into a camera-following density texture once per
 * frame (before the scene draws), then three receivers (stain and film quads) threshold it at ground, deck and rock
 * depth. Water reads the same texture through its dye input. Everything is bounded: one texture,
 * one instanced draw, at most three receiver quads sized to the marks they show.
 */
export class BloodFieldRenderer {
  private readonly id = nextId++;
  private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer | null;
  private texture: Phaser.Textures.DynamicTexture | null = null;
  /** Colour × density of marks with their own blood colour, at half resolution; drawn only while any exist. */
  private tint: Phaser.Textures.DynamicTexture | null = null;
  private tintActive = 0;
  private mode = 0;
  private textureScale = 0;
  private anchor: Phaser.GameObjects.Image | null = null;
  private batch: BloodAccumulationBatchPort | null = null;
  private ground: ReceiverPair | null = null;
  private deck: ReceiverPair | null = null;
  private rock: ReceiverPair | null = null;
  private rockBinding: FormationCoverageBinding | null = null;
  /** World rectangle the accumulation covers this frame (x, y, w, h). Shared with the water dye. */
  readonly fieldRect = new Float32Array(4);
  private readonly fieldTexel = new Float32Array(2);
  private readonly groundQuad = new Float32Array(4);
  private readonly deckQuad = new Float32Array(4);
  private readonly rockQuad = new Float32Array(4);
  private readonly rockFrame = new Float32Array(4);
  private readonly decks = new Float32Array(BLOOD_MAX_DECKS * 4);
  private deckCount = 0;
  private readonly sun = new Float32Array([-0.5, -0.5, Math.SQRT1_2, 1]);
  private night = 0;
  private lampOn = 0;
  private readonly lamps = createSurfaceLightFrame();
  private pixelsPerWorld = 1;
  /** 1 when the accumulation's alpha blends by maximum (liveliness without division). */
  readonly alphaMax: number;
  private detail = 1;
  private timeSec = 0;
  private drawn = false;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly model: BloodFieldModel) {
    const renderer = scene.sys?.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    this.renderer = renderer?.gl ? renderer : null;
    this.alphaMax = this.renderer && maxEquation(this.renderer) !== null ? 1 : 0;
  }

  /** Texture key of the density field, or null before the first marks were drawn. */
  get textureKey(): string | null { return this.drawn ? this.texture?.key ?? null : null; }
  /** Colour pass of the last frame, or null while every mark is the default red. */
  get tintKey(): string | null { return this.drawn && this.tintActive ? this.tint?.key ?? null : null; }
  /** True after a frame drew at least one water cloud. */
  get hasWater(): boolean { return this.drawn && this.model.bounds(BloodChannel.Water).count > 0; }
  get frame() {
    return { model: this.model, rect: this.fieldRect, time: this.timeSec, mode: this.mode };
  }

  /** Draws this frame's density and places the receivers; cheap no-op without marks. */
  render(nowMs: number, view: Rect, surfaces: BloodFieldSurfaces): void {
    if (this.destroyed || !this.renderer) return;
    const model = this.model;
    if (!model.count) { this.hide(); return; }
    const profile = getGraphicsQualityProfile(this.scene);
    const texture = this.ensureTexture(BLOOD_HIT_VFX.field.resolution[profile.level]);
    if (!texture || !this.anchor) { this.hide(); return; }
    const margin = BLOOD_HIT_VFX.field.viewMarginPx;
    this.fieldRect[0] = view.x - margin; this.fieldRect[1] = view.y - margin;
    this.fieldRect[2] = view.width + margin * 2; this.fieldRect[3] = view.height + margin * 2;
    this.fieldTexel[0] = 1 / texture.width; this.fieldTexel[1] = 1 / texture.height;
    this.timeSec = model.seconds(nowMs);
    this.detail = profile.level === 'low' ? 0 : 1;
    this.pixelsPerWorld = this.scene.cameras.main.zoomX || 1;
    texture.clear();
    texture.draw(this.anchor);
    texture.render();
    const maximum = maximumMode(this.renderer);
    this.tintActive = model.tintedCount > 0 && this.tint && maximum !== null ? 1 : 0;
    if (this.tintActive && this.tint && maximum !== null) {
      const additive = this.anchor.blendMode;
      this.mode = 1;
      this.anchor.setBlendMode(maximum);
      try { this.tint.clear(); this.tint.draw(this.anchor); this.tint.render(); }
      finally { this.mode = 0; this.anchor.setBlendMode(additive); }
    }
    this.drawn = true;
    this.applyLighting(surfaces, view);
    this.placeGround();
    this.placeDecks(surfaces.decks);
    this.placeRock(surfaces.rockCoverage);
  }

  /** Diagnostics for the review lab: which receivers drew and what they cover. */
  debugState() {
    const quad = (pair: ReceiverPair | null, rect: Float32Array) => pair
      ? { visible: pair.stain.visible, x: Math.round(rect[0]), y: Math.round(rect[1]), w: Math.round(rect[2]), h: Math.round(rect[3]) } : null;
    return { drawn: this.drawn, texture: this.texture ? `${this.texture.width}x${this.texture.height}` : null,
      field: Array.from(this.fieldRect, Math.round), ground: quad(this.ground, this.groundQuad), deck: quad(this.deck, this.deckQuad),
      rock: quad(this.rock, this.rockQuad), rockCoverage: !!this.rockBinding, lamps: this.lamps.count, night: this.night };
  }

  /** Shader warmup: links the accumulation and both receiver programs. */
  prepare(context: Phaser.Renderer.WebGL.DrawingContext): boolean {
    if (!this.renderer) return true;
    this.ensureAnchor();
    context.renderer.renderNodes.startStandAloneRender();
    return this.batch?.run(context, true) ?? false;
  }

  hide(): void {
    show(this.ground, false); show(this.deck, false); show(this.rock, false);
    this.drawn = false;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    destroyPair(this.ground); this.ground = null;
    destroyPair(this.deck); this.deck = null;
    destroyPair(this.rock); this.rock = null; this.rockBinding = null;
    this.anchor?.destroy(); this.anchor = null; this.batch = null;
    if (this.texture) { this.scene.textures.remove(this.texture.key); this.texture = null; }
    if (this.tint) { this.scene.textures.remove(this.tint.key); this.tint = null; }
  }

  private ensureTexture(scale: number): Phaser.Textures.DynamicTexture | null {
    this.ensureAnchor();
    if (this.texture && this.textureScale === scale) return this.texture;
    // Never `setSize`: it reallocates the framebuffer under the receivers' bound sampler.
    const old = this.texture, oldTint = this.tint;
    this.texture = null; this.tint = null;
    const margin = BLOOD_HIT_VFX.field.viewMarginPx;
    const width = Math.max(4, Math.ceil((GAME_WIDTH + margin * 2) * scale));
    const height = Math.max(4, Math.ceil((GAME_HEIGHT + margin * 2) * scale));
    const key = `__blood_field_${this.id}_${Math.round(scale * 100)}`;
    const texture = this.scene.textures.addDynamicTexture(key, width, height);
    if (!texture) return null;
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.texture = texture;
    this.textureScale = scale;
    const tint = this.scene.textures.addDynamicTexture(`${key}_tint`, Math.max(4, Math.ceil(width / 2)), Math.max(4, Math.ceil(height / 2)));
    tint?.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.tint = tint ?? null;
    // Receivers sample the texture by key: rebuild them around the new one, then drop the old.
    for (const pair of [this.ground, this.deck, this.rock]) destroyPair(pair);
    this.ground = this.deck = this.rock = null;
    this.rockBinding = null;
    if (old) this.scene.textures.remove(old.key);
    if (oldTint) this.scene.textures.remove(oldTint.key);
    return texture;
  }

  private ensureAnchor(): void {
    if (this.anchor || !this.renderer) return;
    const renderer = this.renderer;
    // Never part of the display list: only the accumulation texture draws it.
    const anchor = new Phaser.GameObjects.Image(this.scene, 0, 0, '__WHITE');
    anchor.setBlendMode(additiveMode(renderer));
    const batch = createBloodAccumulationBatch(renderer, this);
    const manager = renderer.renderNodes;
    class Submitter extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
      constructor() { super('SubmitterBloodField', manager); }
      run(context: Phaser.Renderer.WebGL.DrawingContext): void {
        manager.startStandAloneRender(); this.onRunBegin(context); batch.run(context); this.onRunEnd(context);
      }
    }
    anchor.setRenderNodeRole('Submitter', new Submitter());
    anchor.once(Phaser.GameObjects.Events.DESTROY, () => batch.dispose());
    this.anchor = anchor;
    this.batch = batch;
  }

  private placeGround(): void {
    const bounds = this.clip(BloodChannel.Ground, this.groundQuad);
    if (!bounds) { show(this.ground, false); return; }
    this.ground ??= this.makePair(BLOOD_GROUND_SHADER_NAME, BLOOD_GROUND_FRAGMENT, BLOOD_GROUND_DEPTH,
      [this.texture!.key, this.tintTexture()], BloodReceiverPass.Ground, this.groundQuad, set => set('uTint', 1));
    this.place(this.ground, this.groundQuad);
  }

  private placeDecks(decks: readonly Rect[]): void {
    this.deckCount = Math.min(BLOOD_MAX_DECKS, decks.length);
    const bounds = this.deckCount ? this.clip(BloodChannel.Ground, this.deckQuad) : null;
    if (!bounds) { show(this.deck, false); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let index = 0; index < this.deckCount; index++) {
      const deck = decks[index], offset = index * 4;
      this.decks[offset] = deck.x; this.decks[offset + 1] = deck.y; this.decks[offset + 2] = deck.width; this.decks[offset + 3] = deck.height;
      minX = Math.min(minX, deck.x); minY = Math.min(minY, deck.y);
      maxX = Math.max(maxX, deck.x + deck.width); maxY = Math.max(maxY, deck.y + deck.height);
    }
    // Only where blood and planks overlap.
    const q = this.deckQuad;
    const left = Math.max(q[0], minX), top = Math.max(q[1], minY);
    const right = Math.min(q[0] + q[2], maxX), bottom = Math.min(q[1] + q[3], maxY);
    if (right <= left || bottom <= top) { show(this.deck, false); return; }
    q[0] = left; q[1] = top; q[2] = right - left; q[3] = bottom - top;
    this.deck ??= this.makePair(BLOOD_GROUND_SHADER_NAME, BLOOD_GROUND_FRAGMENT, BLOOD_DECK_DEPTH,
      [this.texture!.key, this.tintTexture()], BloodReceiverPass.Deck, this.deckQuad, set => {
        set('uDecks[0]', this.decks); set('uDeckCount', this.deckCount); set('uTint', 1);
      });
    this.place(this.deck, this.deckQuad);
  }

  private placeRock(coverage: FormationCoverageBinding | null): void {
    const bounds = coverage ? this.clip(BloodChannel.Rock, this.rockQuad) : null;
    if (!coverage || !bounds) { show(this.rock, false); return; }
    const textures = [this.texture!.key, coverage.field.key, coverage.lookup.key, this.tintTexture()];
    if (!this.rock) {
      this.rock = this.makePair(BLOOD_ROCK_SHADER_NAME, BLOOD_ROCK_FRAGMENT, BLOOD_ROCK_DEPTH, textures,
        BloodReceiverPass.Rock, this.rockQuad, set => {
          set('uRockField', 1); set('uRockLookup', 2); set('uRockFrame', this.rockFrame); set('uTint', 3);
        });
    } else if (this.rockBinding !== coverage) {
      this.rock.stain.setTextures(textures); this.rock.film.setTextures(textures);
    }
    this.rockBinding = coverage;
    for (let i = 0; i < 4; i++) this.rockFrame[i] = coverage.frame[i];
    this.place(this.rock, this.rockQuad);
  }

  /** The receiver's marks within the accumulated rectangle, or null when it has none there. */
  private clip(channel: BloodChannel, out: Float32Array): Float32Array | null {
    const bounds = this.model.bounds(channel);
    if (!bounds.count) return null;
    const r = this.fieldRect;
    const left = Math.max(r[0], Math.floor(bounds.minX)), top = Math.max(r[1], Math.floor(bounds.minY));
    const right = Math.min(r[0] + r[2], Math.ceil(bounds.maxX)), bottom = Math.min(r[1] + r[3], Math.ceil(bounds.maxY));
    if (right <= left || bottom <= top) return null;
    out[0] = left; out[1] = top; out[2] = right - left; out[3] = bottom - top;
    return out;
  }

  private tintTexture(): string { return this.tint?.key ?? '__DEFAULT'; }

  private place(pair: ReceiverPair, rect: Float32Array): void {
    for (const quad of [pair.stain, pair.film]) quad.setPosition(rect[0], rect[1]).setDisplaySize(rect[2], rect[3]).setVisible(true);
  }

  private makePair(name: string, fragmentSource: string, depth: number, textures: string[], pass: number,
    quadRect: Float32Array, extra: (set: Set) => void): ReceiverPair {
    return {
      stain: this.makeQuad(name, fragmentSource, depth, textures, pass, BloodReceiverLayer.Stain, quadRect, extra),
      film: this.makeQuad(name, fragmentSource, depth + FILM_DEPTH_OFFSET, textures, pass, BloodReceiverLayer.Film, quadRect, extra),
    };
  }

  private applyLighting(surfaces: BloodFieldSurfaces, view: Rect): void {
    const night = Math.max(0, Math.min(1, surfaces.night?.night ?? 0));
    const sun = surfaces.sunlight?.sunPath?.sun;
    if (sun) { this.sun[0] = sun[0]; this.sun[1] = sun[1]; this.sun[2] = Math.max(0.05, sun[2]); }
    else { this.sun[0] = -0.5; this.sun[1] = -0.5; this.sun[2] = Math.SQRT1_2; }
    // The sun's gloss gives way to the lamps as the night deepens.
    this.sun[3] = 1 - night;
    this.night = night;
    this.lampOn = 0;
    if (surfaces.night && night > 0) {
      surfaces.night.lights(view.x, view.y, view.width, view.height, this.lamps);
      this.lampOn = this.lamps.count > 0 ? 1 : 0;
    } else {
      this.lamps.count = 0;
    }
  }

  private makeQuad(name: string, fragmentSource: string, depth: number, textures: string[], pass: number, layer: number,
    quadRect: Float32Array, extra: (set: Set) => void): Phaser.GameObjects.Shader {
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name, shaderName: name, fragmentSource,
      setupUniforms: (set: Set) => {
        set('uField', 0); set('uQuad', quadRect); set('uFieldRect', this.fieldRect); set('uFieldTexel', this.fieldTexel);
        set('uThreshold', BLOOD_HIT_VFX.field.threshold); set('uSun', this.sun); set('uNight', this.night);
        set('uDetail', this.detail); set('uPass', pass); set('uLayer', layer); set('uLampOn', this.lampOn); set('uPixelsPerWorld', this.pixelsPerWorld);
        set('uDeckCount', 0); set('uTintOn', this.tintActive); set('uAlphaMax', this.alphaMax);
        setSurfaceLightUniforms(set, this.lampOn ? this.lamps : null, null);
        extra(set);
      },
    }, 0, 0, 1, 1, textures);
    const node = quad.renderNode;
    if (node) quad.once('destroy', () => disposeShaderWarmupNode(node));
    quad.setOrigin(0).setDepth(depth)
      .setBlendMode(layer === BloodReceiverLayer.Stain ? Phaser.BlendModes.MULTIPLY : Phaser.BlendModes.NORMAL);
    quad.name = `blood-field-${['ground', 'deck', 'rock'][pass]}-${layer === BloodReceiverLayer.Stain ? 'stain' : 'film'}`;
    registerGraphicsObject(this.scene, 'bloodField', quad);
    this.scene.add.existing(quad);
    return quad;
  }
}

/** Links the accumulation program with a detached one-mark model. */
export function createBloodFieldShaderProbe(scene: Phaser.Scene): ShaderWarmupProbe {
  let layer: BloodFieldRenderer | null = null;
  return {
    name: 'blood-field',
    prepare: context => (layer ??= new BloodFieldRenderer(scene, new BloodFieldModel(1))).prepare(context),
    destroy: () => { layer?.destroy(); layer = null; },
  };
}

function show(pair: ReceiverPair | null, visible: boolean): void {
  pair?.stain.setVisible(visible); pair?.film.setVisible(visible);
}

function destroyPair(pair: ReceiverPair | null): void {
  pair?.stain.destroy(); pair?.film.destroy();
}

interface BloodAccumulationBatchPort { run(context: Phaser.Renderer.WebGL.DrawingContext, preparing?: boolean): boolean; dispose(): void }

// Lazy like the other GPU layers: importing presentation must also work in headless runtime tests.
function createBloodAccumulationBatch(renderer: Phaser.Renderer.WebGL.WebGLRenderer, owner: BloodFieldRenderer): BloodAccumulationBatchPort {
  const capacity = owner.frame.model.capacity;
  const uRect = new Float32Array(4), uDry = new Float32Array(2);
  class BloodAccumulationBatch extends Phaser.Renderer.WebGL.RenderNodes.BatchHandler {
    private primed = false;
    private disposed = false;
    constructor() {
      super(renderer.renderNodes, { name: 'BatchHandlerBloodField', shaderName: 'BLOOD_FIELD_ACCUMULATION',
        instancesPerBatch: Math.max(1, capacity), verticesPerInstance: BLOOD_FIELD_VERTICES, indicesPerInstance: BLOOD_FIELD_VERTICES,
        topology: renderer.gl.TRIANGLES, vertexSource: BLOOD_ACCUMULATION_VERTEX, fragmentSource: BLOOD_ACCUMULATION_FRAGMENT,
        vertexBufferLayout: { usage: 'DYNAMIC_DRAW', layout: [{ name: 'inA', size: 4 }, { name: 'inB', size: 4 },
          { name: 'inC', size: 4 }, { name: 'inD', size: 4 }, { name: 'inCorner', size: 4 }] },
      });
    }
    _generateElementIndices(instances: number): ArrayBuffer {
      const indices = new Uint16Array(instances * BLOOD_FIELD_VERTICES);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
      return indices.buffer;
    }
    run(context: Phaser.Renderer.WebGL.DrawingContext, preparing = false): boolean {
      const { model, rect, time, mode } = owner.frame;
      if (!preparing && !model.count) return false;
      const instances = Math.max(preparing ? 1 : 0, model.drawCount);
      this.onRunBegin(context);
      const program = this.programManager;
      const suite = program.getCurrentProgramSuite() as { program: Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
        vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper } | null;
      if (suite) {
        // Only changed marks travel to the GPU; the colour pass reuses this frame's upload.
        const buffer = this.vertexBufferLayout.buffer, view = buffer.viewF32!;
        const block = BLOOD_FIELD_VERTICES * BLOOD_FIELD_WORDS;
        const dirty = preparing ? null : model.takeDirty();
        if (preparing || !this.primed || dirty!.all) {
          view.set(model.data.subarray(0, instances * block));
          buffer.update(instances * block * 4, 0);
          this.primed = !preparing;
        } else {
          for (let index = 0; index < dirty!.count; index++) {
            const slot = dirty!.slots[index];
            if (slot >= instances) continue;
            view.set(model.data.subarray(slot * block, (slot + 1) * block), slot * block);
            buffer.update(block * 4, slot * block * 4);
          }
        }
        const field = BLOOD_HIT_VFX.field;
        uRect.set(rect); uDry[0] = field.dryStartMs / 1000; uDry[1] = field.dryEndMs / 1000;
        program.setUniform('uRect', uRect);
        program.setUniform('uTime', time);
        program.setUniform('uThreshold', field.threshold);
        program.setUniform('uPower', field.falloffPower);
        program.setUniform('uDry', uDry);
        program.setUniform('uMode', mode);
        program.setUniform('uAlphaMax', owner.alphaMax);
        program.applyUniforms(suite.program);
        renderer.drawElements(context, [], suite.program, suite.vao, instances * BLOOD_FIELD_VERTICES, 0, this.topology);
      }
      this.onRunEnd(context);
      return !!suite;
    }
    dispose(): void {
      if (this.disposed) return; this.disposed = true;
      (this.manager as unknown as Phaser.Events.EventEmitter).off(Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS, this.updateTextureCount, this);
      for (const suite of Object.values(this.programManager.programs)) {
        Phaser.Utils.Array.Remove(renderer.glVAOWrappers, suite.vao); suite.vao.destroy();
      }
      this.programManager.programs = {}; renderer.deleteBuffer(this.indexBuffer); renderer.deleteBuffer(this.vertexBufferLayout.buffer);
    }
  }
  return new BloodAccumulationBatch();
}
