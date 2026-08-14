import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import { RockGridIndex } from '../src/arena/RockGridIndex';
import { AutoTiler, ROCK_AUTOTILE } from '../src/arena/AutoTiler';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';
import {
  COOP_DEFENSE_CONSTRUCTIONS,
  COOP_DEFENSE_CONSTRUCTION_IDS,
} from '../src/config/coopDefenseConstructions';
import type { PlayerManager } from '../src/entities/PlayerManager';
import {
  UTILITY_CONFIGS,
  WEAPON_CONFIGS,
  type PlaceableTurretUtilityConfig,
} from '../src/loadout/LoadoutConfig';
import { POWERUP_DEFS, TIMED_POWERUP_PEDESTAL_CONFIGS } from '../src/powerups/PowerUpConfig';
import { PowerUpSystem } from '../src/powerups/PowerUpSystem';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import { TimeBubbleSystem } from '../src/systems/TimeBubbleSystem';
import { TurretSystem } from '../src/systems/TurretSystem';
import type { ArenaLayout } from '../src/types';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS } from '../src/utils/coopDefenseUpgrades';

const layout: ArenaLayout = {
  seed: 1,
  rocks: [],
  trees: [],
  tracks: [],
  dirt: [],
  // Unbekannter Typ wird nicht materialisiert, reserviert aber die statische ID 7.
  powerUpPedestals: [{ id: 7, defId: 'UNKNOWN', gridX: 0, gridY: 0 }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Inspector support construction registry', () => {
  it('uses text placeholders until the six new construction icons exist', () => {
    expect([
      'flame_turret',
      'tesla_turret',
      'gravity_turret',
      'slow_bubble_turret',
      'medic_pedestal',
      'armor_pedestal',
    ].map((id) => COOP_DEFENSE_CONSTRUCTIONS[id as keyof typeof COOP_DEFENSE_CONSTRUCTIONS].iconKey))
      .toEqual([null, null, null, null, null, null]);
  });

  it('registers the four constructs with their intended behavior and capacity', () => {
    expect(COOP_DEFENSE_CONSTRUCTION_IDS).toEqual(expect.arrayContaining([
      'gravity_turret',
      'slow_bubble_turret',
      'medic_pedestal',
      'armor_pedestal',
    ]));

    expect(COOP_DEFENSE_CONSTRUCTIONS.gravity_turret).toMatchObject({
      kind: 'turret', weaponId: 'TURRET_GRAVITY',
      energyInjectorEffect: { type: 'gravity_pull' },
    });
    expect(COOP_DEFENSE_CONSTRUCTIONS.gravity_turret.maxHp).toBeGreaterThan(0);
    expect(COOP_DEFENSE_CONSTRUCTIONS.gravity_turret.targetRange).toBeGreaterThan(0);
    expect(COOP_DEFENSE_CONSTRUCTIONS.gravity_turret.capacityCost).toBeGreaterThan(0);
    expect(COOP_DEFENSE_CONSTRUCTIONS.gravity_turret.energyInjectorEffect.pullStrengthMultiplier).toBeGreaterThan(0);
    expect(COOP_DEFENSE_CONSTRUCTIONS.slow_bubble_turret).toMatchObject({
      kind: 'turret', weaponId: 'TURRET_SLOW_BUBBLE',
      energyInjectorEffect: { type: 'slow_bubble' },
    });
    expect(COOP_DEFENSE_CONSTRUCTIONS.slow_bubble_turret.maxHp).toBeGreaterThan(0);
    expect(COOP_DEFENSE_CONSTRUCTIONS.slow_bubble_turret.targetRange).toBeGreaterThan(0);
    expect(COOP_DEFENSE_CONSTRUCTIONS.slow_bubble_turret.capacityCost).toBeGreaterThan(0);
    expect(COOP_DEFENSE_CONSTRUCTIONS.slow_bubble_turret.energyInjectorEffect.slowStrengthMultiplier).toBeGreaterThan(0);
    expect(COOP_DEFENSE_CONSTRUCTIONS.medic_pedestal).toMatchObject({
      kind: 'pedestal', powerUpDefId: 'HEALTH_PACK', indestructible: true,
      energyInjectorEffect: { type: 'powerup_cooldown' },
    });
    expect(COOP_DEFENSE_CONSTRUCTIONS.medic_pedestal.capacityCost).toBeGreaterThan(0);
    expect(COOP_DEFENSE_CONSTRUCTIONS.medic_pedestal.energyInjectorEffect?.respawnTimeMultiplier)
      .toBeGreaterThan(0);
    expect(COOP_DEFENSE_CONSTRUCTIONS.armor_pedestal).toMatchObject({
      kind: 'pedestal', powerUpDefId: 'ARMOR', indestructible: true,
      energyInjectorEffect: { type: 'powerup_cooldown' },
    });
    expect(COOP_DEFENSE_CONSTRUCTIONS.armor_pedestal.capacityCost).toBeGreaterThan(0);
    expect(COOP_DEFENSE_CONSTRUCTIONS.armor_pedestal.energyInjectorEffect?.respawnTimeMultiplier)
      .toBeGreaterThan(0);
    expect(COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.energyInjectorEffect)
      .toMatchObject({ type: 'damage_turret' });
    expect(COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.energyInjectorEffect.damageMultiplier).toBeGreaterThan(1);
    const mushroom = UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig;
    expect(mushroom.placeable.energyInjectorEffect).toMatchObject({ type: 'damage_turret' });
    expect(mushroom.placeable.energyInjectorEffect?.damageMultiplier).toBeGreaterThan(1);
  });

  it('configures both support projectiles without damage', () => {
    const gravity = WEAPON_CONFIGS.TURRET_GRAVITY;
    const slow = WEAPON_CONFIGS.TURRET_SLOW_BUBBLE;
    expect(gravity.damage).toBe(0);
    expect(slow.damage).toBe(0);
    expect(gravity.cooldown).toBeGreaterThan(0);
    expect(slow.cooldown).toBeGreaterThan(0);
    expect(gravity.range).toBeGreaterThan(0);
    expect(slow.range).toBeGreaterThan(0);
    expect(gravity.fire.type).toBe('projectile');
    expect(slow.fire.type).toBe('projectile');
    if (gravity.fire.type !== 'projectile' || slow.fire.type !== 'projectile') return;

    expect(gravity.fire.impactExplosion).toMatchObject({
      radius: expect.any(Number),
      maxDamage: 0,
      knockback: 0,
      rockDamageMult: 0,
      trainDamageMult: 0,
      blackHoleDurationMs: expect.any(Number),
      blackHolePullStrength: expect.any(Number),
    });
    expect(slow.fire.impactExplosion).toMatchObject({
      radius: expect.any(Number),
      maxDamage: 0,
      knockback: 0,
      rockDamageMult: 0,
      trainDamageMult: 0,
      timeBubble: {
        type: 'time_bubble',
        radius: expect.any(Number),
        duration: expect.any(Number),
        projectileSlowFactor: expect.any(Number),
        playerSlowFactor: expect.any(Number),
        trainSlowFactor: expect.any(Number),
        friendlyImmunity: 0,
      },
    });
    expect(slow.grenadeVisualPreset).toBe('time_bubble');
  });

  it('exposes four refundable one-point unlocks in the intended order', () => {
    for (const id of [
      'unlock_gravity_turret',
      'unlock_slow_bubble_turret',
      'unlock_medic_pedestal',
      'unlock_armor_pedestal',
    ]) {
      const definition = COOP_DEFENSE_UPGRADE_DEFINITIONS[id];
      expect(definition.code.length).toBeGreaterThan(0);
      expect(definition.maxLevel).toBeGreaterThan(0);
      expect(definition.startingLevel).toBeGreaterThanOrEqual(0);
      expect(definition.startingLevel).toBeLessThanOrEqual(definition.maxLevel);
      expect(definition.costPerLevel).toBeGreaterThanOrEqual(0);
      expect(definition.refundable).toBe(true);
    }
  });
});

