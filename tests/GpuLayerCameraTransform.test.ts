import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { configureGpuLayerCameraTransform } from '../src/graphics/GpuLayerCameraTransform';
import { EnemyEyeBatch } from '../src/effects/EnemyEyeBatch';

vi.mock('phaser', () => ({
  GameObjects: { SpriteGPULayer: class {
    constructor(_scene: unknown, _texture: unknown, size: number) { return makeGpuLayer(size); }
  } },
  Renderer: { WebGL: { Utils: { getTintAppendFloatAlpha: (color: number, alpha: number) => getTint(color, alpha) } } },
}));

// Execute the installed Phaser methods; only unrelated browser/GL construction is omitted.
function phaserMethods(path: string): Record<string, (...args: any[]) => any> {
  const source = new URL(`../node_modules/phaser/src/${path}`, import.meta.url);
  const module = { exports: {} };
  runInNewContext(readFileSync(source, 'utf8'), {
    module, exports: module.exports,
    require: (id: string) => id.endsWith('/Class') ? function (definition: object) { return definition; }
      : id.endsWith('/Utils.js') ? createRequire(source)(id)
      : id.endsWith('/Utils') ? { updateLightingUniforms() {} } : function () { return {}; },
  });
  return module.exports as Record<string, (...args: any[]) => any>;
}

const getViewMatrix = phaserMethods('cameras/2d/Camera.js').getViewMatrix;
const setupUniforms = phaserMethods('renderer/webgl/renderNodes/submitter/SubmitterSpriteGPULayer.js').setupUniforms;
const require = createRequire(import.meta.url);
const getCalcMatrix = require('../node_modules/phaser/src/gameobjects/GetCalcMatrix.js');
const TransformMatrix = require('../node_modules/phaser/src/gameobjects/components/TransformMatrix.js');
const getTint = require('../node_modules/phaser/src/renderer/webgl/Utils.js').getTintAppendFloatAlpha;
const spriteMethods = phaserMethods('gameobjects/spritegpulayer/SpriteGPULayer.js');
function makeGpuLayer(size: number) {
  const nextMemberF32 = new Float32Array(42);
  const layer = {
    size, memberCount: 0, timeElapsed: 37, visible: false,
    frame: { name: 'eye', realWidth: 32, realHeight: 48 }, frameDataIndices: { eye: 7 },
    nextMemberF32, nextMemberU32: new Uint32Array(nextMemberF32.buffer),
    submitterNode: { instanceBufferLayout: { layout: { stride: 42 * 4 }, buffer: { viewF32: new Float32Array(size * 42) } } },
    addMember: spriteMethods.addMember, addData: spriteMethods.addData, _setAnimatedValue: spriteMethods._setAnimatedValue,
    setSegmentNeedsUpdate() {}, setVisible(value: boolean) { this.visible = value; },
    resize(capacity: number) { this.size = capacity; this.submitterNode.instanceBufferLayout.buffer.viewF32 = new Float32Array(capacity * 42); },
  };
  return layer;
}

describe('GPU layers in inset World cameras', () => {
  it('packs moving eye quads exactly like Phaser, including tint bits, defaults and resized buffers', () => {
    const batch = new EnemyEyeBatch({ textures: { get: () => ({}) } } as never, 'eye', 1);
    const reference = makeGpuLayer(8);
    for (const count of [7, 2, 0, 1]) {
      batch.begin(count); reference.memberCount = 0;
      for (let i = 0; i < count; i++) {
        const x = -100 + i * 13.5, y = 20.25 + i, rotation = i * 0.37;
        const width = 12 + i, height = 20 + i, color = [0xffffff, 0xffcc99, 0x007f00][i % 3], alpha = i * 0.13;
        batch.write(x, y, width, height, rotation, color, alpha);
        reference.addMember({ x, y, rotation, scaleX: width / 32, scaleY: height / 48, alpha,
          tintTopLeft: color, tintTopRight: color, tintBottomLeft: color, tintBottomRight: color });
      }
      const actual = batch.layer.submitterNode.instanceBufferLayout.buffer.viewF32!;
      const expected = reference.submitterNode.instanceBufferLayout.buffer.viewF32;
      expect(new Uint32Array(actual.buffer).subarray(0, count * 42)).toEqual(new Uint32Array(expected.buffer).subarray(0, count * 42));
      expect(batch.layer.memberCount).toBe(count);
      expect(batch.layer.visible).toBe(count > 0);
    }
  });

  it.each([0.5, 1, 2])('aligns GPU members with regular sprites at render scale %s', (scale) => {
    for (const filtered of [false, true]) {
      const uniforms = new Map<string, any>();
      const matrix = new TransformMatrix();
      matrix.applyITRS(0, 0, 0, scale, scale).translate(-23, -41);
      const external = new TransformMatrix();
      external.translate(320 * scale, 230 * scale);
      const combined = new TransformMatrix();
      external.multiply(matrix, combined);
      const camera = { matrix, matrixExternal: external, matrixCombined: combined, scrollX: 23, scrollY: 41,
        filters: { internal: { length: filtered ? 1 : 0 }, external: { length: 0 } }, getViewMatrix };
      const context = { camera, useCanvas: !filtered, width: 544 * scale, height: 544 * scale,
        renderer: { setProjectionMatrixFromDrawingContext() {}, projectionMatrix: { val: [] } } };
      const node = { setupUniforms: vi.fn(setupUniforms), programManager: {
        setUniform: (key: string, value: unknown) => uniforms.set(key, value),
      }, gameObject: { alpha: .8, timeElapsed: 10, frame: { source: { width: 64, height: 64 } },
        frameDataTexture: { width: 64, height: 64 }, texture: { source: [{ glTexture: { width: 64, height: 64 } }] },
        selfShadow: {} } };
      const originalSetup = node.setupUniforms;
      const layer = { submitterNode: node };
      configureGpuLayerCameraTransform(layer as never);
      configureGpuLayerCameraTransform(layer as never);
      node.setupUniforms(context);
      expect(originalSetup).toHaveBeenCalledTimes(1);
      const world = { x: 280, y: 170, scrollFactorX: 1, scrollFactorY: 1, rotation: 0, scaleX: 1, scaleY: 1 };
      const sprite = getCalcMatrix(world, camera, undefined, filtered).calc;
      const gpu = uniforms.get('uViewMatrix');
      expect(gpu[0] * world.x + gpu[3] * world.y + gpu[6]).toBeCloseTo(sprite.tx);
      expect(gpu[1] * world.x + gpu[4] * world.y + gpu[7]).toBeCloseTo(sprite.ty);
      expect(uniforms.get('uCameraScrollAndAlpha')).toEqual([23, 41, .8]);
    }
  });
});
