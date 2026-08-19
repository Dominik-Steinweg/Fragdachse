import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class Line {
    x1 = 0;
    y1 = 0;
    x2 = 0;
    y2 = 0;
    constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) {
      this.setTo(x1, y1, x2, y2);
    }
    setTo(x1: number, y1: number, x2: number, y2: number) {
      this.x1 = x1;
      this.y1 = y1;
      this.x2 = x2;
      this.y2 = y2;
      return this;
    }
  }

  class Circle {
    x = 0;
    y = 0;
    radius = 0;
    constructor(x = 0, y = 0, radius = 0) {
      this.setTo(x, y, radius);
    }
    setTo(x: number, y: number, radius: number) {
      this.x = x;
      this.y = y;
      this.radius = radius;
      return this;
    }
  }

  class Rectangle {
    x = 0;
    y = 0;
    width = 0;
    height = 0;
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.setTo(x, y, width, height);
    }
    setTo(x: number, y: number, width: number, height: number) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      return this;
    }
  }

  return {
    Geom: {
      Line,
      Circle,
      Rectangle,
      Intersects: {
        GetLineToCircle: () => [],
      },
    },
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
      Distance: {
        Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      },
    },
  };
});

import {
  validateWeaponBalanceCapabilities,
  UnsupportedWeaponMechanicError,
} from '../src/debug/coopDefenseBalance/weaponCapabilityValidator';
import {
  validateProjectileSpawnPayload,
  validateHitscanShotPayload,
  validateMeleeSwingPayload,
} from '../src/debug/coopDefenseBalance/headlessPayloadGuard';
import {
  runWeaponSingleTargetBenchmark,
  runWeaponSingleTargetBenchmarkSet,
  resolveAndValidateWeaponSlot,
  calculatePercentile,
} from '../src/debug/coopDefenseBalance/weaponBenchmark';
import { analyzeWeaponSingleTargetProgression } from '../src/debug/coopDefenseBalance/progressionAnalyzer';
import { WEAPON_CONFIGS, type WeaponConfig } from '../src/loadout/LoadoutConfig';

