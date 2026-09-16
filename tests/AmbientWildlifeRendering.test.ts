import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./AmbientWildlifePhaserHarness')).phaser);
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: () => {} }));

import { wildlifeScene } from './AmbientWildlifePhaserHarness';
import { prepareWildlifeVisual } from '../src/arena/AmbientWildlifeGeometry';
import { createAmbientWildlifeLayer } from '../src/arena/AmbientWildlifeLayer';
import { AmbientWildlifeRenderer } from '../src/arena/AmbientWildlifeRenderer';
import { AmbientWildlifeModel, type WildlifeAnimal } from '../src/arena/AmbientWildlifeModel';
import { AMBIENT_WILDLIFE as TUNING } from '../src/arena/AmbientWildlifeConfig';
import { createWildlifeAppearance, writeSnakeBodyPose } from '../src/arena/AmbientWildlifeAppearance';
import { DEPTH, DEPTH_LIGHTING } from '../src/config';

const view = { x: 0, y: 0, width: 1024, height: 1024 };
const frame = { offsetX: 0, offsetY: 0, width: 1024, height: 1024 };
const layout = { seed: 882, trees: [{ gridX: 8, gridY: 12 }], rocks: [], dirt: [], tracks: [], powerUpPedestals: [],
  water: Array.from({ length: 120 }, (_, i) => ({ gridX: 14 + i % 12, gridY: 8 + Math.floor(i / 12) })) };

