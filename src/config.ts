// ---- Display ----
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

export const ARENA_WIDTH = 1440;
export const ARENA_HEIGHT = 1080;
export const ARENA_OFFSET_X = (GAME_WIDTH - ARENA_WIDTH) / 2; // 160
export const ARENA_OFFSET_Y = 0;

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
  GRASS: 0x2d5a1e,
  SIDEBAR: 0x1a1a1a,
  ROCK: 0x666666,
  CANOPY: 0x1a4a0e,
  CANOPY_ALPHA: 0.4,
  PROJECTILE: 0xffff00,
  PLAYER_FALLBACK: 0xffffff,
} as const;

// ---- Player ----
export const PLAYER_SIZE  = 32;
export const PLAYER_SPEED = 200;

// ---- Combat ----
export const HP_MAX           = 100;
export const DAMAGE_PER_HIT   = 10;
export const RESPAWN_DELAY_MS = 1000;

// ---- HP-Balken ----
export const HP_BAR_WIDTH    = PLAYER_SIZE;     // gleiche Breite wie Spieler
export const HP_BAR_HEIGHT   = 5;
export const HP_BAR_OFFSET_Y = 24;              // Pixel unter Sprite-Mittelpunkt

// ---- Effekt-Layer (über Baumkronen) ----
export const DEPTH_FX = 25;

// ---- Projectile ----
export const PROJECTILE_SIZE = 6;
export const PROJECTILE_SPEED = 400;
export const PROJECTILE_LIFETIME_MS = 3000;
export const PROJECTILE_MAX_BOUNCES = 10;

// ---- Arena Layout: Felsen (relativ zur Arena) ----
export const ROCKS: Array<{ x: number; y: number; w: number; h: number }> = [
  { x: 200, y: 150, w: 60, h: 60 },
  { x: 500, y: 300, w: 80, h: 40 },
  { x: 700, y: 500, w: 50, h: 70 },
  { x: 350, y: 600, w: 90, h: 40 },
  { x: 150, y: 400, w: 40, h: 80 },
  { x: 780, y: 180, w: 55, h: 55 },
  { x: 450, y: 550, w: 70, h: 35 },
];

// ---- Arena Layout: Baumkronen (relativ zur Arena) ----
export const CANOPIES: Array<{ x: number; y: number; radius: number }> = [
  { x: 300, y: 200, radius: 80 },
  { x: 650, y: 450, radius: 100 },
  { x: 480, y: 150, radius: 60 },
  { x: 820, y: 600, radius: 75 },
];

// ---- Spawn-Punkte (relativ zur Arena, 12 Einträge) ----
export const SPAWN_POINTS: Array<{ x: number; y: number }> = [
  { x: 80,  y: 80  },
  { x: 880, y: 80  },
  { x: 80,  y: 640 },
  { x: 880, y: 640 },
  { x: 480, y: 80  },
  { x: 480, y: 640 },
  { x: 80,  y: 360 },
  { x: 880, y: 360 },
  { x: 240, y: 200 },
  { x: 720, y: 200 },
  { x: 240, y: 520 },
  { x: 720, y: 520 },
];

// ---- Szenen / Match ----
export const MAX_PLAYERS       = 12;
export const ARENA_DURATION_SEC = 120;
export const COUNTDOWN_SEC      = 3;

// State-Keys und RPC-Namen sind intern in NetworkBridge gekapselt.
