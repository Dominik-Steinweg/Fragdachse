import * as Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_VIEWPORT_WIDTH,
  COLORS,
  DEPTH,
  GAME_WIDTH,
  toCssColor,
} from '../config';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { t } from '../i18n';
import { getCoopDefenseObjectiveAnnouncementHudRect } from './CoopDefenseObjectiveAnnouncement';
import { COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT } from './CoopDefenseSecondaryObjectiveLayout';
import { RADIAL_HUB_FRAME, RADIAL_HUB_GEOMETRY, RADIAL_WHEEL_TEXTURE } from './RadialWheelAssets';
import { FONT_DISPLAY, FONT_WEIGHT } from './uiTheme';

/** Angezeigte Kantenlänge des Waldboden-Nabenrings aus dem Utility-Rad-Atlas. */
const MEDALLION_SIZE = 136;
const FRAME_SCALE = MEDALLION_SIZE / RADIAL_HUB_GEOMETRY.size;
const INNER_RADIUS = RADIAL_HUB_GEOMETRY.innerRadius * FRAME_SCALE;
const OUTER_RADIUS = RADIAL_HUB_GEOMETRY.outerRadius * FRAME_SCALE;
/** Der Lichtbogen liegt auf dem grünen Innensaum des Holzrings. */
const SEAM_RADIUS = INNER_RADIUS + 2.6;
const FALLBACK_RING_WIDTH = OUTER_RADIUS - INNER_RADIUS;

/** Abstand Medaillonmitte ↔ Dachs; hält Lebens-/Statusring der Figur frei. */
const ANCHOR_OFFSET_Y = 118;
const EDGE_MARGIN = 12;
/** Oberhalb dieser Linie liegen Statusleiste und Ankündigungen. */
const TOP_HUD_CLEARANCE = 64;

const NUMERAL_SIZE_PX = 56;
const GO_SIZE_PX = 30;
const INK = '#070a0c';
const PARCHMENT = '#ded5ad';
const SEAM_LIGHT = 0xdfe9b0;
const DISC_FILL = 0x0b110d;
const FOLLOW_SHARPNESS = 14;

const ENTER_MS = 360;
const NUMERAL_IN_MS = 240;
const NUMERAL_OUT_MS = 180;
const GO_LEAF_MS = 900;
const GO_HOLD_MS = 520;
const GO_OUT_MS = 380;

/** Blätter, die sich beim Start vom Efeu-Ring lösen: Winkel, Weite, Drehung, Farbe. */
const GO_LEAVES = [
  { angle: -0.35, reach: 62, spin: 2.4, size: 1.0, color: COLORS.GREEN_2 },
  { angle: 0.35, reach: 54, spin: -1.8, size: 0.8, color: COLORS.GREEN_3 },
  { angle: 1.05, reach: 66, spin: 2.9, size: 1.1, color: COLORS.GREEN_2 },
  { angle: 1.7, reach: 48, spin: -2.2, size: 0.75, color: COLORS.GREEN_1 },
  { angle: 2.45, reach: 60, spin: 1.6, size: 0.95, color: COLORS.GREEN_3 },
  { angle: 3.15, reach: 52, spin: -2.6, size: 0.85, color: COLORS.GREEN_2 },
  { angle: 3.9, reach: 64, spin: 2.1, size: 1.05, color: COLORS.GREEN_4 },
  { angle: 4.7, reach: 50, spin: -1.5, size: 0.8, color: COLORS.GREEN_1 },
  { angle: 5.45, reach: 58, spin: 2.7, size: 0.9, color: COLORS.GREEN_3 },
] as const;
/** Mandelförmige Blattkontur in lokalen Einheiten (Spitze bei +x). */
const LEAF_SHAPE: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [-0.45, -0.42], [0.35, -0.38], [1, 0], [0.35, 0.38], [-0.45, 0.42],
];
const LEAF_POINTS = LEAF_SHAPE.map(() => new Phaser.Math.Vector2());
const LEAF_LENGTH = 8;

type Phase = 'hidden' | 'count' | 'go';
type Side = 'above' | 'below';

const easeOutCubic = (value: number): number => 1 - (1 - value) ** 3;
const clamp01 = (value: number): number => Phaser.Math.Clamp(value, 0, 1);

/**
 * Rundenstart-Countdown (3 · 2 · 1 · LOS!) als kleines Waldboden-Medaillon am eigenen Dachs.
 *
 * Der Nabenring des Utility-Rads trägt die Ziffer; auf seinem grünen Innensaum läuft pro
 * Sekunde ein heller Lichtbogen ab. Das Medaillon folgt der Figur im Fokus des Schleiers und
 * weicht nach unten aus, wenn oben HUD oder Zielankündigung liegen. Bei „LOS!“ lösen sich ein
 * paar Blätter vom Ring, danach blendet es sich aus.
 *
 * Die Ansicht ist rein visuell: Zeitbasis, Audio, Schleier und Anker liefert der Aufrufer.
 */
