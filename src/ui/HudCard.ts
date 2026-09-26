/**
 * HudCard – gemeinsame Karte aller Arena-Infoflächen.
 *
 * Aufbau (lokale Koordinaten, Ursprung in der Kartenmitte, Einheiten = Bildschirmpixel):
 *   - halbtransparente Glasfläche hinter der Rahmenöffnung – die Welt bleibt sichtbar
 *   - Waldboden-Rahmen (3-Slice, nur horizontal gestreckt) in der Farbfamilie der Aussage
 *   - schmale Fortschrittsfüllung oberhalb der unteren Holzschiene
 *   - Kicker als kleines Schild auf der oberen Schiene, optional Marken rechts auf der Schiene
 *   - eine Inhaltszeile: Titel links, Wert rechts
 *
 * Alle Größen folgen aus `scale` (Quellpixel → Bildschirm) und `width`. Die Karte kann während
 * einer Animation pro Frame umgebaut werden: `setWidth` verschiebt nur Positionen und Breiten.
 */
import * as Phaser from 'phaser';
import { COLORS, toCssColor } from '../config';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { createGradientTexture, rgbStr } from './LivingBarEffect';
import { FONT_DISPLAY, FONT_MONO, FONT_WEIGHT } from './uiTheme';
import { roundRectPath } from './uiTextures';
import {
  HUD_CARD_SOURCE,
  HUD_FRAME_TEXTURE,
  HUD_TONES,
  hudCardFrame,
  type HudTone,
} from './HudFrameAssets';

const BACKING_TEX = '_hud_card_backing';
const HEAD_TEX = '_hud_card_fill_head';
const FILL_TEX_W = 256;
const FILL_TEX_H = 8;
const SRC = HUD_CARD_SOURCE;

/** Ruhiger Text: warmes Pergament wie die Forest-Menüs, nicht reines Weiß. */
export const HUD_TEXT_PRIMARY = 0xe6dcc4;
export const HUD_TEXT_MUTED = 0xa9ad95;

export interface HudCardConfig {
  readonly scale: number;
  readonly width: number;
  readonly tone: HudTone;
  readonly titleSize?: number;
  readonly valueSize?: number;
  readonly kickerSize?: number;
  /** Deckkraft der Glasfläche; die Welt bleibt dahinter lesbar. */
  readonly backingAlpha?: number;
  /** Titel mittig statt links (Ankündigungen). */
  readonly centered?: boolean;
  /**
   * Wird direkt nach der Füllung aufgerufen, bevor Schild und Text entstehen. Dort erzeugte
   * Objekte (z. B. `LivingBarEffect`) liegen damit über der Füllung und unter dem Text.
   */
  readonly onFillCreated?: (card: HudCard) => void;
}

export interface HudFillRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function ensureBackingTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(BACKING_TEX)) return;
  const size = 48;
  const ct = scene.textures.createCanvas(BACKING_TEX, size, size);
  if (!ct) return;
  const ctx = ct.context;
  ctx.clearRect(0, 0, size, size);
  roundRectPath(ctx, 0, 0, size, size, 12);
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, rgbStr(0x101815, 0.9));
  grad.addColorStop(1, rgbStr(COLORS.GREY_10, 0.94));
  ctx.fillStyle = grad;
  ctx.fill();
  ct.refresh();
}

function ensureHeadTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(HEAD_TEX)) return;
  const size = 16;
  const ct = scene.textures.createCanvas(HEAD_TEX, size, size);
  if (!ct) return;
  const ctx = ct.context;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ct.refresh();
}

export function ensureHudFillTexture(scene: Phaser.Scene, tone: HudTone): string {
  const key = `_hud_card_fill_${tone}`;
  if (!scene.textures.exists(key)) createGradientTexture(scene, key, HUD_TONES[tone].fill, FILL_TEX_W, FILL_TEX_H);
  return key;
}

/** Kürzt einen Text pixelgenau mit Auslassungszeichen; läuft nur bei Textänderungen. */
export function fitHudText(text: Phaser.GameObjects.Text, full: string, maxWidth: number): void {
  text.setText(full);
  if (text.width <= maxWidth || full.length <= 1) return;
  let low = 1;
  let high = full.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    text.setText(`${full.slice(0, mid).trimEnd()}…`);
    if (text.width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  text.setText(`${full.slice(0, low).trimEnd()}…`);
}

export function hudTextStyle(size: number, color: number, mono = false, tracking = 0): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: mono ? FONT_MONO : FONT_DISPLAY,
    fontSize: `${size}px`,
    fontStyle: FONT_WEIGHT.bold,
    color: toCssColor(color),
    letterSpacing: tracking,
    // Dünne dunkle Kontur: Text bleibt über hellen Weltflächen lesbar, auch wenn das Glas
    // bewusst transparent ist.
    stroke: '#070a0c',
    strokeThickness: Math.max(2, Math.round(size / 6)),
  };
}

