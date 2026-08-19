import { describe, expect, it, vi } from 'vitest';

import { GPU_VFX_NO_SLOT, GpuVfxPool, type GpuVfxLayerHandle } from '../src/effects/gpu/GpuVfxPool';

/** Stride eines Members in Bytes: 42 Float32-Woerter. */
const MEMBER_BYTES = 42 * 4;

interface FakeLayer extends GpuVfxLayerHandle {
  readonly added: object[];
  readonly edited: number[];
  readonly patched: number[];
  readonly patchMasks: number[][];
}

function fakeLayer(size = 8): FakeLayer {
  const added: object[] = [];
  const edited: number[] = [];
  const patched: number[] = [];
  const patchMasks: number[][] = [];
  return {
    size,
    added,
    edited,
    patched,
    patchMasks,
    getDataByteSize: () => MEMBER_BYTES,
    addMember: (member) => { added.push(member); return undefined; },
    editMember: (index) => { edited.push(index); return undefined; },
    patchMember: (index, _data, mask) => { patched.push(index); patchMasks.push(mask ?? []); },
  };
}

function primedPool(size = 8): { pool: GpuVfxPool; layer: FakeLayer } {
  const layer = fakeLayer(size);
  const pool = new GpuVfxPool(layer, size, 'test');
  pool.prime({ scaleX: 0, scaleY: 0, alpha: 0 });
  return { pool, layer };
}

describe('gpu vfx pool', () => {
  it('creates every member once up front and never again', () => {
    const { pool, layer } = primedPool(8);
    expect(layer.added.length).toBe(8);

    pool.prime({ scaleX: 0, scaleY: 0, alpha: 0 });
    expect(layer.added.length).toBe(8);
  });

  it('hands out slots in ring order', () => {
    const { pool } = primedPool(4);
    expect(pool.acquire(1, 0, 100)).toBe(0);
    expect(pool.acquire(1, 0, 100)).toBe(1);
    expect(pool.acquire(1, 0, 100)).toBe(2);
    expect(pool.getStats().activeSlots).toBe(3);
  });

  it('reuses a slot only after its member expired', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pool } = primedPool(4);
    for (let n = 0; n < 4; n += 1) pool.acquire(1, 0, 100);

    // Ring voll, nichts abgelaufen: kein Slot, kein Ueberschreiben.
    expect(pool.acquire(1, 50, 100)).toBe(GPU_VFX_NO_SLOT);
    warn.mockRestore();

    pool.retireExpired(100);
    expect(pool.getStats().activeSlots).toBe(0);
    expect(pool.acquire(1, 100, 100)).toBe(0);
  });

  it('never overwrites a living slot and reports the overrun', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pool, layer } = primedPool(2);
    pool.acquire(1, 0, 1000);
    pool.acquire(1, 0, 1000);
    layer.edited.length = 0;

    expect(pool.acquire(1, 10, 1000)).toBe(GPU_VFX_NO_SLOT);
    expect(pool.acquire(1, 10, 1000)).toBe(GPU_VFX_NO_SLOT);

    const stats = pool.getStats();
    expect(stats.overruns).toBe(2);
    expect(stats.activeSlots).toBe(2);
    // Nichts wurde still ueberschrieben, und die Warnung kommt genau einmal.
    expect(layer.edited).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('retires an expired slot exactly once, masking scale and alpha', () => {
    const { pool, layer } = primedPool(4);
    pool.acquire(7, 0, 100);
    pool.acquire(7, 0, 300);

    pool.retireExpired(150);
    expect(layer.patched).toEqual([0]);

    // Zweiter Sweep ohne neuen Ablauf: kein weiterer Schreibzugriff.
    pool.retireExpired(200);
    expect(layer.patched).toEqual([0]);

    pool.retireExpired(300);
    expect(layer.patched).toEqual([0, 1]);

    // Maske trifft genau scaleX/scaleY/alpha (Woerter 12..23) und sonst nichts.
    const mask = layer.patchMasks[0];
    expect(mask.length).toBe(42);
    for (let word = 0; word < mask.length; word += 1) {
      expect(mask[word]).toBe(word >= 12 && word < 24 ? 1 : 0);
    }
  });

  it('retires out-of-order deaths without blocking on a long-lived slot', () => {
    // Lebenszeiten streuen (260..460 ms); ein langlebiger Slot am Fensteranfang darf juengere,
    // bereits abgelaufene Slots nicht am Stilllegen hindern.
    const { pool, layer } = primedPool(8);
    pool.acquire(1, 0, 1000);
    pool.acquire(1, 0, 100);
    pool.acquire(1, 0, 100);

    pool.retireExpired(200);
    expect(layer.patched).toEqual([1, 2]);
    expect(pool.getStats().activeSlots).toBe(1);
  });

  it('hides exactly the members of a vanished owner', () => {
    const { pool, layer } = primedPool(8);
    pool.acquire(1, 0, 1000);
    pool.acquire(2, 0, 1000);
    pool.acquire(1, 0, 1000);
    pool.acquire(2, 0, 1000);

    pool.releaseOwner(1);
    expect(layer.patched).toEqual([0, 2]);
    expect(pool.getStats().activeSlots).toBe(2);

    pool.releaseOwner(2);
    expect(layer.patched).toEqual([0, 2, 1, 3]);
    expect(pool.getStats().activeSlots).toBe(0);
  });

  it('clears everything on teardown and is idempotent', () => {
    const { pool, layer } = primedPool(4);
    pool.acquire(1, 0, 1000);
    pool.acquire(2, 0, 1000);

    pool.releaseAll();
    expect(layer.patched.length).toBe(2);
    expect(pool.getStats().activeSlots).toBe(0);

    pool.releaseAll();
    expect(layer.patched.length).toBe(2);

    // Ring steht wieder am Anfang und ist sofort wieder benutzbar.
    expect(pool.acquire(3, 0, 100)).toBe(0);
  });

  it('keeps the per-frame scan bounded by the live window, not by capacity', () => {
    const { pool } = primedPool(8);
    pool.acquire(1, 0, 100);
    pool.acquire(1, 0, 100);
    expect(pool.getStats().scanWindow).toBe(2);

    pool.retireExpired(100);
    expect(pool.getStats().scanWindow).toBe(0);

    pool.acquire(1, 100, 100);
    expect(pool.getStats().scanWindow).toBe(1);
  });

  it('survives many wrap-arounds without leaking active slots', () => {
    const { pool } = primedPool(4);
    let now = 0;
    for (let step = 0; step < 100; step += 1) {
      now += 50;
      pool.retireExpired(now);
      expect(pool.acquire(1, now, 100)).not.toBe(GPU_VFX_NO_SLOT);
    }
    // Bei 50 ms Takt und 100 ms Lebenszeit sind hoechstens zwei Slots gleichzeitig lebend.
    expect(pool.getStats().activeSlots).toBeLessThanOrEqual(2);
    expect(pool.getStats().overruns).toBe(0);
  });
});
