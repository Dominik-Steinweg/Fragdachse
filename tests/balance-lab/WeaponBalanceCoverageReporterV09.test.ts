import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Geom: {
    Line: class Line {
      x1 = 0; y1 = 0; x2 = 0; y2 = 0;
      constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) { this.setTo(x1, y1, x2, y2); }
      setTo(x1: number, y1: number, x2: number, y2: number) {
        this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2; return this;
      }
    },
    Circle: class Circle {
      x = 0; y = 0; radius = 0;
      constructor(x = 0, y = 0, radius = 0) { this.setTo(x, y, radius); }
      setTo(x: number, y: number, radius: number) {
        this.x = x; this.y = y; this.radius = radius; return this;
      }
    },
    Rectangle: class Rectangle {
      x = 0; y = 0; width = 0; height = 0;
      constructor(x = 0, y = 0, width = 0, height = 0) { this.setTo(x, y, width, height); }
      setTo(x: number, y: number, width: number, height: number) {
        this.x = x; this.y = y; this.width = width; this.height = height; return this;
      }
    },
    Intersects: { GetLineToCircle: () => [] },
  },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
  },
}));

import {
  generateWeaponBalanceCoverageData,
  generateWeaponBalanceCoverageDataForScenarios,
  generateWeaponBalanceCoverageReport,
} from '../../src/debug/coopDefenseBalance/coverageReporter';
import { analyzeWeaponFiveTargetProgression } from '../../src/debug/coopDefenseBalance/progressionAnalyzer';

describe('Weapon Balance V0.10 machine-generated reporter', () => {
  it('matches the shared five-target analyzer exactly', () => {
    const analysis = analyzeWeaponFiveTargetProgression({ weaponId: 'GLOCK', slot: 'weapon1', scenario: 'five_target', seeds: [1], durationMs: 100, stepDeltaMs: 16 });
    const report = generateWeaponBalanceCoverageData(['GLOCK'], {
      slot: 'weapon1',
      scenario: 'five_target',
      seeds: [1],
      durationMs: 100,
      stepDeltaMs: 16,
    });
    const weapon = report.weapons[0];

    expect(weapon.scenarioId).toBe('five_target_static.v1');
    expect(weapon.scenarioVersion).toBe(1);
    for (const stage of analysis.stages) {
      const reported = weapon.stages.find((entry) => entry.stage === stage.stage)!;
      expect(reported.expectedDps).toBe(stage.bestSupportedExpectedDps);
      expect(reported.directDps).toBe(stage.benchmarkAggregate?.expectedDirectDps ?? stage.bestSupportedExpectedDps);
      expect(reported.selectedBuildSignature).toBe(stage.bestSupportedBuild?.signature ?? 'base');
      expect(reported.provenMaximum).toBe(stage.provenMaximum);
      expect(reported.primaryMetricComplete).toBe(stage.primaryMetricComplete);
      expect(reported.tailComplete).toBe(stage.tailComplete);
    }
  }, 30000);

  it('reports canonical ST/5T profiles with separate ASMD Direct/Chain DPS', () => {
    const data = generateWeaponBalanceCoverageDataForScenarios(['ASMD_PRIM'], {
      slot: 'weapon1',
      seeds: [1],
      durationMs: 30_000,
      stepDeltaMs: 16,
    });
    expect(data.weapons.map((weapon) => weapon.scenarioId)).toEqual([
      'single_target_static.v1',
      'five_target_static.v1',
    ]);

    const fiveTarget = data.weapons[1];
    const endgame = fiveTarget.stages.find((stage) => stage.stage === 'endgame')!;
    expect(endgame.provenMaximum).toBe(true);
    expect(endgame.directDps).toBeGreaterThan(0);
    expect(endgame.chainDps).toBeGreaterThan(0);

    const markdown = generateWeaponBalanceCoverageReport(['ASMD_PRIM'], {
      slot: 'weapon1',
      scenario: 'five_target',
      seeds: [1],
      durationMs: 30_000,
      stepDeltaMs: 16,
    });
    expect(markdown).toContain('Expected Total DPS');
    expect(markdown).toContain('Chain:');
  }, 30000);
});