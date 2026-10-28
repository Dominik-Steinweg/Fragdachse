import * as Phaser from 'phaser';

/** One turret's reach on the Bauhof's World. */
export interface PersistentBaseRangeRing {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: number;
  /** 0 a quiet hint, 1 the selected turret. */
  readonly emphasis: number;
}

const MAX_RINGS = 24;
const SHADER = 'PersistentBaseRangeField';

/**
 * Reaches as a soft light on the ground, no lines: a faint fill that brightens a little towards
 * the edge and fades out past it. Overlaps grow denser but never saturate; the selected turret's
 * edge is clearer and breathes.
 */
const FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform vec4 uQuad;
uniform vec4 uRings[${MAX_RINGS}];
uniform vec4 uTones[${MAX_RINGS}];
uniform float uCount;
uniform float uTime;
void main() {
  vec2 world = uQuad.xy + vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uQuad.zw;
  vec3 tone = vec3(0.0);
  float sum = 0.0;
  for (int i = 0; i < ${MAX_RINGS}; i++) {
    if (float(i) >= uCount) break;
    vec4 ring = uRings[i];
    float d = length(world - ring.xy), r = ring.z, emphasis = ring.w;
    float inside = 1.0 - smoothstep(r - 40.0, r + 3.0, d);
    float edge = (d - r) / (10.0 + 8.0 * emphasis);
    float rim = exp(-edge * edge);
    float breath = 0.82 + 0.18 * sin(uTime * 0.0021 + float(i) * 1.7);
    float a = inside * mix(0.022, 0.045, emphasis) + inside * smoothstep(r * 0.6, r, d) * mix(0.03, 0.06, emphasis)
      + rim * mix(0.07, 0.22 * breath, emphasis);
    tone += uTones[i].rgb * a;
    sum += a;
  }
  if (sum <= 0.002) discard;
  float alpha = 1.0 - exp(-sum * 1.15);
  gl_FragColor = vec4(tone / sum * alpha, alpha);
}`;

/** The reaches of the Bauhof's turrets as one GPU quad over the World. */
export class PersistentBaseRangeField {
  private readonly quad: Phaser.GameObjects.Shader;
  private readonly rings = new Float32Array(MAX_RINGS * 4);
  private readonly tones = new Float32Array(MAX_RINGS * 4);
  private readonly frame = new Float32Array(4);
  private count = 0;

  constructor(private readonly scene: Phaser.Scene, bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
    depth: number) {
    this.frame.set([bounds.x, bounds.y, bounds.width, bounds.height]);
    this.quad = new Phaser.GameObjects.Shader(scene, {
      name: SHADER, shaderName: SHADER, fragmentSource: FRAGMENT,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        set('uQuad', this.frame);
        set('uRings[0]', this.rings);
        set('uTones[0]', this.tones);
        set('uCount', this.count);
        set('uTime', this.scene.time.now);
      },
    }, bounds.x, bounds.y, bounds.width, bounds.height, [scene.textures.get('__DEFAULT')]);
    scene.add.existing(this.quad).setOrigin(0).setDepth(depth).setVisible(false);
  }

  set(rings: readonly PersistentBaseRangeRing[]): void {
    this.count = Math.min(MAX_RINGS, rings.length);
    for (let i = 0; i < this.count; i++) {
      const ring = rings[i]!, color = Phaser.Display.Color.IntegerToColor(ring.color);
      this.rings.set([ring.x, ring.y, ring.radius, ring.emphasis], i * 4);
      this.tones.set([color.redGL, color.greenGL, color.blueGL, 1], i * 4);
    }
    this.quad.setVisible(this.count > 0);
  }

  destroy(): void {
    // Phaser 4.2.1 Shader.preDestroy omits its private VAOs and vertex buffer (as in BaseFortRenderer).
    const node = this.quad.renderNode;
    if (node?.programManager) {
      for (const suite of Object.values(node.programManager.programs)) {
        Phaser.Utils.Array.Remove(node.renderer.glVAOWrappers, suite.vao); suite.vao.destroy();
      }
      node.programManager.programs = {}; node.renderer.deleteBuffer(node.vertexBufferLayout.buffer);
    }
    this.quad.destroy();
  }
}
