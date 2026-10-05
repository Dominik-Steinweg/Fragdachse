import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { installPhaserGpuLayerTextures } from '../src/graphics/PhaserGpuLayerTextures';

function fixture() {
  const source = new URL('../node_modules/phaser/src/gameobjects/spritegpulayer/SpriteGPULayer.js', import.meta.url);
  const require = createRequire(source), module = { exports: {} };
  runInNewContext(readFileSync(source, 'utf8'), {
    module, exports: module.exports,
    require: (id: string) => {
      if (id === '../../utils/Class') return function (definition: object) { return definition; };
      if (id === '../components' || id === './SpriteGPULayerRender.js') return {};
      if (id === '../GameObject.js' || id === '../../structs/Map'
        || id === '../../renderer/webgl/renderNodes/submitter/SubmitterSpriteGPULayer.js') return function () {};
      return require(id);
    },
  }, { filename: source.pathname });
  const prototype = module.exports as Record<string, (...args: any[]) => any>;
  installPhaserGpuLayerTextures(prototype);
  const TextureWrapper = require('../../renderer/webgl/wrappers/WebGLTextureWrapper');
  const textures: any[] = [], deleted: unknown[] = [];
  const renderer = {
    glTextureWrappers: textures,
    gl: { isContextLost: () => false, createTexture: () => ({}), deleteTexture: (t: unknown) => deleted.push(t) },
    deleteTexture(texture: any) {
      const index = textures.indexOf(texture);
      if (index >= 0) textures.splice(index, 1);
      texture.destroy();
    },
    createUint8ArrayTexture() { return makeTexture(); },
  };
  function makeTexture() {
    const texture = Object.assign(Object.create(TextureWrapper.prototype), {
      renderer, pixels: new Uint8Array(4), webGLTexture: {}, _processTexture: vi.fn(),
    });
    textures.push(texture); return texture;
  }
  const other = makeTexture(), initial = makeTexture();
  const layer = Object.assign(Object.create(prototype), {
    scene: { renderer }, frameDataTexture: initial, animationData: [],
    texture: { getFrameNames: () => ['body'], get: () => ({ cutX: 0, cutY: 0, cutWidth: 16, cutHeight: 16 }) },
  });
  return { prototype, renderer, textures, deleted, layer, initial, other };
}

describe('installed Phaser GPU layer texture lifetime', () => {
  it('preserves live texture ownership when frame generation fails before replacement', () => {
    const f = fixture();
    f.layer.texture.get = () => { throw new Error('missing frame'); };
    expect(() => f.layer.generateFrameDataTexture()).toThrow('missing frame');
    expect(f.textures).toEqual([f.other, f.initial]);
    expect(f.deleted).toEqual([]);
    expect(() => f.textures.forEach(texture => texture.createResource())).not.toThrow();
  });
  it('installs once and retains only current frame data through repeated rebuilds and destruction', () => {
    const f = fixture(), original = f.prototype.preDestroy;
    installPhaserGpuLayerTextures(f.prototype);
    expect(f.prototype.preDestroy).toBe(original);
    for (let i = 0; i < 3; i++) {
      f.layer.generateFrameDataTexture();
      expect(f.textures).toEqual([f.other, f.layer.frameDataTexture]);
    }
    f.layer.preDestroy(); f.layer.preDestroy();
    expect(f.textures).toEqual([f.other]);
    expect(f.deleted).toHaveLength(4);
  });
  it.each(['generateFrameDataTexture', 'preDestroy'])('restores remaining textures after %s releases its old frame data', method => {
    const f = fixture(), oldHandle = f.initial.webGLTexture;
    f.layer[method]();
    // Execute the actual wrapper recreation that the renderer uses after context loss.
    expect(() => f.textures.forEach(texture => texture.createResource())).not.toThrow();
    expect(f.textures).not.toContain(f.initial);
    expect(f.textures).toContain(f.other);
    expect(f.deleted).toEqual([oldHandle]);
    if (method === 'generateFrameDataTexture') expect(f.textures).toContain(f.layer.frameDataTexture);
    else expect(f.textures).toEqual([f.other]);
  });
});
