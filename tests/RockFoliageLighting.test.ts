import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import { createRequire } from 'node:module';
const ShaderProgramFactory = createRequire(import.meta.url)('../node_modules/phaser/src/renderer/webgl/ShaderProgramFactory.js');

vi.mock('phaser', () => ({
  Renderer: {
    Events: { SET_PARALLEL_TEXTURE_UNITS: 'textures', RESIZE: 'resize' },
    WebGL: { RenderNodes: {
      RenderNode: class { run = () => {}; constructor(public name: string, public manager: unknown) {} },
      BatchHandlerQuadSingle: class {
        programManager = {
          programs: {} as Record<string, unknown>,
          addAddition: (addition: unknown) => {
            const renderer = (this.manager as any).renderer;
            const factory = renderer.shaderProgramFactory;
            const base = { name: 'STANDARD_SINGLE', vertexShader: '', fragmentShader: '' };
            const key = factory.getKey(base, [addition], []);
            const program = factory.getShaderProgram(base, [addition], []);
            const vao = { destroy: vi.fn() };
            renderer.glVAOWrappers.push(vao);
            this.programManager.programs[key] = { program, vao };
          },
          setUniform: (key: string, value: unknown) => this.uniforms.set(key, Array.isArray(value) ? [...value] : value),
        };
        uniforms = new Map<string, unknown>();
        vertexBufferLayout = { buffer: { kind: 'vertex' } };
        indexBuffer = { kind: 'index' };
        setupUniforms = () => {};
        resize = () => {};
        updateTextureCount = () => {};
        constructor(public manager: unknown) {}
      },
    } },
  },
  Utils: { Array: { Remove: (array: unknown[], value: unknown) => array.splice(array.indexOf(value), 1) } },
}));

import { FOLIAGE_HEADER, RockFoliageLighting, type FormationReceiverBinding } from '../src/arena/rocks/RockFoliageLighting';

function fixture() {
  type Batch = { setupUniforms: (context: unknown) => void; uniforms: Map<string, unknown> };
  const draws: Array<{ x: number; custom: boolean; uniforms?: Map<string, unknown> }> = [];
  const manager = {
    renderer: {} as unknown,
    currentBatchNode: null as Batch | null,
    off: vi.fn(),
    finishBatch() {
      this.currentBatchNode?.setupUniforms({});
      this.currentBatchNode = null;
    },
  };
  const renderer = {
    gl: {}, maxTextures: 8, renderNodes: manager,
    glTextureUnits: { bind: vi.fn() },
    off: vi.fn(), deleteBuffer: vi.fn(), deleteProgram: vi.fn(), glVAOWrappers: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
    createProgram: vi.fn(() => ({ destroyed: false })), shaderProgramFactory: null as any,
  };
  renderer.shaderProgramFactory = new ShaderProgramFactory(renderer);
  manager.renderer = renderer;
  const receiver = new RockFoliageLighting({ sys: { renderer } } as unknown as Phaser.Scene);
  const makeTexture = (x = 100, y = 200) => {
    const texture = {
      x, y, active: true,
      frame: { cutWidth: 512, cutHeight: 512, u0: 2/516, v0: 514/516, u1: 514/516, v1: 2/516 },
      customRenderNodes: {} as Record<string, { run: (...args: unknown[]) => void } & Partial<Batch>>,
      defaultRenderNodes: { Submitter: { run() {
        const batch = texture.customRenderNodes.BatchHandler as Batch | undefined;
        if (batch) manager.currentBatchNode = batch;
        draws.push({ x: texture.x, custom: !!batch, uniforms: batch?.uniforms });
      } } },
      setRenderNodeRole(role: string, node: null | typeof texture.customRenderNodes[string]) {
        if (node) this.customRenderNodes[role] = node;
        else delete this.customRenderNodes[role];
      },
    };
    receiver.attach(texture as unknown as Phaser.GameObjects.RenderTexture);
    return texture;
  };
  const render = (texture: ReturnType<typeof makeTexture>) => {
    const node = texture.customRenderNodes.Submitter ?? texture.defaultRenderNodes.Submitter;
    node.run({}, texture, null, undefined, {}, {});
  };
  const dataTexture = () => ({ source: [{ glTexture: { webGLTexture: {} } }] }) as unknown as Phaser.Textures.Texture;
  const binding: FormationReceiverBinding = {
    field: dataTexture(), lookup: dataTexture(), occlusion: dataTexture(),
    frame: [37, 12, 2048, 2048], sun: [-.5, -.5, .707], options: [1, 0, 1, 1],
  };
  return { receiver, renderer, manager, makeTexture, render, binding, draws };
}

