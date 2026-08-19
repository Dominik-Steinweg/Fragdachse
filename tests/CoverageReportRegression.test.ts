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
  generateWeaponBalanceCoverageData,
  generateWeaponBalanceCoverageReport,
} from '../src/debug/coopDefenseBalance/coverageReporter';
import { runWeaponSingleTargetBenchmark } from '../src/debug/coopDefenseBalance/weaponBenchmark';

describe('Coverage Report Regression & Source of Truth', () => {
  describe('1. Baseline DPS Regression Tests (Source of Truth)', () => {
    it('BITE Base erzielt exakt 86 Treffer / 4300 Schaden in 30s (~143.33 DPS)', () => {
      const result = runWeaponSingleTargetBenchmark({
        weaponId: 'BITE',
        sourceSlot: 'weapon1',
        durationMs: 30_000,
        seed: 1,
      });

      expect(result.shotsFired).toBe(86);
      expect(result.hits).toBe(86);
      expect(result.totalDamage).toBe(4300);
      expect(result.dps).toBeCloseTo(4300 / 30, 2); // 143.333...
    });

    it('P90 Base erzielt exakt 69 Treffer / 552 Schaden in 30s (18.4 DPS)', () => {
      const result = runWeaponSingleTargetBenchmark({
        weaponId: 'P90',
        sourceSlot: 'weapon2',
        durationMs: 30_000,
        seed: 1,
      });

      expect(result.shotsFired).toBe(69);
      expect(result.hits).toBe(69);
      expect(result.totalDamage).toBe(552);
      expect(result.dps).toBeCloseTo(18.4, 2);
    });

    it('ASMD_PRIM Base erzielt exakt 50 Treffer / 500 Schaden in 30s (~16.67 DPS)', () => {
      const result = runWeaponSingleTargetBenchmark({
        weaponId: 'ASMD_PRIM',
        sourceSlot: 'weapon1',
        durationMs: 30_000,
        seed: 1,
      });

      expect(result.shotsFired).toBe(50);
      expect(result.hits).toBe(50);
      expect(result.totalDamage).toBe(500);
      expect(result.dps).toBeCloseTo(500 / 30, 2); // 16.666...
    });

    it('GLOCK Base erzielt 68 Treffer / 408 Schaden in 30s (13.6 DPS)', () => {
      const result = runWeaponSingleTargetBenchmark({
        weaponId: 'GLOCK',
        sourceSlot: 'weapon1',
        durationMs: 30_000,
        seed: 1,
      });

      expect(result.shotsFired).toBe(68);
      expect(result.hits).toBe(68);
      expect(result.totalDamage).toBe(408);
      expect(result.dps).toBeCloseTo(13.6, 2);
    });
  });

  describe('2. Machine-Generated Coverage Reporter', () => {
    it('erzeugt verifizierte Coverage-Daten für alle 4 Waffen und formatiert Markdown fehlerfrei', () => {
      const weaponIds = ['GLOCK', 'P90', 'ASMD_PRIM', 'BITE'] as const;
      const data = generateWeaponBalanceCoverageData(weaponIds, {
        weaponSlots: {
          GLOCK: 'weapon1',
          P90: 'weapon2',
          ASMD_PRIM: 'weapon1',
          BITE: 'weapon1',
        },
      });

      expect(data.weapons.length).toBe(4);

      // BITE Base im Report prüfen
      const biteData = data.weapons.find((w) => w.weaponId === 'BITE')!;
      const biteBase = biteData.stages.find((s) => s.stage === 'base')!;
      expect(biteBase.expectedDps).toBeCloseTo(143.33, 1);
      expect(biteBase.provenMaximum).toBe(true);

      // P90 Base im Report prüfen
      const p90Data = data.weapons.find((w) => w.weaponId === 'P90')!;
      const p90Base = p90Data.stages.find((s) => s.stage === 'base')!;
      expect(p90Base.expectedDps).toBeCloseTo(18.4, 1);
      expect(p90Base.provenMaximum).toBe(true);

      // Markdown-Generierung testen
      const md = generateWeaponBalanceCoverageReport(weaponIds, {
        weaponSlots: {
          GLOCK: 'weapon1',
          P90: 'weapon2',
          ASMD_PRIM: 'weapon1',
          BITE: 'weapon1',
        },
      });

      expect(md).toContain('| **BITE** | `weapon1` | 143.3 DPS');
      expect(md).toContain('| **P90** | `weapon2` | 18.4 DPS');
      expect(md).toContain('| **ASMD_PRIM** | `weapon1` | 16.7 DPS');
      expect(md).toContain('| **GLOCK** | `weapon1` | 13.6 DPS');
    }, 45000);
  });
});
