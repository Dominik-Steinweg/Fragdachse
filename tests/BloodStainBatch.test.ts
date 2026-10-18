import EventEmitter from 'eventemitter3';
import { describe, expect, it, vi } from 'vitest';
import { BloodStainBatch, sampleBloodStain, type BloodStainRecord } from '../src/effects/BloodStainBatch';

vi.mock('phaser', () => ({
  Scenes: { Events: { POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown' } },
}));
vi.mock('../src/effects/EnemyEyeBatch', () => ({ EnemyEyeBatch: class {
  layer: any;
  begin = vi.fn(); write = vi.fn();
  destroy: ReturnType<typeof vi.fn>;
  constructor(scene: any, _texture: string, _capacity: number, depth: number) {
    this.layer = { depth, frame: { realWidth: 40, realHeight: 42 }, setName() {}, batch: this };
    scene.layers.push(this.layer);
    this.destroy = vi.fn();
  }
} }));

function fixture(maxStains = 500) {
  const scene = { events: new EventEmitter(), layers: [] as any[], time: { now: 0 } };
  const onDestroy = vi.fn();
  const batch = new BloodStainBatch(scene as never, 'blood', maxStains, onDestroy);
  const stain = (x: number, bornAt = scene.time.now): BloodStainRecord => ({
    x, y: 32, rotation: .4, tint: 0x922211, animation: { bornAt, alpha: .6, scale: 2, holdMs: 250, fadeMs: 1000 },
  });
  return { scene, batch, stain, onDestroy };
}

describe('blood stain batch', () => {
  it('writes one ground batch per depth in arrival order, without per-stain game objects', () => {
    const { scene, batch, stain } = fixture();
    batch.add(9.84, stain(10)); batch.add(9.84, stain(20)); batch.add(8, stain(30));
    scene.time.now = 200;
    scene.events.emit('postupdate');
    const [ground, lower] = scene.layers;
    expect(scene.layers.map(layer => layer.depth)).toEqual([9.84, 8]);
    expect(ground.batch.write.mock.calls.map((call: number[]) => call[0])).toEqual([10, 20]);
    expect(ground.batch.write.mock.calls[0]).toEqual([10, 32, 80, 84, .4, 0x922211, ((0.6 * 255) | 0) / 255]);
    expect(lower.batch.write.mock.calls.map((call: number[]) => call[0])).toEqual([30]);
  });

  it('animates arrival, hold and fade from the clock and drops the decal when its fade ends', () => {
    const { scene, batch, stain } = fixture();
    batch.add(9.84, stain(10));
    scene.events.emit('postupdate');
    const writer = scene.layers[0].batch;
    // Fully transparent at birth: nothing is submitted.
    expect(writer.write).not.toHaveBeenCalled();
    scene.time.now = 750; writer.write.mockClear();
    scene.events.emit('postupdate');
    expect(writer.write.mock.calls[0][6]).toBeLessThan(0.6);
    expect(writer.write.mock.calls[0][6]).toBeGreaterThan(0);
    scene.time.now = 1250; writer.write.mockClear();
    scene.events.emit('postupdate');
    expect(writer.write).not.toHaveBeenCalled();
    expect(batch.stainCount).toBe(0);
    const animation = stain(0, 0).animation;
    expect(sampleBloodStain(animation, 40)!.scale).toBeGreaterThan(2 * 0.82);
    expect(sampleBloodStain(animation, 40)!.scale).toBeLessThan(2);
    expect(sampleBloodStain(animation, 1250)).toBeNull();
  });

  it('gives way with its oldest stain once the cap is reached', () => {
    const { scene, batch, stain } = fixture(2);
    batch.add(9.84, stain(10, 0)); batch.add(9.84, stain(20, 1)); batch.add(9.84, stain(30, 2));
    expect(batch.stainCount).toBe(2);
    scene.time.now = 200;
    scene.events.emit('postupdate');
    expect(scene.layers[0].batch.write.mock.calls.map((call: number[]) => call[0])).toEqual([20, 30]);
  });

  it('spawns scheduled arrivals in due order on the clock', () => {
    const { scene, batch } = fixture();
    const order: string[] = [];
    batch.schedule(300, () => order.push('late'));
    batch.schedule(100, () => order.push('early'));
    batch.schedule(100, () => order.push('early-second'));
    scene.time.now = 99; scene.events.emit('postupdate');
    expect(order).toEqual([]);
    scene.time.now = 150; scene.events.emit('postupdate');
    expect(order).toEqual(['early', 'early-second']);
  });

  it.each(['shutdown', 'world-clear'])('drops decals and pending arrivals on %s exactly once', (reason) => {
    const { scene, batch, stain, onDestroy } = fixture();
    batch.add(9.84, stain(10));
    const late = vi.fn();
    batch.schedule(100, late);
    if (reason === 'shutdown') scene.events.emit('shutdown');
    else batch.destroy();
    batch.destroy();
    batch.add(9.84, stain(20));
    scene.time.now = 200; scene.events.emit('postupdate');
    expect(late).not.toHaveBeenCalled();
    expect(scene.layers[0].batch.destroy).toHaveBeenCalledOnce();
    expect(scene.layers).toHaveLength(1);
    expect(batch.stainCount).toBe(0);
    expect(onDestroy).toHaveBeenCalledOnce();
    expect(scene.events.listenerCount('postupdate')).toBe(0);
    expect(scene.events.listenerCount('shutdown')).toBe(0);
  });
});
