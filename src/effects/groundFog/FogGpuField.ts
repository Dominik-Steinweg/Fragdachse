import * as Phaser from 'phaser';
import { FOG, FOG_DEBUG, type FogDebug, type FogRect, type FogTuning, type FogQuality } from './FogConfig';
import { FogTerrainModel } from './FogTerrainModel';
import { FogResidency } from './FogResidency';
import type { FogImpulse } from './FogImpulses';
import { FOG_DENSITY_FRAGMENT, FOG_IMPULSE_FRAGMENT, FOG_MATERIAL_FRAGMENT, FOG_VELOCITY_FRAGMENT, FOG_TRAIL_FRAGMENT, FOG_TRAIL_VERTEX } from './fogShaders';
import { FogTrailSegments } from './FogTrailSegments';
import { FogTrailRenderer } from './FogTrailRenderer';

const SIDE = FOG.chunkSize / FOG.cellSize;
const WIDTH = SIDE * FOG.atlasCols, HEIGHT = SIDE * FOG.atlasRows, SLOTS = FOG.atlasCols * FOG.atlasRows;
let nextId = 0;
function encode(data: Uint8Array, offset: number, value: number): void {
  const n = Math.round(Math.max(0, Math.min(65535, value)));
  data[offset] = n >> 8; data[offset + 1] = n & 255;
}
/** Phaser wrappers keep all texture/state changes visible to its WebGL state cache. */
class FogDataTexture {
  readonly data: Uint8Array;
  readonly texture: Phaser.Textures.Texture;
  private readonly wrapper: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper;
  constructor(private readonly scene: Phaser.Scene, readonly key: string, readonly width: number, readonly height: number) {
    this.data = new Uint8Array(width * height * 4);
    const renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer, gl = renderer.gl;
    this.wrapper = renderer.createTexture2D(0, gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE,
      gl.RGBA, this.data, width, height, false, false, false);
    this.texture = scene.textures.addGLTexture(key, this.wrapper)!;
  }
  upload(): void {
    const renderer = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer, gl = renderer.gl;
    renderer.glTextureUnits.bind(this.wrapper, 0);
    renderer.glWrapper.updateTexturing({ texturing: { flipY: false, premultiplyAlpha: false } });
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
  }
  destroy(): void { this.scene.textures.remove(this.key); }
}

/** Shader.preDestroy does not release its private VAOs/buffer in Phaser 4.2.1. */
export function destroyFogShader(shader: Phaser.GameObjects.Shader): void {
  const node = shader.renderNode;
  if (node) {
    for (const suite of Object.values(node.programManager.programs)) {
      Phaser.Utils.Array.Remove(node.renderer.glVAOWrappers, suite.vao); suite.vao.destroy();
    }
    node.programManager.programs = {};
    node.renderer.deleteBuffer(node.vertexBufferLayout.buffer);
  }
  shader.destroy();
}

