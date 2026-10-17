import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { ADD: 1 } }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityProfile: () => ({ level: 'high' }) }));
const frames = vi.hoisted(() => [] as { kind: number; t: number }[][]);
vi.mock('../src/effects/gpu/RestHealGpuLayer', () => ({ RestHealGpuLayer: class {
  private items: { kind: number; t: number }[] = [];
  begin() { this.items = []; }
  add(item: { kind: number; t: number }) { this.items.push(item); return true; }
  flush() { frames.push(this.items); }
  clear() { frames.push([]); }
  destroy() {}
  get size() { return this.items.length; }
} }));
import type * as Phaser from 'phaser';
import { RestHealTendrilRenderer, type RestHealChannel } from '../src/effects/RestHealTendrilRenderer';
import { REST_HEAL_KIND } from '../src/effects/gpu/RestHealShader';

const scene = () => ({ time: { now: 0 }, cameras: { main: { zoom: 1, zoomX: 1, zoomY: 1, rotation: 0, width: 4000, height: 4000,
  originX: 0.5, originY: 0.5, scrollX: -2000, scrollY: -2000, worldView: { x: -2000, y: -2000, width: 4000, height: 4000 } } } });
const channel = (targets: RestHealChannel['targets']): RestHealChannel => ({ id: 'toad', allied: false,
  body: { x: 0, y: 0, radius: 15 }, cross: { x: -4, y: 0 }, facing: 0, targets, eyes: [{ x: 5, y: -4 }],
  eyeColor: 0xb45cff, restAt: 0, tickMs: 250 });
const of = (kind: number) => (frames.at(-1) ?? []).filter(item => item.kind === kind);

describe('rest heal presentation', () => {
  it('grows a new link from the frame after it appears, keeps it while linked and withdraws it afterwards', () => {
    const s = scene(), renderer = new RestHealTendrilRenderer(s as unknown as Phaser.Scene);
    const linked = channel([{ id: 'ally', x: 120, y: 0, radius: 12 }]);
    renderer.draw([linked], 0);
    expect(of(REST_HEAL_KIND.link)).toHaveLength(0);
    s.time.now = 100; renderer.draw([linked], 100);
    expect(of(REST_HEAL_KIND.link)[0]!.t).toBeGreaterThan(0);
    s.time.now = 1000; renderer.draw([linked], 1000);
    expect(of(REST_HEAL_KIND.link)[0]!.t).toBe(1);
    expect(of(REST_HEAL_KIND.receiver)).toHaveLength(1);
    s.time.now = 1050; renderer.draw([channel([])], 1050);
    s.time.now = 1120; renderer.draw([channel([])], 1120);
    const withdrawing = of(REST_HEAL_KIND.link)[0]!.t;
    expect(withdrawing).toBeGreaterThan(0); expect(withdrawing).toBeLessThan(1);
    s.time.now = 2000; renderer.draw([], 2000);
    expect(of(REST_HEAL_KIND.link)).toHaveLength(0);
  });

  it('leaves a fading sigil on the ground when the rest ends; cross and eye rings belong to the channelling body', () => {
    const s = scene(), renderer = new RestHealTendrilRenderer(s as unknown as Phaser.Scene);
    const linked = channel([{ id: 'ally', x: 120, y: 0, radius: 12 }]);
    renderer.draw([linked], 0);
    s.time.now = 500; renderer.draw([linked], 500);
    expect(of(REST_HEAL_KIND.sigil)[0]!.t).toBe(1);
    expect(of(REST_HEAL_KIND.cross)).toHaveLength(1);
    expect(of(REST_HEAL_KIND.eyes)).toHaveLength(1);
    s.time.now = 600; renderer.draw([], 600);
    s.time.now = 700; renderer.draw([], 700);
    const fading = of(REST_HEAL_KIND.sigil)[0]!.t;
    expect(fading).toBeGreaterThan(0); expect(fading).toBeLessThan(1);
    expect(of(REST_HEAL_KIND.cross)).toHaveLength(0);
    expect(of(REST_HEAL_KIND.eyes)).toHaveLength(0);
    s.time.now = 3000; renderer.draw([], 3000);
    expect(of(REST_HEAL_KIND.sigil)).toHaveLength(0);
  });
});
