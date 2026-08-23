import { describe, expect, it } from 'vitest';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';
import {
  normalizeCoopDefenseMapConfig,
  type CoopBaseFaction,
  type CoopDefenseMapConfig,
  type ResolvedCoopDefenseMapMissionProgressConfig,
} from '../src/config/coopDefenseMaps';
import type { BaseManager } from '../src/entities/BaseManager';
import { isRoundTeamPermanentlyDown } from '../src/scenes/arena/RoundParticipationPolicy';
import { CoopDefenseMissionProgressSystem } from '../src/systems/CoopDefenseMissionProgressSystem';
import { CoopDefenseRoundStateSystem } from '../src/systems/CoopDefenseRoundStateSystem';
import type { RoundParticipationState } from '../src/types';
import { buildCoopDefenseLifeStatusViewModel } from '../src/ui/coopDefenseLifeStatusModel';
import { buildMainObjectiveViewModel } from '../src/ui/coopDefenseMainObjectiveModel';

function createBaseManager(friendlyHp: readonly number[]): BaseManager {
  const bases = friendlyHp.map((hp) => ({ hp, faction: 'friendly' as CoopBaseFaction }));
  return {
    getBases: () => bases.map((base) => ({ getHp: () => base.hp })),
    getBasesByFaction: (faction: CoopBaseFaction) => bases
      .filter((base) => base.faction === faction)
      .map((base) => ({ getHp: () => base.hp })),
    getTotalHp: () => bases.reduce((sum, base) => sum + base.hp, 0),
    hasFaction: (faction: CoopBaseFaction) => bases.some((base) => base.faction === faction),
    getMainBasesByFaction: (faction: CoopBaseFaction) => bases
      .filter((base) => base.faction === faction)
      .map((base, index) => ({ id: `${faction}-${index}`, getHp: () => base.hp })),
    getTotalMainBaseHp: (faction: CoopBaseFaction) => bases
      .filter((base) => base.faction === faction)
      .reduce((sum, base) => sum + base.hp, 0),
  } as unknown as BaseManager;
}

function advanceRoundState(options: {
  readonly routeComplete?: boolean;
  readonly teamDefeated?: boolean;
  readonly friendlyHp?: readonly number[];
}): CoopDefenseRoundStateSystem {
  return new CoopDefenseRoundStateSystem({
    baseManager: createBaseManager(options.friendlyHp ?? []),
    objective: 'advance',
    getSecondsLeft: () => 0,
    isAdvanceComplete: () => options.routeComplete === true,
    isAdvanceTeamDefeated: () => options.teamDefeated === true,
  });
}

describe('advance round state', () => {
  it('never loses through a missing or destroyed friendly main base', () => {
    expect(advanceRoundState({}).update()).toBeNull();
    expect(advanceRoundState({ friendlyHp: [0] }).update()).toBeNull();
    expect(advanceRoundState({ friendlyHp: [0], routeComplete: true }).update()).toBe('victory');
  });

  it('wins as soon as the route is complete', () => {
    expect(advanceRoundState({ routeComplete: true }).update()).toBe('victory');
  });

  it('keeps running while nobody is alive but a regular respawn is still allowed', () => {
    expect(advanceRoundState({ teamDefeated: false }).update()).toBeNull();
  });

  it('loses once no relevant participant is alive or able to return', () => {
    expect(advanceRoundState({ teamDefeated: true }).update()).toBe('defeat');
  });

  it('prefers the final defeat when both signals arrive in the same host tick', () => {
    expect(advanceRoundState({ teamDefeated: true, routeComplete: true }).update()).toBe('defeat');
  });

  it('concludes only once', () => {
    const system = advanceRoundState({ routeComplete: true });
    expect(system.update()).toBe('victory');
    expect(system.update()).toBeNull();
  });
});

describe('advance team defeat policy', () => {
  const participation: RoundParticipationState = {
    roundStartTime: 1,
    roundRevision: 1,
    participantIds: ['a', 'b'],
    spectatorIds: [],
  };
  const connected = ['a', 'b', 'late'];

  it('is false while at least one participant lives', () => {
    expect(isRoundTeamPermanentlyDown(
      participation,
      connected,
      (id) => id === 'a',
      () => false,
    )).toBe(false);
  });

  it('is false for a momentary wipe with respawns still allowed', () => {
    expect(isRoundTeamPermanentlyDown(participation, connected, () => false, () => true)).toBe(false);
  });

  it('is true once nobody lives and nobody may respawn', () => {
    expect(isRoundTeamPermanentlyDown(participation, connected, () => false, () => false)).toBe(true);
  });

  it('ignores late joiners and disconnected participants', () => {
    // Der Late Joiner lebt, ist aber kein Teilnehmer und verhindert die Niederlage deshalb nicht.
    expect(isRoundTeamPermanentlyDown(
      participation,
      connected,
      (id) => id === 'late',
      () => false,
    )).toBe(true);
    // Ein dauerhaft getrennter Teilnehmer blockiert die Pruefung nicht.
    expect(isRoundTeamPermanentlyDown(
      participation,
      ['a'],
      () => false,
      () => false,
    )).toBe(true);
  });

  it('ignores participants that were switched to spectator', () => {
    expect(isRoundTeamPermanentlyDown(
      { ...participation, spectatorIds: ['b'] },
      connected,
      (id) => id === 'b',
      () => false,
    )).toBe(true);
  });
});

