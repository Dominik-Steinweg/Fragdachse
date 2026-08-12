/**
 * UiButton – der gemeinsame Button der gesamten Oberflaeche.
 *
 * Ersetzt das bisher an ~40 Stellen wiederholte Muster aus `add.image` mit Texturschluessel,
 * separatem `add.text` und `attachHoverEffect`. Neben der Vereinheitlichung bringt er zwei
 * Zustaende mit, die es vorher nirgends gab: eine Press-Reaktion und einen echten
 * Deaktiviert-Zustand.
 *
 * **Aufbau:** Wurzel ist ein Container *auf* der Buttonmitte, dessen Kinder lokal bei (0, 0)
 * liegen. Nur so darf skaliert werden – bei absolut platzierten Kindern zoege `scale` das
 * Element Richtung Bildschirmecke (siehe `docs/ai/visual-guidelines.md`).
 *
 * **Klarheitskamera:** Der Aufrufer haengt `getRoot()` in seinen Overlay-Container und ruft
 * anschliessend einmal `promoteToClarityCamera` auf der Wurzel des Overlays auf.
 */
import * as Phaser from 'phaser';
import {
  BUTTON_SCALE,
  INTENT,
  MOTION,
  RADIUS,
  SPACE,
  textStyle,
  type ButtonIntent,
  type TypeRole,
} from './uiTheme';
import { COLORS, toCssColor } from '../config';
import {
  ensureIconTexture,
  ensureRoundedTexture,
  lerpColor,
  type UiIconName,
} from './uiTextures';

type ButtonVisualState = 'rest' | 'hover' | 'press';

export interface UiButtonOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  /** Typo-Rolle der Beschriftung. Vorgabe `label` (15 px), fuer den Haupt-CTA `subtitle`. */
  labelRole?: TypeRole;
  intent?: ButtonIntent;
  icon?: UiIconName;
  /** Nur das Symbol zeigen – fuer Pfeile und Werkzeugknoepfe. */
  iconOnly?: boolean;
  iconSize?: number;
  radius?: number;
  onClick?: () => void;
  /**
   * `pointerup` ist noetig, wo der Browser eine echte Nutzergeste verlangt (Vollbild). Der
   * Button merkt sich dann seinen eigenen `pointerdown` und ignoriert fremde Loslass-Ereignisse,
   * die ein sich schliessendes Overlay durchreicht.
   */
  activateOn?: 'pointerdown' | 'pointerup';
  scrollFactor?: number;
  /** Zusaetzliche Bedingung; ist sie falsch, reagiert der Button nicht. */
  isEnabled?: () => boolean;
}

const BADGE_RADIUS = 9;

export class UiButton {
  private readonly root: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Image;
  private readonly labelText: Phaser.GameObjects.Text | null = null;
  private readonly iconImage: Phaser.GameObjects.Image | null = null;
  private badge: Phaser.GameObjects.Container | null = null;
  private badgeCount: Phaser.GameObjects.Text | null = null;

