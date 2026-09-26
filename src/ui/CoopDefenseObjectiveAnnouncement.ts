import * as Phaser from 'phaser';
import { DEPTH, GAME_WIDTH } from '../config';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT } from './CoopDefenseSecondaryObjectiveLayout';
import { HudCard, HUD_TEXT_MUTED, hudTextStyle } from './HudCard';
import { HUD_TONES, type HudTone } from './HudFrameAssets';
import type { HudOcclusionRect } from './hudOcclusionFade';

const LAYOUT = COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT;
const ANNOUNCE_X = GAME_WIDTH / 2;
const ANNOUNCE_Y = LAYOUT.centerY;
const ANNOUNCE_W = LAYOUT.width;
const ANNOUNCE_H = LAYOUT.height;
const CARD_SCALE = LAYOUT.cardScale;
const CARD_H = 98 * CARD_SCALE;
/** Die Karte sitzt im oberen Teil der reservierten Fläche, die Detailzeile darunter. */
const CARD_OFFSET_Y = -(ANNOUNCE_H - CARD_H) / 2;
const DETAIL_Y = CARD_OFFSET_Y + CARD_H / 2 + 16;
const ANNOUNCE_IN_MS = 320;
const TRACKING_IN_MS = 460;
const TITLE_TRACKING_FROM = 7;
const TITLE_TRACKING = 0.8;
const ANNOUNCE_HOLD_MS = 1_900;
/** Ergebnisquittungen bleiben in der Mitte kurz; die lange Lesedauer gehört ihrem Panel. */
const ANNOUNCE_RESULT_HOLD_MS = 1_250;
const ANNOUNCE_FLIGHT_MS = 620;
const ANNOUNCE_OUT_MS = 360;
const BACKING_ALPHA = 0.74;
const TARGET_BACKING_ALPHA = 0.62;

export type CoopDefenseAnnouncementTone =
  | 'main'
  | 'wave'
  | 'secondary'
  | 'positive'
  | 'negative';

/** Jede Aussage hat dieselbe Farbfamilie wie ihr Zielpanel – der Flug wirkt dadurch wie ein Stück. */
const TONE_FAMILY: Readonly<Record<CoopDefenseAnnouncementTone, HudTone>> = {
  main: 'gold',
  wave: 'purple',
  secondary: 'blue',
  positive: 'green',
  negative: 'red',
};

/** Zielkarte eines Übergabeflugs in Bildschirmkoordinaten (Kartenmitte). */
export interface CoopDefenseAnnouncementTarget {
  readonly x: number;
  readonly y: number;
  /** Angezeigte Breite der Zielkarte. */
  readonly width: number;
  /** Rahmenmaßstab der Zielkarte (Quellpixel → Bildschirm). */
  readonly scale: number;
}

export interface CoopDefenseAnnouncementMessage {
  readonly id: string;
  readonly kicker: string;
  readonly title: string;
  readonly detail?: string;
  readonly tone: CoopDefenseAnnouncementTone;
  /** Meldungen desselben Themas ersetzen sich, damit keine veraltete Phase nachläuft. */
  readonly topic?: string;
  /** Höhere Werte rücken vor bereits wartende, weniger zeitkritische Meldungen. */
  readonly priority?: number;
  /** Späte Queue-Einträge werden unmittelbar vor dem Abspielen gegen den Live-Zustand geprüft. */
  readonly isRelevant?: () => boolean;
  readonly target?: CoopDefenseAnnouncementTarget;
  readonly holdMs?: number;
  readonly onStart?: () => void;
  readonly onArrive?: () => void;
  readonly onCancel?: () => void;
}

