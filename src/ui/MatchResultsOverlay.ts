import * as Phaser from 'phaser';
import { COLORS, DEPTH, GAME_HEIGHT, GAME_WIDTH, toCssColor } from '../config';
import { getLocalizedTeamLabel } from '../i18n/gameModePresentation';
import {
  getCoopDefenseLevelForXp,
  getCoopDefenseXpThresholdForLevel,
} from '../utils/coopDefenseProgression';
import {
  createQualityEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  setEmitterTintArray,
} from '../effects/EffectUtils';
import { scaleParticleCount } from '../graphics/GraphicsQuality';
import { addExternalGlow, removeExternalFx, type GlowHandle } from '../utils/phaserFx';
import {
  LivingBarEffect,
  createGradientTexture,
  ensureLivingBarTextures,
  rgbStr,
  type LivingBarPalette,
} from './LivingBarEffect';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { attachHoverEffect } from './uiHover';
import {
  ensureFlatPanelTexture,
  ensureGlossyButtonTexture,
  ensureModalPanelTexture,
  ensureRoundedTexture,
  lerpColor,
} from './uiTextures';
import type {
  MatchItemRewardPresentation,
  MatchProgressDelta,
  MatchResultOutcome,
  MatchResultsPresentation,
} from './MatchResultsModel';
import { getCoopDefenseItemCellColor } from './CoopDefenseItemsModel';
import { BORDER, INTENT, SURFACE, textStyle, FONT_MONO } from './uiTheme';
import {
  ensureCoopDefenseItemCellTexture,
  resolveCoopDefenseItemIconTexture,
} from './coopDefenseItemIcons';
import { formatNumber, getLocale, t } from '../i18n';

// ── Layout ───────────────────────────────────────────────────────────────────
// Der Ergebnis-Layer nutzt dieselbe Formsprache wie Upgrade-, Options- und Help-Overlay:
// eine modale Flaeche mit Goldrand, darin zwei getoente Sektionen. Nur der Ergebnisstreifen
// im Kopf traegt die Ausgangsfarbe (Sieg/Niederlage/Unentschieden).

const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;

const PANEL_W = 1800;
const PANEL_H = 1008;
const PANEL_LEFT = CX - PANEL_W / 2;
const PANEL_RIGHT = CX + PANEL_W / 2;
const PANEL_PAD = 30;

const CONTENT_LEFT = PANEL_LEFT + PANEL_PAD;
const CONTENT_RIGHT = PANEL_RIGHT - PANEL_PAD;

const BANNER_W = 800;
const BANNER_H = 106;
const BANNER_Y = 118;
const META_Y = 190;

const SECTION_TOP = 236;
const SECTION_BOTTOM = 976;
const SECTION_H = SECTION_BOTTOM - SECTION_TOP;
const SECTION_CY = SECTION_TOP + SECTION_H / 2;
const SECTION_GAP = 24;

const LEFT_X = CONTENT_LEFT;
const LEFT_W = 1000;
const LEFT_CX = LEFT_X + LEFT_W / 2;
const RIGHT_X = LEFT_X + LEFT_W + SECTION_GAP;
const RIGHT_W = CONTENT_RIGHT - RIGHT_X;
const RIGHT_CX = RIGHT_X + RIGHT_W / 2;

const SECTION_TITLE_Y = SECTION_TOP + 30;

const ROW_INSET = 20;
const ROW_W = LEFT_W - ROW_INSET * 2;
const ROW_H = 46;
const ROW_GAP = 3;
const ROW_START_Y = 366;
const MAX_ROWS = 12;
const MEDAL_SIZE = 32;
const MEDAL_X = LEFT_X + 52;
const NAME_X = LEFT_X + 96;
const TEAM_X = LEFT_X + 700;
const SCORE_X = LEFT_X + LEFT_W - ROW_INSET - 20;
const HEADER_ROW_Y = 312;
const HEADER_DIVIDER_Y = 336;

const CHIP_X = RIGHT_X + 36;
const CHIP_W = RIGHT_W - 72;
const CHIP_H = 60;
const CHIP_CX = CHIP_X + CHIP_W / 2;
const CHIP_STRIDE = 74;
const BADGE_SIZE = 36;
const CHIP_LABEL_W = CHIP_W - BADGE_SIZE - 70;

const BAR_X = CHIP_X;
const BAR_W = CHIP_W;
const BAR_H = 22;
const BAR_Y = 376;
const LEVEL_ROW_Y = 322;
const XP_TEXT_Y = 408;
const PROGRESS_DIVIDER_Y = 446;
const REWARD_TITLE_Y = 484;
const REWARD_START_Y = 530;
const MAX_REWARD_CHIPS = 7;
/** Unterkante, an der die Belohnungsliste enden muss – daraus folgt der Zeilenabstand. */
const REWARD_LIMIT_Y = SECTION_BOTTOM - 8;
/** Vorschau der drei angebotenen Teile, rechts in der Item-Zeile. */
const OFFER_PREVIEW_SIZE = 46;
const OFFER_PREVIEW_GAP = 8;
const MAX_OFFER_PREVIEWS = 3;
const OFFER_PREVIEW_BLOCK_W = MAX_OFFER_PREVIEWS * (OFFER_PREVIEW_SIZE + OFFER_PREVIEW_GAP);

const SUMMARY_START_Y = 330;
const MAX_SUMMARY_CHIPS = 5;

const FOOTER_Y = 1012;
const CONTINUE_W = 270;
const CONTINUE_H = 56;
const CONTINUE_X = CONTENT_RIGHT - CONTINUE_W / 2;
const FEEDBACK_W = 250;
const FEEDBACK_X = CONTENT_RIGHT - CONTINUE_W - 16 - FEEDBACK_W / 2;

const PANEL_BG = SURFACE.modal;
const PANEL_ACCENT = BORDER.default;
const LOCAL_ROW_ACCENT = COLORS.BLUE_2;

const TEX_PANEL = '_mro_panel';
const TEX_SECTION_LEFT = '_mro_section_left';
const TEX_SECTION_RIGHT = '_mro_section_right';
const TEX_CONTINUE = '_mro_continue';
const TEX_SPARK = '_mro_spark';
const TEX_SHARD = '_mro_shard';
const TEX_RING = '_mro_ring';
const TEX_XP_FILL = '_mro_xpfill';
const RING_SIZE = 128;

/** Ausgangsfarbe und Feierlaune je Ergebnis. */
interface OutcomeStyle {
  labelKey: string;
  color: number;
  /** Sieg und Aufstieg feiern mit Konfetti, Niederlage nur mit einer Druckwelle. */
  celebrate: boolean;
}

const OUTCOME_STYLE: Record<MatchResultOutcome, OutcomeStyle> = {
  victory: { labelKey: 'ui.results.victory', color: COLORS.GREEN_2, celebrate: true },
  defeat: { labelKey: 'ui.results.defeat', color: COLORS.RED_2, celebrate: false },
  draw: { labelKey: 'ui.results.draw', color: COLORS.BLUE_2, celebrate: false },
  aborted: { labelKey: 'ui.results.aborted', color: COLORS.GOLD_2, celebrate: false },
  syncing: { labelKey: 'ui.results.syncing', color: COLORS.BLUE_2, celebrate: false },
};

/** Rang 1–3 bekommen Medaillenfarben, alles darunter ein neutrales Plaettchen. */
const MEDAL_COLORS: readonly number[] = [COLORS.GOLD_1, COLORS.GREY_2, COLORS.BROWN_3];

interface ResultRow {
  container: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Image;
  medal: Phaser.GameObjects.Image;
  rank: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  team: Phaser.GameObjects.Text;
  score: Phaser.GameObjects.Text;
  frags: number;
}

/**
 * Belohnungs-Zeile: farbiges Abzeichen plus Text. Der Container sitzt auf der Chip-Mitte und
 * seine Kinder liegen lokal dazu — nur so skaliert der Aufpopp-Tween um die eigene Mitte
 * statt die Zeile Richtung Bildschirmecke zu ziehen. `sparkX`/`sparkY` halten deshalb die
 * Weltposition des Abzeichens fuer den Funkenstoss fest.
 */
interface RewardChip {
  container: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Image;
  badge: Phaser.GameObjects.Image;
  glyph: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  sparkX: number;
  sparkY: number;
  tooltip: string | null;
}

/** Uebersichts-Zeile ohne Fortschritt: Bezeichnung links, Wert rechts. */
interface StatChip {
  container: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  value: Phaser.GameObjects.Text;
}

