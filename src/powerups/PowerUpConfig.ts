// ── Power-Up-Definitionen ──────────────────────────────────────────────────

import { COLORS } from '../config';

export type PowerUpType = 'instant_heal' | 'buff_regen' | 'buff_damage' | 'global_nuke' | 'holy_hand_grenade';

export interface PowerUpDef {
  readonly id:          string;
  readonly type:        PowerUpType;
  readonly healAmount?: number;   // nur instant_heal (999 = Full HP)
  readonly durationMs?: number;   // nur buff_*
  readonly multiplier?: number;   // nur buff_*
  /** Hex-Farbe für die Client-Darstellung (Fallback wenn kein spriteKey) */
  readonly color:       number;
  /** Phaser-Texture-Key für die Sprite-Darstellung (optional, sonst Rectangle) */
  readonly spriteKey?:  string;
}

export const POWERUP_DEFS: Record<string, PowerUpDef> = {
  HEALTH_PACK:   { id: 'HEALTH_PACK',   type: 'instant_heal', healAmount: 999,                     color: COLORS.GREEN_2,  spriteKey: 'powerup_hp'  },
  ADRENALINE:    { id: 'ADRENALINE',    type: 'buff_regen',   durationMs: 10_000, multiplier: 2.0, color: COLORS.BLUE_2,   spriteKey: 'powerup_adr' },
  DOUBLE_DAMAGE: { id: 'DOUBLE_DAMAGE', type: 'buff_damage',  durationMs:  8_000, multiplier: 2.0, color: COLORS.PURPLE_2, spriteKey: 'powerup_dam' },
  NUKE:                { id: 'NUKE',                type: 'global_nuke',                                       color: COLORS.RED_2,    spriteKey: 'powerup_nuke' },
  HOLY_HAND_GRENADE:   { id: 'HOLY_HAND_GRENADE',  type: 'holy_hand_grenade',                                  color: COLORS.GOLD_1,   spriteKey: 'powerup_hhg'  },
};

export const NUKE_CONFIG = {
  countdownMs:        5_000,
  radius:             500,
  maxDamage:          1000,
  minDamage:          50,
  edgePaddingPx:      120,
  farSpawnTopFraction: 0.25,
  warningColor:       COLORS.RED_2,
  circleFillAlpha:    0.12,
  circleStrokeAlpha:  0.42,
  rockDamageMult:     0.25,  // 25% Schaden an Felsen
  trainDamageMult:    1.0,   // 100% Schaden am Zug
} as const;

// ── Drop-Tabellen ──────────────────────────────────────────────────────────

export interface DropTable {
  /** 0-1 Wahrscheinlichkeit, dass überhaupt etwas droppt (fehlt = 1.0) */
  chanceToDrop?: number;
  /** defId → Gewichtung (0 = deaktiviert) */
  items: Record<string, number>;
}

export const DROP_TABLES: Record<string, DropTable> = {
  ENEMY_KILL: {
    chanceToDrop: 1.0,
    items: { HEALTH_PACK: 70, ADRENALINE: 30, DOUBLE_DAMAGE: 0 },
  },
  ROCK_DESTROY: {
    chanceToDrop: 0.2,
    items: { HEALTH_PACK: 80, ADRENALINE: 20, DOUBLE_DAMAGE: 0 },
  },
  SCHEDULED_EVENT: {
    // chanceToDrop fehlt → immer 1.0
    items: { HEALTH_PACK: 0, ADRENALINE: 0, DOUBLE_DAMAGE: 100, NUKE: 0 },
  },
  TRAIN_DESTROY: {
    // chanceToDrop fehlt → immer 1.0 (Zug gibt immer Power-Ups)
    items: { HEALTH_PACK: 0, ADRENALINE: 0, DOUBLE_DAMAGE: 0, NUKE: 50, HOLY_HAND_GRENADE: 50 },
  },
};

/** Anzahl Power-Ups, die beim Zerstören des Zugs gespawnt werden. */
export const TRAIN_DROP_COUNT = 1;

// ── Geplante Spawns (Sekunden nach Rundenstart) ────────────────────────────

export interface ScheduledSpawn {
  readonly timeSeconds: number;
  readonly amount:      number;
}

export const SCHEDULED_SPAWNS: ScheduledSpawn[] = [
  { timeSeconds: 90, amount: 1 },
];

// ── Pickup-Radius (Pixel) ──────────────────────────────────────────────────

/** Maximaler Abstand Spieler–PowerUp-Mittelpunkt, um einzusammeln */
export const PICKUP_RADIUS = 16;

/** Darstellungsgröße der PowerUp-Rectangles (px) */
export const POWERUP_RENDER_SIZE = 16;
