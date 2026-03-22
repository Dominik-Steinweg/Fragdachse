/**
 * LeftSidePanel – linker Seitenbereich (x=0..240) für Lobby- und Arena-Phase.
 *
 * lobbyContainer (y=0):      Namensanzeige, Farbauswahl
 * gameContainer  (y=−H):     ArenaHUD (initial off-screen oben)
 *
 * Reusability-Template: gleiche Public-API wie RightSidePanel.
 */
import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import { ArenaHUD } from './ArenaHUD';
import type { ArenaHUDData } from './ArenaHUD';
import { GAME_HEIGHT, DEPTH, COLORS, PLAYER_COLORS, toCssColor } from '../config';
import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../loadout/LoadoutConfig';
import type { LoadoutSlot } from '../types';

// ── Layout-Konstanten (innerhalb des 240px-Sidebars) ─────────────────────────
const NAME_LABEL_X = 20;
const NAME_LABEL_Y = 80;
const NAME_VALUE_X = 20;
const NAME_VALUE_Y = 108;
const EDIT_BTN_X   = 20;
const EDIT_BTN_Y   = 136;

const COLOR_LABEL_X      = 20;
const COLOR_LABEL_Y      = 174;
const COLOR_SWATCH_X     = 20;   // linke Kante des Indikator-Squares
const COLOR_SWATCH_Y     = 194;  // obere Kante
const COLOR_SWATCH_SIZE  = 32;

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

const LABEL_FONT = { fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_2) };
const NAME_FONT  = { fontSize: '18px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1), fontStyle: 'bold' as const };
const EDIT_FONT  = { fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.BLUE_1) };

// ── Loadout-Karussell-Konstanten ──────────────────────────────────────────────
const CAROUSEL_START_Y  = 258;   // Y des "Loadout:"-Labels
const CAROUSEL_ROW_STEP = 52;    // Abstand zwischen Slot-Gruppen (Pfeile + Label unten)
const CAROUSEL_GROUP_DY = 20;    // Offset erste Karussell-Zeile unter "Loadout:"
const CAROUSEL_LABEL_DY = 20;    // Slot-Label-Offset UNTER den Pfeilen
const ARROW_X_LEFT      = 15;
const ARROW_X_RIGHT     = 195;   // "[ > ]" (~42px) endet bei ≈237 – bleibt im 240px-Sidebar
const ITEM_NAME_X       = 120;   // zentriert in 240px Sidebar

type LoadoutCarouselItem = {
  id: string;
  displayName: string;
};

// Item-Arrays nach Slot gefiltert
const SLOT_ITEMS: Record<LoadoutSlot, LoadoutCarouselItem[]> = {
  weapon1:  Object.values(WEAPON_CONFIGS).filter(w => (w.allowedSlots as readonly string[]).includes('weapon1')),
  weapon2:  Object.values(WEAPON_CONFIGS).filter(w => (w.allowedSlots as readonly string[]).includes('weapon2')),
  utility:  Object.values(UTILITY_CONFIGS).filter(u => (u.allowedSlots as readonly string[]).includes('utility')),
  ultimate: Object.values(ULTIMATE_CONFIGS),
};

const SLOT_LABELS: Record<LoadoutSlot, string> = {
  weapon1:  'Waffe 1',
  weapon2:  'Waffe 2',
  utility:  'Utility',
  ultimate: 'Ultimate',
};

// ── Swatch-Eintrag im Picker ──────────────────────────────────────────────────
interface SwatchEntry {
  rect:  Phaser.GameObjects.Rectangle;
  color: number;
}

export class LeftSidePanel {
  private lobbyContainer!: Phaser.GameObjects.Container;
  private gameContainer!:  Phaser.GameObjects.Container;
  private arenaHUD!:       ArenaHUD;
  private localNameText!:  Phaser.GameObjects.Text;
  private nameEditEnabled  = true;
  private nameEditOpen     = false;
  private pendingDelay:    Phaser.Time.TimerEvent | null = null;

  // Farbindikator im lobbyContainer (lokale Koordinaten)
  private colorIndicatorRect!: Phaser.GameObjects.Rectangle;

  // Picker-Popup (eigener world-space-Container, depth OVERLAY+2)
  private pickerContainer!: Phaser.GameObjects.Container;
  private pickerSwatches:   SwatchEntry[] = [];
  private pickerOpen        = false;
  private requestPending    = false;

