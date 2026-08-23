import { afterEach, describe, expect, it } from 'vitest';
import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  applyArenaMetricsForMode,
} from '../src/config';
import {
  getCoopDefenseMapConfig,
  normalizeCoopDefenseMapConfig,
  resolveCoopDefenseMapEncounterConfigs,
  resolveCoopDefenseMapMissionProgress,
  resolveCoopDefenseMapTutorialSteps,
  type CoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { getMapTutorial, getMapTutorialStep } from '../src/i18n/contentPresentation';
import { CoopDefenseMissionProgressSystem } from '../src/systems/CoopDefenseMissionProgressSystem';
import { CoopDefenseRoundStateSystem } from '../src/systems/CoopDefenseRoundStateSystem';
import type { BaseManager } from '../src/entities/BaseManager';
import {
  advanceCoopDefenseTutorialSteps,
  createCoopDefenseTutorialStepState,
  getVisibleCoopDefenseTutorialStepId,
} from '../src/ui/coopDefenseTutorialStepModel';

const MAP = getCoopDefenseMapConfig('1');
const MISSION = resolveCoopDefenseMapMissionProgress(MAP)!;

function applyMapMetrics(): void {
  applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', MAP.arenaWidthCells, MAP.arenaHeightCells);
}

function worldCenterOf(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: ARENA_OFFSET_X + (gridX + 0.5) * CELL_SIZE,
    y: ARENA_OFFSET_Y + (gridY + 0.5) * CELL_SIZE,
  };
}

function emptyBaseManager(): BaseManager {
  return {
    getBases: () => [],
    getBasesByFaction: () => [],
    getTotalHp: () => 0,
    hasFaction: () => false,
    getMainBasesByFaction: () => [],
    getTotalMainBaseHp: () => 0,
  } as unknown as BaseManager;
}

