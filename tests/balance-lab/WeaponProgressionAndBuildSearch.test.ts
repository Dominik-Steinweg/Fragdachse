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

import { PROGRESSION_STAGES, getProgressionStageDefinition } from '../../src/debug/coopDefenseBalance/progressionStages';
import { generateWeaponUpgradeBuilds } from '../../src/debug/coopDefenseBalance/WeaponUpgradeBuildGenerator';
import { analyzeWeaponSingleTargetProgression } from '../../src/debug/coopDefenseBalance/progressionAnalyzer';
import { runWeaponSingleTargetBenchmark } from '../../src/debug/coopDefenseBalance/weaponBenchmark';
import {
  isSpreadWithinTriggerDiscipline,
  calculateMaxAllowedSpreadDeg,
} from '../../src/debug/coopDefenseBalance/triggerDiscipline';
import {
  getCoopDefenseResolvedEffectTotals,
} from '../../src/utils/coopDefenseUpgrades';
import { applyCoopDefenseModifiersToWeaponConfig } from '../../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS, getWeaponConfig, type WeaponConfig } from '../../src/loadout/LoadoutConfig';

describe('Weapon Balance Lab 0.3 – Single-Target Progression & Build Search', () => {
  describe('1. GDD-Konformität der Progressionsstufen', () => {
    it('definiert exakt die fünf GDD-Stufen mit ihren Punkte- und Boss-Budgets', () => {
      expect(PROGRESSION_STAGES.length).toBe(5);

      const base = getProgressionStageDefinition('base');
      expect(base.normalPointBudget).toBe(0);
      expect(base.bossPointBudget).toBe(0);

      const early = getProgressionStageDefinition('early');
      expect(early.normalPointBudget).toBe(3);
      expect(early.bossPointBudget).toBe(0);

      const mid = getProgressionStageDefinition('mid');
      expect(mid.normalPointBudget).toBe(5);
      expect(mid.bossPointBudget).toBe(1);

      const late = getProgressionStageDefinition('late');
      expect(late.normalPointBudget).toBe(10);
      expect(late.bossPointBudget).toBe(2);

      const endgame = getProgressionStageDefinition('endgame');
      expect(endgame.normalPointBudget).toBe(20);
      expect(endgame.bossPointBudget).toBe(2);
    });
  });

  describe('2. Build-Generator & Echte Registry-Entdeckung', () => {
    it('erzeugt für P90 in Base genau 1 Build mit vorausgesetztem Unlock ohne Punktabzug', () => {
      const builds = generateWeaponUpgradeBuilds({
        weaponId: 'P90',
        slot: 'weapon2',
        normalPointBudget: 0,
        bossPointBudget: 0,
      });

      expect(builds.length).toBe(1);
      const baseBuild = builds[0];
      expect(baseBuild.signature).toBe('base');
      expect(baseBuild.spentNormalPoints).toBe(0);
      expect(baseBuild.spentBossPoints).toBe(0);
      // Der Unlock ist im Profil gesetzt
      expect(baseBuild.profile.upgrades.unlock_p90?.level).toBe(1);
    });

    it('enthält keine allgemeinen Upgrades oder Upgrades fremder Waffen', () => {
      const builds = generateWeaponUpgradeBuilds({
        weaponId: 'P90',
        slot: 'weapon2',
        normalPointBudget: 10,
        bossPointBudget: 2,
      });

      expect(builds.length).toBeGreaterThan(1);
      for (const build of builds) {
        for (const upgradeId of Object.keys(build.levels)) {
          expect(upgradeId.startsWith('p90_')).toBe(true);
          // Keine allgemeinen Upgrades wie critical_chance oder dash_cooldown
          expect(upgradeId).not.toBe('critical_chance');
          expect(upgradeId).not.toBe('dash_cooldown');
        }
      }
    });

    it('respektiert echte Upgrade-Abhängigkeiten (Requirements)', () => {
      const builds = generateWeaponUpgradeBuilds({
        weaponId: 'P90',
        slot: 'weapon2',
        normalPointBudget: 3,
        bossPointBudget: 0,
      });

      for (const build of builds) {
        // p90_range erfordert p90_adrenaline_cost, welches p90_damage erfordert
        if ((build.levels.p90_range ?? 0) > 0) {
          expect(build.levels.p90_adrenaline_cost).toBeGreaterThanOrEqual(1);
          expect(build.levels.p90_damage).toBeGreaterThanOrEqual(1);
        }
        if ((build.levels.p90_adrenaline_cost ?? 0) > 0) {
          expect(build.levels.p90_damage).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it('respektiert Boss-Budgets strikt', () => {
      // Early: 0 Boss-Punkte
      const earlyBuilds = generateWeaponUpgradeBuilds({
        weaponId: 'P90',
        slot: 'weapon2',
        normalPointBudget: 3,
        bossPointBudget: 0,
      });

      for (const build of earlyBuilds) {
        expect(build.spentBossPoints).toBe(0);
        expect(build.levels.p90_bullet_storm).toBeUndefined();
      }

      // Mid: max 1 Boss-Punkt
      const midBuilds = generateWeaponUpgradeBuilds({
        weaponId: 'P90',
        slot: 'weapon2',
        normalPointBudget: 5,
        bossPointBudget: 1,
      });

      for (const build of midBuilds) {
        expect(build.spentBossPoints).toBeLessThanOrEqual(1);
      }
    });

    it('erzeugt kanonisch deduplizierte Builds ohne Permutationsduplikate', () => {
      const builds = generateWeaponUpgradeBuilds({
        weaponId: 'P90',
        slot: 'weapon2',
        normalPointBudget: 5,
        bossPointBudget: 1,
      });

      const signatures = new Set<string>();
      for (const build of builds) {
        expect(signatures.has(build.signature)).toBe(false);
        signatures.add(build.signature);
      }
    });
  });

  describe('3. Coop-Modifier-Pfad & Reaktivität', () => {
    it('wendet echte Coop-Modifier auf WeaponConfig an', () => {
      const builds = generateWeaponUpgradeBuilds({
        weaponId: 'P90',
        slot: 'weapon2',
        normalPointBudget: 3,
        bossPointBudget: 0,
      });

      const damage3Build = builds.find((b) => b.levels.p90_damage === 3 && Object.keys(b.levels).length === 1);
      expect(damage3Build).toBeDefined();

      const effectTotals = getCoopDefenseResolvedEffectTotals(damage3Build!.profile);
      const modifiedConfig = applyCoopDefenseModifiersToWeaponConfig(
        WEAPON_CONFIGS.P90,
        'weapon2',
        effectTotals,
      );

      // P90 Basis = 8 Schaden. p90_damage gibt +10% Schaden pro Level -> 8 * 1.3 = 10.4 Schaden
      expect(modifiedConfig.damage).toBeCloseTo(10.4, 2);
    });

    it('lässt Base-Stage exakt der normalen Base-WeaponConfig entsprechen', () => {
      const baseResult = runWeaponSingleTargetBenchmark({
        weaponId: 'P90',
        sourceSlot: 'weapon2',
        seed: 1,
      });

      const analysis = analyzeWeaponSingleTargetProgression({
        weaponId: 'P90',
        slot: 'weapon2',
        seed: 1,
      });

      const baseStage = analysis.stages.find((s) => s.stage === 'base')!;
      expect(baseStage.bestSupportedBuild?.signature).toBe('base');
      expect(baseStage.bestSupportedDps).toBeCloseTo(baseResult.dps, 2);
    });
  });

  describe('4. Trigger Discipline für Accuracy-Spread', () => {
    it('berechnet den zulässigen Spread-Winkel aus Dachs-Größe und Distanz', () => {
      const p90 = WEAPON_CONFIGS.P90;
      // Bei 150px Distanz und 16px Radius: targetHalfAngle ~ 6.12° (Durchmesser ~ 12.24°)
      const maxAllowed = calculateMaxAllowedSpreadDeg(p90, 150, 16);
      expect(maxAllowed).toBeCloseTo(12.24, 1);

      // P90 spreadStanding ist 2°, bei dynamicSpread 4° -> Spread 6° <= 12.24° (erlaubt)
      expect(isSpreadWithinTriggerDiscipline(p90, 4, 150, 16)).toBe(true);
      // Bei dynamicSpread 15° -> Spread 17° > 12.24° (gesperrt)
      expect(isSpreadWithinTriggerDiscipline(p90, 15, 150, 16)).toBe(false);
    });

    it('legt bei extremem Dynamic Spread gezielte Feuerpausen ein und bleibt step-invariant', () => {
      // Künstliche Waffe mit starkem Spread-Bloom
      const heavyBloomGun: WeaponConfig = {
        id: 'HEAVY_BLOOM_GUN',
        cooldown: 100,
        damage: 50,
        range: 500,
        fire: {
          type: 'projectile',
          projectileSpeed: 1000,
          projectileSize: 6,
          projectileMaxBounces: 0,
        },
        allowedSlots: ['weapon1'],
        adrenalinCost: 0,
        adrenalinGain: 10,
        spreadStanding: 2,
        spreadMoving: 2,
        spreadPerShot: 8, // Sehr hoher Bloom pro Schuss
        maxDynamicSpread: 30, // Ziel hat bei 150px nur ca. 12.24° Abdeckung
        spreadRecoveryDelay: 300,
        spreadRecoveryRate: 10,
        spreadRecoverySpeed: 100,
      };

      // Führe Benchmark mit stepDeltaMs 8, 16 und 25 aus
      const run8 = runWeaponSingleTargetBenchmark({
        weaponId: 'HEAVY_BLOOM_GUN',
        durationMs: 10_000,
        stepDeltaMs: 8,
        targetDistance: 150,
        weaponConfigOverride: heavyBloomGun,
      });

      const run16 = runWeaponSingleTargetBenchmark({
        weaponId: 'HEAVY_BLOOM_GUN',
        durationMs: 10_000,
        stepDeltaMs: 16,
        targetDistance: 150,
        weaponConfigOverride: heavyBloomGun,
      });

      const run25 = runWeaponSingleTargetBenchmark({
        weaponId: 'HEAVY_BLOOM_GUN',
        durationMs: 10_000,
        stepDeltaMs: 25,
        targetDistance: 150,
        weaponConfigOverride: heavyBloomGun,
      });

      // Wegen Trigger Discipline muss die Schusszahl geringer sein als ohne Pausen (10.000 / 100 = 100 Schuss)
      expect(run16.shotsFired).toBeLessThan(100);
      expect(run16.shotsFired).toBeGreaterThan(10);
      // Alle Schüsse müssen treffen (100% Trefferquote durch Trigger Discipline)
      expect(run16.hitRate).toBe(1.0);

      // Exakte Step-Invarianz
      expect(run8.shotsFired).toBe(run16.shotsFired);
      expect(run16.shotsFired).toBe(run25.shotsFired);
      expect(run8.totalDamage).toBe(run16.totalDamage);
      expect(run16.totalDamage).toBe(run25.totalDamage);
    });
  });

  describe('5. Single-Target Progression Analyzer & Transparenz', () => {
    it('wählt in Early für P90 den maximalen legalen Schadensbuild mit provenMaximum = true', () => {
      const analysis = analyzeWeaponSingleTargetProgression({
        weaponId: 'P90',
        slot: 'weapon2',
        seed: 1,
      });

      const baseStage = analysis.stages.find((s) => s.stage === 'base')!;
      const earlyStage = analysis.stages.find((s) => s.stage === 'early')!;

      expect(earlyStage.bestSupportedBuild).toBeDefined();
      expect(earlyStage.bestSupportedBuild!.levels.p90_damage).toBe(3);
      expect(earlyStage.bestSupportedDps).toBeGreaterThan(baseStage.bestSupportedDps);
      expect(earlyStage.unsupportedCandidates).toBe(0);
      expect(earlyStage.provenMaximum).toBe(true);
    });

    it('markiert spätere P90-Stufen mit Homing transparent als provenMaximum = false', () => {
      const analysis = analyzeWeaponSingleTargetProgression({
        weaponId: 'P90',
        slot: 'weapon2',
        seed: 1,
      });

      const endgameStage = analysis.stages.find((s) => s.stage === 'endgame')!;
      expect(endgameStage.unsupportedCandidates).toBeGreaterThan(0);
      expect(endgameStage.provenMaximum).toBe(false);
      expect(endgameStage.unsupportedReasons.some((r) => r.toLowerCase().includes('homing'))).toBe(true);
      // Liefert dennoch den besten unterstützten Non-Homing Build
      expect(endgameStage.bestSupportedDps).toBeGreaterThan(0);
    });

    it('analysiert ASMD Primär und Bite über alle 5 Stufen', () => {
      const asmdAnalysis = analyzeWeaponSingleTargetProgression({
        weaponId: 'ASMD_PRIM',
        slot: 'weapon1',
        seed: 1,
      });
      expect(asmdAnalysis.stages.length).toBe(5);
      expect(asmdAnalysis.stages[0].stage).toBe('base');
      expect(asmdAnalysis.stages[0].bestSupportedDps).toBeCloseTo((50 * 10) / 30, 2);

      const biteAnalysis = analyzeWeaponSingleTargetProgression({
        weaponId: 'BITE',
        slot: 'weapon1',
        seed: 1,
      });
      expect(biteAnalysis.stages.length).toBe(5);
      expect(biteAnalysis.stages[0].stage).toBe('base');
      expect(biteAnalysis.stages[0].bestSupportedDps).toBeCloseTo((86 * 50) / 30, 2);
    });

    it('erzeugt eine verständliche Text-Zusammenfassung', () => {
      const analysis = analyzeWeaponSingleTargetProgression({
        weaponId: 'P90',
        slot: 'weapon2',
        seed: 1,
      });

      expect(analysis.summaryText).toContain('=== Single-Target Progression: P90 (weapon2)');
      expect(analysis.summaryText).toContain('[BASE]');
      expect(analysis.summaryText).toContain('[EARLY]');
      expect(analysis.summaryText).toContain('[ENDGAME]');
    });
  });
});