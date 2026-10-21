import { describe, expect, it } from 'vitest';
import { BloodChannel, BloodFieldModel, BloodMarkKind, type BloodPoolFeed } from '../src/effects/blood/BloodFieldModel';

const feed = (over: Partial<BloodPoolFeed> = {}): BloodPoolFeed => ({
  x: 100, y: 100, area: 100, channel: BloodChannel.Ground, atMs: 0, spreadMs: 500, lifeMs: 10_000, maxLifeMs: 15_000,
  shrinkMs: 3_000, maxRadiusPx: 40, growCore: 0.6, mergeMarginPx: 8, seed: 0.5, ...over,
});

const splat = (model: BloodFieldModel, bornAtMs: number, endAtMs = bornAtMs + 10_000) => model.add({
  kind: BloodMarkKind.Splat, channel: BloodChannel.Ground, x: 0, y: 0, angle: 0, r0: 2, r1: 6, seed: 0.3,
  bornAtMs, spreadMs: 90, endAtMs, shrinkMs: 3_000,
});

describe('BloodFieldModel', () => {
  it('grows one pool when blood keeps falling on it instead of stacking new ones', () => {
    const model = new BloodFieldModel(64);
    const first = model.feedPool(feed());
    const second = model.feedPool(feed({ x: 103, y: 101, atMs: 600 }));
    expect(second.grew).toBe(true);
    expect(second.slot).toBe(first.slot);
    expect(model.countOf(BloodMarkKind.Pool)).toBe(1);
    expect(model.mark(first.slot)!.area).toBe(200);
    expect(second.radius).toBeGreaterThan(first.radius);
  });

  it('keeps distant pools and other receivers apart', () => {
    const model = new BloodFieldModel(64);
    model.feedPool(feed());
    expect(model.feedPool(feed({ x: 200 })).grew).toBe(false);
    expect(model.feedPool(feed({ channel: BloodChannel.Rock })).grew).toBe(false);
    expect(model.countOf(BloodMarkKind.Pool)).toBe(3);
  });

  it('caps a growing pool and extends its life without exceeding the maximum', () => {
    const model = new BloodFieldModel(8);
    const { slot } = model.feedPool(feed({ area: 10_000 }));
    expect(model.mark(slot)!.r1).toBeLessThanOrEqual(40);
    expect(model.feedPool(feed({ atMs: 5_000, area: 50 })).grew).toBe(true);
    expect(model.mark(slot)!.endAtMs).toBeLessThanOrEqual(15_000 + 1);
    expect(model.mark(slot)!.endAtMs).toBeGreaterThan(14_000);
    // A pool already withdrawing is not revived; fresh blood starts its own pool there.
    expect(model.feedPool(feed({ atMs: 13_000, area: 50 })).grew).toBe(false);
  });

  it('removes marks after their life and reports receiver bounds', () => {
    const model = new BloodFieldModel(8);
    splat(model, 0, 1_000);
    model.update(500, 8, 1, 900);
    expect(model.count).toBe(1);
    expect(model.bounds(BloodChannel.Ground).count).toBe(1);
    model.update(1_001, 8, 1, 900);
    expect(model.count).toBe(0);
    expect(model.bounds(BloodChannel.Ground).count).toBe(0);
  });

  it('lets the oldest marks dry out early under budget pressure instead of popping them', () => {
    const model = new BloodFieldModel(16);
    for (let i = 0; i < 10; i++) splat(model, i * 10);
    model.update(200, 8, 1, 900);
    // Nothing disappears in the same frame; the two oldest marks now end soon.
    expect(model.count).toBe(10);
    expect(model.mark(0)!.endAtMs).toBeLessThan(200 + 901);
    expect(model.mark(1)!.endAtMs).toBeLessThan(200 + 901);
    expect(model.mark(2)!.endAtMs).toBeCloseTo(10_020, 1);
    model.update(1_200, 8, 1, 900);
    expect(model.count).toBe(8);
  });

  it('never exceeds its capacity and changes its version only with its data', () => {
    const model = new BloodFieldModel(4);
    for (let i = 0; i < 9; i++) splat(model, i);
    expect(model.count).toBe(4);
    const version = model.version;
    model.update(10, 4, 1, 900);
    expect(model.version).toBe(version);
    model.clear(50);
    expect(model.count).toBe(0);
    expect(model.version).not.toBe(version);
  });
});
