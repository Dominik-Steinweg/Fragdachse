import { getLoadoutUtilityId } from '../loadout/LoadoutTools';
import { getCoopDefenseToolCapacity } from '../utils/coopDefenseUpgrades';
/**
 * LobbyOverlay – kein Phaser-Scene, sondern eine Helferklasse.
 * Verwaltet das semi-transparente Lobby-UI innerhalb der ArenaScene.
 * Sichtbar wenn gamePhase === 'LOBBY' ODER lokaler Spieler isReady === false.
 *
 * Farbhierarchie: der BEREIT-Button ist die einzige gesaettigte Flaeche des Bildschirms. Gold
 * gehoert der Progression, Rot echten Fehlern, alles Uebrige ist neutral oder ghost. Die Rollen
 * kommen aus `ui/uiTheme`; dieser Datei gehoert keine eigene Farbtabelle mehr.
 *
 * Screen-fixed Kartenmasse gehoeren LobbyLayout; die World-Geometrie ist davon unabhaengig.
 */
import * as Phaser from 'phaser';
import type { BackdropSurface } from '../effects/postfx/BackdropBlur';
import { COLORS, DEPTH, GAME_HEIGHT, GAME_WIDTH, TEAM_BLUE_COLOR, TEAM_RED_COLOR, toCssColor } from '../config';
import { hasTeamSelection, isCoopDefenseMode } from '../gameModes';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { getLocale, t } from '../i18n';
import { formatDate } from '../i18n/format';
import {
  describeLoadoutItem,
  describeLoadoutTool,
  type LoadoutItemPresentation,
} from '../loadout/LoadoutCatalog';
import { DEFAULT_LOADOUT } from '../loadout/LoadoutConfig';
import { buildLobbyRosterSlots } from '../lobby/LobbyRosterLayout';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { LinkDiagnostics } from '../network/peer';
import type { LoadoutSlot, LoadoutToolRef, PlayerProfile, RoomQualitySnapshot, TeamId } from '../types';
import { createLoadoutHoverGroup, createLoadoutSlotControl } from '../ui/LoadoutSlotControl';
import { LobbyAlertBanner, type LobbyAlert } from '../ui/LobbyAlertBanner';
import { getLobbyReliefBounds, LOBBY_CARD, LOBBY_PLAYER_FOOTER, LOBBY_ROSTER_ROW_STEP, LOBBY_WORLD_BUTTON } from '../ui/LobbyLayout';
import { FOREST } from '../ui/UiSkin';
import { ensureForestFrame, ensureForestPanel, forestOrnament } from '../ui/forestTextures';
import { LobbyPlayerProgress } from '../ui/LobbyPlayerProgress';
import { LobbyRosterScroller } from '../ui/LobbyRosterScroller';
import { LobbySettingsControls } from '../ui/LobbySettingsControls';
import { UiButton } from '../ui/UiButton';
import { UiContextMenu } from '../ui/UiContextMenu';
import { UiTooltip } from '../ui/UiTooltip';
import { isFullscreen, onFullscreenChange, toggleFullscreen } from '../ui/fullscreen';
import {
  ensureIconTexture,
  ensureLobbyFooterTexture,
  ensureLobbyPanelTexture,
  ensureRoundedTexture,
} from '../ui/uiTextures';
import { BORDER, getPingColor, MOTION, TEXT, textStyle } from '../ui/uiTheme';
import type { CoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';
import { addExternalGlow, removeExternalFx, type GlowHandle } from '../utils/phaserFx';
import { PLAYER_NAME_MAX_LENGTH } from '../utils/playerName';
import { promoteToClarityCamera } from './arena/ClarityCameraRegistry';

// ── Panel ────────────────────────────────────────────────────────────────────
const PANEL_W = LOBBY_CARD.width;
const PANEL_H_MAX = LOBBY_CARD.height;
const PANEL_X = LOBBY_CARD.left;
const PANEL_Y = LOBBY_CARD.top;
const PANEL_CX = PANEL_X + PANEL_W / 2;
const CONTENT_L = PANEL_X + LOBBY_CARD.padding;
const CONTENT_R = CONTENT_L + LOBBY_CARD.contentWidth;
const CONTENT_W = LOBBY_CARD.contentWidth;

/** Startversatz des Panel-Auftritts bei einer spaeteren Rueckkehr in die Lobby. */
const ENTRANCE_OFFSET_Y = 18;

// ── Raumzeile ───────────────────────────────────────────────────────
const HEADER_Y = LOBBY_CARD.titleY;
const QUALITY_Y = PANEL_Y + 90;
const HEADER_DIVIDER_Y = 482;
const ROOM_CHIP_W = 224;
const ROOM_CHIP_H = 38;
const ROOM_CHIP_X = CONTENT_L + ROOM_CHIP_W / 2;

// ── Spielerliste ─────────────────────────────────────────────────────────────
const LIST_LABEL_Y = 496;
const LIST_Y = LOBBY_CARD.rosterTop;
const ROSTER_SLOT_W = CONTENT_W - 16;
const ROSTER_SLOT_H = 52;
const ROSTER_ROW_STEP = LOBBY_ROSTER_ROW_STEP;
const TEAM_HEADER_H = 28;
const READY_STATUS_OFFSET_X = 23;
const LOADOUT_ICON_SIZE = 36;
const LOADOUT_ICON_GAP = 2;
const LOADOUT_SLOTS: readonly LoadoutSlot[] = ['weapon1', 'weapon2', 'utility', 'ultimate'];
const LOADOUT_CONTENT_W = LOADOUT_ICON_SIZE * LOADOUT_SLOTS.length + LOADOUT_ICON_GAP * (LOADOUT_SLOTS.length - 1);
const LOADOUT_FRAME_PADDING_X = 3;
const LOADOUT_FRAME_PADDING_Y = 3;
const LOADOUT_FRAME_W = LOADOUT_CONTENT_W + LOADOUT_FRAME_PADDING_X * 2;
const LOADOUT_FRAME_H = LOADOUT_ICON_SIZE + LOADOUT_FRAME_PADDING_Y * 2;
/** Fester Anker des Loadout-Trays mit etwas Luft zur Ping-/HOST-Spalte. */
const LOADOUT_LEFT_OFFSET = ROSTER_SLOT_W - LOADOUT_FRAME_W - 68;

// ── Fixed footer; the primary action remains below the history actions. ──
const CTA_BLOCK_H = 152;
const READY_BTN_W = CONTENT_W;
const READY_BTN_H = 64;
const HOST_BTN_W = 200;
const HOST_BTN_H = ROOM_CHIP_H;
const HOST_BTN_X = CONTENT_L + ROOM_CHIP_W + 8 + HOST_BTN_W / 2;
const INFO_BTN_SIZE = 36;
const INFO_BTN_X = CONTENT_R - INFO_BTN_SIZE / 2;
const CTA_DIVIDER_Y_MAX = LOBBY_CARD.rosterBottom + 12;
const CTA_FADE_OVERLAP = 24;

// ── Ausserhalb des Panels ────────────────────────────────────────────────────
const BUILD_INFO_X = 16;
const BUILD_INFO_Y = GAME_HEIGHT - 16;
const SYSTEM_BAR_GAP = 8;
const SYSTEM_BAR_H = 40;
const HELP_BTN_W = (LOBBY_PLAYER_FOOTER.width - SYSTEM_BAR_GAP * 2) / 3;
const OPTIONS_BTN_W = HELP_BTN_W;
const FULLSCREEN_BTN_W = HELP_BTN_W;
const SYSTEM_BAR_Y = LOBBY_CARD.systemY;
const FULLSCREEN_BTN_X = LOBBY_PLAYER_FOOTER.left + LOBBY_PLAYER_FOOTER.width - FULLSCREEN_BTN_W / 2;
const OPTIONS_BTN_X = FULLSCREEN_BTN_X - FULLSCREEN_BTN_W / 2 - SYSTEM_BAR_GAP - OPTIONS_BTN_W / 2;
const HELP_BTN_X = OPTIONS_BTN_X - OPTIONS_BTN_W / 2 - SYSTEM_BAR_GAP - HELP_BTN_W / 2;
const FULLSCREEN_HINT_MS = 2200;

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
  root: Phaser.GameObjects.Container;
  bg:    Phaser.GameObjects.Image;
  name:  Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Arc;
  mark:  Phaser.GameObjects.Image;
  ping:  Phaser.GameObjects.Text;
  loadoutFrame: Phaser.GameObjects.Image;
  loadout: Phaser.GameObjects.Container;
  loadoutSignature: string | null;
};

