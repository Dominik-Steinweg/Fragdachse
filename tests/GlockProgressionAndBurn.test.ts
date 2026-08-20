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

import {
  runWeaponSingleTargetBenchmark,
  runWeaponSingleTargetBenchmarkSet,
} from '../src/debug/coopDefenseBalance/weaponBenchmark';
import { analyzeWeaponSingleTargetProgression } from '../src/debug/coopDefenseBalance/progressionAnalyzer';
import { WEAPON_CONFIGS, type WeaponConfig } from '../src/loadout/LoadoutConfig';

describe('Glock Single-Target Progression & Shared Burn Verification', () => {
  describe('1. Glock Burn-Simulation & Schadensaufteilung', () => {
    it('trennt Direktschaden und Brandschaden sauber auf und verbucht damageKind: burn', () => {
      const glockWithBurn: WeaponConfig = {
        ...WEAPON_CONFIGS.GLOCK,
        burnOnHit: {
          durationMs: 2000,
          damagePerTick: 4,
        },
      };

      const result = runWeaponSingleTargetBenchmark({
        weaponId: 'GLOCK',
        weaponConfigOverride: glockWithBurn,
        sourceSlot: 'weapon1',
        durationMs: 5000,
        seed: 1,
      });

      expect(result.directDamage).toBeGreaterThan(0);
      expect(result.burnDamage).toBeGreaterThan(0);
      expect(result.totalDamage).toBe(result.directDamage + result.burnDamage);
      expect(result.dps).toBeCloseTo(result.totalDamage / 5, 2);
      expect(result.directDps).toBeCloseTo(result.directDamage / 5, 2);
      expect(result.burnDps).toBeCloseTo(result.burnDamage / 5, 2);

      const burnEvents = result.damageEvents.filter((e) => e.damageKind === 'burn');
      const directEvents = result.damageEvents.filter((e) => e.damageKind === 'direct');
      expect(burnEvents.length).toBeGreaterThan(0);
      expect(directEvents.length).toBeGreaterThan(0);
      expect(result.damageEvents.length).toBe(burnEvents.length + directEvents.length);
    });

    it('erzeugt durch Brand kein zusätzliches normales adrenalinGain', () => {
      const glockBase = runWeaponSingleTargetBenchmark({
        weaponId: 'GLOCK',
        sourceSlot: 'weapon1',
        durationMs: 5000,
        seed: 1,
      });

      const glockWithBurn: WeaponConfig = {
        ...WEAPON_CONFIGS.GLOCK,
        burnOnHit: {
          durationMs: 2000,
          damagePerTick: 4,
        },
      };

      const glockBurn = runWeaponSingleTargetBenchmark({
        weaponId: 'GLOCK',
        weaponConfigOverride: glockWithBurn,
        sourceSlot: 'weapon1',
        durationMs: 5000,
        seed: 1,
      });

      // Adrenalin entsteht ausschließlich pro abgefeuertem Projektiltreffer (Hits), nicht durch Brand-Ticks
      expect(glockBurn.adrenalineGenerated).toBe(glockBase.adrenalineGenerated);
    });
  });

  describe('2. Step-Invarianz mit kontinuierlicher Impact-Zeit', () => {
    it('liefert identischen Gesamtschaden und äquivalente Burn-Semantik für stepDeltaMs 8, 16 und 25', () => {
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

      expect(res8.directDamage).toBe(res16.directDamage);
      expect(res16.directDamage).toBe(res25.directDamage);

      // Durch kontinuierliche Impact-Zeit ist der Brandschaden bei 8ms und 16ms exakt identisch und bei 25ms innerhalb 1 Tick Abweichung
      expect(res8.burnDamage).toBe(res16.burnDamage);
      expect(Math.abs(res16.burnDamage - res25.burnDamage)).toBeLessThanOrEqual(4);
      expect(res8.totalDamage).toBe(res16.totalDamage);
    });
  });

  describe('3. Settle Phase & Truncation', () => {
    it('lässt Brandschaden in der Settle-Phase vollständig auslaufen', () => {
      const glockWithBurn: WeaponConfig = {
        ...WEAPON_CONFIGS.GLOCK,
        burnOnHit: {
          durationMs: 2000,
          damagePerTick: 4,
        },
      };

      const res = runWeaponSingleTargetBenchmark({
        weaponId: 'GLOCK',
        weaponConfigOverride: glockWithBurn,
        sourceSlot: 'weapon1',
        durationMs: 2000,
        maxSettleDurationMs: 5000,
      });

      expect(res.settleDurationMs).toBeGreaterThan(1500); // Brand läuft ~2000ms nach
      expect(res.settleTruncated).toBeFalsy();
    });

    it('erkennt settleTruncated = true, wenn maxSettleDurationMs den Brand vorzeitig abbricht', () => {
      const glockWithBurn: WeaponConfig = {
        ...WEAPON_CONFIGS.GLOCK,
        burnOnHit: {
          durationMs: 3000,
          damagePerTick: 4,
        },
      };

      const res = runWeaponSingleTargetBenchmark({
        weaponId: 'GLOCK',
        weaponConfigOverride: glockWithBurn,
        sourceSlot: 'weapon1',
        durationMs: 1000,
        maxSettleDurationMs: 50, // Viel zu kurz, Brand bricht ab
      });

      expect(res.settleTruncated).toBe(true);
    });
  });

  describe('4. Vollständige Glock Single-Target Progression über alle 5 Stufen', () => {
    it('analysiert GLOCK deterministisch über Base, Early, Mid, Late, Endgame mit provenMaximum = true', () => {
      const progression = analyzeWeaponSingleTargetProgression({
        weaponId: 'GLOCK',
        slot: 'weapon1',
        durationMs: 30_000,
      });

      expect(progression.stages.length).toBe(5);

      const base = progression.stages.find((s) => s.stage === 'base')!;
      const early = progression.stages.find((s) => s.stage === 'early')!;
      const mid = progression.stages.find((s) => s.stage === 'mid')!;
      const late = progression.stages.find((s) => s.stage === 'late')!;
      const endgame = progression.stages.find((s) => s.stage === 'endgame')!;

      // Base: reine Direktschüsse (6 Schaden, die neue Window-Grenze zaehlt den
      // Treffer exakt am Ende nicht mehr mit: ~13.4 DPS statt des alten ~13.6-Werts)
      expect(base.bestSupportedExpectedDps).toBeCloseTo(13.4, 1);
      expect(base.provenMaximum).toBe(true);

      // Early (3 Punkte): Glock hat keine Direktschadens-Upgrades in Early.
      expect(early.bestSupportedExpectedDps).toBeCloseTo(13.4, 1);
      expect(early.provenMaximum).toBe(true);

      // Mid (5 normal / 1 boss): glock_burning_bullets (Boss) schaltet Brand frei -> massiver DPS-Sprung auf ~104.6 DPS!
      expect(mid.bestSupportedExpectedDps).toBeGreaterThan(early.bestSupportedExpectedDps * 2);
      expect(mid.bestSupportedBuild?.levels.glock_burning_bullets).toBe(1);
      expect(mid.bestSupportedBuild?.levels.glock_burning_bullets_damage).toBe(3);
      expect(mid.provenMaximum).toBe(true);

      // Late (10 normal / 2 boss) & Endgame (20 normal / 2 boss): Glock-Baum ist bereits in Mid voll ausgebaut
      expect(late.bestSupportedExpectedDps).toBeGreaterThanOrEqual(mid.bestSupportedExpectedDps);
      expect(late.provenMaximum).toBe(true);
      expect(endgame.bestSupportedExpectedDps).toBeGreaterThanOrEqual(late.bestSupportedExpectedDps);
      expect(endgame.provenMaximum).toBe(true);
    });
  });
});
