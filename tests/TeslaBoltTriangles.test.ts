import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const root = process.cwd() + '/node_modules/phaser/src/';
  const commands = require(root + 'gameobjects/graphics/Commands.js');
  // Only the browser-dependent GameObject constructor is replaced. The reference
  // Graphics renderer, FillTri, camera matrices and tint packing are installed Phaser.
  class Graphics {
    commandBuffer: number[] = [];
    alpha = 1; x = 0; y = 0; rotation = 0; scaleX = 1; scaleY = 1;
    scrollFactorX = 1; scrollFactorY = 1; lighting = false; pathDetailThreshold = 0;
    customRenderNodes = {}; defaultRenderNodes = {};
    constructor(readonly scene: unknown) {}
    clear() { this.commandBuffer.length = 0; return this; }
    fillStyle(color: number, alpha: number) { this.commandBuffer.push(commands.FILL_STYLE, color, alpha); return this; }
    fillTriangle(...points: number[]) { this.commandBuffer.push(commands.FILL_TRIANGLE, ...points); return this; }
  }
  return { GameObjects: { Graphics, GetCalcMatrix: require(root + 'gameobjects/GetCalcMatrix.js') },
    Renderer: { WebGL: { Utils: require(root + 'renderer/webgl/Utils.js') } } };
});

import * as Phaser from 'phaser';
import { TeslaBoltTriangles } from '../src/effects/TeslaBoltTriangles';

const require = createRequire(import.meta.url);
const root = process.cwd() + '/node_modules/phaser/src/';
const renderGraphics = require(root + 'gameobjects/graphics/GraphicsWebGLRenderer.js');
const FillTri = require(root + 'renderer/webgl/renderNodes/FillTri.js');
const Matrix = require(root + 'gameobjects/components/TransformMatrix.js');

function capture() {
  const triangles: number[][] = [];
  const batch = vi.fn((_context: unknown, indices: number[], positions: number[], colors: number[]) => {
    for (const index of indices) triangles.push([Math.fround(positions[index * 2]), Math.fround(positions[index * 2 + 1]), colors[index]]);
  });
  return { triangles, batch };
}

describe('Tesla ribbon submission', () => {
  it.each([false, true])('matches Graphics geometry, color and object alpha (camera framebuffer: %s)', (filtered) => {
    const scene = { sys: { renderer: { gl: {} } } } as never;
    const mesh = new TeslaBoltTriangles(scene);
    const legacy = new Phaser.GameObjects.Graphics(scene);
    const actual = capture(), reference = capture();
    mesh.defaultRenderNodes = { Submitter: actual };
    legacy.defaultRenderNodes = { Submitter: reference, FillTri: new FillTri({}) };
    const matrix = new Matrix().applyITRS(0, 0, 0.23, 0.65, 1.3);
    const matrixExternal = new Matrix().translate(240, 110);
    const matrixCombined = new Matrix();
    matrixExternal.multiply(matrix, matrixCombined);
    const camera = { matrix, matrixExternal, matrixCombined, scrollX: 41, scrollY: -23, addToRenderList() {} };
    const context = { camera, useCanvas: !filtered } as never;
    const renderer = { config: { pathDetailThreshold: 0 } } as never;
    const parent = new Matrix().applyITRS(7, 8, 0.7, 1.4, 0.8);
    for (const object of [mesh, legacy]) Object.assign(object, { x: 30, y: -15, rotation: 0.4, alpha: 0.37 });
    // Grow, shrink, empty, then reuse: no stale triangles from a vanished branch.
    for (const count of [300, 2, 0, 8]) {
      mesh.resetTriangles(); legacy.clear(); actual.triangles.length = 0; reference.triangles.length = 0;
      for (let i = 0; i < count; i++) {
        const x = i * 0.37, y = Math.sin(i);
        const color = i % 2 ? 0x78adff : 0xffffff, alpha = 0.13 + (i % 7) * 0.1;
        mesh.addSection(x, y, x + 1, y + 3, x + 4, y - 2, x + 5, y + 1, color, alpha);
        legacy.fillStyle(color, alpha);
        legacy.fillTriangle(x, y, x + 1, y + 3, x + 4, y - 2);
        legacy.fillTriangle(x + 1, y + 3, x + 5, y + 1, x + 4, y - 2);
      }
      mesh.renderWebGL(renderer, mesh, context, parent);
      renderGraphics(renderer, legacy, context, parent);
      expect(actual.triangles).toEqual(reference.triangles);
      expect(actual.triangles).toHaveLength(count * 6);
    }
  });

  it('retains the ordinary triangle commands for Canvas', () => {
    const mesh = new TeslaBoltTriangles({ sys: { renderer: {} } } as never);
    const legacy = new Phaser.GameObjects.Graphics({} as never);
    mesh.addSection(1, 2, 3, 4, 5, 6, 7, 8, 0x78adff, 0.4);
    legacy.fillStyle(0x78adff, 0.4).fillTriangle(1, 2, 3, 4, 5, 6).fillTriangle(3, 4, 7, 8, 5, 6);
    expect(mesh.commandBuffer).toEqual(legacy.commandBuffer);
    mesh.resetTriangles();
    expect(mesh.commandBuffer).toEqual([]);
  });
});
