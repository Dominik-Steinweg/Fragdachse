import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, DEPTH } from '../src/config';
import type { ResolvedCoopDefenseMapMissionProgressConfig } from '../src/config/coopDefenseMaps';
import type { CoopDefenseMissionProgressPresentationState } from '../src/types';
import { CHECKPOINT_ACTIVATION_MS, CHECKPOINT_COMPLETION_MS } from '../src/effects/checkpointMarkerShader';
import { AutoTiler, MISSION_BARRIER_AUTOTILE } from '../src/arena/AutoTiler';

const quality = vi.hoisted(() => ({ level: 'high' }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityProfile: () => quality }));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));
vi.mock('phaser', () => {
  class Shader {
    depth = 0;
    originX = 0.5;
    originY = 0.5;
    destroyed = false;
    visible = true;
    constructor(
      public scene: unknown,
      public config: { setupUniforms: (set: (name: string, value: unknown) => void, context: unknown) => void },
      public x: number, public y: number, public width: number, public height: number,
    ) {}
    setOrigin(v: number) { this.originX = v; this.originY = v; return this; }
    setDepth(v: number) { this.depth = v; return this; }
    setBlendMode() { return this; }
    setVisible(value: boolean) { this.visible = value; return this; }
    destroy() { this.destroyed = true; }
    uniforms(zoom = 1): Record<string, number | number[]> {
      const values: Record<string, number | number[]> = {};
      this.config.setupUniforms((name, value) => {
        values[name] = value instanceof Float32Array ? Array.from(value) : value as number;
      }, { camera: { zoomX: zoom, zoomY: zoom } });
      return values;
    }
  }
  return { GameObjects: { Shader }, BlendModes: { NORMAL: 0 } };
});

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

beforeEach(() => { quality.level = 'high'; });

