import * as Phaser from 'phaser';
import { beginShaderPrograms } from '../../graphics/compileShaderPrograms';
import { disposeShaderWarmupNode } from '../../graphics/disposeShaderWarmupNode';
import { canPrelightFog } from './FogMaterialLighting';
import { SUN_TUNING_DEFAULTS } from '../sunlight/SunTuning';
import { FOG_DENSITY_FRAGMENT, FOG_DISPLAY_FRAGMENT, FOG_IMPULSE_FRAGMENT, FOG_K_MATERIAL_FRAGMENT,
  FOG_MATERIAL_FRAGMENT, FOG_VELOCITY_FRAGMENT, FOG_TRAIL_FRAGMENT, FOG_TRAIL_VERTEX } from './fogShaders';
import { FOG_SURFACE_FRAGMENT } from './FogSurfaceMask';

/** Lobby's ordinary fog variants. No framebuffer, draw or display-list entry;
 * the real fields reuse the renderer's cached programs with their own uniforms.
 */
export function warmupFogShaders(scene: Phaser.Scene, quality: string): () => void {
  const renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!renderer?.gl) return () => {};
  const prelit = canPrelightFog(SUN_TUNING_DEFAULTS, renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_IMAGE_UNITS), true);
  const configs: [string, string, string?][] = [
    ['impulse', FOG_IMPULSE_FRAGMENT], ['density', FOG_DENSITY_FRAGMENT], ['velocity', FOG_VELOCITY_FRAGMENT],
    [prelit ? 'materialLit' : 'material', prelit ? FOG_K_MATERIAL_FRAGMENT : FOG_MATERIAL_FRAGMENT],
    ['display', FOG_DISPLAY_FRAGMENT], ['rockAerial', FOG_DISPLAY_FRAGMENT], ['surface', FOG_SURFACE_FRAGMENT],
  ];
  if (quality !== 'low') configs.push(['trails', FOG_TRAIL_FRAGMENT, FOG_TRAIL_VERTEX]);
  const probes: Phaser.GameObjects.Shader[] = [];
  try {
    for (const [name, fragmentSource, vertexSource] of configs) {
      probes.push(new Phaser.GameObjects.Shader(scene, { name: `GroundFog_${name}`, shaderName: `GroundFog_${name}`,
        fragmentSource, vertexSource }, 0, 0, 1, 1));
    }
    const finish = beginShaderPrograms(renderer, probes.map(p => p.renderNode.programManager));
    return () => {
      try { finish(); } catch (error) {
        // Fog's regular initialization owns capability failure and fallback.
        console.warn('[GroundFog] Shader precompile failed; using normal initialization.', error);
      }
    };
  } catch (error) {
    console.warn('[GroundFog] Shader precompile unavailable; using normal initialization.', error);
    return () => {};
  } finally {
    for (const probe of probes) { disposeShaderWarmupNode(probe.renderNode); probe.destroy(); }
  }
}
