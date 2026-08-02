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
import type { ProjectileExplosionConfig, TrackedProjectile } from '../src/types';

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

describe('CombatSystem base damage routing', () => {
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
