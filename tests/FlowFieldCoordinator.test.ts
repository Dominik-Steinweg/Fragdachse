import { describe, expect, it } from 'vitest';

import {
  ENEMY_FLOW_FIELD_IDS,
  FlowFieldCoordinator,
  allyFlowFieldId,
} from '../src/systems/flowfield/FlowFieldCoordinator';
import { InlineFlowFieldRunner } from '../src/systems/flowfield/FlowFieldRunner';
import {
  buildBaseDescriptors,
  buildStaticKindRaster,
  createFlowFieldTuning,
  goalCellsToIndexes,
} from '../src/systems/flowfield/FlowFieldSources';
import { INTEGRATION_INFINITY, type FlowFieldMetrics } from '../src/systems/flowfield/FlowFieldKernel';
import { EnemyFlowFieldService } from '../src/systems/EnemyFlowFieldService';
import type { ArenaLayout } from '../src/types';
import type { BaseSpec } from '../src/arena/BaseRegistry';

const METRICS: FlowFieldMetrics = {
  cols: 16,
  rows: 11,
  cellSize: 32,
  arenaOffsetX: 0,
  arenaOffsetY: 0,
};
const NAV_TICK_MS = 50;

function createLayout(overrides: Partial<ArenaLayout> = {}): ArenaLayout {
  return {
    seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [], ...overrides,
  } as ArenaLayout;
}

function createBase(id: string, minGridX: number, minGridY: number, width: number, height: number): BaseSpec {
  const cells: { gridX: number; gridY: number }[] = [];
  for (let gridY = minGridY; gridY < minGridY + height; gridY += 1) {
    for (let gridX = minGridX; gridX < minGridX + width; gridX += 1) cells.push({ gridX, gridY });
  }
  return {
    id,
    cells,
    region: { minGridX, minGridY, maxGridX: minGridX + width - 1, maxGridY: minGridY + height - 1 },
    hpMax: 1000,
    faction: 'friendly',
    role: 'main',
    turrets: [],
    powerUpPedestals: [],
  } as unknown as BaseSpec;
}

interface Harness {
  readonly coordinator: FlowFieldCoordinator;
  readonly runner: InlineFlowFieldRunner;
  readonly obstacleReads: () => number;
  setObstacles(cells: ReadonlyArray<{ gridX: number; gridY: number }>): void;
  goals(cells: ReadonlyArray<{ gridX: number; gridY: number }>): Int32Array;
  /**
   * Erstaufbau wie im verborgenen Arena-Ladezustand: synchron gerechnet und aktiviert. Danach
   * haelt der Runner seine Ergebnisse zurueck, damit die Tests Worker-Latenz steuern koennen.
   */
  bootstrap(): void;
}

function createHarness(options: {
  bases?: readonly BaseSpec[];
  layout?: ArenaLayout;
  autoFlush?: boolean;
} = {}): Harness {
  const bases = options.bases ?? [createBase('main', 12, 4, 2, 2)];
  const layout = options.layout ?? createLayout();
  let obstacles: ReadonlyArray<{ gridX: number; gridY: number }> = layout.rocks;
  let obstacleReads = 0;
  const runner = new InlineFlowFieldRunner(options.autoFlush ?? true);
  const coordinator = new FlowFieldCoordinator({
    metrics: METRICS,
    tuning: createFlowFieldTuning(),
    staticKind: buildStaticKindRaster(layout, METRICS),
    bases: buildBaseDescriptors(bases),
    activeBaseIds: new Set(bases.map((base) => base.id)),
    obstacleCellProvider: () => {
      obstacleReads += 1;
      return obstacles;
    },
    runner,
    navTickIntervalMs: NAV_TICK_MS,
  });
  return {
    coordinator,
    runner,
    obstacleReads: () => obstacleReads,
    setObstacles: (cells) => { obstacles = cells; },
    goals: (cells) => goalCellsToIndexes(cells, METRICS),
    bootstrap: () => {
      runner.setAutoFlush(true);
      coordinator.prepareNow();
      runner.setAutoFlush(options.autoFlush ?? true);
    },
  };
}

