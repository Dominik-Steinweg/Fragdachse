/**
 * LeftSidePanel – linker Seitenbereich (x=0..240) für Lobby- und Arena-Phase.
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
import type { ArenaHUDData } from './ArenaHUD';
import { GAME_WIDTH, GAME_HEIGHT, DEPTH, COLORS, PLAYER_COLORS, toCssColor } from '../config';
import { HelpOverlay } from './HelpOverlay';
import { OptionsOverlay } from './OptionsOverlay';
import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS, getAvailableUltimateConfigs } from '../loadout/LoadoutConfig';
import { LivingBarEffect, paletteFromColor, createGradientTexture, ensureLivingBarTextures } from './LivingBarEffect';
import { BadgerPreview } from './BadgerPreview';
import type { GameMode, LoadoutSlot, TeamId } from '../types';
import { getGameModeLabel, isTeamGameMode } from '../gameModes';
import { clampPlayerNameInput, PLAYER_NAME_MAX_LENGTH, sanitizePlayerName } from '../utils/playerName';
import { getStoredLoadoutSlot, getStoredPlayerName, setStoredLoadoutSlot, setStoredPlayerName } from '../utils/localPreferences';

// ── Layout-Konstanten (innerhalb des 240px-Sidebars) ─────────────────────────
const CENTER_X     = 120;  // Mitte des 240px Sidebars
const NAME_LABEL_Y = 60;
const NAME_VALUE_Y = 80;
const EDIT_BTN_Y   = 114;
const MODE_LABEL_Y = 132;
const MODE_ROW_Y   = 150;
const DIVIDER1_Y   = 176;  // Trennlinie zwischen Name-/Modus-Sektion und Dachs
const BADGER_Y     = 222;  // Dachs-Sprite-Mitte
const DIVIDER2_Y   = 286;  // Trennlinie zwischen Dachs und Loadout
const BADGER_SIZE        = 48;   // Anzeigegröße
const BADGER_CLICK_SIZE  = 56;   // Klickbare Fläche
const TEAM_SELECT_Y      = BADGER_Y + BADGER_SIZE / 2 + 6;

// Color-Picker-Popup (world-Koordinaten, separater Container)
const PICKER_WORLD_X  = 12;
const PICKER_WORLD_Y  = 238;
const PICKER_W        = 188;
const PICKER_H        = 148;
const PICKER_PADDING  = 10;
const SWATCH_SIZE     = 32;
const SWATCH_GAP      = 4;
const PICKER_COLS     = 4;
const PICKER_GRID_Y   = 30;   // Y-Start des Gitters innerhalb des Popups
const TEX_SWATCH_PREFIX = '__picker_swatch_';

const LABEL_FONT = { fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_2) };
const NAME_FONT  = { fontSize: '26px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1), fontStyle: 'bold' as const };
const EDIT_FONT  = { fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.BLUE_1) };

// ── Loadout-Karussell-Konstanten ──────────────────────────────────────────────
const CAROUSEL_START_Y  = 312;   // Y des "Loadout:"-Labels
const CAROUSEL_ROW_STEP = 52;    // Abstand zwischen Slot-Gruppen (Pfeile + Label unten)
const CAROUSEL_GROUP_DY = 20;    // Offset erste Karussell-Zeile unter "Loadout:"
const CAROUSEL_LABEL_DY = 20;    // Slot-Label-Offset UNTER den Pfeilen

// ── Hilfe-Button unter Loadout ────────────────────────────────────────────────
const DIVIDER3_Y  = 536;  // Trennlinie unter Loadout
const MENU_BTN_Y  = 566;
const MENU_BTN_W  = 92;
const MENU_BTN_H  = 34;
const OPTIONS_BTN_X = 70;
const HELP_BTN_X = 170;
const ARROW_X_LEFT      = 15;
const ARROW_X_RIGHT     = 195;   // "[ > ]" (~42px) endet bei ≈237 – bleibt im 240px-Sidebar
const ITEM_NAME_X       = 120;   // zentriert in 240px Sidebar

const MODE_OPTIONS: readonly GameMode[] = ['deathmatch', 'team_deathmatch', 'capture_the_beer'];
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
  private editBtn:         Phaser.GameObjects.Text | null = null;
  private modeNameText:    Phaser.GameObjects.Text | null = null;
  private modeArrowButtons: { left: Phaser.GameObjects.Text; right: Phaser.GameObjects.Text } | null = null;
  private colorEditText:   Phaser.GameObjects.Text | null = null;
  private teamArrowButtons: { left: Phaser.GameObjects.Text; right: Phaser.GameObjects.Text } | null = null;
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
  private loadoutArrowButtons: Partial<Record<LoadoutSlot, { left: Phaser.GameObjects.Text; right: Phaser.GameObjects.Text }>> = {};
  private loadoutEnabled    = true;
  private lobbyFieldsLocked = false;
  private helpOverlay:      HelpOverlay | null = null;
  private optionsOverlay:   OptionsOverlay | null = null;

  constructor(
    private scene:  Phaser.Scene,
    private bridge: NetworkBridge,
    private audioSystem: GameAudioSystem,
  ) {}

  // ── Aufbau ─────────────────────────────────────────────────────────────────

  build(): void {
    // ── gameContainer (ArenaHUD, initial off-screen oben) ─────────────────────
    this.gameContainer = this.scene.add.container(0, -GAME_HEIGHT);
    this.gameContainer.setDepth(DEPTH.OVERLAY - 1);
    this.gameContainer.add(
      this.scene.add.rectangle(CENTER_X, GAME_HEIGHT / 2, 240, GAME_HEIGHT, 0x000000, 0.18)
        .setScrollFactor(0),
    );

    // Power-Up-Container: feste Position mittig unten, unabhängig vom Tween
    this.puContainer = this.scene.add.container(PU_CONTAINER_X, 0);
    this.puContainer.setDepth(DEPTH.OVERLAY - 1);
    this.puContainer.setVisible(false);

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

    const editBtn = this.scene.add.text(CENTER_X, EDIT_BTN_Y, '[ ÄNDERN ]', EDIT_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.openNameEdit())
      .on('pointerover',  () => editBtn.setAlpha(0.7))
      .on('pointerout',   () => editBtn.setAlpha(1.0));
    this.editBtn = editBtn;
    objects.push(editBtn);

    objects.push(
      this.scene.add.text(CENTER_X, MODE_LABEL_Y, 'Spielmodus:', LABEL_FONT)
        .setOrigin(0.5, 0)
        .setScrollFactor(0),
    );

    const modeLeftBtn = this.scene.add.text(ARROW_X_LEFT, MODE_ROW_Y, '[ < ]', EDIT_FONT)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.stepGameMode(-1))
      .on('pointerover', () => modeLeftBtn.setAlpha(0.7))
      .on('pointerout', () => modeLeftBtn.setAlpha(1.0));
    objects.push(modeLeftBtn);

    const modeNameText = this.scene.add.text(ITEM_NAME_X, MODE_ROW_Y, '', {
      fontSize: '15px', fontFamily: 'monospace', color: '#e0e0e0', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setScrollFactor(0);
    this.modeNameText = modeNameText;
    objects.push(modeNameText);

    const modeRightBtn = this.scene.add.text(ARROW_X_RIGHT, MODE_ROW_Y, '[ > ]', EDIT_FONT)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.stepGameMode(+1))
      .on('pointerover', () => modeRightBtn.setAlpha(0.7))
      .on('pointerout', () => modeRightBtn.setAlpha(1.0));
    objects.push(modeRightBtn);
    this.modeArrowButtons = { left: modeLeftBtn, right: modeRightBtn };

    // ── Trennlinie ──
    const divider = this.scene.add.graphics();
    divider.lineStyle(1, COLORS.GREY_6, 0.5);
    divider.beginPath();
    divider.moveTo(20, DIVIDER1_Y);
    divider.lineTo(220, DIVIDER1_Y);
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
    const colorEditText = this.scene.add.text(CENTER_X, BADGER_Y + BADGER_SIZE / 2 + 6, '[ Farbe ändern ]', EDIT_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.toggleColorPicker());
    this.colorEditText = colorEditText;
    objects.push(colorEditText);

    const teamLeftBtn = this.scene.add.text(ARROW_X_LEFT, TEAM_SELECT_Y, '[ < ]', EDIT_FONT)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.stepTeam(-1))
      .on('pointerover', () => teamLeftBtn.setAlpha(0.7))
      .on('pointerout', () => teamLeftBtn.setAlpha(1.0));
    teamLeftBtn.setVisible(false);
    objects.push(teamLeftBtn);

    const teamRightBtn = this.scene.add.text(ARROW_X_RIGHT, TEAM_SELECT_Y, '[ > ]', EDIT_FONT)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.stepTeam(+1))
      .on('pointerover', () => teamRightBtn.setAlpha(0.7))
      .on('pointerout', () => teamRightBtn.setAlpha(1.0));
    teamRightBtn.setVisible(false);
    objects.push(teamRightBtn);
    this.teamArrowButtons = { left: teamLeftBtn, right: teamRightBtn };

    // ── Trennlinie 2 ──
    const divider2 = this.scene.add.graphics();
    divider2.lineStyle(1, COLORS.GREY_6, 0.5);
    divider2.beginPath();
    divider2.moveTo(20, DIVIDER2_Y);
    divider2.lineTo(220, DIVIDER2_Y);
    divider2.strokePath();
    divider2.setScrollFactor(0);
    objects.push(divider2);

    // ── Loadout-Karussell ──
    objects.push(
      this.scene.add.text(20, CAROUSEL_START_Y, 'Loadout:', LABEL_FONT).setScrollFactor(0),
    );

    this.applyStoredPlayerNamePreference();

    const slots: LoadoutSlot[] = ['weapon1', 'weapon2', 'utility', 'ultimate'];
    slots.forEach((slot, i) => {
      const arrowY = CAROUSEL_START_Y + CAROUSEL_GROUP_DY + i * CAROUSEL_ROW_STEP;
      const labelY = arrowY + CAROUSEL_LABEL_DY;

      const leftBtn = this.scene.add.text(ARROW_X_LEFT, arrowY, '[ < ]', EDIT_FONT)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.stepCarousel(slot, -1))
        .on('pointerover',  () => leftBtn.setAlpha(0.7))
        .on('pointerout',   () => leftBtn.setAlpha(1.0));
      objects.push(leftBtn);

      const nameText = this.scene.add.text(ITEM_NAME_X, arrowY, '', {
        fontSize: '15px', fontFamily: 'monospace', color: '#e0e0e0', fontStyle: 'bold',
      }).setOrigin(0.5, 0).setScrollFactor(0);
      this.loadoutNameTexts[slot] = nameText;
      objects.push(nameText);

      const rightBtn = this.scene.add.text(ARROW_X_RIGHT, arrowY, '[ > ]', EDIT_FONT)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.stepCarousel(slot, +1))
        .on('pointerover',  () => rightBtn.setAlpha(0.7))
        .on('pointerout',   () => rightBtn.setAlpha(1.0));
      objects.push(rightBtn);
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
    divider3.lineTo(220, DIVIDER3_Y);
    divider3.strokePath();
    divider3.setScrollFactor(0);
    objects.push(divider3);

    // ── Hilfe-Button ──
    const optionsBtn = this.scene.add.rectangle(OPTIONS_BTN_X, MENU_BTN_Y, MENU_BTN_W, MENU_BTN_H, COLORS.GREY_7)
      .setStrokeStyle(2, COLORS.GOLD_1)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.optionsOverlay?.show())
      .on('pointerover', () => optionsBtn.setAlpha(0.7))
      .on('pointerout',  () => optionsBtn.setAlpha(1))
      .setScrollFactor(0);
    objects.push(optionsBtn);
    objects.push(
      this.scene.add.text(OPTIONS_BTN_X, MENU_BTN_Y, 'OPTIONEN', {
        fontSize: '14px', fontFamily: 'monospace', fontStyle: 'bold',
        color: toCssColor(COLORS.GOLD_1),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    const helpBtn = this.scene.add.rectangle(HELP_BTN_X, MENU_BTN_Y, MENU_BTN_W, MENU_BTN_H, COLORS.GREY_7)
      .setStrokeStyle(2, COLORS.GOLD_1)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.helpOverlay?.show())
      .on('pointerover', () => helpBtn.setAlpha(0.7))
      .on('pointerout',  () => helpBtn.setAlpha(1))
      .setScrollFactor(0);
    objects.push(helpBtn);
    objects.push(
      this.scene.add.text(HELP_BTN_X, MENU_BTN_Y, 'HILFE', {
        fontSize: '16px', fontFamily: 'monospace', fontStyle: 'bold',
        color: toCssColor(COLORS.GOLD_1),
      }).setOrigin(0.5).setScrollFactor(0),
    );

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
    this.optionsOverlay = new OptionsOverlay(this.scene, this.audioSystem);
    this.optionsOverlay.build();
    this.setLobbyFieldsLocked(false);
    this.refreshColorIndicator();
  }

  getPuContainer(): Phaser.GameObjects.Container { return this.puContainer; }

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
    this.badgerPreview?.sprite.setVisible(false);
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
    this.badgerPreview?.sprite.setVisible(true);
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
    this.syncAllLoadoutSelections();
    this.updateModeSelectorState();
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
    if (isTeamGameMode(this.bridge.getGameMode())) {
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
    if (isTeamGameMode(this.bridge.getGameMode())) return;
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
      return;
    }
    const nextIndex = Phaser.Math.Clamp(this.loadoutIndices[slot], 0, items.length - 1);
    this.loadoutIndices[slot] = nextIndex;
    const item = items[nextIndex];
    this.loadoutNameTexts[slot]?.setText(item.displayName ?? item.id);
  }

  private getSlotItems(slot: LoadoutSlot): LoadoutCarouselItem[] {
    if (slot === 'ultimate') {
      return getAvailableUltimateConfigs(this.bridge.getGameMode());
    }
    return STATIC_SLOT_ITEMS[slot];
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
    const scaleX = canvasRect.width / this.scene.scale.width;
    const scaleY = canvasRect.height / this.scene.scale.height;
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

    document.body.appendChild(popup);
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

  private closeNameEditPopup(): void {
    this.closeNameEditPopupFn?.();
  }

  private updateNameEditButtonVisibility(): void {
    this.editBtn?.setVisible(!this.lobbyFieldsLocked);
    if (this.lobbyFieldsLocked) {
      this.editBtn?.disableInteractive();
      return;
    }
    this.editBtn?.setInteractive({ useHandCursor: true });
  }

  private updateColorEditState(): void {
    const mode = this.bridge.getGameMode();
    const enabled = !this.lobbyFieldsLocked && !isTeamGameMode(mode);
    this.badgerClickZone.setAlpha(enabled ? 1 : 0);
    if (enabled) this.badgerClickZone.setInteractive({ useHandCursor: true });
    else this.badgerClickZone.disableInteractive();

    this.colorEditText?.setVisible(!isTeamGameMode(mode) && !this.lobbyFieldsLocked);
    if (!this.colorEditText) return;
    this.colorEditText.setText('[ Farbe aendern ]');
    if (enabled) this.colorEditText.setInteractive({ useHandCursor: true });
    else this.colorEditText.disableInteractive();
  }

  private updateLoadoutArrowVisibility(): void {
    for (const buttons of Object.values(this.loadoutArrowButtons)) {
      if (!buttons) continue;
      buttons.left.setVisible(!this.lobbyFieldsLocked);
      buttons.right.setVisible(!this.lobbyFieldsLocked);
      if (this.lobbyFieldsLocked) {
        buttons.left.disableInteractive();
        buttons.right.disableInteractive();
      } else {
        buttons.left.setInteractive({ useHandCursor: true });
        buttons.right.setInteractive({ useHandCursor: true });
      }
    }
  }

  private stepGameMode(delta: -1 | 1): void {
    if (this.lobbyFieldsLocked || !this.bridge.isHost()) return;
    const currentMode = this.bridge.getGameMode();
    const currentIndex = MODE_OPTIONS.indexOf(currentMode);
    const nextIndex = (currentIndex + delta + MODE_OPTIONS.length) % MODE_OPTIONS.length;
    this.bridge.setGameMode(MODE_OPTIONS[nextIndex]);
    this.refreshColorIndicator();
  }

  private stepTeam(delta: -1 | 1): void {
    if (!isTeamGameMode(this.bridge.getGameMode())) return;
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
    this.modeArrowButtons?.left.setVisible(isHost).setAlpha(alpha);
    this.modeArrowButtons?.right.setVisible(isHost).setAlpha(alpha);
    if (enabled) {
      this.modeArrowButtons?.left.setInteractive({ useHandCursor: true });
      this.modeArrowButtons?.right.setInteractive({ useHandCursor: true });
    } else {
      this.modeArrowButtons?.left.disableInteractive();
      this.modeArrowButtons?.right.disableInteractive();
    }
  }

  private updateTeamSelectorState(mode: GameMode, teamId: TeamId | null): void {
    const isTeamMode = isTeamGameMode(mode);
    const canChangeTeam = isTeamMode && !this.lobbyFieldsLocked && this.bridge.canPlayerChangeTeam(this.bridge.getLocalPlayerId());
    const alpha = canChangeTeam ? 1 : 0.35;

    if (isTeamMode) {
      this.closeColorPicker();
    }

    this.teamArrowButtons?.left.setVisible(isTeamMode).setAlpha(alpha);
    this.teamArrowButtons?.right.setVisible(isTeamMode).setAlpha(alpha);
    if (canChangeTeam) {
      this.teamArrowButtons?.left.setInteractive({ useHandCursor: true });
      this.teamArrowButtons?.right.setInteractive({ useHandCursor: true });
    } else {
      this.teamArrowButtons?.left.disableInteractive();
      this.teamArrowButtons?.right.disableInteractive();
    }

    if (!this.colorEditText) return;
    if (isTeamMode) {
      this.colorEditText.setVisible(true);
      this.colorEditText.setText(getTeamLabel(teamId));
      this.colorEditText.disableInteractive();
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
