import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH, DEPTH_LIGHTING } from '../../config';
import type { LightingSystem } from '../../effects/LightingSystem';
import { LIGHT_PRESETS, type LightPresetKey } from '../../effects/LightingConfig';
import type { LongCasterFrame, ShadowSystem } from '../../effects/ShadowSystem';
import { STRUCTURE_SHADOW } from '../../effects/ShadowConfig';
import { emissiveAlpha } from '../../effects/EmissiveScale';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { setCloudUniforms } from '../../effects/sunlight/cloudShadow';
import { createSurfaceLightFrame, setSurfaceLightUniforms } from '../../effects/SurfaceLocalLights';
import type { FogSurfaceStamp } from '../../effects/groundFog/FogSurfaceMask';
import type { LobbyStructureSunlight } from '../lobbyStructures/LobbyStructureRenderer';
import { LOBBY_STRUCTURE_RELIEF_FRAGMENT, LOBBY_STRUCTURE_SHADOW_FRAGMENT } from '../lobbyStructures/lobbyStructureShaders';
import { baseFortCoreAsset, baseFortKitAsset, baseFortTextureKey, TURRET_PLINTH, type BaseFortLayer, type BaseFortPass, type BaseFortSocket } from './BaseFortAssets';
import { composeOutpost, type ComposedFort, type FortCell } from './BaseFortKitComposer';
import { fortObstacleCover, type FortHeightWindow } from './fortObstacleCover';
import type { BaseFortEmitter, BaseFortEmitterKind, BaseFortFx } from './BaseFortFx';
import { BaseFortMountedHeights, MOUNTED_HEIGHT_RANGE_PX } from './BaseFortMountedHeights';
import type { MeshShadowCaster } from '../../effects/EnemyMeshShadowRenderer';

/** Ambient particles of one fort; supplied by the World presentation, which owns the GPU particle backend. */
export type BaseFortParticles = Pick<BaseFortFx, 'setActive' | 'setNight' | 'destroy'>;
export type BaseFortParticleFactory = (emitters: readonly BaseFortEmitter[]) => BaseFortParticles;

type FortLighting = Pick<LightingSystem, 'setLight' | 'releaseLight' | 'getArtificialLightFactor'>;
type FortShadows = Pick<ShadowSystem, 'getLongCasterFrame' | 'turretCasters'>;
/** Dynamic textures share the caster images' row order (v = 1 at the top), so no flip. */
const MOUNTED_FLIP = 0;

/**
 * Below the turrets' aura (ROCKS + 0.1) and sprite (ROCKS + 0.2), above the ground band: turrets
 * stand on the decks, figures walk in front of the walls.
 */
export const BASE_FORT_DEPTH = DEPTH.ROCKS + 0.04;
const RELIEF_DEPTH = BASE_FORT_DEPTH + 0.005;
/** The translucent ground layer lies on the build-area gravel, below decals and figures. */
const GROUND_DEPTH = DEPTH.BASES;
const EMISSION_DEPTH = DEPTH_LIGHTING + 0.1;
/**
 * The ground layer lies above the ground chunks, so the ground's sun shading does not reach it;
 * this tint brings its albedo down to the shaded gravel it covers (measured on map 04 at noon).
 */
const GROUND_TINT = 0xb6b2aa;
/** Low decks and stakes: a lighter, softer ground shadow than the tall lobby buildings. */
const FORT_SHADOW = { opacity: .34, softness: 1.6 };
/**
 * The glowing torch heads and bowl coals glow by day too and breathe slowly: fast flicker reads as
 * strobing at this scale.
 */
const LAYER_LOOK: Record<BaseFortLayer, { day: number; night: number; flicker: number; hz: number }> = {
  forge: { day: .6, night: 1, flicker: .08, hz: 1.3 },
};
/**
 * Light-map lights by socket prefix; daylight keeps a pool, night the full one. The fire bowls stay
 * clearly lit by day; the torches only faintly.
 */
