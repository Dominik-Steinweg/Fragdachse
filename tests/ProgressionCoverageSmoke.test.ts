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

import { analyzeWeaponSingleTargetProgression } from '../src/debug/coopDefenseBalance/progressionAnalyzer';
import { runWeaponSingleTargetBenchmarkSet } from '../src/debug/coopDefenseBalance/weaponBenchmark';

describe('Programmatic Progression Coverage Smoke Test', () => {
  it('führt Live-Progression für P90, ASMD_PRIM und BITE durch und verifiziert alle Sanity-Invarianten', () => {
    // 1. P90
    const p90 = analyzeWeaponSingleTargetProgression({ weaponId: 'P90', slot: 'weapon2' });
    expect(p90.stages.length).toBe(5);
    const p90Base = p90.stages.find((s) => s.stage === 'base')!;
    const p90Early = p90.stages.find((s) => s.stage === 'early')!;
    const p90Standalone = runWeaponSingleTargetBenchmarkSet({ weaponId: 'P90', sourceSlot: 'weapon2' });
    expect(p90Base.bestSupportedExpectedDps).toBeCloseTo(p90Standalone.expectedDps, 2);
    expect(p90Early.bestSupportedExpectedDps).toBeGreaterThan(p90Base.bestSupportedExpectedDps);

    // 2. ASMD_PRIM
    const asmd = analyzeWeaponSingleTargetProgression({ weaponId: 'ASMD_PRIM', slot: 'weapon1' });
    expect(asmd.stages.length).toBe(5);
    const asmdBase = asmd.stages.find((s) => s.stage === 'base')!;
    const asmdEarly = asmd.stages.find((s) => s.stage === 'early')!;
    const asmdStandalone = runWeaponSingleTargetBenchmarkSet({ weaponId: 'ASMD_PRIM', sourceSlot: 'weapon1' });
    expect(asmdBase.bestSupportedExpectedDps).toBeCloseTo(asmdStandalone.expectedDps, 2);
    expect(asmdEarly.bestSupportedExpectedDps).toBeGreaterThan(asmdBase.bestSupportedExpectedDps);

    // 3. BITE
    const bite = analyzeWeaponSingleTargetProgression({ weaponId: 'BITE', slot: 'weapon1' });
    expect(bite.stages.length).toBe(5);
    const biteBase = bite.stages.find((s) => s.stage === 'base')!;
    const biteEarly = bite.stages.find((s) => s.stage === 'early')!;
    const biteStandalone = runWeaponSingleTargetBenchmarkSet({ weaponId: 'BITE', sourceSlot: 'weapon1' });
    expect(biteBase.bestSupportedExpectedDps).toBeCloseTo(biteStandalone.expectedDps, 2);
    expect(biteEarly.bestSupportedExpectedDps).toBeGreaterThan(biteBase.bestSupportedExpectedDps);

    // 4. Cache-Funktionalität prüfen
    expect(p90.cacheHits).toBeGreaterThan(0);
    expect(asmd.cacheHits).toBeGreaterThan(0);
    expect(bite.cacheHits).toBeGreaterThan(0);
  }, 30000);
});