export class HudCard {
  readonly root: Phaser.GameObjects.Container;
  readonly scale: number;
  readonly height: number;
  readonly kicker: Phaser.GameObjects.Text;
  readonly title: Phaser.GameObjects.Text;
  readonly value: Phaser.GameObjects.Text;
  readonly fill: Phaser.GameObjects.Image;

  private readonly backing: Phaser.GameObjects.NineSlice;
  private readonly frame: Phaser.GameObjects.NineSlice;
  private readonly head: Phaser.GameObjects.Image;
  private readonly decor: Phaser.GameObjects.Graphics;
  private readonly centered: boolean;
  private toneId: HudTone;
  private widthValue: number;
  private fillFrac = 0;
  private fillVisible = true;
  private headVisible = false;
  private kickerText = '';
  private glyph = false;
  private pips: { count: number; filled: number; current: number } | null = null;
  private railNote = '';
  private readonly railNoteText: Phaser.GameObjects.Text;

  constructor(private readonly scene: Phaser.Scene, config: HudCardConfig) {
    ensureBackingTexture(scene);
    ensureHeadTexture(scene);
    this.scale = config.scale;
    this.height = SRC.height * config.scale;
    this.widthValue = config.width;
    this.toneId = config.tone;
    this.centered = config.centered ?? false;
    const style = HUD_TONES[config.tone];

    this.backing = scene.add.nineslice(0, 0, BACKING_TEX, undefined, 48, 48, 12, 12, 12, 12)
      .setAlpha(config.backingAlpha ?? 0.62);
    this.frame = scene.add.nineslice(
      0, 0, HUD_FRAME_TEXTURE, hudCardFrame(config.tone), SRC.width, SRC.height, SRC.cap, SRC.cap,
    ).setScale(config.scale);
    this.fill = scene.add.image(0, 0, ensureHudFillTexture(scene, config.tone)).setOrigin(0, 0.5);
    this.root = scene.add.container(0, 0, [this.backing, this.frame, this.fill]);
    config.onFillCreated?.(this);
    this.head = scene.add.image(0, 0, HEAD_TEX).setBlendMode(Phaser.BlendModes.ADD).setVisible(false)
      .setTint(style.accent);
    this.decor = scene.add.graphics();
    registerGraphicsObject(scene, 'gameplayHud', this.decor);
    this.kicker = scene.add.text(0, 0, '', hudTextStyle(config.kickerSize ?? 10, style.accent, false, 1.4))
      .setOrigin(0, 0.5);
    this.railNoteText = scene.add.text(0, 0, '', hudTextStyle(config.kickerSize ?? 10, HUD_TEXT_MUTED, false, 0.8))
      .setOrigin(1, 0.5).setVisible(false);
    this.title = scene.add.text(0, 0, '', hudTextStyle(config.titleSize ?? 16, HUD_TEXT_PRIMARY, false, 0.6))
      .setOrigin(this.centered ? 0.5 : 0, 0.5);
    this.value = scene.add.text(0, 0, '', hudTextStyle(config.valueSize ?? 15, HUD_TEXT_PRIMARY, true))
      .setOrigin(1, 0.5);
    this.root.add([this.head, this.decor, this.kicker, this.railNoteText, this.title, this.value]);
    this.layout();
  }

  get tone(): HudTone { return this.toneId; }
  get width(): number { return this.widthValue; }

  /** Kartenoberkante relativ zur Mitte. */
  get top(): number { return -this.height / 2; }

  /** Rechteck der Füllung in lokalen Koordinaten. */
  get fillRect(): HudFillRect {
    const s = this.scale;
    const left = -this.widthValue / 2 + SRC.trackInset * s;
    const height = Math.max(2, (SRC.trackBottom - SRC.trackTop) * s - 1);
    return {
      x: left,
      y: this.top + ((SRC.trackTop + SRC.trackBottom) / 2) * s - height / 2,
      width: Math.max(1, this.widthValue - SRC.trackInset * s * 2),
      height,
    };
  }

  get contentLeft(): number { return -this.widthValue / 2 + 66 * this.scale + (this.glyph ? 18 * this.scale * 2 : 0); }
  get contentRight(): number { return this.widthValue / 2 - 66 * this.scale; }
  get interiorCenterY(): number { return this.top + ((SRC.interiorTop + SRC.interiorBottom) / 2) * this.scale; }
  get railY(): number { return this.top + SRC.railCenter * this.scale; }

