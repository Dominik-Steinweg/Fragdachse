import * as Phaser from 'phaser';
import { addInternalGlowLegacy, type GlowHandle } from '../utils/phaserFx';

const NODE = 'PlayerOuterGlow';
const registeredManagers = new WeakSet<object>();

// Object-local sampling follows the animated frame. The radial envelope closes the gaps
// between the badger's head, body and feet, so they cannot become glowing interior edges.
const FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec2 resolution;
uniform vec4 glowColor;
uniform float outerStrength;
varying vec2 outTexCoord;
#pragma phaserTemplate(fragmentHeader)
void main() {
    vec4 source = boundedSampler(uMainSampler, outTexCoord);
    vec2 radial = outTexCoord - vec2(0.5);
    float extent = max(abs(radial.x), abs(radial.y));
    vec2 edge = vec2(0.5) + radial * (0.5 / max(extent, 0.0001));
    float silhouette = source.a;
    for (int i = 1; i <= 64; i++) {
        vec2 uv = mix(outTexCoord, edge, float(i) / 64.0);
        silhouette = max(silhouette, boundedSampler(uMainSampler, uv).a);
    }
    float outside = 1.0 - smoothstep(0.02, 0.12, silhouette);
    float halo = 0.0;
    float weightSum = 0.0;
    if (outside > 0.0) {
        for (int ring = 1; ring <= 8; ring++) {
            float radius = float(ring) * 5.0;
            float weight = exp(-0.5 * pow(radius / 14.0, 2.0)) * radius;
            for (int direction = 0; direction < 12; direction++) {
                float angle = (float(direction) + float(ring) * 0.375) * 0.523598776;
                vec2 offset = vec2(cos(angle), sin(angle)) * radius / resolution;
                halo += boundedSampler(uMainSampler, outTexCoord + offset).a * weight;
                weightSum += weight;
            }
        }
    }
    // Exponential response preserves the soft falloff even during bright flashes.
    float alpha = (1.0 - exp(-halo / max(weightSum, 1.0) * outerStrength * 0.55))
        * outside * (1.0 - source.a);
    gl_FragColor = source + vec4(glowColor.rgb * alpha, alpha);
}
`;

function createPlayerGlowNode() {
  return class PlayerGlowNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
    constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
      super(NODE, manager, undefined, FRAGMENT);
    }

    override setupUniforms(
      controller: Phaser.Filters.Glow,
      drawingContext: Phaser.Renderer.WebGL.DrawingContext,
    ): void {
      this.programManager.setUniform('resolution', [drawingContext.width, drawingContext.height]);
      this.programManager.setUniform('glowColor', controller.glcolor);
      this.programManager.setUniform('outerStrength', controller.outerStrength);
    }
  };
}

/** Uses the existing filter ownership, quality tracking and teardown for every player form. */
export function addPlayerGlow(target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, color: number): GlowHandle | null {
  const glow = addInternalGlowLegacy(target, color, 4, 0, false, 0.1, 40, 'critical');
  const renderer = target.scene.sys?.renderer;
  if (glow && renderer && 'gl' in renderer) {
    const manager = renderer.renderNodes;
    if (!registeredManagers.has(manager)) {
      manager.addNodeConstructor(NODE, createPlayerGlowNode());
      registeredManagers.add(manager);
    }
    glow.renderNode = NODE;
    glow.setPaddingOverride?.(-44, -44, 44, 44);
  }
  return glow;
}
