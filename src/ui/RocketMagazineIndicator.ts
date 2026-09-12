import * as Phaser from 'phaser';
import { DEPTH_AIM } from '../config';
import { ensureCanvasTexture } from '../effects/EffectUtils';
import type { RocketMagazineState } from '../types';

const RADIUS = 21;
const STEPS = 16;
const SIZE = 52;

/** Cached arc textures; cursor updates only change transforms, tint and texture selection. */
export class RocketMagazineIndicator {
  private readonly root: Phaser.GameObjects.Container;
  private readonly segments: Array<{ empty: Phaser.GameObjects.Image; fill: Phaser.GameObjects.Image }> = [];
  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(DEPTH_AIM + 0.01);
  }

  hide(): void { this.root.setVisible(false); }

  update(x: number, y: number, state: RocketMagazineState, now: number): void {
    const capacity = state.capacity;
    const fraction = state.canLoadNext === false ? 0 : Math.max(0, Math.min(1, 1 - (state.nextLoadAt - now) / Math.max(1, state.intervalMs)));
    const color = state.focused ? 0x8fefff : 0xffc16e;
    this.root.setPosition(x, y).setVisible(true).setScale(state.focused ? 15 / RADIUS : 1);
    while (this.segments.length < capacity) {
      const empty = this.scene.add.image(0, 0, this.texture(capacity, STEPS));
      const fill = this.scene.add.image(0, 0, this.texture(capacity, STEPS));
      this.root.add([empty, fill]); this.segments.push({ empty, fill });
    }
    this.segments.forEach(({ empty, fill }, i) => {
      const visible = i < capacity;
      empty.setVisible(visible); fill.setVisible(visible);
      if (!visible) return;
      const rotation = i * Math.PI * 2 / capacity;
      empty.setTexture(this.texture(capacity, STEPS)).setRotation(rotation).setTint(color).setAlpha(0.18);
      const progress = i < state.loaded ? STEPS : i === state.loaded ? Math.ceil(fraction * STEPS) : 0;
      fill.setVisible(progress > 0).setTexture(this.texture(capacity, Math.max(1, progress)))
        .setRotation(rotation).setTint(color).setAlpha(0.95);
    });
  }

  private texture(capacity: number, progress: number): string {
    const key = '__rocket_magazine_' + capacity + '_' + progress;
    ensureCanvasTexture(this.scene.textures, key, SIZE, SIZE, ctx => {
      const start = -Math.PI / 2 + 0.12;
      const end = start + (Math.PI * 2 / capacity - 0.24) * progress / STEPS;
      ctx.strokeStyle = 'rgba(8,15,24,0.9)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, RADIUS, start, end); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, RADIUS, start, end); ctx.stroke();
    });
    return key;
  }

  destroy(): void { this.root.destroy(); this.segments.length = 0; }
}