  setTone(tone: HudTone): this {
    if (tone === this.toneId) return this;
    this.toneId = tone;
    const style = HUD_TONES[tone];
    this.frame.setFrame(hudCardFrame(tone));
    // `setFrame` setzt die Slices nicht zurück; Breite und Kappen bleiben erhalten.
    this.frame.setSlices(this.frame.width, SRC.height, SRC.cap, SRC.cap, 0, 0);
    this.fill.setTexture(ensureHudFillTexture(this.scene, tone));
    this.head.setTint(style.accent);
    this.kicker.setColor(toCssColor(style.accent));
    this.layout();
    return this;
  }

  setWidth(width: number): this {
    if (Math.abs(width - this.widthValue) < 0.01) return this;
    this.widthValue = width;
    this.layout();
    return this;
  }

  setKicker(text: string): this {
    if (text === this.kickerText) return this;
    this.kickerText = text;
    this.kicker.setText(text);
    this.drawDecor();
    return this;
  }

  /** Kurzer Zusatz rechts auf der oberen Schiene (z. B. Belohnung). */
  setRailNote(text: string): this {
    if (text === this.railNote) return this;
    this.railNote = text;
    this.railNoteText.setText(text).setVisible(text.length > 0);
    this.drawDecor();
    return this;
  }

  setGlyph(enabled: boolean): this {
    if (enabled === this.glyph) return this;
    this.glyph = enabled;
    this.layout();
    return this;
  }

  /** Marken rechts auf der Schiene: abgeschlossen, laufend (hervorgehoben), ausstehend. */
  setPips(count: number, filled: number, current: number): this {
    const next = count > 0 ? { count, filled, current } : null;
    if (next?.count === this.pips?.count && next?.filled === this.pips?.filled
      && next?.current === this.pips?.current) return this;
    this.pips = next;
    this.drawDecor();
    return this;
  }

  setTitle(text: string, color: number = HUD_TEXT_PRIMARY): this {
    const maxWidth = this.centered
      ? this.widthValue - 150 * this.scale
      : this.contentRight - this.contentLeft - (this.value.text ? this.value.width + 12 : 0);
    fitHudText(this.title, text, Math.max(20, maxWidth));
    this.title.setColor(toCssColor(color));
    return this;
  }

  setValue(text: string, color: number = HUD_TEXT_PRIMARY): this {
    if (this.value.text !== text) this.value.setText(text);
    this.value.setColor(toCssColor(color)).setVisible(text.length > 0);
    return this;
  }

  /**
   * Füllgrad 0..1. `head` zeigt die laufende Spitze; `null` blendet die Füllung aus, die
   * gemalte Rinne bleibt dann leer.
   */
  setProgress(frac: number | null, head = true, alpha = 1): this {
    const visible = frac !== null;
    this.fillVisible = visible;
    this.fillFrac = visible ? Phaser.Math.Clamp(frac, 0, 1) : 0;
    this.headVisible = visible && head && this.fillFrac > 0.02 && this.fillFrac < 0.995;
    this.fill.setAlpha(alpha);
    this.syncFill();
    return this;
  }

  /** Setzt die laufende Spitze frei (z. B. als Scan bei unbestimmtem Fortschritt). */
  setHeadAt(frac: number | null): this {
    const rect = this.fillRect;
    if (frac === null) {
      this.head.setVisible(false);
      return this;
    }
    this.head.setVisible(true).setPosition(rect.x + rect.width * Phaser.Math.Clamp(frac, 0, 1), rect.y + rect.height / 2);
    return this;
  }

  /** Deckkraft aller Inhalte ohne Glas und Rahmen – für die Übergabe aus einer Ankündigung. */
  setContentAlpha(alpha: number): this {
    for (const object of [this.fill, this.head, this.decor, this.kicker, this.railNoteText, this.title, this.value]) {
      object.setAlpha(alpha);
    }
    return this;
  }

  /** Helligkeit der laufenden Spitze (ruhiges Atmen eines fokussierten Ziels). */
  setHeadPulse(alpha: number): this {
    this.head.setAlpha(alpha);
    return this;
  }

  setBackingAlpha(alpha: number): this {
    this.backing.setAlpha(alpha);
    return this;
  }

  destroy(): void {
    this.root.destroy(true);
  }

  private syncFill(): void {
    const rect = this.fillRect;
    const width = rect.width * this.fillFrac;
    this.fill
      .setVisible(this.fillVisible && width > 0.5)
      .setPosition(rect.x, rect.y + rect.height / 2)
      .setDisplaySize(Math.max(1, rect.width), rect.height)
      .setCrop(0, 0, FILL_TEX_W * this.fillFrac, FILL_TEX_H);
    this.head.setVisible(this.headVisible);
    if (this.headVisible) {
      this.head.setPosition(rect.x + width, rect.y + rect.height / 2).setScale(Math.max(0.6, rect.height / 5));
    }
  }

