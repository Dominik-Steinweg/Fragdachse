import type * as Phaser from 'phaser';
import { FogGpuField } from '../effects/groundFog/FogGpuField';
import { FogTerrainModel } from '../effects/groundFog/FogTerrainModel';
import { FOG, fogTuning } from '../effects/groundFog/FogConfig';
import { createWeaponFogTrailProfile } from '../effects/groundFog/WeaponFogTrail';

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
    field.step([{ x: 50, y: 100, endX: 150, endY: 100, radius: 4, strength: FOG.smallProjectileStrength, priority: 10, kind: 'projectile' }], [.8, .8], tuning, time += FOG.stepMs);
    field.render(view, 512, 256, 'normal', 1);
    const fineTrail = field.readTrail(100, 100), outsideTrail = field.readTrail(100, 116);
    steps(30); field.render(view, 512, 256, 'normal', 1);
    const sustainedTrail = field.readTrail(100, 100);
    steps(Math.ceil(FOG.trailMs / FOG.stepMs)); field.render(view, 512, 256, 'normal', 1);
    const expiredTrail = field.readTrail(100, 100);
    for (let i = 0; i < 40; i++) {
      const point = (n: number) => ({ x: 50 + n * 9, y: 330 - n * 5, timeMs: n * 20, sequence: n + 1, vx: 450, vy: -250 });
      field.trails.addPath({ from: point(i), to: point(i + 1), ageMs: 800 - (i + 1) * 20 }, 71, time);
    }
    steps(1); field.render(view, 512, 256, 'normal', 1);
    const diagonalTrace = Array.from({ length: 19 }, (_, i) => field.readTrail(50 + (i + 1) * 18, 330 - (i + 1) * 10));
    const joinedTraceCount = field.trails.size;
    const frontBefore = field.readDensity(140, 220).density, backBefore = field.readDensity(60, 220).density;
    field.prepare(view, time);
    field.step([{ x: 100, y: 220, endX: 101, endY: 220, radius: 100, arcDegrees: 90, strength: .85, kind: 'melee', priority: 80 }], [.8, .8], tuning, time += FOG.stepMs);
    const frontAfter = field.readDensity(140, 220).density, backAfter = field.readDensity(60, 220).density;
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
    const obstacleFlow = checkObstacleFlow(scene);
    const traceLoad = checkTraceLoad(field, view, tuning, time);
    const weaponProfiles = checkWeaponProfiles(field, view, tuning, time);
    const softTraces = checkSoftTraces(field, view, tuning, time);
    const checks = {
      ...obstacleFlow.checks,
      ...traceLoad.checks,
      ...weaponProfiles.checks,
      ...softTraces.checks,
      cachedTerrainEditsPreserveOtherCells: cachedBefore.density === cachedAfter.density,
      cachedEditsAppliedBeforeResume: reopenedCached.density === 0 && !reopenedCached.reached && blockedCached.density === 0,
      thinTraceWithoutWideLane: fineTrail > 0 && outsideTrail === 0,
      smallTraceSurvivesOneSecond: sustainedTrail > .02,
      diagonalTraceHasNoGaps: diagonalTrace.every(v => v > .1),
      straightPathUsesOneTrace: joinedTraceCount === 1,
      traceExpiresOnGpu: expiredTrail === 0,
      meleeOnlyClearsFacingSector: frontAfter < frontBefore * .7 && backAfter > backBefore * .8,
      velocityEncodingPreservesWind: Math.abs(initialVelocity[0] - tuning.windX) < .05 && Math.abs(initialVelocity[1]) < .05,
      boundedFiniteFlow: neighbourhood.every(p => p.velocity.every(Number.isFinite) && Math.abs(p.velocity[0]) + Math.abs(p.velocity[1]) <= FOG.maxSpeed + .01),
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
      readings: { initial, initialVelocity, wall, isolated, openingCenter, openingEdge, entered, reblocked, beforeRead, afterRead, neighbourhood,
        fineTrail, sustainedTrail, expiredTrail, diagonalTrace, joinedTraceCount, frontBefore, frontAfter, backBefore, backAfter, obstacleFlow: obstacleFlow.readings, traceLoad: traceLoad.readings, weaponProfiles: weaponProfiles.readings, softTraces: softTraces.readings } };
  } finally { field.destroy(); terrain.clear(); }
}

