import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class TestLine {
    x1 = 0;
    y1 = 0;
    x2 = 0;
    y2 = 0;

    static Length(line: TestLine): number {
      return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    }

    constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) {
      this.setTo(x1, y1, x2, y2);
    }

    setTo(x1: number, y1: number, x2: number, y2: number): this {
      this.x1 = x1;
      this.y1 = y1;
      this.x2 = x2;
      this.y2 = y2;
      return this;
    }
  }

  class TestRectangle {
    x = 0;
    y = 0;
    width = 0;
    height = 0;

    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.setTo(x, y, width, height);
    }

    setTo(x: number, y: number, width: number, height: number): this {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      return this;
    }

    get left(): number { return this.x; }
    get right(): number { return this.x + this.width; }
    get top(): number { return this.y; }
    get bottom(): number { return this.y + this.height; }
  }

  class TestCircle {
    x = 0;
    y = 0;
    radius = 0;
  }

  return {
    Geom: {
      Line: TestLine,
      Rectangle: TestRectangle,
      Circle: TestCircle,
    },
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
      Distance: {
        Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      },
    },
  };
});

import { CombatSystem } from '../src/systems/CombatSystem';
import type { BaseManager } from '../src/entities/BaseManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { ProjectilePhysicsBinding } from '../src/projectile/ProjectilePhysicsBinding';
import type { NetworkBridge } from '../src/network/NetworkBridge';
import type {
  HitscanSupportEffect,
  ProjectileExplosionConfig,
  SyncedDeathEffect,
  TrackedProjectile,
} from '../src/types';

function makeCombatHarness() {
  const base = {
    id: 'hostile-base',
    faction: 'hostile' as const,
    getHp: vi.fn(() => 100),
    getNearestSurfacePoint: vi.fn(() => ({ x: 100, y: 0, distance: 100 })),
  };
  const baseManager = {
    getBasesByFaction: vi.fn((faction: 'friendly' | 'hostile') => faction === 'hostile' ? [base] : []),
    getBaseIdAtWorldPoint: vi.fn(() => base.id),
    getBase: vi.fn(() => base),
  } as unknown as BaseManager;
  const bridge = {
    isHost: vi.fn(() => true),
    broadcastHitscanTracer: vi.fn(),
    broadcastMeleeSwing: vi.fn(),
  } as unknown as NetworkBridge;
  const combat = new CombatSystem(
    { getAllPlayers: () => [], getPlayer: () => undefined } as unknown as PlayerManager,
    {} as ProjectilePhysicsBinding,
    bridge,
  );
  combat.setBaseManager(baseManager);
  combat.setLoadoutManager({
    getDamageMultiplier: () => 2,
    getWeaponDamageMultiplier: () => 2,
  });
  combat.setPowerUpSystem({
    getDamageMultiplier: () => 3,
    removePlayer: () => {},
  });
  const baseDamage = vi.fn();
  combat.setBaseDamageCallback(baseDamage);

  return { combat, base, baseDamage };
}

function makeSupportCombatHarness() {
  const players = [
    fakeEntity({ id: 'shooter', color: 0xffffff, x: 0, y: 0, rotation: 0 }),
    fakeEntity({ id: 'ally', color: 0x55cc88, x: 100, y: 0, rotation: 0 }),
    fakeEntity({ id: 'victim', color: 0xcc5555, x: 100, y: 20, rotation: 0 }),
  ];
  const bridge = {
    isHost: vi.fn(() => true),
    getPlayerProfile: vi.fn(() => undefined),
    areTeammates: vi.fn((first: string, second: string) => first === 'shooter' && second === 'ally'),
    broadcastEffect: vi.fn(),
    broadcastHitscanTracer: vi.fn(),
  } as unknown as NetworkBridge;
  const playerManager = {
    getAllPlayers: () => players,
    getPlayer: (id: string) => players.find((player) => player.id === id),
  } as unknown as PlayerManager;
  const combat = new CombatSystem(playerManager, {} as ProjectilePhysicsBinding, bridge);
  for (const player of players) combat.initPlayer(player.id);
  combat.setLoadoutManager({
    getDamageMultiplier: () => 1,
    getWeaponDamageMultiplier: () => 1,
  });
  combat.setPowerUpSystem({ getDamageMultiplier: () => 1, removePlayer: () => {} });
  return { combat, players };
}

