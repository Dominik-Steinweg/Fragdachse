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
import { hasWorldFigure, type WorldParticipation } from '../src/world/WorldParticipation';

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

  /**
   * Tod und Respawn brauchen keine Runde.
   *
   * Beide Tore der `CombatSystem` sind reine Resolver. Ohne Activity beantwortet sie die
   * World-Teilnahme, und der Respawn selbst liest ohnehin nur den World-Spawnpunkt – es gibt
   * dafuer keinen zweiten, lobby-eigenen Pfad.
   */
  it('laesst eine World ohne Activity ueber die World-Teilnahme sterben und respawnen', () => {
    vi.useFakeTimers();
    try {
      const player = fakeEntity({ id: 'p1', x: 100, y: 100, body: { enable: true }, setPosition: vi.fn() });
      const playerManager = {
        getPlayer: (id: string) => id === player.id ? player : undefined,
        getAllPlayers: () => [player],
        getWorldSpawnPoint: () => ({ x: 512, y: 320 }),
      } as unknown as PlayerManager;
      const bridge = { isHost: () => true, broadcastEffect: vi.fn() } as unknown as NetworkBridge;
      const combat = new CombatSystem(playerManager, {} as ProjectileManager, bridge);

      // Genau die Aufloesung der LobbyWorld: keine Runde, nur Teilnahme.
      combat.setInitialSpawnAllowedResolver((id) => hasWorldFigure(participation.get(id) ?? 'none'));
      combat.setRespawnAllowedResolver((id) => hasWorldFigure(participation.get(id) ?? 'none'));
      const participation = new Map<string, WorldParticipation>([['p1', 'joining']]);

      combat.initPlayer('p1');
      expect(combat.isAlive('p1')).toBe(true);

      participation.set('p1', 'interactive');
      (combat as unknown as { handleDeath: (id: string, x: number, y: number, seed: number) => void })
        .handleDeath('p1', 100, 100, 1);
      expect(combat.isAlive('p1')).toBe(false);

      vi.advanceTimersByTime(5000);
      expect(combat.isAlive('p1')).toBe(true);
      expect(player.setPosition).toHaveBeenCalledWith(512, 320);
    } finally {
      vi.useRealTimers();
    }
  });

  it('laesst zwei interaktive Spieler ohne Activity gegenseitig kaempfen, sterben und respawnen', () => {
    vi.useFakeTimers();
    try {
      const attacker = fakeEntity({ id: 'p1', x: 100, y: 100, body: { enable: true }, setPosition: vi.fn() });
      const victim = fakeEntity({ id: 'p2', x: 140, y: 100, body: { enable: true }, setPosition: vi.fn() });
      const players = new Map([[attacker.id, attacker], [victim.id, victim]]);
      const playerManager = {
        getPlayer: (id: string) => players.get(id),
        getAllPlayers: () => [...players.values()],
        getWorldSpawnPoint: (id: string) => id === 'p1' ? { x: 512, y: 320 } : { x: 544, y: 320 },
      } as unknown as PlayerManager;
      const bridge = {
        isHost: () => true,
        broadcastEffect: vi.fn(),
        getPlayerProfile: (id: string) => players.has(id) ? { id, name: id, colorHex: 0xffffff } : undefined,
        areTeammates: () => false,
      } as unknown as NetworkBridge;
      const combat = new CombatSystem(playerManager, {} as ProjectileManager, bridge);
      const participation = new Map<string, WorldParticipation>([
        ['p1', 'interactive'],
        ['p2', 'interactive'],
      ]);
      combat.setInitialSpawnAllowedResolver((id) => hasWorldFigure(participation.get(id) ?? 'none'));
      combat.setRespawnAllowedResolver((id) => hasWorldFigure(participation.get(id) ?? 'none'));
      combat.setPlayerActionAllowedResolver((id) => participation.get(id) === 'interactive');
      const killed = vi.fn();
      combat.setKillCallback(killed);
      combat.initPlayer('p1');
      combat.initPlayer('p2');

      expect(combat.canDamageTarget('p1', 'p2')).toBe(true);
      combat.applyDamage('p2', 9999, false, 'p1', 'GLOCK');
      expect(combat.isAlive('p2')).toBe(false);
      expect(killed).toHaveBeenCalledWith('p1', 'p2', 'GLOCK', victim.x, victim.y, undefined);

      vi.advanceTimersByTime(5000);
      expect(combat.isAlive('p2')).toBe(true);
      expect(victim.setPosition).toHaveBeenCalledWith(544, 320);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gibt einem Peer ausserhalb der World weder Figur noch Respawn', () => {
    vi.useFakeTimers();
    try {
      const player = fakeEntity({ id: 'p1', x: 100, y: 100, body: { enable: true }, setPosition: vi.fn() });
      const playerManager = {
        getPlayer: (id: string) => id === player.id ? player : undefined,
        getAllPlayers: () => [player],
        getWorldSpawnPoint: () => ({ x: 512, y: 320 }),
      } as unknown as PlayerManager;
      const bridge = { isHost: () => true, broadcastEffect: vi.fn() } as unknown as NetworkBridge;
      const combat = new CombatSystem(playerManager, {} as ProjectileManager, bridge);

      // `none` steht ausserhalb, `observer` steht drin – aber ohne Figur.
      for (const outside of ['none', 'observer'] as const) {
        combat.setInitialSpawnAllowedResolver(() => hasWorldFigure(outside));
        combat.setRespawnAllowedResolver(() => hasWorldFigure(outside));
        combat.initPlayer('p1');
        expect(combat.isAlive('p1'), outside).toBe(false);
      }
      vi.advanceTimersByTime(5000);
      expect(player.setPosition).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
