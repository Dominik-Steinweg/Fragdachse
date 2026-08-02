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
import type { ProjectileManager } from '../src/entities/ProjectileManager';
import type { NetworkBridge } from '../src/network/NetworkBridge';
import type { HitscanSupportEffect, ProjectileExplosionConfig, TrackedProjectile } from '../src/types';

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
    {} as ProjectileManager,
    bridge,
  );
  combat.setBaseManager(baseManager);
  combat.setLoadoutManager({
    getDamageMultiplier: () => 2,
    getWeaponDamageMultiplier: () => 2,
    registerAk47ProjectileHit: () => {},
    resetAk47State: () => {},
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
    { id: 'shooter', color: 0xffffff, sprite: { x: 0, y: 0, rotation: 0 } },
    { id: 'ally', color: 0x55cc88, sprite: { x: 100, y: 0, rotation: 0 } },
    { id: 'victim', color: 0xcc5555, sprite: { x: 100, y: 20, rotation: 0 } },
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
  const combat = new CombatSystem(playerManager, {} as ProjectileManager, bridge);
  for (const player of players) combat.initPlayer(player.id);
  combat.setLoadoutManager({
    getDamageMultiplier: () => 1,
    getWeaponDamageMultiplier: () => 1,
    registerAk47ProjectileHit: () => {},
    resetAk47State: () => {},
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
    expect(baseDamage.mock.calls[0]?.[1]).toBe(12);
    expect(baseDamage.mock.calls[0]?.[2]).toBe('player-1');
  });

  it('applies general vulnerability to player damage as well', () => {
    const player = { id: 'victim', color: 0xffffff, sprite: { x: 100, y: 100, rotation: 0 } };
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
      {} as ProjectileManager,
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
      ['hostile-base', 11, 'player-1', 'utility'],
    ]);
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
    const shooter = {
      id: 'shooter',
      color: 0xffffff,
      sprite: {
        x: 0,
        y: 0,
        displayWidth: 40,
        displayHeight: 40,
        body: { velocity: { x: -240, y: 0 } },
      },
    };
    const bridge = {
      isHost: vi.fn(() => true),
      getLatestGameState: vi.fn(() => undefined),
    } as unknown as NetworkBridge;
    const combat = new CombatSystem(
      {
        getAllPlayers: () => [shooter],
        getPlayer: () => shooter,
      } as unknown as PlayerManager,
      {} as ProjectileManager,
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

    expect(internals.getHitscanTargetHitDistance).toHaveBeenCalledWith(
      expect.anything(),
      shooter,
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
