import type { RoomQualityRetryMode, RoomQualityStartPolicy } from './types';

// ---- Display ----
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

export const ARENA_WIDTH = 1440;
export const ARENA_HEIGHT = 1056;
export const ARENA_OFFSET_X = (GAME_WIDTH - ARENA_WIDTH) / 2; // 240
export const ARENA_OFFSET_Y = 12;
export const ARENA_MAX_X = ARENA_OFFSET_X + ARENA_WIDTH;
export const ARENA_MAX_Y = ARENA_OFFSET_Y + ARENA_HEIGHT;

// ---- Depth Layers ----
export const DEPTH = {
  GRASS: 1,
  DIRT: 2,
  TRACKS: 3,
  ROCKS: 9,
  PLAYERS: 10,
  TRAIN: 11,  
  PROJECTILES: 15,
  FIRE: 16,
  SMOKE: 18,
  CANOPY: 20,
  OVERLAY: 100,
} as const;

// ---- Colors ----
export const COLORS = {
  // ─── BLUES (1 = Hellstes Eisblau, 6 = Dunkelstes Nachtblau) ──────
  BLUE_1:   0xa4dddb,
  BLUE_2:   0x73bed3,
  BLUE_3:   0x4f8fba,
  BLUE_4:   0x3c5e8b,
  BLUE_5:   0x253a5e,
  BLUE_6:   0x172038,

  // ─── GREENS (1 = Helles Gelbgrün, 6 = Dunkles Tannengrün) ────────
  GREEN_1:  0xd0da91,
  GREEN_2:  0xa8ca58,
  GREEN_3:  0x75a743,
  GREEN_4:  0x468232,
  GREEN_5:  0x25562e,
  GREEN_6:  0x19332d,

  // ─── BROWNS (1 = Heller Sand, 6 = Dunkles Holz/Erde) ─────────────
  BROWN_1:  0xe7d5b3,
  BROWN_2:  0xd7b594,
  BROWN_3:  0xc09473,
  BROWN_4:  0xad7757,
  BROWN_5:  0x7a4841,
  BROWN_6:  0x4d2b32,

  // ─── GOLDS (1 = Helles Gold, 6 = Dunkles Rostrot/Braun) ──────────
  GOLD_1:   0xe8c170,
  GOLD_2:   0xde9e41,
  GOLD_3:   0xbe772b,
  GOLD_4:   0x884b2b,
  GOLD_5:   0x602c2c,
  GOLD_6:   0x341c27,

  // ─── REDS (1 = Helles Orange, 6 = Sehr dunkles Weinrot) ──────────
  RED_1:    0xda863e,
  RED_2:    0xcf573c,
  RED_3:    0xa53030, // Dein "dritthellstes Rot"
  RED_4:    0x752438, // Dein "vierthellstes Rot"
  RED_5:    0x411d31,
  RED_6:    0x241527,

  // ─── PURPLES (1 = Helles Rosa, 6 = Dunkles Indigo) ───────────────
  PURPLE_1: 0xdf84a5,
  PURPLE_2: 0xc65197,
  PURPLE_3: 0xa23e8c,
  PURPLE_4: 0x7a367b,
  PURPLE_5: 0x402751,
  PURPLE_6: 0x1e1d39,

  // ─── GREYS (1 = Fast Weiß, 10 = Fast Schwarz) ────────────────────
  GREY_1:   0xebede9,
  GREY_2:   0xc7cfcc,
  GREY_3:   0xa8b5b2,
  GREY_4:   0x819796,
  GREY_5:   0x577277,
  GREY_6:   0x394a50,
  GREY_7:   0x202e37,
  GREY_8:   0x151d28,
  GREY_9:   0x10141f,
  GREY_10:  0x090a14,


  // Alpha-Werte
  CANOPY_ALPHA: 0.4
} as const;

export interface BeamPalette {
  shadow: number;
  glow: number;
  core: number;
}

const DEFAULT_BEAM_PALETTE: BeamPalette = {
  shadow: COLORS.GREY_9,
  glow:   COLORS.GREY_5,
  core:   COLORS.GREY_1,
};

export function getBeamPaletteForPlayerColor(color: number): BeamPalette {
  switch (color) {
    case COLORS.BLUE_3:
    case COLORS.BLUE_2:
      return { shadow: COLORS.BLUE_6, glow: COLORS.BLUE_4, core: COLORS.BLUE_1 };

    case COLORS.GREEN_3:
    case COLORS.GREEN_2:
      return { shadow: COLORS.GREEN_6, glow: COLORS.GREEN_4, core: COLORS.GREEN_1 };

    case COLORS.BROWN_3:
    case COLORS.BROWN_2:
      return { shadow: COLORS.BROWN_6, glow: COLORS.BROWN_4, core: COLORS.BROWN_1 };

    case COLORS.GOLD_3:
    case COLORS.GOLD_2:
      return { shadow: COLORS.GOLD_6, glow: COLORS.GOLD_4, core: COLORS.GOLD_1 };

    case COLORS.RED_3:
    case COLORS.RED_2:
      return { shadow: COLORS.RED_6, glow: COLORS.RED_4, core: COLORS.RED_1 };

    case COLORS.PURPLE_3:
    case COLORS.PURPLE_2:
      return { shadow: COLORS.PURPLE_6, glow: COLORS.PURPLE_4, core: COLORS.PURPLE_1 };

    default:
      return DEFAULT_BEAM_PALETTE;
  }
}

