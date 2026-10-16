import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { ADD: 1 } }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityProfile: () => ({ level: 'high' }) }));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: (_: unknown, __: unknown, object: unknown) => object }));
import type * as Phaser from 'phaser';
import { RestHealTendrilRenderer, type RestHealChannel } from '../src/effects/RestHealTendrilRenderer';

function graphics() {
  const g = { lines: 0, clear: () => { g.lines = 0; return g; }, lineBetween: () => { g.lines++; return g; } } as Record<string, unknown> & { lines: number };
  for (const name of ['setDepth', 'setBlendMode', 'lineStyle', 'fillStyle', 'fillCircle', 'strokeCircle', 'destroy']) g[name] = () => g;
  return g;
}

describe('rest heal tendrils', () => {
  it('draws a new heal link from the frame after it appears and keeps it while linked', () => {
    const surface = graphics(), light = graphics(), layers = [surface, light];
    const scene = { time: { now: 0 }, add: { graphics: () => layers.shift() ?? graphics() } };
    const renderer = new RestHealTendrilRenderer(scene as unknown as Phaser.Scene);
    const channel: RestHealChannel = { id: 'toad', allied: false, cross: { x: 0, y: 0 }, facing: 0,
      targets: [{ id: 'ally', x: 120, y: 0 }], eyes: [], eyeColor: 0xb45cff, restAt: 0, tickMs: 250 };

    renderer.draw([channel], 0);
    const crossOnly = surface.lines;
    scene.time.now = 100;
    renderer.draw([channel], 100);
    expect(surface.lines).toBeGreaterThan(crossOnly);
    scene.time.now = 1000;
    renderer.draw([channel], 1000);
    expect(surface.lines).toBeGreaterThan(crossOnly + 8);
  });
});
