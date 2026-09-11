import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { ADD: 1 } }));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject() {}, mixColors: (color: number) => color }));
import { ZeusTaserRenderer } from '../src/effects/ZeusTaserRenderer';
import { zeusFixture, zeusRef } from './ZeusTestHelper';

function fixture() {
  const layers: Record<string, ReturnType<typeof vi.fn>>[] = [];
  const scene = { add: { graphics: () => {
    const layer: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['setDepth', 'setBlendMode', 'clear', 'fillStyle', 'fillCircle', 'lineStyle',
      'strokeCircle', 'lineBetween', 'beginPath', 'moveTo', 'lineTo', 'strokePath', 'destroy']) layer[method] = vi.fn(() => layer);
    layers.push(layer); return layer;
  } } };
  return { renderer: new ZeusTaserRenderer(scene as never), layers };
}

describe('Zeus snapshot presentation', () => {
  it('does not allocate CPU Graphics for the body or ground', () => {
    const { runtime, use, movement } = zeusFixture({ groundEnabled: 1 });
    runtime.startBall(use, movement, 0); runtime.move({ ...movement, x: 30 }, 10);
    const f = fixture();
    f.renderer.syncUpgrades(runtime.snapshot(), 10, () => ({ x: 100, y: 120, radius: 99 }));
    expect(f.layers).toEqual([]);
    f.renderer.clearUpgrades(); f.renderer.clearUpgrades();
  });
  it('ignores an expired stun and a replacement target with the same id', () => {
    const f = fixture();
    const state = { balls: [], ground: [], stuns: [{ target: zeusRef('e', 1), expiresAt: 100 }] };
    f.renderer.syncUpgrades(state, 10, () => ({ x: 0, y: 0, radius: 10, entityGeneration: 2 }));
    expect(f.layers[0].beginPath).not.toHaveBeenCalled();
    f.renderer.syncUpgrades(state, 100, () => ({ x: 0, y: 0, radius: 10, entityGeneration: 1 }));
    expect(f.layers[0].beginPath).not.toHaveBeenCalled();
    f.renderer.syncUpgrades(state, 99, () => ({ x: 0, y: 0, radius: 10, entityGeneration: 1 }));
    expect(f.layers[0].beginPath).toHaveBeenCalled();
    f.renderer.clearUpgrades();
  });
});
