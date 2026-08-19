import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { ADD: 1 } }));

import { GpuVfxRegistry } from '../src/effects/gpu/GpuVfxRegistry';
import { makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function setup(capacity = 8) {
  const scene = makeFakeGpuVfxScene();
  const registry = new GpuVfxRegistry(scene as never);
  const emitter = registry.createEmitter({
    name: 'test-fx',
    texture: '__test',
    capacity,
    depth: 12.5,
    eases: ['Linear'],
  });
  return { scene, registry, emitter, layer: scene.layers[0] };
}

describe('gpu vfx registry', () => {
  it('configures and primes a layer on creation', () => {
    const { scene, layer } = setup(8);
    expect(scene.layers.length).toBe(1);
    expect(layer.blendMode).toBe(1);
    expect(layer.depth).toBe(12.5);
    expect(layer.enabledEases).toEqual(['Linear']);
    // Alle Member existieren vorab; spaeter wird nur noch editiert.
    expect(layer.added).toBe(8);
    expect(layer.edited).toEqual([]);
  });

  it('passes the gravity only when the effect asks for it', () => {
    const scene = makeFakeGpuVfxScene();
    const registry = new GpuVfxRegistry(scene as never);
    registry.createEmitter({ name: 'a', texture: 't', capacity: 2, depth: 1, eases: ['Linear'] });
    registry.createEmitter({
      name: 'b', texture: 't', capacity: 2, depth: 2, eases: ['Gravity'], gravity: 30,
    });
    expect(scene.layers[0].gravity).toBe(1024);
    expect(scene.layers[1].gravity).toBe(30);
  });

  it('retires expired members before running the emission ticks', () => {
    // Reihenfolge ist Teil des Vertrags: `acquire()` vergibt nur freie Slots, ein Spawn vor dem
    // Sweep wuerde als Overrun abgewiesen.
    const { registry, emitter, layer } = setup(2);
    const order: string[] = [];
    registry.registerEmission((_deltaMs, nowMs) => {
      order.push(`tick@${nowMs}`);
      emitter.pool.acquire(1, nowMs, 100);
    });

    registry.update(50);
    registry.update(50);
    expect(emitter.pool.getStats().activeSlots).toBe(2);

    // Bei 100 ms laeuft der erste Slot ab; der Sweep gibt ihn frei, bevor der Tick spawnt.
    layer.patched.length = 0;
    registry.update(50);
    expect(layer.patched).toEqual([0]);
    expect(emitter.pool.getStats().overruns).toBe(0);
    expect(order.length).toBe(3);
  });

  it('shares one monotonic clock across effects', () => {
    const { registry } = setup();
    expect(registry.now()).toBe(0);
    registry.update(16);
    registry.update(16);
    expect(registry.now()).toBe(32);
  });

  it('suppresses rendering and scheduler together, without catching up afterwards', () => {
    const { registry, emitter, layer } = setup(8);
    let ticks = 0;
    registry.registerEmission((_deltaMs, nowMs) => {
      ticks += 1;
      emitter.pool.acquire(1, nowMs, 10_000);
    });

    registry.update(16);
    registry.update(16);
    expect(ticks).toBe(2);
    expect(emitter.pool.getStats().activeSlots).toBe(2);

    registry.setSuppressed(true);
    expect(layer.visible).toBe(false);
    // Laufendes Material verschwindet sofort – GPU-Zeit laesst sich nicht einfrieren.
    expect(emitter.pool.getStats().activeSlots).toBe(0);

    for (let frame = 0; frame < 60; frame += 1) registry.update(16);
    expect(ticks).toBe(2);

    registry.setSuppressed(false);
    expect(layer.visible).toBe(true);
    registry.update(16);
    // Kein Nachhol-Burst: genau ein Tick fuer den einen Frame nach der Freigabe.
    expect(ticks).toBe(3);
  });

  it('is idempotent about the suppression state', () => {
    const { registry, layer } = setup();
    registry.setSuppressed(true);
    registry.setSuppressed(true);
    expect(registry.isSuppressed()).toBe(true);
    registry.setSuppressed(false);
    expect(layer.visible).toBe(true);
    expect(registry.isSuppressed()).toBe(false);
  });

  it('retires live members when a layer clock wraps', () => {
    // `ElapseTimer` setzt `timeElapsed` nach einer Stunde zurueck, ohne die `creationTime` der
    // Member mitzuziehen. Ohne Eingriff extrapolieren deren Animationen schlagartig weit ueber
    // ihr Ende hinaus – additiv also ein Vollbild-Blitz.
    const { registry, emitter, layer } = setup(8);
    registry.registerEmission((_deltaMs, nowMs) => { emitter.pool.acquire(1, nowMs, 10_000); });

    layer.timeElapsed = 3_599_900;
    registry.update(16);
    registry.update(16);
    expect(emitter.pool.getStats().activeSlots).toBe(2);

    layer.timeElapsed = 100;
    registry.update(16);
    // Alles vor dem Ruecksprung ist still; nur der Spawn dieses Frames lebt noch.
    expect(emitter.pool.getStats().activeSlots).toBe(1);
  });

  it('reports stats per registered effect', () => {
    const scene = makeFakeGpuVfxScene();
    const registry = new GpuVfxRegistry(scene as never);
    expect(registry.getStats()).toBeNull();

    const a = registry.createEmitter({ name: 'alpha', texture: 't', capacity: 4, depth: 1, eases: [] });
    registry.createEmitter({ name: 'beta', texture: 't', capacity: 6, depth: 2, eases: [] });
    a.pool.acquire(1, 0, 100);

    const stats = registry.getStats();
    expect(Object.keys(stats ?? {})).toEqual(['alpha', 'beta']);
    expect(stats?.alpha.activeSlots).toBe(1);
    expect(stats?.alpha.capacity).toBe(4);
    expect(stats?.beta.activeSlots).toBe(0);
    expect(stats?.beta.capacity).toBe(6);
  });
});
