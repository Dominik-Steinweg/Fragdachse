import * as Phaser from 'phaser';
import { KRAKEN_REVIEW_FX_SHADER } from './kraken/reviewEffectShader';
import type { ShaderWarmupProbe } from '../graphics/ShaderWarmupProbe';
import { disposeShaderWarmupNode } from '../graphics/disposeShaderWarmupNode';
import { DistortionFilter } from './distortion/DistortionFilter';
import { EnemyReadabilityRenderer } from './EnemyReadabilityRenderer';
import { StinkCloudBody } from './StinkCloudBody';
import { MeteorGpuLayer } from './gpu/MeteorGpuLayer';
import { MortarGpuLayer } from './gpu/MortarGpuLayer';
import { FirestarterGpuLayer } from './gpu/FirestarterGpuLayer';
import { ShieldChargerGpuLayer } from './gpu/ShieldChargerGpuLayer';
import { AlienConeGpuLayer } from './gpu/AlienConeGpuLayer';
import { EnergyShieldGpuLayer } from './gpu/EnergyShieldGpuLayer';
import {
  TESLA_BOLT_FRAGMENT_SOURCE, TESLA_BOLT_SHADER_NAME, TESLA_DOME_FRAGMENT_SOURCE, TESLA_DOME_SHADER_NAME,
  TESLA_NOVA_FRAGMENT_SOURCE, TESLA_NOVA_SHADER_NAME,
} from './teslaDomeShader';
import { createTeslaStormShaderProbe } from './teslaStorm/TeslaStormBoltGpuLayer';
import { createEnergyBallShaderProbe } from './energyBall/EnergyBallGpuLayer';
import { createFireControlPortalShaderProbe } from './fireControl/FireControlPortalGpuLayer';
import { PLASMA_BURNER_BEAM_FRAGMENT_SOURCE, PLASMA_BURNER_BEAM_SHADER_NAME } from './plasmaBurnerBeamShader';

/** Lazy probes; their owner releases them on completion, failure and Scene teardown.
 * Phaser's program cache belongs to this renderer/context. No Activity or Round is created.
 */
export function createCombatShaderWarmupProbes(scene: Phaser.Scene): ShaderWarmupProbe[] {
  let contour: EnemyReadabilityRenderer | null = null;
  let stink: StinkCloudBody | null = null;
  let displacement: DistortionFilter | null = null;
  let meteor: MeteorGpuLayer | null = null;
  let mortar: MortarGpuLayer | null = null;
  let firestarter: FirestarterGpuLayer | null = null;
  let shieldCharger: ShieldChargerGpuLayer | null = null;
  let alienCone: AlienConeGpuLayer | null = null;
  let energyShield: EnergyShieldGpuLayer | null = null;
  return [
    {
      name: 'armageddon',
      // Ground, radiant heat, flight/flash and lit smoke all share this program;
      // prepare() primes every pass, including the v2 material buffer, before combat.
      prepare: context => (meteor ??= new MeteorGpuLayer(scene)).prepare(context),
      destroy: () => { meteor?.destroy(); meteor = null; },
    },
    {
      name: 'mortar',
      // Telegraph, drop shadow, shell and crater share one program; every pass is primed.
      prepare: context => (mortar ??= new MortarGpuLayer(scene)).prepare(context),
      destroy: () => { mortar?.destroy(); mortar = null; },
    },
    {
      name: 'firestarter',
      // Telegraph, lance, void orbs and combo share one program; every pass is primed.
      prepare: context => (firestarter ??= new FirestarterGpuLayer(scene)).prepare(context),
      destroy: () => { firestarter?.destroy(); firestarter = null; },
    },
    {
      name: 'shield-charger',
      // Lane telegraph, run streak, dust and scuffs share one program; every pass is primed.
      prepare: context => (shieldCharger ??= new ShieldChargerGpuLayer(scene)).prepare(context),
      destroy: () => { shieldCharger?.destroy(); shieldCharger = null; },
    },
    {
      name: 'alien-cone',
      // Charge, wavefront and allied outline of the energy cone share one program.
      prepare: context => (alienCone ??= new AlienConeGpuLayer(scene)).prepare(context),
      destroy: () => { alienCone?.destroy(); alienCone = null; },
    },
    {
      name: 'energy-shield',
      // Player arcs, energy domes and enemy frontal shields share one membrane program.
      prepare: context => (energyShield ??= new EnergyShieldGpuLayer(scene)).prepare(context),
      destroy: () => { energyShield?.destroy(); energyShield = null; },
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
    // The plasma burner beam linked on the first trigger pull, a visible hitch on the training ground.
    shaderQuadProbe(scene, PLASMA_BURNER_BEAM_SHADER_NAME, PLASMA_BURNER_BEAM_FRAGMENT_SOURCE),
    // Mini-Kraken melee ink reuses the kraken FX shader on ordinary maps.
    shaderQuadProbe(scene, 'KrakenReviewFX', KRAKEN_REVIEW_FX_SHADER),
    createTeslaStormShaderProbe(scene),
    createEnergyBallShaderProbe(scene),
    createFireControlPortalShaderProbe(scene),
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
