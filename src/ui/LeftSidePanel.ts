/**
 * LeftSidePanel – linker Seitenbereich für Lobby- und Arena-Phase.
 *
 * lobbyContainer (y=0):      Namensanzeige, Farbauswahl
 * gameContainer  (y=−H):     ArenaHUD (initial off-screen oben)
 *
 * Reusability-Template: gleiche Public-API wie RightSidePanel.
 */
import * as Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import { GameAudioSystem } from '../audio/GameAudioSystem';
import { ArenaHUD } from './ArenaHUD';
import { configureArenaHudLayout } from './ArenaHUD';
import type { ArenaHUDData } from './ArenaHUD';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  DEFAULT_ARENA_OFFSET_X,
  DEPTH,
  COLORS,
  PLAYER_COLORS,
  LOBBY_SIDE_MENU_EXTRA_HEIGHT,
  LOBBY_SIDE_MENU_WIDTH,
  toCssColor,
} from '../config';
import { HelpOverlay } from './HelpOverlay';
import { OptionsOverlay, type AbortMatchBinding } from './OptionsOverlay';
import type { GraphicsQualityController } from '../graphics/GraphicsQuality';
import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS, getAvailableUltimateConfigs, DEFAULT_LOADOUT } from '../loadout/LoadoutConfig';
import { LivingBarEffect, paletteFromColor, createGradientTexture, ensureLivingBarTextures } from './LivingBarEffect';
import { ensureGlossyButtonTexture } from './uiTextures';
import { attachHoverEffect } from './uiHover';
import { getOverlayRoot } from './fullscreen';
import { BadgerPreview } from './BadgerPreview';
import type { GameMode, LoadoutSlot, TeamId } from '../types';
import { getGameModeLabel, hasTeamSelection, isCoopDefenseMode, usesTeamColors } from '../gameModes';
import { getCoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { clampPlayerNameInput, PLAYER_NAME_MAX_LENGTH, sanitizePlayerName } from '../utils/playerName';
import { getStoredCoopDefenseUpgradeProfile, getStoredHighestUnlockedCoopDefenseMapId, getStoredLoadoutSlot, getStoredPlayerName, setStoredLoadoutSlot, setStoredPlayerName } from '../utils/localPreferences';
import { getUnlockedCoopDefenseMapConfigs } from '../config/coopDefenseMapUnlocks';
import { isCoopDefenseLoadoutItemSelectable } from '../utils/coopDefenseUpgrades';

// ── Layout-Konstanten (innerhalb des linken Sidebars) ────────────────────────
const LOBBY_PANEL_W = LOBBY_SIDE_MENU_WIDTH;
const ARENA_PANEL_W = Math.round(DEFAULT_ARENA_OFFSET_X * 1.5);
const CENTER_X     = LOBBY_PANEL_W / 2;
const ARENA_CENTER_X = ARENA_PANEL_W / 2;
const LOBBY_CONTROL_COLOR = COLORS.GREY_7;
const LOBBY_CONTROL_STROKE = COLORS.GREY_5;
const LOBBY_CONTROL_TEXT = toCssColor(COLORS.GREY_2);
const LOBBY_TOP_OFFSET_Y = 246;
const UPPER_INFO_SPACING_STEP = LOBBY_SIDE_MENU_EXTRA_HEIGHT / 8;
const NAME_LABEL_Y = 60 + LOBBY_TOP_OFFSET_Y;
const NAME_VALUE_Y = 80 + LOBBY_TOP_OFFSET_Y;
const EDIT_BTN_Y   = 114 + LOBBY_TOP_OFFSET_Y + UPPER_INFO_SPACING_STEP;
const MODE_LABEL_Y = 162 + LOBBY_TOP_OFFSET_Y + UPPER_INFO_SPACING_STEP * 2;
const MODE_ROW_Y   = 180 + LOBBY_TOP_OFFSET_Y + UPPER_INFO_SPACING_STEP * 3;
const MAP_LABEL_Y  = 204 + LOBBY_TOP_OFFSET_Y + UPPER_INFO_SPACING_STEP * 4;
const MAP_ROW_Y    = 222 + LOBBY_TOP_OFFSET_Y + UPPER_INFO_SPACING_STEP * 5;
const DIVIDER1_Y   = 248 + LOBBY_TOP_OFFSET_Y + UPPER_INFO_SPACING_STEP * 6;
const BADGER_Y     = 294 + LOBBY_TOP_OFFSET_Y + UPPER_INFO_SPACING_STEP * 7;
const BADGER_SIZE        = 48;   // Anzeigegröße
const BADGER_CLICK_SIZE  = 56;   // Klickbare Fläche
const DIVIDER2_Y         = BADGER_Y + BADGER_SIZE / 2 + 14;
const CONTROL_BUTTON_DY  = 8;
const NAME_COLOR_BUTTON_W = 128;
const NAME_COLOR_BUTTON_H = 28;
const NAME_COLOR_BUTTON_GAP = 8;
const NAME_BUTTON_X      = CENTER_X - (NAME_COLOR_BUTTON_W / 2 + NAME_COLOR_BUTTON_GAP / 2);
const COLOR_BUTTON_X     = CENTER_X + (NAME_COLOR_BUTTON_W / 2 + NAME_COLOR_BUTTON_GAP / 2);
const NAME_COLOR_ROW_Y   = EDIT_BTN_Y + CONTROL_BUTTON_DY;
const NAME_MODE_DIVIDER_Y = NAME_COLOR_ROW_Y + NAME_COLOR_BUTTON_H / 2 + 12;
const CONTROL_LABEL_OFFSET_Y = 1.5;
const ARROW_BUTTON_W     = 24;
const ARROW_BUTTON_H     = 24;
const TEAM_SELECT_ARROW_OFFSET_X = NAME_COLOR_BUTTON_W / 2 - ARROW_BUTTON_W / 2;

// Color-Picker-Popup (world-Koordinaten, separater Container)
const PICKER_W        = 188;
const PICKER_H        = 148;
const PICKER_WORLD_X  = (LOBBY_PANEL_W - PICKER_W) / 2;
const PICKER_WORLD_Y  = NAME_COLOR_ROW_Y + NAME_COLOR_BUTTON_H / 2 + 10;
const PICKER_PADDING  = 10;
const SWATCH_SIZE     = 32;
const SWATCH_GAP      = 4;
const PICKER_COLS     = 4;
const PICKER_GRID_Y   = 30;   // Y-Start des Gitters innerhalb des Popups
const TEX_SWATCH_PREFIX = '__picker_swatch_';

const LABEL_FONT = { fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_2) };
const NAME_FONT  = { fontSize: '26px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1), fontStyle: 'bold' as const };

// ── Loadout-Karussell-Konstanten ──────────────────────────────────────────────
const CAROUSEL_START_Y  = DIVIDER2_Y + 18;
const CAROUSEL_ROW_STEP = 46;    // Abstand zwischen Slot-Gruppen (Pfeile + Label unten)
const CAROUSEL_GROUP_DY = 28;    // Offset erste Karussell-Zeile unter "Loadout:"
const CAROUSEL_LABEL_DY = 20;    // Slot-Label-Offset UNTER den Pfeilen

// ── Hilfe-Button unter Loadout ────────────────────────────────────────────────
const DIVIDER3_Y  = CAROUSEL_START_Y + CAROUSEL_GROUP_DY + 3 * CAROUSEL_ROW_STEP + CAROUSEL_LABEL_DY + 28;
const MENU_BTN_Y  = DIVIDER3_Y + 30;
const MENU_BTN_W  = 92;
const MENU_BTN_H  = 34;
const OPTIONS_BTN_X = CENTER_X - 50;
const HELP_BTN_X = CENTER_X + 50;
const ARROW_X_LEFT      = 20;
const ARROW_X_RIGHT     = LOBBY_PANEL_W - 20;
const ITEM_NAME_X       = CENTER_X;

const MODE_OPTIONS: readonly GameMode[] = ['deathmatch', 'team_deathmatch', 'capture_the_beer', 'coop_defense'];
const TEAM_OPTIONS: readonly TeamId[] = ['blue', 'red'];

function getTeamLabel(teamId: TeamId | null): string {
  if (teamId === 'blue') return 'Team Blau';
  if (teamId === 'red') return 'Team Rot';
  return 'Team waehlen';
}

type LoadoutCarouselItem = {
  id: string;
  displayName: string;
};

type CompactLabel = Phaser.GameObjects.Text | Phaser.GameObjects.Graphics;

type CompactButton = {
  button: Phaser.GameObjects.Image;
  label: CompactLabel;
  text?: Phaser.GameObjects.Text;
};

// Item-Arrays nach Slot gefiltert
const STATIC_SLOT_ITEMS: Record<Exclude<LoadoutSlot, 'ultimate'>, LoadoutCarouselItem[]> = {
  weapon1:  Object.values(WEAPON_CONFIGS).filter(w => (w.allowedSlots as readonly string[]).includes('weapon1')),
  weapon2:  Object.values(WEAPON_CONFIGS).filter(w => (w.allowedSlots as readonly string[]).includes('weapon2')),
  utility:  Object.values(UTILITY_CONFIGS).filter(u => (u.allowedSlots as readonly string[]).includes('utility')),
};

const SLOT_LABELS: Record<LoadoutSlot, string> = {
  weapon1:  'Waffe 1',
  weapon2:  'Waffe 2',
  utility:  'Utility',
  ultimate: 'Ultimate',
};

// ── Swatch-Eintrag im Picker ──────────────────────────────────────────────────
interface SwatchEntry {
  bg:     Phaser.GameObjects.Rectangle;
  img:    Phaser.GameObjects.Image;
  effect: LivingBarEffect;
  color:  number;
}

// ── Power-Up-Container (center-bottom, nicht animiert) ─────────────────────
// x=840 → Balken (BAR_X=14, BAR_W=212) erscheinen zentriert auf x=960
// y wird dynamisch von ArenaHUD gesetzt (abhängig von Anzahl aktiver Power-Ups)
const PU_CONTAINER_X = GAME_WIDTH / 2 - 120; // 840

export class LeftSidePanel {
  private lobbyContainer!: Phaser.GameObjects.Container;
  private gameContainer!:  Phaser.GameObjects.Container;
  private puContainer!:    Phaser.GameObjects.Container;
  private arenaHUD!:       ArenaHUD;
  private arenaOverlayVisible = false;
  private localNameText!:  Phaser.GameObjects.Text;
  private editBtn:         Phaser.GameObjects.Image | null = null;
  private editBtnLabel:    Phaser.GameObjects.Text | null = null;
  private modeNameText:    Phaser.GameObjects.Text | null = null;
  private modeArrowButtons: { left: CompactButton; right: CompactButton } | null = null;
  private mapLabelText:    Phaser.GameObjects.Text | null = null;
  private mapNameText:     Phaser.GameObjects.Text | null = null;
  private mapArrowButtons: { left: CompactButton; right: CompactButton } | null = null;
  private colorEditBtn:   Phaser.GameObjects.Image | null = null;
  private colorEditText:   Phaser.GameObjects.Text | null = null;
  private teamArrowButtons: { left: CompactButton; right: CompactButton } | null = null;
  private nameEditEnabled  = true;
  private nameEditOpen     = false;
  private nameEditPopup:   HTMLDivElement | null = null;
  private closeNameEditPopupFn: (() => void) | null = null;
  private pendingDelay:    Phaser.Time.TimerEvent | null = null;

  // Dachs-Vorschau als Farbindikator
  private badgerPreview: BadgerPreview | null = null;
  private badgerClickZone!: Phaser.GameObjects.Rectangle;

  // Picker-Popup (eigener world-space-Container, depth OVERLAY+2)
  private pickerContainer!: Phaser.GameObjects.Container;
  private pickerSwatches:   SwatchEntry[] = [];
  private pickerOpen        = false;
  private requestPending    = false;
  private pickerDismissDelay: Phaser.Time.TimerEvent | null = null;
  private pickerDismissHandler: (() => void) | null = null;

  // Loadout-Karussell
  private loadoutIndices:   Record<LoadoutSlot, number> = { weapon1: 0, weapon2: 0, utility: 0, ultimate: 0 };
  private loadoutNameTexts: Partial<Record<LoadoutSlot, Phaser.GameObjects.Text>> = {};
  private loadoutArrowButtons: Partial<Record<LoadoutSlot, { left: CompactButton; right: CompactButton }>> = {};
  private loadoutEnabled    = true;
  private lobbyFieldsLocked = false;
  private helpOverlay:      HelpOverlay | null = null;
  private optionsOverlay:   OptionsOverlay | null = null;
  // Wird vor dem Bau gesetzt, wenn der Lifecycle-Koordinator frueher fertig ist als das Panel.
  private abortMatchBinding: AbortMatchBinding | null = null;

  constructor(
    private scene:  Phaser.Scene,
    private bridge: NetworkBridge,
    private audioSystem: GameAudioSystem,
    private graphicsQuality: GraphicsQualityController,
  ) {}

  // ── Aufbau ─────────────────────────────────────────────────────────────────

  build(): void {
    // ── gameContainer (ArenaHUD, initial off-screen oben) ─────────────────────
    this.gameContainer = this.scene.add.container(0, -GAME_HEIGHT);
    this.gameContainer.setDepth(DEPTH.OVERLAY - 1);
    this.gameContainer.add(
      this.scene.add.rectangle(ARENA_CENTER_X, GAME_HEIGHT / 2, ARENA_PANEL_W, GAME_HEIGHT, 0x000000, 0.18)
        .setScrollFactor(0),
    );

    // Power-Up-Container: feste Position mittig unten, unabhängig vom Tween
    this.puContainer = this.scene.add.container(PU_CONTAINER_X, 0);
    this.puContainer.setDepth(DEPTH.OVERLAY - 1);
    this.puContainer.setVisible(false);

    configureArenaHudLayout(ARENA_PANEL_W);
    this.arenaHUD = new ArenaHUD(this.scene, this.gameContainer, this.puContainer);

    // ── lobbyContainer (Namens- und Farbsektion, initial on-screen) ───────────
    const objects: Phaser.GameObjects.GameObject[] = [];

    objects.push(
      this.scene.add.text(CENTER_X, NAME_LABEL_Y, 'Dein Name:', LABEL_FONT)
        .setOrigin(0.5, 0)
        .setScrollFactor(0),
    );

    this.localNameText = this.scene.add.text(CENTER_X, NAME_VALUE_Y, '', NAME_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    objects.push(this.localNameText);

    const editControl = this.createCompactButton(
      NAME_BUTTON_X,
      NAME_COLOR_ROW_Y,
      'NAME \u00c4NDERN',
      NAME_COLOR_BUTTON_W,
      NAME_COLOR_BUTTON_H,
      () => this.openNameEdit(),
    );
    this.editBtn = editControl.button;
    this.editBtnLabel = editControl.text ?? null;
    objects.push(editControl.button, editControl.label);

    const colorEditBtn = this.createCompactButton(
      COLOR_BUTTON_X,
      NAME_COLOR_ROW_Y,
      'FARBE \u00c4NDERN',
      NAME_COLOR_BUTTON_W,
      NAME_COLOR_BUTTON_H,
      () => this.toggleColorPicker(),
    );
    this.colorEditBtn = colorEditBtn.button;
    this.colorEditText = colorEditBtn.text ?? null;
    objects.push(colorEditBtn.button, colorEditBtn.label);

    objects.push(
      this.scene.add.rectangle(CENTER_X, NAME_MODE_DIVIDER_Y, LOBBY_PANEL_W - 40, 1, COLORS.GREY_6, 0.5)
        .setScrollFactor(0),
    );

    objects.push(
      this.scene.add.text(CENTER_X, MODE_LABEL_Y, 'Spielmodus:', LABEL_FONT)
        .setOrigin(0.5, 0)
        .setScrollFactor(0),
    );

    const modeLeftBtn = this.createChevronButton(
      ARROW_X_LEFT,
      MODE_ROW_Y + CONTROL_BUTTON_DY,
      'left',
      () => this.stepGameMode(-1),
    );
    objects.push(modeLeftBtn.button, modeLeftBtn.label);

    const modeNameText = this.scene.add.text(ITEM_NAME_X, MODE_ROW_Y, '', {
      fontSize: '15px', fontFamily: 'monospace', color: '#e0e0e0', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setScrollFactor(0);
    this.modeNameText = modeNameText;
    objects.push(modeNameText);

    const modeRightBtn = this.createChevronButton(
      ARROW_X_RIGHT,
      MODE_ROW_Y + CONTROL_BUTTON_DY,
      'right',
      () => this.stepGameMode(+1),
    );
    objects.push(modeRightBtn.button, modeRightBtn.label);
    this.modeArrowButtons = { left: modeLeftBtn, right: modeRightBtn };

    const mapLabelText = this.scene.add.text(CENTER_X, MAP_LABEL_Y, 'Map:', LABEL_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    this.mapLabelText = mapLabelText;
    objects.push(mapLabelText);

    const mapLeftBtn = this.createChevronButton(
      ARROW_X_LEFT,
      MAP_ROW_Y + CONTROL_BUTTON_DY,
      'left',
      () => this.stepCoopDefenseMap(-1),
    );
    objects.push(mapLeftBtn.button, mapLeftBtn.label);

    const mapNameText = this.scene.add.text(ITEM_NAME_X, MAP_ROW_Y, '', {
      fontSize: '15px', fontFamily: 'monospace', color: '#e0e0e0', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setScrollFactor(0);
    this.mapNameText = mapNameText;
    objects.push(mapNameText);

    const mapRightBtn = this.createChevronButton(
      ARROW_X_RIGHT,
      MAP_ROW_Y + CONTROL_BUTTON_DY,
      'right',
      () => this.stepCoopDefenseMap(+1),
    );
    objects.push(mapRightBtn.button, mapRightBtn.label);
    this.mapArrowButtons = { left: mapLeftBtn, right: mapRightBtn };

    // ── Trennlinie ──
    const divider = this.scene.add.graphics();
    divider.lineStyle(1, COLORS.GREY_6, 0.5);
    divider.beginPath();
    divider.moveTo(20, DIVIDER1_Y);
    divider.lineTo(LOBBY_PANEL_W - 20, DIVIDER1_Y);
    divider.strokePath();
    divider.setScrollFactor(0);
    objects.push(divider);

    // ── Dachs-Vorschau als Farbindikator ──
    // Invisible click zone (sprite itself is not in lobbyContainer — it's world-space for preFX)
    this.badgerClickZone = this.scene.add
      .rectangle(CENTER_X, BADGER_Y, BADGER_CLICK_SIZE, BADGER_CLICK_SIZE, 0x000000, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.toggleColorPicker());
    objects.push(this.badgerClickZone);
    const teamLeftBtn = this.createChevronButton(
      COLOR_BUTTON_X - TEAM_SELECT_ARROW_OFFSET_X,
      NAME_COLOR_ROW_Y,
      'left',
      () => this.stepTeam(-1),
    );
    teamLeftBtn.button.setVisible(false);
    teamLeftBtn.label.setVisible(false);
    objects.push(teamLeftBtn.button, teamLeftBtn.label);

    const teamRightBtn = this.createChevronButton(
      COLOR_BUTTON_X + TEAM_SELECT_ARROW_OFFSET_X,
      NAME_COLOR_ROW_Y,
      'right',
      () => this.stepTeam(+1),
    );
    teamRightBtn.button.setVisible(false);
    teamRightBtn.label.setVisible(false);
    objects.push(teamRightBtn.button, teamRightBtn.label);
    this.teamArrowButtons = { left: teamLeftBtn, right: teamRightBtn };

    // ── Trennlinie 2 ──
    const divider2 = this.scene.add.graphics();
    divider2.lineStyle(1, COLORS.GREY_6, 0.5);
    divider2.beginPath();
    divider2.moveTo(20, DIVIDER2_Y);
    divider2.lineTo(LOBBY_PANEL_W - 20, DIVIDER2_Y);
    divider2.strokePath();
    divider2.setScrollFactor(0);
    objects.push(divider2);

    // ── Loadout-Karussell ──
    objects.push(
      this.scene.add.text(CENTER_X, CAROUSEL_START_Y, 'Loadout:', LABEL_FONT)
        .setOrigin(0.5, 0)
        .setScrollFactor(0),
    );

    this.applyStoredPlayerNamePreference();

    const slots: LoadoutSlot[] = ['weapon1', 'weapon2', 'utility', 'ultimate'];
    slots.forEach((slot, i) => {
      const arrowY = CAROUSEL_START_Y + CAROUSEL_GROUP_DY + i * CAROUSEL_ROW_STEP;
      const labelY = arrowY + CAROUSEL_LABEL_DY;

      const leftBtn = this.createChevronButton(
        ARROW_X_LEFT,
        arrowY + CONTROL_BUTTON_DY,
        'left',
        () => this.stepCarousel(slot, -1),
      );
      objects.push(leftBtn.button, leftBtn.label);

      const nameText = this.scene.add.text(ITEM_NAME_X, arrowY, '', {
        fontSize: '15px', fontFamily: 'monospace', color: '#e0e0e0', fontStyle: 'bold',
      }).setOrigin(0.5, 0).setScrollFactor(0);
      this.loadoutNameTexts[slot] = nameText;
      objects.push(nameText);

      const rightBtn = this.createChevronButton(
        ARROW_X_RIGHT,
        arrowY + CONTROL_BUTTON_DY,
        'right',
        () => this.stepCarousel(slot, +1),
      );
      objects.push(rightBtn.button, rightBtn.label);
      this.loadoutArrowButtons[slot] = { left: leftBtn, right: rightBtn };

      // Slot-Label zentriert UNTER den Pfeilen
      objects.push(
        this.scene.add.text(ITEM_NAME_X, labelY, SLOT_LABELS[slot], {
          fontSize: '12px', fontFamily: 'monospace', color: '#888888',
        }).setOrigin(0.5, 0).setScrollFactor(0),
      );

      const initialItems = this.getSlotItems(slot);
      const initialSelectionId = this.resolveInitialLoadoutId(slot);
      if (initialSelectionId) {
        const initialIndex = initialItems.findIndex((item) => item.id === initialSelectionId);
        this.loadoutIndices[slot] = initialIndex >= 0 ? initialIndex : 0;
      }

      // Initialwert anzeigen und in Bridge/Preferences speichern
      this.updateCarouselDisplay(slot);
      if (initialItems.length > 0) {
        this.applyLocalLoadoutSelection(slot, initialItems[this.loadoutIndices[slot]].id);
      }
    });

    // ── Trennlinie 3 (unter Loadout) ──
    const divider3 = this.scene.add.graphics();
    divider3.lineStyle(1, COLORS.GREY_6, 0.5);
    divider3.beginPath();
    divider3.moveTo(20, DIVIDER3_Y);
    divider3.lineTo(LOBBY_PANEL_W - 20, DIVIDER3_Y);
    divider3.strokePath();
    divider3.setScrollFactor(0);
    objects.push(divider3);

    // ── Hilfe-Button ──
    const menuBtnTex = ensureGlossyButtonTexture(
      this.scene, `_lsp_menu_btn_${MENU_BTN_W}x${MENU_BTN_H}`, MENU_BTN_W, MENU_BTN_H, COLORS.GREY_6, COLORS.GOLD_1,
    );
    const optionsBtn = this.scene.add.image(OPTIONS_BTN_X, MENU_BTN_Y, menuBtnTex)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.optionsOverlay?.show())
      .setScrollFactor(0);
    objects.push(optionsBtn);
    const optionsLabel = this.scene.add.text(OPTIONS_BTN_X, MENU_BTN_Y, 'OPTIONEN', {
      fontSize: '14px', fontFamily: 'monospace', fontStyle: 'bold',
      color: toCssColor(COLORS.GOLD_1),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(optionsLabel);
    attachHoverEffect(this.scene, optionsBtn, optionsLabel);

    const helpBtn = this.scene.add.image(HELP_BTN_X, MENU_BTN_Y, menuBtnTex)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.helpOverlay?.show())
      .setScrollFactor(0);
    objects.push(helpBtn);
    const helpLabel = this.scene.add.text(HELP_BTN_X, MENU_BTN_Y, 'HILFE', {
      fontSize: '14px', fontFamily: 'monospace', fontStyle: 'bold',
      color: toCssColor(COLORS.GOLD_1),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(helpLabel);
    attachHoverEffect(this.scene, helpBtn, helpLabel);

    this.lobbyContainer = this.scene.add.container(0, 0, objects);
    this.lobbyContainer.setDepth(DEPTH.OVERLAY - 1);

    // BadgerPreview (world-space, separate from container for preFX support)
    this.badgerPreview = new BadgerPreview(this.scene, CENTER_X, BADGER_Y, 0x888888, BADGER_SIZE);
    this.badgerPreview.setScrollFactor(0);
    this.badgerPreview.setDepth(DEPTH.OVERLAY);

    // ── Picker-Popup (world-space, über LobbyOverlay) ─────────────────────────
    this.pickerContainer = this.buildPickerContainer();
    this.pickerContainer.setVisible(false);

    // ── Hilfe-Overlay (world-space, über allem) ───────────────────────────────
    this.helpOverlay = new HelpOverlay(this.scene);
    this.helpOverlay.build();
    this.optionsOverlay = new OptionsOverlay(this.scene, this.audioSystem, this.graphicsQuality);
    this.optionsOverlay.build();
    this.optionsOverlay.setAbortMatchBinding(this.abortMatchBinding);
    this.setLobbyFieldsLocked(false);
    this.refreshColorIndicator();
  }

  getPuContainer(): Phaser.GameObjects.Container { return this.puContainer; }

  /** Reicht den Host-Abbruch der laufenden Partie an das Optionsmenue durch. */
  setAbortMatchBinding(binding: AbortMatchBinding | null): void {
    this.abortMatchBinding = binding;
    this.optionsOverlay?.setAbortMatchBinding(binding);
  }

  toggleOptionsOverlay(): void {
    this.optionsOverlay?.toggle();
  }

  hideOptionsOverlay(): void {
    this.optionsOverlay?.hide();
  }

  isOptionsOverlayOpen(): boolean {
    return this.optionsOverlay?.isOpen() ?? false;
  }

  isHelpOverlayOpen(): boolean {
    return this.helpOverlay?.isOpen() ?? false;
  }

  isHotkeyInputBlocked(): boolean {
    return this.nameEditOpen || this.pickerOpen;
  }

  // ── Transitions ────────────────────────────────────────────────────────────

  transitionToGame(): void {
    this.closeColorPicker();
    this.closeNameEditPopup();
    this.helpOverlay?.hide();
    this.optionsOverlay?.hide();
    this.nameEditEnabled = false;
    this.loadoutEnabled  = false;
    this.badgerPreview?.setVisible(false);
    this.scene.tweens.killTweensOf(this.lobbyContainer);
    this.scene.tweens.killTweensOf(this.gameContainer);
    this.pendingDelay?.remove();

    // Populate ArenaHUD with player info and loadout names
    this.initArenaHUD();
    this.arenaOverlayVisible = false;
    this.gameContainer.y = -GAME_HEIGHT;

    this.scene.tweens.add({
      targets:  this.lobbyContainer,
      y:        GAME_HEIGHT,
      duration: 350,
      ease:     'Power2.easeIn',
    });
    this.pendingDelay = null;
  }

  transitionToLobby(): void {
    this.helpOverlay?.hide();
    this.optionsOverlay?.hide();
    this.scene.tweens.killTweensOf(this.lobbyContainer);
    this.scene.tweens.killTweensOf(this.gameContainer);
    this.pendingDelay?.remove();

    this.arenaHUD.reset();
    this.arenaOverlayVisible = false;
    this.badgerPreview?.setVisible(true);
    this.puContainer.setVisible(false);

    this.scene.tweens.add({
      targets:  this.gameContainer,
      y:        -GAME_HEIGHT,
      duration: 350,
      ease:     'Power2.easeIn',
    });

    this.pendingDelay = this.scene.time.delayedCall(100, () => {
      this.scene.tweens.add({
        targets:    this.lobbyContainer,
        y:          0,
        duration:   500,
        ease:       'Back.easeOut',
        onComplete: () => {
          this.nameEditEnabled = true;
          this.loadoutEnabled  = true;
          this.setLobbyFieldsLocked(false);
          this.pendingDelay    = null;
        },
      });
    });
  }

  setArenaOverlayVisible(visible: boolean, immediate = false): void {
    const targetY = visible ? 0 : -GAME_HEIGHT;
    if (!immediate && this.arenaOverlayVisible === visible) {
      return;
    }

    this.scene.tweens.killTweensOf(this.gameContainer);
    this.arenaOverlayVisible = visible;

    if (immediate) {
      this.gameContainer.y = targetY;
      return;
    }

    this.scene.tweens.add({
      targets: this.gameContainer,
      y: targetY,
      duration: visible ? 220 : 180,
      ease: visible ? 'Back.easeOut' : 'Power2.easeIn',
    });
  }

  isArenaOverlayVisible(): boolean {
    return this.arenaOverlayVisible;
  }

  // ── Daten-Updates (von ArenaScene.update() aufgerufen) ────────────────────

  updateLocalName(name: string): void {
    this.localNameText?.setText(name);
  }

  /** Per-frame arena HUD update with all player vitals. */
  updateArenaHUD(data: ArenaHUDData): void {
    this.arenaHUD.update(data);
  }

  /** Trigger fire-highlight on a weapon/utility slot. */
  flashSlot(slot: 'weapon1' | 'weapon2' | 'utility'): void {
    this.arenaHUD.flashSlot(slot);
  }

  /** Aktualisiert den Dachs-Farbindikator und Spielernamen anhand des aktuellen Player-States. */
  refreshColorIndicator(): void {
    const color = this.bridge.getPlayerColor(this.bridge.getLocalPlayerId());
    const mode = this.bridge.getGameMode();
    const teamId = this.bridge.getPlayerTeam(this.bridge.getLocalPlayerId());
    if (color !== undefined) {
      this.badgerPreview?.setColor(color);
      this.localNameText?.setColor(toCssColor(color));
    }
    this.modeNameText?.setText(getGameModeLabel(mode));
    this.mapNameText?.setText(isCoopDefenseMode(mode)
      ? getCoopDefenseMapConfig(this.bridge.getCoopDefenseMapId()).displayName
      : '---');
    this.syncAllLoadoutSelections();
    this.updateModeSelectorState();
    this.updateMapSelectorState(mode);
    this.updateTeamSelectorState(mode, teamId);
  }

  /** Per-frame lobby update: rotate badger towards mouse. */
  updateLobby(): void {
    if (!this.badgerPreview) return;
    const pointer = this.scene.input.activePointer;
    // Sprite is scrollFactor(0), so compare with screen coords directly
    const angle = Phaser.Math.Angle.Between(
      CENTER_X, BADGER_Y,
      pointer.x, pointer.y,
    );
    this.badgerPreview.setRotation(angle);
  }

  /** Aktualisiert den Picker live, solange er offen ist (jeden Lobby-Frame). */
  refreshColorPickerIfOpen(): void {
    if (usesTeamColors(this.bridge.getGameMode())) {
      this.closeColorPicker();
      return;
    }
    if (!this.pickerOpen) return;
    this.refreshPickerSwatches();
  }

  // ── Callbacks von ArenaScene ──────────────────────────────────────────────

  /** Wird aufgerufen wenn der Host den Farbwechsel akzeptiert hat. */
  onColorAccepted(): void {
    this.requestPending = false;
    this.closeColorPicker();
    this.refreshColorIndicator();
  }

  /** Wird aufgerufen wenn der Host den Farbwechsel abgelehnt hat. */
  onColorDenied(): void {
    this.requestPending = false;
    this.refreshPickerSwatches();  // zeigt aktualisierten Pool
  }

  setLobbyFieldsLocked(locked: boolean): void {
    this.lobbyFieldsLocked = locked;
    this.nameEditEnabled = !locked;
    this.loadoutEnabled = !locked;

    if (locked) {
      this.closeColorPicker();
      this.closeNameEditPopup();
    }

    this.updateNameEditButtonVisibility();
    this.updateColorEditState();
    this.updateLoadoutArrowVisibility();
    this.updateModeSelectorState();
    this.updateMapSelectorState(this.bridge.getGameMode());
    this.updateTeamSelectorState(this.bridge.getGameMode(), this.bridge.getPlayerTeam(this.bridge.getLocalPlayerId()));
  }

  destroy(): void {
    this.closeNameEditPopup();
    this.cleanupPickerDismissListener();
    this.badgerPreview?.destroy();
    this.destroyPickerEffects();
    this.helpOverlay?.destroy();
    this.optionsOverlay?.destroy();
    this.arenaHUD.destroy();
    this.lobbyContainer.destroy(true);
    this.gameContainer.destroy(true);
    this.pickerContainer.destroy(true);
  }

  // ── Color-Picker ──────────────────────────────────────────────────────────

  private buildPickerContainer(): Phaser.GameObjects.Container {
    ensureLivingBarTextures(this.scene);
    const objects: Phaser.GameObjects.GameObject[] = [];

    // Hintergrund
    objects.push(
      this.scene.add
        .rectangle(0, 0, PICKER_W, PICKER_H, COLORS.GREY_8, 0.97)
        .setOrigin(0, 0)
        .setStrokeStyle(1, COLORS.GREY_5),
    );

    // Titel
    objects.push(
      this.scene.add
        .text(PICKER_PADDING, PICKER_PADDING, 'Farbe wählen', {
          fontSize: '12px', fontFamily: 'monospace', color: '#c7cfcc',
        }),
    );

    const container = this.scene.add.container(PICKER_WORLD_X, PICKER_WORLD_Y, objects);
    container.setDepth(DEPTH.OVERLAY + 2);

    // Farb-Swatches (created after container, so LivingBarEffect can add emitters)
    this.pickerSwatches = [];
    PLAYER_COLORS.forEach((color, idx) => {
      const col = idx % PICKER_COLS;
      const row = Math.floor(idx / PICKER_COLS);
      const sx  = PICKER_PADDING + col * (SWATCH_SIZE + SWATCH_GAP);
      const sy  = PICKER_GRID_Y  + row * (SWATCH_SIZE + SWATCH_GAP);

      // Background rect (border/frame)
      const bg = this.scene.add
        .rectangle(sx, sy, SWATCH_SIZE, SWATCH_SIZE, COLORS.GREY_9)
        .setOrigin(0, 0);
      container.add(bg);

      // Gradient image for the swatch
      const texKey = TEX_SWATCH_PREFIX + idx;
      const palette = paletteFromColor(color);
      createGradientTexture(this.scene, texKey, palette, SWATCH_SIZE, SWATCH_SIZE);
      const img = this.scene.add.image(sx + SWATCH_SIZE / 2, sy + SWATCH_SIZE / 2, texKey);
      container.add(img);

      // LivingBarEffect (particles inside swatch area, reduced intensity for small swatches)
      const effect = new LivingBarEffect(
        this.scene, container,
        sx, sy, SWATCH_SIZE, SWATCH_SIZE,
        palette,
        { intensity: 0.25 },
      );

      // Interactive zone on top
      bg.setInteractive({ useHandCursor: true })
        .on('pointerover', () => { if (bg.alpha > 0.5) bg.setStrokeStyle(2, 0xffffff); })
        .on('pointerout',  () => bg.setStrokeStyle(0))
        .on('pointerdown', () => this.requestColor(color));

      this.pickerSwatches.push({ bg, img, effect, color });
    });

    return container;
  }

  private destroyPickerEffects(): void {
    for (const s of this.pickerSwatches) {
      s.effect.destroy();
    }
  }

  private toggleColorPicker(): void {
    if (this.lobbyFieldsLocked) return;
    if (this.pickerOpen) this.closeColorPicker();
    else                 this.openColorPicker();
  }

  private openColorPicker(): void {
    if (this.lobbyFieldsLocked) return;
    this.pickerOpen = true;
    this.requestPending = false;
    this.refreshPickerSwatches();
    this.pickerContainer.setVisible(true);
    this.schedulePickerDismissListener();
  }

  private closeColorPicker(): void {
    this.pickerOpen = false;
    this.pickerContainer.setVisible(false);
    this.cleanupPickerDismissListener();
  }

  /**
   * Aktualisiert alle Swatches:
   * - Eigene Farbe:      voll sichtbar, Rand markiert
   * - Verfügbare Farbe:  voll sichtbar, klickbar
   * - Vergeben Farbe:    gedimmt (35% alpha), nicht interaktiv
   * - Pending:           alle gedimmt
   */
  private refreshPickerSwatches(): void {
    const available = this.bridge.getAvailableColors();
    const ownColor  = this.bridge.getPlayerColor(this.bridge.getLocalPlayerId());

    for (const { bg, img, effect, color } of this.pickerSwatches) {
      const isOwn       = color === ownColor;
      const isFree      = available.includes(color);
      const isClickable = (isFree || isOwn) && !this.requestPending;
      const visible     = isOwn || isFree;

      bg.setAlpha(visible ? 1.0 : 0.07);
      img.setAlpha(visible ? 1.0 : 0.07);
      bg.setStrokeStyle(isOwn ? 3 : 0, COLORS.GREY_1);

      if (visible) effect.start();
      else effect.stop();

      if (isClickable) {
        bg.setInteractive({ useHandCursor: true });
      } else {
        bg.disableInteractive();
      }
    }
  }

  private requestColor(color: number): void {
    if (usesTeamColors(this.bridge.getGameMode())) return;
    if (this.lobbyFieldsLocked) return;
    if (this.requestPending) return;
    const ownColor = this.bridge.getPlayerColor(this.bridge.getLocalPlayerId());
    if (color === ownColor) { this.closeColorPicker(); return; }  // bereits eigene Farbe

    this.requestPending = true;
    this.closeColorPicker();
    this.refreshPickerSwatches();  // alle Swatches sperren während Anfrage läuft
    this.bridge.sendColorRequest(color);
  }

  // ── Loadout-Karussell ─────────────────────────────────────────────────────

  private stepCarousel(slot: LoadoutSlot, delta: -1 | 1): void {
    if (!this.loadoutEnabled) return;
    const items = this.getSlotItems(slot);
    if (items.length === 0) return;
    this.syncLoadoutSelectionFromBridge(slot);
    this.loadoutIndices[slot] = (this.loadoutIndices[slot] + delta + items.length) % items.length;
    this.updateCarouselDisplay(slot);
    this.applyLocalLoadoutSelection(slot, items[this.loadoutIndices[slot]].id);
  }

  private updateCarouselDisplay(slot: LoadoutSlot): void {
    const items = this.getSlotItems(slot);
    if (items.length === 0) {
      this.loadoutNameTexts[slot]?.setText('-');
      this.loadoutIndices[slot] = 0;
      this.updateSlotArrowVisibility(slot);
      return;
    }
    const nextIndex = Phaser.Math.Clamp(this.loadoutIndices[slot], 0, items.length - 1);
    this.loadoutIndices[slot] = nextIndex;
    const item = items[nextIndex];
    this.loadoutNameTexts[slot]?.setText(item.displayName ?? item.id);
    this.updateSlotArrowVisibility(slot);
  }

  private getSlotItems(slot: LoadoutSlot): LoadoutCarouselItem[] {
    const mode = this.bridge.getGameMode();
    const base: LoadoutCarouselItem[] = slot === 'ultimate'
      ? getAvailableUltimateConfigs(mode)
      : STATIC_SLOT_ITEMS[slot];

    if (!isCoopDefenseMode(mode)) return base;

    const profile = getStoredCoopDefenseUpgradeProfile();
    const filtered = base.filter((item) => isCoopDefenseLoadoutItemSelectable(profile, slot, item.id));
    if (filtered.length > 0) return filtered;

    // Sicherheits-Fallback: Liste nie leer — Default-Item des Slots erzwingen.
    const fallback = DEFAULT_LOADOUT[slot];
    return [{ id: fallback.id, displayName: fallback.displayName }];
  }

  private syncAllLoadoutSelections(): void {
    this.syncLoadoutSelectionFromBridge('weapon1');
    this.syncLoadoutSelectionFromBridge('weapon2');
    this.syncLoadoutSelectionFromBridge('utility');
    this.syncLoadoutSelectionFromBridge('ultimate');
  }

  private syncLoadoutSelectionFromBridge(slot: LoadoutSlot): void {
    const items = this.getSlotItems(slot);
    if (items.length === 0) {
      this.loadoutIndices[slot] = 0;
      this.loadoutNameTexts[slot]?.setText('-');
      return;
    }

    const localId = this.bridge.getLocalPlayerId();
    const selectedId = this.bridge.getPlayerLoadoutSlot(localId, slot);
    const nextIndex = items.findIndex((item) => item.id === selectedId);
    if (nextIndex >= 0) {
      if (this.loadoutIndices[slot] !== nextIndex) {
        this.loadoutIndices[slot] = nextIndex;
        setStoredLoadoutSlot(slot, items[nextIndex].id);
      }
      this.updateCarouselDisplay(slot);
      return;
    }

    this.loadoutIndices[slot] = 0;
    this.updateCarouselDisplay(slot);
    if (selectedId !== items[0].id) {
      this.applyLocalLoadoutSelection(slot, items[0].id);
    }
  }

  // ── Namens-Edit DOM-Popup ──────────────────────────────────────────────────

  private openNameEdit(): void {
    if (!this.nameEditEnabled) return;
    if (this.nameEditOpen) return;
    this.nameEditOpen = true;

    const localId     = this.bridge.getLocalPlayerId();
    const currentName = clampPlayerNameInput(this.bridge.getConnectedPlayers().find(p => p.id === localId)?.name ?? '');

    // Position relativ zum Canvas berechnen ([ ÄNDERN ] Button)
    const canvas = this.scene.game.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    // Bezugsgröße ist der Designraum, nicht die Renderauflösung der Canvas: CENTER_X und
    // NAME_VALUE_Y sind Designkoordinaten (siehe `graphics/RenderResolution`).
    const scaleX = canvasRect.width / GAME_WIDTH;
    const scaleY = canvasRect.height / GAME_HEIGHT;
    const popupLeft = canvasRect.left + (CENTER_X + 80) * scaleX;
    const popupTop  = canvasRect.top  + NAME_VALUE_Y * scaleY;

    const popup = document.createElement('div');
    Object.assign(popup.style, {
      position:        'fixed',
      top:             `${popupTop}px`,
      left:            `${popupLeft}px`,
      backgroundColor: toCssColor(COLORS.GREY_9),
      border:          `1px solid ${toCssColor(COLORS.GREY_5)}`,
      padding:         '10px',
      display:         'flex',
      flexDirection:   'row',
      gap:             '6px',
      alignItems:      'center',
      zIndex:          '1000',
      fontFamily:      'monospace',
    });

    const playerColor = this.bridge.getPlayerColor(this.bridge.getLocalPlayerId());
    const colorCss = playerColor !== undefined ? toCssColor(playerColor) : toCssColor(COLORS.GREY_1);

    const inputElement = document.createElement('input');
    inputElement.type  = 'text';
    inputElement.value = currentName;
    inputElement.maxLength = PLAYER_NAME_MAX_LENGTH;
    Object.assign(inputElement.style, {
      fontSize:        '22px',
      padding:         '4px 8px',
      border:          `1px solid ${toCssColor(COLORS.GREY_5)}`,
      backgroundColor: toCssColor(COLORS.GREY_8),
      color:           colorCss,
      outline:         'none',
      width:           '160px',
      fontFamily:      'monospace',
      fontWeight:      'bold',
    });

    const confirmBtn     = document.createElement('button');
    confirmBtn.innerText = 'OK';
    Object.assign(confirmBtn.style, {
      padding:         '4px 10px',
      fontSize:        '13px',
      cursor:          'pointer',
      backgroundColor: toCssColor(COLORS.GREEN_4),
      color:           toCssColor(COLORS.GREY_1),
      border:          `1px solid ${toCssColor(COLORS.GREEN_3)}`,
      fontFamily:      'monospace',
      fontWeight:      'bold',
    });

    const cancelBtn     = document.createElement('button');
    cancelBtn.innerText = 'X';
    Object.assign(cancelBtn.style, {
      padding:         '4px 8px',
      fontSize:        '13px',
      cursor:          'pointer',
      backgroundColor: toCssColor(COLORS.RED_4),
      color:           toCssColor(COLORS.GREY_1),
      border:          `1px solid ${toCssColor(COLORS.RED_3)}`,
      fontFamily:      'monospace',
      fontWeight:      'bold',
    });

    popup.appendChild(inputElement);
    popup.appendChild(confirmBtn);
    popup.appendChild(cancelBtn);

    getOverlayRoot().appendChild(popup);
    this.nameEditPopup = popup;
    inputElement.focus();
    inputElement.select();

    inputElement.addEventListener('input', () => {
      const clamped = clampPlayerNameInput(inputElement.value);
      if (inputElement.value !== clamped) inputElement.value = clamped;
    });

    const closePopup = () => {
      if (this.nameEditPopup === popup) {
        this.nameEditPopup = null;
        this.closeNameEditPopupFn = null;
      }
      this.nameEditOpen = false;
      popup.remove();
    };
    this.closeNameEditPopupFn = closePopup;
    const saveName   = () => {
      const input = sanitizePlayerName(inputElement.value);
      if (input === '') {
        inputElement.focus();
        inputElement.select();
        return;
      }
      this.bridge.setLocalName(input);
      setStoredPlayerName(input);
      closePopup();
    };

    confirmBtn.onclick = saveName;
    cancelBtn.onclick  = closePopup;
    inputElement.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter')  saveName();
      if (e.key === 'Escape') closePopup();
    });
  }

  private createCompactButton(
    x: number,
    y: number,
    labelText: string,
    width: number,
    height: number,
    onClick: () => void,
    fontSize = '13px',
    labelOffsetY = CONTROL_LABEL_OFFSET_Y,
    iconDirection: 'left' | 'right' | null = null,
  ): CompactButton {
    const textureKey = `_lsp_compact_btn_${width}x${height}`;
    const button = this.scene.add.image(
      x,
      y,
      ensureGlossyButtonTexture(
        this.scene,
        textureKey,
        width,
        height,
        LOBBY_CONTROL_COLOR,
        LOBBY_CONTROL_STROKE,
      ),
    )
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onClick)
      .setScrollFactor(0);
    const label: CompactLabel = iconDirection
      ? this.createChevronIcon(x, y, iconDirection)
      : this.scene.add.text(x, y + labelOffsetY, labelText, {
        fontSize,
        fontFamily: 'monospace',
        color: LOBBY_CONTROL_TEXT,
        fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0);
    attachHoverEffect(this.scene, button, label);
    return { button, label, text: iconDirection ? undefined : label as Phaser.GameObjects.Text };
  }

  private createChevronButton(
    x: number,
    y: number,
    direction: 'left' | 'right',
    onClick: () => void,
  ): CompactButton {
    return this.createCompactButton(
      x,
      y,
      '',
      ARROW_BUTTON_W,
      ARROW_BUTTON_H,
      onClick,
      '13px',
      0,
      direction,
    );
  }

  private createChevronIcon(
    x: number,
    y: number,
    direction: 'left' | 'right',
  ): Phaser.GameObjects.Graphics {
    const icon = this.scene.add.graphics();
    icon.lineStyle(1.8, COLORS.GREY_2, 1);
    icon.beginPath();
    if (direction === 'left') {
      icon.moveTo(3, -4);
      icon.lineTo(-2, 0);
      icon.lineTo(3, 4);
    } else {
      icon.moveTo(-3, -4);
      icon.lineTo(2, 0);
      icon.lineTo(-3, 4);
    }
    icon.strokePath();
    icon.setPosition(x, y).setScrollFactor(0);
    return icon;
  }

  private setCompactButtonState(
    control: CompactButton,
    visible: boolean,
    enabled: boolean,
    alpha = 1,
  ): void {
    control.button.setVisible(visible).setAlpha(alpha);
    control.label.setVisible(visible).setAlpha(alpha);
    if (enabled) control.button.setInteractive({ useHandCursor: true });
    else control.button.disableInteractive();
  }

  private closeNameEditPopup(): void {
    this.closeNameEditPopupFn?.();
  }

  private updateNameEditButtonVisibility(): void {
    const enabled = !this.lobbyFieldsLocked;
    if (this.editBtn) {
      this.editBtn.setVisible(enabled).setAlpha(enabled ? 1 : 0);
      if (enabled) this.editBtn.setInteractive({ useHandCursor: true });
      else this.editBtn.disableInteractive();
    }
    this.editBtnLabel?.setVisible(enabled).setAlpha(enabled ? 1 : 0);
  }

  private updateColorEditState(): void {
    const mode = this.bridge.getGameMode();
    const enabled = !this.lobbyFieldsLocked && !usesTeamColors(mode);
    this.badgerClickZone.setAlpha(enabled ? 1 : 0);
    if (enabled) this.badgerClickZone.setInteractive({ useHandCursor: true });
    else this.badgerClickZone.disableInteractive();

    const visible = !usesTeamColors(mode) && !this.lobbyFieldsLocked;
    this.colorEditBtn?.setVisible(visible).setAlpha(visible ? 1 : 0);
    this.colorEditText
      ?.setPosition(COLOR_BUTTON_X, NAME_COLOR_ROW_Y + CONTROL_LABEL_OFFSET_Y)
      .setVisible(visible)
      .setAlpha(visible ? 1 : 0)
      .setText('FARBE \u00c4NDERN');
    if (enabled) this.colorEditBtn?.setInteractive({ useHandCursor: true });
    else this.colorEditBtn?.disableInteractive();
  }

  private updateLoadoutArrowVisibility(): void {
    for (const slot of Object.keys(this.loadoutArrowButtons) as LoadoutSlot[]) {
      this.updateSlotArrowVisibility(slot);
    }
  }

  /** Pfeile nur sichtbar/klickbar, wenn nicht gesperrt UND mehr als ein Item zur Auswahl steht. */
  private updateSlotArrowVisibility(slot: LoadoutSlot): void {
    const buttons = this.loadoutArrowButtons[slot];
    if (!buttons) return;
    const enabled = !this.lobbyFieldsLocked && this.getSlotItems(slot).length > 1;
    this.setCompactButtonState(buttons.left, enabled, enabled);
    this.setCompactButtonState(buttons.right, enabled, enabled);
  }

  private stepGameMode(delta: -1 | 1): void {
    if (this.lobbyFieldsLocked || !this.bridge.isHost()) return;
    const currentMode = this.bridge.getGameMode();
    const currentIndex = MODE_OPTIONS.indexOf(currentMode);
    const nextIndex = (currentIndex + delta + MODE_OPTIONS.length) % MODE_OPTIONS.length;
    this.bridge.setGameMode(MODE_OPTIONS[nextIndex]);
    this.refreshColorIndicator();
  }

  /** Blaettert nur durch die lokal freigeschalteten Maps – gesperrte Maps sind nicht erreichbar. */
  private stepCoopDefenseMap(delta: -1 | 1): void {
    const mode = this.bridge.getGameMode();
    if (this.lobbyFieldsLocked || !this.bridge.isHost() || !isCoopDefenseMode(mode)) return;
    const selectableMaps = getUnlockedCoopDefenseMapConfigs(getStoredHighestUnlockedCoopDefenseMapId());
    if (selectableMaps.length === 0) return;
    const currentMapId = this.bridge.getCoopDefenseMapId();
    const currentIndex = selectableMaps.findIndex((mapConfig) => mapConfig.mapId === currentMapId);
    const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (normalizedIndex + delta + selectableMaps.length) % selectableMaps.length;
    this.bridge.setCoopDefenseMapId(selectableMaps[nextIndex].mapId);
    this.refreshColorIndicator();
  }

  private stepTeam(delta: -1 | 1): void {
    if (!hasTeamSelection(this.bridge.getGameMode())) return;
    if (this.lobbyFieldsLocked) return;
    const localId = this.bridge.getLocalPlayerId();
    if (!this.bridge.canPlayerChangeTeam(localId)) return;
    const currentTeam = this.bridge.getPlayerTeam(localId) ?? 'blue';
    const currentIndex = TEAM_OPTIONS.indexOf(currentTeam);
    const nextIndex = (currentIndex + delta + TEAM_OPTIONS.length) % TEAM_OPTIONS.length;
    void this.bridge.requestTeamChange(TEAM_OPTIONS[nextIndex]).then((changed) => {
      if (changed) this.refreshColorIndicator();
    });
  }

  private updateModeSelectorState(): void {
    const isHost = this.bridge.isHost();
    const enabled = !this.lobbyFieldsLocked && isHost;
    const alpha = enabled ? 1 : 0.35;
    if (this.modeArrowButtons) {
      this.setCompactButtonState(this.modeArrowButtons.left, isHost, enabled, alpha);
      this.setCompactButtonState(this.modeArrowButtons.right, isHost, enabled, alpha);
    }
  }

  private updateMapSelectorState(mode: GameMode): void {
    const isHost = this.bridge.isHost();
    const showMapSelector = isCoopDefenseMode(mode);
    const enabled = showMapSelector && !this.lobbyFieldsLocked && isHost;
    const alpha = enabled ? 1 : 0.35;

    this.mapLabelText?.setVisible(showMapSelector);
    if (this.mapArrowButtons) {
      this.setCompactButtonState(this.mapArrowButtons.left, showMapSelector && isHost, enabled, alpha);
      this.setCompactButtonState(this.mapArrowButtons.right, showMapSelector && isHost, enabled, alpha);
    }
    this.mapNameText?.setVisible(showMapSelector).setAlpha(1);
  }

  private updateTeamSelectorState(mode: GameMode, teamId: TeamId | null): void {
    const showTeamSelect = hasTeamSelection(mode);
    const canChangeTeam = showTeamSelect && !this.lobbyFieldsLocked && this.bridge.canPlayerChangeTeam(this.bridge.getLocalPlayerId());
    const alpha = canChangeTeam ? 1 : 0.35;

    if (usesTeamColors(mode)) {
      this.closeColorPicker();
    }

    if (this.teamArrowButtons) {
      this.setCompactButtonState(this.teamArrowButtons.left, showTeamSelect, canChangeTeam, alpha);
      this.setCompactButtonState(this.teamArrowButtons.right, showTeamSelect, canChangeTeam, alpha);
    }

    if (!this.colorEditText) return;
    if (showTeamSelect) {
      this.colorEditBtn?.setVisible(false).disableInteractive();
      this.colorEditText
        .setPosition(COLOR_BUTTON_X, NAME_COLOR_ROW_Y + CONTROL_LABEL_OFFSET_Y)
        .setVisible(true);
      this.colorEditText.setText(getTeamLabel(teamId));
    } else {
      this.updateColorEditState();
    }
  }

  private schedulePickerDismissListener(): void {
    this.cleanupPickerDismissListener();
    this.pickerDismissDelay = this.scene.time.delayedCall(120, () => {
      this.pickerDismissDelay = null;
      if (!this.pickerOpen) return;
      this.pickerDismissHandler = () => {
        if (!this.pickerOpen) return;
        this.closeColorPicker();
      };
      this.scene.input.once('pointerdown', this.pickerDismissHandler);
    });
  }

  private cleanupPickerDismissListener(): void {
    this.pickerDismissDelay?.destroy();
    this.pickerDismissDelay = null;
    if (this.pickerDismissHandler) {
      this.scene.input.off('pointerdown', this.pickerDismissHandler);
      this.pickerDismissHandler = null;
    }
  }

  // ── Arena-HUD Initialisation ─────────────────────────────────────────────

  private initArenaHUD(): void {
    const localId = this.bridge.getLocalPlayerId();

    // Player name + colour
    const players = this.bridge.getConnectedPlayers();
    const localProfile = players.find(p => p.id === localId);
    const name  = localProfile?.name ?? 'Spieler';
    const color = this.bridge.getPlayerColor(localId) ?? 0xffffff;
    this.arenaHUD.setPlayerInfo(name, color);

    // Loadout display names
    const w1Id  = this.bridge.getPlayerCommittedLoadoutSlot(localId, 'weapon1') ?? this.bridge.getPlayerLoadoutSlot(localId, 'weapon1');
    const w2Id  = this.bridge.getPlayerCommittedLoadoutSlot(localId, 'weapon2') ?? this.bridge.getPlayerLoadoutSlot(localId, 'weapon2');
    const utId  = this.bridge.getPlayerCommittedLoadoutSlot(localId, 'utility') ?? this.bridge.getPlayerLoadoutSlot(localId, 'utility');
    const ulId  = this.bridge.getPlayerCommittedLoadoutSlot(localId, 'ultimate') ?? this.bridge.getPlayerLoadoutSlot(localId, 'ultimate');

    const w1Name  = (w1Id && WEAPON_CONFIGS[w1Id as keyof typeof WEAPON_CONFIGS]?.displayName) ?? 'Glock';
    const w2Name  = (w2Id && WEAPON_CONFIGS[w2Id as keyof typeof WEAPON_CONFIGS]?.displayName) ?? 'P90';
    const utName  = (utId && UTILITY_CONFIGS[utId as keyof typeof UTILITY_CONFIGS]?.displayName) ?? 'Granate';
    const ulName  = (ulId && ULTIMATE_CONFIGS[ulId as keyof typeof ULTIMATE_CONFIGS]?.displayName) ?? 'Honigdachs-Wut';

    this.arenaHUD.setLoadoutNames(w1Name, w2Name, utName, ulName);

    // Weapon 2 adrenaline cost → tick marks on adrenaline bar
    const w2Cfg = w2Id ? WEAPON_CONFIGS[w2Id as keyof typeof WEAPON_CONFIGS] : undefined;
    this.arenaHUD.setAdrenalinTickCost(w2Cfg?.adrenalinCost ?? 0);
  }

  private applyStoredPlayerNamePreference(): void {
    const storedName = getStoredPlayerName();
    if (!storedName) return;
    this.bridge.setLocalName(storedName);
    this.localNameText?.setText(storedName);
  }

  private resolveInitialLoadoutId(slot: LoadoutSlot): string | null {
    const items = this.getSlotItems(slot);
    if (items.length === 0) return null;

    const localPlayerId = this.bridge.getLocalPlayerId();
    const currentBridgeId = this.bridge.getPlayerLoadoutSlot(localPlayerId, slot);
    if (currentBridgeId && items.some((item) => item.id === currentBridgeId)) return currentBridgeId;

    const storedId = getStoredLoadoutSlot(slot);
    if (storedId && items.some((item) => item.id === storedId)) return storedId;

    return items[0].id;
  }

  private applyLocalLoadoutSelection(slot: LoadoutSlot, itemId: string): void {
    this.bridge.setLocalLoadoutSlot(slot, itemId);
    setStoredLoadoutSlot(slot, itemId);
  }
}
