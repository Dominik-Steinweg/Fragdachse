import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { GROUND_FIRE_CELL_SIZE } from './FireSystem';
import { TEX_VOID_FLAME_GLOW } from './FlameShared';
import type { SyncedBurningGroundSnapshot } from '../types';

/** A soft, pulsing preheat band. It only reads the host-selected upcoming cells. */
export class GroundHazardWarningRenderer {
  private readonly images: Phaser.GameObjects.Image[] = [];
  constructor(private readonly scene: Phaser.Scene) {}

  sync(cells: SyncedBurningGroundSnapshot['warnings'], now: number): void {
    let used = 0;
    for (const cell of cells ?? []) {
      if (cell.activatesAt <= now) continue;
      const image = this.images[used] ?? this.scene.add.image(0, 0, TEX_VOID_FLAME_GLOW)
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.FIRE - 0.1).setTint(0xc992ff);
      this.images[used++] = image;
      const urgency = 1 - Math.min(1, (cell.activatesAt - now) / 3000);
      image.setPosition((cell.gridX + 0.5) * GROUND_FIRE_CELL_SIZE, (cell.gridY + 0.5) * GROUND_FIRE_CELL_SIZE)
        .setDisplaySize(GROUND_FIRE_CELL_SIZE * 2.2, GROUND_FIRE_CELL_SIZE * 2.2)
        .setAlpha((0.12 + urgency * 0.16) * (0.8 + Math.sin(now * 0.007 + cell.gridY * 0.3) * 0.2))
        .setVisible(true);
    }
    for (let i = used; i < this.images.length; i++) this.images[i].setVisible(false);
  }

  clear(): void { for (const image of this.images) image.destroy(); this.images.length = 0; }
}
