import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0 },
  Math: {
    Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
    FloatBetween: (min: number, max: number) => min + (max - min) * 0.37,
    Between: (min: number, max: number) => Math.round((min + max) / 2),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
    Angle: { Between: (x: number, y: number, tx: number, ty: number) => Math.atan2(ty - y, tx - x) },
  },
}));
vi.mock('../src/ui/HostileBaseIndicator', () => ({ getVisibleWorldView: () => ({ x: 100, y: 100, width: 500, height: 500 }) }));
vi.mock('../src/effects/EffectUtils', () => ({
  createEmitter: vi.fn(() => ({ explode: vi.fn(), clear: vi.fn(), destroy: vi.fn() })),
  destroyEmitter: (emitter: { destroy(): void }) => emitter.destroy(),
  killAllAndResetParticlePositions: (emitter: { clear(): void }) => emitter.clear(),
  ensureCanvasTexture: () => {},
  setEmitterTintArray: () => {},
}));

import { RockDestructionRenderer } from '../src/effects/RockDestructionRenderer';
import { createEmitter } from '../src/effects/EffectUtils';

// Crop leaves the full frame dimensions unchanged, just as Phaser does.
class Image {
  width = 32; height = 32; x = 0; y = 0; scaleX = 1; scaleY = 1;
  originX = 0.5; originY = 0.5; alpha = 1; angle = 0; active = false;
  crop = { x: 0, y: 0, width: 32, height: 32 };
  destroy = vi.fn();
  setActive(v: boolean) { this.active = v; return this; }
  setVisible(_v: boolean) { return this; }
  setTexture(_key: string, _frame: unknown) { return this; }
  setDepth(_v: number) { return this; }
  setTint(_v: number) { return this; }
  setAlpha(v: number) { this.alpha = v; return this; }
  setAngle(v: number) { this.angle = v; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setScale(x: number, y: number) { this.scaleX = x; this.scaleY = y; return this; }
  setDisplaySize(x: number, y: number) { return this.setScale(x / this.width, y / this.height); }
  setOrigin(x: number, y: number) { this.originX = x; this.originY = y; return this; }
  setCrop(x: number, y: number, width: number, height: number) { this.crop = { x, y, width, height }; return this; }
}

const snapshot = { x: 300, y: 300, size: 32, scaleX: 2, scaleY: 0.75, frame: 0, tint: 0x998877, angle: 90, alpha: 1 };

function setup() {
  const events = new EventEmitter();
  const images: Image[] = [];
  const scene = {
    events: {
      on: (name: string, fn: (...args: number[]) => void, ctx: unknown) => events.on(name, fn.bind(ctx)),
      once: (name: string, fn: () => void, ctx: unknown) => events.once(name, fn.bind(ctx)),
      off: (name: string) => events.removeAllListeners(name),
    },
    cameras: { main: {} }, game: { loop: { frame: 1 } },
    textures: { getFrame: () => ({ realWidth: 32, realHeight: 32 }) },
    add: { image: () => { const image = new Image(); images.push(image); return image; } },
  };
  const renderer = new RockDestructionRenderer(scene as unknown as Phaser.Scene);
  renderer.generateTextures();
  return { renderer, images, events, tick: (delta = 0) => events.emit('postupdate', 0, delta), active: () => images.filter(i => i.active) };
}

describe('RockDestructionRenderer', () => {
  it('spawns centered material fragments inside the rock and retains relative scale during flight', () => {
    const h = setup();
    h.renderer.playDestruction(snapshot); h.tick();
    expect(h.active().length).toBeGreaterThan(0);
    const scales = h.active().map(image => [image.scaleX, image.scaleY]);
    for (const image of h.active()) {
      expect(image.originX).toBe(0.5);
      expect(image.originY).toBe(0.5);
      expect(Math.abs(image.x - snapshot.x)).toBeLessThan(snapshot.size * snapshot.scaleX / 2);
      expect(Math.abs(image.y - snapshot.y)).toBeLessThan(snapshot.size * snapshot.scaleY / 2);
      expect(image.scaleX * image.width).toBeLessThan(snapshot.size * snapshot.scaleX);
      expect(image.scaleX).toBeGreaterThan(0);
      expect(image.alpha).toBeGreaterThan(0);
    }
    h.tick(100);
    h.active().forEach((image, index) => {
      expect(image.alpha).toBeGreaterThan(0);
      expect(image.scaleX / scales[index][0]).toBeCloseTo(image.scaleY / scales[index][1]);
    });
  });

  it('bounds concurrent work and reuses the pool after expiry and clear', () => {
    const h = setup();
    const emitters = vi.mocked(createEmitter).mock.results.slice(-2).map(result => result.value);
    const capacity = h.images.length;
    for (let batch = 0; batch < capacity; batch++) {
      for (let i = 0; i < 10; i++) h.renderer.playDestruction({ ...snapshot, x: 200 + i * 20 });
      h.tick();
    }
    expect(h.images).toHaveLength(capacity);
    expect(h.active().length).toBeLessThanOrEqual(capacity);
    const dust = emitters[0];
    const previousBursts = vi.mocked(dust.explode).mock.calls.length;
    h.renderer.playDestruction(snapshot); h.tick();
    expect(vi.mocked(dust.explode).mock.calls.length).toBeGreaterThan(previousBursts);
    h.tick(2000);
    expect(h.active()).toHaveLength(0);
    h.renderer.playDestruction(snapshot); h.tick();
    expect(h.active().length).toBeGreaterThan(0);
    h.renderer.playDestruction(snapshot);
    h.renderer.clear(); h.tick();
    expect(h.active()).toHaveLength(0);
    for (const emitter of emitters) expect(emitter.clear).toHaveBeenCalled();
    h.events.emit('shutdown');
    expect(h.events.listenerCount('postupdate')).toBe(0);
    for (const image of h.images) expect(image.destroy).toHaveBeenCalledOnce();
    for (const emitter of emitters) expect(emitter.destroy).toHaveBeenCalledOnce();
    h.renderer.playDestruction(snapshot); h.tick();
    expect(h.active()).toHaveLength(0);
  });

  it('includes effects reaching the viewport and culls distant destruction', () => {
    const h = setup();
    h.renderer.playDestruction({ ...snapshot, x: 50 }); h.tick();
    expect(h.active().length).toBeGreaterThan(0);
    h.renderer.clear();
    h.renderer.playDestruction({ ...snapshot, x: -1000 }); h.tick();
    expect(h.active()).toHaveLength(0);
  });
});
