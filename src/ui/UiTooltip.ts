import * as Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, toCssColor } from '../config';
import { toDesignSpace } from '../graphics/RenderResolution';

/**
 * Geteilter Hover-Tooltip fuer Overlays: dunkle Flaeche, farbiger Titel, Trennlinie und darunter
 * beliebig viele einzeln eingefaerbte Zeilen. Der Aufrufer haengt den von `build()` gelieferten
 * Container in seinen eigenen Root-Container, damit der Tooltip die Schichtung des Overlays erbt.
 */

export interface UiTooltipLine {
  readonly text: string;
  readonly color: number;
  readonly bold?: boolean;
}

const OFFSET_X = 18;
const OFFSET_Y = 18;
const PADDING = 12;
const TITLE_GAP = 6;
const DIVIDER_GAP = 7;
/** Leerzeilen (`text: ''`) dienen als Abschnittstrenner und brauchen keine volle Zeilenhoehe. */
const SPACER_H = 8;
/**
 * Zeilen darueber werden still verworfen. Ein gelbes Item mit zwei Laufzeit-Affixen belegt
 * Grundwert, zwei Affixnamen samt Erklaerung, Vergleichsblock und Fussnoten – 16 reichten dafuer
 * nicht mehr, und abgeschnitten wuerde ausgerechnet das Ende: Vergleich und Zerlegehinweis.
 */
const MAX_LINES = 22;

export class UiTooltip {
  private container: Phaser.GameObjects.Container | null = null;
  private background: Phaser.GameObjects.Rectangle | null = null;
  private titleText: Phaser.GameObjects.Text | null = null;
  private divider: Phaser.GameObjects.Rectangle | null = null;
  private lineTexts: Phaser.GameObjects.Text[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly maxWidth = 320,
    private readonly accentColor: number = COLORS.GOLD_1,
  ) {}

  build(): Phaser.GameObjects.Container {
    this.destroy();

    this.background = this.scene.add.rectangle(0, 0, 10, 10, COLORS.GREY_9, 0.97)
      .setOrigin(0, 0)
      .setStrokeStyle(1, this.accentColor)
      .setScrollFactor(0);
    this.titleText = this.scene.add.text(0, 0, '', {
      fontSize: '16px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: toCssColor(this.accentColor),
      wordWrap: { width: this.maxWidth },
    }).setOrigin(0, 0).setScrollFactor(0);
    this.divider = this.scene.add.rectangle(0, 0, 10, 1, COLORS.GREY_4, 0.9)
      .setOrigin(0, 0)
      .setScrollFactor(0);

    const objects: Phaser.GameObjects.GameObject[] = [this.background, this.titleText, this.divider];
    for (let index = 0; index < MAX_LINES; index++) {
      const line = this.scene.add.text(0, 0, '', {
        fontSize: '14px',
        fontFamily: 'monospace',
        color: toCssColor(COLORS.GREY_1),
        wordWrap: { width: this.maxWidth },
      }).setOrigin(0, 0).setVisible(false).setScrollFactor(0);
      this.lineTexts.push(line);
      objects.push(line);
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
    let contentWidth = this.titleText.width;

    const dividerY = PADDING + this.titleText.height + TITLE_GAP;
    let cursorY = dividerY + DIVIDER_GAP;
    this.lineTexts.forEach((text, index) => {
      const line = lines[index];
      if (!line) {
        text.setVisible(false);
        return;
      }
      if (line.text.length === 0) {
        text.setVisible(false);
        cursorY += SPACER_H;
        return;
      }
      text
        .setText(line.text)
        .setColor(toCssColor(line.color))
        .setFontStyle(line.bold ? 'bold' : '')
        .setPosition(PADDING, cursorY)
        .setVisible(true);
      contentWidth = Math.max(contentWidth, text.width);
      cursorY += text.height;
    });

    this.background.setSize(contentWidth + PADDING * 2, cursorY + PADDING);
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
    const y = Phaser.Math.Clamp(pointerY + OFFSET_Y, 12, Math.max(12, GAME_HEIGHT - height - 12));

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
  }
}