describe('Inspector automated support turrets', () => {
  it('fires the rocket turret as a fast two-shot burst before its reload', () => {
    const combat = {
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
    };
    const fire = vi.fn();
    const turrets = new TurretSystem(
      { getAllPlayers: () => [] } as unknown as PlayerManager,
      combat as never,
    );
    turrets.setEnemyTargetProvider(() => [{ id: 'enemy', x: 100, y: 0 }]);
    turrets.setTurretProvider(() => [{
      id: 1,
      x: 0,
      y: 0,
      ownerId: 'inspector',
      ownerColor: 0xff8a3d,
      weaponId: 'TURRET_ROCKET_BURST',
      targetRange: 150,
      muzzleOffset: 16,
    }], null);
    turrets.setFireHandler(fire);

    const rocketConfig = WEAPON_CONFIGS.TURRET_ROCKET_BURST;
    const burstIntervalMs = rocketConfig.turretBurst?.intervalMs ?? 1;
    const reloadAt = burstIntervalMs + Math.max(1, rocketConfig.cooldown);
    turrets.hostUpdate(0, UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig, WEAPON_CONFIGS.SPORES);
    turrets.hostUpdate(
      Math.max(0, burstIntervalMs - 1),
      UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig,
      WEAPON_CONFIGS.SPORES,
    );
    expect(fire).toHaveBeenCalledOnce();

    turrets.hostUpdate(
      burstIntervalMs,
      UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig,
      WEAPON_CONFIGS.SPORES,
    );
    expect(fire).toHaveBeenCalledTimes(2);

    turrets.hostUpdate(
      reloadAt - 1,
      UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig,
      WEAPON_CONFIGS.SPORES,
    );
    expect(fire).toHaveBeenCalledTimes(2);
    turrets.hostUpdate(
      reloadAt,
      UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig,
      WEAPON_CONFIGS.SPORES,
    );
    expect(fire).toHaveBeenCalledTimes(3);
  });

  it('prioritizes the focused target without bypassing normal range or line of fire', () => {
    const combat = {
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
    };
    const fire = vi.fn();
    const turrets = new TurretSystem(
      { getAllPlayers: () => [] } as unknown as PlayerManager,
      combat as never,
    );
    turrets.setEnemyTargetProvider(() => [
      { id: 'near', x: 20, y: 0 },
      { id: 'focused', x: 120, y: 0 },
    ]);
    turrets.setFocusTargetProvider(() => ({ targetType: 'enemy', targetId: 'focused' }));
    turrets.setTurretProvider(() => [{
      id: 1,
      x: 0,
      y: 0,
      ownerId: 'inspector',
      ownerColor: 0xffffff,
      weaponId: 'TURRET_GRAVITY',
      targetRange: 150,
      muzzleOffset: 0,
    }], null);
    turrets.setLineOfFireChecker(() => true);
    turrets.setFireHandler(fire);

    turrets.hostUpdate(0, UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig, WEAPON_CONFIGS.SPORES);

    expect(fire.mock.calls[0]?.slice(6, 8)).toEqual([120, 0]);
  });

  it('falls back to a normal target when the focus target is out of range or blocked', () => {
    const combat = {
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
    };
    const fire = vi.fn();
    const turrets = new TurretSystem(
      { getAllPlayers: () => [] } as unknown as PlayerManager,
      combat as never,
    );
    turrets.setEnemyTargetProvider(() => [
      { id: 'near', x: 20, y: 0 },
      { id: 'focused', x: 120, y: 0 },
    ]);
    turrets.setFocusTargetProvider(() => ({ targetType: 'enemy', targetId: 'focused' }));
    turrets.setTurretProvider(() => [{
      id: 1,
      x: 0,
      y: 0,
      ownerId: 'inspector',
      ownerColor: 0xffffff,
      weaponId: 'TURRET_GRAVITY',
      targetRange: 150,
      muzzleOffset: 0,
    }], null);
    turrets.setLineOfFireChecker((_sx, _sy, targetX) => targetX !== 120);
    turrets.setFireHandler(fire);

    turrets.hostUpdate(0, UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig, WEAPON_CONFIGS.SPORES);

    expect(fire.mock.calls[0]?.slice(6, 8)).toEqual([20, 0]);
  });

  it.each(['TURRET_GRAVITY', 'TURRET_SLOW_BUBBLE'] as const)(
    '%s uses the regular target, range and line-of-fire path',
    (weaponId) => {
      const combat = {
        isAlive: () => true,
        isBurrowed: () => false,
        canDamageTarget: () => true,
      };
      const lineOfFire = vi.fn(() => true);
      const fire = vi.fn();
      const turrets = new TurretSystem(
        { getAllPlayers: () => [] } as unknown as PlayerManager,
        combat as never,
      );
      turrets.setEnemyTargetProvider(() => [{ id: 'enemy', x: 100, y: 0 }]);
      turrets.setTurretProvider(() => [{
        id: 1,
        x: 0,
        y: 0,
        ownerId: 'inspector',
        ownerColor: 0xa755ff,
        weaponId,
        targetRange: weaponId === 'TURRET_GRAVITY' ? 520 : 500,
        muzzleOffset: 16,
        skipRockIndex: 1,
      }], null);
      turrets.setLineOfFireChecker(lineOfFire);
      turrets.setFireHandler(fire);

      turrets.hostUpdate(
        0,
        UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig,
        WEAPON_CONFIGS.SPORES,
      );

      expect(lineOfFire).toHaveBeenCalledOnce();
      expect(lineOfFire.mock.calls[0].slice(0, 5)).toEqual([16, 0, 100, 0, 1]);
      expect(fire).toHaveBeenCalledOnce();
      expect(fire.mock.calls[0][2]).toBe(weaponId);
      expect(fire.mock.calls[0].slice(3, 8)).toEqual([16, 0, 0, 100, 0]);
      expect(fire.mock.calls[0][11]).toBe(1);
    },
  );
});

