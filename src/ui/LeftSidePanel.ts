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
import { OptionsOverlay, type AbortMatchBinding, type SpectatorMatchBinding } from './OptionsOverlay';
import type { GraphicsQualityController } from '../graphics/GraphicsQuality';
import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS, DEFAULT_LOADOUT } from '../loadout/LoadoutConfig';
import {
  describeLoadoutItem,
  describeLoadoutTool,
  getSelectableLoadoutItems,
  loadoutToolKey,
  LOADOUT_SLOT_LABELS,
  type LoadoutItemRef,
} from '../loadout/LoadoutCatalog';
import { LivingBarEffect, paletteFromColor, createGradientTexture, ensureLivingBarTextures } from './LivingBarEffect';
import { ensureFlatPanelTexture, ensureGlassColumnTexture, ensureRoundedTexture, lerpColor } from './uiTextures';
import { attachHoverEffect } from './uiHover';
import { BORDER, FONT_DISPLAY, INTENT, RADIUS, SPACE, SURFACE, TEXT, textStyle } from './uiTheme';
import { getOverlayRoot } from './fullscreen';
import { BadgerPreview } from './BadgerPreview';
import type { HeldItemSlot } from '../loadout/HeldItemSlotTracker';
import type { CoopDefenseClassId, GameMode, LoadoutSlot, TeamId } from '../types';
import { getGameModeLabel, hasTeamSelection, isCoopDefenseMode, usesTeamColors } from '../gameModes';
import { getCoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { clampPlayerNameInput, PLAYER_NAME_MAX_LENGTH, sanitizePlayerName } from '../utils/playerName';
import {
  downloadStoredGameProgress,
  getStoredCoopDefenseLoadoutSlot,
  getStoredCoopDefenseProgress,
  getStoredCoopDefenseUpgradeProfile,
  getStoredHighestUnlockedCoopDefenseMapId,
  getStoredLoadoutSlot,
  getStoredPlayerName,
  importStoredGameProgressFile,
  setStoredCoopDefenseLoadoutSlot,
  setStoredCoopDefenseUpgradeProfile,
  setStoredLoadoutSlot,
  setStoredPlayerName,
} from '../utils/localPreferences';
import { getUnlockedCoopDefenseMapConfigs } from '../config/coopDefenseMapUnlocks';
import { formatTimeOfDay, MINUTES_PER_DAY } from '../effects/TimeOfDay';
import { UiContextMenu } from './UiContextMenu';
import { LOBBY_FRAME_BOUNDS, LOBBY_PANEL_WIDTH } from '../arena/MenuArenaPreviewConfig';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { toDesignSpace } from '../graphics/RenderResolution';
import { LoadoutSlotPicker, type LoadoutPickerEntry } from './LoadoutSlotPicker';
import { createLoadoutSlotControl } from './LoadoutSlotControl';
import {
  getCoopDefenseToolCapacity,
  getLoadoutToolSlots,
  getUnlockedLoadoutToolRefs,
  setLoadoutToolSlots,
} from '../utils/coopDefenseUpgrades';
import type { LoadoutToolRef } from '../types';

// ── Layout-Konstanten (innerhalb des linken Sidebars) ────────────────────────
const LOBBY_PANEL_W = LOBBY_SIDE_MENU_WIDTH;
const ARENA_PANEL_W = Math.round(DEFAULT_ARENA_OFFSET_X * 1.5);
const CENTER_X     = LOBBY_PANEL_W / 2;
const ARENA_CENTER_X = ARENA_PANEL_W / 2;
const LOBBY_TOP_OFFSET_Y = 246;
const UPPER_INFO_SPACING_STEP = LOBBY_SIDE_MENU_EXTRA_HEIGHT / 8;
const NAME_LABEL_Y = 60 + LOBBY_TOP_OFFSET_Y;
const NAME_VALUE_Y = 80 + LOBBY_TOP_OFFSET_Y;
const EDIT_BTN_Y   = 114 + LOBBY_TOP_OFFSET_Y + UPPER_INFO_SPACING_STEP;
const MODE_LABEL_Y = 162 + LOBBY_TOP_OFFSET_Y + UPPER_INFO_SPACING_STEP * 2;
const MODE_ROW_Y   = 180 + LOBBY_TOP_OFFSET_Y + UPPER_INFO_SPACING_STEP * 3;
const MAP_LABEL_Y  = 204 + LOBBY_TOP_OFFSET_Y + UPPER_INFO_SPACING_STEP * 4;
const MAP_ROW_Y    = 222 + LOBBY_TOP_OFFSET_Y + UPPER_INFO_SPACING_STEP * 5;
const DIVIDER1_Y   = MAP_ROW_Y + 42;
const BADGER_Y     = DIVIDER1_Y + 58;
const BADGER_SIZE        = 68;
const BADGER_CLICK_SIZE  = 76;
const DIVIDER2_Y         = BADGER_Y + BADGER_SIZE / 2 + 16;
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
const TIME_SLIDER_TRACK_W = 192;
const TIME_SLIDER_TRACK_X = CENTER_X - TIME_SLIDER_TRACK_W / 2;
const TIME_SLIDER_TRACK_Y = MAP_ROW_Y + 8;
const TIME_SLIDER_STEP_MINUTES = 15;

// Color-Picker-Popup (world-Koordinaten, separater Container)
const PICKER_PADDING  = 10;
const SWATCH_SIZE     = 32;
const SWATCH_GAP      = 4;
const PICKER_COLS     = 4;
const PICKER_GRID_W    = PICKER_COLS * SWATCH_SIZE + (PICKER_COLS - 1) * SWATCH_GAP;
const PICKER_W        = PICKER_PADDING * 2 + PICKER_GRID_W;
const PICKER_H        = 148;
const PICKER_WORLD_X  = (LOBBY_PANEL_W - PICKER_W) / 2;
const PICKER_WORLD_Y  = NAME_COLOR_ROW_Y + NAME_COLOR_BUTTON_H / 2 + 10;
const PICKER_GRID_Y   = 30;   // Y-Start des Gitters innerhalb des Popups
const TEX_SWATCH_PREFIX = '__picker_swatch_';

/** Sektionsbeschriftung ueber einem Bedienfeld – gesperrt und gedaempft, damit der Wert traegt. */
const LABEL_FONT = textStyle('section');
const NAME_FONT = textStyle('title', { color: COLORS.GREY_1 });
/** Ausgewaehlter Wert eines Karussells (Modus, Map, Loadout-Slot). */
const VALUE_FONT = textStyle('body', { color: TEXT.primary });

// ── Glasflaeche hinter der Spalte ────────────────────────────────────────────
// Ohne sie steht der Text direkt auf dem Gras der Menuevorschau. Die Flaeche schliesst buendig
// an den Felsrahmen an: aussen am Bildrand, oben unter der oberen Felszeile, unten an der
// unteren, und nach innen laeuft sie zur Felssaeule hin aus. Kanten aus `LOBBY_FRAME_BOUNDS`,
// damit sie dem Raster der Vorschau folgen statt eigener Schaetzwerte.
const GLASS_X = 0;
const GLASS_W = LOBBY_FRAME_BOUNDS.leftColumnRight;
const GLASS_Y = LOBBY_FRAME_BOUNDS.top;
const GLASS_H = LOBBY_FRAME_BOUNDS.bottom - LOBBY_FRAME_BOUNDS.top;

// ── Loadout-Karussell-Konstanten ──────────────────────────────────────────────
const CAROUSEL_START_Y  = DIVIDER2_Y + 18;
const CAROUSEL_ROW_STEP = 50;
const CAROUSEL_GROUP_DY = 46;
const LOADOUT_CONTROL_W = LOBBY_PANEL_W - 40;
const LOADOUT_CONTROL_H = 38;
const LOADOUT_POPUP_MARGIN = 12;
const LOADOUT_POPUP_SAFE_AREA = {
  left: LOADOUT_POPUP_MARGIN,
  top: LOADOUT_POPUP_MARGIN,
  right: GAME_WIDTH / 2 - LOBBY_PANEL_WIDTH / 2 - LOADOUT_POPUP_MARGIN,
  bottom: GAME_HEIGHT - LOADOUT_POPUP_MARGIN,
} as const;

// ── Hilfe-Button unter Loadout ────────────────────────────────────────────────
const ARROW_X_LEFT      = 20;
const ARROW_X_RIGHT     = LOBBY_PANEL_W - 20;
const ITEM_NAME_X       = CENTER_X;

const MODE_OPTIONS: readonly GameMode[] = ['deathmatch', 'team_deathmatch', 'capture_the_beer', 'coop_defense'];
const TEAM_OPTIONS: readonly TeamId[] = ['blue', 'red'];

function getTeamLabel(teamId: TeamId | null): string {
  if (teamId === 'blue') return 'Team Blau';
  if (teamId === 'red') return 'Team Rot';
  return 'Team wählen';
}

type LoadoutCarouselItem = LoadoutItemRef;

type CompactLabel = Phaser.GameObjects.Text | Phaser.GameObjects.Graphics;

type CompactButton = {
  button: Phaser.GameObjects.Image;
  label: CompactLabel;
  text?: Phaser.GameObjects.Text;
};

const SLOT_LABELS = LOADOUT_SLOT_LABELS;

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
  private saveMenu: UiContextMenu | null = null;
  private saveStatusText: Phaser.GameObjects.Text | null = null;
  private saveStatusTimer: Phaser.Time.TimerEvent | null = null;
  private editBtn:         Phaser.GameObjects.Image | null = null;
  private editBtnLabel:    Phaser.GameObjects.Text | null = null;
  private modeNameText:    Phaser.GameObjects.Text | null = null;
  private modeArrowButtons: { left: CompactButton; right: CompactButton } | null = null;
  private mapLabelText:    Phaser.GameObjects.Text | null = null;
  private mapNameText:     Phaser.GameObjects.Text | null = null;
  private mapArrowButtons: { left: CompactButton; right: CompactButton } | null = null;
  private timeSliderLabel: Phaser.GameObjects.Text | null = null;
  private timeSliderTrack: Phaser.GameObjects.Rectangle | null = null;
  private timeSliderFill: Phaser.GameObjects.Rectangle | null = null;
  private timeSliderThumb: Phaser.GameObjects.Arc | null = null;
  private timeSliderHitArea: Phaser.GameObjects.Rectangle | null = null;
  private timeSliderDragging = false;
  private timeSliderPointerMoveHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;
  private timeSliderPointerUpHandler: (() => void) | null = null;
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

  // Gemeinsame Loadout-Slots und Auswahl-Popup
  private loadoutIndices:   Record<LoadoutSlot, number> = { weapon1: 0, weapon2: 0, utility: 0, ultimate: 0 };
  /**
   * Slot, dessen Item die Lobby-Vorschau in den Pfoten zeigt: der zuletzt im Karussell geaenderte.
   * Das Ultimate zaehlt nicht mit – es ist keine Handwaffe und hat kein getragenes Bild.
   */
  private previewHeldSlot: HeldItemSlot = 'weapon1';
  private loadoutLayer: Phaser.GameObjects.Container | null = null;
  private loadoutPicker: LoadoutSlotPicker | null = null;
  private loadoutEnabled    = true;
  private lobbyFieldsLocked = false;
  private helpOverlay:      HelpOverlay | null = null;
  private optionsOverlay:   OptionsOverlay | null = null;
  // Wird vor dem Bau gesetzt, wenn der Lifecycle-Koordinator frueher fertig ist als das Panel.
  private abortMatchBinding: AbortMatchBinding | null = null;
  private spectatorMatchBinding: SpectatorMatchBinding | null = null;

  constructor(
    private scene:  Phaser.Scene,
    private bridge: NetworkBridge,
    private audioSystem: GameAudioSystem,
    private graphicsQuality: GraphicsQualityController,
    private readonly onProgressImported?: () => void,
  ) {}

  // ── Aufbau ─────────────────────────────────────────────────────────────────

  build(): void {
    // ── gameContainer (ArenaHUD, initial off-screen oben) ─────────────────────
    this.gameContainer = this.scene.add.container(0, -GAME_HEIGHT);
    this.gameContainer.setDepth(DEPTH.OVERLAY - 1).setVisible(false).setActive(false);
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
    this.arenaHUD.setPresentationActive(false);

    // ── lobbyContainer (Namens- und Farbsektion, initial on-screen) ───────────
    const objects: Phaser.GameObjects.GameObject[] = [];

    // Zuerst eingehaengt: liegt hinter allem Uebrigen.
    objects.push(
      this.scene.add.image(
        GLASS_X + GLASS_W / 2, GLASS_Y + GLASS_H / 2,
        ensureGlassColumnTexture(this.scene, '_lobby_glass_left', GLASS_W, GLASS_H, COLORS.GREY_9, 'right'),
      ).setScrollFactor(0),
    );

    objects.push(
      this.scene.add.text(CENTER_X, NAME_LABEL_Y, 'SPIELER', LABEL_FONT)
        .setOrigin(0.5, 0)
        .setScrollFactor(0),
    );

    this.localNameText = this.scene.add.text(CENTER_X, NAME_VALUE_Y, '', NAME_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', (pointer: Phaser.Input.Pointer) => this.openSaveMenu(pointer));
    objects.push(this.localNameText);

    this.saveStatusText = this.scene.add.text(CENTER_X, NAME_VALUE_Y + 31, '',
      textStyle('micro', { color: COLORS.GREEN_3 }))
      .setOrigin(0.5, 0).setScrollFactor(0).setVisible(false);
    objects.push(this.saveStatusText);

    const editControl = this.createCompactButton(
      NAME_BUTTON_X,
      NAME_COLOR_ROW_Y,
      'NAME ÄNDERN',
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
      'FARBE ÄNDERN',
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
      this.scene.add.text(CENTER_X, MODE_LABEL_Y, 'SPIELMODUS', LABEL_FONT)
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
      ...VALUE_FONT,
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

    const mapLabelText = this.scene.add.text(CENTER_X, MAP_LABEL_Y, 'MAP', LABEL_FONT)
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
      ...VALUE_FONT,
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

    const timeSliderLabel = this.scene.add.text(
      CENTER_X,
      MAP_LABEL_Y,
      `Uhrzeit: ${formatTimeOfDay(this.bridge.getLobbyTimeOfDayMinutes())}`,
      LABEL_FONT,
    )
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    this.timeSliderLabel = timeSliderLabel;
    objects.push(timeSliderLabel);

    const timeSliderTrack = this.scene.add.rectangle(
      TIME_SLIDER_TRACK_X,
      TIME_SLIDER_TRACK_Y,
      TIME_SLIDER_TRACK_W,
      7,
      COLORS.GREY_8,
      0.95,
    ).setOrigin(0, 0.5).setStrokeStyle(1, COLORS.GREY_6, 0.8).setScrollFactor(0);
    this.timeSliderTrack = timeSliderTrack;
    objects.push(timeSliderTrack);

    const timeSliderFill = this.scene.add.rectangle(
      TIME_SLIDER_TRACK_X,
      TIME_SLIDER_TRACK_Y,
      1,
      5,
      COLORS.BLUE_4,
      0.9,
    ).setOrigin(0, 0.5).setScrollFactor(0);
    this.timeSliderFill = timeSliderFill;
    objects.push(timeSliderFill);

    const timeSliderThumb = this.scene.add.circle(
      TIME_SLIDER_TRACK_X,
      TIME_SLIDER_TRACK_Y,
      7,
      COLORS.GREY_3,
      1,
    ).setStrokeStyle(1, COLORS.BLUE_2, 1).setScrollFactor(0);
    this.timeSliderThumb = timeSliderThumb;
    objects.push(timeSliderThumb);

    const timeSliderHitArea = this.scene.add.rectangle(
      TIME_SLIDER_TRACK_X,
      TIME_SLIDER_TRACK_Y,
      TIME_SLIDER_TRACK_W,
      28,
      0x000000,
      0,
    ).setOrigin(0, 0.5).setInteractive({ useHandCursor: true }).setScrollFactor(0);
    timeSliderHitArea.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.isTimeSliderEnabled()) return;
      this.timeSliderDragging = true;
      this.applyTimeSliderPointer(pointer.x);
    });
    this.timeSliderHitArea = timeSliderHitArea;
    objects.push(timeSliderHitArea);

    this.timeSliderPointerMoveHandler = (pointer: Phaser.Input.Pointer) => {
      if (this.timeSliderDragging) this.applyTimeSliderPointer(pointer.x);
    };
    this.timeSliderPointerUpHandler = () => {
      this.timeSliderDragging = false;
    };
    this.scene.input.on('pointermove', this.timeSliderPointerMoveHandler);
    this.scene.input.on('pointerup', this.timeSliderPointerUpHandler);

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
      this.scene.add.text(CENTER_X, CAROUSEL_START_Y, 'AUSRÜSTUNG', LABEL_FONT)
        .setOrigin(0.5, 0)
        .setScrollFactor(0),
    );

    this.applyStoredPlayerNamePreference();
    this.loadoutLayer = this.scene.add.container(0, 0).setScrollFactor(0);
    objects.push(this.loadoutLayer);

    this.lobbyContainer = this.scene.add.container(0, 0, objects);
    this.lobbyContainer.setDepth(DEPTH.OVERLAY - 1);
    this.saveMenu = new UiContextMenu(this.scene, this.lobbyContainer);
    this.loadoutPicker = new LoadoutSlotPicker(this.scene, this.lobbyContainer, DEPTH.OVERLAY + 2);

    // BadgerPreview (world-space, separate from container for preFX support)
    this.badgerPreview = new BadgerPreview(
      this.scene,
      CENTER_X,
      BADGER_Y,
      0x888888,
      BADGER_SIZE,
      // Das Bild der getragenen Waffe entsteht erst beim ersten Item und verpasst deshalb die
      // Kamerazuordnung weiter unten im Aufbaupfad.
      (image) => promoteToClarityCamera(this.scene, image),
    );
    this.badgerPreview.setScrollFactor(0);
    this.badgerPreview.setDepth(DEPTH.OVERLAY);

    // ── Picker-Popup (world-space, über LobbyOverlay) ─────────────────────────
    this.pickerContainer = this.buildPickerContainer();
    this.pickerContainer.setVisible(false);

    // Klarheitskamera: dieses Panel ist HUD und darf von der Bildkomposition der Welt nicht
    // erfasst werden. `puContainer` und `pickerContainer` sind eigene Wurzeln, kein Kind von
    // `gameContainer` – sie brauchen deshalb je einen eigenen Aufruf.
    promoteToClarityCamera(this.scene, this.gameContainer);
    promoteToClarityCamera(this.scene, this.puContainer);
    promoteToClarityCamera(this.scene, this.lobbyContainer);
    promoteToClarityCamera(this.scene, this.pickerContainer);
    promoteToClarityCamera(this.scene, this.badgerPreview.sprite);

    // ── Hilfe-Overlay (world-space, über allem) ───────────────────────────────
    this.helpOverlay = new HelpOverlay(this.scene);
    this.helpOverlay.build();
    this.optionsOverlay = new OptionsOverlay(this.scene, this.audioSystem, this.graphicsQuality);
    this.optionsOverlay.build();
    this.optionsOverlay.setAbortMatchBinding(this.abortMatchBinding);
    this.optionsOverlay.setSpectatorMatchBinding(this.spectatorMatchBinding);
    this.setLobbyFieldsLocked(false);
    this.refreshColorIndicator();
  }

  getPuContainer(): Phaser.GameObjects.Container { return this.puContainer; }

  /** Reicht den Host-Abbruch der laufenden Partie an das Optionsmenue durch. */
  setAbortMatchBinding(binding: AbortMatchBinding | null): void {
    this.abortMatchBinding = binding;
    this.optionsOverlay?.setAbortMatchBinding(binding);
  }

  /** Reicht den freiwilligen Rollenwechsel in den Spectator-Modus durch. */
  setSpectatorMatchBinding(binding: SpectatorMatchBinding | null): void {
    this.spectatorMatchBinding = binding;
    this.optionsOverlay?.setSpectatorMatchBinding(binding);
  }

  toggleOptionsOverlay(): void {
    this.optionsOverlay?.toggle();
  }

  showOptionsOverlay(): void {
    this.optionsOverlay?.show();
  }

  showHelpOverlay(): void {
    this.helpOverlay?.show();
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
    return this.nameEditOpen || this.pickerOpen || (this.loadoutPicker?.isOpen() ?? false)
      || (this.saveMenu?.isOpen() ?? false);
  }

  // ── Transitions ────────────────────────────────────────────────────────────

  transitionToGame(): void {
    this.saveMenu?.close();
    this.loadoutPicker?.close();
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
    this.gameContainer.setVisible(false).setActive(false);
    this.arenaHUD.setPresentationActive(false);

    this.scene.tweens.add({
      targets:  this.lobbyContainer,
      y:        GAME_HEIGHT,
      duration: 350,
      ease:     'Power2.easeIn',
    });
    this.pendingDelay = null;
  }

  transitionToLobby(): void {
    this.loadoutPicker?.close();
    this.helpOverlay?.hide();
    this.optionsOverlay?.hide();
    this.scene.tweens.killTweensOf(this.lobbyContainer);
    this.scene.tweens.killTweensOf(this.gameContainer);
    this.pendingDelay?.remove();

    this.arenaHUD.reset();
    this.arenaHUD.setPresentationActive(false);
    this.arenaOverlayVisible = false;
    this.badgerPreview?.setVisible(true);
    this.puContainer.setVisible(false);

    this.scene.tweens.add({
      targets:  this.gameContainer,
      y:        -GAME_HEIGHT,
      duration: 350,
      ease:     'Power2.easeIn',
      onComplete: () => this.gameContainer.setVisible(false).setActive(false),
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

    if (visible) {
      this.gameContainer.setVisible(true).setActive(true);
      this.arenaHUD.setPresentationActive(true);
    } else {
      this.arenaHUD.setPresentationActive(false);
    }

    if (immediate) {
      this.gameContainer.y = targetY;
      this.gameContainer.setVisible(visible).setActive(visible);
      return;
    }

    this.scene.tweens.add({
      targets: this.gameContainer,
      y: targetY,
      duration: visible ? 220 : 180,
      ease: visible ? 'Back.easeOut' : 'Power2.easeIn',
      onComplete: () => {
        if (!visible && !this.arenaOverlayVisible) {
          this.gameContainer.setVisible(false).setActive(false);
        }
      },
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
    if (this.arenaOverlayVisible) this.arenaHUD.flashSlot(slot);
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
    this.refreshBadgerHeldItem();
    this.updateModeSelectorState();
    this.updateMapSelectorState(mode);
    this.updateTeamSelectorState(mode, teamId);
  }

  /** Per-frame lobby update: rotate badger towards mouse. */
  updateLobby(): void {
    if (this.badgerPreview) {
      const pointer = this.scene.input.activePointer;
      // The sprite is fixed to the clarity camera in design space; pointer coordinates are
      // render pixels and must be converted before comparing them with the sprite position.
      const angle = Phaser.Math.Angle.Between(
        CENTER_X, BADGER_Y,
        toDesignSpace(this.scene.scale, pointer.x),
        toDesignSpace(this.scene.scale, pointer.y),
      );
      this.badgerPreview.setRotation(angle);
    }
    this.refreshTimeSlider();
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
    if (this.timeSliderPointerMoveHandler) {
      this.scene.input.off('pointermove', this.timeSliderPointerMoveHandler);
      this.timeSliderPointerMoveHandler = null;
    }
    if (this.timeSliderPointerUpHandler) {
      this.scene.input.off('pointerup', this.timeSliderPointerUpHandler);
      this.timeSliderPointerUpHandler = null;
    }
    this.timeSliderDragging = false;
    this.closeNameEditPopup();
    this.saveStatusTimer?.remove();
    this.saveStatusTimer = null;
    this.saveMenu?.destroy();
    this.saveMenu = null;
    this.loadoutPicker?.close();
    this.loadoutPicker = null;
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
        .image(0, 0, ensureFlatPanelTexture(
          this.scene, '__picker_panel', PICKER_W, PICKER_H, SURFACE.modal, BORDER.subtle,
          { radius: RADIUS.md, fillAlpha: 0.98, strokeAlpha: 0.9 },
        ))
        .setOrigin(0, 0),
    );

    // Titel
    objects.push(
      this.scene.add
        .text(PICKER_PADDING, PICKER_PADDING, 'FARBE WÄHLEN', textStyle('section')),
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
        .on('pointerover', () => { if (bg.alpha > 0.5) bg.setStrokeStyle(2, BORDER.default, 1); })
        .on('pointerout',  () => this.refreshPickerSwatches())
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
      bg.setStrokeStyle(
        isOwn ? 2 : 1,
        isOwn ? TEXT.primary : BORDER.subtle,
        isOwn ? 1 : (isClickable ? 0.85 : 0.35),
      );

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

  /**
   * Zeigt in der Vorschau das Item des zuletzt geaenderten Slots. Wird auch ohne Karussell-Klick
   * gerufen, weil ein Moduswechsel oder ein importierter Spielstand die Auswahl ersetzen kann.
   */
  private refreshBadgerHeldItem(): void {
    const localId = this.bridge.getLocalPlayerId();
    const itemId = this.bridge.getPlayerLoadoutSlot(localId, this.previewHeldSlot) ?? null;
    this.badgerPreview?.setHeldItemId(itemId);
  }

  private updateCarouselDisplay(slot: LoadoutSlot): void {
    const items = this.getSlotItems(slot);
    if (items.length === 0) {
      this.loadoutIndices[slot] = 0;
      this.renderLoadoutControls();
      return;
    }
    const nextIndex = Phaser.Math.Clamp(this.loadoutIndices[slot], 0, items.length - 1);
    this.loadoutIndices[slot] = nextIndex;
    this.renderLoadoutControls();
  }

  private renderLoadoutControls(): void {
    if (!this.loadoutLayer) return;
    this.loadoutLayer.removeAll(true);
    const inspector = this.isInspectorLoadout();
    const rowSlots: readonly LoadoutSlot[] = inspector
      ? ['weapon1', 'weapon2', 'ultimate']
      : ['weapon1', 'weapon2', 'utility', 'ultimate'];

    rowSlots.forEach((slot, visibleIndex) => {
      const rowIndex = inspector && slot === 'ultimate' ? 3 : visibleIndex;
      const items = this.getSlotItems(slot);
      const item = items[this.loadoutIndices[slot]] ?? null;
      this.loadoutLayer!.add(createLoadoutSlotControl(this.scene, {
        x: CENTER_X,
        y: CAROUSEL_START_Y + CAROUSEL_GROUP_DY + rowIndex * CAROUSEL_ROW_STEP,
        width: LOADOUT_CONTROL_W,
        height: LOADOUT_CONTROL_H,
        accentColor: item ? describeLoadoutItem(slot, item.id).accentColor : COLORS.GREY_5,
        presentation: item ? describeLoadoutItem(slot, item.id) : null,
        label: SLOT_LABELS[slot],
        enabled: this.loadoutEnabled && !this.lobbyFieldsLocked,
        onClick: (anchorX) => this.openLoadoutSlotPicker(slot, anchorX),
      }));
    });

    if (inspector) this.renderInspectorToolSlots();
  }

  private openLoadoutSlotPicker(slot: LoadoutSlot, anchorX: number): void {
    if (!this.loadoutEnabled || this.lobbyFieldsLocked) return;
    const items = this.getSlotItems(slot);
    const selectedId = items[this.loadoutIndices[slot]]?.id ?? null;
    const entries: LoadoutPickerEntry[] = items.map((item) => {
      const presentation = describeLoadoutItem(slot, item.id);
      return {
        key: item.id,
        displayName: presentation.displayName,
        textureKey: presentation.textureKey,
        accentColor: presentation.accentColor,
        selected: item.id === selectedId,
        disabled: false,
        onPick: () => {
          const index = items.findIndex((candidate) => candidate.id === item.id);
          this.loadoutIndices[slot] = Math.max(0, index);
          this.applyLocalLoadoutSelection(slot, item.id);
          if (slot !== 'ultimate') this.previewHeldSlot = slot;
          this.refreshBadgerHeldItem();
          this.renderLoadoutControls();
        },
      };
    });
    this.loadoutPicker?.open({
      anchorX,
      anchorY: CAROUSEL_START_Y + CAROUSEL_GROUP_DY + LOADOUT_CONTROL_H / 2 + 6,
      title: SLOT_LABELS[slot],
      groups: [{ label: null, entries }],
      maxColumns: 2,
      safeArea: LOADOUT_POPUP_SAFE_AREA,
    });
  }

  private isInspectorLoadout(): boolean {
    const progress = getStoredCoopDefenseProgress();
    return isCoopDefenseMode(this.bridge.getGameMode())
      && progress.unlockedClassIds.includes('inspector_gadachs')
      && progress.selectedClassId === 'inspector_gadachs';
  }

  private renderInspectorToolSlots(): void {
    if (!this.loadoutLayer) return;
    const profile = getStoredCoopDefenseUpgradeProfile('inspector_gadachs');
    const tools = getLoadoutToolSlots(profile);
    const capacity = Math.max(1, getCoopDefenseToolCapacity(profile));
    const rowY = CAROUSEL_START_Y + CAROUSEL_GROUP_DY + 2 * CAROUSEL_ROW_STEP;
    this.loadoutLayer.add(this.scene.add.text(20, rowY, 'UTILITY-RAD', textStyle('caption', {
      color: COLORS.GREY_3,
    })).setOrigin(0, 0.5).setScrollFactor(0));
    const availableW = LOBBY_PANEL_W - 126;
    const gap = 4;
    const size = Math.min(34, (availableW - gap * (capacity - 1)) / capacity);
    const startX = 112 + size / 2;
    for (let index = 0; index < capacity; index += 1) {
      const tool = tools[index] ?? null;
      this.loadoutLayer.add(createLoadoutSlotControl(this.scene, {
        x: startX + index * (size + gap),
        y: rowY,
        width: size,
        height: size,
        accentColor: COLORS.GOLD_2,
        presentation: tool ? describeLoadoutTool(tool) : null,
        compact: true,
        enabled: this.loadoutEnabled && !this.lobbyFieldsLocked,
        onClick: (anchorX) => this.openInspectorToolPicker(index, anchorX),
      }));
    }
  }

  private openInspectorToolPicker(slotIndex: number, anchorX: number): void {
    const profile = getStoredCoopDefenseUpgradeProfile('inspector_gadachs');
    const tools = [...getLoadoutToolSlots(profile)];
    const current = tools[slotIndex] ?? null;
    const currentKey = loadoutToolKey(current);
    const equippedKeys = new Set(tools.map((tool) => loadoutToolKey(tool)));
    const entries = getUnlockedLoadoutToolRefs(profile).map((tool): LoadoutPickerEntry => {
      const presentation = describeLoadoutTool(tool);
      const key = loadoutToolKey(tool);
      return {
        key,
        displayName: presentation.displayName,
        textureKey: presentation.textureKey,
        accentColor: presentation.accentColor,
        selected: key === currentKey,
        disabled: key !== currentKey && equippedKeys.has(key),
        onPick: () => this.persistInspectorToolSlot(profile, tools, slotIndex, tool),
      };
    });
    this.loadoutPicker?.open({
      anchorX,
      anchorY: CAROUSEL_START_Y + CAROUSEL_GROUP_DY + 2 * CAROUSEL_ROW_STEP + 24,
      title: `Utility-Slot ${slotIndex + 1}`,
      groups: [{ label: null, entries }],
      maxColumns: 2,
      safeArea: LOADOUT_POPUP_SAFE_AREA,
      clearLabel: current ? 'Slot leeren' : undefined,
      onClear: current
        ? () => this.persistInspectorToolSlot(profile, tools, slotIndex, null)
        : undefined,
    });
  }

  private persistInspectorToolSlot(
    profile: ReturnType<typeof getStoredCoopDefenseUpgradeProfile>,
    currentTools: readonly LoadoutToolRef[],
    slotIndex: number,
    tool: LoadoutToolRef | null,
  ): void {
    const next = [...currentTools];
    if (tool) {
      if (slotIndex < next.length) next[slotIndex] = tool;
      else next.push(tool);
    } else if (slotIndex < next.length) {
      next.splice(slotIndex, 1);
    }
    const selected = tool ?? next[Math.min(slotIndex, next.length - 1)] ?? null;
    setStoredCoopDefenseUpgradeProfile(setLoadoutToolSlots(profile, next, selected), 'inspector_gadachs');
    this.onProgressImported?.();
    this.renderLoadoutControls();
  }

  private getSlotItems(slot: LoadoutSlot): readonly LoadoutCarouselItem[] {
    const mode = this.bridge.getGameMode();
    if (!isCoopDefenseMode(mode)) return getSelectableLoadoutItems(slot, mode, null, 'dachs_nukem');

    const storedProgress = getStoredCoopDefenseProgress();
    const classesUnlocked = storedProgress.unlockedClassIds.length > 0;
    const classId = classesUnlocked
      ? storedProgress.selectedClassId
      : 'dachs_nukem';
    const profile = classesUnlocked
      ? getStoredCoopDefenseUpgradeProfile(storedProgress.selectedClassId)
      : storedProgress.defaultProfile;
    // Nur der Utility-Slot des Inspectors wird ueber seine geteilten Werkzeug-Slots belegt.
    // Waffe 2 bleibt ein regulaerer Slot und zeigt seine Klassenwaffe an.
    if (classesUnlocked && classId === 'inspector_gadachs' && slot === 'utility') {
      return [{
        id: DEFAULT_LOADOUT[slot].id,
        displayName: 'Utility-Rad (R)',
      }];
    }
    return getSelectableLoadoutItems(
      slot,
      mode,
      profile,
      classId,
    );
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
      this.renderLoadoutControls();
      return;
    }

    const localId = this.bridge.getLocalPlayerId();
    const selectedId = this.bridge.getPlayerLoadoutSlot(localId, slot);
    const activeClassId = this.getActiveCoopDefenseLoadoutClassId();
    const storedId = activeClassId
      ? getStoredCoopDefenseLoadoutSlot(activeClassId, slot)
      : null;
    const preferredId = storedId && items.some((item) => item.id === storedId)
      ? storedId
      : selectedId;
    const nextIndex = items.findIndex((item) => item.id === preferredId);
    if (nextIndex >= 0) {
      if (this.loadoutIndices[slot] !== nextIndex) {
        this.loadoutIndices[slot] = nextIndex;
        this.persistStoredLoadoutSlot(slot, items[nextIndex].id);
      }
      this.updateCarouselDisplay(slot);
      if (preferredId !== selectedId) {
        this.applyLocalLoadoutSelection(slot, items[nextIndex].id);
      }
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
      backgroundColor: toCssColor(SURFACE.modal),
      border:          `1px solid ${toCssColor(BORDER.default)}`,
      borderRadius:    `${RADIUS.md}px`,
      boxShadow:       '0 12px 28px rgba(0, 0, 0, 0.32)',
      padding:         `${SPACE.md}px`,
      display:         'flex',
      flexDirection:   'row',
      gap:             `${SPACE.sm}px`,
      alignItems:      'center',
      zIndex:          '1000',
      fontFamily:      FONT_DISPLAY,
    });

    const inputElement = document.createElement('input');
    inputElement.type  = 'text';
    inputElement.value = currentName;
    inputElement.maxLength = PLAYER_NAME_MAX_LENGTH;
    Object.assign(inputElement.style, {
      fontSize:        '15px',
      padding:         `${SPACE.sm}px ${SPACE.md}px`,
      border:          `1px solid ${toCssColor(BORDER.subtle)}`,
      borderRadius:    `${RADIUS.sm}px`,
      backgroundColor: toCssColor(SURFACE.sunken),
      color:           toCssColor(TEXT.primary),
      outline:         'none',
      width:           '160px',
      fontFamily:      FONT_DISPLAY,
      fontWeight:      'bold',
    });

    const confirmBtn     = document.createElement('button');
    confirmBtn.innerText = 'OK';
    Object.assign(confirmBtn.style, {
      padding:         `${SPACE.sm}px ${SPACE.md}px`,
      fontSize:        '13px',
      cursor:          'pointer',
      backgroundColor: toCssColor(INTENT.primary.fill),
      color:           toCssColor(INTENT.primary.label),
      border:          `1px solid ${toCssColor(INTENT.primary.stroke)}`,
      borderRadius:    `${RADIUS.sm}px`,
      fontFamily:      FONT_DISPLAY,
      fontWeight:      'bold',
    });

    const cancelBtn     = document.createElement('button');
    cancelBtn.innerText = 'X';
    Object.assign(cancelBtn.style, {
      padding:         `${SPACE.sm}px ${SPACE.md}px`,
      fontSize:        '13px',
      cursor:          'pointer',
      backgroundColor: toCssColor(INTENT.ghost.fill),
      color:           toCssColor(INTENT.ghost.label),
      border:          `1px solid ${toCssColor(INTENT.ghost.stroke)}`,
      borderRadius:    `${RADIUS.sm}px`,
      fontFamily:      FONT_DISPLAY,
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
    // Bedienelemente der Spalte sind Nebenwege: ghost, damit sie den Handlungsaufruf im
    // Zentrum nicht ueberstimmen. Der Intent gehoert in den Schluessel – ohne ihn teilten sich
    // alle gleich grossen Kompaktbuttons zwangslaeufig eine Textur.
    const spec = INTENT.ghost;
    const textureKey = `_lsp_compact_btn_ghost_${width}x${height}`;
    const button = this.scene.add.image(
      x,
      y,
      ensureRoundedTexture(this.scene, {
        key: textureKey,
        w: width,
        h: height,
        radius: RADIUS.sm,
        topColor: lerpColor(spec.fill, 0xffffff, 0.16),
        bottomColor: lerpColor(spec.fill, 0x000000, 0.3),
        fillAlpha: spec.fillAlpha,
        strokeColor: spec.stroke,
        strokeAlpha: spec.strokeAlpha,
        strokeWidth: 1.5,
        highlightAlpha: spec.gloss,
      }),
    )
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onClick)
      .setScrollFactor(0);
    const label: CompactLabel = iconDirection
      ? this.createChevronIcon(x, y, iconDirection)
      : this.scene.add.text(x, y + labelOffsetY, labelText, textStyle('labelSm', {
        color: spec.label,
      })).setOrigin(0.5).setScrollFactor(0);
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
    icon.lineStyle(1.8, INTENT.ghost.label, 1);
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
      .setText('FARBE ÄNDERN');
    if (enabled) this.colorEditBtn?.setInteractive({ useHandCursor: true });
    else this.colorEditBtn?.disableInteractive();
  }

  private updateLoadoutArrowVisibility(): void {
    this.loadoutPicker?.close();
    this.renderLoadoutControls();
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

    const showTimeHeader = !showMapSelector;
    const showTimeSlider = showTimeHeader && isHost;
    const timeEnabled = showTimeSlider && !this.lobbyFieldsLocked;
    const timeAlpha = timeEnabled ? 1 : 0.42;
    this.timeSliderLabel?.setVisible(showTimeHeader).setAlpha(showTimeHeader ? 1 : 0);
    this.timeSliderTrack?.setVisible(showTimeSlider).setAlpha(timeAlpha);
    this.timeSliderFill?.setVisible(showTimeSlider).setAlpha(timeAlpha);
    this.timeSliderThumb?.setVisible(showTimeSlider).setAlpha(timeAlpha);
    this.timeSliderHitArea?.setVisible(showTimeSlider);
    if (timeEnabled) this.timeSliderHitArea?.setInteractive({ useHandCursor: true });
    else this.timeSliderHitArea?.disableInteractive();
    if (!timeEnabled) this.timeSliderDragging = false;
    this.refreshTimeSlider();
  }

  private isTimeSliderEnabled(): boolean {
    return !this.lobbyFieldsLocked
      && this.bridge.isHost()
      && !isCoopDefenseMode(this.bridge.getGameMode());
  }

  private refreshTimeSlider(): void {
    const minutes = this.bridge.getLobbyTimeOfDayMinutes();
    const fraction = minutes / MINUTES_PER_DAY;
    this.timeSliderLabel?.setText(`Uhrzeit: ${formatTimeOfDay(minutes)}`);
    this.timeSliderFill?.setDisplaySize(Math.max(1, TIME_SLIDER_TRACK_W * fraction), 5);
    this.timeSliderThumb?.setPosition(
      TIME_SLIDER_TRACK_X + TIME_SLIDER_TRACK_W * fraction,
      TIME_SLIDER_TRACK_Y,
    );
  }

  private applyTimeSliderPointer(pointerX: number): void {
    if (!this.isTimeSliderEnabled()) return;
    const fraction = Phaser.Math.Clamp(
      (pointerX - TIME_SLIDER_TRACK_X) / TIME_SLIDER_TRACK_W,
      0,
      1,
    );
    const maxStep = Math.floor((MINUTES_PER_DAY - TIME_SLIDER_STEP_MINUTES) / TIME_SLIDER_STEP_MINUTES);
    const step = Phaser.Math.Clamp(
      Math.round(fraction * maxStep),
      0,
      maxStep,
    );
    this.bridge.setLobbyTimeOfDayMinutes(step * TIME_SLIDER_STEP_MINUTES);
    this.refreshTimeSlider();
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
    const activeClassId = this.getActiveCoopDefenseLoadoutClassId();
    const storedId = activeClassId
      ? getStoredCoopDefenseLoadoutSlot(activeClassId, slot)
      : getStoredLoadoutSlot(slot);
    if (storedId && items.some((item) => item.id === storedId)) return storedId;
    if (currentBridgeId && items.some((item) => item.id === currentBridgeId)) return currentBridgeId;

    return items[0].id;
  }

  private openSaveMenu(pointer: Phaser.Input.Pointer): void {
    if (this.lobbyFieldsLocked) return;
    this.saveMenu?.open({
      x: pointer.x,
      y: pointer.y,
      title: 'Lokaler Spielstand',
      titleColor: COLORS.GOLD_1,
      entries: [
        {
          label: 'Spielstand exportieren',
          color: COLORS.GREEN_3,
          onPick: () => this.showSaveStatus(downloadStoredGameProgress()),
        },
        {
          label: 'Spielstand importieren',
          color: COLORS.BLUE_2,
          onPick: () => { void this.importSaveFile(); },
        },
      ],
    });
  }

  private async importSaveFile(): Promise<void> {
    const result = await importStoredGameProgressFile();
    if (result.ok) {
      this.applyStoredPlayerNamePreference();
      this.syncAllLoadoutSelections();
      this.onProgressImported?.();
      this.refreshColorIndicator();
    }
    this.showSaveStatus(result);
  }

  private showSaveStatus(result: { ok: boolean; message: string }): void {
    this.saveStatusTimer?.remove();
    this.saveStatusText
      ?.setText(result.message)
      .setColor(toCssColor(result.ok ? COLORS.GREEN_3 : COLORS.RED_3))
      .setVisible(true);
    this.saveStatusTimer = this.scene.time.delayedCall(4_000, () => {
      this.saveStatusText?.setVisible(false);
      this.saveStatusTimer = null;
    });
  }

  private applyLocalLoadoutSelection(slot: LoadoutSlot, itemId: string): void {
    this.bridge.setLocalLoadoutSlot(slot, itemId);
    this.persistStoredLoadoutSlot(slot, itemId);
  }

  private getActiveCoopDefenseLoadoutClassId(): CoopDefenseClassId | null {
    if (!isCoopDefenseMode(this.bridge.getGameMode())) return null;
    const storedProgress = getStoredCoopDefenseProgress();
    return storedProgress.unlockedClassIds.length > 0 ? storedProgress.selectedClassId : null;
  }

  private persistStoredLoadoutSlot(slot: LoadoutSlot, itemId: string): void {
    const activeClassId = this.getActiveCoopDefenseLoadoutClassId();
    if (activeClassId) {
      setStoredCoopDefenseLoadoutSlot(activeClassId, slot, itemId);
    } else {
      setStoredLoadoutSlot(slot, itemId);
    }
  }
}