function world(gridX: number, gridY = 2): { x: number; y: number } {
  return {
    x: ARENA_OFFSET_X + (gridX + 0.5) * CELL_SIZE,
    y: ARENA_OFFSET_Y + (gridY + 0.5) * CELL_SIZE,
  };
}

function route(): ResolvedCoopDefenseMapMissionProgressConfig {
  return {
    checkpoints: [
      { id: 'entry', gridX: 2, gridY: 2, radiusCells: 0.25, setRespawn: false },
      { id: 'camp', gridX: 5, gridY: 2, radiusCells: 0.25, setRespawn: true },
      { id: 'extraction', gridX: 8, gridY: 2, radiusCells: 0.25, setRespawn: false },
    ],
    mandatoryDefenses: [{ id: 'hold-camp', checkpointId: 'camp', objectiveId: 'hold-objective' }],
    barriers: [],
  };
}

describe('advance extraction', () => {
  it('completes the route only at the final checkpoint and only for a living participant', () => {
    const system = new CoopDefenseMissionProgressSystem(route(), {
      roundRevision: 1,
      getDefenseObjectiveState: () => 'completed',
    });

    // Ein toter oder als Spectator gefuehrter Spieler ist nicht berechtigt und extrahiert nicht.
    system.hostUpdate(0, false, [{ playerId: 'dead', ...world(0), eligible: false }]);
    system.hostUpdate(16, false, [{ playerId: 'dead', ...world(10), eligible: false }]);
    expect(system.isRouteComplete()).toBe(false);

    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(0), eligible: true }]);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(6), eligible: true }]);
    expect(system.isCheckpointActivated('camp')).toBe(true);
    expect(system.isCheckpointActivated('extraction')).toBe(false);
    expect(system.isRouteComplete()).toBe(false);

    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(9), eligible: true }]);
    expect(system.isRouteComplete()).toBe(true);
  });

  it('lets a single living player extract while the rest of the team is down', () => {
    const system = new CoopDefenseMissionProgressSystem(route(), {
      roundRevision: 1,
      getDefenseObjectiveState: () => 'completed',
    });
    const downed = { playerId: 'downed', ...world(0), eligible: false };
    system.hostUpdate(0, false, [{ playerId: 'runner', ...world(0), eligible: true }, downed]);
    system.hostUpdate(16, false, [{ playerId: 'runner', ...world(6), eligible: true }, downed]);
    // Die Mandatory Defense loest im Folgetick terminal auf und gibt die Route frei.
    system.hostUpdate(16, false, [{ playerId: 'runner', ...world(6), eligible: true }, downed]);
    system.hostUpdate(16, false, [{ playerId: 'runner', ...world(9), eligible: true }, downed]);

    expect(system.isRouteComplete()).toBe(true);
  });

  it('keeps an unresolved mandatory defense from unlocking the extraction', () => {
    let defenseState: 'dormant' | 'active' | 'completed' = 'active';
    const system = new CoopDefenseMissionProgressSystem(route(), {
      roundRevision: 1,
      getDefenseObjectiveState: () => defenseState,
    });
    system.hostUpdate(0, false, [{ playerId: 'p1', ...world(0), eligible: true }]);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(10), eligible: true }]);

    expect(system.isCheckpointActivated('camp')).toBe(true);
    expect(system.isCheckpointActivated('extraction')).toBe(false);
    expect(system.isRouteComplete()).toBe(false);

    defenseState = 'completed';
    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(10), eligible: true }]);
    expect(system.isRouteComplete()).toBe(false);

    const beforeExtraction = world(7);
    system.resetPlayerPosition('p1', beforeExtraction.x, beforeExtraction.y);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...beforeExtraction, eligible: true }]);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(9), eligible: true }]);
    expect(system.isRouteComplete()).toBe(true);
  });
});

