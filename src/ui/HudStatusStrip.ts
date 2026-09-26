/**
 * HudStatusStrip – schmale Statusleiste oben mittig.
 *
 * Trägt nur, was gerade gilt: Lebensstatus, Rundentimer, Zug. Jedes Feld ist optional; die
 * Leiste wächst und schrumpft weich mit ihrem Inhalt, zwischen zwei Feldern sitzt ein
 * geschnitzter Trenner aus dem Rahmen-Atlas. Ohne Felder blendet sie sich aus und belegt
 * dann keine Spielfläche.
 */
import * as Phaser from 'phaser';
import { toCssColor } from '../config';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { LivingBarEffect, type LivingBarPalette } from './LivingBarEffect';
import { HUD_TEXT_MUTED, HUD_TEXT_PRIMARY, hudTextStyle, ensureHudFillTexture } from './HudCard';
import { HUD_DIVIDER_SOURCE, HUD_FRAME_TEXTURE, HUD_STRIP_SOURCE } from './HudFrameAssets';

const SCALE = 0.5;
const SRC = HUD_STRIP_SOURCE;
/** Abstand zwischen Rahmenkante und erstem Inhalt: die Laub-Ecken bleiben frei. */
const OUTER_PAD = 30;
const FIELD_PAD = 14;
const LABEL_GAP = 7;
const BAR_W = 92;
const BAR_H = 6;
const LAYOUT_MS = 220;
const FADE_MS = 180;

export type HudStatusFieldId = 'life' | 'timer' | 'train';

export interface HudStatusField {
  readonly id: HudStatusFieldId;
  readonly label: string;
  readonly value: string;
  readonly valueColor?: number;
  /** Anteil 0..1 einer Zustandsleiste anstelle eines Werts (Zug-HP). */
  readonly bar?: number;
}

interface FieldVisual {
  readonly container: Phaser.GameObjects.Container;
  readonly label: Phaser.GameObjects.Text;
  readonly value: Phaser.GameObjects.Text;
  readonly barGroup: Phaser.GameObjects.Container | null;
  readonly barBg: Phaser.GameObjects.Image | null;
  readonly barFill: Phaser.GameObjects.Image | null;
  readonly barEffect: LivingBarEffect | null;
  width: number;
  lastBarWidth: number;
}

const TRAIN_PALETTE: LivingBarPalette = { dark: 0x3d1812, mid: 0xcf573c, light: 0xff8060 };

export class HudStatusStrip {
  readonly root: Phaser.GameObjects.Container;
  private readonly frame: Phaser.GameObjects.NineSlice;
  private readonly backing: Phaser.GameObjects.Rectangle;
  private readonly dividers: Phaser.GameObjects.Image[] = [];
  private readonly fields = new Map<HudStatusFieldId, FieldVisual>();
  private order: HudStatusFieldId[] = [];
  private displayWidth = 0;
  private layoutTween: Phaser.Tweens.Tween | null = null;
  private fadeTween: Phaser.Tweens.Tween | null = null;
  private layoutSignature = '';
  private shown = false;
  private readonly baseY: number;
  /** Felder, die vor dem aktuellen Layout schon standen; nur sie gleiten an ihren neuen Platz. */
  private placed = new Set<HudStatusFieldId>();

  constructor(private readonly scene: Phaser.Scene, centerX: number, topY: number) {
    const height = SRC.height * SCALE;
    this.backing = scene.add.rectangle(0, 0, 10, (SRC.interiorBottom - SRC.interiorTop + 6) * SCALE, 0x0a0f0e, 0.55);
    registerGraphicsObject(scene, 'gameplayHud', this.backing);
    this.frame = scene.add.nineslice(0, 0, HUD_FRAME_TEXTURE, 'strip', SRC.width, SRC.height, SRC.cap, SRC.cap)
      .setScale(SCALE);
    this.baseY = topY + height / 2;
    this.root = scene.add.container(centerX, this.baseY, [this.backing, this.frame])
      .setVisible(false).setAlpha(0);
    for (const id of ['life', 'timer', 'train'] as const) this.fields.set(id, this.createField(id));
  }

