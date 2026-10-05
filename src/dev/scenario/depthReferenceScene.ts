import { defaultScenario, parseScenario, scenarioLoadout, type DevScenario, type GridPoint } from './config';
import type { DevScenarioController } from './controller';

export const DEPTH_REFERENCE_SCENES = ['canopyEdge', 'smallExplosion', 'deathBlood', 'flight', 'gases',
  'surface', 'train', 'readability', 'extreme'] as const;
export type DepthReferenceScene = typeof DEPTH_REFERENCE_SCENES[number];
export const DEPTH_REFERENCE_MINUTES = [480, 720, 1140, 0] as const;
type Command = Record<string, unknown>;
export interface ReferenceCue { readonly frame: number; readonly command: Command }
export interface DepthReferenceRecipe {
  readonly version: 1; readonly name: DepthReferenceScene; readonly scenario: DevScenario;
  readonly focus: GridPoint; readonly zoom: number; readonly cues: readonly ReferenceCue[];
  readonly captures: readonly number[];
}
const target = (gridX: number, gridY: number): Command => ({ action: 'target', gridX, gridY });
const utility = (id: string): Command => ({ action: 'temporaryUtility', utility: id, chargeMs: 0 });

/** Authored inputs only; real host actions still decide hits, destruction and resource use. */
export function depthReferenceRecipe(name: DepthReferenceScene, minute: number): DepthReferenceRecipe {
  if (!DEPTH_REFERENCE_SCENES.includes(name)) throw new Error('Unknown depth reference scene');
  if (!(DEPTH_REFERENCE_MINUTES as readonly number[]).includes(minute)) throw new Error('timeOfDay: 480, 720, 1140 or 0');
  const scenario = defaultScenario('dachs_nukem');
  Object.assign(scenario, { mapId: '1', seed: 12345, timeOfDay: minute, hideAim: false,
    player: { gridX: 27, gridY: 28 }, weapon1: 'GLOCK', weapon2: 'ROCKET_LAUNCHER' });
  let focus = { gridX: 31, gridY: 19 }, zoom = 2;
  const cues: ReferenceCue[] = [], cue = (frame: number, command: Command) => cues.push({ frame, command });
  let captures = [0, 1, 12, 30, 60, 90, 120, 180];
  switch (name) {
    case 'canopyEdge':
      cue(0, { action: 'enemyReadabilityArrange', surface: 'woodland' });
      cue(0, target(31, 19)); cue(1, { action: 'fire', slot: 'weapon2' }); break;
    case 'smallExplosion':
      focus = { gridX: 27, gridY: 26 }; cue(0, target(27, 26)); cue(1, utility('HE_GRENADE'));
      captures = [0, 30, 59, 65, 72, 90, 120, 180]; break;
    case 'deathBlood':
      focus = { gridX: 27, gridY: 28 };
      // Legal player cell is guaranteed by the ordinary ready barrier. Low HP makes the
      // overlapping host target a reproducible kill through the real grenade action.
      cue(0, target(27, 28));
      cue(0, { action: 'spawn', kind: 'zombie-badger', pinned: true, hp: 1, gridX: 27, gridY: 28 });
      cue(1, utility('HE_GRENADE')); captures = [0, 59, 65, 72, 84, 96, 120, 180]; break;
    case 'flight':
      focus = { gridX: 31, gridY: 19 }; cue(0, target(31, 19));
      cue(1, { action: 'fire', slot: 'weapon1' }); cue(30, { action: 'fire', slot: 'weapon2' });
      captures = [0, 1, 3, 6, 12, 30, 33, 42, 60]; break;
    case 'gases':
      focus = { gridX: 27, gridY: 28 }; cue(0, target(27, 28)); cue(1, utility('STINK_CLOUD'));
      cue(120, utility('SMOKE_GRENADE')); cue(300, utility('MOLOTOV_GRENADE'));
      captures = [0, 60, 120, 240, 300, 420, 540]; break;
    case 'surface':
      cue(0, { action: 'enemyReadabilityArrange', surface: 'woodland' });
      focus = { gridX: 28, gridY: 21 }; zoom = 1.4;
      cue(30, { action: 'burrow', phase: 'enter' }); cue(90, { action: 'burrow', phase: 'exit' }); break;
    case 'train':
      focus = { gridX: 130.4, gridY: 20 }; zoom = 1;
      cue(1, { action: 'train', invulnerable: true });
      captures = [0, 60, 180, 360, 600]; break;
    case 'readability':
      cue(0, { action: 'enemyReadabilityArrange', surface: 'woodland' });
      focus = { gridX: 28, gridY: 21 }; zoom = 1.4; break;
    case 'extreme':
      focus = { gridX: 27, gridY: 26 }; zoom = 1;
      cue(0, target(27, 26)); cue(1, utility('NUKE'));
      captures = [0, 60, 120, 180, 240, 300, 360, 480, 600]; break;
  }
  const validated = parseScenario(scenario);
  scenarioLoadout(validated); // Fail before changing the running scenario.
  return { version: 1, name, scenario: validated, focus, zoom, cues, captures };
}