describe('advance respawn focus', () => {
  it('keeps the normal spawn fallback until a setRespawn checkpoint activates', () => {
    const system = new CoopDefenseMissionProgressSystem(route(), {
      roundRevision: 1,
      getDefenseObjectiveState: () => 'completed',
    });
    expect(system.getRespawnCheckpointId()).toBeNull();

    system.hostUpdate(0, false, [{ playerId: 'p1', ...world(0), eligible: true }]);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(3), eligible: true }]);
    // `entry` fuehrt kein setRespawn und veraendert den Fokus deshalb nicht.
    expect(system.isCheckpointActivated('entry')).toBe(true);
    expect(system.getRespawnCheckpointId()).toBeNull();

    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(6), eligible: true }]);
    expect(system.getRespawnCheckpointId()).toBe('camp');
  });

  it('replaces an earlier respawn checkpoint with a later one', () => {
    const twoRespawns: ResolvedCoopDefenseMapMissionProgressConfig = {
      checkpoints: [
        { id: 'first', gridX: 2, gridY: 2, radiusCells: 0.25, setRespawn: true },
        { id: 'second', gridX: 5, gridY: 2, radiusCells: 0.25, setRespawn: true },
      ],
      mandatoryDefenses: [],
      barriers: [],
    };
    const system = new CoopDefenseMissionProgressSystem(twoRespawns, {
      roundRevision: 1,
      getDefenseObjectiveState: () => null,
    });
    system.hostUpdate(0, false, [{ playerId: 'p1', ...world(0), eligible: true }]);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(3), eligible: true }]);
    expect(system.getRespawnCheckpointId()).toBe('first');

    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(6), eligible: true }]);
    expect(system.getRespawnCheckpointId()).toBe('second');
  });

  it('keeps mission progress across death and respawn without activating a checkpoint', () => {
    const system = new CoopDefenseMissionProgressSystem(route(), {
      roundRevision: 1,
      getDefenseObjectiveState: () => 'completed',
    });
    system.hostUpdate(0, false, [{ playerId: 'p1', ...world(0), eligible: true }]);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(6), eligible: true }]);
    // Erst nach der terminalen Defense-Aufloesung steht der Missionszustand still.
    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(6), eligible: true }]);
    const progressBefore = system.getPresentationState();
    expect(progressBefore.respawnCheckpointId).toBe('camp');

    // Tod: der Spieler faellt aus den berechtigten Samples und der Fortschritt bleibt stehen.
    system.hostUpdate(16, false, [{ playerId: 'p1', ...world(6), eligible: false }]);
    // Respawn am Checkpoint: Positionshistorie zuruecksetzen, kein Fortschritt aus dem Sprung.
    const respawn = world(5);
    system.resetPlayerPosition('p1', respawn.x, respawn.y);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...respawn, eligible: true }]);

    expect(system.getPresentationState()).toMatchObject({
      missionRevision: progressBefore.missionRevision,
      respawnCheckpointId: 'camp',
      nextCheckpointId: 'extraction',
      routeComplete: false,
    });
    expect(system.isCheckpointActivated('entry')).toBe(true);
    expect(system.isCheckpointActivated('camp')).toBe(true);
    expect(system.isCheckpointActivated('extraction')).toBe(false);
  });

  it('does not let a respawn teleport cross a pending checkpoint', () => {
    const system = new CoopDefenseMissionProgressSystem(route(), {
      roundRevision: 1,
      getDefenseObjectiveState: () => 'completed',
    });
    system.hostUpdate(0, false, [{ playerId: 'p1', ...world(0), eligible: true }]);
    const forward = world(9);
    system.resetPlayerPosition('p1', forward.x, forward.y);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...forward, eligible: true }]);

    expect(system.isCheckpointActivated('entry')).toBe(false);
    expect(system.isRouteComplete()).toBe(false);
  });
});

function makeAdvanceMap(overrides: Partial<CoopDefenseMapConfig> = {}): CoopDefenseMapConfig {
  return {
    mapId: 'advance-test',
    displayName: 'Advance test',
    arenaWidthCells: 60,
    arenaHeightCells: 34,
    balanceReferenceDurationSec: 60,
    objective: 'advance',
    bases: [],
    powerUps: [],
    missionProgress: {
      checkpoints: [
        { id: 'entry', gridX: 4, gridY: 4, radiusCells: 1 },
        { id: 'extraction', gridX: 40, gridY: 4, radiusCells: 2, setRespawn: true },
      ],
    },
    ...overrides,
  };
}

