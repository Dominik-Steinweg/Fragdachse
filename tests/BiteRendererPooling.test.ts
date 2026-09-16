import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';

const mocks = vi.hoisted(() => {
  const visual = () => {
    const object: Record<string, unknown> = {};
    for (const name of ['setDepth', 'setRotation', 'setBlendMode', 'setTint', 'setAlpha',
      'setDisplaySize', 'add', 'lineStyle', 'beginPath', 'moveTo', 'lineTo', 'strokePath',
      'lineBetween', 'removeAll', 'destroy']) object[name] = () => object;
    return object;
  };
  return { visual, contours: vi.fn(visual) };
});
vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Math: {
    DegToRad: (x: number) => x * Math.PI / 180,
    RadToDeg: (x: number) => x * 180 / Math.PI,
    Clamp: (x: number, min: number, max: number) => Math.max(min, Math.min(max, x)),
    FloatBetween: (min: number, max: number) => (min + max) / 2,
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
  },
}));
vi.mock('../src/effects/StaticPolygonGraphics', () => ({ createStaticPolygonGraphics: mocks.contours }));
vi.mock('../src/effects/EffectUtils', async importOriginal => ({
  ...await importOriginal<typeof import('../src/effects/EffectUtils')>(),
  createEmitter: (scene: { add: { particles: (...args: unknown[]) => unknown } }, ...args: unknown[]) => scene.add.particles(...args),
  registerGraphicsObject: (_scene: unknown, _family: unknown, object: unknown) => object,
  makeAdditive: (object: unknown) => object,
}));
import { BiteRenderer } from '../src/effects/BiteRenderer';

interface Particle { x: number; y: number; angle: number }
class Emitter {
  alive: Particle[] = [];
  dead: Particle[] = [];
  angle = 0;
  constructor(readonly x: number, readonly y: number) {}
  setEmitterAngle(range: { min: number; max: number }) { this.angle = (range.min + range.max) / 2; return this; }
  explode(count: number, x = 0, y = 0) {
    for (let i = 0; i < count; i++) {
      const particle = this.dead.pop() ?? { x: 0, y: 0, angle: 0 };
      particle.x += this.x + x; particle.y += this.y + y; particle.angle = this.angle;
      this.alive.push(particle);
    }
  }
  killAll() { this.dead.push(...this.alive); this.alive.length = 0; }
  forEachDead(callback: (particle: Particle) => void) { this.dead.forEach(callback); }
}

describe('Bite particle lifetime', () => {
  it('reuses bounded immutable contours and releases the World cache', () => {
    mocks.contours.mockClear();
    const scene = { add: { particles: (x: number, y: number) => new Emitter(x, y),
      container: mocks.visual, graphics: mocks.visual, image: mocks.visual }, tweens: { add: vi.fn() } };
    const renderer = new BiteRenderer(scene as unknown as Phaser.Scene);
    for (let hit = 0; hit < 200; hit++) renderer.playSwing(500, 500, hit / 10, 45, 40, 0);
    const calls = mocks.contours.mock.calls as unknown as [unknown, object][];
    const firstHalf = new Set(calls.slice(0, 200).map(call => call[1]));
    const later = new Set(calls.slice(200).map(call => call[1]));
    expect(firstHalf.size).toBeGreaterThan(1);
    expect(later.size).toBeLessThanOrEqual(firstHalf.size);
    expect([...later].every(contour => firstHalf.has(contour))).toBe(true);
    renderer.clear();
    renderer.playSwing(500, 500, 0, 45, 40, 0);
    expect(firstHalf.has(calls.at(-1)![1])).toBe(false);
  });

  it('keeps concurrent impacts at their own coordinates and directions, with reusable World-safe pools', () => {
    const emitters: Emitter[] = [];
    const scene = { add: {
      particles: (x: number, y: number) => { const emitter = new Emitter(x, y); emitters.push(emitter); return emitter; },
      container: mocks.visual, graphics: mocks.visual, image: mocks.visual,
    }, tweens: { add: vi.fn() }, time: { delayedCall: vi.fn() } };
    const renderer = new BiteRenderer(scene as unknown as Phaser.Scene);
    renderer.playSwing(500, 500, 0, 45, 40, 0, true, 520, 510);
    const impact = emitters.find(emitter => emitter.alive.some(p => p.x === 520 && p.y === 510))!;
    const first = impact.alive.map(p => ({ ...p }));
    const allocated = emitters.length;
    renderer.playSwing(700, 700, Math.PI / 2, 45, 40, 0, true, 730, 710);
    expect(emitters).toHaveLength(allocated);
    expect(impact.alive.slice(0, first.length)).toEqual(first);
    expect(impact.alive.slice(first.length).every(p => p.x === 730 && p.y === 710 && p.angle === 90)).toBe(true);
    renderer.clear();
    expect(emitters.every(emitter => emitter.alive.length === 0)).toBe(true);
    renderer.playSwing(800, 800, Math.PI, 45, 40, 0, true, 830, 810);
    expect(emitters).toHaveLength(allocated);
    expect(impact.alive.every(p => p.x === 830 && p.y === 810 && p.angle === 180)).toBe(true);
  });
});