const SOCKET_LIGHTS: readonly { prefix: string; preset: LightPresetKey; day: number; scale: number }[] = [
  { prefix: 'bowl', preset: 'baseFortBowl', day: .55, scale: 1 },
  { prefix: 'torch', preset: 'baseFortTorch', day: .3, scale: 1 },
];
const EMITTER_KINDS: readonly BaseFortEmitterKind[] = ['torch', 'bowl'];
/** The structure fades with the staggered cell explosions instead of vanishing at once. */
const DESTROYED_ALPHA = 0;
/** Turret plinths lie on the decks, under the turrets' mounted shadow (ROCKS + 0.09) and sprite. */
const PLINTH_DEPTH = DEPTH.ROCKS + 0.06;
/**
 * The plinth's stone fills 0.70 m of its 0.78 m canvas (catalog orthoScale) and shows 22 px wide, centred under
 * its turret. Where something rises more than 10 px above the deck (stakes, posts, fire bowls) it is cut away,
 * so the palisade stands in front of its rim; without readable caster heights it shrinks to stay clear.
 */
const PLINTH = { fill: .70 / .78, sidePx: 22, fallbackSidePx: 13, risePx: 10 };

const EMPTY_CASTERS: readonly MeshShadowCaster[] = [];

/** Deterministic flicker per light, two incommensurate sines. */
function flicker(seconds: number, hz: number, amount: number, phase: number): number {
  if (amount <= 0) return 1;
  return 1 + amount * (.6 * Math.sin((seconds * hz + phase) * Math.PI * 2) + .4 * Math.sin((seconds * hz * 2.37 + phase * 3.1) * Math.PI * 2));
}

/** Where a view's art comes from: the published core, or an outpost composed from the kit. */
interface FortArt {
  readonly size: number;
  readonly sourceSize: number;
  readonly heightPx: { readonly min: number; readonly max: number };
  readonly deckPx: number;
  readonly layers: readonly BaseFortLayer[];
  readonly keys: Readonly<Partial<Record<BaseFortPass, string>>>;
  readonly sockets: readonly (readonly [string, BaseFortSocket])[];
  /** Composed textures the view owns and removes with it. */
  readonly owned: readonly string[];
  /** Outposts: the kit caster-height frame of every cell (their composed caster grid is GPU-only). */
  readonly cellHeights?: ComposedFort['cellHeights'];
}

interface FortMounted {
  left: number;
  top: number;
  target: Phaser.Textures.DynamicTexture | null;
  readonly uniform: Float32Array;
}

interface FortView {
  readonly art: FortArt;
  readonly ground: Phaser.GameObjects.Image | null;
  readonly body: Phaser.GameObjects.Image;
  readonly relief: Phaser.GameObjects.Shader | null;
  readonly shadow: Phaser.GameObjects.Shader | null;
  readonly emission: { layer: BaseFortLayer; image: Phaser.GameObjects.Image; phase: number }[];
  readonly lights: { key: string; preset: LightPresetKey; day: number; scale: number; x: number; y: number; phase: number }[];
  readonly stamp: { -readonly [K in keyof FogSurfaceStamp]: FogSurfaceStamp[K] };
  readonly emitters: readonly BaseFortEmitter[];
  fx: BaseFortParticles | null;
  /** World centres of the base cells; turrets standing on them join the fort's shadow. */
  readonly cells: readonly { readonly x: number; readonly y: number }[];
  readonly mounted: FortMounted;
  readonly cellCount: number;
  destroyedCells: number;
  /** Per cell: the caster heights around it (the core's grid or an outpost's kit frame), read once; null if unreadable. */
  heightWindows: (FortHeightWindow | null)[] | null;
  /** Plinth textures cut to this fort's cells, owned by the view. */
  readonly plinthKeys: string[];
  /** Stone plinths under the turrets standing on the cells, by cell index. */
  readonly plinths: Map<number, Phaser.GameObjects.Image>;
}

/**
 * Presentation of the persistent base core as one hand-built fort (GDD Rustikale Basis): the
 * translucent ground layer over the build-area gravel, the lit structure with height relief and a
 * ray-marched ground shadow on the shared sun, emissive torches and lanterns above the light map,
 * and their light-map lights. Collision, occlusion and HP stay with the base cells; the fort only
 * presents them. One renderer per BaseManager, one view per persistent core.
 */
