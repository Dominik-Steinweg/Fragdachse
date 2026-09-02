/**
 * CenterHUD – feste UI-Elemente in der Bildschirmmitte.
 *
 * Enthält Timer (oben mittig), RB54-Widget (direkt darunter) und
 * den unteren Stack für Power-Ups, Utility und Ultimate.
 */
import * as Phaser from 'phaser';
import { ARMOR_COLOR, GAME_WIDTH, GAME_HEIGHT, DEPTH, COLORS, toCssColor } from '../config';
import { getUtilityHudDisplayName, type ArenaHUDData } from './ArenaHUD';
import type { CoopDefenseEncounterPresentationState } from '../types';
import type { CoopDefenseLifeStatusViewModel } from './coopDefenseLifeStatusModel';
import {
  rgbStr,
  type LivingBarPalette,
  ensureLivingBarTextures, createGradientTexture, LivingBarEffect,
} from './LivingBarEffect';
import { addExternalGlow, removeExternalFx, type GlowHandle } from '../utils/phaserFx';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { formatTrainArrivalLabel } from '../train/TrainEvent';
import { formatNumber, getLocale, t } from '../i18n';
import { getContentDisplayName, getSourceName } from '../i18n/contentPresentation';
import {
  COOP_DEFENSE_TUTORIAL_CONTROLS_BODY_H,
  COOP_DEFENSE_TUTORIAL_CONTROLS_DESC_X,
  COOP_DEFENSE_TUTORIAL_CONTROLS_HEADING_H,
  COOP_DEFENSE_TUTORIAL_CONTROLS_KEY_X,
  COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H,
  COOP_DEFENSE_TUTORIAL_PAD_TOP,
  COOP_DEFENSE_TUTORIAL_PAD_X,
  COOP_DEFENSE_TUTORIAL_PANEL_WIDTH,
  COOP_DEFENSE_TUTORIAL_TITLE_H,
  getCoopDefenseTutorialPanelCenterX,
  getCoopDefenseTutorialPanelHeight,
  getCoopDefenseTutorialPanelTopY,
  type CoopDefenseTutorialAnchor,
} from '../config/coopDefenseTutorial';
import { HELP_CONTROLS } from '../config/helpControls';
import { ensureFlatPanelTexture, roundRectPath } from './uiTextures';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import type { MainObjectiveViewModel } from './coopDefenseMainObjectiveModel';
import type { CoopDefenseObjectiveAnnouncement } from './CoopDefenseObjectiveAnnouncement';
import {
  COOP_DEFENSE_ENCOUNTER_LAYOUT,
  COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT,
} from './CoopDefenseSecondaryObjectiveLayout';
import {
  BOTTOM_STACK_BAR_H,
  BOTTOM_STACK_BAR_LEFT,
  BOTTOM_STACK_BAR_W,
  BOTTOM_STACK_GAP,
  BOTTOM_STACK_LABEL_FONT,
  BOTTOM_STACK_LABEL_H,
  BOTTOM_STACK_PANEL_H,
  BOTTOM_STACK_PANEL_W,
  BOTTOM_STACK_TOTAL_H,
} from './BottomStackLayout';
import {
  advanceHudOcclusionFade,
  createHudOcclusionFadeState,
  type HudOcclusionRect,
  resetHudOcclusionFade,
} from './hudOcclusionFade';
import { doHudRectsOverlap, getWorldRectOnScreen, isHudRectOccluded } from './hudOcclusionProbe';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';

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
const TUTORIAL_OCCLUSION_MARGIN_PX = 6;
const TUTORIAL_OCCLUSION_FADE = {
  minAlpha: 0.02,
  fadeOutMs: 90,
  fadeInMs: 520,
  holdMs: 260,
} as const;
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
const TOP_PANEL_FADE_TEX = '_center_top_panel_fade';
const TIMER_PANEL_FADE_TEX = '_center_timer_panel_fade';
const TOP_PANEL_W       = PANEL_WIDTH + 28;
const TOP_PANEL_TOP     = TIMER_Y - TIMER_BG_H / 2;
const TOP_PANEL_BOTTOM  = TRAIN_PANEL_Y + TRAIN_PANEL_H / 2;
const TOP_PANEL_H       = TOP_PANEL_BOTTOM - TOP_PANEL_TOP;
const TOP_PANEL_Y       = (TOP_PANEL_TOP + TOP_PANEL_BOTTOM) / 2;

// ── Encounter-Panel ──────────────────────────────────────────────────────────
// Anzeige der Coop-Defense-Angriffsserie. Die Wellenposition trägt die Pip-Leiste,
// die Phase die Statuszeile, die Restzeit der eigene Countdown – jede Information
// steht damit genau einmal im Panel.
const ENCOUNTER_PANEL_W = COOP_DEFENSE_ENCOUNTER_LAYOUT.width;
const ENCOUNTER_PANEL_H = COOP_DEFENSE_ENCOUNTER_LAYOUT.height;
const ENCOUNTER_PANEL_X = COOP_DEFENSE_ENCOUNTER_LAYOUT.centerX;
const ENCOUNTER_PANEL_TOP_Y = COOP_DEFENSE_ENCOUNTER_LAYOUT.topY;
const ENCOUNTER_PANEL_Y = ENCOUNTER_PANEL_TOP_Y + ENCOUNTER_PANEL_H / 2;

/**
 * Lage des Pflichtziel-Panels. Exportiert, damit sich das Nebenziel-Panel daran ausrichten
 * kann, statt dieselben Zahlen ein zweites Mal zu führen – die beiden bilden bewusst eine
 * gemeinsame Zeile am oberen Rand.
 */
export const ENCOUNTER_PANEL_LAYOUT = {
  ...COOP_DEFENSE_ENCOUNTER_LAYOUT,
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
const ENCOUNTER_ANNOUNCEMENT_PRIORITY = 100;
const ENCOUNTER_START_ANNOUNCEMENT_HOLD_MS = 900;
const ENCOUNTER_RESULT_ANNOUNCEMENT_HOLD_MS = 1_200;

// ── Hauptziel-Panel ─────────────────────────────────────────────────────────
const MAIN_PANEL_W = COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT.width;
const MAIN_PANEL_H = COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT.height;
const MAIN_PANEL_X = COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT.centerX;
const MAIN_PANEL_Y = COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT.topY + MAIN_PANEL_H / 2;
const MAIN_PANEL_LEFT = -MAIN_PANEL_W / 2;
const MAIN_PANEL_TOP = -MAIN_PANEL_H / 2;
const MAIN_PANEL_RADIUS = 9;
const MAIN_CONTENT_LEFT = MAIN_PANEL_LEFT + 20;
const MAIN_CONTENT_RIGHT = -MAIN_PANEL_LEFT - 18;
const MAIN_KICKER_Y = MAIN_PANEL_TOP + 15;
const MAIN_TITLE_Y = MAIN_PANEL_TOP + 35;
const MAIN_PROGRESS_Y = MAIN_PANEL_TOP + 53;
const MAIN_PROGRESS_H = 6;
const MAIN_PROGRESS_W = MAIN_CONTENT_RIGHT - MAIN_CONTENT_LEFT;
const MAIN_FILL_H = MAIN_PROGRESS_H - 2;
const MAIN_FILL_W = MAIN_PROGRESS_W - 2;
const MAIN_BG_TEX = '_center_main_objective_bg';
const MAIN_BAR_TEX = '_center_main_objective_bar';
const MAIN_ENTRY_SCALE = 0.42;

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
    accent: COLORS.PURPLE_2,
    muted: COLORS.PURPLE_4,
    palette: { dark: COLORS.PURPLE_6, mid: COLORS.PURPLE_3, light: COLORS.PURPLE_1 },
    barTex: '_center_encounter_bar_incoming',
  },
  active: {
    accent: COLORS.PURPLE_2,
    muted: COLORS.PURPLE_4,
    palette: { dark: COLORS.PURPLE_6, mid: COLORS.PURPLE_3, light: COLORS.PURPLE_1 },
    barTex: '_center_encounter_bar_active',
  },
  done: {
    accent: COLORS.GREEN_2,
    muted: COLORS.GREEN_4,
    palette: { dark: 0x1d3a1a, mid: COLORS.GREEN_3, light: COLORS.GREEN_1 },
    barTex: '_center_encounter_bar_done',
  },
  rest: {
    accent: COLORS.PURPLE_3,
    muted: COLORS.PURPLE_4,
    palette: { dark: COLORS.PURPLE_6, mid: COLORS.PURPLE_4, light: COLORS.PURPLE_2 },
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
    west: t('ui.direction.west'),
    north: t('ui.direction.north'),
    east: t('ui.direction.east'),
    south: t('ui.direction.south'),
  } as Record<string, string>)[front] ?? t('ui.direction.west'));
  return labels.length > 1 ? labels.join(' + ') : labels[0] ?? t('ui.direction.west');
}

