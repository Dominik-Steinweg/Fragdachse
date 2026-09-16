import { FlowFieldCoordinator } from '../src/systems/flowfield/FlowFieldCoordinator';
import { InlineFlowFieldRunner } from '../src/systems/flowfield/FlowFieldRunner';
import { createFlowFieldTuning } from '../src/systems/flowfield/FlowFieldSources';
import { EnemyFlowFieldService } from '../src/systems/EnemyFlowFieldService';
import { EnemyAiTargetCatalog } from '../src/systems/EnemyAiTargetCatalog';
import { EnemyIntentSystem } from '../src/systems/navigation/EnemyIntentSystem';
import { NavigationGeometry, type NavigationObstacle } from '../src/systems/navigation/NavigationGeometry';
import type { FlowFieldBaseDescriptor } from '../src/systems/flowfield/FlowFieldKernel';

export function navigationTestWorld(obstacles: NavigationObstacle[] = [], bases: FlowFieldBaseDescriptor[] = [], radius = 15) {
  const metrics = { cols: 17, rows: 17, cellSize: 16, pointOffset: 0, arenaOffsetX: 0, arenaOffsetY: 0 };
  const snapshot = { left: 0, top: 0, right: 256, bottom: 256, obstacles };
  const runner = new InlineFlowFieldRunner();
  const coordinator = new FlowFieldCoordinator({ metrics, tuning: createFlowFieldTuning(), staticKind: new Uint8Array(17 * 17),
    bases, activeBaseIds: new Set(bases.map(b => b.id)), obstacleCellProvider: () => [], runner,
    geometryProvider: () => snapshot, navTickIntervalMs: 100, generationId: 17 });
  const field = EnemyFlowFieldService.fromView(coordinator.registerField('test', { goalMode: 'dynamic', bodyRadius: radius }));
  const catalog = new EnemyAiTargetCatalog(), intents = new EnemyIntentSystem(coordinator, catalog);
  return { metrics, snapshot, runner, coordinator, field, catalog, intents,
    geometry: () => new NavigationGeometry(snapshot),
    goal: (x: number, y: number) => coordinator.setGoalCells('test', [y / 16 * metrics.cols + x / 16]),
    flush: () => coordinator.runSynchronously(false),
    destroy: () => { intents.clear(); coordinator.destroy(); } };
}