export class RoundStartCountdownView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly medallion: Phaser.GameObjects.Container;
  private readonly seam: Phaser.GameObjects.Graphics;
  private readonly leaves: Phaser.GameObjects.Graphics;
  private readonly numeral: Phaser.GameObjects.Text;
  private readonly outgoing: Phaser.GameObjects.Text;
  private readonly goText: Phaser.GameObjects.Text;
  private phase: Phase = 'hidden';
  private side: Side | null = null;
  private shownValue = 0;
  private secondFraction = 1;
  private anchorX = GAME_WIDTH / 2;
  private anchorY = ARENA_OFFSET_Y + ARENA_HEIGHT / 2;
  private hasAnchor = false;
  private lastFollowMs = 0;
  private readonly goState = { leaves: 1, seam: 1 };
  private goTimer: Phaser.Tweens.Tween | null = null;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    const disc = scene.add.graphics();
    disc.fillStyle(DISC_FILL, 0.74).fillCircle(0, 0, INNER_RADIUS + 1);
    const parts: Phaser.GameObjects.GameObject[] = [disc];
    if (scene.textures.exists(RADIAL_WHEEL_TEXTURE)) {
      parts.push(scene.add.image(0, 0, RADIAL_WHEEL_TEXTURE, RADIAL_HUB_FRAME)
        .setOrigin(RADIAL_HUB_GEOMETRY.centerX / RADIAL_HUB_GEOMETRY.size, RADIAL_HUB_GEOMETRY.centerY / RADIAL_HUB_GEOMETRY.size)
        .setScale(FRAME_SCALE));
    } else {
      // Ohne Atlas bleibt eine ruhige Holzring-Andeutung statt eines leeren Rands.
      disc.lineStyle(FALLBACK_RING_WIDTH, COLORS.BROWN_6, 0.9)
        .strokeCircle(0, 0, INNER_RADIUS + FALLBACK_RING_WIDTH / 2);
    }
    this.seam = scene.add.graphics();
    this.leaves = scene.add.graphics();
    registerGraphicsObject(scene, 'gameplayHud', this.seam);
    registerGraphicsObject(scene, 'gameplayHud', this.leaves);

    this.numeral = this.createLabel(NUMERAL_SIZE_PX);
    this.outgoing = this.createLabel(NUMERAL_SIZE_PX);
    this.goText = this.createLabel(GO_SIZE_PX).setColor(toCssColor(COLORS.GREEN_1)).setLetterSpacing(1);
    parts.push(this.seam, this.outgoing, this.numeral, this.goText);

    this.medallion = scene.add.container(0, 0, parts);
    this.root = scene.add.container(0, 0, [this.medallion, this.leaves])
      .setDepth(DEPTH.OVERLAY)
      .setScrollFactor(0)
      .setVisible(false);
    promoteToClarityCamera(scene, this.root);
  }

  isVisible(): boolean {
    return this.phase !== 'hidden';
  }

  /** Bildschirmposition des eigenen Dachses nach Kamera-Feedback (Designraum 1920×1080). */
  setAnchor(screenX: number, screenY: number): void {
    const first = !this.hasAnchor;
    this.anchorX = screenX;
    this.anchorY = screenY;
    this.hasAnchor = true;
    if (this.phase === 'hidden') return;
    if (this.side === null) this.side = this.resolveSide();
    this.follow(first);
  }

  /** Zeigt den laufenden Countdown; `msLeft` ist die Restzeit bis zur Freigabe (> 0). */
  showCount(msLeft: number): void {
    if (this.destroyed) return;
    const value = Math.max(1, Math.ceil(msLeft / 1000));
    if (this.phase !== 'count') this.enter();
    if (value !== this.shownValue) this.advanceTo(value);
    this.secondFraction = clamp01((msLeft - (value - 1) * 1000) / 1000);
    this.redrawSeam();
  }

  /** Einmaliger Abschluss: „LOS!“, Blätter lösen sich, danach blendet sich das Medaillon aus. */
  playGo(): void {
    if (this.destroyed || this.phase === 'go') return;
    if (this.phase === 'hidden') this.enter();
    this.phase = 'go';
    this.shownValue = 0;
    this.dropOutgoing();
    this.numeral.setVisible(false);

    const tweens = this.scene.tweens;
    this.goText.setText(t('ui.match.go')).setVisible(true).setAlpha(0).setScale(1.3);
    tweens.add({ targets: this.goText, alpha: 1, scale: 1, duration: 220, ease: 'Cubic.easeOut' });

    tweens.killTweensOf(this.medallion);
    this.medallion.setAlpha(1).setScale(1);
    tweens.add({ targets: this.medallion, scale: 1.07, duration: 140, yoyo: true, ease: 'Sine.easeOut' });

    this.goState.leaves = 0;
    this.goState.seam = 0;
    tweens.add({
      targets: this.goState,
      leaves: 1,
      duration: GO_LEAF_MS,
      ease: 'Linear',
      onUpdate: () => this.redrawLeaves(),
      onComplete: () => this.redrawLeaves(),
    });
    tweens.add({
      targets: this.goState,
      seam: 1,
      duration: 420,
      ease: 'Sine.easeOut',
      onUpdate: () => this.redrawSeam(),
    });
    tweens.add({
      targets: this.medallion,
      alpha: 0,
      delay: GO_HOLD_MS,
      duration: GO_OUT_MS,
      ease: 'Sine.easeIn',
    });
    this.goTimer = tweens.addCounter({
      from: 0,
      to: 1,
      duration: Math.max(GO_LEAF_MS, GO_HOLD_MS + GO_OUT_MS),
      onComplete: () => { if (this.phase === 'go') this.hide(); },
    });
  }

  hide(): void {
    if (this.destroyed) return;
    this.stopTweens();
    this.phase = 'hidden';
    this.side = null;
    this.shownValue = 0;
    this.secondFraction = 1;
    this.goState.leaves = 1;
    this.goState.seam = 1;
    this.seam.clear();
    this.leaves.clear();
    this.numeral.setVisible(false);
    this.outgoing.setVisible(false);
    this.goText.setVisible(false);
    this.root.setVisible(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.hide();
    this.destroyed = true;
    this.root.destroy(true);
  }

  private createLabel(sizePx: number): Phaser.GameObjects.Text {
    return this.scene.add.text(0, 0, '', {
      fontFamily: FONT_DISPLAY,
      fontSize: `${sizePx}px`,
      fontStyle: FONT_WEIGHT.bold,
      color: PARCHMENT,
      stroke: INK,
      strokeThickness: Math.max(3, Math.round(sizePx / 11)),
      padding: { x: 8, y: 8 },
    })
      .setOrigin(0.5)
      .setShadow(0, 2, 'rgba(0,0,0,0.55)', 6, true, true)
      .setVisible(false);
  }

  private enter(): void {
    this.stopTweens();
    this.phase = 'count';
    this.side = this.hasAnchor ? this.resolveSide() : null;
    this.shownValue = 0;
    this.secondFraction = 1;
    this.goState.leaves = 1;
    this.goState.seam = 1;
    this.leaves.clear();
    this.goText.setVisible(false);
    this.outgoing.setVisible(false);
    this.root.setVisible(true);
    this.follow(true);
    this.medallion.setAlpha(0).setScale(0.86);
    this.scene.tweens.add({ targets: this.medallion, alpha: 1, scale: 1, duration: ENTER_MS, ease: 'Back.easeOut' });
  }

  private advanceTo(value: number): void {
    const first = this.shownValue === 0;
    this.dropOutgoing();
    this.shownValue = value;
    const tweens = this.scene.tweens;
    tweens.killTweensOf(this.numeral);
    this.numeral.setText(String(value)).setVisible(true).setAlpha(0).setScale(1.28).setY(0);
    tweens.add({ targets: this.numeral, alpha: 1, scale: 1, duration: NUMERAL_IN_MS, ease: 'Cubic.easeOut' });
    if (!first) {
      // Leichter Taktschlag des ganzen Medaillons statt einer Schockwelle.
      tweens.add({ targets: this.medallion, scale: 1.045, duration: 110, yoyo: true, ease: 'Sine.easeOut' });
    }
  }

  private dropOutgoing(): void {
    if (!this.numeral.visible || this.numeral.text === '') return;
    const tweens = this.scene.tweens;
    tweens.killTweensOf(this.outgoing);
    this.outgoing.setText(this.numeral.text).setVisible(true)
      .setAlpha(this.numeral.alpha).setScale(this.numeral.scale).setY(0);
    tweens.add({
      targets: this.outgoing,
      alpha: 0,
      scale: 0.8,
      y: 6,
      duration: NUMERAL_OUT_MS,
      ease: 'Quad.easeIn',
      onComplete: () => this.outgoing.setVisible(false),
    });
  }

  /** Oben, solange Arena-Oberkante und Zielankündigung frei bleiben; sonst unterhalb der Figur. */
  private resolveSide(): Side {
    const top = this.anchorY - ANCHOR_OFFSET_Y - OUTER_RADIUS;
    if (top < ARENA_OFFSET_Y + TOP_HUD_CLEARANCE) return 'below';
    const announce = getCoopDefenseObjectiveAnnouncementHudRect(
      GAME_WIDTH / 2,
      COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT.centerY,
    );
    const x = this.clampX(this.anchorX);
    const overlapsAnnouncement = x + OUTER_RADIUS > announce.left - EDGE_MARGIN
      && x - OUTER_RADIUS < announce.right + EDGE_MARGIN
      && top < announce.bottom + EDGE_MARGIN;
    return overlapsAnnouncement ? 'below' : 'above';
  }

  private clampX(x: number): number {
    return Phaser.Math.Clamp(
      x,
      ARENA_OFFSET_X + OUTER_RADIUS + EDGE_MARGIN,
      ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH - OUTER_RADIUS - EDGE_MARGIN,
    );
  }

  private follow(snap: boolean): void {
    const offset = this.side === 'below' ? ANCHOR_OFFSET_Y : -ANCHOR_OFFSET_Y;
    const targetX = this.clampX(this.anchorX);
    const targetY = Phaser.Math.Clamp(
      this.anchorY + offset,
      ARENA_OFFSET_Y + OUTER_RADIUS + EDGE_MARGIN,
      ARENA_OFFSET_Y + ARENA_HEIGHT - OUTER_RADIUS - EDGE_MARGIN,
    );
    const now = this.scene.time.now;
    const dt = Math.min(100, Math.max(0, now - this.lastFollowMs));
    this.lastFollowMs = now;
    if (snap || dt === 0) {
      this.root.setPosition(targetX, targetY);
      return;
    }
    // Weiches Nachführen: Screenshake und Kamerazittern reißen das Medaillon nicht mit.
    const k = 1 - Math.exp(-FOLLOW_SHARPNESS * dt / 1000);
    this.root.setPosition(this.root.x + (targetX - this.root.x) * k, this.root.y + (targetY - this.root.y) * k);
  }

  private redrawSeam(): void {
    const g = this.seam;
    g.clear();
    if (this.phase === 'hidden') return;
    const top = -Math.PI / 2;
    const end = top + Math.PI * 2;

    if (this.phase === 'go') {
      // Der Saum leuchtet einmal vollständig auf und verglimmt.
      const fade = 1 - clamp01(this.goState.seam);
      g.lineStyle(7, SEAM_LIGHT, 0.28 * fade).strokeCircle(0, 0, SEAM_RADIUS);
      g.lineStyle(3, SEAM_LIGHT, 0.95 * fade).strokeCircle(0, 0, SEAM_RADIUS);
      return;
    }

    const fraction = this.secondFraction;
    if (fraction <= 0.002) return;
    // Der Kopf wandert im Uhrzeigersinn; übrig bleibt der Bogen zurück zur 12-Uhr-Position.
    const head = top + Math.PI * 2 * (1 - fraction);
    g.lineStyle(7, SEAM_LIGHT, 0.22);
    g.beginPath();
    g.arc(0, 0, SEAM_RADIUS, head, end, false);
    g.strokePath();
    g.lineStyle(3, SEAM_LIGHT, 0.95);
    g.beginPath();
    g.arc(0, 0, SEAM_RADIUS, head, end, false);
    g.strokePath();
    g.fillStyle(SEAM_LIGHT, 1);
    g.fillCircle(Math.cos(head) * SEAM_RADIUS, Math.sin(head) * SEAM_RADIUS, 2.6);
  }

  private redrawLeaves(): void {
    const g = this.leaves;
    g.clear();
    const p = clamp01(this.goState.leaves);
    if (p >= 1 || this.phase !== 'go') return;
    const eased = easeOutCubic(p);
    const alpha = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
    for (const leaf of GO_LEAVES) {
      const distance = OUTER_RADIUS - 6 + leaf.reach * eased;
      // Leichtes Absinken wie fallendes Laub.
      const cx = Math.cos(leaf.angle) * distance;
      const cy = Math.sin(leaf.angle) * distance + 14 * p * p;
      const rotation = leaf.angle + leaf.spin * p;
      const length = LEAF_LENGTH * leaf.size;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      for (let index = 0; index < LEAF_SHAPE.length; index += 1) {
        const [lx, ly] = LEAF_SHAPE[index];
        const x = lx * length;
        const y = ly * length;
        LEAF_POINTS[index].set(cx + x * cos - y * sin, cy + x * sin + y * cos);
      }
      g.fillStyle(leaf.color, alpha);
      g.fillPoints(LEAF_POINTS, true);
      g.lineStyle(1, COLORS.GREEN_6, 0.7 * alpha);
      g.lineBetween(cx - cos * length * 0.8, cy - sin * length * 0.8, cx + cos * length * 0.8, cy + sin * length * 0.8);
    }
  }

  private stopTweens(): void {
    this.goTimer?.remove();
    this.goTimer = null;
    this.scene.tweens.killTweensOf([
      this.medallion, this.numeral, this.outgoing, this.goText, this.goState,
    ]);
  }
}
