import { describe, expect, it } from 'vitest';
import { CoopDefenseSurvivalSystem } from '../src/systems/CoopDefenseSurvivalSystem';

function createSystem(respawnsPerPlayer = 2): CoopDefenseSurvivalSystem {
  return new CoopDefenseSurvivalSystem({
    respawnsPerPlayer,
    participantIds: ['p1', 'p2'],
  });
}

describe('CoopDefenseSurvivalSystem', () => {
  it('does not consume a respawn on the initial spawn', () => {
    const system = createSystem();

    expect(system.getPlayerState('p1')).toEqual({
      remainingRespawns: 2,
      alive: true,
      eliminated: false,
    });
    expect(system.registerInitialSpawn('p1')).toBe(true);
    expect(system.getPlayerState('p1')?.remainingRespawns).toBe(2);
  });

  it('allows a reconnect during the same life without treating it as a respawn', () => {
    const system = createSystem();

    expect(system.registerInitialSpawn('p1')).toBe(true);
    expect(system.getPlayerState('p1')?.remainingRespawns).toBe(2);
    expect(system.canPlayerRespawn('p1')).toBe(false);
  });

  it('rejects the initial reconnect path after death so reentry must consume one respawn', () => {
    const system = createSystem();

    system.handlePlayerDeath('p1');
    expect(system.registerInitialSpawn('p1')).toBe(false);
    expect(system.canPlayerRespawn('p1')).toBe(true);
    expect(system.consumeRespawn('p1')).toBe(true);
    expect(system.getPlayerState('p1')?.remainingRespawns).toBe(1);
  });

  it('keeps the gate pure and consumes exactly one budget on a real respawn', () => {
    const system = createSystem();

    system.handlePlayerDeath('p1');
    expect(system.canPlayerRespawn('p1')).toBe(true);
    expect(system.canPlayerRespawn('p1')).toBe(true);
    expect(system.getPlayerState('p1')?.remainingRespawns).toBe(2);

    expect(system.consumeRespawn('p1')).toBe(true);
    expect(system.getPlayerState('p1')).toEqual({
      remainingRespawns: 1,
      alive: true,
      eliminated: false,
    });
    expect(system.consumeRespawn('p1')).toBe(false);
  });

  it('treats zero remaining respawns as the last active life', () => {
    const system = createSystem(1);

    system.handlePlayerDeath('p1');
    expect(system.consumeRespawn('p1')).toBe(true);
    expect(system.getPlayerState('p1')).toEqual({
      remainingRespawns: 0,
      alive: true,
      eliminated: false,
    });
    expect(system.canPlayerAct('p1')).toBe(true);
    expect(system.isTeamWiped(['p1'])).toBe(false);

    system.handlePlayerDeath('p1');
    expect(system.getPlayerState('p1')).toEqual({
      remainingRespawns: 0,
      alive: false,
      eliminated: true,
    });
    expect(system.canPlayerRespawn('p1')).toBe(false);
    expect(system.canPlayerAct('p1')).toBe(false);
    expect(system.registerInitialSpawn('p1')).toBe(false);
  });

  it('keeps eliminated players as survival participants while excluding spectators and disconnects from the wipe', () => {
    const system = createSystem(1);
    system.handlePlayerDeath('p1');
    system.handlePlayerDeath('p2');
    expect(system.consumeRespawn('p2')).toBe(true);
    system.handlePlayerDeath('p2');

    expect(system.isTeamWiped(['p1', 'p2', 'late'])).toBe(false);
    expect(system.isTeamWiped(['p1', 'p2', 'late'], ['p1'])).toBe(true);
    expect(system.isTeamWiped(['p2', 'late'])).toBe(true);
    expect(system.hasPlayer('late')).toBe(false);

    const disconnected = createSystem(1);
    disconnected.handlePlayerDeath('p1');
    expect(disconnected.consumeRespawn('p1')).toBe(true);
    disconnected.handlePlayerDeath('p1');
    disconnected.handlePlayerDeath('p2');
    expect(disconnected.isTeamWiped(['p1', 'p2'])).toBe(false);
    expect(disconnected.isTeamWiped(['p1'])).toBe(true);
  });

  it('does not wipe while a connected participant can respawn or is alive on the last life', () => {
    const system = createSystem(1);

    system.handlePlayerDeath('p1');
    system.handlePlayerDeath('p2');
    expect(system.isTeamWiped(['p1', 'p2'])).toBe(false);

    expect(system.consumeRespawn('p1')).toBe(true);
    expect(system.isTeamWiped(['p1', 'p2'])).toBe(false);

    system.handlePlayerDeath('p1');
    expect(system.isTeamWiped(['p1', 'p2'])).toBe(false);

    expect(system.consumeRespawn('p2')).toBe(true);
    system.handlePlayerDeath('p2');
    expect(system.isTeamWiped(['p1', 'p2'])).toBe(true);
  });
});
