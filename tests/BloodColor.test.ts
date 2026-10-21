import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
import * as enemyConfig from '../src/config/coopDefenseEnemies';
import { BloodChannel, BloodFieldModel, BloodMarkKind, type BloodPoolFeed } from '../src/effects/blood/BloodFieldModel';
import { BloodMarkPlanner } from '../src/effects/blood/BloodMarkPlanner';
import { createBloodLanding } from '../src/effects/blood/BloodTerrain';

const feed = (over: Partial<BloodPoolFeed> = {}): BloodPoolFeed => ({
  x: 100, y: 100, area: 100, channel: BloodChannel.Ground, atMs: 0, spreadMs: 500, lifeMs: 10_000, maxLifeMs: 15_000,
  shrinkMs: 3_000, maxRadiusPx: 40, growCore: 0.6, mergeMarginPx: 8, seed: 0.5, ...over,
});

describe('authored blood colour', () => {
  it('accepts an optional 0xRRGGBB blood colour per enemy kind and rejects anything else', () => {
    const base = enemyConfig.getCoopDefenseEnemyConfig(enemyConfig.COOP_DEFENSE_ENEMY_KINDS[0]);
    const registry = (bloodColor: unknown) => enemyConfig.normalizeEnemyRegistry({ enemies: [{ ...base, id: 'probe', bloodColor }] } as never);
    expect(registry(0x39af3f).probe.bloodColor).toBe(0x39af3f);
    expect(registry(undefined).probe.bloodColor).toBeUndefined();
    expect(() => registry(-1)).toThrow(/blood color/);
    expect(() => registry(0x1000000)).toThrow(/blood color/);
    expect(() => registry(1.5)).toThrow(/blood color/);
  });

  it('merges pools only with blood of the same colour and keeps the colour pass off for red', () => {
    const model = new BloodFieldModel(16);
    model.feedPool(feed());
    expect(model.tintedCount).toBe(0);
    expect(model.feedPool(feed({ color: 0x39af3f })).grew).toBe(false);
    expect(model.feedPool(feed({ color: 0x39af3f, atMs: 100 })).grew).toBe(true);
    expect(model.feedPool(feed({ color: 0x39af40, atMs: 200 })).grew).toBe(false);
    expect(model.tintedCount).toBe(2);
    model.update(20_000, 16, 1, 900);
    expect(model.count).toBe(0);
    expect(model.tintedCount).toBe(0);
  });

  it('colours every mark of a hit with the hit body\'s blood', () => {
    const model = new BloodFieldModel(256), planner = new BloodMarkPlanner(model);
    planner.beginFrame(0);
    planner.beginHit({ x: 300, y: 300, dirX: 1, dirY: 0, totalDamage: 60, isKill: true, seed: 9, nowMs: 0, color: 0x5522aa });
    for (let i = 0; i < 6; i++) {
      planner.flight('streak', planner.land(300, 300, 340 + i * 6, 300 + i * 3, 0.9, createBloodLanding()), 300, 300, 0.6, 1, 120);
    }
    planner.endHit();
    expect(model.count).toBeGreaterThan(3);
    expect(model.tintedCount).toBe(model.count);
    expect(model.countOf(BloodMarkKind.Pool)).toBeGreaterThan(0);
  });
});