export function toCssColor(color: number): `#${string}` {
  return `#${color.toString(16).padStart(6, '0')}`;
}


// ---- Player ----
export const PLAYER_SIZE  = 32;
export const PLAYER_SPEED = 200;
export const MUZZLE_FORWARD_OFFSET = PLAYER_SIZE * 0.7;
export const MUZZLE_PROJECTILE_FALLBACK_BACKTRACK = PLAYER_SIZE * 1.1;

// ---- Combat ----
export const HP_MAX           = 100;
export const ARMOR_MAX        = 100;
export const ARMOR_COLOR      = COLORS.GOLD_2;
export const RESPAWN_DELAY_MS = 1000;
export const HITSCAN_FAVOR_THE_SHOOTER_MS = 120;
export const HITSCAN_FAVOR_THE_SHOOTER_MAX_OFFSET = 36;

export const BLOOD_HIT_VFX = {
  spawnPushPx: PLAYER_SIZE * 0.18,
  lateralJitterPx: 8,
  killshotMultiplier: 2.5,
  palette: [0x3c070b, 0x5b0d12, 0x76171b, 0x8d2429] as const,
  coreSplashScale: 0.95,
  coreSplashAlpha: 0.78,
  coreSplashDurationMs: 120,
  stainDelayMs: 55,
  bands: {
    light: {
      maxDamage: 14,
      spreadDeg: 18,
      streakCountMin: 3,
      streakCountMax: 5,
      dropletCountMin: 2,
      dropletCountMax: 4,
      travelMinPx: 14,
      travelMaxPx: 34,
      streakScaleMin: 0.34,
      streakScaleMax: 0.58,
      dropletScaleMin: 0.18,
      dropletScaleMax: 0.34,
      flightMinMs: 110,
      flightMaxMs: 190,
      stainCountMin: 1,
      stainCountMax: 3,
      stainScaleMin: 0.16,
      stainScaleMax: 0.28,
      stainAlpha: 0.18,
      stainFadeMs: 760,
    },
    medium: {
      maxDamage: 38,
      spreadDeg: 28,
      streakCountMin: 6,
      streakCountMax: 9,
      dropletCountMin: 5,
      dropletCountMax: 8,
      travelMinPx: 22,
      travelMaxPx: 56,
      streakScaleMin: 0.42,
      streakScaleMax: 0.82,
      dropletScaleMin: 0.22,
      dropletScaleMax: 0.5,
      flightMinMs: 140,
      flightMaxMs: 240,
      stainCountMin: 2,
      stainCountMax: 4,
      stainScaleMin: 0.24,
      stainScaleMax: 0.44,
      stainAlpha: 0.24,
      stainFadeMs: 1200,
    },
    heavy: {
      maxDamage: Number.POSITIVE_INFINITY,
      spreadDeg: 40,
      streakCountMin: 10,
      streakCountMax: 15,
      dropletCountMin: 7,
      dropletCountMax: 12,
      travelMinPx: 32,
      travelMaxPx: 84,
      streakScaleMin: 0.56,
      streakScaleMax: 1.18,
      dropletScaleMin: 0.26,
      dropletScaleMax: 0.66,
      flightMinMs: 170,
      flightMaxMs: 290,
      stainCountMin: 4,
      stainCountMax: 7,
      stainScaleMin: 0.34,
      stainScaleMax: 0.72,
      stainAlpha: 0.32,
      stainFadeMs: 1500,
    },
  },
} as const;

export const DEATH_DISINTEGRATION_VFX = {
  durationMs: 1000,
  chunkSizePx: 2,
  travelMinPx: 22,
  travelMaxPx: 104,
  jitterPx: 18,
  rotationMaxDeg: 180,
  scaleStart: 1.0,
  scaleEnd: 0.34,
  alpha: 0.96,
  auraTintMix: 0.18,
  glowCount: 12,
  glowTravelMinPx: 26,
  glowTravelMaxPx: 118,
  glowScaleMin: 0.28,
  glowScaleMax: 0.82,
  glowAlpha: 0.36,
} as const;

