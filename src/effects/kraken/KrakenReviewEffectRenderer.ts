import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { disposeShaderWarmupNode } from '../../graphics/disposeShaderWarmupNode';
import { EnemyClawRenderer, ENEMY_CLAW_HOSTILE_COLOR } from '../EnemyClawRenderer';
import { KRAKEN_REVIEW_FX_SHADER, krakenInkQuad } from './reviewEffectShader';

type Point = { x: number; y: number };
interface Quad { object: Phaser.GameObjects.Shader; mode: number; age: number; opacity: number; shape: number[]; timing: number[]; detail: number[]; core: number[]; edge: number[] }
export interface KrakenReviewEffectFrame {
  effect: 'none' | 'ink' | 'erupt' | 'slam' | 'intro' | 'surface' | 'dive' | 'egg-throw'; time: number; angle: number;
  mouth: Point; shores: Point[]; charge: number; spit: number; impact: number; retract: number;
  length: number; width: number;
  ink: { range: number; halfAngle: number; travel: number; hold: number; dissolve: number; opacity: number;
    waterSpread: number; coreColor: number; edgeColor: number; cloudWarp: number; sheen: number };
  erupt: { radius: number; rise: number; lifetime: number; retractScale: number; bulgeDuration: number;
    sprayCount: number; spraySpeed: number; foamOpacity: number };
  slam: { dustLifetime: number; decalLifetime: number; whipDelay: number; curveBend: number; contactWidth: number };
  bodyMotion?: { center: Point; radius: number; lead: number; arms: number; keel: number; roar: number; submerged: number;
    lifetime: number; foamOpacity: number; sprayCount: number; spraySpeed: number; shadowOpacity: number };
  eggs?: { point: Point; visible: boolean; height: number; landingAge: number; hatchAge: number; alpha: number; radius: number }[];
}
let serial = 0;
/** Dev presentation using the existing sector GPU renderer and Phaser ShaderQuad backend.
 * Fixed quad pools and one small water mask; seeking allocates no effects, timers or tweens. */