function formatEncounterLabel(
  sequenceIndex: number,
  sequenceCount: number,
  fronts: readonly string[] | undefined,
): string {
  const count = Math.max(1, Math.floor(sequenceCount));
  const index = Math.min(count, Math.max(1, Math.floor(sequenceIndex)));
  return t('ui.encounter.waveLabel', { index, count, fronts: formatEncounterFronts(fronts) });
}

const STACK_MARGIN     = 20;
const STACK_REVEAL_MS  = 500;
const ULTIMATE_REVEAL_MS = 850;
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
const MAIN_KICKER_FONT = {
  fontSize: '11px', fontFamily: 'monospace', fontStyle: 'bold',
  color: toCssColor(COLORS.GOLD_3), letterSpacing: 2,
};
const MAIN_TITLE_FONT = {
  fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GOLD_1),
};
const MAIN_PROGRESS_FONT = {
  fontSize: '14px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GOLD_2),
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

/** Bildschirmfeste HUD-Fläche mit weichem Alpha-Auslauf an allen Außenkanten. */
function ensureFadedPanelTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  fillAlpha: number,
): void {
  if (scene.textures.exists(key)) return;
  const ct = scene.textures.createCanvas(key, width, height);
  if (!ct) return;

  const ctx = ct.context;
  const edgeX = Math.min(14, width * 0.12);
  const edgeY = Math.min(5, height * 0.16);
  ctx.clearRect(0, 0, width, height);

  const body = ctx.createLinearGradient(0, 0, 0, height);
  body.addColorStop(0, `rgba(0,0,0,${fillAlpha * 0.88})`);
  body.addColorStop(0.5, `rgba(0,0,0,${fillAlpha})`);
  body.addColorStop(1, `rgba(0,0,0,${fillAlpha * 0.92})`);
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, width, height);

  // Maske zuerst horizontal, dann vertikal anwenden: dadurch entstehen keine harten
  // Rechteckkanten und die gemeinsame Fläche bleibt zwischen Timer und Zug durchgehend.
  ctx.globalCompositeOperation = 'destination-in';
  const horizontal = ctx.createLinearGradient(0, 0, width, 0);
  horizontal.addColorStop(0, 'rgba(0,0,0,0)');
  horizontal.addColorStop(edgeX / width, 'rgba(0,0,0,0.78)');
  horizontal.addColorStop(Math.min(0.2, (edgeX * 2) / width), 'rgba(0,0,0,1)');
  horizontal.addColorStop(Math.max(0.8, 1 - (edgeX * 2) / width), 'rgba(0,0,0,1)');
  horizontal.addColorStop(1 - edgeX / width, 'rgba(0,0,0,0.78)');
  horizontal.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, width, height);

  const vertical = ctx.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, 'rgba(0,0,0,0)');
  vertical.addColorStop(edgeY / height, 'rgba(0,0,0,0.82)');
  vertical.addColorStop(Math.min(0.2, (edgeY * 2) / height), 'rgba(0,0,0,1)');
  vertical.addColorStop(Math.max(0.8, 1 - (edgeY * 2) / height), 'rgba(0,0,0,1)');
  vertical.addColorStop(1 - edgeY / height, 'rgba(0,0,0,0.82)');
  vertical.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
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

  private timerPanelBg!: Phaser.GameObjects.Image;
  private topPanelBg!: Phaser.GameObjects.Image;
  private timerText!: Phaser.GameObjects.Text;
  private lifeStatusText!: Phaser.GameObjects.Text;
  private tutorialContainer!: Phaser.GameObjects.Container;
  private tutorialLifecycleContainer!: Phaser.GameObjects.Container;
  private tutorialGraphics!: Phaser.GameObjects.Graphics;
  private tutorialTitle!: Phaser.GameObjects.Text;
  private tutorialBody!: Phaser.GameObjects.Text;
  private tutorialControlsHeading!: Phaser.GameObjects.Text;
  private tutorialControlsTexts: Phaser.GameObjects.Text[] = [];
  private tutorialTween: Phaser.Tweens.Tween | null = null;
  private readonly tutorialOcclusionFade = createHudOcclusionFadeState();
  private tutorialValue: string | null = null;
  private tutorialControlsValue = false;
  private tutorialStepContainer!: Phaser.GameObjects.Container;
  private tutorialStepLifecycleContainer!: Phaser.GameObjects.Container;
  private tutorialStepGraphics!: Phaser.GameObjects.Graphics;
  private tutorialStepTitle!: Phaser.GameObjects.Text;
  private tutorialStepBody!: Phaser.GameObjects.Text;
  private tutorialStepTween: Phaser.Tweens.Tween | null = null;
  private tutorialStepValue: string | null = null;
  private announcementContainer!: Phaser.GameObjects.Container;
  private announcementBg!: Phaser.GameObjects.Rectangle;
  private announcementText!: Phaser.GameObjects.Text;
  private announcementTween: Phaser.Tweens.Tween | null = null;
  /** Trägt Hauptziel- und Angriffsserien-Panel; weicht als Ganzes vor dem Spielfeld zurück. */
  private missionStack!: Phaser.GameObjects.Container;
  private readonly missionStackFade = createHudOcclusionFadeState();
  private mainObjectivePanel!: Phaser.GameObjects.Container;
  private mainObjectiveBg!: Phaser.GameObjects.Image;
  private mainObjectiveFrame!: Phaser.GameObjects.Graphics;
  private mainObjectiveFill!: Phaser.GameObjects.Image;
  private mainObjectiveHead!: Phaser.GameObjects.Image;
  private mainObjectiveKicker!: Phaser.GameObjects.Text;
  private mainObjectiveTitle!: Phaser.GameObjects.Text;
  private mainObjectiveProgress!: Phaser.GameObjects.Text;
  private mainObjectiveTween: Phaser.Tweens.Tween | null = null;
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
  private lastLifeStatusText: string | null = null;
  private lastMainObjectiveId: string | null = null;
  private lastMainObjectiveSignature: string | null = null;
  private lastMainObjectiveProgressWidth = -1;
  private mainObjectiveAnnouncementPending = false;
  private lastEncounterPresentationId: string | null = null;
  private lastEncounterPresentationSignature: string | null = null;
  private lastEncounterPresentationPhase: CoopDefenseEncounterPresentationState['phase'] | null = null;
  private lastEncounterStyleId: EncounterStyleId | null = null;
  private lastEncounterPipSignature: string | null = null;
  private lastEncounterProgressWidth = -1;
  private lastEncounterCountdownText: string | null = null;
  private lastEncounterDeterminate: boolean | null = null;
  private encounterAnnouncementHandsOver = false;
  private currentEncounterAnnouncementId: string | null = null;
  private currentEncounterAnnouncementPhase: CoopDefenseEncounterPresentationState['phase'] | null = null;
  private readonly announcedEncounterStarts = new Set<string>();
  private readonly announcedEncounterResults = new Set<string>();
  private lastTrainText: string | null = null;
  private lastTrainBarWidth = -1;
  private lastTrainMode: 'hidden' | 'arrival' | 'hp' | 'destroyed' = 'hidden';
  private utilityRevealUntil = 0;
  private ultimateRevealUntil = 0;
  private utilityHeldLastFrame = false;
  private utilityAttentionActive = false;
  private ultimateReadyActive = false;

  private objectiveAnnouncements: CoopDefenseObjectiveAnnouncement | null = null;

  constructor(private scene: Phaser.Scene) {}

  setObjectiveAnnouncements(announcements: CoopDefenseObjectiveAnnouncement | null): void {
    this.objectiveAnnouncements = announcements;
  }

  build(): void {
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(DEPTH.OVERLAY - 1);
    this.container.setVisible(false);
    promoteToClarityCamera(this.scene, this.container);

    ensureLivingBarTextures(this.scene);
    ensureFadedPanelTexture(this.scene, TIMER_PANEL_FADE_TEX, TOP_PANEL_W, TIMER_BG_H, 0.35);
    ensureFadedPanelTexture(this.scene, TOP_PANEL_FADE_TEX, TOP_PANEL_W, TOP_PANEL_H, 0.3);
    ensureBarBgTexture(this.scene, TRAIN_BAR_BG_TEX, TRAIN_BAR_W, TRAIN_BAR_H);
    ensureBarBgTexture(this.scene, STACK_BAR_BG_TEX, BOTTOM_STACK_BAR_W, BOTTOM_STACK_BAR_H);
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
      createGradientTexture(this.scene, UTIL_BAR_TEX, UTIL_PAL, BOTTOM_STACK_BAR_W, BOTTOM_STACK_BAR_H);
    }
    if (!this.scene.textures.exists(ARM_BAR_TEX)) {
      createGradientTexture(this.scene, ARM_BAR_TEX, ARM_PAL, BOTTOM_STACK_BAR_W, BOTTOM_STACK_BAR_H);
    }
    if (!this.scene.textures.exists(ULT_BAR_TEX)) {
      createGradientTexture(this.scene, ULT_BAR_TEX, ULT_PAL, BOTTOM_STACK_BAR_W, BOTTOM_STACK_BAR_H);
    }

    this.buildTimer();
    // Eigene Zwischenebene für die beiden Missionspanels: Ihre Auftritts-Tweens schreiben ihr
    // eigenes Alpha, das Ausweichen vor dem Spielfeld liegt deshalb eine Ebene darüber und
    // multipliziert sich damit, statt es abzubrechen.
    this.missionStack = this.scene.add.container(0, 0);
    this.container.add(this.missionStack);
    this.buildMainObjectivePanel();
    this.buildEncounterPanel();
    this.buildTutorialPanel();
    this.buildTutorialStepPanel();
    this.buildAnnouncementOverlay();
    this.buildTrainWidget();
    this.buildBottomStack();
  }

  private buildTimer(): void {
    this.timerPanelBg = this.scene.add.image(CENTER_X, TIMER_Y, TIMER_PANEL_FADE_TEX)
      .setScrollFactor(0);
    this.topPanelBg = this.scene.add.image(CENTER_X, TOP_PANEL_Y, TOP_PANEL_FADE_TEX)
      .setScrollFactor(0)
      .setVisible(false);
    this.timerText = this.scene.add.text(CENTER_X, TIMER_Y, '2:00', {
      fontSize: '32px', fontFamily: 'monospace', color: TIMER_COLOR_NORMAL, fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0);
    this.lifeStatusText = this.scene.add.text(CENTER_X + PANEL_WIDTH / 2 + 18, TIMER_Y, '', {
      fontSize: '14px', fontFamily: 'monospace', color: '#ffd166', fontStyle: 'bold',
    }).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);
    this.container.add([this.timerPanelBg, this.topPanelBg, this.timerText, this.lifeStatusText]);
  }

  private buildMainObjectivePanel(): void {
    ensureFlatPanelTexture(
      this.scene,
      MAIN_BG_TEX,
      MAIN_PANEL_W,
      MAIN_PANEL_H,
      COLORS.GREY_8,
      COLORS.GREY_6,
      { radius: MAIN_PANEL_RADIUS, fillAlpha: 0.88, strokeAlpha: 0.42 },
    );
    if (!this.scene.textures.exists(MAIN_BAR_TEX)) {
      createGradientTexture(
        this.scene,
        MAIN_BAR_TEX,
        { dark: 0x4d3210, mid: COLORS.GOLD_2, light: COLORS.GOLD_1 },
        MAIN_FILL_W,
        MAIN_FILL_H,
      );
    }

    this.mainObjectiveBg = this.scene.add.image(0, 0, MAIN_BG_TEX).setOrigin(0.5);
    this.mainObjectiveFrame = this.scene.add.graphics();
    registerGraphicsObject(this.scene, 'gameplayHud', this.mainObjectiveFrame);
    this.mainObjectiveFill = this.scene.add.image(
      MAIN_CONTENT_LEFT + 1,
      MAIN_PROGRESS_Y - MAIN_FILL_H / 2,
      MAIN_BAR_TEX,
    ).setOrigin(0, 0);
    this.mainObjectiveFill.setCrop(0, 0, 0, MAIN_FILL_H);
    this.mainObjectiveHead = this.scene.add.image(MAIN_CONTENT_LEFT, MAIN_PROGRESS_Y, STACK_CORE_TEX)
      .setOrigin(0.5)
      .setScale(1.45)
      .setTint(COLORS.GOLD_1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    this.mainObjectiveKicker = this.scene.add.text(
      MAIN_CONTENT_LEFT,
      MAIN_KICKER_Y,
      'HAUPTZIEL',
      MAIN_KICKER_FONT,
    ).setOrigin(0, 0.5);
    this.mainObjectiveTitle = this.scene.add.text(
      MAIN_CONTENT_LEFT,
      MAIN_TITLE_Y,
      '',
      MAIN_TITLE_FONT,
    ).setOrigin(0, 0.5);
    this.mainObjectiveProgress = this.scene.add.text(
      MAIN_CONTENT_RIGHT,
      MAIN_TITLE_Y,
      '',
      MAIN_PROGRESS_FONT,
    ).setOrigin(1, 0.5);

    this.mainObjectiveFrame.lineStyle(1.5, COLORS.GOLD_2, 0.54);
    this.mainObjectiveFrame.strokeRoundedRect(
      MAIN_PANEL_LEFT + 1,
      MAIN_PANEL_TOP + 1,
      MAIN_PANEL_W - 2,
      MAIN_PANEL_H - 2,
      MAIN_PANEL_RADIUS,
    );
    this.mainObjectiveFrame.fillStyle(COLORS.GREY_9, 0.9);
    this.mainObjectiveFrame.fillRoundedRect(
      MAIN_CONTENT_LEFT,
      MAIN_PROGRESS_Y - MAIN_PROGRESS_H / 2,
      MAIN_PROGRESS_W,
      MAIN_PROGRESS_H,
      MAIN_PROGRESS_H / 2,
    );
    this.mainObjectiveFrame.lineStyle(1, COLORS.GOLD_2, 0.3);
    this.mainObjectiveFrame.strokeRoundedRect(
      MAIN_CONTENT_LEFT,
      MAIN_PROGRESS_Y - MAIN_PROGRESS_H / 2,
      MAIN_PROGRESS_W,
      MAIN_PROGRESS_H,
      MAIN_PROGRESS_H / 2,
    );

    this.mainObjectivePanel = this.scene.add.container(MAIN_PANEL_X, MAIN_PANEL_Y, [
      this.mainObjectiveBg,
      this.mainObjectiveFrame,
      this.mainObjectiveFill,
      this.mainObjectiveHead,
      this.mainObjectiveKicker,
      this.mainObjectiveTitle,
      this.mainObjectiveProgress,
    ]).setScrollFactor(0).setVisible(false);
    this.missionStack.add(this.mainObjectivePanel);
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
    registerGraphicsObject(this.scene, 'gameplayHud', this.encounterFrame);
    this.encounterRailGlow = this.scene.add
      .image(ENCOUNTER_RAIL_X, 0, ENCOUNTER_RAIL_GLOW_TEX)
      .setOrigin(0.5)
      .setAlpha(ENCOUNTER_RAIL_GLOW_ALPHA)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.encounterRail = this.scene.add
      .image(ENCOUNTER_RAIL_X, 0, ENCOUNTER_RAIL_TEX)
      .setOrigin(0.5);
    this.encounterPips = this.scene.add.graphics();
    registerGraphicsObject(this.scene, 'gameplayHud', this.encounterPips);

    this.encounterKicker = this.scene.add
      .text(ENCOUNTER_CONTENT_LEFT, ENCOUNTER_KICKER_Y, t('ui.encounter.series'), ENCOUNTER_KICKER_FONT)
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
    this.missionStack.add(this.encounterPanel);
  }

  private buildTutorialPanel(): void {
    this.tutorialGraphics = this.scene.add.graphics();
    registerGraphicsObject(this.scene, 'gameplayHud', this.tutorialGraphics);
    this.tutorialTitle = this.scene.add.text(0, TUTORIAL_PAD_TOP, t('ui.help.title'), TUTORIAL_TITLE_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(1);
    this.tutorialBody = this.scene.add.text(0, TUTORIAL_PAD_TOP + TUTORIAL_TITLE_H, '', TUTORIAL_BODY_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(1);

    // Steuerungstabelle: einmal aufgebaut, nur in der Steuerungs-Variante sichtbar.
    // Pro Zeile zwei Text-Objekte statt eines mehrzeiligen Textes, weil Tasten- und
    // Beschreibungsspalte unterschiedliche Schriftgrößen und damit Zeilenhöhen haben.
    const left = -COOP_DEFENSE_TUTORIAL_PANEL_WIDTH / 2;
    this.tutorialControlsHeading = this.scene.add.text(0, TUTORIAL_CONTROLS_TOP, t('ui.help.heading'), TUTORIAL_TITLE_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(1);
    this.tutorialControlsTexts = HELP_CONTROLS.flatMap((entry, i) => {
      const y = TUTORIAL_CONTROLS_ROWS_Y + i * COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H
        + COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H / 2;
      return [
        this.scene.add.text(left + COOP_DEFENSE_TUTORIAL_CONTROLS_KEY_X, y, t(entry.keyId), TUTORIAL_CONTROLS_KEY_FONT)
          .setOrigin(0, 0.5).setScrollFactor(1),
        this.scene.add.text(left + COOP_DEFENSE_TUTORIAL_CONTROLS_DESC_X, y, t(entry.descriptionKey), TUTORIAL_CONTROLS_DESC_FONT)
          .setOrigin(0, 0.5).setScrollFactor(1),
      ];
    });

    this.tutorialLifecycleContainer = this.scene.add.container(0, 0, [
      this.tutorialGraphics,
      this.tutorialTitle,
      this.tutorialBody,
      this.tutorialControlsHeading,
      ...this.tutorialControlsTexts,
    ]).setScrollFactor(1).setAlpha(0);
    this.tutorialContainer = this.scene.add.container(
      getCoopDefenseTutorialPanelCenterX(),
      getCoopDefenseTutorialPanelTopY(),
      [this.tutorialLifecycleContainer],
    );
    // Der übrige CenterHUD liegt auf der scrollfreien Klarheitskamera. Das Tutorial muss
    // dagegen ein Weltobjekt bleiben, damit es beim horizontalen Kamera-Scroll über seiner
    // Felsformation bleibt. Als eigener Root-Container erbt es nicht die Kamera-Maske des HUDs.
    this.tutorialContainer
      .setDepth(DEPTH.OVERLAY - 1)
      .setScrollFactor(1)
      .setVisible(false)
      .setAlpha(1);
  }

  private buildTutorialStepPanel(): void {
    this.tutorialStepGraphics = this.scene.add.graphics();
    registerGraphicsObject(this.scene, 'gameplayHud', this.tutorialStepGraphics);
    this.tutorialStepTitle = this.scene.add.text(0, TUTORIAL_PAD_TOP, t('ui.help.title'), TUTORIAL_TITLE_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(1);
    this.tutorialStepBody = this.scene.add.text(0, TUTORIAL_PAD_TOP + TUTORIAL_TITLE_H, '', TUTORIAL_BODY_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(1);
    this.tutorialStepLifecycleContainer = this.scene.add.container(0, 0, [
      this.tutorialStepGraphics,
      this.tutorialStepTitle,
      this.tutorialStepBody,
    ]).setScrollFactor(1).setAlpha(0);
    this.tutorialStepContainer = this.scene.add.container(
      getCoopDefenseTutorialPanelCenterX(),
      getCoopDefenseTutorialPanelTopY(),
      [this.tutorialStepLifecycleContainer],
    );
    this.tutorialStepContainer
      .setDepth(DEPTH.OVERLAY - 1)
      .setScrollFactor(1)
      .setVisible(false)
      .setAlpha(1);
  }

  private buildAnnouncementOverlay(): void {
    this.announcementBg = this.scene.add.rectangle(CENTER_X, ANNOUNCEMENT_Y, ANNOUNCEMENT_MIN_W, ANNOUNCEMENT_MIN_H, PANEL_BG_COL, PANEL_BG_ALPHA)
      .setScrollFactor(0)
      .setVisible(false);
    registerGraphicsObject(this.scene, 'gameplayHud', this.announcementBg);
    this.announcementText = this.scene.add.text(CENTER_X, ANNOUNCEMENT_Y, '', ANNOUNCEMENT_FONT)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);
    this.announcementContainer = this.scene.add.container(0, 0, [this.announcementBg, this.announcementText]);
    this.announcementContainer.setScrollFactor(0).setVisible(false).setAlpha(1);
    this.container.add(this.announcementContainer);
  }

  private buildTrainWidget(): void {
    this.trainText = this.scene.add.text(CENTER_X, TRAIN_TEXT_Y, '', {
      fontSize: '13px', fontFamily: 'monospace', color: '#c0a060', align: 'center',
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
    registerGraphicsObject(this.scene, 'gameplayHud', this.trainBarBorder);
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

    const panelBg = this.scene.add.rectangle(0, BOTTOM_STACK_TOTAL_H / 2, BOTTOM_STACK_PANEL_W, BOTTOM_STACK_PANEL_H, PANEL_BG_COL, PANEL_BG_ALPHA)
      .setScrollFactor(0);
    registerGraphicsObject(this.scene, 'gameplayHud', panelBg);
    const label = this.scene.add.text(0, 0, '', BOTTOM_STACK_LABEL_FONT)
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    const bg = this.scene.add.image(BOTTOM_STACK_BAR_LEFT, BOTTOM_STACK_LABEL_H, STACK_BAR_BG_TEX)
      .setOrigin(0, 0)
      .setScrollFactor(0);
    const fg = this.scene.add.image(BOTTOM_STACK_BAR_LEFT, BOTTOM_STACK_LABEL_H, textureKey)
      .setOrigin(0, 0)
      .setScrollFactor(0);
    fg.setCrop(0, 0, 0, BOTTOM_STACK_BAR_H);
    const border = this.scene.add.rectangle(BOTTOM_STACK_BAR_LEFT, BOTTOM_STACK_LABEL_H, BOTTOM_STACK_BAR_W, BOTTOM_STACK_BAR_H)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setStrokeStyle(1, COL_BORDER, 1)
      .setFillStyle(0, 0);
    registerGraphicsObject(this.scene, 'gameplayHud', border);

    section.add([panelBg, label, bg, fg]);
    const effect = new LivingBarEffect(
      this.scene,
      section,
      BOTTOM_STACK_BAR_LEFT,
      BOTTOM_STACK_LABEL_H,
      BOTTOM_STACK_BAR_W,
      BOTTOM_STACK_BAR_H,
      palette,
      { glowTarget: fg, scrollFactor: 0 },
    );
    section.add(border);
    this.container.add(section);

    return {
      container: section,
      panelBg,
      label,
      bg,
      fg,
      border,
      effect,
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
    // Der eigentliche Rundentimer wird erst ab `isArenaStarted()` synchronisiert. Bis dahin
    // darf der Build-Default (2:00) nicht als bereits laufender Spieltimer erscheinen.
    this.timerPanelBg.setVisible(false);
    this.timerText.setVisible(false);
    this.topPanelBg.setVisible(false);
  }

  transitionToLobby(): void {
    this.container.setVisible(false);
    this.resetCoopMissionPresentation();
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
  }

  /**
   * Clears only Activity-scoped Coop presentation. The CenterHUD itself remains scene-lifetime
   * infrastructure and can immediately serve the next World or Activity.
   */
  resetCoopMissionPresentation(): void {
    this.objectiveAnnouncements?.reset();
    this.announcedEncounterStarts.clear();
    this.announcedEncounterResults.clear();
    this.encounterAnnouncementHandsOver = false;
    this.hideAnnouncement();
    this.hideMainObjectivePresentation(true);
    this.hideEncounterPresentation();
    this.hideTutorial(true);
    this.hideTutorialStep(true);
    if (this.missionStack) {
      resetHudOcclusionFade(this.missionStackFade);
      this.missionStack.setAlpha(1);
    }
    this.lastLifeStatusText = null;
    this.lifeStatusText.setVisible(false);
  }

  setPuContainer(c: Phaser.GameObjects.Container): void {
    this.puContainerRef = c;
  }

  updateTimer(secs: number, visible = true): void {
    this.timerText.setVisible(visible);
    this.timerPanelBg.setVisible(visible);
    if (!visible) return;
    const mm = Math.floor(secs / 60);
    const ss = secs % 60;
    const nextText = `${mm}:${ss.toString().padStart(2, '0')}`;
    const nextColor = secs <= 10 ? TIMER_COLOR_WARNING : TIMER_COLOR_NORMAL;
    this.timerText.setFontSize(32);
    if (nextText !== this.lastTimerText) {
      this.timerText.setText(nextText);
      this.lastTimerText = nextText;
    }
    if (nextColor !== this.lastTimerColor) {
      this.timerText.setColor(nextColor);
      this.lastTimerColor = nextColor;
    }
  }

  /**
   * Kompakte Lebens-/Rueckkehrzeile neben dem Timer. Jede Map mit authored Respawn-Budget
   * fuellt sie; welcher Text erscheint, entscheidet allein das Anzeigemodell.
   */
  updateLifeStatus(model: CoopDefenseLifeStatusViewModel | null): void {
    if (!model) {
      if (this.lifeStatusText.visible) this.lifeStatusText.setVisible(false);
      this.lastLifeStatusText = null;
      return;
    }

    if (model.text !== this.lastLifeStatusText) {
      this.lifeStatusText.setText(model.text);
      this.lastLifeStatusText = model.text;
    }
    this.lifeStatusText.setColor(model.color).setVisible(true);
  }

  updateMainObjectivePresentation(model: MainObjectiveViewModel | null): void {
    if (!model) {
      this.hideMainObjectivePresentation(false);
      return;
    }

    const objectiveChanged = model.id !== this.lastMainObjectiveId;
    const signature = `${model.id}|${model.title}|${model.progressLabel}|${model.progress.toFixed(4)}`;
    if (signature !== this.lastMainObjectiveSignature) {
      this.mainObjectiveProgress.setText(model.progressLabel);
      const availableTitleWidth = Math.max(
        80,
        MAIN_CONTENT_RIGHT - MAIN_CONTENT_LEFT - this.mainObjectiveProgress.width - 14,
      );
      this.mainObjectiveTitle.setFontSize(18).setText(model.title);
      if (this.mainObjectiveTitle.width > availableTitleWidth) this.mainObjectiveTitle.setFontSize(15);

      const fillW = Math.round(MAIN_FILL_W * Phaser.Math.Clamp(model.progress, 0, 1));
      if (fillW !== this.lastMainObjectiveProgressWidth) {
        this.mainObjectiveFill.setCrop(0, 0, fillW, MAIN_FILL_H);
        this.mainObjectiveHead
          .setX(MAIN_CONTENT_LEFT + 1 + fillW)
          .setVisible(fillW > 4 && fillW < MAIN_FILL_W);
        this.lastMainObjectiveProgressWidth = fillW;
      }
      this.lastMainObjectiveSignature = signature;
    }

    if (objectiveChanged) {
      this.lastMainObjectiveId = model.id;
      this.mainObjectiveAnnouncementPending = this.objectiveAnnouncements !== null;
      this.mainObjectivePanel.setVisible(false);
      if (this.objectiveAnnouncements) {
        this.objectiveAnnouncements.enqueue({
          id: `main:${model.id}`,
          kicker: 'HAUPTZIEL',
          title: model.title,
          detail: model.progressLabel,
          tone: 'main',
          target: { x: MAIN_PANEL_X, y: MAIN_PANEL_Y, scale: MAIN_ENTRY_SCALE },
          onStart: () => {
            this.mainObjectiveAnnouncementPending = true;
            if (this.mainObjectivePanel?.active) this.mainObjectivePanel.setVisible(false);
          },
          onArrive: () => {
            this.mainObjectiveAnnouncementPending = false;
            if (this.mainObjectivePanel?.active && this.lastMainObjectiveId === model.id) {
              this.playMainObjectiveEntry(MAIN_ENTRY_SCALE);
            }
          },
        });
      } else {
        this.mainObjectiveAnnouncementPending = false;
        this.playMainObjectiveEntry(1);
      }
      return;
    }

    if (!this.mainObjectiveAnnouncementPending && !this.mainObjectivePanel.visible) {
      this.playMainObjectiveEntry(1);
    }
  }

  private playMainObjectiveEntry(fromScale: number): void {
    this.mainObjectiveTween?.destroy();
    this.mainObjectivePanel
      .setPosition(MAIN_PANEL_X, MAIN_PANEL_Y + (fromScale < 1 ? 0 : 7))
      .setScale(fromScale < 1 ? fromScale : 0.97)
      .setVisible(true)
      .setAlpha(0);
    this.mainObjectiveTween = this.scene.tweens.add({
      targets: this.mainObjectivePanel,
      alpha: 1,
      y: MAIN_PANEL_Y,
      scaleX: 1,
      scaleY: 1,
      duration: fromScale < 1 ? 260 : 180,
      ease: 'Back.easeOut',
      onComplete: () => { this.mainObjectiveTween = null; },
    });
  }

  private hideMainObjectivePresentation(resetRound: boolean): void {
    if (!resetRound && !this.lastMainObjectiveId && !this.mainObjectivePanel?.visible) return;
    this.mainObjectiveTween?.destroy();
    this.mainObjectiveTween = null;
    this.mainObjectivePanel?.setVisible(false).setAlpha(1).setScale(1).setPosition(MAIN_PANEL_X, MAIN_PANEL_Y);
    this.lastMainObjectiveId = null;
    this.lastMainObjectiveSignature = null;
    this.lastMainObjectiveProgressWidth = -1;
    this.mainObjectiveAnnouncementPending = false;
  }

  /**
   * Pro Frame: Hauptziel- und Angriffsserien-Panel weichen gemeinsam zurück, sobald unter der
   * rechten Spalte gekämpft oder gezielt wird. Gemeinsam, weil eine halb durchsichtige Spalte
   * über einer deckenden aussähe wie ein Darstellungsfehler.
   */
  updateMissionStackOcclusion(
    deltaMs: number,
    playerManager: PlayerManager | null,
    enemyManager: EnemyManager | null,
  ): void {
    if (!this.missionStack) return;
    const mainVisible = this.mainObjectivePanel?.visible === true;
    const encounterVisible = this.encounterPanel?.visible === true;
    if (!mainVisible && !encounterVisible) {
      resetHudOcclusionFade(this.missionStackFade);
      this.missionStack.setAlpha(1);
      return;
    }

    const occluded = isHudRectOccluded(this.scene, {
      left: MAIN_PANEL_X - MAIN_PANEL_W / 2,
      right: MAIN_PANEL_X + MAIN_PANEL_W / 2,
      top: mainVisible ? COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT.topY : ENCOUNTER_PANEL_TOP_Y,
      bottom: encounterVisible
        ? ENCOUNTER_PANEL_TOP_Y + ENCOUNTER_PANEL_H
        : COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT.topY + MAIN_PANEL_H,
    }, playerManager, enemyManager);
    this.missionStack.setAlpha(advanceHudOcclusionFade(this.missionStackFade, occluded, deltaMs));
  }

  /** Screen-Space-Flächen, die das World-Space-Tutorial nicht überdecken darf. */
  getReservedHudRects(): readonly HudOcclusionRect[] {
    const rects: HudOcclusionRect[] = [];
    const announcementRect = this.objectiveAnnouncements?.getReservedHudRect();
    if (announcementRect) rects.push(announcementRect);

    const addPanelRect = (
      panel: Phaser.GameObjects.Container | undefined,
      width: number,
      height: number,
    ): void => {
      if (!panel?.visible) return;
      rects.push({
        left: panel.x - width * panel.scaleX / 2,
        right: panel.x + width * panel.scaleX / 2,
        top: panel.y - height * panel.scaleY / 2,
        bottom: panel.y + height * panel.scaleY / 2,
      });
    };

    addPanelRect(this.mainObjectivePanel, MAIN_PANEL_W, MAIN_PANEL_H);
    addPanelRect(this.encounterPanel, ENCOUNTER_PANEL_W, ENCOUNTER_PANEL_H);
    return rects;
  }

  /**
   * Aktualisiert die temporäre Verdeckung in einer eigenen Alpha-Ebene. Der Welt-Root bleibt
   * an seiner Position; nur seine Sichtbarkeit wird gegen die aktuellen Screen-Flächen geprüft.
   */
  updateTutorialOcclusion(
    deltaMs: number,
    reservedHudRects: readonly HudOcclusionRect[],
  ): void {
    const tutorialRects = this.getTutorialScreenRects();
    if (tutorialRects.length === 0) {
      resetHudOcclusionFade(this.tutorialOcclusionFade);
      if (this.tutorialContainer?.active) this.tutorialContainer.setAlpha(1);
      if (this.tutorialStepContainer?.active) this.tutorialStepContainer.setAlpha(1);
      return;
    }

    const occluded = tutorialRects.some((tutorialRect) => reservedHudRects.some((reservedRect) => (
      doHudRectsOverlap(tutorialRect, reservedRect, TUTORIAL_OCCLUSION_MARGIN_PX)
    )));
    const alpha = advanceHudOcclusionFade(
      this.tutorialOcclusionFade,
      occluded,
      deltaMs,
      TUTORIAL_OCCLUSION_FADE,
    );
    this.tutorialContainer.setAlpha(alpha);
    this.tutorialStepContainer.setAlpha(alpha);
  }

  /** Aktuelle sichtbare Panel-Fläche des Tutorials in Design-Screen-Koordinaten. */
  getTutorialScreenRect(): HudOcclusionRect | null {
    return this.getTutorialScreenRectForContainer(this.tutorialContainer, this.tutorialControlsValue);
  }

  private getTutorialScreenRects(): HudOcclusionRect[] {
    return [
      this.getTutorialScreenRectForContainer(this.tutorialContainer, this.tutorialControlsValue),
      this.getTutorialScreenRectForContainer(this.tutorialStepContainer, false),
    ].filter((rect): rect is HudOcclusionRect => rect !== null);
  }

  private getTutorialScreenRectForContainer(
    container: Phaser.GameObjects.Container | undefined,
    showControls: boolean,
  ): HudOcclusionRect | null {
    if (!container?.visible) return null;
    const camera = this.scene.cameras?.main;
    if (!camera) return null;
    const width = COOP_DEFENSE_TUTORIAL_PANEL_WIDTH;
    const height = getCoopDefenseTutorialPanelHeight(showControls);
    return getWorldRectOnScreen({
      left: container.x - width / 2,
      right: container.x + width / 2,
      top: container.y,
      bottom: container.y + height,
    }, camera);
  }

  updateEncounterPresentation(
    state: CoopDefenseEncounterPresentationState | null,
    elapsedMs: number,
  ): void {
    if (!state) {
      this.currentEncounterAnnouncementId = null;
      this.currentEncounterAnnouncementPhase = null;
      this.hideEncounterPresentation();
      return;
    }

    this.currentEncounterAnnouncementId = state.encounterId;
    this.currentEncounterAnnouncementPhase = state.phase;
    this.queueEncounterAnnouncements(state);

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
          ? t('ui.encounter.countdownSeconds', { seconds: formatNumber(Math.ceil(remainingMs / 1000), getLocale(), { useGrouping: false }) })
          : t('ui.encounter.countdownSeconds', { seconds: formatNumber(remainingMs / 1000, getLocale(), { maximumFractionDigits: 1, useGrouping: false }) });
    const statusText = t(
      state.phase === 'incoming'
        ? 'ui.encounter.status.incoming'
        : state.phase === 'active'
          ? 'ui.encounter.status.active'
          : state.phase === 'cleared'
            ? 'ui.encounter.status.cleared'
            : state.phase === 'rest'
              ? 'ui.encounter.status.rest'
              : 'ui.encounter.status.complete',
    );
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

    if (!this.encounterAnnouncementHandsOver && (phaseChanged || !this.encounterPanel.visible)) {
      this.playEncounterPhaseEntry(state.phase);
    }
    this.lastEncounterPresentationId = state.encounterId;
    this.lastEncounterPresentationPhase = state.phase;
  }

  private queueEncounterAnnouncements(state: CoopDefenseEncounterPresentationState): void {
    if (!this.objectiveAnnouncements) return;
    const isStarting = state.phase === 'incoming' || state.phase === 'active';
    if (isStarting && !this.announcedEncounterStarts.has(state.encounterId)) {
      this.announcedEncounterStarts.add(state.encounterId);
      const targetId = state.encounterId;
      this.objectiveAnnouncements.enqueue({
        id: `wave:start:${targetId}`,
        topic: 'wave',
        priority: ENCOUNTER_ANNOUNCEMENT_PRIORITY,
        kicker: t('ui.encounter.waveKicker', { index: state.sequenceIndex, count: state.sequenceCount }),
        title: t('ui.encounter.attackFrom', { fronts: formatEncounterFronts(state.encounterFronts) }),
        detail: t('ui.encounter.prepare'),
        tone: 'wave',
        holdMs: ENCOUNTER_START_ANNOUNCEMENT_HOLD_MS,
        isRelevant: () => this.currentEncounterAnnouncementId === targetId
          && (this.currentEncounterAnnouncementPhase === 'incoming'
            || this.currentEncounterAnnouncementPhase === 'active'),
        target: { x: ENCOUNTER_PANEL_X, y: ENCOUNTER_PANEL_Y, scale: 0.42 },
        onStart: () => {
          this.encounterAnnouncementHandsOver = true;
          if (this.encounterPanel?.active) this.encounterPanel.setVisible(false);
        },
        onArrive: () => {
          this.encounterAnnouncementHandsOver = false;
          if (this.encounterPanel?.active && this.lastEncounterPresentationId === targetId) {
            this.playEncounterPhaseEntry(this.lastEncounterPresentationPhase ?? state.phase);
          }
        },
        onCancel: () => {
          this.encounterAnnouncementHandsOver = false;
        },
      });
    }

    const isResult = state.phase === 'cleared' || state.phase === 'complete';
    const resultKey = `${state.encounterId}:${state.phase}`;
    if (isResult && !this.announcedEncounterResults.has(resultKey)) {
      this.announcedEncounterResults.add(resultKey);
      this.objectiveAnnouncements.enqueue({
        id: `wave:result:${resultKey}`,
        topic: 'wave',
        priority: ENCOUNTER_ANNOUNCEMENT_PRIORITY,
        kicker: state.phase === 'complete'
          ? t('ui.encounter.series')
          : t('ui.encounter.waveKicker', { index: state.sequenceIndex, count: state.sequenceCount }),
        title: state.phase === 'complete' ? t('ui.encounter.allWavesCleared') : t('ui.encounter.waveCleared'),
        tone: 'positive',
        holdMs: ENCOUNTER_RESULT_ANNOUNCEMENT_HOLD_MS,
        isRelevant: () => this.currentEncounterAnnouncementId === state.encounterId
          && (this.currentEncounterAnnouncementPhase === 'cleared'
            || this.currentEncounterAnnouncementPhase === 'complete'),
      });
    }
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
    const signature = `${count}|${clearedCount}|${currentIndex}|${style.accent}|${state.encounterFronts.join(',')}`;
    if (signature === this.lastEncounterPipSignature) return;
    this.lastEncounterPipSignature = signature;

    this.encounterPips.clear();
    if (count > ENCOUNTER_PIP_MAX) {
      // Zu viele Wellen für eine zählbare Leiste – die Position wandert dann in den Kicker.
      this.encounterKicker.setText(formatEncounterLabel(state.sequenceIndex, count, state.encounterFronts));
      return;
    }
    this.encounterKicker.setText(formatEncounterLabel(state.sequenceIndex, count, state.encounterFronts));

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
    this.encounterAnnouncementHandsOver = false;
    this.currentEncounterAnnouncementId = null;
    this.currentEncounterAnnouncementPhase = null;
    this.lastEncounterPresentationSignature = null;
    this.lastEncounterPresentationId = null;
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
  updateTutorial(
    text: string | null,
    showControls = false,
    anchor?: CoopDefenseTutorialAnchor,
  ): void {
    this.tutorialContainer.setPosition(
      getCoopDefenseTutorialPanelCenterX(anchor),
      getCoopDefenseTutorialPanelTopY(anchor),
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

    this.drawTutorialPanel(this.tutorialGraphics, showControls, width, height);

    this.tutorialContainer.setVisible(true).setAlpha(this.tutorialOcclusionFade.alpha);
    this.tutorialLifecycleContainer.setAlpha(0);
    this.tutorialTween = this.scene.tweens.add({
      targets: this.tutorialLifecycleContainer,
      alpha: 1,
      duration: TUTORIAL_FADE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => { this.tutorialTween = null; },
    });
  }

  /**
   * Lokaler Tutorial-Step im selben World-Space-Panel wie das Starttutorial. Der Checkpoint
   * wird außerhalb der HUD-Darstellung ausgewertet; `anchor` bestimmt ausschließlich die
   * authored Weltposition des Fensters.
   */
  updateTutorialStep(
    text: string | null,
    anchor?: CoopDefenseTutorialAnchor,
  ): void {
    this.tutorialStepContainer.setPosition(
      getCoopDefenseTutorialPanelCenterX(anchor),
      getCoopDefenseTutorialPanelTopY(anchor),
    );
    const nextText = text?.trim() || null;
    if (nextText === this.tutorialStepValue) return;
    this.tutorialStepValue = nextText;
    this.tutorialStepTween?.destroy();
    this.tutorialStepTween = null;

    if (!nextText) {
      this.hideTutorialStep(false);
      return;
    }

    this.tutorialStepBody.setText(nextText);
    this.drawTutorialPanel(
      this.tutorialStepGraphics,
      false,
      COOP_DEFENSE_TUTORIAL_PANEL_WIDTH,
      getCoopDefenseTutorialPanelHeight(false),
    );
    this.tutorialStepContainer.setVisible(true).setAlpha(1);
    this.tutorialStepLifecycleContainer.setAlpha(0);
    this.tutorialStepTween = this.scene.tweens.add({
      targets: this.tutorialStepLifecycleContainer,
      alpha: 1,
      duration: TUTORIAL_FADE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => { this.tutorialStepTween = null; },
    });
  }

  private drawTutorialPanel(
    graphics: Phaser.GameObjects.Graphics,
    showControls: boolean,
    width: number,
    height: number,
  ): void {
    const left = -width / 2;
    graphics.clear();
    graphics.fillStyle(0x000000, 0.24);
    graphics.fillRoundedRect(left + 4, 4, width, height, 12);
    graphics.fillStyle(TUTORIAL_BG_COLOR, 0.78);
    graphics.fillRoundedRect(left, 0, width, height, 12);
    graphics.lineStyle(2, TUTORIAL_ACCENT, 0.72);
    graphics.strokeRoundedRect(left, 0, width, height, 12);

    if (!showControls) return;
    // Trennlinie unter der Überschrift + Zeilen-Alternierung wie im Hilfe-Fenster.
    graphics.fillStyle(TUTORIAL_ACCENT, 0.55);
    graphics.fillRect(left + TUTORIAL_PAD_X, TUTORIAL_CONTROLS_SEP_Y, width - TUTORIAL_PAD_X * 2, 1);
    graphics.fillStyle(COLORS.GREY_8, 0.3);
    for (let i = 0; i < HELP_CONTROLS.length; i += 2) {
      graphics.fillRect(
        left + TUTORIAL_PAD_X,
        TUTORIAL_CONTROLS_ROWS_Y + i * COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H + 2,
        width - TUTORIAL_PAD_X * 2,
        COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H - 4,
      );
    }
  }

  /** @param arrivalTimerSecs Verbleibende Sekunden bis zur nächsten Einfahrt. */
  setTrainArrival(arrivalTimerSecs: number): void {
    const nextText = formatTrainArrivalLabel(arrivalTimerSecs, getLocale());
    if (this.lastTrainText !== nextText) {
      this.trainText.setText(nextText);
      this.lastTrainText = nextText;
    }
    if (this.lastTrainMode !== 'arrival') {
      this.showTrainPanelBackground();
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
      this.showTrainPanelBackground();
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
      this.showTrainPanelBackground();
      this.trainText.setVisible(true);
      this.hideTrainBar();
      this.lastTrainMode = 'destroyed';
      this.lastTrainBarWidth = -1;
    }
  }

  hideTrainWidget(): void {
    this.topPanelBg.setVisible(false);
    this.timerPanelBg.setVisible(true);
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
      || data.utilityAction !== undefined
      || data.persistentBaseRewardId !== undefined
      || data.utilityCooldownFrac > 0.001
      || now < this.utilityRevealUntil
      || (data.isTemporaryUtilitySelected ?? false);
    const isUltimateReady = data.isUltimateActive || data.rage >= data.ultimateRequiredRage;
    const showUltimate = isUltimateReady || now < this.ultimateRevealUntil;
    const showArmor = data.armor > 0;

    let nextBottom = GAME_HEIGHT - STACK_MARGIN;

    if (showUltimate) {
      this.showLowerSection(
        this.ultimateSection,
        t('ui.hud.ultimate', { name: data.ultimateId ? getContentDisplayName(data.ultimateId, getLocale()) : t('ui.common.unknown') }),
        Phaser.Math.Clamp(data.rage / Math.max(1, data.maxRage), 0, 1),
        CENTER_X,
        nextBottom - BOTTOM_STACK_TOTAL_H,
      );
      this.setUltimateReadyVisual(isUltimateReady);
      nextBottom = this.ultimateSection.container.y - BOTTOM_STACK_GAP;
    } else {
      this.setUltimateReadyVisual(false);
      this.hideLowerSection(this.ultimateSection);
    }

    if (showUtility) {
      this.showLowerSection(
        this.utilitySection,
        t('ui.hud.utility', {
          name: getUtilityHudDisplayName(data.utilityId, data.utilityAction, data.persistentBaseRewardId),
        }),
        Phaser.Math.Clamp(1 - data.utilityCooldownFrac, 0, 1),
        CENTER_X,
        nextBottom - BOTTOM_STACK_TOTAL_H,
      );
      this.setUtilityAttention(data.isTemporaryUtilitySelected ?? false);
      nextBottom = this.utilitySection.container.y - BOTTOM_STACK_GAP;
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
        nextBottom - BOTTOM_STACK_TOTAL_H,
      );
      nextBottom = this.armorSection.container.y - BOTTOM_STACK_GAP;
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

  showFraggedBy(killerName: string, sourceId: string, _color: number): void {
    this.showAnnouncement(t('ui.announcement.fraggedBy', {
      player: killerName,
      source: getSourceName(sourceId, getLocale()),
    }), COLORS.RED_2);
  }

  showYouFragged(victimName: string, _color: number): void {
    this.showAnnouncement(t('ui.announcement.youFragged', { player: victimName }), COLORS.GREEN_2);
  }

  showBeerCaptured(playerName: string, _color: number): void {
    this.showAnnouncement(t('ui.announcement.beerCaptured', { player: playerName }), COLORS.GREEN_2);
  }

  destroy(): void {
    this.hideAnnouncement();
    this.hideMainObjectivePresentation(true);
    this.hideEncounterPresentation();
    this.hideTutorial(true);
    this.hideTutorialStep(true);
    this.tutorialContainer.destroy(true);
    this.tutorialStepContainer.destroy(true);
    this.trainBarEffect.destroy();
    this.stopSectionAttention(this.armorSection);
    this.stopSectionAttention(this.utilitySection);
    this.stopSectionAttention(this.ultimateSection);
    this.armorSection.effect.destroy();
    this.utilitySection.effect.destroy();
    this.ultimateSection.effect.destroy();
    this.mainObjectiveTween?.destroy();
    this.container.destroy(true);
  }

  private showLowerSection(section: LowerBarSection, label: string, frac: number, x: number, y: number): void {
    const fillW = Math.max(0, Math.round(BOTTOM_STACK_BAR_W * Phaser.Math.Clamp(frac, 0, 1)));
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
      section.fg.setCrop(0, 0, fillW, BOTTOM_STACK_BAR_H);
      section.effect.setFilledWidth(fillW);
      section.lastWidth = fillW;
    }
    if (fillW <= 6) {
      section.effect.stop();
    } else {
      section.effect.start();
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
    section.effect.setEnergyIntensity(energized ? 1 : 0);
    if (section.container.visible && hasFill) section.effect.start();
    else section.effect.stop();
  }

  private hideTrainBar(): void {
    this.trainBarBg.setVisible(false);
    this.trainBarFgImg.setVisible(false);
    this.trainBarBorder.setVisible(false);
    this.trainBarEffect.stop();
  }

  private showTrainPanelBackground(): void {
    this.timerPanelBg.setVisible(false);
    this.topPanelBg.setVisible(true);
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
      this.tutorialContainer.setVisible(false).setAlpha(1);
      this.tutorialLifecycleContainer.setAlpha(0);
      resetHudOcclusionFade(this.tutorialOcclusionFade);
      return;
    }
    this.tutorialTween = this.scene.tweens.add({
      targets: this.tutorialLifecycleContainer,
      alpha: 0,
      duration: TUTORIAL_FADE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.tutorialTween = null;
        this.tutorialContainer.setVisible(false).setAlpha(1);
        resetHudOcclusionFade(this.tutorialOcclusionFade);
      },
    });
  }

  private hideTutorialStep(immediate: boolean): void {
    this.tutorialStepTween?.destroy();
    this.tutorialStepTween = null;
    this.tutorialStepValue = null;
    if (immediate || !this.tutorialStepContainer?.visible) {
      this.tutorialStepContainer?.setVisible(false).setAlpha(1);
      this.tutorialStepLifecycleContainer?.setAlpha(0);
      return;
    }
    this.tutorialStepTween = this.scene.tweens.add({
      targets: this.tutorialStepLifecycleContainer,
      alpha: 0,
      duration: TUTORIAL_FADE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.tutorialStepTween = null;
        this.tutorialStepContainer.setVisible(false).setAlpha(1);
      },
    });
  }
}
