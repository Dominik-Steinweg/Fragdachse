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
import { TargetStatusSystem } from '../src/systems/TargetStatusSystem';
import { CoopDefenseRespawnBudgetSystem } from '../src/systems/CoopDefenseRespawnBudgetSystem';
import type { NetworkBridge } from '../src/network/NetworkBridge';
import type { PlayerManager } from '../src/entities/PlayerManager';
import { hasWorldFigure, type WorldParticipation } from '../src/world/WorldParticipation';
import { HP_MAX, RESPAWN_DELAY_MS } from '../src/config';

function lifecycleFixture() {
  let now = 1000;
  const players = new Map(['p1', 'p2'].map(id => [id,
    fakeEntity({ id, x: 100, y: 100, body: { enable: true }, setPosition: vi.fn() })]));
  const combat = new CombatSystem({
    getPlayer: (id: string) => players.get(id), getAllPlayers: () => [...players.values()],
    getWorldSpawnPoint: () => ({ x: 260, y: 42 }),
  } as unknown as PlayerManager, {
    isHost: () => true, broadcastEffect: vi.fn(), areTeammates: () => false,
    getPlayerProfile: (id: string) => players.has(id) ? { id } : undefined,
  } as unknown as NetworkBridge);
  const world = combat.bindPlayerVitalsScope({ worldRevision: 1, runtimeGeneration: 7 });
  combat.bindHostExecutionSources({ nowMs: () => now, random: () => 0.25 });
  const budget = new CoopDefenseRespawnBudgetSystem({ respawnsPerPlayer: 1, participantIds: ['p1', 'p2'] });
  const consume = vi.fn((id: string) => budget.consumeRespawn(id));
  const death = vi.fn((id: string) => budget.handlePlayerDeath(id));
  combat.setRespawnAllowedResolver(id => budget.canPlayerRespawn(id));
  combat.setRespawnCallback(consume); combat.setDeathCallback(death);
  combat.initPlayer('p1'); combat.initPlayer('p2');
  const kill = vi.fn(); combat.setKillCallback(kill);
  return { combat, world, players, budget, consume, death, kill,
    advance: () => { now += RESPAWN_DELAY_MS; combat.advancePlayerLifecycle(now); },
    hit: () => combat.applyDamage('p2', HP_MAX * 2, false, 'p1', 'test', undefined, { damageKind: 'direct', sourceSlot: 'weapon1' }),
  };
}

