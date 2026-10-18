import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { MULTIPLY: 2 } }));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));
const batches: any[] = [];
vi.mock('../src/effects/EnemyEyeBatch', () => ({ EnemyEyeBatch: class {
  layer = { memberCount: 0, visible: false, blend: 0, name: '',
    setBlendMode(mode: number) { this.blend = mode; return this; }, setName(name: string) { this.name = name; return this; },
    setVisible(visible: boolean) { this.visible = visible; return this; } };
  writes: number[][] = [];
  constructor(_scene: unknown, public texture: string, _capacity: number, public depth: number) { batches.push(this); }
  begin(count: number) { this.layer.memberCount = 0; this.writes = []; this.layer.setVisible(count > 0); }
  write(...args: number[]) { this.layer.memberCount++; this.writes.push(args); }
  destroy = vi.fn();
} }));
import { ShadowTrunkStamp } from '../src/effects/ShadowTrunkStamp';

function fixture() {
  const fills: { style: string; arcs: number }[] = [];
  let current = { style: '', arcs: 0 };
  const context = { clearRect: vi.fn(), beginPath: () => { current = { style: '', arcs: 0 }; },
    arc: () => { current.arcs++; }, closePath: () => {}, fill: () => { fills.push({ ...current, style: context.fillStyle }); },
    fillStyle: '' };
  const texture = { context, refresh: vi.fn(), destroy: vi.fn() };
  const scene = { textures: { createCanvas: vi.fn(() => texture) } };
  return { scene, texture, fills };
}

describe('baked trunk shadow stamp', () => {
  it('bakes the shared layered stadium once and draws one multiplied quad per trunk', () => {
    const { scene, texture, fills } = fixture();
    const stamp = new ShadowTrunkStamp(scene as never, 8.8);
    const batch = batches.at(-1);
    expect(batch.depth).toBe(8.8); expect(batch.layer.blend).toBe(2);
    const layers = [{ radius: 33, alpha: 0.05 }, { radius: 22, alpha: 0.12 }, { radius: 17, alpha: 0.21 }];
    expect(stamp.prepare(layers, 12, 9, 0x05070b)).toBe(true);
    // Outermost first, each a closed stadium of two half arcs, alpha scaled by the near-black colour.
    expect(fills.map(fill => fill.arcs)).toEqual([2, 2, 2]);
    expect(Number(fills[0].style.match(/,([\d.]+)\)$/)![1])).toBeCloseTo(0.05 * (1 - 0.0254), 3);
    expect(stamp.prepare(layers, 12, 9, 0x05070b)).toBe(true);
    expect(texture.refresh).toHaveBeenCalledTimes(1);
    stamp.begin(3); stamp.write(100, 200); stamp.write(300, 50); stamp.end();
    expect(batch.writes).toEqual([[100, 200, 256, 256, 0, 0xffffff, 1], [300, 50, 256, 256, 0, 0xffffff, 1]]);
    expect(batch.layer.visible).toBe(true);
    stamp.begin(3); stamp.end();
    expect(batch.layer.visible).toBe(false);
  });

  it('declines shadows longer than the stamp so the caller keeps its polygons', () => {
    const { scene, texture } = fixture();
    const stamp = new ShadowTrunkStamp(scene as never, 8.8);
    expect(stamp.prepare([{ radius: 60, alpha: 0.1 }], 70, 70, 0x05070b)).toBe(false);
    expect(texture.refresh).not.toHaveBeenCalled();
    stamp.destroy();
    expect(batches.at(-1).destroy).toHaveBeenCalledOnce(); expect(texture.destroy).toHaveBeenCalledOnce();
  });
});