describe('advance map validation', () => {
  it('accepts an advance map without any friendly main base', () => {
    const normalized = normalizeCoopDefenseMapConfig(makeAdvanceMap());
    expect(normalized.objective).toBe('advance');
    expect(normalized.bases).toHaveLength(0);
    expect(normalized.missionProgress?.checkpoints).toHaveLength(2);
    expect(normalized.surviveDurationSec).toBeUndefined();
    expect(normalized.surviveRespawnsPerPlayer).toBeUndefined();
  });

  it('rejects an advance map without missionProgress', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeAdvanceMap({ missionProgress: undefined })))
      .toThrow(/needs missionProgress with at least one checkpoint/);
  });

  it('rejects an advance map without checkpoints', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeAdvanceMap({ missionProgress: { checkpoints: [] } })))
      .toThrow(/needs at least one checkpoint/);
  });

  it('rejects an advance-specific respawn or survival configuration', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeAdvanceMap({ surviveRespawnsPerPlayer: 2 })))
      .toThrow(/Only survive maps may declare surviveRespawnsPerPlayer/);
    expect(() => normalizeCoopDefenseMapConfig(makeAdvanceMap({ surviveDurationSec: 120 })))
      .toThrow(/Only survive maps may declare surviveDurationSec/);
  });

  it('keeps the Block B reference validation active on advance maps', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeAdvanceMap({
      missionProgress: {
        checkpoints: [{ id: 'entry', gridX: 4, gridY: 4 }],
        barriers: [{
          id: 'gate',
          cells: [{ gridX: 6, gridY: 4 }],
          openOn: { type: 'after-checkpoint', checkpointId: 'missing' },
        }],
      },
    }))).toThrow(/references unknown checkpoint/);
  });

  it('does not require encounters on an advance map', () => {
    expect(() => normalizeCoopDefenseMapConfig(makeAdvanceMap({ encounters: [] }))).not.toThrow();
  });
});

describe('advance presentation', () => {
  const baseInput = {
    mapId: 'advance-test',
    objective: 'advance' as const,
    elapsedMs: 0,
    encounterCount: 0,
    encounter: null,
    boss: null,
    hostileBases: null,
  };

  it('shows the advance title with the checkpoint progress', () => {
    const model = buildMainObjectiveViewModel({
      ...baseInput,
      advance: { activatedCheckpoints: 3, totalCheckpoints: 6, routeComplete: false },
    });
    expect(model.title).toBe('VORSTOSS');
    expect(model.progressLabel).toBe('3 / 6');
    expect(model.progress).toBeCloseTo(0.5);
  });

  it('names the extraction once the final checkpoint is the remaining one', () => {
    expect(buildMainObjectiveViewModel({
      ...baseInput,
      advance: { activatedCheckpoints: 5, totalCheckpoints: 6, routeComplete: false },
    }).progressLabel).toBe('5 / 6 · EXTRAKTION');
    expect(buildMainObjectiveViewModel({
      ...baseInput,
      advance: { activatedCheckpoints: 6, totalCheckpoints: 6, routeComplete: true },
    }).progressLabel).toBe('6 / 6 · EXTRAKTION');
  });

  it('stays readable before the first mission snapshot arrives', () => {
    const model = buildMainObjectiveViewModel({ ...baseInput, advance: null });
    expect(model.title).toBe('VORSTOSS');
    expect(model.progress).toBe(0);
  });

  it('communicates the checkpoint respawn instead of an elimination state', () => {
    const dead = buildCoopDefenseLifeStatusViewModel({
      objective: 'advance',
      survival: null,
      missionRespawnActive: true,
      alive: false,
      canRespawn: true,
    });
    expect(dead?.text).toBe('RESPAWN AM LETZTEN CHECKPOINT');

    expect(buildCoopDefenseLifeStatusViewModel({
      objective: 'advance',
      survival: null,
      missionRespawnActive: true,
      alive: true,
      canRespawn: true,
    })).toBeNull();
    // Ohne aktivierten Missions-Checkpoint greift der normale Spawn-Fallback ohne Zusatztext.
    expect(buildCoopDefenseLifeStatusViewModel({
      objective: 'advance',
      survival: null,
      missionRespawnActive: false,
      alive: false,
      canRespawn: true,
    })).toBeNull();
  });

  it('keeps the survival respawn budget untouched', () => {
    expect(buildCoopDefenseLifeStatusViewModel({
      objective: 'survive',
      survival: { remainingRespawns: 2, alive: true, eliminated: false },
      missionRespawnActive: false,
      alive: true,
      canRespawn: true,
    })).toEqual({ text: 'RESPAWNS: 2', color: '#ffd166' });
    expect(buildCoopDefenseLifeStatusViewModel({
      objective: 'survive',
      survival: { remainingRespawns: 0, alive: false, eliminated: true },
      missionRespawnActive: false,
      alive: false,
      canRespawn: false,
    })).toEqual({ text: 'AUSGESCHIEDEN', color: '#ff5555' });
  });
});