export class BaseFortRenderer {
  private readonly views = new Map<string, FortView>();
  private lighting: FortLighting | null = null;
  private shadows: FortShadows | null = null;
  private sunlight: LobbyStructureSunlight | null = null;
  private particles: BaseFortParticleFactory | null = null;
  private readonly castFrame: LongCasterFrame = { x: 0, y: 1, lengthMult: 1, softnessMult: 1, opacityMult: 1, visible: true };
  private readonly surfaceLights = createSurfaceLightFrame();
  private readonly canvasUniform = new Float32Array(4);
  private readonly quadUniform = new Float32Array(4);
  private readonly castUniform = new Float32Array(4);
  private readonly heightUniform = new Float32Array(2);
  private readonly optionsUniform = new Float32Array([0, 0, 1, 1]);
  private readonly shadeUniform = new Float32Array(2);
  private mountedHeights: BaseFortMountedHeights | null = null;
  private readonly casterScratch: MeshShadowCaster[] = [];
  private readonly occupiedScratch = new Set<number>();
  private readonly mountedScratch: MeshShadowCaster[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  /** Presents a persistent core centred on the given world point (the centre of its anchor cell). */
  add(baseId: string, centreX: number, centreY: number, cells: readonly { readonly x: number; readonly y: number }[]): void {
    const asset = baseFortCoreAsset();
    if (!asset) return;
    this.remove(baseId);
    const keys: Partial<Record<BaseFortPass, string>> = {};
    const passes: BaseFortPass[] = ['beauty', 'albedo', 'elevation', 'solid', 'caster-height', 'ground',
      ...asset.layers.map(layer => `emission-${layer}` as const)];
    for (const pass of passes) keys[pass] = baseFortTextureKey(asset, pass);
    this.present(baseId, { size: asset.displaySize, sourceSize: asset.sourceSize, heightPx: asset.heightPx, deckPx: asset.deckPx ?? 0,
      layers: asset.layers, keys, sockets: Object.entries(asset.sockets), owned: [] }, centreX, centreY, cells);
  }

  /**
   * Presents an outpost or middle base: its art is composed once from the outpost kit, one frame per
   * cell mask, in the same fort style as the core. Returns false without a published kit.
   */
  addOutpost(baseId: string, cells: readonly FortCell[]): boolean {
    const kit = baseFortKitAsset();
    if (!kit || !cells.length) return false;
    this.remove(baseId);
    const lit = getGraphicsQualityProfile(this.scene).level !== 'low';
    const passes: BaseFortPass[] = [lit ? 'albedo' : 'beauty', 'solid', ...kit.layers.map(layer => `emission-${layer}` as const),
      ...(lit ? ['elevation', 'caster-height'] as const : [])];
    const composed = composeOutpost(this.scene, kit, baseId, cells, passes);
    if (!composed) return false;
    this.present(baseId, { size: composed.size, sourceSize: composed.sourceSize, heightPx: kit.heightPx, deckPx: kit.deckPx ?? 0,
      layers: kit.layers, keys: composed.keys, sockets: composed.sockets, owned: Object.values(composed.keys), cellHeights: composed.cellHeights },
    composed.centreX, composed.centreY, cells);
    return true;
  }

  private present(baseId: string, art: FortArt, centreX: number, centreY: number,
    cells: readonly { readonly x: number; readonly y: number }[]): void {
    const size = art.size, key = (pass: BaseFortPass) => art.keys[pass]!;
    const lit = getGraphicsQualityProfile(this.scene).level !== 'low' && !!art.keys.elevation;
    const left = centreX - size / 2, top = centreY - size / 2;
    const ground = art.keys.ground ? this.scene.add.image(left, top, key('ground')).setOrigin(0).setDisplaySize(size, size)
      .setDepth(GROUND_DEPTH).setTint(GROUND_TINT) : null;
    const body = this.scene.add.image(left, top, key(lit ? 'albedo' : 'beauty')).setOrigin(0)
      .setDisplaySize(size, size).setDepth(BASE_FORT_DEPTH);
    const emission = art.layers.map((layer, index) => ({ layer, phase: index * .21,
      image: this.scene.add.image(left, top, key(`emission-${layer}`)).setOrigin(0).setDisplaySize(size, size)
        .setDepth(EMISSION_DEPTH).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0) }));
    const lights: FortView['lights'] = [], emitters: BaseFortEmitter[] = [];
    for (const [name, socket] of art.sockets) {
      const kind = EMITTER_KINDS.find(candidate => name.startsWith(candidate + '_'));
      if (kind) emitters.push({ kind, x: centreX + socket.x, y: centreY + socket.y });
      const rule = SOCKET_LIGHTS.find(candidate => name.startsWith(candidate.prefix + '_'));
      if (!rule) continue;
      lights.push({ key: `base-fort:${baseId}:${name}`, preset: rule.preset, day: rule.day, scale: rule.scale,
        x: centreX + socket.x, y: centreY + socket.y, phase: lights.length * .43 });
    }
    const stamp = { active: true, visible: true, alpha: 1, x: left, y: top, displayWidth: size, displayHeight: size,
      scaleX: size / art.sourceSize, scaleY: size / art.sourceSize, originX: 0, originY: 0, rotation: 0,
      texture: { key: key('solid') }, frame: { name: '__BASE' } };
    const mounted: FortMounted = { left, top, target: null, uniform: new Float32Array([art.deckPx, 0, MOUNTED_FLIP]) };
    this.views.set(baseId, { art, ground, body, emission, lights, stamp, emitters, cells, mounted, cellCount: cells.length,
      destroyedCells: 0, fx: this.particles?.(emitters) ?? null, heightWindows: null, plinths: new Map(), plinthKeys: [],
      relief: lit ? this.makeRelief(left, top, art) : null, shadow: lit ? this.makeShadow(left, top, mounted, art) : null });
  }

