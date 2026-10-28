import type * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { HUD_TONES } from './HudFrameAssets';
import { textStyle } from './ForestModal';

export interface WorldPlaqueContent {
  /** Bright lead text: the action verb, a name, or a blocked object's name. */
  readonly primary: string;
  /** Quieter trailing text: the object name or a denial reason. */
  readonly secondary?: string;
  readonly blocked?: boolean;
  /** The action prepares in the background: a small turning ring after the text. */
  readonly busy?: boolean;
}

const PAD_X = 12;
const KEYCAP = { width: 42, height: 20, gap: 9 } as const;
const SECONDARY_GAP = 7;
const SPINNER = { gap: 8, radius: 5, width: 2 } as const;
const POINTER = { halfWidth: 6, height: 5 } as const;
const PALETTE = {
  primary: '#f4ead5', secondary: '#cdb78b', blockedPrimary: '#d9cdb5', blockedSecondary: '#d39470',
  walnut: 0x211b16, keycapFace: 0x493d2b, keycapShadow: 0x100e0b,
} as const;

/**
 * Quiet world-space brass/walnut plaque sharing the HUD's type and tone palette. Used for building
 * nameplates and, with a keycap and pointer, for the shared Shift interaction focus.
 */
export class WorldPlaque {
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly primary: Phaser.GameObjects.Text;
  private readonly secondary: Phaser.GameObjects.Text;
  private readonly keycap: Phaser.GameObjects.Text | null;
  private readonly spinner: Phaser.GameObjects.Graphics;
  private spinnerTween: Phaser.Tweens.Tween | null = null;
  private content: WorldPlaqueContent = { primary: '' };
  private pointer: { side: 'above' | 'below'; offsetX: number } | null = null;
  private plaqueWidth = 0;
  private alphaValue = 0;
  readonly height: number;

  constructor(private readonly scene: Phaser.Scene, keycap = false) {
    this.height = keycap ? 30 : 26;
    this.frame = scene.add.graphics().setDepth(DEPTH.LOCAL_UI);
    registerGraphicsObject(scene, 'weaponTelegraphs', this.frame);
    const style = { ...textStyle('body'), fontSize: 15, color: PALETTE.primary,
      stroke: '#201a14', strokeThickness: 2, resolution: 2 };
    this.primary = scene.add.text(0, 0, '', style).setOrigin(0.5).setDepth(DEPTH.LOCAL_UI + 1);
    this.secondary = scene.add.text(0, 0, '', { ...style, color: PALETTE.secondary })
      .setOrigin(0, 0.5).setDepth(DEPTH.LOCAL_UI + 1);
    this.keycap = keycap ? scene.add.text(0, 0, 'Shift', { ...style, fontSize: 13, fontStyle: 'bold' })
      .setOrigin(0.5).setDepth(DEPTH.LOCAL_UI + 1) : null;
    // Drawn around its own origin, so turning it turns the ring in place.
    this.spinner = scene.add.graphics().setDepth(DEPTH.LOCAL_UI + 1).setVisible(false)
      .lineStyle(SPINNER.width, HUD_TONES.gold.accent, .9).beginPath()
      .arc(0, 0, SPINNER.radius, -Math.PI / 2, Math.PI).strokePath();
    this.setAlpha(0);
  }

  get width(): number { return this.plaqueWidth; }

  setText(text: string): this { return this.setContent({ primary: text }); }

  setContent(content: WorldPlaqueContent): this {
    const previous = this.content;
    if (this.plaqueWidth > 0 && previous.primary === content.primary && previous.secondary === content.secondary
      && !!previous.blocked === !!content.blocked && !!previous.busy === !!content.busy) return this;
    this.content = content;
    this.primary.setText(content.primary).setColor(content.blocked ? PALETTE.blockedPrimary : PALETTE.primary);
    this.secondary.setText(content.secondary ? `· ${content.secondary}` : '')
      .setColor(content.blocked ? PALETTE.blockedSecondary : PALETTE.secondary);
    const keyWidth = this.keycap ? KEYCAP.width + KEYCAP.gap : 0;
    const secondaryWidth = content.secondary ? SECONDARY_GAP + Math.ceil(this.secondary.width) : 0;
    const spinnerWidth = content.busy ? SPINNER.gap + SPINNER.radius * 2 : 0;
    this.plaqueWidth = PAD_X * 2 + keyWidth + Math.ceil(this.primary.width) + secondaryWidth + spinnerWidth;
    this.spinner.setVisible(!!content.busy);
    if (content.busy && !this.spinnerTween) {
      this.spinnerTween = this.scene.tweens.add({ targets: this.spinner, angle: 360, duration: 1100, repeat: -1 });
    } else if (!content.busy && this.spinnerTween) {
      this.spinnerTween.remove(); this.spinnerTween = null; this.spinner.setAngle(0);
    }
    this.setAlpha(this.alphaValue);
    return this.redraw();
  }

