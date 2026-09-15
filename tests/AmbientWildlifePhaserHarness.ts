import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = new URL('../node_modules/phaser/src/', import.meta.url);
const require = createRequire(root);
const installed = (path: string): any => require(fileURLToPath(new URL(path, root)));
export const Matrix = installed('gameobjects/components/TransformMatrix.js');
const getCalcMatrix = installed('gameobjects/GetCalcMatrix.js');
const Utils = installed('renderer/webgl/Utils.js');
const GraphicsWebGL = installed('gameobjects/graphics/GraphicsWebGLRenderer.js');

/** Installed Phaser implementation, with only DOM/GL construction isolated. */
export function phaserMethods(path: string, overrides: Record<string, unknown> = {}): any {
  const source = new URL(path, root), localRequire = createRequire(source), module = { exports: {} };
  runInNewContext(readFileSync(source, 'utf8'), { module, exports: module.exports,
    require: (id: string) => id.endsWith('/Class') ? function (definition: object) { return definition; }
      : id in overrides ? overrides[id] : localRequire(id),
  });
  return module.exports;
}

const methods = phaserMethods('gameobjects/graphics/Graphics.js', {
  '../../cameras/2d/BaseCamera': function () {}, '../components': {}, '../GameObject': function () {}, './GraphicsRender': {},
});

export class TestGraphics extends EventEmitter {
  [key: string]: any;
  constructor(scene: any) {
    super();
    Object.assign(this, { scene, commandBuffer: [], defaultFillColor: -1, defaultStrokeColor: -1,
      _lineWidth: 1, pathDetailThreshold: 0, alpha: 1, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
      scrollFactorX: 1, scrollFactorY: 1, customRenderNodes: {}, defaultRenderNodes: scene.nodes,
      active: true, visible: true, lighting: false });
  }
  setDepth(depth: number) { this.depth = depth; return this; }
  setName(name: string) { this.name = name; return this; }
  destroy() { if (!this.active) return; this.preDestroy(); this.active = false; this.emit('destroy'); }
  renderWebGL(renderer: any, src: any, context: any) { GraphicsWebGL(renderer, src, context); }
}
for (const [name, fn] of Object.entries(methods)) {
  if (typeof fn === 'function' && name !== 'initialize') (TestGraphics.prototype as any)[name] = fn;
}

export const phaser = { GameObjects: { Graphics: TestGraphics, GetCalcMatrix: getCalcMatrix },
  Renderer: { WebGL: { Utils } } };

export function wildlifeScene(batch?: (context: any, indices: number[], vertices: number[], colors: number[]) => void) {
  const nodes: any = { Submitter: { batch: batch ?? (() => {}) } };
  for (const name of ['FillPath', 'FillTri', 'StrokePath', 'DrawLine']) {
    const Node = installed(`renderer/webgl/renderNodes/${name}.js`);
    nodes[name] = new Node({ getNode: (key: string) => nodes[key] });
  }
  nodes.StrokePath.drawLineNode = nodes.DrawLine;
  const objects: any[] = [];
  const scene: any = { nodes, objects, add: {
    existing: (object: any) => { objects.push(object); return object; },
    graphics: () => { const object = new TestGraphics(scene); objects.push(object); return object; },
  } };
  const camera = { matrix: new Matrix(), matrixCombined: new Matrix(), matrixExternal: new Matrix(),
    scrollX: 0, scrollY: 0, addToRenderList: () => {} };
  const context: any = { camera, useCanvas: true, alphaStrategy: 'BLEND' };
  const renderer: any = { config: { pathDetailThreshold: 0 } };
  return { scene, context, renderer, render: () => {
    for (const object of objects) if (object.active && object.visible) {
      const render = object.renderWebGL;
      render(renderer, object, context);
    }
  } };
}
