import { generateArenaWithActiveMetrics } from './ArenaGeneratorTestHelper';
import { afterEach, describe, expect, it } from 'vitest';
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
import { getCoopDefenseTutorialRockRegion } from '../src/config/coopDefenseTutorial';
import { getMapTutorial, getMapTutorialStep } from '../src/i18n/contentPresentation';
import { CoopDefenseMissionProgressSystem } from '../src/systems/CoopDefenseMissionProgressSystem';
import { CoopDefenseRoundStateSystem } from '../src/systems/CoopDefenseRoundStateSystem';
import type { BaseManager } from '../src/entities/BaseManager';
import {
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
    expect(MAP.arenaWidthCells).toBe(260);
    expect(MAP.arenaHeightCells).toBe(33);
    expect(MAP.rockField).toBeDefined();
    expect(MAP.arenaWidthCells!).toBeGreaterThan(MAP.arenaHeightCells! * 7);
    expect(MAP.respawnsPerPlayer).toBe(100);
    expect(MAP.surviveDurationSec).toBeUndefined();
  });

  it('keeps the existing start tutorial window and adds one local step per learning stage', () => {
    expect(getMapTutorial('1', 'de')).toBeTruthy();
    expect(getMapTutorial('1', 'en')).toBeTruthy();
    expect(MAP.tutorialPersistent).toBe(true);
    expect(MAP.tutorialShowControls).toBe(true);
    // Das Fenster folgt dem authored Anker in den Startbereich statt in die Arenamitte.
    expect(MAP.tutorialAnchor).toEqual({ gridX: 15, gridY: 1 });

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
      expect(step.anchor, step.id).toBeDefined();
    }
  });

  it('places each step window on deterministic ordinary rock banks', () => {
    applyMapMetrics();
    const steps = resolveCoopDefenseMapTutorialSteps(MAP);
    const layout = generateArenaWithActiveMetrics(42_424, MAP);
    const trackColumns = new Set(layout.tracks.flatMap(({ gridX }) => [gridX, gridX + 1]));
    for (const step of steps) {
      const region = getCoopDefenseTutorialRockRegion(false, step.anchor);
      const rocksUnderPanel = layout.rocks.filter((rock) => (
        rock.gridX >= region.minGridX
        && rock.gridX <= region.maxGridX
        && rock.gridY >= region.minGridY
        && rock.gridY <= region.maxGridY
        && !trackColumns.has(rock.gridX)
      ));
      expect(rocksUnderPanel.length, step.id).toBeGreaterThan(0);
      expect(rocksUnderPanel.every((rock) => rock.armorDropMult === undefined), step.id).toBe(true);
    }
  });

  it('keeps every authored checkpoint core free of rocks and trees', () => {
    applyMapMetrics();
    for (const seed of [1, 42, 4242]) {
      const layout = generateArenaWithActiveMetrics(seed, MAP);
      const rocks = new Set(layout.rocks.map(({ gridX, gridY }) => `${gridX}:${gridY}`));
      const trees = new Set(layout.trees.map(({ gridX, gridY }) => `${gridX}:${gridY}`));

      for (const checkpoint of MISSION.checkpoints) {
        const centerX = checkpoint.gridX + 0.5;
        const centerY = checkpoint.gridY + 0.5;
        const radiusSq = checkpoint.radiusCells * checkpoint.radiusCells;
        for (
          let gridY = Math.max(0, Math.floor(centerY - checkpoint.radiusCells - 0.5));
          gridY <= Math.min(GRID_ROWS - 1, Math.ceil(centerY + checkpoint.radiusCells - 0.5));
          gridY += 1
        ) {
          for (
            let gridX = Math.max(0, Math.floor(centerX - checkpoint.radiusCells - 0.5));
            gridX <= Math.min(GRID_COLS - 1, Math.ceil(centerX + checkpoint.radiusCells - 0.5));
            gridX += 1
          ) {
            const dx = gridX + 0.5 - centerX;
            const dy = gridY + 0.5 - centerY;
            if (dx * dx + dy * dy > radiusSq) continue;
            expect(rocks.has(`${gridX}:${gridY}`), `${seed} ${checkpoint.id} rock`).toBe(false);
            expect(trees.has(`${gridX}:${gridY}`), `${seed} ${checkpoint.id} tree`).toBe(false);
          }
        }
      }
    }
  });

  it('keeps Map 1 authored corridors at least two grid cells wide', () => {
    const rockField = MAP.rockField!;
    const narrowestAuthoredRadius = Math.min(
      rockField.corridorRadiusCells,
      ...rockField.corridors.map((corridor) => corridor.radiusCells ?? rockField.corridorRadiusCells),
    ) - rockField.corridorRadiusVarianceCells;
    expect(narrowestAuthoredRadius).toBeGreaterThanOrEqual(1.1);
  });

  it('starts the burrow train five seconds after checkpoint 3 and repeats every ten seconds', () => {
    expect(MAP.mapEvents).toEqual([{
      id: 'burrow-train',
      type: 'train',
      start: { type: 'after-checkpoint', checkpointId: 'cp3-burrow' },
      delayMs: 5_000,
      repeatAfterExitMs: 10_000,
    }]);
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
    // Jeder erreichte Checkpoint wird zum neuen Respawn-Fokus; CP3 ist damit z. B. der
    // Wiedereinstiegspunkt für den Einbuddeln-Abschnitt.
    expect(checkpoints.filter(({ setRespawn }) => setRespawn).map(({ id }) => id)).toEqual(
      checkpoints.map(({ id }) => id),
    );
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
      const layout = generateArenaWithActiveMetrics(seed, MAP);
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
      for (const barrier of MISSION.barriers) {
        for (const cell of barrier.cells) {
          expect(rocks.has(`${cell.gridX}:${cell.gridY}`), `${seed} ${barrier.id}`).toBe(false);
        }
      }
    }
  });

  it('keeps every route stage and authored spawn area walkable', () => {
    applyMapMetrics();
    for (const seed of [1, 42, 4242]) {
      const layout = generateArenaWithActiveMetrics(seed, MAP);
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
    const barrier = MISSION.barriers.find(({ id }) => id === 'extraction-gate')!;
    expect(MISSION.barriers).toHaveLength(2);
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

  it('locks the CP4-to-CP5 route behind the ordinary rage encounter', () => {
    const barrier = MISSION.barriers.find(({ id }) => id === 'rage-gate')!;
    expect(barrier.cells).toHaveLength(MAP.arenaHeightCells);
    expect(barrier.openOn).toEqual({ type: 'after-encounter', encounterId: 'cp4-pressure' });
    expect(MISSION.mandatoryDefenses).toHaveLength(1);
    expect(MISSION.mandatoryDefenses[0].checkpointId).toBe('cp5-base-defense');
    expect(MAP.secondaryObjectives?.some((objective) => objective.id === 'cp4-pressure')).toBe(false);
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

  it('shows a tutorial step for every player from the shared checkpoint activation', () => {
    applyMapMetrics();
    const steps = resolveCoopDefenseMapTutorialSteps(MAP);
    const activatedCheckpoints = [{ checkpointId: 'cp1-adrenaline', activatedAtRoundMs: 1_000 }];

    // Keine lokale Spielerposition ist Teil der Projektion: alle Clients erhalten denselben Text.
    expect(getVisibleCoopDefenseTutorialStepId(steps, activatedCheckpoints, 999)).toBeNull();
    expect(getVisibleCoopDefenseTutorialStepId(steps, activatedCheckpoints, 1_000)).toBe('map01-adrenaline');

    // Standzeit laeuft ab; danach wird nichts mehr angezeigt.
    const durationMs = steps[0].durationMs;
    expect(getVisibleCoopDefenseTutorialStepId(steps, activatedCheckpoints, 1_000 + durationMs)).toBeNull();

    // Der naechste gemeinsame Checkpoint uebernimmt die Anzeige, sobald er aktiviert wurde.
    activatedCheckpoints.push({ checkpointId: 'cp2-utility', activatedAtRoundMs: 20_000 });
    expect(getVisibleCoopDefenseTutorialStepId(steps, activatedCheckpoints, 20_001)).toBe('map01-utility');
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