describe('CombatSystem base damage routing', () => {
  it('applies general vulnerability in the central base path', () => {
    const { combat, baseDamage } = makeCombatHarness();
    combat.setTargetIncomingDamageMultiplierResolver((target) => target.targetType === 'base' ? 1.2 : 1);

    combat.applyBaseDamage('hostile-base', 10, 'player-1', 'weapon2');

    expect(baseDamage.mock.calls[0]?.[0]).toBe('hostile-base');
    expect(baseDamage.mock.calls[0]?.[1]).toBe(72);
    expect(baseDamage.mock.calls[0]?.[2]).toBe('player-1');
  });

  it('applies general vulnerability to player damage as well', () => {
    const player = fakeEntity({ id: 'victim', color: 0xffffff, x: 100, y: 100, rotation: 0 });
    const bridge = {
      isHost: vi.fn(() => true),
      getPlayerProfile: vi.fn(() => undefined),
      areTeammates: vi.fn(() => false),
      broadcastEffect: vi.fn(),
    } as unknown as NetworkBridge;
    const combat = new CombatSystem(
      {
        getAllPlayers: () => [player],
        getPlayer: (id: string) => id === player.id ? player : undefined,
      } as unknown as PlayerManager,
      {} as ProjectilePhysicsBinding,
      bridge,
    );
    combat.initPlayer(player.id);
    combat.setTargetIncomingDamageMultiplierResolver((target) => target.targetType === 'player' ? 1.2 : 1);

    combat.applyDamage(player.id, 10, false, 'attacker', 'Plasmabrenner');

    expect(combat.getHP(player.id)).toBe(88);
  });

  it('keeps projectile, melee, hitscan and explosion base paths on one callback', () => {
    const { combat, baseDamage } = makeCombatHarness();

    combat.applyProjectileBaseDamage('hostile-base', {
      damage: 10,
      ownerId: 'player-1',
      sourceSlot: 'weapon1',
    } as TrackedProjectile);

    const internals = combat as unknown as {
      traceHitscan: () => {
        endX: number;
        endY: number;
        distance: number;
        hitPlayerId: null;
        hitEnemyId: null;
        hitDecoyId: null;
        hitObstacle: boolean;
      };
    };
    internals.traceHitscan = vi.fn(() => ({
      endX: 100,
      endY: 0,
      distance: 100,
      hitPlayerId: null,
      hitEnemyId: null,
      hitDecoyId: null,
      hitObstacle: true,
    }));
    combat.resolveHitscanShot(
      'player-1', 0, 0, 0, 100, 7, 2, 0xffffff, 0, 'Hitscan',
      'default', undefined, 'weapon1',
    );

    combat.resolveMeleeSwing(
      'player-1', 0, 0, 0, 150, 90, 5, 0, 'Melee', 0xffffff,
      'weapon1', 1, 1, 'default', undefined, undefined, undefined, 0, 0, 1, ['bases'],
    );

    const explosion: ProjectileExplosionConfig = {
      radius: 200,
      maxDamage: 11,
      minDamage: 11,
      knockback: 0,
      selfDamageMult: 0,
      color: 0xffffff,
    };
    combat.applyExplosionDamage(0, 0, explosion, 'player-1', 'utility', 'Explosion');

    expect(baseDamage.mock.calls).toEqual([
      ['hostile-base', 60, 'player-1', 'weapon1'],
      ['hostile-base', 42, 'player-1', 'weapon1'],
      ['hostile-base', 30, 'player-1', 'weapon1'],
      ['hostile-base', 66, 'player-1', 'utility'],
    ]);
  });

  it('applies runtime multipliers once and enables critical hits against hostile bases', () => {
    const { combat, baseDamage } = makeCombatHarness();
    const outgoing = vi.fn((_attacker: string | undefined, target: string, amount: number, allowCritical: boolean) => ({
      amount: allowCritical ? amount * 2 : amount,
      isCritical: allowCritical,
    }));
    combat.setPlayerOutgoingDamageResolver(outgoing);

    combat.applyProjectileBaseDamage('hostile-base', {
      damage: 10,
      ownerId: 'player-1',
      sourceSlot: 'weapon1',
    } as TrackedProjectile);
    const explosion: ProjectileExplosionConfig = {
      radius: 200,
      maxDamage: 10,
      minDamage: 10,
      knockback: 0,
      selfDamageMult: 0,
      color: 0xffffff,
    };
    combat.applyExplosionDamage(0, 0, explosion, 'player-1', 'utility', 'Explosion');

    expect(outgoing).toHaveBeenNthCalledWith(1, 'player-1', 'base:hostile-base', 60, true, 'weapon1');
    expect(outgoing).toHaveBeenNthCalledWith(2, 'player-1', 'base:hostile-base', 60, true, 'utility');
    expect(baseDamage.mock.calls[0]?.[1]).toBe(120);
    expect(baseDamage.mock.calls[1]?.[1]).toBe(120);
  });

  it('keeps a baseDamageMult isolated to base damage', () => {
    const { combat, baseDamage } = makeCombatHarness();
    const explosion: ProjectileExplosionConfig = {
      radius: 200,
      maxDamage: 10,
      minDamage: 10,
      baseDamageMult: 2,
      knockback: 0,
      selfDamageMult: 0,
      color: 0xffffff,
    };

    combat.applyExplosionDamage(0, 0, explosion, 'player-1', 'utility', 'HE');

    expect(baseDamage).toHaveBeenCalledWith('hostile-base', 120, 'player-1', 'utility');
  });

  it('keeps baseDamageMult out of ordinary enemy damage while preserving it for clusters', () => {
    const enemyDamage = vi.fn((_id: string, amount: number) => ({ died: false, remainingHp: 100 - amount }));
    const enemy = fakeEntity({ id: 'enemy',
      faction: 'hostile' as const, x: 100, y: 0, isBurrowed: () => false,
      getHp: () => 100,
      getMaxHp: () => 100,
      isBoss: () => false });
    const bridge = {
      isHost: vi.fn(() => true),
      getPlayerProfile: vi.fn(() => undefined),
      areTeammates: vi.fn(() => false),
      broadcastEffect: vi.fn(),
    } as unknown as NetworkBridge;
    const combat = new CombatSystem(
      { getAllPlayers: () => [], getPlayer: () => undefined } as unknown as PlayerManager,
      {} as ProjectilePhysicsBinding,
      bridge,
    );
    combat.setEnemyManager({
      getAllEnemies: () => [enemy],
      hasEnemy: (id: string) => id === enemy.id,
      getEnemy: (id: string) => id === enemy.id ? enemy : undefined,
      applyDamage: enemyDamage,
    } as unknown as import('../src/entities/EnemyManager').EnemyManager);
    const baseDamage = vi.fn();
    combat.setBaseManager({
      getBasesByFaction: (faction: 'friendly' | 'hostile') => faction === 'hostile' ? [{
        id: 'hostile-base',
        faction: 'hostile' as const,
        getHp: () => 100,
        getNearestSurfacePoint: () => ({ x: 100, y: 0, distance: 100 }),
      }] : [],
    } as unknown as BaseManager);
    combat.setBaseDamageCallback(baseDamage);

    combat.applyAoeDamage(0, 0, 200, 10, 'player-1', false, { baseDamageMult: 1 });
    combat.applyAoeDamage(0, 0, 200, 10, 'player-1', false, { baseDamageMult: 2 });

    expect(enemyDamage.mock.calls.map(([, amount]) => amount)).toEqual([10, 10]);
    expect(baseDamage.mock.calls.map(([, amount]) => amount)).toEqual([10, 20]);
  });
});

