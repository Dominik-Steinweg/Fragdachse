import EventEmitter from 'eventemitter3';
import { describe, expect, it, vi } from 'vitest';
import { BloodStainBatch } from '../src/effects/BloodStainBatch';

vi.mock('phaser', () => ({
  Scenes: { Events: { POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown' } },
  GameObjects: { Events: { DESTROY: 'destroy' } },
}));
vi.mock('../src/effects/EnemyEyeBatch', () => ({ EnemyEyeBatch: class {
  layer: any;
  begin = vi.fn(); write = vi.fn(); destroy = vi.fn();
  constructor(scene: any, _texture: string, _capacity: number, depth: number) {
    this.layer = { depth, setName() {}, batch: this };
    scene.children.list.push(this.layer);
  }
} }));

function fixture() {
  const scene = { events: new EventEmitter(), children: { list: [] as any[] }, tweens: { killTweensOf: vi.fn() } };
  const onDestroy = vi.fn();
  const batch = new BloodStainBatch(scene as never, 'blood', onDestroy);
  const stain = (x: number, depth = 9.95) => {
    const image = Object.assign(new EventEmitter(), {
      x, y: 32, displayWidth: 20, displayHeight: 21, rotation: .4, tintTopLeft: 0x922211,
      alpha: .5, active: true, visible: true, depth,
      removeFromDisplayList() { scene.children.list.splice(scene.children.list.indexOf(this), 1); },
      destroy() { this.emit('destroy'); this.active = false; },
    });
    scene.children.list.push(image);
    batch.add(image as never);
    return image;
  };
  return { scene, batch, stain, onDestroy };
}

describe('blood stain render batching', () => {
  it('preserves compositing order across equal-depth enemies and different depths', () => {
    const { scene, stain } = fixture();
    const first = stain(10), second = stain(20);
    const enemy = { depth: 9.95 };
    scene.children.list.push(enemy);
    stain(30);
    stain(40, 8);
    const [before, interleaved, after, lower] = scene.children.list;
    expect(interleaved).toBe(enemy);
    expect(scene.children.list).toHaveLength(4);
    expect(lower.depth).toBe(8);
    // Tween values are sampled after update; the Image remains the tween target.
    first.alpha = .25; second.displayWidth = 28;
    scene.events.emit('postupdate');
    expect(before.batch.write.mock.calls).toEqual([
      [10, 32, 20, 21, .4, 0x922211, 63 / 255], [20, 32, 28, 21, .4, 0x922211, 127 / 255],
    ]);
    expect(after.batch.write.mock.calls[0][0]).toBe(30);
    expect(lower.batch.write.mock.calls[0][0]).toBe(40);
  });

  it('removes expired stains and releases empty batches', () => {
    const { scene, stain } = fixture();
    const first = stain(10), second = stain(20);
    const writer = scene.children.list[0].batch;
    first.destroy();
    scene.events.emit('postupdate');
    expect(writer.write.mock.calls).toHaveLength(1);
    expect(writer.write.mock.calls[0][0]).toBe(20);
    second.destroy();
    scene.events.emit('postupdate');
    expect(writer.destroy).toHaveBeenCalledOnce();
  });

  it.each(['shutdown', 'world-clear'])('cleans detached Images and tweens on %s exactly once', (reason) => {
    const { scene, batch, stain, onDestroy } = fixture();
    const first = stain(10), second = stain(20);
    const writer = scene.children.list[0].batch;
    if (reason === 'shutdown') scene.events.emit('shutdown');
    else batch.destroy();
    batch.destroy();
    scene.events.emit('postupdate');
    expect(first.active).toBe(false); expect(second.active).toBe(false);
    expect(scene.tweens.killTweensOf.mock.calls.map(([image]) => image)).toEqual([first, second]);
    expect(writer.destroy).toHaveBeenCalledOnce();
    expect(writer.write).not.toHaveBeenCalled();
    expect(onDestroy).toHaveBeenCalledOnce();
    expect(scene.events.listenerCount('postupdate')).toBe(0);
    expect(scene.events.listenerCount('shutdown')).toBe(0);
  });
});
