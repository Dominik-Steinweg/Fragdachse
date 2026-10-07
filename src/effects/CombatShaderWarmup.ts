import * as Phaser from 'phaser';
import type { ShaderWarmupProbe } from '../graphics/ShaderWarmupProbe';
import { disposeShaderWarmupNode } from '../graphics/disposeShaderWarmupNode';
import { DistortionFilter } from './distortion/DistortionFilter';
import { EnemyReadabilityRenderer } from './EnemyReadabilityRenderer';
import { StinkCloudBody } from './StinkCloudBody';
import { MeteorGpuLayer } from './gpu/MeteorGpuLayer';
import {
  TESLA_BOLT_FRAGMENT_SOURCE, TESLA_BOLT_SHADER_NAME, TESLA_DOME_FRAGMENT_SOURCE, TESLA_DOME_SHADER_NAME,
  TESLA_NOVA_FRAGMENT_SOURCE, TESLA_NOVA_SHADER_NAME,
} from './teslaDomeShader';
import { createTeslaStormShaderProbe } from './teslaStorm/TeslaStormBoltGpuLayer';

/** Lazy probes; their owner releases them on completion, failure and Scene teardown.
 * Phaser's program cache belongs to this renderer/context. No Activity or Round is created.
 */
export function createCombatShaderWarmupProbes(scene: Phaser.Scene): ShaderWarmupProbe[] {
  let contour: EnemyReadabilityRenderer | null = null;
  let stink: StinkCloudBody | null = null;
  let displacement: DistortionFilter | null = null;
  let meteor: MeteorGpuLayer | null = null;
  return [
    {
      name: 'armageddon',
      // Ground, radiant heat, flight/flash and lit smoke all share this program;
      // prepare() primes every pass, including the v2 material buffer, before combat.
      prepare: context => (meteor ??= new MeteorGpuLayer(scene)).prepare(context),
      destroy: () => { meteor?.destroy(); meteor = null; },
    },
    {
      name: 'enemy-contour',
      prepare: context => (contour ??= new EnemyReadabilityRenderer(scene)).prepareShader(context),
      destroy: () => { contour?.destroy(); contour = null; },
    },
    {
      name: 'stink-body',
      // Gas palettes, electric mode and quality are uniforms of the same program.
      prepare: context => (stink ??= new StinkCloudBody(scene, 0, 'stink')).prepareShader(context),
      destroy: () => { stink?.destroyShaderProbe(); stink = null; },
    },
    {
      name: 'displacement',
      prepare: context => {
        displacement ??= new DistortionFilter(scene.cameras.main);
        displacement.setPaddingOverride();
        const renderer = scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
        const node = renderer.renderNodes.getNode(displacement.renderNode) as Phaser.Renderer.WebGL.RenderNodes.FilterDisplacement;
        const input = renderer.drawingContextPool.get(1, 1);
        try {
          // BaseFilterShader consumes/releases its input, including while parallel linking.
          node.run(displacement, input, context);
        } catch (error) {
          input.release();
          throw error;
        }
        return !!node.programManager.getCurrentProgramSuite();
      },
      destroy: () => { displacement?.destroy(); displacement = null; },
    },
    // Tesla dome, beams and nova otherwise link on their first activation: a visible hitch.
    shaderQuadProbe(scene, TESLA_DOME_SHADER_NAME, TESLA_DOME_FRAGMENT_SOURCE),
    shaderQuadProbe(scene, TESLA_BOLT_SHADER_NAME, TESLA_BOLT_FRAGMENT_SOURCE),
    shaderQuadProbe(scene, TESLA_NOVA_SHADER_NAME, TESLA_NOVA_FRAGMENT_SOURCE),
    createTeslaStormShaderProbe(scene),
  ];
}

/** Links a fragment-only Shader program with a detached quad; its uniforms stay at defaults. */
function shaderQuadProbe(scene: Phaser.Scene, shaderName: string, fragmentSource: string): ShaderWarmupProbe {
  let quad: Phaser.GameObjects.Shader | null = null;
  return {
    name: shaderName,
    prepare: context => {
      quad ??= new Phaser.GameObjects.Shader(scene, { name: shaderName, shaderName, fragmentSource }, 0, 0, 1, 1);
      // Phaser's runtime accepts no parent; its 4.2.1 declaration incorrectly requires one.
      quad.renderNode.run(context, quad, undefined as unknown as Phaser.GameObjects.Components.TransformMatrix);
      return !!quad.renderNode.programManager.getCurrentProgramSuite();
    },
    destroy: () => {
      if (quad?.renderNode) disposeShaderWarmupNode(quad.renderNode);
      quad?.destroy();
      quad = null;
    },
  };
}