  /** Rendert die gegebenen Felder in ihrer Reihenfolge; ungenannte Felder verschwinden. */
  setFields(fields: readonly HudStatusField[]): void {
    const visibleIds = fields.map((field) => field.id);
    for (const [id, visual] of this.fields) {
      const field = fields.find((entry) => entry.id === id);
      if (!field) {
        visual.container.setVisible(false);
        visual.barEffect?.stop();
        continue;
      }
      this.applyField(visual, field);
    }

    if (fields.length === 0) {
      this.fadeOut();
      this.order = [];
      this.layoutSignature = '';
      return;
    }

    const signature = fields.map((field) => `${field.id}:${Math.round(this.fields.get(field.id)!.width)}`).join('|');
    this.order = visibleIds;
    if (signature !== this.layoutSignature) {
      this.layoutSignature = signature;
      this.layout(this.shown);
    }
    this.fadeIn();
  }

  hide(): void {
    this.setFields([]);
  }

  destroy(): void {
    this.layoutTween?.destroy();
    this.fadeTween?.destroy();
    for (const field of this.fields.values()) field.barEffect?.destroy();
    this.root.destroy(true);
  }

  private createField(id: HudStatusFieldId): FieldVisual {
    const label = this.scene.add.text(0, 0, '', hudTextStyle(11, HUD_TEXT_MUTED, false, 1.4)).setOrigin(0, 0.5);
    const value = this.scene.add.text(0, 0, '', hudTextStyle(id === 'timer' ? 22 : 17, HUD_TEXT_PRIMARY, true))
      .setOrigin(0, 0.5);
    const container = this.scene.add.container(0, this.contentY(), [label]);
    let barGroup: Phaser.GameObjects.Container | null = null;
    let barBg: Phaser.GameObjects.Image | null = null;
    let barFill: Phaser.GameObjects.Image | null = null;
    let barEffect: LivingBarEffect | null = null;
    if (id === 'train') {
      barBg = this.scene.add.image(0, 0, ensureHudFillTexture(this.scene, 'neutral'))
        .setOrigin(0, 0.5).setDisplaySize(BAR_W, BAR_H).setTint(0x2a2f33).setAlpha(0.9);
      barFill = this.scene.add.image(0, 0, ensureHudFillTexture(this.scene, 'red')).setOrigin(0, 0.5)
        .setDisplaySize(BAR_W, BAR_H);
      // Eigene Gruppe: Der Balkeneffekt ist an seine Konstruktionsposition gebunden und
      // wandert so mit, wenn sich die Beschriftung davor ändert.
      barGroup = this.scene.add.container(0, 0, [barBg, barFill]);
      container.add(barGroup);
      barEffect = new LivingBarEffect(this.scene, barGroup, 0, -BAR_H / 2, BAR_W, BAR_H, TRAIN_PALETTE, {
        glowTarget: barFill, scrollFactor: 0, startActive: false,
      });
    }
    container.add(value);
    container.setVisible(false);
    this.root.add(container);
    return { container, label, value, barGroup, barBg, barFill, barEffect, width: 0, lastBarWidth: -1 };
  }

  private contentY(): number {
    return (-SRC.height / 2 + (SRC.interiorTop + SRC.interiorBottom) / 2) * SCALE;
  }

  private applyField(visual: FieldVisual, field: HudStatusField): void {
    visual.container.setVisible(true);
    if (visual.label.text !== field.label) visual.label.setText(field.label);
    if (visual.value.text !== field.value) visual.value.setText(field.value);
    visual.value.setColor(toCssColor(field.valueColor ?? HUD_TEXT_PRIMARY));
    const labelW = field.label ? visual.label.width + LABEL_GAP : 0;
    visual.label.setVisible(field.label.length > 0);
    let x = labelW;
    const hasBar = field.bar !== undefined && visual.barFill !== null;
    visual.barGroup?.setVisible(hasBar);
    if (hasBar) {
      visual.barGroup!.setX(x);
      const fillW = Math.round(BAR_W * Phaser.Math.Clamp(field.bar!, 0, 1));
      if (fillW !== visual.lastBarWidth) {
        visual.barFill!.setCrop(0, 0, (visual.barFill!.frame.width * fillW) / BAR_W, visual.barFill!.frame.height);
        visual.barEffect?.setFilledWidth(fillW);
        visual.lastBarWidth = fillW;
      }
      if (fillW > 6) visual.barEffect?.start(); else visual.barEffect?.stop();
      x += BAR_W + (field.value ? LABEL_GAP : 0);
    } else {
      visual.barEffect?.stop();
      visual.lastBarWidth = -1;
    }
    visual.value.setX(x).setVisible(field.value.length > 0);
    visual.width = x + (field.value ? visual.value.width : 0) + FIELD_PAD * 2;
  }