describe('retained wildlife rendering', () => {
  it('illuminates visible fireflies and releases lights on culling, dawn and teardown', () => {
    const harness = wildlifeScene();
    const renderer = new AmbientWildlifeRenderer(harness.scene, frame, layout);
    const lighting = { setLight: vi.fn(), releaseLight: vi.fn() };
    const update = (minutes = 0, camera = view) => renderer.update(50, [], camera, minutes, lighting);
    update();
    expect(lighting.setLight.mock.calls.length).toBeGreaterThan(0);
    const [key, preset, x, y, overrides] = lighting.setLight.mock.calls[0];
    expect(preset).toBe('firefly');
    expect(renderer.model.animals.some(a => a.kind === 'firefly' && a.x === x && a.y === y)).toBe(true);
    expect(overrides.intensity).toBeGreaterThan(0);
    update(0, { ...view, x: 10000 });
    expect(lighting.releaseLight).toHaveBeenCalledWith(key, { immediate: true });
    lighting.releaseLight.mockClear();
    update();
    for (let i = 0; i < 200; i++) update(12 * 60);
    expect(lighting.releaseLight).toHaveBeenCalledWith(key, { immediate: true });
    for (let i = 0; i < 200; i++) update();
    lighting.releaseLight.mockClear();
    renderer.clearLights();
    expect(lighting.releaseLight).toHaveBeenCalledWith(key, { immediate: true });
    update();
    lighting.releaseLight.mockClear();
    renderer.destroy();
    expect(lighting.releaseLight).toHaveBeenCalledWith(key, { immediate: true });
    const releases = lighting.releaseLight.mock.calls.length;
    renderer.destroy(); update();
    expect(lighting.releaseLight).toHaveBeenCalledTimes(releases);
  });

  it.each(['butterfly', 'moth', 'firefly'] as const)('fades the entire %s silhouette and halo', kind => {
    const animal = new AmbientWildlifeModel(layout, frame).animals.find(a => a.kind === kind)!;
    const batches: number[][] = [];
    const harness = wildlifeScene((_ctx, indices, _vertices, colors) =>
      batches.push(Array.from(indices, i => colors[i] >>> 24)));
    const layer = createAmbientWildlifeLayer(harness.scene, [prepareWildlifeVisual(animal)], 4, 'test');
    animal.opacity = 1;
    layer.updatePose(view, 0); harness.render();
    animal.opacity = .5;
    layer.updatePose(view, 0); harness.render();
    expect(batches[0].some(alpha => alpha > 0)).toBe(true);
    expect(batches[1].every((alpha, i) => Math.abs(alpha - batches[0][i] / 2) <= 1)).toBe(true);
    animal.opacity = 0;
    layer.updatePose(view, 0); harness.render();
    expect(batches).toHaveLength(2);
    layer.destroy();
  });

  it('culls before sampling, reuses topology, and resumes at the current phase without a stale frame', () => {
    const animal = new AmbientWildlifeModel(layout, frame).animals[0];
    const visual = prepareWildlifeVisual(animal), sample = vi.spyOn(visual, 'sample');
    const batches: number[][] = [];
    const harness = wildlifeScene((_ctx, indices, vertices) => batches.push(Array.from(indices, i => vertices[i * 2 + 1])));
    const layer = createAmbientWildlifeLayer(harness.scene, [visual], 4, 'test');
    const topology = [...visual.mesh.indices], coordinates = [...visual.mesh.xy];
    layer.updatePose(view, 0); harness.render();
    expect(batches).toHaveLength(1);
    layer.updatePose({ ...view, x: 10000 }, 1); harness.render();
    expect(batches).toHaveLength(1);
    expect(sample).toHaveBeenCalledTimes(1);
    animal.animation += .371;
    layer.updatePose(view, 2); harness.render();
    expect(sample).toHaveBeenLastCalledWith(2);
    expect(batches).toHaveLength(2);
    expect(batches[1]).not.toEqual(batches[0]);
    expect(visual.mesh.indices).toEqual(topology);
    expect(visual.mesh.xy).toEqual(coordinates);
    layer.destroy(); layer.destroy(); harness.render();
    expect(batches).toHaveLength(2);
  });

  it('keeps snake ribbon cross-sections on the existing continuous body wave for all sizes', () => {
    const original = new AmbientWildlifeModel(layout, frame).animals[0];
    for (let size = 0; size < TUNING.snakeSizes.length; size++) {
      const animal = { ...original, kind: 'snake', appearance: createWildlifeAppearance('snake',
        (size + .5) / TUNING.snakeSizes.length, .5, 0) } as WildlifeAnimal;
      const { mesh, sample } = prepareWildlifeVisual(animal);
      const pose = { x: 0, y: 0, halfWidth: 0 };
      for (const phase of [0, .117, 1.3, 6.2, 50]) {
        animal.animation = phase; sample(phase);
        for (let i = 0; i <= TUNING.snakeVisual.segments; i++) {
          writeSnakeBodyPose(animal.appearance, phase, i / TUNING.snakeVisual.segments, pose);
          expect(mesh.poses[i].y).toBeCloseTo(pose.y, 12);
        }
      }
      expect(mesh.indices.every(i => i >= 0 && i < mesh.channels.length)).toBe(true);
    }
  });

  it('preserves model semantics and owns self-lit fireflies below the canopies', () => {
    const harness = wildlifeScene();
    const renderer = new AmbientWildlifeRenderer(harness.scene, frame, layout);
    const model = new AmbientWildlifeModel(layout, frame);
    const glow = harness.scene.objects.find((o: any) => o.name === 'ambient-wildlife-fireflies');
    expect(glow.depth).toBeGreaterThan(DEPTH_LIGHTING);
    expect(glow.depth).toBeLessThan(DEPTH.CANOPY);
    for (let i = 0; i < 30; i++) {
      const players = [{ id: 'p', x: 350 + i, y: 400 }];
      if (i === 5) { renderer.notifyShot(400, 400); model.notifyShot(400, 400); }
      const camera = i > 10 && i < 20 ? { ...view, x: 10000 } : view;
      renderer.update(16, players, camera); model.update(16, players, camera);
      expect(renderer.model.animals).toEqual(model.animals);
    }
    renderer.destroy(); renderer.destroy();
    expect(harness.scene.objects.every((object: any) => !object.active)).toBe(true);
  });
});
