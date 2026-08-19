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
    static Length(line: Line): number {
      return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
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
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get top() { return this.y; }
    get bottom() { return this.y + this.height; }
  }

  function getLineToCircle(
    line: Line,
    circle: Circle,
    out: Array<{ x: number; y: number }> = [],
  ): Array<{ x: number; y: number }> {
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    const fx = line.x1 - circle.x;
    const fy = line.y1 - circle.y;

    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - circle.radius * circle.radius;

    if (a < 1e-9) {
      if (c <= 0) out.push({ x: line.x1, y: line.y1 });
      return out;
    }

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return out;

    const sqrtDisc = Math.sqrt(discriminant);
    const t1 = (-b - sqrtDisc) / (2 * a);
    const t2 = (-b + sqrtDisc) / (2 * a);

    if (t1 >= 0 && t1 <= 1) {
      out.push({ x: line.x1 + t1 * dx, y: line.y1 + t1 * dy });
    }
    if (t2 >= 0 && t2 <= 1 && Math.abs(t2 - t1) > 1e-6) {
      out.push({ x: line.x1 + t2 * dx, y: line.y1 + t2 * dy });
    }

    return out;
  }

  return {
    Geom: {
      Line,
      Circle,
      Rectangle,
      Intersects: {
        GetLineToCircle: getLineToCircle,
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
  runWeaponSingleTargetBenchmark,
  resolveDefaultTargetDistance,
} from '../src/debug/coopDefenseBalance/weaponBenchmark';
import { HeadlessSingleTargetWorld } from '../src/debug/coopDefenseBalance/HeadlessSingleTargetWorld';
import { WEAPON_CONFIGS, getWeaponConfig } from '../src/loadout/LoadoutConfig';
import { WeaponFireExecutor } from '../src/loadout/WeaponFireExecutor';
import { PLAYER_SIZE } from '../src/config';

describe('Weapon Balance Lab – Single Target Benchmark', () => {
  it('liefert mit gleichem Seed und gleichem Build exakt reproduzierbare Ergebnisse', () => {
    const runA = runWeaponSingleTargetBenchmark({
      weaponId: 'P90',
      durationMs: 30_000,
      seed: 42,
    });

    const runB = runWeaponSingleTargetBenchmark({
      weaponId: 'P90',
      durationMs: 30_000,
      seed: 42,
    });

    expect(runA.totalDamage).toBe(runB.totalDamage);
    expect(runA.shotsFired).toBe(runB.shotsFired);
    expect(runA.hits).toBe(runB.hits);
    expect(runA.dps).toBe(runB.dps);
    expect(runA.adrenalineSpent).toBe(runB.adrenalineSpent);
    expect(runA.damageEvents).toEqual(runB.damageEvents);
    expect(runA.resourceEvents).toEqual(runB.resourceEvents);
  });

  it('führt 30 virtuelle Sekunden in wenigen Millisekunden Echtzeit aus', () => {
    const startRealTime = performance.now();
    const result = runWeaponSingleTargetBenchmark({
      weaponId: 'P90',
      durationMs: 30_000,
      seed: 1,
    });
    const elapsedRealMs = performance.now() - startRealTime;

    expect(result.durationMs).toBe(30_000);
    expect(result.shotsFired).toBeGreaterThan(300);
    // 30 simulierte Sekunden müssen in unter 100ms realer Ausführungszeit fertig sein
    expect(elapsedRealMs).toBeLessThan(100);
  });

  it('misst P90 über den realen Projectile-Pfad und erfasst Adrenalinverbrauch', () => {
    const p90Config = getWeaponConfig('P90');
    expect(p90Config).toBeDefined();
    expect(p90Config.fire.type).toBe('projectile');
    expect(p90Config.damage).toBe(8);
    expect(p90Config.cooldown).toBe(80);
    expect(p90Config.adrenalinCost).toBe(4);

    const result = runWeaponSingleTargetBenchmark({
      weaponId: 'P90',
      durationMs: 30_000,
      seed: 1,
    });

    expect(result.weaponId).toBe('P90');
    // Bei 80ms Kadenz und 30s Dauer: 30.000 / 80 = 375 Schuss
    expect(result.shotsFired).toBe(375);
    expect(result.hits).toBeGreaterThan(0);
    expect(result.hits).toBeLessThanOrEqual(result.shotsFired);
    expect(result.totalDamage).toBe(result.hits * p90Config.damage);
    expect(result.dps).toBeCloseTo(result.totalDamage / 30, 2);

    // Waffe 2 verbraucht Adrenalin: 375 Schuss * 4 Adrenalin = 1500
    expect(result.adrenalineSpent).toBe(375 * 4);
    expect(result.adrenalineSpentPerSec).toBeCloseTo(1500 / 30, 2);
    expect(result.adrenalineGenerated).toBe(0);

    // Schadensereignisse tragen reale Schadenswerte
    expect(result.damageEvents.length).toBe(result.hits);
    expect(result.damageEvents[0].damage).toBe(8);
    expect(result.damageEvents[0].sourceId).toBe('P90');
  });

  it('misst ASMD Primär über den realen Hitscan-Pfad und erfasst Adrenalingenerierung', () => {
    const asmdConfig = getWeaponConfig('ASMD_PRIM');
    expect(asmdConfig).toBeDefined();
    expect(asmdConfig.fire.type).toBe('hitscan');
    expect(asmdConfig.damage).toBe(10);
    expect(asmdConfig.cooldown).toBe(600);
    expect(asmdConfig.adrenalinGain).toBe(8);

    const result = runWeaponSingleTargetBenchmark({
      weaponId: 'ASMD_PRIM',
      durationMs: 30_000,
      seed: 1,
    });

    expect(result.weaponId).toBe('ASMD_PRIM');
    // Bei 600ms Kadenz und 16ms Ticks: erster Schuss bei t=0, dann alle 608ms -> 50 Schuss
    expect(result.shotsFired).toBe(50);
    // Hitscan ohne Spread trifft das Ziel zu 100%
    expect(result.hits).toBe(50);
    expect(result.hitRate).toBe(1.0);
    expect(result.totalDamage).toBe(50 * asmdConfig.damage);
    expect(result.dps).toBeCloseTo((50 * 10) / 30, 2);

    // Waffe 1 erzeugt Adrenalin: 50 Treffer * 8 Adrenalin = 400
    expect(result.adrenalineGenerated).toBe(50 * 8);
    expect(result.adrenalineGeneratedPerSec).toBeCloseTo(400 / 30, 2);
    expect(result.adrenalineSpent).toBe(0);

    // Ereignisse prüfen
    expect(result.damageEvents.length).toBe(50);
    expect(result.damageEvents[0].damage).toBe(10);
    expect(result.damageEvents[0].sourceId).toBe('ASMD_PRIM');
  });

  it('misst Bite über den realen Melee-Pfad und erfasst Adrenalingenerierung', () => {
    const biteConfig = getWeaponConfig('BITE');
    expect(biteConfig).toBeDefined();
    expect(biteConfig.fire.type).toBe('melee');
    expect(biteConfig.damage).toBe(50);
    expect(biteConfig.cooldown).toBe(350);
    expect(biteConfig.adrenalinGain).toBe(50);

    const result = runWeaponSingleTargetBenchmark({
      weaponId: 'BITE',
      durationMs: 30_000,
      seed: 1,
    });

    expect(result.weaponId).toBe('BITE');
    // Bei 350ms Kadenz und 16ms Ticks: t=0, 352, 704, ... -> 86 Schläge
    expect(result.shotsFired).toBe(86);
    // Im Nahkampf-Bereich trifft jeder Schwung
    expect(result.hits).toBe(86);
    expect(result.hitRate).toBe(1.0);
    expect(result.totalDamage).toBe(86 * biteConfig.damage);
    expect(result.dps).toBeCloseTo((86 * 50) / 30, 2);

    // Waffe 1 erzeugt Adrenalin: 86 Treffer * 50 Adrenalin = 4300
    expect(result.adrenalineGenerated).toBe(86 * 50);
    expect(result.adrenalineGeneratedPerSec).toBeCloseTo(4300 / 30, 2);
    expect(result.adrenalineSpent).toBe(0);

    expect(result.damageEvents.length).toBe(86);
    expect(result.damageEvents[0].damage).toBe(50);
    expect(result.damageEvents[0].sourceId).toBe('BITE');
  });

  it('reagiert automatisch auf geänderte WeaponConfig ohne Analyzer-Codeanpassung', () => {
    const baseResult = runWeaponSingleTargetBenchmark({
      weaponId: 'P90',
      durationMs: 30_000,
      seed: 1,
    });

    // Überschriebene Config mit doppeltem Basisschaden
    const modifiedConfig = {
      ...WEAPON_CONFIGS.P90,
      damage: WEAPON_CONFIGS.P90.damage * 2,
    };

    const modifiedResult = runWeaponSingleTargetBenchmark({
      weaponId: 'P90',
      durationMs: 30_000,
      seed: 1,
      weaponConfigOverride: modifiedConfig,
    });

    expect(modifiedResult.shotsFired).toBe(baseResult.shotsFired);
    expect(modifiedResult.hits).toBe(baseResult.hits);
    expect(modifiedResult.totalDamage).toBe(baseResult.totalDamage * 2);
    expect(modifiedResult.dps).toBeCloseTo(baseResult.dps * 2, 2);
  });

  it('Parity-Test: Ein Einzeltreffer im Headless-Pfad erzeugt denselben Schaden wie der WeaponFireExecutor', () => {
    const world = new HeadlessSingleTargetWorld(40, 1);
    const executor = new WeaponFireExecutor(world);

    // Ein Einzelschuss mit ASMD_PRIM über den Executor
    executor.fire(WEAPON_CONFIGS.ASMD_PRIM, {
      x: 0,
      y: 0,
      angle: 0,
      targetX: 40,
      targetY: 0,
      ownerId: 'player_1',
      ownerColor: 0xffffff,
      sourceSlot: 'weapon1',
    });

    expect(world.getHits()).toBe(1);
    expect(world.getTotalDamage()).toBe(WEAPON_CONFIGS.ASMD_PRIM.damage);
    expect(world.getAdrenalineGenerated()).toBe(WEAPON_CONFIGS.ASMD_PRIM.adrenalinGain);
  });

  it('positioniert das Ziel standardmäßig passend zur Waffenreichweite bei voller Spielergröße', () => {
    const meleeDistance = resolveDefaultTargetDistance('melee', 50);
    expect(meleeDistance).toBeLessThanOrEqual(50);
    expect(meleeDistance).toBe(40);

    const rangedDistance = resolveDefaultTargetDistance('hitscan', 700);
    expect(rangedDistance).toBe(150);

    const world = new HeadlessSingleTargetWorld(150, 1);
    expect(world.target.radius).toBe(PLAYER_SIZE * 0.5);
  });
});