/** GPU-only dynamics. CPU arrays below contain terrain/topology/observations, never density. */
export class FogGpuField {
  readonly residency: FogResidency;
  private readonly prefix = `__ground_fog_${nextId++}_`;
  private readonly terrainTexture: FogDataTexture;
  private readonly metaTexture: FogDataTexture;
  private readonly commands: FogDataTexture;
  private readonly bins: FogDataTexture;
  private readonly lookup: FogDataTexture;
  private readonly states: Phaser.GameObjects.Shader[] = [];
  private readonly velocities: Phaser.GameObjects.Shader[] = [];
  private readonly impulse: Phaser.GameObjects.Shader;
  private material: Phaser.GameObjects.Shader | null = null;
  private display: Phaser.GameObjects.Image | null = null;
  private surfaceMask: Phaser.GameObjects.RenderTexture | null = null;
  private trailMask: Phaser.GameObjects.Shader | null = null;
  private trailCommands: FogDataTexture | null = null;
  private trailRenderer: FogTrailRenderer | null = null;
  private trailVersion = -1;
  readonly trails: FogTrailSegments;
  private readonly resources: (() => void)[] = [];
  private readonly dither: boolean;
  private hasSurfaces = false;
  private quality: FogQuality = 'high';
  private lookupKey = '';
  private current = 0;
  private elapsed = 0;
  private density: readonly number[] = [0, 0];
  private tuning: FogTuning;
  private view: FogRect = { x: 0, y: 0, width: 1, height: 1 };
  private debug: FogDebug = 'normal';
  private interpolation = 1;
  private initializeOnly = false;
  private destroyed = false;
  private initialized = false;
  private readonly resetSlots = new Set<number>();
  submitted = 0;
  dropped = 0;
  constructor(private readonly scene: Phaser.Scene, readonly terrain: FogTerrainModel, private readonly seed: number,
    tuning: FogTuning, private readonly depth: number) {
    this.tuning = tuning;
    this.residency = new FogResidency(terrain.frame);
    this.trails = new FogTrailSegments(terrain.frame);
    const gl = (scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl;
    this.dither = gl.isEnabled(gl.DITHER);
    if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < Math.max(WIDTH, HEIGHT, FOG.trailTextureWidth)
      || gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 8
      || !gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision) throw new Error('Required RGBA8 shader capabilities unavailable');
    try {
      this.terrainTexture = this.makeData('terrain', WIDTH, HEIGHT);
      this.metaTexture = this.makeData('meta', SLOTS, 3);
      this.commands = this.makeData('commands', 256, 4);
      this.bins = this.makeData('bins', FOG.impulsesPerChunk, SLOTS);
      this.lookup = this.makeData('lookup', Math.ceil(terrain.frame.width / 512), Math.ceil(terrain.frame.height / 512));
      // All shaders are allocated/compiled during preparation, before first visible impulse.
      this.impulse = this.makePass('impulse', FOG_IMPULSE_FRAGMENT, WIDTH, HEIGHT);
      for (let i = 0; i < 2; i++) {
        this.states.push(this.makePass(`density${i}`, FOG_DENSITY_FRAGMENT, WIDTH, HEIGHT));
        this.velocities.push(this.makePass(`velocity${i}`, FOG_VELOCITY_FRAGMENT, WIDTH, HEIGHT));
      }
    } catch (error) { this.destroy(); throw error; }
  }
  private makeData(name: string, width: number, height: number): FogDataTexture {
    const texture = new FogDataTexture(this.scene, this.prefix + name, width, height);
    this.resources.push(() => texture.destroy()); return texture;
  }
  private makePass(name: string, fragment: string, width: number, height: number, vertexSource?: string): Phaser.GameObjects.Shader {
    const shader = new Phaser.GameObjects.Shader(this.scene, {
      name: `GroundFog_${name.replace(/[01]$/, '')}`, shaderName: `GroundFog_${name.replace(/[01]$/, '')}`,
      fragmentSource: fragment,
      vertexSource,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        for (const [i, uniform] of ['uState', 'uVelocity', 'uTerrain', 'uMeta', 'uCommands', 'uBins', 'uImpulse', 'uLookup'].entries()) set(uniform, i);
        set('uWorldSize', [this.terrain.frame.width, this.terrain.frame.height]);
        set('uWind', [this.tuning.windX, this.tuning.windY]); set('uTime', this.elapsed / 1000);
        set('uSeed', (this.seed >>> 0) % 997); set('uDensity', this.density); set('uReaction', this.tuning.reaction);
        set('uInitialize', this.initializeOnly ? 1 : 0);
        set('uLookupSize', [this.lookup.width, this.lookup.height]);
        set('uViewOrigin', [this.view.x - this.terrain.frame.offsetX, this.view.y - this.terrain.frame.offsetY]);
        set('uViewSize', [this.view.width, this.view.height]);
        set('uOpacity', this.tuning.opacity); set('uDetail', this.tuning.detail);
        set('uDebug', FOG_DEBUG.indexOf(this.debug)); set('uInterpolation', this.interpolation);
        set('uHasSurface', this.hasSurfaces ? 1 : 0); set('uQuality', this.quality === 'high' ? 2 : this.quality === 'medium' ? 1 : 0);
        set('uHasTrails', this.trailMask ? 1 : 0);
      },
    }, 0, 0, width, height, Array(8).fill('__DEFAULT'));
    try {
      shader.setRenderToTexture(this.prefix + name);
      const renderer = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer, gl = renderer.gl;
      const suite = shader.renderNode.programManager.getCurrentProgramSuite() as { program: { webGLProgram: WebGLProgram } } | null;
      const program = suite?.program.webGLProgram;
      if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Shader ${name} could not link`);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Incomplete RGBA8 framebuffer ${name}`);
      // DrawingContext.setBlendMode writes `enable`, whereas the global wrapper
      // consumes `enabled` in Phaser 4.2.1. Data must bypass alpha blending.
      shader.drawingContext!.state.blend = { ...shader.drawingContext!.state.blend, enabled: false };
      shader.texture!.setFilter(Phaser.Textures.FilterMode.NEAREST);
      return shader;
    } catch (error) { destroyFogShader(shader); throw error; }
  }
  private draw(shader: Phaser.GameObjects.Shader, state: Phaser.GameObjects.Shader, velocity: Phaser.GameObjects.Shader): void {
    shader.setTextures([state.texture!, velocity.texture!, this.terrainTexture.texture, this.metaTexture.texture,
      this.commands.texture, this.bins.texture, this.impulse.texture!, this.lookup.texture]);
    if (shader === this.material) {
      shader.textures[4] = this.velocities[this.current].texture!;
      shader.textures[5] = this.surfaceMask?.texture ?? this.scene.textures.get('__DEFAULT');
      if (this.debug === 'normal' && this.trailMask) shader.textures[6] = this.trailMask.texture!;
    }
    // Never bind the output as an input, even when that sampler was optimized out.
    for (let i = 0; i < shader.textures.length; i++) if (shader.textures[i] === shader.texture)
      shader.textures[i] = this.scene.textures.get('__DEFAULT');
    const renderer = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    // Dithering encoded channels changes the high byte and creates artificial flow.
    renderer.gl.disable(renderer.gl.DITHER);
    shader.renderWebGLStep(renderer, shader, shader.drawingContext!);
    if (this.dither) renderer.gl.enable(renderer.gl.DITHER);
    renderer.glWrapper.update({ blend: { enabled: true } });
  }
  prepare(view: FogRect, now: number): void {
    this.residency.update(view, now);
    if (this.residency.overflow) { this.display?.setVisible(false); return; }
    const data = this.terrainTexture.data;
    let changed = false;
    for (const chunk of this.residency.chunks.values()) {
      if (!chunk.fresh && !this.terrain.dirtyChunks.has(`${chunk.cx},${chunk.cy}`)) continue;
      changed = true;
      // Cached cells retain their reset flags until their first active step. A
      // terrain edit must not reinitialize the unaffected remainder of a chunk.
      if (chunk.fresh) this.resetSlots.delete(chunk.slot);
      const ox = chunk.slot % FOG.atlasCols * SIDE, oy = Math.floor(chunk.slot / FOG.atlasCols) * SIDE;
      for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
        const pixel = this.terrain.sample(chunk.cx * 512 + (x + .5) * 8, chunk.cy * 512 + (y + .5) * 8);
        const index = ((oy + y) * WIDTH + ox + x) * 4;
        const reset = pixel[3] || (!chunk.fresh && data[index + 3]);
        data.set(pixel, index);
        if (reset) { data[index + 3] = 255; this.resetSlots.add(chunk.slot); }
      }
    }
    if (changed) this.terrainTexture.upload();
    this.terrain.acknowledge();
    const lookupKey = [...this.residency.chunks.values()].filter(c => c.active).map(c => `${c.slot}:${c.cx}:${c.cy}`).join(';');
    if (lookupKey !== this.lookupKey) {
      this.lookupKey = lookupKey; this.lookup.data.fill(0);
      for (const c of this.residency.chunks.values()) if (c.active) this.lookup.data[(c.cy * this.lookup.width + c.cx) * 4] = c.slot + 1;
      this.lookup.upload();
    }
  }
  private uploadMeta(impulses: readonly FogImpulse[]): void {
    const meta = this.metaTexture.data; meta.fill(0); this.bins.data.fill(0);
    this.commands.data.fill(0);
    const frame = this.terrain.frame;
    const accepted = new Set<number>();
    impulses.forEach((p, i) => {
      encode(this.commands.data, i * 4, (p.x - frame.offsetX) / frame.width * 65535);
      encode(this.commands.data, i * 4 + 2, (p.y - frame.offsetY) / frame.height * 65535);
      encode(this.commands.data, (256 + i) * 4, (p.endX - frame.offsetX) / frame.width * 65535);
      encode(this.commands.data, (256 + i) * 4 + 2, (p.endY - frame.offsetY) / frame.height * 65535);
      encode(this.commands.data, (512 + i) * 4, p.radius / 4096 * 65535);
      this.commands.data[(512 + i) * 4 + 2] = Math.round(p.strength * 255);
      this.commands.data[(512 + i) * 4 + 3] = p.kind === 'explosion' ? 255 : p.kind === 'melee' ? 128 : 0;
      encode(this.commands.data, (768 + i) * 4, (Math.cos((p.arcDegrees ?? 0) * Math.PI / 360) * .5 + .5) * 65535);
      encode(this.commands.data, (768 + i) * 4 + 2, (Math.atan2(p.endY - p.y, p.endX - p.x) / (Math.PI * 2) + .5) * 65535);
    });
    for (const c of this.residency.chunks.values()) {
      for (const [i, [dx, dy]] of [[-1, 0], [1, 0], [0, -1], [0, 1]].entries()) {
        const n = this.residency.chunks.get(`${c.cx + dx},${c.cy + dy}`);
        meta[c.slot * 4 + i] = n?.active ? n.slot + 1 : 0;
      }
      encode(meta, (SLOTS + c.slot) * 4, c.cx); encode(meta, (SLOTS + c.slot) * 4 + 2, c.cy);
      const offset = (2 * SLOTS + c.slot) * 4;
      meta[offset] = c.active ? 255 : 0; meta[offset + 1] = c.fresh ? 255 : 0;
      if (!c.active) continue;
      const x = frame.offsetX + c.cx * 512, y = frame.offsetY + c.cy * 512;
      let count = 0;
      for (let i = 0; i < impulses.length && count < FOG.impulsesPerChunk; i++) {
        const p = impulses[i];
        if (Math.max(p.x, p.endX) + p.radius < x || Math.min(p.x, p.endX) - p.radius > x + 512
          || Math.max(p.y, p.endY) + p.radius < y || Math.min(p.y, p.endY) - p.radius > y + 512) continue;
        encode(this.bins.data, (c.slot * FOG.impulsesPerChunk + count++) * 4, i);
        accepted.add(i);
      }
      meta[offset + 2] = count;
    }
    this.metaTexture.upload(); this.commands.upload(); this.bins.upload();
    this.submitted = impulses.length;
    this.dropped += impulses.length - accepted.size;
  }
  step(impulses: readonly FogImpulse[], density: readonly number[], tuning: FogTuning, elapsed: number, initializeOnly = false): void {
    if (this.destroyed || this.residency.overflow) return;
    this.density = density; this.tuning = tuning; this.elapsed = elapsed; this.initializeOnly = initializeOnly;
    for (const p of impulses) if (p.kind === 'projectile' && p.radius <= 4) this.trails.add(p, elapsed);
    this.trails.prepare(elapsed);
    // Sub-cell bullet wakes use the continuous mask, not circular holes in the 8px field.
    this.uploadMeta(impulses.filter(p => p.kind !== 'projectile' || p.radius > 4));
    const next = 1 - this.current;
    this.draw(this.impulse, this.states[this.current], this.velocities[this.current]);
    this.draw(this.velocities[next], this.states[this.current], this.velocities[this.current]);
    this.draw(this.states[next], this.states[this.current], this.velocities[next]);
    this.current = next; this.initialized = true;
    for (const c of this.residency.chunks.values()) if (c.active) c.fresh = false;
    let cleared = false;
    for (const slot of this.resetSlots) if (this.residency.slots[slot]?.active) {
      const ox = slot % FOG.atlasCols * SIDE, oy = Math.floor(slot / FOG.atlasCols) * SIDE;
      for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) this.terrainTexture.data[((oy + y) * WIDTH + ox + x) * 4 + 3] = 0;
      this.resetSlots.delete(slot); cleared = true;
    }
    if (cleared) this.terrainTexture.upload();
  }
  render(view: FogRect, pixelWidth: number, pixelHeight: number, debug: FogDebug, interpolation: number,
    surfaces: readonly Phaser.GameObjects.Image[] = [], quality: FogQuality = 'high'): void {
    if (!this.initialized || this.residency.overflow || this.destroyed) { this.display?.setVisible(false); return; }
    this.view = view; this.debug = debug; this.interpolation = interpolation; this.quality = quality;
    const w = Math.max(2, Math.ceil(pixelWidth / 2) * 2), h = Math.max(2, Math.ceil(pixelHeight / 2) * 2);
    if (!this.material || this.material.width !== w || this.material.height !== h) {
      this.display?.destroy(); if (this.material) destroyFogShader(this.material);
      this.material = this.makePass('material', FOG_MATERIAL_FRAGMENT, w, h);
      this.material.texture!.setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.display = this.scene.add.image(view.x, view.y, this.material.texture!).setOrigin(0).setDepth(this.depth);
      this.surfaceMask?.destroy(); this.surfaceMask = null;
    }
    if (quality !== 'low' || this.trails.size > 0 || this.trailMask) {
      this.trailCommands ??= this.makeData('trailCommands', FOG.trailTextureWidth, FOG.trailCapacity / FOG.trailTextureWidth * 5);
      if (this.trailVersion !== this.trails.version) {
        this.trailCommands.data.set(this.trails.commands); this.trailCommands.upload(); this.trailVersion = this.trails.version;
      }
      if (!this.trailMask || this.trailMask.width !== w || this.trailMask.height !== h) {
        if (this.trailMask) destroyFogShader(this.trailMask);
        this.trailMask = this.makePass('trails', FOG_TRAIL_FRAGMENT, w, h, FOG_TRAIL_VERTEX);
        this.trailMask.texture!.setFilter(Phaser.Textures.FilterMode.LINEAR);
        this.trailRenderer = new FogTrailRenderer(this.trailMask, this.terrain.frame);
      }
      this.trailRenderer!.draw(this.trails, view, this.elapsed, this.tuning.reaction, this.trailCommands.texture, quality !== 'low');
    }
    this.hasSurfaces = surfaces.length > 0;
    if (this.hasSurfaces) {
      this.surfaceMask ??= new Phaser.GameObjects.RenderTexture(this.scene, 0, 0, w, h);
      const mask = this.surfaceMask; mask.clear();
      const sx = w / view.width, sy = h / view.height;
      for (const image of surfaces) {
        if (!image.active || !image.visible || image.alpha <= 0 || image.x < view.x - image.displayWidth
          || image.y < view.y - image.displayHeight || image.x > view.x + view.width + image.displayWidth
          || image.y > view.y + view.height + image.displayHeight) continue;
        mask.stamp(image.texture.key, image.frame.name, (image.x - view.x) * sx, (image.y - view.y) * sy,
          { scaleX: image.scaleX * sx, scaleY: image.scaleY * sy, originX: image.originX, originY: image.originY,
            rotation: image.rotation, alpha: image.alpha });
      }
      mask.render();
    }
    this.draw(this.material, this.states[this.current], this.states[1 - this.current]);
    this.display!.setPosition(view.x, view.y).setDisplaySize(view.width, view.height).setVisible(true);
  }
  hide(): void { this.display?.setVisible(false); }
  get trailDrawCalls(): number { return this.trailRenderer?.drawCalls ?? 0; }
  get visibleTraces(): number { return this.trailRenderer?.visibleTraces ?? 0; }
  /** Explicit lab diagnostic only; never used by simulation, residency or ordinary rendering. */
  readDensity(worldX: number, worldY: number): { density: number; reached: boolean } {
    const pixel = this.readPixel(worldX, worldY, this.states[this.current]);
    return { density: (pixel[0] * 256 + pixel[1]) / 65535, reached: pixel[2] > 127 };
  }
  readVelocity(worldX: number, worldY: number): readonly number[] {
    const p = this.readPixel(worldX, worldY, this.velocities[this.current]);
    return [((p[0] * 256 + p[1]) / 65535 * 2 - 1) * FOG.maxSpeed, ((p[2] * 256 + p[3]) / 65535 * 2 - 1) * FOG.maxSpeed];
  }
  readTrail(worldX: number, worldY: number): number {
    const shader = this.trailMask; if (!shader) return 0;
    const gl = (this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl, pixel = new Uint8Array(4);
    shader.drawingContext!.beginDraw();
    gl.readPixels(Math.floor((worldX - this.view.x) / this.view.width * shader.width),
      shader.height - 1 - Math.floor((worldY - this.view.y) / this.view.height * shader.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    (this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer).glWrapper.update({ blend: { enabled: true } });
    return pixel[0] / 255;
  }
  private readPixel(worldX: number, worldY: number, shader: Phaser.GameObjects.Shader): Uint8Array {
    const x = worldX - this.terrain.frame.offsetX, y = worldY - this.terrain.frame.offsetY;
    const c = this.residency.chunks.get(`${Math.floor(x / 512)},${Math.floor(y / 512)}`);
    if (!c) return new Uint8Array(4);
    const px = c.slot % FOG.atlasCols * SIDE + Math.floor((x % 512) / 8);
    const py = Math.floor(c.slot / FOG.atlasCols) * SIDE + Math.floor((y % 512) / 8);
    const context = shader.drawingContext!, gl = (this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl;
    const pixel = new Uint8Array(4);
    // use() auto-clears this render target; a diagnostic must only bind it.
    context.beginDraw();
    gl.readPixels(px, HEIGHT - 1 - py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    (this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer).glWrapper.update({ blend: { enabled: true } });
    return pixel;
  }
  get bytes(): number {
    return WIDTH * HEIGHT * 4 * 6 + this.metaTexture.data.length + this.commands.data.length + this.bins.data.length
      + this.lookup.data.length + (this.material ? this.material.width * this.material.height * 4 : 0)
      + (this.surfaceMask ? this.surfaceMask.width * this.surfaceMask.height * 4 : 0)
      + (this.trailMask ? this.trailMask.width * this.trailMask.height * 4 : 0)
      + (this.trailCommands?.data.length ?? 0) + (this.trailRenderer ? FOG.trailCapacity * 6 * 16 : 0);
  }
  destroy(): void {
    if (this.destroyed) return; this.destroyed = true;
    this.display?.destroy(); this.display = null;
    this.surfaceMask?.destroy(); this.surfaceMask = null;
    if (this.material) destroyFogShader(this.material);
    if (this.trailMask) destroyFogShader(this.trailMask);
    for (const shader of [...this.states, ...this.velocities, this.impulse]) if (shader) destroyFogShader(shader);
    for (const dispose of this.resources.splice(0)) dispose();
    this.trails.clear();
    this.residency.clear();
  }
}
