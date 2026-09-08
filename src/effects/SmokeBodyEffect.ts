import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { fillRadialGradientTexture, makeAdditive, registerGraphicsObject } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';

export interface EntityStatusVisualTarget {
  readonly sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  readonly bodySize: number;
  readonly visible: boolean;
}

const GLOW = '__smoke_status_scatter';
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const random = (n: number) => { const v = Math.sin(n * 127.1 + 91.7) * 43758.5453; return v - Math.floor(v); };

/** A colour overlay follows the real animated body without changing its own tint. */
export class VulnerableBodyEffect {
  private image: Phaser.GameObjects.Image | null = null;
  private active = false;
  private endedAt = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  setActive(active: boolean): void {
    if (this.active && !active) this.endedAt = this.scene.time.now;
    this.active = active;
  }

  sync(target: EntityStatusVisualTarget): void {
    const { sprite } = target;
    const fade = this.active ? 1 : clamp(1 - (this.scene.time.now - this.endedAt) / 220);
    if (!target.visible || !sprite.active || !sprite.visible || (!this.active && !this.image) || fade <= 0) {
      this.image?.destroy(); this.image = null; return;
    }
    if (!this.image) {
      this.image = makeAdditive(this.scene.add.image(sprite.x, sprite.y, sprite.texture.key, sprite.frame.name)).setTint(0xd24b42);
      registerGraphicsObject(this.scene, 'enemyStatus', this.image);
    }
    const pulse = .16 + .10 * (.5 + .5 * Math.sin(this.scene.time.now * .006 + sprite.x * .013));
    this.image.setTexture(sprite.texture.key, sprite.frame.name)
      .setOrigin(sprite.originX, sprite.originY).setFlip(sprite.flipX, sprite.flipY)
      .setPosition(sprite.x, sprite.y).setRotation(sprite.rotation)
      .setDisplaySize(sprite.displayWidth, sprite.displayHeight)
      .setDepth(Math.min(DEPTH.SMOKE - .1, sprite.depth + .19))
      .setAlpha(emissiveAlpha(pulse * fade * sprite.alpha));
  }

  destroy(): void { this.image?.destroy(); this.image = null; this.active = false; }
}

/** Bounded body effects, owned by the smoke renderer for one target sprite instance. */
export class SmokeBodyEffect {
  readonly sprite: EntityStatusVisualTarget['sprite'];
  private readonly wisps: Phaser.GameObjects.Image[];
  private readonly arcs: Phaser.GameObjects.Graphics;
  private readonly scatter: Phaser.GameObjects.Image;
  private shapeStep = -1;
  private lastSize = 0;
  private readonly seed: number;
  private readonly startedAt: number;

  constructor(private readonly scene: Phaser.Scene, target: EntityStatusVisualTarget, wispTexture: string, seed: number) {
    this.sprite = target.sprite;
    this.seed = seed;
    this.startedAt = scene.time.now;
    fillRadialGradientTexture(scene.textures, GLOW, 96, [
      [0, 'rgba(230,247,255,.65)'], [.25, 'rgba(178,215,255,.30)'],
      [.6, 'rgba(125,181,255,.09)'], [1, 'rgba(100,155,255,0)'],
    ]);
    this.wisps = [0, 1, 2].map(() => scene.add.image(0, 0, wispTexture).setTint(0xb1b3ba));
    this.arcs = makeAdditive(scene.add.graphics());
    this.scatter = makeAdditive(scene.add.image(0, 0, GLOW)).setTint(0x9bcfff).setDepth(DEPTH.SMOKE + .05);
    this.arcs.setVisible(false);
    registerGraphicsObject(scene, 'enemyStatus', this.arcs);
    for (const object of [...this.wisps, this.scatter]) {
      object.setVisible(false);
      registerGraphicsObject(scene, 'enemyStatus', object);
    }
  }

