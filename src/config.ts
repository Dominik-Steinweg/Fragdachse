import type { RoomQualityRetryMode, RoomQualityStartPolicy } from './types';

// ---- Display ----
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

export const ARENA_WIDTH = 1440;
export const ARENA_HEIGHT = 1056;
export const ARENA_OFFSET_X = (GAME_WIDTH - ARENA_WIDTH) / 2; // 240
export const ARENA_OFFSET_Y = 12;

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

// ---- Combat ----
export const HP_MAX           = 100;
export const ARMOR_MAX        = 100;
export const ARMOR_COLOR      = COLORS.GOLD_2;
export const RESPAWN_DELAY_MS = 1000;
export const HITSCAN_FAVOR_THE_SHOOTER_MS = 120;
export const HITSCAN_FAVOR_THE_SHOOTER_MAX_OFFSET = 36;

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

export const RAGE_MAX                  = 300;
export const RAGE_PER_DAMAGE           = 1;    // Wut pro Schadenspunkt

// ---- Dash ----
export const DASH_T1_S    = 0.5;    // Burst-Phase Dauer (s)
export const DASH_T2_S    = 0.25;    // Recovery-Phase Dauer (s)
export const DASH_F_MIN   = 0.25;   // Kriechgang-Faktor (25 % v_norm)
// f_start = (3*t1 + 2*t2 - 2*f_min*(t1+t2)) / t1 = 3.25 — Strecken-Neutralität
export const DASH_F_START =
  (3 * DASH_T1_S + 2 * DASH_T2_S - 2 * DASH_F_MIN * (DASH_T1_S + DASH_T2_S)) / DASH_T1_S;

// ---- Burrow ----
export const BURROW_SPEED_FACTOR       = 0.4;       // Faktor * PLAYER_SPEED
export const BURROW_ALPHA              = 0.4;
export const BURROW_TINT               = 0x8B5E3C;  // Braun
export const BURROW_STUCK_DAMAGE_PER_SEC = 10;

// ---- Schockwelle ----
export const SHOCKWAVE_RADIUS          = 250;   // px
export const SHOCKWAVE_DAMAGE          = 30;
export const SHOCKWAVE_KNOCKBACK       = 1400;   // px/s Impuls
export const SELF_STUN_DURATION_MS     = 1000;

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
export const ROOM_QUALITY_MAX_ACCEPTABLE_PING_MS = 80;
export const ROOM_QUALITY_REQUIRED_SAMPLES = 3;
export const ROOM_QUALITY_SAMPLE_INTERVAL_MS = 500;
export const ROOM_QUALITY_MAX_AUTO_RETRIES = 3;
export const ROOM_QUALITY_AUTO_RETRY_DELAY_MS = 2500;
export const ROOM_QUALITY_HOST_PROBE_SAMPLE_COUNT = 3;
export const ROOM_QUALITY_HOST_PROBE_TIMEOUT_MS = 2500;
export const ROOM_QUALITY_RETRY_MODE: RoomQualityRetryMode = 'suggest';
export const ROOM_QUALITY_START_POLICY: RoomQualityStartPolicy = 'warn';

// State-Keys und RPC-Namen sind intern in NetworkBridge gekapselt.
