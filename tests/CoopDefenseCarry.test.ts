import { describe, expect, it } from 'vitest';
import {
  getCoopDefenseMapObjectiveZoneWorldRect,
  normalizeCoopDefenseMapConfig,
  type CoopDefenseMapConfig,
  type ResolvedCoopDefenseMapSecondaryObjectiveConfig,
} from '../src/config/coopDefenseMaps';
import { CoopDefenseCarrySystem, type CoopDefenseCarryPlayerLike } from '../src/systems/CoopDefenseCarrySystem';
import { CoopDefenseSecondaryObjectiveSystem } from '../src/systems/CoopDefenseSecondaryObjectiveSystem';

interface FakePlayer extends CoopDefenseCarryPlayerLike {
  alive: boolean;
  burrowed: boolean;
  setPosition(x: number, y: number): void;
}

function makePlayer(id: string, x = 0, y = 0): FakePlayer {
  const player = {
    id,
    alive: true,
    burrowed: false,
    body: { enable: true },
    sprite: {
      x,
      y,
      getBounds: () => ({ x: player.sprite.x - 6, y: player.sprite.y - 6, width: 12, height: 12 }),
    },
    setPosition(nextX: number, nextY: number) {
      player.sprite.x = nextX;
      player.sprite.y = nextY;
    },
  } as FakePlayer;
  return player;
}

function makeCarryConfig(overrides: Partial<ResolvedCoopDefenseMapSecondaryObjectiveConfig> = {}) {
  return {
    id: 'carry-beer',
    type: 'carry',
    start: { type: 'time', atMs: 0 },
    targets: [],
    targetGoal: 3,
    carry: {
      spawnZone: { gridX: 0, gridY: 0, widthCells: 1, heightCells: 1 },
      deliveryZone: { gridX: 10, gridY: 0, widthCells: 1, heightCells: 1 },
      itemCount: 3,
    },
    ...overrides,
  } satisfies ResolvedCoopDefenseMapSecondaryObjectiveConfig;
}

function makeRound() {
  const deliveredFx: Array<{ x: number; y: number }> = [];
  const players = [makePlayer('p2'), makePlayer('p1')];
  const playerManager = {
    getAllPlayers: () => players,
    getPlayer: (playerId: string) => players.find((player) => player.id === playerId),
  };
  let objectiveSystem!: CoopDefenseSecondaryObjectiveSystem;
  let carrySystem!: CoopDefenseCarrySystem;
  const config = makeCarryConfig();
  objectiveSystem = new CoopDefenseSecondaryObjectiveSystem([config], {
    onObjectiveActivated: (objectiveId) => carrySystem.activateObjective(objectiveId),
  });
  carrySystem = new CoopDefenseCarrySystem([config], playerManager, {
    isPlayerEligible: () => true,
    isPlayerAlive: (playerId) => playerManager.getPlayer(playerId)?.alive ?? false,
    isPlayerBurrowed: (playerId) => playerManager.getPlayer(playerId)?.burrowed ?? false,
    onDelivered: (objectiveId, itemId) => objectiveSystem.reportCarryDelivered(objectiveId, itemId),
    onDeliveredFx: (x, y) => deliveredFx.push({ x, y }),
  });
  objectiveSystem.hostUpdate(0, false);
  return { players, playerManager, config, objectiveSystem, carrySystem, deliveredFx };
}

