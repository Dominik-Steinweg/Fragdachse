import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class Line {
    x1 = 0; y1 = 0; x2 = 0; y2 = 0;
    setTo(x1: number, y1: number, x2: number, y2: number) {
      this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2; return this;
    }
  }
  class Rectangle {
    x = 0; y = 0; width = 0; height = 0;
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x; this.y = y; this.width = width; this.height = height;
    }
    setTo(x: number, y: number, width: number, height: number) {
      this.x = x; this.y = y; this.width = width; this.height = height; return this;
    }
  }
  return {
    Geom: { Line, Rectangle, Circle: class Circle {}, Intersects: {} },
    Math: { Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)) },
  };
});

import { CombatSystem } from '../src/systems/CombatSystem';

describe('CombatSystem Chain Lightning – Runtime/Shared Resolver Parity', () => {
  it('keeps primary exclusion, nearest-first tie order, 1-based falloff, chain damage kind and resources', () => {
    const enemyManager = {
      getAllEnemies: () => [
        fakeEntity({ id: 'primary', x: 10, y: 0 }),
        fakeEntity({ id: 'enemy_next', x: 35, y: 0 }),
      ],
      getEnemy: () => undefined,
      hasEnemy: () => false,
    };
    const playerManager = {
      getAllPlayers: () => [fakeEntity({ id: 'player_equal', x: 35, y: 0 })],
    };
    const bridge = {
      getPlayerProfile: () => undefined,
      areTeammates: () => false,
    };
    const combat = new CombatSystem(playerManager as never, bridge as never);
    const runtime = combat as any;
    runtime.enemyManager = enemyManager;
    runtime.canDamageTarget = vi.fn(() => true);
    runtime.isAlive = vi.fn(() => true);
    runtime.hasChainLineOfSight = vi.fn(() => true);
    runtime.queueHitscanTrace = vi.fn();
    runtime.applyDamage = vi.fn();
    runtime.resourceSystem = { addAdrenaline: vi.fn() };

    runtime.resolveChainLightning({
      shooterId: 'sim_player',
      originX: 10,
      originY: 0,
      baseDamage: 10,
      chainCfg: {
        maxJumps: 1,
        searchRadius: 30,
        damageFalloffPerJump: 0.1,
        targetEnemies: true,
        targetPlayers: true,
      },
      sourceId: 'ASMD_PRIM',
      adrenalinGain: 8,
      playerColor: 0xffffff,
      visualPreset: 'asmd_primary',
      baseThickness: 3,
      visitedPlayers: new Set(),
      visitedEnemies: new Set(['primary']),
      visitedDecoys: new Set(),
    });

    expect(runtime.applyDamage).toHaveBeenCalledWith(
      'enemy_next',
      9,
      false,
      'sim_player',
      'ASMD_PRIM',
      { sourceX: 10, sourceY: 0 },
      { damageKind: 'chain' },
    );
    expect(runtime.resourceSystem.addAdrenaline).toHaveBeenCalledWith('sim_player', 8);
    expect(runtime.queueHitscanTrace).toHaveBeenCalledTimes(1);
  });
});
