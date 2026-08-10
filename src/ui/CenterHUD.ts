/**
 * CenterHUD – feste UI-Elemente in der Bildschirmmitte.
 *
 * Enthält Timer (oben mittig), RB54-Widget (direkt darunter) und
 * den unteren Stack für Power-Ups, Utility und Ultimate.
 */
import * as Phaser from 'phaser';
import { ARMOR_COLOR, GAME_WIDTH, GAME_HEIGHT, DEPTH, COLORS, toCssColor } from '../config';
import type { ArenaHUDData } from './ArenaHUD';
import type { CoopDefenseEncounterPresentationState, CoopDefenseSurvivalPlayerState } from '../types';
import {
  rgbStr,
  type LivingBarPalette,
  ensureLivingBarTextures, createGradientTexture, LivingBarEffect, randomEmitZoneData,
} from './LivingBarEffect';
import { addExternalGlow, removeExternalFx, type GlowHandle } from '../utils/phaserFx';
import { formatTrainArrivalLabel } from '../train/TrainEvent';
import {
  COOP_DEFENSE_TUTORIAL_CONTROLS_BODY_H,
  COOP_DEFENSE_TUTORIAL_CONTROLS_DESC_X,
  COOP_DEFENSE_TUTORIAL_CONTROLS_HEADING_H,
  COOP_DEFENSE_TUTORIAL_CONTROLS_KEY_X,
  COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H,
  COOP_DEFENSE_TUTORIAL_PAD_TOP,
  COOP_DEFENSE_TUTORIAL_PAD_X,
  COOP_DEFENSE_TUTORIAL_PANEL_TOP_Y,
  COOP_DEFENSE_TUTORIAL_PANEL_WIDTH,
  COOP_DEFENSE_TUTORIAL_TITLE_H,
  getCoopDefenseTutorialPanelCenterX,
  getCoopDefenseTutorialPanelHeight,
} from '../config/coopDefenseTutorial';
import { HELP_CONTROLS } from '../config/helpControls';
import { ensureFlatPanelTexture, roundRectPath } from './uiTextures';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';

const CENTER_X       = GAME_WIDTH / 2;
const PANEL_WIDTH    = 200;
const PANEL_BG_COL   = 0x000000;
const PANEL_BG_ALPHA = 0.25;

const TIMER_Y             = 28;
const TIMER_BG_H          = 44;
const TIMER_COLOR_NORMAL  = '#e0e0e0';
const TIMER_COLOR_WARNING = '#ff4444';

const TUTORIAL_PAD_X      = COOP_DEFENSE_TUTORIAL_PAD_X;
const TUTORIAL_PAD_TOP    = COOP_DEFENSE_TUTORIAL_PAD_TOP;
const TUTORIAL_TITLE_H    = COOP_DEFENSE_TUTORIAL_TITLE_H;
const TUTORIAL_FADE_MS    = 220;
const TUTORIAL_BG_COLOR   = 0x07131f;
const TUTORIAL_ACCENT     = COLORS.GOLD_2;
// Steuerungstabelle im Tutorial-Fenster – bewusst identisch formatiert zum Hilfe-Fenster.
const TUTORIAL_CONTROLS_TOP    = TUTORIAL_PAD_TOP + TUTORIAL_TITLE_H + COOP_DEFENSE_TUTORIAL_CONTROLS_BODY_H;
const TUTORIAL_CONTROLS_ROWS_Y = TUTORIAL_CONTROLS_TOP + COOP_DEFENSE_TUTORIAL_CONTROLS_HEADING_H;
const TUTORIAL_CONTROLS_SEP_Y  = TUTORIAL_CONTROLS_TOP + 26;

const ANNOUNCEMENT_Y          = GAME_HEIGHT / 2;
const ANNOUNCEMENT_MAX_TEXT_W = 560;
const ANNOUNCEMENT_MIN_W      = 240;
const ANNOUNCEMENT_MIN_H      = 48;
const ANNOUNCEMENT_PAD_X      = 20;
const ANNOUNCEMENT_PAD_Y      = 14;
const ANNOUNCEMENT_HOLD_MS    = 800;
const ANNOUNCEMENT_FADE_MS    = 200;
const ANNOUNCEMENT_TEXT_COLOR = '#e0e0e0';

const TRAIN_SEP_Y      = 56;
const TRAIN_TEXT_Y     = 72;
const TRAIN_BAR_Y      = 90;
const TRAIN_BAR_H      = 12;
const TRAIN_BAR_W      = PANEL_WIDTH - 16;
const TRAIN_BAR_LEFT   = CENTER_X - TRAIN_BAR_W / 2;
const TRAIN_BAR_TOP    = TRAIN_BAR_Y - TRAIN_BAR_H / 2;
const TRAIN_BAR_ALPHA  = 1;
const TRAIN_BAR_TEX    = '_center_train_fg';
const TRAIN_BAR_BG_TEX = '_center_train_bg';
const TRAIN_PAL: LivingBarPalette = { dark: 0x3d1812, mid: 0xcf573c, light: 0xff8060 };
const TRAIN_PANEL_Y    = 78;
const TRAIN_PANEL_H    = 54;

// ── Encounter-Panel ──────────────────────────────────────────────────────────
// Anzeige der Coop-Defense-Angriffsserie. Die Wellenposition trägt die Pip-Leiste,
// die Phase die Statuszeile, die Restzeit der eigene Countdown – jede Information
// steht damit genau einmal im Panel.
const ENCOUNTER_PANEL_W = 400;
const ENCOUNTER_PANEL_H = 84;
const ENCOUNTER_PANEL_X = GAME_WIDTH - ENCOUNTER_PANEL_W / 2 - 24;
const ENCOUNTER_PANEL_TOP_Y = 22;
const ENCOUNTER_PANEL_Y = ENCOUNTER_PANEL_TOP_Y + ENCOUNTER_PANEL_H / 2;

/**
 * Lage des Pflichtziel-Panels. Exportiert, damit sich das Nebenziel-Panel daran ausrichten
 * kann, statt dieselben Zahlen ein zweites Mal zu führen – die beiden bilden bewusst eine
 * gemeinsame Zeile am oberen Rand.
 */
export const ENCOUNTER_PANEL_LAYOUT = {
  centerX: ENCOUNTER_PANEL_X,
  topY: ENCOUNTER_PANEL_TOP_Y,
  width: ENCOUNTER_PANEL_W,
  height: ENCOUNTER_PANEL_H,
} as const;
const ENCOUNTER_PANEL_LEFT = -ENCOUNTER_PANEL_W / 2;
const ENCOUNTER_PANEL_TOP = -ENCOUNTER_PANEL_H / 2;
const ENCOUNTER_PANEL_RADIUS = 10;
const ENCOUNTER_CONTENT_LEFT = ENCOUNTER_PANEL_LEFT + 24;
const ENCOUNTER_CONTENT_RIGHT = -ENCOUNTER_PANEL_LEFT - 20;
const ENCOUNTER_RAIL_X = ENCOUNTER_PANEL_LEFT + 9;
const ENCOUNTER_RAIL_H = ENCOUNTER_PANEL_H - 24;
const ENCOUNTER_KICKER_Y = ENCOUNTER_PANEL_TOP + 19;
const ENCOUNTER_STATUS_Y = ENCOUNTER_PANEL_TOP + 46;
const ENCOUNTER_PROGRESS_Y = ENCOUNTER_PANEL_TOP + 69;
const ENCOUNTER_PROGRESS_H = 6;
const ENCOUNTER_PROGRESS_W = ENCOUNTER_CONTENT_RIGHT - ENCOUNTER_CONTENT_LEFT;
const ENCOUNTER_FILL_H = ENCOUNTER_PROGRESS_H - 2;
const ENCOUNTER_FILL_W = ENCOUNTER_PROGRESS_W - 2;
const ENCOUNTER_PIP_W = 17;
const ENCOUNTER_PIP_H = 5;
const ENCOUNTER_PIP_GAP = 5;
/** Über dieser Wellenzahl bleibt die Pip-Leiste ungezeichnet; die Pips wären nicht mehr zählbar. */
const ENCOUNTER_PIP_MAX = 9;
const ENCOUNTER_FADE_MS = 180;
const ENCOUNTER_BG_TEX = '_center_encounter_bg';
const ENCOUNTER_RAIL_TEX = '_center_encounter_rail';
const ENCOUNTER_RAIL_GLOW_TEX = '_center_encounter_rail_glow';
const ENCOUNTER_RAIL_W = 6;
const ENCOUNTER_RAIL_GLOW_W = 34;
const ENCOUNTER_RAIL_GLOW_ALPHA = 0.5;
const ENCOUNTER_SCAN_PERIOD_MS = 1_800;
const ENCOUNTER_SCAN_INSET_PX = 9;

