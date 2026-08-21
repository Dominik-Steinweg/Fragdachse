import { describe, expect, it, vi } from 'vitest';

import {
  GPU_VFX_NO_SLOT,
  GpuVfxPool,
  type GpuVfxLayerHandle,
} from '../src/effects/gpu/GpuVfxPool';

/** Stride eines Members in Bytes: 42 Float32-Woerter. */
const MEMBER_BYTES = 42 * 4;

/** Phasers `SpriteGPULayer._segments`. */
const BUFFER_SEGMENTS = 24;

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

function primedPool(size = 8, maxSources = 8): { pool: GpuVfxPool; layer: FakeLayer } {
  const layer = fakeLayer(size);
  const pool = new GpuVfxPool(layer, size, 'test', maxSources);
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

  it('hands out slots in ascending ring order', () => {
    const { pool } = primedPool(4);
    expect(pool.acquire(1, 0, 100)).toBe(0);
    expect(pool.acquire(1, 0, 100)).toBe(1);
    expect(pool.acquire(1, 0, 100)).toBe(2);
    expect(pool.getStats().liveCount).toBe(3);
  });

  it('reuses a slot only after its member expired', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pool } = primedPool(4);
    for (let n = 0; n < 4; n += 1) pool.acquire(1, 0, 100);

    // Alles belegt, nichts abgelaufen: kein Slot, kein Ueberschreiben.
    expect(pool.acquire(1, 50, 100)).toBe(GPU_VFX_NO_SLOT);
    warn.mockRestore();

    pool.retireExpired(100);
    expect(pool.getStats().liveCount).toBe(0);
    expect(pool.acquire(1, 100, 100)).toBe(0);
  });

  it('never overwrites a living slot and reports the capacity drop', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pool, layer } = primedPool(2);
    pool.acquire(1, 0, 1000);
    pool.acquire(1, 0, 1000);
    layer.edited.length = 0;

    expect(pool.acquire(1, 10, 1000)).toBe(GPU_VFX_NO_SLOT);
    expect(pool.acquire(1, 10, 1000)).toBe(GPU_VFX_NO_SLOT);

    const stats = pool.getStats();
    expect(stats.capacityDrops).toBe(2);
    expect(stats.liveCount).toBe(2);
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
    // Lebenszeiten streuen; ein langlebiger Slot am Anfang darf juengere, bereits abgelaufene
    // Slots nicht am Stilllegen hindern.
    const { pool, layer } = primedPool(8);
    pool.acquire(1, 0, 1000);
    pool.acquire(1, 0, 100);
    pool.acquire(1, 0, 100);

    pool.retireExpired(200);
    expect(layer.patched.sort()).toEqual([1, 2]);
    expect(pool.getStats().liveCount).toBe(1);
  });

  it('hands out both free slots of a fragmented pool [live, free, free, live]', () => {
    const { pool } = primedPool(4);
    pool.acquire(1, 0, 1000); // Slot 0, langlebig
    pool.acquire(1, 0, 100);  // Slot 1
    pool.acquire(1, 0, 100);  // Slot 2
    pool.acquire(1, 0, 1000); // Slot 3, langlebig

    pool.retireExpired(150);
    expect(pool.getStats().liveCount).toBe(2);

    // Der Cursor steht hinter Slot 3, also auf 0 – und 0 lebt noch. Beide Luecken muessen
    // trotzdem vergeben werden, ohne lebendes Material anzutasten.
    expect(pool.acquire(2, 150, 100)).toBe(1);
    expect(pool.acquire(2, 150, 100)).toBe(2);
    expect(pool.acquire(2, 150, 100)).toBe(GPU_VFX_NO_SLOT);
    expect(pool.getStats().liveCount).toBe(4);
  });

  it('does not lose a spawn to a long-lived member sitting on the cursor', () => {
    const { pool } = primedPool(4);
    // Ringzyklus vollenden, damit der Cursor wieder auf 0 steht.
    pool.acquire(1, 0, 10_000);
    pool.acquire(1, 0, 100);
    pool.acquire(1, 0, 100);
    pool.acquire(1, 0, 100);
    pool.retireExpired(200);

    // Slot 0 lebt weiter, 1..3 sind frei: drei Spawns muessen durchgehen.
    for (let n = 0; n < 3; n += 1) {
      expect(pool.acquire(2, 200, 100)).not.toBe(GPU_VFX_NO_SLOT);
    }
    expect(pool.getStats().capacityDrops).toBe(0);
  });

  it('keeps slot indices ascending across a full wrap cycle', () => {
    // Die Zeichenreihenfolge innerhalb einer Lane ist die Slot-Reihenfolge. `rocket-smoke`
    // zeichnet NORMAL mit Alpha 0.95 – frische Puffs muessen ueber aelteren liegen.
    const { pool } = primedPool(8);
    let now = 0;
    let previous = -1;
    let wraps = 0;
    for (let step = 0; step < 40; step += 1) {
      now += 40;
      pool.retireExpired(now);
      const slot = pool.acquire(1, now, 100);
      expect(slot).not.toBe(GPU_VFX_NO_SLOT);
      if (slot <= previous) wraps += 1;
      else expect(slot).toBeGreaterThan(previous);
      previous = slot;
    }
    // Ueber 40 Spawns bei Kapazitaet 8 sind mehrere Zyklen zu erwarten, aber kein Zickzack.
    expect(wraps).toBeGreaterThan(2);
  });

  it('keeps the spawns of one frame inside few buffer segments', () => {
    // Regressionswaechter fuer die Buffer-Uploads: Phaser laedt je dirtyem Segment hoch und
    // kippt auf einen Vollupload, sobald alle belegten Segmente dirty sind.
    const capacity = 240;
    const { pool } = primedPool(capacity, 4);
    const segmentSize = Math.ceil(capacity / BUFFER_SEGMENTS);
    for (let n = 0; n < segmentSize + 2; n += 1) pool.acquire(1, 0, 1000);

    pool.beginFrame();
    const stats = pool.getStats();
    expect(stats.segmentsTouched).toBe(2);
    expect(stats.fullUploadFrames).toBe(0);
  });

  it('hides exactly the members of a vanished source', () => {
    const { pool, layer } = primedPool(8);
    pool.acquire(1, 0, 1000);
    pool.acquire(2, 0, 1000);
    pool.acquire(1, 0, 1000);
    pool.acquire(2, 0, 1000);

    pool.releaseSource(1);
    expect(layer.patched.slice().sort()).toEqual([0, 2]);
    expect(pool.getStats().liveCount).toBe(2);

    pool.releaseSource(2);
    expect(layer.patched.slice().sort()).toEqual([0, 1, 2, 3]);
    expect(pool.getStats().liveCount).toBe(0);
  });

  it('lets detached members live on and keeps a recycled source from claiming them', () => {
    const { pool, layer } = primedPool(8);
    pool.acquire(1, 0, 1000);
    pool.acquire(1, 0, 1000);

    // `linger`: die Quelle verschwindet, die Member laufen aus.
    pool.detachSource(1);
    expect(layer.patched).toEqual([]);
    expect(pool.getStats().liveCount).toBe(2);

    // Derselbe Index wird recycelt und spaeter hart freigegeben – die alten Member duerfen das
    // nicht mitbekommen.
    pool.acquire(1, 0, 1000);
    pool.releaseSource(1);
    expect(layer.patched).toEqual([2]);
    expect(pool.getStats().liveCount).toBe(2);

    // Erst ihr eigener Ablauf legt sie still.
    pool.retireExpired(1000);
    expect(pool.getStats().liveCount).toBe(0);
  });

  it('clears everything on teardown and is idempotent', () => {
    const { pool, layer } = primedPool(4);
    pool.acquire(1, 0, 1000);
    pool.acquire(2, 0, 1000);

    pool.releaseAll();
    expect(layer.patched.length).toBe(2);
    expect(pool.getStats().liveCount).toBe(0);

    pool.releaseAll();
    expect(layer.patched.length).toBe(2);

    // Cursor steht wieder am Anfang und der Pool ist sofort wieder benutzbar.
    expect(pool.acquire(3, 0, 100)).toBe(0);
  });

  it('retires only expired members, independent of the capacity', () => {
    const { pool, layer } = primedPool(512, 4);
    pool.acquire(1, 0, 100);
    pool.acquire(1, 0, 5000);
    pool.acquire(1, 0, 100);

    pool.retireExpired(100);
    // Der Sweep laeuft ueber die dichte Liste der Lebenden, nicht ueber die Kapazitaet.
    expect(layer.patched.slice().sort((a, b) => a - b)).toEqual([0, 2]);
    expect(pool.getStats().liveCount).toBe(1);
  });

  it('tracks the high water mark for the capacity decision', () => {
    const { pool } = primedPool(8);
    for (let n = 0; n < 5; n += 1) pool.acquire(1, 0, 100);
    pool.retireExpired(100);
    pool.acquire(1, 100, 100);

    const stats = pool.getStats();
    expect(stats.peakLive).toBe(5);
    expect(stats.liveCount).toBe(1);
    expect(stats.rearms).toBe(6);
    expect(stats.retirements).toBe(5);
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
    expect(pool.getStats().liveCount).toBeLessThanOrEqual(2);
    expect(pool.getStats().capacityDrops).toBe(0);
  });
});
