import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { registerGraphicsObject } from '../effects/EffectUtils';
import type { ArenaLayout } from '../types';
import type { ChunkWorldFrame, ChunkWorldRect } from './chunks/ArenaChunkGrid';
import { AMBIENT_WILDLIFE as TUNING } from './AmbientWildlifeConfig';
import { snakeTongueExtension, writeSnakeBodyPose, writeFishMemberPose, type FishMemberPose,
  type SnakeBodyPose } from './AmbientWildlifeAppearance';
import { AmbientWildlifeModel, type WildlifeAnimal, type WildlifePlayer } from './AmbientWildlifeModel';

/** Two bounded, batched vector layers; tiny silhouettes animate at actual world scale. */
export class AmbientWildlifeRenderer {
  readonly model: AmbientWildlifeModel;
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly fish: Phaser.GameObjects.Graphics;
  private destroyed = false;
  private visualTime = 0;
  private readonly snakePose: SnakeBodyPose = { x: 0, y: 0, halfWidth: 0 };
  private readonly fishPose: FishMemberPose = { x: 0, y: 0, length: 0 };

  constructor(scene: Phaser.Scene, frame: ChunkWorldFrame, layout: ArenaLayout) {
    this.model = new AmbientWildlifeModel(layout, frame);
    this.ground = scene.add.graphics().setDepth(DEPTH.DECALS + .4).setName('ambient-wildlife-land');
    this.fish = scene.add.graphics().setDepth(DEPTH.WATER + .1).setName('ambient-wildlife-fish');
    registerGraphicsObject(scene, 'ambientWildlife', this.ground);
    registerGraphicsObject(scene, 'ambientWildlife', this.fish);
  }

  update(deltaMs: number, players: readonly WildlifePlayer[], view: ChunkWorldRect): void {
    if (this.destroyed) return;
    this.visualTime += Math.max(0, Math.min(deltaMs / 1000, .05));
    this.model.update(deltaMs, players, view);
    this.ground.clear(); this.fish.clear();
    for (const a of this.model.animals) {
      const margin = a.appearance.footprint;
      if (a.opacity <= .005 || a.x < view.x - margin || a.y < view.y - margin
        || a.x > view.x + view.width + margin || a.y > view.y + view.height + margin) continue;
      const g = a.kind === 'fish' ? this.fish : this.ground;
      g.save(); g.translateCanvas(a.x, a.y); g.rotateCanvas(a.angle);
      if (a.kind !== 'fish') g.scaleCanvas(TUNING.visualScale, TUNING.visualScale);
      if (a.kind === 'butterfly') this.drawButterfly(g, a);
      else if (a.kind === 'snake') this.drawSnake(g, a);
      else this.drawSchool(g, a);
      g.restore();
    }
  }

  notifyShot(x: number, y: number): void {
    if (!this.destroyed) this.model.notifyShot(x, y);
  }

  private drawButterfly(g: Phaser.GameObjects.Graphics, a: WildlifeAnimal): void {
    const flap = .28 + .72 * (.5 - .5 * Math.cos(a.animation * 2));
    const color = TUNING.butterflyColors[a.appearance.colorIndex];
    g.fillStyle(0x24372a, .17); g.fillEllipse(-1, 2, 3.4, 1.6, 8);
    g.save(); g.translateCanvas(0, Math.sin(a.animation * .19) * .75);
    const width = TUNING.butterfly.size * .48 * flap;
    for (const side of [-1, 1]) {
      g.fillStyle(0x555047, .7); g.fillEllipse(.5, side * width * .52, 3.5, width, 8);
      g.fillStyle(color, .95); g.fillEllipse(.65, side * width * .55, 2.9, width * .8, 8);
      g.fillEllipse(-1.2, side * width * .43, 1.9, width * .72, 8);
      g.fillStyle(0xfff5d9, .62); g.fillEllipse(1, side * width * .7, .8, width * .25, 6);
    }
    g.lineStyle(.55, 0x454139, .95); g.lineBetween(-1.6, 0, 1.8, 0);
    g.restore();
  }

