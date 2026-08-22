import { describe, expect, it, vi } from 'vitest';

const shaderInstances: { destroyed: boolean; renders: number; key: string | null }[] = [];

vi.mock('phaser', () => {
  class FakeShader {
    drawingContext = { clear: () => undefined, setClearColor: () => undefined };
    private readonly record = { destroyed: false, renders: 0, key: null as string | null };
    constructor(
      public scene: unknown,
      public config: unknown,
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {
      shaderInstances.push(this.record);
    }
    setRenderToTexture(key: string): this { this.record.key = key; return this; }
    renderWebGLStep(): void { this.record.renders += 1; }
    destroy(): void { this.record.destroyed = true; }
  }
  return {
    BlendModes: { ADD: 1 },
    GameObjects: { Shader: FakeShader },
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
  };
});

import { LivingFieldTexture } from '../src/effects/living/LivingFieldTexture';
import { GraphicsQualityController } from '../src/graphics/GraphicsQuality';

function makeScene(key: string, options: { webgl?: boolean } = {}) {
  const updateListeners: ((time: number, delta: number) => void)[] = [];
  const scene = {
    scene: { key },
    sys: { renderer: options.webgl === false ? {} : { gl: { COLOR_BUFFER_BIT: 0x4000 } } },
    textures: { exists: () => false, remove: () => undefined },
    events: {
      on: (event: string, fn: (time: number, delta: number) => void) => {
        if (event === 'update') updateListeners.push(fn);
      },
      once: () => undefined,
      off: () => undefined,
    },
    // Der GraphicsQualityController patcht `add.particles` beim Attach.
    add: { particles: () => undefined },
  } as never;
  return { scene, tick: (deltaMs: number) => updateListeners.forEach((fn) => fn(0, deltaMs)) };
}

describe('LivingFieldTexture', () => {
  it('creates the shader on the first consumer and drops it with the last', () => {
    shaderInstances.length = 0;
    const { scene } = makeScene('SceneA');
    const field = LivingFieldTexture.get(scene);

    expect(field.isAvailable()).toBe(true);
    expect(shaderInstances.length).toBe(0);

    field.retain();
    field.retain();
    // Ein Shader fuer beliebig viele Balken – das ist der ganze Punkt der geteilten Textur.
    expect(shaderInstances.length).toBe(1);
    expect(shaderInstances[0].key).toBe('__living_field_SceneA');

    field.release();
    expect(shaderInstances[0].destroyed).toBe(false);
    field.release();
    expect(shaderInstances[0].destroyed).toBe(true);
  });

  it('renders at the configured rate instead of every frame', () => {
    shaderInstances.length = 0;
    const { scene, tick } = makeScene('SceneB');
    const field = LivingFieldTexture.get(scene);
    field.retain();

    // Der erste Tick loest sofort aus, danach gilt das 30-Hz-Intervall.
    tick(16);
    expect(shaderInstances[0].renders).toBe(1);
    tick(16);
    expect(shaderInstances[0].renders).toBe(1);
    tick(20);
    expect(shaderInstances[0].renders).toBe(2);
  });

  it('keeps the texture resolution stable below the high profile', () => {
    shaderInstances.length = 0;
    const { scene } = makeScene('SceneC');
    new GraphicsQualityController('medium').attach(scene);
    const field = LivingFieldTexture.get(scene);
    expect(field.getTextureWidth()).toBe(1024);
    expect(field.getTextureHeight()).toBe(128);
    expect(field.getPixelsPerUnit()).toBe(1);
  });

  it('keeps existing texture consumers valid when quality changes', () => {
    shaderInstances.length = 0;
    const { scene } = makeScene('SceneE');
    const controller = new GraphicsQualityController('high');
    controller.attach(scene);
    const field = LivingFieldTexture.get(scene);
    field.retain();

    const originalShader = shaderInstances[0];
    controller.setLevel('medium');

    expect(originalShader.destroyed).toBe(false);
    expect(shaderInstances).toHaveLength(1);
    expect(field.getTextureWidth()).toBe(1024);

    field.release();
  });

  it('reports itself unavailable without a WebGL renderer', () => {
    shaderInstances.length = 0;
    const { scene } = makeScene('SceneD', { webgl: false });
    const field = LivingFieldTexture.get(scene);
    expect(field.isAvailable()).toBe(false);
    field.retain();
    expect(shaderInstances.length).toBe(0);
  });
});