export function getCoopDefenseObjectiveAnnouncementHudRect(
  centerX: number,
  centerY: number,
  scaleX = 1,
  scaleY = 1,
): HudOcclusionRect {
  return {
    left: centerX - ANNOUNCE_W * scaleX / 2,
    right: centerX + ANNOUNCE_W * scaleX / 2,
    top: centerY - ANNOUNCE_H * scaleY / 2,
    bottom: centerY + ANNOUNCE_H * scaleY / 2,
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Phaser.Math.Clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Ein gemeinsamer, serialisierter Kanal für Hauptziel, Wellen, Nebenmissionen und Map-Events.
 *
 * Choreografie: Die Karte erscheint im oberen Bilddrittel (Aufblenden, leichtes Aufsteigen,
 * der Titel zieht seine Laufweite zusammen). Während der Lesezeit leert sich die Rinne als
 * stiller Countdown. Mit Zielpanel verwandelt sich die Karte danach in einem Zug in genau
 * dieses Panel – Position, Breite und Rahmenmaßstab laufen gemeinsam, der Inhalt blendet
 * früh aus. Am Ziel übernimmt das Panel ohne Sprung, weil Rahmen und Farbfamilie identisch sind.
 */
export class CoopDefenseObjectiveAnnouncement {
  private root!: Phaser.GameObjects.Container;
  private card!: HudCard;
  private detail!: Phaser.GameObjects.Text;
  private detailBacking!: Phaser.GameObjects.Graphics;
  private tweens: Phaser.Tweens.Tween[] = [];
  private readonly queue: CoopDefenseAnnouncementMessage[] = [];
  private readonly acceptedIds = new Set<string>();
  private activeMessage: CoopDefenseAnnouncementMessage | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  build(): void {
    this.card = new HudCard(this.scene, {
      scale: CARD_SCALE,
      width: ANNOUNCE_W,
      tone: 'gold',
      titleSize: 25,
      kickerSize: 12,
      centered: true,
      backingAlpha: BACKING_ALPHA,
    });
    this.card.root.setY(CARD_OFFSET_Y);
    this.detailBacking = this.scene.add.graphics();
    registerGraphicsObject(this.scene, 'gameplayHud', this.detailBacking);
    this.detail = this.scene.add.text(0, DETAIL_Y, '', hudTextStyle(13, HUD_TEXT_MUTED, false, 1.6)).setOrigin(0.5);
    this.root = this.scene.add.container(ANNOUNCE_X, ANNOUNCE_Y, [this.detailBacking, this.detail, this.card.root])
      .setDepth(DEPTH.OVERLAY)
      .setScrollFactor(0)
      .setVisible(false);
    promoteToClarityCamera(this.scene, this.root);
  }

  enqueue(message: CoopDefenseAnnouncementMessage): void {
    if (!this.root?.active || this.acceptedIds.has(message.id)) return;
    this.acceptedIds.add(message.id);

    if (message.topic) {
      for (let index = this.queue.length - 1; index >= 0; index -= 1) {
        if (this.queue[index].topic === message.topic) this.queue.splice(index, 1);
      }
      if (this.activeMessage?.topic === message.topic) this.cancelActiveMessage();
    }

    const priority = message.priority ?? 0;
    const insertAt = this.queue.findIndex((queued) => (queued.priority ?? 0) < priority);
    if (insertAt < 0) this.queue.push(message);
    else this.queue.splice(insertAt, 0, message);
    this.playNext();
  }

  /** Entfernt ausstehende bzw. laufende Meldungen eines Producers, ohne andere Topics zu stören. */
  clearTopic(topic: string): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index].topic === topic) this.queue.splice(index, 1);
    }
    if (this.activeMessage?.topic === topic) {
      this.cancelActiveMessage();
      this.playNext();
    }
  }

  reset(): void {
    this.stopTweens();
    this.queue.length = 0;
    this.acceptedIds.clear();
    this.activeMessage = null;
    this.resetVisual();
  }

  /** Aktuelle sichtbare Screen-Space-Fläche der laufenden Objective-Ankündigung. */
  getReservedHudRect(): HudOcclusionRect | null {
    if (!this.root?.visible || !this.activeMessage) return null;
    return getCoopDefenseObjectiveAnnouncementHudRect(
      this.root.x,
      this.root.y,
      this.root.scaleX,
      this.root.scaleY,
    );
  }

  destroy(): void {
    this.reset();
    this.root?.destroy(true);
  }

  private stopTweens(): void {
    for (const tween of this.tweens) tween.destroy();
    this.tweens = [];
  }

  private resetVisual(): void {
    this.root?.setVisible(false).setPosition(ANNOUNCE_X, ANNOUNCE_Y).setScale(1).setAlpha(1);
    this.card?.setWidth(ANNOUNCE_W).setContentAlpha(1).setBackingAlpha(BACKING_ALPHA);
    this.card?.root.setY(CARD_OFFSET_Y);
    this.detail?.setAlpha(1);
    this.detailBacking?.setAlpha(1);
  }

  private cancelActiveMessage(): void {
    const canceled = this.activeMessage;
    this.activeMessage = null;
    this.stopTweens();
    this.resetVisual();
    canceled?.onCancel?.();
  }

  private playNext(): void {
    if (this.activeMessage || this.queue.length === 0 || !this.root?.active) return;
    let message: CoopDefenseAnnouncementMessage | undefined;
    while (this.queue.length > 0) {
      const candidate = this.queue.shift();
      if (!candidate) break;
      if (candidate.isRelevant?.() === false) {
        candidate.onCancel?.();
        continue;
      }
      message = candidate;
      break;
    }
    if (!message) return;
    this.activeMessage = message;
    message.onStart?.();
    this.present(message);
  }

  private present(message: CoopDefenseAnnouncementMessage): void {
    const tone = TONE_FAMILY[message.tone];
    const style = HUD_TONES[tone];
    this.stopTweens();
    this.resetVisual();
    this.card.setTone(tone).setKicker(message.kicker).setValue('');
    this.card.title.setLetterSpacing(TITLE_TRACKING);
    this.card.setTitle(message.title, style.accent);
    this.card.setProgress(1, false, 0.7);
    const detail = message.detail ?? '';
    this.detail.setText(detail).setVisible(detail.length > 0);
    this.detailBacking.clear();
    if (detail) {
      const w = this.detail.width + 28;
      const h = this.detail.height + 6;
      this.detailBacking.fillStyle(0x070a0c, 0.6);
      this.detailBacking.fillRoundedRect(-w / 2, DETAIL_Y - h / 2, w, h, h / 2);
    }

    const hold = message.holdMs
      ?? (message.tone === 'positive' || message.tone === 'negative' ? ANNOUNCE_RESULT_HOLD_MS : ANNOUNCE_HOLD_MS);

    // Auftritt: Aufblenden, leichtes Aufsteigen, Titel zieht die Laufweite zusammen.
    this.root.setVisible(true).setAlpha(0).setScale(0.94)
      .setPosition(ANNOUNCE_X, ANNOUNCE_Y + LAYOUT.entryOffsetY);
    this.card.title.setAlpha(0);
    this.detail.setAlpha(0);
    this.detailBacking.setAlpha(0);
    this.tweens.push(this.scene.tweens.add({
      targets: this.root,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      y: ANNOUNCE_Y,
      duration: ANNOUNCE_IN_MS,
      ease: 'Cubic.easeOut',
    }));
    const tracking = { value: TITLE_TRACKING_FROM, alpha: 0 };
    this.tweens.push(this.scene.tweens.add({
      targets: tracking,
      value: TITLE_TRACKING,
      alpha: 1,
      delay: 60,
      duration: TRACKING_IN_MS,
      ease: 'Quart.easeOut',
      onUpdate: () => {
        this.card.title.setLetterSpacing(tracking.value).setAlpha(tracking.alpha);
      },
    }));
    this.tweens.push(this.scene.tweens.add({
      targets: [this.detail, this.detailBacking],
      alpha: 1,
      delay: 180,
      duration: 260,
      ease: 'Quad.easeOut',
    }));
    // Stiller Countdown der Lesezeit in der Rinne.
    const drain = { frac: 1 };
    this.tweens.push(this.scene.tweens.add({
      targets: drain,
      frac: 0,
      delay: ANNOUNCE_IN_MS,
      duration: Math.max(1, hold - ANNOUNCE_IN_MS),
      ease: 'Linear',
      onUpdate: () => { this.card.setProgress(drain.frac, false, 0.7); },
    }));

    this.tweens.push(this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      delay: hold,
      duration: 1,
      onComplete: () => {
        if (this.activeMessage !== message) return;
        if (message.target) this.flyTo(message, message.target);
        else this.fadeOut(message);
      },
    }));
  }

  /**
   * Übergabeflug: Die Karte wird zur Zielkarte. Die Containerskalierung übernimmt den
   * Rahmenmaßstab, die Kartenbreite wird so nachgeführt, dass die sichtbare Breite linear von
   * der Ankündigung zur Zielbreite läuft – Ecken und Schienen bleiben dabei proportional.
   */
  private flyTo(message: CoopDefenseAnnouncementMessage, target: CoopDefenseAnnouncementTarget): void {
    const startX = this.root.x;
    const startY = this.root.y;
    const endScale = target.scale / CARD_SCALE;
    // Die Karte sitzt oberhalb der Containermitte; das Ziel ist die Kartenmitte.
    const endY = target.y - CARD_OFFSET_Y * endScale;
    const proxy = { t: 0 };
    this.tweens.push(this.scene.tweens.add({
      targets: proxy,
      t: 1,
      duration: ANNOUNCE_FLIGHT_MS,
      ease: 'Cubic.easeInOut',
      onUpdate: () => {
        const t = proxy.t;
        const k = 1 + (endScale - 1) * t;
        const visibleWidth = ANNOUNCE_W + (target.width - ANNOUNCE_W) * t;
        this.root.setScale(k).setPosition(startX + (target.x - startX) * t, startY + (endY - startY) * t);
        this.card.setWidth(visibleWidth / k);
        const contentAlpha = 1 - smoothstep(0, 0.42, t);
        this.card.setContentAlpha(contentAlpha);
        this.detail.setAlpha(1 - smoothstep(0, 0.22, t));
        this.detailBacking.setAlpha(this.detail.alpha);
        const backingAlpha = BACKING_ALPHA + (TARGET_BACKING_ALPHA - BACKING_ALPHA) * t;
        this.card.setBackingAlpha(backingAlpha);
      },
      onComplete: () => this.finish(message),
    }));
  }

  private fadeOut(message: CoopDefenseAnnouncementMessage): void {
    this.tweens.push(this.scene.tweens.add({
      targets: this.root,
      y: ANNOUNCE_Y - 16,
      alpha: 0,
      duration: ANNOUNCE_OUT_MS,
      ease: 'Quad.easeIn',
      onComplete: () => this.finish(message),
    }));
  }

  private finish(message: CoopDefenseAnnouncementMessage): void {
    if (this.activeMessage !== message) return;
    this.stopTweens();
    this.resetVisual();
    this.activeMessage = null;
    message.onArrive?.();
    this.playNext();
  }
}
