 import * as Phaser from 'phaser';
import { ROCK_SURFACE_TEXTURE_KEY } from '../RockBaseConfig';
import { getRockSurfaceLighting } from './RockRendererSettings';
import { resolveRockDaylight, ROCK_SURFACE_GLSL, type RockSurfaceLightingState } from './RockSurfaceLighting';

interface SurfaceResources {
  readonly state: RockSurfaceLightingState;
  batch?: Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuad;
}
const resources = new WeakMap<Phaser.Scene, SurfaceResources>();

/** A scene-owned batch is shared by classic rocks and the bounded fragment pool. */
function getResources(scene: Phaser.Scene): SurfaceResources {
  let entry = resources.get(scene);
  if (entry) return entry;
  entry = { state: { enabled: getRockSurfaceLighting(), daylight: resolveRockDaylight(480) } };
  resources.set(scene, entry);
  scene.events.once?.('shutdown', () => {
    if (entry.batch) disposeNode(entry.batch);
    resources.delete(scene);
  });
  return entry;
}

export function getRockSurfaceState(scene: Phaser.Scene): RockSurfaceLightingState {
  return getResources(scene).state;
}

function configureMaterial(program: Phaser.Renderer.WebGL.ProgramManager): void {
  // Keep Phaser's paired-texture binding/batching, replace only its point-light calculation.
  for (const addition of program.getAdditionsByTag('LIGHTING')) program.removeAddition(addition.name);
  program.addAddition({
    name: 'RockSurface',
    additions: { fragmentHeader: ROCK_SURFACE_GLSL,
      fragmentProcess: 'fragColor = applyRockSurface(fragColor, texCoord);' },
  });
}

export function bindRockSurfaceGpu(layer: Phaser.GameObjects.SpriteGPULayer, state: RockSurfaceLightingState): void {
  const node = layer.submitterNode;
  if (!node?.programManager) return; // Renderer-free tests / presentation-less worlds.
  layer.setLighting(true).setSelfShadow(false);
  configureMaterial(node.programManager);
  const setup = node.setupUniforms;
  node.setupUniforms = function(context: Phaser.Renderer.WebGL.DrawingContext): void {
    setup.call(this, context);
    this.programManager.setUniform('uRockSurface', 2);
    this.programManager.setUniform('uRockDaylight', state.daylight);
  };
}

export function bindRockSurfaceImage(scene: Phaser.Scene, image: Phaser.GameObjects.Image): void { 
  const renderer = scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
  if (!renderer?.renderNodes) return;
  if (image.texture.key !== ROCK_SURFACE_TEXTURE_KEY) {
    image.setLighting?.(false);
    if (image.customRenderNodes && 'BatchHandler' in image.customRenderNodes) image.setRenderNodeRole('BatchHandler', null);
    return;
  }
  const entry = getResources(scene);
  if (!entry.batch) {
    const batch = new Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuad(renderer.renderNodes, {
      name: 'RockSurfaceBatch', shaderName: 'ROCK_SURFACE',
    });
    configureMaterial(batch.programManager);
    const setup = batch.setupUniforms;
    batch.setupUniforms = function(context: Phaser.Renderer.WebGL.DrawingContext): void {
      setup.call(this, context);
      this.programManager.setUniform('uRockSurface', 1);
      this.programManager.setUniform('uRockDaylight', entry.state.daylight);
    };
    entry.batch = batch;
  }
  image.setLighting(true).setSelfShadow(false).setRenderNodeRole('BatchHandler', entry.batch);
}

type OwnedNode = Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuad
  | Phaser.Renderer.WebGL.RenderNodes.SubmitterSpriteGPULayer;

/** Phaser 4.2.1 leaves GPU submitter disposal as a TODO. Shared shader programs stay owned by Phaser. */
function disposeNode(node: OwnedNode): void {
  const renderer = node.manager.renderer;
  const owned = node as unknown as {
    updateTextureCount?: (...args: unknown[]) => void;
    resize?: (...args: unknown[]) => void;
    indexBuffer?: Phaser.Renderer.WebGL.Wrappers.WebGLBufferWrapper;
    instanceBufferLayout?: { buffer: Phaser.Renderer.WebGL.Wrappers.WebGLBufferWrapper };
    vertexBufferLayout: { buffer: Phaser.Renderer.WebGL.Wrappers.WebGLBufferWrapper };
  };
  if (owned.updateTextureCount) (node.manager as unknown as Phaser.Events.EventEmitter)
    .off(Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS, owned.updateTextureCount, node);
  if (owned.resize) renderer.off(Phaser.Renderer.Events.RESIZE, owned.resize, node);
  if (node.manager.currentBatchNode === node) node.manager.finishBatch();
  for (const suite of Object.values(node.programManager.programs)) {
    Phaser.Utils.Array.Remove(renderer.glVAOWrappers, suite.vao);
    suite.vao.destroy();
  }
  node.programManager.programs = {};
  if (owned.indexBuffer) renderer.deleteBuffer(owned.indexBuffer);
  if (owned.instanceBufferLayout) renderer.deleteBuffer(owned.instanceBufferLayout.buffer);
  renderer.deleteBuffer(owned.vertexBufferLayout.buffer);
}

export function destroyRockGpuLayer(layer: Phaser.GameObjects.SpriteGPULayer): void {
  if (layer.submitterNode?.programManager) disposeNode(layer.submitterNode);
  layer.destroy();
}
