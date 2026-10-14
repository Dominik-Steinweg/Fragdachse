import { describe, expect, it, vi } from 'vitest';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';
import type { ResolvedCoopDefenseMapMissionProgressConfig } from '../src/config/coopDefenseMaps';
import type { CoopDefenseMissionProgressPresentationState } from '../src/types';
import { AutoTiler, MISSION_BARRIER_AUTOTILE } from '../src/arena/AutoTiler';

vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));
vi.mock('phaser', () => ({}));

import { CoopDefenseMissionProgressRenderer } from '../src/effects/CoopDefenseMissionProgressRenderer';

interface Quad {
  visible: boolean;
  x: number; y: number; width: number; height: number; depth: number;
  destroyed: boolean;
  uniforms(zoom?: number): Record<string, number | number[]>;
}

interface BarrierImage {
  x: number; y: number; texture: string; frame: number;
  width: number; height: number; depth: number; destroyed: boolean;
}

function makeConfig(): ResolvedCoopDefenseMapMissionProgressConfig {
  return {
    checkpoints: [
      { id: 'entry', gridX: 4, gridY: 5, radiusCells: 3, setRespawn: true },
      { id: 'middle', gridX: 14, gridY: 6, radiusCells: 4, setRespawn: true },
      { id: 'exit', gridX: 24, gridY: 7, radiusCells: 5, setRespawn: true },
    ],
    barriers: [{ id: 'gate', cells: [{ gridX: 10, gridY: 5 }], openOn: { type: 'after-checkpoint', checkpointId: 'entry' } }],
    mandatoryDefenses: [],
  };
}

function makeState(): CoopDefenseMissionProgressPresentationState {
  return {
    roundRevision: 1, missionRevision: 0, activatedCheckpoints: [], nextCheckpointId: 'entry',
    completedCheckpoints: [],
    respawnCheckpointId: null, routeLockDefenseId: null, resolvedDefenses: [],
    barriers: [{ barrierId: 'gate', open: false }], routeComplete: false,
  };
}

function setup(webgl = true) {
  const quads: Quad[] = [];
  const images: BarrierImage[] = [];
  const scene = {
    sys: { renderer: webgl ? { gl: {} } : {} },
    add: {
      existing: (quad: Quad) => { quads.push(quad); },
      image: (x: number, y: number, texture: string, frame: number) => {
        const image = {
          x, y, texture, frame, width: 0, height: 0, depth: 0, destroyed: false,
          setFrame(value: number) { this.frame = value; return this; },
          setDisplaySize(width: number, height: number) { this.width = width; this.height = height; return this; },
          setDepth(value: number) { this.depth = value; return this; },
          destroy() { this.destroyed = true; },
        };
        images.push(image);
        return image;
      },
    },
  };
  return { renderer: new CoopDefenseMissionProgressRenderer(scene as never), quads, images };
}

describe('CoopDefenseMissionProgressRenderer', () => {
  it('clears barriers on detach and replaces them on a new round', () => {
    const { renderer, images, quads } = setup();
    const config = makeConfig(), state = makeState();
    renderer.sync(config, state, 0, true);
    expect(quads).toHaveLength(0); // marker batches are owned by MarkerSystem
    expect(images).toHaveLength(1);
    renderer.sync(config, { ...state, roundRevision: 2 }, 0, true);
    expect(images[0].destroyed).toBe(true);
    expect(images[1].destroyed).toBe(false);
    renderer.sync(config, state, 0, false);
    expect(images.every(i => i.destroyed)).toBe(true);
    renderer.destroy(); renderer.sync(config, state, 0, true);
    expect(images).toHaveLength(2);
  });

  it('joins closed gates, reuses images and exposes new end caps when a neighbour opens', () => {
    const { renderer, images } = setup();
    const baseConfig = makeConfig();
    const config = { ...baseConfig, barriers: [
      { ...baseConfig.barriers[0], cells: [{ gridX: 10, gridY: 5 }, { gridX: 10, gridY: 6 }] },
      { ...baseConfig.barriers[0], id: 'other', cells: [{ gridX: 11, gridY: 6 }] },
    ] };
    const state = makeState();
    state.barriers.push({ barrierId: 'other', open: false });
    renderer.sync(config, state, 0, true);
    expect(images).toHaveLength(3);
    expect(images[0]).toMatchObject({
      x: ARENA_OFFSET_X + 10.5 * CELL_SIZE, y: ARENA_OFFSET_Y + 5.5 * CELL_SIZE,
      width: CELL_SIZE, height: CELL_SIZE, texture: 'mission_barrier',
      frame: AutoTiler.getFrame(16, MISSION_BARRIER_AUTOTILE),
    });
    expect(images[1].frame).toBe(AutoTiler.getFrame(1 | 4, MISSION_BARRIER_AUTOTILE));
    expect(images[2].frame).toBe(AutoTiler.getFrame(64, MISSION_BARRIER_AUTOTILE));
    renderer.sync(config, { ...state }, 100, true);
    expect(images).toHaveLength(3);

    renderer.sync(config, { ...state, missionRevision: 1, barriers: [
      { barrierId: 'gate', open: true }, { barrierId: 'other', open: false },
    ] }, 200, true);
    expect(images).toHaveLength(3);
    expect(images.slice(0, 2).every(image => image.destroyed)).toBe(true);
    expect(images[2]).toMatchObject({ destroyed: false, frame: AutoTiler.getFrame(0, MISSION_BARRIER_AUTOTILE) });
    renderer.destroy();
    expect(images.every(image => image.destroyed)).toBe(true);
  });

  it('does not create barrier images for gates already open on a late join', () => {
    const { renderer, images } = setup();
    const state = makeState();
    state.barriers = [{ barrierId: 'gate', open: true }];
    renderer.sync(makeConfig(), state, 500, true);
    expect(images).toHaveLength(0);
  });

  it('does not allocate shader objects without WebGL', () => {
    const { renderer, quads } = setup(false);
    renderer.sync(makeConfig(), makeState(), 0, true);
    expect(quads).toHaveLength(0);
    renderer.destroy();
  });
});