interface Run {
  recipe: DepthReferenceRecipe; frame: number; origin: number | null; config: DevScenario;
  random: () => number; busy: boolean; failed: boolean; applied: number;
  log: { frame: number; command: Command; result: unknown }[];
}
const runs = new WeakMap<DevScenarioController, Run>();
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function integer(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) throw new Error(`Invalid ${label}`);
  return value;
}
async function nextFrame(controller: DevScenarioController, assertCurrent: () => void): Promise<void> {
  assertCurrent();
  const before = controller.clock.now;
  controller.step(1);
  const start = performance.now();
  // Poll a real wall clock: the presentation clock is deliberately stopped between samples.
  while (controller.clock.now < before + 1000 / 60 - .001) {
    assertCurrent();
    if (controller.state !== 'ready') throw new Error('Reference lost its ready world');
    if (performance.now() - start > 10000) throw new Error('Reference step timed out');
    await new Promise<void>(resolve => setTimeout(resolve, 4));
  }
  assertCurrent();
}

/** Only the new API action uses this runner. No normal gameplay / controller update hooks. */
export async function runDepthReferenceScene(controller: DevScenarioController, input: Command,
  execute: (command: Command) => void | Promise<void>): Promise<void> {
  for (const key of Object.keys(input)) if (!['action','scene','timeOfDay','phase','frame'].includes(key)) throw new Error(`Unknown depthReferenceScene option: ${key}`);
  const phase = input.phase ?? 'prepare';
  if (phase !== 'prepare' && phase !== 'sample') throw new Error('phase: prepare or sample');
  if (runs.get(controller)?.busy) throw new Error('Depth reference already sampling');
  if (phase === 'prepare') {
    if (input.frame !== undefined) throw new Error('frame belongs to sample');
    const recipe = depthReferenceRecipe(input.scene as DepthReferenceScene, input.timeOfDay === undefined ? 720 : input.timeOfDay as number);
    controller.start(recipe.scenario);
    const run: Run = { recipe, frame: -1, origin: null, config: controller.config, random: random(recipe.scenario.seed),
      busy: false, failed: false, applied: 0, log: [] };
    runs.set(controller, run);
    controller.lastAction = { depthReference: { ...recipe, phase: 'prepare', stepMs: 1000 / 60 } };
    return;
  }
  const frame = integer(input.frame, 'frame (0..600)', 600), run = runs.get(controller);
  if (!run || run.failed || run.config !== controller.config) throw new Error('Prepare this reference again before sampling');
  if (input.scene !== undefined && input.scene !== run.recipe.name) throw new Error('Scene differs from prepared reference');
  if (input.timeOfDay !== undefined && input.timeOfDay !== run.recipe.scenario.timeOfDay) throw new Error('Time differs from prepared reference');
  if (frame < run.frame) throw new Error('Backward sampling requires prepare + whenReady (deterministic replay)');
  if (controller.snapshot().ready !== true) throw new Error('Await devScenario.whenReady() first');
  const isCurrent = () => controller.isCurrentScenario(run.config);
  const assertCurrent = () => {
    if (!isCurrent()) throw new Error('Reference scenario was replaced or destroyed');
  };
  controller.pause(); run.busy = true;
  const nativeRandom = Math.random;
  try {
    if (run.origin === null) {
      // Let camera/time-of-day settle through the regular frame binding before the cue origin.
      controller.aim = { ...run.recipe.focus }; controller.zoom = run.recipe.zoom; controller.cameraAtTarget = true;
      for (let i = 0; i < 120; i++) {
        await nextFrame(controller, assertCurrent);
        assertCurrent();
      }
      run.origin = controller.clock.now;
    } else if (Math.abs(controller.clock.now - run.origin - Math.max(0, run.frame) * 1000 / 60) > .01) {
      throw new Error('Clock changed outside reference; prepare again');
    }
    Math.random = run.random;
    for (let at = Math.max(0, run.frame + 1); at <= frame; at++) {
      for (const cue of run.recipe.cues.filter(c => c.frame === at)) {
        assertCurrent();
        await execute(cue.command);
        assertCurrent();
        run.log.push({ frame: at, command: cue.command, result: structuredClone(controller.lastAction) });
        const result = controller.lastAction as { ok?: boolean; reason?: string } | null;
        if (result?.ok === false) throw new Error(`Reference action rejected: ${result.reason ?? JSON.stringify(result)}`);
        run.applied++;
      }
      controller.aim = { ...run.recipe.focus }; controller.zoom = run.recipe.zoom; controller.cameraAtTarget = true;
      controller.syncCamera();
      await nextFrame(controller, assertCurrent);
      assertCurrent();
      // Frame zero is the first rendered fixture, after pose/camera reconciliation.
      if (at === 0) run.origin = controller.clock.now;
      run.frame = at;
    }
    controller.lastAction = { depthReference: { version: 1, scene: run.recipe.name, seed: run.recipe.scenario.seed,
      timeOfDay: run.recipe.scenario.timeOfDay, frame: run.frame, timeMs: run.frame * 1000 / 60,
      originSimulationMs: run.origin, stepMs: 1000 / 60, captures: run.recipe.captures, log: run.log,
      wallTimeMs: Date.now(),
      determinism: 'Fixed input frames and seeded Math.random during sampling. Fresh page per comparison; wall epoch, GPU/worker/ambient animation is not a bitwise replay.' } };
  } catch (error) { run.failed = true; throw error; }
  finally {
    if (Math.random === run.random) Math.random = nativeRandom;
    if (isCurrent()) controller.clock.paused = true;
    run.busy = false;
  }
}
