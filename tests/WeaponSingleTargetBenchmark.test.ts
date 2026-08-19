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
  runWeaponSingleTargetBenchmark,
  resolveDefaultTargetDistance,
} from '../src/debug/coopDefenseBalance/weaponBenchmark';
import { HeadlessSingleTargetWorld } from '../src/debug/coopDefenseBalance/HeadlessSingleTargetWorld';
import {
  UnsupportedWeaponMechanicError,
  validateWeaponBalanceCapabilities,
} from '../src/debug/coopDefenseBalance/weaponCapabilityValidator';
import {
  checkSweptCircleHit,
  checkHitscanRayCircleHit,
  checkMeleeArcHit,
  isAngleWithinArc,
} from '../src/combat/rules/DirectCombatHitResolver';
import { resolveShotPlan } from '../src/loadout/ShotPlanResolver';
import { WEAPON_CONFIGS, getWeaponConfig, type WeaponConfig } from '../src/loadout/LoadoutConfig';
import { GenericWeapon } from '../src/loadout/GenericWeapon';
import { WeaponFireExecutor } from '../src/loadout/WeaponFireExecutor';
import { PLAYER_SIZE } from '../src/config';

describe('Weapon Balance Lab 0.2 – Paritäts- und Simulationsfundament', () => {
  describe('1. Determinismus & Reproduzierbarkeit', () => {
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
  });

  describe('2. Frame-/Step-Unabhängigkeit der Feuerrate', () => {
    it('liefert bei ASMD Primär identische Schusszahlen und DPS für stepDeltaMs 8, 16 und 25', () => {
      const run8 = runWeaponSingleTargetBenchmark({
        weaponId: 'ASMD_PRIM',
        durationMs: 30_000,
        stepDeltaMs: 8,
        seed: 1,
      });

      const run16 = runWeaponSingleTargetBenchmark({
        weaponId: 'ASMD_PRIM',
        durationMs: 30_000,
        stepDeltaMs: 16,
        seed: 1,
      });

      const run25 = runWeaponSingleTargetBenchmark({
        weaponId: 'ASMD_PRIM',
        durationMs: 30_000,
        stepDeltaMs: 25,
        seed: 1,
      });

      expect(run8.shotsFired).toBe(50);
      expect(run16.shotsFired).toBe(50);
      expect(run25.shotsFired).toBe(50);

      expect(run8.totalDamage).toBe(run16.totalDamage);
      expect(run16.totalDamage).toBe(run25.totalDamage);

      expect(run8.dps).toBeCloseTo(run16.dps, 4);
      expect(run16.dps).toBeCloseTo(run25.dps, 4);
    });

    it('liefert bei Bite identische Schusszahlen für stepDeltaMs 8, 16 und 25', () => {
      const run8 = runWeaponSingleTargetBenchmark({
        weaponId: 'BITE',
        durationMs: 30_000,
        stepDeltaMs: 8,
        seed: 1,
      });

      const run16 = runWeaponSingleTargetBenchmark({
        weaponId: 'BITE',
        durationMs: 30_000,
        stepDeltaMs: 16,
        seed: 1,
      });

      const run25 = runWeaponSingleTargetBenchmark({
        weaponId: 'BITE',
        durationMs: 30_000,
        stepDeltaMs: 25,
        seed: 1,
      });

      expect(run8.shotsFired).toBe(86);
      expect(run16.shotsFired).toBe(86);
      expect(run25.shotsFired).toBe(86);
      expect(run8.totalDamage).toBe(run16.totalDamage);
      expect(run16.totalDamage).toBe(run25.totalDamage);
    });
  });

  describe('3. P90, ASMD_PRIM und BITE Basismessung', () => {
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
      // Unter optimaler Trigger Discipline bei 150px Distanz feuert die P90 kontrollierte Salven
      expect(result.shotsFired).toBe(69);
      expect(result.hits).toBe(69);
      expect(result.hitRate).toBe(1.0);
      expect(result.totalDamage).toBe(69 * p90Config.damage);
      expect(result.dps).toBeCloseTo((69 * p90Config.damage) / 30, 2);

      // Adrenalinverbrauch: 69 Schuss * 4 Adrenalin = 276
      expect(result.adrenalineSpent).toBe(69 * 4);
      expect(result.adrenalineSpentPerSec).toBeCloseTo(276 / 30, 2);
      expect(result.adrenalineGenerated).toBe(0);

      // Schadensereignisse tragen reale Schadenswerte und CombatDamageKind 'direct'
      expect(result.damageEvents.length).toBe(result.hits);
      expect(result.damageEvents[0].damage).toBe(8);
      expect(result.damageEvents[0].damageKind).toBe('direct');
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
      expect(result.shotsFired).toBe(50);
      expect(result.hits).toBe(50);
      expect(result.hitRate).toBe(1.0);
      expect(result.totalDamage).toBe(50 * asmdConfig.damage);
      expect(result.dps).toBeCloseTo((50 * 10) / 30, 2);

      expect(result.adrenalineGenerated).toBe(50 * 8);
      expect(result.adrenalineGeneratedPerSec).toBeCloseTo(400 / 30, 2);
      expect(result.adrenalineSpent).toBe(0);

      expect(result.damageEvents.length).toBe(50);
      expect(result.damageEvents[0].damage).toBe(10);
      expect(result.damageEvents[0].damageKind).toBe('direct');
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
      expect(result.shotsFired).toBe(86);
      expect(result.hits).toBe(86);
      expect(result.hitRate).toBe(1.0);
      expect(result.totalDamage).toBe(86 * biteConfig.damage);
      expect(result.dps).toBeCloseTo((86 * 50) / 30, 2);

      expect(result.adrenalineGenerated).toBe(86 * 50);
      expect(result.adrenalineGeneratedPerSec).toBeCloseTo(4300 / 30, 2);
      expect(result.adrenalineSpent).toBe(0);

      expect(result.damageEvents.length).toBe(86);
      expect(result.damageEvents[0].damage).toBe(50);
      expect(result.damageEvents[0].damageKind).toBe('direct');
      expect(result.damageEvents[0].sourceId).toBe('BITE');
    });
  });

  describe('4. Attack Window und Settle Phase', () => {
    it('lässt vor Ende des Attack Windows abgefeuerte Projektile in der Settle Phase sauber treffen', () => {
      // Einzelschuss-Projektil mit langsamer Flugzeit (100 px/s, Distanz 100px -> 1000ms Flugzeit)
      const slowProjectileConfig: WeaponConfig = {
        id: 'SLOW_TEST_GUN',
        cooldown: 500,
        damage: 100,
        range: 500,
        fire: {
          type: 'projectile',
          projectileSpeed: 100,
          projectileSize: 8,
          projectileMaxBounces: 0,
        },
        allowedSlots: ['weapon1'],
        adrenalinCost: 0,
        adrenalinGain: 10,
        spreadStanding: 0,
        spreadMoving: 0,
        spreadPerShot: 0,
        maxDynamicSpread: 0,
        spreadRecoveryDelay: 400,
        spreadRecoveryRate: 5,
        spreadRecoverySpeed: 100,
      };

      // Attack Window von nur 100 ms: Schuss fällt bei t=0, Fenster schließt bei t=100.
      // Das Projektil trifft erst bei ca. t=840 ms in der Settle Phase.
      const result = runWeaponSingleTargetBenchmark({
        weaponId: 'SLOW_TEST_GUN',
        durationMs: 100,
        stepDeltaMs: 16,
        targetDistance: 100,
        weaponConfigOverride: slowProjectileConfig,
      });

      expect(result.shotsFired).toBe(1);
      expect(result.hits).toBe(1);
      expect(result.totalDamage).toBe(100);
      // DPS-Nenner bleibt exakt das 100ms Attack Window: 100 / 0.1s = 1000 DPS
      expect(result.dps).toBeCloseTo(100 / 0.1, 2);
      expect(result.settleDurationMs).toBeGreaterThan(500);
    });
  });

  describe('5. Multi-Projectile-Unterstützung (Pellets)', () => {
    it('führt pelletCount > 1 Salven als 1 Schuss mit unabhängigen Pellet-Treffern aus', () => {
      const shotgunConfig: WeaponConfig = {
        id: 'TEST_SHOTGUN',
        cooldown: 1000,
        damage: 10,
        pelletCount: 5,
        pelletSpreadAngle: 8,
        range: 300,
        fire: {
          type: 'projectile',
          projectileSpeed: 1000,
          projectileSize: 4,
          projectileMaxBounces: 0,
        },
        allowedSlots: ['weapon1'],
        adrenalinCost: 0,
        adrenalinGain: 2,
        spreadStanding: 0,
        spreadMoving: 0,
        spreadPerShot: 0,
        maxDynamicSpread: 0,
        spreadRecoveryDelay: 400,
        spreadRecoveryRate: 5,
        spreadRecoverySpeed: 100,
      };

      const result = runWeaponSingleTargetBenchmark({
        weaponId: 'TEST_SHOTGUN',
        durationMs: 5_000,
        stepDeltaMs: 16,
        targetDistance: 50,
        weaponConfigOverride: shotgunConfig,
      });

      // Bei 1000ms Cooldown in 5s: Schüsse bei t=0, 1000, 2000, 3000, 4000 -> 5 Salven
      expect(result.shotsFired).toBe(5);
      // Bei 5 Pellets pro Salve auf kurze Distanz (50px) treffen alle Pellets
      expect(result.hits).toBe(25);
      expect(result.totalDamage).toBe(25 * 10);
      expect(result.hitRate).toBe(1.0);
      expect(result.adrenalineGenerated).toBe(25 * 2);
    });
  });

  describe('6. Bookkeeping bei fehlschlagendem Fire-Sink', () => {
    it('erhöht keine Schuss-/Ressourcenzähler wenn der Fire-Sink den Schuss ablehnt', () => {
      const world = new HeadlessSingleTargetWorld(150, 1);
      world.failingSink = true; // Sink verweigert die Schussannahme

      const weapon = new GenericWeapon(WEAPON_CONFIGS.P90);
      const executor = new WeaponFireExecutor(world);

      const shotPlan = resolveShotPlan({
        config: WEAPON_CONFIGS.P90,
        aimAngle: 0,
        dynamicSpread: 0,
      });

      let anyFired = false;
      for (const shot of shotPlan.shots) {
        const fired = executor.fire(shot.config, {
          x: 0,
          y: 0,
          angle: shot.angle,
          targetX: 150,
          targetY: 0,
          ownerId: 'player',
          ownerColor: 0xffffff,
          sourceSlot: 'weapon2',
        });
        if (fired) anyFired = true;
      }

      expect(anyFired).toBe(false);
      // Wenn nicht gefeuert wurde, darf weder Schuss noch Adrenalin verbucht werden
      expect(world.getShotsFired()).toBe(0);
      expect(world.getAdrenalineSpent()).toBe(0);
      expect(weapon.getLastUsedAt()).toBe(-Infinity);
      expect(weapon.getDynamicSpread()).toBe(0);
    });
  });

  describe('7. Unsupported Mechanics Erkennung', () => {
    it('lehnt ununterstützte Mechaniken wie Burn oder Explosion explizit ab', () => {
      const burnConfig: WeaponConfig = {
        ...WEAPON_CONFIGS.P90,
        id: 'UNSUPPORTED_BURN_GUN',
        burnOnHit: {
          durationMs: 3000,
          damagePerTick: 5,
        },
      };

      const check = validateWeaponBalanceCapabilities(burnConfig);
      expect(check.supported).toBe(false);
      expect(check.unsupportedReasons.some(r => r.includes('burnOnHit'))).toBe(true);

      expect(() => {
        runWeaponSingleTargetBenchmark({
          weaponId: 'UNSUPPORTED_BURN_GUN',
          weaponConfigOverride: burnConfig,
        });
      }).toThrow(UnsupportedWeaponMechanicError);
    });

    it('akzeptiert P90, ASMD Primär und Bite als unterstützt', () => {
      expect(validateWeaponBalanceCapabilities(WEAPON_CONFIGS.P90).supported).toBe(true);
      expect(validateWeaponBalanceCapabilities(WEAPON_CONFIGS.ASMD_PRIM).supported).toBe(true);
      expect(validateWeaponBalanceCapabilities(WEAPON_CONFIGS.BITE).supported).toBe(true);
    });
  });

  describe('8. Reaktivität auf WeaponConfig', () => {
    it('reagiert automatisch auf geänderte WeaponConfig ohne Analyzer-Codeanpassung', () => {
      const baseResult = runWeaponSingleTargetBenchmark({
        weaponId: 'P90',
        durationMs: 30_000,
        seed: 1,
      });

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
  });

  describe('9. Geteilte Logik & Geometrie-Resolver', () => {
    it('Shared Shot-Orchestrierung: resolveShotPlan liefert identische Schusswinkel für Runtime und Headless', () => {
      const rng = () => 0.5; // Feste RNG-Rückgabe für deterministischen Vergleich

      const planA = resolveShotPlan({
        config: WEAPON_CONFIGS.P90,
        aimAngle: 0.25,
        dynamicSpread: 4,
        isMoving: true,
        random: rng,
      });

      const planB = resolveShotPlan({
        config: WEAPON_CONFIGS.P90,
        aimAngle: 0.25,
        dynamicSpread: 4,
        isMoving: true,
        random: rng,
      });

      expect(planA.totalSpreadDeg).toBe(planB.totalSpreadDeg);
      expect(planA.halfSpreadRad).toBe(planB.halfSpreadRad);
      expect(planA.shots[0].angle).toBe(planB.shots[0].angle);
    });

    it('Shared Arc-Geometrie: isAngleWithinArc und CombatGeometry.isWithinArc arbeiten identisch', () => {
      const facing = 0;
      const halfArc = Math.PI / 4; // 45°
      // Ziel bei 30° -> im Bogen
      expect(isAngleWithinArc(Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), facing, halfArc)).toBe(true);
      // Ziel bei 60° -> außerhalb des Bogens
      expect(isAngleWithinArc(Math.cos(Math.PI / 3), Math.sin(Math.PI / 3), facing, halfArc)).toBe(false);
    });

    it('Headless-Resolver: DirectCombatHitResolver Projektil-Sweep', () => {
      // Prüfe, dass der Resolver einen swept Linien-Treffer auflöst
      const hit = checkSweptCircleHit(0, 0, 100, 0, 50, 0, 16);
      expect(hit).not.toBeNull();
      expect(hit!.hit).toBe(true);
      expect(hit!.distance).toBeCloseTo(34, 1);
      expect(hit!.x).toBeCloseTo(34, 1);
      expect(hit!.y).toBe(0);

      // Verfehlen
      const miss = checkSweptCircleHit(0, 0, 100, 0, 50, 50, 16);
      expect(miss).toBeNull();
    });

    it('Headless-Resolver: DirectCombatHitResolver Hitscan-Ray', () => {
      const hit = checkHitscanRayCircleHit(0, 0, 0, 500, 4, 100, 0, 16);
      expect(hit).not.toBeNull();
      expect(hit!.hit).toBe(true);
      // Effektiver Radius = 16 + 4*0.5 = 18; Abstand = 100 - 18 = 82
      expect(hit!.distance).toBeCloseTo(82, 1);

      // Zu geringe Reichweite
      const outOfRange = checkHitscanRayCircleHit(0, 0, 0, 50, 4, 100, 0, 16);
      expect(outOfRange).toBeNull();
    });

    it('Headless-Resolver: DirectCombatHitResolver Melee-Arc', () => {
      // Treffer innerhalb 80° Bogen und 50px Reichweite + 16px Zielradius = 66px
      const hit = checkMeleeArcHit(0, 0, 0, 50, 80, 40, 0, 16);
      expect(hit).not.toBeNull();
      expect(hit!.hit).toBe(true);
      expect(hit!.distance).toBe(40);

      // Außerhalb des Bogens (90° Abweichung bei 80° Gesamtbogen)
      const outOfArc = checkMeleeArcHit(0, 0, 0, 50, 80, 0, 40, 16);
      expect(outOfArc).toBeNull();

      // Außerhalb der Reichweite (80px > 66px)
      const outOfRange = checkMeleeArcHit(0, 0, 0, 50, 80, 80, 0, 16);
      expect(outOfRange).toBeNull();
    });
  });
});