export const DAMAGE_VIGNETTE_VFX = {
  color: COLORS.RED_3,
  durationMs: 800,
  damageFloor: 6,
  damageMid: 22,
  damageCeil: 58,
  alphaMin: 0.1,
  alphaMid: 0.3,
  alphaMax: 0.52,
  maxAlpha: 0.72,
  stackAlphaBonus: 0.08,
  /** Fraction of the directional alpha shown uniformly on all 4 edges (the base frame). */
  frameAlphaRatio: 0.2,
} as const;

// ---- HP-Balken ----
export const HP_BAR_WIDTH    = PLAYER_SIZE;     // gleiche Breite wie Spieler
export const HP_BAR_HEIGHT   = 5;
export const HP_BAR_OFFSET_Y = 24;              // Pixel unter Sprite-Mittelpunkt
export const ARMOR_BAR_WIDTH    = PLAYER_SIZE;
export const ARMOR_BAR_HEIGHT   = 3;
export const ARMOR_BAR_OFFSET_Y = HP_BAR_OFFSET_Y + HP_BAR_HEIGHT + 1;

// ---- Effekt-Layer (über Baumkronen) ----
export const DEPTH_TRACE = 16;
export const DEPTH_FX = 25;

// ---- Prozedurales Arena-Grid ----
export const CELL_SIZE           = 32;
export const GRID_COLS           = Math.floor(ARENA_WIDTH  / CELL_SIZE); // 30
export const GRID_ROWS           = Math.floor(ARENA_HEIGHT / CELL_SIZE); // 22
export const ROCK_FILL_RATIO     = 0.30;
export const DIRT_FILL_RATIO     = 0.05;   
export const TREE_COUNT          = 3;
export const CA_SMOOTHING_STEPS  = 4;    // Anzahl Cellular-Automata-Durchläufe (0 = kein Smoothing)
export const CA_MIN_ROCK_NEIGHBORS = 3;  // Fels mit < N Nachbarn wird zu Boden
export const CA_MAX_FLOOR_NEIGHBORS = 4; // Boden mit > N Nachbarn wird zu Fels

// ---- Gleise ----
/** Anzahl Gleise pro Runde */
export const TRACK_COUNT           = 1;
/** Erste erlaubte Spalte (≥ 25 % der Arena-Breite, inklusive) */
export const TRACK_SPAWN_MIN_COL   = Math.floor(GRID_COLS * 0.25); // 7
/** Letzte erlaubte Spalte (≤ 75 % der Arena-Breite, inklusive) */
export const TRACK_SPAWN_MAX_COL   = Math.floor(GRID_COLS * 0.75); // 22

// ---- Felsen HP ----
export const ROCK_HP_MAX         = 200;
export const ROCK_TINT_STEPS     = 20;     // Anzahl visueller Abstufungen (0xffffff → 0x666666)

// ---- Baumstumpf & Baumkrone ----
export const TRUNK_RADIUS        = 16;     // Kollisions-Radius Baumstumpf (px)
export const CANOPY_RADIUS       = 96;     // Visueller Radius Baumkrone (px)
export const CANOPY_ALPHA_PLAYER = 0.2;   // Alpha wenn lokaler Spieler darunter (80% transparent)

// ---- Ressourcen ----
export const ADRENALINE_MAX            = 100;
export const ADRENALINE_START          = 30;
export const ADRENALINE_REGEN_PER_SEC  = 10;    // passiv, Host
export const ADRENALINE_DRAIN_PER_SEC  = 20;   // während Burrow
export const ADRENALINE_REGEN_PAUSE_MS = 500;  // Pause nach Verbrauch

export const RAGE_MAX                  = 600;
export const RAGE_PER_DAMAGE           = 1;    // Wut pro Schadenspunkt

// ---- Dash ----
export const DASH_T1_S    = 0.5;    // Burst-Phase Dauer (s)
export const DASH_T2_S    = 0.25;    // Recovery-Phase Dauer (s)
export const DASH_F_MIN   = 0.25;   // Kriechgang-Faktor (25 % v_norm)
// f_start = (3*t1 + 2*t2 - 2*f_min*(t1+t2)) / t1 = 3.25 — Strecken-Neutralität
export const DASH_F_START =
  (3 * DASH_T1_S + 2 * DASH_T2_S - 2 * DASH_F_MIN * (DASH_T1_S + DASH_T2_S)) / DASH_T1_S;

// ---- Burrow ----
export const BURROW_MIN_ADRENALINE       = 15;
export const BURROW_WINDUP_DURATION_MS   = 150;
export const BURROW_WINDUP_SPEED_FACTOR  = 0.8;
export const BURROW_UNDERGROUND_SPEED_FACTOR = 1.3;
export const BURROW_DRAIN_AMOUNT_PER_TICK = 5;
export const BURROW_DRAIN_INTERVAL_MS    = 60;
export const BURROW_STUCK_DAMAGE_PER_SEC = 25;
export const BURROW_POPOUT_WEAPON_LOCK_MS = 300;