describe('integrated Combat damage, reaction and Player life', () => {
  it.each([false, true])('ends old-life vulnerability before a reentrant new life can acquire status (%s)', reentrant => {
    const f = lifecycleFixture(), statuses = new TargetStatusSystem();
    const target = { targetType: 'player' as const, targetId: 'p2' };
    f.combat.setTargetIncomingDamageMultiplierResolver((ref, now) => statuses.getIncomingDamageMultiplier(ref, now));
    f.combat.setPlayerLifeEndedHandler(ref => {
      if (f.combat.isCurrentCombatantTarget(ref)) statuses.removeTarget({ targetType: 'player', targetId: String(ref.id) });
    });
    statuses.applyVulnerability(target, 10000, 1000);
    if (reentrant) f.combat.setPlayerDamageTakenHandler(() => {
      expect(statuses.isVulnerable(target, 1000)).toBe(false);
      f.budget.handlePlayerDeath('p2');
      expect(f.combat.spawnPlayerAfterReconnect('p2')).toBe(true);
      statuses.applyVulnerability(target, 10000, 1000);
    });
    f.hit();
    f.combat.setPlayerDamageTakenHandler(null);
    if (!reentrant) f.advance();
    const hit = f.combat.applyDamage('p2', 10, false, 'p1', 'test');
    expect(hit).toMatchObject({ actualDamage: reentrant ? 12 : 10 });
    expect(statuses.isVulnerable(target, 6000)).toBe(reentrant);
  });

  it('commits death and its attribution exactly once despite repeated lethal requests', () => {
    const f = lifecycleFixture();
    const outcome = f.hit(); f.hit();
    expect(outcome).toMatchObject({ kind: 'damage-applied', actualDamage: HP_MAX, transition: { kind: 'dead' } });
    expect(f.death).toHaveBeenCalledTimes(1); expect(f.kill).toHaveBeenCalledTimes(1);
    f.advance(); f.advance();
    expect(f.consume).toHaveBeenCalledTimes(1);
    expect(f.players.get('p2')!.setPosition).toHaveBeenCalledTimes(1);
  });

  it('checks actor prerequisites before budget consumption and shares reconnect with deadline commit', () => {
    const f = lifecycleFixture(); const actor = f.players.get('p2')!;
    f.hit(); f.players.delete('p2'); f.advance();
    expect(f.combat.spawnPlayerAfterReconnect('p2')).toBe(false);
    expect(f.consume).not.toHaveBeenCalled();
    f.players.set('p2', actor);
    expect(f.combat.spawnPlayerAfterReconnect('p2')).toBe(true);
    expect(f.combat.spawnPlayerAfterReconnect('p2')).toBe(false);
    f.advance(); expect(f.consume).toHaveBeenCalledTimes(1);
    expect(actor.setPosition).toHaveBeenCalledTimes(1);
  });

  it('invalidates pending respawn when its Activity policy or World ends', () => {
    for (const worldEnds of [false, true]) {
      const f = lifecycleFixture(); f.hit();
      if (worldEnds) f.world.destroy(); else f.combat.invalidatePlayerLifecyclePolicy();
      f.advance(); expect(f.consume).not.toHaveBeenCalled();
    }
  });

  it('keeps parent loss and attribution through mutual reflect and removal of its source actor', () => {
    const f = lifecycleFixture(); const observed = vi.fn();
    f.combat.addDamageDealtObserver(observed);
    f.combat.setPlayerDamageTakenHandler((id, attacker, hp, armor, kind) => {
      if (kind !== 'reflect') f.combat.applyDamage(attacker!, hp + armor, false, id, 'thorns', undefined, { damageKind: 'reflect' });
      else f.players.delete('p1');
    });
    const outcome = f.hit();
    expect(outcome).toMatchObject({ kind: 'damage-applied', actualDamage: HP_MAX, transition: { kind: 'dead' } });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(f.death).toHaveBeenCalledTimes(2); expect(f.kill).toHaveBeenCalledTimes(2);
    expect(f.kill.mock.calls.find(call => call[1] === 'p2')?.[0]).toBe('p1');
    expect(observed.mock.calls.map(call => call[0].damage)).toEqual([HP_MAX, HP_MAX]);
  });

  it('retains a committed receipt but stops stale reactions after reentrant teardown', () => {
    const f = lifecycleFixture();
    f.combat.setPlayerDamageTakenHandler(() => f.world.destroy());
    expect(f.hit()).toMatchObject({ kind: 'damage-applied', transition: { kind: 'dead' } });
    expect(f.death).not.toHaveBeenCalled(); expect(f.kill).not.toHaveBeenCalled();
    f.advance(); expect(f.consume).not.toHaveBeenCalled();
  });

  it('isolates passive observer failures after authoritative death and kill work', () => {
    const f = lifecycleFixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      f.combat.addDamageDealtObserver(() => { throw new Error('observer'); });
      expect(() => f.hit()).not.toThrow(); expect(f.kill).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });

  it('does not deactivate a new life created reentrantly by a permitted reconnect', () => {
    const f = lifecycleFixture();
    f.combat.setRespawnAllowedResolver(() => true);
    f.combat.setRespawnCallback(() => true);
    f.combat.setPlayerDamageTakenHandler(id => { expect(f.combat.spawnPlayerAfterReconnect(id)).toBe(true); });
    expect(f.hit()).toMatchObject({ transition: { kind: 'dead' } });
    expect(f.combat.isAlive('p2')).toBe(true);
    expect(f.players.get('p2')!.body.enable).toBe(true);
    expect(f.death).not.toHaveBeenCalled();
  });
});