describe('CombatSystem death visual snapshots', () => {
  function buildSnapshot(frame: string | number): SyncedDeathEffect {
    const player = fakeEntity({ id: 'player-1',
      color: 0x55cc88, x: 320,
        y: 240,
        rotation: 0.25,
        texture: { key: 'badger_walking' },
        frame: { name: frame },
        displayWidth: 32,
        displayHeight: 32,
        tint: 0xffffff });
    const combat = new CombatSystem(
      {
        getAllPlayers: () => [player],
        getPlayer: (id: string) => id === player.id ? player : undefined,
      } as unknown as PlayerManager,
      {} as ProjectilePhysicsBinding,
      {} as NetworkBridge,
    );
    const internals = combat as unknown as {
      buildDeathEffect: (
        playerId: string,
        x: number,
        y: number,
        seed: number,
      ) => SyncedDeathEffect;
    };

    return internals.buildDeathEffect(player.id, player.sprite.x, player.sprite.y, 42);
  }

  it('keeps a complete visual snapshot for idle frame 0', () => {
    const effect = buildSnapshot(0);

    expect(effect).toMatchObject({
      textureKey: 'badger_walking',
      frame: 0,
      displayWidth: 32,
      displayHeight: 32,
      tint: 0xffffff,
    });
  });

  it('keeps a complete visual snapshot for a running frame', () => {
    const effect = buildSnapshot('walk-4');

    expect(effect).toMatchObject({
      textureKey: 'badger_walking',
      frame: 'walk-4',
      displayWidth: 32,
      displayHeight: 32,
      tint: 0xffffff,
    });
  });
});

