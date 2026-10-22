import type * as Phaser from 'phaser';
import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import { CELL_SIZE } from '../../config';
import { getSpawnStructureTemplate, SPAWN_STRUCTURE_OUTLETS, type SpawnStructureOutlet } from '../../config/spawnStructure';
import type { SpawnStructureRenderer, SpawnStructureLightingPort } from '../../effects/spawnStructure/SpawnStructureRenderer';
import type { SpawnStructureView } from '../../effects/spawnStructure/SpawnStructureModel';
import type { DevScenarioController } from './controller';

const fixtures = new WeakMap<DevScenarioController, { runtime: ArenaRuntime; review: SpawnStructureReview | null }>();

type ReviewState = 'active' | 'sealed' | 'damaged' | 'rubble';

/**
 * Presentation-only showcase of the spawn structure (GDD Spawnbauwerk V1): the four openings while
 * active, then sealed, damaged and rubble, around one point; `charge` previews an announced release.
 * Gameplay never sees these structures.
 */
class SpawnStructureReview {
  private readonly renderer: SpawnStructureRenderer;
  private readonly views: SpawnStructureView[];
  private charge = 0;

  constructor(private readonly scene: Phaser.Scene, lighting: SpawnStructureLightingPort, centre: { x: number; y: number },
    rendererType: typeof SpawnStructureRenderer) {
    this.renderer = new rendererType(scene);
    this.renderer.setLighting(lighting);
    this.renderer.setChargeProvider(() => this.charge);
    const layout: [SpawnStructureOutlet, ReviewState, number, number][] = [
      ...SPAWN_STRUCTURE_OUTLETS.map((outlet, i): [SpawnStructureOutlet, ReviewState, number, number] => [outlet, 'active', (i - 1.5) * 5.5, -3]),
      ['south', 'sealed', -5.5, 3], ['south', 'damaged', 0, 3], ['south', 'rubble', 5.5, 3],
    ];
    this.views = layout.map(([outlet, state, dx, dy], index) => {
      const x = Math.round(centre.x / CELL_SIZE + dx) * CELL_SIZE, y = Math.round(centre.y / CELL_SIZE + dy) * CELL_SIZE;
      const template = getSpawnStructureTemplate(outlet);
      // Pit centre on a cell corner; wall cells relative to the template's pit.
      const originX = x - (template.area.gridX + 1) * CELL_SIZE, originY = y - (template.area.gridY + 1) * CELL_SIZE;
      return {
        id: `review-${index}`, x, y, outlet, maxHp: 100, hp: state === 'damaged' ? 30 : state === 'rubble' ? 0 : 100,
        dormant: state === 'sealed', destroyed: state === 'rubble', live: true, hpRevision: 0,
        wallCells: template.cells.map((cell) => ({ x: originX + (cell.gridX + 0.5) * CELL_SIZE, y: originY + (cell.gridY + 0.5) * CELL_SIZE })),
      };
    });
    scene.events.on('postupdate', this.update, this);
  }

  setCharge(charge: number): void { this.charge = Math.max(0, Math.min(1, charge)); }

  status() {
    return { charge: this.charge, structures: this.views.map(({ id, x, y, outlet, hp, dormant, destroyed }) => ({ id, x, y, outlet, hp, dormant, destroyed })) };
  }

  destroy(): void {
    this.scene.events.off('postupdate', this.update, this);
    this.renderer.destroy();
  }

  private update(): void {
    this.renderer.sync(this.views, this.scene.time.now);
  }
}

export function bindSpawnStructureReview(controller: DevScenarioController, runtime: ArenaRuntime): void {
  fixtures.set(controller, { runtime, review: null });
}

export function releaseSpawnStructureReview(controller: DevScenarioController): void {
  fixtures.get(controller)?.review?.destroy();
  fixtures.delete(controller);
}

/** window.devScenario.run({action:'spawnStructureReview', step:'show'|'charge'|'clear'|'status', gridX?, gridY?, charge?}). */
export async function runSpawnStructureReview(controller: DevScenarioController, command: Record<string, unknown>): Promise<void> {
  const fixture = fixtures.get(controller);
  if (!fixture) throw new Error('Spawn structure review is not bound');
  const step = command.step ?? 'show';
  if (step === 'show') {
    controller.requireReadyForBots();
    fixture.review?.destroy();
    const centre = typeof command.gridX === 'number' && typeof command.gridY === 'number'
      ? { x: command.gridX * CELL_SIZE + CELL_SIZE / 2, y: command.gridY * CELL_SIZE + CELL_SIZE / 2 }
      : fixture.runtime.navigationLabPort.getPlayerPosition();
    if (!centre) throw new Error('No player position');
    const { scene } = fixture.runtime.getScenarioPortalTargets();
    // Loaded on demand: the scenario command module stays free of Phaser for headless callers.
    const { SpawnStructureRenderer } = await import('../../effects/spawnStructure/SpawnStructureRenderer');
    fixture.review?.destroy();
    fixture.review = new SpawnStructureReview(scene, fixture.runtime.getScenarioMeteorTargets().lighting, centre, SpawnStructureRenderer);
  }
  const review = fixture.review;
  if (!review) throw new Error('Run spawnStructureReview step "show" first');
  if (step === 'charge') review.setCharge(typeof command.charge === 'number' ? command.charge : 0);
  else if (step === 'clear') { review.destroy(); fixture.review = null; controller.lastAction = { spawnStructureReview: 'cleared' }; return; }
  controller.lastAction = { spawnStructureReview: review.status() };
}
