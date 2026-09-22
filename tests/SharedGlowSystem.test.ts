import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => {
  class Rectangle {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
  }
  class Image {
    type = 'Image'; active = true; visible = true; alpha = 1; cameraFilter = 0;
    scaleX = 1; scaleY = 1; scrollFactorX = 1; scrollFactorY = 1;
    flipX = false; flipY = false; isCropped = false;
    width = 20; height = 20; originX = 0.5; originY = 0.5; displayOriginX = 10; displayOriginY = 10;
    frame = { source: { resolution: 1 }, customPivot: false, realWidth: 20, realHeight: 20 };
    customRenderNodes: Record<string, unknown> = {};
    _renderSteps = [this.renderWebGL];
    parentContainer: { active?: boolean; visible?: boolean; alpha?: number; cameraFilter?: number; parentContainer?: unknown } | null = null;
    filters: { internal: { addBlur: (...args: unknown[]) => { active: boolean } } } | null = null;
    bounds: Rectangle;
    private listeners = new Set<() => void>();
    constructor(public scene: unknown, x = 0, y = 0, public key = '') { this.bounds = new Rectangle(x, y, 20, 20); }
    // Phaser supplies world bounds, including parent transforms; this fixture controls that output.
    getBounds(out: Rectangle) { return Object.assign(out, this.bounds); }
    renderWebGL() {}
    renderWebGLStep() {}
    setOrigin(x = 0.5, y = x) {
      this.originX = x; this.originY = y;
      this.displayOriginX = x * this.width; this.displayOriginY = y * this.height;
      return this;
    }
    setSize(width: number, height: number) { this.width = width; this.height = height; return this; }
    setDisplaySize() { return this; }
    setScrollFactor(x: number, y = x) { this.scrollFactorX = x; this.scrollFactorY = y; return this; }
    setDepth() { return this; }
    setBlendMode() { return this; }
    setVisible(visible: boolean) { this.visible = visible; return this; }
    enableFilters() {
      this._renderSteps.unshift(() => {});
      this.filters = { internal: { addBlur: () => ({ active: true }) } };
      return this;
    }
    once(_event: string, listener: () => void) { this.listeners.add(listener); return this; }
    off(_event: string, listener: () => void) { this.listeners.delete(listener); return this; }
    destroy() { this.active = this.visible = false; for (const listener of [...this.listeners]) listener(); }
  }
  class Sprite extends Image { type = 'Sprite'; }
  class Container {
    alpha = 1; visible = true; cameraFilter = 0; parentContainer: Container | null = null;
    getWorldTransformMatrix() { return {}; }
    getBoundsTransformMatrix() { return this.getWorldTransformMatrix(); }
  }
  return {
    GameObjects: { Image, Sprite, Container, Events: { DESTROY: 'destroy' } },
    Geom: { Rectangle }, Textures: { FilterMode: { LINEAR: 1 } }, BlendModes: { ADD: 1 },
    Scenes: { Events: { POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
  };
});
import * as Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../src/config';
import { SharedGlowSystem } from '../src/effects/SharedGlowSystem';
import { ClarityCameraRegistry } from '../src/scenes/arena/ClarityCameraRegistry';
import {
  GRAPHICS_QUALITY_PROFILES,
  GraphicsQualityController,
} from '../src/graphics/GraphicsQuality';
import {
  canUseSharedGlow,
  isSharedGlowTargetVisible,
  resolveSharedGlowAlpha,
  resolveSharedGlowBandWeights,
  resolveSharedGlowTargetAlpha,
} from '../src/effects/sharedGlowModel';

describe('shared glow model', () => {
  it('maps glow distances into the two shared bands', () => {
    expect(resolveSharedGlowBandWeights(6)).toEqual({ near: 1, far: 0 });
    expect(resolveSharedGlowBandWeights(11)).toEqual({ near: 7 / 12, far: 0.5 });
    expect(resolveSharedGlowBandWeights(16)).toEqual({ near: 1 / 6, far: 1 });
    expect(resolveSharedGlowBandWeights(100)).toEqual({ near: 0, far: 1 });
  });

  it('keeps source alpha bounded and proportional to outer strength', () => {
    expect(resolveSharedGlowAlpha(-1)).toBe(0);
    expect(resolveSharedGlowAlpha(0)).toBe(0);
    expect(resolveSharedGlowAlpha(2)).toBeCloseTo(0.36);
    expect(resolveSharedGlowAlpha(100)).toBe(1);
  });

  it('ignores hidden or transparent parent containers', () => {
    const hiddenParent = { visible: false, alpha: 1, parentContainer: null };
    const target = { visible: true, active: true, alpha: 1, parentContainer: hiddenParent };
    expect(isSharedGlowTargetVisible(target)).toBe(false);

    hiddenParent.visible = true;
    hiddenParent.alpha = 0;
    expect(isSharedGlowTargetVisible(target)).toBe(false);
    expect(resolveSharedGlowTargetAlpha(target)).toBe(0);
  });

  it('preserves the effective alpha of nested capture targets', () => {
    const target = {
      alpha: 0.8,
      parentContainer: { alpha: 0.5, parentContainer: null },
    };
    expect(resolveSharedGlowTargetAlpha(target)).toBeCloseTo(0.4);
  });

  it('only accepts outer-only non-knockout glows', () => {
    expect(canUseSharedGlow(0, false)).toBe(true);
    expect(canUseSharedGlow(-0.1, false)).toBe(true);
    expect(canUseSharedGlow(0.01, false)).toBe(false);
    expect(canUseSharedGlow(0, true)).toBe(false);
  });
});

describe('shared glow quality policy', () => {
  it('keeps high and medium on the shared path while low keeps only critical glow', () => {
    expect(GRAPHICS_QUALITY_PROFILES.high.sharedGlow).toMatchObject({
      enabled: true,
      bufferScale: 1,
      importance: { critical: true, standard: true, decorative: true },
    });
    expect(GRAPHICS_QUALITY_PROFILES.medium.sharedGlow).toMatchObject({
      enabled: true,
      bufferScale: 0.5,
      importance: { critical: true, standard: true, decorative: true },
    });
    expect(GRAPHICS_QUALITY_PROFILES.low.sharedGlow).toMatchObject({
      enabled: true,
      bufferScale: 0.25,
      importance: { critical: true, standard: false, decorative: false },
      far: null,
    });
  });

  it('applies runtime quality and filter ablation to shared handles', () => {
    const controller = new GraphicsQualityController('high');
    const target = { once: vi.fn(), off: vi.fn() };
    const handle = { active: false, setActive: vi.fn(function setActive(active: boolean) {
      handle.active = active;
      return handle;
    }) };

    controller.trackSharedGlow(target, handle, 'standard');
    expect(handle.active).toBe(true);

    controller.setLevel('low');
    expect(handle.active).toBe(false);
    controller.setLevel('medium');
    expect(handle.active).toBe(true);
    controller.setAblationFiltersDisabled(true);
    expect(handle.active).toBe(false);
    controller.setAblationFiltersDisabled(false);
    expect(handle.active).toBe(true);
  });
});

interface CaptureTarget extends Phaser.GameObjects.Image {
  bounds: { x: number; y: number; width: number; height: number };
  key: string;
}
type Capture = { target: CaptureTarget; config: { transform: string; alpha: number; tint: number } };

/** Queued clears/captures make stale pixels and empty-frame work observable without WebGL. */
function queuedTexture(key: string, width: number, height: number) {
  const commands: ('clear' | Capture)[] = [];
  const pixels: Capture[] = [];
  const camera = {
    scrollX: 0, scrollY: 0, zoom: 1,
    setOrigin() {}, setRotation() {},
    setZoom(zoom: number) { this.zoom = zoom; },
    setScroll(x: number, y: number) { this.scrollX = x; this.scrollY = y; },
  };
  return {
    key, width, height, commands, pixels, camera, clears: 0, renders: 0,
    setFilter() {},
    clear() { this.clears++; commands.push('clear'); return this; },
    capture(target: CaptureTarget, config: Capture['config']) { commands.push({ target, config }); return this; },
    render() {
      this.renders++;
      for (const command of commands) {
        if (command === 'clear') pixels.length = 0;
        else pixels.push(command);
      }
      commands.length = 0;
      return this;
    },
  };
}

function glowHarness() {
  const textures = new Map<string, ReturnType<typeof queuedTexture>>();
  const images: CaptureTarget[] = [];
  const world = { id: 1, scrollX: 0, scrollY: 0 };
  const scene = {
    sys: { renderer: { gl: {} } }, cameras: { main: world },
    events: { on() {}, once() {}, off() {} },
    textures: {
      addDynamicTexture(key: string, width: number, height: number) {
        const texture = queuedTexture(key, width, height); textures.set(key, texture); return texture;
      },
      remove(key: string) { textures.delete(key); },
    },
    add: {
      particles() {},
      image(x: number, y: number, key: string) {
        const image = new Phaser.GameObjects.Image(scene as never, x, y, key) as CaptureTarget;
        images.push(image); return image;
      },
    },
  };
  const typedScene = scene as unknown as Phaser.Scene;
  const quality = new GraphicsQualityController('high');
  quality.attach(typedScene);
  new ClarityCameraRegistry(typedScene, world as never, { id: 2 } as never);
  const system = new SharedGlowSystem(typedScene);
  const band = (mode: 'world' | 'clarity', name: 'near' | 'far') => {
    const texture = [...textures.values()].find(item => item.key.endsWith(`_${mode}_${name}`))!;
    return { texture, image: images.findLast(item => item.key === texture.key)! };
  };
  const target = (x = 50, y = 50, sprite = false) => new (sprite ? Phaser.GameObjects.Sprite : Phaser.GameObjects.Image)(
    typedScene, x, y, 'source',
  ) as CaptureTarget;
  const container = () => new Phaser.GameObjects.Container(typedScene);
  const add = (source: CaptureTarget, distance = 6) => system.add({
    target: source, distance, color: 0xabcdef, outerStrength: 1, innerStrength: 0,
    knockout: false, importance: 'critical',
  })!;
  const resetCounts = () => { for (const texture of textures.values()) texture.clears = texture.renders = 0; };
  resetCounts();
  return { system, quality, textures, images, world, band, target, container, add, resetCounts };
}

describe('shared glow captures', () => {
  it('does no clear/render work for empty bands and clears stale pixels before re-entry', () => {
    const h = glowHarness();
    h.system.flush();
    expect([...h.textures.values()].every(texture => texture.clears === 0 && texture.renders === 0)).toBe(true);
    const first = h.target(), second = h.target(80);
    const a = h.add(first), b = h.add(second);
    h.system.flush();
    const near = h.band('world', 'near');
    expect(near.texture.pixels.map(pixel => pixel.target)).toEqual([first, second]);
    expect([near.texture.clears, near.texture.renders, near.image.visible]).toEqual([1, 1, true]);
    expect(h.band('world', 'far').texture.renders).toBe(0);
    a.setActive(false); b.destroy(); h.resetCounts();
    for (let frame = 0; frame < 3; frame++) h.system.flush();
    expect(near.image.visible).toBe(false);
    expect([near.texture.clears, near.texture.renders, near.texture.commands.length]).toEqual([0, 0, 0]);
    a.setActive(true); h.system.flush();
    expect(near.texture.pixels.map(pixel => pixel.target)).toEqual([first]);
    expect([near.texture.clears, near.texture.renders, near.image.visible]).toEqual([1, 1, true]);
    h.system.destroy();
  });

  it('keeps bands independent and refreshes tint and nested alpha on each visible frame', () => {
    const h = glowHarness(), nearSource = h.target(), farSource = h.target(100);
    nearSource.alpha = 0.8;
    const parent = h.container(); parent.alpha = 0.5; parent.cameraFilter = 2;
    nearSource.parentContainer = parent;
    const nearHandle = h.add(nearSource), farHandle = h.add(farSource, 100);
    h.system.flush();
    const near = h.band('world', 'near'), far = h.band('world', 'far');
    expect(near.texture.pixels[0].config).toEqual({ transform: 'world', alpha: 0.18 * 0.8 * 0.5, tint: 0xabcdef });
    parent.visible = false; farHandle.outerStrength = 0; h.resetCounts(); h.system.flush();
    expect([near.image.visible, far.image.visible]).toEqual([false, false]);
    expect([...h.textures.values()].every(texture => texture.renders === 0)).toBe(true);
    parent.visible = true; nearHandle.color = 0x123456; farHandle.outerStrength = 2;
    h.system.flush();
    expect(near.texture.pixels[0].config.tint).toBe(nearHandle.color);
    expect(far.texture.pixels[0].config.alpha).toBe(resolveSharedGlowAlpha(farHandle.outerStrength));
    nearSource.destroy(); farHandle.setActive(false); h.system.flush();
    expect([near.image.visible, far.image.visible]).toEqual([false, false]);
    h.system.destroy();
  });

  it('retains crossing edges and excludes distant standard Image/Sprite quads', () => {
    const h = glowHarness();
    const sources = [h.target(-10), h.target(GAME_WIDTH - 10), h.target(50, -10), h.target(50, GAME_HEIGHT - 10, true)];
    const outside = [h.target(-100), h.target(GAME_WIDTH + 100), h.target(50, -100), h.target(50, GAME_HEIGHT + 100, true)];
    for (const source of [...sources, ...outside]) h.add(source);
    h.system.flush();
    const near = h.band('world', 'near');
    expect(near.texture.pixels.map(pixel => pixel.target)).toEqual(sources);
    for (const source of sources) source.bounds.x = GAME_WIDTH + 100;
    h.resetCounts(); h.system.flush();
    expect([near.image.visible, near.texture.renders]).toEqual([false, 0]);
    outside[0].bounds.x = 20; h.system.flush();
    expect(near.texture.pixels.map(pixel => pixel.target)).toEqual([outside[0]]);
    h.system.destroy();
  });

  it('uses target parallax for world captures and root camera routing for nested clarity targets', () => {
    const h = glowHarness(); h.world.scrollX = 10_000; h.world.scrollY = 20_000;
    const worldSources = [h.target(10_030, 20_030), h.target(5_030, 10_030, true), h.target(30, 30)];
    worldSources[1].setScrollFactor(0.5); worldSources[2].setScrollFactor(0);
    const clarity = h.target(40, 40);
    clarity.parentContainer = h.container(); clarity.parentContainer.cameraFilter = 1;
    const outsideWorld = h.target(30, 30), outsideClarity = h.target(10_030, 20_030);
    outsideClarity.cameraFilter = 1;
    for (const source of [...worldSources, clarity, outsideWorld, outsideClarity]) h.add(source);
    h.system.flush();
    expect(h.band('world', 'near').texture.pixels.map(pixel => pixel.target)).toEqual(worldSources);
    expect(h.band('clarity', 'near').texture.pixels.map(pixel => pixel.target)).toEqual([clarity]);
    expect(h.band('world', 'near').texture.camera).toMatchObject({ scrollX: 10_000, scrollY: 20_000 });
    expect(h.band('clarity', 'near').texture.camera).toMatchObject({ scrollX: 0, scrollY: 0 });
    h.system.destroy();
  });

  it.each(['high', 'medium', 'low'] as const)('retains a subpixel outside edge at %s capture resolution', quality => {
    const h = glowHarness(); h.quality.setLevel(quality);
    const fractionOfPixel = 0.4 / h.quality.getProfile().sharedGlow.bufferScale;
    const sources = [h.target(-20 - fractionOfPixel), h.target(GAME_WIDTH + fractionOfPixel)];
    for (const source of sources) h.add(source);
    h.system.flush();
    expect(h.band('world', 'near').texture.pixels.map(pixel => pixel.target)).toEqual(sources);
    h.system.destroy();
  });

  it('captures a quad whose logical size gives it a different display origin than its bounds', () => {
    const h = glowHarness(), source = h.target(GAME_WIDTH + 1000);
    source.setSize(source.frame.realWidth * 3, source.frame.realHeight * 4).setOrigin(0.25, 0.75);
    h.add(source); h.system.flush();
    expect(h.band('world', 'near').texture.pixels.map(pixel => pixel.target)).toEqual([source]);
    source.setSize(source.frame.realWidth, source.frame.realHeight).setOrigin(0.25, 0.75);
    h.system.flush();
    expect(h.band('world', 'near').image.visible).toBe(false);
    h.system.destroy();
  });

  it.each(['getBoundsTransformMatrix', 'getWorldTransformMatrix'] as const)(
    'retains the fallback when an ancestor customizes %s', method => {
      const h = glowHarness(), source = h.target(GAME_WIDTH + 1000);
      source.parentContainer = h.container();
      const ancestor = h.container(); source.parentContainer.parentContainer = ancestor;
      h.add(source); h.system.flush();
      expect(h.band('world', 'near').image.visible).toBe(false);
      const original = ancestor[method];
      ancestor[method] = () => ({} as never);
      h.system.flush();
      expect(h.band('world', 'near').texture.pixels.map(pixel => pixel.target)).toEqual([source]);
      ancestor[method] = original; h.system.flush();
      expect(h.band('world', 'near').image.visible).toBe(false);
      h.system.destroy();
    },
  );

  it.each(['unknown', 'filters', 'negative-scale', 'custom-pivot', 'cropped', 'resolution', 'custom-node', 'custom-step', 'custom-bounds', 'custom-renderer', 'nonfinite'])(
    'retains the capture fallback for %s geometry', kind => {
      const h = glowHarness(), source = h.target(GAME_WIDTH + 1000);
      if (kind === 'unknown') source.type = 'CustomEffect';
      if (kind === 'filters') source.enableFilters();
      if (kind === 'negative-scale') source.scaleX = -1;
      if (kind === 'custom-pivot') { source.frame.customPivot = true; source.flipX = true; }
      if (kind === 'cropped') source.isCropped = true;
      if (kind === 'resolution') source.frame.source.resolution = 0.5;
      if (kind === 'custom-node') source.customRenderNodes.Transformer = {} as never;
      if (kind === 'custom-step') (source as unknown as { _renderSteps: unknown[] })._renderSteps.push(() => {});
      if (kind === 'custom-bounds') source.getBounds = (() => new Phaser.Geom.Rectangle(GAME_WIDTH + 1000, 0, 20, 20)) as typeof source.getBounds;
      if (kind === 'custom-renderer') source.renderWebGLStep = () => {};
      if (kind === 'nonfinite') source.bounds.x = NaN;
      h.add(source); h.system.flush();
      expect(h.band('world', 'near').texture.pixels.map(pixel => pixel.target)).toEqual([source]);
      h.system.destroy();
    },
  );

  it('rebuilds empty buffers across quality changes and captures fresh content on return', () => {
    const h = glowHarness(), source = h.target(); h.add(source, 11); h.system.flush();
    const oldTextures = [...h.textures.values()], oldImages = [...h.images];
    source.visible = false; h.quality.setLevel('low'); h.resetCounts(); h.system.flush();
    expect(oldImages.every(image => !image.active)).toBe(true);
    expect([...h.textures.values()].every(texture => !oldTextures.includes(texture) && texture.renders === 0)).toBe(true);
    expect([...h.textures.keys()].some(key => key.endsWith('_far'))).toBe(false);
    source.visible = true; h.system.flush();
    expect(h.band('world', 'near').texture.pixels.map(pixel => pixel.target)).toEqual([source]);
    h.quality.setLevel('medium'); h.resetCounts(); h.system.flush();
    for (const name of ['near', 'far'] as const) {
      const band = h.band('world', name);
      expect(band.texture.pixels.map(pixel => pixel.target)).toEqual([source]);
      expect([band.texture.clears, band.texture.renders, band.image.visible]).toEqual([1, 1, true]);
      expect(band.texture.width).toBe(Math.ceil(GAME_WIDTH * h.quality.getProfile().sharedGlow.bufferScale));
    }
    h.system.destroy();
  });
});
