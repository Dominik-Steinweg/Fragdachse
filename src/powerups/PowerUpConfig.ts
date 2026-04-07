// ── Power-Up-Definitionen ──────────────────────────────────────────────────

import { ARMOR_COLOR, COLORS } from '../config';

export type PowerUpType = 'instant_heal' | 'instant_armor' | 'buff_regen' | 'buff_damage' | 'shield_overcharge' | 'global_nuke' | 'holy_hand_grenade' | 'bfg' | 'decoy_stealth';

export interface PowerUpDef {
  readonly id:          string;
  readonly type:        PowerUpType;
  readonly displayName: string;
  readonly amount?: number;       // nur instant_* (999 = Full HP)
  readonly durationMs?: number;   // nur buff_*
  readonly multiplier?: number;   // nur buff_*
  /** Hex-Farbe für die Client-Darstellung (Fallback wenn kein spriteKey) */
  readonly color:       number;
  /** Phaser-Texture-Key für die Sprite-Darstellung (optional, sonst Rectangle) */
  readonly spriteKey?:  string;
}

export interface TimedPedestalPowerUpConfig {
  readonly defId: string;
  readonly weight: number;
  readonly respawnMs: number;
  readonly spawnOnArenaStart: boolean;
}

export const POWERUP_DEFS: Record<string, PowerUpDef> = {
  HEALTH_PACK:   { id: 'HEALTH_PACK',   type: 'instant_heal',  displayName: 'Medipack',            amount: 999,                        color: COLORS.GREEN_2,  spriteKey: 'powerup_hp'  },
  ARMOR:         { id: 'ARMOR',         type: 'instant_armor', displayName: 'Armor',               amount: 50,                         color: ARMOR_COLOR,     spriteKey: 'powerup_arm' },
  ADRENALINE:    { id: 'ADRENALINE',    type: 'buff_regen',    displayName: 'Adrenalin Spritze',  durationMs: 3_000, multiplier: 3.0, color: COLORS.BLUE_2,   spriteKey: 'powerup_adr' },
  DOUBLE_DAMAGE: { id: 'DOUBLE_DAMAGE', type: 'buff_damage',   displayName: 'Double Damage',      durationMs:  8_000, multiplier: 2.0, color: COLORS.PURPLE_2, spriteKey: 'powerup_dam' },
  DECOY_STEALTH: { id: 'DECOY_STEALTH', type: 'decoy_stealth', displayName: 'Unsichtbarkeit', color: COLORS.GREY_2 },
  SHIELD_OVERCHARGE: { id: 'SHIELD_OVERCHARGE', type: 'shield_overcharge', displayName: 'Schildladung', color: 0x78f0ff },
  NUKE:                { id: 'NUKE',                type: 'global_nuke',         displayName: 'Atombombe',                               color: COLORS.RED_2,    spriteKey: 'powerup_nuk' },
  HOLY_HAND_GRENADE:   { id: 'HOLY_HAND_GRENADE',  type: 'holy_hand_grenade',   displayName: 'Heilige Handgranate',                     color: COLORS.GOLD_1,   spriteKey: 'powerup_hhg'  },
  BFG:                 { id: 'BFG',                type: 'bfg',                 displayName: 'BFG',                                     color: COLORS.GREEN_3,  spriteKey: 'powerup_bfg'  },
};

export const TIMED_POWERUP_PEDESTAL_COUNT = 4;

export const TIMED_POWERUP_PEDESTAL_CONFIGS: Record<string, TimedPedestalPowerUpConfig> = {
  HEALTH_PACK: {
    defId: 'HEALTH_PACK',
    weight: 300,
    respawnMs: 20_000,
    spawnOnArenaStart: true,
  },
 ARMOR: {
    defId: 'ARMOR',
    weight: 0,
    respawnMs: 30_000,
    spawnOnArenaStart: false,
  },    
  ADRENALINE: {
    defId: 'ADRENALINE',
    weight: 0,
    respawnMs: 20_000,
    spawnOnArenaStart: false,
  },     
  DOUBLE_DAMAGE: {
    defId: 'DOUBLE_DAMAGE',
    weight: 50,
    respawnMs: 70_000,
    spawnOnArenaStart: false,
  },
  NUKE: {
    defId: 'NUKE',
    weight: 0,
    respawnMs: 90_000,
    spawnOnArenaStart: false,
  },     
  HOLY_HAND_GRENADE: {
    defId: 'HOLY_HAND_GRENADE',
    weight: 50,
    respawnMs: 70_000,
    spawnOnArenaStart: false,
  },      
  BFG: {
    defId: 'BFG',
    weight: 0,
    respawnMs: 90_000,
    spawnOnArenaStart: true,
  },   
};

export const POWERUP_PEDESTAL_CONFIG = {
  announceLeadMs: 5_000,
  edgePaddingCells: 2,
  minSpacingCells: 7,
  renderBaseRadius: 10,
  renderInnerRadius: 8,
  renderCoreRadius: 4,
  renderGlowSize: 72,
} as const;

export const NUKE_CONFIG = {
  countdownMs:        5_000,
  radius:             750,
  maxDamage:          1000,
  minDamage:          50,
  allowTeamDamage:    true,
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
    items: { HEALTH_PACK: 0, ADRENALINE: 100, DOUBLE_DAMAGE: 0, NUKE: 0, HOLY_HAND_GRENADE: 0, BFG: 0 },
  },
  ROCK_DESTROY: {
    chanceToDrop: 0.1,
    items: { HEALTH_PACK: 0, ARMOR: 10, ADRENALINE: 0, DOUBLE_DAMAGE: 0 },
  },
  TRAIN_DESTROY: {
    // chanceToDrop fehlt → immer 1.0 (Zug gibt immer Power-Ups)
    items: { HEALTH_PACK: 0, ADRENALINE: 0, DOUBLE_DAMAGE: 0, NUKE: 50, HOLY_HAND_GRENADE: 0, BFG: 50 },
  },
};

/** Anzahl Power-Ups, die beim Zerstören des Zugs gespawnt werden. */
export const TRAIN_DROP_COUNT = 1;

// ── Pickup-Radius (Pixel) ──────────────────────────────────────────────────

/** Maximaler Abstand Spieler–PowerUp-Mittelpunkt, um einzusammeln */
export const PICKUP_RADIUS = 16;

/** Darstellungsgröße der PowerUp-Rectangles (px) */
export const POWERUP_RENDER_SIZE = 16;