export class LobbyOverlay {
  private container:      Phaser.GameObjects.Container | null = null;
  private systemBar:      Phaser.GameObjects.Container | null = null;
  /** Austritt aus dem Testgelaende; unabhaengig vom Lobby-Panel sichtbar. */
  private worldExitBar:   Phaser.GameObjects.Container | null = null;
  private worldExitBtn:   UiButton | null = null;
  /** Entry sitzt unten zwischen den Karten und ist vom Exit bewusst getrennt. */
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
  private teamHeaders:     Record<TeamId, Phaser.GameObjects.Text> | null = null;
  private forestRelief: Phaser.GameObjects.Image | null = null;
  private panelBg!:       Phaser.GameObjects.Image;
  private ctaDivider!:    Phaser.GameObjects.Rectangle;
  private headerTitle!:   Phaser.GameObjects.Text;
  private statusText!:    Phaser.GameObjects.Text;
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
  /**
   * Hinter dem Bootscreen stehen Panel und Spielerzeilen bereits in ihrem Endzustand.
   * Erst spaetere Lobby-Auftritte und neue Spieler erhalten eine Eintrittsanimation.
   */
  private bootPreparing = true;
  private readyGlow: GlowHandle | null = null;
  private readyGlowTween: Phaser.Tweens.Tween | null = null;
  private progress: LobbyPlayerProgress | null = null;
  private settings: LobbySettingsControls | null = null;
  private rosterScroller: LobbyRosterScroller | null = null;
  private replayBtn: UiButton | null = null;
  private statisticsBtn: UiButton | null = null;
  private resultsReplayAvailable = false;
  private replayResultsHandler: (() => void) | null = null;
  private roomStatsDetailHandler: (() => void) | null = null;
  private lobbyAlertBanner: LobbyAlertBanner | null = null;
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

