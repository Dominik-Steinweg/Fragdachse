/**
 * PersistentBaseEditorHud – die vollständige Oberfläche der Persistent-Base-Editor-Runtime.
 *
 * Der Editor blendet Lobby-Overlay und beide Seitenpanels aus. Damit er trotzdem eine sichtbare,
 * bedienbare Oberfläche hat, ersetzt dieses schlanke HUD sie: ein Titel, eine Zeile für
 * Konflikt-/Statusinformation und der Ausstieg. ESC bleibt zusätzlich möglich, ist aber
 * ausdrücklich nicht der einzige Weg zurück.
 */
import * as Phaser from 'phaser';
import { DEPTH, GAME_WIDTH } from '../config';
import { t } from '../i18n';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { UiButton } from './UiButton';
import { ensureFlatPanelTexture } from './uiTextures';
import { BORDER, RADIUS, SPACE, SURFACE, textStyle } from './uiTheme';

const PANEL_W = 420;
const PANEL_H = 96;
const PANEL_X = GAME_WIDTH / 2;
const PANEL_Y = SPACE.lg + PANEL_H / 2;
const PANEL_TEX_KEY = '_pb_editor_hud_panel';
const LEAVE_BTN_W = 176;
const LEAVE_BTN_H = 40;

export class PersistentBaseEditorHud {
  private container: Phaser.GameObjects.Container | null = null;
  private titleText: Phaser.GameObjects.Text | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  private leaveBtn: UiButton | null = null;
  private visible = false;
  private lastStatus: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onLeave: () => void,
  ) {}

  build(): void {
    this.destroy();

    const panelKey = ensureFlatPanelTexture(
      this.scene, PANEL_TEX_KEY, PANEL_W, PANEL_H, SURFACE.raised, BORDER.subtle,
      { radius: RADIUS.lg, fillAlpha: 0.96, strokeAlpha: 0.85 },
    );

    const panel = this.scene.add.image(0, 0, panelKey).setOrigin(0.5);
    this.titleText = this.scene.add
      .text(-PANEL_W / 2 + SPACE.lg, -PANEL_H / 2 + SPACE.md, t('ui.persistentBase.editorTitle'), textStyle('label'))
      .setOrigin(0, 0);
    this.statusText = this.scene.add
      .text(
        -PANEL_W / 2 + SPACE.lg,
        SPACE.xs,
        t('ui.persistentBase.editorHint'),
        textStyle('caption', { wordWrapWidth: PANEL_W - LEAVE_BTN_W - SPACE.xxl }),
      )
      .setOrigin(0, 0.5);

    this.leaveBtn = new UiButton(this.scene, {
      x: PANEL_W / 2 - SPACE.lg - LEAVE_BTN_W / 2,
      y: 0,
      w: LEAVE_BTN_W,
      h: LEAVE_BTN_H,
      label: t('ui.persistentBase.leave'),
      intent: 'primary',
      onClick: () => this.onLeave(),
    });

    this.container = this.scene.add
      .container(PANEL_X, PANEL_Y, [panel, this.titleText, this.statusText, this.leaveBtn.getRoot()])
      .setScrollFactor(0)
      .setDepth(DEPTH.OVERLAY)
      .setVisible(false)
      .setActive(false);
    promoteToClarityCamera(this.scene, this.container);
    this.visible = false;
    this.lastStatus = null;
  }

  setVisible(visible: boolean): void {
    if (!this.container || this.visible === visible) return;
    this.visible = visible;
    this.container.setVisible(visible).setActive(visible);
    this.leaveBtn?.setEnabled(visible);
  }

  isVisible(): boolean { return this.visible; }

  /** Statuszeile des Editors; `null` fällt auf den neutralen Hinweistext zurück. */
  setStatus(status: string | null): void {
    if (!this.statusText || this.lastStatus === status) return;
    this.lastStatus = status;
    this.statusText.setText(status ?? t('ui.persistentBase.editorHint'));
  }

  refreshLocale(): void {
    if (!this.container) return;
    const wasVisible = this.visible;
    this.build();
    this.setVisible(wasVisible);
  }

  destroy(): void {
    this.leaveBtn?.destroy();
    this.leaveBtn = null;
    this.container?.destroy(true);
    this.container = null;
    this.titleText = null;
    this.statusText = null;
    this.visible = false;
    this.lastStatus = null;
  }
}
