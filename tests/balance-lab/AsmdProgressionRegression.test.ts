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

import { generateWeaponUpgradeBuilds } from '../../src/debug/coopDefenseBalance/WeaponUpgradeBuildGenerator';
import { analyzeWeaponFiveTargetProgression, analyzeWeaponSingleTargetProgression } from '../../src/debug/coopDefenseBalance/progressionAnalyzer';
import { getCoopDefenseResolvedEffectTotals } from '../../src/utils/coopDefenseUpgrades';
import { applyCoopDefenseModifiersToWeaponConfig } from '../../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';

describe('ASMD_PRIM Progression & Registry Hardening', () => {
  it('1. Build Discovery: entdeckt alle ASMD-Upgrades und respektiert Cooldown-Voraussetzung für Schaden', () => {
    const earlyBuilds = generateWeaponUpgradeBuilds({
      weaponId: 'ASMD_PRIM',
      slot: 'weapon1',
      normalPointBudget: 3,
      bossPointBudget: 0,
    });

    expect(earlyBuilds.length).toBeGreaterThan(5);

    // Prüfe, dass Builds mit Schaden existieren
    const damageBuilds = earlyBuilds.filter((b) => (b.levels.asmd_primary_damage ?? 0) > 0);
    expect(damageBuilds.length).toBeGreaterThan(0);

    // Harte Invariante: asmd_primary_damage erfordert asmd_primary_cooldown >= 1
    for (const build of earlyBuilds) {
      if ((build.levels.asmd_primary_damage ?? 0) > 0) {
        expect(build.levels.asmd_primary_cooldown).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('2. Modifier: berechnet Cooldown I (-10%) + Damage II (+40%) exakt über den echten Modifier-Pfad', () => {
    const earlyBuilds = generateWeaponUpgradeBuilds({
      weaponId: 'ASMD_PRIM',
      slot: 'weapon1',
      normalPointBudget: 3,
      bossPointBudget: 0,
    });

    const targetBuild = earlyBuilds.find(
      (b) => b.levels.asmd_primary_cooldown === 1 && b.levels.asmd_primary_damage === 2,
    );
    expect(targetBuild).toBeDefined();

    const totals = getCoopDefenseResolvedEffectTotals(targetBuild!.profile);
    const modifiedConfig = applyCoopDefenseModifiersToWeaponConfig(
      WEAPON_CONFIGS.ASMD_PRIM,
      'weapon1',
      totals,
    );

    // Basis: cooldown 600ms, damage 10
    // Cooldown I: -10% -> 600 * 0.9 = 540ms
    // Damage II: +40% -> 10 * 1.4 = 14
    expect(modifiedConfig.cooldown).toBe(540);
    expect(modifiedConfig.damage).toBe(14);
  });

  it('3. Progression: Early Expected ST DPS übersteigt Base deutlich (~26.1 DPS vs 16.7 DPS)', () => {
    const progression = analyzeWeaponSingleTargetProgression({
      weaponId: 'ASMD_PRIM',
      slot: 'weapon1',
      durationMs: 30_000,
    });

    const baseStage = progression.stages.find((s) => s.stage === 'base')!;
    const earlyStage = progression.stages.find((s) => s.stage === 'early')!;

    expect(baseStage.bestSupportedExpectedDps).toBeCloseTo(16.67, 1);
    expect(earlyStage.bestSupportedExpectedDps).toBeGreaterThan(baseStage.bestSupportedExpectedDps);
    expect(earlyStage.bestSupportedExpectedDps).toBeCloseTo(26.13, 1);
    expect(earlyStage.bestSupportedBuild?.levels.asmd_primary_cooldown).toBe(1);
    expect(earlyStage.bestSupportedBuild?.levels.asmd_primary_damage).toBe(2);
    expect(earlyStage.provenMaximum).toBe(true);
  });

  it('4. Boss-Entdeckung: asmd_primary_chain_lightning wird in Mid/Late/Endgame entdeckt und ist im ST-Szenario irrelevant', () => {
    const progression = analyzeWeaponSingleTargetProgression({
      weaponId: 'ASMD_PRIM',
      slot: 'weapon1',
    });

    const midStage = progression.stages.find((s) => s.stage === 'mid')!;
    const lateStage = progression.stages.find((s) => s.stage === 'late')!;
    const endgameStage = progression.stages.find((s) => s.stage === 'endgame')!;

    // In Mid/Late/Endgame gibt es Boss-Punkte
    expect(midStage.bossPointBudget).toBe(1);
    expect(lateStage.bossPointBudget).toBe(2);
    expect(endgameStage.bossPointBudget).toBe(2);

    // Da Chain Lightning im Single-Target-Dummy-Szenario nicht springen kann, ist es scenario-irrelevant
    expect(midStage.unsupportedCandidates).toBe(0);
    expect(midStage.provenMaximum).toBe(true);
    expect(lateStage.provenMaximum).toBe(true);
    expect(endgameStage.provenMaximum).toBe(true);
  });

  it('5. Five-Target: ASMD-Bossbuild simuliert Direct und Chain getrennt und bleibt provenMaximum', () => {
    const progression = analyzeWeaponFiveTargetProgression({
      weaponId: 'ASMD_PRIM',
      slot: 'weapon1',
      seeds: [1],
      durationMs: 30_000,
    });

    for (const stage of progression.stages) {
      expect(stage.provenMaximum).toBe(true);
      expect(stage.benchmarkAggregate?.expectedDps).toBeCloseTo(
        stage.benchmarkAggregate!.expectedDirectDps + stage.benchmarkAggregate!.expectedBurnDps + stage.benchmarkAggregate!.expectedChainDps,
        8,
      );
    }

    const endgame = progression.stages.find((stage) => stage.stage === 'endgame')!;
    expect(endgame.bestSupportedBuild?.levels.asmd_primary_chain_lightning).toBe(1);
    expect(endgame.benchmarkAggregate?.expectedDirectDps).toBeGreaterThan(0);
    expect(endgame.benchmarkAggregate?.expectedChainDps).toBeGreaterThan(0);
  }, 30000);
});