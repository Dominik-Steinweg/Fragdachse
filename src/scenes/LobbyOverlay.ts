/**
 * LobbyOverlay – kein Phaser-Scene, sondern eine Helferklasse.
 * Verwaltet das semi-transparente Lobby-UI innerhalb der ArenaScene.
 * Sichtbar wenn gamePhase === 'LOBBY' ODER lokaler Spieler isReady === false.
 *
 * Farbhierarchie: der BEREIT-Button ist die einzige gesaettigte Flaeche des Bildschirms. Gold
 * gehoert der Progression, Rot echten Fehlern, alles Uebrige ist neutral oder ghost. Die Rollen
 * kommen aus `ui/uiTheme`; dieser Datei gehoert keine eigene Farbtabelle mehr.
 *
 * Geometrie: das Panel liegt in der Freiflaeche, die `LobbyWorldLayout` per
 * `overlayClearZones` aus dem Felsrahmen ausspart. Wer PANEL_Y/PANEL_H aendert, muss die dortige
 * Zone auf dem 32-px-Raster nachziehen.
 */
import * as Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { LoadoutSlot, LoadoutToolRef, PlayerProfile, RoomQualitySnapshot, TeamId } from '../types';
import type { LinkDiagnostics } from '../network/peer';
import {
  GAME_WIDTH, GAME_HEIGHT,
  DEPTH, COLORS, TEAM_BLUE_COLOR, TEAM_RED_COLOR, toCssColor,
} from '../config';
import {
  hasTeamSelection, isCoopDefenseMode,
} from '../gameModes';
import type { CoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';
import {
  ensureLobbyPanelTexture,
  ensureLobbyFooterTexture,
  ensureIconTexture,
  ensureRoundedTexture,
} from '../ui/uiTextures';
import {
  LivingBarEffect,
  createGradientTexture,
  ensureLivingBarTextures,
  type LivingBarPalette,
} from '../ui/LivingBarEffect';
import { UiButton } from '../ui/UiButton';
import { BORDER, getPingColor, MOTION, SPACE, TEXT, textStyle } from '../ui/uiTheme';
import { addExternalGlow, removeExternalFx, type GlowHandle } from '../utils/phaserFx';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { UiTooltip } from '../ui/UiTooltip';
import { UiContextMenu } from '../ui/UiContextMenu';
import { isFullscreen, onFullscreenChange, toggleFullscreen } from '../ui/fullscreen';
import { COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID } from '../config/coopDefenseItems';
import { DEFAULT_LOADOUT } from '../loadout/LoadoutConfig';
import {
  describeLoadoutItem,
  describeLoadoutTool,
  type LoadoutItemPresentation,
} from '../loadout/LoadoutCatalog';
import { LOBBY_FRAME_BOUNDS, LOBBY_PANEL_WIDTH } from '../arena/LobbyWorldLayout';
import { promoteToClarityCamera } from './arena/ClarityCameraRegistry';
import { buildLobbyRosterSlots } from '../lobby/LobbyRosterLayout';
import { createLoadoutHoverGroup, createLoadoutSlotControl } from '../ui/LoadoutSlotControl';
import { PLAYER_NAME_MAX_LENGTH } from '../utils/playerName';
import { getLocale, t } from '../i18n';
import { getLocalizedGameModeLabel } from '../i18n/gameModePresentation';
import { formatDate } from '../i18n/format';
import { getMapName } from '../i18n/contentPresentation';

// ── Panel ────────────────────────────────────────────────────────────────────
const PANEL_W = LOBBY_PANEL_WIDTH;
/**
 * Das Panel ist so hoch wie sein Inhalt, zwischen diesen Grenzen. Eine feste Hoehe muesste sich
 * am groessten Fall orientieren (Coop-Fortschrittsband, volle Spielerliste) und liesse eine
 * Zweierlobby halb leer stehen.
 */
/**
 * Volle Hoehe = die gesamte Hoehe des Felsrahmens, Aussenkante zu Aussenkante. Das Panel
 * fluchtet damit oben und unten mit den Felszeilen der Seitenspalten, nicht nur mit deren
 * Innenflaeche.
 */
const PANEL_H_MAX = LOBBY_FRAME_BOUNDS.outerBottom - LOBBY_FRAME_BOUNDS.outerTop;
const PANEL_X = GAME_WIDTH / 2 - PANEL_W / 2;
const PANEL_Y = LOBBY_FRAME_BOUNDS.outerTop;
const PANEL_CX = GAME_WIDTH / 2;
const PAD = 28;
const CONTENT_L = PANEL_X + PAD;
const CONTENT_R = PANEL_X + PANEL_W - PAD;
const CONTENT_W = CONTENT_R - CONTENT_L;

// ── Kopfzeile ────────────────────────────────────────────────────────────────
// Zwei Zeilen: oben Partie und Raum, darunter der Verbindungszustand und – nur beim Host –
// der Raumwechsel. Der Raumwechsel gehoert fachlich zum Raum, nicht zum Handlungsaufruf; unten
// stand er dem BEREIT-Button nur im Weg und verschob ihn gegenueber der Client-Ansicht.
const HEADER_Y = PANEL_Y + 34;
const QUALITY_Y = PANEL_Y + 70;
const HEADER_DIVIDER_Y = PANEL_Y + 96;
const ROOM_CHIP_W = 176;
const ROOM_CHIP_H = 38;
/** Raum-Chip rechtsbuendig; der Raumwechsel darunter teilt sich diese rechte Kante und Breite. */
const ROOM_CHIP_X = CONTENT_R - ROOM_CHIP_W / 2;
const ROOM_CAPTION_X = ROOM_CHIP_X - ROOM_CHIP_W / 2 - SPACE.md;

// ── Spielerliste ─────────────────────────────────────────────────────────────
const LIST_LABEL_Y = PANEL_Y + 118;
const LIST_Y = PANEL_Y + 142;
const ROSTER_COLUMN_GAP = 12;
const ROSTER_SLOT_W = (CONTENT_W - ROSTER_COLUMN_GAP) / 2;
const ROSTER_SLOT_H = 44;
const ROSTER_ROW_STEP = 48;
const TEAM_HEADER_H = 28;
const READY_STATUS_OFFSET_X = 23;
const LOADOUT_ICON_SIZE = 28;
const LOADOUT_ICON_GAP = 2;
const LOADOUT_SLOTS: readonly LoadoutSlot[] = ['weapon1', 'weapon2', 'utility', 'ultimate'];
const LOADOUT_CONTENT_W = LOADOUT_ICON_SIZE * LOADOUT_SLOTS.length + LOADOUT_ICON_GAP * (LOADOUT_SLOTS.length - 1);
const LOADOUT_FRAME_PADDING_X = 3;
const LOADOUT_FRAME_PADDING_Y = 3;
const LOADOUT_FRAME_W = LOADOUT_CONTENT_W + LOADOUT_FRAME_PADDING_X * 2;
const LOADOUT_FRAME_H = LOADOUT_ICON_SIZE + LOADOUT_FRAME_PADDING_Y * 2;
/** Fester Anker des Loadout-Trays mit etwas Luft zur Ping-/HOST-Spalte. */
const LOADOUT_LEFT_OFFSET = 190;

// ── Coop-Fortschrittsband (innerhalb des Panels) ─────────────────────────────
// Sichtbar nur im Coop; dann steht das Panel immer auf seiner vollen Hoehe.
const COOP_BAND_TOP = PANEL_Y + 426;
const COOP_BAND_BG_TOP = COOP_BAND_TOP + 8;
const COOP_LABEL_Y = COOP_BAND_TOP + 26;
const COOP_BAR_Y = COOP_BAND_TOP + 58;
const COOP_BAR_H = 12;
const COOP_BTN_Y = COOP_BAND_TOP + 100;
const COOP_BTN_W = 190;
const COOP_BTN_H = 44;
const COOP_BTN_GAP = SPACE.lg;
const COOP_ACTION_ROW_W = COOP_BTN_W * 3 + COOP_BTN_GAP * 2;
const COOP_UPGRADE_BTN_X = PANEL_CX - COOP_ACTION_ROW_W / 2 + COOP_BTN_W / 2;
const COOP_TEST_AREA_BTN_X = PANEL_CX;
const COOP_ITEMS_BTN_X = PANEL_CX + COOP_ACTION_ROW_W / 2 - COOP_BTN_W / 2;
const COOP_BAR_TEX_KEY = '_lobby_coop_xpbar';

// ── Handlungsaufruf ──────────────────────────────────────────────────────────
/**
 * Hoehe des Fussblocks: von der Trennlinie bis zur Panelunterkante. Er traegt nur noch den
 * Handlungsaufruf, damit dieser bei Host und Gast an derselben Stelle mittig steht.
 */
const CTA_BLOCK_H = 86;
/** Luft zwischen dem letzten Listeneintrag und der Trennlinie ueber dem Fussblock. */
const CTA_GAP = 12;
const READY_BTN_W = 260;
const READY_BTN_H = 56;
const READY_BTN_DY = 46;
/**
 * Host-Zeile der Kopfzeile: Raumwechsel buendig unter dem Raum-Chip, die Verbindungsdiagnose
 * als Symbol links daneben. Beide gehoeren zum Raum, nicht zum Handlungsaufruf.
 */
const HOST_BTN_W = ROOM_CHIP_W;
const HOST_BTN_H = 30;
const HOST_BTN_X = CONTENT_R - HOST_BTN_W / 2;
const INFO_BTN_SIZE = HOST_BTN_H;
const INFO_BTN_X = HOST_BTN_X - HOST_BTN_W / 2 - SPACE.sm - INFO_BTN_SIZE / 2;
/** Unterkante der Liste bei voll ausgefahrenem Panel ohne Fortschrittsband. */
const CTA_DIVIDER_Y_MAX = PANEL_Y + PANEL_H_MAX - CTA_BLOCK_H;
const CTA_FADE_OVERLAP = 44;

// ── Ausserhalb des Panels ────────────────────────────────────────────────────
const BUILD_INFO_X = 16;
const BUILD_INFO_Y = GAME_HEIGHT - 16;
const SYSTEM_BAR_GAP = 8;
const SYSTEM_BAR_H = 40;
const SYSTEM_BAR_MARGIN = 28;
const HELP_BTN_W = 112;
const OPTIONS_BTN_W = 132;
const FULLSCREEN_BTN_W = 168;
const SYSTEM_BAR_Y = GAME_HEIGHT - SYSTEM_BAR_MARGIN - SYSTEM_BAR_H / 2;
const FULLSCREEN_BTN_X = GAME_WIDTH - SYSTEM_BAR_MARGIN - FULLSCREEN_BTN_W / 2;
const OPTIONS_BTN_X = FULLSCREEN_BTN_X - FULLSCREEN_BTN_W / 2 - SYSTEM_BAR_GAP - OPTIONS_BTN_W / 2;
const HELP_BTN_X = OPTIONS_BTN_X - OPTIONS_BTN_W / 2 - SYSTEM_BAR_GAP - HELP_BTN_W / 2;
/** Der Exit bleibt auch bei ausgeblendetem Lobby-Panel im unteren Systembereich sichtbar. */
const WORLD_EXIT_BTN_W = 268;
/** Platz neben der sichtbaren Systemleiste – nur solange das Lobby-Panel noch steht. */
const WORLD_EXIT_BTN_X = HELP_BTN_X - HELP_BTN_W / 2 - SYSTEM_BAR_GAP - WORLD_EXIT_BTN_W / 2;
/**
 * Regelfall: Wer in der World steht, sieht die Systemleiste nicht mehr. Der Exit rueckt dann an
 * denselben rechten Rand, an dem sonst VOLLBILD sitzt – ohne ihn stuende er allein in der Mitte.
 */
const WORLD_EXIT_BTN_SOLO_X = GAME_WIDTH - SYSTEM_BAR_MARGIN - WORLD_EXIT_BTN_W / 2;
const FULLSCREEN_HINT_MS = 2200;

/**
 * Obergrenze der Liste. Ohne Fortschrittsband darf sie bis zum Fussblock des voll
 * ausgefahrenen Panels laufen – gebraucht wird davon nur, was die Liste wirklich fuellt.
 */
/**
 * Zeilenflaechen werden je Groesse gebacken statt gestreckt: `setDisplaySize` auf einer
 * abgerundeten Textur zoege die Eckradien mit in die Laenge.
 */
function rowTextureKey(
  width: number,
  height: number,
  ghost: boolean,
  own: boolean,
  accentColor?: number,
): string {
  const accent = accentColor === undefined ? '' : `_${accentColor.toString(16)}`;
  return `_lobby_row${ghost ? '_ghost' : own ? '_own' : ''}_${Math.round(width)}x${Math.round(height)}${accent}`;
}

function formatBuildTimestamp(isoTimestamp: string): string {
  return formatDate(new Date(isoTimestamp), getLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type PlayerRow = {
  bg:    Phaser.GameObjects.Image;
  name:  Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Arc;
  mark:  Phaser.GameObjects.Image;
  ping:  Phaser.GameObjects.Text;
  loadoutFrame: Phaser.GameObjects.Image;
  loadout: Phaser.GameObjects.Container;
  loadoutSignature: string | null;
};

/** Platzhalterzeile fuer einen noch fehlenden Mitspieler. */
type WaitingRow = {
  bg: Phaser.GameObjects.Image;
};

export class LobbyOverlay {
  private container:      Phaser.GameObjects.Container | null = null;
  private systemBar:      Phaser.GameObjects.Container | null = null;
  /** Austritt aus dem Testgelaende; unabhaengig vom Lobby-Panel sichtbar. */
  private worldExitBar:   Phaser.GameObjects.Container | null = null;
  private worldExitBtn:   UiButton | null = null;
  /** Entry sitzt im zentralen Vorbereitungspanel und ist vom Exit bewusst getrennt. */
  private testAreaBtn:    UiButton | null = null;
  private worldEntryInside = false;
  private worldEntryAvailable = false;
  private worldEntryEnabled = false;
  private playerContextMenu: UiContextMenu | null = null;
  private loadoutTooltip: UiTooltip | null = null;
  private loadoutTooltipRoot: Phaser.GameObjects.Container | null = null;
  private playerNameTooltip: UiTooltip | null = null;
  private playerNameTooltipRoot: Phaser.GameObjects.Container | null = null;
  private playerRows:     Map<string, PlayerRow> = new Map();
  private waitingRows:    WaitingRow[] = [];
  private teamHeaders:     Record<TeamId, Phaser.GameObjects.Text> | null = null;
  private panelBg!:       Phaser.GameObjects.Image;
  private ctaDivider!:    Phaser.GameObjects.Rectangle;
  private headerTitle!:   Phaser.GameObjects.Text;
  private statusText!:    Phaser.GameObjects.Text;
  private roomQualityText!: Phaser.GameObjects.Text;
  private roomCaption!:   Phaser.GameObjects.Text;
  private readyBtn!:      UiButton;
  private roomChip!:      UiButton;
  private infoBtn!:       UiButton;
  private retryBtn!:      UiButton;
  private inviteRow!:     UiButton;
  private inviteCopyIcon: Phaser.GameObjects.Image | null = null;
  private helpBtn!:       UiButton;
  private optionsBtn!:    UiButton;
  private fullscreenBtn!: UiButton;
  private fullscreenHintEvent: Phaser.Time.TimerEvent | null = null;
  private fullscreenUnsubscribe: (() => void) | null = null;
  private entranceTween: Phaser.Tweens.Tween | null = null;
  private readyGlow: GlowHandle | null = null;
  private readyGlowTween: Phaser.Tweens.Tween | null = null;
  private coopBand: Phaser.GameObjects.Container | null = null;
  private coopProgressLevelText: Phaser.GameObjects.Text | null = null;
  private coopProgressBarFill: Phaser.GameObjects.Image | null = null;
  private coopBarEffect: LivingBarEffect | null = null;
  private coopUpgradesBtn: UiButton | null = null;
  private coopItemsBtn: UiButton | null = null;
  private coopProgressPointsText: Phaser.GameObjects.Text | null = null;
  private upgradeBtnEffect: LivingBarEffect | null = null;
  private itemsBtnEffect: LivingBarEffect | null = null;
  private itemsTooltip: UiTooltip | null = null;
  private coopItemsUnlocked = false;
  private coopItemsSignature: string | null = null;
  private visible         = false;
  private btnLocked       = false;
  private isReady         = false;
  private roomQuality: RoomQualitySnapshot | null = null;
  private transportDiagnostics: LinkDiagnostics | null = null;
  private connectionEnded = false;
  private localIsHost = false;
  private playerListSignature: string | null = null;
  private roomQualitySignature: string | null = null;
  private transportDiagnosticsSignature: string | null = null;
  private coopProgressSignature: string | null = null;

  constructor(
    private scene:          Phaser.Scene,
    private bridge:         NetworkBridge,
    private onReadyToggled: () => void,
    private onCopyRoomLink: () => void,
    private onRejoinRoom: () => void,
    private onRetryRoom: () => void,
    private onShowNetDiagnostics: () => void,
    private onShowHelp: () => void,
    private onShowOptions: () => void,
    private onOpenCoopDefenseUpgrades: () => void,
    private onOpenCoopDefenseItems: () => void,
    private onToggleWorldEntry: (enter: boolean) => void,
  ) {}

  /** Erstellt alle GameObjects. Sicher mehrfach aufrufbar. */
  build(): void {
    this.teardown();

    const objects: Phaser.GameObjects.GameObject[] = [];

    // ── Panelflaeche ──────────────────────────────────────────────────────
    this.panelBg = this.scene.add.image(
      PANEL_CX, PANEL_Y + PANEL_H_MAX / 2, this.panelTexture(PANEL_H_MAX),
    ).setScrollFactor(0);
    objects.push(this.panelBg);

    // Ein langer Verlauf beginnt oberhalb der Trennlinie und laeuft erst an der Unterkante
    // deckend aus. So bleibt der CTA stabil, ohne den harten Helligkeits-Cut eines Rechtecks.
    const footerH = CTA_BLOCK_H + CTA_FADE_OVERLAP;
    objects.push(this.scene.add.image(
      PANEL_CX,
      CTA_DIVIDER_Y_MAX - CTA_FADE_OVERLAP + footerH / 2,
      ensureLobbyFooterTexture(
        this.scene,
        `_lobby_footer_${PANEL_W - 4}x${footerH}`,
        PANEL_W - 4,
        footerH,
        COLORS.GREY_9,
      ),
    ).setScrollFactor(0));

    // ── Kopfzeile: was wird gespielt, und in welchem Raum ─────────────────
    this.headerTitle = this.scene.add.text(CONTENT_L, HEADER_Y, '', textStyle('subtitle', {
      color: COLORS.GREY_1,
    })).setOrigin(0, 0.5).setScrollFactor(0);
    objects.push(this.headerTitle);

    this.roomCaption = this.scene.add.text(ROOM_CAPTION_X, HEADER_Y, t('ui.lobby.room'), textStyle('micro'))
      .setOrigin(1, 0.5).setScrollFactor(0);
    objects.push(this.roomCaption);

    this.roomChip = new UiButton(this.scene, {
      x: ROOM_CHIP_X, y: HEADER_Y, w: ROOM_CHIP_W, h: ROOM_CHIP_H,
      label: this.bridge.getRoomCode(),
      labelRole: 'code',
      intent: 'ghost',
      icon: 'copy',
      iconSize: 16,
      onClick: () => {
        if (this.connectionEnded && !this.localIsHost) this.onRejoinRoom();
        else if (!this.btnLocked) this.onCopyRoomLink();
      },
    });
    objects.push(this.roomChip.getRoot());

    this.infoBtn = new UiButton(this.scene, {
      x: INFO_BTN_X, y: QUALITY_Y, w: INFO_BTN_SIZE, h: INFO_BTN_SIZE,
      intent: 'ghost',
      icon: 'info',
      iconOnly: true,
      iconSize: 16,
      onClick: () => { if (!this.btnLocked) this.onShowNetDiagnostics(); },
    });
    objects.push(this.infoBtn.getRoot());

    this.roomQualityText = this.scene.add.text(CONTENT_L, QUALITY_Y, t('ui.lobby.pingPreparing'),
      textStyle('caption')).setOrigin(0, 0.5).setScrollFactor(0);
    objects.push(this.roomQualityText);

    this.retryBtn = new UiButton(this.scene, {
      x: HOST_BTN_X, y: QUALITY_Y, w: HOST_BTN_W, h: HOST_BTN_H,
      label: t('ui.lobby.newRoom'),
      labelRole: 'labelSm',
      intent: 'ghost',
      onClick: () => { if (this.connectionEnded || !this.btnLocked) this.onRetryRoom(); },
    });
    objects.push(this.retryBtn.getRoot());

    objects.push(
      this.scene.add.rectangle(PANEL_CX, HEADER_DIVIDER_Y, CONTENT_W, 1, COLORS.GREY_6, 0.7)
        .setScrollFactor(0),
    );

    // ── Listenkopf ────────────────────────────────────────────────────────
    objects.push(
      this.scene.add.text(CONTENT_L, LIST_LABEL_Y, t('ui.lobby.players'), textStyle('section'))
        .setOrigin(0, 0.5).setScrollFactor(0),
    );
    this.statusText = this.scene.add.text(CONTENT_R, LIST_LABEL_Y, '', textStyle('section', {
      color: TEXT.accent,
    })).setOrigin(1, 0.5).setScrollFactor(0);
    objects.push(this.statusText);

    const blueHeader = this.scene.add.text(CONTENT_L, LIST_Y, t('ui.lobby.teamBlue'), textStyle('caption', {
      color: TEAM_BLUE_COLOR,
    })).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);
    const redHeader = this.scene.add.text(
      CONTENT_L + ROSTER_SLOT_W + ROSTER_COLUMN_GAP,
      LIST_Y,
      t('ui.lobby.teamRed'),
      textStyle('caption', { color: TEAM_RED_COLOR }),
    ).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);
    this.teamHeaders = { blue: blueHeader, red: redHeader };
    objects.push(blueHeader, redHeader);

    // Einladen-Zeile: beantwortet die eigentliche Frage einer wartenden Lobby und ersetzt den
    // frueheren, gleich lauten Kopieren-Button in der Fusszeile.
    this.inviteRow = new UiButton(this.scene, {
      x: PANEL_CX, y: LIST_Y, w: ROSTER_SLOT_W, h: ROSTER_SLOT_H,
      label: t('ui.lobby.inviteFriend'),
      intent: 'ghost',
      icon: 'plus',
      iconSize: 18,
      radius: 10,
      onClick: () => { if (!this.btnLocked) this.onCopyRoomLink(); },
    });
    this.inviteCopyIcon = this.scene.add.image(
      ROSTER_SLOT_W / 2 - 18,
      0,
      ensureIconTexture(this.scene, 'copy', 28, COLORS.GREY_4),
    ).setDisplaySize(14, 14).setScrollFactor(0);
    this.inviteRow.getRoot().add(this.inviteCopyIcon);
    objects.push(this.inviteRow.getRoot());

    // ── Handlungsaufruf ───────────────────────────────────────────────────
    this.ctaDivider = this.scene.add
      .rectangle(PANEL_CX, CTA_DIVIDER_Y_MAX, CONTENT_W, 1, COLORS.GREY_6, 0.7)
      .setScrollFactor(0);
    objects.push(this.ctaDivider);

    this.readyBtn = new UiButton(this.scene, {
      x: PANEL_CX, y: CTA_DIVIDER_Y_MAX + CTA_BLOCK_H - READY_BTN_DY, w: READY_BTN_W, h: READY_BTN_H,
      label: t('ui.lobby.ready'),
      labelRole: 'subtitle',
      intent: 'primary',
      onClick: () => { if (!this.btnLocked) this.onReadyToggled(); },
    });
    objects.push(this.readyBtn.getRoot());

    const buildInfo = this.scene.add.text(
      BUILD_INFO_X,
      BUILD_INFO_Y,
      `v${__GAME_VERSION__} · ${formatBuildTimestamp(__BUILD_TIMESTAMP__)}`,
      textStyle('micro', { color: COLORS.GREY_5 }),
    ).setOrigin(0, 1).setAlpha(0.9).setScrollFactor(0);
    objects.push(buildInfo);

    // ── Systemleiste (unten rechts, unabhaengig von den Panels) ───────────
    // Bleibt auf `pointerup`, damit die Browser-Geste auch auf Touch gueltig ist; UiButton
    // akzeptiert dieses Loslassen nur nach einem eigenen `pointerdown`.
    this.helpBtn = new UiButton(this.scene, {
      x: HELP_BTN_X, y: SYSTEM_BAR_Y, w: HELP_BTN_W, h: SYSTEM_BAR_H,
      label: t('ui.lobby.help'),
      labelRole: 'labelSm',
      intent: 'secondary',
      icon: 'help',
      iconSize: 20,
      onClick: () => this.onShowHelp(),
    });
    this.optionsBtn = new UiButton(this.scene, {
      x: OPTIONS_BTN_X, y: SYSTEM_BAR_Y, w: OPTIONS_BTN_W, h: SYSTEM_BAR_H,
      label: t('ui.lobby.options'),
      labelRole: 'labelSm',
      intent: 'secondary',
      icon: 'settings',
      iconSize: 20,
      onClick: () => this.onShowOptions(),
    });
    this.fullscreenBtn = new UiButton(this.scene, {
      x: FULLSCREEN_BTN_X, y: SYSTEM_BAR_Y, w: FULLSCREEN_BTN_W, h: SYSTEM_BAR_H,
      label: t('ui.lobby.fullscreen'),
      labelRole: 'labelSm',
      intent: 'secondary',
      icon: isFullscreen() ? 'fullscreen-exit' : 'fullscreen-enter',
      iconSize: 18,
      activateOn: 'pointerup',
      onClick: () => this.onFullscreenClicked(),
    });

    // Nicht an ENTER/LEAVE_FULLSCREEN des ScaleManagers: die kennen nur das API-Vollbild und
    // schweigen bei F11-Vollbild. Siehe `ui/fullscreen`.
    this.fullscreenUnsubscribe = onFullscreenChange(() => this.updateFullscreenIcon());

    this.buildCoopBand(objects);

    // Der Einstieg gehoert in die Vorbereitung, nicht in die allgemeine Systemleiste. Im Coop
    // steht er mittig zwischen UPGRADES und ITEMS; ohne Coop-Fortschrittsband bleibt er derselbe
    // einzelne, normal gewichtete Aktionsbutton.
    this.testAreaBtn = new UiButton(this.scene, {
      x: COOP_TEST_AREA_BTN_X, y: COOP_BTN_Y, w: COOP_BTN_W, h: COOP_BTN_H,
      label: t('ui.lobby.testArea'),
      intent: 'neutral',
      onClick: () => {
        if (!this.worldEntryInside) this.onToggleWorldEntry(true);
      },
    }).setVisible(false);
    objects.push(this.testAreaBtn.getRoot());

    this.container = this.scene.add.container(0, 0, objects).setDepth(DEPTH.OVERLAY);
    promoteToClarityCamera(this.scene, this.container);
    this.playerContextMenu = new UiContextMenu(this.scene, this.container);
    this.loadoutTooltip = new UiTooltip(this.scene, 280);
    this.loadoutTooltipRoot = this.loadoutTooltip.build();
    this.container.add(this.loadoutTooltipRoot);
    this.playerNameTooltip = new UiTooltip(this.scene, 180);
    this.playerNameTooltipRoot = this.playerNameTooltip.build();
    this.container.add(this.playerNameTooltipRoot);
    this.container.setVisible(this.visible);

    this.systemBar = this.scene.add.container(0, 0, [
      this.helpBtn.getRoot(),
      this.optionsBtn.getRoot(),
      this.fullscreenBtn.getRoot(),
    ]).setDepth(DEPTH.OVERLAY);
    promoteToClarityCamera(this.scene, this.systemBar);
    this.systemBar.setVisible(this.visible);

    // Eigener Container: seine Sichtbarkeit folgt der World-Teilnahme, nicht dem Lobby-Panel.
    this.worldExitBtn = new UiButton(this.scene, {
      x: WORLD_EXIT_BTN_X, y: SYSTEM_BAR_Y, w: WORLD_EXIT_BTN_W, h: SYSTEM_BAR_H,
      label: t('ui.lobby.returnToLobby'),
      labelRole: 'labelSm',
      intent: 'secondary',
      icon: 'chevron-left',
      iconSize: 18,
      onClick: () => {
        if (this.worldEntryInside) this.onToggleWorldEntry(false);
      },
    });
    this.worldExitBar = this.scene.add
      .container(0, 0, [this.worldExitBtn.getRoot()])
      .setDepth(DEPTH.OVERLAY);
    promoteToClarityCamera(this.scene, this.worldExitBar);
    this.worldExitBar.setVisible(false);

    this.refreshHeader();
    this.updateRoomActionButtons();
    this.layoutList();
  }

  /** Fortschrittsband des Coop-Modus – sitzt jetzt im Panel statt frei darunter. */
  private buildCoopBand(objects: Phaser.GameObjects.GameObject[]): void {
    // Das Band gibt es nur bei voller Panelhoehe, deshalb die feste Obergrenze.
    const bandBottom = CTA_DIVIDER_Y_MAX - CTA_GAP - 14;
    const bandH = bandBottom - COOP_BAND_BG_TOP;
    const bandBg = this.scene.add.image(
      PANEL_CX, COOP_BAND_BG_TOP + bandH / 2,
      ensureRoundedTexture(this.scene, {
        key: `_lobby_coop_panel_polished_${Math.round(CONTENT_W)}x${Math.round(bandH)}`,
        w: CONTENT_W,
        h: bandH,
        radius: 16,
        topColor: COLORS.GREY_7,
        bottomColor: COLORS.GREY_8,
        fillAlpha: 0.42,
        strokeColor: COLORS.GREY_5,
        strokeAlpha: 0.18,
        strokeWidth: 1,
        highlightAlpha: 0.025,
      }),
    ).setScrollFactor(0);

    const bandLabel = this.scene.add.text(CONTENT_L + SPACE.lg, COOP_LABEL_Y, t('ui.lobby.progress'),
      textStyle('section', { color: COLORS.GREY_3 })).setOrigin(0, 0.5).setScrollFactor(0);

    this.coopProgressLevelText = this.scene.add.text(CONTENT_L + SPACE.lg + 132, COOP_LABEL_Y, t('ui.lobby.level', { level: 1 }),
      textStyle('numL', { color: COLORS.GREY_1 })).setOrigin(0, 0.5).setScrollFactor(0);

    this.coopProgressPointsText = this.scene.add.text(CONTENT_R - SPACE.lg, COOP_LABEL_Y, '',
      textStyle('numM', { color: COLORS.GOLD_1 })).setOrigin(1, 0.5).setScrollFactor(0);

    const barW = CONTENT_W - SPACE.lg * 2;
    const barX = CONTENT_L + SPACE.lg;
    const barBg = this.scene.add.rectangle(PANEL_CX, COOP_BAR_Y, barW, COOP_BAR_H, COLORS.GREY_9, 0.95)
      .setStrokeStyle(1, COLORS.GREY_6)
      .setScrollFactor(0);

    ensureLivingBarTextures(this.scene);
    const coopBarPalette: LivingBarPalette = { dark: COLORS.GREEN_4, mid: COLORS.GREEN_2, light: COLORS.GREEN_1 };
    createGradientTexture(this.scene, COOP_BAR_TEX_KEY, coopBarPalette, barW, COOP_BAR_H);
    this.coopProgressBarFill = this.scene.add.image(barX, COOP_BAR_Y, COOP_BAR_TEX_KEY)
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    this.coopProgressBarFill.setCrop(0, 0, barW, COOP_BAR_H);

    this.coopUpgradesBtn = new UiButton(this.scene, {
      x: COOP_UPGRADE_BTN_X, y: COOP_BTN_Y, w: COOP_BTN_W, h: COOP_BTN_H,
      label: t('ui.lobby.upgrades'),
      intent: 'neutral',
      onClick: () => this.onOpenCoopDefenseUpgrades(),
    });

    // Items bleiben bis zum Sieg auf Map 10 gesperrt: `disabled` statt einer eigenen Farbe.
    this.coopItemsBtn = new UiButton(this.scene, {
      x: COOP_ITEMS_BTN_X, y: COOP_BTN_Y, w: COOP_BTN_W, h: COOP_BTN_H,
      label: t('ui.lobby.items'),
      intent: 'neutral',
      icon: 'lock',
      iconSize: 16,
      onClick: () => {
        if (!this.coopItemsUnlocked) return;
        this.onOpenCoopDefenseItems();
      },
    });
    this.coopItemsBtn.setEnabled(false);
    this.attachItemsLockTooltip();

    this.coopBand = this.scene.add.container(0, 0, [
      bandBg,
      bandLabel,
      this.coopProgressLevelText,
      this.coopProgressPointsText,
      barBg,
      this.coopProgressBarFill,
      this.coopUpgradesBtn.getRoot(),
      this.coopItemsBtn.getRoot(),
    ]).setScrollFactor(0).setVisible(false);
    objects.push(this.coopBand);

    // Living-Bar-Effekt auf dem Upgrade-Button: macht auf freie Punkte aufmerksam.
    this.upgradeBtnEffect = new LivingBarEffect(
      this.scene,
      this.coopBand,
      COOP_UPGRADE_BTN_X - COOP_BTN_W / 2,
      COOP_BTN_Y - COOP_BTN_H / 2,
      COOP_BTN_W,
      COOP_BTN_H,
      { dark: COLORS.GOLD_3, mid: COLORS.GOLD_1, light: COLORS.GOLD_1 },
      { glowTarget: this.coopUpgradesBtn.getBackground(), scrollFactor: 0, intensity: 0.34 },
    );
    // Effektpartikel ueber der Flaeche, aber unter der Beschriftung halten.
    this.coopBand.bringToTop(this.coopUpgradesBtn.getRoot());
    this.upgradeBtnEffect.stop();

    this.itemsBtnEffect = new LivingBarEffect(
      this.scene,
      this.coopBand,
      COOP_ITEMS_BTN_X - COOP_BTN_W / 2,
      COOP_BTN_Y - COOP_BTN_H / 2,
      COOP_BTN_W,
      COOP_BTN_H,
      { dark: COLORS.GOLD_3, mid: COLORS.GOLD_1, light: COLORS.GOLD_1 },
      { glowTarget: this.coopItemsBtn.getBackground(), scrollFactor: 0, intensity: 0.34 },
    );
    this.coopBand.bringToTop(this.coopItemsBtn.getRoot());
    this.itemsBtnEffect.stop();

    this.coopBarEffect = new LivingBarEffect(
      this.scene,
      this.coopBand,
      barX,
      COOP_BAR_Y - COOP_BAR_H / 2,
      barW,
      COOP_BAR_H,
      coopBarPalette,
      { glowTarget: this.coopProgressBarFill, scrollFactor: 0, intensity: 1.2 },
    );
    this.coopBarEffect.stop();

    // Zuletzt eingehaengt, damit der Tooltip ueber Buttons und Effektpartikeln liegt.
    this.itemsTooltip = new UiTooltip(this.scene, 360);
    this.coopBand.add(this.itemsTooltip.build());
  }

  /** Gesperrt erklaert der Mouse-Over den Weg zur Freischaltung. */
  private attachItemsLockTooltip(): void {
    const bg = this.coopItemsBtn?.getBackground();
    if (!bg) return;
    // Der Button ist im gesperrten Zustand nicht interaktiv; die Trefferflaeche muss deshalb
    // eigens gesetzt werden, sonst gaebe es kein pointerover fuer den Hinweis.
    bg.setInteractive({ useHandCursor: false });
    bg.on('pointerover', (pointer: Phaser.Input.Pointer) => {
      if (this.coopItemsUnlocked) return;
      this.itemsTooltip?.show(
        'ITEMS',
        COLORS.GOLD_1,
        [
          { text: t('ui.items.locked'), color: COLORS.GREY_1 },
          { text: '', color: COLORS.GREY_5 },
          { text: t('ui.items.unlockByVictory'), color: COLORS.GREY_3 },
          {
            text: getMapName(COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID, getLocale()),
            color: COLORS.GOLD_2,
            bold: true,
          },
          { text: '', color: COLORS.GREY_5 },
          { text: t('ui.items.victoryDrops'), color: COLORS.GREY_3 },
        ],
        pointer,
      );
    });
    bg.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.coopItemsUnlocked) return;
      this.itemsTooltip?.move(pointer);
    });
    bg.on('pointerout', () => this.itemsTooltip?.hide());
  }

  private teardown(): void {
    this.fullscreenUnsubscribe?.();
    this.fullscreenUnsubscribe = null;
    this.fullscreenHintEvent?.remove();
    this.fullscreenHintEvent = null;
    this.entranceTween?.remove();
    this.entranceTween = null;
    this.stopReadyGlow();
    this.connectionEnded = false;
    this.isReady = false;
    this.worldEntryInside = false;
    this.worldEntryAvailable = false;
    this.worldEntryEnabled = false;
    this.playerListSignature = null;
    this.roomQualitySignature = null;
    this.transportDiagnosticsSignature = null;
    this.coopProgressSignature = null;
    this.coopItemsSignature = null;
    this.playerContextMenu?.destroy();
    this.playerContextMenu = null;
    this.loadoutTooltip?.destroy();
    this.loadoutTooltip = null;
    this.loadoutTooltipRoot = null;
    this.playerNameTooltip?.destroy();
    this.playerNameTooltip = null;
    this.playerNameTooltipRoot = null;

    // Die Effekte haengen an Containern, die gleich zerstoert werden – vorher abbauen.
    this.upgradeBtnEffect?.destroy();
    this.upgradeBtnEffect = null;
    this.itemsBtnEffect?.destroy();
    this.itemsBtnEffect = null;
    this.coopBarEffect?.destroy();
    this.coopBarEffect = null;
    this.itemsTooltip?.destroy();
    this.itemsTooltip = null;

    // UiButtons melden globale Pointer-Listener ab; das erledigt nur ihr eigenes destroy().
    this.roomChip?.destroy();
    this.infoBtn?.destroy();
    this.inviteRow?.destroy();
    this.readyBtn?.destroy();
    this.retryBtn?.destroy();
    this.helpBtn?.destroy();
    this.optionsBtn?.destroy();
    this.fullscreenBtn?.destroy();
    this.testAreaBtn?.destroy();
    this.testAreaBtn = null;
    this.worldExitBtn?.destroy();
    this.worldExitBtn = null;
    this.coopUpgradesBtn?.destroy();
    this.coopItemsBtn?.destroy();
    this.coopUpgradesBtn = null;
    this.coopItemsBtn = null;

    if (this.container) {
      this.container.destroy(true);
      this.container = null;
    }
    if (this.systemBar) {
      this.systemBar.destroy(true);
      this.systemBar = null;
    }
    if (this.worldExitBar) {
      this.worldExitBar.destroy(true);
      this.worldExitBar = null;
    }
    this.playerRows.clear();
    this.waitingRows = [];
    this.inviteCopyIcon = null;
    this.coopBand = null;
    this.coopProgressLevelText = null;
    this.coopProgressBarFill = null;
    this.coopProgressPointsText = null;
  }

  show(): void {
    const wasVisible = this.visible;
    this.visible = true;
    this.container?.setVisible(true);
    this.systemBar?.setVisible(true);
    this.updateWorldEntryButtons();
    if (!wasVisible) this.playEntrance();
    this.updateReadyGlow();
  }

  /**
   * Synchronisiert die Teilnahme an der LobbyWorld. Der Entry sitzt im zentralen Lobby-Panel;
   * der Exit bleibt davon getrennt unten rechts sichtbar, sobald der lokale Spieler interaktiv
   * teilnimmt.
   */
  setWorldEntryState(state: { readonly inside: boolean; readonly canEnter: boolean } | null): void {
    this.worldEntryInside = state?.inside === true;
    this.worldEntryAvailable = state !== null;
    this.worldEntryEnabled = state?.canEnter === true;
    this.updateWorldEntryButtons();
  }

  private updateWorldEntryButtons(): void {
    const showEntry = this.visible && !this.worldEntryInside;
    const showExit = this.worldEntryAvailable && this.worldEntryInside;

    this.testAreaBtn
      ?.setVisible(showEntry)
      .setEnabled(showEntry && this.worldEntryAvailable && this.worldEntryEnabled
        && !this.btnLocked && !this.connectionEnded);
    // Der Button sitzt im eigenen Container; die Ankerwahl verschiebt ihn, statt ihn neu zu bauen.
    this.worldExitBar
      ?.setX(this.visible ? 0 : WORLD_EXIT_BTN_SOLO_X - WORLD_EXIT_BTN_X)
      .setVisible(showExit);
    this.worldExitBtn?.setEnabled(showExit && !this.connectionEnded);
  }

  hide(): void {
    this.visible = false;
    this.playerContextMenu?.close();
    this.loadoutTooltip?.hide();
    this.playerNameTooltip?.hide();
    this.entranceTween?.remove();
    this.entranceTween = null;
    this.stopReadyGlow();
    this.container?.setVisible(false);
    this.systemBar?.setVisible(false);
    this.updateWorldEntryButtons();
    this.upgradeBtnEffect?.stop();
    this.itemsBtnEffect?.stop();
    this.itemsTooltip?.hide();
    this.coopBarEffect?.stop();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Auftritt des Panels. Bewusst nur `alpha` und `y`: die Kinder des Containers liegen auf
   * Bildschirmkoordinaten, ein `scale` zoege sie Richtung Bildschirmecke (0, 0).
   */
  private playEntrance(): void {
    if (!this.container) return;
    this.entranceTween?.remove();
    this.container.setAlpha(0).setY(18);
    this.entranceTween = this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      y: 0,
      duration: MOTION.slow,
      ease: MOTION.ease.out,
    });
  }

  /** Synchronisiert die Spielerliste; unveraenderter Zustand mutiert und rastert keine GameObjects neu. */
  refreshPlayerList(connectedPlayers: PlayerProfile[]): void {
    if (!this.container) return;

    const mode = this.bridge.getGameMode();
    const hostId = this.bridge.getHostPlayerId();
    const signature = JSON.stringify([
      mode,
      hostId,
      this.bridge.getGamePhase(),
      this.bridge.isHost(),
      this.bridge.getRoomCode(),
      isCoopDefenseMode(mode) ? this.bridge.getCoopDefenseMapId() : null,
      connectedPlayers.map(profile => [
        (() => {
          const preview = this.bridge.getPlayerLobbyLoadoutPreview(profile.id);
          return [
            ...LOADOUT_SLOTS.map((slot) => this.getLobbyLoadoutItemId(profile.id, slot)),
            preview?.coopDefenseClassId ?? null,
            ...(preview?.tools ?? []).map((tool) => `${tool.kind}:${tool.id}`),
          ];
        })(),
        profile.id,
        profile.name,
        profile.colorHex,
        profile.teamId ?? null,
        this.bridge.getPlayerReady(profile.id),
        profile.id === hostId ? 'host' : this.bridge.getPlayerPing(profile.id),
      ]),
    ]);
    if (signature === this.playerListSignature) return;
    this.playerListSignature = signature;

    const currentIds = new Set(connectedPlayers.map(p => p.id));

    for (const [id, row] of this.playerRows) {
      if (!currentIds.has(id)) {
        this.playerContextMenu?.close();
        this.loadoutTooltip?.hide();
        this.playerNameTooltip?.hide();
        row.bg.destroy(); row.name.destroy(); row.badge.destroy();
        row.mark.destroy(); row.ping.destroy();
        row.loadoutFrame.destroy(); row.loadout.destroy(true);
        this.playerRows.delete(id);
      }
    }

    for (const profile of connectedPlayers) {
      if (!this.playerRows.has(profile.id)) {
        this.addPlayerRow(profile);
      } else {
        const row = this.playerRows.get(profile.id)!;
        row.name.setText(profile.name.slice(0, PLAYER_NAME_MAX_LENGTH));
        row.name.setColor(toCssColor(COLORS.GREY_1));
        this.refreshPlayerLoadout(profile.id, row);
      }
      this.setPlayerRowInteractive(profile.id, this.playerRows.get(profile.id)!.bg);
      this.setPlayerNameTooltipInteractive(this.playerRows.get(profile.id)!.name);
    }

    this.refreshHeader();
    this.layoutList();
    this.refreshBadges();
    this.refreshPings();
    this.updatePlayerNameTooltipVisibility();
    this.updateStatus(connectedPlayers.length);
    this.updateRoomActionButtons();
  }

  setRoomQuality(snapshot: RoomQualitySnapshot | null, localIsHost: boolean): void {
    const signature = JSON.stringify([
      localIsHost,
      snapshot?.status ?? null,
      snapshot?.thresholdMs ?? null,
      snapshot?.worstPingMs ?? null,
      snapshot?.measuredPlayers ?? null,
      snapshot?.totalPlayers ?? null,
      snapshot?.minSamplesCollected ?? null,
      snapshot?.requiredSamples ?? null,
      snapshot?.startBlocked ?? null,
    ]);
    if (signature === this.roomQualitySignature) return;
    this.roomQualitySignature = signature;
    this.roomQuality = snapshot;
    this.localIsHost = localIsHost;
    this.updateStatus(this.playerRows.size);
    this.updateRoomActionButtons();
  }

  /**
   * Zustand der direkten WebRTC-Verbindung. Hat Vorrang vor der Raumqualitaets-Zeile:
   * ob die Verbindung ueberhaupt direkt zustande kam, ist wichtiger als ihr Ping.
   */
  setTransportDiagnostics(worst: LinkDiagnostics | null): void {
    const signature = JSON.stringify([
      worst?.usesRelay ?? null,
      worst?.connectionState ?? null,
      worst?.iceConnectionState ?? null,
      worst?.fastChannelState ?? null,
      worst?.localCandidateType ?? null,
      worst?.remoteCandidateType ?? null,
      worst?.medianRttMs ?? null,
      worst?.jitterRttMs ?? null,
    ]);
    if (signature === this.transportDiagnosticsSignature) return;
    this.transportDiagnosticsSignature = signature;
    this.transportDiagnostics = worst;
    this.updateStatus(this.playerRows.size);
  }

  /** Bestaetigt den Kopiervorgang am Raum-Chip und direkt in der Einladen-Zeile. */
  showCopySuccess(): void {
    this.roomChip.setIcon('check');
    this.inviteRow.setIcon('check').setLabel(t('ui.lobby.linkCopied'));
    this.inviteCopyIcon?.setVisible(false);
    this.scene.time.delayedCall(1200, () => {
      if (!this.container) return;
      this.roomChip.setIcon('copy');
      this.inviteRow.setIcon('plus').setLabel(t('ui.lobby.inviteFriend'));
      this.inviteCopyIcon?.setVisible(true);
    });
  }

  /**
   * Transienter Hinweis am BEREIT-Button, wenn der Klick blockiert wurde, weil der lokale
   * Spieler-Stand noch nicht mit dem Host übereinstimmt (Roster-Konsistenz-Check).
   */
  showReadySyncNotice(): void {
    if (this.btnLocked) return;
    this.readyBtn.setLabel(t('ui.lobby.sync'));
    this.scene.time.delayedCall(1200, () => {
      if (!this.container || this.btnLocked) return;
      this.readyBtn.setLabel(this.isReady ? t('ui.lobby.notReady') : t('ui.lobby.ready'));
    });
  }

  setCoopDefenseProgress(progress: CoopDefenseProgressSnapshot | null): void {
    if (!this.coopBand || !this.coopProgressLevelText) return;

    const signature = progress
      ? [
        progress.level,
        progress.levelProgressFraction,
        progress.availableUpgradePoints,
        progress.availableBossPoints,
        progress.earnedBossPoints,
      ].join('|')
      : 'none';
    const shouldBeVisible = this.visible && progress !== null;
    if (signature === this.coopProgressSignature && this.coopBand.visible === shouldBeVisible) {
      return;
    }
    const bandVisibilityChanged = this.coopBand.visible !== shouldBeVisible;
    this.coopProgressSignature = signature;

    if (!progress) {
      this.coopBand.setVisible(false);
      this.upgradeBtnEffect?.stop();
      this.coopBarEffect?.stop();
      if (bandVisibilityChanged) this.layoutList();
      return;
    }

    this.coopBand.setVisible(this.visible);
    if (bandVisibilityChanged) this.layoutList();
    this.coopProgressLevelText.setText(`${t('ui.lobby.level')} ${progress.level}`);

    const barW = CONTENT_W - SPACE.lg * 2;
    const fillW = Math.max(0.001, barW * progress.levelProgressFraction);
    this.coopProgressBarFill?.setCrop(0, 0, fillW, COOP_BAR_H);
    this.coopBarEffect?.setFilledWidth(fillW);
    if (this.visible) this.coopBarEffect?.start();
    else this.coopBarEffect?.stop();

    const freePoints = progress.availableUpgradePoints;
    const upgradesAvailable = freePoints > 0 || progress.availableBossPoints > 0;
    this.coopProgressPointsText?.setText(
      `${freePoints} Upgrade-P.  ★ ${progress.availableBossPoints}/${progress.earnedBossPoints}`,
    );
    this.coopProgressPointsText?.setColor(toCssColor(
      upgradesAvailable ? COLORS.GOLD_1 : COLORS.GREY_4,
    ));

    // Gold bleibt als Kontur und Glanz lokal; die Flaeche konkurriert nicht mit BEREIT.
    this.coopUpgradesBtn?.setIntent(upgradesAvailable ? 'attention' : 'neutral');

    if (upgradesAvailable && this.visible) {
      this.upgradeBtnEffect?.setFilledWidth(COOP_BTN_W);
      this.upgradeBtnEffect?.start();
    } else {
      this.upgradeBtnEffect?.stop();
    }
  }

  /**
   * Zustand des Item-Buttons. Getrennt vom Fortschritts-Snapshot, weil Freischaltung, offene
   * Belohnung und ungesehene Teile nicht Teil der Upgrade-Progression sind.
   *
   * `hasUnseenItems` meint neu erhaltene Teile, die der Spieler noch nicht angesehen hat.
   * Wie freie Upgrade-Punkte aktiviert dieser Zustand dieselbe goldene Attention-Sprache.
   */
  setCoopDefenseItemsState(
    unlocked: boolean,
    pendingRewardCount: number,
    hasUnseenItems: boolean,
  ): void {
    if (!this.coopItemsBtn) return;

    const openCount = Math.max(0, Math.floor(pendingRewardCount));
    const signature = `${unlocked}|${openCount}|${hasUnseenItems}|${this.visible}`;
    if (signature === this.coopItemsSignature) return;
    this.coopItemsSignature = signature;
    this.coopItemsUnlocked = unlocked;
    // Ein offener Sperr-Hinweis waere nach dem Freischalten falsch.
    this.itemsTooltip?.hide();

    this.updateCoopDefenseMenuButtons();
    // Das Schloss traegt die Sperre; freigeschaltet braucht der Button kein Symbol mehr.
    this.coopItemsBtn.setIcon(unlocked ? null : 'lock');
    const needsAttention = unlocked && (openCount > 0 || hasUnseenItems);
    this.coopItemsBtn.setBadge(unlocked && openCount > 0 ? openCount : null);
    this.coopItemsBtn.setIntent(needsAttention ? 'attention' : 'neutral');
    if (needsAttention && this.visible) {
      this.itemsBtnEffect?.setFilledWidth(COOP_BTN_W);
      this.itemsBtnEffect?.start();
    } else {
      this.itemsBtnEffect?.stop();
    }
  }

  /** Button-Zustand nach isReady-Toggle anpassen. */
  setReadyButtonState(isReady: boolean): void {
    this.isReady = isReady;
    this.updateCoopDefenseMenuButtons();
    if (this.connectionEnded) {
      this.btnLocked = true;
      this.readyBtn.setEnabled(false).setLabel(t('ui.lobby.ended'));
      this.updateRoomActionButtons();
      return;
    }
    this.btnLocked = false;
    // Die Farbe beschreibt die Handlung, nicht den Zustand: bereit zu werden ist der Einstieg
    // (primary), ihn zurueckzunehmen ist eine gewoehnliche Nebenhandlung (neutral). Wer bereit
    // ist, sieht das am Haken in seiner Zeile und am Zaehler ueber der Liste.
    this.readyBtn
      .setEnabled(true)
      .setIntent(isReady ? 'neutral' : 'primary')
      .setLabel(isReady ? t('ui.lobby.notReady') : t('ui.lobby.ready'));
    this.updateReadyGlow();
    this.updateRoomActionButtons();
  }

  /** Upgrade- und Item-Menues bleiben geschlossen, solange der lokale Spieler bereit ist. */
  private updateCoopDefenseMenuButtons(): void {
    const enabled = !this.isReady && !this.connectionEnded;
    this.coopUpgradesBtn?.setEnabled(enabled);
    this.coopItemsBtn?.setEnabled(enabled && this.coopItemsUnlocked);
  }

  /**
   * Ruhiges Atem-Glimmen, solange der Spieler noch am Zug ist. Es hoert auf, sobald er bereit
   * ist – ein dauerhaft pulsierendes Element im Blickfeld wird sonst zur Stoerung.
   *
   * Auf der Qualitaetsstufe `low` entfaellt der Effekt, wie bei den Living-Bar-Effekten.
   */
  private updateReadyGlow(): void {
    const wanted = !this.isReady
      && !this.btnLocked
      && !this.connectionEnded
      && getGraphicsQualityProfile(this.scene).livingBarEffects;

    if (!wanted) {
      this.stopReadyGlow();
      return;
    }
    if (this.readyGlow) return;

    const target = this.readyBtn.getBackground();
    this.readyGlow = addExternalGlow(target, COLORS.GREEN_1, 4, 0, false, 0.1, 12, 'decorative');
    if (!this.readyGlow) return;
    this.readyGlowTween = this.scene.tweens.add({
      targets: this.readyGlow,
      outerStrength: 9,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: MOTION.ease.inOut,
    });
  }

  private stopReadyGlow(): void {
    this.readyGlowTween?.remove();
    this.readyGlowTween = null;
    if (!this.readyGlow) return;
    removeExternalFx(this.readyBtn.getBackground(), this.readyGlow);
    this.readyGlow = null;
  }

  /** Button deaktivieren wenn Runde startet. */
  lockButton(): void {
    this.btnLocked = true;
    this.readyBtn.setEnabled(false);
    this.stopReadyGlow();
    this.updateRoomActionButtons();
  }

  /**
   * Zeigt eine permanente Fehlermeldung, wenn die Partie nicht mehr weiterlaufen kann –
   * Host weg, Verbindung verloren, kein direkter Weg. Deaktiviert den BEREIT-Button,
   * bis das Overlay neu gebaut wird (build()).
   */
  showHostDisconnectedMessage(message?: string): void {
    this.playerContextMenu?.close();
    this.connectionEnded = true;
    this.statusText.setText(t('ui.lobby.ended')).setColor(toCssColor(COLORS.RED_2));
    this.roomQualityText
      .setText(`${message ?? t('ui.lobby.hostLeft')} ${t('ui.lobby.reloadForNewRoom')}`)
      .setColor(toCssColor(COLORS.RED_2));
    this.btnLocked = true;
    this.readyBtn.setEnabled(false).setLabel(t('ui.lobby.ended'));
    this.stopReadyGlow();
    this.updateRoomActionButtons();
  }

  // ── Interne Hilfsmethoden ─────────────────────────────────────────────────

  /** Kopfzeile: welcher Modus, welche Karte, welcher Raum. */
  private refreshHeader(): void {
    const mode = this.bridge.getGameMode();
    const title = isCoopDefenseMode(mode)
      ? `${getLocalizedGameModeLabel(mode)}  ·  ${getMapName(this.bridge.getCoopDefenseMapId(), getLocale())}`
      : getLocalizedGameModeLabel(mode);
    if (this.headerTitle.text !== title) this.headerTitle.setText(title);
    const code = this.bridge.getRoomCode();
    this.roomChip.setLabel(code);
  }

  private updateFullscreenIcon(): void {
    this.fullscreenBtn?.setIcon(isFullscreen() ? 'fullscreen-exit' : 'fullscreen-enter');
  }

  private onFullscreenClicked(): void {
    const result = toggleFullscreen();
    if (result === 'entered' || result === 'exited') return;

    // Vom Browser selbst hergestelltes Vollbild (Browsermenue oder ein F11, das der Browser
    // nicht durchreicht) kann nur der Browser wieder beenden – dann bleibt nur der Hinweis.
    this.showFullscreenHint(result === 'browser-locked'
      ? t('ui.lobby.fullscreenBrowserLocked')
      : t('ui.lobby.fullscreenUnavailable'));
  }

  private showFullscreenHint(text: string): void {
    this.fullscreenHintEvent?.remove();
    this.fullscreenBtn.setLabel(text);
    this.fullscreenHintEvent = this.scene.time.delayedCall(FULLSCREEN_HINT_MS, () => {
      this.fullscreenHintEvent = null;
      this.fullscreenBtn.setLabel(t('ui.lobby.fullscreen'));
    });
  }

  private addPlayerRow(profile: PlayerProfile): void {
    const own = profile.id === this.bridge.getLocalPlayerId();
    const bg = this.scene.add.image(
      PANEL_CX,
      LIST_Y,
      this.rowTexture(ROSTER_SLOT_W, ROSTER_SLOT_H, false, own, profile.colorHex),
    )
      .setScrollFactor(0);

    const name = this.scene.add.text(CONTENT_L + 40, LIST_Y, profile.name, textStyle('body', {
      color: COLORS.GREY_1,
    })).setOrigin(0, 0.5).setScrollFactor(0);
    name.setText(profile.name.slice(0, PLAYER_NAME_MAX_LENGTH));
    name
      .on('pointerover', (pointer: Phaser.Input.Pointer) => this.showCoopLevelTooltip(profile.id, pointer))
      .on('pointermove', (pointer: Phaser.Input.Pointer) => this.playerNameTooltip?.move(pointer))
      .on('pointerout', () => this.playerNameTooltip?.hide());

    const badge = this.scene.add.circle(CONTENT_L + READY_STATUS_OFFSET_X, LIST_Y, 11, COLORS.GREY_7)
      .setStrokeStyle(2, COLORS.GREY_4)
      .setScrollFactor(0);
    const mark = this.scene.add.image(CONTENT_L + READY_STATUS_OFFSET_X, LIST_Y, this.readyMarkTexture())
      .setDisplaySize(14, 14)
      .setVisible(false)
      .setScrollFactor(0);

    const ping = this.scene.add.text(CONTENT_L + ROSTER_SLOT_W - 10, LIST_Y, '', textStyle('numS'))
      .setOrigin(1, 0.5).setScrollFactor(0);
    const loadoutFrame = this.scene.add.image(
      CONTENT_L + LOADOUT_LEFT_OFFSET + LOADOUT_FRAME_W / 2,
      LIST_Y,
      this.loadoutFrameTexture(),
    ).setScrollFactor(0);
    const loadout = this.scene.add.container(CONTENT_L + LOADOUT_LEFT_OFFSET, LIST_Y)
      .setScrollFactor(0);

    const handlePlayerPointerUp = (
      pointer: Phaser.Input.Pointer,
      _localX: number,
      _localY: number,
      event: Phaser.Types.Input.EventData,
    ): void => {
      event?.stopPropagation();
      const currentProfile = this.bridge.getPlayerProfile(profile.id) ?? profile;
      if (this.canKickPlayer(currentProfile.id)) {
        this.openPlayerActionMenu(currentProfile, pointer.x, pointer.y);
      }
    };
    bg.on('pointerup', handlePlayerPointerUp);
    // Der Name ist fuer den Coop-Level-Tooltip interaktiv und liegt damit bei `topOnly` ueber
    // dem Zeilenhintergrund. Der bestehende Kick-Pfad bleibt deshalb auch dort identisch.
    name.on('pointerup', handlePlayerPointerUp);

    this.container!.add([bg, name, badge, mark, loadoutFrame, loadout, ping]);
    // Neue Zeilen gleiten herein, statt aufzuploppen.
    for (const object of [bg, name, badge, mark, loadoutFrame, loadout, ping]) {
      object.setAlpha(0);
      this.scene.tweens.add({
        targets: object, alpha: 1, duration: MOTION.base, ease: MOTION.ease.out,
      });
    }
    const row: PlayerRow = {
      bg, name, badge, mark, ping, loadoutFrame, loadout, loadoutSignature: null,
    };
    this.playerRows.set(profile.id, row);
    this.refreshPlayerLoadout(profile.id, row);
    this.setPlayerRowInteractive(profile.id, bg);
  }

  /** Loadout-IDs bleiben die vorhandenen per-Spieler-States; fehlende Legacy-States fallen auf Defaults. */
  private getLobbyLoadoutItemId(playerId: string, slot: LoadoutSlot): string | null {
    return this.bridge.getPlayerLoadoutSlot(playerId, slot) ?? DEFAULT_LOADOUT[slot]?.id ?? null;
  }

  private getInspectorLobbyTools(playerId: string): readonly LoadoutToolRef[] {
    return this.isInspectorLobbyPreview(playerId)
      ? this.bridge.getPlayerLobbyLoadoutPreview(playerId)?.tools ?? []
      : [];
  }

  private isInspectorLobbyPreview(playerId: string): boolean {
    return isCoopDefenseMode(this.bridge.getGameMode())
      && this.bridge.getPlayerLobbyLoadoutPreview(playerId)?.coopDefenseClassId === 'inspector_gadachs';
  }

  private getLobbyLoadoutPresentation(
    playerId: string,
    slot: LoadoutSlot,
  ): LoadoutItemPresentation | null {
    if (slot === 'utility' && this.isInspectorLobbyPreview(playerId)) {
      return {
        displayName: t('ui.loadout.utilityWheel'),
        textureKey: ensureIconTexture(this.scene, 'utility-rad', 56, COLORS.GOLD_2),
        accentColor: COLORS.GOLD_2,
      };
    }
    const itemId = this.getLobbyLoadoutItemId(playerId, slot);
    return itemId ? describeLoadoutItem(slot, itemId) : null;
  }

  /** Baut nur die vier kompakten Slot-Controls neu, nicht die Rosterzeile selbst. */
  private refreshPlayerLoadout(playerId: string, row: PlayerRow): void {
    const inspector = this.isInspectorLobbyPreview(playerId);
    const tools = inspector ? this.getInspectorLobbyTools(playerId) : [];
    const presentations = LOADOUT_SLOTS.map((slot) => this.getLobbyLoadoutPresentation(playerId, slot));
    const signature = JSON.stringify([
      inspector,
      ...LOADOUT_SLOTS.map((slot, index) => [
        slot,
        this.getLobbyLoadoutItemId(playerId, slot),
        presentations[index]?.textureKey ?? null,
        presentations[index]?.displayName ?? null,
      ]),
      ...tools.map((tool) => `${tool.kind}:${tool.id}`),
    ]);
    if (signature === row.loadoutSignature) return;

    row.loadoutSignature = signature;
    this.loadoutTooltip?.hide();
    row.loadout.removeAll(true);
    const slotStep = LOADOUT_ICON_SIZE + LOADOUT_ICON_GAP;
    const hoverGroup = createLoadoutHoverGroup((pointer) => {
      const bounds = row.loadout.getBounds();
      return Phaser.Geom.Rectangle.Contains(bounds, pointer.worldX, pointer.worldY);
    });
    LOADOUT_SLOTS.forEach((slot, index) => {
      const presentation = presentations[index];
      if (!presentation) return;
      const control = createLoadoutSlotControl(this.scene, {
        x: LOADOUT_FRAME_PADDING_X + LOADOUT_ICON_SIZE / 2 + index * slotStep,
        y: 0,
        width: LOADOUT_ICON_SIZE,
        height: LOADOUT_ICON_SIZE,
        accentColor: presentation.accentColor,
        presentation,
        compact: true,
        accentMode: 'lobby',
        hoverGroup,
        hoverKey: String(index),
        onClick: () => undefined,
        onPointerOver: (pointer) => {
          this.playerNameTooltip?.hide();
          this.showLoadoutTooltip(slot, presentation, pointer, inspector ? tools : []);
        },
        onPointerMove: (pointer) => this.loadoutTooltip?.move(pointer),
        onPointerOut: (pointer) => {
          if (!hoverGroup.isPointerInsideItem(pointer)) {
            this.loadoutTooltip?.hide();
          }
        },
      });
      row.loadout.add(control);
    });
  }

  private showLoadoutTooltip(
    slot: LoadoutSlot,
    presentation: LoadoutItemPresentation,
    pointer: Phaser.Input.Pointer,
    tools: readonly LoadoutToolRef[],
  ): void {
    if (!this.loadoutTooltip) return;
    if (this.container && this.loadoutTooltipRoot) this.container.bringToTop(this.loadoutTooltipRoot);

    const isInspectorRadial = slot === 'utility'
      && presentation.displayName === t('ui.loadout.utilityWheel');
    const lines = isInspectorRadial
      ? tools.length > 0
        ? tools.map((tool) => {
          const toolPresentation = describeLoadoutTool(tool);
          return {
            text: toolPresentation.displayName,
            color: toolPresentation.accentColor,
            bold: true,
            textureKey: toolPresentation.textureKey,
          };
        })
        : [{ text: t('ui.loadout.noTools'), color: TEXT.muted }]
      : [{
        text: presentation.displayName,
        color: TEXT.primary,
        bold: true,
        textureKey: presentation.textureKey,
      }];
    this.loadoutTooltip.show(
      isInspectorRadial ? t('ui.loadout.utilityWheel') : t(`ui.loadout.${slot}`),
      presentation.accentColor,
      lines,
      pointer,
    );
  }

  private canKickPlayer(playerId: string): boolean {
    return this.bridge.isHost()
      && this.bridge.getGamePhase() === 'LOBBY'
      && playerId !== this.bridge.getLocalPlayerId()
      && playerId !== this.bridge.getHostPlayerId();
  }

  private setPlayerRowInteractive(playerId: string, bg: Phaser.GameObjects.Image): void {
    if (this.canKickPlayer(playerId)) bg.setInteractive({ useHandCursor: true });
    else bg.disableInteractive();
  }

  private openPlayerActionMenu(profile: PlayerProfile, x: number, y: number): void {
    if (!this.playerContextMenu || !this.canKickPlayer(profile.id)) return;
    this.playerContextMenu.open({
      x,
      y,
      title: profile.name,
      titleColor: COLORS.GOLD_1,
      entries: [{
        label: t('ui.lobby.kickPlayer'),
        color: COLORS.RED_2,
        onPick: () => this.openKickConfirmation(profile, x, y),
      }],
    });
  }

  private openKickConfirmation(profile: PlayerProfile, x: number, y: number): void {
    if (!this.playerContextMenu || !this.canKickPlayer(profile.id)) return;
    const currentName = this.bridge.getPlayerName(profile.id);
    this.playerContextMenu.open({
      x,
      y,
      title: t('ui.lobby.kickPlayerConfirm'),
      titleColor: COLORS.RED_1,
      entries: [
        {
          label: `${t('ui.common.yes')}: ${currentName}`,
          color: COLORS.RED_2,
          onPick: () => { void this.confirmKick(profile.id); },
        },
        {
          label: t('ui.common.cancel').toUpperCase(),
          color: COLORS.GREY_2,
          onPick: () => undefined,
        },
      ],
    });
  }

  private async confirmKick(playerId: string): Promise<void> {
    if (!this.canKickPlayer(playerId)) return;
    const result = await this.bridge.kickPlayer(playerId);
    if (!result.ok && this.visible && this.roomQualityText.scene) {
      this.roomQualityText.setText(t('ui.lobby.kickFailed'))
        .setColor(toCssColor(COLORS.RED_2));
    }
  }

  /**
   * Ordnet Spielerzeilen, Wartezeilen und die Einladen-Zeile in der verfuegbaren Hoehe an.
   *
   * Passt nicht alles in voller Zeilenhoehe, schaltet die Liste auf kompakte Zeilen um und
   * laesst zuletzt die Einladen-Zeile weg – lieber vollstaendig und eng als abgeschnitten.
   */
  private layoutList(): void {
    if (!this.container) return;

    const mode = this.bridge.getGameMode();
    const teamMode = hasTeamSelection(mode);
    const slots = buildLobbyRosterSlots(mode, [...this.playerRows.keys()].map((id) => ({
      id,
      teamId: this.bridge.getPlayerProfile(id)?.teamId ?? null,
    })));
    this.syncWaitingRows(slots.filter((slot) => slot.playerId === null).length);

    this.teamHeaders?.blue.setVisible(teamMode).setPosition(CONTENT_L, LIST_Y);
    this.teamHeaders?.red.setVisible(teamMode).setPosition(
      CONTENT_L + ROSTER_SLOT_W + ROSTER_COLUMN_GAP,
      LIST_Y,
    );

    let waitingIndex = 0;
    let invitePlaced = false;
    for (const slot of slots) {
      const x = CONTENT_L + slot.column * (ROSTER_SLOT_W + ROSTER_COLUMN_GAP) + ROSTER_SLOT_W / 2;
      const y = LIST_Y + (teamMode ? TEAM_HEADER_H : 0) + ROSTER_SLOT_H / 2 + slot.row * ROSTER_ROW_STEP;
      if (slot.playerId) {
        const row = this.playerRows.get(slot.playerId);
        if (row) this.positionPlayerRow(
          row,
          x,
          y,
          ROSTER_SLOT_W,
          ROSTER_SLOT_H,
          slot.playerId === this.bridge.getLocalPlayerId(),
          this.bridge.getPlayerProfile(slot.playerId)?.colorHex ?? COLORS.GREY_4,
        );
      } else {
        const row = this.waitingRows[waitingIndex++];
        if (row) this.positionWaitingRow(row, x, y, ROSTER_SLOT_W, ROSTER_SLOT_H);
      }
      if (slot.invite && !this.connectionEnded) {
        this.inviteRow.setPosition(x, y);
        invitePlaced = true;
      }
    }
    this.inviteRow.setVisible(invitePlaced);
    if (invitePlaced) this.container.bringToTop(this.inviteRow.getRoot());

    // `y` steht jetzt unter dem letzten Eintrag – daraus folgt die Panelhoehe. Mit
    // Fortschrittsband gibt dessen Unterkante die Hoehe vor, nicht die Liste.
    this.panelBg.setTexture(this.panelTexture(PANEL_H_MAX)).setY(PANEL_Y + PANEL_H_MAX / 2);
    this.ctaDivider.setY(CTA_DIVIDER_Y_MAX);
    this.readyBtn.setPosition(PANEL_CX, CTA_DIVIDER_Y_MAX + CTA_BLOCK_H - READY_BTN_DY);
  }

  /**
   * Zieht Panelflaeche und Fussblock auf die Hoehe, die der Inhalt braucht.
   *
   * Die Oberkante bleibt fest – nur die Unterkante wandert, damit Kopfzeile und Liste nicht bei
   * jedem Beitritt springen.
   */
  /**
   * Panelflaechen werden je Hoehe gebacken; es gibt nur eine Handvoll davon.
   *
   * Der Rand ist bewusst neutral statt golden: Gold ist in dieser Oberflaeche die Farbe der
   * Progression. Ein goldener Rahmen um die ganze Flaeche haette dieselbe Bedeutung fuer alles
   * beansprucht und dem Fortschrittsband seine Auszeichnung genommen.
   */
  private panelTexture(height: number): string {
    return ensureLobbyPanelTexture(
      this.scene, `_lobby_panel_${Math.round(height)}`, PANEL_W, height, COLORS.GREY_8, BORDER.default,
    );
  }

  /** Haelt die Zahl der Platzhalterzeilen auf dem Sollwert. */
  private syncWaitingRows(count: number): void {
    while (this.waitingRows.length > count) {
      const row = this.waitingRows.pop()!;
      row.bg.destroy();
    }
    while (this.waitingRows.length < count) {
      const bg = this.scene.add.image(
        PANEL_CX,
        LIST_Y,
        this.rowTexture(ROSTER_SLOT_W, ROSTER_SLOT_H, true),
      )
        .setScrollFactor(0);
      this.container!.add(bg);
      this.waitingRows.push({ bg });
    }
  }

  private positionPlayerRow(
    row: PlayerRow,
    x: number,
    y: number,
    width: number,
    height: number,
    own: boolean,
    accentColor: number,
  ): void {
    const left = x - width / 2;
    row.bg.setPosition(x, y).setOrigin(0.5).setTexture(
      this.rowTexture(width, height, false, own, accentColor),
    );
    row.name.setPosition(left + 40, y);
    row.badge.setPosition(left + READY_STATUS_OFFSET_X, y);
    row.mark.setPosition(left + READY_STATUS_OFFSET_X, y);
    row.ping.setPosition(x + width / 2 - 10, y);
    row.loadoutFrame.setPosition(left + LOADOUT_LEFT_OFFSET + LOADOUT_FRAME_W / 2, y);
    row.loadout.setPosition(left + LOADOUT_LEFT_OFFSET, y);
  }

  private positionWaitingRow(row: WaitingRow, x: number, y: number, width: number, height: number): void {
    row.bg.setPosition(x, y).setOrigin(0.5).setTexture(this.rowTexture(width, height, true));
  }

  /** Gebackene Zeilenflaeche in der gewuenschten Hoehe; belegte und freie Plaetze unterscheiden sich. */
  private rowTexture(
    width: number,
    height: number,
    ghost: boolean,
    own = false,
    accentColor?: number,
  ): string {
    return ensureRoundedTexture(this.scene, {
      key: rowTextureKey(width, height, ghost, own, accentColor),
      w: width,
      h: height,
      radius: 10,
      topColor: ghost ? COLORS.GREY_7 : COLORS.GREY_6,
      bottomColor: COLORS.GREY_8,
      fillAlpha: ghost ? 0.18 : own ? 0.76 : 0.66,
      strokeColor: ghost ? COLORS.GREY_5 : COLORS.GREY_4,
      strokeAlpha: ghost ? 0.1 : own ? 0.72 : 0.46,
      strokeWidth: own ? 2 : 1,
      highlightAlpha: ghost ? 0.01 : 0.04,
      leftAccentColor: ghost ? undefined : accentColor,
      leftAccentAlpha: ghost ? 0 : own ? 1 : 0.9,
      leftAccentWidth: own ? 7 : 6,
    });
  }

  /** Ruhige Tray-Flaeche, die die vier zusammengehoerenden Loadout-Slots klar gruppiert. */
  private loadoutFrameTexture(): string {
    return ensureRoundedTexture(this.scene, {
      key: `_lobby_loadout_tray_${LOADOUT_FRAME_W}x${LOADOUT_FRAME_H}`,
      w: LOADOUT_FRAME_W,
      h: LOADOUT_FRAME_H,
      radius: 7,
      topColor: COLORS.GREY_8,
      bottomColor: COLORS.GREY_9,
      fillAlpha: 0.18,
      strokeColor: BORDER.subtle,
      strokeAlpha: 0.38,
      strokeWidth: 1,
      highlightAlpha: 0.015,
    });
  }

  private refreshBadges(): void {
    for (const [id, row] of this.playerRows) {
      const ready = this.bridge.getPlayerReady(id);
      row.badge.setFillStyle(ready ? COLORS.GREEN_5 : COLORS.GREY_7);
      row.badge.setStrokeStyle(2, ready ? COLORS.GREEN_1 : COLORS.GREY_4);
      row.mark.setVisible(ready).setTexture(this.readyMarkTexture());
      row.mark.setDisplaySize(14, 14);
    }
  }

  /** Gemeinsames Check-Icon fuer die Bereitschaftsanzeige einer Spielerzeile. */
  private readyMarkTexture(): string {
    return ensureIconTexture(
      this.scene,
      'check',
      28,
      COLORS.GREEN_1,
    );
  }

  private updatePlayerNameTooltipVisibility(): void {
    const showLevels = isCoopDefenseMode(this.bridge.getGameMode());
    if (!showLevels) this.playerNameTooltip?.hide();
    for (const row of this.playerRows.values()) {
      if (showLevels) row.name.setInteractive({ useHandCursor: false });
      else row.name.disableInteractive();
    }
  }

  private setPlayerNameTooltipInteractive(name: Phaser.GameObjects.Text): void {
    if (isCoopDefenseMode(this.bridge.getGameMode())) name.setInteractive({ useHandCursor: false });
    else name.disableInteractive();
  }

  private showCoopLevelTooltip(playerId: string, pointer: Phaser.Input.Pointer): void {
    if (!this.playerNameTooltip || !isCoopDefenseMode(this.bridge.getGameMode())) return;
    if (this.container && this.playerNameTooltipRoot) this.container.bringToTop(this.playerNameTooltipRoot);
    this.loadoutTooltip?.hide();
    this.playerNameTooltip.show(
      `Coop-Level ${this.bridge.getPlayerCoopDefenseLevel(playerId)}`,
      TEXT.accent,
      [],
      pointer,
    );
  }

  private refreshPings(): void {
    const hostId = this.bridge.getHostPlayerId();
    for (const [id, row] of this.playerRows) {
      // Der Host misst sich nicht selbst. Statt einer nichtssagenden Null steht dort, wer den
      // Raum haelt – das beantwortet fuer die Mitspieler gleich die wichtigere Frage.
      if (id === hostId) {
        row.ping.setText(t('ui.lobby.host')).setColor(toCssColor(COLORS.GREEN_2));
        continue;
      }
      const ms = this.bridge.getPlayerPing(id);
      if (ms === null) {
        row.ping.setText('–').setColor(toCssColor(TEXT.muted));
        continue;
      }
      row.ping.setText(`${ms}ms`).setColor(getPingColor(ms));
    }
  }

  private updateStatus(playerCount: number): void {
    // Nach einem Verbindungsabbruch bleibt die Fehlermeldung stehen, bis build() das Overlay neu aufbaut.
    if (this.connectionEnded) return;

    const readyCount = [...this.playerRows.keys()]
      .filter(id => this.bridge.getPlayerReady(id)).length;
    const allReady = playerCount > 0 && readyCount === playerCount;
    this.statusText.setText(`${readyCount} / ${playerCount} ${t('ui.lobby.ready')}`)
      .setColor(toCssColor(allReady ? COLORS.GREEN_2 : TEXT.secondary));

    const transport = this.formatTransportText();
    if (transport) {
      this.roomQualityText.setText(transport.text).setColor(transport.color);
      return;
    }

    const roomSummary = this.formatRoomQualityText();
    const color = this.roomQuality
      ? this.getRoomQualityColor(this.roomQuality.status)
      : toCssColor(TEXT.muted);
    this.roomQualityText.setText(roomSummary).setColor(color);
  }

  /**
   * Verbindungszustand in Klartext. `null` bedeutet: nichts zu melden, die Raumqualitaets-Zeile
   * darf uebernehmen (typisch: allein in der Lobby, es gibt noch keine Verbindung zu messen).
   */
  private formatTransportText(): { text: string; color: string } | null {
    const link = this.transportDiagnostics;
    if (!link) return null;

    if (link.usesRelay) {
      return {
        text: t('ui.lobby.relayRejected'),
        color: toCssColor(COLORS.RED_2),
      };
    }

    if (link.connectionState === 'failed' || link.iceConnectionState === 'failed') {
      return {
        text: t('ui.lobby.directConnectionFailed'),
        color: toCssColor(COLORS.RED_2),
      };
    }

    if (link.localCandidateType === null || link.fastChannelState !== 'open') {
      return { text: t('ui.lobby.connectionBuilding'), color: toCssColor(TEXT.muted) };
    }

    if (link.medianRttMs === null) {
      return { text: t('ui.lobby.directPing'), color: toCssColor(COLORS.GREEN_2) };
    }

    return {
      text: `● Direkt · ${Math.round(link.medianRttMs)} ms`,
      color: getPingColor(link.medianRttMs),
    };
  }

  private updateRoomActionButtons(): void {
    const showRetry = this.localIsHost || this.connectionEnded;
    const retryDisabled = this.btnLocked && !this.connectionEnded;

    // Der Raumcode ist eine Information, kein Host-Werkzeug: er bleibt fuer alle lesbar, und
    // einladen darf auch ein Gast – der Link zeigt auf denselben Raum. Gedimmt wird nur, was
    // wirklich nicht mehr geht (laufender Rundenstart).
    this.roomChip.setVisible(true).setEnabled(!this.btnLocked || this.connectionEnded);
    this.roomCaption.setText(this.connectionEnded ? t('ui.lobby.ended') : t('ui.lobby.room'));
    this.infoBtn.setVisible(this.localIsHost && !this.connectionEnded);
    this.retryBtn.setVisible(showRetry).setEnabled(showRetry && !retryDisabled);
    this.inviteRow.setEnabled(!this.btnLocked && !this.connectionEnded);
    this.updateWorldEntryButtons();
  }

  private formatRoomQualityText(): string {
    if (!this.roomQuality) return '';

    if (this.roomQuality.status === 'sampling') {
      return t('ui.lobby.roomSampling', {
        current: this.roomQuality.minSamplesCollected,
        required: this.roomQuality.requiredSamples,
      });
    }

    if (this.roomQuality.status === 'waiting') {
      return '';
    }

    if (this.roomQuality.status === 'good' && this.roomQuality.worstPingMs !== null) {
      if (!this.localIsHost) return '';
      return t('ui.lobby.roomGood', {
        worst: this.roomQuality.worstPingMs,
        target: this.roomQuality.thresholdMs,
      });
    }

    if (this.roomQuality.status === 'bad' && this.roomQuality.worstPingMs !== null) {
      return t('ui.lobby.roomBad', {
        worst: this.roomQuality.worstPingMs,
        target: this.roomQuality.thresholdMs,
      });
    }

    return '';
  }

  private getRoomQualityColor(status: RoomQualitySnapshot['status']): string {
    if (status === 'good') return toCssColor(COLORS.GREEN_2);
    if (status === 'bad') return toCssColor(COLORS.RED_2);
    return toCssColor(TEXT.muted);
  }
}
