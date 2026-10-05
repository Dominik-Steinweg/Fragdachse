import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { InstalledShader } = await import('./CharacterShadowPhaserHarness');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ShaderQuad = require(process.cwd() + '/node_modules/phaser/src/renderer/webgl/renderNodes/ShaderQuad.js');
  return {
    Textures: { FilterMode: { LINEAR: 1 } },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
    BlendModes: { NORMAL: 0 }, Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
      Linear: (a: number, b: number, t: number) => a + (b - a) * t,
      Easing: { Quadratic: { Out: (t: number) => t * (2 - t) } },
    },
    GameObjects: { Shader: class extends InstalledShader {
      callbacks: Array<() => void> = [];
      constructor(scene: any, config: any, ...args: any[]) {
        super(scene, config, ...args);
        // Keep the installed Shader constructor/components/preDestroy, replacing the
        // harness's draw-only node with the installed allocation/ProgramManager path.
        this.renderNode = new ShaderQuad(scene.sys.renderer.renderNodes, config);
      }
      once(_event: string, callback: () => void) { this.callbacks.push(callback); return this; }
      destroy() {
        if (this.destroyed) return;
        this.callbacks.forEach(callback => callback());
        this.preDestroy();
        super.destroy();
      }
    } },
  };
});
vi.mock('../src/effects/EffectUtils', () => ({
  registerGraphicsObject() {}, mixColors: (color: number) => color,
  ensureCanvasTexture() {}, fillRadialGradientTexture() {},
}));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityProfile: () => ({ level: 'high' }) }));

import { CoopDefenseMissionProgressRenderer } from '../src/effects/CoopDefenseMissionProgressRenderer';
import { TeslaNovaRenderer } from '../src/effects/TeslaNovaRenderer';
import { TeslaFieldVisual } from '../src/effects/TeslaFieldVisual';
import { WaterSurfaceRenderer } from '../src/arena/WaterSurfaceRenderer';
import { StinkCloudBody } from '../src/effects/StinkCloudBody';
import { FlamethrowerUpgradeRenderer } from '../src/effects/FlamethrowerUpgradeRenderer';
import { PlasmaBurnerRenderer } from '../src/effects/PlasmaBurnerRenderer';
import * as Phaser from 'phaser';

function fixture() {
  const sharedIndex = { destroy: vi.fn() }, programs = new Map<string, { destroy: ReturnType<typeof vi.fn>; compiling: boolean }>();
  const buffers: object[] = [sharedIndex], vaos: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const renderer: any = {
    gl: { FLOAT: 5126, DYNAMIC_DRAW: 35048 }, shaderSetters: { constants: { 5126: { size: 1, bytes: 4 } } },
    genericQuadIndexBuffer: sharedIndex, glBufferWrappers: buffers, glVAOWrappers: vaos,
    createVertexBuffer: () => { const buffer = { destroy: vi.fn() }; buffers.push(buffer); return buffer; },
    deleteBuffer: (buffer: any) => { const i = buffers.indexOf(buffer); if (i >= 0) buffers.splice(i, 1); buffer.destroy(); },
    createVAO: () => { const vao = { destroy: vi.fn() }; vaos.push(vao); return vao; },
    shaderProgramFactory: {
      getKey: (base: { name: string }) => base.name,
      getShaderProgram: (base: { name: string }) => {
        let program = programs.get(base.name);
        if (!program) { program = { compiling: false, destroy: vi.fn() }; programs.set(base.name, program); }
        return program;
      },
    },
  };
  renderer.renderNodes = { renderer, getNode: () => ({}), finishBatch: vi.fn() };
  const quads: any[] = [];
  const scene = {
    sys: { renderer }, textures: {
      get: () => ({}), remove: vi.fn(),
      createCanvas: () => ({ context: {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData() {},
      }, refresh() {}, setFilter() {} }),
    }, time: { now: 0 }, events: { once: vi.fn() },
    add: {
      existing: (quad: any) => { quads.push(quad); return quad; },
      shader: (...args: any[]) => {
        const quad = new (Phaser.GameObjects.Shader as any)(scene, ...args);
        quads.push(quad); return quad;
      },
    },
  };
  return { scene, buffers, vaos, quads, programs, sharedIndex };
}

