import * as Phaser from 'phaser';
import { DEPTH, VOID_PALETTE } from '../../config';
import { disposeShaderWarmupNode } from '../../graphics/disposeShaderWarmupNode';
import { createVisibleWorldView, getVisibleWorldView } from '../../graphics/CameraWorldView';
import type { FormationCoverageBinding } from '../../arena/rocks/RockFormationLighting';
import type { VoidCreepField, VoidCreepTexelRect } from '../../arena/VoidCreepField';
import { MAX_VOID_DANGER_ALERTS, type VoidDangerAlert, type VoidMarchers } from '../../arena/VoidDangerField';
import { VoidTaintTrails, type VoidTaintFrame } from '../../arena/VoidTaint';
import { createVoidLiftWave, liftFront, liftStrength, LIFT_SOFT_PX, type VoidLiftWave } from '../../arena/VoidLiftWave';
/** The creep's domain warp reaches this far (world px); a region rewrite grows by as much. */
const WARP_REACH_PX = 150;
import type { LightMapAmbientLayer } from '../LightingSystem';
import type { FogVoidHaze } from '../groundFog/FogVoidHaze';
import type { FogAirBinding } from '../groundFog/FogAirBinding';
import { VoidSporeMotes, type VoidMoteQuality } from './VoidSporeMotes';
import { VOID_MOTE_LIFTS } from './VoidSporeMoteShaders';
import { VoidTaintLayer } from './VoidTaintLayer';
import { SunRenderTarget } from './SunRenderTarget';
import { fogDetailNoise } from './SunFieldModel';
import {
  VOID_CREEP_GLOW_FRAGMENT, VOID_CREEP_GLOW_SHADER_NAME, VOID_CREEP_GROUND_FRAGMENT, VOID_CREEP_GROUND_SHADER_NAME,
  VOID_CREEP_ROCK_FRAGMENT, VOID_CREEP_ROCK_SHADER_NAME,
} from './VoidCreepShaders';

/** Light the creep adds at full night, per channel of the void's primary violet. */
const GLOW_STRENGTH = 0.30;
/** Strength of the airborne spore haze inside the ground fog. */
const AIR_STRENGTH = 0.85;
/** World margin around the camera so drifting rims never pop at the screen edge. */
const VIEW_MARGIN_PX = 24;
/** A haze region crossfades this long after its place lost or regained presence (E7). */
const HAZE_FADE_SEC = 3;
/**
 * Patches of that crossfade start one after another across this share of it; patch size in world px.
 * Over the shaped fog a uniform crossfade let whole areas cross the fog's threshold at once.
 */
const HAZE_FADE_SPREAD = .55, HAZE_FADE_PATCH_PX = 170;
/** Lifting waves shown at once (VoidLiftWave); a further one replaces the oldest. */
const MAX_LIFTS = VOID_MOTE_LIFTS;
/** Haze crossfades re-upload the field at most this often; the haze drifts slowly anyway. */
const HAZE_UPLOAD_SEC = 1 / 15;

/** A running crossfade of one texel region of the haze channel; a lift wipes outward from its centre. */
interface HazeFade {
  readonly rect: VoidCreepTexelRect;
  readonly from: Uint8Array;
  readonly to: Uint8Array;
  elapsed: number;
  readonly lift: VoidLiftWave | null;
}
/** A lifting wave on its way out, for the motes' shimmer and the creep it wipes. */
interface RunningLift { readonly wave: VoidLiftWave; elapsed: number }

let nextCreepId = 0;
type Set = (name: string, value: unknown) => void;

/** The creep's night light in light-map space, drawn additively like the moon islands. */
class VoidCreepGlow implements LightMapAmbientLayer {
  private readonly target: SunRenderTarget;
  private readonly image: Phaser.GameObjects.Image;
  private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer;
  private readonly world = new Float32Array(4);
  readonly glow = new Float32Array(3);
  private width = 0;
  private height = 0;

