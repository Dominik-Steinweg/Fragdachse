import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { configureAdditiveImage, mixColors, registerGraphicsObject } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';

interface ChargeVisual { halo: Phaser.GameObjects.Image; tail: Phaser.GameObjects.Image; core: Phaser.GameObjects.Image; ribbons: Phaser.GameObjects.Image[] }

/** Compact molten droplets; shares the burner's textures and never allocates per-frame particles. */
export class PlasmaBurnerChargeRenderer {
  private readonly visuals = new Map<number, ChargeVisual>();
  private readonly pool: ChargeVisual[] = [];
  constructor(private readonly scene: Phaser.Scene) {}
  has(id: number): boolean { return this.visuals.has(id); }
  getActiveIds(): IterableIterator<number> { return this.visuals.keys(); }
  createVisual(id: number, x: number, y: number, size: number, color: number): void {
    if (this.has(id)) return;
    const make = (texture: string) => {
      const image = configureAdditiveImage(this.scene.add.image(0, 0, texture), DEPTH.PROJECTILES + 0.1, 1, 0xffffff);
      registerGraphicsObject(this.scene, 'plasmaBurnerEffects', image);
      return image;
    };
    const visual = this.pool.pop() ?? { halo: make('__plasma_burner_haze'), tail: make('__plasma_burner_streak'),
      core: make('__plasma_burner_spark'), ribbons: [make('__plasma_burner_streak'), make('__plasma_burner_streak')] };
    for (const image of [visual.halo, visual.tail, visual.core, ...visual.ribbons]) image.setVisible(true);
    this.visuals.set(id, visual);
    this.updateVisual(id, x, y, size, 1, 0, color);
  }
  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number, color: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    const angle = Math.atan2(vy, vx);
    const tint = mixColors(color, 0x4dff3a, 0.72);
    const pulse = 1 + Math.sin(this.scene.time.now * 0.018 + id * 2.4) * 0.08;
    visual.halo.setPosition(x, y).setDisplaySize(size * 4, size * 4).setTint(tint).setAlpha(emissiveAlpha(0.22));
    visual.tail.setPosition(x - Math.cos(angle) * size, y - Math.sin(angle) * size)
      .setRotation(angle).setDisplaySize(size * 3.5, size * 0.8).setTint(tint).setAlpha(emissiveAlpha(0.7));
    visual.core.setPosition(x, y).setDisplaySize(size * 1.15 * pulse, size * 1.15 * pulse)
      .setTint(0xf4ffd9).setAlpha(emissiveAlpha(0.95));
    visual.ribbons.forEach((ribbon, index) => {
      const phase = this.scene.time.now * 0.011 + id + index * Math.PI;
      ribbon.setPosition(x + Math.cos(phase) * size * 0.6, y + Math.sin(phase) * size * 0.6)
        .setRotation(phase + Math.PI / 2).setDisplaySize(size * 1.2, size * 0.22)
        .setTint(tint).setAlpha(emissiveAlpha(0.65));
    });
  }
  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    for (const image of [visual.halo, visual.tail, visual.core, ...visual.ribbons]) image.setVisible(false);
    this.visuals.delete(id);
    this.pool.push(visual);
  }
  destroyAll(): void {
    for (const id of this.visuals.keys()) this.destroyVisual(id);
    for (const visual of this.pool) for (const image of [visual.halo, visual.tail, visual.core, ...visual.ribbons]) image.destroy();
    this.pool.length = 0;
  }
}