  /** Points at the object below (`above`) or above (`below`); `offsetX` is relative to the plaque centre. */
  setPointer(side: 'above' | 'below' | null, offsetX = 0): this {
    const next = side ? { side, offsetX: Math.round(offsetX) } : null;
    if (next?.side === this.pointer?.side && next?.offsetX === this.pointer?.offsetX) return this;
    this.pointer = next;
    return this.redraw();
  }

  /** x is the plaque centre; y is its top edge, in world coordinates. */
  setPosition(x: number, y: number): this {
    const left = x - this.plaqueWidth / 2, midY = y + this.height / 2;
    this.frame.setPosition(x, y);
    const textX = left + PAD_X + (this.keycap ? KEYCAP.width + KEYCAP.gap : 0);
    const primaryWidth = Math.ceil(this.primary.width);
    this.primary.setPosition(textX + primaryWidth / 2, midY);
    this.secondary.setPosition(textX + primaryWidth + SECONDARY_GAP, midY);
    this.keycap?.setPosition(left + PAD_X + KEYCAP.width / 2, midY - 1);
    this.spinner.setPosition(left + this.plaqueWidth - PAD_X - SPINNER.radius, midY);
    return this;
  }

  setAlpha(alpha: number): this {
    this.alphaValue = alpha;
    this.frame.setAlpha(alpha); this.primary.setAlpha(alpha); this.secondary.setAlpha(alpha); this.spinner.setAlpha(alpha);
    this.keycap?.setAlpha(alpha * (this.content.blocked ? 0.55 : 1));
    return this;
  }

  destroy(): void {
    this.spinnerTween?.remove(); this.spinnerTween = null;
    this.frame.destroy(); this.primary.destroy(); this.secondary.destroy(); this.keycap?.destroy(); this.spinner.destroy();
  }

  private redraw(): this {
    const width = this.plaqueWidth, h = this.height, left = -width / 2;
    const brass = HUD_TONES.gold, tone = HUD_TONES.bronze;
    const rim = this.content.blocked ? tone.muted : brass.muted;
    this.frame.clear()
      .fillStyle(0x000000, 0.4).fillRoundedRect(left - 1, 1, width + 2, h + 1, 6)
      .fillStyle(rim).fillRoundedRect(left, 0, width, h, 5)
      .fillStyle(PALETTE.walnut, 0.97).fillRoundedRect(left + 2, 2, width - 4, h - 4, 4)
      .lineStyle(1, tone.accent, 0.65).strokeRoundedRect(left + 3.5, 3.5, width - 7, h - 7, 3)
      .fillStyle(brass.accent, 0.75).fillCircle(left + 7, h / 2, 1.5).fillCircle(-left - 7, h / 2, 1.5);
    if (this.pointer) {
      const { halfWidth, height } = POINTER, px = this.pointer.offsetX;
      if (this.pointer.side === 'above') {
        this.frame.fillStyle(rim).fillTriangle(px - halfWidth - 1, h - 1, px + halfWidth + 1, h - 1, px, h + height + 1)
          .fillStyle(PALETTE.walnut, 0.97).fillTriangle(px - halfWidth + 1.5, h - 2, px + halfWidth - 1.5, h - 2, px, h + height - 1.5);
      } else {
        this.frame.fillStyle(rim).fillTriangle(px - halfWidth - 1, 1, px + halfWidth + 1, 1, px, -height - 1)
          .fillStyle(PALETTE.walnut, 0.97).fillTriangle(px - halfWidth + 1.5, 2, px + halfWidth - 1.5, 2, px, -height + 1.5);
      }
    }
    if (this.keycap) {
      const kx = left + PAD_X, ky = (h - KEYCAP.height) / 2;
      this.frame.fillStyle(PALETTE.keycapShadow).fillRoundedRect(kx, ky + 2, KEYCAP.width, KEYCAP.height, 4)
        .fillStyle(PALETTE.keycapFace).fillRoundedRect(kx, ky, KEYCAP.width, KEYCAP.height, 4)
        .lineStyle(1, brass.accent, this.content.blocked ? 0.35 : 0.7).strokeRoundedRect(kx, ky, KEYCAP.width, KEYCAP.height, 4);
    }
    return this;
  }
}
