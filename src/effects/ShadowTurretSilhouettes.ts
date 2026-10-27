import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { LongCasterFrame } from './ShadowSystem';

/**
 * Above the ground and the decks of base structures (ROCKS + 0.04), below the turret aura (ROCKS + 0.1)
 * and sprite (ROCKS + 0.2): a turret's shadow falls on whatever it stands on.
 */
export const TURRET_SILHOUETTE_DEPTH = DEPTH.ROCKS + 0.09;
export const TURRET_SILHOUETTE = {
  /** Height of the turret head above the surface it stands on; the cast is this long at full sun. */
  heightPx: 14,
  opacity: 0.4,
  /** Penumbra radius in world px; low quality draws a hard edge. */
  softnessPx: 1.6,
} as const;
const SWEEP_STEPS = 7;

/** Visits every turret sprite a presentation owner currently shows. */
export type TurretSilhouetteSource = (visit: (sprite: Phaser.GameObjects.Sprite) => void) => void;

const FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uTurret;
uniform vec4 uQuad;     // quad top-left and size in world px
uniform vec4 uPose;     // sprite position (origin point), cos and sin of its rotation
uniform vec4 uSize;     // displayed size, origin
uniform vec4 uTrim;     // cut rect inside the real frame, as fractions of it
uniform vec4 uUv;       // frame u0, v0, u1 - u0, v1 - v0 (flips folded in)
uniform vec4 uCast;     // cast direction, reach in px, softness in px
uniform float uOpacity;
float cover(vec2 world){
  vec2 d=world-uPose.xy;
  vec2 st=vec2(d.x*uPose.z+d.y*uPose.w,-d.x*uPose.w+d.y*uPose.z)/uSize.xy+uSize.zw;
  st=(st-uTrim.xy)/uTrim.zw;
  if(st.x<0.0||st.y<0.0||st.x>1.0||st.y>1.0)return 0.0;
  return texture2D(uTurret,uUv.xy+st*uUv.zw).a;
}
float soft(vec2 world){
  float r=uCast.w;
  if(r<=0.0)return step(.5,cover(world));
  return .25*(cover(world+vec2(r,r*.4))+cover(world-vec2(r,r*.4))+cover(world+vec2(-r*.4,r))+cover(world-vec2(-r*.4,r)));
}
vec4 shadowMultiply(float factor){float retained=min(1.0,factor);return vec4(vec3(factor-retained),1.0-retained);}
void main(){
  vec2 world=uQuad.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uQuad.zw;
  float shade=0.0;
  // The silhouette swept from the foot to the projected head: union, so one turret never darkens itself twice.
  for(int k=0;k<${SWEEP_STEPS};k++){
    float t=(float(k)+.5)/${SWEEP_STEPS}.0;
    shade=max(shade,soft(world-uCast.xy*uCast.z*t));
  }
  if(shade<=.002)discard;
  gl_FragColor=shadowMultiply(1.0-uOpacity*shade);
}
`;

interface Entry {
  readonly quad: Phaser.GameObjects.Shader;
  readonly quadRect: Float32Array;
  readonly pose: Float32Array;
  readonly size: Float32Array;
  readonly trim: Float32Array;
  readonly uv: Float32Array;
  readonly shade: { opacity: number };
  seen: number;
}

/**
 * Sun-cast silhouettes of turret sprites on the shadow system's long-caster bearing: built turrets on
 * the ground, base turrets on the decks of the persistent fort and outpost turrets alike. One small
 * shader quad per turret sweeps the sprite's own alpha from its foot along the cast with a soft rim,
 * in the same multiply look as the structure shadows. Owners register a source; sprites that vanish
 * from every source lose their silhouette on the next frame.
 */
export class ShadowTurretSilhouettes {
  private readonly sources = new Set<TurretSilhouetteSource>();
  private readonly entries = new Map<Phaser.GameObjects.Sprite, Entry>();
  private readonly frame: LongCasterFrame = { x: 0, y: 1, lengthMult: 1, softnessMult: 1, opacityMult: 1, visible: true };
  private readonly cast = new Float32Array(4);
  private readonly visit = (sprite: Phaser.GameObjects.Sprite): void => this.place(sprite);
  private tick = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly getFrame: (out: LongCasterFrame) => LongCasterFrame,
    private readonly soft: boolean) {
    // Headless scenes in tests have no event emitter; they never render either.
    scene.events?.on(Phaser.Scenes.Events.PRE_RENDER, this.sync, this);
  }

  /** Registers an owner's turret sprites; the returned function unregisters them. */
  addSource(source: TurretSilhouetteSource): () => void {
    this.sources.add(source);
    return () => { this.sources.delete(source); };
  }

  private sync(): void {
    const frame = this.getFrame(this.frame);
    this.tick++;
    this.cast[0] = frame.x; this.cast[1] = frame.y;
    this.cast[2] = TURRET_SILHOUETTE.heightPx * frame.lengthMult;
    this.cast[3] = this.soft ? TURRET_SILHOUETTE.softnessPx * frame.softnessMult : 0;
    if (frame.visible) for (const source of this.sources) source(this.visit);
    for (const [sprite, entry] of this.entries) {
      if (entry.seen === this.tick) continue;
      this.destroyQuad(entry.quad);
      this.entries.delete(sprite);
    }
  }

  private place(sprite: Phaser.GameObjects.Sprite): void {
    if (!sprite.active || !sprite.scene) return;
    let entry = this.entries.get(sprite);
    if (!entry) {
      entry = this.makeEntry(sprite);
      this.entries.set(sprite, entry);
    }
    entry.seen = this.tick;
    const visible = sprite.visible && sprite.alpha > 0 && sprite.displayWidth !== 0 && sprite.displayHeight !== 0;
    entry.quad.setVisible(visible);
    if (!visible) return;
    const frame = sprite.frame, w = sprite.displayWidth, h = sprite.displayHeight;
    if (entry.quad.textures[0] !== sprite.texture) entry.quad.textures[0] = sprite.texture;
    entry.pose[0] = sprite.x; entry.pose[1] = sprite.y; entry.pose[2] = Math.cos(sprite.rotation); entry.pose[3] = Math.sin(sprite.rotation);
    entry.size[0] = w; entry.size[1] = h; entry.size[2] = sprite.originX; entry.size[3] = sprite.originY;
    entry.trim[0] = frame.x / frame.realWidth; entry.trim[1] = frame.y / frame.realHeight;
    entry.trim[2] = frame.cutWidth / frame.realWidth; entry.trim[3] = frame.cutHeight / frame.realHeight;
    const u0 = sprite.flipX ? frame.u1 : frame.u0, u1 = sprite.flipX ? frame.u0 : frame.u1;
    const v0 = sprite.flipY ? frame.v1 : frame.v0, v1 = sprite.flipY ? frame.v0 : frame.v1;
    entry.uv[0] = u0; entry.uv[1] = v0; entry.uv[2] = u1 - u0; entry.uv[3] = v1 - v0;
    entry.shade.opacity = TURRET_SILHOUETTE.opacity * this.frame.opacityMult * sprite.alpha;
    // Bounds of the rotated sprite, stretched along the cast and padded by the penumbra.
    const radius = Math.hypot(Math.abs(w) * Math.max(sprite.originX, 1 - sprite.originX),
      Math.abs(h) * Math.max(sprite.originY, 1 - sprite.originY)) + this.cast[3] * 1.5 + 1;
    const dx = this.cast[0] * this.cast[2], dy = this.cast[1] * this.cast[2];
    const left = sprite.x - radius + Math.min(0, dx), top = sprite.y - radius + Math.min(0, dy);
    const width = radius * 2 + Math.abs(dx), height = radius * 2 + Math.abs(dy);
    entry.quadRect[0] = left; entry.quadRect[1] = top; entry.quadRect[2] = width; entry.quadRect[3] = height;
    entry.quad.setPosition(left, top).setSize(width, height);
  }

  private makeEntry(sprite: Phaser.GameObjects.Sprite): Entry {
    const quadRect = new Float32Array(4), pose = new Float32Array(4), size = new Float32Array(4);
    const trim = new Float32Array(4), uv = new Float32Array(4);
    const shade = { opacity: 0 };
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name: 'TurretSilhouetteShadow', shaderName: 'TurretSilhouetteShadow', fragmentSource: FRAGMENT,
      setupUniforms: (set: (name: string, value: unknown) => void) => {
        set('uTurret', 0); set('uQuad', quadRect); set('uPose', pose); set('uSize', size); set('uTrim', trim);
        set('uUv', uv); set('uCast', this.cast); set('uOpacity', shade.opacity);
      },
    }, 0, 0, 1, 1, [sprite.texture]);
    this.scene.add.existing(quad).setOrigin(0).setDepth(TURRET_SILHOUETTE_DEPTH).setBlendMode(Phaser.BlendModes.MULTIPLY);
    return { quad, quadRect, pose, size, trim, uv, shade, seen: 0 };
  }

  private destroyQuad(quad: Phaser.GameObjects.Shader): void {
    // Phaser 4.2.1 Shader.preDestroy omits its private VAOs and vertex buffer (as in LobbyStructureRenderer).
    const node = quad.renderNode;
    if (node?.programManager) {
      for (const suite of Object.values(node.programManager.programs)) {
        Phaser.Utils.Array.Remove(node.renderer.glVAOWrappers, suite.vao); suite.vao.destroy();
      }
      node.programManager.programs = {}; node.renderer.deleteBuffer(node.vertexBufferLayout.buffer);
    }
    quad.destroy();
  }

  destroy(): void {
    this.scene.events?.off(Phaser.Scenes.Events.PRE_RENDER, this.sync, this);
    this.sources.clear();
    for (const entry of this.entries.values()) this.destroyQuad(entry.quad);
    this.entries.clear();
  }
}