describe('shared Time Bubble payload', () => {
  it('slows friendly players, projectiles and the train when immunity is zero', () => {
    const system = new TimeBubbleSystem();
    system.setFriendlyResolver(() => true);
    system.hostCreateBubble('inspector', 100, 100, {
      type: 'time_bubble',
      radius: 72,
      duration: 3000,
      projectileSlowFactor: 0.4,
      playerSlowFactor: 0.5,
      trainSlowFactor: 0.5,
      friendlyImmunity: 0,
    }, 1000);

    expect(system.getPlayerMovementFactorAt(100, 100, 1200, 'friendly')).toBe(0.5);
    expect(system.getProjectileMovementFactorAt(100, 100, 1200, 'friendly')).toBe(0.4);
    expect(system.getTrainMovementFactorAt(100, [100], [20], 20, 1200)).toBe(0.5);
    expect(system.hostUpdate(4000)).toEqual([]);
  });
});

describe('dynamic construction pedestals', () => {
  function createSystem() {
    const healToFull = vi.fn();
    const addArmor = vi.fn();
    const system = new PowerUpSystem(
      { getAllPlayers: () => [] } as unknown as PlayerManager,
      {
        healToFull,
        addArmor,
        isAlive: () => true,
        isBurrowed: () => false,
        applyDamage: vi.fn(),
        applyExplosionDamage: vi.fn(),
      },
      layout,
    );
    system.setArenaStartTime(1);
    return { system, healToFull, addArmor };
  }

  it.each([
    ['HEALTH_PACK', 'heal'] as const,
    ['ARMOR', 'armor'] as const,
  ])('spawns and respawns one %s with its existing effect and cooldown', (defId, effect) => {
    const respawnMs = TIMED_POWERUP_PEDESTAL_CONFIGS[defId].respawnMs;
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { system, healToFull, addArmor } = createSystem();

    expect(system.registerConstructionPedestal(42, defId, 200, 240)).toBe(true);
    expect(system.registerConstructionPedestal(42, defId, 200, 240)).toBe(true);
    expect(system.getWorldItemSnapshot()).toEqual([{ uid: 1, defId, x: 200, y: 240 }]);
    expect(system.getPedestalSnapshot()).toEqual([{
      id: 8,
      defId,
      x: 200,
      y: 240,
      hasPowerUp: true,
      nextRespawnAt: 0,
    }]);

    system.tryPickup('player', 1, 200, 240);
    expect(effect === 'heal' ? healToFull : addArmor).toHaveBeenCalledOnce();
    if (effect === 'armor') expect(addArmor).toHaveBeenCalledWith('player', POWERUP_DEFS.ARMOR.amount);
    expect(system.getWorldItemSnapshot()).toEqual([]);
    expect(system.getPedestalSnapshot()[0]).toMatchObject({
      hasPowerUp: false,
      nextRespawnAt: now + respawnMs,
    });

    now += respawnMs - 1;
    system.update(0);
    expect(system.getWorldItemSnapshot()).toEqual([]);
    now += 1;
    system.update(0);
    expect(system.getWorldItemSnapshot()).toEqual([{ uid: 2, defId, x: 200, y: 240 }]);
  });

  it('replicates the owner color only for a construction pedestal', () => {
    const { system } = createSystem();

    system.registerConstructionPedestal(42, 'HEALTH_PACK', 200, 240, 0x55ff99);

    expect(system.getPedestalSnapshot()[0]).toMatchObject({
      ownerColor: 0x55ff99,
    });
  });

  it('replicates removal and removes an outstanding item on dismantle', () => {
    const { system } = createSystem();
    system.registerConstructionPedestal(42, 'HEALTH_PACK', 200, 240);
    system.getNetSnapshot();
    system.getPedestalNetSnapshot();

    expect(system.unregisterConstructionPedestal(42)).toBe(true);
    expect(system.getWorldItemSnapshot()).toEqual([]);
    expect(system.getNetSnapshot()).toMatchObject({ full: false, removals: [1] });
    expect(system.getPedestalNetSnapshot()).toEqual({ full: false, upserts: [], removals: [8] });
  });

  it('places pedestals as indestructible, blocking and dismantleable constructs', () => {
    const rockGrid = new RockGridIndex(layout.rocks);
    const placement = new PlacementSystem(
      layout,
      rockGrid,
      { getAllPlayers: () => [] } as unknown as PlayerManager,
    );
    const originX = ARENA_OFFSET_X + CELL_SIZE * 3.5;
    const originY = ARENA_OFFSET_Y + CELL_SIZE * 3.5;
    const targetX = ARENA_OFFSET_X + CELL_SIZE * 4.5;
    const targetY = ARENA_OFFSET_Y + CELL_SIZE * 3.5;
    const placed = placement.tryPlaceConstruction(
      COOP_DEFENSE_CONSTRUCTIONS.medic_pedestal,
      1,
      'inspector',
      0x52d273,
      originX,
      originY,
      targetX,
      targetY,
    );

    expect(placed).toMatchObject({ kind: 'pedestal', hp: 1, maxHp: 1 });
    expect(rockGrid.isOccupied(placed!.gridX, placed!.gridY)).toBe(true);
    expect(placement.applyDamage(placed!.id, 999, 'enemy')?.hp).toBe(1);
    expect(placement.removeRockAt(placed!.gridX, placed!.gridY, 'inspector')?.id).toBe(placed!.id);
    expect(rockGrid.isOccupied(placed!.gridX, placed!.gridY)).toBe(false);
  });

  it('previews turret bases with the connected rock autotile frame', () => {
    const connectedLayout = { ...layout, rocks: [{ gridX: 5, gridY: 3 }] };
    const rockGrid = new RockGridIndex(connectedLayout.rocks);
    const placement = new PlacementSystem(
      connectedLayout,
      rockGrid,
      { getAllPlayers: () => [] } as unknown as PlayerManager,
    );
    const originX = ARENA_OFFSET_X + CELL_SIZE * 3.5;
    const originY = ARENA_OFFSET_Y + CELL_SIZE * 3.5;
    const preview = placement.getConstructionPlacementPreview(
      COOP_DEFENSE_CONSTRUCTIONS.rocket_turret,
      originX,
      originY,
      ARENA_OFFSET_X + CELL_SIZE * 4.5,
      originY,
    );
    const expectedMask = AutoTiler.computeMask(4, 3, (gx, gy) => (
      (gx === 4 && gy === 3) || rockGrid.isOccupied(gx, gy)
    ));

    expect(preview).toMatchObject({ kind: 'turret', gridX: 4, gridY: 3 });
    expect(preview?.frame).toBe(AutoTiler.getFrame(expectedMask, ROCK_AUTOTILE));
  });
});
