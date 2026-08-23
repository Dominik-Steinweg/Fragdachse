import * as Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, toCssColor } from '../config';
import { toDesignSpace } from '../graphics/RenderResolution';
import { ensureFlatPanelTexture } from './uiTextures';
import { BORDER, RADIUS, SPACE, SURFACE, TEXT, textStyle } from './uiTheme';
import { fitLoadoutIcon, getLoadoutIconTextureKey } from './LoadoutIconLayout';

/**
 * Geteilter Hover-Tooltip fuer Overlays: dunkle Flaeche, farbiger Titel, Trennlinie und darunter
 * beliebig viele einzeln eingefaerbte Zeilen. Der Aufrufer haengt den von `build()` gelieferten
 * Container in seinen eigenen Root-Container, damit der Tooltip die Schichtung des Overlays erbt.
 */

export interface UiTooltipLine {
  readonly text: string;
  readonly color: number;
  readonly bold?: boolean;
  /** Optional inline runs. When present, runs are laid out and styled independently. */
  readonly segments?: readonly UiTooltipSegment[];
  /** Optionales, bereits aufgeloestes UI-Icon links neben der Zeile. */
  readonly textureKey?: string | null;
}

export interface UiTooltipSegment {
  readonly text: string;
  readonly color: number;
  readonly bold?: boolean;
}

const OFFSET_X = SPACE.lg;
const OFFSET_Y = SPACE.lg;
const PADDING = SPACE.md;
const TITLE_GAP = SPACE.xs;
const DIVIDER_GAP = SPACE.sm;
const ICON_SIZE = 16;
const ICON_GAP = SPACE.sm;
/** Leerzeilen (`text: ''`) dienen als Abschnittstrenner und brauchen keine volle Zeilenhoehe. */
const SPACER_H = SPACE.sm;
/**
 * Zeilen darueber werden still verworfen. Ein gelbes Item mit zwei Laufzeit-Affixen belegt
 * Grundwert, zwei Affixnamen samt Erklaerung, Vergleichsblock und Fussnoten – 16 reichten dafuer
 * nicht mehr, und abgeschnitten wuerde ausgerechnet das Ende: Vergleich und Zerlegehinweis.
 */
const MAX_LINES = 22;

