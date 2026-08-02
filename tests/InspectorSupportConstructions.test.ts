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
      kind: 'turret', weaponId: 'TURRET_GRAVITY', maxHp: 200, targetRange: 520, capacityCost: 25,
      energyInjectorEffect: { type: 'gravity_pull', pullStrengthMultiplier: 1.5 },
    });
    expect(COOP_DEFENSE_CONSTRUCTIONS.slow_bubble_turret).toMatchObject({
      kind: 'turret', weaponId: 'TURRET_SLOW_BUBBLE', maxHp: 180, targetRange: 500, capacityCost: 20,
      energyInjectorEffect: { type: 'slow_bubble', slowStrengthMultiplier: 1.5 },
    });
    expect(COOP_DEFENSE_CONSTRUCTIONS.medic_pedestal).toMatchObject({
      kind: 'pedestal', powerUpDefId: 'HEALTH_PACK', capacityCost: 30, indestructible: true,
      energyInjectorEffect: { type: 'powerup_cooldown', respawnTimeMultiplier: 0.5 },
    });
    expect(COOP_DEFENSE_CONSTRUCTIONS.armor_pedestal).toMatchObject({
      kind: 'pedestal', powerUpDefId: 'ARMOR', capacityCost: 25, indestructible: true,
      energyInjectorEffect: { type: 'powerup_cooldown', respawnTimeMultiplier: 0.5 },
    });
    expect(COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.energyInjectorEffect)
      .toEqual({ type: 'damage_turret', damageMultiplier: 1.25 });
    const mushroom = UTILITY_CONFIGS.FLIEGENPILZ as PlaceableTurretUtilityConfig;
    expect(mushroom.placeable.energyInjectorEffect)
      .toEqual({ type: 'damage_turret', damageMultiplier: 1.25 });
  });

  it('configures both support projectiles without damage', () => {
    const gravity = WEAPON_CONFIGS.TURRET_GRAVITY;
    const slow = WEAPON_CONFIGS.TURRET_SLOW_BUBBLE;
    expect(gravity).toMatchObject({ cooldown: 3500, damage: 0, range: 560 });
    expect(slow).toMatchObject({ cooldown: 4000, damage: 0, range: 520 });
    expect(gravity.fire.type).toBe('projectile');
    expect(slow.fire.type).toBe('projectile');
    if (gravity.fire.type !== 'projectile' || slow.fire.type !== 'projectile') return;

    expect(gravity.fire.impactExplosion).toMatchObject({
      radius: 95,
      maxDamage: 0,
      knockback: 0,
      rockDamageMult: 0,
      trainDamageMult: 0,
      blackHoleDurationMs: 1000,
      blackHolePullStrength: 2400,
    });
    expect(slow.fire.impactExplosion).toMatchObject({
      radius: 72,
      maxDamage: 0,
      knockback: 0,
      rockDamageMult: 0,
      trainDamageMult: 0,
      timeBubble: {
        type: 'time_bubble',
        radius: 72,
        duration: 3000,
        projectileSlowFactor: 0.4,
        playerSlowFactor: 0.5,
        trainSlowFactor: 0.5,
        friendlyImmunity: 0,
      },
    });
    expect(slow.grenadeVisualPreset).toBe('time_bubble');
  });

  it('exposes four refundable one-point unlocks in the intended order', () => {
    expect([
      'unlock_gravity_turret',
      'unlock_slow_bubble_turret',
      'unlock_medic_pedestal',
      'unlock_armor_pedestal',
    ].map((id) => COOP_DEFENSE_UPGRADE_DEFINITIONS[id])).toMatchObject([
      { code: 'E-K7', maxLevel: 1, startingLevel: 0, costPerLevel: 1, refundable: true, sortOrder: 36 },
      { code: 'E-K8', maxLevel: 1, startingLevel: 0, costPerLevel: 1, refundable: true, sortOrder: 37 },
      { code: 'E-K9', maxLevel: 1, startingLevel: 0, costPerLevel: 1, refundable: true, sortOrder: 38 },
      { code: 'E-K10', maxLevel: 1, startingLevel: 0, costPerLevel: 1, refundable: true, sortOrder: 39 },
    ]);
  });
});

describe('Inspector automated support turrets', () => {
  it('prioritizes the focused target without bypassing normal range or line of sight', () => {
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
    turrets.setLineOfSightChecker(() => true);
    turrets.setFireHandler(fire);

    turrets.hostUpdate(0, UTILITY_CONFIGS.FLIEGENPILZ as PlaceableTurretUtilityConfig, WEAPON_CONFIGS.SPOREN);

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
    turrets.setLineOfSightChecker((_sx, _sy, targetX) => targetX !== 120);
    turrets.setFireHandler(fire);

    turrets.hostUpdate(0, UTILITY_CONFIGS.FLIEGENPILZ as PlaceableTurretUtilityConfig, WEAPON_CONFIGS.SPOREN);

    expect(fire.mock.calls[0]?.slice(6, 8)).toEqual([20, 0]);
  });

  it.each(['TURRET_GRAVITY', 'TURRET_SLOW_BUBBLE'] as const)(
    '%s uses the regular target, range and line-of-sight path',
    (weaponId) => {
      const combat = {
        isAlive: () => true,
        isBurrowed: () => false,
        canDamageTarget: () => true,
      };
      const lineOfSight = vi.fn(() => true);
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
      turrets.setLineOfSightChecker(lineOfSight);
      turrets.setFireHandler(fire);

      turrets.hostUpdate(
        0,
        UTILITY_CONFIGS.FLIEGENPILZ as PlaceableTurretUtilityConfig,
        WEAPON_CONFIGS.SPOREN,
      );

      expect(lineOfSight).toHaveBeenCalledOnce();
      expect(lineOfSight.mock.calls[0].slice(0, 5)).toEqual([16, 0, 100, 0, 1]);
      expect(fire).toHaveBeenCalledOnce();
      expect(fire.mock.calls[0][2]).toBe(weaponId);
      expect(fire.mock.calls[0].slice(3, 8)).toEqual([16, 0, 0, 100, 0]);
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
    ['HEALTH_PACK', 5000, 'heal'] as const,
    ['ARMOR', 10000, 'armor'] as const,
  ])('spawns and respawns one %s with its existing effect and cooldown', (defId, respawnMs, effect) => {
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
    if (effect === 'armor') expect(addArmor).toHaveBeenCalledWith('player', 50);
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
});
