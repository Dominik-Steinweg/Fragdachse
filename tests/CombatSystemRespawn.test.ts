import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class TestLine {
    x1 = 0; y1 = 0; x2 = 0; y2 = 0;
    constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) { this.setTo(x1, y1, x2, y2); }
    setTo(x1: number, y1: number, x2: number, y2: number): this {
      this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2; return this;
    }
    static Length(line: TestLine): number { return Math.hypot(line.x2 - line.x1, line.y2 - line.y1); }
  }
  class TestRectangle {
    x = 0; y = 0; width = 0; height = 0;
    constructor(x = 0, y = 0, width = 0, height = 0) { this.setTo(x, y, width, height); }
    setTo(x: number, y: number, width: number, height: number): this {
      this.x = x; this.y = y; this.width = width; this.height = height; return this;
    }
    get left(): number { return this.x; }
    get right(): number { return this.x + this.width; }
    get top(): number { return this.y; }
    get bottom(): number { return this.y + this.height; }
  }
  class TestCircle { x = 0; y = 0; radius = 0; }
  return {
    Geom: { Line: TestLine, Rectangle: TestRectangle, Circle: TestCircle },
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
      Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
    },
  };
});

import { CombatSystem } from '../src/systems/CombatSystem';
import { CoopDefenseRespawnBudgetSystem } from '../src/systems/CoopDefenseRespawnBudgetSystem';
import type { NetworkBridge } from '../src/network/NetworkBridge';
import type { ProjectileManager } from '../src/entities/ProjectileManager';
import type { PlayerManager } from '../src/entities/PlayerManager';

describe('CombatSystem respawn lifecycle', () => {
  it('does not consume budget during repeated gate checks and consumes once at actual respawn', () => {
    vi.useFakeTimers();
    try {
      const player = fakeEntity({ id: 'p1', x: 100, y: 100, body: { enable: true },
        setPosition: vi.fn() });
      const playerManager = {
        getPlayer: (id: string) => id === player.id ? player : undefined,
        getAllPlayers: () => [player],
        getWorldSpawnPoint: () => ({ x: 260, y: 42 }),
      } as unknown as PlayerManager;
      const bridge = {
        isHost: () => true,
        broadcastEffect: vi.fn(),
      } as unknown as NetworkBridge;
      const combat = new CombatSystem(playerManager, {} as ProjectileManager, bridge);
      const survival = new CoopDefenseRespawnBudgetSystem({ respawnsPerPlayer: 1, participantIds: ['p1'] });

      combat.setInitialSpawnAllowedResolver(() => true);
      combat.setRespawnAllowedResolver((id) => survival.canPlayerRespawn(id));
      combat.setRespawnCallback((id) => survival.consumeRespawn(id));
      combat.setDeathCallback((id) => survival.handlePlayerDeath(id));
      combat.initPlayer('p1');

      const gate = (): boolean => survival.canPlayerRespawn('p1');
      (combat as unknown as { handleDeath: (id: string, x: number, y: number, seed: number) => void })
        .handleDeath('p1', 100, 100, 1);
      expect(gate()).toBe(true);
      expect(gate()).toBe(true);
      expect(survival.getPlayerState('p1')?.remainingRespawns).toBe(1);

      vi.advanceTimersByTime(5000);
      expect(survival.getPlayerState('p1')).toEqual({
        remainingRespawns: 0,
        alive: true,
        eliminated: false,
      });
      expect(player.setPosition).toHaveBeenCalledTimes(1);
      expect(player.setPosition).toHaveBeenCalledWith(260, 42);
    } finally {
      vi.useRealTimers();
    }
  });
});