  // Loadout-Karussell
  private loadoutIndices:   Record<LoadoutSlot, number> = { weapon1: 0, weapon2: 0, utility: 0, ultimate: 0 };
  private loadoutNameTexts: Partial<Record<LoadoutSlot, Phaser.GameObjects.Text>> = {};
  private loadoutEnabled    = true;

  constructor(
    private scene:  Phaser.Scene,
    private bridge: NetworkBridge,
  ) {}

  // ── Aufbau ─────────────────────────────────────────────────────────────────

  build(): void {
    // ── gameContainer (ArenaHUD, initial off-screen oben) ─────────────────────
    this.gameContainer = this.scene.add.container(0, -GAME_HEIGHT);
    this.gameContainer.setDepth(DEPTH.OVERLAY - 1);
    this.arenaHUD = new ArenaHUD(this.scene, this.gameContainer);

    // ── lobbyContainer (Namens- und Farbsektion, initial on-screen) ───────────
    const objects: Phaser.GameObjects.GameObject[] = [];

    objects.push(
      this.scene.add.text(NAME_LABEL_X, NAME_LABEL_Y, 'Dein Name:', LABEL_FONT)
        .setScrollFactor(0),
    );

    this.localNameText = this.scene.add.text(NAME_VALUE_X, NAME_VALUE_Y, '', NAME_FONT)
      .setScrollFactor(0);
    objects.push(this.localNameText);

    const editBtn = this.scene.add.text(EDIT_BTN_X, EDIT_BTN_Y, '[ ÄNDERN ]', EDIT_FONT)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.openNameEdit())
      .on('pointerover',  () => editBtn.setAlpha(0.7))
      .on('pointerout',   () => editBtn.setAlpha(1.0));
    objects.push(editBtn);

    // ── Farbsektion ──
    objects.push(
      this.scene.add.text(COLOR_LABEL_X, COLOR_LABEL_Y, 'Farbe:', LABEL_FONT)
        .setScrollFactor(0),
    );

