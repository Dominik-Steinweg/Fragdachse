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
  ROCKS: 9,
  PLAYERS: 10,
  PROJECTILES: 15,
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

export function toCssColor(color: number): `#${string}` {
  return `#${color.toString(16).padStart(6, '0')}`;
}


// ---- Player ----
export const PLAYER_SIZE  = 32;
export const PLAYER_SPEED = 200;

// ---- Combat ----
export const HP_MAX           = 100;
export const RESPAWN_DELAY_MS = 1000;

// ---- HP-Balken ----
export const HP_BAR_WIDTH    = PLAYER_SIZE;     // gleiche Breite wie Spieler
export const HP_BAR_HEIGHT   = 5;
export const HP_BAR_OFFSET_Y = 24;              // Pixel unter Sprite-Mittelpunkt

// ---- Effekt-Layer (über Baumkronen) ----
export const DEPTH_FX = 25;

// ---- Prozedurales Arena-Grid ----
export const CELL_SIZE           = 48;
export const GRID_COLS           = Math.floor(ARENA_WIDTH  / CELL_SIZE); // 30
export const GRID_ROWS           = Math.floor(ARENA_HEIGHT / CELL_SIZE); // 22
export const ROCK_FILL_RATIO     = 0.30;   
export const TREE_COUNT          = 2;
export const CA_SMOOTHING_STEPS  = 3;    // Anzahl Cellular-Automata-Durchläufe (0 = kein Smoothing)
export const CA_MIN_ROCK_NEIGHBORS = 2;  // Fels mit < N Nachbarn wird zu Boden
export const CA_MAX_FLOOR_NEIGHBORS = 4; // Boden mit > N Nachbarn wird zu Fels

// ---- Felsen HP ----
export const ROCK_HP_MAX         = 200;
export const ROCK_HP_THRESHOLD   = 100;    // < 50% → Farbwechsel zu BROWN_3

// ---- Baumstumpf & Baumkrone ----
export const TRUNK_RADIUS        = 24;     // Kollisions-Radius Baumstumpf (px)
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
export const DASH_SPEED                = 600;  // px/s
export const DASH_DURATION_MS          = 75;  // Dauer der Geschwindigkeitsüberschreibung
export const DASH_COOLDOWN_MS          = 500;

// ---- Burrow ----
export const BURROW_SPEED_FACTOR       = 0.4;       // Faktor * PLAYER_SPEED
export const BURROW_ALPHA              = 0.4;
export const BURROW_TINT               = 0x8B5E3C;  // Braun
export const BURROW_STUCK_DAMAGE_PER_SEC = 10;

// ---- Schockwelle ----
export const SHOCKWAVE_RADIUS          = 150;   // px
export const SHOCKWAVE_DAMAGE          = 30;
export const SHOCKWAVE_KNOCKBACK       = 400;   // px/s Impuls
export const SELF_STUN_DURATION_MS     = 1000;

// ---- Spielerfarben (12 auswählbare, einzigartige Farben) ----
export const PLAYER_COLORS: readonly number[] = [
  COLORS.BLUE_2,   COLORS.BLUE_5,
  COLORS.GREEN_2,  COLORS.GREEN_5,
  COLORS.BROWN_2,  COLORS.BROWN_5,
  COLORS.GOLD_2,   COLORS.GOLD_5,
  COLORS.RED_2,    COLORS.RED_5,
  COLORS.PURPLE_2, COLORS.PURPLE_5,
] as const;

// ---- Szenen / Match ----
export const MAX_PLAYERS        = 12;
export const ARENA_COUNTDOWN_SEC = 3;
export const ARENA_DURATION_SEC = 120;

// State-Keys und RPC-Namen sind intern in NetworkBridge gekapselt.