describe('CombatSystem actual damage callbacks', () => {
  it('reports clamped hostile-enemy damage without overkill', () => {
    const enemy = fakeEntity({ id: 'zombie',
      kind: 'zombie-badger',
      faction: 'hostile' as const, x: 10, y: 20, isBurrowed: () => false,
      getHp: () => 10,
      getMaxHp: () => 10 });
    let hp = 10;
    const bridge = {
      isHost: vi.fn(() => true),
      getPlayerProfile: vi.fn((id: string) => id === 'player' ? { id } : undefined),
      incrementPlayerFrags: vi.fn(),
      canPlayerReceiveRoundRewards: vi.fn(() => true),
      getGameMode: vi.fn(() => 'deathmatch'),
      getActiveGameMode: vi.fn(() => 'deathmatch'),
      broadcastEffect: vi.fn(),
    } as unknown as NetworkBridge;
    const combat = new CombatSystem(
      { getAllPlayers: () => [], getPlayer: () => undefined } as unknown as PlayerManager,
      {} as ProjectilePhysicsBinding,
      bridge,
    );
    combat.setEnemyManager({
      hasEnemy: (id: string) => id === enemy.id,
      getEnemy: (id: string) => id === enemy.id ? enemy : undefined,
      applyDamage: (_id: string, amount: number) => {
        hp = Math.max(0, hp - amount);
        return { died: hp === 0, remainingHp: hp };
      },
    } as unknown as import('../src/entities/EnemyManager').EnemyManager);
    const damage = vi.fn();
    combat.setDamageDealtHandler(damage);

    combat.applyDamage(enemy.id, 25, false, 'player', 'test');

    expect(damage).toHaveBeenCalledWith('enemy', enemy.id, 'player', 10, 'direct');
  });

  it('reports player damage after armor/HP clamping and only one death', () => {
    const victim = fakeEntity({ id: 'victim', body: { enable: true }, x: 10, y: 20 });
    const bridge = {
      isHost: vi.fn(() => true),
      areTeammates: vi.fn(() => false),
      broadcastEffect: vi.fn(),
    } as unknown as NetworkBridge;
    const combat = new CombatSystem(
      {
        getAllPlayers: () => [victim],
        getPlayer: (id: string) => id === victim.id ? victim : undefined,
      } as unknown as PlayerManager,
      {} as ProjectilePhysicsBinding,
      bridge,
    );
    combat.initPlayer(victim.id);
    combat.addArmor(victim.id, 5);
    const damage = vi.fn();
    const damageTaken = vi.fn();
    const death = vi.fn();
    combat.setDamageDealtHandler(damage);
    combat.setPlayerDamageTakenHandler(damageTaken);
    combat.setDeathCallback(death);

    combat.applyDamage(victim.id, 200, false, 'attacker', 'test');
    combat.applyDamage(victim.id, 200, false, 'attacker', 'test');

    expect(damage).toHaveBeenCalledWith('player', victim.id, 'attacker', 105, 'direct');
    expect(damageTaken).toHaveBeenCalledWith(victim.id, 'attacker', 100, 5, 'direct');
    expect(death).toHaveBeenCalledOnce();
  });

  it('reports only effective healing and armor gains, including capped regen', () => {
    const player = fakeEntity({ id: 'player', body: { enable: true }, x: 10, y: 20 });
    const bridge = {
      isHost: vi.fn(() => true),
      areTeammates: vi.fn(() => false),
      broadcastEffect: vi.fn(),
    } as unknown as NetworkBridge;
    const combat = new CombatSystem(
      {
        getAllPlayers: () => [player],
        getPlayer: (id: string) => id === player.id ? player : undefined,
      } as unknown as PlayerManager,
      {} as ProjectilePhysicsBinding,
      bridge,
    );
    combat.initPlayer(player.id);
    const healing = vi.fn();
    const armor = vi.fn();
    combat.setHealingReceivedHandler(healing);
    combat.setArmorReceivedHandler(armor);
    combat.setPlayerMaxArmorResolver(() => 10);
    combat.setPlayerArmorGainMultiplierResolver(() => 2);

    combat.applyDamage(player.id, 20, false, 'attacker', 'test');
    combat.healToFull(player.id);
    combat.healToFull(player.id);
    combat.addArmor(player.id, 4);
    combat.addArmor(player.id, 4);

    expect(healing).toHaveBeenCalledOnce();
    expect(healing).toHaveBeenCalledWith(player.id, 20);
    expect(armor.mock.calls.map(([id, amount]) => [id, amount])).toEqual([
      [player.id, 8],
      [player.id, 2],
    ]);

    combat.setPlayerHpRegenPerSecondResolver(() => 10);
    combat.setPlayerArmorRegenPerSecondResolver(() => 4);
    combat.applyDamage(player.id, 13, false, 'attacker', 'test');
    combat.hpRegenTick(player.id, 500);
    combat.armorRegenTick(player.id, 500);
    expect(healing).toHaveBeenCalledTimes(2);
    expect(healing).toHaveBeenLastCalledWith(player.id, 3);
    expect(armor).toHaveBeenLastCalledWith(player.id, 2);
  });
});