export class KrakenReviewEffectRenderer {
  private readonly telegraph: EnemyClawRenderer;
  private readonly ink: Quad;
  private readonly surfaces: Quad[];
  private readonly plumes: Quad[];
  private readonly motion: Quad;
  private readonly eggGround: Quad[];
  private readonly eggFlash: Quad[];
  private readonly mask: Phaser.Textures.CanvasTexture;
  private maskSignature = '';
  private time = 0;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly waterAt: (x: number, y: number) => number) {
    this.mask = scene.textures.createCanvas(`kraken-ink-water-${++serial}`, 128, 128)!;
    this.telegraph = new EnemyClawRenderer(scene, () => this.time * 1000);
    this.ink = this.quad(0, DEPTH.PLAYERS + .2);
    this.surfaces = Array.from({ length: 3 }, () => this.quad(3, DEPTH.DECALS + .15));
    this.plumes = Array.from({ length: 3 }, () => this.quad(1, DEPTH.PLAYERS + .1));
    this.motion = this.quad(4, DEPTH.PLAYERS - .25);
    this.eggGround = Array.from({ length: 8 }, () => this.quad(5, DEPTH.PLAYERS - .3));
    this.eggFlash = Array.from({ length: 8 }, () => this.quad(6, DEPTH.PLAYERS + .15));
  }
  private quad(mode: number, depth: number): Quad {
    const q = { mode, age: -1, opacity: 1, shape: [1, 1, 1, 1], timing: [1, 1, 1, 1], detail: [0, 0, 0, 0], core: [0, 0, 0], edge: [0, 0, 0] } as Quad;
    q.object = this.scene.add.shader({ name: 'KrakenReviewFX', shaderName: 'KrakenReviewFX', fragmentSource: KRAKEN_REVIEW_FX_SHADER,
      setupUniforms: (set: (name: string, value: number | readonly number[]) => void) => {
        set('uWater', 0); set('uMode', q.mode); set('uAge', q.age); set('uShape', q.shape); set('uTiming', q.timing);
        set('uOpacity', q.opacity); set('uDetail', q.detail);
        set('uCore', q.core); set('uEdge', q.edge);
      },
    }, 0, 0, 1, 1, [this.mask.key]).setDepth(depth).setVisible(false);
    const node = q.object.renderNode;
    q.object.once('destroy', () => disposeShaderWarmupNode(node));
    return q;
  }
  private place(q: Quad, origin: Point, angle: number, width: number, height: number, shift = 0): void {
    q.object.setPosition(origin.x + Math.cos(angle) * shift, origin.y + Math.sin(angle) * shift)
      .setRotation(angle).setDisplaySize(width, height).setVisible(true);
    q.shape[0] = width; q.shape[1] = height;
  }
  render(f: KrakenReviewEffectFrame | { effect: 'none' }): void {
    this.telegraph.clear();
    for (const q of this.quads()) q.object.setVisible(false);
    if (f.effect === 'none') return;
    this.time = f.time;
    if (f.effect === 'egg-throw') {
      f.eggs?.forEach((egg, i) => {
        if (!egg.visible) return;
        const q = this.eggGround[i], flash = this.eggFlash[i];
        this.place(q, egg.point, 0, egg.radius * 7, egg.radius * 7);
        q.age = egg.landingAge; q.shape[2] = egg.radius; q.shape[3] = i;
        q.timing = [egg.height, egg.hatchAge, 0, 0]; q.opacity = egg.alpha;
        if (egg.hatchAge >= 0 && egg.hatchAge < .55) {
          this.place(flash, egg.point, 0, egg.radius * 7, egg.radius * 7);
          flash.age = egg.hatchAge; flash.shape[2] = egg.radius; flash.shape[3] = i;
        }
      });
      return;
    }
    if (f.bodyMotion) {
      const b = f.bodyMotion, dive = f.effect === 'dive', q = this.motion;
      this.place(q, b.center, f.angle, b.radius * 5, b.radius * 5);
      q.age = dive ? f.time - b.submerged : f.time;
      q.shape[2] = b.radius; q.shape[3] = dive ? 1 : 0;
      q.timing = [dive ? b.lifetime : b.arms, b.shadowOpacity, b.foamOpacity, b.lead];
      if (!dive && f.time >= b.arms) q.object.setVisible(false);
      if (!dive) [b.arms, b.keel, b.roar].forEach((at, i) => {
        const plume = this.plumes[i], age = f.time - at;
        if (age < 0 || age >= b.lifetime || (i === 2 && f.effect !== 'intro')) return;
        const radius = b.radius * (i === 1 ? .7 : i === 2 ? 1.35 : 1);
        plume.mode = 1; plume.age = age; plume.opacity = 1;
        this.place(plume, b.center, f.angle, radius * 5, radius * 5);
        plume.shape[2] = radius; plume.shape[3] = i;
        plume.timing = [b.lifetime, .1, 0, b.foamOpacity];
        plume.detail = [b.sprayCount, b.spraySpeed, i === 2 ? 3.4 : 1.8, 1];
      });
      return;
    }
    if (f.effect === 'ink') {
      if (f.time < f.spit) this.telegraph.showAttack('ink', {
        ...f.mouth, angle: f.angle, range: f.ink.range, halfArc: f.ink.halfAngle * Math.PI / 180,
        telegraphOnly: true, startedAt: 0, strikeAt: f.spit * 1000, hitAt: f.spit * 1000, color: ENEMY_CLAW_HOSTILE_COLOR,
      });
      const q = this.ink; q.age = f.time - f.spit;
      if (q.age < 0 || q.age >= f.ink.travel + f.ink.hold + f.ink.dissolve) return;
      const quad = krakenInkQuad(f.ink.range, f.ink.halfAngle * Math.PI / 180);
      this.place(q, f.mouth, f.angle, quad.width, quad.height, quad.shift);
      q.shape[2] = f.ink.range; q.shape[3] = Math.tan(f.ink.halfAngle * Math.PI / 180);
      q.timing = [f.ink.travel, f.ink.hold, f.ink.dissolve, f.ink.waterSpread];
      q.detail = [f.ink.cloudWarp, f.ink.sheen, 0, quad.shift];
      q.opacity = f.ink.opacity;
      const rgb = (color: number) => [(color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255];
      q.core = rgb(f.ink.coreColor); q.edge = rgb(f.ink.edgeColor);
      this.updateMask(q.object, quad.width, quad.height);
      return;
    }
    f.shores.forEach((point, index) => {
      const plume = this.plumes[index], ground = this.surfaces[index];
      plume.mode = f.effect === 'erupt' ? 1 : 2;
      if (f.effect === 'erupt') {
        const retracting = f.time >= f.retract;
        plume.age = f.time - (retracting ? f.retract : f.erupt.rise);
        if (plume.age < -f.erupt.bulgeDuration || plume.age >= f.erupt.lifetime) return;
        const radius = f.erupt.radius * (retracting ? f.erupt.retractScale : 1);
        this.place(plume, point, f.angle, radius * 5, radius * 5);
        plume.shape[2] = radius; plume.shape[3] = index;
        plume.timing = [f.erupt.lifetime, f.erupt.bulgeDuration, retracting ? 1 : 0, f.erupt.foamOpacity];
        plume.detail = [f.erupt.sprayCount, f.erupt.spraySpeed * (retracting ? f.erupt.retractScale : 1), 0, 0];
      } else {
        if (f.time < f.impact) this.telegraph.showAttack(`slam-${index}`, {
          shape: 'lane', ...point, angle: f.angle, length: f.length, width: f.width,
          startedAt: 0, strikeAt: f.impact * 1000, hitAt: f.impact * 1000, color: ENEMY_CLAW_HOSTILE_COLOR,
        });
        const age = f.time - f.impact;
        for (const [q, lifetime] of [[ground, f.slam.decalLifetime], [plume, f.slam.dustLifetime]] as const) {
          if (age < 0 || age >= lifetime) continue;
          q.age = age;
          this.place(q, point, f.angle, f.length * 1.8, Math.max(f.width * 3, f.slam.contactWidth * 3 + f.slam.curveBend * 2), f.length * 1.8 * .3);
          q.shape[2] = f.length; q.shape[3] = f.width;
          q.timing = [lifetime, f.slam.whipDelay, f.slam.curveBend, f.slam.contactWidth];
        }
      }
    });
  }
  private updateMask(s: Phaser.GameObjects.Shader, width: number, height: number): void {
    const signature = [s.x, s.y, s.rotation, width, height].join(',');
    if (signature === this.maskSignature) return;
    this.maskSignature = signature;
    const image = this.mask.context.createImageData(128, 128), c = Math.cos(s.rotation), sn = Math.sin(s.rotation);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const dx = ((x + .5) / 128 - .5) * width, dy = ((y + .5) / 128 - .5) * height;
      const i = (y * 128 + x) * 4;
      image.data[i] = Math.round(Math.max(0, Math.min(1, this.waterAt(s.x + dx * c - dy * sn, s.y + dx * sn + dy * c))) * 255);
      image.data[i + 3] = 255;
    }
    this.mask.context.putImageData(image, 0, 0); this.mask.refresh();
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const q of this.quads()) q.object.destroy();
    this.telegraph.destroy(); this.mask.destroy();
  }
  private quads(): Quad[] { return [this.ink, ...this.surfaces, ...this.plumes, this.motion, ...this.eggGround, ...this.eggFlash]; }
}