  update(target: EntityStatusVisualTarget, confusedUntil: number, chargedUntil: number, now: number, smokeCover: number): void {
    const { sprite, bodySize: size } = target;
    if (!target.visible || !sprite.active || !sprite.visible) {
      for (const object of [...this.wisps, this.arcs, this.scatter]) object.setVisible(false);
      return;
    }
    const t = (this.scene.time.now - this.startedAt) * .001;
    const confusion = clamp((confusedUntil - now) / 350);
    const charge = clamp((chargedUntil - now) / 300);
    const depth = Math.min(DEPTH.SMOKE - .1, sprite.depth + .27);
    this.wisps.forEach((wisp, i) => {
      const phase = t * (.65 + i * .11) + this.seed + i * 2.1;
      const travel = (t * .43 + i / 3 + random(this.seed)) % 1;
      const envelope = Math.sin(travel * Math.PI);
      wisp.setVisible(confusion > 0).setDepth(depth)
        .setPosition(sprite.x + Math.sin(phase) * size * .16, sprite.y + Math.cos(phase * 1.31) * size * .13)
        .setRotation(phase * .37 + Math.sin(phase * .7) * .3)
        .setDisplaySize(size * (.85 + travel * .5), size * (.42 + travel * .25))
        .setAlpha(confusion * envelope * .22 * sprite.alpha);
    });
    const cycle = Math.floor((t + this.seed) / .63);
    const age = (t + this.seed) % .63;
    const onset = .06 + random(cycle + this.seed) * .17;
    const pulseAge = age - onset;
    const pulse = pulseAge > 0 && pulseAge < .23 ? Math.sin(Math.PI * pulseAge / .23) : 0;
    const lightPulse = pulseAge > 0 && pulseAge < .44 ? (1 - Math.exp(-pulseAge * 35)) * (1 - pulseAge / .44) : 0;
    const step = cycle * 10 + Math.floor(age / .08);
    if (charge > 0 && pulse > 0 && (step !== this.shapeStep || size !== this.lastSize)) {
      this.drawArcs(size, step); this.shapeStep = step; this.lastSize = size;
    }
    this.arcs.setVisible(charge > 0 && pulse > 0).setDepth(depth + .01)
      .setPosition(sprite.x, sprite.y).setRotation(sprite.rotation).setAlpha(emissiveAlpha(charge * pulse * sprite.alpha));
    // Only diffuse light sits above smoke. The thin bolts and the body remain occluded.
    this.scatter.setVisible(charge > 0 && smokeCover > 0 && lightPulse > 0)
      .setPosition(sprite.x, sprite.y).setDisplaySize(size * 4.2, size * 3.7)
      // This illuminates the dark smoke surface, like its own weather shader.
      // Daylight attenuation for ground emitters would erase that diffuse signal.
      .setAlpha(charge * lightPulse * smokeCover * .65 * sprite.alpha);
  }

  private drawArcs(size: number, step: number): void {
    this.arcs.clear();
    const seed = this.seed + step * 13;
    for (let a = 0; a < 2; a++) {
      const angle = random(seed + a * 17) * Math.PI * 2;
      const length = size * (.36 + random(seed + a + 7) * .22);
      const cx = Math.cos(angle) * size * .12, cy = Math.sin(angle) * size * .12;
      const points = Array.from({ length: 6 }, (_, i) => {
        const along = (i / 5 - .5) * length;
        const across = (random(seed + i * 3 + a * 29) - .5) * size * .17;
        return { x: cx + Math.cos(angle) * along - Math.sin(angle) * across,
          y: cy + Math.sin(angle) * along + Math.cos(angle) * across };
      });
      for (const [width, color, alpha] of [[2.8, 0x5eabec, .22], [.85, 0xd7f2ff, .82]]) {
        this.arcs.lineStyle(width, color, alpha);
        for (let i = 1; i < points.length; i++) this.arcs.lineBetween(points[i-1].x, points[i-1].y, points[i].x, points[i].y);
      }
      // Tiny escaping sparks remain close to the body, with no orbit or icon.
      const tip = points[5];
      this.arcs.lineStyle(.7, 0xe9faff, .65);
      this.arcs.lineBetween(tip.x * 1.18, tip.y * 1.18, tip.x * 1.32, tip.y * 1.32);
    }
  }

  destroy(): void { for (const object of [...this.wisps, this.arcs, this.scatter]) object.destroy(); }
}
