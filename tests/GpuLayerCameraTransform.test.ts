import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { configureGpuLayerCameraTransform } from '../src/graphics/GpuLayerCameraTransform';

// Execute the installed Phaser methods; only unrelated browser/GL construction is omitted.
function phaserMethods(path: string): Record<string, (...args: any[]) => any> {
  const source = new URL(`../node_modules/phaser/src/${path}`, import.meta.url);
  const module = { exports: {} };
  runInNewContext(readFileSync(source, 'utf8'), {
    module, exports: module.exports,
    require: (id: string) => id.endsWith('/Class') ? function (definition: object) { return definition; }
      : id.endsWith('/Utils') ? { updateLightingUniforms() {} } : function () { return {}; },
  });
  return module.exports as Record<string, (...args: any[]) => any>;
}

const getViewMatrix = phaserMethods('cameras/2d/Camera.js').getViewMatrix;
const setupUniforms = phaserMethods('renderer/webgl/renderNodes/submitter/SubmitterSpriteGPULayer.js').setupUniforms;
const require = createRequire(import.meta.url);
const getCalcMatrix = require('../node_modules/phaser/src/gameobjects/GetCalcMatrix.js');
const TransformMatrix = require('../node_modules/phaser/src/gameobjects/components/TransformMatrix.js');

describe('GPU layers in inset World cameras', () => {
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