export class UiTooltip {
  private container: Phaser.GameObjects.Container | null = null;
  private background: Phaser.GameObjects.Image | null = null;
  private titleText: Phaser.GameObjects.Text | null = null;
  private divider: Phaser.GameObjects.Rectangle | null = null;
  private lineTexts: Phaser.GameObjects.Text[] = [];
  private lineIcons: Phaser.GameObjects.Image[] = [];
  private lineSegmentTexts: Phaser.GameObjects.Text[][] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly maxWidth = 320,
    private readonly accentColor: number = TEXT.primary,
    /** Untere Designraumgrenze fuer Overlays mit einer festen Fusszeile. */
    private readonly bottomLimit = GAME_HEIGHT - 12,
  ) {}

  build(): Phaser.GameObjects.Container {
    this.destroy();

    this.background = this.scene.add.image(0, 0, ensureFlatPanelTexture(
      this.scene, '_uitooltip_initial', 10, 10, SURFACE.sunken, BORDER.subtle,
      { radius: RADIUS.md, fillAlpha: 0.98, strokeAlpha: 0.9 },
    ))
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.titleText = this.scene.add.text(0, 0, '', textStyle('label', {
      color: this.accentColor,
      wordWrapWidth: this.maxWidth,
    })).setOrigin(0, 0).setScrollFactor(0);
    this.divider = this.scene.add.rectangle(0, 0, 10, 1, BORDER.subtle, 0.9)
      .setOrigin(0, 0)
      .setScrollFactor(0);

    const objects: Phaser.GameObjects.GameObject[] = [this.background, this.titleText, this.divider];
    for (let index = 0; index < MAX_LINES; index++) {
      const line = this.scene.add.text(0, 0, '', textStyle('body', {
        color: TEXT.primary,
        wordWrapWidth: this.maxWidth,
      })).setOrigin(0, 0).setVisible(false).setScrollFactor(0);
      const icon = this.scene.add.image(0, 0, '_uitooltip_initial')
        .setDisplaySize(ICON_SIZE, ICON_SIZE)
        .setVisible(false)
        .setScrollFactor(0);
      this.lineTexts.push(line);
      this.lineIcons.push(icon);
      objects.push(icon, line);
    }

    this.container = this.scene.add.container(0, 0, objects).setVisible(false);
    return this.container;
  }

  /** Mehrzeiliger Tooltip mit eigener Farbe je Zeile. */
  show(
    title: string,
    titleColor: number,
    lines: readonly UiTooltipLine[],
    pointer: Phaser.Input.Pointer,
  ): void {
    if (!this.container || !this.background || !this.titleText || !this.divider) return;

    this.titleText.setText(title).setColor(toCssColor(titleColor));
    this.clearRichText();
    let contentWidth = this.titleText.width;

    const dividerY = PADDING + this.titleText.height + TITLE_GAP;
    let cursorY = dividerY + DIVIDER_GAP;
    this.lineTexts.forEach((text, index) => {
      const line = lines[index];
      if (!line) {
        text.setVisible(false);
        this.lineIcons[index]?.setVisible(false);
        return;
      }
      if (line.segments && line.segments.length > 0) {
        text.setVisible(false);
        this.lineIcons[index]?.setVisible(false);
        const rich = this.renderRichLine(line.segments, cursorY);
        contentWidth = Math.max(contentWidth, rich.contentWidth);
        cursorY = rich.bottom;
        return;
      }
      if (line.text.length === 0) {
        text.setVisible(false);
        this.lineIcons[index]?.setVisible(false);
        cursorY += SPACER_H;
        return;
      }
      const iconTextureKey = line.textureKey && this.scene.textures.exists(line.textureKey)
        ? getLoadoutIconTextureKey(this.scene, line.textureKey)
        : null;
      const icon = iconTextureKey
        ? this.lineIcons[index]
        : null;
      const textX = PADDING + (icon ? ICON_SIZE + ICON_GAP : 0);
      text
        .setText(line.text)
        .setColor(toCssColor(line.color))
        .setFontStyle(line.bold ? 'bold' : '')
        .setWordWrapWidth(this.maxWidth - (icon ? ICON_SIZE + ICON_GAP : 0))
        .setPosition(textX, cursorY)
        .setVisible(true);
      if (icon) {
        icon
          .setTexture(iconTextureKey!);
        fitLoadoutIcon(icon, ICON_SIZE, ICON_SIZE)
          .setPosition(PADDING + ICON_SIZE / 2, cursorY + text.height / 2)
          .setVisible(true);
      } else {
        this.lineIcons[index]?.setVisible(false);
      }
      contentWidth = Math.max(contentWidth, textX + text.width - PADDING);
      cursorY += text.height;
    });

    const width = contentWidth + PADDING * 2;
    const height = cursorY + PADDING;
    this.background.setTexture(ensureFlatPanelTexture(
      this.scene,
      `_uitooltip_${Math.ceil(width)}x${Math.ceil(height)}`,
      width,
      height,
      SURFACE.sunken,
      BORDER.subtle,
      { radius: RADIUS.md, fillAlpha: 0.98, strokeAlpha: 0.9 },
    )).setDisplaySize(width, height);
    this.titleText.setPosition(PADDING, PADDING);
    this.divider.setPosition(PADDING, dividerY).setSize(contentWidth, 1);

    this.container.setVisible(true);
    this.move(pointer);
  }

  /** Bestandsform: Titel in der Akzentfarbe, ein einzelner Fliesstext darunter. */
  showText(title: string, body: string, pointer: Phaser.Input.Pointer): void {
    this.show(title, this.accentColor, [{ text: body, color: COLORS.GREY_1 }], pointer);
  }

  move(pointer: Phaser.Input.Pointer): void {
    if (!this.container || !this.background) return;

    const width = this.background.width;
    const height = this.background.height;
    // Zeigerkoordinaten sind Renderpixel der Render-Aufloesung, das Overlay liegt dagegen im
    // 1920x1080-Designraum. Ohne die Umrechnung wandert der Tooltip von der Maus weg.
    const pointerX = toDesignSpace(this.scene.scale, pointer.x);
    const pointerY = toDesignSpace(this.scene.scale, pointer.y);
    // `Math.max(12, ...)` an der oberen Grenze: passt der Tooltip nicht mehr auf den Bildschirm,
    // waere der Clamp-Bereich sonst invertiert und Phaser lieferte ein negatives y – der Tooltip
    // verschwaende oben aus dem Bild, statt am oberen Rand zu kleben.
    const x = Phaser.Math.Clamp(pointerX + OFFSET_X, 12, Math.max(12, GAME_WIDTH - width - 12));
    const y = Phaser.Math.Clamp(pointerY + OFFSET_Y, 12, Math.max(12, this.bottomLimit - height));

    this.container.setPosition(x, y);
  }

  hide(): void {
    this.container?.setVisible(false);
  }

  isVisible(): boolean {
    return this.container?.visible ?? false;
  }

  destroy(): void {
    this.container?.destroy(true);
    this.container = null;
    this.background = null;
    this.titleText = null;
    this.divider = null;
    this.lineTexts = [];
    this.lineIcons = [];
    this.lineSegmentTexts = [];
  }

  private clearRichText(): void {
    for (const texts of this.lineSegmentTexts) {
      for (const text of texts) text.destroy();
    }
    this.lineSegmentTexts = [];
  }

  private renderRichLine(
    segments: readonly UiTooltipSegment[],
    startY: number,
  ): { bottom: number; contentWidth: number } {
    const maxX = PADDING + this.maxWidth;
    let x = PADDING;
    let y = startY;
    let lineHeight = 0;
    let contentWidth: number = PADDING;
    const texts: Phaser.GameObjects.Text[] = [];

    const nextVisualLine = (): void => {
      y += lineHeight;
      x = PADDING;
      lineHeight = 0;
    };

    for (const segment of segments) {
      // Keep whitespace tokens so the run boundaries remain invisible to the reader.
      const tokens = segment.text.split(/(\s+)/).filter((token) => token.length > 0);
      for (const token of tokens) {
        if (token.includes('\n')) {
          const parts = token.split('\n');
          for (const [partIndex, part] of parts.entries()) {
            if (part.length > 0) {
              const text = this.scene.add.text(0, 0, part, textStyle('body', { color: segment.color }))
                .setOrigin(0, 0)
                .setFontStyle(segment.bold ? 'bold' : '')
                .setScrollFactor(0);
              if (x > PADDING && x + text.width > maxX && !/^\s+$/.test(part)) nextVisualLine();
              text.setPosition(x, y);
              this.container?.add(text);
              texts.push(text);
              x += text.width;
              lineHeight = Math.max(lineHeight, text.height);
              contentWidth = Math.max(contentWidth, x);
            }
            if (partIndex < parts.length - 1) nextVisualLine();
          }
          continue;
        }

        const whitespace = /^\s+$/.test(token);
        const text = this.scene.add.text(0, 0, token, textStyle('body', { color: segment.color }))
          .setOrigin(0, 0)
          .setFontStyle(segment.bold ? 'bold' : '')
          .setScrollFactor(0);
        if (whitespace && x === PADDING) {
          text.destroy();
          continue;
        }
        if (!whitespace && x > PADDING && x + text.width > maxX) nextVisualLine();
        text.setPosition(x, y);
        this.container?.add(text);
        texts.push(text);
        x += text.width;
        lineHeight = Math.max(lineHeight, text.height);
        contentWidth = Math.max(contentWidth, x);
      }
    }

    this.lineSegmentTexts.push(texts);
    return { bottom: y + lineHeight, contentWidth: contentWidth - PADDING };
  }
}
