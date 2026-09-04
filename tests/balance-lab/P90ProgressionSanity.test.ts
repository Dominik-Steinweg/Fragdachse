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
import { getCoopDefenseResolvedEffectTotals } from '../../src/utils/coopDefenseUpgrades';
import { applyCoopDefenseModifiersToWeaponConfig } from '../../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';

describe('P90 Mid Progression Sanity & Modifier Structure', () => {
  it('bestätigt, dass der starke Mid-Sprung aus der echten Upgrade-Kombination stammt (Bullet Storm Salve)', () => {
    const progression = analyzeWeaponSingleTargetProgression({
      weaponId: 'P90',
      slot: 'weapon2',
    });

    const midStage = progression.stages.find((s) => s.stage === 'mid')!;
    expect(midStage).toBeDefined();
    expect(midStage.bestSupportedBuild).toBeDefined();

    const build = midStage.bestSupportedBuild!;
    // 1. Gewinner enthält den Boss-Knoten p90_bullet_storm
    expect(build.levels.p90_bullet_storm).toBe(1);
    expect(build.levels.p90_bullet_storm_spread).toBeGreaterThanOrEqual(1);
    expect(build.levels.p90_damage).toBe(3);

    // 2. Echter Coop-Modifier-Pfad erzeugt pelletCount = 3
    const effectTotals = getCoopDefenseResolvedEffectTotals(build.profile);
    const modifiedConfig = applyCoopDefenseModifiersToWeaponConfig(
      WEAPON_CONFIGS.P90,
      'weapon2',
      effectTotals,
    );

    expect(modifiedConfig.pelletCount).toBe(3);
    // Cooldown ist drastisch reduziert durch bullet_storm (von 430ms auf ~80ms)
    expect(modifiedConfig.cooldown).toBeLessThan(100);
    // Schaden pro Kugel ist erhöht durch p90_damage: 3 (+30% -> 8 * 1.3 = 10.4)
    expect(modifiedConfig.damage).toBeCloseTo(10.4, 1);

    // 3. P90-DPS ist in Mid um ein Vielfaches höher als in Early (durch 3 Pellets + 80ms Kadenz)
    const earlyStage = progression.stages.find((s) => s.stage === 'early')!;
    expect(midStage.bestSupportedExpectedDps).toBeGreaterThan(earlyStage.bestSupportedExpectedDps * 5);
  }, 20000);
});