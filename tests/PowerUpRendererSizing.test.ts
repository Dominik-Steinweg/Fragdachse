import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { ADD: 1 },
  GameObjects: { Events: { DESTROY: 'destroy' } },
}));
vi.mock('../src/effects/EffectUtils', () => ({
  configureAdditiveImage: (image: unknown) => image,
  createEmitter: () => ({ explode: vi.fn() }),
  destroyEmitter: vi.fn(),
  ensureCanvasTexture: vi.fn(),
  fillRadialGradientTexture: vi.fn(),
  registerGraphicsObject: vi.fn(),
  setCircleEmitZone: vi.fn(),
  mixColors: vi.fn(),
}));

import { PowerUpRenderer } from '../src/powerups/PowerUpRenderer';
import { POWERUP_DEFS, POWERUP_RENDER_SIZE, POWERUP_SYMBOL_PULSE } from '../src/powerups/PowerUpConfig';
import { POWERUP_BASE_KEY, powerUpSymbolKey, POWERUP_ASSETS, preloadPowerUpAssets, assertPowerUpAssetsReady } from '../src/assets/PowerUpAssets';

// Pedestal GPU rendering is covered separately; this test exercises item sync and reveal.
vi.mock('../src/powerups/PowerUpPedestalGpuSystem', () => ({
  PowerUpPedestalGpuSystem: class {},
}));

class DisplayObject {
  destroyed = false;
  scaleX = 1;
  scaleY = 1;
  alpha = 1;
  children: DisplayObject[] = [];
  parent: DisplayObject | null = null;
  constructor(readonly width: number, readonly height: number, readonly key = '') {}
  get displayWidth() { return this.width * this.scaleX; }
  get displayHeight() { return this.height * this.scaleY; }
  get worldScale(): number { return this.scaleX * (this.parent?.worldScale ?? 1); }
  setScale(x: number, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setDisplaySize(w: number, h: number) { return this.setScale(w / this.width, h / this.height); }
  setAlpha(value: number) { this.alpha = value; return this; }
  setDepth() { return this; }
  setPosition() { return this; }
  once() { return this; }
  add(child: DisplayObject) { child.parent = this; this.children.push(child); return this; }
  addAt(child: DisplayObject, index: number) { child.parent = this; this.children.splice(index, 0, child); return this; }
  destroy(children = false) { this.destroyed = true; if (children) this.children.forEach(child => child.destroy(true)); }
}

interface TweenConfig {
  targets: DisplayObject | { value: number };
  onUpdate?: () => void;
  onComplete?: () => void;
}

describe('PowerUpRenderer materialization sizing', () => {
  it.each([16, 256])('keeps every pickup within its display box throughout reveal with %spx source images', (sourceSize) => {
    const images: DisplayObject[] = [];
    const tweens: TweenConfig[] = [];
    const scene = {
      add: {
        container: (_x: number, _y: number, children: DisplayObject[] = []) => {
          const container = new DisplayObject(1, 1); children.forEach(child => container.add(child)); return container;
        },
        image: (_x: number, _y: number, key: string) => {
          const image = new DisplayObject(sourceSize, sourceSize, key);
          images.push(image);
          return image;
        },
      },
      tweens: { add: (config: TweenConfig) => { tweens.push(config); return { stop: vi.fn() }; } },
      time: { delayedCall: vi.fn() },
    };
    const renderer = new PowerUpRenderer(scene as never);
    const definitions = Object.values(POWERUP_DEFS).filter(def => def.spriteKey);
    const pickups = definitions.map((def, uid) => ({ uid, defId: def.id, x: 100, y: 100 }));
    renderer.sync(pickups);
    const icons = images.filter(image => image.key === POWERUP_BASE_KEY);
    const symbols = images.filter(image => definitions.some(def => powerUpSymbolKey(def.spriteKey!) === image.key));
    const reveals = tweens.filter(tween => 'value' in tween.targets);
    expect(icons).toHaveLength(pickups.length);
    expect(symbols).toHaveLength(pickups.length);
    expect(reveals).toHaveLength(pickups.length);
    const checkBounds = () => {
      for (const icon of icons) {
        expect(icon.displayWidth).toBeGreaterThan(0);
        expect(icon.width * icon.worldScale).toBeLessThanOrEqual(POWERUP_RENDER_SIZE);
        expect(icon.displayHeight).toBeLessThanOrEqual(POWERUP_RENDER_SIZE);
      }
    };
    checkBounds();
    expect(icons[0].width * icons[0].worldScale).toBeLessThan(POWERUP_RENDER_SIZE);
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      for (const tween of reveals) {
        (tween.targets as { value: number }).value = progress;
        tween.onUpdate?.();
      }
      checkBounds();
    }
    reveals.forEach(tween => tween.onComplete?.());
    renderer.sync(pickups);
    for (const icon of icons) {
      expect(icon.displayWidth).toBeCloseTo(POWERUP_RENDER_SIZE);
      expect(icon.displayHeight).toBeCloseTo(POWERUP_RENDER_SIZE);
      expect(icon.alpha).toBe(1);
    }
    const widths = (time: number) => {
      renderer.updatePresentation(time);
      return symbols.map(symbol => symbol.displayWidth);
    };
    const initial = widths(250);
    expect(widths(250)).toEqual(initial);
    expect(widths(250 + POWERUP_SYMBOL_PULSE.periodMs)).toEqual(initial);
    expect(new Set(initial).size).toBeGreaterThan(1);
    expect(widths(500)).not.toEqual(initial);
    for (const width of widths(700)) {
      expect(width).toBeGreaterThanOrEqual(POWERUP_RENDER_SIZE * (1 - POWERUP_SYMBOL_PULSE.amplitude));
      expect(width).toBeLessThanOrEqual(POWERUP_RENDER_SIZE * (1 + POWERUP_SYMBOL_PULSE.amplitude));
    }
    for (const base of icons) expect(base.displayWidth).toBe(POWERUP_RENDER_SIZE);
    const beforeResync = widths(700);
    renderer.sync(pickups);
    expect(widths(700)).toEqual(beforeResync);
    renderer.sync([]);
    expect([...icons, ...symbols].every(image => image.destroyed)).toBe(true);
    renderer.updatePresentation(900);
  });
});

it('loads layered pickups and static UI keys through versioned colour URLs, and reports missing images', () => {
  const loaded = new Set<string>();
  const requests: [string, string][] = [];
  const scene = { textures: { exists: (key: string) => loaded.has(key) },
    load: { image: (key: string, url: string) => requests.push([key, url]) } };
  preloadPowerUpAssets(scene as never);
  expect(requests).toHaveLength(POWERUP_ASSETS.length);
  expect(new Set(requests.map(([key]) => key)).size).toBe(requests.length);
  for (const [key, url] of requests) {
    expect(url).toMatch(/\?v=[a-f0-9]{64}$/);
    loaded.add(key);
  }
  expect(() => assertPowerUpAssetsReady(scene as never)).not.toThrow();
  for (const def of Object.values(POWERUP_DEFS).filter(def => def.spriteKey)) {
    expect(loaded.has(def.spriteKey!)).toBe(true);
    expect(loaded.has(powerUpSymbolKey(def.spriteKey!)!)).toBe(true);
  }
  requests.length = 0;
  preloadPowerUpAssets(scene as never);
  expect(requests).toHaveLength(0);
  loaded.delete(POWERUP_BASE_KEY);
  expect(() => assertPowerUpAssetsReady(scene as never)).toThrow('Power-Up');
});