type EncounterStyleId = 'incoming' | 'active' | 'done' | 'rest';

interface EncounterStyle {
  /** Leitfarbe für Rahmen, Schiene, Pips, Balken und Statuszeile. */
  readonly accent: number;
  /** Gedämpfte Zweitfarbe für Kicker und ruhende Pips. */
  readonly muted: number;
  readonly palette: LivingBarPalette;
  readonly barTex: string;
}

const ENCOUNTER_STYLES: Record<EncounterStyleId, EncounterStyle> = {
  incoming: {
    accent: COLORS.RED_1,
    muted: COLORS.GOLD_3,
    palette: { dark: 0x4a1c12, mid: COLORS.RED_2, light: COLORS.RED_1 },
    barTex: '_center_encounter_bar_incoming',
  },
  active: {
    accent: COLORS.GOLD_1,
    muted: COLORS.GOLD_3,
    palette: { dark: 0x4d3210, mid: COLORS.GOLD_2, light: COLORS.GOLD_1 },
    barTex: '_center_encounter_bar_active',
  },
  done: {
    accent: COLORS.GREEN_2,
    muted: COLORS.GREEN_4,
    palette: { dark: 0x1d3a1a, mid: COLORS.GREEN_3, light: COLORS.GREEN_1 },
    barTex: '_center_encounter_bar_done',
  },
  rest: {
    accent: COLORS.BLUE_2,
    muted: COLORS.BLUE_4,
    palette: { dark: 0x16303f, mid: COLORS.BLUE_3, light: COLORS.BLUE_1 },
    barTex: '_center_encounter_bar_rest',
  },
};

function resolveEncounterStyleId(phase: CoopDefenseEncounterPresentationState['phase']): EncounterStyleId {
  if (phase === 'active') return 'active';
  if (phase === 'cleared' || phase === 'complete') return 'done';
  if (phase === 'rest') return 'rest';
  return 'incoming';
}

function formatEncounterFronts(fronts: readonly string[] | undefined): string {
  const labels = (fronts ?? ['west']).map((front) => ({
    west: 'WEST',
    north: 'NORD',
    east: 'OST',
    south: 'SÜD',
  } as Record<string, string>)[front] ?? 'WEST');
  return labels.length > 1 ? labels.join(' + ') : labels[0] ?? 'WEST';
}

const STACK_BAR_W      = 212;
const STACK_BAR_H      = 14;
const STACK_LABEL_H    = 20;
const STACK_TOTAL_H    = STACK_LABEL_H + STACK_BAR_H;
const STACK_PANEL_W    = STACK_BAR_W + 20;
const STACK_PANEL_H    = STACK_TOTAL_H + 4;
const STACK_MARGIN     = 20;
const STACK_GAP        = 8;
const STACK_REVEAL_MS  = 500;
const ULTIMATE_REVEAL_MS = 850;
const STACK_BAR_LEFT   = -STACK_BAR_W / 2;
const STACK_FADE_MS    = 100;
const STACK_CORE_TEX   = '_center_core';

const ARM_BAR_TEX      = '_center_arm_fg';
const UTIL_BAR_TEX     = '_center_util_fg';
const ULT_BAR_TEX      = '_center_ult_fg';
const STACK_BAR_BG_TEX = '_center_stack_bg';
const ARM_PAL: LivingBarPalette = { dark: COLORS.GOLD_3, mid: ARMOR_COLOR, light: COLORS.GOLD_1 };
const UTIL_PAL: LivingBarPalette = { dark: 0x8a4018, mid: 0xd97030, light: 0xf0a048 };
const ULT_PAL: LivingBarPalette = { dark: COLORS.RED_3, mid: COLORS.RED_2, light: COLORS.RED_1 };

const COLOR_SEPARATOR = 0x334455;
const COL_BAR_BG      = COLORS.GREY_9;
const COL_BAR_BG2     = COLORS.GREY_8;
const COL_BORDER      = COLORS.GREY_6;

const LABEL_FONT = {
  fontSize: '15px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_3),
};
const ANNOUNCEMENT_FONT = {
  fontSize: '22px', fontFamily: 'monospace', fontStyle: 'bold', color: ANNOUNCEMENT_TEXT_COLOR,
  align: 'center' as const,
  wordWrap: { width: ANNOUNCEMENT_MAX_TEXT_W },
};
const TUTORIAL_TITLE_FONT = {
  fontSize: '14px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(TUTORIAL_ACCENT),
};
const TUTORIAL_BODY_FONT = {
  fontSize: '19px', fontFamily: 'monospace', color: '#f1f4f6', align: 'center' as const,
  lineSpacing: 5,
  wordWrap: { width: COOP_DEFENSE_TUTORIAL_PANEL_WIDTH - TUTORIAL_PAD_X * 2 },
};
const TUTORIAL_CONTROLS_KEY_FONT = {
  fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GOLD_1),
};
const TUTORIAL_CONTROLS_DESC_FONT = {
  fontSize: '16px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_2),
};
const ENCOUNTER_KICKER_FONT = {
  fontSize: '13px', fontFamily: 'monospace', fontStyle: 'bold',
  color: toCssColor(COLORS.GREY_4), letterSpacing: 2,
};
const ENCOUNTER_STATUS_FONT = {
  fontSize: '22px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
};
const ENCOUNTER_COUNTDOWN_FONT = {
  fontSize: '22px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
};

function ensureBarBgTexture(scene: Phaser.Scene, key: string, width: number, height: number): void {
  if (scene.textures.exists(key)) return;
  const ct = scene.textures.createCanvas(key, width, height)!;
  const ctx = ct.context;
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, rgbStr(COL_BAR_BG2));
  grad.addColorStop(1, rgbStr(COL_BAR_BG));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, width, 1);
  ct.refresh();
}

interface LowerBarSection {
  container: Phaser.GameObjects.Container;
  panelBg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  bg: Phaser.GameObjects.Image;
  fg: Phaser.GameObjects.Image;
  border: Phaser.GameObjects.Rectangle;
  effect: LivingBarEffect;
  energyZone: Phaser.Geom.Rectangle;
  coreEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  outerEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  energized: boolean;
  glow: GlowHandle | null;
  glowTween: Phaser.Tweens.Tween | null;
  labelTween: Phaser.Tweens.Tween | null;
  hideTween: Phaser.Tweens.Tween | null;
  lastWidth: number;
  lastLabel: string | null;
}

/**
 * Leitschiene des Encounter-Panels. Beide Texturen sind reines Weiß mit Alphaverlauf und
 * werden zur Laufzeit auf die Phasenfarbe getintet.
 *
 * Der Körper liegt bewusst unter voller Deckkraft, der schmale Kern darüber auf 1: nach dem
 * Tint entsteht daraus ein heller Kern in einem dunkleren Mantel. Ein einfarbiges Rechteck
 * bliebe flach, und seine harten Kanten verrieten den additiven Schein als Rechteck.
 */
function ensureEncounterRailTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(ENCOUNTER_RAIL_TEX)) {
    const ct = scene.textures.createCanvas(ENCOUNTER_RAIL_TEX, ENCOUNTER_RAIL_W, ENCOUNTER_RAIL_H);
    if (ct) {
      const ctx = ct.context;
      const radius = (ENCOUNTER_RAIL_W - 1) / 2;
      ctx.clearRect(0, 0, ENCOUNTER_RAIL_W, ENCOUNTER_RAIL_H);
      const body = ctx.createLinearGradient(0, 0, 0, ENCOUNTER_RAIL_H);
      body.addColorStop(0, 'rgba(255,255,255,0.16)');
      body.addColorStop(0.16, 'rgba(255,255,255,0.5)');
      body.addColorStop(0.5, 'rgba(255,255,255,0.68)');
      body.addColorStop(0.84, 'rgba(255,255,255,0.5)');
      body.addColorStop(1, 'rgba(255,255,255,0.16)');
      roundRectPath(ctx, 0.5, 0.5, ENCOUNTER_RAIL_W - 1, ENCOUNTER_RAIL_H - 1, radius);
      ctx.fillStyle = body;
      ctx.fill();

      ctx.save();
      roundRectPath(ctx, 0.5, 0.5, ENCOUNTER_RAIL_W - 1, ENCOUNTER_RAIL_H - 1, radius);
      ctx.clip();
      const core = ctx.createLinearGradient(0, 0, 0, ENCOUNTER_RAIL_H);
      core.addColorStop(0, 'rgba(255,255,255,0)');
      core.addColorStop(0.22, 'rgba(255,255,255,1)');
      core.addColorStop(0.78, 'rgba(255,255,255,1)');
      core.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = core;
      ctx.fillRect(ENCOUNTER_RAIL_W / 2 - 1, 0, 2, ENCOUNTER_RAIL_H);
      ctx.restore();
      ct.refresh();
    }
  }

  if (scene.textures.exists(ENCOUNTER_RAIL_GLOW_TEX)) return;
  const ct = scene.textures.createCanvas(ENCOUNTER_RAIL_GLOW_TEX, ENCOUNTER_RAIL_GLOW_W, ENCOUNTER_RAIL_H);
  if (!ct) return;
  const ctx = ct.context;
  ctx.clearRect(0, 0, ENCOUNTER_RAIL_GLOW_W, ENCOUNTER_RAIL_H);
  const horizontal = ctx.createLinearGradient(0, 0, ENCOUNTER_RAIL_GLOW_W, 0);
  horizontal.addColorStop(0, 'rgba(255,255,255,0)');
  horizontal.addColorStop(0.34, 'rgba(255,255,255,0.26)');
  horizontal.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  horizontal.addColorStop(0.66, 'rgba(255,255,255,0.26)');
  horizontal.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, ENCOUNTER_RAIL_GLOW_W, ENCOUNTER_RAIL_H);
  // Vertikaler Auslauf über destination-in: Der Schein endet weich statt an einer Kante.
  ctx.globalCompositeOperation = 'destination-in';
  const vertical = ctx.createLinearGradient(0, 0, 0, ENCOUNTER_RAIL_H);
  vertical.addColorStop(0, 'rgba(0,0,0,0)');
  vertical.addColorStop(0.2, 'rgba(0,0,0,1)');
  vertical.addColorStop(0.8, 'rgba(0,0,0,1)');
  vertical.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, ENCOUNTER_RAIL_GLOW_W, ENCOUNTER_RAIL_H);
  ctx.globalCompositeOperation = 'source-over';
  ct.refresh();
}

