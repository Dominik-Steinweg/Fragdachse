import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const shaderInstances: { destroyed: boolean; renders: number; key: string | null }[] = [];

vi.mock('phaser', () => {
  class FakeShader {
    drawingContext = { clear: () => undefined, setClearColor: () => undefined };
    private readonly record = { destroyed: false, renders: 0, key: null as string | null };
    constructor(
      public scene: { textureKeys: Set<string> },
      public config: unknown,
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {
      shaderInstances.push(this.record);
    }
    setRenderToTexture(key: string): this {
      this.record.key = key;
      this.scene.textureKeys.add(key);
      this.renderWebGLStep(); // Phaser initializes the texture before any Scene tick.
      return this;
    }
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
  const events = new EventEmitter();
  const textureKeys = new Set<string>();
  const scene = {
    scene: { key },
    sys: { renderer: options.webgl === false ? {} : { gl: { COLOR_BUFFER_BIT: 0x4000 } } },
    textureKeys,
    textures: { exists: (key: string) => textureKeys.has(key), remove: (key: string) => textureKeys.delete(key) },
    events,
    // Der GraphicsQualityController patcht `add.particles` beim Attach.
    add: { particles: () => undefined },
  } as never;
  return { scene, events, textureKeys, tick: (deltaMs: number) => events.emit('update', 0, deltaMs) };
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
    field.activate();

    // Der erste Tick loest sofort aus, danach gilt das 30-Hz-Intervall.
    tick(16);
    expect(shaderInstances[0].renders).toBe(2);
    tick(16);
    expect(shaderInstances[0].renders).toBe(2);
    tick(20);
    expect(shaderInstances[0].renders).toBe(3);
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

  it('pauses without invalidating resident frames and resumes on the next tick', () => {
    shaderInstances.length = 0;
    const { scene, tick, textureKeys } = makeScene('Resident');
    const field = LivingFieldTexture.get(scene);
    field.retain();
    field.retain();
    const shader = shaderInstances[0];
    tick(500);
    expect(shader.renders).toBe(1); // Only Phaser's initialization frame.
    field.activate();
    field.activate();
    tick(1);
    expect(shader.renders).toBe(2);
    field.deactivate();
    tick(50);
    expect(shader.renders).toBe(3); // One other active consumer remains.
    field.deactivate();
    tick(500);
    expect(shader.renders).toBe(3);
    expect(shader.destroyed).toBe(false);
    expect(textureKeys.has(field.getTextureKey())).toBe(true);
    field.activate();
    tick(1);
    expect(shader.renders).toBe(4);
    field.deactivate();
    field.release();
    expect(shader.destroyed).toBe(false);
    field.release();
    expect(shader.destroyed).toBe(true);
    expect(textureKeys.size).toBe(0);
  });

  it('changes cadence on medium without replacing active or paused textures', () => {
    shaderInstances.length = 0;
    const { scene, tick } = makeScene('Cadence');
    const controller = new GraphicsQualityController('high');
    controller.attach(scene);
    const field = LivingFieldTexture.get(scene);
    field.retain();
    controller.setLevel('medium');
    tick(100);
    expect(shaderInstances[0].renders).toBe(1);
    field.activate();
    tick(1);
    tick(34);
    expect(shaderInstances[0].renders).toBe(2);
    tick(16);
    expect(shaderInstances[0].renders).toBe(3);
    expect(shaderInstances).toHaveLength(1);
    expect(field.getTextureWidth()).toBe(1024);
    expect(field.getTextureHeight()).toBe(128);
  });

  it('tolerates late consumer teardown after shutdown and gives a restarted scene a fresh field', () => {
    shaderInstances.length = 0;
    const { scene, tick, events, textureKeys } = makeScene('Restart');
    const field = LivingFieldTexture.get(scene);
    field.retain();
    field.activate();
    events.emit('shutdown');
    expect(shaderInstances[0].destroyed).toBe(true);
    expect(textureKeys.size).toBe(0);
    expect(events.listenerCount('update')).toBe(0);
    expect(field.isAvailable()).toBe(false);
    field.deactivate();
    field.release();
    field.retain();
    field.activate();
    tick(100);
    expect(shaderInstances).toHaveLength(1);
    const restarted = LivingFieldTexture.get(scene);
    expect(restarted).not.toBe(field);
    restarted.retain();
    restarted.activate();
    tick(1);
    expect(shaderInstances[1].renders).toBe(2);
  });
});