/** Compare the same seeded flow with/without a finite wall, beyond its first grid row. */
function checkObstacleFlow(scene: Phaser.Scene) {
  const frame = { offsetX: 0, offsetY: 0, width: 512, height: 512 };
  const view = { x: 0, y: 0, width: 512, height: 512 };
  const tuning = { ...fogTuning(183), windX: 24, windY: 0 };
  const baseline = new FogTerrainModel(frame, []), blocked = new FogTerrainModel(frame, []);
  blocked.setObstacle('rock', Array.from({ length: 12 }, (_, i) => ({ gridX: 10 + i % 2, gridY: 5 + Math.floor(i / 2) })), true);
  const control = new FogGpuField(scene, baseline, 183, tuning, 0);
  const obstacle = new FogGpuField(scene, blocked, 183, tuning, 0);
  try {
    for (let i = 0; i < 360; i++) for (const field of [control, obstacle]) {
      field.prepare(view, i * FOG.stepMs); field.step([], [.8, .8], tuning, (i + 1) * FOG.stepMs);
    }
    const band = [244, 276, 300].map(x => ({ x, extraDensity: [208, 240, 272].reduce((sum, y) =>
      sum + obstacle.readDensity(x, y).density - control.readDensity(x, y).density, 0) / 3 }));
    const corner = [308, 332, 356].map(x => ({ x, withRock: obstacle.readVelocity(x, 148), withoutRock: control.readVelocity(x, 148) }));
    return { checks: {
      accumulationExtendsBeyondFirstRow: band.filter(p => p.x <= 276).some(p => p.extraDensity > .01),
      cornerFlowIsDeflected: corner.some(p => Math.abs(p.withRock[1]) > Math.abs(p.withoutRock[1]) + 1),
    }, readings: { band, corner } };
  } finally { control.destroy(); obstacle.destroy(); baseline.clear(); blocked.clear(); }
}

/** Controlled readbacks are outside all performance runs. Includes the old 64/tile failure. */
function checkTraceLoad(field: FogGpuField, view: { x: number; y: number; width: number; height: number }, tuning: ReturnType<typeof fogTuning>, start: number) {
  field.trails.clear();
  const input = { x: 20, y: 100, endX: 460, endY: 100, radius: 5, strength: FOG.smallProjectileStrength, kind: 'projectile' as const, priority: 10 };
  const render = (now: number): void => { field.step([], [.8, .8], tuning, now); field.render(view, 1024, 512, 'normal', 1); };
  field.trails.add(input, start); render(start);
  const single = field.readTrail(40, 100);
  field.trails.add(input, start); render(start);
  const duplicate = field.readTrail(40, 100);
  render(start + 1000); const oldBefore = field.readTrail(40, 100);
  for (let i = 0; i < 768; i++) field.trails.add({ ...input, x: 80, y: 90 + i % 30, endY: 90 + i % 30 }, start + 1000);
  render(start + 1000);
  const oldAfter = field.readTrail(40, 100), newest = field.readTrail(300, 90), traceCount = field.trails.size;
  const p = (x: number, timeMs: number) => ({ x, y: 400, timeMs, sequence: 1, vx: 100, vy: 0 });
  field.trails.addPath({ from: p(30, 0), to: p(100, 100), ageMs: 0 }, 812,
    start + 1000, { radius: 10, strength: .7, lifeMs: FOG.trailMs, decayMs: FOG.trailDecayMs });
  field.trails.addPath({ from: p(100, 100), to: p(300, 500), ageMs: 0 }, 812,
    start + 1400, { radius: 50, strength: .7, lifeMs: FOG.trailMs, decayMs: FOG.trailDecayMs });
  render(start + 1400);
  const narrow = field.readTrail(60, 425), wide = field.readTrail(285, 425);
  field.trails.add({ ...input, x: 100, endX: 450, y: 300, endY: 300 }, start + 1400,
    { radius: 55, strength: .8, lifeMs: FOG.trainTrailMs, decayMs: FOG.trainTrailDecayMs });
  render(start + 1400 + FOG.trailMs + 500);
  const train = field.readTrail(200, 330), bulletGone = field.readTrail(40, 100);
  render(start + 1400 + FOG.trainTrailMs + 1);
  const trainGone = field.readTrail(200, 330);
  field.trails.clear();
  const cappedTime = start + 1400 + FOG.trainTrailMs + 100;
  field.trails.addPath({ from: p(30, 0), to: p(100, 20), ageMs: 0 }, 900, cappedTime);
  field.trails.addPath({ from: p(100, 20), to: p(300, 200), ageMs: 0 }, 900, cappedTime + 66);
  render(cappedTime + 66);
  const cappedTip = field.readTrail(295, 400);
  return { checks: {
    overlappingCapsulesPreserveSingleTrace: single > .1 && Math.abs(single - duplicate) <= 1 / 255,
    crowdedTileRetainsOlderTrace: oldAfter === oldBefore && oldAfter > .1 && newest > .1 && traceCount === 770,
    streamWidthGrowsAlongPath: narrow === 0 && wide > .1,
    trainWakeOutlastsSmallTraces: train > .1 && bulletGone === 0,
    trainWakeExpires: trainGone === 0,
    cappedClockKeepsTraceTip: cappedTip > .1,
  }, readings: { single, duplicate, oldBefore, oldAfter, newest, traceCount, narrow, wide, train, bulletGone, trainGone, cappedTip } };
}

