import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { DevScenarioController } from './controller';
import { registerDiagnosticMap } from '../../config/coopDefenseMaps';
import type { CoopBaseConfig } from '../../config/coopDefenseMapAuthoring';
import type { PersistentBaseRewardId } from '../../persistentBase/PersistentBaseRewardTypes';
import { defaultScenario } from './config';

const MAP = 'base-review';
const CORE = { gridX: 18, gridY: 19 };

/** Base turrets on the core's L bastions, relative to the core centre: corners plus two arm ends near the gate lanterns. */
const CORE_TURRETS: readonly { rewardId: PersistentBaseRewardId; dx: number; dy: number }[] = [
  { rewardId: 'base_plasma_turret', dx: -3, dy: -3 },
  { rewardId: 'base_plasma_turret_2', dx: 3, dy: -3 },
  { rewardId: 'base_spore_turret', dx: 3, dy: 3 },
  { rewardId: 'base_rocket_turret', dx: -3, dy: 3 },
  { rewardId: 'base_plasma_turret_dawn_1', dx: -2, dy: -3 },
  { rewardId: 'base_plasma_turret_dawn_2', dx: 3, dy: 2 },
];

/** Ordinary player constructions inside and outside the build area. */
const BUILT = [
  { id: 'spore_turret', gridX: 25, gridY: 13 },
  { id: 'rocket_turret', gridX: 27, gridY: 26 },
  { id: 'machine_gun_turret', gridX: 9, gridY: 26 },
] as const;

const cells = (...offsets: [number, number][]) => ({ kind: 'cells' as const, cells: offsets.map(([gridX, gridY]) => ({ gridX, gridY })) });

/** Every outpost form the authored maps use, some armed like their map counterparts. */
const OUTPOSTS: readonly (Pick<CoopBaseConfig, 'id' | 'shape' | 'turrets'> & { gridX: number; gridY: number })[] = [
  { id: 'lab-single', gridX: 35, gridY: 5, shape: cells([0, 0]),
    turrets: [{ id: 'lab-single-rocket', cellOffset: { gridX: 0, gridY: 0 }, mountSide: 'front', weaponId: 'TURRET_ROCKET_BURST' }] },
  { id: 'lab-l3', gridX: 39, gridY: 5, shape: cells([0, 0], [1, 0], [0, 1]) },
  { id: 'lab-square', gridX: 44, gridY: 5, shape: { kind: 'rectangle', widthCells: 2, heightCells: 2 } },
  { id: 'lab-line', gridX: 50, gridY: 4, shape: { kind: 'rectangle', widthCells: 1, heightCells: 7 },
    turrets: [{ id: 'lab-line-rocket', cellOffset: { gridX: 0, gridY: 2 }, mountSide: 'front', weaponId: 'TURRET_ROCKET_BURST' },
      { id: 'lab-line-spores', cellOffset: { gridX: 0, gridY: 5 }, mountSide: 'front', weaponId: 'TURRET_SPORES' }] },
  { id: 'lab-block', gridX: 35, gridY: 13, shape: { kind: 'rectangle', widthCells: 4, heightCells: 4 } },
  { id: 'lab-zigzag', gridX: 42, gridY: 13,
    shape: cells([0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2], [3, 3], [4, 3], [4, 4]) },
  { id: 'lab-bastion', gridX: 35, gridY: 24, shape: cells([0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [0, 3], [0, 4]),
    turrets: [{ id: 'lab-bastion-rocket', cellOffset: { gridX: 0, gridY: 1 }, mountSide: 'front', weaponId: 'TURRET_ROCKET_BURST' }] },
  { id: 'lab-middle', gridX: 44, gridY: 25, shape: { kind: 'rectangle', widthCells: 2, heightCells: 4 } },
];

/** Camera targets shared by the panel steps and capture specs. */
export const BASE_REVIEW_FOCUS = {
  core: { gridX: CORE.gridX + .5, gridY: CORE.gridY + .5 },
  gate: { gridX: CORE.gridX + .5, gridY: CORE.gridY + 3.5 },
  outposts: { gridX: 43, gridY: 17 },
  built: { gridX: 22, gridY: 22 },
} as const;
type Focus = keyof typeof BASE_REVIEW_FOCUS;

const fixtures = new WeakMap<DevScenarioController, { runtime: ArenaRuntime; unregister: () => void }>();

export function bindBaseReview(controller: DevScenarioController, runtime: ArenaRuntime): void {
  const unregister = registerDiagnosticMap({
    mapId: MAP, arenaWidthCells: 56, arenaHeightCells: 38, timeOfDay: '12:00',
    rockFillRatio: 0, treeCount: 0, trackMode: 'none', tutorialDurationMs: 0,
    balanceReferenceDurationSec: 3600, objective: 'survive', surviveDurationSec: 3600, respawnsPerPlayer: 3,
    bases: OUTPOSTS.map(({ gridX, gridY, ...base }) => ({ ...base, role: 'outpost', faction: 'friendly', hpMax: 1_000_000,
      anchor: { kind: 'grid', gridX, gridY } })),
    persistentBase: { baseId: 'review-base', anchor: CORE },
    encounters: [], persistentSpawns: [], powerUps: [], mapEvents: [],
  });
  fixtures.set(controller, { runtime, unregister });
}

export function releaseBaseReview(controller: DevScenarioController): void {
  fixtures.get(controller)?.unregister();
  fixtures.delete(controller);
}

function minutes(value: unknown): number {
  if (value === undefined || value === 'day') return 720;
  if (value === 'dusk') return 1170;
  if (value === 'night') return 1380;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440) return value;
  throw new Error('time: day, dusk, night or minutes 0…1439');
}

