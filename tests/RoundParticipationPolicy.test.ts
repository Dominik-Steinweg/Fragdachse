import { describe, expect, it } from 'vitest';
import {
  canRoundPlayerReceiveRewards,
  canRoundPlayerSpawnOrRespawn,
  createRoundParticipationState,
  enterRoundSpectator,
  getRoundPlayerRole,
  getRoundResultEligibleIds,
  markRoundLateJoiner,
} from '../src/scenes/arena/RoundParticipationPolicy';
import { CoopDefenseRespawnBudgetSystem } from '../src/systems/CoopDefenseRespawnBudgetSystem';

describe('round participation policy', () => {
  it('marks a latejoiner as spectator and excludes it from spawn, respawn and results', () => {
    const started = createRoundParticipationState(1000, ['p1', 'p2']);
    const withLatejoiner = markRoundLateJoiner(started, 'late');

    expect(getRoundPlayerRole(withLatejoiner, 'late')).toBe('spectator');
    expect(canRoundPlayerSpawnOrRespawn(withLatejoiner, 'late')).toBe(false);
    expect(canRoundPlayerReceiveRewards(withLatejoiner, 'late')).toBe(false);
    expect(getRoundResultEligibleIds(withLatejoiner, ['p1', 'p2', 'late'])).toEqual(['p1', 'p2']);
    expect(getRoundPlayerRole(withLatejoiner, 'p1')).toBe('participant');
  });

  it('turns a voluntary participant into a permanent spectator without granting rewards', () => {
    const started = createRoundParticipationState(1000, ['p1', 'p2']);
    const spectatorState = enterRoundSpectator(started, 'p1');

    expect(getRoundPlayerRole(spectatorState, 'p1')).toBe('spectator');
    expect(canRoundPlayerSpawnOrRespawn(spectatorState, 'p1')).toBe(false);
    expect(canRoundPlayerReceiveRewards(spectatorState, 'p1')).toBe(false);
    expect(getRoundResultEligibleIds(spectatorState, ['p1', 'p2'])).toEqual(['p2']);
    expect(getRoundPlayerRole(spectatorState, 'p2')).toBe('participant');
  });

  it('allows a former spectator to participate again only in a newly created round', () => {
    const previousRound = enterRoundSpectator(
      createRoundParticipationState(1000, ['p1', 'p2']),
      'p1',
    );
    const nextRound = createRoundParticipationState(5000, ['p1', 'p2']);

    expect(getRoundPlayerRole(previousRound, 'p1')).toBe('spectator');
    expect(getRoundPlayerRole(nextRound, 'p1')).toBe('participant');
    expect(canRoundPlayerSpawnOrRespawn(nextRound, 'p1')).toBe(true);
    expect(canRoundPlayerReceiveRewards(nextRound, 'p1')).toBe(true);
  });

  it('keeps a budget-eliminated participant eligible without moving it into spectatorIds', () => {
    const started = createRoundParticipationState(1000, ['p1', 'p2']);
    const survival = new CoopDefenseRespawnBudgetSystem({ respawnsPerPlayer: 0, participantIds: ['p1', 'p2'] });
    survival.handlePlayerDeath('p1');

    expect(getRoundPlayerRole(started, 'p1')).toBe('participant');
    expect(started.spectatorIds).not.toContain('p1');
    expect(canRoundPlayerReceiveRewards(started, 'p1')).toBe(true);
    expect(getRoundResultEligibleIds(started, ['p1', 'p2'])).toContain('p1');
    expect(survival.isPlayerEliminated('p1')).toBe(true);
  });
});