function checkWeaponProfiles(field: FogGpuField, view: { x: number; y: number; width: number; height: number }, tuning: ReturnType<typeof fogTuning>, start: number) {
  field.trails.clear();
  const point = (x: number, y: number) => ({ x, y, timeMs: 0, sequence: 1, vx: 0, vy: 0 });
  const add = (y: number, id: number, width: number, duration: number, arc?: number) => {
    const profile = createWeaponFogTrailProfile(arc ? 100 : 10, .8, { fogTrailWidthFactor: width, fogTrailDurationFactor: duration }, arc)!;
    field.trails.addPath({ from: point(100, y), to: point(arc ? 132 : 450, y), ageMs: 0 }, id, start, profile);
  };
  const render = (now: number, quality: 'high' | 'low' = 'high') => {
    field.step([], [.8, .8], tuning, now); field.render(view, 1024, 512, 'normal', 1, [], quality);
  };
  add(60, 1, 1, 1); add(140, 2, 2, 1); add(220, 3, 1, 2); add(340, 4, 1, 2, 90);
  render(start);
  const narrowOutside = field.readTrail(200, 80), wideInside = field.readTrail(200, 160);
  const front = field.readTrail(140, 340), behind = field.readTrail(60, 340), side = field.readTrail(100, 380);
  render(start, 'low');
  const lowMelee = field.readTrail(140, 340), lowProjectile = field.readTrail(200, 60);
  render(start + FOG.trailMs + 100);
  const normalExpired = field.readTrail(200, 60), extended = field.readTrail(200, 220), extendedMelee = field.readTrail(140, 340);
  render(start + FOG.trailMs * 2 + 100);
  const allExpired = field.readTrail(200, 220) === 0 && field.readTrail(140, 340) === 0;
  return { checks: {
    weaponWidthFactorReachesGpu: narrowOutside === 0 && wideInside > .01,
    weaponDurationFactorReachesGpu: normalExpired === 0 && extended > .01 && extendedMelee > .01 && allExpired,
    analyticalMeleeFacesForward: front > .1 && behind === 0 && side === 0,
    lowQualityKeepsMeleeButHidesProjectiles: lowMelee > .1 && lowProjectile === 0,
  }, readings: { narrowOutside, wideInside, front, behind, side, lowMelee, lowProjectile, normalExpired, extended, extendedMelee, allExpired } };
}