  constructor(scene: Phaser.Scene, texture: string,
    private readonly creep: { frame: Float32Array; time: number; alerts: Float32Array; alertLevels: Float32Array; shape: Float32Array;
      fogShapeView: Float32Array; fogShapeLent: number; taintView: Float32Array; taintOn: number }) {
    this.renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    this.target = new SunRenderTarget(scene, 'VoidCreepGlow', VOID_CREEP_GLOW_FRAGMENT, set => {
      set('uCreep', 0); set('uCreepFrame', this.creep.frame); set('uCreepTime', this.creep.time);
      set('uVoidAlert[0]', this.creep.alerts); set('uVoidAlertLevel[0]', this.creep.alertLevels);
      set('uHazeShape', this.creep.shape); set('uWorld', this.world); set('uGlow', this.glow);
      set('uFogShape', 1); set('uFogShapeView', this.creep.fogShapeView); set('uFogShapeLent', this.creep.fogShapeLent);
      set('uVoidTaint', 2); set('uVoidTaintView', this.creep.taintView); set('uVoidTaintOn', this.creep.taintOn);
    }, [texture, '__DEFAULT', '__DEFAULT'], VOID_CREEP_GLOW_SHADER_NAME);
    this.image = new Phaser.GameObjects.Image(scene, 0, 0, this.target.shader.texture!.key)
      .setOrigin(0).setBlendMode(Phaser.BlendModes.ADD);
  }

  /** The fog's lent shape texture on unit one; null falls back to evaluating the shape. */
  setFogShape(texture: Phaser.Textures.Texture | null): void {
    const shader = this.target.shader, next = texture ?? shader.scene.textures.get('__DEFAULT');
    if (shader.textures[1] !== next) shader.textures[1] = next;
  }

  /** This frame's void trails on unit two; null without. */
  setTaint(texture: Phaser.Textures.Texture | null): void {
    const shader = this.target.shader, next = texture ?? shader.scene.textures.get('__DEFAULT');
    if (shader.textures[2] !== next) shader.textures[2] = next;
  }

  update(worldX: number, worldY: number, worldWidth: number, worldHeight: number, width: number, height: number):
    Phaser.GameObjects.GameObject | null {
    this.world[0] = worldX; this.world[1] = worldY; this.world[2] = worldWidth; this.world[3] = worldHeight;
    this.renderer.renderNodes.finishBatch();
    this.target.draw(width, height);
    if (this.width !== width || this.height !== height) {
      this.width = width; this.height = height;
      this.image.setTexture(this.target.shader.texture!.key).setDisplaySize(width, height);
    }
    return this.image;
  }

  destroy(): void { this.image.destroy(); this.target.destroy(); }
}

/**
 * Void creep of one World (GDD Nachtsicht N-6): a fine spore haze over ground and rock tops where
 * the void has taken the flora, and its night glow through the light map. Material layers draw by day and
 * night; the glow only from dusk. Owned by the World's sunlight presentation, which also hands the
 * creep field to the water stain and the spores.
 */