  /** One base cell exploded: the fort fades with the staggered destruction and is gone with the last. */
  destroyCell(baseId: string): void {
    const view = this.views.get(baseId);
    if (!view) return;
    view.destroyedCells = Math.min(view.cellCount, view.destroyedCells + 1);
    const remaining = 1 - view.destroyedCells / view.cellCount;
    const alpha = remaining <= 0 ? DESTROYED_ALPHA : .35 + .65 * remaining;
    view.body.setAlpha(alpha);
    if (remaining <= 0) {
      for (const object of [view.body, view.relief, view.shadow]) object?.setVisible(false);
      view.stamp.visible = false;
      for (const light of view.lights) this.lighting?.releaseLight(light.key, { immediate: true });
    }
  }

  remove(baseId: string): void {
    const view = this.views.get(baseId);
    if (!view) return;
    for (const light of view.lights) this.lighting?.releaseLight(light.key, { immediate: true });
    view.ground?.destroy(); view.body.destroy();
    this.destroyQuad(view.relief); this.destroyQuad(view.shadow);
    for (const { image } of view.emission) image.destroy();
    for (const plinth of view.plinths.values()) plinth.destroy();
    for (const key of view.plinthKeys) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    view.fx?.destroy();
    if (view.mounted.target) this.scene.textures.remove(view.mounted.target);
    for (const key of view.art.owned) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.views.delete(baseId);
  }

  setLighting(lighting: FortLighting | null): void {
    if (this.lighting && this.lighting !== lighting) for (const view of this.views.values()) {
      for (const light of view.lights) this.lighting.releaseLight(light.key, { immediate: true });
    }
    this.lighting = lighting;
  }

  /** Leaves the light map, e.g. while the World is not shown; the next update lights it again. */
  releaseLights(): void {
    for (const view of this.views.values()) for (const light of view.lights) this.lighting?.releaseLight(light.key, { immediate: true });
  }

  setShadows(shadows: FortShadows | null): void { this.shadows = shadows; }

  /** Torch flames, embers, smoke, moths and fireflies on the World's GPU particle backend. */
  setParticles(particles: BaseFortParticleFactory | null): void {
    if (particles === this.particles) return;
    this.particles = particles;
    for (const view of this.views.values()) {
      view.fx?.destroy();
      view.fx = particles?.(view.emitters) ?? null;
    }
  }

