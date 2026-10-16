import * as Phaser from 'phaser';
import { beginShaderPrograms, type ShaderProgramBarrier } from '../../graphics/compileShaderPrograms';
import { disposeShaderWarmupNode } from '../../graphics/disposeShaderWarmupNode';
import { WATER_DISTURBANCE_FRAGMENT, WATER_DISTURBANCE_PROGRAM } from '../../arena/WaterDisturbanceField';
import { CHARACTER_MESH_BLUR, CHARACTER_MESH_MASK } from '../characterMeshShaders';
import { KRAKEN_REVIEW_FX_SHADER } from './reviewEffectShader';
import { KRAKEN_EMISSION_FRAGMENT, KRAKEN_EMISSION_PROGRAM } from './krakenEmissionShader';
import { KRAKEN_SHADOW_BLUR, KRAKEN_SHADOW_TARGET, KRAKEN_SHADOW_COMPOSITE, KRAKEN_SHADOW_PROJECTION,
  KRAKEN_SHADOW_COMPOSITE_FRAGMENT, KRAKEN_SHADOW_VERTEX, KRAKEN_SHADOW_MASK } from './KrakenShadowRenderer';
import { getSubmersionNode } from './submersionShader';
import { getKrakenDrainNode } from './KrakenReviewDrainFilter';

/** Mission-load split barrier, like WorldMaterialWarmup. Submit all links before
 * World construction; finish before the existing presentation-ready gate opens.
 * Only renderer-owned programs survive. No atlas pages, targets or visible probes.
 * Quality, part role, wet/contact passes and FX modes are uniforms, not variants.
 */
export function warmupKrakenShaders(scene: Phaser.Scene): ShaderProgramBarrier {
  const renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  const inactive = (): ShaderProgramBarrier => Object.assign(() => {}, { isReady: () => true });
  if (!renderer?.gl) return inactive();
  const probes: Phaser.GameObjects.Shader[] = [];
  try {
    for (const [name, fragmentSource] of [
      // setRenderToTexture submits one initialization draw before the custom mesh pass.
      [KRAKEN_SHADOW_TARGET, CHARACTER_MESH_MASK],
      [KRAKEN_SHADOW_BLUR, CHARACTER_MESH_BLUR],
      [KRAKEN_SHADOW_COMPOSITE, KRAKEN_SHADOW_COMPOSITE_FRAGMENT],
      ['KrakenReviewFX', KRAKEN_REVIEW_FX_SHADER],
      [KRAKEN_EMISSION_PROGRAM, KRAKEN_EMISSION_FRAGMENT],
      [WATER_DISTURBANCE_PROGRAM, WATER_DISTURBANCE_FRAGMENT],
    ]) probes.push(new Phaser.GameObjects.Shader(scene, { name, shaderName: name, fragmentSource }, 0, 0, 1, 1));
    // No VAO/buffer is needed to link the mesh program. Real casters own layouts.
    const projection = new Phaser.Renderer.WebGL.ProgramManager(renderer, []);
    projection.setBaseShader(KRAKEN_SHADOW_PROJECTION, KRAKEN_SHADOW_VERTEX, KRAKEN_SHADOW_MASK);
    const finish = beginShaderPrograms(renderer, [...probes.map(p => p.renderNode.programManager), projection,
      getSubmersionNode(renderer).programManager, getKrakenDrainNode(renderer).programManager]);
    return Object.assign(() => {
      try { finish(); } catch (error) { console.warn('[Kraken] Shader precompile failed; using normal initialization.', error); }
    }, { isReady: () => finish.isReady() });
  } catch (error) {
    console.warn('[Kraken] Shader precompile unavailable; using normal initialization.', error);
    return inactive();
  } finally {
    for (const probe of probes) { disposeShaderWarmupNode(probe.renderNode); probe.destroy(); }
  }
}