describe('CoopDefenseMissionProgressRenderer', () => {
  it('uses authored world geometry with padded bounds below actors, and marks only the route end as extraction', () => {
    const { renderer, quads } = setup();
    const config = makeConfig();
    renderer.sync(config, makeState(), 0, true);
    expect(quads).toHaveLength(config.checkpoints.length);
    config.checkpoints.forEach((checkpoint, index) => {
      const quad = quads[index];
      expect(quad.x).toBe(ARENA_OFFSET_X + (checkpoint.gridX + 0.5) * CELL_SIZE);
      expect(quad.y).toBe(ARENA_OFFSET_Y + (checkpoint.gridY + 0.5) * CELL_SIZE);
      expect(quad.uniforms().uRadius).toBe(checkpoint.radiusCells * CELL_SIZE);
      expect(quad.width).toBeGreaterThan(checkpoint.radiusCells * CELL_SIZE * 2);
      expect(quad.height).toBe(quad.width);
      expect(quad.depth).toBeGreaterThan(DEPTH.DECALS);
      expect(quad.depth).toBeLessThan(Math.min(DEPTH.ROCKS, DEPTH.PLAYERS));
      expect(quad.uniforms().uExtraction).toBe(index === config.checkpoints.length - 1 ? 1 : 0);
    });
  });

  it('advances animation and quality without new snapshots or replacing quads', () => {
    const { renderer, quads } = setup();
    const config = makeConfig();
    const state = makeState();
    renderer.sync(config, state, 100, true);
    const first = quads[0];
    const high = first.uniforms();
    quality.level = 'medium';
    renderer.sync(config, state, 300, true);
    const medium = first.uniforms();
    expect(medium.uTime).toBeGreaterThan(high.uTime);
    expect(medium.uAmbientCount).toBeGreaterThan(0);
    expect(medium.uAmbientCount).toBeLessThan(high.uAmbientCount);
    expect(medium.uBurstCount).toBeLessThan(high.uBurstCount);
    quality.level = 'low';
    renderer.sync(config, state, 500, true);
    expect(first.uniforms()).toMatchObject({ uAmbientCount: 0, uBurstCount: 0, uNext: 1 });
    expect(first.uniforms().uOpacity).toBeGreaterThan(0);
    expect(first.uniforms(2).uPixelSize).toBeLessThan(first.uniforms(1).uPixelSize);
    expect(quads).toHaveLength(config.checkpoints.length);
    expect(first.destroyed).toBe(false);
  });

  it('hides future checkpoints and distinguishes available, active and completed markers for late readers', () => {
    const { renderer, quads } = setup();
    const config = makeConfig();
    const state = makeState();
    renderer.sync(config, state, 0, true);
    expect(quads.map(quad => quad.visible)).toEqual([true, false, false]);
    const available = quads[0].uniforms().uColor;
    state.missionRevision++;
    state.activatedCheckpoints = [{ checkpointId: 'entry', activatedAtRoundMs: 100 }];
    state.nextCheckpointId = null;
    renderer.sync(config, state, 200, true);
    const active = quads[0].uniforms().uColor as number[];
    expect(active).not.toEqual(available);
    expect(active[2]).toBeGreaterThan(active[0]);
    expect(quads[1].visible).toBe(false);
    state.missionRevision++;
    state.completedCheckpoints = [{ checkpointId: 'entry', completedAtRoundMs: 300 }];
    state.nextCheckpointId = 'middle';
    renderer.sync(config, state, 400, true);
    const completed = quads[0].uniforms().uColor as number[];
    expect(completed[1]).toBeGreaterThan(completed[0]);
    expect(completed[1]).toBeGreaterThan(completed[2]);
    expect(quads.map(quad => quad.visible)).toEqual([true, true, false]);
    const late = setup();
    late.renderer.sync(config, state, 10_000, true);
    expect(late.quads.map(quad => quad.visible)).toEqual([true, true, false]);
    expect(late.quads[0].uniforms().uColor).toEqual(completed);
  });

  it('derives acquisition feedback from the authoritative timestamp, including late joins and repeated snapshots', () => {
    const { renderer, quads, images } = setup();
    const config = makeConfig();
    const state = makeState();
    renderer.sync(config, state, 0, true);
    const waiting = quads[0].uniforms();
    expect(waiting).toMatchObject({ uNext: 1, uActivationAge: -1 });
    expect(images.filter(image => !image.destroyed)).toHaveLength(config.barriers[0].cells.length);
    const activatedAt = 5_000;
    state.missionRevision++;
    state.activatedCheckpoints = [{ checkpointId: 'entry', activatedAtRoundMs: activatedAt }];
    state.nextCheckpointId = null;
    state.barriers = [{ barrierId: 'gate', open: true }];
    renderer.sync(config, state, activatedAt + CHECKPOINT_ACTIVATION_MS * 0.2, true);
    const justReached = quads[0].uniforms();
    expect(justReached.uNext).toBe(0);
    expect(justReached.uActivationAge).toBeCloseTo(0.2);
    expect(justReached.uColor).not.toEqual(waiting.uColor);
    expect(quads[1].uniforms().uNext).toBe(0);
    expect(images.every(image => image.destroyed)).toBe(true);
    renderer.sync(config, { ...state }, activatedAt + CHECKPOINT_ACTIVATION_MS * 0.6, true);
    expect(quads[0].uniforms().uActivationAge).toBeCloseTo(0.6);
    const late = setup();
    late.renderer.sync(config, state, activatedAt + CHECKPOINT_ACTIVATION_MS * 0.6, true);
    expect(late.quads[0].uniforms().uActivationAge).toBeCloseTo(0.6);
    renderer.sync(config, state, activatedAt + CHECKPOINT_ACTIVATION_MS, true);
    expect(quads[0].uniforms().uActivationAge).toBe(-1);
    expect(quads[0].uniforms().uOpacity).toBeLessThan(waiting.uOpacity);
    const old = setup();
    old.renderer.sync(config, state, activatedAt + CHECKPOINT_ACTIVATION_MS * 10, true);
    expect(old.quads[0].uniforms().uActivationAge).toBe(-1);
  });

  it('plays completion from host time without replaying on repeated snapshots, late join or visibility changes', () => {
    const { renderer, quads } = setup();
    const config = makeConfig();
    const state = makeState();
    state.activatedCheckpoints = [{ checkpointId: 'entry', activatedAtRoundMs: 100 }];
    state.nextCheckpointId = null;
    renderer.sync(config, state, 200, true);
    expect(quads[0].uniforms().uCompletionAge).toBe(-1);
    const completedAt = 10_000;
    state.missionRevision++;
    state.completedCheckpoints = [{ checkpointId: 'entry', completedAtRoundMs: completedAt }];
    state.nextCheckpointId = 'middle';
    renderer.sync(config, state, completedAt - 1, true);
    expect(quads[0].uniforms().uCompletionAge).toBe(-1);
    renderer.sync(config, state, completedAt, true);
    expect(quads[0].uniforms()).toMatchObject({ uCompletionAge: 0, uActivationAge: -1 });
    renderer.sync(config, { ...state }, completedAt + CHECKPOINT_COMPLETION_MS * 0.4, true);
    expect(quads[0].uniforms().uCompletionAge).toBeCloseTo(0.4);
    const late = setup();
    late.renderer.sync(config, state, completedAt + CHECKPOINT_COMPLETION_MS * 0.4, true);
    expect(late.quads[0].uniforms().uCompletionAge).toBeCloseTo(0.4);
    quality.level = 'low';
    renderer.sync(config, state, completedAt + CHECKPOINT_COMPLETION_MS * 0.6, true);
    expect(quads[0].uniforms()).toMatchObject({ uBurstCount: 0, uCompletionAge: 0.6 });
    expect(quads).toHaveLength(config.checkpoints.length);
    renderer.sync(config, state, completedAt + CHECKPOINT_COMPLETION_MS, true);
    expect(quads[0].uniforms().uCompletionAge).toBe(-1);
    renderer.sync(config, state, completedAt + CHECKPOINT_COMPLETION_MS, false);
    expect(quads.every(quad => quad.destroyed)).toBe(true);
    renderer.sync(config, state, completedAt + CHECKPOINT_COMPLETION_MS * 2, true);
    expect(quads[config.checkpoints.length].uniforms().uCompletionAge).toBe(-1);
    const old = setup();
    old.renderer.sync(config, state, completedAt + CHECKPOINT_COMPLETION_MS * 3, true);
    expect(old.quads[0].uniforms().uCompletionAge).toBe(-1);
  });

  it('gives completion priority over acquisition when both occur together and resets feedback with the round', () => {
    const { renderer, quads } = setup();
    const config = makeConfig();
    const state = makeState();
    state.activatedCheckpoints = [{ checkpointId: 'entry', activatedAtRoundMs: 100 }];
    state.completedCheckpoints = [{ checkpointId: 'entry', completedAtRoundMs: 100 }];
    renderer.sync(config, state, 100, true);
    expect(quads[0].uniforms()).toMatchObject({ uActivationAge: -1, uCompletionAge: 0 });
    renderer.sync(config, { ...makeState(), roundRevision: 2 }, 0, true);
    expect(quads[0].destroyed).toBe(true);
    expect(quads[config.checkpoints.length].uniforms()).toMatchObject({ uActivationAge: -1, uCompletionAge: -1 });
  });

  it('rebuilds on config and round changes even with identical mission revisions', () => {
    const { renderer, quads } = setup();
    const config = makeConfig();
    const state = makeState();
    renderer.sync(config, state, 100, true);
    const original = [...quads];
    const replacement = { ...makeConfig(), checkpoints: [{ ...config.checkpoints[0], gridX: 30 }] };
    renderer.sync(replacement, state, 200, true);
    expect(original.every(quad => quad.destroyed)).toBe(true);
    const replaced = quads.at(-1)!;
    expect(replaced.x).toBe(ARENA_OFFSET_X + (replacement.checkpoints[0].gridX + 0.5) * CELL_SIZE);
    renderer.sync(replacement, { ...state, roundRevision: state.roundRevision + 1 }, 0, true);
    expect(replaced.destroyed).toBe(true);
    expect(quads.at(-1)!.uniforms().uActivationAge).toBe(-1);
  });

  it('releases activity resources on hide, null state and clear, and is inert after destruction', () => {
    const { renderer, quads, images } = setup();
    const config = makeConfig();
    const state = makeState();
    renderer.sync(config, state, 0, true);
    renderer.sync(config, state, 1, false);
    expect(quads.every(quad => quad.destroyed)).toBe(true);
    expect(images.every(image => image.destroyed)).toBe(true);
    renderer.sync(config, state, 2, true);
    expect(quads.at(-1)!.destroyed).toBe(false);
    renderer.sync(config, null, 3, true);
    expect(quads.every(quad => quad.destroyed)).toBe(true);
    renderer.sync(config, state, 4, true);
    renderer.clear();
    renderer.sync(config, state, 5, true);
    renderer.destroy();
    const count = quads.length;
    renderer.destroy();
    renderer.clear();
    renderer.sync(config, state, 6, true);
    expect(quads).toHaveLength(count);
    expect(quads.every(quad => quad.destroyed)).toBe(true);
    expect(images.every(image => image.destroyed)).toBe(true);
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