describe('Map 1 as the guided advance tutorial', () => {
  afterEach(() => {
    applyArenaMetricsForMode('deathmatch', 'LOBBY');
  });

  it('is a productive advance map that is clearly larger than the old tutorial arena', () => {
    expect(MAP.objective).toBe('advance');
    expect(MAP.arenaWidthCells).toBe(160);
    expect(MAP.arenaHeightCells).toBe(44);
    // Deutlich groesser als die bisherige 60x33-Feuertaufe und laenglich statt quadratisch.
    expect(MAP.arenaWidthCells!).toBeGreaterThan(MAP.arenaHeightCells! * 3);
    expect(MAP.respawnsPerPlayer).toBe(100);
    expect(MAP.surviveDurationSec).toBeUndefined();
  });

  it('keeps the existing start tutorial window and adds one local step per learning stage', () => {
    expect(getMapTutorial('1', 'de')).toBeTruthy();
    expect(getMapTutorial('1', 'en')).toBeTruthy();
    expect(MAP.tutorialPersistent).toBe(true);
    expect(MAP.tutorialShowControls).toBe(true);
    // Das Fenster folgt dem authored Anker in den Startbereich statt in die Arenamitte.
    expect(MAP.tutorialAnchor).toEqual({ gridX: 15, gridY: 7 });

    const steps = resolveCoopDefenseMapTutorialSteps(MAP);
    expect(steps.map((step) => step.id)).toEqual([
      'map01-adrenaline',
      'map01-utility',
      'map01-burrow',
      'map01-rage',
      'map01-base-defense',
      'map01-extraction',
    ]);
    for (const step of steps) {
      expect(step.durationMs).toBeGreaterThan(0);
      expect(MISSION.checkpoints.some(({ id }) => id === step.checkpointId), step.id).toBe(true);
      expect(getMapTutorialStep(step.id, 'de'), step.id).toBeTruthy();
      expect(getMapTutorialStep(step.id, 'en'), step.id).toBeTruthy();
    }
  });

  it('orders the route from the western start area to the eastern extraction', () => {
    const checkpoints = MISSION.checkpoints;
    expect(checkpoints.map(({ id }) => id)).toEqual([
      'cp1-adrenaline',
      'cp2-utility',
      'cp3-burrow',
      'cp4-rage',
      'cp5-base-defense',
      'final-extraction',
    ]);
    expect(MISSION.startArea?.gridX).toBeLessThan(checkpoints[0].gridX);
    for (let index = 1; index < checkpoints.length; index += 1) {
      expect(checkpoints[index].gridX, checkpoints[index].id)
        .toBeGreaterThan(checkpoints[index - 1].gridX);
    }
    // Nur CP4 muss den Respawn-Fokus setzen; alles davor bleibt der authored Startbereich.
    expect(checkpoints.filter(({ setRespawn }) => setRespawn).map(({ id }) => id)).toEqual(['cp4-rage']);
  });

  it('authors both learning walls as ordinary destructible rock, one cell thick', () => {
    expect(MAP.rockWalls?.map((wall) => wall.id)).toEqual(['utility-wall', 'burrow-wall']);
    for (const wall of MAP.rockWalls ?? []) {
      expect(wall.widthCells, wall.id).toBe(1);
      expect(wall.heightCells, wall.id).toBe(MAP.arenaHeightCells);
    }
    // Jede Wand liegt hinter ihrem Lern-Checkpoint und vor dem naechsten.
    const checkpointX = Object.fromEntries(MISSION.checkpoints.map((cp) => [cp.id, cp.gridX]));
    const [utilityWall, burrowWall] = MAP.rockWalls!;
    expect(utilityWall.gridX).toBeGreaterThan(checkpointX['cp2-utility']);
    expect(utilityWall.gridX).toBeLessThan(checkpointX['cp3-burrow']);
    expect(burrowWall.gridX).toBeGreaterThan(checkpointX['cp3-burrow']);
    expect(burrowWall.gridX).toBeLessThan(checkpointX['cp4-rage']);
  });

  it('stamps the authored walls as complete rock bands without cutting them open again', () => {
    applyMapMetrics();
    for (const seed of [1, 42, 4242]) {
      const layout = ArenaGenerator.generate(seed, MAP);
      const rocks = new Set(layout.rocks.map((rock) => `${rock.gridX}:${rock.gridY}`));
      for (const wall of MAP.rockWalls ?? []) {
        for (let gridY = 0; gridY < GRID_ROWS; gridY += 1) {
          expect(rocks.has(`${wall.gridX}:${gridY}`), `${seed} ${wall.id} ${gridY}`).toBe(true);
        }
      }
      // Die Waende sind gewoehnliche Felsen: kein Tutorial-Armor-Marker, kein Sonderstatus.
      const wallColumns = new Set((MAP.rockWalls ?? []).map((wall) => wall.gridX));
      for (const rock of layout.rocks) {
        if (!wallColumns.has(rock.gridX)) continue;
        expect(rock.armorDropMult).toBeUndefined();
      }
      // Reservierte Barrierezellen bleiben frei von generiertem Fels.
      for (const cell of MISSION.barriers[0].cells) {
        expect(rocks.has(`${cell.gridX}:${cell.gridY}`), `${seed} barrier`).toBe(false);
      }
    }
  });

  it('keeps every route stage and authored spawn area walkable', () => {
    applyMapMetrics();
    for (const seed of [1, 42, 4242]) {
      const layout = ArenaGenerator.generate(seed, MAP);
      const blocked = new Set<string>([
        ...layout.rocks.map((rock) => `${rock.gridX}:${rock.gridY}`),
        ...layout.trees.map((tree) => `${tree.gridX}:${tree.gridY}`),
      ]);
      const countFree = (
        minGridX: number,
        minGridY: number,
        widthCells: number,
        heightCells: number,
      ): number => {
        let free = 0;
        for (let gridY = Math.max(0, minGridY); gridY < Math.min(GRID_ROWS, minGridY + heightCells); gridY += 1) {
          for (let gridX = Math.max(0, minGridX); gridX < Math.min(GRID_COLS, minGridX + widthCells); gridX += 1) {
            if (!blocked.has(`${gridX}:${gridY}`)) free += 1;
          }
        }
        return free;
      };

      const start = MISSION.startArea!;
      expect(countFree(
        start.gridX - start.radiusCells,
        start.gridY - start.radiusCells,
        start.radiusCells * 2 + 1,
        start.radiusCells * 2 + 1,
      ), `${seed} start`).toBeGreaterThan(20);

      for (const checkpoint of MISSION.checkpoints) {
        expect(countFree(
          checkpoint.gridX - checkpoint.radiusCells,
          checkpoint.gridY - checkpoint.radiusCells,
          checkpoint.radiusCells * 2 + 1,
          checkpoint.radiusCells * 2 + 1,
        ), `${seed} ${checkpoint.id}`).toBeGreaterThan(8);
      }

      for (const encounter of MAP.encounters ?? []) {
        for (const group of encounter.groups) {
          const area = group.spawnArea!;
          expect(countFree(area.gridX, area.gridY, area.widthCells, area.heightCells), `${seed} ${encounter.id}`)
            .toBeGreaterThan(10);
        }
      }
    }
  });

  it('spawns every encounter from an authored area instead of an arena-wide front band', () => {
    const groups = resolveCoopDefenseMapEncounterConfigs(MAP, 1).flatMap((encounter) => encounter.groups);
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.spawnArea).toBeDefined();
      expect(group.spawnArea!.gridX + group.spawnArea!.widthCells).toBeLessThanOrEqual(MAP.arenaWidthCells!);
      expect(group.spawnArea!.gridY + group.spawnArea!.heightCells).toBeLessThanOrEqual(MAP.arenaHeightCells!);
    }
  });

  it('runs the CP5 defence as two waves against a very tough friendly outpost', () => {
    const outpost = MAP.bases.find((base) => base.id === 'tutorial-outpost');
    expect(outpost?.role).toBe('outpost');
    expect(outpost?.dormant).toBe(true);
    expect(outpost?.faction ?? 'friendly').not.toBe('hostile');
    // Sehr hohe, aber ganz normale HP – keine Unverwundbarkeit als Tutorial-Sonderregel.
    expect(outpost!.hpMax).toBeGreaterThanOrEqual(10_000);

    const waveIds = (MAP.encounters ?? [])
      .filter((encounter) => encounter.id.startsWith('cp5-'))
      .map((encounter) => encounter.id);
    expect(waveIds).toEqual(['cp5-wave-1', 'cp5-wave-2']);
    const waveOne = MAP.encounters!.find((encounter) => encounter.id === 'cp5-wave-1')!;
    const waveTwo = MAP.encounters!.find((encounter) => encounter.id === 'cp5-wave-2')!;
    expect(waveOne.start).toEqual({ type: 'after-checkpoint', checkpointId: 'cp5-base-defense' });
    expect(waveTwo.start).toEqual({ type: 'after-encounter', encounterId: 'cp5-wave-1' });
    // Welle 2 ist merklich groesser und startet nach einer kurzen Pause.
    const sizeOf = (encounter: typeof waveOne): number => encounter.groups
      .reduce((sum, group) => sum + group.count, 0);
    expect(sizeOf(waveTwo)).toBeGreaterThan(sizeOf(waveOne));
    expect(Math.min(...waveTwo.groups.map((group) => group.delayMs ?? 0))).toBeGreaterThan(0);
  });

  it('locks the extraction route behind the completed two-wave defence', () => {
    const barrier = MISSION.barriers[0];
    expect(MISSION.barriers).toHaveLength(1);
    expect(barrier.openOn).toEqual({ type: 'after-encounter', encounterId: 'cp5-wave-2' });
    expect(barrier.cells).toHaveLength(MAP.arenaHeightCells);
    const extraction = MISSION.checkpoints[MISSION.checkpoints.length - 1];
    expect(barrier.cells.every((cell) => cell.gridX < extraction.gridX)).toBe(true);
    expect(barrier.cells.every((cell) => cell.gridX > MISSION.checkpoints[4].gridX)).toBe(true);

    const defense = MISSION.mandatoryDefenses[0];
    expect(MISSION.mandatoryDefenses).toHaveLength(1);
    expect(defense.checkpointId).toBe('cp5-base-defense');
    expect(defense.failureEndsMission).toBe(true);
    const hold = MAP.secondaryObjectives?.find((objective) => objective.id === defense.objectiveId);
    expect(hold?.type).toBe('hold');
    expect(hold?.holdUntil).toEqual({ type: 'after-encounter', encounterId: 'cp5-wave-2' });
    expect(hold?.targets).toEqual(['tutorial-outpost']);
  });

  it('opens the barrier only once the second wave is cleared', () => {
    const cleared = new Set<string>();
    const system = new CoopDefenseMissionProgressSystem(MISSION, {
      roundRevision: 1,
      getDefenseObjectiveState: () => null,
      isEncounterCleared: (encounterId) => cleared.has(encounterId),
    });
    system.hostUpdate(16, false, []);
    expect(system.isBarrierOpen('extraction-gate')).toBe(false);

    cleared.add('cp5-wave-1');
    system.hostUpdate(16, false, []);
    expect(system.isBarrierOpen('extraction-gate')).toBe(false);

    cleared.add('cp5-wave-2');
    system.hostUpdate(16, false, []);
    expect(system.isBarrierOpen('extraction-gate')).toBe(true);
  });

  it('ends the mission when the authored mandatory defence fails', () => {
    let objectiveState: 'active' | 'completed' | 'failed' = 'active';
    const system = new CoopDefenseMissionProgressSystem(MISSION, {
      roundRevision: 1,
      getDefenseObjectiveState: () => objectiveState,
      isEncounterCleared: () => false,
    });
    applyMapMetrics();
    const start = worldCenterOf(MISSION.startArea!.gridX, MISSION.startArea!.gridY);
    system.resetPlayerPosition('p1', start.x, start.y);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...start, eligible: true }]);
    for (const checkpoint of MISSION.checkpoints.slice(0, 5)) {
      const point = worldCenterOf(checkpoint.gridX, checkpoint.gridY);
      system.hostUpdate(16, false, [{ playerId: 'p1', ...point, eligible: true }]);
    }
    expect(system.isCheckpointActivated('cp5-base-defense')).toBe(true);
    expect(system.isMissionFailed()).toBe(false);

    objectiveState = 'failed';
    system.hostUpdate(16, false, []);
    expect(system.isMissionFailed()).toBe(true);

    const roundState = new CoopDefenseRoundStateSystem({
      baseManager: emptyBaseManager(),
      objective: 'advance',
      getSecondsLeft: () => 0,
      isAdvanceComplete: () => true,
      isAdvanceFailed: () => true,
    });
    // Die Niederlage hat auch dann Vorrang, wenn die Route im selben Tick fertig gemeldet wird.
    expect(roundState.update()).toBe('defeat');
  });

  it('leaves an unflagged mandatory defence on the existing resolved-is-enough semantics', () => {
    const system = new CoopDefenseMissionProgressSystem({
      ...MISSION,
      mandatoryDefenses: MISSION.mandatoryDefenses.map((defense) => ({
        ...defense,
        failureEndsMission: false,
      })),
    }, {
      roundRevision: 1,
      getDefenseObjectiveState: () => 'failed',
      isEncounterCleared: () => false,
    });
    applyMapMetrics();
    const point = worldCenterOf(MISSION.checkpoints[4].gridX, MISSION.checkpoints[4].gridY);
    system.resetPlayerPosition('p1', point.x, point.y);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...point, eligible: true }]);
    system.hostUpdate(16, false, [{ playerId: 'p1', ...point, eligible: true }]);
    expect(system.isMissionFailed()).toBe(false);
  });

  it('shows each local tutorial step once and only for the player who reaches the checkpoint', () => {
    applyMapMetrics();
    const steps = resolveCoopDefenseMapTutorialSteps(MAP);
    const input = { steps, checkpoints: MISSION.checkpoints };
    let state = createCoopDefenseTutorialStepState();

    const away = worldCenterOf(MISSION.startArea!.gridX, MISSION.startArea!.gridY);
    state = advanceCoopDefenseTutorialSteps(state, { ...input, localPlayer: away, nowMs: 0 });
    expect(getVisibleCoopDefenseTutorialStepId(state, 0)).toBeNull();

    const atCp1 = worldCenterOf(MISSION.checkpoints[0].gridX, MISSION.checkpoints[0].gridY);
    state = advanceCoopDefenseTutorialSteps(state, { ...input, localPlayer: atCp1, nowMs: 1_000 });
    expect(getVisibleCoopDefenseTutorialStepId(state, 1_000)).toBe('map01-adrenaline');

    // Standzeit laeuft ab; danach wird nichts mehr angezeigt.
    const durationMs = steps[0].durationMs;
    state = advanceCoopDefenseTutorialSteps(state, {
      ...input,
      localPlayer: null,
      nowMs: 1_000 + durationMs,
    });
    expect(getVisibleCoopDefenseTutorialStepId(state, 1_000 + durationMs)).toBeNull();

    // Erneutes Betreten desselben Checkpoints wiederholt den Hinweis nicht.
    state = advanceCoopDefenseTutorialSteps(state, {
      ...input,
      localPlayer: atCp1,
      nowMs: 60_000,
    });
    expect(getVisibleCoopDefenseTutorialStepId(state, 60_000)).toBeNull();

    // Eine neue Runde beginnt mit frischem lokalem Zustand.
    const freshRound = advanceCoopDefenseTutorialSteps(createCoopDefenseTutorialStepState(), {
      ...input,
      localPlayer: atCp1,
      nowMs: 0,
    });
    expect(getVisibleCoopDefenseTutorialStepId(freshRound, 0)).toBe('map01-adrenaline');
  });

  it('rejects tutorial steps and spawn areas that the map cannot back', () => {
    const base = {
      mapId: 'advance-authoring-test',
      arenaWidthCells: 40,
      arenaHeightCells: 33,
      objective: 'advance',
      respawnsPerPlayer: 1,
      balanceReferenceDurationSec: 60,
      bases: [],
      powerUps: [],
      missionProgress: { checkpoints: [{ id: 'gate', gridX: 5, gridY: 5 }] },
    } as unknown as CoopDefenseMapConfig;

    expect(() => normalizeCoopDefenseMapConfig(base)).not.toThrow();
    expect(() => normalizeCoopDefenseMapConfig({
      ...base,
      tutorialSteps: [{ id: 'step', checkpointId: 'missing' }],
    })).toThrow(/unknown checkpoint/);
    expect(() => normalizeCoopDefenseMapConfig({
      ...base,
      tutorialSteps: [{ id: 'step', checkpointId: 'gate' }, { id: 'step', checkpointId: 'gate' }],
    })).toThrow(/Duplicate tutorial step id/);
    expect(() => normalizeCoopDefenseMapConfig({
      ...base,
      rockWalls: [{ id: 'wall', gridX: 400, gridY: 0, widthCells: 4, heightCells: 4 }],
    })).toThrow(/outside the arena/);
    expect(() => normalizeCoopDefenseMapConfig({
      ...base,
      encounters: [{
        id: 'wave',
        start: { type: 'after-checkpoint', checkpointId: 'gate' },
        groups: [{
          enemyKind: 'zombie-badger',
          count: 1,
          front: 'west',
          spawnArea: { gridX: 0, gridY: 0, widthCells: 4, heightCells: 4 },
        }],
      }],
    } as unknown as CoopDefenseMapConfig)).toThrow(/must not combine front and spawnArea/);
    expect(() => normalizeCoopDefenseMapConfig({
      ...base,
      encounters: [{
        id: 'wave',
        start: { type: 'after-checkpoint', checkpointId: 'gate' },
        groups: [{
          enemyKind: 'zombie-badger',
          count: 1,
          spawnArea: { gridX: 400, gridY: 0, widthCells: 8, heightCells: 4 },
        }],
      }],
    } as unknown as CoopDefenseMapConfig)).toThrow(/out-of-bounds spawnArea/);
  });
});