  private layout(): void {
    const s = this.scale;
    const w = this.widthValue;
    this.frame.width = w / s;
    // NineSlice rechnet seine Vertices in den width/height-Settern neu.
    this.backing.width = Math.max(24, w - 44 * s);
    this.backing.height = Math.max(24, (SRC.trackBottom - SRC.interiorTop + 12) * s);
    this.backing.setPosition(0, this.top + (SRC.interiorTop + SRC.trackBottom) / 2 * s);
    const y = this.interiorCenterY;
    this.title.setPosition(this.centered ? 0 : this.contentLeft, y);
    this.value.setPosition(this.contentRight, y);
    this.syncFill();
    this.drawDecor();
  }

  private drawDecor(): void {
    const style = HUD_TONES[this.toneId];
    const g = this.decor;
    const s = this.scale;
    g.clear();
    const railY = this.railY;
    const plateH = Math.round(this.kicker.height * 0.86) + 2;

    let railLeft = -this.widthValue / 2 + 78 * s;
    if (this.kickerText) {
      const plateW = this.kicker.width + 14;
      const plateX = this.centered ? -plateW / 2 : -this.widthValue / 2 + 78 * s;
      railLeft = plateX + plateW + 8;
      g.fillStyle(0x0a0e0d, 0.94);
      g.fillRoundedRect(plateX, railY - plateH / 2, plateW, plateH, plateH / 2);
      g.lineStyle(1, style.muted, 0.95);
      g.strokeRoundedRect(plateX, railY - plateH / 2, plateW, plateH, plateH / 2);
      this.kicker.setVisible(true).setPosition(plateX + 7, railY);
    } else {
      this.kicker.setVisible(false);
    }

    let railRight = this.widthValue / 2 - 78 * s;
    if (this.pips) {
      const pipW = Math.max(6, 22 * s);
      const pipH = Math.max(3, 7 * s);
      const gap = Math.max(3, 6 * s);
      const total = this.pips.count * pipW + (this.pips.count - 1) * gap;
      const plateW = total + 12;
      g.fillStyle(0x0a0e0d, 0.94);
      g.fillRoundedRect(railRight - plateW, railY - plateH / 2, plateW, plateH, plateH / 2);
      g.lineStyle(1, style.muted, 0.95);
      g.strokeRoundedRect(railRight - plateW, railY - plateH / 2, plateW, plateH, plateH / 2);
      const startX = railRight - plateW + 6;
      for (let index = 0; index < this.pips.count; index += 1) {
        const x = startX + index * (pipW + gap);
        if (index === this.pips.current) g.fillStyle(style.accent, 1);
        else if (index < this.pips.filled) g.fillStyle(style.muted, 0.95);
        else g.fillStyle(COLORS.GREY_6, 0.85);
        g.fillRoundedRect(x, railY - pipH / 2, pipW, pipH, pipH / 2);
      }
      railRight -= plateW + 6;
    }
    // Die Notiz bekommt nur den Platz zwischen Kicker und Marken; reicht er nicht, entfällt sie.
    const noteSpace = railRight - railLeft - 14;
    const showNote = this.railNote.length > 0 && noteSpace >= 48;
    this.railNoteText.setVisible(showNote);
    if (showNote) {
      fitHudText(this.railNoteText, this.railNote, noteSpace);
      const plateW = this.railNoteText.width + 14;
      g.fillStyle(0x0a0e0d, 0.9);
      g.fillRoundedRect(railRight - plateW, railY - plateH / 2, plateW, plateH, plateH / 2);
      g.lineStyle(1, COLORS.GREY_6, 0.9);
      g.strokeRoundedRect(railRight - plateW, railY - plateH / 2, plateW, plateH, plateH / 2);
      this.railNoteText.setPosition(railRight - 7, railY);
    }

    if (this.glyph) {
      // Raute: eindeutiges Zeichen des freiwilligen Nebenziels (Pflichtziel ohne Glyphe).
      const gx = -this.widthValue / 2 + 66 * s + 8 * s * 2 - 4;
      const gy = this.interiorCenterY;
      const r = Math.max(3.5, 9 * s);
      g.fillStyle(style.accent, 0.95);
      g.fillPoints([
        new Phaser.Math.Vector2(gx, gy - r), new Phaser.Math.Vector2(gx + r, gy),
        new Phaser.Math.Vector2(gx, gy + r), new Phaser.Math.Vector2(gx - r, gy),
      ], true);
    }
  }
}