export class VoidCreepPresentation {
  private readonly id = nextCreepId++;
  private key: string | null = null;
  private texture: Phaser.Textures.CanvasTexture | null = null;
  private pixels: ImageData | null = null;
  private field: VoidCreepField | null = null;
  /** The haze as currently shown; crossfades write into it. */
  private haze: Uint8Array | null = null;
  private fades: HazeFade[] = [];
  /** Lifting waves by slot; the motes shimmer along their fronts. */
  private readonly lifts: (RunningLift | null)[] = Array(MAX_LIFTS).fill(null);
  /** Trails hostile bodies lay (E12); they outlive creep rebuilds of the same World. */
  private trails: VoidTaintTrails | null = null;
  private taint: VoidTaintLayer | null = null;
  private taintFrame: VoidTaintFrame | null = null;
  /** Long side of the trails' target in texels (quality). */
  private taintTexels = 512;
  private lastTime = NaN;
  private sinceUpload = 0;
  private readonly creep = { frame: new Float32Array(4), time: 0,
    alerts: new Float32Array(MAX_VOID_DANGER_ALERTS * 4), alertLevels: new Float32Array(MAX_VOID_DANGER_ALERTS),
    /** Lifting waves for the motes: centre x, y, front radius, strength. */
    lifts: new Float32Array(MAX_LIFTS * 4),
    /** Shaped fog: on, shape time (s), drift travel (px), cover; the haze then draws the fog's shape. */
    shape: new Float32Array(4),
    /** The fog's lent shape pass: the world rect it covers and 1 while lent (fogShape). */
    fogShapeView: new Float32Array(4), fogShapeLent: 0,
    /** The void trails' target: the world rect it covers and 1 while it holds trails (VoidTaintLayer). */
    taintView: new Float32Array(4), taintOn: 0 };
  /** The trails as lent with the airborne haze to the fog, kept current every frame. */
  private readonly taintBinding: { texture: Phaser.Textures.Texture | null; readonly view: Float32Array; on: number } =
    { texture: null, view: this.creep.taintView, on: 0 };
  /** The fog's shape texture this frame, borrowed read-only; null evaluates the shape here. */
  private fogShapeTexture: Phaser.Textures.Texture | null = null;
  private nextLiftSlot = 0;
  /** World px per screen pixel; the surface shaders fade detail finer than that. */
  private pixelWorld = 1;
  private readonly view = new Float32Array(4);
  private readonly visible = createVisibleWorldView();
  private readonly rockFrame = new Float32Array(4);
  private ground: Phaser.GameObjects.Shader | null = null;
  private rock: Phaser.GameObjects.Shader | null = null;
  private rockBinding: FormationCoverageBinding | null = null;
  private glow: VoidCreepGlow | null = null;
  private motes: VoidSporeMotes | null = null;
  /** The airborne half of the haze, lent to the World's ground fog; null without creep. */
  private fogHaze: (Omit<FogVoidHaze, 'time'> & { time: number }) | null = null;
  /** 1 while the fog carries the airborne haze; the ground layer then keeps to settled dust. */
  private airborne = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  /** The World's creep field; null releases texture, quads and glow. */
  setCreep(creep: VoidCreepField | null): void {
    this.release();
    if (!creep) return;
    const key = this.key = `__void_creep_${this.id}`;
    const texture = this.scene.textures.createCanvas(key, creep.width, creep.height);
    if (!texture) throw new Error('[VoidCreepPresentation] Cannot allocate the creep field');
    const pixels = texture.context.createImageData(creep.width, creep.height);
    for (let i = 0; i < creep.data.length; i++) {
      pixels.data[i * 4] = creep.data[i]; pixels.data[i * 4 + 1] = creep.land[i]; pixels.data[i * 4 + 2] = creep.haze[i]; pixels.data[i * 4 + 3] = 255;
    }
    texture.context.putImageData(pixels, 0, 0); texture.refresh();
    this.texture = texture; this.pixels = pixels; this.field = creep; this.haze = creep.haze.slice();
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.creep.frame.set([creep.offsetX, creep.offsetY, creep.width * creep.texelPx, creep.height * creep.texelPx]);
    this.fogHaze = { texture, frame: this.creep.frame, time: 0, strength: AIR_STRENGTH,
      alerts: this.creep.alerts, alertLevels: this.creep.alertLevels, taint: this.taintBinding };
    this.ground = this.makeQuad(VOID_CREEP_GROUND_SHADER_NAME, VOID_CREEP_GROUND_FRAGMENT, DEPTH.VOID_CREEP, [key, '__DEFAULT', '__DEFAULT'],
      set => { set('uFogShape', 1); set('uVoidTaint', 2); });
    this.motes = new VoidSporeMotes(this.scene, key, this.creep, this.view, () => this.pixelWorld);
  }

