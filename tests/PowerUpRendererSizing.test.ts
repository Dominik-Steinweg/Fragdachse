import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { ADD: 1 },
  GameObjects: { Events: { DESTROY: 'destroy' } },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    FloatBetween: (min: number, max: number) => (min + max) / 2,
  },
}));
vi.mock('../src/effects/EffectUtils', () => ({
  configureAdditiveImage: (image: unknown) => image,
  createEmitter: vi.fn(() => ({ explode: vi.fn() })),
  destroyEmitter: vi.fn(),
  ensureCanvasTexture: vi.fn(),
  fillRadialGradientTexture: vi.fn(),
  registerGraphicsObject: vi.fn(),
  setCircleEmitZone: vi.fn(),
  mixColors: vi.fn(() => 0xffffff),
}));
// Display prefiltering needs a DOM canvas; the renderer contract only needs the returned key.
vi.mock('../src/powerups/PowerUpItemArt', () => ({
  ensurePowerUpDisplayTexture: (_scene: unknown, key: string) => key + '@display',
}));
// Pedestal and item decoration GPU layers are covered separately; this test exercises the items.
vi.mock('../src/powerups/PowerUpPedestalGpuSystem', () => ({
  PowerUpPedestalGpuSystem: class { clear() {} destroy() {} },
}));
const itemGpu = vi.hoisted(() => ({ upsert: vi.fn(), remove: vi.fn(), clear: vi.fn(), destroy: vi.fn(), setEmissiveAlpha: vi.fn() }));
vi.mock('../src/powerups/PowerUpItemGpuSystem', () => ({
  PowerUpItemGpuSystem: class {
    upsert = itemGpu.upsert; remove = itemGpu.remove; clear = itemGpu.clear;
    destroy = itemGpu.destroy; setEmissiveAlpha = itemGpu.setEmissiveAlpha;
  },
}));

import { PowerUpRenderer, powerUpSymbolFrame } from '../src/powerups/PowerUpRenderer';
import { createEmitter, destroyEmitter } from '../src/effects/EffectUtils';
import {
  POWERUP_DEFS,
  POWERUP_ITEM_ART,
  POWERUP_RENDER_SIZE,
  POWERUP_SYMBOL_PULSE,
} from '../src/powerups/PowerUpConfig';
import {
  POWERUP_ASSETS, POWERUP_LOOP_ASSETS, POWERUP_TOKEN_KEY, assertPowerUpAssetsReady, powerUpSymbolArt, preloadPowerUpAssets,
} from '../src/assets/PowerUpAssets';
import { DAWN_PIPELINE_ASSETS, DAWN_SCRAP_DISPLAY_SIZE, isDawnScrapTexture } from '../src/assets/DawnAssets';
import { preloadTurretVisualAssets, registerTurretAnimations } from '../src/config/turretVisuals';