  private drawSnake(g: Phaser.GameObjects.Graphics, a: WildlifeAnimal): void {
    const tuning = TUNING.snakeVisual;
    const colors = TUNING.snakeColors[a.appearance.colorIndex];
    const pose = this.snakePose, segments = tuning.segments;
    // A continuous tapered ribbon keeps the tiny tail from breaking into beads.
    for (const shadow of [true, false]) {
      g.fillStyle(shadow ? 0x20271d : colors.body, shadow ? .25 : .98);
      g.beginPath();
      for (let i = 0; i <= segments * 2; i++) {
        const t = (i <= segments ? i : segments * 2 - i) / segments;
        const side = i <= segments ? 1 : -1;
        writeSnakeBodyPose(a.appearance, a.animation, t, pose);
        const x = pose.x + (shadow ? .5 : 0);
        const y = pose.y + side * pose.halfWidth + (shadow ? .65 : 0);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fillPath();
    }
    // A tapered dorsal ribbon follows the same wave, including near the tail.
    g.fillStyle(colors.highlight, .3); g.beginPath();
    for (let i = 0; i <= segments * 2; i++) {
      const t = (i <= segments ? i : segments * 2 - i) / segments;
      writeSnakeBodyPose(a.appearance, a.animation, t, pose);
      const y = pose.y + (i <= segments ? .15 : -.35) * pose.halfWidth;
      if (i === 0) g.moveTo(pose.x, y); else g.lineTo(pose.x, y);
    }
    g.closePath(); g.fillPath();
    for (let i = 1; i < 11; i++) {
      writeSnakeBodyPose(a.appearance, a.animation, i / 12, pose);
      g.fillStyle(colors.pattern, .55);
      g.fillEllipse(pose.x, pose.y + pose.halfWidth * .35, .85, pose.halfWidth * .7, 8);
    }
    g.save(); g.scaleCanvas(tuning.scale, a.appearance.widthScale);
    const extension = snakeTongueExtension(this.visualTime, a.variation);
    if (extension > 0) {
      const root = 1.45, tip = root + tuning.tongueLength * extension;
      const fork = tip - .65 * extension;
      g.lineStyle(tuning.tongueWidth, tuning.tongueColor, .95);
      g.beginPath(); g.moveTo(root, 0); g.lineTo(fork, 0);
      g.lineTo(tip, -.36 * extension); g.moveTo(fork, 0); g.lineTo(tip, .36 * extension);
      g.strokePath();
    }
    g.fillStyle(colors.head, 1); g.fillEllipse(.15, 0, 2.8, 1.65, 16);
    g.fillStyle(colors.highlight, .3); g.fillEllipse(.3, -.15, 1.8, .65, 12);
    g.fillStyle(0x20291c, .95);
    g.fillEllipse(.85, -.57, .35, .33, 8); g.fillEllipse(.85, .57, .35, .33, 8);
    g.restore();
  }

  private drawSchool(g: Phaser.GameObjects.Graphics, a: WildlifeAnimal): void {
    const appearance = a.appearance;
    const colors = TUNING.fishColors[appearance.colorIndex];
    for (let i = 0; i < appearance.count; i++) {
      writeFishMemberPose(appearance, a.animation, a.variation, i, this.fishPose);
      const { x, y, length } = this.fishPose;
      const tail = Math.sin(a.animation + i * .8) * .7;
      g.save(); g.translateCanvas(x, y);
      g.scaleCanvas(TUNING.visualScale, TUNING.visualScale * appearance.widthScale);
      // Low contrast blue-green silhouettes and a broken silver back read below
      // the surface. Diving removes the glint first, then the entire silhouette.
      g.fillStyle(colors.body, a.opacity * .72);
      g.fillEllipse(0, 0, length * .72, 1.3, 8);
      g.fillTriangle(-length * .22, 0, -length * .62, tail - .8, -length * .62, tail + .8);
      g.lineStyle(.4, colors.back, a.opacity * a.opacity * .55);
      g.lineBetween(-length * .15, -.3, length * .25, -.3);
      g.restore();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ground.destroy(); this.fish.destroy(); this.model.destroy();
  }
}