describe('Weapon Balance Lab V0.4 – Correctness Hardening & Expected-Value Foundation', () => {
  describe('1. Bite hitAdrenaline Korrektur', () => {
    it('lehnt Waffen mit hitAdrenaline > 0 als unsupported ab', () => {
      const biteWithHitAdrenaline: WeaponConfig = {
        ...WEAPON_CONFIGS.BITE,
        hitAdrenaline: 10,
      };

      const check = validateWeaponBalanceCapabilities(biteWithHitAdrenaline);
      expect(check.supported).toBe(false);
      expect(check.unsupportedReasons.some((r) => r.includes('hitAdrenaline'))).toBe(true);

      expect(() => {
        runWeaponSingleTargetBenchmark({
          weaponId: 'BITE',
          weaponConfigOverride: biteWithHitAdrenaline,
          sourceSlot: 'weapon1',
        });
      }).toThrow(UnsupportedWeaponMechanicError);
    });

    it('behandelt Bite-Bossstufen mit hitAdrenaline transparent als nicht provenMaximum', () => {
      const progression = analyzeWeaponSingleTargetProgression({
        weaponId: 'BITE',
        slot: 'weapon1',
      });

      // In Mid (1 Boss Point) gibt es den Boss-Knoten bite_blood_bite (hitAdrenaline +10)
      const midStage = progression.stages.find((s) => s.stage === 'mid')!;
      expect(midStage.unsupportedCandidates).toBeGreaterThan(0);
      expect(midStage.unsupportedReasons.some((r) => r.includes('hitAdrenaline'))).toBe(true);
      expect(midStage.provenMaximum).toBe(false);
    });
  });

  describe('2. Systematischer Audit gegen WeaponConfigShape (Kategorien A, B, C)', () => {
    it('Kategorie B: rein visuelle oder defensive Felder blockieren den Benchmark nicht', () => {
      const visualWeapon: WeaponConfig = {
        ...WEAPON_CONFIGS.P90,
        projectileColor: 0xff00ff,
        projectileVisualScale: 1.5,
        damageReduction: 0.2, // Dummy schlägt nicht zurück
        hitKnockback: 100,
        rockDamageMult: 0,
        trainDamageMult: 0,
        bloodEffectMultiplier: 2.0,
      };

      const check = validateWeaponBalanceCapabilities(visualWeapon);
      expect(check.supported).toBe(true);
      expect(check.unsupportedReasons.length).toBe(0);
    });

    it('Kategorie C: ergebnisrelevante Mechaniken blockieren zuverlässig', () => {
      // 1. Verwundbarkeit
      expect(validateWeaponBalanceCapabilities({
        ...WEAPON_CONFIGS.P90,
        hitVulnerabilityDurationMs: 3000,
      }).supported).toBe(false);

      // 2. Scope
      expect(validateWeaponBalanceCapabilities({
        ...WEAPON_CONFIGS.P90,
        scopeConfig: {
          scopeInMs: 500,
          fullScopeViewRadius: 60,
          edgeSoftnessPx: 30,
          unscopedSpreadDeg: 20,
          unscopeSpeedMs: 200,
        },
      }).supported).toBe(false);

      // 3. Warmup-Burn
      expect(validateWeaponBalanceCapabilities({
        ...WEAPON_CONFIGS.P90,
        warmupBurnThreshold: 15,
      }).supported).toBe(false);

      // 4. Hit Adrenaline
      expect(validateWeaponBalanceCapabilities({
        ...WEAPON_CONFIGS.P90,
        hitAdrenaline: 10,
      }).supported).toBe(false);

      // 5. Direct Damage Override
      expect(validateWeaponBalanceCapabilities({
        ...WEAPON_CONFIGS.P90,
        directDamageOverride: 99,
      }).supported).toBe(false);

      // 6. Hit Heal: im statischen Dummy-Benchmark scenario-irrelevant, im Combat-Szenario unsupported
      expect(validateWeaponBalanceCapabilities({
        ...WEAPON_CONFIGS.P90,
        hitHeal: 25,
      }, 'single_target_static').supported).toBe(true);

      expect(validateWeaponBalanceCapabilities({
        ...WEAPON_CONFIGS.P90,
        hitHeal: 25,
      }, 'combat_scenario').supported).toBe(false);
    });
  });

  describe('3. Zweite Sicherheitsgrenze auf den Fire-Requests (Headless Payload Guard)', () => {
    it('wirft Fehler bei ununterstützter Projektil-Payload', () => {
      expect(() => {
        validateProjectileSpawnPayload({
          speed: 800,
          size: 4,
          damage: 10,
          color: 0xffffff,
          lifetime: 1000,
          maxBounces: 0,
          isGrenade: false,
          adrenalinGain: 0,
          homing: {
            acquireDelayMs: 100,
            searchRadius: 300,
            retargetIntervalMs: 100,
            maxTurnDegreesPerStep: 5,
            targetTypes: ['enemies'],
            requireLineOfSight: true,
            excludeOwner: true,
            distanceWeight: 1,
            forwardWeight: 0.5,
          },
        });
      }).toThrow(UnsupportedWeaponMechanicError);
    });

    it('wirft Fehler bei ununterstützter Hitscan-Payload (z.B. Brand oder Kettenblitz im Multi-Target)', () => {
      // 1. Brand ist immer unsupported
      expect(() => {
        validateHitscanShotPayload({
          shooterId: 'p1',
          startX: 0,
          startY: 0,
          angle: 0,
          range: 500,
          damage: 20,
          traceThickness: 2,
          color: 0xffffff,
          adrenalinGain: 0,
          sourceId: 'gun',
          visualPreset: 'laser',
          rockDamageMult: 1,
          trainDamageMult: 1,
          baseDamageMult: 1,
          burnOnHit: {
            durationMs: 2000,
            damagePerTick: 5,
          },
        });
      }).toThrow(UnsupportedWeaponMechanicError);

      // 2. Kettenblitz ist im Multi-Target-Szenario unsupported
      expect(() => {
        validateHitscanShotPayload({
          shooterId: 'p1',
          startX: 0,
          startY: 0,
          angle: 0,
          range: 500,
          damage: 20,
          traceThickness: 2,
          color: 0xffffff,
          adrenalinGain: 0,
          sourceId: 'gun',
          visualPreset: 'laser',
          rockDamageMult: 1,
          trainDamageMult: 1,
          baseDamageMult: 1,
          chainLightning: {
            damageRetention: 0.7,
            jumpRadius: 200,
            maxJumps: 3,
            retargetIntervalMs: 50,
          },
        }, 'five_target');
      }).toThrow(UnsupportedWeaponMechanicError);
    });

    it('wirft Fehler bei ununterstützter Melee-Payload (z.B. hitAdrenaline)', () => {
      expect(() => {
        validateMeleeSwingPayload({
          shooterId: 'p1',
          x: 0,
          y: 0,
          angle: 0,
          range: 50,
          arcDegrees: 80,
          damage: 40,
          adrenalinGain: 0,
          sourceId: 'bite',
          color: 0xffffff,
          rockDamageMult: 1,
          trainDamageMult: 1,
          baseDamageMult: 1,
          visualPreset: 'bite',
          hitHeal: 0,
          hitAdrenaline: 10, // Noch nicht headless unterstützt
          bloodEffectMultiplier: 1,
        });
      }).toThrow(UnsupportedWeaponMechanicError);
    });
  });

  describe('4. Slot-Sicherheit', () => {
    it('akzeptiert nur weapon1 oder weapon2 und prüft allowedSlots', () => {
      // P90 ist nur in weapon2 erlaubt
      expect(resolveAndValidateWeaponSlot(WEAPON_CONFIGS.P90, 'weapon2')).toBe('weapon2');

      expect(() => {
        resolveAndValidateWeaponSlot(WEAPON_CONFIGS.P90, 'weapon1');
      }).toThrow(/nicht für Slot "weapon1" zugelassen/);

      expect(() => {
        resolveAndValidateWeaponSlot(WEAPON_CONFIGS.P90, 'utility1');
      }).toThrow(/ausschließlich "weapon1" oder "weapon2"/);
    });

    it('wählt automatisch den ersten erlaubten Waffen-Slot, wenn keiner angegeben ist', () => {
      expect(resolveAndValidateWeaponSlot(WEAPON_CONFIGS.P90)).toBe('weapon2');
      expect(resolveAndValidateWeaponSlot(WEAPON_CONFIGS.ASMD_PRIM)).toBe('weapon1');
    });
  });

  describe('5. Deterministische Multi-Seed-Aggregation & Quantile', () => {
    it('berechnet Quantile via linearer Interpolation korrekt', () => {
      const values = [10, 20, 30, 40, 50];
      // Min (P0) & Max (P100)
      expect(calculatePercentile(values, 0)).toBe(10);
      expect(calculatePercentile(values, 100)).toBe(50);
      // Median (P50) -> Index 0.5 * 4 = 2 -> 30
      expect(calculatePercentile(values, 50)).toBe(30);
      // P25 -> Index 0.25 * 4 = 1 -> 20
      expect(calculatePercentile(values, 25)).toBe(20);
      // P10 -> Index 0.1 * 4 = 0.4 -> 10 + 0.4 * 10 = 14
      expect(calculatePercentile(values, 10)).toBe(14);
      // P90 -> Index 0.9 * 4 = 3.6 -> 40 + 0.6 * 10 = 46
      expect(calculatePercentile(values, 90)).toBe(46);
    });

    it('liefert identische Aggregation unabhängig von der Reihenfolge der Seeds', () => {
      const seedsA = [1, 2, 3, 4, 5, 6, 7, 8];
      const seedsB = [8, 3, 1, 5, 2, 7, 4, 6];

      const aggA = runWeaponSingleTargetBenchmarkSet({
        weaponId: 'P90',
        seeds: seedsA,
        durationMs: 5000,
      });

      const aggB = runWeaponSingleTargetBenchmarkSet({
        weaponId: 'P90',
        seeds: seedsB,
        durationMs: 5000,
      });

      expect(aggA.expectedDps).toBeCloseTo(aggB.expectedDps, 5);
      expect(aggA.medianDps).toBeCloseTo(aggB.medianDps, 5);
      expect(aggA.p10Dps).toBeCloseTo(aggB.p10Dps, 5);
      expect(aggA.p90Dps).toBeCloseTo(aggB.p90Dps, 5);
      expect(aggA.minDps).toBeCloseTo(aggB.minDps, 5);
      expect(aggA.maxDps).toBeCloseTo(aggB.maxDps, 5);
      expect(aggA.expectedHitRate).toBeCloseTo(aggB.expectedHitRate, 5);
    });
  });

  describe('6. Optimizer auf Expected ST DPS & Transparenz', () => {
    it('erfasst detaillierte unsupportedReasonCounts pro Progressionsstufe', () => {
      const progression = analyzeWeaponSingleTargetProgression({
        weaponId: 'P90',
        slot: 'weapon2',
        seeds: [1, 2, 3, 4],
        durationMs: 5000,
      });

      const lateStage = progression.stages.find((s) => s.stage === 'late')!;
      expect(lateStage.unsupportedReasonCounts).toBeDefined();
      const homingCount = Object.entries(lateStage.unsupportedReasonCounts).find(([r]) => r.toLowerCase().includes('homing'))?.[1];
      expect(homingCount).toBeGreaterThan(0);
      expect(lateStage.provenMaximum).toBe(false);
    });

    it('erzielt provenMaximum = true nur bei 100% Evaluation aller legalen Kandidaten', () => {
      const progression = analyzeWeaponSingleTargetProgression({
        weaponId: 'P90',
        slot: 'weapon2',
        seeds: [1, 2],
        durationMs: 5000,
      });

      const earlyStage = progression.stages.find((s) => s.stage === 'early')!;
      expect(earlyStage.unsupportedCandidates).toBe(0);
      expect(earlyStage.evaluatedCandidates).toBe(earlyStage.totalLegalCandidates);
      expect(earlyStage.provenMaximum).toBe(true);
    });
  });
});
