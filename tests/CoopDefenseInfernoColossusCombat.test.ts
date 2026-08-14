import { describe, expect, it, vi } from 'vitest';

// Phaser braucht ein DOM; fuer Zielauswahl, Wurfballistik und Pausenlogik reichen die Helfer.
vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Linear: (from: number, to: number, t: number) => from + (to - from) * t,
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      Squared: (x1: number, y1: number, x2: number, y2: number) => (x2 - x1) ** 2 + (y2 - y1) ** 2,
    },
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
  },
}));

import { CoopDefenseEnemyAttackSystem } from '../src/systems/CoopDefenseEnemyAttackSystem';
import { CoopDefenseEnemyAbilitySystem } from '../src/systems/CoopDefenseEnemyAbilitySystem';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, type MolotovUtilityConfig } from '../src/loadout/LoadoutConfig';
import { GenericWeapon } from '../src/loadout/GenericWeapon';
import { VOID_FIRE_COLOR } from '../src/config';
import type { BaseManager } from '../src/entities/BaseManager';
import type { EnemyAttackWeapon, EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { ProjectileManager } from '../src/entities/ProjectileManager';
import type { StinkCloudSystem } from '../src/effects/StinkCloudSystem';
import type { FireSystem } from '../src/effects/FireSystem';
import type { LoadoutManager } from '../src/loadout/LoadoutManager';
import type { CombatSystem } from '../src/systems/CombatSystem';
import type { EnergyShieldSystem } from '../src/systems/EnergyShieldSystem';
import type { FlamethrowerUpgradeSystem } from '../src/systems/FlamethrowerUpgradeSystem';

const COLOSSUS = getCoopDefenseEnemyConfig('inferno-colossus');
const SCAN_INTERVAL_MS = COLOSSUS.attackScanIntervalMs;
const STOP_DURATION_MS = COLOSSUS.attackStopDurationMs;
const VOID_ROCKETS = WEAPON_CONFIGS.INFERNO_COLOSSUS_VOID_ROCKETS;
const VOID_MOLOTOV = COLOSSUS.voidMolotov!;
const SALVO = COLOSSUS.weapons.find(weapon => weapon.salvo)!.salvo!;

interface TestPlayer {
  id: string;
  sprite: { x: number; y: number; active: boolean };
}

interface FiredShot {
  weaponId: string;
  targetX: number;
  targetY: number;
}

type TestColossus = EnemyEntity & {
  attackPauseUntil: number;
  attackPauseFactor: number;
  weaponLockouts: Map<string, number>;
  specialAction: string;
  specialActionProgress: number;
  aimAngle: number;
  stopCalls: number;
  pauseCalls: Array<{ factor: number; durationMs: number }>;
};

/**
 * Boss-Attrappe mit exakt der Waffenreihenfolge aus der Registry. Angriffspause, Waffen-Lockout
 * und Scan-Takt bilden die echte {@link EnemyEntity} nach, damit die Waffenwahl unter denselben
 * Bedingungen laeuft wie im Spiel.
 */
function createColossus(x = 100, y = 100): TestColossus {
  const weapons: EnemyAttackWeapon[] = COLOSSUS.weapons.map(configured => ({
    weapon: new GenericWeapon(WEAPON_CONFIGS[configured.weaponId as keyof typeof WEAPON_CONFIGS]),
    targetMode: configured.targetMode,
    minimumFireDurationMs: configured.minimumFireDurationMs ?? 0,
    playerMeleeWindupMs: configured.playerMeleeWindupMs ?? 0,
    attackMovementSpeedFactor: configured.attackMovementSpeedFactor ?? 0,
    minTargetDistancePx: configured.minTargetDistancePx ?? 0,
    salvo: configured.salvo,
  }));

  return {
    id: 'boss-1',
    kind: 'inferno-colossus',
    faction: 'hostile',
    attackPauseUntil: 0,
    attackPauseFactor: 0,
    weaponLockouts: new Map<string, number>(),
    specialAction: 'none',
    specialActionProgress: 0,
    aimAngle: 0,
    stopCalls: 0,
    pauseCalls: [] as Array<{ factor: number; durationMs: number }>,
    nextScanAt: 0,
    sprite: { x, y, active: true },
    getHp: () => 2_000,
    wantsToMove: () => true,
    isPathBlocked: () => false,
    getAttackWeapons: () => weapons,
    getObstacleAttackDelayMs: () => COLOSSUS.obstacleAttackDelayMs,
    isBurrowed: () => false,
    decayWeaponSpread: () => {},
    rollWeaponSpreadOffset: () => 0,
    getCollisionRadius: () => 34,
    faceAngle(angle: number) { this.aimAngle = angle; },
    stopMovement() { this.stopCalls += 1; },
    canScanForAttack(now: number) { return now >= this.nextScanAt; },
    scheduleNextAttackScan(now: number) { this.nextScanAt = now + SCAN_INTERVAL_MS; },
    isWeaponReady(weapon: GenericWeapon, now: number) {
      return !weapon.isOnCooldown(now) && now >= (this.weaponLockouts.get(weapon.config.id) ?? 0);
    },
    lockWeaponUntil(weapon: GenericWeapon, readyAt: number) {
      this.weaponLockouts.set(weapon.config.id, Math.max(this.weaponLockouts.get(weapon.config.id) ?? 0, readyAt));
    },
    recordWeaponUse: (weapon: GenericWeapon, now: number) => { weapon.recordUse(now); weapon.addSpread(); },
    isAttackMovementPaused(now: number) { return now < this.attackPauseUntil; },
    getAttackMovementSpeedFactor(now: number) {
      return now < this.attackPauseUntil ? this.attackPauseFactor : 1;
    },
    pauseAttackMovement(now: number, factor = 0, durationMs = STOP_DURATION_MS) {
      this.pauseCalls.push({ factor, durationMs });
      this.attackPauseUntil = Math.max(this.attackPauseUntil, now + Math.max(0, durationMs));
      this.attackPauseFactor = Math.min(1, Math.max(0, factor));
      if (this.attackPauseFactor <= 0) this.stopMovement();
    },
    setSpecialAction(action: string, _endsAt = 0, progress = 0) {
      this.specialAction = action;
      this.specialActionProgress = progress;
    },
  } as unknown as TestColossus;
}

function createAttackSystem(enemy: TestColossus, players: readonly TestPlayer[]) {
  const shots: FiredShot[] = [];
  const enemyManager = {
    getAllEnemies: () => [enemy],
    getAlliedEnemies: () => [],
    getEnemy: () => undefined,
    hasEnemy: (id: string) => id === enemy.id,
    isEnemyPanicking: () => false,
  } as unknown as EnemyManager;

  const system = new CoopDefenseEnemyAttackSystem(
    enemyManager,
    {
      getAllPlayers: () => players,
      getPlayer: (id: string) => players.find(player => player.id === id),
    } as unknown as PlayerManager,
    { getBases: () => [], getBasesByFaction: () => [] } as unknown as BaseManager,
    {
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
      hasLineOfSight: () => true,
      hasClearLineOfFire: () => true,
    } as unknown as CombatSystem,
    {
      fireAutomatedWeapon: (
        config: { id: string },
        _originX: number,
        _originY: number,
        _angle: number,
        targetX: number,
        targetY: number,
      ) => {
        shots.push({ weaponId: config.id, targetX, targetY });
        return true;
      },
    } as unknown as LoadoutManager,
    () => [],
  );

  return { system, shots };
}

/** Laesst den Host-Takt so lange laufen, bis `untilMs` erreicht ist. */
function runAttackFrames(
  system: CoopDefenseEnemyAttackSystem,
  fromMs: number,
  untilMs: number,
  stepMs = 16,
): void {
  for (let now = fromMs; now <= untilMs; now += stepMs) {
    system.hostUpdate(stepMs, now);
  }
}

describe('Flammenkoloss – Waffenwahl nach Distanz', () => {
  it('nutzt im Nahbereich den Hoellenwerfer und laeuft dabei mit 75 % weiter', () => {
    const enemy = createColossus();
    const { system, shots } = createAttackSystem(enemy, [{ id: 'p1', sprite: { x: 300, y: 100, active: true } }]);

    system.hostUpdate(16, 1_000);

    expect(shots.map(shot => shot.weaponId)).toEqual(['INFERNO_COLOSSUS_FLAMETHROWER']);
    // Der Boss darf waehrend des Feuerns laufen – die Pause haelt ihn nicht mehr an.
    expect(enemy.pauseCalls).toEqual([{ factor: 0.75, durationMs: STOP_DURATION_MS }]);
    expect(enemy.getAttackMovementSpeedFactor(1_000)).toBeCloseTo(0.75);
    expect(enemy.stopCalls).toBe(0);
  });

  it('feuert ab 450 px Void-Raketen und bewegt sich dabei ungebremst', () => {
    const enemy = createColossus();
    const { system, shots } = createAttackSystem(enemy, [{ id: 'p1', sprite: { x: 600, y: 100, active: true } }]);

    system.hostUpdate(16, 1_000);

    expect(shots.map(shot => shot.weaponId)).toEqual(['INFERNO_COLOSSUS_VOID_ROCKETS']);
    // Jeder Einzelschuss der Salve darf den Boss nicht festsetzen.
    expect(enemy.pauseCalls).toEqual([{ factor: 1, durationMs: STOP_DURATION_MS }]);
    expect(enemy.getAttackMovementSpeedFactor(1_000)).toBe(1);
    expect(enemy.stopCalls).toBe(0);
  });

  it('haelt die Raketen unter ihrer Mindestdistanz zurueck und laeuft stattdessen weiter', () => {
    // 400 px: zu weit fuer den Hoellenwerfer (350), zu nah fuer die Raketen (450).
    const enemy = createColossus();
    const { system, shots } = createAttackSystem(enemy, [{ id: 'p1', sprite: { x: 500, y: 100, active: true } }]);

    runAttackFrames(system, 1_000, 2_000);

    expect(shots).toEqual([]);
    expect(enemy.getAttackMovementSpeedFactor(2_000)).toBe(1);
  });

  it('feuert genau zehn Raketen und pausiert danach acht Sekunden', () => {
    const enemy = createColossus();
    const { system, shots } = createAttackSystem(enemy, [{ id: 'p1', sprite: { x: 800, y: 100, active: true } }]);

    // Eine volle Salve braucht 10 × Salventakt; grosszuegig darueber hinaus takten.
    const salvoWindowMs = SALVO.intervalMs * 14;
    runAttackFrames(system, 1_000, 1_000 + salvoWindowMs);
    expect(shots).toHaveLength(10);
    expect(shots.every(shot => shot.weaponId === 'INFERNO_COLOSSUS_VOID_ROCKETS')).toBe(true);

    // Innerhalb der Salvenpause bleibt es bei zehn Schuessen.
    runAttackFrames(system, 1_000 + salvoWindowMs, 1_000 + salvoWindowMs + 7_000);
    expect(shots).toHaveLength(10);

    // Nach der Pause startet die naechste Salve.
    runAttackFrames(system, 1_000 + salvoWindowMs + 7_000, 1_000 + salvoWindowMs + 9_000);
    expect(shots.length).toBeGreaterThan(10);
  });

  it('wechselt mitten in der Salve auf den Hoellenwerfer, wenn ein Spieler heranrueckt', () => {
    const player = { id: 'p1', sprite: { x: 800, y: 100, active: true } };
    const enemy = createColossus();
    const { system, shots } = createAttackSystem(enemy, [player]);

    // Zwei Raketen der Salve, dann schliesst der Spieler auf Nahkampfdistanz auf.
    runAttackFrames(system, 1_000, 1_000 + SALVO.intervalMs * 2);
    expect(shots.length).toBeGreaterThan(1);
    player.sprite.x = 300;

    const shotsBeforeClosing = shots.length;
    runAttackFrames(system, 1_000 + SALVO.intervalMs * 2, 1_000 + SALVO.intervalMs * 2 + 300);

    expect(shots.slice(shotsBeforeClosing).map(shot => shot.weaponId))
      .toContain('INFERNO_COLOSSUS_FLAMETHROWER');
  });

  it('beisst waehrend der Salvenpause weiter Felsen frei, statt festzuhaengen', () => {
    const enemy = createColossus();
    const rock = { x: 140, y: 100, active: true } as unknown as Phaser.GameObjects.Image;
    const shots: FiredShot[] = [];
    const enemyManager = {
      getAllEnemies: () => [enemy],
      getAlliedEnemies: () => [],
      getEnemy: () => undefined,
      hasEnemy: () => true,
      isEnemyPanicking: () => false,
    } as unknown as EnemyManager;
    const system = new CoopDefenseEnemyAttackSystem(
      enemyManager,
      {
        getAllPlayers: () => [{ id: 'p1', sprite: { x: 800, y: 100, active: true } }],
        getPlayer: () => ({ id: 'p1', sprite: { x: 800, y: 100, active: true } }),
      } as unknown as PlayerManager,
      { getBases: () => [], getBasesByFaction: () => [] } as unknown as BaseManager,
      {
        isAlive: () => true,
        isBurrowed: () => false,
        canDamageTarget: () => true,
        hasLineOfSight: () => true,
        hasClearLineOfFire: () => true,
      } as unknown as CombatSystem,
      {
        fireAutomatedWeapon: (
          config: { id: string },
          _originX: number,
          _originY: number,
          _angle: number,
          targetX: number,
          targetY: number,
        ) => {
          shots.push({ weaponId: config.id, targetX, targetY });
          return true;
        },
      } as unknown as LoadoutManager,
      () => [rock],
    );

    // Salve abfeuern, danach steckt der Boss in der Salvenpause fest.
    runAttackFrames(system, 1_000, 1_000 + VOID_ROCKETS.cooldown * 14);
    const shotsAfterSalvo = shots.length;
    runAttackFrames(system, 3_000, 5_000);

    expect(shots.slice(shotsAfterSalvo).map(shot => shot.weaponId)).toContain('INFERNO_COLOSSUS_BITE');
  });
});

describe('Flammenkoloss – Void-Brandsatz', () => {
  function createAbilitySystem(enemy: TestColossus, players: readonly TestPlayer[]) {
    const spawnProjectile = vi.fn().mockReturnValue(1);
    const system = new CoopDefenseEnemyAbilitySystem(
      {
        getAllEnemies: () => [enemy],
        getEnemy: () => enemy,
        getHostileEnemies: () => [],
      } as unknown as EnemyManager,
      { getAllPlayers: () => players } as unknown as PlayerManager,
      { spawnProjectile } as unknown as ProjectileManager,
      {
        isAlive: () => true,
        isBurrowed: () => false,
        canDamageTarget: () => true,
        hasClearLineOfFire: () => true,
      } as unknown as CombatSystem,
      null as EnergyShieldSystem | null,
      {} as StinkCloudSystem,
      { hostCreateFireChunkBurst: vi.fn() } as unknown as FlamethrowerUpgradeSystem,
      { hostRefreshGroundCellsAlongSweptCircle: vi.fn() } as unknown as FireSystem,
    );
    return { system, spawnProjectile };
  }

  it('haelt den Boss fuer die Ausholzeit an und wirft danach lila Void-Feuer', () => {
    const enemy = createColossus();
    const { system, spawnProjectile } = createAbilitySystem(enemy, [
      { id: 'p1', sprite: { x: 600, y: 100, active: true } },
    ]);

    // Erster Takt setzt nur die Anfangspause.
    system.hostUpdate(1_000);
    expect(spawnProjectile).not.toHaveBeenCalled();

    const readyAt = 1_000 + VOID_MOLOTOV.cooldownMs;
    system.hostUpdate(readyAt);
    expect(system.blocksRegularAttacks(enemy.id)).toBe(true);
    expect(enemy.specialAction).toBe('void-molotov-windup');
    expect(enemy.stopCalls).toBeGreaterThan(0);
    expect(spawnProjectile).not.toHaveBeenCalled();

    system.hostUpdate(readyAt + VOID_MOLOTOV.windupMs - 1);
    expect(spawnProjectile).not.toHaveBeenCalled();

    system.hostUpdate(readyAt + VOID_MOLOTOV.windupMs);
    expect(spawnProjectile).toHaveBeenCalledTimes(1);
    expect(system.blocksRegularAttacks(enemy.id)).toBe(false);
    expect(enemy.specialAction).toBe('none');

    const molotov = UTILITY_CONFIGS.MOLOTOV_GRENADE as MolotovUtilityConfig;
    const spawnOptions = spawnProjectile.mock.calls[0][4];
    expect(spawnOptions).toMatchObject({
      color: VOID_FIRE_COLOR,
      isGrenade: true,
      rockDamageMult: 0,
      trainDamageMult: 0,
      grenadeEffect: {
        type: 'fire',
        radius: molotov.fireRadius,
        damagePerTick: molotov.fireDamagePerTick,
        lingerDuration: molotov.fireLingerDuration,
        visualStyle: 'void',
        damageTarget: 'players',
      },
    });
  });

  it('wirft so, dass der Brandsatz bei Zuendung auf dem Ziel liegt statt darueber hinaus', () => {
    const molotov = UTILITY_CONFIGS.MOLOTOV_GRENADE as MolotovUtilityConfig;
    // Daempfungsmodell der gegnerischen Wurfphysik: v(t) = v0 * decay^t ab frictionDelayMs.
    const travelPerUnitSpeed = (flightMs: number): number => {
      const flightSeconds = flightMs / 1_000;
      const undamped = Math.min(flightSeconds, 0.3);
      return undamped + (1 - 0.15 ** (flightSeconds - undamped)) / Math.log(1 / 0.15);
    };

    for (const playerX of [100 + VOID_MOLOTOV.minRange, 100 + 480, 100 + VOID_MOLOTOV.maxRange]) {
      const enemy = createColossus();
      const { system, spawnProjectile } = createAbilitySystem(enemy, [
        { id: 'p1', sprite: { x: playerX, y: 100, active: true } },
      ]);
      const readyAt = 1_000 + VOID_MOLOTOV.cooldownMs;
      system.hostUpdate(1_000);
      system.hostUpdate(readyAt);
      system.hostUpdate(readyAt + VOID_MOLOTOV.windupMs);

      const [spawnX, , , , options] = spawnProjectile.mock.calls[0];
      const aimDistance = playerX - spawnX;
      const flownDistance = options.speed * travelPerUnitSpeed(molotov.fuseTime);
      // Der Brandsatz landet auf dem Ziel; frueher trug ihn der pauschale Aufschlag fast doppelt so weit.
      expect(flownDistance / aimDistance).toBeCloseTo(1, 1);
    }
  });

  it('haelt den Boss waehrend der Ausholzeit vollstaendig an', () => {
    const enemy = createColossus();
    const { system } = createAbilitySystem(enemy, [{ id: 'p1', sprite: { x: 600, y: 100, active: true } }]);

    system.hostUpdate(1_000);
    const readyAt = 1_000 + VOID_MOLOTOV.cooldownMs;
    system.hostUpdate(readyAt);

    expect(enemy.pauseCalls).toEqual([{ factor: 0, durationMs: VOID_MOLOTOV.windupMs }]);
    expect(enemy.getAttackMovementSpeedFactor(readyAt + 500)).toBe(0);
  });

  it('hat im Ueberlappungsbereich Vorrang vor den Raketen und weicht im Cooldown auf sie aus', () => {
    // 500 px liegt in beiden Baendern (Molotov 350–600, Raketen ab 450).
    const players = [{ id: 'p1', sprite: { x: 600, y: 100, active: true } }];
    const enemy = createColossus();
    const ability = createAbilitySystem(enemy, players);
    const attack = createAttackSystem(enemy, players);
    // Dieselbe Verkettung wie in der Arena: eine laufende Utility sperrt die regulaeren Waffen.
    attack.system.setActionBlockedChecker(id => ability.system.blocksRegularAttacks(id));

    const readyAt = 1_000 + VOID_MOLOTOV.cooldownMs;
    ability.system.hostUpdate(1_000);
    ability.system.hostUpdate(readyAt);
    attack.system.hostUpdate(16, readyAt);

    expect(ability.system.blocksRegularAttacks(enemy.id)).toBe(true);
    expect(attack.shots).toEqual([]);

    // Nach dem Wurf ist der Brandsatz im Cooldown – jetzt uebernehmen sofort die Raketen.
    ability.system.hostUpdate(readyAt + VOID_MOLOTOV.windupMs);
    expect(ability.system.blocksRegularAttacks(enemy.id)).toBe(false);

    attack.system.hostUpdate(16, readyAt + VOID_MOLOTOV.windupMs + SCAN_INTERVAL_MS);
    expect(attack.shots.map(shot => shot.weaponId)).toEqual(['INFERNO_COLOSSUS_VOID_ROCKETS']);
  });

  it('wirft nur innerhalb seines Einsatzbandes', () => {
    const nearEnemy = createColossus();
    const near = createAbilitySystem(nearEnemy, [{ id: 'p1', sprite: { x: 300, y: 100, active: true } }]);
    near.system.hostUpdate(1_000);
    near.system.hostUpdate(1_000 + VOID_MOLOTOV.cooldownMs);
    expect(near.system.blocksRegularAttacks(nearEnemy.id)).toBe(false);

    const farEnemy = createColossus();
    const far = createAbilitySystem(farEnemy, [{ id: 'p1', sprite: { x: 900, y: 100, active: true } }]);
    far.system.hostUpdate(1_000);
    far.system.hostUpdate(1_000 + VOID_MOLOTOV.cooldownMs);
    expect(far.system.blocksRegularAttacks(farEnemy.id)).toBe(false);
  });

  it('wirft nicht ohne freie Wurflinie', () => {
    const enemy = createColossus();
    const spawnProjectile = vi.fn().mockReturnValue(1);
    const system = new CoopDefenseEnemyAbilitySystem(
      {
        getAllEnemies: () => [enemy],
        getEnemy: () => enemy,
        getHostileEnemies: () => [],
      } as unknown as EnemyManager,
      { getAllPlayers: () => [{ id: 'p1', sprite: { x: 600, y: 100, active: true } }] } as unknown as PlayerManager,
      { spawnProjectile } as unknown as ProjectileManager,
      {
        isAlive: () => true,
        isBurrowed: () => false,
        canDamageTarget: () => true,
        hasClearLineOfFire: () => false,
      } as unknown as CombatSystem,
      null as EnergyShieldSystem | null,
      {} as StinkCloudSystem,
      { hostCreateFireChunkBurst: vi.fn() } as unknown as FlamethrowerUpgradeSystem,
      { hostRefreshGroundCellsAlongSweptCircle: vi.fn() } as unknown as FireSystem,
    );

    system.hostUpdate(1_000);
    system.hostUpdate(1_000 + VOID_MOLOTOV.cooldownMs);

    expect(system.blocksRegularAttacks(enemy.id)).toBe(false);
    expect(spawnProjectile).not.toHaveBeenCalled();
  });
});

describe('Flammenkoloss – Void-Darstellung', () => {
  it('startet jede Rakete brennend mit lila Void-Feuer', () => {
    expect(VOID_ROCKETS.burnOnHit?.durationMs).toBeGreaterThan(0);
    expect(VOID_ROCKETS.burnOnHit?.damagePerTick).toBeGreaterThan(0);
    expect(VOID_ROCKETS.projectileBurnVisualStyle).toBe('void');
  });

  it('faerbt Rakete, Rauch und Explosion violett', () => {
    expect(VOID_ROCKETS.projectileColor).toBe(0xd98cff);
    expect(VOID_ROCKETS.rocketSmokeTrailColor).toBe(0xa755ff);
    expect(VOID_ROCKETS.fire.type).toBe('projectile');
    expect(VOID_ROCKETS.fire.type === 'projectile' && VOID_ROCKETS.fire.impactExplosion?.color).toBe(VOID_FIRE_COLOR);
  });

  it('verwendet Spieler-Homing bei 1000 px Reichweite', () => {
    expect(VOID_ROCKETS.range).toBe(1_000);
    expect(VOID_ROCKETS.fire.type === 'projectile' && VOID_ROCKETS.fire.homing?.targetTypes).toEqual(['players']);
    expect(VOID_ROCKETS.fire.type === 'projectile' && VOID_ROCKETS.fire.homing?.maxTurnDegreesPerStep).toBeGreaterThan(0);
  });

  it('taktet die Salve im geforderten Fenster von 75–100 ms', () => {
    expect(VOID_ROCKETS.cooldown).toBeGreaterThanOrEqual(75);
    expect(VOID_ROCKETS.cooldown).toBeLessThanOrEqual(100);
  });

  it('behaelt die vorhandenen Void-Feuer-Effekte des Bosses unveraendert', () => {
    expect(COLOSSUS.voidFireChunks).toMatchObject({ visualStyle: 'void', damageTarget: 'players' });
    expect(COLOSSUS.voidFireTrail).toMatchObject({ visualStyle: 'void', damageTarget: 'players' });
  });
});