/** Shape contracts use relative gradients, not a fixed material opacity. */
function checkSoftTraces(field: FogGpuField, view: { x: number; y: number; width: number; height: number }, tuning: ReturnType<typeof fogTuning>, start: number) {
  const render = () => { field.step([], [.8, .8], tuning, start); field.render(view, 1024, 512, 'normal', 1); };
  const profile = { radius: 12, strength: .8, lifeMs: FOG.trailMs, decayMs: FOG.trailDecayMs };
  const point = (x: number, y: number, timeMs: number, flags = {}) => ({ x, y, timeMs, sequence: 1, vx: 100, vy: 0, ...flags });
  const decreases = (values: number[]) => values.every((value, i) => i === 0 || value < values[i - 1]);
  field.trails.clear();
  field.trails.addPath({ from: point(100, 80, 0), to: point(400, 80, 0), ageMs: 0 }, 1, start, profile);
  render();
  const radial = [0, 6, 12, 18, 24].map(offset => field.readTrail(250, 80 + offset));
  const head = [150, 125, 110, 100, 90, 76].map(x => field.readTrail(x, 80));
  const tail = [350, 375, 390, 400, 410, 424].map(x => field.readTrail(x, 80));

  // A continuous path split only by upload duration must match the unsplit GPU result.
  field.trails.clear();
  field.trails.addPath({ from: point(100, 80, 0), to: point(400, 80, 2000), ageMs: 0 }, 2, start, profile);
  render(); const referenceJoin = field.readTrail(250, 80);
  field.trails.clear();
  const first = { from: point(100, 80, 0), to: point(250, 80, 1000), ageMs: 1000 };
  field.trails.addPath(first, 3, start, profile);
  field.trails.addPath({ from: point(250, 80, 1000), to: point(400, 80, 2000), ageMs: 0 }, 3, start, profile);
  render(); const batchJoin = field.readTrail(250, 80), batchCount = field.trails.size;
  field.trails.clear();
  field.trails.addPath(first, 4, start, profile);
  field.trails.addPath({ from: point(250, 80, 1000, { bounceSequence: 1 }), to: point(350, 180, 2000), ageMs: 0 }, 4, start, profile);
  render(); const bounceJoin = field.readTrail(250, 80), bounceCount = field.trails.size;
  field.trails.clear();
  field.trails.addPath(first, 5, start, profile);
  field.trails.addPath({ from: point(250, 80, 1000, { breakBefore: true }), to: point(400, 80, 2000), ageMs: 0 }, 5, start, profile);
  render(); const interruptedJoin = field.readTrail(250, 80);

  field.trails.clear();
  field.trails.addPath({ from: point(100, 340, 0), to: point(132, 340, 0), ageMs: 0 }, 6, start, { ...profile, radius: 80, arcDegrees: 90 });
  render();
  const meleeAngles = [0, 25, 35, 44, 50].map(angle => field.readTrail(100 + Math.cos(angle * Math.PI / 180) * 50, 340 + Math.sin(angle * Math.PI / 180) * 50));
  const meleeRadial = [20, 40, 60, 100, 150].map(radius => field.readTrail(100 + radius, 340));
  return { checks: {
    traceEdgesFadeContinuously: decreases(radial) && radial[3] > 0 && radial[4] === 0,
    traceStartAndEndFadeContinuously: decreases(head) && decreases(tail) && head[4] > 0 && tail[4] > 0 && head[5] === 0 && tail[5] === 0,
    batchBoundaryDoesNotFeather: batchCount === 2 && referenceJoin > .1 && Math.abs(batchJoin - referenceJoin) <= 1 / 255,
    bouncePivotDoesNotFeather: bounceCount === 2 && Math.abs(bounceJoin - referenceJoin) <= 2 / 255,
    pathInterruptionRestoresEndFeathers: interruptedJoin > 0 && interruptedJoin < batchJoin * .9,
    meleeHasSoftAngularAndRadialEdges: decreases(meleeAngles) && decreases(meleeRadial) && meleeAngles[4] === 0 && meleeRadial[4] === 0,
  }, readings: { radial, head, tail, referenceJoin, batchJoin, batchCount, bounceJoin, bounceCount, interruptedJoin, meleeAngles, meleeRadial } };
}