describe('Coop-Defense B7 Carry', () => {
  it('activates and spawns authored independent items in a compact centered stack', () => {
    const { carrySystem, objectiveSystem, config } = makeRound();
    expect(objectiveSystem.getObjectiveState('carry-beer')).toBe('active');
    expect(carrySystem.getSnapshot()).toHaveLength(3);
    expect(new Set(carrySystem.getSnapshot().map((item) => item.id)).size).toBe(3);
    expect(carrySystem.getSnapshot().every((item) => item.state === 'spawned')).toBe(true);
    expect(new Set(carrySystem.getSnapshot().map((item) => `${item.x}:${item.y}`)).size).toBe(3);
    const spawnRect = getCoopDefenseMapObjectiveZoneWorldRect(config.carry!.spawnZone);
    const centerX = spawnRect.x + spawnRect.width * 0.5;
    const centerY = spawnRect.y + spawnRect.height * 0.5;
    for (const item of carrySystem.getSnapshot()) {
      expect(Math.abs(item.x - centerX)).toBeLessThanOrEqual(4);
      expect(Math.abs(item.y - centerY)).toBeLessThanOrEqual(4);
    }
  });

  it('allows deterministic claims while limiting every player to one item', () => {
    const { players, carrySystem } = makeRound();
    const firstItem = carrySystem.getSnapshot()[0];
    players[0].setPosition(firstItem.x, firstItem.y);
    players[1].setPosition(firstItem.x, firstItem.y);
    carrySystem.hostUpdate(true);

    const claimed = carrySystem.getSnapshot().find((item) => item.id === firstItem.id);
    expect(claimed?.holderId).toBe('p1');
    expect(carrySystem.getSnapshot().filter((item) => item.holderId === 'p1')).toHaveLength(1);
    expect(carrySystem.getSnapshot().filter((item) => item.holderId === 'p2')).toHaveLength(1);
    expect(carrySystem.getSnapshot().filter((item) => item.holderId === null)).toHaveLength(1);
  });

  it('replicates delivery progress, deduplicates delivery, and completes at targetGoal', () => {
    const { players, carrySystem, objectiveSystem, config, deliveredFx } = makeRound();
    const delivery = getCoopDefenseMapObjectiveZoneWorldRect(config.carry!.deliveryZone);
    const deliveryX = delivery.x + delivery.width * 0.5;
    const deliveryY = delivery.y + delivery.height * 0.5;

    for (let index = 0; index < 3; index += 1) {
      const item = carrySystem.getSnapshot()[0];
      players[0].setPosition(item.x, item.y);
      carrySystem.hostUpdate(true);
      players[0].setPosition(deliveryX, deliveryY);
      carrySystem.hostUpdate(true);
      expect(objectiveSystem.getPresentationState()[0]?.progressCurrent).toBe(index + 1);
      expect(carrySystem.getSnapshot()).toHaveLength(2 - index);
    }
    expect(objectiveSystem.getObjectiveState('carry-beer')).toBe('completed');
    expect(carrySystem.getSnapshot()).toHaveLength(0);
    // Genau ein Abgabe-Burst pro angenommener Abgabe, an der autoritativen Abgabeposition.
    expect(deliveredFx).toEqual([
      { x: deliveryX, y: deliveryY },
      { x: deliveryX, y: deliveryY },
      { x: deliveryX, y: deliveryY },
    ]);

    // Ein weiterer Tick im Abgabebereich ohne Objekt darf keinen zweiten Burst auslösen.
    carrySystem.hostUpdate(true);
    expect(deliveredFx).toHaveLength(3);
  });

  it('drops on death, survives disconnect/spectator removal, and can be reclaimed', () => {
    const { players, carrySystem } = makeRound();
    const item = carrySystem.getSnapshot()[0];
    players[1].setPosition(item.x, item.y);
    carrySystem.hostUpdate(true);
    carrySystem.dropForPlayer('p1', 444, 555);
    expect(carrySystem.getSnapshot().find((entry) => entry.id === item.id)).toMatchObject({
      holderId: null,
      state: 'dropped',
      x: 444,
      y: 555,
    });

    players[1].alive = false;
    players[0].setPosition(444, 555);
    carrySystem.hostUpdate(true);
    expect(carrySystem.getSnapshot().find((entry) => entry.id === item.id)?.holderId).toBe('p2');

    carrySystem.handlePlayerUnavailable('p2');
    const returned = carrySystem.getSnapshot().find((entry) => entry.id === item.id);
    expect(returned).toMatchObject({ holderId: null, state: 'dropped' });
    expect(returned?.x).toBe(item.x);
    expect(returned?.y).toBe(item.y);
    players[1].alive = true;
    players[1].setPosition(item.x, item.y);
    carrySystem.hostUpdate(true);
    expect(carrySystem.getSnapshot().find((entry) => entry.id === item.id)?.holderId).toBe('p1');
  });
});

describe('B7 Carry map validation', () => {
  function makeMap(
    objective: CoopDefenseMapConfig['secondaryObjectives'][number],
    itemDrop?: CoopDefenseMapConfig['itemDrop'],
  ): CoopDefenseMapConfig {
    return {
      mapId: 'carry-validation',
      displayName: 'Carry validation',
      arenaWidthCells: 30,
      arenaHeightCells: 20,
      balanceReferenceDurationSec: 60,
      objective: 'survive',
      surviveDurationSec: 60,
      surviveRespawnsPerPlayer: 1,
      bases: [{
        id: 'main',
        hpMax: 100,
        anchor: { kind: 'right-center', edgeInsetCells: 0 },
        shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
      }],
      powerUps: [],
      itemDrop,
      secondaryObjectives: [objective],
    };
  }

  const valid = {
    id: 'carry',
    type: 'carry',
    start: { type: 'time', atMs: 0 },
    targets: [],
    targetGoal: 3,
    carry: {
      spawnZone: { gridX: 1, gridY: 1, widthCells: 4, heightCells: 4 },
      deliveryZone: { gridX: 22, gridY: 10, widthCells: 4, heightCells: 4 },
      itemCount: 3,
    },
  } as const;

  it('accepts valid zones and rejects missing, overlapping, and out-of-bounds zones', () => {
    expect(normalizeCoopDefenseMapConfig(makeMap(valid)).secondaryObjectives?.[0].carry).toEqual(valid.carry);
    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      ...valid,
      carry: { ...valid.carry, deliveryZone: { ...valid.carry.deliveryZone, gridX: 3, gridY: 1 } },
    }))).toThrow('must not overlap');
    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      ...valid,
      carry: { ...valid.carry, spawnZone: { ...valid.carry.spawnZone, gridX: 999 } },
    }))).toThrow('out-of-bounds');
    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      ...valid,
      carry: { ...valid.carry, itemCount: 2 },
    }))).toThrow('targetGoal cannot exceed itemCount');
    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      ...valid,
      carry: undefined,
    }))).toThrow('needs carry zones');
  });

  it('requires itemDrop only for a Carry objective that grants the item meta reward', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeMap({
      ...valid,
      rewards: { itemMetaRewardOnComplete: true },
    }))).toThrow('needs itemDrop');

    const normalized = normalizeCoopDefenseMapConfig(makeMap({
      ...valid,
      rewards: { itemMetaRewardOnComplete: true },
    }, { itemLevel: 1 }));
    expect(normalized.secondaryObjectives?.[0].rewards).toEqual({ itemMetaRewardOnComplete: true });
  });
});
