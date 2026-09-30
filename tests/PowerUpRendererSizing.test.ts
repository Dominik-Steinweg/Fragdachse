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
import { POWERUP_DEFS, POWERUP_RENDER_SIZE } from '../src/powerups/PowerUpConfig';

// Pedestal GPU rendering is covered separately; this test exercises item sync and reveal.
vi.mock('../src/powerups/PowerUpPedestalGpuSystem', () => ({
  PowerUpPedestalGpuSystem: class {},
}));

class DisplayObject {
  scaleX = 1;
  scaleY = 1;
  alpha = 1;
  children: DisplayObject[] = [];
  constructor(readonly width: number, readonly height: number, readonly key = '') {}
  get displayWidth() { return this.width * this.scaleX; }
  get displayHeight() { return this.height * this.scaleY; }
  setScale(x: number, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setDisplaySize(w: number, h: number) { return this.setScale(w / this.width, h / this.height); }
  setAlpha(value: number) { this.alpha = value; return this; }
  setDepth() { return this; }
  setPosition() { return this; }
  once() { return this; }
  add(child: DisplayObject) { this.children.push(child); return this; }
  addAt(child: DisplayObject, index: number) { this.children.splice(index, 0, child); return this; }
  destroy() {}
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
        container: () => new DisplayObject(1, 1),
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
    const icons = images.filter(image => definitions.some(def => def.spriteKey === image.key));
    const reveals = tweens.filter(tween => 'value' in tween.targets);
    expect(icons).toHaveLength(pickups.length);
    expect(reveals).toHaveLength(pickups.length);
    const checkBounds = () => {
      for (const icon of icons) {
        expect(icon.displayWidth).toBeGreaterThan(0);
        expect(icon.displayWidth).toBeLessThanOrEqual(POWERUP_RENDER_SIZE);
        expect(icon.displayHeight).toBeLessThanOrEqual(POWERUP_RENDER_SIZE);
      }
    };
    checkBounds();
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
  });
});
