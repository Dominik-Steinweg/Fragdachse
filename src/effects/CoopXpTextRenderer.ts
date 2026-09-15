import type * as Phaser from 'phaser';
import { COLORS, DEPTH, toCssColor } from '../config';

const ATLAS_KEY = '__coop_xp_glyphs';
const CHARS = [...new Set('+0123456789 XP.e-InfinityNa')].join('');
const CELL = 32;
const WIDTH = 1024;
const HEIGHT = 512;
const MAX_IDLE = 128;
const DURATION = 950;
interface Popup {
  outline: Phaser.GameObjects.BitmapText;
  label: Phaser.GameObjects.BitmapText;
  elapsed: number;
  startY: number;
}

/** Bounded shared glyph storage; live popups are never capped or coalesced. */
export class CoopXpTextRenderer {
  private atlas: Phaser.Textures.CanvasTexture | null = null;
  private probe: Phaser.GameObjects.Text | null = null;
  private nextStroke = 3;
  private readonly active: Popup[] = [];
  private readonly idle: Popup[] = [];
  private readonly fontKeys: string[] = [];
  private listening = false;

  constructor(private readonly scene: Phaser.Scene) {}

  get ready(): boolean { return this.nextStroke > 8 && this.atlas !== null; }

  /** Called behind the loading veil, after fonts are available. One stroke variant per tick. */
  prepare(): boolean {
    if (this.ready) return true;
    if (!this.atlas) {
      this.atlas = this.scene.textures.createCanvas(ATLAS_KEY, WIDTH, HEIGHT);
      if (!this.atlas) throw new Error('Cannot create XP glyph atlas');
      // Preserve the currently shipped Text metrics, including its literal font-size value.
      // Correcting that value would change the popup size and is a separate visual change.
      this.probe = this.scene.make.text({ x: 0, y: 0, text: '', style: {
        fontFamily: 'monospace', fontSize: '${fontSize}px', fontStyle: 'bold',
        color: toCssColor(COLORS.GOLD_1), stroke: '#241527', resolution: 1,
      } }, false);
    }
    const probe = this.probe!;
    const stroke = this.nextStroke++;
    const row = stroke - 3;
    probe.setStroke('#241527', stroke);
    probe.setText('X');
    // Phaser's runtime requires xAdvance, omitted by its current generated declaration.
    const chars: Record<number, Phaser.Types.GameObjects.BitmapText.BitmapFontCharacterData & { xAdvance: number }> = {};
    const fillChars: typeof chars = {};
    const context = this.atlas.context;
    context.font = probe.context.font;
    context.textBaseline = 'alphabetic';
    context.fillStyle = toCssColor(COLORS.GOLD_1);
    context.strokeStyle = '#241527';
    context.lineWidth = stroke;
    const ascent = probe.style.getTextMetrics().ascent;
    let lineHeight = 0;
    for (let index = 0; index < CHARS.length; index++) {
      const char = CHARS[index];
      const advance = probe.context.measureText(char).width;
      const width = Math.ceil(advance + stroke);
      const height = probe.height;
      if (width > CELL || height > CELL) throw new Error('XP glyph exceeds atlas cell');
      const x = index * CELL;
      const y = row * CELL;
      const fillY = (row + 6) * CELL;
      const textX = x + Math.round(stroke / 2);
      const baseline = Math.round(stroke / 2 + ascent);
      context.strokeText(char, textX, y + baseline);
      context.fillText(char, textX, fillY + baseline);
      lineHeight = Math.max(lineHeight, height);
      chars[char.charCodeAt(0)] = {
        x, y, width, height, centerX: width / 2, centerY: height / 2,
        xOffset: 0, yOffset: 0, xAdvance: advance,
        u0: x / WIDTH, v0: 1 - y / HEIGHT,
        u1: (x + width) / WIDTH, v1: 1 - (y + height) / HEIGHT,
        data: {}, kerning: {},
      };
      fillChars[char.charCodeAt(0)] = { ...chars[char.charCodeAt(0)], y: fillY,
        v0: 1 - fillY / HEIGHT, v1: 1 - (fillY + height) / HEIGHT };
    }
    // Canvas text uses pair kerning; preserve it when laying out the same glyphs separately.
    for (const current of CHARS) for (const previous of CHARS) {
      chars[current.charCodeAt(0)].kerning[previous.charCodeAt(0)] =
        probe.context.measureText(previous + current).width
        - probe.context.measureText(previous).width - probe.context.measureText(current).width;
    }
    const key = `${ATLAS_KEY}_${stroke}`;
    this.fontKeys.push(key);
    this.scene.cache.bitmapFont.add(key, {
      texture: ATLAS_KEY, frame: null,
      data: { font: key, size: 1, lineHeight, retroFont: false, chars },
    });
    this.fontKeys.push(`${key}_fill`);
    this.scene.cache.bitmapFont.add(`${key}_fill`, {
      texture: ATLAS_KEY, frame: null,
      data: { font: `${key}_fill`, size: 1, lineHeight, retroFont: false, chars: fillChars },
    });
    if (this.ready) {
      this.probe?.destroy();
      this.probe = null;
      this.atlas.refresh();
      for (let i = 0; i < 64; i++) this.idle.push(this.createPopup());
    }
    return this.ready;
  }

