import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = new URL('../node_modules/phaser/src/', import.meta.url);
function moduleWith(path: string, overrides: Record<string, unknown>) {
  const url = new URL(path, root), localRequire = createRequire(url), module = { exports: {} };
  runInNewContext(readFileSync(url, 'utf8'), { module, exports: module.exports,
    require: (id: string) => id in overrides ? overrides[id] : localRequire(id) }, { filename: url.pathname });
  return module.exports as any;
}
const definition = function (value: unknown) { return value; };
const quadMethods = moduleWith('renderer/webgl/renderNodes/ShaderQuad.js', { '../../../utils/Class': definition,
  '../wrappers/WebGLVertexBufferLayoutWrapper': function () {}, '../ProgramManager': function () {}, './RenderNode': function () {} });
const transformMethods = moduleWith('renderer/webgl/renderNodes/transformer/TransformerImage.js', { '../../../../utils/Class': definition, '../RenderNode': function () {} });
const Matrix = require(fileURLToPath(new URL('gameobjects/components/TransformMatrix.js', root)));
const components = Object.fromEntries(['BlendMode','ComputedSize','GetBounds','Origin','ScrollFactor','Transform','Visible']
  .map(name => [name, require(fileURLToPath(new URL('gameobjects/components/' + name + '.js', root)))]));
components.Depth = moduleWith('gameobjects/components/Depth.js', { '../../utils/array': {} });

function GameObject(this: any, scene: any) {
  this.scene = scene; this.active = true; this.renderFlags = 15; this.cameraFilter = 0; this.displayList = null;
}
GameObject.prototype.willRoundVertices = () => false;
GameObject.prototype.destroy = function () { this.destroyed = true; this.setVisible(false); };

function ShaderQuad(this: any, manager: any, config: any) {
  Object.assign(this, quadMethods);
  this.manager = manager; this.renderer = manager.renderer; this.config = config;
  this.onRunBegin = this.onRunEnd = this.updateShaderConfig = () => {};
  this._texturerProxy = { frame: {}, uvSource: { x: 0, y: 0 } };
  this.transformerNode = { ...transformMethods, onRunBegin() {}, onRunEnd() {},
    _spriteMatrix: new Matrix(), _calcMatrix: new Matrix(), quad: new Float32Array(8) };
  this.vertexBufferLayout = { layout: { stride: 16 }, buffer: { viewF32: new Float32Array(16), update() {} } };
  const uniforms: Record<string, unknown> = {};
  this.setUniform = (key: string, value: unknown) => { uniforms[key] = value; };
  this.programManager = { getCurrentProgramSuite: () => ({ program: { uniforms }, vao: {} }), applyUniforms() {} };
}
/** Installed Shader constructor/components and ShaderQuad/TransformerImage.run;
 * only browser/GL allocation and shader compilation are replaced. */
export const InstalledShader = moduleWith('gameobjects/shader/Shader.js', {
  '../GameObject': GameObject, '../components': components, './ShaderRender': {},
  '../../renderer/webgl/renderNodes/ShaderQuad': ShaderQuad,
  '../../cameras/2d/BaseCamera': function () {}, '../../renderer/webgl/DrawingContext': function () {},
});
export { Matrix };
