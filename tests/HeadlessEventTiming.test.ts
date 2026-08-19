import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class Line {
    x1 = 0; y1 = 0; x2 = 0; y2 = 0;
    constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) { this.setTo(x1, y1, x2, y2); }
    setTo(x1: number, y1: number, x2: number, y2: number) { this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2; return this; }
  }
  class Circle {
    x = 0; y = 0; radius = 0;
    constructor(x = 0, y = 0, radius = 0) { this.setTo(x, y, radius); }
    setTo(x: number, y: number, radius: number) { this.x = x; this.y = y; this.radius = radius; return this; }
  }
  class Rectangle {
    x = 0; y = 0; width = 0; height = 0;
    constructor(x = 0, y = 0, width = 0, height = 0) { this.setTo(x, y, width, height); }
    setTo(x: number, y: number, width: number, height: number) { this.x = x; this.y = y; this.width = width; this.height = height; return this; }
  }
  return {
    Geom: { Line, Circle, Rectangle, Intersects: { GetLineToCircle: () => [] } },
    Math: {
      Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
      Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
    },
  };
});

import { HeadlessSingleTargetWorld } from '../src/debug/coopDefenseBalance/HeadlessSingleTargetWorld';
import { runWeaponSingleTargetBenchmark } from '../src/debug/coopDefenseBalance/weaponBenchmark';
import { WEAPON_CONFIGS, type WeaponConfig } from '../src/loadout/LoadoutConfig';

describe('Headless Event Timing & Causal Correctness', () => {
  describe('1. Causal Non-Retroactivity Boundary Tests', () => {
    it('Impact nach Brandtick-Grenze (t = 260ms, Tick bei 250ms) erhält keinen rückwirkenden Schaden für Tick 250ms', () => {
      // Dummy at distance 150 (radius 16, collision distance 133px).
      // If projectile travels at speed 500 px/s:
      // Distance at 240ms = 0.24 * 500 = 120px (< 133px, no hit yet).
      // Distance at 265ms = 0.265 * 500 = 132.5px...
      // Let's set speed so hit lands exactly at t = 260ms:
      // speed = 133 / 0.260 = 511.538461538 px/s.
      const world = new HeadlessSingleTargetWorld(150, 1, true);
      const targetDistToCollision = 150 - world.target.radius; // 134px if radius=16, let's check exact:
      const colDist = 150 - (world.target.radius + 1); // 133px for size 2
      const speed = colDist / 0.260; // Hits at exactly 260ms!

      world.setTime(0);
      world.spawnProjectile(0, 0, 0, 'shooter_1', {
        speed,
        size: 2,
        damage: 10,
        lifetime: 1000,
        burnDurationMs: 2000,
        burnDamagePerTick: 5,
        sourceId: 'test_gun',
      });

      // Advance from 0 to 240ms in single step
      world.step(240);
      expect(world.getHits()).toBe(0);
      expect(world.getDirectDamage()).toBe(0);
      expect(world.getBurnDamage()).toBe(0);

      // Now step from 240ms to 265ms (covers tick 250ms and impact 260ms)
      world.step(25); // 240 + 25 = 265ms

      // Impact occurred at 260ms -> 1 Hit, 10 direct damage
      expect(world.getHits()).toBe(1);
      expect(world.getDirectDamage()).toBe(10);

      // CRITICAL: Tick 250ms occurred BEFORE impact 260ms, so burn damage at 265ms MUST BE 0!
      expect(world.getBurnDamage()).toBe(0);

      // Advance to 500ms (next tick)
      world.step(235); // 265 + 235 = 500ms
      // Now tick 500ms has executed -> 5 burn damage!
      expect(world.getBurnDamage()).toBe(5);
    });

    it('Impact vor Brandtick-Grenze (t = 240ms, Tick bei 250ms) erhält pünktlich Schaden bei Tick 250ms', () => {
      const world = new HeadlessSingleTargetWorld(150, 1, true);
      const colDist = 150 - (world.target.radius + 1);
      const speed = colDist / 0.240; // Hits at exactly 240ms!

      world.setTime(0);
      world.spawnProjectile(0, 0, 0, 'shooter_1', {
        speed,
        size: 2,
        damage: 10,
        lifetime: 1000,
        burnDurationMs: 2000,
        burnDamagePerTick: 5,
        sourceId: 'test_gun',
      });

      // Step from 0 to 265ms in one step (covers impact at 240ms, then tick at 250ms)
      world.step(265);

      expect(world.getHits()).toBe(1);
      expect(world.getDirectDamage()).toBe(10);
      // Impact was at 240ms, tick was at 250ms -> burn damage MUST be 5!
      expect(world.getBurnDamage()).toBe(5);
    });
  });

  describe('2. Absolute Step Invariance (8ms, 16ms, 25ms)', () => {
    it('erzielt exakt dieselben Schüsse, Treffer, Direktschäden und Brandschäden ohne Toleranz', () => {
      const glockWithBurn: WeaponConfig = {
        ...WEAPON_CONFIGS.GLOCK,
        burnOnHit: {
          durationMs: 2000,
          damagePerTick: 4,
        },
      };

      const res8 = runWeaponSingleTargetBenchmark({
        weaponId: 'GLOCK',
        weaponConfigOverride: glockWithBurn,
        sourceSlot: 'weapon1',
        durationMs: 10_000,
        stepDeltaMs: 8,
        seed: 42,
      });

      const res16 = runWeaponSingleTargetBenchmark({
        weaponId: 'GLOCK',
        weaponConfigOverride: glockWithBurn,
        sourceSlot: 'weapon1',
        durationMs: 10_000,
        stepDeltaMs: 16,
        seed: 42,
      });

      const res25 = runWeaponSingleTargetBenchmark({
        weaponId: 'GLOCK',
        weaponConfigOverride: glockWithBurn,
        sourceSlot: 'weapon1',
        durationMs: 10_000,
        stepDeltaMs: 25,
        seed: 42,
      });

      expect(res8.shotsFired).toBe(res16.shotsFired);
      expect(res16.shotsFired).toBe(res25.shotsFired);

      expect(res8.hits).toBe(res16.hits);
      expect(res16.hits).toBe(res25.hits);

      expect(res8.directDamage).toBe(res16.directDamage);
      expect(res16.directDamage).toBe(res25.directDamage);

      // Exakte Gleichheit der Brandschäden!
      expect(res8.burnDamage).toBe(res16.burnDamage);
      expect(res16.burnDamage).toBe(res25.burnDamage);

      expect(res8.totalDamage).toBe(res16.totalDamage);
      expect(res16.totalDamage).toBe(res25.totalDamage);
    });
  });

  describe('3. Attribution & Source-Key Parity', () => {
    it('verwendet weapon:sourceId als Source-Key und den übergebenen ownerId', () => {
      const world = new HeadlessSingleTargetWorld(150, 1, true);
      const colDist = 150 - (world.target.radius + 1);
      const speed = colDist / 0.100;

      world.setTime(0);
      world.spawnProjectile(0, 0, 0, 'player_alpha', {
        speed,
        size: 2,
        damage: 10,
        lifetime: 1000,
        burnDurationMs: 2000,
        burnDamagePerTick: 5,
        sourceId: 'plasma_rifle',
      });

      world.step(150); // Impact at 100ms

      const sources = world.burnStateMachine.getActiveSources(world.target.id, 150);
      expect(sources.length).toBe(1);
      expect(sources[0].attackerId).toBe('player_alpha');
      expect(sources[0].sourceId).toBe('plasma_rifle');
      expect(sources[0].sourceKey).toBe('weapon:plasma_rifle');
    });
  });
});