    this.colorIndicatorRect = this.scene.add
      .rectangle(COLOR_SWATCH_X, COLOR_SWATCH_Y, COLOR_SWATCH_SIZE, COLOR_SWATCH_SIZE, 0x888888)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.toggleColorPicker())
      .on('pointerover',  () => this.colorIndicatorRect.setStrokeStyle(2, 0xffffff))
      .on('pointerout',   () => this.colorIndicatorRect.setStrokeStyle(0));
    objects.push(this.colorIndicatorRect);

    // ── Loadout-Karussell ──
    objects.push(
      this.scene.add.text(20, CAROUSEL_START_Y, 'Loadout:', LABEL_FONT).setScrollFactor(0),
    );

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

      // Slot-Label zentriert UNTER den Pfeilen
      objects.push(
        this.scene.add.text(ITEM_NAME_X, labelY, SLOT_LABELS[slot], {
          fontSize: '12px', fontFamily: 'monospace', color: '#888888',
        }).setOrigin(0.5, 0).setScrollFactor(0),
      );

      // Initialwert anzeigen und in Bridge speichern
      this.updateCarouselDisplay(slot);
      this.bridge.setLocalLoadoutSlot(slot, SLOT_ITEMS[slot][0].id);
    });

    this.lobbyContainer = this.scene.add.container(0, 0, objects);
    this.lobbyContainer.setDepth(DEPTH.OVERLAY - 1);

    // ── Picker-Popup (world-space, über LobbyOverlay) ─────────────────────────
    this.pickerContainer = this.buildPickerContainer();
    this.pickerContainer.setVisible(false);
  }

  // ── Transitions ────────────────────────────────────────────────────────────

  transitionToGame(): void {
    this.closeColorPicker();
    this.nameEditEnabled = false;
    this.loadoutEnabled  = false;
    this.scene.tweens.killTweensOf(this.lobbyContainer);
    this.scene.tweens.killTweensOf(this.gameContainer);
    this.pendingDelay?.remove();

    // Populate ArenaHUD with player info and loadout names
    this.initArenaHUD();

    this.scene.tweens.add({
      targets:  this.lobbyContainer,
      y:        GAME_HEIGHT,
      duration: 350,
      ease:     'Power2.easeIn',
    });

    this.pendingDelay = this.scene.time.delayedCall(100, () => {
      this.scene.tweens.add({
        targets:  this.gameContainer,
        y:        0,
        duration: 500,
        ease:     'Back.easeOut',
      });
      this.pendingDelay = null;
    });
  }

  transitionToLobby(): void {
    this.scene.tweens.killTweensOf(this.lobbyContainer);
    this.scene.tweens.killTweensOf(this.gameContainer);
    this.pendingDelay?.remove();

    this.arenaHUD.reset();

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
          this.pendingDelay    = null;
        },
      });
    });
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

  /** Aktualisiert das Farbindikator-Quadrat anhand des aktuellen Player-States. */
  refreshColorIndicator(): void {
    const color = this.bridge.getPlayerColor(this.bridge.getLocalPlayerId());
    if (color !== undefined) this.colorIndicatorRect.setFillStyle(color);
  }

  /** Aktualisiert den Picker live, solange er offen ist (jeden Lobby-Frame). */
  refreshColorPickerIfOpen(): void {
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

  destroy(): void {
    this.arenaHUD.destroy();
    this.lobbyContainer.destroy(true);
    this.gameContainer.destroy(true);
    this.pickerContainer.destroy(true);
  }

  // ── Color-Picker ──────────────────────────────────────────────────────────

  private buildPickerContainer(): Phaser.GameObjects.Container {
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

    // Farb-Swatches
    this.pickerSwatches = [];
    PLAYER_COLORS.forEach((color, idx) => {
      const col = idx % PICKER_COLS;
      const row = Math.floor(idx / PICKER_COLS);
      const sx  = PICKER_PADDING + col * (SWATCH_SIZE + SWATCH_GAP);
      const sy  = PICKER_GRID_Y  + row * (SWATCH_SIZE + SWATCH_GAP);

      const rect = this.scene.add
        .rectangle(sx, sy, SWATCH_SIZE, SWATCH_SIZE, color)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => { if (rect.alpha > 0.5) rect.setStrokeStyle(2, 0xffffff); })
        .on('pointerout',  () => rect.setStrokeStyle(0))
        .on('pointerdown', () => this.requestColor(color));

      objects.push(rect);
      this.pickerSwatches.push({ rect, color });
    });

    const container = this.scene.add.container(PICKER_WORLD_X, PICKER_WORLD_Y, objects);
    container.setDepth(DEPTH.OVERLAY + 2);
    return container;
  }

  private toggleColorPicker(): void {
    if (this.pickerOpen) this.closeColorPicker();
    else                 this.openColorPicker();
  }

  private openColorPicker(): void {
    this.pickerOpen = true;
    this.requestPending = false;
    this.refreshPickerSwatches();
    this.pickerContainer.setVisible(true);
  }

  private closeColorPicker(): void {
    this.pickerOpen = false;
    this.pickerContainer.setVisible(false);
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

    for (const { rect, color } of this.pickerSwatches) {
      const isOwn       = color === ownColor;
      const isFree      = available.includes(color);
      const isClickable = (isFree || isOwn) && !this.requestPending;

      rect.setAlpha(isOwn || isFree ? 1.0 : 0.07);
      rect.setStrokeStyle(isOwn ? 3 : 0, COLORS.GREY_1);

      if (isClickable) {
        rect.setInteractive({ useHandCursor: true });
      } else {
        rect.disableInteractive();
      }
    }
  }

  private requestColor(color: number): void {
    if (this.requestPending) return;
    const ownColor = this.bridge.getPlayerColor(this.bridge.getLocalPlayerId());
    if (color === ownColor) { this.closeColorPicker(); return; }  // bereits eigene Farbe

    this.requestPending = true;
    this.refreshPickerSwatches();  // alle Swatches sperren während Anfrage läuft
    this.bridge.sendColorRequest(color);
  }

  // ── Loadout-Karussell ─────────────────────────────────────────────────────

  private stepCarousel(slot: LoadoutSlot, delta: -1 | 1): void {
    if (!this.loadoutEnabled) return;
    const items = SLOT_ITEMS[slot];
    this.loadoutIndices[slot] = (this.loadoutIndices[slot] + delta + items.length) % items.length;
    this.updateCarouselDisplay(slot);
    this.bridge.setLocalLoadoutSlot(slot, items[this.loadoutIndices[slot]].id);
  }

  private updateCarouselDisplay(slot: LoadoutSlot): void {
    const item = SLOT_ITEMS[slot][this.loadoutIndices[slot]];
    this.loadoutNameTexts[slot]?.setText(item.displayName ?? item.id);
  }

  // ── Namens-Edit DOM-Popup ──────────────────────────────────────────────────

  private openNameEdit(): void {
    if (!this.nameEditEnabled) return;
    if (this.nameEditOpen) return;
    this.nameEditOpen = true;

    const localId     = this.bridge.getLocalPlayerId();
    const currentName = this.bridge.getConnectedPlayers().find(p => p.id === localId)?.name ?? '';

    const popup = document.createElement('div');
    Object.assign(popup.style, {
      position:        'absolute',
      top:             '50%',
      left:            '50%',
      transform:       'translate(-50%, -50%)',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      border:          `3px solid ${toCssColor(COLORS.GREEN_4)}`,
      borderRadius:    '8px',
      padding:         '20px',
      display:         'flex',
      flexDirection:   'column',
      gap:             '15px',
      zIndex:          '1000',
      fontFamily:      'Arial, sans-serif',
      boxShadow:       '0px 0px 20px rgba(0,0,0,0.8)',
    });

    const inputElement = document.createElement('input');
    inputElement.type  = 'text';
    inputElement.value = currentName;
    Object.assign(inputElement.style, {
      fontSize:        '20px',
      padding:         '10px',
      textAlign:       'center',
      border:          `2px solid ${toCssColor(COLORS.GREY_5)}`,
      borderRadius:    '4px',
      backgroundColor: toCssColor(COLORS.GREY_8),
      color:           toCssColor(COLORS.GREY_1),
      outline:         'none',
      width:           '250px',
    });

    const buttonContainer = document.createElement('div');
    Object.assign(buttonContainer.style, {
      display:        'flex',
      justifyContent: 'space-between',
      gap:            '10px',
    });

    const confirmBtn     = document.createElement('button');
    confirmBtn.innerText = 'Speichern';
    Object.assign(confirmBtn.style, {
      flex:            '1',
      padding:         '10px',
      fontSize:        '16px',
      cursor:          'pointer',
      backgroundColor: toCssColor(COLORS.GREEN_4),
      color:           toCssColor(COLORS.GREY_1),
      border:          'none',
      borderRadius:    '4px',
      fontWeight:      'bold',
    });

    const cancelBtn     = document.createElement('button');
    cancelBtn.innerText = 'Abbrechen';
    Object.assign(cancelBtn.style, {
      flex:            '1',
      padding:         '10px',
      fontSize:        '16px',
      cursor:          'pointer',
      backgroundColor: toCssColor(COLORS.RED_4),
      color:           toCssColor(COLORS.GREY_1),
      border:          'none',
      borderRadius:    '4px',
      fontWeight:      'bold',
    });

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(confirmBtn);
    popup.appendChild(inputElement);
    popup.appendChild(buttonContainer);

    const container = document.getElementById('game-container') || document.body;
    container.appendChild(popup);
    inputElement.focus();

    const closePopup = () => { this.nameEditOpen = false; popup.remove(); };
    const saveName   = () => {
      const input = inputElement.value.trim();
      if (input !== '') this.bridge.setLocalName(input);
      closePopup();
    };

    confirmBtn.onclick = saveName;
    cancelBtn.onclick  = closePopup;
    inputElement.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter')  saveName();
      if (e.key === 'Escape') closePopup();
    });
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
    const w1Id  = this.bridge.getPlayerLoadoutSlot(localId, 'weapon1');
    const w2Id  = this.bridge.getPlayerLoadoutSlot(localId, 'weapon2');
    const utId  = this.bridge.getPlayerLoadoutSlot(localId, 'utility');
    const ulId  = this.bridge.getPlayerLoadoutSlot(localId, 'ultimate');

    const w1Name  = (w1Id && WEAPON_CONFIGS[w1Id as keyof typeof WEAPON_CONFIGS]?.displayName) ?? 'Glock';
    const w2Name  = (w2Id && WEAPON_CONFIGS[w2Id as keyof typeof WEAPON_CONFIGS]?.displayName) ?? 'P90';
    const utName  = (utId && UTILITY_CONFIGS[utId as keyof typeof UTILITY_CONFIGS]?.displayName) ?? 'Granate';
    const ulName  = (ulId && ULTIMATE_CONFIGS[ulId as keyof typeof ULTIMATE_CONFIGS]?.displayName) ?? 'Honigdachs-Wut';

    this.arenaHUD.setLoadoutNames(w1Name, w2Name, utName, ulName);

    // Weapon 2 adrenaline cost → tick marks on adrenaline bar
    const w2Cfg = w2Id ? WEAPON_CONFIGS[w2Id as keyof typeof WEAPON_CONFIGS] : undefined;
    this.arenaHUD.setAdrenalinTickCost(w2Cfg?.adrenalinCost ?? 0);
  }
}
