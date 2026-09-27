import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { ADD: 1 },
  Display: { Color: {
    IntegerToRGB: (n: number) => ({ r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 }),
    GetColor: (r: number, g: number, b: number) => r << 16 | g << 8 | b,
  } },
}));
vi.mock('../src/effects/EffectUtils', () => ({
  createEmitter: () => { const emitter = makeObject(); emitters.push(emitter); return emitter; },
  configureAdditiveImage: (image: ReturnType<typeof makeObject>, _depth: number, alpha: number, tint: number) => image.setAlpha(alpha).setTint(tint),
  setCircleEmitZone: (emitter: ReturnType<typeof makeObject>, radius: number) => { emitter.zone = { radius }; },
  destroyEmitter: (emitter: ReturnType<typeof makeObject>) => emitter.destroy(),
}));
import { EnergyBallRenderer } from '../src/effects/EnergyBallRenderer';

function makeObject() {
  return {
    x: 0, y: 0, tint: 0, alpha: 1, scale: 1, rotation: 0, zone: null as { radius: number } | null,
    particleScale: null as number[] | null, destroyed: false,
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
    setTint(tint: number) { this.tint = tint; return this; },
    setAlpha(alpha: number) { this.alpha = alpha; return this; },
    setScale(scale: number) { this.scale = scale; return this; },
    setRotation(rotation: number) { this.rotation = rotation; return this; },
    setParticleScale(start: number, end: number) { this.particleScale = [start, end]; return this; },
    destroy() { this.destroyed = true; },
  };
}
const emitters: ReturnType<typeof makeObject>[] = [];

describe('energy ball presentation configuration', () => {
  it('reuses stable emission geometry while following movement, size, color and variant changes', () => {
    emitters.length = 0;
    const images: ReturnType<typeof makeObject>[] = [];
    const scene = { time: { now: 0 }, add: { image: () => { const image = makeObject(); images.push(image); return image; } } };
    const renderer = new EnergyBallRenderer(scene as never);
    renderer.createVisual(1, 10, 20, 12, 0xff2233);
    const zones = emitters.map(e => e.zone), scales = emitters.map(e => e.particleScale);
    const initialRotation = images[1].rotation, initialTint = images[0].tint;
    scene.time.now = 100;
    renderer.updateVisual(1, 30, 40, 12, 5, 7, 0xff2233);
    emitters.forEach((e, i) => {
      expect(e.zone).toBe(zones[i]); expect(e.particleScale).toBe(scales[i]);
      expect([e.x, e.y]).toEqual([30, 40]);
    });
    expect(images[1].rotation).not.toBe(initialRotation);
    expect([images[0].x, images[0].y]).toEqual([30, 40]);
    renderer.updateVisual(1, 30, 40, 24, 5, 7, 0x3355ff, 'plasma');
    emitters.forEach((e, i) => {
      expect(e.zone).not.toBe(zones[i]); expect(e.particleScale).not.toEqual(scales[i]);
    });
    expect(images[0].tint).not.toBe(initialTint);
    renderer.destroyVisual(1);
    expect([...emitters, ...images].every(o => o.destroyed)).toBe(true);
    renderer.createVisual(1, 0, 0, 12, 0xff2233);
    expect(emitters[2].zone).toEqual(zones[0]);
    expect(emitters[2].zone).not.toBe(zones[0]);
  });
});
