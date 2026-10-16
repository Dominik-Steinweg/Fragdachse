import { describe, expect, it, vi } from 'vitest';

const water = vi.hoisted(() => ({ blooms: [] as unknown[] }));
vi.mock('../src/arena/WaterSurfaceRenderer', () => ({
  WaterSurfaceRenderer: { for: () => ({ setVoidBloom: (bloom: unknown) => water.blooms.push(bloom) }) },
}));

import { KRAKEN_POND_VOID, KrakenPondVoid, krakenPondReleaseAt, krakenPondVoidState } from '../src/effects/kraken/KrakenPondVoid';
import { CELL_SIZE } from '../src/config';
import type { BossIntroState } from '../src/config/bossIntros';

const reach = 480;

describe('kraken pond void timeline', () => {
  it('waits for the camera, spreads from the anchor to every shore and floods once on the roar', () => {
    expect(krakenPondVoidState(0, reach, null).grade).toBe(0);
    const early = krakenPondVoidState(KRAKEN_POND_VOID.spreadStartMs + 300, reach, null);
    const mid = krakenPondVoidState((KRAKEN_POND_VOID.spreadStartMs + KRAKEN_POND_VOID.spreadEndMs) / 2, reach, null);
    const done = krakenPondVoidState(KRAKEN_POND_VOID.spreadEndMs, reach, null);
    expect(early.frontPx).toBeGreaterThan(0);
    expect(mid.frontPx).toBeGreaterThan(early.frontPx);
    expect(done.frontPx).toBeGreaterThan(reach);
    expect(done.grade).toBe(1);
    const roar = krakenPondVoidState(KRAKEN_POND_VOID.pulseAtMs, reach, null).pulse;
    expect(roar).toBeCloseTo(1);
    expect(krakenPondVoidState(KRAKEN_POND_VOID.pulseAtMs + 2000, reach, null).pulse).toBeLessThan(0.2);
  });

  it('holds through the fight and recedes to nothing after the kill', () => {
    const fight = 60_000;
    expect(krakenPondVoidState(fight, reach, null).grade).toBe(1);
    const receding = krakenPondVoidState(fight, reach, KRAKEN_POND_VOID.releaseMs / 2);
    expect(receding.frontPx).toBeLessThan(reach);
    expect(krakenPondVoidState(fight, reach, KRAKEN_POND_VOID.releaseMs).grade).toBe(0);
    expect(krakenPondReleaseAt({ kind: 'dying', startedAt: 10, endsAt: 20, terminalPose: 0, asset: 'water', submerged: false } as never)).toBe(10);
    expect(krakenPondReleaseAt({ kind: 'removed', removedAt: 30 } as never)).toBe(30);
    expect(krakenPondReleaseAt({ kind: 'surfaced', startedAt: 1, nextDiveAt: 2 } as never)).toBeNull();
  });
});

describe('kraken pond void presentation', () => {
  it('grades the scene water and lights the pond from its own cells, then restores both', () => {
    water.blooms.length = 0;
    const setGroundGlowLights = vi.fn();
    const metrics = { offsetX: 100, offsetY: 50 } as never;
    const layout = { water: Array.from({ length: 12 }, (_, i) => ({ gridX: 10 + i, gridY: 9 })) } as never;
    const pond = new KrakenPondVoid({} as never, { setGroundGlowLights } as never, () => ({ layout, metrics }));
    const state: BossIntroState = { preset: 'kraken-rise', habitatId: 'pond', waterAnchorId: 'center',
      x: 100 + 15.5 * CELL_SIZE, y: 50 + 9.5 * CELL_SIZE, startedAtMs: 1000, seed: 3 };
    pond.sync(state, 1000 + KRAKEN_POND_VOID.spreadEndMs);
    expect(water.blooms.at(-1)).toMatchObject({ x: state.x, y: state.y, grade: 1 });
    const frame = setGroundGlowLights.mock.calls.at(-1)![1];
    expect(frame.lightCount).toBeGreaterThan(0);
    expect(frame.lights.every((light: { intensity: number }) => light.intensity > 0)).toBe(true);
    pond.sync(null, 9000);
    expect(water.blooms.at(-1)).toBeNull();
    expect(setGroundGlowLights).toHaveBeenLastCalledWith(pond, null);
  });
});
