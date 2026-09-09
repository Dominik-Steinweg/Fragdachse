import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1, SCREEN: 2 }, Math: {
  Clamp: (n: number, a: number, b: number) => Math.max(a, Math.min(b, n)),
  Linear: (a: number, b: number, t: number) => a + (b - a) * t,
} }));
vi.mock('../src/utils/phaserFx', () => ({ addExternalGlow: () => null, removeExternalFx: vi.fn() }));
vi.mock('../src/effects/EffectUtils', async importOriginal => ({
  ...await importOriginal<typeof import('../src/effects/EffectUtils')>(),
  edgeZone: (radius: number) => ({ radius }),
  createEmitter: (scene: any, x: number, y: number, texture: string, config: unknown) => scene.add.particles(x, y, texture, config),
}));
import { TimeBubbleRenderer } from '../src/effects/TimeBubbleRenderer';
import { BULLET_GLOW_TEXTURE } from '../src/effects/BulletRenderer';
import type { SyncedTimeBubble } from '../src/types';

function image(key: string) {
  return {
    key, rotation: 0, x: 0, y: 0, alpha: 1,
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
    setAlpha(alpha: number) { this.alpha = alpha; return this; },
    setRotation(rotation: number) { this.rotation = rotation; return this; },
    setScale() { return this; }, setDepth() { return this; }, setTint() { return this; },
    setDisplaySize() { return this; }, setBlendMode() { return this; }, setFlipX() { return this; },
    destroy: vi.fn(),
  };
}

describe('Time Bubble presentation ownership', () => {
  it('adds warm layers only with charge, reserves sparks and pulsing for full charge, and cleans every object', () => {
    const images: ReturnType<typeof image>[] = [], emitters: ReturnType<typeof image>[] = [];
    const scene = { time: { now: 1000 }, add: {
      image: (_x: number, _y: number, key: string) => { const o = image(key); images.push(o); return o; },
      particles: () => { const o = image('sparks'); emitters.push(o); return o; },
    } };
    const renderer = new TimeBubbleRenderer(scene as unknown as Phaser.Scene);
    const lighting = { setLight: vi.fn(), releaseLight: vi.fn() };
    renderer.setLightingSystem(lighting as never);
    const bubble: SyncedTimeBubble = { id: 2, ownerId: 'owner', x: 200, y: 300, radius: 120,
      alpha: 1, color: 0xffffff, distortion: 0.75, charge: 0, chargeCapacity: 80 };
    renderer.syncVisuals([bubble]); const baseline = images.length;
    renderer.syncVisuals([{ ...bubble, charge: 20 }]); const warm = images.slice(baseline);
    expect(warm.length).toBeGreaterThan(0); const lowAlpha = warm[0].alpha;
    renderer.syncVisuals([{ ...bubble, charge: 40 }]);
    expect(warm[0].alpha).toBeGreaterThan(lowAlpha); expect(emitters).toHaveLength(0);
    const partialAlphas = warm.map(o => o.alpha);
    scene.time.now += 250; renderer.update(250);
    expect(warm.map(o => o.alpha)).toEqual(partialAlphas);
    renderer.syncVisuals([{ ...bubble, charge: 80, chargeCapacity: 160 }]);
    expect(warm.map(o => o.alpha)).toEqual(partialAlphas);
    renderer.syncVisuals([{ ...bubble, charge: bubble.chargeCapacity }]);
    expect(emitters).toHaveLength(1); const fullAlphas = warm.map(o => o.alpha);
    scene.time.now += 250; renderer.update(250);
    expect(warm.some((o, i) => o.alpha !== fullAlphas[i])).toBe(true);
    expect(images.slice(baseline)).toEqual(warm);
    renderer.syncVisuals([{ ...bubble, charge: bubble.chargeCapacity, alpha: 0 }]);
    expect(warm.every(o => o.alpha === 0)).toBe(true); expect(emitters[0].alpha).toBe(0);
    renderer.syncVisuals([]); renderer.destroyAll();
    for (const o of [...images, ...emitters]) expect(o.destroy).toHaveBeenCalledTimes(1);
    expect(lighting.releaseLight).toHaveBeenCalledWith(`timebubble:charge:${bubble.id}`);
  });
  it('adds the source only for upgraded snapshots, reuses it and cleans it up on removal and teardown', () => {
    const images: ReturnType<typeof image>[] = [];
    const scene = { time: { now: 1000 }, add: { image: (_x: number, _y: number, key: string) => {
      const visual = image(key); images.push(visual); return visual;
    } } };
    const renderer = new TimeBubbleRenderer(scene as unknown as Phaser.Scene);
    const bubble: SyncedTimeBubble = { id: 1, ownerId: 'owner', x: 200, y: 300, radius: 120,
      alpha: 1, color: 0xffffff, distortion: 0.75 };
    renderer.syncVisuals([bubble]);
    expect(images.filter(i => i.key === BULLET_GLOW_TEXTURE)).toHaveLength(0);
    renderer.syncVisuals([{ ...bubble, prismActive: true }]);
    const center = images.filter(i => i.key === BULLET_GLOW_TEXTURE);
    expect(center.length).toBeGreaterThan(0);
    const count = images.length;
    renderer.syncVisuals([{ ...bubble, prismActive: true, alpha: 0 }]);
    renderer.update(16);
    expect(images).toHaveLength(count);
    for (const visual of center) expect(visual.alpha).toBe(0);
    renderer.syncVisuals([bubble]);
    for (const visual of center) expect(visual.destroy).toHaveBeenCalledTimes(1);
    renderer.syncVisuals([{ ...bubble, prismActive: true }]);
    renderer.syncVisuals([]);
    renderer.destroyAll();
    for (const visual of images) expect(visual.destroy).toHaveBeenCalledTimes(1);
  });
});