  private intent: ButtonIntent;
  /** Aktuelles Symbol – nicht `options.icon` lesen, sonst faellt `setIcon` beim naechsten Hover zurueck. */
  private currentIcon: UiIconName | null;
  private enabled = true;
  private hovered = false;
  private pressed = false;
  private scaleTween: Phaser.Tweens.Tween | null = null;
  private readonly ownPointerIds = new Set<number>();
  private readonly globalPointerUp: ((pointer: Phaser.Input.Pointer) => void) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly options: UiButtonOptions,
  ) {
    this.intent = options.intent ?? 'neutral';
    this.currentIcon = options.icon ?? null;
    const scrollFactor = options.scrollFactor ?? 0;

    this.bg = scene.add.image(0, 0, this.textureFor('rest')).setScrollFactor(scrollFactor);

    const children: Phaser.GameObjects.GameObject[] = [this.bg];

    if (options.icon) {
      this.iconImage = scene.add.image(0, 0, this.iconTexture())
        .setDisplaySize(this.iconSize(), this.iconSize())
        .setScrollFactor(scrollFactor);
      children.push(this.iconImage);
    }

    if (options.label && !options.iconOnly) {
      this.labelText = scene.add.text(0, 0, options.label, textStyle(options.labelRole ?? 'label', {
        color: INTENT[this.intent].label,
      })).setOrigin(0.5).setScrollFactor(scrollFactor);
      children.push(this.labelText);
    }

    this.root = scene.add.container(options.x, options.y, children);
    this.layoutContent();
    this.applyIntentVisuals();

    this.bg.setInteractive({ useHandCursor: true });
    this.bindPointer();

    if (options.activateOn === 'pointerup') {
      this.globalPointerUp = (pointer: Phaser.Input.Pointer) => {
        this.ownPointerIds.delete(pointer.id);
      };
      scene.input.on('pointerup', this.globalPointerUp);
      scene.input.on('pointerupoutside', this.globalPointerUp);
    }
  }

  // ── Oeffentliche Schnittstelle ─────────────────────────────────────────────

  getRoot(): Phaser.GameObjects.Container {
    return this.root;
  }

  /** Die Hintergrundflaeche – etwa als `glowTarget` fuer `LivingBarEffect`. */
  getBackground(): Phaser.GameObjects.Image {
    return this.bg;
  }

  setIntent(intent: ButtonIntent): this {
    if (this.intent === intent) return this;
    this.intent = intent;
    this.applyIntentVisuals();
    return this;
  }

  getIntent(): ButtonIntent {
    return this.intent;
  }

  setLabel(label: string): this {
    if (!this.labelText || this.labelText.text === label) return this;
    this.labelText.setText(label);
    this.layoutContent();
    return this;
  }

  /** `null` blendet das Symbol aus – etwa wenn ein Schloss nach der Freischaltung wegfaellt. */
  setIcon(icon: UiIconName | null): this {
    if (!this.iconImage || this.currentIcon === icon) return this;
    this.currentIcon = icon;
    if (icon === null) {
      this.iconImage.setVisible(false);
    } else {
      this.iconImage.setVisible(true);
      this.iconImage.setTexture(this.iconTexture());
      this.iconImage.setDisplaySize(this.iconSize(), this.iconSize());
    }
    this.layoutContent();
    return this;
  }

  /**
   * Deaktiviert den Button sichtbar und funktional. Der urspruengliche Intent bleibt gemerkt,
   * damit `setEnabled(true)` ihn wiederherstellt.
   */
  setEnabled(enabled: boolean): this {
    if (this.enabled === enabled) return this;
    this.enabled = enabled;
    if (!enabled) {
      this.hovered = false;
      this.pressed = false;
      this.ownPointerIds.clear();
      this.tweenScale(1);
    }
    // Die Trefferflaeche bleibt bestehen, nur der Cursor wechselt: `interactive()` unterbindet
    // Hover, Press und Ausloesen ohnehin. Ein `disableInteractive()` wuerde daneben auch die
    // Pointer-Ereignisse abschneiden, an denen externe Erklaerungs-Tooltips haengen (gesperrte
    // Buttons sind genau die, die einen Hinweis brauchen).
    this.bg.setInteractive({ useHandCursor: enabled });
    this.applyIntentVisuals();
    return this;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Kleiner Zaehler oben rechts. `null` entfernt ihn wieder. Ersetzt das frueher farbige
   * Leuchten ganzer Buttons – die Aufmerksamkeit bleibt so lokal und die Flaeche neutral.
   */
  setBadge(count: number | null): this {
    if (count === null || count <= 0) {
      this.badge?.destroy(true);
      this.badge = null;
      this.badgeCount = null;
      return this;
    }

    const label = count > 9 ? '9+' : String(count);
    if (this.badge && this.badgeCount) {
      this.badgeCount.setText(label);
      return this;
    }

    const bx = this.options.w / 2 - BADGE_RADIUS + 2;
    const by = -this.options.h / 2 + BADGE_RADIUS - 2;
    const dot = this.scene.add.circle(0, 0, BADGE_RADIUS, COLORS.GOLD_1)
      .setStrokeStyle(1.5, COLORS.GOLD_6, 0.9)
      .setScrollFactor(this.options.scrollFactor ?? 0);
    this.badgeCount = this.scene.add.text(0, 0, label, textStyle('numS', { color: COLORS.GOLD_6 }))
      .setOrigin(0.5)
      .setScrollFactor(this.options.scrollFactor ?? 0);
    this.badge = this.scene.add.container(bx, by, [dot, this.badgeCount])
      .setScrollFactor(this.options.scrollFactor ?? 0);
    this.root.add(this.badge);
    return this;
  }

  setVisible(visible: boolean): this {
    this.root.setVisible(visible);
    return this;
  }

  setPosition(x: number, y: number): this {
    this.root.setPosition(x, y);
    return this;
  }

  destroy(): void {
    if (this.globalPointerUp) {
      this.scene.input.off('pointerup', this.globalPointerUp);
      this.scene.input.off('pointerupoutside', this.globalPointerUp);
    }
    this.scaleTween?.remove();
    this.scaleTween = null;
    this.root.destroy(true);
  }

  // ── Intern ────────────────────────────────────────────────────────────────

  private effectiveIntent(): ButtonIntent {
    return this.enabled ? this.intent : 'disabled';
  }

  private labelColor(): number {
    const spec = INTENT[this.effectiveIntent()];
    return this.hovered && spec.labelHover !== undefined ? spec.labelHover : spec.label;
  }

  /** Grundfarbe des jeweiligen Zustands: Hover hellt auf, Press dunkelt ab. */
  private fillFor(state: ButtonVisualState): number {
    const base = INTENT[this.effectiveIntent()].fill;
    if (state === 'hover') return lerpColor(base, 0xffffff, 0.1);
    if (state === 'press') return lerpColor(base, 0x000000, 0.12);
    return base;
  }

  private textureFor(state: ButtonVisualState): string {
    const intent = this.effectiveIntent();
    const spec = INTENT[intent];
    const radius = this.options.radius ?? RADIUS.md;
    const fill = this.fillFor(state);
    const key = `_btn_${intent}_${state}_${Math.round(this.options.w)}x${Math.round(this.options.h)}_r${radius}`;
    return ensureRoundedTexture(this.scene, {
      key,
      w: this.options.w,
      h: this.options.h,
      radius,
      topColor: lerpColor(fill, 0xffffff, 0.16),
      bottomColor: lerpColor(fill, 0x000000, 0.3),
      fillAlpha: spec.fillAlpha,
      strokeColor: spec.stroke,
      strokeAlpha: spec.strokeAlpha,
      strokeWidth: 2,
      highlightAlpha: spec.gloss,
    });
  }

  private iconSize(): number {
    return this.options.iconSize ?? Math.round(this.options.h * 0.46);
  }

  /** In doppelter Groesse zeichnen und per `setDisplaySize` verkleinern – haelt die Kontur sauber. */
  private iconTexture(): string {
    return ensureIconTexture(
      this.scene,
      this.currentIcon ?? 'info',
      this.iconSize() * 2,
      this.labelColor(),
    );
  }

  /** Setzt Textur, Groesse und Farbe des Symbols auf den aktuellen Zustand. */
  private syncIcon(alpha?: number): void {
    if (!this.iconImage || this.currentIcon === null) return;
    this.iconImage.setTexture(this.iconTexture());
    this.iconImage.setDisplaySize(this.iconSize(), this.iconSize());
    if (alpha !== undefined) this.iconImage.setAlpha(alpha);
  }

  private currentVisualState(): ButtonVisualState {
    if (!this.enabled) return 'rest';
    if (this.pressed) return 'press';
    return this.hovered ? 'hover' : 'rest';
  }

  private applyIntentVisuals(): void {
    const spec = INTENT[this.effectiveIntent()];
    this.bg.setTexture(this.textureFor(this.currentVisualState()));
    this.bg.setAlpha(spec.restAlpha);
    this.labelText?.setColor(toCssColor(this.labelColor()));
    this.labelText?.setAlpha(spec.restAlpha);
    this.syncIcon(spec.restAlpha);
  }

  /** Zentriert Symbol und Beschriftung gemeinsam – die Beschriftung wechselt zur Laufzeit. */
  private layoutContent(): void {
    const iconVisible = this.iconImage !== null && this.currentIcon !== null;
    if (!iconVisible) {
      this.labelText?.setOrigin(0.5).setPosition(0, 0);
      return;
    }
    if (!this.labelText) {
      this.iconImage!.setPosition(0, 0);
      return;
    }
    const iconSize = this.iconSize();
    const gap = SPACE.sm;
    const total = iconSize + gap + this.labelText.width;
    this.iconImage!.setPosition(-total / 2 + iconSize / 2, 0);
    this.labelText.setOrigin(0, 0.5).setPosition(-total / 2 + iconSize + gap, 0);
  }

  private interactive(): boolean {
    if (!this.enabled) return false;
    if (!INTENT[this.intent].interactive) return false;
    return this.options.isEnabled?.() ?? true;
  }

  private bindPointer(): void {
    this.bg.on('pointerover', () => {
      if (!this.interactive()) return;
      this.hovered = true;
      this.refreshState();
      this.tweenScale(BUTTON_SCALE.hover);
    });

    this.bg.on('pointerout', () => {
      if (!this.hovered && !this.pressed) return;
      this.hovered = false;
      this.pressed = false;
      this.refreshState();
      this.tweenScale(1);
    });

    this.bg.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.interactive()) return;
      this.pressed = true;
      this.refreshState();
      this.tweenScale(BUTTON_SCALE.press);
      if (this.options.activateOn === 'pointerup') {
        this.ownPointerIds.add(pointer.id);
        return;
      }
      this.options.onClick?.();
    });

    this.bg.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const wasPressed = this.pressed;
      this.pressed = false;
      this.refreshState();
      this.tweenScale(this.hovered ? BUTTON_SCALE.hover : 1);
      if (this.options.activateOn !== 'pointerup') return;
      // Nur ein Loslassen, zu dem dieser Button auch das Druecken gesehen hat.
      if (!this.ownPointerIds.delete(pointer.id) || !wasPressed) return;
      if (!this.interactive()) return;
      this.options.onClick?.();
    });
  }

  private refreshState(): void {
    this.bg.setTexture(this.textureFor(this.currentVisualState()));
    this.labelText?.setColor(toCssColor(this.labelColor()));
    this.syncIcon();
  }

  private tweenScale(target: number): void {
    this.scaleTween?.remove();
    this.scaleTween = this.scene.tweens.add({
      targets: this.root,
      scaleX: target,
      scaleY: target,
      duration: target < 1 ? MOTION.instant : MOTION.fast,
      ease: MOTION.ease.hover,
    });
  }
}
