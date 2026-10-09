import * as Phaser from 'phaser';
import { addInternalGlowLegacy, type GlowHandle } from '../utils/phaserFx';
import { PLAYER_VISUAL_SIZE } from '../config';

/** Gemeinsame Abstimmung der Spielerfarbe an Figur, Köder und Vorschau. */
export const PLAYER_GLOW = {
  /** Puls des Außenhalos (`outerStrength`). */
  strength: { min: 7, max: 9, decoyMin: 6.5, decoyMax: 8.5 },
  /** Anteil der Spielerfarbe im Fellsaum; `innerStrength` (Rage) addiert sich. */
  rim: 0.42,
  rimPerInnerStrength: 0.22,
  /** Halo über dem Bodennebel: gleicht diesen Anteil der lokalen Nebeldeckung aus. */
  fogLift: 0.85,
  /** Im Dunst breiter, nicht heller – wie Licht, das im Nebel streut. */
  fogSpread: 0.6,
  /** Schattenloses Bodenlicht in Spielerfarbe; die Lichtkarte blendet es bei Tag aus. */
  groundLight: { radiusPx: PLAYER_VISUAL_SIZE * 2.1, intensity: 0.5 },
} as const;

/** Bestehende Puls-Nutzer (Spieler, Köder, Vorschau). */
export const PLAYER_GLOW_STRENGTH = PLAYER_GLOW.strength;

export interface PlayerGlowOptions {
  /** Grundanteil des Fellsaums in Glowfarbe; 0 schaltet ihn ab. */
  rim?: number;
  /** Nur den Außenhalo zeichnen, ohne Figur und Saum. */
  knockout?: boolean;
  /** Filter-Padding für die größte spätere `scale` des Handles. */
  maxScale?: number;
}

interface PlayerGlowParams { radiusScale: number; rim: number; opacity: number }

const NODE = 'PlayerOuterGlow';
const registeredManagers = new WeakSet<object>();
const glowParams = new WeakMap<object, PlayerGlowParams>();

// Object-local sampling follows the animated frame. The radial envelope closes the gaps
// between the badger's head, body and feet, so they cannot become glowing interior edges.
const FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec2 resolution;
uniform vec4 glowColor;
uniform float outerStrength;
uniform float radiusScale;
uniform float rimStrength;
uniform float knockout;
uniform float opacity;
varying vec2 outTexCoord;
#pragma phaserTemplate(fragmentHeader)
void main() {
    vec4 source = boundedSampler(uMainSampler, outTexCoord);
    vec2 radial = outTexCoord - vec2(0.5);
    float extent = max(abs(radial.x), abs(radial.y));
    vec2 edge = vec2(0.5) + radial * (0.5 / max(extent, 0.0001));
    // Bridge narrow openings only when artwork exists on BOTH sides of the ray.
    // This closes the gap between the fists without expanding the outer silhouette.
    vec2 tangent = vec2(-radial.y, radial.x) / max(length(radial), 0.0001) * 0.045;
    float silhouette = source.a;
    for (int i = 1; i <= 64; i++) {
        vec2 uv = mix(outTexCoord, edge, float(i) / 64.0);
        silhouette = max(silhouette, boundedSampler(uMainSampler, uv).a);
        float bridge = min(boundedSampler(uMainSampler, uv - tangent).a,
                           boundedSampler(uMainSampler, uv + tangent).a);
        silhouette = max(silhouette, bridge);
        if (silhouette >= 0.12) break;
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
                vec2 offset = vec2(cos(angle), sin(angle)) * radius * radiusScale / resolution;
                halo += boundedSampler(uMainSampler, outTexCoord + offset).a * weight;
                weightSum += weight;
            }
        }
    }
    // Exponential response preserves the soft falloff even during bright flashes.
    float alpha = (1.0 - exp(-halo / max(weightSum, 1.0) * outerStrength * 0.55))
        * outside * (1.0 - source.a);
    if (knockout > 0.5) {
        // Light only: reduced coverage lets the halo add to fog and ground instead of veiling them.
        gl_FragColor = vec4(glowColor.rgb * alpha, alpha * 0.6) * opacity;
        return;
    }
    // Fur rim: body pixels near the silhouette take on the player colour, as if lit by their own glow.
    float missing = 0.0;
    if (rimStrength > 0.0 && source.a > 0.05) {
        for (int direction = 0; direction < 8; direction++) {
            vec2 dir = vec2(cos(float(direction) * 0.785398163), sin(float(direction) * 0.785398163)) / resolution;
            missing += (1.0 - boundedSampler(uMainSampler, outTexCoord + dir * 2.0).a) * 0.65;
            missing += (1.0 - boundedSampler(uMainSampler, outTexCoord + dir * 4.0).a) * 0.35;
        }
    }
    float rim = smoothstep(0.0, 0.45, missing / 8.0) * clamp(rimStrength, 0.0, 0.85);
    vec3 body = mix(source.rgb, glowColor.rgb * source.a, rim);
    gl_FragColor = vec4(body, source.a) + vec4(glowColor.rgb * alpha, alpha) * opacity;
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
      const params = glowParams.get(controller);
      const rim = (params?.rim ?? 0) > 0
        ? (params?.rim ?? 0) + Math.max(0, controller.innerStrength) * PLAYER_GLOW.rimPerInnerStrength
        : 0;
      this.programManager.setUniform('resolution', [drawingContext.width, drawingContext.height]);
      this.programManager.setUniform('glowColor', controller.glcolor);
      this.programManager.setUniform('outerStrength', controller.outerStrength);
      this.programManager.setUniform('radiusScale', (params?.radiusScale ?? 1) * (controller.scale ?? 1));
      this.programManager.setUniform('rimStrength', rim);
      this.programManager.setUniform('knockout', controller.knockout ? 1 : 0);
      this.programManager.setUniform('opacity', params?.opacity ?? 1);
    }
  };
}

/** Uses the existing filter ownership, quality tracking and teardown for every player form. */
export function addPlayerGlow(
  target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image,
  color: number,
  radiusScale = 1,
  strength: number = PLAYER_GLOW.strength.min,
  options: PlayerGlowOptions = {},
): GlowHandle | null {
  const knockout = options.knockout ?? false;
  const glow = addInternalGlowLegacy(target, color, strength, 0, knockout, 0.1, 40 * radiusScale, 'critical');
  if (glow) glowParams.set(glow, { radiusScale, rim: options.rim ?? PLAYER_GLOW.rim, opacity: 1 });
  const renderer = target.scene.sys?.renderer;
  if (glow && renderer && 'gl' in renderer) {
    const manager = renderer.renderNodes;
    if (!registeredManagers.has(manager)) {
      manager.addNodeConstructor(NODE, createPlayerGlowNode());
      registeredManagers.add(manager);
    }
    glow.renderNode = NODE;
    const pad = 44 * radiusScale * Math.max(1, options.maxScale ?? 1);
    glow.setPaddingOverride?.(-pad, -pad, pad, pad);
  }
  return glow;
}

/** Output opacity of the glow light. Unlike object alpha it leaves the silhouette detection intact. */
export function setPlayerGlowOpacity(glow: GlowHandle | null, opacity: number): void {
  const params = glow ? glowParams.get(glow) : undefined;
  if (params) params.opacity = Math.max(0, Math.min(1, opacity));
}
