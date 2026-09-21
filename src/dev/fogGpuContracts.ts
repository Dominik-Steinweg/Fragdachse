import type * as Phaser from 'phaser';
import { FogGpuField } from '../effects/groundFog/FogGpuField';
import { FogTerrainModel } from '../effects/groundFog/FogTerrainModel';
import { FOG, fogTuning } from '../effects/groundFog/FogConfig';

/** Deliberate synchronous readbacks in a disposable fixture, never in timed runs. */
export function runFogGpuContracts(scene: Phaser.Scene): object {
  const frame = { offsetX: 0, offsetY: 0, width: 1024, height: 512 };
  const terrain = new FogTerrainModel(frame, []);
  const rect = (x: number, y: number, w: number, h: number) =>
    Array.from({ length: w * h }, (_, i) => ({ gridX: x + i % w, gridY: y + Math.floor(i / w) }));
  terrain.setObstacle('wall', rect(15, 0, 1, 16), true);
  terrain.markOpened(rect(16, 0, 16, 16));
  terrain.setObstacle('rock', rect(6, 5, 6, 6), true);
  const tuning = { ...fogTuning(183), windX: 24, windY: 0 };
  const field = new FogGpuField(scene, terrain, 183, tuning, 0);
  let time = 0;
  const steps = (n: number): void => {
    for (let i = 0; i < n; i++) { field.prepare({ x: 0, y: 0, width: 1024, height: 512 }, time); field.step([], [.8, .8], tuning, time += FOG.stepMs); }
  };
  try {
    steps(1);
    const initial = field.readDensity(100, 100);
    const initialVelocity = field.readVelocity(100, 100);
    const wall = field.readDensity(492, 260);
    steps(90);
    const isolated = field.readDensity(516, 260);
    const neighbourhood = Array.from({ length: 9 }, (_, i) => ({ x: 100 + i % 3 * 8, y: 100 + Math.floor(i / 3) * 8 }))
      .map(p => ({ density: field.readDensity(p.x, p.y).density, velocity: field.readVelocity(p.x, p.y) }));
    terrain.removeObstacle('rock'); steps(1);
    const openingCenter = field.readDensity(292, 260), openingEdge = field.readDensity(196, 260);
    steps(14);
    const entered = field.readDensity(204, 260);
    terrain.setObstacle('rock', rect(6, 5, 6, 6)); steps(1);
    const reblocked = field.readDensity(204, 260);
    const beforeRead = field.readDensity(100, 100), afterRead = field.readDensity(100, 100);
    const view = { x: 0, y: 0, width: 1024, height: 512 };
    field.render(view, 512, 256, 'normal', 1);
    field.prepare(view, time);
    field.step([{ x: 50, y: 100, endX: 150, endY: 100, radius: 4, strength: .13, priority: 10, kind: 'projectile' }], [.8, .8], tuning, time += FOG.stepMs);
    field.render(view, 512, 256, 'normal', 1);
    const fineTrail = field.readTrail(100, 100), outsideTrail = field.readTrail(100, 116);
    steps(11); field.render(view, 512, 256, 'normal', 1);
    const expiredTrail = field.readTrail(100, 100);
    const cachedBefore = field.readDensity(100, 100);
    const remoteView = { x: 920, y: 0, width: 50, height: 100 };
    terrain.removeObstacle('rock');
    field.prepare(remoteView, time); field.step([], [.8, .8], tuning, time += FOG.stepMs);
    // A second cached terrain edit must retain the first pending reset.
    terrain.setObstacle('new', rect(4, 4, 1, 1));
    field.prepare(remoteView, time); field.step([], [.8, .8], tuning, time += FOG.stepMs);
    const cachedAfter = field.readDensity(100, 100);
    field.prepare(view, time); field.step([], [.8, .8], tuning, time += FOG.stepMs);
    const reopenedCached = field.readDensity(292, 260), blockedCached = field.readDensity(140, 140);
    const checks = {
      cachedTerrainEditsPreserveOtherCells: cachedBefore.density === cachedAfter.density,
      cachedEditsAppliedBeforeResume: reopenedCached.density === 0 && !reopenedCached.reached && blockedCached.density === 0,
      thinTraceWithoutWideLane: fineTrail > 0 && outsideTrail === 0,
      traceExpiresOnGpu: expiredTrail === 0,
      velocityEncodingPreservesWind: Math.abs(initialVelocity[0] - tuning.windX) < .05 && Math.abs(initialVelocity[1]) < .05,
      stableUniformFlow: neighbourhood.every(p => Math.abs(p.velocity[0] - tuning.windX) < .05 && Math.abs(p.velocity[1]) < .05),
      noNumericalCheckerboard: Math.max(...neighbourhood.map(p => p.density)) - Math.min(...neighbourhood.map(p => p.density)) < .2,
      baselineExists: initial.density > .01 && initial.reached,
      barriersEmpty: wall.density === 0 && !wall.reached,
      closedWallTransmitsNothing: isolated.density === 0 && !isolated.reached,
      openingHasNoLocalSource: openingCenter.density === 0 && !openingCenter.reached,
      edgeReceivesFlux: openingEdge.density > 0 && openingEdge.reached,
      fogAdvancesFromEdge: entered.density > 0 && entered.reached,
      reblockingClearsState: reblocked.density === 0 && !reblocked.reached,
      readbackIsNonDestructive: beforeRead.density === afterRead.density && beforeRead.density > 0,
    };
    return { passed: Object.values(checks).every(Boolean), checks,
      readings: { initial, initialVelocity, wall, isolated, openingCenter, openingEdge, entered, reblocked, beforeRead, afterRead, neighbourhood } };
  } finally { field.destroy(); terrain.clear(); }
}