function focus(controller: DevScenarioController, target: unknown, zoom: unknown): void {
  if (!(typeof target === 'string' && target in BASE_REVIEW_FOCUS)) throw new Error(`focus: ${Object.keys(BASE_REVIEW_FOCUS).join(', ')}`);
  if (zoom !== undefined && (typeof zoom !== 'number' || zoom < .25 || zoom > 8)) throw new Error('zoom: 0.25…8');
  controller.aim = BASE_REVIEW_FOCUS[target as Focus];
  controller.cameraAtTarget = true;
  if (typeof zoom === 'number') controller.zoom = zoom;
}

/**
 * Lab for the friendly base presentation: the persistent core with base turrets on its decks, every outpost form
 * and ordinary turrets built on open ground. Stored progress stays untouched; the core's build area follows it.
 * window.devScenario.run({action:'baseReview', step:'start', time:'night', turrets:true, built:true}),
 * then {step:'focus', target:'core'|'gate'|'outposts'|'built', zoom} and the usual options/camera actions.
 */
export async function runBaseReview(controller: DevScenarioController, command: Record<string, unknown>): Promise<void> {
  const fixture = fixtures.get(controller);
  if (!fixture) throw new Error('Base review is not bound');
  const step = command.step ?? 'start';
  if (step === 'start') {
    // The builder class, parked in a corner so its flashlight does not grade the base at night.
    const scenario = defaultScenario('inspector_gadachs');
    Object.assign(scenario, { mapId: MAP, player: { gridX: 4.5, gridY: 35.5 }, timeOfDay: minutes(command.time),
      hideAim: true, hideTutorial: true, suppressWaves: true, freezeMission: true,
      tools: BUILT.map(({ id }) => ({ kind: 'construction', id })),
      constructions: command.built === false ? [] : BUILT.map(build => ({ ...build })) });
    controller.start(scenario);
    const activeConfig = controller.config;
    const ready = await window.devScenario!.whenReady(90000);
    if (!controller.isCurrentScenario(activeConfig)) return;
    if (!ready.ok) throw new Error(ready.error);
    if (command.turrets !== false) for (const { rewardId, dx, dy } of CORE_TURRETS)
      fixture.runtime.devScenarioPort.arrangeBaseTurret(rewardId, CORE.gridX + dx, CORE.gridY + dy, Math.atan2(dy, dx));
    focus(controller, 'core', 2);
    controller.setPanelCollapsed(true);
  } else if (step === 'focus') {
    focus(controller, command.target, command.zoom);
  } else if (step !== 'status') throw new Error('Unknown baseReview step');
  controller.lastAction = { baseReview: { core: CORE, outposts: OUTPOSTS.map(({ id, gridX, gridY }) => ({ id, gridX, gridY })),
    built: BUILT, focus: BASE_REVIEW_FOCUS } };
  controller.syncPanel();
}
