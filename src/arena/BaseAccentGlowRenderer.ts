import * as Phaser from 'phaser';
import { emissiveAlpha } from '../effects/EmissiveScale';
import { BASE_ACCENT_PADDING } from './BaseAccentMask';
import { acquireBaseAccentGlowTexture } from './BaseAccentGlowTexture';

const PERIOD_MS = 3000;

interface AccentCell {
  readonly source: Phaser.GameObjects.Image;
  readonly core: Phaser.GameObjects.Image;
  readonly halo: Phaser.GameObjects.Image;
}

/** Static base geometry with a shared scene-time pulse; owns neither bodies nor HP. */
export class BaseAccentGlowRenderer {
  private readonly cells = new Map<number, AccentCell>();
  private texture: ReturnType<typeof acquireBaseAccentGlowTexture> | null = null;

  constructor(private readonly scene: Phaser.Scene, images: readonly Phaser.GameObjects.Image[]) {
    if (images.length === 0) return;
    this.texture = acquireBaseAccentGlowTexture(scene.textures);
    images.forEach((source, index) => {
      const name = String(source.frame.name);
      if (!this.texture!.frames.has(name)) return;
      const width = source.frame.width + BASE_ACCENT_PADDING * 2;
      const height = source.frame.height + BASE_ACCENT_PADDING * 2;
      const overlay = (layer: 'core' | 'halo', tint: number, depth: number) => scene.add.image(
        source.x, source.y, this.texture!.key, `${name}:${layer}`,
      )
        .setOrigin((source.frame.width * source.originX + BASE_ACCENT_PADDING) / width,
          (source.frame.height * source.originY + BASE_ACCENT_PADDING) / height)
        .setDisplaySize(width * source.scaleX, height * source.scaleY)
        .setRotation(source.rotation)
        .setDepth(source.depth + depth)
        .setTint(tint)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.cells.set(index, {
        source,
        halo: overlay('halo', 0x278fff, 0.04),
        core: overlay('core', 0x72caff, 0.05),
      });
    });
    if (this.cells.size === 0) {
      this.texture.release();
      this.texture = null;
      return;
    }
    this.update();
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.update, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private update(): void {
    const pulse = 0.5 - 0.5 * Math.cos(this.scene.time.now / PERIOD_MS * Math.PI * 2);
    const coreAlpha = emissiveAlpha(0.2 + pulse * 0.28);
    const haloAlpha = emissiveAlpha(0.3 + pulse * 0.25);
    for (const cell of this.cells.values()) {
      const alpha = cell.source.active && cell.source.visible ? cell.source.alpha : 0;
      cell.core.setAlpha(coreAlpha * alpha);
      cell.halo.setAlpha(haloAlpha * alpha);
    }
  }

  destroyCell(index: number): void {
    const cell = this.cells.get(index);
    if (!cell) return;
    cell.core.destroy();
    cell.halo.destroy();
    this.cells.delete(index);
    if (this.cells.size === 0) this.destroy();
  }

  destroy(): void {
    if (!this.texture) return;
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.update, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const cell of this.cells.values()) {
      cell.core.destroy();
      cell.halo.destroy();
    }
    this.cells.clear();
    this.texture.release();
    this.texture = null;
  }
}
