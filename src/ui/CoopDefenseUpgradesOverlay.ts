import * as Phaser from 'phaser';
import {
  COLORS,
  DEPTH,
  GAME_HEIGHT,
  GAME_WIDTH,
  toCssColor,
} from '../config';
import type { CoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';

const PANEL_W = GAME_WIDTH - 120;
const PANEL_H = GAME_HEIGHT - 88;
const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;
const TITLE_Y = CY - PANEL_H / 2 + 38;
const SUBTITLE_Y = TITLE_Y + 32;
const BAR_W = PANEL_W - 140;
const BAR_H = 18;
const BAR_X = CX - BAR_W / 2;
const BAR_Y = SUBTITLE_Y + 48;
const POINTS_Y = BAR_Y + 38;
const FOOTER_Y = CY + PANEL_H / 2 - 28;
const UPGRADE_AREA_W = PANEL_W - 112;
const UPGRADE_AREA_TOP = POINTS_Y + 52;
const UPGRADE_AREA_BOTTOM = FOOTER_Y - 56;
const UPGRADE_AREA_H = UPGRADE_AREA_BOTTOM - UPGRADE_AREA_TOP;
const UPGRADE_AREA_Y = UPGRADE_AREA_TOP + UPGRADE_AREA_H / 2;
const UPGRADE_BLOCK_W = 320;
const UPGRADE_BLOCK_H = 170;
const UPGRADE_BLOCK_X = CX - UPGRADE_AREA_W / 2 + UPGRADE_BLOCK_W / 2 + 28;
const UPGRADE_BLOCK_Y = UPGRADE_AREA_TOP + UPGRADE_BLOCK_H / 2 + 36;

const DIM_COLOR = COLORS.GREY_10;
const DIM_ALPHA = 0.78;
const PANEL_BG = COLORS.GREY_7;
const PANEL_ALPHA = 0.96;
const ACCENT = COLORS.GOLD_1;

export class CoopDefenseUpgradesOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private dimRect: Phaser.GameObjects.Rectangle | null = null;
  private levelText: Phaser.GameObjects.Text | null = null;
  private xpText: Phaser.GameObjects.Text | null = null;
  private pointsText: Phaser.GameObjects.Text | null = null;
  private hpStatusText: Phaser.GameObjects.Text | null = null;
  private hpInstructionText: Phaser.GameObjects.Text | null = null;
  private hpBlock: Phaser.GameObjects.Rectangle | null = null;
  private hpBlockTitleText: Phaser.GameObjects.Text | null = null;
  private futureUpgradesHintText: Phaser.GameObjects.Text | null = null;
  private progressFill: Phaser.GameObjects.Rectangle | null = null;
  private progressLabelText: Phaser.GameObjects.Text | null = null;
  private visible = false;
  private dismissDelay: Phaser.Time.TimerEvent | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getProgress: () => CoopDefenseProgressSnapshot,
    private readonly onLevelUpHpUpgrade: () => boolean,
    private readonly onLevelDownHpUpgrade: () => boolean,
  ) {}

  build(): void {
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
    this.levelText = null;
    this.xpText = null;
    this.pointsText = null;
    this.hpStatusText = null;
    this.hpInstructionText = null;
    this.hpBlock = null;
    this.hpBlockTitleText = null;
    this.futureUpgradesHintText = null;
    this.progressFill = null;
    this.progressLabelText = null;

    const objects: Phaser.GameObjects.GameObject[] = [];

    this.dimRect = this.scene.add.rectangle(CX, CY, GAME_WIDTH, GAME_HEIGHT, DIM_COLOR, DIM_ALPHA)
      .setScrollFactor(0);
    objects.push(this.dimRect);

    const panel = this.scene.add.rectangle(CX, CY, PANEL_W, PANEL_H, PANEL_BG, PANEL_ALPHA)
      .setStrokeStyle(2, ACCENT)
      .setScrollFactor(0)
      .setInteractive();
    objects.push(panel);

    objects.push(
      this.scene.add.text(CX, TITLE_Y, 'UPGRADES', {
        fontSize: '28px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(ACCENT),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    this.levelText = this.scene.add.text(CX, SUBTITLE_Y, 'Level 1', {
      fontSize: '22px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.levelText);

    this.xpText = this.scene.add.text(CX, SUBTITLE_Y + 28, '0 XP gesamt', {
      fontSize: '15px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_2),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.xpText);

    objects.push(
      this.scene.add.rectangle(CX, BAR_Y, BAR_W, BAR_H, COLORS.GREY_9, 0.95)
        .setStrokeStyle(1, COLORS.GREY_4)
        .setScrollFactor(0),
    );
    this.progressFill = this.scene.add.rectangle(BAR_X, BAR_Y, BAR_W, BAR_H, COLORS.GREEN_4, 1)
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    objects.push(this.progressFill);

    this.progressLabelText = this.scene.add.text(CX, BAR_Y + 22, '0 / 25 XP bis zum naechsten Level', {
      fontSize: '13px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
    }).setOrigin(0.5, 0).setScrollFactor(0);
    objects.push(this.progressLabelText);

    this.pointsText = this.scene.add.text(CX, POINTS_Y, '0 Upgrade-Punkte verfuegbar', {
      fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.BLUE_1),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.pointsText);

    objects.push(
      this.scene.add.rectangle(CX, UPGRADE_AREA_Y, UPGRADE_AREA_W, UPGRADE_AREA_H, COLORS.GREY_8, 0.55)
        .setStrokeStyle(1, COLORS.GREY_5)
        .setScrollFactor(0),
    );

    objects.push(
      this.scene.add.text(CX, UPGRADE_AREA_TOP + 22, 'Upgrade-Flaeche', {
        fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_3),
      }).setOrigin(0.5, 0).setScrollFactor(0),
    );

    this.hpBlock = this.scene.add.rectangle(UPGRADE_BLOCK_X, UPGRADE_BLOCK_Y, UPGRADE_BLOCK_W, UPGRADE_BLOCK_H, COLORS.BLUE_5, 0.22)
      .setStrokeStyle(2, COLORS.BLUE_3)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handleHpUpgradePointerDown(pointer))
      .on('pointerover', () => {
        if (this.hpBlock?.input?.enabled) this.hpBlock.setAlpha(0.82);
      })
      .on('pointerout', () => this.hpBlock?.setAlpha(1))
      .setScrollFactor(0);
    objects.push(this.hpBlock);

    this.hpBlockTitleText = this.scene.add.text(UPGRADE_BLOCK_X, UPGRADE_BLOCK_Y - 48, 'HP Upgrade', {
      fontSize: '24px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GOLD_1),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.hpBlockTitleText);

    this.hpStatusText = this.scene.add.text(UPGRADE_BLOCK_X, UPGRADE_BLOCK_Y - 10, 'Stufe 0 / 3', {
      fontSize: '19px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_2),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.hpStatusText);

    this.hpInstructionText = this.scene.add.text(UPGRADE_BLOCK_X, UPGRADE_BLOCK_Y + 34, 'Linksklick: skillen\nRechtsklick: zuruecknehmen', {
      fontSize: '15px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_3), align: 'center',
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.hpInstructionText);

    this.futureUpgradesHintText = this.scene.add.text(CX + 136, UPGRADE_AREA_Y + 8, 'Hier bleibt absichtlich viel Platz fuer weitere Upgrades.\nDie Mitte des Overlays ist bereits auf mehrere Karten vorbereitet.', {
      fontSize: '18px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4), align: 'center', wordWrap: { width: 430 },
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.futureUpgradesHintText);

    objects.push(
      this.scene.add.text(CX, FOOTER_Y, '[ ESC / Klick ausserhalb zum Schliessen | Linksklick skillt | Rechtsklick nimmt zurueck ]', {
        fontSize: '13px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    this.container = this.scene.add.container(0, 0, objects)
      .setDepth(DEPTH.OVERLAY + 1);
    this.container.setVisible(false);

    this.refresh();
  }

  refresh(): void {
    if (
      !this.levelText
      || !this.xpText
      || !this.pointsText
      || !this.hpStatusText
      || !this.hpInstructionText
      || !this.hpBlock
      || !this.hpBlockTitleText
      || !this.futureUpgradesHintText
      || !this.progressFill
      || !this.progressLabelText
    ) {
      return;
    }

    const progress = this.getProgress();
    const levelXpSpan = Math.max(1, progress.nextLevelXp - progress.currentLevelStartXp);
    const canLevelUp = progress.hpUpgradeUnlocked
      && progress.availableUpgradePoints > 0
      && progress.hpUpgradeLevel < progress.hpUpgradeMaxLevel;
    const canLevelDown = progress.hpUpgradeLevel > 0;

    this.levelText.setText(`Level ${progress.level}`);
    this.xpText.setText(`${progress.totalXp} XP gesamt`);
    this.pointsText.setText(`${progress.availableUpgradePoints} Upgrade-Punkte verfuegbar`);
    this.hpStatusText.setText(`Stufe ${progress.hpUpgradeLevel} / ${progress.hpUpgradeMaxLevel}`);
    this.hpInstructionText.setText(
      progress.hpUpgradeLevel >= progress.hpUpgradeMaxLevel
        ? 'Rechtsklick nimmt Stufen zurueck'
        : canLevelDown
          ? 'Linksklick: skillen\nRechtsklick: zuruecknehmen'
          : 'Linksklick: skillen',
    );
    this.progressFill.setDisplaySize(Math.max(0.001, BAR_W * progress.levelProgressFraction), BAR_H);
    this.progressLabelText.setText(`${progress.xpIntoLevel} / ${levelXpSpan} XP bis zum naechsten Level`);

    this.hpBlock.setFillStyle(canLevelUp || canLevelDown ? COLORS.BLUE_5 : COLORS.GREY_6, canLevelUp || canLevelDown ? 0.22 : 0.16);
    this.hpBlock.setStrokeStyle(2, canLevelUp ? COLORS.BLUE_3 : canLevelDown ? COLORS.GOLD_3 : COLORS.GREY_5);
    this.hpBlock.setAlpha(1);
    if (canLevelUp || canLevelDown) this.hpBlock.setInteractive({ useHandCursor: true });
    else this.hpBlock.disableInteractive();
    this.hpBlockTitleText.setColor(toCssColor(canLevelUp || canLevelDown ? COLORS.GOLD_1 : COLORS.GREY_4));
  }

  show(): void {
    if (this.visible || !this.container) return;
    this.visible = true;
    this.refresh();

    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 150,
      ease: 'Sine.easeOut',
    });

    this.dismissDelay = this.scene.time.delayedCall(120, () => {
      this.dismissDelay = null;
      if (!this.visible) return;
      this.dimRect?.setInteractive().once('pointerdown', () => this.hide());
    });

    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') this.hide();
    };
    this.scene.input.keyboard?.on('keydown', this.keyHandler);
  }

  hide(): void {
    if (!this.visible || !this.container) return;
    this.visible = false;
    this.dismissDelay?.destroy();
    this.dismissDelay = null;
    this.dimRect?.disableInteractive().removeAllListeners();
    if (this.keyHandler) {
      this.scene.input.keyboard?.off('keydown', this.keyHandler);
      this.keyHandler = null;
    }

    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 100,
      ease: 'Sine.easeIn',
      onComplete: () => this.container?.setVisible(false),
    });
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  isOpen(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.dismissDelay?.destroy();
    if (this.keyHandler) {
      this.scene.input.keyboard?.off('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
  }

  private handleHpUpgradePointerDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.rightButtonDown()) this.onLevelDownHpUpgrade();
    else this.onLevelUpHpUpgrade();
    this.refresh();
  }
}