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

import { analyzeWeaponSingleTargetProgression } from '../../src/debug/coopDefenseBalance/progressionAnalyzer';
import { runWeaponSingleTargetBenchmark } from '../../src/debug/coopDefenseBalance/weaponBenchmark';
import { WEAPON_CONFIGS, type WeaponConfig } from '../../src/loadout/LoadoutConfig';

describe('Bite Progression & hitAdrenaline Support', () => {
  describe('1. hitAdrenaline Benchmark Verifikation', () => {
    it('verrechnet hitAdrenaline zusätzlich zum normalen adrenalinGain pro Treffer', () => {
      const biteBase = runWeaponSingleTargetBenchmark({
        weaponId: 'BITE',
        sourceSlot: 'weapon1',
        durationMs: 5000,
        seed: 1,
      });

      const biteWithHitAdrenaline: WeaponConfig = {
        ...WEAPON_CONFIGS.BITE,
        hitAdrenaline: 10,
      };

      const biteEnhanced = runWeaponSingleTargetBenchmark({
        weaponId: 'BITE',
        weaponConfigOverride: biteWithHitAdrenaline,
        sourceSlot: 'weapon1',
        durationMs: 5000,
        seed: 1,
      });

      expect(biteEnhanced.shotsFired).toBe(biteBase.shotsFired);
      expect(biteEnhanced.hits).toBe(biteBase.hits);
      expect(biteEnhanced.totalDamage).toBe(biteBase.totalDamage);

      // Basis adrenalinGain = 50, zusätzliches hitAdrenaline = 10 -> 60 pro Treffer
      expect(biteEnhanced.adrenalineGenerated).toBe(biteBase.adrenalineGenerated + biteEnhanced.hits * 10);
    });
  });

  describe('2. Vollständige BITE Single-Target Progression', () => {
    it('evaluiert BITE deterministisch über alle 5 Stufen mit provenMaximum = true', () => {
      const progression = analyzeWeaponSingleTargetProgression({
        weaponId: 'BITE',
        slot: 'weapon1',
        durationMs: 30_000,
      });

      expect(progression.stages.length).toBe(5);

      const base = progression.stages.find((s) => s.stage === 'base')!;
      const early = progression.stages.find((s) => s.stage === 'early')!;
      const mid = progression.stages.find((s) => s.stage === 'mid')!;
      const late = progression.stages.find((s) => s.stage === 'late')!;
      const endgame = progression.stages.find((s) => s.stage === 'endgame')!;

      // Base: 50 Schaden, 350ms Cooldown -> ~143.33 DPS
      expect(base.bestSupportedExpectedDps).toBeCloseTo(143.33, 1);
      expect(base.provenMaximum).toBe(true);

      // Early (3 Punkte): bite_damage (3x +10% -> 65 Schaden) -> ~186.3 DPS
      expect(early.bestSupportedExpectedDps).toBeGreaterThan(base.bestSupportedExpectedDps);
      expect(early.provenMaximum).toBe(true);

      // Mid (5 normal / 1 boss): bite_damage: 3 (max) -> ~186.3 DPS
      expect(mid.bestSupportedExpectedDps).toBeGreaterThanOrEqual(early.bestSupportedExpectedDps);
      expect(mid.bestSupportedBuild?.levels.bite_damage).toBe(3);
      expect(mid.provenMaximum).toBe(true);
      expect(mid.unsupportedCandidates).toBe(0);

      // Late (10 normal / 2 boss) & Endgame (20 normal / 2 boss): Bite-Baum ist voll ausgebaut
      expect(late.bestSupportedExpectedDps).toBeGreaterThanOrEqual(mid.bestSupportedExpectedDps);
      expect(late.provenMaximum).toBe(true);
      expect(late.unsupportedCandidates).toBe(0);

      expect(endgame.bestSupportedExpectedDps).toBeGreaterThanOrEqual(late.bestSupportedExpectedDps);
      expect(endgame.provenMaximum).toBe(true);
      expect(endgame.unsupportedCandidates).toBe(0);
    });
  });
});