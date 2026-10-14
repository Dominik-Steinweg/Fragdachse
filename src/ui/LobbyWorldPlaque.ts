import type * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { HUD_TONES } from './HudFrameAssets';
import { textStyle } from './ForestModal';

/** Quiet world-space brass/walnut plaque, sharing the HUD's type and tone palette. */
export class LobbyWorldPlaque {
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly keycap: Phaser.GameObjects.Text | null;
  private content = '';
  private width = 0;
  readonly height: number;

  constructor(scene: Phaser.Scene, keycap = false) {
    this.height = keycap ? 34 : 26;
    this.frame = scene.add.graphics().setDepth(DEPTH.LOCAL_UI);
    registerGraphicsObject(scene, 'weaponTelegraphs', this.frame);
    const style = { ...textStyle('body'), fontSize: 15, color: '#f4ead5',
      stroke: '#201a14', strokeThickness: 2, resolution: 2 };
    this.label = scene.add.text(0, 0, '', style).setOrigin(0.5).setDepth(DEPTH.LOCAL_UI + 1);
    this.keycap = keycap ? scene.add.text(0, 0, 'Shift', { ...style, fontStyle: 'bold' })
      .setOrigin(0.5).setDepth(DEPTH.LOCAL_UI + 1) : null;
    this.setAlpha(0);
  }

  setText(text: string): this {
    if (this.content === text) return this;
    this.content = text;
    this.label.setText(text);
    const keyWidth = this.keycap ? 52 : 0;
    this.width = Math.ceil(this.label.width) + keyWidth + 28;
    const left = -this.width / 2, h = this.height;
    const brass = HUD_TONES.gold, tone = HUD_TONES.bronze;
    this.frame.clear()
      .fillStyle(0x000000, 0.4).fillRoundedRect(left - 1, 1, this.width + 2, h + 1, 6)
      .fillStyle(brass.muted).fillRoundedRect(left, 0, this.width, h, 5)
      .fillStyle(0x211b16, 0.97).fillRoundedRect(left + 2, 2, this.width - 4, h - 4, 4)
      .lineStyle(1, tone.accent, 0.65).strokeRoundedRect(left + 3.5, 3.5, this.width - 7, h - 7, 3)
      .fillStyle(brass.accent, 0.75).fillCircle(left + 7, h / 2, 1.5)
      .fillCircle(-left - 7, h / 2, 1.5);
    if (this.keycap) {
      this.frame.fillStyle(0x100e0b).fillRoundedRect(left + 10, 7, 46, 23, 4)
        .fillStyle(0x493d2b).fillRoundedRect(left + 10, 5, 46, 22, 4)
        .lineStyle(1, brass.accent, 0.7).strokeRoundedRect(left + 10, 5, 46, 22, 4);
    }
    return this;
  }

  /** x is the plaque centre; y is its top edge, in world coordinates. */
  setPosition(x: number, y: number): this {
    this.frame.setPosition(x, y);
    this.label.setPosition(x + (this.keycap ? 26 : 0), y + this.height / 2);
    this.keycap?.setPosition(x - this.width / 2 + 33, y + this.height / 2 - 1);
    return this;
  }

  setAlpha(alpha: number): this {
    this.frame.setAlpha(alpha); this.label.setAlpha(alpha); this.keycap?.setAlpha(alpha);
    return this;
  }

  destroy(): void { this.frame.destroy(); this.label.destroy(); this.keycap?.destroy(); }
}
