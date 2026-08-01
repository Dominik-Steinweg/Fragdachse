import * as Phaser from 'phaser';
import { COLORS, DEPTH, GAME_HEIGHT, GAME_WIDTH, toCssColor } from '../config';
import {
  getCoopDefenseItemRarityDefinition,
  getCoopDefenseItemSlotDefinition,
} from '../config/coopDefenseItems';
import type { CoopDefenseItem, CoopDefenseItemRewardAction } from '../types';
import {
  formatCoopDefenseItemValue,
  getCoopDefenseItemSalvageXp,
  getCoopDefenseItemStatLines,
  isCoopDefenseItemImprovement,
} from '../utils/coopDefenseItems';
import type { MatchItemRewardOption, MatchItemRewardPresentation } from './MatchResultsModel';
import {
  ensureCoopDefenseItemCellTexture,
  resolveCoopDefenseItemIconTexture,
} from './coopDefenseItemIcons';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { attachHoverEffect } from './uiHover';
import {
  ensureFlatPanelTexture,
  ensureGlossyButtonTexture,
  ensureModalPanelTexture,
  ensureTintedSectionTexture,
} from './uiTextures';

/**
 * Auswahl der Item-Belohnung nach einem Sieg.
 *
 * Bewusst ein eigener Layer statt einer Sektion im Ergebnis-Screen: die Entscheidung braucht Platz
 * fuer drei Karten mit Vergleich und im Zweifel eine Zerlege-Auswahl, und derselbe Layer wird aus
 * der Lobby wiederverwendet, wenn eine Belohnung noch offen ist. Er liegt deshalb ueber dem
 * Ergebnis-Layer und schliesst nie, ohne dass der Spieler es will – die Belohnung bleibt
 * andernfalls persistent offen.
 */

const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;

const PANEL_W = 1520;
const PANEL_H = 880;
const PANEL_TOP = CY - PANEL_H / 2;
const PANEL_BOTTOM = CY + PANEL_H / 2;

const TITLE_Y = PANEL_TOP + 62;
const SUBTITLE_Y = PANEL_TOP + 104;

const CARD_W = 440;
const CARD_H = 640;
const CARD_GAP = 40;
const CARD_TOP = PANEL_TOP + 150;
const CARD_CY = CARD_TOP + CARD_H / 2;
const CARDS_LEFT = CX - (CARD_W * 3 + CARD_GAP * 2) / 2;

const CARD_PAD = 22;
const CARD_ICON = 96;
const CARD_ICON_DY = -CARD_H / 2 + 24 + CARD_ICON / 2;
const CARD_TITLE_DY = CARD_ICON_DY + CARD_ICON / 2 + 26;
const CARD_META_DY = CARD_TITLE_DY + 30;
const CARD_DIVIDER_DY = CARD_META_DY + 26;
const CARD_STATS_DY = CARD_DIVIDER_DY + 22;
const CARD_LINE_H = 30;
const MAX_STAT_LINES = 3;
const CARD_COMPARE_DY = CARD_STATS_DY + MAX_STAT_LINES * CARD_LINE_H + 22;
const MAX_COMPARE_LINES = 5;
const CARD_HINT_DY = CARD_H / 2 - 96;
const CARD_BUTTON_DY = CARD_H / 2 - 46;

const CARD_BUTTON_W = CARD_W - CARD_PAD * 2;
const CARD_BUTTON_H = 46;
const CARD_BUTTON_GAP = 12;
const CARD_ACTION_W = (CARD_BUTTON_W - CARD_BUTTON_GAP) / 2;

const FOOTER_Y = PANEL_BOTTOM - 44;
const FOOTER_BUTTON_W = 300;
const FOOTER_BUTTON_H = 50;

const SALVAGE_ICON = 32;
const SALVAGE_ROW_W = PANEL_W - 240;
const SALVAGE_ROW_H = 46;
const SALVAGE_ROW_GAP = 8;
const SALVAGE_TOP = PANEL_TOP + 210;
const MAX_SALVAGE_ROWS = 11;

const PANEL_BG = COLORS.GREY_7;
const PANEL_ACCENT = COLORS.GOLD_1;