function ensureRadialTexture(
  scene: Phaser.Scene,
  key: string,
  size: number,
  colorStops: [number, string][],
): void {
  if (scene.textures.exists(key)) return;
  const ct = scene.textures.createCanvas(key, size, size)!;
  const ctx = ct.context;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  for (const [stop, color] of colorStops) grad.addColorStop(stop, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ct.refresh();
}

export class CenterHUD {
  private container!: Phaser.GameObjects.Container;

  private timerText!: Phaser.GameObjects.Text;
  private survivalText!: Phaser.GameObjects.Text;
  private tutorialContainer!: Phaser.GameObjects.Container;
  private tutorialGraphics!: Phaser.GameObjects.Graphics;
  private tutorialTitle!: Phaser.GameObjects.Text;
  private tutorialBody!: Phaser.GameObjects.Text;
  private tutorialControlsHeading!: Phaser.GameObjects.Text;
  private tutorialControlsTexts: Phaser.GameObjects.Text[] = [];
  private tutorialTween: Phaser.Tweens.Tween | null = null;
  private tutorialValue: string | null = null;
  private tutorialControlsValue = false;
  private announcementContainer!: Phaser.GameObjects.Container;
  private announcementBg!: Phaser.GameObjects.Rectangle;
  private announcementText!: Phaser.GameObjects.Text;
  private announcementTween: Phaser.Tweens.Tween | null = null;
  private encounterPanel!: Phaser.GameObjects.Container;
  private encounterBg!: Phaser.GameObjects.Image;
  private encounterFrame!: Phaser.GameObjects.Graphics;
  private encounterPips!: Phaser.GameObjects.Graphics;
  private encounterRailGlow!: Phaser.GameObjects.Image;
  private encounterRail!: Phaser.GameObjects.Image;
  private encounterProgressFill!: Phaser.GameObjects.Image;
  private encounterProgressHead!: Phaser.GameObjects.Image;
  private encounterKicker!: Phaser.GameObjects.Text;
  private encounterStatus!: Phaser.GameObjects.Text;
  private encounterCountdown!: Phaser.GameObjects.Text;
  private encounterTween: Phaser.Tweens.Tween | null = null;
  private encounterPulseTween: Phaser.Tweens.Tween | null = null;

  private trainText!: Phaser.GameObjects.Text;
  private trainPanelBg!: Phaser.GameObjects.Rectangle;
  private trainBarBg!: Phaser.GameObjects.Image;
  private trainBarFgImg!: Phaser.GameObjects.Image;
  private trainBarEffect!: LivingBarEffect;
  private trainBarBorder!: Phaser.GameObjects.Rectangle;

  private utilitySection!: LowerBarSection;
  private armorSection!: LowerBarSection;
  private ultimateSection!: LowerBarSection;
  private puContainerRef: Phaser.GameObjects.Container | null = null;

  private lastTimerText: string | null = null;
  private lastTimerColor: string | null = null;
  private lastSurvivalText: string | null = null;
  private lastEncounterPresentationSignature: string | null = null;
  private lastEncounterPresentationPhase: CoopDefenseEncounterPresentationState['phase'] | null = null;
  private lastEncounterStyleId: EncounterStyleId | null = null;
  private lastEncounterPipSignature: string | null = null;
  private lastEncounterProgressWidth = -1;
  private lastEncounterCountdownText: string | null = null;
  private lastEncounterDeterminate: boolean | null = null;
  private lastTrainText: string | null = null;
  private lastTrainBarWidth = -1;
  private lastTrainMode: 'hidden' | 'arrival' | 'hp' | 'destroyed' = 'hidden';
  private utilityRevealUntil = 0;
  private ultimateRevealUntil = 0;
  private utilityHeldLastFrame = false;
  private utilityAttentionActive = false;
  private ultimateReadyActive = false;

  constructor(private scene: Phaser.Scene) {}

  build(): void {
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(DEPTH.OVERLAY - 1);
    this.container.setVisible(false);
    promoteToClarityCamera(this.scene, this.container);

    ensureLivingBarTextures(this.scene);
    ensureBarBgTexture(this.scene, TRAIN_BAR_BG_TEX, TRAIN_BAR_W, TRAIN_BAR_H);
    ensureBarBgTexture(this.scene, STACK_BAR_BG_TEX, STACK_BAR_W, STACK_BAR_H);
    ensureRadialTexture(this.scene, STACK_CORE_TEX, 14, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.3, 'rgba(255,255,255,0.7)'],
      [0.6, 'rgba(255,255,255,0.2)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    if (!this.scene.textures.exists(TRAIN_BAR_TEX)) {
      createGradientTexture(this.scene, TRAIN_BAR_TEX, TRAIN_PAL, TRAIN_BAR_W, TRAIN_BAR_H);
    }
    if (!this.scene.textures.exists(UTIL_BAR_TEX)) {
      createGradientTexture(this.scene, UTIL_BAR_TEX, UTIL_PAL, STACK_BAR_W, STACK_BAR_H);
    }
    if (!this.scene.textures.exists(ARM_BAR_TEX)) {
      createGradientTexture(this.scene, ARM_BAR_TEX, ARM_PAL, STACK_BAR_W, STACK_BAR_H);
    }
    if (!this.scene.textures.exists(ULT_BAR_TEX)) {
      createGradientTexture(this.scene, ULT_BAR_TEX, ULT_PAL, STACK_BAR_W, STACK_BAR_H);
    }

    this.buildTimer();
    this.buildEncounterPanel();
    this.buildTutorialPanel();
    this.buildAnnouncementOverlay();
    this.buildTrainWidget();
    this.buildBottomStack();
  }

  private buildTimer(): void {
    const timerBg = this.scene.add.rectangle(CENTER_X, TIMER_Y, PANEL_WIDTH, TIMER_BG_H, 0x000000, 0.35)
      .setScrollFactor(0);
    this.timerText = this.scene.add.text(CENTER_X, TIMER_Y, '2:00', {
      fontSize: '32px', fontFamily: 'monospace', color: TIMER_COLOR_NORMAL, fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    this.survivalText = this.scene.add.text(CENTER_X + PANEL_WIDTH / 2 + 18, TIMER_Y, '', {
      fontSize: '14px', fontFamily: 'monospace', color: '#ffd166', fontStyle: 'bold',
    }).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);
    this.container.add([timerBg, this.timerText, this.survivalText]);
  }

  private buildEncounterPanel(): void {
    // Grundfläche als geteilte Panel-Textur: gleicher Verlauf, Radius und Randton wie die
    // übrigen Menü- und Overlay-Flächen. Nur die farbführenden Teile liegen als eigene
    // Objekte darüber und werden bei einem Phasenwechsel neu gezeichnet, nicht pro Frame.
    ensureFlatPanelTexture(
      this.scene,
      ENCOUNTER_BG_TEX,
      ENCOUNTER_PANEL_W,
      ENCOUNTER_PANEL_H,
      COLORS.GREY_8,
      COLORS.GREY_6,
      { radius: ENCOUNTER_PANEL_RADIUS, fillAlpha: 0.88, strokeAlpha: 0.45 },
    );
    for (const style of Object.values(ENCOUNTER_STYLES)) {
      if (this.scene.textures.exists(style.barTex)) continue;
      createGradientTexture(this.scene, style.barTex, style.palette, ENCOUNTER_FILL_W, ENCOUNTER_FILL_H);
    }
    ensureEncounterRailTextures(this.scene);

    this.encounterBg = this.scene.add.image(0, 0, ENCOUNTER_BG_TEX).setOrigin(0.5);
    this.encounterFrame = this.scene.add.graphics();
    this.encounterRailGlow = this.scene.add
      .image(ENCOUNTER_RAIL_X, 0, ENCOUNTER_RAIL_GLOW_TEX)
      .setOrigin(0.5)
      .setAlpha(ENCOUNTER_RAIL_GLOW_ALPHA)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.encounterRail = this.scene.add
      .image(ENCOUNTER_RAIL_X, 0, ENCOUNTER_RAIL_TEX)
      .setOrigin(0.5);
    this.encounterPips = this.scene.add.graphics();

    this.encounterKicker = this.scene.add
      .text(ENCOUNTER_CONTENT_LEFT, ENCOUNTER_KICKER_Y, 'ANGRIFFSSERIE', ENCOUNTER_KICKER_FONT)
      .setOrigin(0, 0.5);
    this.encounterStatus = this.scene.add
      .text(ENCOUNTER_CONTENT_LEFT, ENCOUNTER_STATUS_Y, '', ENCOUNTER_STATUS_FONT)
      .setOrigin(0, 0.5);
    this.encounterCountdown = this.scene.add
      .text(ENCOUNTER_CONTENT_RIGHT, ENCOUNTER_STATUS_Y, '', ENCOUNTER_COUNTDOWN_FONT)
      .setOrigin(1, 0.5);

    this.encounterProgressFill = this.scene.add
      .image(ENCOUNTER_CONTENT_LEFT + 1, ENCOUNTER_PROGRESS_Y - ENCOUNTER_FILL_H / 2, ENCOUNTER_STYLES.incoming.barTex)
      .setOrigin(0, 0);
    this.encounterProgressFill.setCrop(0, 0, 0, ENCOUNTER_FILL_H);
    // Laufende Spitze des Balkens: dieselbe Radialtextur wie die Kernpartikel des unteren
    // Stacks, additiv und eingefärbt – sie macht den Fortschritt auch bei 6 px Höhe ablesbar.
    this.encounterProgressHead = this.scene.add
      .image(ENCOUNTER_CONTENT_LEFT, ENCOUNTER_PROGRESS_Y, STACK_CORE_TEX)
      .setOrigin(0.5)
      .setScale(1.6)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);

    this.encounterPanel = this.scene.add.container(ENCOUNTER_PANEL_X, ENCOUNTER_PANEL_Y, [
      this.encounterBg,
      this.encounterFrame,
      this.encounterRailGlow,
      this.encounterRail,
      this.encounterProgressFill,
      this.encounterProgressHead,
      this.encounterPips,
      this.encounterKicker,
      this.encounterStatus,
      this.encounterCountdown,
    ]).setScrollFactor(0).setVisible(false).setAlpha(1);
    this.container.add(this.encounterPanel);
  }

  private buildTutorialPanel(): void {
    this.tutorialGraphics = this.scene.add.graphics();
    this.tutorialTitle = this.scene.add.text(0, TUTORIAL_PAD_TOP, 'TUTORIAL', TUTORIAL_TITLE_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(1);
    this.tutorialBody = this.scene.add.text(0, TUTORIAL_PAD_TOP + TUTORIAL_TITLE_H, '', TUTORIAL_BODY_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(1);

    // Steuerungstabelle: einmal aufgebaut, nur in der Steuerungs-Variante sichtbar.
    // Pro Zeile zwei Text-Objekte statt eines mehrzeiligen Textes, weil Tasten- und
    // Beschreibungsspalte unterschiedliche Schriftgrößen und damit Zeilenhöhen haben.
    const left = -COOP_DEFENSE_TUTORIAL_PANEL_WIDTH / 2;
    this.tutorialControlsHeading = this.scene.add.text(0, TUTORIAL_CONTROLS_TOP, 'STEUERUNG', TUTORIAL_TITLE_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(1);
    this.tutorialControlsTexts = HELP_CONTROLS.flatMap(([key, desc], i) => {
      const y = TUTORIAL_CONTROLS_ROWS_Y + i * COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H
        + COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H / 2;
      return [
        this.scene.add.text(left + COOP_DEFENSE_TUTORIAL_CONTROLS_KEY_X, y, key, TUTORIAL_CONTROLS_KEY_FONT)
          .setOrigin(0, 0.5).setScrollFactor(1),
        this.scene.add.text(left + COOP_DEFENSE_TUTORIAL_CONTROLS_DESC_X, y, desc, TUTORIAL_CONTROLS_DESC_FONT)
          .setOrigin(0, 0.5).setScrollFactor(1),
      ];
    });

    this.tutorialContainer = this.scene.add.container(
      getCoopDefenseTutorialPanelCenterX(),
      COOP_DEFENSE_TUTORIAL_PANEL_TOP_Y,
      [
      this.tutorialGraphics,
      this.tutorialTitle,
      this.tutorialBody,
      this.tutorialControlsHeading,
      ...this.tutorialControlsTexts,
      ],
    );
    // Der übrige CenterHUD liegt auf der scrollfreien Klarheitskamera. Das Tutorial muss
    // dagegen ein Weltobjekt bleiben, damit es beim horizontalen Kamera-Scroll über seiner
    // Felsformation bleibt. Als eigener Root-Container erbt es nicht die Kamera-Maske des HUDs.
    this.tutorialContainer
      .setDepth(DEPTH.OVERLAY - 1)
      .setScrollFactor(1)
      .setVisible(false)
      .setAlpha(0);
  }

  private buildAnnouncementOverlay(): void {
    this.announcementBg = this.scene.add.rectangle(CENTER_X, ANNOUNCEMENT_Y, ANNOUNCEMENT_MIN_W, ANNOUNCEMENT_MIN_H, PANEL_BG_COL, PANEL_BG_ALPHA)
      .setScrollFactor(0)
      .setVisible(false);
    this.announcementText = this.scene.add.text(CENTER_X, ANNOUNCEMENT_Y, '', ANNOUNCEMENT_FONT)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);
    this.announcementContainer = this.scene.add.container(0, 0, [this.announcementBg, this.announcementText]);
    this.announcementContainer.setScrollFactor(0).setVisible(false).setAlpha(1);
    this.container.add(this.announcementContainer);
  }

  private buildTrainWidget(): void {
    this.trainPanelBg = this.scene.add.rectangle(CENTER_X, TRAIN_PANEL_Y, PANEL_WIDTH, TRAIN_PANEL_H, PANEL_BG_COL, PANEL_BG_ALPHA)
      .setScrollFactor(0)
      .setVisible(false);
    this.container.add(this.trainPanelBg);


    this.trainText = this.scene.add.text(CENTER_X, TRAIN_TEXT_Y, '', {
      fontSize: '16px', fontFamily: 'monospace', color: '#c0a060', align: 'center',
      wordWrap: { width: PANEL_WIDTH - 8 },
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setVisible(false);
    this.container.add(this.trainText);

    this.trainBarBg = this.scene.add.image(TRAIN_BAR_LEFT, TRAIN_BAR_TOP, TRAIN_BAR_BG_TEX)
      .setOrigin(0, 0).setScrollFactor(0).setAlpha(TRAIN_BAR_ALPHA).setVisible(false);
    this.container.add(this.trainBarBg);

    this.trainBarFgImg = this.scene.add.image(TRAIN_BAR_LEFT, TRAIN_BAR_TOP, TRAIN_BAR_TEX)
      .setOrigin(0, 0).setScrollFactor(0).setAlpha(TRAIN_BAR_ALPHA).setVisible(false);
    this.trainBarFgImg.setCrop(0, 0, 0, TRAIN_BAR_H);
    this.container.add(this.trainBarFgImg);

    this.trainBarEffect = new LivingBarEffect(
      this.scene,
      this.container,
      TRAIN_BAR_LEFT,
      TRAIN_BAR_TOP,
      TRAIN_BAR_W,
      TRAIN_BAR_H,
      TRAIN_PAL,
      { glowTarget: this.trainBarFgImg, scrollFactor: 0, intensity: TRAIN_BAR_ALPHA },
    );
    // The effect starts with a full emit zone by default, while the train widget
    // itself is hidden until a round actually provides a train.
    this.trainBarEffect.setFilledWidth(0);
    this.trainBarEffect.stop();

    this.trainBarBorder = this.scene.add.rectangle(TRAIN_BAR_LEFT, TRAIN_BAR_TOP, TRAIN_BAR_W, TRAIN_BAR_H)
      .setOrigin(0, 0).setScrollFactor(0)
      .setStrokeStyle(1, 0x5a2010, 0.6)
      .setFillStyle(0, 0)
      .setAlpha(TRAIN_BAR_ALPHA)
      .setVisible(false);
    this.container.add(this.trainBarBorder);
  }

  private buildBottomStack(): void {
    this.armorSection = this.createLowerSection(ARM_BAR_TEX, ARM_PAL);
    this.utilitySection = this.createLowerSection(UTIL_BAR_TEX, UTIL_PAL);
    this.ultimateSection = this.createLowerSection(ULT_BAR_TEX, ULT_PAL);
  }

  private createLowerSection(textureKey: string, palette: LivingBarPalette): LowerBarSection {
    const section = this.scene.add.container(CENTER_X, 0);
    section.setVisible(false).setAlpha(1);

    const panelBg = this.scene.add.rectangle(0, STACK_TOTAL_H / 2, STACK_PANEL_W, STACK_PANEL_H, PANEL_BG_COL, PANEL_BG_ALPHA)
      .setScrollFactor(0);
    const label = this.scene.add.text(0, 0, '', LABEL_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    const bg = this.scene.add.image(STACK_BAR_LEFT, STACK_LABEL_H, STACK_BAR_BG_TEX)
      .setOrigin(0, 0)
      .setScrollFactor(0);
    const fg = this.scene.add.image(STACK_BAR_LEFT, STACK_LABEL_H, textureKey)
      .setOrigin(0, 0)
      .setScrollFactor(0);
    fg.setCrop(0, 0, 0, STACK_BAR_H);
    const border = this.scene.add.rectangle(STACK_BAR_LEFT, STACK_LABEL_H, STACK_BAR_W, STACK_BAR_H)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setStrokeStyle(1, COL_BORDER, 1)
      .setFillStyle(0, 0);

    const energyZone = new Phaser.Geom.Rectangle(STACK_BAR_LEFT + 2, STACK_LABEL_H + 1, STACK_BAR_W - 4, STACK_BAR_H - 2);
    const zoneData = randomEmitZoneData(energyZone as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource);
    const coreEmitter = this.scene.add.particles(0, 0, STACK_CORE_TEX, {
      lifespan:  { min: 200, max: 500 },
      frequency: 30,
      quantity:  2,
      speedX:    { min: -8, max: 8 },
      speedY:    { min: -3, max: 3 },
      scale:     { start: 0.6, end: 0.1 },
      alpha:     { start: 0.9, end: 0 },
      tint:      [palette.light, 0xffffff, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    }).setScrollFactor(0);
    coreEmitter.addEmitZone(zoneData);

    const outerEmitter = this.scene.add.particles(0, 0, '_living_blob', {
      lifespan:  { min: 400, max: 800 },
      frequency: 50,
      quantity:  1,
      speedX:    { min: -5, max: 5 },
      speedY:    { min: -2, max: 2 },
      scale:     { start: 0.7, end: 0.15 },
      alpha:     { start: 0.5, end: 0 },
      tint:      [palette.mid, palette.light, palette.dark],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    }).setScrollFactor(0);
    outerEmitter.addEmitZone(zoneData);

    section.add([panelBg, label, bg, fg]);
    const effect = new LivingBarEffect(
      this.scene,
      section,
      STACK_BAR_LEFT,
      STACK_LABEL_H,
      STACK_BAR_W,
      STACK_BAR_H,
      palette,
      { glowTarget: fg, scrollFactor: 0 },
    );
    section.add([coreEmitter, outerEmitter, border]);
    this.container.add(section);

    return {
      container: section,
      panelBg,
      label,
      bg,
      fg,
      border,
      effect,
      energyZone,
      coreEmitter,
      outerEmitter,
      energized: false,
      glow: null,
      glowTween: null,
      labelTween: null,
      hideTween: null,
      lastWidth: -1,
      lastLabel: null,
    };
  }

  transitionToGame(): void {
    this.container.setVisible(true);
  }

  transitionToLobby(): void {
    this.container.setVisible(false);
    this.hideAnnouncement();
    this.hideEncounterPresentation();
    this.hideTutorial(true);
    this.hideTrainWidget();
    this.hideLowerSection(this.armorSection);
    this.hideLowerSection(this.utilitySection);
    this.hideLowerSection(this.ultimateSection);
    this.stopSectionAttention(this.armorSection);
    this.stopSectionAttention(this.utilitySection);
    this.stopSectionAttention(this.ultimateSection);
    this.utilityRevealUntil = 0;
    this.ultimateRevealUntil = 0;
    this.utilityHeldLastFrame = false;
    this.utilityAttentionActive = false;
    this.ultimateReadyActive = false;
    this.lastTimerText = null;
    this.lastTimerColor = null;
    this.lastSurvivalText = null;
    this.survivalText.setVisible(false);
  }

  setPuContainer(c: Phaser.GameObjects.Container): void {
    this.puContainerRef = c;
  }

  /**
   * @param objectiveLabel Gesetzt: ersetzt die Restzeit durch das offene Rundenziel. Dieselbe
   *   Darstellung wie beim wartenden Boss – kein zusaetzliches Widget.
   */
  updateTimer(secs: number, objectiveLabel: string | null = null): void {
    const mm = Math.floor(secs / 60);
    const ss = secs % 60;
    const nextText = objectiveLabel ?? `${mm}:${ss.toString().padStart(2, '0')}`;
    const nextColor = objectiveLabel ? '#ffd166' : secs <= 10 ? TIMER_COLOR_WARNING : TIMER_COLOR_NORMAL;
    this.timerText.setFontSize(objectiveLabel ? 18 : 32);
    if (nextText !== this.lastTimerText) {
      this.timerText.setText(nextText);
      this.lastTimerText = nextText;
    }
    if (nextColor !== this.lastTimerColor) {
      this.timerText.setColor(nextColor);
      this.lastTimerColor = nextColor;
    }
  }

  /** Kompakter Hinweis nur fuer bewusst migrierte Survival-Maps mit begrenzten Respawns. */
  updateSurvivalStatus(status: CoopDefenseSurvivalPlayerState | null): void {
    if (!status) {
      if (this.survivalText.visible) this.survivalText.setVisible(false);
      this.lastSurvivalText = null;
      return;
    }

    const nextText = status.eliminated
      ? 'AUSGESCHIEDEN'
      : status.alive && status.remainingRespawns === 0
        ? 'LETZTES LEBEN'
        : `RESPAWNS: ${status.remainingRespawns}`;
    if (nextText !== this.lastSurvivalText) {
      this.survivalText.setText(nextText);
      this.lastSurvivalText = nextText;
    }
    this.survivalText
      .setColor(status.eliminated ? '#ff5555' : status.alive && status.remainingRespawns === 0 ? '#ffb347' : '#ffd166')
      .setVisible(true);
  }

  updateEncounterPresentation(
    state: CoopDefenseEncounterPresentationState | null,
    elapsedMs: number,
  ): void {
    if (!state) {
      this.hideEncounterPresentation();
      return;
    }

    const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0;
    const remainingMs = state.phaseEndsAtMs === null
      ? 0
      : Math.max(0, state.phaseEndsAtMs - elapsed);
    const hasCountdown = state.phaseEndsAtMs !== null
      && (state.phase === 'incoming' || state.phase === 'rest');
    // Während des laufenden Angriffs tritt die Gegnerbilanz an die Stelle der Restzeit: Sie ist
    // hier die einzige Größe, die den Fortschritt der Welle tatsächlich beschreibt.
    const kills = state.phase === 'active'
      && typeof state.enemiesTotal === 'number'
      && typeof state.enemiesDefeated === 'number'
      && state.enemiesTotal > 0
      ? { defeated: Phaser.Math.Clamp(state.enemiesDefeated, 0, state.enemiesTotal), total: state.enemiesTotal }
      : null;
    const countdownText = kills
      ? `${kills.defeated} / ${kills.total}`
      : !hasCountdown
        ? ''
        : remainingMs >= 10_000
          ? `${Math.ceil(remainingMs / 1000)}s`
          : `${(remainingMs / 1000).toFixed(1)}s`;
    const statusText = state.phase === 'incoming'
      ? 'ANGRIFF ROLLT AN'
      : state.phase === 'active'
        ? 'ANGRIFF LÄUFT'
        : state.phase === 'cleared'
          ? 'ANGRIFF ABGEWEHRT'
          : state.phase === 'rest'
            ? 'NÄCHSTER ANGRIFF'
            : 'SERIE ABGEWEHRT';
    const styleId = resolveEncounterStyleId(state.phase);
    const style = ENCOUNTER_STYLES[styleId];
    const textSignature = [state.encounterId, state.phase, statusText].join('|');
    const phaseChanged = state.phase !== this.lastEncounterPresentationPhase;

    if (textSignature !== this.lastEncounterPresentationSignature) {
      this.encounterStatus.setText(statusText);
      this.lastEncounterPresentationSignature = textSignature;
    }
    if (countdownText !== this.lastEncounterCountdownText) {
      this.encounterCountdown.setText(countdownText).setVisible(countdownText.length > 0);
      this.lastEncounterCountdownText = countdownText;
    }

    if (styleId !== this.lastEncounterStyleId) {
      this.applyEncounterStyle(style);
      this.lastEncounterStyleId = styleId;
    }
    this.drawEncounterPips(state, style);

    // Nur die Gegnerbilanz oder eine wirklich zeitlich endende Phase darf einen Abschluss
    // behaupten. Für einen offenen active-State ohne belastbare Gegnerzuordnung bleibt die
    // Leiste voll gedimmt und bekommt stattdessen einen wandernden Lichtimpuls.
    const indeterminate = state.phase === 'active' && kills === null;
    const progress = indeterminate
      ? 1
      : kills
        ? kills.defeated / kills.total
        : state.phaseEndsAtMs === null
          ? 1
          : Phaser.Math.Clamp(
            (elapsed - state.phaseStartedAtMs) / Math.max(1, state.phaseEndsAtMs - state.phaseStartedAtMs),
            0,
            1,
          );
    const determinate = !indeterminate
      && (kills !== null || (state.phaseEndsAtMs !== null && state.phase !== 'active'));
    const fillW = Math.round(ENCOUNTER_FILL_W * progress);
    if (fillW !== this.lastEncounterProgressWidth) {
      this.encounterProgressFill.setCrop(0, 0, fillW, ENCOUNTER_FILL_H);
      this.lastEncounterProgressWidth = fillW;
    }
    if (determinate !== this.lastEncounterDeterminate) {
      this.encounterProgressFill.setAlpha(determinate ? 1 : 0.32);
      this.lastEncounterDeterminate = determinate;
    }
    if (indeterminate) {
      const scanRange = Math.max(1, ENCOUNTER_FILL_W - ENCOUNTER_SCAN_INSET_PX * 2);
      const scanPhase = 0.5 + 0.5 * Math.sin((elapsed / ENCOUNTER_SCAN_PERIOD_MS) * Math.PI * 2);
      this.encounterProgressHead.setX(
        ENCOUNTER_CONTENT_LEFT + 1 + ENCOUNTER_SCAN_INSET_PX + scanPhase * scanRange,
      );
    } else {
      this.encounterProgressHead.setX(ENCOUNTER_CONTENT_LEFT + 1 + fillW);
    }
    this.encounterProgressHead.setVisible(
      indeterminate || (determinate && fillW > 4 && fillW < ENCOUNTER_FILL_W),
    );

    if (phaseChanged || !this.encounterPanel.visible) {
      this.playEncounterPhaseEntry(state.phase);
    }
    this.lastEncounterPresentationPhase = state.phase;
  }

  /** Farbführende Teile des Panels. Läuft nur beim Wechsel der Phasenfarbe. */
  private applyEncounterStyle(style: EncounterStyle): void {
    this.encounterRail.setTint(style.accent);
    this.encounterRailGlow.setTint(style.accent);
    this.encounterStatus.setColor(toCssColor(style.accent));
    this.encounterCountdown.setColor(toCssColor(style.accent));
    this.encounterKicker.setColor(toCssColor(style.muted));
    this.encounterProgressFill.setTexture(style.barTex);
    this.encounterProgressFill.setCrop(0, 0, Math.max(0, this.lastEncounterProgressWidth), ENCOUNTER_FILL_H);
    this.encounterProgressHead.setTint(style.accent);

    const frame = this.encounterFrame;
    frame.clear();
    frame.lineStyle(1.5, style.accent, 0.5);
    frame.strokeRoundedRect(
      ENCOUNTER_PANEL_LEFT + 1,
      ENCOUNTER_PANEL_TOP + 1,
      ENCOUNTER_PANEL_W - 2,
      ENCOUNTER_PANEL_H - 2,
      ENCOUNTER_PANEL_RADIUS,
    );
    frame.fillStyle(COLORS.GREY_9, 0.9);
    frame.fillRoundedRect(
      ENCOUNTER_CONTENT_LEFT,
      ENCOUNTER_PROGRESS_Y - ENCOUNTER_PROGRESS_H / 2,
      ENCOUNTER_PROGRESS_W,
      ENCOUNTER_PROGRESS_H,
      ENCOUNTER_PROGRESS_H / 2,
    );
    frame.lineStyle(1, style.accent, 0.28);
    frame.strokeRoundedRect(
      ENCOUNTER_CONTENT_LEFT,
      ENCOUNTER_PROGRESS_Y - ENCOUNTER_PROGRESS_H / 2,
      ENCOUNTER_PROGRESS_W,
      ENCOUNTER_PROGRESS_H,
      ENCOUNTER_PROGRESS_H / 2,
    );
  }

  /**
   * Wellenposition als Segmentleiste. Sie ersetzt die frühere doppelte Zahlenangabe:
   * abgewehrt, laufend und ausstehend sind an Farbe und Deckkraft unterscheidbar.
   */
  private drawEncounterPips(state: CoopDefenseEncounterPresentationState, style: EncounterStyle): void {
    const count = Math.max(1, Math.floor(state.sequenceCount));
    const isDone = state.phase === 'cleared' || state.phase === 'complete';
    const clearedCount = state.phase === 'complete'
      ? count
      : isDone
        ? state.sequenceIndex
        : state.sequenceIndex - 1;
    const currentIndex = isDone ? -1 : state.sequenceIndex - 1;
    const signature = `${count}|${clearedCount}|${currentIndex}|${style.accent}`;
    if (signature === this.lastEncounterPipSignature) return;
    this.lastEncounterPipSignature = signature;

    this.encounterPips.clear();
    if (count > ENCOUNTER_PIP_MAX) {
      // Zu viele Wellen für eine zählbare Leiste – die Position wandert dann in den Kicker.
      this.encounterKicker.setText(`ANGRIFF ${Math.min(state.sequenceIndex, count)} / ${count}`);
      return;
    }
    this.encounterKicker.setText(formatEncounterFronts(state.fronts));

    const totalW = count * ENCOUNTER_PIP_W + (count - 1) * ENCOUNTER_PIP_GAP;
    const startX = ENCOUNTER_CONTENT_RIGHT - totalW;
    const top = ENCOUNTER_KICKER_Y - ENCOUNTER_PIP_H / 2;
    for (let index = 0; index < count; index += 1) {
      const x = startX + index * (ENCOUNTER_PIP_W + ENCOUNTER_PIP_GAP);
      if (index === currentIndex) {
        this.encounterPips.fillStyle(style.accent, 0.22);
        this.encounterPips.fillRoundedRect(x - 2, top - 2, ENCOUNTER_PIP_W + 4, ENCOUNTER_PIP_H + 4, 4);
        this.encounterPips.fillStyle(style.accent, 1);
      } else if (index < clearedCount) {
        this.encounterPips.fillStyle(style.accent, 0.75);
      } else {
        this.encounterPips.fillStyle(COLORS.GREY_6, 0.7);
      }
      this.encounterPips.fillRoundedRect(x, top, ENCOUNTER_PIP_W, ENCOUNTER_PIP_H, 2);
    }
  }

  /**
   * Auftritt bei Phasenwechsel. Der Container sitzt auf der Panelmitte und trägt lokal
   * platzierte Kinder – ein Skalierungs-Tween wächst hier deshalb um die eigene Mitte.
   */
  private playEncounterPhaseEntry(phase: CoopDefenseEncounterPresentationState['phase']): void {
    this.encounterTween?.destroy();
    this.encounterPanel
      .setPosition(ENCOUNTER_PANEL_X, ENCOUNTER_PANEL_Y + 8)
      .setScale(0.97)
      .setVisible(true)
      .setAlpha(0);
    this.encounterTween = this.scene.tweens.add({
      targets: this.encounterPanel,
      alpha: 1,
      y: ENCOUNTER_PANEL_Y,
      scaleX: 1,
      scaleY: 1,
      duration: ENCOUNTER_FADE_MS,
      ease: 'Back.easeOut',
      onComplete: () => { this.encounterTween = null; },
    });

    this.encounterPulseTween?.destroy();
    this.encounterPulseTween = null;
    this.encounterRailGlow.setScale(1, 1).setAlpha(ENCOUNTER_RAIL_GLOW_ALPHA);
    if (phase !== 'incoming' && phase !== 'cleared') return;
    // Nur die beiden kurzen Signalphasen atmen. Ein Dauerpuls während des Angriffs
    // würde neben den Kampfeffekten nur flimmern.
    this.encounterPulseTween = this.scene.tweens.add({
      targets: this.encounterRailGlow,
      scaleX: 1.7,
      alpha: ENCOUNTER_RAIL_GLOW_ALPHA * 0.42,
      duration: phase === 'incoming' ? 340 : 480,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private hideEncounterPresentation(): void {
    this.encounterTween?.destroy();
    this.encounterTween = null;
    this.encounterPulseTween?.destroy();
    this.encounterPulseTween = null;
    this.encounterPanel
      ?.setVisible(false)
      .setAlpha(1)
      .setScale(1)
      .setPosition(ENCOUNTER_PANEL_X, ENCOUNTER_PANEL_Y);
    this.encounterRailGlow?.setScale(1, 1).setAlpha(ENCOUNTER_RAIL_GLOW_ALPHA);
    this.lastEncounterPresentationSignature = null;
    this.lastEncounterPresentationPhase = null;
    this.lastEncounterStyleId = null;
    this.lastEncounterPipSignature = null;
    this.lastEncounterProgressWidth = -1;
    this.lastEncounterCountdownText = null;
    this.lastEncounterDeterminate = null;
  }

  /**
   * @param showControls True: Unter dem Fließtext erscheint die Steuerungstabelle des
   *   Hilfe-Fensters; das Fenster wächst entsprechend (Einstiegs-Map).
   */
  updateTutorial(text: string | null, showControls = false): void {
    this.tutorialContainer.setPosition(
      getCoopDefenseTutorialPanelCenterX(),
      COOP_DEFENSE_TUTORIAL_PANEL_TOP_Y,
    );
    const nextText = text?.trim() || null;
    if (nextText === this.tutorialValue && showControls === this.tutorialControlsValue) return;
    this.tutorialValue = nextText;
    this.tutorialControlsValue = showControls;
    this.tutorialTween?.destroy();
    this.tutorialTween = null;

    if (!nextText) {
      this.hideTutorial(false);
      return;
    }

    this.tutorialBody.setText(nextText);
    this.tutorialControlsHeading.setVisible(showControls);
    for (const entry of this.tutorialControlsTexts) entry.setVisible(showControls);

    const width = COOP_DEFENSE_TUTORIAL_PANEL_WIDTH;
    const height = getCoopDefenseTutorialPanelHeight(showControls);
    const left = -width / 2;

    this.tutorialGraphics.clear();
    this.tutorialGraphics.fillStyle(0x000000, 0.24);
    this.tutorialGraphics.fillRoundedRect(left + 4, 4, width, height, 12);
    this.tutorialGraphics.fillStyle(TUTORIAL_BG_COLOR, 0.78);
    this.tutorialGraphics.fillRoundedRect(left, 0, width, height, 12);
    this.tutorialGraphics.lineStyle(2, TUTORIAL_ACCENT, 0.72);
    this.tutorialGraphics.strokeRoundedRect(left, 0, width, height, 12);

    if (showControls) {
      // Trennlinie unter der Überschrift + Zeilen-Alternierung wie im Hilfe-Fenster.
      this.tutorialGraphics.fillStyle(TUTORIAL_ACCENT, 0.55);
      this.tutorialGraphics.fillRect(left + TUTORIAL_PAD_X, TUTORIAL_CONTROLS_SEP_Y, width - TUTORIAL_PAD_X * 2, 1);
      this.tutorialGraphics.fillStyle(COLORS.GREY_8, 0.3);
      for (let i = 0; i < HELP_CONTROLS.length; i += 2) {
        this.tutorialGraphics.fillRect(
          left + TUTORIAL_PAD_X,
          TUTORIAL_CONTROLS_ROWS_Y + i * COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H + 2,
          width - TUTORIAL_PAD_X * 2,
          COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H - 4,
        );
      }
    }

    this.tutorialContainer.setVisible(true).setAlpha(0);
    this.tutorialTween = this.scene.tweens.add({
      targets: this.tutorialContainer,
      alpha: 1,
      duration: TUTORIAL_FADE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => { this.tutorialTween = null; },
    });
  }

  /** @param arrivalTimerSecs Verbleibende Sekunden bis zur nächsten Einfahrt. */
  setTrainArrival(arrivalTimerSecs: number): void {
    const nextText = formatTrainArrivalLabel(arrivalTimerSecs);
    if (this.lastTrainText !== nextText) {
      this.trainText.setText(nextText);
      this.lastTrainText = nextText;
    }
    if (this.lastTrainMode !== 'arrival') {
      this.trainPanelBg.setVisible(true);
      this.trainText.setVisible(true);
      this.hideTrainBar();
      this.lastTrainMode = 'arrival';
      this.lastTrainBarWidth = -1;
    }
  }

  updateTrainHP(hp: number, maxHp: number): void {
    const ratio = maxHp > 0 ? Math.max(0, hp / maxHp) : 0;
    const nextText = 'RB 54';
    if (this.lastTrainText !== nextText) {
      this.trainText.setText(nextText);
      this.lastTrainText = nextText;
    }
    if (this.lastTrainMode !== 'hp') {
      this.trainPanelBg.setVisible(true);
      this.trainText.setVisible(true);
      this.trainBarBg.setVisible(true);
      this.trainBarFgImg.setVisible(true);
      this.trainBarBorder.setVisible(true);
      this.trainBarEffect.start();
      this.lastTrainMode = 'hp';
    }
    const fillW = Math.max(0, Math.round(TRAIN_BAR_W * ratio));
    if (this.lastTrainBarWidth !== fillW) {
      this.trainBarFgImg.setCrop(0, 0, fillW, TRAIN_BAR_H);
      this.trainBarEffect.setFilledWidth(fillW);
      this.lastTrainBarWidth = fillW;
    }
  }

  showTrainDestroyed(): void {
    const nextText = 'RB 54 fällt\nheute leider aus';
    if (this.lastTrainText !== nextText) {
      this.trainText.setText(nextText);
      this.lastTrainText = nextText;
    }
    if (this.lastTrainMode !== 'destroyed') {
      this.trainPanelBg.setVisible(true);
      this.trainText.setVisible(true);
      this.hideTrainBar();
      this.lastTrainMode = 'destroyed';
      this.lastTrainBarWidth = -1;
    }
  }

  hideTrainWidget(): void {
    this.trainPanelBg.setVisible(false);
    this.trainText.setVisible(false);
    this.hideTrainBar();
    this.lastTrainMode = 'hidden';
    this.lastTrainBarWidth = -1;
    this.lastTrainText = null;
  }

  updateBottomStatus(data: ArenaHUDData, utilityHeld: boolean): void {
    const now = this.scene.time.now;
    if (utilityHeld) {
      this.utilityHeldLastFrame = true;
    } else if (this.utilityHeldLastFrame) {
      this.utilityHeldLastFrame = false;
      this.utilityRevealUntil = now + STACK_REVEAL_MS;
    }

    const showUtility = utilityHeld
      || data.utilityCooldownFrac > 0.001
      || now < this.utilityRevealUntil
      || (data.isUtilityOverridden ?? false);
    const isUltimateReady = data.isUltimateActive || data.rage >= data.ultimateRequiredRage;
    const showUltimate = isUltimateReady || now < this.ultimateRevealUntil;
    const showArmor = data.armor > 0;

    let nextBottom = GAME_HEIGHT - STACK_MARGIN;

    if (showUltimate) {
      this.showLowerSection(
        this.ultimateSection,
        `Ultimate: ${data.ultimateDisplayName ?? 'Ultimate'}`,
        Phaser.Math.Clamp(data.rage / Math.max(1, data.maxRage), 0, 1),
        CENTER_X,
        nextBottom - STACK_TOTAL_H,
      );
      this.setUltimateReadyVisual(isUltimateReady);
      nextBottom = this.ultimateSection.container.y - STACK_GAP;
    } else {
      this.setUltimateReadyVisual(false);
      this.hideLowerSection(this.ultimateSection);
    }

    if (showUtility) {
      this.showLowerSection(
        this.utilitySection,
        `Utility: ${data.utilityDisplayName ?? 'Utility'}`,
        Phaser.Math.Clamp(1 - data.utilityCooldownFrac, 0, 1),
        CENTER_X,
        nextBottom - STACK_TOTAL_H,
      );
      this.setUtilityAttention(data.isUtilityOverridden ?? false);
      nextBottom = this.utilitySection.container.y - STACK_GAP;
    } else {
      this.setUtilityAttention(false);
      this.hideLowerSection(this.utilitySection);
    }

    if (showArmor) {
      this.showLowerSection(
        this.armorSection,
        `Armor: ${Math.round(data.armor)}/${Math.round(data.maxArmor)}`,
        Phaser.Math.Clamp(data.armor / Math.max(1, data.maxArmor), 0, 1),
        CENTER_X,
        nextBottom - STACK_TOTAL_H,
      );
      nextBottom = this.armorSection.container.y - STACK_GAP;
    } else {
      this.hideLowerSection(this.armorSection);
    }

    this.layoutPowerUps(nextBottom);
  }

  flashUtilityCooldown(_frac: number, _displayName: string): void {
    this.utilityRevealUntil = Math.max(this.utilityRevealUntil, this.scene.time.now + STACK_REVEAL_MS);
  }

  flashUltimateInsufficientRage(): void {
    this.ultimateRevealUntil = Math.max(this.ultimateRevealUntil, this.scene.time.now + ULTIMATE_REVEAL_MS);
  }

  showAnnouncement(text: string, color: string | number = ANNOUNCEMENT_TEXT_COLOR): void {
    this.announcementTween?.destroy();
    this.announcementTween = null;
    this.announcementText.setText(text);
    this.announcementText.setColor(typeof color === 'number' ? toCssColor(color) : color);

    const width = Math.max(
      ANNOUNCEMENT_MIN_W,
      Math.min(ANNOUNCEMENT_MAX_TEXT_W + ANNOUNCEMENT_PAD_X * 2, this.announcementText.width + ANNOUNCEMENT_PAD_X * 2),
    );
    const height = Math.max(ANNOUNCEMENT_MIN_H, this.announcementText.height + ANNOUNCEMENT_PAD_Y * 2);
    this.announcementBg.setSize(width, height);

    this.announcementContainer.setAlpha(1).setVisible(true);
    this.announcementBg.setVisible(true);
    this.announcementText.setVisible(true);

    this.announcementTween = this.scene.tweens.add({
      targets: this.announcementContainer,
      alpha: 0,
      delay: ANNOUNCEMENT_HOLD_MS,
      duration: ANNOUNCEMENT_FADE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => this.hideAnnouncement(),
    });
  }

  showFraggedBy(killerName: string, weapon: string, color: number): void {
    this.showAnnouncement(`Fragged by ${killerName} (${weapon})`, color);
  }

  showYouFragged(victimName: string, color: number): void {
    this.showAnnouncement(`You Fragged ${victimName}`, color);
  }

  showBeerCaptured(playerName: string, color: number): void {
    this.showAnnouncement(`${playerName} captured the Beer!`, color);
  }

  destroy(): void {
    this.hideAnnouncement();
    this.hideEncounterPresentation();
    this.hideTutorial(true);
    this.trainBarEffect.destroy();
    this.stopSectionAttention(this.armorSection);
    this.stopSectionAttention(this.utilitySection);
    this.stopSectionAttention(this.ultimateSection);
    this.armorSection.effect.destroy();
    this.utilitySection.effect.destroy();
    this.ultimateSection.effect.destroy();
    this.armorSection.coreEmitter.destroy();
    this.armorSection.outerEmitter.destroy();
    this.utilitySection.coreEmitter.destroy();
    this.utilitySection.outerEmitter.destroy();
    this.ultimateSection.coreEmitter.destroy();
    this.ultimateSection.outerEmitter.destroy();
    this.container.destroy(true);
  }

  private showLowerSection(section: LowerBarSection, label: string, frac: number, x: number, y: number): void {
    const fillW = Math.max(0, Math.round(STACK_BAR_W * Phaser.Math.Clamp(frac, 0, 1)));
    if (section.hideTween) {
      section.hideTween.destroy();
      section.hideTween = null;
    }
    section.container.setPosition(x, y).setVisible(true).setAlpha(1);
    section.panelBg.setVisible(true);
    section.bg.setVisible(true);
    section.fg.setVisible(true);
    section.border.setVisible(true);
    if (section.lastLabel !== label) {
      section.label.setText(label);
      section.lastLabel = label;
    }
    section.label.setVisible(true);
    if (section.lastWidth !== fillW) {
      section.fg.setCrop(0, 0, fillW, STACK_BAR_H);
      section.effect.setFilledWidth(fillW);
      section.energyZone.width = fillW > 6 ? fillW - 4 : 0;
      section.lastWidth = fillW;
    }
    if (fillW <= 6) {
      section.coreEmitter.stop();
      section.outerEmitter.stop();
      if (!section.energized) section.effect.stop();
    } else {
      if (section.energized) {
        if (!section.coreEmitter.emitting) section.coreEmitter.start();
        if (!section.outerEmitter.emitting) section.outerEmitter.start();
      } else {
        section.effect.start();
      }
    }
  }

  private hideLowerSection(section: LowerBarSection): void {
    if (!section.container.visible || section.hideTween) return;
    section.hideTween = this.scene.tweens.add({
      targets: section.container,
      alpha: 0,
      duration: STACK_FADE_MS,
      ease: 'Linear',
      onComplete: () => {
        section.hideTween = null;
        section.container.setVisible(false).setAlpha(1);
        section.effect.stop();
        section.coreEmitter.stop();
        section.outerEmitter.stop();
        section.lastWidth = -1;
      },
    });
  }

  private layoutPowerUps(nextBottom: number): void {
    if (!this.puContainerRef?.visible) return;
    const stackHeight = Number(this.puContainerRef.getData('stackHeight') ?? 0);
    this.puContainerRef.setY(nextBottom - stackHeight);
  }

  private setUtilityAttention(enabled: boolean): void {
    if (enabled === this.utilityAttentionActive) return;
    this.utilityAttentionActive = enabled;
    this.setSectionEnergized(this.utilitySection, enabled);
    if (enabled) {
      this.utilitySection.glow = addExternalGlow(this.utilitySection.fg, UTIL_PAL.light, 3, 0, false, 0.4, 8);
      if (this.utilitySection.glow) {
        this.utilitySection.glowTween = this.scene.tweens.add({
          targets: this.utilitySection.glow,
          outerStrength: 8,
          duration: 400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
      this.utilitySection.labelTween = this.scene.tweens.add({
        targets: this.utilitySection.label,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      return;
    }
    this.stopSectionAttention(this.utilitySection);
  }

  private setUltimateReadyVisual(enabled: boolean): void {
    if (enabled === this.ultimateReadyActive) return;
    this.ultimateReadyActive = enabled;
    this.setSectionEnergized(this.ultimateSection, enabled);
    if (enabled) {
      this.ultimateSection.glow = addExternalGlow(this.ultimateSection.fg, 0xff3300, 4, 0, false, 0.3, 10);
      if (this.ultimateSection.glow) {
        this.ultimateSection.glowTween = this.scene.tweens.add({
          targets: this.ultimateSection.glow,
          outerStrength: 8,
          duration: 800,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
      return;
    }
    this.stopSectionAttention(this.ultimateSection);
  }

  private stopSectionAttention(section: LowerBarSection): void {
    if (section.labelTween) {
      section.labelTween.destroy();
      section.labelTween = null;
      section.label.setScale(1);
    }
    if (section.glowTween) {
      section.glowTween.destroy();
      section.glowTween = null;
    }
    if (section.glow) {
      removeExternalFx(section.fg, section.glow);
      section.glow = null;
    }
  }

  private setSectionEnergized(section: LowerBarSection, energized: boolean): void {
    if (section.energized === energized) return;
    section.energized = energized;
    const hasFill = section.lastWidth > 6;
    if (energized) {
      section.effect.stop();
      if (hasFill) {
        section.coreEmitter.start();
        section.outerEmitter.start();
      }
      return;
    }

    section.coreEmitter.stop();
    section.outerEmitter.stop();
    if (section.container.visible && hasFill) section.effect.start();
  }

  private hideTrainBar(): void {
    this.trainBarBg.setVisible(false);
    this.trainBarFgImg.setVisible(false);
    this.trainBarBorder.setVisible(false);
    this.trainBarEffect.stop();
  }

  private hideAnnouncement(): void {
    this.announcementTween?.destroy();
    this.announcementTween = null;
    this.announcementContainer.setVisible(false).setAlpha(1);
    this.announcementBg.setVisible(false);
    this.announcementText.setVisible(false);
  }

  private hideTutorial(immediate: boolean): void {
    this.tutorialTween?.destroy();
    this.tutorialTween = null;
    this.tutorialValue = null;
    if (immediate || !this.tutorialContainer.visible) {
      this.tutorialContainer.setVisible(false).setAlpha(0);
      return;
    }
    this.tutorialTween = this.scene.tweens.add({
      targets: this.tutorialContainer,
      alpha: 0,
      duration: TUTORIAL_FADE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.tutorialTween = null;
        this.tutorialContainer.setVisible(false).setAlpha(0);
      },
    });
  }
}