  /** Lent by the World sunlight owner while it presents this World; null when it leaves. */
  setSunlight(sunlight: LobbyStructureSunlight | null): void { this.sunlight = sunlight; }

  /** Solid geometry of every standing fort: the fog is cut on it, never on its ground layer. */
  *getFogSurfaces(): Iterable<FogSurfaceStamp> {
    for (const view of this.views.values()) if (view.stamp.visible) yield view.stamp;
  }

  /** Per frame: glow, particles, light-map lights, the shadow bearing and the turrets on the decks. */
  update(): void {
    const seconds = this.scene.time.now / 1000;
    this.shadows?.getLongCasterFrame(this.castFrame);
    const lighting = this.lighting;
    const night = lighting?.getArtificialLightFactor() ?? 0;
    const casters = this.casterScratch;
    casters.length = 0;
    this.shadows?.turretCasters.collect(casters);
    for (const view of this.views.values()) {
      view.shadow?.setVisible(this.castFrame.visible && view.destroyedCells < view.cellCount);
      const standing = view.destroyedCells < view.cellCount;
      this.syncPlinths(view, standing ? casters : EMPTY_CASTERS);
      if (view.shadow && standing) this.drawMounted(view, this.castFrame.visible ? casters : EMPTY_CASTERS);
      view.fx?.setActive(standing && lighting !== null);
      view.fx?.setNight(night);
      for (const glow of view.emission) {
        const look = LAYER_LOOK[glow.layer];
        const level = look.day + (look.night - look.day) * night;
        glow.image.setAlpha(standing && lighting ? emissiveAlpha(Math.min(1, level * flicker(seconds, look.hz, look.flicker, glow.phase))) : 0);
      }
      if (!lighting || !standing) continue;
      for (const light of view.lights) {
        const level = light.day + (1 - light.day) * night;
        const preset = LIGHT_PRESETS[light.preset];
        lighting.setLight(light.key, light.preset, light.x, light.y,
          { intensity: preset.intensity * level, radiusPx: preset.radiusPx * light.scale });
      }
    }
  }

  /** A stone plinth centred under every turret standing on one of this fort's cells. */
  private syncPlinths(view: FortView, casters: readonly MeshShadowCaster[]): void {
    const half = CELL_SIZE / 2, occupied = this.occupiedScratch;
    occupied.clear();
    for (const caster of casters) {
      if ((caster.getShadowReceiverPlane?.() ?? 0) !== 1) continue;
      const { x, y } = caster.sprite;
      const index = view.cells.findIndex(cell => Math.abs(cell.x - x) <= half && Math.abs(cell.y - y) <= half);
      if (index >= 0) occupied.add(index);
    }
    for (const [index, plinth] of view.plinths) plinth.setVisible(occupied.has(index));
    if (!occupied.size) return;
    view.heightWindows ??= this.heightWindows(view);
    for (const index of occupied) {
      if (view.plinths.has(index)) continue;
      const cell = view.cells[index], window = view.heightWindows[index];
      const key = window ? this.cutPlinth(view, index, window) : null;
      const size = (key ? PLINTH.sidePx : PLINTH.fallbackSidePx) / PLINTH.fill;
      view.plinths.set(index, this.scene.add.image(cell.x, cell.y, key ?? TURRET_PLINTH.textureKey)
        .setDisplaySize(size, size).setDepth(PLINTH_DEPTH));
    }
  }