function mission(scene: any) {
  const renderer = new CoopDefenseMissionProgressRenderer(scene);
  renderer.sync({ checkpoints: [{ id: 'entry', gridX: 1, gridY: 1, radiusCells: 2, setRespawn: true }],
    barriers: [], mandatoryDefenses: [] }, {
    roundRevision: 1, missionRevision: 0, activatedCheckpoints: [], completedCheckpoints: [],
    nextCheckpointId: 'entry', respawnCheckpointId: null, routeLockDefenseId: null,
    resolvedDefenses: [], barriers: [], routeComplete: false,
  }, 0, true);
  return () => renderer.destroy();
}

describe('World shader effects release private Phaser GPU resources', () => {
  it.each(['mission', 'nova-expiry', 'nova-teardown', 'tesla-field', 'stink', 'stink-probe', 'flame-expiry', 'flame-teardown'] as const)('releases %s without retiring another owner or shared programs', kind => {
    const f = fixture();
    const create = () => {
      if (kind === 'mission') return mission(f.scene);
      if (kind.startsWith('stink')) {
        const owner = new StinkCloudBody(f.scene as never, f.quads.length, 'stink');
        return () => kind === 'stink-probe' ? owner.destroyShaderProbe() : owner.destroy();
      }
      if (kind === 'tesla-field') {
        const owner = new TeslaFieldVisual(f.scene as never, { seed: 1, depth: 1, boltDepth: 2, register() {} },
          { x: 100, y: 100, radius: 80 } as never);
        owner.setBolt(0, { endX: 120, endY: 120, thickness: 1, amplitude: 0, branch: 0, impact: 0, surge: 0 });
        return () => owner.destroy();
      }
      if (kind.startsWith('flame')) {
        const owner = new FlamethrowerUpgradeRenderer(f.scene as never,
          { getOwnerVisualState: () => ({ x: 100, y: 100, visible: true }) } as never);
        owner.syncRings({ p: { flameRingRadius: 64, alive: true, isBurrowed: false } } as never);
        owner.update(0);
        return () => {
          if (kind === 'flame-expiry') {
            owner.syncRings({}); f.scene.time.now += 10_000; owner.update(f.scene.time.now);
          } else owner.clear();
        };
      }
      const owner = new TeslaNovaRenderer(f.scene as never);
      owner.play(100, 100, 80, 0xffffff);
      return () => {
        if (kind === 'nova-expiry') { f.scene.time.now += 10_000; owner.update(); }
        else owner.destroyAll();
      };
    };
    const releaseFirst = create(), first = [...f.quads];
    const releaseSecond = create(), second = f.quads.slice(first.length);
    const firstNodes = first.map(quad => quad.renderNode), secondNodes = second.map(quad => quad.renderNode);
    const firstSuites = firstNodes.map(node => node.programManager.getCurrentProgramSuite());
    const secondSuites = secondNodes.map(node => node.programManager.getCurrentProgramSuite());
    expect(firstSuites[0].program).toBe(secondSuites[0].program);
    expect(firstSuites[0].vao).not.toBe(secondSuites[0].vao);
    expect(f.buffers).toHaveLength(1 + first.length + second.length);
    releaseFirst();
    expect(first.every(quad => quad.destroyed)).toBe(true);
    expect(f.buffers).toEqual([f.sharedIndex, ...secondNodes.map(node => node.vertexBufferLayout.buffer)]);
    expect(f.vaos).toEqual(secondSuites.map(suite => suite.vao));
    expect(second.every(quad => !quad.destroyed)).toBe(true);
    firstSuites.forEach(suite => expect(suite.program.destroy).not.toHaveBeenCalled());
    expect(f.sharedIndex.destroy).not.toHaveBeenCalled();
    releaseFirst();
    firstSuites.forEach(suite => expect(suite.vao.destroy).toHaveBeenCalledOnce());
    releaseSecond();
    expect(f.buffers).toEqual([f.sharedIndex]);
    expect(f.vaos).toEqual([]);
    firstSuites.forEach(suite => expect(suite.program.destroy).not.toHaveBeenCalled());
  });

  it.each(['active', 'pooled'] as const)('reuses plasma GPU nodes until the %s beam is cleared with its World', finalState => {
    const f = fixture();
    const first = new PlasmaBurnerRenderer(f.scene as never), second = new PlasmaBurnerRenderer(f.scene as never);
    const fire = (owner: PlasmaBurnerRenderer) => owner.playTracer(100, 100, 200, 100, 0xffffff, 3);
    fire(first); fire(second);
    const quad = f.quads[0], control = f.quads[1], node = quad.renderNode, controlNode = control.renderNode;
    const suite = node.programManager.getCurrentProgramSuite(), controlSuite = controlNode.programManager.getCurrentProgramSuite();
    expect(suite.program).toBe(controlSuite.program);
    first.update();
    expect(quad.visible).toBe(true);
    f.scene.time.now += 10_000; first.update();
    expect(quad.visible).toBe(false);
    expect(quad.destroyed).not.toBe(true);
    expect(f.buffers).toContain(node.vertexBufferLayout.buffer);
    expect(f.vaos).toContain(suite.vao);
    fire(first); first.update();
    expect(f.quads).toHaveLength(2);
    expect(quad.visible).toBe(true);
    if (finalState === 'pooled') { f.scene.time.now += 10_000; first.update(); }
    first.clear(); first.clear();
    expect(quad.destroyed).toBe(true);
    expect(f.buffers).toEqual([f.sharedIndex, controlNode.vertexBufferLayout.buffer]);
    expect(f.vaos).toEqual([controlSuite.vao]);
    expect(suite.vao.destroy).toHaveBeenCalledOnce();
    expect(control.destroyed).not.toBe(true);
    expect(suite.program.destroy).not.toHaveBeenCalled();
    second.shutdown();
    expect(f.buffers).toEqual([f.sharedIndex]);
    expect(f.vaos).toEqual([]);
    expect(f.sharedIndex.destroy).not.toHaveBeenCalled();
  });

  it.each(['eviction', 'sunlight', 'destroy'] as const)('releases water private nodes on %s while preserving another resident owner', transition => {
    const f = fixture();
    const near = { x: 0, y: 0, width: 256, height: 256 };
    const createWater = () => {
      const owner = new WaterSurfaceRenderer(f.scene as never, { offsetX: 0, offsetY: 0, width: 256, height: 256 },
        [{ gridX: 2, gridY: 2 }], 1);
      while (!owner.isPrepared()) owner.prepareMasks();
      owner.updateResidency(near);
      return owner;
    };
    const first = createWater(), second = createWater();
    const oldQuad = f.quads[0], control = f.quads[1], oldNode = oldQuad.renderNode;
    const oldSuite = oldNode.programManager.getCurrentProgramSuite();
    const controlNode = control.renderNode, controlSuite = controlNode.programManager.getCurrentProgramSuite();
    expect(oldSuite.program).toBe(controlSuite.program);
    if (transition === 'sunlight') first.setSunlight({} as never);
    else if (transition === 'eviction') first.updateResidency({ x: 4000, y: 0, width: 100, height: 100 });
    else first.destroy();
    expect(oldQuad.destroyed).toBe(true);
    expect(f.buffers).not.toContain(oldNode.vertexBufferLayout.buffer);
    expect(f.vaos).not.toContain(oldSuite.vao);
    expect(f.buffers).toContain(controlNode.vertexBufferLayout.buffer);
    expect(f.vaos).toContain(controlSuite.vao);
    expect(control.destroyed).not.toBe(true);
    expect(oldSuite.program.destroy).not.toHaveBeenCalled();

    if (transition === 'eviction') first.updateResidency(near);
    if (transition === 'sunlight') {
      const sunQuad = f.quads.at(-1), sunNode = sunQuad.renderNode;
      const sunSuite = sunNode.programManager.getCurrentProgramSuite();
      first.setSunlight(undefined);
      expect(sunQuad.destroyed).toBe(true);
      expect(f.buffers).not.toContain(sunNode.vertexBufferLayout.buffer);
      expect(f.vaos).not.toContain(sunSuite.vao);
    }
    if (transition !== 'destroy') {
      const replacement = f.quads.at(-1);
      expect(replacement.destroyed).not.toBe(true);
      expect(replacement.renderNode.programManager.getCurrentProgramSuite().program).toBe(oldSuite.program);
    }
    first.destroy(); first.destroy(); second.destroy();
    expect(f.buffers).toEqual([f.sharedIndex]);
    expect(f.vaos).toEqual([]);
    expect(f.sharedIndex.destroy).not.toHaveBeenCalled();
    expect([...f.programs.values()].every(program => program.destroy.mock.calls.length === 0)).toBe(true);
  });
});
