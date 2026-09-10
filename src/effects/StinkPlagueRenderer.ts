import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import { registerGraphicsObject } from './EffectUtils';
import { TEX_STINK_PUFF } from './gpu/GpuVfxSourceTextures';
import type { EntityStatusVisualTarget } from './SmokeBodyEffect';
import type { StinkPlagueSnapshot, SyncedPlagueTarget, PlagueTransfer } from '../systems/StinkPlagueRuntime';

type Body = { image: Phaser.GameObjects.Image; wisps: Phaser.GameObjects.Image[] };
type Impulse = { image: Phaser.GameObjects.Image; event: PlagueTransfer };

/** Snapshot-driven body marks. Only decorative wisps/impulses consume quality budgets. */
export class StinkPlagueRenderer {
  private targets: readonly SyncedPlagueTarget[] = [];
  private lookup: (id: string) => EntityStatusVisualTarget | null = () => null;
  private now = 0;
  private sequence: number | null = null;
  private readonly bodies = new Map<string, Body>();
  private readonly bodyPool: Body[] = [];
  private readonly impulses: Impulse[] = [];
  private readonly impulsePool: Phaser.GameObjects.Image[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  sync(snapshot: StinkPlagueSnapshot, now: number, lookup: typeof this.lookup): void {
    this.targets = snapshot.targets; this.now = now; this.lookup = lookup;
    const budget = Math.round(96 * getGraphicsQualityProfile(this.scene).particleFactors.standard);
    if (this.sequence !== null) for (const event of snapshot.transfers) {
      if (event.sequence <= this.sequence || now - event.createdAt >= 240 || this.impulses.length >= budget) continue;
      const image = this.impulsePool.pop() ?? this.puff();
      this.impulses.push({ image, event });
    }
    this.sequence = Math.max(this.sequence ?? 0, snapshot.transferSequence);
    this.update(0);
  }

  update(delta: number): void {
    this.now += delta;
    const view = getVisibleWorldView(this.scene.cameras.main);
    const wispCount = Math.round(2 * getGraphicsQualityProfile(this.scene).particleFactors.standard);
    const visible = new Set<string>();
    for (const state of this.targets) {
      if (state.expiresAt <= this.now) continue;
      const target = this.lookup(state.enemyId);
      if (!target || target.entityGeneration !== state.entityGeneration || !target.visible
        || !target.sprite.active || !target.sprite.visible) continue;
      const { sprite, bodySize: size } = target;
      if (sprite.x + size < view.x || sprite.x - size > view.x + view.width
        || sprite.y + size < view.y || sprite.y - size > view.y + view.height) continue;
      const key = state.enemyId + ':' + state.entityGeneration;
      visible.add(key);
      let body = this.bodies.get(key);
      if (!body) {
        body = this.bodyPool.pop() ?? { image: this.puff(), wisps: [this.puff(), this.puff()] };
        this.bodies.set(key, body);
      }
      const infectious = state.infectiousUntil > this.now;
      const phase = this.now * (infectious ? .009 : .003) + sprite.x * .017;
      const depth = Math.min(DEPTH.SMOKE - .12, sprite.depth + .22);
      body.image.setTexture(sprite.texture.key, sprite.frame.name).setVisible(true)
        .setOrigin(sprite.originX, sprite.originY).setFlip(sprite.flipX, sprite.flipY)
        .setPosition(sprite.x, sprite.y).setRotation(sprite.rotation)
        .setDisplaySize(sprite.displayWidth, sprite.displayHeight).setDepth(depth)
        .setTint(infectious ? 0xb8ba43 : 0x8b9860).setAlpha((.18 + .05 * Math.sin(phase)) * sprite.alpha);
      body.wisps.forEach((wisp, index) => {
        const angle = phase * .22 + index * Math.PI;
        wisp.setVisible(index < wispCount).setPosition(sprite.x + Math.sin(angle) * size * .19,
          sprite.y + Math.cos(angle * 1.3) * size * .16).setDepth(depth + .01)
          .setRotation(angle).setDisplaySize(size * .52, size * .32)
          .setAlpha((infectious ? .27 : .10) * sprite.alpha);
      });
    }
    for (const [key, body] of this.bodies) if (!visible.has(key)) {
      for (const image of [body.image, ...body.wisps]) image.setVisible(false);
      this.bodies.delete(key);
      if (this.bodyPool.length < 128) this.bodyPool.push(body);
      else for (const image of [body.image, ...body.wisps]) image.destroy();
    }
    for (let i = this.impulses.length - 1; i >= 0; i--) {
      const { image, event } = this.impulses[i];
      const progress = Math.max(0, (this.now - event.createdAt) / 240);
      if (progress >= 1) {
        image.setVisible(false); this.impulses.splice(i, 1); this.impulsePool.push(image); continue;
      }
      image.setVisible(true).setPosition(event.fromX + (event.toX - event.fromX) * progress,
        event.fromY + (event.toY - event.fromY) * progress).setDepth(DEPTH.SMOKE - .11)
        .setRotation(Math.atan2(event.toY - event.fromY, event.toX - event.fromX))
        .setDisplaySize(22 + progress * 13, 12).setAlpha(Math.sin(progress * Math.PI) * .6);
    }
  }

  clear(): void {
    for (const body of [...this.bodies.values(), ...this.bodyPool]) for (const image of [body.image, ...body.wisps]) image.destroy();
    for (const image of [...this.impulses.map(i => i.image), ...this.impulsePool]) image.destroy();
    this.bodies.clear(); this.bodyPool.length = 0; this.impulses.length = 0; this.impulsePool.length = 0;
    this.targets = []; this.lookup = () => null; this.sequence = null;
  }

  private puff(): Phaser.GameObjects.Image {
    const image = this.scene.add.image(0, 0, TEX_STINK_PUFF).setTint(0xb4b644).setVisible(false);
    registerGraphicsObject(this.scene, 'enemyStatus', image);
    return image;
  }
}