  /**
   * The plinth of one cell as its own texture: the stone at source resolution with everything rising above the
   * deck there (stakes, posts) cut away softly, so the plinth reads as lying under the palisade's rim.
   */
  private cutPlinth(view: FortView, index: number, window: FortHeightWindow): string | null {
    const source = this.scene.textures.get(TURRET_PLINTH.textureKey).getSourceImage();
    if (!(source instanceof HTMLImageElement || source instanceof HTMLCanvasElement)) return null;
    const key = `base-fort-plinth:${view.stamp.x}:${view.stamp.y}:${index}`, size = source.width;
    if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    const texture = this.scene.textures.createCanvas(key, size, size);
    if (!texture) return null;
    texture.context.drawImage(source, 0, 0, size, size);
    const image = texture.context.getImageData(0, 0, size, size), cell = view.cells[index];
    const display = PLINTH.sidePx / PLINTH.fill, perPixel = display / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!image.data[i + 3]) continue;
      const cover = fortObstacleCover(window, view.art.heightPx, view.art.deckPx, PLINTH.risePx,
        cell.x - display / 2 + (x + .5) * perPixel, cell.y - display / 2 + (y + .5) * perPixel);
      if (cover > 0) image.data[i + 3] = Math.round(image.data[i + 3] * (1 - cover));
    }
    texture.context.putImageData(image, 0, 0);
    texture.refresh();
    view.plinthKeys.push(key);
    return key;
  }

  /** The caster heights around every cell: the core's grid, or for an outpost the kit frame each cell came from. */
  private heightWindows(view: FortView): (FortHeightWindow | null)[] {
    const art = view.art, core = art.keys['caster-height'];
    const whole = !art.cellHeights && core ? this.readPixels(core) : null;
    return view.cells.map((cell, index) => {
      if (whole) return { ...whole, left: view.mounted.left, top: view.mounted.top, texelPx: art.size / whole.width };
      if (!art.cellHeights) return null;
      const { key, frame, framePx } = art.cellHeights[index];
      const pixels = this.readPixels(key, frame);
      return pixels ? { ...pixels, left: cell.x - framePx / 2, top: cell.y - framePx / 2, texelPx: framePx / pixels.width } : null;
    });
  }

  /** RGBA of a loaded image texture (optionally one frame of it), or null where the CPU cannot read it. */
  private readPixels(key: string, frameName?: string): { data: Uint8ClampedArray; width: number; height: number } | null {
    if (!this.scene.textures.exists(key) || typeof document === 'undefined') return null;
    const texture = this.scene.textures.get(key), source = texture.getSourceImage();
    if (!(source instanceof HTMLImageElement || source instanceof HTMLCanvasElement)) return null;
    const frame = frameName ? texture.get(frameName) : null;
    const x = frame?.cutX ?? 0, y = frame?.cutY ?? 0, width = frame?.cutWidth ?? source.width, height = frame?.cutHeight ?? source.height;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(source, x, y, width, height, 0, 0, width, height);
    return { data: context.getImageData(0, 0, width, height).data, width, height };
  }

  /** Stamps the turrets standing on this fort's cells into its mounted height grid. */
  private drawMounted(view: FortView, casters: readonly MeshShadowCaster[]): void {
    const mounted = this.mountedScratch, half = CELL_SIZE / 2;
    mounted.length = 0;
    for (const caster of casters) {
      if ((caster.getShadowReceiverPlane?.() ?? 0) !== 1) continue;
      const { x, y } = caster.sprite;
      if (view.cells.some(cell => Math.abs(cell.x - x) <= half && Math.abs(cell.y - y) <= half)) mounted.push(caster);
    }
    const state = view.mounted;
    if (!mounted.length && !state.target) return;
    const texels = this.scene.textures.get(view.art.keys['caster-height']!).source[0].width;
    this.mountedHeights ??= new BaseFortMountedHeights(this.scene);
    if (!state.target) {
      state.target = this.mountedHeights.createTarget(texels);
      view.shadow!.textures[1] = state.target;
    }
    const any = this.mountedHeights.draw(state.target, state.left, state.top, view.art.size / texels, mounted);
    state.uniform[1] = any ? MOUNTED_HEIGHT_RANGE_PX : 0;
  }

  private makeRelief(left: number, top: number, art: FortArt): Phaser.GameObjects.Shader {
    const asset = art, size = art.size;
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name: 'LobbyStructureRelief', shaderName: 'LobbyStructureRelief', fragmentSource: LOBBY_STRUCTURE_RELIEF_FRAGMENT,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        const sunlight = this.sunlight;
        setCloudUniforms(set, sunlight?.clouds);
        set('uElevation', 0); set('uMineralResponse', 0); set('uFineMineral', 0);
        this.canvasUniform[0] = left; this.canvasUniform[1] = top; this.canvasUniform[2] = size; this.canvasUniform[3] = 0;
        set('uCanvas', this.canvasUniform);
        this.heightUniform[0] = asset.heightPx.min; this.heightUniform[1] = asset.heightPx.max;
        set('uHeight', this.heightUniform);
        set('uSun', sunlight?.state.sun ?? [0, 0, 1]);
        this.optionsUniform[0] = sunlight?.state.enabled ? sunlight.clouds.strength : 0;
        set('uOptions', this.optionsUniform);
        const lights = sunlight ? sunlight.surfaceLights(left, top, size, size, this.surfaceLights) : null;
        setSurfaceLightUniforms(set, lights, sunlight?.moon ?? null, sunlight?.clouds.quality?.surfaceLights);
      },
    }, left, top, size, size, [this.scene.textures.get(art.keys.elevation!)]);
    return this.scene.add.existing(quad).setOrigin(0).setDepth(RELIEF_DEPTH).setBlendMode(Phaser.BlendModes.MULTIPLY);
  }

  private makeShadow(left: number, top: number, mounted: FortMounted, art: FortArt): Phaser.GameObjects.Shader {
    const asset = art, size = art.size, reach = STRUCTURE_SHADOW.maxReachPx;
    const quadLeft = left - reach, quadTop = top - reach, quadSize = size + reach * 2;
    const caster = this.scene.textures.get(art.keys['caster-height']!);
    const casterTexels = caster.source[0].width;
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name: 'LobbyStructureShadow', shaderName: 'LobbyStructureShadow', fragmentSource: LOBBY_STRUCTURE_SHADOW_FRAGMENT,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        const frame = this.castFrame;
        set('uCaster', 0);
        set('uTexels', casterTexels);
        set('uMountedCaster', 1); set('uMounted', mounted.uniform);
        this.canvasUniform[0] = left; this.canvasUniform[1] = top; this.canvasUniform[2] = size; this.canvasUniform[3] = 0;
        set('uCanvas', this.canvasUniform);
        this.heightUniform[0] = asset.heightPx.min; this.heightUniform[1] = asset.heightPx.max;
        set('uHeight', this.heightUniform);
        this.quadUniform[0] = quadLeft; this.quadUniform[1] = quadTop; this.quadUniform[2] = quadSize; this.quadUniform[3] = quadSize;
        set('uQuad', this.quadUniform);
        this.castUniform[0] = frame.x; this.castUniform[1] = frame.y; this.castUniform[2] = frame.lengthMult;
        this.castUniform[3] = Math.min(reach, asset.heightPx.max * frame.lengthMult);
        set('uCast', this.castUniform);
        this.shadeUniform[0] = FORT_SHADOW.opacity * frame.opacityMult;
        this.shadeUniform[1] = STRUCTURE_SHADOW.softnessPx * FORT_SHADOW.softness * frame.softnessMult;
        set('uShade', this.shadeUniform);
      },
    }, quadLeft, quadTop, quadSize, quadSize, [caster, this.scene.textures.get('__DEFAULT')]);
    return this.scene.add.existing(quad).setOrigin(0).setDepth(STRUCTURE_SHADOW.layerDepth).setBlendMode(Phaser.BlendModes.MULTIPLY);
  }

  private destroyQuad(quad: Phaser.GameObjects.Shader | null): void {
    if (!quad) return;
    // Phaser 4.2.1 Shader.preDestroy omits its private VAOs and vertex buffer (as in LobbyStructureRenderer).
    const node = quad.renderNode;
    if (node?.programManager) {
      for (const suite of Object.values(node.programManager.programs)) {
        Phaser.Utils.Array.Remove(node.renderer.glVAOWrappers, suite.vao); suite.vao.destroy();
      }
      node.programManager.programs = {}; node.renderer.deleteBuffer(node.vertexBufferLayout.buffer);
    }
    quad.destroy();
  }

  destroy(): void {
    for (const id of [...this.views.keys()]) this.remove(id);
    this.mountedHeights?.destroy(); this.mountedHeights = null;
    this.lighting = null; this.shadows = null; this.sunlight = null; this.particles = null;
  }
}
