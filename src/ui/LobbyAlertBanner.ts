import * as Phaser from 'phaser';
import { COLORS, GAME_WIDTH, toCssColor } from '../config';
import { LOBBY_FRAME_BOUNDS, LOBBY_PANEL_WIDTH } from '../arena/LobbyWorldLayout';
import { ensureRoundedTexture } from './uiTextures';
import { RADIUS, SPACE, SURFACE, TEXT, textStyle } from './uiTheme';

export type LobbyAlertSeverity = 'error' | 'warning' | 'info';

export interface LobbyAlert {
  readonly severity: LobbyAlertSeverity;
  readonly title: string;
  readonly message: string;
  readonly persistent?: boolean;
  /** Meldungen mit hoeherer Prioritaet duerfen eine aktive Meldung ersetzen. */
  readonly priority?: number;
}

const BANNER_W = LOBBY_PANEL_WIDTH;
const BANNER_X = (GAME_WIDTH - BANNER_W) / 2;
/** Der Banner sitzt ueber dem Panel und reserviert dort im Normalzustand keinen Platz. */
const BANNER_BOTTOM_Y = LOBBY_FRAME_BOUNDS.outerTop - SPACE.md;
const BANNER_MIN_H = 80;
const BANNER_MAX_H = 176;
const BANNER_PAD_X = SPACE.xl;
const BANNER_PAD_TOP = SPACE.md;
const BANNER_PAD_BOTTOM = SPACE.lg;
const BANNER_TITLE_GAP = SPACE.xs;
const BANNER_CONTENT_W = BANNER_W - BANNER_PAD_X * 2;
const BANNER_MAX_MESSAGE_LINES = 5;

const SEVERITY_PRIORITY: Readonly<Record<LobbyAlertSeverity, number>> = {
  info: 10,
  warning: 20,
  error: 30,
};

const SEVERITY_STYLE: Readonly<Record<LobbyAlertSeverity, {
  readonly accent: number;
  readonly title: number;
}>> = {
  error: { accent: COLORS.RED_2, title: COLORS.RED_1 },
  warning: { accent: COLORS.GOLD_2, title: COLORS.GOLD_1 },
  info: { accent: COLORS.BLUE_2, title: COLORS.BLUE_1 },
};

/**
 * Einzelne, persistente Fehlermeldung der Lobby.
 *
 * Der Root wird vom LobbyOverlay in dessen Clarity-Container gehaengt. Dadurch bleibt der
 * Banner bildschirmfest, liegt ueber der Weltkamera und wird beim Lobby-Neuaufbau gemeinsam mit
 * dem restlichen Overlay zerstoert. Er besitzt absichtlich keine interaktiven Kinder.
 */
export class LobbyAlertBanner {
  private root: Phaser.GameObjects.Container | null = null;
  private background: Phaser.GameObjects.Image | null = null;
  private titleText: Phaser.GameObjects.Text | null = null;
  private messageText: Phaser.GameObjects.Text | null = null;
  private activeAlert: LobbyAlert | null = null;
  private activePriority = -Infinity;
  private activeSignature: string | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  build(): Phaser.GameObjects.Container {
    this.destroy();

    this.background = this.scene.add.image(
      BANNER_X,
      BANNER_BOTTOM_Y - BANNER_MIN_H,
      this.bannerTexture('info', BANNER_MIN_H),
    )
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setVisible(false);
    this.titleText = this.scene.add.text(
      BANNER_X + BANNER_PAD_X,
      0,
      '',
      textStyle('section', { color: TEXT.danger }),
    )
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setVisible(false);
    this.messageText = this.scene.add.text(
      BANNER_X + BANNER_PAD_X,
      0,
      '',
      textStyle('body', { color: TEXT.primary, wordWrapWidth: BANNER_CONTENT_W }),
    )
      .setOrigin(0, 0)
      .setMaxLines(BANNER_MAX_MESSAGE_LINES)
      .setScrollFactor(0)
      .setVisible(false);

    this.root = this.scene.add.container(0, 0, [
      this.background,
      this.titleText,
      this.messageText,
    ])
      .setScrollFactor(0)
      .setVisible(false);
    return this.root;
  }

  showAlert(alert: LobbyAlert): void {
    if (!this.root || !this.background || !this.titleText || !this.messageText) return;

    const priority = alert.priority ?? SEVERITY_PRIORITY[alert.severity];
    if (this.activeAlert && priority < this.activePriority) return;

    const signature = [
      alert.severity,
      alert.title,
      alert.message,
      alert.persistent === true,
      priority,
    ].join('|');
    if (signature === this.activeSignature) return;

    const style = SEVERITY_STYLE[alert.severity];
    this.activeAlert = alert;
    this.activePriority = priority;
    this.activeSignature = signature;
    this.titleText
      .setText(alert.title)
      .setColor(toCssColor(style.title));
    this.messageText
      .setText(alert.message)
      .setColor(toCssColor(TEXT.primary));

    const contentHeight = BANNER_PAD_TOP
      + this.titleText.height
      + BANNER_TITLE_GAP
      + this.messageText.height
      + BANNER_PAD_BOTTOM;
    const height = Math.min(BANNER_MAX_H, Math.max(BANNER_MIN_H, Math.ceil(contentHeight)));
    const top = BANNER_BOTTOM_Y - height;

    this.background
      .setTexture(this.bannerTexture(alert.severity, height))
      .setDisplaySize(BANNER_W, height)
      .setPosition(BANNER_X, top)
      .setVisible(true);
    this.titleText
      .setPosition(BANNER_X + BANNER_PAD_X, top + BANNER_PAD_TOP)
      .setVisible(true);
    this.messageText
      .setPosition(
        BANNER_X + BANNER_PAD_X,
        top + BANNER_PAD_TOP + this.titleText.height + BANNER_TITLE_GAP,
      )
      .setVisible(true);
    this.root.setVisible(true);
  }

  clearAlert(): void {
    this.activeAlert = null;
    this.activePriority = -Infinity;
    this.activeSignature = null;
    this.root?.setVisible(false);
    this.background?.setVisible(false);
    this.titleText?.setVisible(false);
    this.messageText?.setVisible(false);
  }

  isVisible(): boolean {
    return this.root?.visible ?? false;
  }

  destroy(): void {
    this.root?.destroy(true);
    this.root = null;
    this.background = null;
    this.titleText = null;
    this.messageText = null;
    this.activeAlert = null;
    this.activePriority = -Infinity;
    this.activeSignature = null;
  }

  private bannerTexture(severity: LobbyAlertSeverity, height: number): string {
    const key = `_lobby_alert_${severity}_${BANNER_W}x${Math.round(height)}`;
    const style = SEVERITY_STYLE[severity];
    return ensureRoundedTexture(this.scene, {
      key,
      w: BANNER_W,
      h: height,
      radius: RADIUS.lg,
      topColor: SURFACE.modal,
      bottomColor: SURFACE.sunken,
      fillAlpha: 0.88,
      strokeColor: style.accent,
      strokeAlpha: 0.72,
      strokeWidth: 1,
      highlightAlpha: 0.035,
      leftAccentColor: style.accent,
      leftAccentAlpha: 0.9,
      leftAccentWidth: 6,
    });
  }
}
