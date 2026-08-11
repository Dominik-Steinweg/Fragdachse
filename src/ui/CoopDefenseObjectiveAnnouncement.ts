import * as Phaser from 'phaser';
import { COLORS, DEPTH, GAME_WIDTH, toCssColor } from '../config';
import { COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT } from '../config/coopDefenseTutorial';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';

const ANNOUNCE_X = GAME_WIDTH / 2;
const ANNOUNCE_Y = COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT.centerY;
const ANNOUNCE_W = 420;
const ANNOUNCE_H = COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT.height;
const ANNOUNCE_ENTRY_OFFSET_Y = COOP_DEFENSE_OBJECTIVE_ANNOUNCEMENT_LAYOUT.entryOffsetY;
const ANNOUNCE_IN_MS = 200;
const ANNOUNCE_HOLD_MS = 1_900;
/** Ergebnisquittungen bleiben in der Mitte kurz; die lange Lesedauer gehört ihrem Panel. */
const ANNOUNCE_RESULT_HOLD_MS = 1_250;
const ANNOUNCE_FLIGHT_MS = 460;

export type CoopDefenseAnnouncementTone =
  | 'main'
  | 'wave'
  | 'secondary'
  | 'positive'
  | 'negative';

interface AnnouncementStyle {
  readonly accent: number;
  readonly muted: number;
}

const STYLES: Readonly<Record<CoopDefenseAnnouncementTone, AnnouncementStyle>> = {
  main: { accent: COLORS.GOLD_1, muted: COLORS.GOLD_3 },
  wave: { accent: COLORS.PURPLE_2, muted: COLORS.PURPLE_4 },
  secondary: { accent: COLORS.BLUE_2, muted: COLORS.BLUE_4 },
  positive: { accent: COLORS.GREEN_2, muted: COLORS.GREEN_4 },
  negative: { accent: COLORS.RED_2, muted: COLORS.RED_4 },
};