  setCoopDefenseProgress(progress: CoopDefenseProgressSnapshot | null): void { this.progress?.setCoopDefenseProgress(progress); }
  setCoopDefenseItemsState(unlocked: boolean, pending: number, unseen: boolean): void {
    this.progress?.setCoopDefenseItemsState(unlocked, pending, unseen);
  }
  setResultsReplayHandler(handler: () => void): void { this.replayResultsHandler = handler; }
  setRoomStatisticsDetailHandler(handler: () => void): void { this.roomStatsDetailHandler = handler; }
  setResultsReplayAvailable(available: boolean): void {
    this.resultsReplayAvailable = available;
    this.replayBtn?.setVisible(available);
    this.statisticsBtn?.setVisible(available);
  }
  isHotkeyInputBlocked(): boolean { return (this.settings?.isOpen() ?? false) || (this.playerContextMenu?.isOpen() ?? false); }

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
        `_lobby_forest_footer_${PANEL_W - LOBBY_CARD.glassInset * 2}x${footerH}`,
        PANEL_W - LOBBY_CARD.glassInset * 2,
        footerH,
        FOREST.sunken,
      ),
    ).setScrollFactor(0));

    // ── Kopfzeile: was wird gespielt, und in welchem Raum ─────────────────
    objects.push(this.scene.add.image(PANEL_CX, PANEL_Y + PANEL_H_MAX / 2,
      ensureForestFrame(this.scene, PANEL_W, PANEL_H_MAX))
      .setDisplaySize(PANEL_W, PANEL_H_MAX).setScrollFactor(0));
    this.forestRelief = forestOrnament(this.scene, 'relief', PANEL_CX, LIST_Y, 400, 200)
      .setAlpha(0.16).setVisible(false);
    objects.push(this.forestRelief);
    this.headerTitle = this.scene.add.text(PANEL_CX, HEADER_Y, '', textStyle('title', {
      color: FOREST.text,
    })).setOrigin(0.5).setScrollFactor(0).setStroke('#23170f', 3);
    objects.push(this.headerTitle);

    this.roomChip = new UiButton(this.scene, { skin: 'forest',
      x: ROOM_CHIP_X, y: QUALITY_Y, w: ROOM_CHIP_W, h: ROOM_CHIP_H,
      surface: 'glass', label: this.bridge.getRoomCode(),
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

    this.infoBtn = new UiButton(this.scene, { skin: 'forest',
      x: INFO_BTN_X, y: QUALITY_Y, w: INFO_BTN_SIZE, h: INFO_BTN_SIZE,
      intent: 'ghost',
      icon: 'info',
      iconOnly: true,
      iconSize: 16,
      onClick: () => {
        this.playerContextMenu?.open({
          x: INFO_BTN_X - 210, y: QUALITY_Y + 26,
          title: t('ui.lobby.room') + ' ' + this.bridge.getRoomCode(),
          titleColor: TEXT.primary,
          description: [this.formatTransportText()?.text, this.formatRoomQualityText()].filter(Boolean).join('\n\n')
            || t('ui.lobby.pingPreparing'),
          entries: [{ label: t('ui.lobby.netDetails'), color: TEXT.primary, onPick: this.onShowNetDiagnostics }],
        });
      },
    });
    objects.push(this.infoBtn.getRoot());

    this.retryBtn = new UiButton(this.scene, { skin: 'forest',
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
      this.scene.add.text(CONTENT_L, LIST_LABEL_Y, t('ui.lobby.players'), textStyle('section', { color: FOREST.muted }))
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
      CONTENT_L,
      LIST_Y,
      t('ui.lobby.teamRed'),
      textStyle('caption', { color: TEAM_RED_COLOR }),
    ).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);
    this.teamHeaders = { blue: blueHeader, red: redHeader };
    objects.push(blueHeader, redHeader);

    // Einladen-Zeile: beantwortet die eigentliche Frage einer wartenden Lobby und ersetzt den
    // frueheren, gleich lauten Kopieren-Button in der Fusszeile.
    this.inviteRow = new UiButton(this.scene, { skin: 'forest',
      x: PANEL_CX, y: LIST_Y, w: ROSTER_SLOT_W, h: ROSTER_SLOT_H,
      surface: 'glass', label: t('ui.lobby.inviteFriend'),
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

    this.readyBtn = new UiButton(this.scene, { skin: 'forest',
      x: PANEL_CX, y: LOBBY_CARD.readyY, w: READY_BTN_W, h: READY_BTN_H,
      label: t('ui.lobby.ready'),
      labelRole: 'subtitle',
      intent: 'primary',
      onClick: () => { if (!this.btnLocked) this.onReadyToggled(); },
    });
    objects.push(this.readyBtn.getRoot());
    const historyW = (CONTENT_W - 12) / 2;
    this.replayBtn = new UiButton(this.scene, { skin: 'forest',
      x: CONTENT_L + historyW / 2, y: LOBBY_CARD.historyY, w: historyW, h: 40,
      label: t('ui.results.lastRound'), intent: 'neutral', labelRole: 'labelSm',
      onClick: () => this.replayResultsHandler?.(),
    });
    this.statisticsBtn = new UiButton(this.scene, { skin: 'forest',
      x: CONTENT_R - historyW / 2, y: LOBBY_CARD.historyY, w: historyW, h: 40,
      label: t('ui.results.roomStats'), intent: 'neutral', labelRole: 'labelSm',
      onClick: () => this.roomStatsDetailHandler?.(),
    });
    objects.push(this.replayBtn.getRoot(), this.statisticsBtn.getRoot());
    this.setResultsReplayAvailable(this.resultsReplayAvailable);

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
    this.helpBtn = new UiButton(this.scene, { skin: 'forest',
      x: HELP_BTN_X, y: SYSTEM_BAR_Y, w: HELP_BTN_W, h: SYSTEM_BAR_H,
      label: t('ui.lobby.help'),
      labelRole: 'labelSm',
      intent: 'secondary',
      icon: 'help',
      iconSize: 20,
      onClick: () => this.onShowHelp(),
    });
    this.optionsBtn = new UiButton(this.scene, { skin: 'forest',
      x: OPTIONS_BTN_X, y: SYSTEM_BAR_Y, w: OPTIONS_BTN_W, h: SYSTEM_BAR_H,
      label: t('ui.lobby.options'),
      labelRole: 'labelSm',
      intent: 'secondary',
      icon: 'settings',
      iconSize: 20,
      onClick: () => this.onShowOptions(),
    });
    this.fullscreenBtn = new UiButton(this.scene, { skin: 'forest',
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

    this.progress = new LobbyPlayerProgress(this.scene,
      this.onOpenCoopDefenseUpgrades, this.onOpenCoopDefenseItems);
    this.progress.build(objects);

    // Freistehender Einstieg in die World zwischen den beiden Karten.
    this.testAreaBtn = new UiButton(this.scene, { skin: 'forest',
      ...LOBBY_WORLD_BUTTON,
      label: t('ui.lobby.testArea'),
      intent: 'neutral',
      onClick: () => {
        if (!this.worldEntryInside) this.onToggleWorldEntry(true);
      },
    }).setVisible(false);
    objects.push(this.testAreaBtn.getRoot());
    this.testAreaBtn.getRoot().add(forestOrnament(this.scene, 'leaves', 96, 0, 64, 64));

    this.container = this.scene.add.container(0, 0, objects).setDepth(DEPTH.OVERLAY);
    promoteToClarityCamera(this.scene, this.container);
    this.settings = new LobbySettingsControls(this.scene, this.bridge, this.container);
    this.rosterScroller = new LobbyRosterScroller(this.scene, this.container,
      () => this.visible && !this.settings?.isOpen() && !this.playerContextMenu?.isOpen(),
      () => { this.loadoutTooltip?.hide(); this.playerNameTooltip?.hide(); this.layoutList(); });
    this.playerContextMenu = new UiContextMenu(this.scene, this.container, DEPTH.OVERLAY + 3, 'forest');
    this.loadoutTooltip = new UiTooltip(this.scene, 280, undefined, undefined, 'forest');
    this.loadoutTooltipRoot = this.loadoutTooltip.build();
    this.container.add(this.loadoutTooltipRoot);
    this.playerNameTooltip = new UiTooltip(this.scene, 180, undefined, undefined, 'forest');
    this.playerNameTooltipRoot = this.playerNameTooltip.build();
    this.container.add(this.playerNameTooltipRoot);
    // Im Normalzustand unsichtbar; im Fehlerfall sitzt der Banner ueber dem Panel, ohne dessen
    // Geometrie oder die Hoehe der Liste zu veraendern.
    this.lobbyAlertBanner = new LobbyAlertBanner(this.scene);
    this.container.add(this.lobbyAlertBanner.build());
    this.container.setVisible(this.visible);

    this.systemBar = this.scene.add.container(0, 0, [
      this.helpBtn.getRoot(),
      this.optionsBtn.getRoot(),
      this.fullscreenBtn.getRoot(),
    ]).setDepth(DEPTH.OVERLAY);
    promoteToClarityCamera(this.scene, this.systemBar);
    this.systemBar.setVisible(this.visible);

    // Eigener Container: seine Sichtbarkeit folgt der World-Teilnahme, nicht dem Lobby-Panel.
    this.worldExitBtn = new UiButton(this.scene, { skin: 'forest',
      ...LOBBY_WORLD_BUTTON,
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
    this.worldExitBtn.getRoot().add(forestOrnament(this.scene, 'leaves', 96, 0, 64, 64));

    this.refreshHeader();
    this.updateRoomActionButtons();
    this.layoutList();
  }

  private teardown(): void {
    this.settings?.destroy(); this.settings = null;
    this.rosterScroller?.destroy(); this.rosterScroller = null;
    this.progress?.destroy(); this.progress = null;
    this.replayBtn?.destroy(); this.replayBtn = null;
    this.statisticsBtn?.destroy(); this.statisticsBtn = null;
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
    this.playerContextMenu?.destroy();
    this.playerContextMenu = null;
    this.loadoutTooltip?.destroy();
    this.loadoutTooltip = null;
    this.loadoutTooltipRoot = null;
    this.playerNameTooltip?.destroy();
    this.playerNameTooltip = null;
    this.playerNameTooltipRoot = null;
    this.lobbyAlertBanner?.destroy();
    this.lobbyAlertBanner = null;

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
    this.forestRelief = null;
    this.inviteCopyIcon = null;
  }

  show(): void {
    const wasVisible = this.visible;
    this.visible = true;
    this.container?.setVisible(true);
    this.settings?.refresh();
    this.systemBar?.setVisible(true);
    this.updateWorldEntryButtons();
    // Alpha 0 wuerde das Panel vom Rendern ausschliessen. Beim Boot muss es bereits
    // vollstaendig hinter dem deckenden DOM-Ladescreen stehen.
    if (this.bootPreparing) this.container?.setAlpha(1).setY(0);
    else if (!wasVisible) this.playEntrance();
    this.updateReadyGlow();
    this.progress?.setVisible(this.visible);
  }

  /**
   * Synchronisiert die Teilnahme an der LobbyWorld. Der Entry sitzt zwischen den Lobby-Karten;
   * der Exit bleibt an derselben Stelle sichtbar, sobald der lokale Spieler interaktiv
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
    this.worldExitBar?.setVisible(showExit);
    this.worldExitBtn?.setEnabled(showExit && !this.connectionEnded);
  }

  hide(): void {
    this.visible = false;
    this.settings?.close();
    this.rosterScroller?.reset();
    this.playerContextMenu?.close();
    this.loadoutTooltip?.hide();
    this.playerNameTooltip?.hide();
    this.entranceTween?.remove();
    this.entranceTween = null;
    this.stopReadyGlow();
    this.container?.setVisible(false);
    this.systemBar?.setVisible(false);
    this.updateWorldEntryButtons();
    this.progress?.setVisible(this.visible);
  }

  /** Endgueltiger Scene-Abbau; build() verwendet denselben idempotenten Pfad. */
  destroy(): void {
    this.visible = false;
    this.teardown();
  }

  isVisible(): boolean {
    return this.visible;
  }

  getBackdropSurface(): BackdropSurface | null {
    if (!this.container?.visible) return null;
    return { x: PANEL_X + LOBBY_CARD.glassInset, y: PANEL_Y + LOBBY_CARD.glassInset + this.container.y,
      width: PANEL_W - LOBBY_CARD.glassInset * 2, height: PANEL_H_MAX - LOBBY_CARD.glassInset * 2,
      radius: 22, alpha: this.container.alpha };
  }

  /** Ein terminaler Fehlerbanner muss auch ohne fertig aufgebaute World sichtbar werden. */
  hasTerminalFailure(): boolean {
    return this.connectionEnded;
  }

  /** Gibt nur kuenftige Auftrittsanimationen frei; der fertig gerenderte Boot-Frame bleibt stehen. */
  completeBootReveal(): void {
    this.bootPreparing = false;
  }

  /**
   * Auftritt des Panels. Bewusst nur `alpha` und `y`: die Kinder des Containers liegen auf
   * Bildschirmkoordinaten, ein `scale` zoege sie Richtung Bildschirmecke (0, 0).
   */
  private playEntrance(): void {
    if (!this.container) return;
    this.entranceTween?.remove();
    this.container.setAlpha(0).setY(ENTRANCE_OFFSET_Y);
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
    this.settings?.refresh();

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
        this.scene.tweens.killTweensOf(row.root);
        row.root.destroy(true);
        this.playerRows.delete(id);
      }
    }

    for (const profile of connectedPlayers) {
      if (!this.playerRows.has(profile.id)) {
        this.addPlayerRow(profile);
      } else {
        const row = this.playerRows.get(profile.id)!;
        row.name.setText(profile.name.slice(0, PLAYER_NAME_MAX_LENGTH));
        row.name.setColor(toCssColor(FOREST.text));
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

  /** Button-Zustand nach isReady-Toggle anpassen. */
  setReadyButtonState(isReady: boolean): void {
    this.isReady = isReady;
    this.settings?.setLocked(isReady || this.connectionEnded);
    this.progress?.setReady(this.isReady, this.connectionEnded);
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
    this.settings?.setLocked(true);
    this.progress?.setReady(true, this.connectionEnded);
    this.readyBtn.setEnabled(false);
    this.stopReadyGlow();
    this.updateRoomActionButtons();
  }

  /** Zentrale Fehler-API der Lobby; gleichzeitig bleibt hoechstens eine Meldung sichtbar. */
  showAlert(alert: LobbyAlert): void {
    this.lobbyAlertBanner?.showAlert(alert);
  }

  clearAlert(): void {
    this.lobbyAlertBanner?.clearAlert();
  }

  /**
   * Zeigt eine permanente Fehlermeldung, wenn die Verbindung zur Lobby nicht mehr weiterlaufen
   * kann. BEENDET bleibt der kurze Status; die Erklaerung gehoert ausschliesslich in den Banner.
   */
  showHostDisconnectedMessage(message?: string): void {
    this.markConnectionEnded();
    this.showAlert({
      severity: 'error',
      title: t('ui.lobby.alertConnectionError'),
      message: `${message ?? t('ui.lobby.hostLeft')} ${t('ui.lobby.reloadForNewRoom')}`,
      priority: 100,
    });
  }

  /** Technischer Arena-Abbruch mit eigener, zentraler Bannersemantik. */
  showArenaFailureMessage(message?: string): void {
    this.markConnectionEnded();
    this.showAlert({
      severity: 'error',
      title: t('ui.lobby.alertArenaError'),
      message: `${message ?? t('ui.lobby.arenaStartFailed')} ${t('ui.lobby.reloadForNewRoom')}`,
      priority: 100,
    });
  }

  private markConnectionEnded(): void {
    this.playerContextMenu?.close();
    this.connectionEnded = true;
    this.settings?.setLocked(true);
    this.progress?.setReady(this.isReady, true);
    this.statusText.setText(t('ui.lobby.ended')).setColor(toCssColor(COLORS.RED_2));
    this.btnLocked = true;
    this.readyBtn.setEnabled(false).setLabel(t('ui.lobby.ended'));
    this.stopReadyGlow();
    this.updateRoomActionButtons();
  }

  // ── Interne Hilfsmethoden ─────────────────────────────────────────────────

  /** Kopfzeile: welcher Modus, welche Karte, welcher Raum. */
  private refreshHeader(): void {
    this.headerTitle.setText(t('ui.lobby.title'));
    this.roomChip.setLabel(this.bridge.getRoomCode());
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
      color: FOREST.text,
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

    const root = this.scene.add.container(0, 0, [bg, name, badge, mark, loadoutFrame, loadout, ping]).setScrollFactor(0);
    this.container!.add(root);
    if (!this.bootPreparing) {
      root.setAlpha(0);
      this.scene.tweens.add({ targets: root, alpha: 1, duration: MOTION.base, ease: MOTION.ease.out });
    }
    const row: PlayerRow = {
      root, bg, name, badge, mark, ping, loadoutFrame, loadout, loadoutSignature: null,
    };
    this.playerRows.set(profile.id, row);
    this.refreshPlayerLoadout(profile.id, row);
    this.setPlayerRowInteractive(profile.id, bg);
  }

  /** Loadout-IDs bleiben die vorhandenen per-Spieler-States; fehlende Legacy-States fallen auf Defaults. */
  private getLobbyLoadoutItemId(playerId: string, slot: LoadoutSlot): string | null {
    if (slot === 'utility' && isCoopDefenseMode(this.bridge.getGameMode())) {
      const preview = this.bridge.getPlayerLobbyLoadoutPreview(playerId);
      if (preview) return getLoadoutUtilityId(preview.tools) || null;
    }
    return this.bridge.getPlayerLoadoutSlot(playerId, slot) ?? DEFAULT_LOADOUT[slot]?.id ?? null;
  }

  private getLobbyTools(playerId: string): readonly LoadoutToolRef[] {
    return this.usesLobbyTools(playerId)
      ? this.bridge.getPlayerLobbyLoadoutPreview(playerId)?.tools ?? []
      : [];
  }

  private usesLobbyTools(playerId: string): boolean {
    if (!isCoopDefenseMode(this.bridge.getGameMode())) return false;
    const preview = this.bridge.getPlayerLobbyLoadoutPreview(playerId);
    return preview !== null && getCoopDefenseToolCapacity(
      preview.coopDefenseProfile ?? { upgrades: {} },
      preview.coopDefenseClassId ?? 'dachs_nukem',
    ) > 1;
  }

  private getLobbyLoadoutPresentation(
    playerId: string,
    slot: LoadoutSlot,
  ): LoadoutItemPresentation | null {
    if (slot === 'utility' && this.usesLobbyTools(playerId)) {
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
    const multipleTools = this.usesLobbyTools(playerId);
    const tools = multipleTools ? this.getLobbyTools(playerId) : [];
    const presentations = LOADOUT_SLOTS.map((slot) => this.getLobbyLoadoutPresentation(playerId, slot));
    const signature = JSON.stringify([
      multipleTools,
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
      const control = createLoadoutSlotControl(this.scene, { skin: 'forest',
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
          this.showLoadoutTooltip(slot, presentation, pointer, multipleTools ? tools : []);
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

    const isUtilityRadial = slot === 'utility'
      && presentation.displayName === t('ui.loadout.utilityWheel');
    const lines = isUtilityRadial
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
      isUtilityRadial ? t('ui.loadout.utilityWheel') : t(`ui.loadout.${slot}`),
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
    if (!result.ok && this.visible) {
      this.showAlert({
        severity: 'error',
        title: t('ui.lobby.alertError'),
        message: t('ui.lobby.kickFailed'),
        priority: 40,
      });
    }
  }

  /** Scrollt belegte Zeilen und Einladung; Schrift-/Icongroessen und Footer bleiben fest. */
  private layoutList(): void {
    if (!this.container || !this.rosterScroller) return;
    const mode = this.bridge.getGameMode();
    const slots = buildLobbyRosterSlots(mode, [...this.playerRows.keys()].map(id => ({
      id, teamId: this.bridge.getPlayerTeam(id),
    })));
    const teamMode = hasTeamSelection(mode);
    const height = slots.length * ROSTER_ROW_STEP + (teamMode ? TEAM_HEADER_H * 2 : 0);
    const relief = getLobbyReliefBounds(height);
    this.forestRelief?.setVisible(relief !== null);
    if (relief) this.forestRelief?.setPosition(relief.x, relief.y).setDisplaySize(relief.width, relief.height);
    this.rosterScroller.setContentHeight(height);
    let y = LIST_Y - this.rosterScroller.scrollOffset;
    const inView = (top: number, height: number) => top >= LIST_Y && top + height <= LOBBY_CARD.rosterBottom;
    this.teamHeaders?.blue.setVisible(false);
    this.teamHeaders?.red.setVisible(false);
    this.inviteRow.setVisible(false);
    for (const row of this.playerRows.values()) row.root.setVisible(false);
    const groups = teamMode ? ['blue', 'red'] as const : [null];
    for (const teamId of groups) {
      if (teamId && this.teamHeaders) {
        this.teamHeaders[teamId].setPosition(CONTENT_L, y + TEAM_HEADER_H / 2)
          .setVisible(inView(y, TEAM_HEADER_H));
        y += TEAM_HEADER_H;
      }
      for (const slot of slots.filter(slot => slot.teamId === teamId || !teamMode)) {
        const centerY = y + ROSTER_SLOT_H / 2;
        const visible = inView(y, ROSTER_SLOT_H);
        if (slot.playerId) {
          const row = this.playerRows.get(slot.playerId);
          if (row) {
            this.positionPlayerRow(row, CONTENT_L + ROSTER_SLOT_W / 2, centerY, ROSTER_SLOT_W, ROSTER_SLOT_H,
              slot.playerId === this.bridge.getLocalPlayerId(), this.bridge.getPlayerProfile(slot.playerId)?.colorHex ?? COLORS.GREY_4);
            row.root.setVisible(visible);
          }
        } else if (slot.invite) {
          this.inviteRow.setPosition(CONTENT_L + ROSTER_SLOT_W / 2, centerY).setVisible(visible && !this.connectionEnded);
        }
        y += ROSTER_ROW_STEP;
      }
    }
  }

  /**
   * Panelflaechen werden je Hoehe gebacken; es gibt nur eine Handvoll davon.
   *
   * Der Rand ist bewusst neutral statt golden: Gold ist in dieser Oberflaeche die Farbe der
   * Progression. Ein goldener Rahmen um die ganze Flaeche haette dieselbe Bedeutung fuer alles
   * beansprucht und dem Fortschrittsband seine Auszeichnung genommen.
   */
  private panelTexture(height: number): string {
    return ensureForestPanel(this.scene, PANEL_W - LOBBY_CARD.glassInset * 2,
      height - LOBBY_CARD.glassInset * 2, true);
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
    // Preserve icon/text sizes; truncate unusually long names before they reach the loadout.
    let visibleName = row.name.text;
    while (row.name.width > LOADOUT_LEFT_OFFSET - 56 && visibleName.length > 1) {
      visibleName = visibleName.slice(0, -1);
      row.name.setText(`${visibleName}…`);
    }
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

  /** Gebackene Zeilenflaeche in der gewuenschten Hoehe; belegte und freie Plaetze unterscheiden sich. */
  private rowTexture(
    width: number,
    height: number,
    ghost: boolean,
    own = false,
    accentColor?: number,
  ): string {
    return ensureRoundedTexture(this.scene, {
      key: '_forest' + rowTextureKey(width, height, ghost, own, accentColor),
      w: width,
      h: height,
      radius: 10,
      topColor: ghost ? FOREST.sunken : FOREST.raised,
      bottomColor: FOREST.sunken,
      fillAlpha: ghost ? 0.18 : own ? 0.76 : 0.66,
      strokeColor: FOREST.border,
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
      key: `_lobby_forest_loadout_tray_${LOADOUT_FRAME_W}x${LOADOUT_FRAME_H}`,
      w: LOADOUT_FRAME_W,
      h: LOADOUT_FRAME_H,
      radius: 7,
      topColor: FOREST.field,
      bottomColor: FOREST.sunken,
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
    for (const row of this.playerRows.values()) this.setPlayerNameTooltipInteractive(row.name);
  }

  private setPlayerNameTooltipInteractive(name: Phaser.GameObjects.Text): void {
    name.setInteractive({ useHandCursor: false });
  }

  private showCoopLevelTooltip(playerId: string, pointer: Phaser.Input.Pointer): void {
    if (!this.playerNameTooltip) return;
    if (this.container && this.playerNameTooltipRoot) this.container.bringToTop(this.playerNameTooltipRoot);
    this.loadoutTooltip?.hide();
    this.playerNameTooltip.show(
      this.bridge.getPlayerProfile(playerId)?.name ?? '',
      TEXT.accent,
      isCoopDefenseMode(this.bridge.getGameMode())
        ? [{ text: 'Coop-Level ' + this.bridge.getPlayerCoopDefenseLevel(playerId), color: TEXT.primary }]
        : [],
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
    if (this.connectionEnded) return;
    const readyCount = [...this.playerRows.keys()].filter(id => this.bridge.getPlayerReady(id)).length;
    const allReady = playerCount > 0 && readyCount === playerCount;
    this.statusText.setText(readyCount + ' / ' + playerCount + ' ' + t('ui.lobby.ready'))
      .setColor(toCssColor(allReady ? COLORS.GREEN_2 : TEXT.secondary));
  }

  /**
   * Verbindungszustand fuer das Raum-Info-Menue. Ohne Peer-Verbindung gibt es noch nichts zu messen.
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
    this.infoBtn.setVisible(true);
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

}