describe('FlowFieldCoordinator', () => {
  it('activates a result only at a nav tick, never as soon as it is finished', () => {
    const harness = createHarness({ autoFlush: false });
    const view = harness.coordinator.registerField('player', { goalMode: 'dynamic' });
    const service = EnemyFlowFieldService.fromView(view);
    view.setGoals(harness.goals([{ gridX: 2, gridY: 5 }]));
    harness.bootstrap();
    expect(service.getReachedGoalCellAt(3, 5)).toEqual({ gridX: 2, gridY: 5 });

    view.setGoals(harness.goals([{ gridX: 13, gridY: 8 }]));
    harness.coordinator.advance(NAV_TICK_MS);
    // Der Worker ist fertig - aktiviert wird trotzdem erst am naechsten Tick.
    expect(harness.runner.flush()).toBe(1);
    expect(service.getReachedGoalCellAt(3, 5)).toEqual({ gridX: 2, gridY: 5 });

    harness.coordinator.advance(NAV_TICK_MS);
    expect(service.getReachedGoalCellAt(3, 5)).toEqual({ gridX: 13, gridY: 8 });
    harness.coordinator.destroy();
  });

  it('collapses A -> B -> C -> D into A -> D without ever computing B or C', () => {
    const harness = createHarness({ autoFlush: false });
    const view = harness.coordinator.registerField('player', { goalMode: 'dynamic' });
    const service = EnemyFlowFieldService.fromView(view);
    view.setGoals(harness.goals([{ gridX: 2, gridY: 5 }]));
    harness.bootstrap();
    const dispatchesAfterSetup = harness.coordinator.getDiagnostics().dispatchedJobs;

    // A geht raus und bleibt in Flight.
    view.setGoals(harness.goals([{ gridX: 3, gridY: 5 }]));
    harness.coordinator.advance(NAV_TICK_MS);
    expect(harness.coordinator.getDiagnostics().dispatchedJobs).toBe(dispatchesAfterSetup + 1);

    // B und C fallen waehrend des laufenden Jobs an - kein weiterer Dispatch.
    view.setGoals(harness.goals([{ gridX: 4, gridY: 5 }]));
    harness.coordinator.advance(NAV_TICK_MS);
    view.setGoals(harness.goals([{ gridX: 5, gridY: 5 }]));
    harness.coordinator.advance(NAV_TICK_MS);
    expect(harness.coordinator.getDiagnostics().dispatchedJobs).toBe(dispatchesAfterSetup + 1);

    // A landet, D ist der aktuelle Stand: genau ein weiterer Dispatch, gesampelt bei D.
    harness.runner.flush();
    view.setGoals(harness.goals([{ gridX: 6, gridY: 5 }]));
    harness.coordinator.advance(NAV_TICK_MS);
    expect(harness.coordinator.getDiagnostics().dispatchedJobs).toBe(dispatchesAfterSetup + 2);
    harness.runner.flush();
    harness.coordinator.advance(NAV_TICK_MS);
    expect(service.getGoalCells()).toEqual([{ gridX: 6, gridY: 5 }]);
    harness.coordinator.destroy();
  });

  it('never loses a topology patch that arrives while a job is in flight', () => {
    const harness = createHarness({ autoFlush: false });
    const view = harness.coordinator.registerField('player', { goalMode: 'dynamic' });
    const service = EnemyFlowFieldService.fromView(view);
    view.setGoals(harness.goals([{ gridX: 2, gridY: 5 }]));
    harness.bootstrap();

    view.setGoals(harness.goals([{ gridX: 3, gridY: 5 }]));
    harness.coordinator.advance(NAV_TICK_MS);
    harness.coordinator.patchCell(6, 5, true);
    harness.coordinator.patchCell(6, 6, true);
    harness.coordinator.patchCell(6, 7, true);
    harness.runner.flush();
    harness.coordinator.advance(NAV_TICK_MS);
    harness.runner.flush();
    harness.coordinator.advance(NAV_TICK_MS);

    // Der Spiegel sieht die Zellen sofort, das gerechnete Feld spaetestens jetzt.
    expect(service.isTraversableAt(6, 5)).toBe(false);
    expect(service.getVectorAt(6, 6)).toEqual({ x: 0, y: 0 });
    harness.coordinator.destroy();
  });

  it('does not dispatch a field whose goals and topology are unchanged', () => {
    const harness = createHarness({ autoFlush: false });
    const view = harness.coordinator.registerField('player', { goalMode: 'dynamic' });
    view.setGoals(harness.goals([{ gridX: 2, gridY: 5 }]));
    harness.bootstrap();
    const baseline = harness.coordinator.getDiagnostics().dispatchedJobs;

    for (let tick = 0; tick < 10; tick += 1) {
      view.setGoals(harness.goals([{ gridX: 2, gridY: 5 }]));
      harness.coordinator.advance(NAV_TICK_MS);
      harness.runner.flush();
    }
    expect(harness.coordinator.getDiagnostics().dispatchedJobs).toBe(baseline);
    expect(harness.coordinator.getDiagnostics().skippedUnchangedFields).toBeGreaterThan(0);

    // Eine Topologieaenderung erzeugt sehr wohl einen Rebuild.
    harness.coordinator.patchCell(4, 4, true);
    harness.coordinator.advance(NAV_TICK_MS);
    expect(harness.coordinator.getDiagnostics().dispatchedJobs).toBe(baseline + 1);
    harness.coordinator.destroy();
  });

  it('drops a result from an earlier arena generation', () => {
    const harness = createHarness({ autoFlush: false });
    const view = harness.coordinator.registerField('player', { goalMode: 'dynamic' });
    const service = EnemyFlowFieldService.fromView(view);
    view.setGoals(harness.goals([{ gridX: 2, gridY: 5 }]));
    harness.bootstrap();

    view.setGoals(harness.goals([{ gridX: 13, gridY: 8 }]));
    harness.coordinator.advance(NAV_TICK_MS);
    // Die Runde endet, waehrend das Ergebnis noch unterwegs ist.
    harness.coordinator.destroy();
    harness.runner.flush();

    // Nichts wurde aktiviert; der letzte vollstaendige Stand bleibt lesbar.
    expect(service.getReachedGoalCellAt(3, 5)).toEqual({ gridX: 2, gridY: 5 });
  });

  it('keeps the last complete field while the runner is overloaded', () => {
    const harness = createHarness({ autoFlush: false });
    const view = harness.coordinator.registerField('player', { goalMode: 'dynamic' });
    const service = EnemyFlowFieldService.fromView(view);
    view.setGoals(harness.goals([{ gridX: 2, gridY: 5 }]));
    harness.bootstrap();
    const dispatchesAfterSetup = harness.coordinator.getDiagnostics().dispatchedJobs;

    view.setGoals(harness.goals([{ gridX: 13, gridY: 8 }]));
    for (let tick = 0; tick < 5; tick += 1) {
      harness.coordinator.advance(NAV_TICK_MS);
      // Nie mehr als ein Job in Flight, egal wie lange das Ergebnis ausbleibt.
      expect(harness.runner.pendingResults).toBeLessThanOrEqual(1);
      expect(service.getReachedGoalCellAt(3, 5)).toEqual({ gridX: 2, gridY: 5 });
      expect(service.getIntegrationValueAt(3, 5)).toBeLessThan(INTEGRATION_INFINITY);
    }
    expect(harness.coordinator.getDiagnostics().dispatchedJobs).toBe(dispatchesAfterSetup + 1);
    harness.coordinator.destroy();
  });

  it('suppresses the goal cells of a destroyed base in the very same frame', () => {
    const outpost = createBase('outpost', 2, 5, 1, 1);
    const harness = createHarness({ bases: [createBase('main', 12, 4, 2, 2), outpost], autoFlush: false });
    const view = harness.coordinator.registerField(ENEMY_FLOW_FIELD_IDS.base, { goalMode: 'bases' });
    const service = EnemyFlowFieldService.fromView(view);
    harness.bootstrap();
    expect(service.getIntegrationValueAt(3, 5)).toBe(0);

    harness.coordinator.setActiveBaseIds(new Set(['main']));
    // Ohne Sperre bliebe der Integrationswert 0 - und ein Gegner dort stehen, weil er als
    // angekommen gilt (EnemyManager stoppt bei integrationValue <= 0).
    expect(service.getIntegrationValueAt(3, 5)).toBe(INTEGRATION_INFINITY);
    // Die Base-Aenderung wartet nicht auf den naechsten Nav-Tick.
    expect(harness.runner.pendingResults).toBe(1);

    harness.runner.flush();
    harness.coordinator.advance(NAV_TICK_MS);
    expect(service.isGoalCell(3, 5)).toBe(false);
    expect(service.getIntegrationValueAt(3, 5)).toBeGreaterThan(0);
    expect(service.getIntegrationValueAt(3, 5)).toBeLessThan(INTEGRATION_INFINITY);
    harness.coordinator.destroy();
  });

  it('activates the payload of a field together with that field', () => {
    const harness = createHarness({ autoFlush: false });
    const view = harness.coordinator.registerField(ENEMY_FLOW_FIELD_IDS.strategic, { goalMode: 'dynamic' });
    const service = EnemyFlowFieldService.fromView(view);
    const activations: string[] = [];
    view.onActivated((payload) => activations.push(payload as string));

    view.setGoals(harness.goals([{ gridX: 2, gridY: 5 }]), 'mapping-A');
    harness.bootstrap();
    // Auch der Erstaufbau uebergibt seine Zuordnung - sonst stuende die Zielwahl bis zum ersten
    // Nav-Tick ohne Mapping da.
    expect(activations).toEqual(['mapping-A']);

    view.setGoals(harness.goals([{ gridX: 13, gridY: 8 }]), 'mapping-B');
    harness.coordinator.advance(NAV_TICK_MS);
    // Waehrend das Ergebnis unterwegs ist, kommt schon die naechste Zuordnung an.
    view.setGoals(harness.goals([{ gridX: 4, gridY: 2 }]), 'mapping-C');
    harness.runner.flush();
    harness.coordinator.advance(NAV_TICK_MS);

    // Aktiviert wird die Zuordnung, aus deren Zielmenge das jetzt aktive Feld entstand - nie die
    // inzwischen eingetroffene C.
    expect(activations).toEqual(['mapping-A', 'mapping-B']);
    expect(service.getReachedGoalCellAt(12, 8)).toEqual({ gridX: 13, gridY: 8 });
    harness.coordinator.destroy();
  });

  it('gives a boss its own clearance topology alongside the standard mirror', () => {
    const harness = createHarness({
      layout: createLayout({ rocks: [{ gridX: 5, gridY: 5 }] as ArenaLayout['rocks'] }),
      autoFlush: false,
    });
    const standard = EnemyFlowFieldService.fromView(
      harness.coordinator.registerField(ENEMY_FLOW_FIELD_IDS.player, { goalMode: 'bases' }),
    );
    const boss = EnemyFlowFieldService.fromView(
      harness.coordinator.registerField(ENEMY_FLOW_FIELD_IDS.boss, { goalMode: 'bases', clearanceCells: 1 }),
    );
    harness.bootstrap();

    // Der Fels sperrt fuer den Boss auch die Nachbarzelle, fuer normale Gegner nicht.
    expect(standard.isTraversableAt(5, 4)).toBe(true);
    expect(boss.isTraversableAt(5, 4)).toBe(false);
    expect(standard.isTraversableAt(0, 0)).toBe(true);
    // Der Arenarand faellt fuer den breiten Koerper weg.
    expect(boss.isTraversableAt(0, 0)).toBe(false);
    // Groesserer Zielabstand zur Basis (Spalten 12..13).
    expect(standard.isGoalCell(11, 4)).toBe(true);
    expect(boss.isGoalCell(11, 4)).toBe(false);
    expect(boss.isGoalCell(10, 4)).toBe(true);
    harness.coordinator.destroy();
  });

  it('serves an ally field that is registered after the arena was built', () => {
    const harness = createHarness({ autoFlush: false });
    harness.coordinator.registerField(ENEMY_FLOW_FIELD_IDS.player, { goalMode: 'dynamic' });
    harness.bootstrap();

    const lateJoiner = allyFlowFieldId('player-2');
    const view = harness.coordinator.registerField(lateJoiner, { goalMode: 'dynamic-fallback-bases' });
    const service = EnemyFlowFieldService.fromView(view);
    view.setGoals(harness.goals([{ gridX: 2, gridY: 5 }]));
    harness.coordinator.advance(NAV_TICK_MS);
    harness.runner.flush();
    harness.coordinator.advance(NAV_TICK_MS);

    expect(service.getReachedGoalCellAt(3, 5)).toEqual({ gridX: 2, gridY: 5 });

    harness.coordinator.unregisterField(lateJoiner);
    expect(harness.coordinator.getFieldView(lateJoiner)).toBeNull();
    harness.coordinator.destroy();
  });

  it('runs at most one nav tick per frame and does not catch up after a hitch', () => {
    const harness = createHarness({ autoFlush: false });
    const view = harness.coordinator.registerField('player', { goalMode: 'dynamic' });
    view.setGoals(harness.goals([{ gridX: 2, gridY: 5 }]));
    harness.bootstrap();
    const baseline = harness.coordinator.getDiagnostics().dispatchedJobs;

    // 400 ms waeren acht Ticks. Der Akkumulator ist auf zwei gedeckelt, und je Frame laeuft
    // hoechstens ein Tick - ein Hitch darf keine Dispatch-Salve ausloesen.
    view.setGoals(harness.goals([{ gridX: 3, gridY: 5 }]));
    harness.coordinator.advance(400);
    expect(harness.coordinator.getDiagnostics().dispatchedJobs).toBe(baseline + 1);
    harness.coordinator.destroy();
  });

  it('reads the obstacle provider only for a coordinate-less change', () => {
    const harness = createHarness({ autoFlush: false });
    harness.coordinator.registerField('player', { goalMode: 'bases' });
    harness.bootstrap();
    const readsAfterSetup = harness.obstacleReads();

    harness.coordinator.patchCell(4, 4, true);
    harness.coordinator.advance(NAV_TICK_MS);
    expect(harness.obstacleReads()).toBe(readsAfterSetup);

    harness.setObstacles([{ gridX: 7, gridY: 7 }]);
    harness.coordinator.requestFullResync();
    expect(harness.obstacleReads()).toBe(readsAfterSetup + 1);
    harness.coordinator.destroy();
  });

  it('keeps the buffer pool bounded across many activation cycles', () => {
    const harness = createHarness({ autoFlush: false });
    const view = harness.coordinator.registerField('player', { goalMode: 'dynamic' });
    const service = EnemyFlowFieldService.fromView(view);
    harness.bootstrap();

    for (let cycle = 0; cycle < 50; cycle += 1) {
      view.setGoals(harness.goals([{ gridX: 2 + (cycle % 8), gridY: 5 }]));
      harness.coordinator.advance(NAV_TICK_MS);
      harness.runner.flush();
      harness.coordinator.advance(NAV_TICK_MS);
    }

    // Aktiv plus hoechstens ein Reservepuffer je Rolle.
    const pools = (harness.coordinator as unknown as {
      fields: Map<string, { pool: Record<string, ArrayBuffer[]> }>;
    }).fields.get('player')!.pool;
    for (const role of Object.keys(pools)) {
      expect(pools[role].length).toBeLessThanOrEqual(2);
    }
    // Das Feld ist nach dem Puffer-Karussell weiterhin intakt: Die Zielzelle selbst traegt keinen
    // Vektor, eine Zelle daneben zeigt auf sie zu.
    const goalCell = service.getGoalCells()[0];
    expect(goalCell).toEqual({ gridX: 2 + (49 % 8), gridY: 5 });
    expect(service.getVectorAt(goalCell.gridX, goalCell.gridY)).toEqual({ x: 0, y: 0 });
    expect(service.getVectorAt(goalCell.gridX + 2, goalCell.gridY)).toEqual({ x: -1, y: 0 });
    harness.coordinator.destroy();
  });
});