export interface CoopDefenseAnnouncementTarget {
  readonly x: number;
  readonly y: number;
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

const KICKER_FONT = {
  fontSize: '13px', fontFamily: 'monospace', fontStyle: 'bold',
  color: toCssColor(COLORS.GREY_3), letterSpacing: 4,
};
const TITLE_FONT = {
  fontSize: '25px', fontFamily: 'monospace', fontStyle: 'bold',
  color: toCssColor(COLORS.GREY_1), align: 'center' as const,
};
const DETAIL_FONT = {
  fontSize: '13px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
  align: 'center' as const, letterSpacing: 1,
};

function fitTitle(text: Phaser.GameObjects.Text, full: string, maxWidth: number): void {
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

/**
 * Ein gemeinsamer, serialisierter Kanal für Hauptziel, Wellen und Nebenmissionen. Dadurch
 * behalten alle drei dieselbe Choreografie, ohne bei zeitgleichen Triggern übereinanderzuliegen.
 */
export class CoopDefenseObjectiveAnnouncement {
  private root!: Phaser.GameObjects.Container;
  private frame!: Phaser.GameObjects.Graphics;
  private kicker!: Phaser.GameObjects.Text;
  private title!: Phaser.GameObjects.Text;
  private detail!: Phaser.GameObjects.Text;
  private tween: Phaser.Tweens.TweenChain | null = null;
  private readonly queue: CoopDefenseAnnouncementMessage[] = [];
  private readonly acceptedIds = new Set<string>();
  private activeMessage: CoopDefenseAnnouncementMessage | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  build(): void {
    this.frame = this.scene.add.graphics();
    this.kicker = this.scene.add.text(0, -ANNOUNCE_H / 2 + 22, '', KICKER_FONT).setOrigin(0.5);
    this.title = this.scene.add.text(0, -ANNOUNCE_H / 2 + 52, '', TITLE_FONT).setOrigin(0.5);
    this.detail = this.scene.add.text(0, -ANNOUNCE_H / 2 + 78, '', DETAIL_FONT).setOrigin(0.5);
    this.root = this.scene.add.container(ANNOUNCE_X, ANNOUNCE_Y, [
      this.frame, this.kicker, this.title, this.detail,
    ])
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

  reset(): void {
    this.tween?.destroy();
    this.tween = null;
    this.queue.length = 0;
    this.acceptedIds.clear();
    this.activeMessage = null;
    this.root?.setVisible(false).setPosition(ANNOUNCE_X, ANNOUNCE_Y).setScale(1).setAlpha(1);
  }

  destroy(): void {
    this.reset();
    this.root?.destroy(true);
  }

  private cancelActiveMessage(): void {
    const canceled = this.activeMessage;
    this.activeMessage = null;
    this.tween?.destroy();
    this.tween = null;
    this.root.setVisible(false).setPosition(ANNOUNCE_X, ANNOUNCE_Y).setScale(1).setAlpha(1);
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

    const style = STYLES[message.tone];
    const decorative = getGraphicsQualityProfile(this.scene).level !== 'low';
    this.kicker.setText(message.kicker).setColor(toCssColor(style.muted));
    fitTitle(this.title, message.title, ANNOUNCE_W - 44);
    this.title.setColor(toCssColor(style.accent));
    this.detail.setText(message.detail ?? '').setVisible((message.detail?.length ?? 0) > 0);

    this.frame.clear();
    this.frame.fillStyle(COLORS.GREY_9, 0.82);
    this.frame.fillRoundedRect(-ANNOUNCE_W / 2, -ANNOUNCE_H / 2, ANNOUNCE_W, ANNOUNCE_H, 10);
    this.frame.lineStyle(1.5, style.accent, 0.58);
    this.frame.strokeRoundedRect(-ANNOUNCE_W / 2, -ANNOUNCE_H / 2, ANNOUNCE_W, ANNOUNCE_H, 10);
    const kickerY = -ANNOUNCE_H / 2 + 22;
    const halfText = this.kicker.width / 2 + 14;
    this.frame.lineStyle(1.5, style.accent, 0.72);
    this.frame.lineBetween(-halfText - 44, kickerY, -halfText, kickerY);
    this.frame.lineBetween(halfText, kickerY, halfText + 44, kickerY);
    if (decorative) {
      this.frame.fillStyle(style.accent, 0.92);
      this.frame.fillCircle(-halfText - 52, kickerY, 2.5);
      this.frame.fillCircle(halfText + 52, kickerY, 2.5);
    }

    this.root
      .setVisible(true)
      .setAlpha(0)
      .setScale(0.9)
      .setPosition(ANNOUNCE_X, ANNOUNCE_Y + ANNOUNCE_ENTRY_OFFSET_Y);
    const defaultHold = message.tone === 'positive' || message.tone === 'negative'
      ? ANNOUNCE_RESULT_HOLD_MS
      : ANNOUNCE_HOLD_MS;
    const exit = message.target
      ? {
        x: message.target.x,
        y: message.target.y,
        scaleX: message.target.scale,
        scaleY: message.target.scale,
        alpha: 0,
        delay: message.holdMs ?? defaultHold,
        duration: ANNOUNCE_FLIGHT_MS,
        ease: 'Cubic.easeInOut',
      }
      : {
        y: ANNOUNCE_Y - 14,
        alpha: 0,
        delay: message.holdMs ?? defaultHold,
        duration: 420,
        ease: 'Quad.easeIn',
      };
    this.tween = this.scene.tweens.chain({
      targets: this.root,
      tweens: [
        { alpha: 1, scaleX: 1, scaleY: 1, y: ANNOUNCE_Y, duration: ANNOUNCE_IN_MS, ease: 'Back.easeOut' },
        exit,
      ],
      onComplete: () => {
        this.tween = null;
        this.root.setVisible(false).setPosition(ANNOUNCE_X, ANNOUNCE_Y).setScale(1).setAlpha(1);
        const completed = this.activeMessage;
        this.activeMessage = null;
        completed?.onArrive?.();
        this.playNext();
      },
    });
  }
}
