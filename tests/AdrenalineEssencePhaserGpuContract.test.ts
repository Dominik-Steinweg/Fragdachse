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
  const require = createRequire(import.meta.url);
  const Submitter = require('../node_modules/phaser/src/renderer/webgl/renderNodes/submitter/SubmitterSpriteGPULayer.js');
  const buffers: any[] = [], vaos: any[] = [];
  const program = { compiling: false, destroy: vi.fn() };
  const sharedIndex = { destroy: vi.fn() };
  const renderer = {
    gl: { FLOAT: 5126, UNSIGNED_BYTE: 5121, STATIC_DRAW: 35044, DYNAMIC_DRAW: 35048 },
    shaderSetters: { constants: { 5126: { size: 1, bytes: 4 }, 5121: { size: 1, bytes: 1 } } },
    genericQuadIndexBuffer: sharedIndex, glVAOWrappers: vaos,
    createVertexBuffer: (bytes: ArrayBuffer) => {
      const buffer: any = { update() {}, setData(data: ArrayBuffer) {
        this.viewF32 = new Float32Array(data); this.viewU32 = new Uint32Array(data); this.viewU8 = new Uint8Array(data);
      } };
      buffer.destroy = vi.fn(() => { buffer.viewF32 = buffer.viewU32 = buffer.viewU8 = null; });
      buffer.setData(bytes); buffers.push(buffer); return buffer;
    },
    deleteBuffer: (buffer: any) => { buffers.splice(buffers.indexOf(buffer), 1); buffer.destroy(); },
    createVAO: () => { const vao = { destroy: vi.fn() }; vaos.push(vao); return vao; },
    shaderProgramFactory: { getKey: () => 'shared', getShaderProgram: () => program },
  };
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
          frameDataTexture: { destroy: vi.fn() },
          setDepth: (depth: number) => { layer.depth = depth; return layer; },
          setBlendMode: (mode: number) => { layer.blendMode = mode; return layer; },
          setVisible: (visible: boolean) => { layer.visible = visible; return layer; },
          destroy: () => {
            if (layer.destroyed) return;
            methods.preDestroy.call(layer); layer.destroyed = true;
          },
        });
        layer.submitterNode = new Submitter({ renderer }, {}, layer);
        layer.submitterNode.instanceBufferLayout.buffer.setData(bytes);
        layers.push(layer);
        return layer;
      },
    },
  };
  return { scene, layers, buffers, vaos, program, sharedIndex };
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
  it.each(['owner', 'display-list-first'] as const)('releases private layer resources once after %s cleanup and preserves another Activity', order => {
    const f = makeBufferScene();
    const first = new AdrenalineEssenceGpuRenderer(f.scene as never, () => null);
    const second = new AdrenalineEssenceGpuRenderer(f.scene as never, () => null);
    first.update(state, 1_500); second.update(state, 1_500);
    const firstLayers = f.layers.slice(0, 2), secondLayers = f.layers.slice(2);
    const firstNodes = firstLayers.map(layer => layer.submitterNode);
    const secondNodes = secondLayers.map(layer => layer.submitterNode);
    const firstSuites = firstNodes.map(node => node.programManager.getCurrentProgramSuite());
    const secondSuites = secondNodes.map(node => node.programManager.getCurrentProgramSuite());
    expect(firstSuites[0].program).toBe(secondSuites[0].program);
    expect(f.buffers).toHaveLength(8);
    if (order === 'display-list-first') firstLayers.forEach(layer => layer.destroy());
    expect(() => first.destroy()).not.toThrow();
    expect(f.buffers).toHaveLength(4);
    expect(f.buffers).toEqual(secondNodes.flatMap(node => [node.instanceBufferLayout.buffer, node.vertexBufferLayout.buffer]));
    expect(f.vaos).toEqual(secondSuites.map(suite => suite.vao));
    expect(f.program.destroy).not.toHaveBeenCalled(); expect(f.sharedIndex.destroy).not.toHaveBeenCalled();
    expect(() => second.update(state, 1_600)).not.toThrow();
    first.destroy();
    firstNodes.forEach(node => {
      expect(node.instanceBufferLayout.buffer.destroy).toHaveBeenCalledOnce();
      expect(node.vertexBufferLayout.buffer.destroy).toHaveBeenCalledOnce();
    });
    second.destroy(); expect(f.buffers).toEqual([]); expect(f.vaos).toEqual([]);
  });

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
