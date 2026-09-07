import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));
vi.mock('../src/effects/gpu/GpuVfxAtlas', () => ({ buildGpuVfxAtlas: () => {}, GPU_VFX_ATLAS_KEY: 'atlas' }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityProfile: () => ({ level: 'high' }) }));

import { AdrenalineEssenceGpuRenderer } from '../src/adrenalineEssence/AdrenalineEssenceGpuRenderer';
import { ESSENCE_LIQUID_FRAMES, ESSENCE_LIQUID_TAIL_FRAME } from '../src/adrenalineEssence/AdrenalineEssenceLiquidFrames';
import type { EssenceState } from '../src/adrenalineEssence/AdrenalineEssenceTypes';

/**
 * Execute the installed Phaser member encoder, not a copy of its implementation. Only
 * unrelated browser/GL constructor dependencies are isolated; addMember/editMember,
 * capacity checks, animation encoding, tint packing and buffer writes are the real API.
 */
function installedLayerMethods(): Record<string, (...args: any[]) => any> {
  const source = new URL('../node_modules/phaser/src/gameobjects/spritegpulayer/SpriteGPULayer.js', import.meta.url);
  const require = createRequire(source);
  const module = { exports: {} };
  runInNewContext(readFileSync(source, 'utf8'), {
    module,
    exports: module.exports,
    require: (id: string) => {
      if (id === '../../utils/Class') return function (definition: object) { return definition; };
      if (id === '../components' || id === './SpriteGPULayerRender.js') return {};
      if (id === '../GameObject.js' || id === '../../structs/Map'
        || id === '../../renderer/webgl/renderNodes/submitter/SubmitterSpriteGPULayer.js') return function () {};
      return require(id);
    },
  }, { filename: source.pathname });
  return module.exports as Record<string, (...args: any[]) => any>;
}

function makeBufferScene() {
  const methods = installedLayerMethods();
  const layers: any[] = [];
  const frames = ['__void', 'death-glow', ...ESSENCE_LIQUID_FRAMES.map(frame => frame.frame), ESSENCE_LIQUID_TAIL_FRAME];
  const scene = {
    add: {
      spriteGPULayer: (_key: string, size: number) => {
        const bytes = new ArrayBuffer(size * 42 * 4);
        const scratch = new ArrayBuffer(42 * 4);
        const layer: any = Object.assign(Object.create(methods), {
          size, memberCount: 0, timeElapsed: 1_000, visible: true,
          bufferUpdateSegmentSize: Math.ceil(size / 24), bufferUpdateSegments: 0,
          MAX_BUFFER_UPDATE_SEGMENTS_FULL: 0xffffff,
          nextMemberF32: new Float32Array(scratch), nextMemberU32: new Uint32Array(scratch),
          frame: { name: '__void' }, frameDataIndices: Object.fromEntries(frames.map((name, i) => [name, i])),
          texture: { get: (name: string) => {
            if (!frames.includes(name)) throw new Error(`Unregistered atlas frame: ${name}`);
            return { name };
          } },
          submitterNode: { instanceBufferLayout: {
            layout: { stride: 42 * 4 },
            buffer: { viewF32: new Float32Array(bytes), viewU32: new Uint32Array(bytes), viewU8: new Uint8Array(bytes) },
          } },
          setDepth: (depth: number) => { layer.depth = depth; return layer; },
          setBlendMode: (mode: number) => { layer.blendMode = mode; return layer; },
          setVisible: (visible: boolean) => { layer.visible = visible; return layer; },
          destroy: () => { layer.destroyed = true; },
        });
        layers.push(layer);
        return layer;
      },
    },
  };
  return { scene, layers };
}

const state: EssenceState = {
  worldRevision: 1, activityRevision: 1, revision: 1, transfers: [],
  clusters: [{
    id: 'reward', accessGroup: { kind: 'coop' }, originX: 140, originY: 90,
    x: 160, y: 110, value: 3, seed: 1, createdAt: 1_000, landAt: 1_200,
    expiresAt: 9_200, state: 'grounded',
  }],
};

describe('essence compatibility with installed Phaser GPU buffers', () => {
  it('encodes finite visible frame, position, scale, alpha and tint in real Phaser member slots', () => {
    const { scene, layers } = makeBufferScene();
    const renderer = new AdrenalineEssenceGpuRenderer(scene as never, () => null);
    renderer.update(state, 1_500);
    const body = layers.find(layer => layer.name === 'adrenaline-essence-body');
    const buffer = body.submitterNode.instanceBufferLayout.buffer;
    expect(body.memberCount).toBeGreaterThan(0);
    expect(body.visible).toBe(true);
    expect(Array.from(buffer.viewF32.slice(0, 32)).every(Number.isFinite)).toBe(true);
    expect(buffer.viewF32[0]).toBe(160);
    expect(buffer.viewF32[4]).toBe(110);
    expect(buffer.viewF32[12]).toBeGreaterThan(0);
    expect(buffer.viewF32[16]).toBeGreaterThan(0);
    expect(buffer.viewF32[20]).toBeGreaterThan(0);
    expect(buffer.viewF32[24]).toBeGreaterThan(0); // The transparent default frame is index 0.
    expect(buffer.viewF32[28]).toBe(1);
    expect(buffer.viewU32[32] >>> 24).toBe(255);
    renderer.clear();
    expect(buffer.viewF32[20]).toBe(0);
    renderer.update(state, 1_600);
    expect(buffer.viewF32[20]).toBeGreaterThan(0);
    renderer.destroy();
    expect(layers.every(layer => layer.destroyed)).toBe(true);
  });
});
