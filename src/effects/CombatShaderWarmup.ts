import type * as Phaser from 'phaser';
import type { ShaderWarmupProbe } from '../graphics/ShaderWarmupProbe';
import { DistortionFilter } from './distortion/DistortionFilter';
import { EnemyReadabilityRenderer } from './EnemyReadabilityRenderer';
import { StinkCloudBody } from './StinkCloudBody';
import { MeteorGpuLayer } from './gpu/MeteorGpuLayer';

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
  ];
}
