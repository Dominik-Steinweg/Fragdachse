import { describe, expect, it } from 'vitest';
import { EnemyAiTargetCatalog, type EnemyAiTargetCandidate } from '../src/systems/EnemyAiTargetCatalog';

function candidate(
  kind: EnemyAiTargetCandidate['kind'],
  id: string,
  isTargetable: () => boolean,
): EnemyAiTargetCandidate {
  return {
    kind,
    id,
    x: 100,
    y: 100,
    goalCells: [{ gridX: 1, gridY: 1 }],
    isTargetable,
  };
}

describe('EnemyAiTargetCatalog', () => {
  it('excludes a stealthed player but keeps the technical decoy target', () => {
    let stealthed = true;
    let decoyAlive = true;
    const catalog = new EnemyAiTargetCatalog();
    catalog.updateTargets([
      candidate('player', 'player-a', () => !stealthed),
      candidate('player', 'player-b', () => true),
      candidate('decoy', '17', () => decoyAlive),
    ]);

    expect(catalog.getCandidates('player-like').map((target) => `${target.kind}:${target.id}`)).toEqual([
      'decoy:17',
      'player:player-b',
    ]);
    expect(catalog.resolve({ kind: 'player', id: 'player-a' })).toBeNull();
    expect(catalog.resolve({ kind: 'decoy', id: '17' })?.kind).toBe('decoy');

    decoyAlive = false;
    expect(catalog.resolve({ kind: 'decoy', id: '17' })).toBeNull();
    expect(catalog.resolve({ kind: 'player', id: 'player-a' })).toBeNull();

    stealthed = false;
    expect(catalog.resolve({ kind: 'player', id: 'player-a' })?.kind).toBe('player');
  });

  it('derives player-like and armed-construct groups without faking a PlayerEntity', () => {
    const catalog = new EnemyAiTargetCatalog();
    catalog.updateTargets([
      candidate('player', 'player-a', () => true),
      candidate('decoy', '17', () => true),
      candidate('armed-construct', '3', () => true),
      candidate('armed-outpost', 'outpost-a', () => true),
    ]);

    expect(catalog.getCandidates('players').map((target) => target.kind)).toEqual(['player']);
    expect(catalog.getCandidates('players-and-armed-constructs').map((target) => target.kind)).toEqual([
      'armed-construct',
      'armed-outpost',
      'decoy',
      'player',
    ]);
    expect(catalog.getStrategicCandidates().some((target) => target.kind === 'decoy')).toBe(true);
  });
});