interface RewardDescriptor {
  glyph: string;
  label: string;
  color: number;
  tooltip?: string;
  /** Markiert die Zeile, an der die Vorschau der angebotenen Teile haengt. */
  itemOffer?: boolean;
}

/** Ein Symbol der Angebotsvorschau: Seltenheitsrahmen plus Item-Symbol. */
interface OfferPreview {
  frame: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image;
}

export class MatchResultsOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private panel: Phaser.GameObjects.Image | null = null;
  private banner: Phaser.GameObjects.Image | null = null;
  private outcomeText: Phaser.GameObjects.Text | null = null;
  private outcomeFlash: Phaser.GameObjects.Text | null = null;
  private metaText: Phaser.GameObjects.Text | null = null;
  private shockRing: Phaser.GameObjects.Image | null = null;

  private rows: ResultRow[] = [];
  private leaderboardGroup: Phaser.GameObjects.Container | null = null;

  private progressGroup: Phaser.GameObjects.Container | null = null;
  private levelText: Phaser.GameObjects.Text | null = null;
  private xpText: Phaser.GameObjects.Text | null = null;
  private xpGainText: Phaser.GameObjects.Text | null = null;
  private xpFill: Phaser.GameObjects.Image | null = null;
  private xpFlash: Phaser.GameObjects.Rectangle | null = null;
  private xpBarEffect: LivingBarEffect | null = null;
  private rewardChips: RewardChip[] = [];
  private offerPreviewGroup: Phaser.GameObjects.Container | null = null;
  private offerPreviews: OfferPreview[] = [];

  private summaryGroup: Phaser.GameObjects.Container | null = null;
  private summaryChips: StatChip[] = [];

  private syncGroup: Phaser.GameObjects.Container | null = null;
  private syncText: Phaser.GameObjects.Text | null = null;
  private syncSpinner: Phaser.GameObjects.Image | null = null;

  private continueButton: Phaser.GameObjects.Image | null = null;
  private continueLabel: Phaser.GameObjects.Text | null = null;
  private balanceFeedbackButton: Phaser.GameObjects.Image | null = null;
  private balanceFeedbackLabel: Phaser.GameObjects.Text | null = null;
  private hintText: Phaser.GameObjects.Text | null = null;

  private sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private shardEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  private visible = false;
  private syncing = false;
  private sequenceComplete = true;
  private presentation: MatchResultsPresentation | null = null;
  private balanceFeedbackAvailable = false;
  /**
   * Nachtraeglich geoeffnete Ansicht derselben Runde. Sie animiert und zeigt alles wie der
   * Original-Durchlauf, loest beim Schliessen aber `onContinue` nicht aus: Der dortige
   * Lobby-Uebergang gehoert zum Rundenende und wuerde hier den Bereit-Button zuruecksetzen.
   */
  private replayOnly = false;

  private timers: Phaser.Time.TimerEvent[] = [];
  private tweens: Phaser.Tweens.BaseTween[] = [];

  // Dauerlaeufer: leben so lange das Overlay sichtbar ist, nicht nur waehrend der Einblendung.
  private idleTweens: Phaser.Tweens.BaseTween[] = [];
  private bannerGlow: GlowHandle | null = null;
  private continueGlow: GlowHandle | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onContinue: () => void,
    private readonly onBalanceFeedback: () => void = () => undefined,
  ) {}

  build(): void {
    this.destroy();
    this.ensureEffectTextures();

    const objects: Phaser.GameObjects.GameObject[] = [];

    const backdrop = this.scene.add.rectangle(CX, CY, GAME_WIDTH, GAME_HEIGHT, COLORS.GREY_10, 0.88)
      .setScrollFactor(0)
      .setInteractive();
    backdrop.on('pointerdown', () => this.skipAnimations());
    objects.push(backdrop);

    this.panel = this.scene.add.image(
      CX,
      CY,
      ensureModalPanelTexture(this.scene, TEX_PANEL, PANEL_W, PANEL_H, PANEL_BG, PANEL_ACCENT),
    ).setScrollFactor(0).setInteractive();
    // Die Flaeche deckt fast den ganzen Bildschirm ab. Ohne eigenen Handler waere der
    // Klick zum Ueberspringen praktisch nur noch am Bildrand erreichbar; der Weiter-Button
    // liegt darueber und faengt seine Klicks weiterhin selbst ab.
    this.panel.on('pointerdown', () => this.skipAnimations());
    objects.push(this.panel);

    objects.push(this.buildHeader());
    this.leaderboardGroup = this.buildLeaderboardPanel();
    objects.push(this.leaderboardGroup);
    this.progressGroup = this.buildProgressPanel();
    objects.push(this.progressGroup);
    this.summaryGroup = this.buildSummaryPanel();
    objects.push(this.summaryGroup);
    this.syncGroup = this.buildSyncPanel();
    objects.push(this.syncGroup);
    objects.push(this.buildFooter());

    // Partikel liegen bewusst am Ende der Liste: Funken und Konfetti sollen ueber Panel,
    // Zeilen und Balken liegen. Beide Emitter stehen auf (0,0); die Ziele kommen aus
    // `emitParticleAt()`, damit dieselbe Instanz Kopf und XP-Balken bedienen kann.
    this.sparkEmitter = createQualityEmitter(this.scene, 0, 0, TEX_SPARK, {
      lifespan: { min: 380, max: 900 },
      speed: { min: 40, max: 210 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.95, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, 'decorative').setScrollFactor(0);
    this.shardEmitter = createQualityEmitter(this.scene, 0, 0, TEX_SHARD, {
      lifespan: { min: 900, max: 1700 },
      speed: { min: 130, max: 430 },
      angle: { min: 200, max: 340 },
      gravityY: 520,
      rotate: { start: 0, end: 360 },
      scale: { start: 1, end: 0.5 },
      alpha: { start: 1, end: 0.1 },
      emitting: false,
    }, 'decorative').setScrollFactor(0);
    objects.push(this.sparkEmitter, this.shardEmitter);

    this.container = this.scene.add.container(0, 0, objects)
      .setDepth(DEPTH.OVERLAY + 4)
      .setVisible(false);
    promoteToClarityCamera(this.scene, this.container);

    // Der lebendige XP-Balken braucht den Container und entsteht deshalb erst hier.
    this.xpBarEffect = new LivingBarEffect(
      this.scene,
      this.container,
      BAR_X,
      BAR_Y - BAR_H / 2,
      BAR_W,
      BAR_H,
      xpBarPalette(),
      { glowTarget: this.xpFill ?? undefined, scrollFactor: 0, intensity: 1.3 },
    );
    this.xpBarEffect.stop();
  }

  showSyncing(modeLabel: string, mapLabel: string): void {
    if (!this.container) this.build();
    this.stopSequence();
    this.stopIdleAnimations();
    this.replayOnly = false;
    this.visible = true;
    this.syncing = true;
    this.sequenceComplete = true;
    this.presentation = null;

    this.applyAccent(OUTCOME_STYLE.syncing.color);
    this.container!.setVisible(true).setAlpha(1);
    this.panel?.setScale(1);
    this.outcomeText?.setText(t(OUTCOME_STYLE.syncing.labelKey)).setScale(1).setAlpha(1);
    this.outcomeFlash?.setVisible(false);
    this.metaText?.setText(`${modeLabel.toUpperCase()}  •  ${mapLabel.toUpperCase()}`).setAlpha(1);

    this.leaderboardGroup?.setVisible(false);
    this.progressGroup?.setVisible(false);
    this.summaryGroup?.setVisible(false);
    // Waehrend der Synchronisierung laeuft keine Sequenz, es gibt also nichts zu ueberspringen.
    this.hintText?.setVisible(false);
    this.syncGroup?.setVisible(true).setAlpha(1);
    this.syncText?.setText(t('ui.results.syncingRewards'));
    this.syncSpinner?.setVisible(true);
    this.balanceFeedbackButton?.setVisible(false);
    this.balanceFeedbackLabel?.setVisible(false);
    this.startIdleAnimations(OUTCOME_STYLE.syncing.color, true);
  }

  showTechnicalAbort(message: string): void {
    this.showSyncing(t('ui.results.match'), t('ui.results.technicalAbort'));
    this.syncing = false;
    const style = OUTCOME_STYLE.aborted;
    this.applyAccent(style.color);
    this.outcomeText?.setText(t('ui.results.aborted'));
    this.syncText?.setText(message || t('ui.results.connectionEnded'));
    // Ohne laufende Synchronisierung gibt es nichts zu drehen.
    this.syncSpinner?.setVisible(false);
    this.stopIdleAnimations();
    this.startIdleAnimations(style.color, false);
  }

  show(presentation: MatchResultsPresentation): void {
    this.replayOnly = false;
    this.present(presentation);
  }

  /**
   * Zeigt eine bereits ausgewertete Runde erneut — mit voller Sequenz, aber ohne den
   * Lobby-Uebergang beim Schliessen. Der Aufrufer reicht dieselbe Praesentation ein und
   * berechnet insbesondere keinen Fortschritt neu; hier wird nichts gespeichert.
   */
  showReplay(presentation: MatchResultsPresentation): void {
    this.replayOnly = true;
    this.present(presentation);
  }

  private present(presentation: MatchResultsPresentation): void {
    if (!this.container) this.build();
    this.stopSequence();
    this.stopIdleAnimations();
    this.visible = true;
    this.syncing = presentation.outcome === 'syncing';
    this.sequenceComplete = false;
    this.presentation = presentation;

    const style = OUTCOME_STYLE[presentation.outcome];
    this.applyAccent(style.color);

    this.container!.setVisible(true).setAlpha(0);
    this.panel?.setScale(0.96);
    this.outcomeText?.setText(t(style.labelKey)).setAlpha(0).setScale(0.7);
    this.outcomeFlash?.setText(t(style.labelKey)).setAlpha(0).setScale(1).setVisible(false);
    this.metaText
      ?.setText(`${presentation.modeLabel.toUpperCase()}  •  ${presentation.mapLabel.toUpperCase()}`)
      .setAlpha(0);
    this.syncGroup?.setVisible(false);
    this.leaderboardGroup?.setVisible(true).setAlpha(1);
    this.hintText?.setVisible(true).setAlpha(1);

    // Der Weiter-Button fuehrt bei offener Belohnung nicht in die Lobby, sondern in die Auswahl.
    this.continueLabel?.setText(t(presentation.itemReward ? 'ui.results.chooseItem' : 'ui.results.continueLobby'));
    this.balanceFeedbackButton?.setVisible(this.balanceFeedbackAvailable && !this.syncing);
    this.balanceFeedbackLabel?.setVisible(this.balanceFeedbackAvailable && !this.syncing);

    this.populateLeaderboard(presentation);
    this.populateProgress(presentation.progress, presentation.itemReward);
    this.populateSummary(presentation);
    this.startIdleAnimations(style.color, false);
    this.startSequence(style);
  }

  isVisible(): boolean {
    return this.visible;
  }

  isSyncing(): boolean {
    return this.visible && this.syncing;
  }

  /** Optionaler Sichtbarkeitshook: die Balance-Logik bleibt ausserhalb dieses Ergebnislayers. */
  setBalanceFeedbackVisible(visible: boolean): void {
    this.balanceFeedbackAvailable = visible;
    this.balanceFeedbackButton?.setVisible(this.visible && !this.syncing && visible);
    this.balanceFeedbackLabel?.setVisible(this.visible && !this.syncing && visible);
  }

  hide(): void {
    this.stopSequence();
    this.stopIdleAnimations();
    this.xpBarEffect?.stop();
    this.visible = false;
    this.syncing = false;
    this.presentation = null;
    this.container?.setVisible(false);
  }

  destroy(): void {
    this.stopSequence();
    this.stopIdleAnimations();
    if (this.sparkEmitter) destroyEmitter(this.sparkEmitter);
    if (this.shardEmitter) destroyEmitter(this.shardEmitter);
    this.sparkEmitter = null;
    this.shardEmitter = null;
    this.xpBarEffect?.destroy();
    this.xpBarEffect = null;
    this.container?.destroy(true);
    this.container = null;
    this.panel = null;
    this.banner = null;
    this.outcomeText = null;
    this.outcomeFlash = null;
    this.metaText = null;
    this.shockRing = null;
    this.rows = [];
    this.leaderboardGroup = null;
    this.progressGroup = null;
    this.levelText = null;
    this.xpText = null;
    this.xpGainText = null;
    this.xpFill = null;
    this.xpFlash = null;
    this.rewardChips = [];
    this.offerPreviewGroup = null;
    this.offerPreviews = [];
    this.summaryGroup = null;
    this.summaryChips = [];
    this.syncGroup = null;
    this.syncText = null;
    this.syncSpinner = null;
    this.continueButton = null;
    this.continueLabel = null;
    this.balanceFeedbackButton = null;
    this.balanceFeedbackLabel = null;
    this.hintText = null;
    this.visible = false;
    this.balanceFeedbackAvailable = false;
  }

  // ── Aufbau ─────────────────────────────────────────────────────────────────

  private ensureEffectTextures(): void {
    ensureLivingBarTextures(this.scene);
    fillRadialGradientTexture(this.scene.textures, TEX_SPARK, 28, [
      [0, 'rgba(255,255,255,1)'],
      [0.35, 'rgba(255,255,255,0.55)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    // Kleines helles Rechteck: rotiert es beim Fallen, liest es sich als Konfetti-Schnipsel.
    ensureCanvasTexture(this.scene.textures, TEX_SHARD, 10, 14, (ctx) => {
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fillRect(0, 0, 10, 14);
    });
    ensureCanvasTexture(this.scene.textures, TEX_RING, RING_SIZE, RING_SIZE, (ctx) => {
      const center = RING_SIZE / 2;
      const gradient = ctx.createRadialGradient(center, center, center * 0.62, center, center, center);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(0.55, 'rgba(255,255,255,0.85)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, RING_SIZE, RING_SIZE);
    });
    createGradientTexture(this.scene, TEX_XP_FILL, xpBarPalette(), BAR_W, BAR_H);
  }

  private buildHeader(): Phaser.GameObjects.Container {
    // Die Druckwelle liegt unter dem Streifen, damit sie hinter der Schrift hervorquillt.
    this.shockRing = this.scene.add.image(CX, BANNER_Y, TEX_RING)
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);

    this.banner = this.scene.add.image(CX, BANNER_Y, this.ensureBannerTexture(OUTCOME_STYLE.syncing.color))
      .setScrollFactor(0);

    this.outcomeText = this.scene.add.text(CX, BANNER_Y, t('ui.results.syncing'), {
      fontFamily: FONT_MONO,
      fontSize: '58px',
      fontStyle: 'bold',
      color: toCssColor(COLORS.GREY_1),
      stroke: rgbStr(COLORS.GREY_10),
      strokeThickness: 6,
    }).setOrigin(0.5).setScrollFactor(0);

    // Zweite Kopie derselben Schrift: skaliert additiv nach aussen und erzeugt so den
    // Aufschlag-Moment, ohne die eigentliche Beschriftung zu verfremden.
    this.outcomeFlash = this.scene.add.text(CX, BANNER_Y, t('ui.results.syncing'), {
      fontFamily: FONT_MONO,
      fontSize: '58px',
      fontStyle: 'bold',
      color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);

    this.metaText = this.scene.add.text(CX, META_Y, '', {
      fontFamily: FONT_MONO,
      fontSize: '18px',
      fontStyle: 'bold',
      color: toCssColor(COLORS.GREY_4),
    }).setOrigin(0.5).setScrollFactor(0);

    return this.scene.add.container(0, 0, [
      this.shockRing,
      this.banner,
      this.outcomeText,
      this.outcomeFlash,
      this.metaText,
    ]).setScrollFactor(0);
  }

  private buildLeaderboardPanel(): Phaser.GameObjects.Container {
    const objects: Phaser.GameObjects.GameObject[] = [];

    objects.push(
      this.scene.add.image(LEFT_CX, SECTION_CY, ensureFlatPanelTexture(
        this.scene, TEX_SECTION_LEFT, LEFT_W, SECTION_H, SURFACE.raised, BORDER.subtle,
        { radius: 16, fillAlpha: 0.96, strokeAlpha: 0.85 },
      )).setScrollFactor(0),
      this.scene.add.text(LEFT_X + 30, SECTION_TITLE_Y, t('ui.results.leaderboard'), textStyle('subtitle'))
        .setOrigin(0, 0.5).setScrollFactor(0),
      this.columnLabel(MEDAL_X, HEADER_ROW_Y, t('ui.results.rank'), 0.5),
      this.columnLabel(NAME_X, HEADER_ROW_Y, t('ui.results.player'), 0),
      this.columnLabel(TEAM_X, HEADER_ROW_Y, t('ui.results.team'), 0),
      this.columnLabel(SCORE_X, HEADER_ROW_Y, t('ui.score.frags'), 1),
      this.scene.add.rectangle(LEFT_CX, HEADER_DIVIDER_Y, ROW_W, 1, COLORS.GREY_5, 0.55)
        .setScrollFactor(0),
    );

    for (let index = 0; index < MAX_ROWS; index++) {
      const y = ROW_START_Y + index * (ROW_H + ROW_GAP);
      const frame = this.scene.add.image(LEFT_CX, y, this.ensureRowTexture('even'))
        .setScrollFactor(0);
      const medal = this.scene.add.image(MEDAL_X, y, this.ensureMedalTexture(COLORS.GREY_5))
        .setScrollFactor(0);
      const rank = this.scene.add.text(MEDAL_X, y, '', {
        fontFamily: FONT_MONO, fontSize: '17px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_10),
      }).setOrigin(0.5).setScrollFactor(0);
      const name = this.scene.add.text(NAME_X, y, '', {
        fontFamily: FONT_MONO, fontSize: '20px', fontStyle: 'bold', color: '#ffffff',
      }).setOrigin(0, 0.5).setScrollFactor(0);
      const team = this.scene.add.text(TEAM_X, y, '', {
        fontFamily: FONT_MONO, fontSize: '15px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_3),
      }).setOrigin(0, 0.5).setScrollFactor(0);
      const score = this.scene.add.text(SCORE_X, y, '', {
        fontFamily: FONT_MONO, fontSize: '22px', fontStyle: 'bold', color: toCssColor(COLORS.GOLD_1),
      }).setOrigin(1, 0.5).setScrollFactor(0);
      const container = this.scene.add.container(0, 0, [frame, medal, rank, name, team, score])
        .setScrollFactor(0);
      this.rows.push({ container, frame, medal, rank, name, team, score, frags: 0 });
      objects.push(container);
    }

    return this.scene.add.container(0, 0, objects).setScrollFactor(0);
  }

  private buildProgressPanel(): Phaser.GameObjects.Container {
    const objects: Phaser.GameObjects.GameObject[] = [];

    objects.push(
      this.scene.add.image(RIGHT_CX, SECTION_CY, ensureFlatPanelTexture(
        this.scene, TEX_SECTION_RIGHT, RIGHT_W, SECTION_H, SURFACE.raised, BORDER.subtle,
        { radius: 16, fillAlpha: 0.96, strokeAlpha: 0.85 },
      )).setScrollFactor(0),
      this.scene.add.text(RIGHT_X + 30, SECTION_TITLE_Y, t('ui.results.progress'), textStyle('subtitle'))
        .setOrigin(0, 0.5).setScrollFactor(0),
    );

    this.levelText = this.scene.add.text(CHIP_X, LEVEL_ROW_Y, t('ui.results.level', { level: 1 }), {
      fontFamily: FONT_MONO, fontSize: '32px', fontStyle: 'bold', color: toCssColor(COLORS.GREEN_1),
    }).setOrigin(0, 0.5).setScrollFactor(0);
    this.xpGainText = this.scene.add.text(CHIP_X + CHIP_W, LEVEL_ROW_Y, t('ui.results.xpGain', { xp: 0 }), {
      fontFamily: FONT_MONO, fontSize: '28px', fontStyle: 'bold', color: toCssColor(COLORS.GOLD_1),
    }).setOrigin(1, 0.5).setScrollFactor(0);
    objects.push(this.levelText, this.xpGainText);

    objects.push(
      this.scene.add.rectangle(BAR_X + BAR_W / 2, BAR_Y, BAR_W, BAR_H, COLORS.GREY_9, 0.95)
        .setStrokeStyle(1, COLORS.GREY_4)
        .setScrollFactor(0),
    );
    this.xpFill = this.scene.add.image(BAR_X, BAR_Y, TEX_XP_FILL)
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    this.xpFill.setCrop(0, 0, BAR_W, BAR_H);
    // Kurzer additiver Aufblitzer beim Levelaufstieg; ruht sonst unsichtbar.
    this.xpFlash = this.scene.add.rectangle(BAR_X + BAR_W / 2, BAR_Y, BAR_W, BAR_H, COLORS.GREEN_1, 1)
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);
    this.xpText = this.scene.add.text(CHIP_CX, XP_TEXT_Y, '', {
      fontFamily: FONT_MONO, fontSize: '16px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_3),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.xpFill, this.xpFlash, this.xpText);

    objects.push(
      this.scene.add.rectangle(CHIP_CX, PROGRESS_DIVIDER_Y, CHIP_W, 1, COLORS.GREY_5, 0.55)
        .setScrollFactor(0),
      this.scene.add.text(CHIP_X, REWARD_TITLE_Y, t('ui.results.rewards'), {
        fontFamily: FONT_MONO, fontSize: '22px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_2),
      }).setOrigin(0, 0.5).setScrollFactor(0),
    );

    for (let index = 0; index < MAX_REWARD_CHIPS; index++) {
      const chip = this.buildRewardChip(REWARD_START_Y + index * CHIP_STRIDE);
      this.rewardChips.push(chip);
      objects.push(chip.container);
    }

    objects.push(this.buildOfferPreview());

    return this.scene.add.container(0, 0, objects).setScrollFactor(0).setVisible(false);
  }

  /**
   * Die drei angebotenen Teile sitzen rechts in ihrer eigenen Belohnungszeile. So bleibt sofort
   * sichtbar, worum es bei der Auswahl geht, ohne der Liste eine weitere Zeile zu kosten.
   */
  private buildOfferPreview(): Phaser.GameObjects.Container {
    const objects: Phaser.GameObjects.GameObject[] = [];
    for (let index = 0; index < MAX_OFFER_PREVIEWS; index++) {
      const x = -index * (OFFER_PREVIEW_SIZE + OFFER_PREVIEW_GAP);
      const frame = this.scene.add.image(x, 0, ensureCoopDefenseItemCellTexture(
        this.scene, OFFER_PREVIEW_SIZE, OFFER_PREVIEW_SIZE, COLORS.GREY_6, 'rest',
      )).setScrollFactor(0);
      const icon = this.scene.add.image(x, 0, resolveCoopDefenseItemIconTexture(
        this.scene, 'armor', 1, OFFER_PREVIEW_SIZE,
      )).setDisplaySize(OFFER_PREVIEW_SIZE * 0.7, OFFER_PREVIEW_SIZE * 0.7).setScrollFactor(0);
      this.offerPreviews.push({ frame, icon });
      objects.push(frame, icon);
    }
    this.offerPreviewGroup = this.scene.add.container(0, 0, objects)
      .setScrollFactor(0)
      .setVisible(false);
    return this.offerPreviewGroup;
  }

  private buildRewardChip(y: number): RewardChip {
    const badgeOffsetX = -CHIP_W / 2 + 22 + BADGE_SIZE / 2;
    const frame = this.scene.add.image(0, 0, this.ensureChipTexture(COLORS.GREY_5))
      .setScrollFactor(0);
    const badge = this.scene.add.image(badgeOffsetX, 0, this.ensureBadgeTexture(COLORS.GREY_5))
      .setScrollFactor(0);
    const glyph = this.scene.add.text(badgeOffsetX, 0, '', {
      fontFamily: FONT_MONO, fontSize: '20px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_10),
    }).setOrigin(0.5).setScrollFactor(0);
    const label = this.scene.add.text(-CHIP_W / 2 + 22 + BADGE_SIZE + 18, 0, '', {
      fontFamily: FONT_MONO,
      fontSize: '18px',
      fontStyle: 'bold',
      color: toCssColor(COLORS.GREY_1),
      wordWrap: { width: CHIP_LABEL_W },
    }).setOrigin(0, 0.5).setScrollFactor(0);
    const container = this.scene.add.container(CHIP_CX, y, [frame, badge, glyph, label])
      .setScrollFactor(0)
      .setVisible(false);
    const chip: RewardChip = {
      container,
      frame,
      badge,
      glyph,
      label,
      sparkX: CHIP_CX + badgeOffsetX,
      sparkY: y,
      tooltip: null,
    };
    frame.setInteractive()
      .on('pointerover', () => this.showRewardTooltip(chip))
      .on('pointerout', () => this.hideRewardTooltip());
    return chip;
  }

  /**
   * Ohne Coop-Fortschritt (PvP) bliebe die rechte Sektion leer. Sie zeigt dann eine
   * Kurzuebersicht, die vollstaendig aus dem Leaderboard ableitbar ist.
   */
  private buildSummaryPanel(): Phaser.GameObjects.Container {
    const objects: Phaser.GameObjects.GameObject[] = [];
    objects.push(
      this.scene.add.image(RIGHT_CX, SECTION_CY, ensureFlatPanelTexture(
        this.scene, TEX_SECTION_RIGHT, RIGHT_W, SECTION_H, SURFACE.raised, BORDER.subtle,
        { radius: 16, fillAlpha: 0.96, strokeAlpha: 0.85 },
      )).setScrollFactor(0),
      this.scene.add.text(RIGHT_X + 30, SECTION_TITLE_Y, t('ui.results.summary'), textStyle('subtitle'))
        .setOrigin(0, 0.5).setScrollFactor(0),
    );

    for (let index = 0; index < MAX_SUMMARY_CHIPS; index++) {
      const y = SUMMARY_START_Y + index * CHIP_STRIDE;
      const frame = this.scene.add.image(CHIP_CX, y, this.ensureChipTexture(COLORS.GREY_5))
        .setScrollFactor(0);
      const label = this.scene.add.text(CHIP_X + 24, y, '', {
        fontFamily: FONT_MONO, fontSize: '16px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_4),
      }).setOrigin(0, 0.5).setScrollFactor(0);
      const value = this.scene.add.text(CHIP_X + CHIP_W - 24, y, '', {
        fontFamily: FONT_MONO, fontSize: '20px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
      }).setOrigin(1, 0.5).setScrollFactor(0);
      const container = this.scene.add.container(0, 0, [frame, label, value])
        .setScrollFactor(0)
        .setVisible(false);
      this.summaryChips.push({ container, frame, label, value });
      objects.push(container);
    }

    return this.scene.add.container(0, 0, objects).setScrollFactor(0).setVisible(false);
  }

  private buildSyncPanel(): Phaser.GameObjects.Container {
    this.syncSpinner = this.scene.add.image(CX, CY - 70, TEX_RING)
      .setScrollFactor(0)
      .setDisplaySize(76, 76)
      .setTint(COLORS.BLUE_2)
      .setAlpha(0.85);
    this.syncText = this.scene.add.text(CX, CY + 10, '', {
      fontFamily: FONT_MONO,
      fontSize: '24px',
      fontStyle: 'bold',
      color: toCssColor(COLORS.BLUE_1),
      align: 'center',
      wordWrap: { width: 900 },
    }).setOrigin(0.5).setScrollFactor(0);
    return this.scene.add.container(0, 0, [this.syncSpinner, this.syncText])
      .setScrollFactor(0)
      .setVisible(false);
  }

  private buildFooter(): Phaser.GameObjects.Container {
    this.hintText = this.scene.add.text(CONTENT_LEFT + 6, FOOTER_Y, t('ui.results.skipHint'), {
      fontFamily: FONT_MONO, fontSize: '14px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_5),
    }).setOrigin(0, 0.5).setScrollFactor(0);

    this.continueButton = this.scene.add.image(CONTINUE_X, FOOTER_Y, ensureGlossyButtonTexture(
      this.scene, TEX_CONTINUE, CONTINUE_W, CONTINUE_H, INTENT.primary.fill, INTENT.primary.stroke,
    )).setScrollFactor(0).setInteractive({ useHandCursor: true });
    this.continueLabel = this.scene.add.text(CONTINUE_X, FOOTER_Y, t('ui.results.continueLobby'), textStyle('label', {
      color: INTENT.primary.label,
    })).setOrigin(0.5).setScrollFactor(0);
    this.continueButton.on('pointerdown', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      // Das Overlay verschwindet sofort. Die Abbruchmarkierung verhindert, dass ein
      // darunterliegendes Lobby-Objekt denselben Pointerdown ebenfalls verarbeitet.
      event?.stopPropagation();
      this.continueToLobby();
    });
    attachHoverEffect(this.scene, this.continueButton, this.continueLabel);

    this.balanceFeedbackButton = this.scene.add.image(FEEDBACK_X, FOOTER_Y, ensureGlossyButtonTexture(
      this.scene, '_mro_balance_feedback', FEEDBACK_W, CONTINUE_H, INTENT.secondary.fill, INTENT.secondary.stroke,
    )).setScrollFactor(0).setInteractive({ useHandCursor: true }).setVisible(false);
    this.balanceFeedbackLabel = this.scene.add.text(FEEDBACK_X, FOOTER_Y, t('ui.results.balanceFeedback'), textStyle('label', {
      color: INTENT.secondary.label,
    })).setOrigin(0.5).setScrollFactor(0).setVisible(false);
    this.balanceFeedbackButton.on('pointerdown', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      this.onBalanceFeedback();
    });
    attachHoverEffect(this.scene, this.balanceFeedbackButton, this.balanceFeedbackLabel);

    return this.scene.add.container(0, 0, [this.hintText, this.balanceFeedbackButton, this.balanceFeedbackLabel, this.continueButton, this.continueLabel])
      .setScrollFactor(0);
  }

  private columnLabel(x: number, y: number, text: string, originX: number): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, text, {
      fontFamily: FONT_MONO, fontSize: '13px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_4),
    }).setOrigin(originX, 0.5).setScrollFactor(0);
  }

  // ── Inhalte ────────────────────────────────────────────────────────────────

  /** Faerbt Kopfstreifen, Druckwelle und Partikel auf die Ausgangsfarbe um. */
  private applyAccent(accent: number): void {
    this.banner?.setTexture(this.ensureBannerTexture(accent));
    this.outcomeText?.setColor(toCssColor(lerpColor(accent, 0xffffff, 0.4)));
    this.shockRing?.setTint(accent);
    this.syncSpinner?.setTint(accent);
    if (this.sparkEmitter) {
      setEmitterTintArray(this.sparkEmitter, [
        accent,
        lerpColor(accent, 0xffffff, 0.55),
        COLORS.GREY_1,
      ]);
    }
    if (this.shardEmitter) {
      setEmitterTintArray(this.shardEmitter, [
        accent,
        lerpColor(accent, 0xffffff, 0.4),
        COLORS.GOLD_2,
        COLORS.BLUE_2,
      ]);
    }
  }

  private populateLeaderboard(presentation: MatchResultsPresentation): void {
    const isTeamMode = presentation.mode !== 'deathmatch';
    this.rows.forEach((row, index) => {
      const entry = presentation.leaderboard[index];
      if (!entry) {
        row.container.setVisible(false);
        return;
      }
      const isLocal = entry.id === presentation.localPlayerId;
      const medalColor = MEDAL_COLORS[index] ?? COLORS.GREY_5;

      row.frags = Math.max(0, Math.floor(entry.frags));
      row.frame.setTexture(this.ensureRowTexture(isLocal ? 'local' : (index % 2 ? 'odd' : 'even')));
      row.medal.setTexture(this.ensureMedalTexture(medalColor));
      row.rank.setText(String(index + 1));
      row.name.setText(isLocal ? `${entry.name}  (${t('ui.results.you')})` : entry.name).setColor(toCssColor(entry.colorHex));
      row.team.setText(entry.teamId && isTeamMode
        ? getLocalizedTeamLabel(entry.teamId, presentation.mode).toUpperCase()
        : t('ui.common.dash'));
      // Zaehlt in der Sequenz hoch; der Endwert steht in `row.frags`.
      row.score.setText('0').setColor(toCssColor(index === 0 ? COLORS.GOLD_1 : COLORS.GREY_1));
      row.container.setVisible(true).setAlpha(0).setX(-52);
    });
  }

  private populateProgress(
    progress: MatchProgressDelta | null,
    itemReward: MatchItemRewardPresentation | null,
  ): void {
    this.progressGroup?.setVisible(!!progress).setAlpha(0);
    this.offerPreviewGroup?.setVisible(false);
    if (!progress) {
      this.xpBarEffect?.stop();
      return;
    }
    this.xpGainText?.setText(t('ui.results.xpGain', { xp: progress.xpGained }));
    this.applyXpValue(progress.before.totalXp);
    this.xpFlash?.setAlpha(0);

    const descriptors = describeRewards(progress, itemReward);
    // Mit vielen Freischaltungen ruecken die Zeilen zusammen, statt unter die Sektion zu laufen:
    // die unterste Zeile muss mit ihrer halben Hoehe noch ueber `REWARD_LIMIT_Y` passen.
    const stride = Math.min(
      CHIP_STRIDE,
      Math.floor((REWARD_LIMIT_Y - CHIP_H / 2 - REWARD_START_Y) / Math.max(1, descriptors.length - 1)),
    );
    this.rewardChips.forEach((chip, index) => {
      const descriptor = descriptors[index];
      if (!descriptor) {
        chip.container.setVisible(false);
        return;
      }
      const y = REWARD_START_Y + index * stride;
      chip.frame.setTexture(this.ensureChipTexture(descriptor.color));
      chip.badge.setTexture(this.ensureBadgeTexture(descriptor.color));
      chip.glyph.setText(descriptor.glyph);
      chip.label
        .setWordWrapWidth(descriptor.itemOffer ? CHIP_LABEL_W - OFFER_PREVIEW_BLOCK_W : CHIP_LABEL_W)
        .setText(descriptor.label)
        .setColor(toCssColor(lerpColor(descriptor.color, 0xffffff, 0.45)));
      chip.tooltip = descriptor.tooltip ?? null;
      chip.sparkY = y;
      chip.container.setPosition(CHIP_CX, y).setVisible(true).setAlpha(0).setScale(0.9);
      if (descriptor.itemOffer) this.placeOfferPreview(itemReward, y);
    });
  }

  private placeOfferPreview(itemReward: MatchItemRewardPresentation | null, y: number): void {
    if (!this.offerPreviewGroup || !itemReward) return;
    this.offerPreviews.forEach((preview, index) => {
      // Rechtsbuendig: das erste Angebot liegt aussen, die weiteren wandern nach links.
      const option = itemReward.options[itemReward.options.length - 1 - index];
      preview.frame.setVisible(!!option);
      preview.icon.setVisible(!!option);
      if (!option) return;
      preview.frame.setTexture(ensureCoopDefenseItemCellTexture(
        this.scene, OFFER_PREVIEW_SIZE, OFFER_PREVIEW_SIZE, getCoopDefenseItemCellColor(option.item), 'rest',
      ));
      preview.icon.setTexture(resolveCoopDefenseItemIconTexture(
        this.scene, option.item.slot, option.item.itemLevel, OFFER_PREVIEW_SIZE,
      )).setDisplaySize(OFFER_PREVIEW_SIZE * 0.7, OFFER_PREVIEW_SIZE * 0.7);
    });
    this.offerPreviewGroup
      .setPosition(CHIP_CX + CHIP_W / 2 - 16 - OFFER_PREVIEW_SIZE / 2, y)
      .setVisible(true)
      .setAlpha(0)
      .setScale(0.9);
  }

  private populateSummary(presentation: MatchResultsPresentation): void {
    const showSummary = presentation.progress === null;
    this.summaryGroup?.setVisible(showSummary).setAlpha(0);
    if (!showSummary) return;

    const entries = presentation.leaderboard;
    const local = entries.find((entry) => entry.id === presentation.localPlayerId) ?? null;
    const localRank = entries.findIndex((entry) => entry.id === presentation.localPlayerId) + 1;
    const totalFrags = entries.reduce((sum, entry) => sum + Math.max(0, Math.floor(entry.frags)), 0);

    const stats: readonly { label: string; value: string; color: number }[] = [
      { label: t('ui.results.mode'), value: presentation.modeLabel.toUpperCase(), color: COLORS.GREY_1 },
      { label: t('ui.results.arena'), value: presentation.mapLabel.toUpperCase(), color: COLORS.GREY_1 },
      {
        label: t('ui.results.bestPlayer'),
        value: entries[0] ? entries[0].name.toUpperCase() : t('ui.common.dash'),
        color: COLORS.GOLD_1,
      },
      {
        label: t('ui.results.yourRank'),
        value: localRank > 0 ? `${localRank} / ${entries.length}` : t('ui.common.dash'),
        color: COLORS.BLUE_1,
      },
      {
        label: t('ui.results.yourFragsTotal'),
        value: `${local ? Math.max(0, Math.floor(local.frags)) : 0}  /  ${totalFrags}`,
        color: COLORS.GREEN_1,
      },
    ];

    this.summaryChips.forEach((chip, index) => {
      const stat = stats[index];
      if (!stat) {
        chip.container.setVisible(false);
        return;
      }
      chip.frame.setTexture(this.ensureChipTexture(lerpColor(stat.color, COLORS.GREY_5, 0.45)));
      chip.label.setText(stat.label);
      chip.value.setText(stat.value).setColor(toCssColor(stat.color));
      chip.container.setVisible(true).setAlpha(0).setX(28);
    });
  }

  // ── Sequenz ────────────────────────────────────────────────────────────────

  private startSequence(style: OutcomeStyle): void {
    // 1. Panel fährt heran, damit der Layer wie ein eigenes Fenster aufgeht.
    this.addTween({ targets: this.container, alpha: 1, duration: 180, ease: 'Sine.easeOut' });
    this.addTween({
      targets: this.panel,
      scale: 1,
      duration: 420,
      ease: 'Back.easeOut',
    });

    // 2. Ergebnis schlägt ein: Schrift springt auf, Druckwelle und Funken markieren den Moment.
    this.addTween({
      targets: this.outcomeText,
      alpha: 1,
      scale: 1,
      duration: 460,
      delay: 120,
      ease: 'Back.easeOut',
    });
    this.addTimer(240, () => this.playOutcomeImpact(style));
    this.addTween({
      targets: this.metaText,
      alpha: 1,
      duration: 280,
      delay: 380,
      ease: 'Sine.easeOut',
    });

    // 3. Leaderboard läuft von links ein, jede Zeile zählt ihre Frags hoch.
    this.rows.forEach((row, index) => {
      if (!row.container.visible) return;
      const delay = 460 + index * 60;
      this.addTween({
        targets: row.container,
        alpha: 1,
        x: 0,
        duration: 300,
        delay,
        ease: 'Cubic.easeOut',
      });
      this.animateRowScore(row, delay + 120);
    });

    // 4. Rechte Sektion folgt: entweder Fortschritt oder Kurzübersicht.
    if (this.presentation?.progress) {
      this.addTween({
        targets: this.progressGroup,
        alpha: 1,
        duration: 320,
        delay: 560,
        ease: 'Sine.easeOut',
      });
      this.xpBarEffect?.start();
      this.addTimer(900, () => this.animateXp(this.presentation!.progress!));
      return;
    }

    this.addTween({
      targets: this.summaryGroup,
      alpha: 1,
      duration: 320,
      delay: 560,
      ease: 'Sine.easeOut',
    });
    this.summaryChips.forEach((chip, index) => {
      if (!chip.container.visible) return;
      this.addTween({
        targets: chip.container,
        alpha: 1,
        x: 0,
        duration: 300,
        delay: 640 + index * 90,
        ease: 'Cubic.easeOut',
      });
    });
    this.addTimer(640 + this.summaryChips.length * 90 + 300, () => this.completeSequence());
  }

  /** Aufschlag des Ergebnisses: Druckwelle, additive Schrift-Kopie, Funken bzw. Konfetti. */
  private playOutcomeImpact(style: OutcomeStyle): void {
    if (this.shockRing) {
      this.shockRing.setVisible(true).setAlpha(0.7).setDisplaySize(BANNER_H * 1.2, BANNER_H * 1.2);
      this.addTween({
        targets: this.shockRing,
        displayWidth: BANNER_W * 1.5,
        displayHeight: BANNER_H * 4.4,
        alpha: 0,
        duration: 620,
        ease: 'Cubic.easeOut',
        onComplete: () => this.shockRing?.setVisible(false),
      });
    }
    if (this.outcomeFlash) {
      this.outcomeFlash.setVisible(true).setAlpha(0.85).setScale(1);
      this.addTween({
        targets: this.outcomeFlash,
        scale: 1.3,
        alpha: 0,
        duration: 460,
        ease: 'Cubic.easeOut',
        onComplete: () => this.outcomeFlash?.setVisible(false),
      });
    }

    this.burstSparks(CX, BANNER_Y, 26);
    if (!style.celebrate) return;
    // Konfetti fällt aus dem Kopfstreifen in die Panelfläche – nur beim Sieg.
    this.emitShards(CX - BANNER_W * 0.32, BANNER_Y, 16);
    this.emitShards(CX + BANNER_W * 0.32, BANNER_Y, 16);
    this.addTimer(260, () => this.emitShards(CX, BANNER_Y - 10, 18));
  }

  private animateRowScore(row: ResultRow, delay: number): void {
    if (row.frags <= 0) {
      this.addTimer(delay, () => row.score.setText('0'));
      return;
    }
    this.addTimer(delay, () => {
      const counter = this.scene.tweens.addCounter({
        from: 0,
        to: row.frags,
        duration: Math.min(700, 220 + row.frags * 28),
        ease: 'Cubic.easeOut',
        onUpdate: (tween) => row.score.setText(String(Math.round(tween.getValue() ?? row.frags))),
        onComplete: () => {
          row.score.setText(String(row.frags));
          this.addTween({
            targets: row.score,
            scale: 1.18,
            duration: 110,
            yoyo: true,
            ease: 'Sine.easeOut',
          });
        },
      });
      this.tweens.push(counter);
    });
  }

  private animateXp(progress: MatchProgressDelta): void {
    if (progress.xpGained <= 0) {
      this.applyXpValue(progress.after.totalXp);
      this.revealRewards();
      return;
    }
    let displayedLevel = progress.before.level;
    const counter = this.scene.tweens.addCounter({
      from: progress.before.totalXp,
      to: progress.after.totalXp,
      duration: Math.min(2200, 700 + progress.xpGained * 14),
      ease: 'Cubic.easeOut',
      onUpdate: (tween) => {
        const xp = Math.round(tween.getValue() ?? progress.after.totalXp);
        this.applyXpValue(xp);
        const level = getCoopDefenseLevelForXp(xp);
        if (level > displayedLevel) {
          displayedLevel = level;
          this.playLevelUp();
        }
      },
      onComplete: () => {
        this.applyXpValue(progress.after.totalXp);
        this.revealRewards();
      },
    });
    this.tweens.push(counter);
  }

  private applyXpValue(totalXp: number): void {
    const level = getCoopDefenseLevelForXp(totalXp);
    const levelStart = getCoopDefenseXpThresholdForLevel(level);
    const levelEnd = getCoopDefenseXpThresholdForLevel(level + 1);
    const span = Math.max(1, levelEnd - levelStart);
    const fraction = Phaser.Math.Clamp((totalXp - levelStart) / span, 0, 1);
    const fillW = Math.max(0.001, BAR_W * fraction);
    this.levelText?.setText(t('ui.results.level', { level }));
    this.xpText?.setText(t('ui.results.xpProgress', {
      current: formatNumber(Math.max(0, totalXp - levelStart), getLocale()),
      span: formatNumber(span, getLocale()),
      total: formatNumber(totalXp, getLocale()),
    }));
    this.xpFill?.setCrop(0, 0, fillW, BAR_H);
    this.xpBarEffect?.setFilledWidth(fillW);
  }

  /** Levelaufstieg: Balken blitzt, Level-Zahl springt, Funken sprühen aus dem Balken. */
  private playLevelUp(): void {
    if (this.levelText) {
      this.addTween({
        targets: this.levelText,
        scale: 1.25,
        duration: 140,
        yoyo: true,
        ease: 'Sine.easeOut',
      });
    }
    if (this.xpFlash) {
      this.xpFlash.setAlpha(0.6);
      this.addTween({ targets: this.xpFlash, alpha: 0, duration: 380, ease: 'Cubic.easeOut' });
    }
    this.burstSparks(BAR_X + BAR_W * 0.5, BAR_Y, 20);
    this.emitShards(BAR_X + BAR_W * 0.5, BAR_Y - 6, 12);
  }

  private revealRewards(): void {
    const visibleChips = this.rewardChips.filter((chip) => chip.container.visible);
    visibleChips.forEach((chip, index) => {
      const delay = index * 130;
      this.addTween({
        targets: chip.container,
        alpha: 1,
        scale: 1,
        duration: 320,
        delay,
        ease: 'Back.easeOut',
      });
      this.addTimer(delay + 60, () => this.burstSparks(chip.sparkX, chip.sparkY, 8));
      // Die Angebotsvorschau gehoert zu ihrer Zeile und poppt deshalb mit ihr auf.
      if (this.offerPreviewGroup?.visible && this.offerPreviewGroup.y === chip.container.y) {
        this.addTween({
          targets: this.offerPreviewGroup,
          alpha: 1,
          scale: 1,
          duration: 320,
          delay: delay + 90,
          ease: 'Back.easeOut',
        });
      }
    });
    this.addTimer(visibleChips.length * 130 + 340, () => this.completeSequence());
  }

  private completeSequence(): void {
    if (this.sequenceComplete) return;
    this.sequenceComplete = true;
    // Der Hinweis bewirbt eine Aktion, die es nicht mehr gibt, und verschwindet deshalb.
    if (this.hintText?.visible) {
      this.idleTweens.push(this.scene.tweens.add({
        targets: this.hintText,
        alpha: 0,
        duration: 260,
        ease: 'Sine.easeIn',
        onComplete: () => this.hintText?.setVisible(false),
      }));
    }
    if (!this.continueButton) return;
    // Erst nach der Auswertung atmet der Weiter-Button — vorher würde er die Aufmerksamkeit
    // von Leaderboard und Belohnungen wegziehen.
    this.continueGlow = addExternalGlow(this.continueButton, COLORS.GREEN_2, 0.6, 0, false, 0.1, 8);
    if (!this.continueGlow) return;
    this.idleTweens.push(this.scene.tweens.add({
      targets: this.continueGlow,
      outerStrength: 2.6,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    }));
  }

  private showRewardTooltip(chip: RewardChip): void {
    if (!chip.tooltip || !this.hintText) return;
    this.hintText
      .setText(chip.tooltip)
      .setColor(toCssColor(COLORS.GOLD_1))
      .setVisible(true)
      .setAlpha(1);
  }

  private hideRewardTooltip(): void {
    if (!this.hintText) return;
    this.hintText
      .setText(t('ui.results.skipHint'))
      .setColor(toCssColor(COLORS.GREY_5));
    if (this.sequenceComplete) this.hintText.setVisible(false);
  }

  private skipAnimations(): void {
    if (!this.visible || this.sequenceComplete || this.syncing) return;
    this.stopSequence();

    this.container?.setAlpha(1);
    this.panel?.setScale(1);
    this.outcomeText?.setAlpha(1).setScale(1);
    this.outcomeFlash?.setVisible(false);
    this.metaText?.setAlpha(1);
    this.shockRing?.setVisible(false);
    this.rows.forEach((row) => {
      if (!row.container.visible) return;
      row.container.setAlpha(1).setX(0);
      row.score.setText(String(row.frags)).setScale(1);
    });

    if (this.presentation?.progress) {
      this.progressGroup?.setAlpha(1);
      this.applyXpValue(this.presentation.progress.after.totalXp);
      this.levelText?.setScale(1);
      this.xpFlash?.setAlpha(0);
      this.rewardChips.forEach((chip) => {
        if (chip.container.visible) chip.container.setAlpha(1).setScale(1);
      });
      if (this.offerPreviewGroup?.visible) this.offerPreviewGroup.setAlpha(1).setScale(1);
    } else {
      this.summaryGroup?.setAlpha(1);
      this.summaryChips.forEach((chip) => {
        if (chip.container.visible) chip.container.setAlpha(1).setX(0);
      });
    }

    this.completeSequence();
  }

  private continueToLobby(): void {
    const wasReplay = this.replayOnly;
    this.hide();
    if (!wasReplay) this.onContinue();
  }

  // ── Effekte ────────────────────────────────────────────────────────────────

  private burstSparks(x: number, y: number, count: number): void {
    const scaled = scaleParticleCount(this.scene, count, 'decorative');
    if (scaled <= 0) return;
    this.sparkEmitter?.emitParticleAt(x, y, scaled);
  }

  private emitShards(x: number, y: number, count: number): void {
    const scaled = scaleParticleCount(this.scene, count, 'decorative');
    if (scaled <= 0) return;
    this.shardEmitter?.emitParticleAt(x, y, scaled);
  }

  /** Dauerlaeufer waehrend der Sichtbarkeit: atmender Kopfstreifen, drehender Spinner. */
  private startIdleAnimations(accent: number, spinning: boolean): void {
    if (this.banner) {
      this.bannerGlow = addExternalGlow(this.banner, accent, 0.8, 0, false, 0.1, 10);
      if (this.bannerGlow) {
        this.idleTweens.push(this.scene.tweens.add({
          targets: this.bannerGlow,
          outerStrength: 2.8,
          duration: 1800,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        }));
      }
    }
    if (spinning && this.syncSpinner) {
      this.syncSpinner.setAngle(0);
      this.idleTweens.push(this.scene.tweens.add({
        targets: this.syncSpinner,
        angle: 360,
        duration: 2600,
        repeat: -1,
        ease: 'Linear',
      }));
      this.idleTweens.push(this.scene.tweens.add({
        targets: this.syncSpinner,
        alpha: 0.35,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }));
    }
  }

  private stopIdleAnimations(): void {
    this.idleTweens.forEach((tween) => tween.destroy());
    this.idleTweens = [];
    if (this.banner && this.bannerGlow) removeExternalFx(this.banner, this.bannerGlow);
    this.bannerGlow = null;
    if (this.continueButton && this.continueGlow) removeExternalFx(this.continueButton, this.continueGlow);
    this.continueGlow = null;
  }

  // ── Texturen ───────────────────────────────────────────────────────────────

  private ensureBannerTexture(accent: number): string {
    return ensureRoundedTexture(this.scene, {
      key: `_mro_banner_${accent.toString(16)}`,
      w: BANNER_W,
      h: BANNER_H,
      radius: 18,
      topColor: lerpColor(COLORS.GREY_8, accent, 0.34),
      bottomColor: lerpColor(COLORS.GREY_9, accent, 0.14),
      fillAlpha: 0.94,
      strokeColor: accent,
      strokeAlpha: 0.9,
      strokeWidth: 2,
      highlightAlpha: 0.12,
    });
  }

  private ensureRowTexture(variant: 'even' | 'odd' | 'local'): string {
    if (variant === 'local') {
      return ensureRoundedTexture(this.scene, {
        key: '_mro_row_local',
        w: ROW_W,
        h: ROW_H,
        radius: 10,
        topColor: lerpColor(COLORS.GREY_8, LOCAL_ROW_ACCENT, 0.34),
        bottomColor: lerpColor(COLORS.GREY_9, LOCAL_ROW_ACCENT, 0.16),
        fillAlpha: 0.92,
        strokeColor: LOCAL_ROW_ACCENT,
        strokeAlpha: 0.85,
        strokeWidth: 2,
        highlightAlpha: 0.1,
      });
    }
    return ensureFlatPanelTexture(
      this.scene,
      `_mro_row_${variant}`,
      ROW_W,
      ROW_H,
      variant === 'even' ? COLORS.GREY_8 : COLORS.GREY_9,
      COLORS.GREY_6,
      { radius: 10, fillAlpha: variant === 'even' ? 0.72 : 0.58, strokeAlpha: 0.35 },
    );
  }

  private ensureMedalTexture(color: number): string {
    return ensureRoundedTexture(this.scene, {
      key: `_mro_medal_${color.toString(16)}`,
      w: MEDAL_SIZE,
      h: MEDAL_SIZE,
      radius: 9,
      topColor: lerpColor(color, 0xffffff, 0.26),
      bottomColor: lerpColor(color, 0x000000, 0.3),
      fillAlpha: 0.97,
      strokeColor: lerpColor(color, 0xffffff, 0.4),
      strokeAlpha: 0.85,
      strokeWidth: 1.5,
      highlightAlpha: 0.3,
    });
  }

  private ensureChipTexture(color: number): string {
    return ensureRoundedTexture(this.scene, {
      key: `_mro_chip_${color.toString(16)}`,
      w: CHIP_W,
      h: CHIP_H,
      radius: 12,
      topColor: lerpColor(COLORS.GREY_8, color, 0.28),
      bottomColor: lerpColor(COLORS.GREY_9, color, 0.1),
      fillAlpha: 0.85,
      strokeColor: color,
      strokeAlpha: 0.6,
      strokeWidth: 1.5,
      highlightAlpha: 0.06,
    });
  }

  private ensureBadgeTexture(color: number): string {
    return ensureRoundedTexture(this.scene, {
      key: `_mro_badge_${color.toString(16)}`,
      w: BADGE_SIZE,
      h: BADGE_SIZE,
      radius: 10,
      topColor: lerpColor(color, 0xffffff, 0.24),
      bottomColor: lerpColor(color, 0x000000, 0.28),
      fillAlpha: 0.97,
      strokeColor: lerpColor(color, 0xffffff, 0.42),
      strokeAlpha: 0.9,
      strokeWidth: 1.5,
      highlightAlpha: 0.28,
    });
  }

  // ── Bookkeeping ────────────────────────────────────────────────────────────

  private addTimer(delay: number, callback: () => void): void {
    this.timers.push(this.scene.time.delayedCall(delay, callback));
  }

  private addTween(config: Phaser.Types.Tweens.TweenBuilderConfig): void {
    this.tweens.push(this.scene.tweens.add(config));
  }

  private stopSequence(): void {
    this.timers.forEach((timer) => timer.remove());
    this.timers = [];
    this.tweens.forEach((tween) => tween.stop());
    this.tweens = [];
  }
}

function xpBarPalette(): LivingBarPalette {
  return { dark: COLORS.GREEN_4, mid: COLORS.GREEN_2, light: COLORS.GREEN_1 };
}

/** Belohnungen als farbcodierte Zeilen; ohne Freischaltung bleibt eine graue Leerzeile. */
function describeRewards(
  progress: MatchProgressDelta,
  itemReward: MatchItemRewardPresentation | null,
): RewardDescriptor[] {
  const descriptors: RewardDescriptor[] = [];
  if (progress.persistentBaseUnlocked) {
    descriptors.push({
      glyph: '🏰',
      label: t('ui.reward.persistentBaseUnlocked'),
      color: COLORS.GOLD_1,
      tooltip: t('ui.reward.persistentBaseUnlockedHint'),
    });
  }
  if (progress.itemsUnlocked) {
    descriptors.push({
      glyph: '🔓',
      label: t('ui.reward.itemsUnlocked'),
      color: COLORS.GOLD_1,
      tooltip: t('ui.reward.itemsUnlockedHint'),
    });
  }
  if (itemReward && itemReward.options.length > 0) {
    descriptors.push({
      glyph: '◈',
      label: t(itemReward.epicGuaranteeCount > 0 ? 'ui.reward.itemChoice' : 'ui.reward.itemChoiceNoGuarantee', {
        count: itemReward.options.length,
        guarantee: itemReward.epicGuaranteeCount,
      }),
      color: COLORS.BLUE_2,
      tooltip: itemReward.epicGuaranteeCount > 0
        ? t('ui.reward.itemChoiceHintGuaranteed', {
          guarantee: itemReward.epicGuaranteeCount,
          count: itemReward.options.length,
        })
        : t('ui.reward.itemChoiceHint'),
      itemOffer: true,
    });
  }
  if (progress.newlyUnlockedClassIds.length > 0) {
    descriptors.push({
      glyph: '🔓',
      label: progress.newlyUnlockedClassIds.length === 1
        ? t('ui.reward.classUnlockedSingle')
        : t('ui.reward.classesUnlocked'),
      color: COLORS.GOLD_1,
      tooltip: t('ui.reward.classUnlockedHint'),
    });
  }
  // Der Levelaufstieg selbst zeigt sich bereits am XP-Balken; hier zaehlt nur sein Ertrag.
  if (progress.newSkillPoints > 0) {
    descriptors.push({
      glyph: '◆',
      label: t(progress.newSkillPoints === 1 ? 'ui.reward.skillPoint' : 'ui.reward.skillPoints', {
        count: progress.newSkillPoints,
      }),
      color: COLORS.BLUE_2,
    });
  }
  if (progress.newBossPoints > 0) {
    descriptors.push({ glyph: '★', label: t('ui.reward.bossUpgrade'), color: COLORS.GOLD_1 });
  }
  if (progress.unlockedMapName) {
    descriptors.push({
      glyph: '▣',
      label: t('ui.reward.mapUnlocked', { map: progress.unlockedMapName.toUpperCase() }),
      color: COLORS.BROWN_2,
    });
  }
  if (descriptors.length === 0) {
    descriptors.push({ glyph: '—', label: t('ui.reward.noNewUnlocks'), color: COLORS.GREY_5 });
  }
  return descriptors;
}
