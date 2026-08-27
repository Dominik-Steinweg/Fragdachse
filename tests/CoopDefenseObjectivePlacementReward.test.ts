import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import {
  normalizeCoopDefenseMapConfig,
  resolveCoopDefenseMapSecondaryObjectives,
  type CoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import {
  getBaseRewardPickupWorldPosition,
  resolveCoopDefenseActivityBases,
} from '../src/arena/BaseRegistry';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';
import { PowerUpSystem } from '../src/powerups/PowerUpSystem';
import { CoopDefenseObjectivePlacementRewardSystem } from '../src/systems/CoopDefenseObjectivePlacementRewardSystem';
import type { ArenaLayout } from '../src/types';

const EMPTY_LAYOUT: ArenaLayout = {
  seed: 1,
  rocks: [],
  trees: [],
  tracks: [],
  dirt: [],
  powerUpPedestals: [],
};

/** Authored Hold-Mission mit Ablage-Belohnung – der Vertrag, den B6 tatsaechlich traegt. */
const REWARD_MAP = {
  mapId: 'placement-reward-test',
  balanceReferenceDurationSec: 60,
  objective: 'repel-assault',
  bases: [
    {
      id: 'friendly-main',
      hpMax: 100,
      anchor: { kind: 'right-center', edgeInsetCells: 0 },
      shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
    },
    {
      id: 'supply-base',
      hpMax: 1_400,
      startHpFactor: 0.35,
      role: 'outpost',
      dormant: true,
      anchor: { kind: 'grid', gridX: 30, gridY: 12 },
      shape: { kind: 'rectangle', widthCells: 2, heightCells: 2 },
    },
  ],
  powerUps: [],
  encounters: [
    { id: 'reveal', start: { type: 'time', atMs: 0 }, restAfterMs: 5_000, groups: [{ enemyKind: 'zombie-badger', count: 2 }] },
    { id: 'defend', start: { type: 'after-previous' }, restAfterMs: 5_000, groups: [{ enemyKind: 'zombie-badger', count: 3 }] },
    { id: 'closing', start: { type: 'after-previous' }, groups: [{ enemyKind: 'zombie-badger', count: 3 }] },
  ],
  secondaryObjectives: [
    {
      id: 'hold-supply-base',
      type: 'hold',
      start: { type: 'after-encounter', encounterId: 'reveal' },
      holdUntil: { type: 'after-encounter', encounterId: 'defend' },
      targets: ['supply-base'],
      rewards: {
        repairTargetOnComplete: false,
        placeablePedestalOnComplete: { powerUpDefId: 'HOLY_HAND_GRENADE' },
      },
    },
  ],
} as unknown as CoopDefenseMapConfig;

function makeObjective(overrides: Partial<Parameters<typeof CoopDefenseObjectivePlacementRewardSystem>[0][number]> = {}) {
  return {
    id: 'hold-supply-base',
    type: 'hold' as const,
    start: { type: 'time' as const, atMs: 0 },
    holdUntil: { type: 'time' as const, atMs: 1_000 },
    targets: ['supply-base'],
    targetGoal: 1,
    rewards: {
      repairTargetOnComplete: false,
      placeablePedestalOnComplete: { powerUpDefId: 'HOLY_HAND_GRENADE' },
    },
    ...overrides,
  };
}

function makeRewardSystem(options: {
  objective?: ReturnType<typeof makeObjective>;
  basePosition?: { x: number; y: number } | null;
  spawnMarker?: (objectiveId: string, defId: string, x: number, y: number) => boolean;
  removeMarker?: (objectiveId: string) => void;
  spawnPickup?: (objectiveId: string, defId: string, x: number, y: number) => boolean;
  overrideUtility?: (playerId: string, config: Parameters<NonNullable<ConstructorParameters<typeof CoopDefenseObjectivePlacementRewardSystem>[1]['overrideUtility']>>[1]) => boolean;
  releaseUtilityOverride?: (playerId: string) => void;
} = {}) {
  const objective = options.objective ?? makeObjective();
  const spawnMarker = options.spawnMarker ?? vi.fn(() => true);
  const removeMarker = options.removeMarker ?? vi.fn();
  const spawnPickup = options.spawnPickup ?? vi.fn(() => true);
  const overrideUtility = options.overrideUtility ?? vi.fn(() => true);
  const releaseUtilityOverride = options.releaseUtilityOverride ?? vi.fn();
  const system = new CoopDefenseObjectivePlacementRewardSystem([objective], {
    isEligiblePlayer: () => true,
    getBasePosition: () => options.basePosition ?? { x: 100, y: 100 },
    spawnMarker,
    removeMarker,
    spawnPickup,
    overrideUtility,
    releaseUtilityOverride,
  });
  return { system, objective, spawnMarker, removeMarker, spawnPickup, overrideUtility, releaseUtilityOverride };
}

function makePowerUpSystem(options: ConstructorParameters<typeof PowerUpSystem>[3] = {}) {
  const combat = {
    healToFull: vi.fn(),
    addArmor: vi.fn(),
    isAlive: vi.fn(() => true),
    isBurrowed: vi.fn(() => false),
    applyDamage: vi.fn(),
    applyExplosionDamage: vi.fn(),
  };
  return new PowerUpSystem(null as never, combat, EMPTY_LAYOUT, options);
}

describe('B6 objective placement rewards', () => {
  /**
   * Der authored Weg von der Hold-Konfiguration bis zum liegenden Pickup.
   *
   * Die Map-Konfiguration ist hier absichtlich im Test aufgebaut und nicht aus einer Karte
   * gelesen: Der frueher benutzte Sandkasten war die Testarena, und die traegt seit Block A nur
   * noch Stressgeometrie. Geprueft wird die Kette Normalisierung -> Basis-Aufloesung ->
   * Ablageposition -> Pickup, nicht der Inhalt einer bestimmten Karte.
   */
  it('spawns an authored supply-base reward after Hold completion', () => {
    const map = normalizeCoopDefenseMapConfig(REWARD_MAP);
    const objective = resolveCoopDefenseMapSecondaryObjectives(map)
      .find((entry) => entry.id === 'hold-supply-base');
    const bases = resolveCoopDefenseActivityBases(map, 1);
    const supplyBase = bases.find((base) => base.id === 'supply-base');
    expect(objective?.rewards?.placeablePedestalOnComplete?.powerUpDefId).toBe('HOLY_HAND_GRENADE');
    expect(supplyBase).toBeDefined();
    if (!objective || !supplyBase) return;

    const position = getBaseRewardPickupWorldPosition(supplyBase, resolveActiveArenaWorldMetrics(), bases);
    expect(position).not.toBeNull();
    if (!position) return;
    const gridX = Math.floor((position.x - ARENA_OFFSET_X) / CELL_SIZE);
    const gridY = Math.floor((position.y - ARENA_OFFSET_Y) / CELL_SIZE);
    expect(supplyBase.cells.some((cell) => cell.gridX === gridX && cell.gridY === gridY)).toBe(false);

    const spawned: Array<{ objectiveId: string; defId: string; x: number; y: number }> = [];
    const rewardSystem = new CoopDefenseObjectivePlacementRewardSystem([objective], {
      isEligiblePlayer: () => true,
      getBasePosition: () => position,
      spawnMarker: () => true,
      removeMarker: () => undefined,
      spawnPickup: (objectiveId, defId, x, y) => {
        spawned.push({ objectiveId, defId, x, y });
        return true;
      },
      overrideUtility: () => true,
      releaseUtilityOverride: () => undefined,
    });

    expect(rewardSystem.activate('hold-supply-base')).toBe(true);
    expect(rewardSystem.getState('hold-supply-base')).toBe('available');
    expect(spawned).toEqual([{
      objectiveId: 'hold-supply-base',
      defId: 'HOLY_HAND_GRENADE',
      x: position.x,
      y: position.y,
    }]);
  });

  it('shows the generic spawn marker from mission start and replaces it with the claimable reward', () => {
    let rewardSystem: CoopDefenseObjectivePlacementRewardSystem;
    const powerUps = makePowerUpSystem({
      onObjectiveRewardPickup: (objectiveId, playerId) => rewardSystem.claim(objectiveId, playerId),
    });
    const reward = makeRewardSystem({
      spawnMarker: (objectiveId, defId, x, y) => powerUps.spawnObjectiveRewardMarker(objectiveId, defId, x, y) !== null,
      spawnPickup: (objectiveId, defId, x, y) => powerUps.spawnObjectiveRewardPickup(objectiveId, defId, x, y) !== null,
    });
    rewardSystem = reward.system;

    expect(rewardSystem.begin(reward.objective.id)).toBe(true);
    const marker = powerUps.getWorldItemSnapshot()[0];
    expect(marker).toMatchObject({ pickupKind: 'objective-marker', objectiveId: reward.objective.id });
    if (!marker) return;
    expect(powerUps.tryPickup('player-a', marker.uid, marker.x, marker.y)).toBe(false);

    expect(rewardSystem.activate(reward.objective.id)).toBe(true);
    expect(powerUps.getWorldItemSnapshot()).toEqual([
      {
        uid: 1,
        defId: 'HOLY_HAND_GRENADE',
        x: 100,
        y: 100,
        pickupKind: 'objective-marker',
        objectiveId: reward.objective.id,
      },
      {
        uid: 2,
        defId: 'HOLY_HAND_GRENADE',
        x: 100,
        y: 100,
        pickupKind: 'objective-placement',
        objectiveId: reward.objective.id,
      },
    ]);
    const rewardPickup = powerUps.getWorldItemSnapshot().find((item) => item.pickupKind === 'objective-placement');
    expect(rewardPickup).toBeDefined();
    if (!rewardPickup) return;
    expect(powerUps.tryPickup('player-a', rewardPickup.uid, rewardPickup.x, rewardPickup.y)).toBe(true);
    expect(powerUps.getWorldItemSnapshot()).toEqual([{
      uid: 1,
      defId: 'HOLY_HAND_GRENADE',
      x: 100,
      y: 100,
      pickupKind: 'objective-marker',
      objectiveId: reward.objective.id,
    }]);
  });

  it('clears the announced spawn point when the Hold fails before completion', () => {
    const { system, objective, removeMarker } = makeRewardSystem();
    expect(system.begin(objective.id)).toBe(true);
    expect(system.cancel(objective.id)).toBe(true);
    expect(system.getState(objective.id)).toBe('cancelled');
    expect(removeMarker).toHaveBeenCalledWith(objective.id);
  });

  it('allows exactly one carrier for competing claims', () => {
    const { system, objective, overrideUtility } = makeRewardSystem();
    expect(system.activate(objective.id)).toBe(true);
    expect(system.claim(objective.id, 'player-a')).toBe(true);
    expect(system.claim(objective.id, 'player-b')).toBe(false);
    expect(system.getCarrierId(objective.id)).toBe('player-a');
    expect(system.getState(objective.id)).toBe('carried');
    expect(overrideUtility).toHaveBeenCalledOnce();
  });

  it('keeps a rejected claim available without creating an override', () => {
    const overrideUtility = vi.fn(() => false);
    const { system, objective } = makeRewardSystem({ overrideUtility });
    expect(system.activate(objective.id)).toBe(true);
    expect(system.claim(objective.id, 'player-a')).toBe(false);
    expect(system.getState(objective.id)).toBe('available');
    expect(system.getCarrierId(objective.id)).toBeNull();
    expect(overrideUtility).toHaveBeenCalledOnce();
  });

  it.each(['death', 'spectator', 'disconnect'] as const)(
    'returns the charge to available with exactly one pickup after %s',
    () => {
      const { system, objective, spawnPickup, releaseUtilityOverride } = makeRewardSystem();
      expect(system.activate(objective.id)).toBe(true);
      expect(system.claim(objective.id, 'player-a')).toBe(true);

      system.handlePlayerUnavailable('player-a');
      system.handlePlayerUnavailable('player-a');

      expect(system.getState(objective.id)).toBe('available');
      expect(system.getCarrierId(objective.id)).toBeNull();
      expect(releaseUtilityOverride).toHaveBeenCalledOnce();
      expect(spawnPickup).toHaveBeenCalledTimes(2);
    },
  );

  it('does not consume a carried charge when placement fails', () => {
    const { system, objective } = makeRewardSystem();
    expect(system.activate(objective.id)).toBe(true);
    expect(system.claim(objective.id, 'player-a')).toBe(true);
    expect(system.canPlace(objective.id, 'player-a')).toBe(true);

    expect(system.consume('other-objective', 'player-a')).toBe(false);
    expect(system.getState(objective.id)).toBe('carried');
    expect(system.getCarrierId(objective.id)).toBe('player-a');
  });

  it('accepts exactly one concurrent normal utility pickup', () => {
    const acceptedPlayers: string[] = [];
    const powerUps = makePowerUpSystem({
      onBfgPickup: (playerId) => {
        acceptedPlayers.push(playerId);
        return true;
      },
    });
    expect(powerUps.registerConstructionPedestal(42, 'BFG', 300, 300)).toBe(true);
    const pickup = powerUps.getWorldItemSnapshot()[0];
    expect(pickup).toBeDefined();
    if (!pickup) return;

    expect(powerUps.tryPickup('player-a', pickup.uid, pickup.x, pickup.y)).toBe(true);
    expect(powerUps.tryPickup('player-b', pickup.uid, pickup.x, pickup.y)).toBe(false);
    expect(acceptedPlayers).toEqual(['player-a']);
  });

  it('consumes after successful placement and gives the first Holy Hand Grenade immediately', () => {
    let rewardSystem: CoopDefenseObjectivePlacementRewardSystem;
    const powerUps = makePowerUpSystem({
      onObjectiveRewardPickup: (objectiveId, playerId) => rewardSystem.claim(objectiveId, playerId),
    });
    const reward = makeRewardSystem({
      spawnPickup: (objectiveId, defId, x, y) => powerUps.spawnObjectiveRewardPickup(objectiveId, defId, x, y) !== null,
    });
    rewardSystem = reward.system;

    expect(rewardSystem.activate(reward.objective.id)).toBe(true);
    const pickup = powerUps.getWorldItemSnapshot()[0];
    expect(pickup).toMatchObject({ pickupKind: 'objective-placement', objectiveId: reward.objective.id });
    if (!pickup) return;
    expect(powerUps.tryPickup('player-a', pickup.uid, pickup.x, pickup.y)).toBe(true);
    expect(rewardSystem.getState(reward.objective.id)).toBe('carried');

    expect(powerUps.registerConstructionPedestal(42, 'HOLY_HAND_GRENADE', 300, 300)).toBe(true);
    expect(rewardSystem.consume(reward.objective.id, 'player-a')).toBe(true);
    expect(rewardSystem.getState(reward.objective.id)).toBe('consumed');
    expect(powerUps.getPedestalSnapshot()).toHaveLength(1);
    expect(powerUps.getWorldItemSnapshot()).toEqual([{ uid: 2, defId: 'HOLY_HAND_GRENADE', x: 300, y: 300 }]);
  });

  it('uses the normal one-item pedestal respawn cycle after the mission placement', () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const powerUps = makePowerUpSystem();
    powerUps.setArenaStartTime(1);
    expect(powerUps.registerConstructionPedestal(42, 'HOLY_HAND_GRENADE', 300, 300)).toBe(true);
    expect(powerUps.getWorldItemSnapshot()).toHaveLength(1);
    expect(powerUps.tryPickup('player-a', 1, 300, 300)).toBe(true);
    expect(powerUps.getWorldItemSnapshot()).toHaveLength(0);

    now += 29_999;
    powerUps.update(0);
    expect(powerUps.getWorldItemSnapshot()).toHaveLength(0);
    now += 1;
    powerUps.update(0);
    expect(powerUps.getWorldItemSnapshot()).toEqual([{ uid: 2, defId: 'HOLY_HAND_GRENADE', x: 300, y: 300 }]);
  });

  it('does not duplicate a reward when activation or unavailable callbacks repeat', () => {
    const { system, objective, spawnPickup } = makeRewardSystem();
    expect(system.activate(objective.id)).toBe(true);
    expect(system.activate(objective.id)).toBe(false);
    expect(system.claim(objective.id, 'player-a')).toBe(true);
    system.handlePlayerUnavailable('player-a');
    system.handlePlayerUnavailable('player-a');
    expect(spawnPickup).toHaveBeenCalledTimes(2);
  });
});