  private layout(animate: boolean): void {
    const widths = this.order.map((id) => this.fields.get(id)!.width);
    const total = widths.reduce((sum, width) => sum + width, 0) + OUTER_PAD * 2 - FIELD_PAD * 2;
    const targets: number[] = [];
    let cursor = -total / 2 + OUTER_PAD - FIELD_PAD;
    for (const width of widths) {
      targets.push(cursor + FIELD_PAD);
      cursor += width;
    }
    const boundaries = widths.slice(0, -1).map((_, index) => {
      let x = -total / 2 + OUTER_PAD - FIELD_PAD;
      for (let i = 0; i <= index; i += 1) x += widths[i];
      return x;
    });
    while (this.dividers.length < boundaries.length) {
      const divider = this.scene.add.image(0, 0, HUD_FRAME_TEXTURE, 'divider').setScale(SCALE);
      this.root.add(divider);
      this.dividers.push(divider);
    }
    this.dividers.forEach((divider, index) => {
      divider.setVisible(index < boundaries.length);
      if (index < boundaries.length) divider.setX(boundaries[index]);
    });

    const apply = (width: number, t: number, from: number[]): void => {
      this.displayWidth = width;
      this.frame.width = width / SCALE;
      this.backing.setSize(Math.max(10, width - 40), this.backing.height);
      this.order.forEach((id, index) => {
        const field = this.fields.get(id)!;
        const start = this.placed.has(id) ? from[index] : targets[index];
        field.container.setX(start + (targets[index] - start) * t);
      });
    };

    this.layoutTween?.destroy();
    this.layoutTween = null;
    const fromX = this.order.map((id) => this.fields.get(id)!.container.x);
    const fresh = this.order.filter((id) => !this.placed.has(id));
    const finish = (): void => { this.placed = new Set(this.order); };
    if (!animate) {
      apply(total, 1, targets);
      finish();
      return;
    }
    const fromWidth = this.displayWidth || total;
    // Neu hinzukommende Felder erscheinen an ihrem Platz und blenden auf.
    for (const id of fresh) {
      const container = this.fields.get(id)!.container;
      container.setAlpha(0);
      this.scene.tweens.add({ targets: container, alpha: 1, duration: LAYOUT_MS, delay: LAYOUT_MS * 0.4 });
    }
    const proxy = { t: 0 };
    this.layoutTween = this.scene.tweens.add({
      targets: proxy,
      t: 1,
      duration: LAYOUT_MS,
      ease: 'Cubic.easeOut',
      onUpdate: () => apply(fromWidth + (total - fromWidth) * proxy.t, proxy.t, fromX),
      onComplete: () => { this.layoutTween = null; },
    });
    finish();
  }

  private fadeIn(): void {
    if (this.shown) return;
    this.shown = true;
    this.fadeTween?.destroy();
    this.root.setVisible(true).setAlpha(0).setY(this.baseY - 8);
    this.fadeTween = this.scene.tweens.add({
      targets: this.root,
      alpha: 1,
      y: this.baseY,
      duration: FADE_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => { this.fadeTween = null; },
    });
  }

  private fadeOut(): void {
    if (!this.shown) return;
    this.shown = false;
    this.fadeTween?.destroy();
    this.fadeTween = this.scene.tweens.add({
      targets: this.root,
      alpha: 0,
      duration: FADE_MS,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.fadeTween = null;
        this.root.setVisible(false);
        this.placed.clear();
        for (const field of this.fields.values()) field.barEffect?.stop();
      },
    });
  }
}