  /** Spawn zone warnings of this frame, strongest first; every void layer thickens its haze there. */
  setAlerts(alerts: readonly VoidDangerAlert[]): void {
    const { alerts: rects, alertLevels: levels } = this.creep;
    levels.fill(0);
    alerts.slice(0, MAX_VOID_DANGER_ALERTS).forEach((alert, i) => {
      rects[i * 4] = alert.x; rects[i * 4 + 1] = alert.y; rects[i * 4 + 2] = alert.width; rects[i * 4 + 3] = alert.height;
      levels[i] = Math.max(0, Math.min(1, alert.level));
    });
  }

  /**
   * Shaped fog (fogStyle 1): the haze draws the fog's own shape at the fog's time and wind travel
   * (`fogShape`, `woodlandThickness`), so the dust below, the glow and the violet fog coincide.
   */
  setFogShape(shaped: boolean, timeSec: number, travelPx: number, cover: number): void {
    this.creep.shape[0] = shaped ? 1 : 0; this.creep.shape[1] = timeSec; this.creep.shape[2] = travelPx; this.creep.shape[3] = cover;
  }

  /**
   * The fog's shape pass after its draw this frame (GroundFogSystem.getShapeBinding), lent read-only:
   * dust and glow then draw exactly the violet fog's shape. Null evaluates the shape here instead.
   */
  setFogShapeBinding(binding: { readonly texture: Phaser.Textures.Texture; readonly view: Float32Array } | null): void {
    this.creep.fogShapeLent = binding ? 1 : 0;
    if (binding) this.creep.fogShapeView.set(binding.view);
    this.fogShapeTexture = binding?.texture ?? null;
    this.bindFogShape();
  }

  private bindFogShape(): void {
    const texture = this.fogShapeTexture ?? this.scene.textures.get('__DEFAULT');
    if (this.ground && this.ground.textures[1] !== texture) this.ground.textures[1] = texture;
    if (this.rock && this.rock.textures[3] !== texture) this.rock.textures[3] = texture;
    this.glow?.setFogShape(this.fogShapeTexture);
  }

  /** The fog's air after its step this frame, lent to the motes; null without simulating fog. */
  setAir(air: FogAirBinding | null): void { this.motes?.setAir(air); }