export interface MuzzleOrigin {
  x: number;
  y: number;
}

export function getTopDownMuzzleOrigin(originX: number, originY: number, aimAngle: number, forwardOffset = MUZZLE_FORWARD_OFFSET): MuzzleOrigin {
  return {
    x: originX + Math.cos(aimAngle) * forwardOffset,
    y: originY + Math.sin(aimAngle) * forwardOffset,
  };
}

export function getTopDownMuzzleOriginFromVector(originX: number, originY: number, vx: number, vy: number, forwardOffset = MUZZLE_FORWARD_OFFSET): MuzzleOrigin {
  const len = Math.hypot(vx, vy);
  if (len <= 0.0001) {
    return { x: originX, y: originY };
  }

  return {
    x: originX + (vx / len) * forwardOffset,
    y: originY + (vy / len) * forwardOffset,
  };
}

export function isPointInsideArena(x: number, y: number): boolean {
  return x >= ARENA_OFFSET_X && x <= ARENA_MAX_X && y >= ARENA_OFFSET_Y && y <= ARENA_MAX_Y;
}

export function clampPointToArena(x: number, y: number): MuzzleOrigin {
  return {
    x: Phaser.Math.Clamp(x, ARENA_OFFSET_X, ARENA_MAX_X),
    y: Phaser.Math.Clamp(y, ARENA_OFFSET_Y, ARENA_MAX_Y),
  };
}

export function clipPointToArenaRay(startX: number, startY: number, endX: number, endY: number): { x: number; y: number; inside: boolean } {
  const inside = isPointInsideArena(endX, endY);
  if (inside) return { x: endX, y: endY, inside: true };

  const dx = endX - startX;
  const dy = endY - startY;
  let t = 1;

  if (dx > 0) t = Math.min(t, (ARENA_MAX_X - startX) / dx);
  else if (dx < 0) t = Math.min(t, (ARENA_OFFSET_X - startX) / dx);

  if (dy > 0) t = Math.min(t, (ARENA_MAX_Y - startY) / dy);
  else if (dy < 0) t = Math.min(t, (ARENA_OFFSET_Y - startY) / dy);

  return {
    x: startX + t * dx,
    y: startY + t * dy,
    inside: false,
  };
}

// ---- Schockwelle ----
export const SHOCKWAVE_RADIUS          = 100;   // px
export const SHOCKWAVE_DAMAGE          = 20;
export const SHOCKWAVE_KNOCKBACK       = 2500;   // px/s Impuls

// ---- Spielerfarben (12 auswählbare, einzigartige Farben) ----
export const PLAYER_COLORS: readonly number[] = [
  COLORS.BLUE_3,   COLORS.BLUE_2,
  COLORS.GREEN_3,  COLORS.GREEN_2,
  COLORS.BROWN_3,  COLORS.BROWN_2,
  COLORS.GOLD_3,   COLORS.GOLD_2,
  COLORS.RED_3,    COLORS.RED_2,
  COLORS.PURPLE_3, COLORS.PURPLE_2,
] as const;

// ---- Szenen / Match ----
export const MAX_PLAYERS        = 12;
export const ARENA_COUNTDOWN_SEC = 3;
export const ARENA_DURATION_SEC = 120;

// ---- Netzwerk ----
/** Netzwerk-Tick-Rate: Wie oft der Host den Game State an Clients sendet. */
export const NET_TICK_RATE_HZ     = 20;
/** Berechnetes Intervall in ms zwischen Netzwerk-Ticks. */
export const NET_TICK_INTERVAL_MS = 1000 / NET_TICK_RATE_HZ;  // 50 ms
/** Zeitbasierte Glättung für Client-Interpolation (ms). ~1.5× Tick-Intervall. */
export const NET_SMOOTH_TIME_MS   = 80;

// ---- Raumqualitaet / Lobby ----
export const ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS = 60;
export const ROOM_QUALITY_REQUIRED_SAMPLES = 3;
export const ROOM_QUALITY_SAMPLE_INTERVAL_MS = 500;
export const ROOM_QUALITY_MAX_AUTO_RETRIES = 3;
export const ROOM_QUALITY_AUTO_RETRY_DELAY_MS = 2500;
export const ROOM_QUALITY_HOST_PROBE_SAMPLE_COUNT = 3;
export const ROOM_QUALITY_HOST_PROBE_TIMEOUT_MS = 2500;
export const ROOM_QUALITY_AUTO_SEARCH_MAX_ATTEMPTS = 5;
export const ROOM_QUALITY_RETRY_MODE: RoomQualityRetryMode = 'suggest';
export const ROOM_QUALITY_START_POLICY: RoomQualityStartPolicy = 'warn';

// State-Keys und RPC-Namen sind intern in NetworkBridge gekapselt.
