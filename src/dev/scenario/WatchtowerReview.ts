import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { DevScenarioController } from './controller';
import { registerDiagnosticMap } from '../../config/coopDefenseMaps';
import { bridge } from '../../network/bridge';
import { defaultScenario } from './config';

const MAP = 'watchtower-review';
const TOWER = { gridX: 18, gridY: 14 };
const fixtures = new WeakMap<DevScenarioController, { runtime: ArenaRuntime; towerId: number | null; worldRevision: number | null; unregister: () => void }>();

/** Isolated review uses real reward materialization, input, AI and damage owners. */
export function bindWatchtowerReview(controller: DevScenarioController, runtime: ArenaRuntime): void {
  const unregister = registerDiagnosticMap({
    mapId: MAP, arenaWidthCells: 44, arenaHeightCells: 34, timeOfDay: '12:00',
    rockFillRatio: 0, treeCount: 0, trackMode: 'none', tutorialDurationMs: 0,
    balanceReferenceDurationSec: 3600, objective: 'survive', surviveDurationSec: 3600, respawnsPerPlayer: 3,
    bases: [],
    persistentBase: { baseId: 'review-base', anchor: { gridX: 24, gridY: 17 } },
    encounters: [], persistentSpawns: [], powerUps: [], mapEvents: [],
  });
  fixtures.set(controller, { runtime, towerId: null, worldRevision: null, unregister });
}

export function releaseWatchtowerReview(controller: DevScenarioController): void {
  fixtures.get(controller)?.unregister();
  fixtures.delete(controller);
}

/** window.devScenario.run({action:'watchtowerReview', step:'start'|'enter'|...}). */
export async function runWatchtowerReview(controller: DevScenarioController, command: Record<string, unknown>): Promise<void> {
  const fixture = fixtures.get(controller);
  if (!fixture) throw new Error('Watchtower review is not bound');
  const { runtime } = fixture;
  const step = command.step ?? 'start';
  if (step === 'start') {
    const scenario = defaultScenario('dachs_nukem');
    Object.assign(scenario, { mapId: MAP, player: { gridX: 18.5, gridY: 17 },
      weapon1: 'GLOCK', weapon2: 'ROCKET_LAUNCHER', refillHp: false, hideAim: false });
    controller.start(scenario);
    const activeConfig = controller.config;
    const ready = await window.devScenario!.whenReady(90000);
    if (!controller.isCurrentScenario(activeConfig)) return;
    if (!ready.ok) throw new Error(ready.error);
    const tower = runtime.devScenarioPort.arrangeWatchtower(TOWER.gridX, TOWER.gridY);
    fixture.towerId = tower.id;
    fixture.worldRevision = runtime.getWorldDescriptor()?.worldRevision ?? null;
    controller.aim = { gridX: 18.5, gridY: 14.5 };
    controller.cameraAtTarget = true;
    controller.zoom = 2;
    controller.setPanelCollapsed(true);
  } else {
    controller.requireReadyForBots();
    if (fixture.towerId === null || fixture.worldRevision !== runtime.getWorldDescriptor()?.worldRevision)
      throw new Error('Start watchtowerReview in the current world first');
    const state = runtime.devScenarioPort.readWatchtower(fixture.towerId);
    switch (step) {
      case 'enter':
        bridge.sendStructureOccupancyRequest({ action: 'enter', structureId: fixture.towerId });
        break;
      case 'exit':
        if (state.occupancy) bridge.sendStructureOccupancyRequest({ action: 'exit', ...state.occupancy });
        break;
      case 'hunters':
        for (const gridX of [15, 18, 21]) controller.spawn('rabid-rabbit', false, null, { gridX, gridY: 10 }, false);
        break;
      case 'damage':
      case 'collapse':
        if (!state.tower) throw new Error('Tower already destroyed; restart the review');
        runtime.devScenarioPort.damageWatchtower(fixture.towerId, state.tower.hp * (step === 'damage' ? .55 : 1));
        break;
      case 'status': break;
      default: throw new Error('Unknown watchtowerReview step');
    }
  }
  controller.lastAction = { watchtowerReview: runtime.devScenarioPort.readWatchtower(fixture.towerId!) };
  controller.syncPanel();
}