  /**
   * Crossfades the haze of one texel region to `to` (region-sized, row-major) over a few seconds:
   * a destroyed base or a closed site lets its haze lift while the soaked ground stays. A region
   * that is still fading starts from what it shows now. A `lift` wave (startLift) wipes it outward.
   */
  fadeHaze(rect: VoidCreepTexelRect, to: Uint8Array, lift: VoidLiftWave | null = null): void {
    if (!this.haze || !this.field) return;
    const width = rect.x1 - rect.x0 + 1, from = new Uint8Array(to.length);
    for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++)
      from[(y - rect.y0) * width + x - rect.x0] = this.haze[y * this.field.width + x];
    this.fades.push({ rect, from, to, elapsed: 0, lift });
  }

  /**
   * Starts the wave that lifts a deactivated place (E11) and the trails its enemies laid (E13): out
   * from the place over its extent, reaching as far as the zone's trails. `zone` null lifts no trails.
   * The returned wave also drives the place's own crossfade (fadeHaze).
   */
  startLift(extent: { x: number; y: number; radius: number }, zone: string | null): VoidLiftWave {
    // The wave runs past the far corner of the place's region, so every texel reaches its residue.
    const place = extent.radius + WARP_REACH_PX + (this.field?.texelPx ?? 0);
    const reach = zone && this.trails ? this.trails.reachOf(zone, extent.x, extent.y) : 0;
    const wave = createVoidLiftWave(extent.x, extent.y, place, reach);
    const slot = this.nextLiftSlot; this.nextLiftSlot = (slot + 1) % MAX_LIFTS;
    // A replaced wave finishes its crossfades at once instead of freezing half way.
    const replaced = this.lifts[slot]?.wave;
    if (replaced) for (const fade of this.fades) if (fade.lift === replaced) fade.elapsed = replaced.durationSec;
    this.lifts[slot] = { wave, elapsed: 0 };
    if (zone && this.trails) this.trails.lift(zone, (Number.isFinite(this.lastTime) ? this.lastTime : 0) * 1000, wave);
    return wave;
  }

  /** True while a haze crossfade is running. */
  get fadingHaze(): boolean { return this.fades.length > 0; }

  /**
   * This frame's trail-laying bodies (E12), stamped at `timeSec` on the World `frame`; null lays
   * none and lets the trails fade. Call before `update`.
   */
  feedMarchers(marchers: VoidMarchers | null, timeSec: number, frame: VoidTaintFrame): void {
    if (this.taintFrame && (this.taintFrame.offsetX !== frame.offsetX || this.taintFrame.offsetY !== frame.offsetY
      || this.taintFrame.width !== frame.width || this.taintFrame.height !== frame.height)) this.releaseTaint();
    if (!this.trails) {
      if (!marchers) return;
      this.taintFrame = { ...frame };
      this.trails = new VoidTaintTrails(this.taintFrame);
      this.taint = new VoidTaintLayer(this.scene, this.trails, this.taintFrame);
    }
    this.trails.feed(timeSec * 1000, marchers);
  }

  /** Long side of the trails' target in texels; follows the render quality. */
  setTaintResolution(texels: number): void { this.taintTexels = Math.max(64, Math.round(texels)); }

  /** True while trails are laid or still fading; the World keeps a land-only creep for them. */
  get hasTrails(): boolean { return (this.trails?.size ?? 0) > 0; }

  private advanceFades(timeSec: number): void {
    const step = Number.isFinite(this.lastTime) ? Math.max(0, Math.min(.25, timeSec - this.lastTime)) : 0;
    this.lastTime = timeSec;
    // The waves move every frame; the haze behind them is uploaded at a calmer rate.
    this.creep.lifts.fill(0);
    this.lifts.forEach((lift, slot) => {
      if (!lift) return;
      lift.elapsed += step;
      if (lift.elapsed >= lift.wave.durationSec) { this.lifts[slot] = null; return; }
      const o = slot * 4;
      this.creep.lifts[o] = lift.wave.x; this.creep.lifts[o + 1] = lift.wave.y;
      this.creep.lifts[o + 2] = liftFront(lift.wave, lift.elapsed);
      this.creep.lifts[o + 3] = liftStrength(lift.wave, lift.elapsed);
    });
    if (!this.fades.length || !this.field || !this.haze || !this.pixels || !this.texture) return;
    this.sinceUpload += step;
    const duration = (fade: HazeFade): number => fade.lift ? fade.lift.durationSec : HAZE_FADE_SEC;
    for (const fade of this.fades) fade.elapsed += step;
    if (this.sinceUpload < HAZE_UPLOAD_SEC && this.fades.every(fade => fade.elapsed < duration(fade))) return;
    this.sinceUpload = 0;
    const field = this.field, haze = this.haze, data = this.pixels.data;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    // Later fades win where regions overlap; each starts from what the earlier ones showed.
    for (const fade of this.fades) {
      const t = Math.min(1, fade.elapsed / duration(fade)), { rect, lift } = fade, width = rect.x1 - rect.x0 + 1;
      const front = lift ? liftFront(lift, fade.elapsed) : 0, uniform = t * t * (3 - 2 * t);
      for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) {
        let k = uniform;
        const wx = field.offsetX + (x + .5) * field.texelPx, wy = field.offsetY + (y + .5) * field.texelPx;
        if (lift && t < 1) {
          const distance = Math.hypot(wx - lift.x, wy - lift.y);
          const behind = Math.max(0, Math.min(1, (front - distance) / LIFT_SOFT_PX));
          k = behind * behind * (3 - 2 * behind);
        } else if (t < 1) {
          // A place gaining or losing presence changes patch by patch, never all at once.
          const local = Math.max(0, Math.min(1, (t - HAZE_FADE_SPREAD * fogDetailNoise(wx / HAZE_FADE_PATCH_PX, wy / HAZE_FADE_PATCH_PX))
            / (1 - HAZE_FADE_SPREAD)));
          k = local * local * (3 - 2 * local);
        }
        const i = (y - rect.y0) * width + x - rect.x0, value = Math.round(fade.from[i] + (fade.to[i] - fade.from[i]) * k);
        haze[y * field.width + x] = value; data[(y * field.width + x) * 4 + 2] = value;
      }
      x0 = Math.min(x0, rect.x0); y0 = Math.min(y0, rect.y0); x1 = Math.max(x1, rect.x1); y1 = Math.max(y1, rect.y1);
    }
    this.fades = this.fades.filter(fade => fade.elapsed < duration(fade));
    this.texture.context.putImageData(this.pixels, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.texture.refresh();
  }

  /**
   * Follows the camera and returns the light-map layer for this frame (null by day, on low
   * quality or without creep). `night` 0..1 follows the lamps' dusk curve.
   */
  update(camera: Phaser.Cameras.Scene2D.Camera, timeSec: number, night: number,
    options: { rocks: boolean; glow: boolean; airborne: boolean; motes: VoidMoteQuality }, coverage: FormationCoverageBinding | null): LightMapAmbientLayer | null {
    if (!this.key || !this.ground) return null;
    this.advanceFades(timeSec);
    this.creep.time = timeSec;
    if (this.fogHaze) this.fogHaze.time = timeSec;
    this.airborne = options.airborne ? 1 : 0;
    // The arena camera uses origin (0, 0); Phaser's cached worldView assumes 0.5.
    const view = getVisibleWorldView(camera, this.visible, VIEW_MARGIN_PX);
    this.view[0] = view.x; this.view[1] = view.y; this.view[2] = view.width; this.view[3] = view.height;
    this.pixelWorld = (view.width - VIEW_MARGIN_PX * 2) / Math.max(1, camera.width);
    // The trails' target follows the camera; the void layers and the fog read it this frame.
    this.taint?.update(camera, timeSec * 1000, this.taintTexels);
    const taint = this.taint?.texture ?? null;
    this.creep.taintOn = taint ? 1 : 0;
    if (taint) this.creep.taintView.set(this.taint!.view);
    this.taintBinding.texture = taint; this.taintBinding.on = this.creep.taintOn;
    // A World without hazy places of its own shows nothing but its trails.
    const bare = !!this.field?.landOnly && !taint;
    this.place(this.ground.setVisible(!bare));
    this.motes?.setVisible(!bare);
    this.motes?.update(this.view[0], this.view[1], this.view[2], this.view[3], night, options.motes);
    this.syncRock(options.rocks && !bare ? coverage : null);
    this.bindFogShape();
    this.bindTaint();
    if (!options.glow || night <= .01 || bare) return null;
    if (!this.glow) { this.glow = new VoidCreepGlow(this.scene, this.key, this.creep); this.bindFogShape(); this.bindTaint(); }
    const [r, g, b] = [(VOID_PALETTE.primary >> 16) & 255, (VOID_PALETTE.primary >> 8) & 255, VOID_PALETTE.primary & 255];
    const strength = GLOW_STRENGTH * Math.min(1, night) / 255;
    this.glow.glow[0] = r * strength; this.glow.glow[1] = g * strength; this.glow.glow[2] = b * strength;
    return this.glow;
  }

  /** The airborne haze for the World's fog, kept current by `update`; null without creep. */
  get airHaze(): FogVoidHaze | null { return this.fogHaze; }

  destroy(): void { this.release(); this.releaseTaint(); }

  private bindTaint(): void {
    const taint = this.taintBinding.texture, texture = taint ?? this.scene.textures.get('__DEFAULT');
    if (this.ground && this.ground.textures[2] !== texture) this.ground.textures[2] = texture;
    if (this.rock && this.rock.textures[4] !== texture) this.rock.textures[4] = texture;
    this.motes?.setTaint(taint);
    this.glow?.setTaint(taint);
  }

  private releaseTaint(): void {
    this.taint?.destroy(); this.taint = null; this.trails = null; this.taintFrame = null;
    this.creep.taintOn = 0; this.taintBinding.texture = null; this.taintBinding.on = 0;
  }

  private syncRock(coverage: FormationCoverageBinding | null): void {
    if (!coverage) { this.rock?.setVisible(false); return; }
    if (!this.rock) {
      this.rock = this.makeQuad(VOID_CREEP_ROCK_SHADER_NAME, VOID_CREEP_ROCK_FRAGMENT, DEPTH.ROCK_VOID_CREEP,
        [this.key!, coverage.field.key, coverage.lookup.key, '__DEFAULT', '__DEFAULT'], set => {
          set('uRockField', 1); set('uRockLookup', 2); set('uRockFrame', this.rockFrame); set('uFogShape', 3); set('uVoidTaint', 4);
        });
      this.rockBinding = coverage;
      this.bindFogShape(); this.bindTaint();
    } else if (this.rockBinding !== coverage) {
      this.rock.setTextures([this.key!, coverage.field.key, coverage.lookup.key, '__DEFAULT', '__DEFAULT']);
      this.rockBinding = coverage;
      this.bindFogShape(); this.bindTaint();
    }
    for (let i = 0; i < 4; i++) this.rockFrame[i] = coverage.frame[i];
    this.place(this.rock.setVisible(true));
  }

  private place(quad: Phaser.GameObjects.Shader): void {
    quad.setPosition(this.view[0], this.view[1]).setDisplaySize(this.view[2], this.view[3]);
  }

  private makeQuad(name: string, fragmentSource: string, depth: number, textures: string[], extra: (set: Set) => void):
    Phaser.GameObjects.Shader {
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name, shaderName: name, fragmentSource,
      setupUniforms: (set: Set) => {
        set('uCreep', 0); set('uCreepFrame', this.creep.frame); set('uCreepTime', this.creep.time); set('uView', this.view);
        set('uVoidAlert[0]', this.creep.alerts); set('uVoidAlertLevel[0]', this.creep.alertLevels);
        set('uPixelWorld', this.pixelWorld); set('uAirborne', this.airborne); set('uHazeShape', this.creep.shape);
        set('uFogShapeView', this.creep.fogShapeView); set('uFogShapeLent', this.creep.fogShapeLent);
        set('uVoidTaintView', this.creep.taintView); set('uVoidTaintOn', this.creep.taintOn);
        extra(set);
      },
    }, 0, 0, 1, 1, textures);
    const node = quad.renderNode;
    if (node) quad.once('destroy', () => disposeShaderWarmupNode(node));
    quad.setOrigin(0).setDepth(depth).setBlendMode(Phaser.BlendModes.NORMAL);
    this.scene.add.existing(quad);
    return quad;
  }

  private release(): void {
    this.ground?.destroy(); this.ground = null;
    this.rock?.destroy(); this.rock = null; this.rockBinding = null;
    this.glow?.destroy(); this.glow = null;
    this.motes?.destroy(); this.motes = null;
    this.fogHaze = null; this.fogShapeTexture = null; this.creep.fogShapeLent = 0;
    this.texture = null; this.pixels = null; this.field = null; this.haze = null; this.fades = []; this.lastTime = NaN; this.sinceUpload = 0;
    this.creep.lifts.fill(0); this.lifts.fill(null);
    if (this.key) { this.scene.textures.remove(this.key); this.key = null; }
  }
}
