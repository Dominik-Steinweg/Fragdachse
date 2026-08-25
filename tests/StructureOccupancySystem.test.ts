import { describe, expect, it } from 'vitest';
import {
  StructureOccupancySystem,
  type StructureOccupancyDefinition,
} from '../src/systems/StructureOccupancySystem';

const watchtower: StructureOccupancyDefinition = {
  id: 'reward-watchtower',
  kind: 'watchtower',
  capacity: 4,
  interactionRange: 100,
  movementLocked: true,
  weaponsAllowed: true,
  utilityAllowed: true,
  dashAllowed: false,
  constructionAllowed: false,
  directDamageImmune: false,
  weaponRangeMultiplier: 1.25,
  adrenalineRegenMultiplier: 1.5,
};

const burrow: StructureOccupancyDefinition = {
  id: 'reward-burrow',
  kind: 'burrow',
  capacity: 'team',
  interactionRange: 100,
  movementLocked: true,
  weaponsAllowed: false,
  utilityAllowed: false,
  dashAllowed: false,
  constructionAllowed: false,
  directDamageImmune: true,
};

function system(
  positions: Record<string, { x: number; y: number }>,
  team = Object.keys(positions),
  onStructureDestroyed?: (structureId: string, occupants: readonly string[]) => void,
): StructureOccupancySystem {
  return new StructureOccupancySystem({
    getPlayerPosition: (playerId) => positions[playerId] ?? null,
    getStructurePosition: (structureId) => structureId === 'reward-watchtower'
      ? { x: 0, y: 0 }
      : structureId === 'reward-burrow' ? { x: 0, y: 0 } : null,
    getTeamPlayerIds: () => team,
    onStructureDestroyed,
  });
}

describe('StructureOccupancySystem', () => {
  it('allows four watchtower occupants, keeps aim irrelevant for a single candidate, and exposes modifiers', () => {
    const positions = {
      p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 }, p4: { x: 0, y: 0 }, p5: { x: 0, y: 0 },
    };
    const occupancy = system(positions);
    occupancy.registerStructure(watchtower);

    expect(occupancy.selectStructure('p1', Math.PI)).toBe('reward-watchtower');
    for (const playerId of ['p1', 'p2', 'p3', 'p4']) {
      expect(occupancy.enter(playerId, 'reward-watchtower')).toMatchObject({ ok: true });
    }
    expect(occupancy.enter('p5', 'reward-watchtower')).toEqual({ ok: false, reason: 'full' });
    expect(occupancy.getPlayerModifiers('p1')).toEqual({
      weaponRangeMultiplier: 1.25,
      adrenalineRegenMultiplier: 1.5,
    });
    expect(occupancy.isActionAllowed('p1', 'move')).toBe(false);
    expect(occupancy.isActionAllowed('p1', 'weapon')).toBe(true);
    expect(occupancy.isActionAllowed('p1', 'dash')).toBe(false);
    expect(occupancy.isPlayerTargetableToEnemies('p1')).toBe(false);
    expect(occupancy.canMoveStructure('reward-watchtower')).toBe(false);
    expect(occupancy.exit('p1')).toBe(true);
    expect(occupancy.canMoveStructure('reward-watchtower')).toBe(false);
  });

  it('uses team capacity and fully locks burrow occupants', () => {
    const positions = {
      p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 }, p4: { x: 0, y: 0 },
    };
    const occupancy = system(positions, ['p1', 'p2', 'p3']);
    occupancy.registerStructure(burrow);

    for (const playerId of ['p1', 'p2', 'p3']) {
      expect(occupancy.enter(playerId, 'reward-burrow')).toMatchObject({ ok: true });
    }
    expect(occupancy.enter('p4', 'reward-burrow')).toEqual({ ok: false, reason: 'full' });
    expect(occupancy.isActionAllowed('p1', 'move')).toBe(false);
    expect(occupancy.isActionAllowed('p1', 'weapon')).toBe(false);
    expect(occupancy.isActionAllowed('p1', 'utility')).toBe(false);
    expect(occupancy.isActionAllowed('p1', 'construction')).toBe(false);
    expect(occupancy.isActionAllowed('p1', 'direct-damage')).toBe(false);
    expect(occupancy.isPlayerProtectedFromDirectDamage('p1')).toBe(true);
    expect(occupancy.isStructureTargetProxy('reward-burrow')).toBe(true);
  });

  it('cleans disconnects and kills every occupant exactly once on destruction', () => {
    const destroyed: Array<{ id: string; occupants: readonly string[] }> = [];
    const positions = { p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 } };
    const occupancy = system(positions, Object.keys(positions), (id, occupants) => {
      destroyed.push({ id, occupants });
    });
    occupancy.registerStructure(burrow);
    occupancy.enter('p1', 'reward-burrow');
    occupancy.enter('p2', 'reward-burrow');

    occupancy.onPlayerDisconnect('p1');
    expect(occupancy.getOccupants('reward-burrow')).toEqual(['p2']);
    expect(occupancy.onStructureDestroyed('reward-burrow')).toEqual(['p2']);
    expect(destroyed).toEqual([{ id: 'reward-burrow', occupants: ['p2'] }]);
    expect(occupancy.getOccupants('reward-burrow')).toEqual([]);
    expect(occupancy.isStructureTargetProxy('reward-burrow')).toBe(false);
  });
});