class DisplayObject {
  destroyed = false;
  x = 0;
  y = 0;
  scaleX = 1;
  scaleY = 1;
  alpha = 1;
  tint: number | null = null;
  frame: number | string = 0;
  children: DisplayObject[] = [];
  parent: DisplayObject | null = null;
  private destroyListeners: Array<() => void> = [];
  constructor(readonly width: number, readonly height: number, readonly key = '') {}
  get displayWidth() { return this.width * this.scaleX; }
  get displayHeight() { return this.height * this.scaleY; }
  setScale(x: number, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setDisplaySize(w: number, h: number) { return this.setScale(w / this.width, h / this.height); }
  setAlpha(value: number) { this.alpha = value; return this; }
  setDepth() { return this; }
  setTint(value: number) { this.tint = value; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setFrame(frame: number | string) { this.frame = frame; return this; }
  once(_event: string, listener: () => void) { this.destroyListeners.push(listener); return this; }
  add(child: DisplayObject) { child.parent = this; this.children.push(child); return this; }
  addAt(child: DisplayObject, index: number) { child.parent = this; this.children.splice(index, 0, child); return this; }
  destroy(children = false) {
    if (this.destroyed) return;
    this.destroyed = true;
    if (children) this.children.forEach(child => child.destroy(true));
    this.destroyListeners.splice(0).forEach(listener => listener());
  }
}

interface TweenConfig {
  targets: DisplayObject | { value: number };
  onUpdate?: () => void;
  onComplete?: () => void;
}

function makeScene(sourceSize = 256) {
  const objects: DisplayObject[] = [];
  const tweens: Array<TweenConfig & { stop: ReturnType<typeof vi.fn> }> = [];
  const timers: Array<{ callback: () => void; remove: ReturnType<typeof vi.fn> }> = [];
  const scene = {
    add: {
      container: (x: number, y: number, children: DisplayObject[] = []) => {
        const object = new DisplayObject(1, 1).setPosition(x, y);
        children.forEach(child => object.add(child)); objects.push(object); return object;
      },
      image: (x: number, y: number, key: string) => {
        const object = new DisplayObject(sourceSize, sourceSize, key).setPosition(x, y); objects.push(object); return object;
      },
    },
    tweens: { add: (config: TweenConfig) => {
      const tween = { ...config, stop: vi.fn() }; tweens.push(tween); return tween;
    } },
    time: { delayedCall: (_delay: number, callback: () => void) => {
      const timer = { callback, remove: vi.fn() }; timers.push(timer); return timer;
    } },
    textures: { exists: () => true },
  };
  return { scene, objects, tweens, timers };
}

const tokenDefs = Object.values(POWERUP_DEFS).filter(def => def.spriteKey && !isDawnScrapTexture(def.spriteKey));

describe('PowerUpRenderer item presentation', () => {
  it('gives every layered power-up the shared token and a hovering symbol driven only by the World clock', () => {
    const { scene, objects } = makeScene();
    itemGpu.upsert.mockClear();
    const renderer = new PowerUpRenderer(scene as never);
    const pickups = tokenDefs.map((def, uid) => ({ uid, defId: def.id, x: 100 + uid * 40, y: 200 }));
    renderer.sync(pickups);

    const tokens = objects.filter(object => object.key === POWERUP_TOKEN_KEY + '@display');
    expect(tokens).toHaveLength(pickups.length);
    expect(itemGpu.upsert).toHaveBeenCalledTimes(pickups.length);
    const symbolKey = (uid: number) => {
      const art = powerUpSymbolArt(POWERUP_DEFS[pickups[uid].defId].spriteKey!)!;
      return art.frames > 1 ? art.key : art.key + '@display';
    };
    const symbolsFor = (uid: number) => objects.filter(object => object.key === symbolKey(uid));
    for (const pickup of pickups) {
      const [shadow, symbol] = symbolsFor(pickup.uid);
      expect(shadow.tint).toBe(0x000000);
      expect(symbol.tint).toBeNull();
    }

    const revealed = POWERUP_ITEM_ART.revealMs + 250;
    const snapshot = (time: number) => {
      renderer.updatePresentation(time);
      return pickups.map(pickup => {
        const [, symbol] = symbolsFor(pickup.uid);
        return { width: symbol.displayWidth, lift: pickup.y - symbol.y, alpha: symbol.alpha };
      });
    };
    const initial = snapshot(revealed);
    expect(snapshot(revealed)).toEqual(initial);
    expect(snapshot(revealed + POWERUP_SYMBOL_PULSE.periodMs)).toEqual(initial);
    expect(new Set(initial.map(item => item.width)).size).toBeGreaterThan(1);
    const amplitude = POWERUP_SYMBOL_PULSE.amplitude;
    for (const item of snapshot(revealed + 300)) {
      expect(item.alpha).toBe(1);
      expect(item.width).toBeGreaterThanOrEqual(POWERUP_RENDER_SIZE * POWERUP_ITEM_ART.symbolScale * (1 - amplitude) - 1e-9);
      expect(item.width).toBeLessThanOrEqual(POWERUP_RENDER_SIZE * POWERUP_ITEM_ART.symbolScale * (1 + amplitude) + 1e-9);
      expect(item.lift).toBeGreaterThanOrEqual(POWERUP_ITEM_ART.hoverPx - POWERUP_ITEM_ART.hoverAmplitudePx - 1e-9);
      expect(item.lift).toBeLessThanOrEqual(POWERUP_ITEM_ART.hoverPx + POWERUP_ITEM_ART.hoverAmplitudePx + 1e-9);
    }
    for (const token of tokens) {
      expect(token.displayWidth).toBeCloseTo(POWERUP_RENDER_SIZE);
      expect(token.alpha).toBe(1);
    }

    // Symbol and its shadow always show the same loop frame, chosen by the World clock alone.
    for (const time of [revealed + 1_000, revealed + 1_083, revealed + 2_400]) {
      renderer.updatePresentation(time);
      for (const pickup of pickups) {
        const [shadow, symbol] = symbolsFor(pickup.uid);
        const art = powerUpSymbolArt(POWERUP_DEFS[pickup.defId].spriteKey!)!;
        expect(symbol.frame).toBe(powerUpSymbolFrame(art, pickup.uid, time));
        expect(shadow.frame).toBe(symbol.frame);
      }
    }

    // A snapshot resend neither restarts the reveal nor moves the pulse.
    const before = snapshot(revealed + 300);
    renderer.sync(pickups);
    expect(snapshot(revealed + 300)).toEqual(before);
  });

  it('reveals from above the token and stays within its display box while materializing', () => {
    const { scene, objects } = makeScene(16);
    const renderer = new PowerUpRenderer(scene as never);
    renderer.updatePresentation(1_000);
    renderer.sync([{ uid: 3, defId: 'HEALTH_PACK', x: 50, y: 60 }]);
    const token = objects.find(object => object.key === POWERUP_TOKEN_KEY + '@display')!;
    const [, symbol] = objects.filter(object => object !== token);
    let previousLift = Infinity;
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      renderer.updatePresentation(1_000 + progress * POWERUP_ITEM_ART.revealMs);
      expect(token.displayWidth).toBeLessThanOrEqual(POWERUP_RENDER_SIZE * 1.03);
      const lift = 60 - symbol.y;
      expect(lift).toBeLessThanOrEqual(previousLift + POWERUP_ITEM_ART.hoverAmplitudePx);
      previousLift = lift;
    }
    expect(symbol.alpha).toBe(1);
  });

  it('turns a collected symbol into short feedback and releases everything on removal and teardown', () => {
    const { scene, objects } = makeScene();
    itemGpu.remove.mockClear(); itemGpu.clear.mockClear();
    const renderer = new PowerUpRenderer(scene as never);
    renderer.updatePresentation(2_000);
    renderer.sync([{ uid: 1, defId: 'RAGE', x: 10, y: 10 }]);
    const [token, shadow, symbol] = objects;
    renderer.sync([]);
    expect(itemGpu.remove).toHaveBeenCalledWith(1);
    expect(token.destroyed).toBe(true);
    expect(shadow.destroyed).toBe(true);
    expect(symbol.destroyed).toBe(false);
    renderer.updatePresentation(2_000 + POWERUP_ITEM_ART.collectMs / 2);
    expect(symbol.alpha).toBeLessThan(1);
    renderer.updatePresentation(2_000 + POWERUP_ITEM_ART.collectMs + 1);
    expect(symbol.destroyed).toBe(true);

    // World teardown removes lying items and pending feedback silently.
    renderer.sync([{ uid: 2, defId: 'NUKE', x: 10, y: 10 }]);
    renderer.sync([]);
    renderer.sync([{ uid: 4, defId: 'BFG', x: 30, y: 10 }]);
    renderer.clear();
    expect(objects.every(object => object.destroyed)).toBe(true);
    expect(itemGpu.clear).toHaveBeenCalled();
  });

  it('keeps scrap on its own art and releases its materialization effects on removal and teardown', () => {
    const { scene, objects, tweens, timers } = makeScene();
    vi.mocked(createEmitter).mockClear();
    vi.mocked(destroyEmitter).mockClear();
    const renderer = new PowerUpRenderer(scene as never);
    const scrapDef = Object.values(POWERUP_DEFS).find(def => def.type === 'dawn_scrap')!;
    const pickup = { uid: 1, defId: scrapDef.id, x: 100, y: 100 };
    renderer.sync([pickup]);
    const image = objects.find(object => object.key === scrapDef.spriteKey)!;
    expect(objects.some(object => object.key.startsWith(POWERUP_TOKEN_KEY))).toBe(false);
    const reveal = tweens.find(tween => 'value' in tween.targets)!;
    reveal.onComplete?.();
    expect(image.displayWidth).toBe(DAWN_SCRAP_DISPLAY_SIZE);
    const emitters = vi.mocked(createEmitter).mock.results.map(result => result.value);
    expect(emitters).toHaveLength(2);

    renderer.sync([]);
    expect(reveal.stop).toHaveBeenCalledOnce();
    renderer.clear();
    expect(objects.every(object => object.destroyed)).toBe(true);
    expect(timers[0].remove).toHaveBeenCalledWith(false);
    for (const emitter of emitters) expect(destroyEmitter).toHaveBeenCalledWith(emitter);
    expect(destroyEmitter).toHaveBeenCalledTimes(2);
    renderer.clear();
    expect(destroyEmitter).toHaveBeenCalledTimes(2);

    // Completed effects release their bookkeeping and are not destroyed again by the next teardown.
    renderer.sync([{ ...pickup, uid: 2 }]);
    timers[1].callback();
    expect(destroyEmitter).toHaveBeenCalledTimes(4);
    renderer.clear();
    expect(destroyEmitter).toHaveBeenCalledTimes(4);
  });
});

it('loads UI composites, the world token and symbol loop sheets through versioned colour URLs, and reports missing images', () => {
  const loaded = new Set<string>();
  const requests: [string, string][] = [];
  const sheets: [string, string, { frameWidth: number; endFrame: number }][] = [];
  const scene = { textures: { exists: (key: string) => loaded.has(key) },
    load: {
      image: (key: string, url: string) => requests.push([key, url]),
      spritesheet: (key: string, url: string, config: { frameWidth: number; endFrame: number }) => sheets.push([key, url, config]),
    } };
  preloadPowerUpAssets(scene as never);
  expect(requests).toHaveLength(POWERUP_ASSETS.length);
  expect(sheets).toHaveLength(POWERUP_LOOP_ASSETS.length);
  const keys = [...requests.map(([key]) => key), ...sheets.map(([key]) => key)];
  expect(new Set(keys).size).toBe(keys.length);
  for (const [key, url] of [...requests, ...sheets]) {
    expect(url).toMatch(/\?v=[a-f0-9]{64}$/);
    loaded.add(key);
  }
  for (const [key, , config] of sheets) {
    const loop = POWERUP_LOOP_ASSETS.find(asset => asset.key === key)!;
    expect(config.frameWidth).toBe(loop.layout.frameWidth);
    expect(config.endFrame).toBe(loop.frames - 1);
  }
  expect(() => assertPowerUpAssetsReady(scene as never)).not.toThrow();
  expect(loaded.has(POWERUP_TOKEN_KEY)).toBe(true);
  for (const def of Object.values(POWERUP_DEFS).filter(def => def.spriteKey)) {
    if (isDawnScrapTexture(def.spriteKey)) {
      expect(powerUpSymbolArt(def.spriteKey!)).toBeUndefined();
      expect(loaded.has(def.spriteKey!)).toBe(false);
      continue;
    }
    expect(loaded.has(def.spriteKey!)).toBe(true);
    expect(loaded.has(powerUpSymbolArt(def.spriteKey!)!.key)).toBe(true);
  }
  requests.length = 0; sheets.length = 0;
  preloadPowerUpAssets(scene as never);
  expect(requests).toHaveLength(0);
  expect(sheets).toHaveLength(0);
  loaded.delete(POWERUP_LOOP_ASSETS[0].key);
  expect(() => assertPowerUpAssetsReady(scene as never)).toThrow('Power-Up');
});

it('chooses loop frames as a pure, wrapping function of the World clock', () => {
  const art = { key: 'loop', frames: 12, fps: 12 };
  expect(powerUpSymbolFrame(art, 0, 0)).toBe(0);
  expect(powerUpSymbolFrame(art, 0, 1_000)).toBe(0);
  expect(powerUpSymbolFrame(art, 0, 999)).toBe(11);
  expect(powerUpSymbolFrame(art, 3, 500)).toBe(powerUpSymbolFrame(art, 3, 500));
  expect(powerUpSymbolFrame({ key: 'static', frames: 1, fps: 0 }, 7, 12_345)).toBe(0);
  for (let time = 0; time < 3_000; time += 37) {
    const frame = powerUpSymbolFrame(art, 5, time);
    expect(frame).toBeGreaterThanOrEqual(0);
    expect(frame).toBeLessThan(art.frames);
  }
});

it('loads Dawn art and registers its clips through the existing construction pipeline', () => {
  const loader = { image: vi.fn(), spritesheet: vi.fn() };
  preloadTurretVisualAssets(loader as never, DAWN_PIPELINE_ASSETS);
  const anims = { exists: () => false,
    generateFrameNumbers: vi.fn((_key, options) => options.frames), create: vi.fn() };
  registerTurretAnimations(anims as never, DAWN_PIPELINE_ASSETS);
  for (const asset of DAWN_PIPELINE_ASSETS) {
    expect(loader.image).toHaveBeenCalledWith(asset.textureKey, asset.idlePath);
    expect(loader.spritesheet).toHaveBeenCalledWith(asset.sheetTextureKey, asset.sheetPath, {
      frameWidth: asset.layout.frameWidth, frameHeight: asset.layout.frameHeight,
      margin: asset.layout.margin, spacing: asset.layout.spacing, endFrame: asset.layout.frameCount - 1,
    });
    for (const clip of asset.clips) {
      expect(anims.create).toHaveBeenCalledWith({ key: `${asset.sheetTextureKey}_${clip.name}`,
        frames: clip.frames, frameRate: clip.frameRate, repeat: clip.loop ? -1 : 0 });
    }
  }
  anims.create.mockClear();
  anims.generateFrameNumbers.mockReturnValue([]);
  registerTurretAnimations(anims as never, DAWN_PIPELINE_ASSETS);
  expect(anims.create).not.toHaveBeenCalled();
});