describe('Plasmabrenner hitscan support impact', () => {
  const effect: HitscanSupportEffect = {
    type: 'plasma_burner',
    healPerHit: 25,
    damagePerHit: 25,
    beamColor: 0x5cf58f,
  };

  it('does not rewind the shooter into its own support trace while moving backwards', () => {
    const shooter = fakeEntity({ id: 'shooter',
      color: 0xffffff, x: 0,
        y: 0,
        displayWidth: 40,
        displayHeight: 40,
        body: { velocity: { x: -240, y: 0 } } });
    const bridge = {
      isHost: vi.fn(() => true),
      getLatestGameState: vi.fn(() => undefined),
    } as unknown as NetworkBridge;
    const combat = new CombatSystem(
      {
        getAllPlayers: () => [shooter],
        getPlayer: () => shooter,
      } as unknown as PlayerManager,
      {} as ProjectilePhysicsBinding,
      bridge,
    );
    combat.initPlayer(shooter.id);

    const internals = combat as unknown as {
      findNearestObstacleHit: ReturnType<typeof vi.fn>;
      getHitscanTargetHitDistance: ReturnType<typeof vi.fn>;
    };
    internals.findNearestObstacleHit = vi.fn(() => null);
    internals.getHitscanTargetHitDistance = vi.fn((_line, _target, _thickness, applyRewind: boolean) => (
      applyRewind ? 4 : null
    ));

    const trace = combat.traceHitscan({
      shooterId: shooter.id,
      startX: 28,
      startY: 0,
      angle: 0,
      range: 420,
      traceThickness: 5,
      applyFavorTheShooter: true,
      includeShooter: true,
    });

    // Das Ziel ist die kanonische Position samt Trefferradius - kein Sprite und keine Entity.
    expect(internals.getHitscanTargetHitDistance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ x: shooter.x, y: shooter.y, hitRadius: expect.any(Number) }),
      5,
      false,
    );
    expect(trace.distance).toBe(420);
    expect(trace.hitPlayerId).toBeNull();
  });

  it('heals allies and damages enemies through the normal damage path', () => {
    const { combat } = makeSupportCombatHarness();
    combat.applyDamage('ally', 40, false, 'enemy', 'test');
    combat.applyDamage('victim', 40, false, 'shooter', 'test');

    const internals = combat as unknown as { traceHitscan: ReturnType<typeof vi.fn> };
    internals.traceHitscan = vi.fn(() => ({
      endX: 100,
      endY: 0,
      distance: 100,
      hitPlayerId: 'ally',
      hitEnemyId: null,
      hitDecoyId: null,
      hitObstacle: false,
    }));
    combat.resolveHitscanShot(
      'shooter', 0, 0, 0, 420, 0, 5, 0x5cf58f, 0, 'Plasmabrenner',
      'plasma_burner', undefined, 'weapon2', undefined, undefined, 1, 1, undefined, undefined, effect,
    );
    expect(combat.getHP('ally')).toBe(85);

    internals.traceHitscan.mockReturnValue({
      endX: 100,
      endY: 20,
      distance: 100,
      hitPlayerId: 'victim',
      hitEnemyId: null,
      hitDecoyId: null,
      hitObstacle: false,
    });
    combat.setTargetIncomingDamageMultiplierResolver((target) => target.targetType === 'player' ? 1.2 : 1);
    combat.resolveHitscanShot(
      'shooter', 0, 0, 0, 420, 0, 5, 0x5cf58f, 0, 'Plasmabrenner',
      'plasma_burner', undefined, 'weapon2', undefined, undefined, 1, 1, undefined, undefined, effect,
    );
    expect(combat.getHP('victim')).toBe(30);
  });

  it('reports an actual base collision surface to the host support callback', () => {
    const { combat } = makeCombatHarness();
    const callback = vi.fn();
    combat.setHitscanSupportImpactCallback(callback);
    const internals = combat as unknown as { traceHitscan: ReturnType<typeof vi.fn> };
    internals.traceHitscan = vi.fn(() => ({
      endX: 100,
      endY: 0,
      distance: 100,
      hitPlayerId: null,
      hitEnemyId: null,
      hitDecoyId: null,
      hitObstacle: true,
      hitObstacleKind: 'base',
    }));
    combat.resolveHitscanShot(
      'player-1', 0, 0, 0, 420, 0, 5, 0x5cf58f, 0, 'Plasmabrenner',
      'plasma_burner', undefined, 'weapon2', undefined, undefined, 1, 1, undefined, undefined, effect,
    );
    expect(callback).toHaveBeenCalledWith(
      { targetType: 'base', targetId: 'hostile-base', x: 100, y: 0 },
      effect,
      'player-1',
      'weapon2',
    );
  });
});
