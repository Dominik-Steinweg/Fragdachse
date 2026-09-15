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

const view = { x: 0, y: 0, width: 1024, height: 1024 };
const frame = { offsetX: 0, offsetY: 0, width: 1024, height: 1024 };
const layout = { seed: 882, trees: [{ gridX: 8, gridY: 12 }], rocks: [], dirt: [], tracks: [], powerUpPedestals: [],
  water: Array.from({ length: 120 }, (_, i) => ({ gridX: 14 + i % 12, gridY: 8 + Math.floor(i / 12) })) };

describe('retained wildlife rendering', () => {
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

  it('leaves model movement, shot reactions and offscreen semantics identical and owns two layers', () => {
    const harness = wildlifeScene();
    const renderer = new AmbientWildlifeRenderer(harness.scene, frame, layout);
    const model = new AmbientWildlifeModel(layout, frame);
    expect(harness.scene.objects).toHaveLength(2);
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