const TEX_PANEL = '_cdir_panel';
const TEX_FOOTER_BUTTON = '_cdir_footer';
const TEX_TAKE_BUTTON = '_cdir_take';
const TEX_EQUIP_BUTTON = '_cdir_equip';
const TEX_SALVAGE_ROW = '_cdir_salvage_row';
const TEX_SALVAGE_ROW_HOT = '_cdir_salvage_row_hot';

type RewardView = 'offers' | 'salvage';

interface RewardCard {
  readonly container: Phaser.GameObjects.Container;
  readonly frame: Phaser.GameObjects.Image;
  readonly iconFrame: Phaser.GameObjects.Image;
  readonly icon: Phaser.GameObjects.Image;
  readonly title: Phaser.GameObjects.Text;
  readonly meta: Phaser.GameObjects.Text;
  readonly divider: Phaser.GameObjects.Rectangle;
  readonly statLines: Phaser.GameObjects.Text[];
  readonly compareTitle: Phaser.GameObjects.Text;
  readonly compareLines: Phaser.GameObjects.Text[];
  readonly hint: Phaser.GameObjects.Text;
  readonly takeButton: Phaser.GameObjects.Image;
  readonly takeLabel: Phaser.GameObjects.Text;
  readonly equipButton: Phaser.GameObjects.Image;
  readonly equipLabel: Phaser.GameObjects.Text;
}

interface SalvageRow {
  readonly container: Phaser.GameObjects.Container;
  readonly frame: Phaser.GameObjects.Image;
  readonly icon: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
  readonly detail: Phaser.GameObjects.Text;
  readonly reward: Phaser.GameObjects.Text;
}

export class CoopDefenseItemRewardOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private title: Phaser.GameObjects.Text | null = null;
  private subtitle: Phaser.GameObjects.Text | null = null;
  private cards: RewardCard[] = [];
  private salvageRows: SalvageRow[] = [];
  private salvageTitle: Phaser.GameObjects.Text | null = null;
  private backButton: Phaser.GameObjects.Image | null = null;
  private backLabel: Phaser.GameObjects.Text | null = null;
  private footerButton: Phaser.GameObjects.Image | null = null;
  private footerLabel: Phaser.GameObjects.Text | null = null;

  private visible = false;
  private view: RewardView = 'offers';
  private presentation: MatchItemRewardPresentation | null = null;
  private salvageOption: MatchItemRewardOption | null = null;
  private salvageAction: CoopDefenseItemRewardAction = 'take';

  constructor(
    private readonly scene: Phaser.Scene,
    /** Uebernimmt ein Angebot; `action` entscheidet zwischen Stash und Ausruesten. */
    private readonly onClaim: (
      offerUid: string,
      salvageUid?: string,
      action?: CoopDefenseItemRewardAction,
    ) => boolean,
    /** Liefert den aktuellen Stand nach jeder Aenderung; `null` schliesst den Layer. */
    private readonly getPresentation: () => MatchItemRewardPresentation | null,
    private readonly onClosed: () => void,
  ) {}

  build(): void {
    this.destroy();
    const objects: Phaser.GameObjects.GameObject[] = [];

    // Der Hintergrund faengt Klicks ab, schliesst aber nicht: die Belohnung soll nie
    // versehentlich weggeklickt werden.
    objects.push(
      this.scene.add.rectangle(CX, CY, GAME_WIDTH, GAME_HEIGHT, COLORS.GREY_10, 0.82)
        .setScrollFactor(0)
        .setInteractive(),
    );
    const panel = this.scene.add.image(
      CX,
      CY,
      ensureModalPanelTexture(this.scene, TEX_PANEL, PANEL_W, PANEL_H, PANEL_BG, PANEL_ACCENT),
    ).setScrollFactor(0).setInteractive();
    objects.push(panel);

    this.title = this.scene.add.text(CX, TITLE_Y, 'BELOHNUNG', {
      fontFamily: 'monospace',
      fontSize: '42px',
      fontStyle: 'bold',
      color: toCssColor(COLORS.GOLD_1),
    }).setOrigin(0.5).setScrollFactor(0);
    this.subtitle = this.scene.add.text(CX, SUBTITLE_Y, '', {
      fontFamily: 'monospace',
      fontSize: '18px',
      fontStyle: 'bold',
      color: toCssColor(COLORS.GREY_4),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.title, this.subtitle);

    for (let index = 0; index < 3; index++) {
      const card = this.buildCard(CARDS_LEFT + CARD_W / 2 + index * (CARD_W + CARD_GAP), index);
      this.cards.push(card);
      objects.push(card.container);
    }

    this.salvageTitle = this.scene.add.text(CX, SALVAGE_TOP - 46, '', {
      fontFamily: 'monospace',
      fontSize: '20px',
      fontStyle: 'bold',
      color: toCssColor(COLORS.GREY_2),
    }).setOrigin(0.5).setScrollFactor(0).setVisible(false);
    objects.push(this.salvageTitle);

    for (let index = 0; index < MAX_SALVAGE_ROWS; index++) {
      const row = this.buildSalvageRow(SALVAGE_TOP + index * (SALVAGE_ROW_H + SALVAGE_ROW_GAP), index);
      this.salvageRows.push(row);
      objects.push(row.container);
    }

    this.backButton = this.scene.add.image(
      CX - PANEL_W / 2 + 40 + FOOTER_BUTTON_W / 2,
      FOOTER_Y,
      ensureGlossyButtonTexture(this.scene, TEX_FOOTER_BUTTON, FOOTER_BUTTON_W, FOOTER_BUTTON_H, COLORS.GREY_6),
    ).setScrollFactor(0).setInteractive({ useHandCursor: true }).setVisible(false);
    this.backLabel = this.scene.add.text(this.backButton.x, FOOTER_Y, 'ZURUECK', {
      fontFamily: 'monospace',
      fontSize: '18px',
      fontStyle: 'bold',
      color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0.5).setScrollFactor(0).setVisible(false);
    this.backButton.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      this.showOffers();
    });
    attachHoverEffect(this.scene, this.backButton, this.backLabel);
    objects.push(this.backButton, this.backLabel);

    this.footerButton = this.scene.add.image(
      CX + PANEL_W / 2 - 40 - FOOTER_BUTTON_W / 2,
      FOOTER_Y,
      ensureGlossyButtonTexture(this.scene, TEX_FOOTER_BUTTON, FOOTER_BUTTON_W, FOOTER_BUTTON_H, COLORS.GREY_6),
    ).setScrollFactor(0).setInteractive({ useHandCursor: true });
    this.footerLabel = this.scene.add.text(this.footerButton.x, FOOTER_Y, 'SPAETER ENTSCHEIDEN', {
      fontFamily: 'monospace',
      fontSize: '17px',
      fontStyle: 'bold',
      color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0.5).setScrollFactor(0);
    this.footerButton.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      this.hide();
      this.onClosed();
    });
    attachHoverEffect(this.scene, this.footerButton, this.footerLabel);
    objects.push(this.footerButton, this.footerLabel);

    this.container = this.scene.add.container(0, 0, objects)
      .setDepth(DEPTH.OVERLAY + 5)
      .setVisible(false);
    promoteToClarityCamera(this.scene, this.container);
  }

  show(presentation: MatchItemRewardPresentation): void {
    if (!this.container) this.build();
    this.presentation = presentation;
    this.visible = true;
    this.container!.setVisible(true);
    this.showOffers();
  }

  isVisible(): boolean {
    return this.visible;
  }

  hide(): void {
    this.visible = false;
    this.presentation = null;
    this.salvageOption = null;
    this.salvageAction = 'take';
    this.container?.setVisible(false);
  }

  destroy(): void {
    this.container?.destroy(true);
    this.container = null;
    this.title = null;
    this.subtitle = null;
    this.cards = [];
    this.salvageRows = [];
    this.salvageTitle = null;
    this.backButton = null;
    this.backLabel = null;
    this.footerButton = null;
    this.footerLabel = null;
    this.visible = false;
    this.presentation = null;
    this.salvageOption = null;
  }

  // ── Aufbau ────────────────────────────────────────────────────────────────

  private buildCard(centerX: number, index: number): RewardCard {
    const frame = this.scene.add.image(
      0,
      0,
      ensureTintedSectionTexture(this.scene, `_cdir_card_${index}`, CARD_W, CARD_H, COLORS.BLUE_4, COLORS.GREY_9),
    ).setScrollFactor(0);

    const iconFrame = this.scene.add.image(0, CARD_ICON_DY, ensureCoopDefenseItemCellTexture(
      this.scene, CARD_ICON, CARD_ICON, COLORS.GREY_6, 'rest',
    )).setScrollFactor(0);
    const icon = this.scene.add.image(0, CARD_ICON_DY, resolveCoopDefenseItemIconTexture(
      this.scene, 'armor', CARD_ICON,
    )).setDisplaySize(CARD_ICON * 0.7, CARD_ICON * 0.7).setScrollFactor(0);

    const title = this.scene.add.text(0, CARD_TITLE_DY, '', {
      fontFamily: 'monospace', fontSize: '24px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0.5).setScrollFactor(0);
    const meta = this.scene.add.text(0, CARD_META_DY, '', {
      fontFamily: 'monospace', fontSize: '15px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_4),
    }).setOrigin(0.5).setScrollFactor(0);
    const divider = this.scene.add.rectangle(0, CARD_DIVIDER_DY, CARD_W - CARD_PAD * 2, 1, COLORS.GREY_5, 0.55)
      .setScrollFactor(0);

    const statLines: Phaser.GameObjects.Text[] = [];
    for (let line = 0; line < MAX_STAT_LINES; line++) {
      statLines.push(this.scene.add.text(-CARD_W / 2 + CARD_PAD, CARD_STATS_DY + line * CARD_LINE_H, '', {
        fontFamily: 'monospace', fontSize: '17px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_2),
        wordWrap: { width: CARD_W - CARD_PAD * 2 },
      }).setOrigin(0, 0.5).setScrollFactor(0));
    }

    const compareTitle = this.scene.add.text(-CARD_W / 2 + CARD_PAD, CARD_COMPARE_DY, '', {
      fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_4),
    }).setOrigin(0, 0.5).setScrollFactor(0);

    const compareLines: Phaser.GameObjects.Text[] = [];
    for (let line = 0; line < MAX_COMPARE_LINES; line++) {
      compareLines.push(this.scene.add.text(
        -CARD_W / 2 + CARD_PAD,
        CARD_COMPARE_DY + 24 + line * 24,
        '',
        { fontFamily: 'monospace', fontSize: '15px', color: toCssColor(COLORS.GREY_3) },
      ).setOrigin(0, 0.5).setScrollFactor(0));
    }

    const hint = this.scene.add.text(0, CARD_HINT_DY, '', {
      fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: toCssColor(COLORS.GOLD_2),
    }).setOrigin(0.5).setScrollFactor(0);

    const takeButton = this.scene.add.image(
      -(CARD_ACTION_W + CARD_BUTTON_GAP) / 2,
      CARD_BUTTON_DY,
      ensureGlossyButtonTexture(this.scene, TEX_TAKE_BUTTON, CARD_ACTION_W, CARD_BUTTON_H, COLORS.BLUE_3),
    ).setScrollFactor(0).setInteractive({ useHandCursor: true });
    const takeLabel = this.scene.add.text(
      takeButton.x,
      CARD_BUTTON_DY,
      'NEHMEN',
      {
        fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_10),
      },
    ).setOrigin(0.5).setScrollFactor(0);
    takeButton.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      // Ohne stopPropagation faengt die darunterliegende Ergebnis-Flaeche den Klick ab.
      event?.stopPropagation();
      this.handleTake(index);
    });
    attachHoverEffect(this.scene, takeButton, takeLabel);

    const equipButton = this.scene.add.image(
      (CARD_ACTION_W + CARD_BUTTON_GAP) / 2,
      CARD_BUTTON_DY,
      ensureGlossyButtonTexture(this.scene, TEX_EQUIP_BUTTON, CARD_ACTION_W, CARD_BUTTON_H, COLORS.GOLD_3),
    ).setScrollFactor(0).setInteractive({ useHandCursor: true });
    const equipLabel = this.scene.add.text(equipButton.x, CARD_BUTTON_DY, 'AUSRUESTEN', {
      fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_10),
    }).setOrigin(0.5).setScrollFactor(0);
    equipButton.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      this.handleEquip(index);
    });
    attachHoverEffect(this.scene, equipButton, equipLabel);

    const container = this.scene.add.container(centerX, CARD_CY, [
      frame, iconFrame, icon, title, meta, divider,
      ...statLines, compareTitle, ...compareLines, hint,
      takeButton, takeLabel, equipButton, equipLabel,
    ]).setScrollFactor(0);

    return {
      container, frame, iconFrame, icon, title, meta, divider,
      statLines, compareTitle, compareLines, hint,
      takeButton, takeLabel, equipButton, equipLabel,
    };
  }

  private buildSalvageRow(centerY: number, index: number): SalvageRow {
    const frame = this.scene.add.image(
      0,
      0,
      ensureFlatPanelTexture(this.scene, TEX_SALVAGE_ROW, SALVAGE_ROW_W, SALVAGE_ROW_H, COLORS.GREY_8, COLORS.GREY_5),
    ).setScrollFactor(0).setInteractive({ useHandCursor: true });
    const icon = this.scene.add.image(-SALVAGE_ROW_W / 2 + 18 + SALVAGE_ICON / 2, 0, resolveCoopDefenseItemIconTexture(
      this.scene, 'armor', SALVAGE_ICON,
    )).setDisplaySize(SALVAGE_ICON, SALVAGE_ICON).setScrollFactor(0);
    const label = this.scene.add.text(-SALVAGE_ROW_W / 2 + 26 + SALVAGE_ICON, 0, '', {
      fontFamily: 'monospace', fontSize: '17px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_2),
    }).setOrigin(0, 0.5).setScrollFactor(0);
    const detail = this.scene.add.text(-SALVAGE_ROW_W / 2 + 260, 0, '', {
      fontFamily: 'monospace', fontSize: '15px', color: toCssColor(COLORS.GREY_3),
    }).setOrigin(0, 0.5).setScrollFactor(0);
    const reward = this.scene.add.text(SALVAGE_ROW_W / 2 - 18, 0, '', {
      fontFamily: 'monospace', fontSize: '15px', fontStyle: 'bold', color: toCssColor(COLORS.GOLD_2),
    }).setOrigin(1, 0.5).setScrollFactor(0);

    // Linksbuendige Zeilen skalieren beim Hover unschoen; stattdessen die Fuellung aufhellen.
    frame.on('pointerover', () => frame.setTexture(ensureFlatPanelTexture(
      this.scene, TEX_SALVAGE_ROW_HOT, SALVAGE_ROW_W, SALVAGE_ROW_H, COLORS.GREY_6, COLORS.GOLD_2,
    )));
    frame.on('pointerout', () => frame.setTexture(ensureFlatPanelTexture(
      this.scene, TEX_SALVAGE_ROW, SALVAGE_ROW_W, SALVAGE_ROW_H, COLORS.GREY_8, COLORS.GREY_5,
    )));
    frame.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      this.handleSalvageChoice(index);
    });

    const container = this.scene.add.container(CX, centerY, [frame, icon, label, detail, reward])
      .setScrollFactor(0)
      .setVisible(false);
    return { container, frame, icon, label, detail, reward };
  }

  // ── Ansichten ─────────────────────────────────────────────────────────────

  private showOffers(): void {
    this.view = 'offers';
    this.salvageOption = null;
    this.salvageAction = 'take';
    const options = this.presentation?.options ?? [];

    this.title?.setText('BELOHNUNG').setVisible(true);
    this.subtitle?.setText('Waehle genau ein Teil. Es wandert dauerhaft in dein Inventar.').setVisible(true);
    this.salvageTitle?.setVisible(false);
    for (const row of this.salvageRows) row.container.setVisible(false);
    this.backButton?.setVisible(false);
    this.backLabel?.setVisible(false);
    this.footerLabel?.setText('SPAETER ENTSCHEIDEN');

    this.cards.forEach((card, index) => {
      const option = options[index];
      card.container.setVisible(!!option);
      if (option) this.renderCard(card, option);
    });
  }

  private renderCard(card: RewardCard, option: MatchItemRewardOption): void {
    const rarity = getCoopDefenseItemRarityDefinition(option.item.rarity);
    const lines = getCoopDefenseItemStatLines(option.item);

    card.frame.setTexture(ensureTintedSectionTexture(
      this.scene,
      `_cdir_card_${option.item.rarity}`,
      CARD_W,
      CARD_H,
      rarity.color,
      COLORS.GREY_9,
    ));
    card.iconFrame.setTexture(ensureCoopDefenseItemCellTexture(
      this.scene, CARD_ICON, CARD_ICON, rarity.color, 'rest',
    ));
    card.icon.setTexture(resolveCoopDefenseItemIconTexture(this.scene, option.item.slot, CARD_ICON))
      .setDisplaySize(CARD_ICON * 0.7, CARD_ICON * 0.7);
    card.title.setText(this.describeSlot(option.item)).setColor(toCssColor(rarity.color));
    card.meta.setText(`${rarity.label}  •  Stufe ${option.item.itemLevel}`);

    card.statLines.forEach((text, index) => {
      const line = lines[index];
      text.setVisible(!!line);
      if (!line) return;
      text.setText(`${formatCoopDefenseItemValue(line.value, line.displayAsPercent)}  ${line.label}`);
      text.setColor(toCssColor(line.isBaseStat ? COLORS.GREY_1 : rarity.color));
    });

    card.compareTitle.setText(option.equipped ? 'GEGENUEBER AUSGERUESTET' : 'SLOT IST LEER');
    const changes = option.comparison.filter((row) => row.delta !== 0);
    card.compareLines.forEach((text, index) => {
      const row = changes[index];
      text.setVisible(!!row);
      if (!row) return;
      text.setText(`${formatCoopDefenseItemValue(row.delta, row.displayAsPercent)}  ${row.label}`);
      text.setColor(toCssColor(
        isCoopDefenseItemImprovement(row.stat, row.delta) ? COLORS.GREEN_2 : COLORS.RED_2,
      ));
    });

    const full = !option.directEquip && option.freeStashSlots <= 0;
    card.hint.setText(full
      ? 'Kategorie voll – waehle ein Teil zum Zerlegen'
      : option.directEquip
        ? 'Slot leer – wird direkt ausgeruestet'
      : `${option.freeStashSlots} Platz${option.freeStashSlots === 1 ? '' : 'e'} frei`);
    card.hint.setColor(toCssColor(full ? COLORS.RED_2 : COLORS.GREY_4));
    const hasEquippedItem = !option.directEquip;
    const actionOffset = (CARD_ACTION_W + CARD_BUTTON_GAP) / 2;
    card.takeButton
      .setVisible(hasEquippedItem)
      .setPosition(-actionOffset, CARD_BUTTON_DY)
      .setDisplaySize(CARD_ACTION_W, CARD_BUTTON_H);
    card.takeLabel
      .setVisible(hasEquippedItem)
      .setPosition(-actionOffset, CARD_BUTTON_DY)
      .setText('NEHMEN');
    card.equipButton
      .setVisible(true)
      .setPosition(hasEquippedItem ? actionOffset : 0, CARD_BUTTON_DY)
      .setDisplaySize(hasEquippedItem ? CARD_ACTION_W : CARD_BUTTON_W, CARD_BUTTON_H);
    card.equipLabel
      .setVisible(true)
      .setPosition(hasEquippedItem ? actionOffset : 0, CARD_BUTTON_DY)
      .setText('AUSRUESTEN');
  }

  private showSalvage(option: MatchItemRewardOption, action: CoopDefenseItemRewardAction): void {
    this.view = 'salvage';
    this.salvageOption = option;
    this.salvageAction = action;

    this.title?.setText('KATEGORIE VOLL');
    this.subtitle?.setText(
      action === 'equip'
        ? `${this.describeSlot(option.item)}: Das bisher getragene Teil wandert ins Inventar. `
          + 'Waehle vorher ein ungetragenes Teil zum Zerlegen.'
        : `${this.describeSlot(option.item)}: waehle, was zerlegt wird. Die XP fliessen in dein Level.`,
    );
    for (const card of this.cards) card.container.setVisible(false);
    this.salvageTitle?.setText('ZERLEGEN').setVisible(true);
    this.backButton?.setVisible(true);
    this.backLabel?.setVisible(true);
    this.footerLabel?.setText('SPAETER ENTSCHEIDEN');

    // Erste Zeile ist immer das Angebot selbst: so ist "gar nichts behalten" ein klarer Klick
    // und keine versteckte Option.
    const entries: { item: CoopDefenseItem; isOffer: boolean }[] = [
      { item: option.item, isOffer: true },
      ...option.stash.map((item) => ({ item, isOffer: false })),
    ];

    this.salvageRows.forEach((row, index) => {
      const entry = entries[index];
      row.container.setVisible(!!entry);
      if (!entry) return;
      const rarity = getCoopDefenseItemRarityDefinition(entry.item.rarity);
      row.icon
        .setTexture(resolveCoopDefenseItemIconTexture(this.scene, entry.item.slot, SALVAGE_ICON))
        .setDisplaySize(SALVAGE_ICON, SALVAGE_ICON)
        .setAlpha(entry.isOffer ? 0.5 : 1);
      row.label.setText(entry.isOffer ? 'Neues Teil verwerfen' : this.describeSlot(entry.item));
      row.label.setColor(toCssColor(entry.isOffer ? COLORS.GREY_4 : rarity.color));
      row.detail.setText(`${rarity.label}  •  Stufe ${entry.item.itemLevel}  •  ${this.describeItemLines(entry.item)}`);
      row.reward.setText(`+${getCoopDefenseItemSalvageXp(entry.item)} XP`);
    });
  }

  // ── Aktionen ──────────────────────────────────────────────────────────────

  private handleTake(cardIndex: number): void {
    const option = this.presentation?.options[cardIndex];
    if (!option || this.view !== 'offers') return;
    if (!option.directEquip && option.freeStashSlots <= 0) {
      this.showSalvage(option, 'take');
      return;
    }
    this.applyClaim(option.item.uid, undefined, 'take');
  }

  private handleEquip(cardIndex: number): void {
    const option = this.presentation?.options[cardIndex];
    if (!option || this.view !== 'offers') return;
    if (option.directEquip) {
      this.applyClaim(option.item.uid, undefined, 'equip');
      return;
    }
    if (option.freeStashSlots <= 0) {
      this.showSalvage(option, 'equip');
      return;
    }
    this.applyClaim(option.item.uid, undefined, 'equip');
  }

  private handleSalvageChoice(rowIndex: number): void {
    const option = this.salvageOption;
    if (!option || this.view !== 'salvage') return;
    const salvageUid = rowIndex === 0 ? option.item.uid : option.stash[rowIndex - 1]?.uid;
    if (!salvageUid) return;
    // Beim Ausruesten kann das Angebot selbst nur verworfen werden; ein vorhandenes
    // ungetragenes Teil macht dagegen Platz fuer das bisher ausgeruestete Item.
    const action = rowIndex === 0 ? 'take' : this.salvageAction;
    this.applyClaim(option.item.uid, salvageUid, action);
  }

  private applyClaim(
    offerUid: string,
    salvageUid?: string,
    action: CoopDefenseItemRewardAction = 'take',
  ): void {
    if (!this.onClaim(offerUid, salvageUid, action)) return;
    const next = this.getPresentation();
    if (!next) {
      this.hide();
      this.onClosed();
      return;
    }
    this.presentation = next;
    this.showOffers();
  }

  // ── Darstellungshilfen ────────────────────────────────────────────────────

  private describeSlot(item: CoopDefenseItem): string {
    return getCoopDefenseItemSlotDefinition(item.slot).label;
  }

  private describeItemLines(item: CoopDefenseItem): string {
    return getCoopDefenseItemStatLines(item)
      .map((line) => `${formatCoopDefenseItemValue(line.value, line.displayAsPercent)} ${line.label}`)
      .join(', ');
  }
}