  private createPopup(): Popup {
    const outline = this.scene.add.bitmapText(0, 0, this.fontKeys[0], '', 1)
      .setOrigin(0.5).setDepth(DEPTH.OVERLAY - 5).setVisible(false).setActive(false);
    outline.removeFromDisplayList();
    const label = this.scene.add.bitmapText(0, 0, this.fontKeys[0], '', 1)
      .setOrigin(0.5).setDepth(DEPTH.OVERLAY - 5).setVisible(false).setActive(false);
    label.removeFromDisplayList();
    return { outline, label, elapsed: 0, startY: 0 };
  }

  play(x: number, y: number, xp: number): void {
    const value = Math.max(0, Math.floor(xp));
    if (value <= 0) return;
    // Normal gameplay is gated by prepare(); direct tooling consumers can prepare synchronously.
    while (!this.ready) this.prepare();
    const fontSize = Math.round(Math.min(60, 18 + 15 * Math.log(Math.max(1, value)) / Math.log(10)));
    const stroke = Math.round(3 + (fontSize - 18) / 8);
    const popup = this.idle.pop() ?? this.createPopup();
    popup.elapsed = 0;
    popup.startY = y - 18;
    const fontIndex = ((Number.isFinite(stroke) ? stroke : 3) - 3) * 2;
    const text = `+${value} XP`;
    // All outlines precede all fills within a popup, just as Canvas strokeText/fillText do.
    this.showLabel(popup.outline, this.fontKeys[fontIndex], text, x, popup.startY, stroke);
    this.showLabel(popup.label, this.fontKeys[fontIndex + 1], text, x, popup.startY, stroke);
    this.active.push(popup);
    if (!this.listening) {
      this.scene.events.on('update', this.update, this);
      this.listening = true;
    }
  }

  private showLabel(label: Phaser.GameObjects.BitmapText, font: string, text: string,
    x: number, y: number, stroke: number): void {
    label.setFont(font, 1).setText(text).setPosition(x, y).setAlpha(1).setVisible(true).setActive(true);
    // BitmapText bounds use advances; Canvas Text also includes the outer stroke and rounds up.
    label.setDisplayOrigin(Math.ceil(label.width + (Number.isFinite(stroke) ? stroke : 3)) / 2, label.height / 2);
    label.addToDisplayList();
  }

  private readonly update = (_time: number, delta: number): void => {
    if (this.scene.tweens.paused) return;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const popup = this.active[i];
      popup.elapsed += delta * this.scene.tweens.timeScale;
      const t = Math.min(1, popup.elapsed / DURATION);
      const eased = t * (2 - t);
      popup.label.y = popup.startY - 46 * eased;
      popup.label.alpha = 1 - eased;
      popup.outline.y = popup.label.y;
      popup.outline.alpha = popup.label.alpha;
      if (t < 1) continue;
      this.active[i] = this.active[this.active.length - 1];
      this.active.pop();
      this.release(popup);
    }
    if (!this.active.length) this.detach();
  };

  private release(popup: Popup): void {
    // DisplayList shutdown can destroy visible objects before EffectSystem's shutdown hook.
    if (!popup.label.scene || !popup.outline.scene) {
      popup.label.destroy();
      popup.outline.destroy();
      return;
    }
    popup.outline.setVisible(false).setActive(false).setText('');
    popup.outline.removeFromDisplayList();
    popup.label.setVisible(false).setActive(false).setText('');
    popup.label.removeFromDisplayList();
    if (this.idle.length < MAX_IDLE) this.idle.push(popup);
    else {
      popup.label.destroy();
      popup.outline.destroy();
    }
  }

  private detach(): void {
    if (this.listening) this.scene.events.off('update', this.update, this);
    this.listening = false;
  }

  clear(): void {
    this.detach();
    for (const popup of this.active) this.release(popup);
    this.active.length = 0;
  }

  destroy(): void {
    this.clear();
    for (const popup of this.idle) {
      popup.label.destroy();
      popup.outline.destroy();
    }
    this.idle.length = 0;
    this.probe?.destroy();
    this.probe = null;
    for (const key of this.fontKeys) this.scene.cache.bitmapFont.remove(key);
    this.fontKeys.length = 0;
    if (this.atlas) this.scene.textures.remove(ATLAS_KEY);
    this.atlas = null;
    this.nextStroke = 3;
  }
}
