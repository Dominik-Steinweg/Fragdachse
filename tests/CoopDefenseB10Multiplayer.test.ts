import { describe, expect, it, vi } from 'vitest';
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../src/config/coopDefenseMaps';
import { CoopDefenseCarrySystem, type CoopDefenseCarryPlayerLike } from '../src/systems/CoopDefenseCarrySystem';
import { CoopDefenseObjectivePlacementRewardSystem } from '../src/systems/CoopDefenseObjectivePlacementRewardSystem';
import { CoopDefenseSecondaryObjectiveSystem } from '../src/systems/CoopDefenseSecondaryObjectiveSystem';
import { CoopDefenseTeamBuffSystem } from '../src/systems/CoopDefenseTeamBuffSystem';
import {
  canRoundPlayerReceiveRewards,
  canRoundPlayerSpawnOrRespawn,
  createRoundParticipationState,
  enterRoundSpectator,
  getRoundResultEligibleIds,
  markRoundLateJoiner,
} from '../src/scenes/arena/RoundParticipationPolicy';

interface FakePlayer extends CoopDefenseCarryPlayerLike {
  setPosition(x: number, y: number): void;
}

function makePlayer(id: string, x = 0, y = 0): FakePlayer {
  const player = {
    id,
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

function destroyObjective(): ResolvedCoopDefenseMapSecondaryObjectiveConfig {
  return {
    id: 'destroy-brood-front',
    type: 'destroy',
    start: { type: 'time', atMs: 0 },
    targets: ['brood-a', 'brood-b'],
    targetGoal: 2,
    rewards: { xpPerTarget: 25 },
  };
}

function carryObjective(): ResolvedCoopDefenseMapSecondaryObjectiveConfig {
  return {
    id: 'carry-beer',
    type: 'carry',
    start: { type: 'time', atMs: 0 },
    targets: [],
    targetGoal: 2,
    rewards: { itemMetaRewardOnComplete: true },
    carry: {
      spawnZone: { gridX: 1, gridY: 1, widthCells: 1, heightCells: 1 },
      deliveryZone: { gridX: 10, gridY: 1, widthCells: 1, heightCells: 1 },
      itemCount: 2,
    },
  };
}

function holdObjectiveWithPedestal(): ResolvedCoopDefenseMapSecondaryObjectiveConfig {
  return {
    id: 'hold-supply-base',
    type: 'hold',
    start: { type: 'time', atMs: 0 },
    holdUntil: { type: 'time', atMs: 10_000 },
    targets: ['supply-base'],
    targetGoal: 1,
    rewards: { placeablePedestalOnComplete: { powerUpDefId: 'HOLY_HAND_GRENADE' } },
  };
}

/** Ein Host-Aufbau mit Objective- und Carry-System und einem umschaltbaren Teilnehmer-Gate. */
function makeRound(config = carryObjective()) {
  const players = [makePlayer('participant'), makePlayer('latejoiner')];
  const eligible = new Set(['participant']);
  const alive = new Set(['participant', 'latejoiner']);
  const playerManager = {
    getAllPlayers: () => players,
    getPlayer: (playerId: string) => players.find((player) => player.id === playerId),
  };

  const objectiveSystem = new CoopDefenseSecondaryObjectiveSystem([config], {
    onObjectiveActivated: (objectiveId) => carrySystem.activateObjective(objectiveId),
  });
  const carrySystem: CoopDefenseCarrySystem = new CoopDefenseCarrySystem([config], playerManager, {
    isPlayerEligible: (playerId) => eligible.has(playerId),
    isPlayerAlive: (playerId) => alive.has(playerId),
    onDelivered: (objectiveId, itemId) => objectiveSystem.reportCarryDelivered(objectiveId, itemId),
  });
  objectiveSystem.hostUpdate(0, false);
  return { players, eligible, alive, objectiveSystem, carrySystem };
}

describe('Coop Defense B10 – Teilnehmerrollen', () => {
  it('leitet Spawn- und Rewardrecht aus derselben eingefrorenen Rundenteilnahme ab', () => {
    const started = createRoundParticipationState(1_000, ['a', 'b']);
    const withLatejoiner = markRoundLateJoiner(started, 'c');
    const withSpectator = enterRoundSpectator(withLatejoiner, 'b');

    expect(canRoundPlayerSpawnOrRespawn(withSpectator, 'a')).toBe(true);
    expect(canRoundPlayerReceiveRewards(withSpectator, 'a')).toBe(true);
    // Ein nachtraeglich Beigetretener veraendert die Runde nicht und erhaelt keine B-Rewards.
    expect(canRoundPlayerSpawnOrRespawn(withSpectator, 'c')).toBe(false);
    expect(canRoundPlayerReceiveRewards(withSpectator, 'c')).toBe(false);
    // Wer die laufende Runde verlaesst, verliert die Berechtigung ebenfalls – dauerhaft.
    expect(canRoundPlayerReceiveRewards(withSpectator, 'b')).toBe(false);
    expect(getRoundResultEligibleIds(withSpectator, ['a', 'b', 'c'])).toEqual(['a']);
  });
});

describe('Coop Defense B10 – Carry unter Latejoin, Tod und Disconnect', () => {
  it('laesst einen Latejoiner ein Missionsobjekt weder aufnehmen noch abliefern', () => {
    const { players, carrySystem, objectiveSystem } = makeRound();
    const [, latejoiner] = players;
    const [item] = carrySystem.getSnapshot();

    latejoiner.setPosition(item.x, item.y);
    carrySystem.hostUpdate(true);
    expect(carrySystem.getSnapshot()[0].holderId).toBeNull();

    // Auch im Zielbereich entsteht kein Fortschritt: Der Zuschauer traegt nichts.
    latejoiner.setPosition(10 * 32 + 16, 1 * 32 + 16);
    carrySystem.hostUpdate(true);
    expect(objectiveSystem.getPresentationState()[0].progressCurrent).toBe(0);
  });

  it('gibt ein getragenes Objekt beim Rollenverlust an seinen authored Startplatz zurueck', () => {
    const { players, eligible, carrySystem } = makeRound();
    const [participant] = players;
    const [item] = carrySystem.getSnapshot();
    const spawnX = item.x;
    const spawnY = item.y;

    participant.setPosition(spawnX, spawnY);
    carrySystem.hostUpdate(true);
    expect(carrySystem.getSnapshot()[0].holderId).toBe('participant');

    participant.setPosition(spawnX + 400, spawnY + 400);
    carrySystem.hostUpdate(true);
    // Rollenwechsel mitten im Transport: Das Objekt darf weder verschwinden noch mitten im
    // Feindgebiet liegen bleiben.
    eligible.delete('participant');
    carrySystem.handlePlayerUnavailable('participant');

    const returned = carrySystem.getSnapshot();
    expect(returned).toHaveLength(2);
    expect(returned[0].holderId).toBeNull();
    expect(returned[0].x).toBe(spawnX);
    expect(returned[0].y).toBe(spawnY);
  });

  it('laesst ein bei Tod fallengelassenes Objekt liegen und wieder aufnehmbar sein', () => {
    const { players, alive, carrySystem } = makeRound();
    const [participant] = players;
    const [item] = carrySystem.getSnapshot();

    participant.setPosition(item.x, item.y);
    carrySystem.hostUpdate(true);
    expect(carrySystem.getSnapshot()[0].state).toBe('carried');

    alive.delete('participant');
    carrySystem.dropForPlayer('participant', 500, 260);
    const dropped = carrySystem.getSnapshot()[0];
    expect(dropped.state).toBe('dropped');
    expect(dropped.holderId).toBeNull();
    expect({ x: dropped.x, y: dropped.y }).toEqual({ x: 500, y: 260 });

    // Respawn an der Basis: Erst dadurch loest sich die Sperre gegen den sofortigen Rueckgriff.
    alive.add('participant');
    participant.setPosition(0, 0);
    carrySystem.hostUpdate(true);
    expect(carrySystem.getSnapshot()[0].holderId).toBeNull();

    participant.setPosition(500, 260);
    carrySystem.hostUpdate(true);
    expect(carrySystem.getSnapshot()[0].holderId).toBe('participant');
  });
});

describe('Coop Defense B10 – keine Doppelbuchung', () => {
  it('bucht ein mehrfach gemeldetes Carry-Objekt genau einmal', () => {
    const { objectiveSystem } = makeRound();
    expect(objectiveSystem.reportCarryDelivered('carry-beer', 'carry-beer:beer-0')).toBe(true);
    expect(objectiveSystem.reportCarryDelivered('carry-beer', 'carry-beer:beer-0')).toBe(false);
    expect(objectiveSystem.getEpicGuaranteeCount()).toBe(1);

    expect(objectiveSystem.reportCarryDelivered('carry-beer', 'carry-beer:beer-1')).toBe(true);
    expect(objectiveSystem.getEpicGuaranteeCount()).toBe(2);
    // Terminal: Eine weitere Meldung nach dem Abschluss darf die Garantie nicht anheben.
    expect(objectiveSystem.reportCarryDelivered('carry-beer', 'carry-beer:beer-2')).toBe(false);
    expect(objectiveSystem.getEpicGuaranteeCount()).toBe(2);
  });

  it('bucht Bonus-XP eines Destroy-Ziels nur beim ersten Zerstoerungs-Callback', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([destroyObjective()]);
    system.hostUpdate(0, false);
    system.reportTargetContribution('destroy-brood-front', 'brood-a');

    expect(system.reportTargetDestroyed('destroy-brood-front', 'brood-a')).toBe(25);
    expect(system.reportTargetDestroyed('destroy-brood-front', 'brood-a')).toBe(0);
    expect(system.getPresentationState()[0].progressCurrent).toBe(1);
  });

  it('loest den Team-Buff nur beim ersten Abschluss aus', () => {
    const teamBuff = new CoopDefenseTeamBuffSystem();
    const reward = { defId: 'TEAM_REGENERATION_SURGE' };
    expect(teamBuff.activate(reward, 1_000)).toBe(true);
    expect(teamBuff.activate(reward, 1_500)).toBe(false);
    expect(teamBuff.getBuffEndsAt()).toBe(1_000 + 30_000);
  });
});

describe('Coop Defense B10 – Reward-Eligibility', () => {
  it('bucht keine Bonus-XP fuer ein Ziel, an dem nur Nichtberechtigte mitgewirkt haben', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([destroyObjective()]);
    system.hostUpdate(0, false);

    // Kein reportTargetContribution: Der Schaden kam ausschliesslich von Spectators/Latejoinern.
    expect(system.reportTargetDestroyed('destroy-brood-front', 'brood-a')).toBe(0);
    // Der Fortschritt gehoert trotzdem der Mission – die Welt hat sich wirklich veraendert.
    expect(system.getPresentationState()[0].progressCurrent).toBe(1);

    system.reportTargetContribution('destroy-brood-front', 'brood-b');
    expect(system.reportTargetDestroyed('destroy-brood-front', 'brood-b')).toBe(25);
    expect(system.getObjectiveState('destroy-brood-front')).toBe('completed');
  });

  it('rechnet nur authored Ziele einer laufenden Mission an', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([destroyObjective()]);
    // Vor der Aktivierung existiert das Ziel spielerisch nicht.
    system.reportTargetContribution('destroy-brood-front', 'brood-a');
    system.hostUpdate(0, false);
    expect(system.reportTargetDestroyed('destroy-brood-front', 'brood-a')).toBe(0);

    system.reportTargetContribution('destroy-brood-front', 'unknown-base');
    expect(system.reportTargetDestroyed('destroy-brood-front', 'unknown-base')).toBe(0);
  });

  it('laesst nur einen berechtigten Teilnehmer die einmalige Missions-Ladung beanspruchen', () => {
    const eligible = new Set(['participant']);
    const spawnPickup = vi.fn().mockReturnValue(true);
    const releaseUtilityOverride = vi.fn();
    const rewards = new CoopDefenseObjectivePlacementRewardSystem([holdObjectiveWithPedestal()], {
      isEligiblePlayer: (playerId) => eligible.has(playerId),
      getBasePosition: () => ({ x: 320, y: 160 }),
      spawnMarker: () => true,
      removeMarker: () => {},
      spawnPickup,
      overrideUtility: () => true,
      releaseUtilityOverride,
    });

    rewards.activate('hold-supply-base');
    expect(rewards.claim('hold-supply-base', 'latejoiner')).toBe(false);
    expect(rewards.getState('hold-supply-base')).toBe('available');

    expect(rewards.claim('hold-supply-base', 'participant')).toBe(true);
    // Teamweite Ladung: Ein zweiter Anspruch auf dieselbe Ladung scheitert.
    expect(rewards.claim('hold-supply-base', 'participant')).toBe(false);

    // Disconnect vor der Platzierung: Die Ladung kehrt an ihre Missionsbasis zurueck.
    rewards.handlePlayerUnavailable('participant');
    expect(releaseUtilityOverride).toHaveBeenCalledWith('participant');
    expect(rewards.getState('hold-supply-base')).toBe('available');
    expect(rewards.getCarrierId('hold-supply-base')).toBeNull();
    expect(spawnPickup).toHaveBeenCalledTimes(2);

    // Erst die erfolgreiche Platzierung verbraucht sie – und zwar genau einmal.
    rewards.claim('hold-supply-base', 'participant');
    expect(rewards.consume('hold-supply-base', 'participant')).toBe(true);
    expect(rewards.consume('hold-supply-base', 'participant')).toBe(false);
    expect(rewards.canPlace('hold-supply-base', 'participant')).toBe(false);
  });
});
