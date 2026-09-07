import type * as Phaser from 'phaser';
import type { WeaponFeedbackProfile } from '../config/weaponFeedback';
import { HeldWeaponFeedbackModel } from '../effects/weapon/HeldWeaponFeedbackModel';
import type { OwnerHeldWeaponPose } from './OwnerVisualSource';
import { getHeldItemAnchor, HELD_ITEM_TEXTURE_SIZE, type MuzzleOrigin } from '../config';
import {
  getHeldItemPointWorld,
  getHeldItemSpriteSpec,
} from '../loadout/HeldItemVisuals';

/**
 * Das in den Pfoten getragene Loadout-Item einer Figur.
 *
 * Ein eigenstaendiges Image mit eigener Rueckstosspose. PlayerBody und Player-Runtime bleiben
 * die Quelle fuer Position und Treffergeometrie; das Item folgt der optionalen Spielerpräsentation.
 *
 * Das Bild bleibt ueber die gesamte Lebensdauer bestehen und wechselt nur seine Textur. Ein
 * Waffenwechsel darf kein Game Object erzeugen: er faellt in einer Runde pro Spieler beliebig oft an.
 */
export class HeldItemVisual {
  private image: Phaser.GameObjects.Image | null = null;
  private itemId: string | null = null;
  private hasSprite = false;
  private scrollFactor: number | null = null;
  private readonly feedback = new HeldWeaponFeedbackModel();
  private readonly feedbackPose = { recoilPx: 0, rotationRad: 0 };
  private staleItemId: string | null | undefined;

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
   * Wiederholte Aufrufe mit derselben ID erzeugen keine Arbeit am Image. `force` kennzeichnet
   * eine bewusste lokale Auswahl; sie darf auch einen laufenden Shot-Slot-Override abbrechen.
   */
  setItem(itemId: string | null, force = false): void {
    if (!force && itemId === this.staleItemId && this.feedback.isActive(this.scene.time.now)) return;
    if (itemId === this.itemId) this.staleItemId = undefined;
    if (itemId === this.itemId) return;
    this.resetFeedback();

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
   * wird – daraus folgt der Massstab der Waffentextur, sodass World-Darstellung und Menü-Vorschau dieselbe
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
      this.resetFeedback();
      this.image.setVisible(false);
      return;
    }

    const textureScale = displaySize / HELD_ITEM_TEXTURE_SIZE;
    const anchor = getHeldItemAnchor(x, y, spriteRotation, textureScale);
    const frame = this.image.frame;
    this.feedback.sample(this.scene.time.now, this.feedbackPose);
    const recoil = this.feedbackPose.recoilPx * textureScale;

    this.image
      .setVisible(true)
      .setPosition(anchor.x - Math.sin(spriteRotation) * recoil, anchor.y + Math.cos(spriteRotation) * recoil)
      .setRotation(spriteRotation + this.feedbackPose.rotationRad)
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

  playShot(itemId: string, profile: WeaponFeedbackProfile): 'started' | 'refreshed' | null {
    const previous = this.itemId;
    if (itemId !== this.itemId) this.setItem(itemId, true);
    if (!this.hasSprite) return null;
    if (previous !== itemId) this.staleItemId = previous;
    return this.feedback.fire(profile, this.scene.time.now) ? 'started' : 'refreshed';
  }

  stopSustained(): void { this.feedback.stopSustained(this.scene.time.now); }
  resetFeedback(): void { this.feedback.reset(); this.staleItemId = undefined; }

  /** Current rendered muzzle; never consumed by simulation. */
  readWeaponPose(out: OwnerHeldWeaponPose): boolean {
    const image = this.image;
    const spec = getHeldItemSpriteSpec(this.itemId);
    if (!image?.active || !image.visible || !spec || !this.itemId) return false;
    const x = (spec.muzzleX - spec.gripX) * image.scaleX;
    const y = (spec.muzzleY - spec.gripY) * image.scaleY;
    const c = Math.cos(image.rotation), s = Math.sin(image.rotation);
    out.x = image.x + x * c - y * s;
    out.y = image.y + x * s + y * c;
    out.rotation = image.rotation;
    out.itemId = this.itemId;
    return true;
  }

  /** Liefert den registrierten Mündungs-Punkt in Weltkoordinaten für Effekte und Audio. */
  getMuzzleOrigin(
    x: number,
    y: number,
    spriteRotation: number,
    displaySize: number,
  ): MuzzleOrigin | null {
    const spec = getHeldItemSpriteSpec(this.itemId);
    if (!spec) return null;
    const point = getHeldItemPointWorld(
      x,
      y,
      spriteRotation,
      displaySize,
      spec,
      spec.muzzleX,
      spec.muzzleY,
    );
    const anchor = getHeldItemAnchor(x, y, spriteRotation, displaySize / HELD_ITEM_TEXTURE_SIZE);
    this.feedback.sample(this.scene.time.now, this.feedbackPose);
    const c = Math.cos(this.feedbackPose.rotationRad), s = Math.sin(this.feedbackPose.rotationRad);
    const dx = point.x - anchor.x, dy = point.y - anchor.y;
    const recoil = this.feedbackPose.recoilPx * displaySize / HELD_ITEM_TEXTURE_SIZE;
    return {
      x: anchor.x + dx * c - dy * s - Math.sin(spriteRotation) * recoil,
      y: anchor.y + dx * s + dy * c + Math.cos(spriteRotation) * recoil,
    };
  }

  destroy(): void {
    this.resetFeedback();
    this.image?.destroy();
    this.image = null;
    this.hasSprite = false;
    this.itemId = null;
  }
}