it('declares all material samplers, including the shared mineral cavity input',()=>{
  const declared=new Set([...FOLIAGE_HEADER.matchAll(/uniform\s+\w+\s+([^;]+);/g)]
    .flatMap(m=>m[1].split(',').map(s=>s.trim().replace(/\[.*$/, ''))));
  const read=new Set([...FOLIAGE_HEADER.replace(/\/\/[^\n]*/g,'').matchAll(/\bu[A-Z]\w*/g)].map(m=>m[0]));
  for(const name of read)expect(declared,`missing ${name}`).toContain(name);
});

describe('foliage receiver ownership', () => {
  it('uses ordinary rendering before opt-in and after a null, failed, or disposed provider', () => {
    const f = fixture(), texture = f.makeTexture();
    f.render(texture);
    expect(f.draws.at(-1)?.custom).toBe(false);
    f.receiver.setProvider(() => f.binding);
    f.render(texture);
    expect(f.draws.at(-1)?.custom).toBe(true);
    expect(texture.customRenderNodes.BatchHandler).toBeUndefined();
    f.receiver.setProvider(() => null);
    f.render(texture);
    expect(f.draws.at(-1)?.custom).toBe(false);
    f.receiver.setProvider(() => { throw new Error('formation unavailable'); });
    f.render(texture);
    expect(f.draws.at(-1)?.custom).toBe(false);
    f.receiver.setProvider(() => f.binding);
    f.binding.field.source.length = 0;
    f.render(texture);
    expect(f.draws.at(-1)?.custom).toBe(false);
    f.receiver.setProvider(null);
    expect(texture.customRenderNodes.Submitter).toBeUndefined();
  });

  it('reads position and clipped UVs after chunk-pool reuse without rebuilding the material', () => {
    const f = fixture(), texture = f.makeTexture();
    f.receiver.setProvider(() => f.binding);
    f.binding.sceneSunOffset = [12, -8];
    const material = texture.customRenderNodes.Submitter;
    f.render(texture);
    expect(f.draws.at(-1)?.uniforms?.get('uFoliageChunk')).toEqual([100, 200, 512, 512]);
    expect(f.draws.at(-1)?.uniforms?.get('uMineralResponse')).toBe(0);
    f.binding.mineralResponse=true;
    f.binding.mineralHeight=f.binding.occlusion;
    f.binding.sceneSunOffset[0] = 13;
    texture.x = 1636; texture.y = 712; texture.frame.cutWidth = 176;
    texture.frame.u1 = 178/516;
    f.render(texture);
    expect(texture.customRenderNodes.Submitter).toBe(material);
    expect(f.draws.at(-1)?.uniforms?.get('uFoliageChunk')).toEqual([1636, 712, 176, 512]);
    expect(f.draws.at(-1)?.uniforms?.get('uMineralResponse')).toBe(1);
    expect(f.draws.at(-1)?.uniforms?.get('uMineralHeight')).toBe(4);
    expect(f.renderer.glTextureUnits.bind).toHaveBeenCalledWith(f.binding.mineralHeight.source[0].glTexture,4);
    expect(f.draws.at(-1)?.uniforms?.get('uFoliageUV')).toEqual([2/516, 514/516, 176/516, -512/516]);
    const later = f.makeTexture(2000, 40);
    expect(later.customRenderNodes.Submitter).toBe(material);
    f.render(later);
    expect(f.draws.at(-1)?.uniforms?.get('uFoliageChunk')).toEqual([2000, 40, 512, 512]);
  });

  it('restores all pooled targets and releases the one shared material exactly once', () => {
    const f = fixture(), first = f.makeTexture(), pooled = f.makeTexture();
    f.receiver.setProvider(() => f.binding);
    f.render(first);
    f.receiver.destroy();
    f.receiver.destroy();
    expect(first.customRenderNodes.Submitter).toBeUndefined();
    expect(pooled.customRenderNodes.Submitter).toBeUndefined();
    expect(f.renderer.deleteBuffer).toHaveBeenCalledTimes(2);
    expect(f.manager.off).toHaveBeenCalledTimes(1);
    expect(f.renderer.off).toHaveBeenCalledTimes(1);
    f.receiver.setProvider(() => f.binding);
    f.render(first);
    expect(f.draws.at(-1)?.custom).toBe(false);
  });

  it('reuses the renderer program across repeated world lifetimes and releases each private VAO', () => {
    const f = fixture(), texture = f.makeTexture();
    let receiver = f.receiver;
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        receiver = new RockFoliageLighting({ sys: { renderer: f.renderer } } as unknown as Phaser.Scene);
        receiver.attach(texture as unknown as Phaser.GameObjects.RenderTexture);
      }
      receiver.setProvider(() => f.binding);
      const vao = f.renderer.glVAOWrappers[0];
      f.render(texture);
      receiver.destroy();
      expect(vao.destroy).toHaveBeenCalledOnce();
      expect(f.renderer.glVAOWrappers).toHaveLength(0);
      expect(Object.keys(f.renderer.shaderProgramFactory.programs)).toHaveLength(1);
    }
    expect(f.renderer.createProgram).toHaveBeenCalledOnce();
    expect(f.renderer.deleteProgram).not.toHaveBeenCalled();
    expect(f.renderer.deleteBuffer).toHaveBeenCalledTimes(6);
  });
});
