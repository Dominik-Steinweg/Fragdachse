import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { DevScenarioController } from './controller';
import { registerDiagnosticMap } from '../../config/coopDefenseMaps';
import { defaultScenario } from './config';

const MAP = 'bridge-review';
const BRIDGE_ID = 'review-bridge';
const fixtures = new WeakMap<DevScenarioController, { runtime: ArenaRuntime; worldRevision: number | null; unregister: () => void }>();

/**
 * Diagnostic World: a river runs from the north edge to row 25; south of it a dry ford connects
 * both banks. One bridge crosses the river halfway, so enemies from the west reroute through the
 * ford once it fell.
 */
export function bindBridgeReview(controller: DevScenarioController, runtime: ArenaRuntime): void {
  const unregister = registerDiagnosticMap({
    mapId: MAP, arenaWidthCells: 44, arenaHeightCells: 34, timeOfDay: '12:00',
    rockFillRatio: 0, treeCount: 0, trackMode: 'none', tutorialDurationMs: 0,
    balanceReferenceDurationSec: 3600, objective: 'survive', surviveDurationSec: 3600, respawnsPerPlayer: 3,
    bases: [],
    waterAreas: [{ gridX: 20, gridY: 0, widthCells: 4, heightCells: 26 }],
    bridges: [{ id: BRIDGE_ID, axis: 'horizontal', gridX: 20, gridY: 12, spanCells: 4, deckWidthCells: 3 }],
    encounters: [], persistentSpawns: [], powerUps: [], mapEvents: [],
  });
  fixtures.set(controller, { runtime, worldRevision: null, unregister });
}

export function releaseBridgeReview(controller: DevScenarioController): void {
  fixtures.get(controller)?.unregister();
  fixtures.delete(controller);
}

/** window.devScenario.run({action:'bridgeReview', step:'start'|'cross'|'crowd'|'plant'|'collapse'|'status'}). */
export async function runBridgeReview(controller: DevScenarioController, command: Record<string, unknown>): Promise<void> {
  const fixture = fixtures.get(controller);
  if (!fixture) throw new Error('Bridge review is not bound');
  const { runtime } = fixture;
  const step = command.step ?? 'start';
  if (step === 'start') {
    const scenario = defaultScenario('dachs_nukem');
    Object.assign(scenario, { mapId: MAP, player: { gridX: 31.5, gridY: 13.5 },
      weapon1: 'GLOCK', weapon2: 'ROCKET_LAUNCHER', refillHp: true, hideAim: false });
    controller.start(scenario);
    const activeConfig = controller.config;
    const ready = await window.devScenario!.whenReady(90000);
    if (!controller.isCurrentScenario(activeConfig)) return;
    if (!ready.ok) throw new Error(ready.error);
    fixture.worldRevision = runtime.getWorldDescriptor()?.worldRevision ?? null;
    controller.aim = { gridX: 22, gridY: 13.5 };
    controller.cameraAtTarget = true;
    controller.zoom = 1.6;
    controller.setPanelCollapsed(true);
  } else {
    controller.requireReadyForBots();
    if (fixture.worldRevision !== runtime.getWorldDescriptor()?.worldRevision)
      throw new Error('Start bridgeReview in the current world first');
    switch (step) {
      case 'cross':
        // Hunters spawn on the west bank and chase the player on the east bank.
        for (const gridY of [9, 12, 15, 18]) controller.spawn('rabid-badger', false, null, { gridX: 6, gridY }, false);
        break;
      case 'crowd':
        for (const gridX of [20.6, 21.8, 23.2]) controller.spawn('rabid-badger', true, null, { gridX, gridY: 13.5 }, false);
        break;
      case 'plant':
        runtime.devScenarioPort.chargeBridge(BRIDGE_ID);
        break;
      case 'collapse':
        runtime.devScenarioPort.collapseBridge(BRIDGE_ID);
        break;
      case 'status': break;
      default: throw new Error('Unknown bridgeReview step');
    }
  }
  controller.lastAction = { bridgeReview: runtime.devScenarioPort.readBridges() };
  controller.syncPanel();
}
