import type * as Phaser from 'phaser';
import { getHeldItemAnchor, PLAYER_TEXTURE_SIZE } from '../config';
import { getHeldItemSpriteSpec } from '../loadout/HeldItemVisuals';

/**
 * Das in den Pfoten getragene Loadout-Item einer Figur.
 *
 * Bewusst ein eigenstaendiges Image statt eines Containers um die Figur: `PlayerEntity.sprite`
 * traegt den Physik-Body, ist projektweit die Trefferposition und wird von Trefferblitz,
 * Beleuchtung und Klarheitskamera direkt referenziert – es in einen Container zu verpacken haette
 * all das verschoben. Der Preis ist, dass der Spielerfarben-Glow der Figur das Item nicht erfasst;
 * dafuer bleibt es bei genau einem Filter je Figur statt zweien.
 *
 * Das Bild bleibt ueber die gesamte Lebensdauer bestehen und wechselt nur seine Textur. Ein
 * Waffenwechsel darf kein Game Object erzeugen: er faellt in einer Runde pro Spieler beliebig oft an.
 */
export class HeldItemVisual {
  private image: Phaser.GameObjects.Image | null = null;
  private itemId: string | null = null;
  private hasSprite = false;
  private scrollFactor: number | null = null;

  /**
   * `onImageCreated` laeuft genau einmal, sobald das Bild tatsaechlich entsteht. Das Bild wird
   * erst beim ersten Item mit Grafik angelegt; Aufbaupfad-Arbeit wie das Zuordnen der
   * Klarheitskamera muss deshalb hier eingehaengt werden statt direkt nach dem Konstruktor.
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private depth: number,
    private readonly onImageCreated?: (image: Phaser.GameObjects.Image) => void,
  ) {}

  setDepth(depth: number): void {
    this.depth = depth;
    this.image?.setDepth(depth);
  }

  /**
   * Getragenes Item setzen. `null` oder eine ID ohne Bild (Nahkampf, Konstrukte) blendet aus.
   * Wiederholte Aufrufe mit derselben ID sind kostenlos – der Aufrufer darf jeden Frame rufen.
   */
  setItem(itemId: string | null): void {
    if (itemId === this.itemId) return;

    const spec = getHeldItemSpriteSpec(itemId);
    if (spec && !this.scene.textures.exists(spec.textureKey)) {
      // Noch nicht geladen: `itemId` bewusst nicht merken, damit der naechste Aufruf es erneut
      // versucht, statt das Item fuer den Rest der Runde auszublenden.
      this.hasSprite = false;
      this.image?.setVisible(false);
      return;
    }

    this.itemId = itemId;
    if (!spec) {
      this.hasSprite = false;
      this.image?.setVisible(false);
      return;
    }

    if (!this.image) {
      this.image = this.scene.add.image(0, 0, spec.textureKey);
      this.image.setDepth(this.depth);
      this.image.setVisible(false);
      if (this.scrollFactor !== null) this.image.setScrollFactor(this.scrollFactor);
      this.onImageCreated?.(this.image);
    } else {
      this.image.setTexture(spec.textureKey);
    }

    // Der Griffpunkt wird zum Ursprung des Bildes: danach ist Positionieren identisch mit
    // "Griff auf den Pfotenanker legen", unabhaengig von der Groesse der Waffentextur.
    const frame = this.image.frame;
    this.image.setOrigin(spec.gripX / frame.cutWidth, spec.gripY / frame.cutHeight);
    this.hasSprite = true;
  }

  /**
   * Bild an die Figur angleichen. `displaySize` ist die Kantenlaenge, mit der die Figur gezeichnet
   * wird – daraus folgt der Massstab der Waffentextur, sodass Arena und Lobby-Vorschau dieselbe
   * Zuordnung mit unterschiedlichen Groessen verwenden koennen.
   */
  sync(
    x: number,
    y: number,
    spriteRotation: number,
    displaySize: number,
    visible: boolean,
    alpha = 1,
  ): void {
    if (!this.image) return;
    if (!this.hasSprite || !visible) {
      this.image.setVisible(false);
      return;
    }

    const textureScale = displaySize / PLAYER_TEXTURE_SIZE;
    const anchor = getHeldItemAnchor(x, y, spriteRotation, textureScale);
    const frame = this.image.frame;

    this.image
      .setVisible(true)
      .setPosition(anchor.x, anchor.y)
      .setRotation(spriteRotation)
      .setDisplaySize(frame.cutWidth * textureScale, frame.cutHeight * textureScale)
      .setAlpha(alpha);
  }

  /** Fuer Vorschauen, die ihr Bild wie die Figur bildschirmfest zeichnen. */
  setScrollFactor(factor: number): void {
    this.scrollFactor = factor;
    this.image?.setScrollFactor(factor);
  }

  /** Das erzeugte Image, solange eines existiert – etwa zum Zuordnen der Klarheitskamera. */
  getImage(): Phaser.GameObjects.Image | null {
    return this.image;
  }

  destroy(): void {
    this.image?.destroy();
    this.image = null;
    this.hasSprite = false;
    this.itemId = null;
  }
}
