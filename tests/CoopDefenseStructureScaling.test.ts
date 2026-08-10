import { describe, expect, it } from 'vitest';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import type { CoopDefenseMapConfig } from '../src/config/coopDefenseMaps';

const C_SHAPE = {
  kind: 'cells' as const,
  cells: [
    { gridX: 0, gridY: 0 }, { gridX: 1, gridY: 0 }, { gridX: 2, gridY: 0 },
    { gridX: 0, gridY: 1 },                         { gridX: 2, gridY: 1 },
    { gridX: 0, gridY: 2 }, { gridX: 1, gridY: 2 }, { gridX: 2, gridY: 2 },
  ],
};

const STRUCTURE_SCALING_MAP: CoopDefenseMapConfig = {
  mapId: 'structure-scaling-test',
  displayName: 'Structure scaling test',
  roundDurationSec: 60,
  bases: [
    {
      id: 'friendly-main',
      hpMax: 100,
      anchor: { kind: 'grid', gridX: 70, gridY: 2 },
      shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
    },
    {
      id: 'friendly-outpost',
      hpMax: 200,
      faction: 'friendly',
      role: 'outpost',
      anchor: { kind: 'grid', gridX: 70, gridY: 5 },
      shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
    },
    {
      id: 'friendly-override',
      hpMax: 100,
      faction: 'friendly',
      role: 'outpost',
      playerScaling: { maxHpFactorPerAdditionalPlayer: 0.5 },
      anchor: { kind: 'grid', gridX: 70, gridY: 8 },
      shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
    },
    {
      id: 'hostile-main',
      hpMax: 1000,
      faction: 'hostile',
      anchor: { kind: 'grid', gridX: 40, gridY: 2 },
      shape: { kind: 'rectangle', widthCells: 2, heightCells: 2 },
    },
    {
      id: 'hostile-outpost',
      hpMax: 400,
      faction: 'hostile',
      role: 'outpost',
      anchor: { kind: 'grid', gridX: 40, gridY: 7 },
      shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
    },
    {
      id: 'hostile-spawn-point',
      hpMax: 200,
      faction: 'hostile',
      role: 'spawn-point',
      anchor: { kind: 'grid', gridX: 40, gridY: 12 },
      shape: C_SHAPE,
      spawnCenter: { gridX: 1, gridY: 1 },
    },
    {
      id: 'hostile-override',
      hpMax: 100,
      faction: 'hostile',
      playerScaling: { maxHpFactorPerAdditionalPlayer: 1 },
      anchor: { kind: 'grid', gridX: 50, gridY: 12 },
      shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
    },
  ],
  powerUps: [],
};

function resolvedById(playerCount: number): Map<string, number> {
  return new Map(resolveCoopDefenseBases(STRUCTURE_SCALING_MAP, playerCount).map((base) => [base.id, base.hpMax]));
}

describe('Coop defense structure multiplayer scaling', () => {
  it('keeps every configured structure at its one-player HP for one player', () => {
    expect([...resolvedById(1).entries()]).toEqual([
      ['friendly-main', 100],
      ['friendly-outpost', 200],
      ['friendly-override', 100],
      ['hostile-main', 1000],
      ['hostile-outpost', 400],
      ['hostile-spawn-point', 200],
      ['hostile-override', 100],
    ]);
  });

  it('scales hostile main bases, outposts, and spawn points by 50 percent per extra player', () => {
    const hp = resolvedById(3);

    expect(hp.get('hostile-main')).toBe(2000);
    expect(hp.get('hostile-outpost')).toBe(800);
    expect(hp.get('hostile-spawn-point')).toBe(400);
  });

  it('does not automatically scale friendly structures but allows an explicit override', () => {
    const hp = resolvedById(3);

    expect(hp.get('friendly-main')).toBe(100);
    expect(hp.get('friendly-outpost')).toBe(200);
    expect(hp.get('friendly-override')).toBe(200);
  });

  it('lets a structure override the hostile default factor', () => {
    expect(resolvedById(3).get('hostile-override')).toBe(300);
  });

  it('resolves identical HP on host and client from the fixed round-start player count', () => {
    const hostResolution = resolvedById(3);
    const clientResolution = resolvedById(3);

    expect(clientResolution).toEqual(hostResolution);
    expect(resolvedById(1)).not.toEqual(hostResolution);
  });
});