describe('CombatSystem respawn lifecycle', () => {
  it('does not consume budget during repeated gate checks and consumes once at actual respawn', () => {
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
      const combat = new CombatSystem(playerManager, bridge);
      combat.bindHostExecutionSources({ nowMs: () => 1000, random: () => 0.25 });
      const survival = new CoopDefenseRespawnBudgetSystem({ respawnsPerPlayer: 1, participantIds: ['p1'] });

      combat.setInitialSpawnAllowedResolver(() => true);
      combat.setRespawnAllowedResolver((id) => survival.canPlayerRespawn(id));
      combat.setRespawnCallback((id) => survival.consumeRespawn(id));
      combat.setDeathCallback((id) => survival.handlePlayerDeath(id));
      combat.initPlayer('p1');

      const gate = (): boolean => survival.canPlayerRespawn('p1');
      combat.applyDamage('p1', 9999);
      expect(gate()).toBe(true);
      expect(gate()).toBe(true);
      expect(survival.getPlayerState('p1')?.remainingRespawns).toBe(1);

      combat.advancePlayerLifecycle(6000);
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
    try {
      const player = fakeEntity({ id: 'p1', x: 100, y: 100, body: { enable: true }, setPosition: vi.fn() });
      const playerManager = {
        getPlayer: (id: string) => id === player.id ? player : undefined,
        getAllPlayers: () => [player],
        getWorldSpawnPoint: () => ({ x: 512, y: 320 }),
      } as unknown as PlayerManager;
      const bridge = { isHost: () => true, broadcastEffect: vi.fn() } as unknown as NetworkBridge;
      const combat = new CombatSystem(playerManager, bridge);
      combat.bindHostExecutionSources({ nowMs: () => 1000, random: () => 0.25 });

      // Genau die Aufloesung der LobbyWorld: keine Runde, nur Teilnahme.
      combat.setInitialSpawnAllowedResolver((id) => hasWorldFigure(participation.get(id) ?? 'none'));
      combat.setRespawnAllowedResolver((id) => hasWorldFigure(participation.get(id) ?? 'none'));
      const participation = new Map<string, WorldParticipation>([['p1', 'joining']]);

      combat.initPlayer('p1');
      expect(combat.isAlive('p1')).toBe(true);

      participation.set('p1', 'interactive');
      combat.applyDamage('p1', 9999);
      expect(combat.isAlive('p1')).toBe(false);

      combat.advancePlayerLifecycle(6000);
      expect(combat.isAlive('p1')).toBe(true);
      expect(player.setPosition).toHaveBeenCalledWith(512, 320);
    } finally {
      vi.useRealTimers();
    }
  });

  it('laesst zwei interaktive Spieler ohne Activity gegenseitig kaempfen, sterben und respawnen', () => {
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
      const combat = new CombatSystem(playerManager, bridge);
      combat.bindHostExecutionSources({ nowMs: () => 1000, random: () => 0.25 });
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
      expect(killed).toHaveBeenCalledWith('p1', 'p2', 'GLOCK', victim.x, victim.y, expect.objectContaining({ damageOrigin: { kind: 'direct', slot: undefined } }));

      combat.advancePlayerLifecycle(6000);
      expect(combat.isAlive('p2')).toBe(true);
      expect(victim.setPosition).toHaveBeenCalledWith(544, 320);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gibt einem Peer ausserhalb der World weder Figur noch Respawn', () => {
    try {
      const player = fakeEntity({ id: 'p1', x: 100, y: 100, body: { enable: true }, setPosition: vi.fn() });
      const playerManager = {
        getPlayer: (id: string) => id === player.id ? player : undefined,
        getAllPlayers: () => [player],
        getWorldSpawnPoint: () => ({ x: 512, y: 320 }),
      } as unknown as PlayerManager;
      const bridge = { isHost: () => true, broadcastEffect: vi.fn() } as unknown as NetworkBridge;
      const combat = new CombatSystem(playerManager, bridge);
      combat.bindHostExecutionSources({ nowMs: () => 1000, random: () => 0.25 });

      // `none` steht ausserhalb, `observer` steht drin – aber ohne Figur.
      for (const outside of ['none', 'observer'] as const) {
        combat.setInitialSpawnAllowedResolver(() => hasWorldFigure(outside));
        combat.setRespawnAllowedResolver(() => hasWorldFigure(outside));
        combat.initPlayer('p1');
        expect(combat.isAlive('p1'), outside).toBe(false);
      }
      combat.advancePlayerLifecycle(6000);
      expect(player.setPosition).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
