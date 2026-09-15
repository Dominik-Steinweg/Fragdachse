import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';
import { setFlagsFromString } from 'node:v8';
import { expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('../AmbientWildlifePhaserHarness')).phaser);

import { phaser, phaserMethods, wildlifeScene } from '../AmbientWildlifePhaserHarness';
import { prepareWildlifeVisuals } from '../../src/arena/AmbientWildlifeGeometry';
import { createAmbientWildlifeLayer } from '../../src/arena/AmbientWildlifeLayer';
import * as appearance from '../../src/arena/AmbientWildlifeAppearance';
import * as config from '../../src/arena/AmbientWildlifeConfig';
import * as model from '../../src/arena/AmbientWildlifeModel';
import { DEPTH } from '../../src/config';

// Opt-in comparison against an explicitly selected Git revision. No historical renderer
// is shipped or kept as a second production implementation.
it.skipIf(!process.env.WILDLIFE_BASELINE)('measures the installed Phaser CPU submission path at equal population', () => {
  const baseline = process.env.WILDLIFE_BASELINE!;
  const source = execFileSync('git', ['show', `${baseline}:src/arena/AmbientWildlifeRenderer.ts`], { encoding: 'utf8' });
  const module = { exports: {} as any };
  const imports: Record<string, unknown> = { phaser, '../config': { DEPTH },
    '../effects/EffectUtils': { registerGraphicsObject: () => {} }, './AmbientWildlifeAppearance': appearance,
    './AmbientWildlifeConfig': config, './AmbientWildlifeModel': model };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, Math, require: (id: string) => {
      if (!(id in imports)) throw new Error(`Unexpected baseline import: ${id}`);
      return imports[id];
    } });
  const Legacy = module.exports.AmbientWildlifeRenderer;
  const seed = new model.AmbientWildlifeModel({ seed: 882, trees: [], rocks: [], dirt: [], tracks: [], powerUpPedestals: [] },
    { offsetX: 0, offsetY: 0, width: 4096, height: 4096 }).animals[0];
  const animals: model.WildlifeAnimal[] = [];
  for (const kind of ['butterfly', 'snake', 'fish'] as const) {
    for (let i = 0; i < config.AMBIENT_WILDLIFE[kind].maxCount; i++) {
      animals.push({ ...seed, kind, x: 80 + i % 12 * 65, y: 80 + Math.floor(i / 12) * 65,
        angle: i * .13, animation: i * .17, variation: (i * .618) % 1, opacity: .7,
        appearance: appearance.createWildlifeAppearance(kind, (i % 3 + .5) / 3, (i * .317) % 1, (i % 3 + .5) / 3) });
    }
  }
  const view = { x: 0, y: 0, width: 1024, height: 1024 };
  const batchMethods = phaserMethods('renderer/webgl/renderNodes/BatchHandlerTriFlat.js', { './BatchHandler': function () {} });
  function sink() {
    // Real installed batch encoder, with driver upload/draw replaced by counters.
    const capacity = 16384, vertexBuffer = new ArrayBuffer(capacity * 3 * 12);
    const result: any = { triangles: 0, flushes: 0, bytes: 0, submissions: 0,
      instanceCount: 0, vertexCount: 0, instancesPerBatch: capacity, verticesPerInstance: 3, indicesPerInstance: 3,
      vertexBufferLayout: { layout: { stride: 12 }, buffer: { viewF32: new Float32Array(vertexBuffer), viewU32: new Uint32Array(vertexBuffer) } },
      indexBuffer: { viewU16: new Uint16Array(capacity * 3) }, manager: { setCurrentBatchNode: () => {} },
      updateRenderOptions: () => {}, _renderOptionsChanged: false,
      run: () => {
        if (!result.instanceCount) return;
        result.flushes++; result.triangles += result.instanceCount;
        result.bytes += result.vertexCount * 12 + result.instanceCount * 3 * 2;
        result.instanceCount = result.vertexCount = 0;
      },
      batch: (...args: any[]) => { result.submissions++; batchMethods.batch.apply(result, args); },
    };
    return result;
  }
  function setup(modern: boolean) {
    const batch = sink(), h = wildlifeScene(batch.batch);
    h.renderer.config.pathDetailThreshold = 1;
    let update: () => void;
    let time = 0;
    if (modern) {
      const visuals = prepareWildlifeVisuals(animals);
      const land = createAmbientWildlifeLayer(h.scene, visuals.filter(v => v.animal.kind !== 'fish'), 1, 'land');
      const fish = createAmbientWildlifeLayer(h.scene, visuals.filter(v => v.animal.kind === 'fish'), 0, 'fish');
      update = () => { time += 1 / 60; land.updatePose(view, time); fish.updatePose(view, time); };
    } else {
      const legacy = Object.assign(Object.create(Legacy.prototype), { destroyed: false, visualTime: 0,
        model: { animals, update: () => {} }, ground: h.scene.add.graphics(), fish: h.scene.add.graphics(),
        snakePose: { x: 0, y: 0, halfWidth: 0 }, fishPose: { x: 0, y: 0, length: 0 } });
      update = () => legacy.update(1000 / 60, [], view);
    }
    return { ...h, update, batch, run: () => {
      update();
      for (const object of h.scene.objects) {
        const render = object.renderWebGL; render(h.renderer, object, h.context);
        batch.run(); // Separate depth lanes, as in the World.
      }
    } };
  }
  const startOld = performance.now(), old = setup(false), oldSetup = performance.now() - startOld;
  const startNew = performance.now(), next = setup(true), newSetup = performance.now() - startNew;
  // Compare actual filled triangle areas per packed color at full path detail. The
  // prepared topology may choose different diagonals but must cover the same contours.
  function areas(h: ReturnType<typeof setup>) {
    const sums = new Map<number, number>();
    const originalBatch = h.scene.nodes.Submitter.batch;
    const detail = h.renderer.config.pathDetailThreshold;
    h.renderer.config.pathDetailThreshold = 0;
    h.scene.nodes.Submitter.batch = (_ctx: unknown, indices: number[], vertices: number[], colors: number[]) => {
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i], b = indices[i + 1], c = indices[i + 2], color = colors[a];
        if (!(color >>> 24)) continue;
        const ax = vertices[a * 2], ay = vertices[a * 2 + 1];
        const area = Math.abs((vertices[b * 2] - ax) * (vertices[c * 2 + 1] - ay)
          - (vertices[c * 2] - ax) * (vertices[b * 2 + 1] - ay)) / 2;
        sums.set(color, (sums.get(color) ?? 0) + area);
      }
    };
    h.run();
    h.scene.nodes.Submitter.batch = originalBatch;
    h.renderer.config.pathDetailThreshold = detail;
    return sums;
  }
  const oldAreas = areas(old), newAreas = areas(next);
  expect([...oldAreas.keys()].sort()).toEqual([...newAreas.keys()].sort());
  for (const [color, area] of oldAreas) expect(Math.abs(newAreas.get(color)! - area) / Math.max(1, area)).toBeLessThan(.0001);
  for (let i = 0; i < 100; i++) { old.run(); next.run(); }
  function measure(h: ReturnType<typeof setup>) {
    const samples: number[] = [];
    h.batch.triangles = h.batch.flushes = h.batch.bytes = h.batch.submissions = 0;
    for (let i = 0; i < 180; i++) {
      for (let a = 0; a < animals.length; a++) animals[a].animation = a * .17 + i * .17;
      const start = performance.now(); h.run(); samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { medianMs: samples[90], p95Ms: samples[171], triangles: h.batch.triangles / 180,
      batchFlushes: h.batch.flushes / 180, uploadBytes: h.batch.bytes / 180, submissions: h.batch.submissions / 180 };
  }
  const before = measure(old), after = measure(next);
  // Measure retained numeric payloads, not an invented process-heap/GPU-memory estimate.
  const counted = new Set<number[]>();
  const meshBytes = next.scene.objects.reduce((sum: number, layer: any) => sum + layer.vertices.byteLength
    + layer.colors.byteLength + layer.indices.byteLength + layer.entries.reduce((total: number, entry: any) => {
      const m = entry.visual.mesh;
      return total + entry.indices.length * 8 + [m.xy, m.channels, m.rgb, m.alpha, m.opacityPower, m.indices]
        .reduce((n, a) => { if (counted.has(a)) return n; counted.add(a); return n + a.length * 8; }, 0)
        + m.poses.length * 4 * 8;
    }, 0), 0);
  const commandBytes = old.scene.objects.reduce((sum: number, g: any) => sum + g.commandBuffer.length * 8, 0);
  setFlagsFromString('--expose_gc');
  const gc = runInNewContext('gc') as () => void;
  function retainedMemory(modern: boolean) {
    const heaps: number[] = [], buffers: number[] = [];
    for (let i = 0; i < 3; i++) {
      gc();
      const start = process.memoryUsage();
      let h: ReturnType<typeof setup> | null = setup(modern);
      h.run(); gc();
      const live = process.memoryUsage();
      heaps.push(live.heapUsed - start.heapUsed); buffers.push(live.arrayBuffers - start.arrayBuffers);
      for (const object of h.scene.objects) object.destroy();
      h = null; gc();
    }
    return { heapBytes: heaps.sort((a, b) => a - b)[1], arrayBufferBytes: buffers.sort((a, b) => a - b)[1] };
  }
  // Includes the same emulated Phaser batch buffers in both cases; excludes browser/driver memory.
  const retainedHeadlessMemory = { before: retainedMemory(false), after: retainedMemory(true) };
  view.x = 10000;
  const culledBefore = measure(old), culledAfter = measure(next);
  const report = { baseline, runtime: process.version, animals: animals.length,
    fishMembers: animals.filter(a => a.kind === 'fish').reduce((n, a) => n + a.appearance.count, 0),
    before, after, culledBefore, culledAfter, retainedHeadlessMemory, setupMs: { before: oldSetup, after: newSetup },
    retainedNumericPayloadBytes: { before: commandBytes, after: meshBytes },
    caveat: 'Headless CPU plus installed batch encoder. Flushes/uploads counted before the GL driver; GPU time and browser/driver memory not measured.' };
  console.log(JSON.stringify(report, null, 2));
  if (process.env.WILDLIFE_REPORT) writeFileSync(process.env.WILDLIFE_REPORT, JSON.stringify(report, null, 2));
  expect(culledAfter.submissions).toBe(0);
  for (const h of [old, next]) for (const object of h.scene.objects) object.destroy();
}, 30000);
