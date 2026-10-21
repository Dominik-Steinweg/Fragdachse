// ── Power-Up-Definitionen ──────────────────────────────────────────────────

import { ARMOR_COLOR, COLORS } from '../config';
import { DAWN_SCRAP_KEYS } from '../assets/DawnAssets';

export type PowerUpType = 'dawn_scrap' | 'instant_heal' | 'instant_armor' | 'instant_rage' | 'buff_regen' | 'buff_damage' | 'weapon_buff' | 'shield_overcharge' | 'global_nuke' | 'holy_hand_grenade' | 'bfg' | 'decoy_stealth';

export interface PowerUpDef {
  readonly id:          string;
  readonly type:        PowerUpType;
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

const DELAYED_FIRST_PEDESTAL_POWER_UPS = new Set([
  'DOUBLE_DAMAGE',
  'NUKE',
  'HOLY_HAND_GRENADE',
  'BFG',
]);

export function shouldDelayFirstPedestalSpawn(defId: string): boolean {
  return DELAYED_FIRST_PEDESTAL_POWER_UPS.has(defId);
}

/** Replacement point for the temporary scrap visual; absent from normal drop tables. */
export const DAWN_SCRAP_DEFS: Record<string, PowerUpDef> = Object.fromEntries(
  [1, 2, 3].map(amount => {
    const id = 'dawn_scrap_' + amount;
    return [id, { id, type: 'dawn_scrap', amount, color: 0xc69762, spriteKey: DAWN_SCRAP_KEYS[amount] }];
  }),
);

export const POWERUP_DEFS: Record<string, PowerUpDef> = {
  ...DAWN_SCRAP_DEFS,
  RAGE: { id: 'RAGE', type: 'instant_rage', amount: 400, color: COLORS.RED_2, spriteKey: 'powerup_rage' },
  HEALTH_PACK:   { id: 'HEALTH_PACK',   type: 'instant_heal',  amount: 999,                        color: COLORS.GREEN_2,  spriteKey: 'powerup_hp'  },
  ARMOR:         { id: 'ARMOR',         type: 'instant_armor', amount: 50,                         color: ARMOR_COLOR,     spriteKey: 'powerup_arm' },
  ADRENALINE:    { id: 'ADRENALINE',    type: 'buff_regen',    durationMs: 3_000, multiplier: 3.0, color: COLORS.BLUE_2,   spriteKey: 'powerup_adr' },
  DOUBLE_DAMAGE: { id: 'DOUBLE_DAMAGE', type: 'buff_damage',   durationMs:  8_000, multiplier: 2.0, color: COLORS.PURPLE_2, spriteKey: 'powerup_dam' },
  DECOY_STEALTH: { id: 'DECOY_STEALTH', type: 'decoy_stealth', color: COLORS.GREY_2 },
  SHIELD_OVERCHARGE: { id: 'SHIELD_OVERCHARGE', type: 'shield_overcharge', color: 0x78f0ff },
  AK47_FOCUS: { id: 'AK47_FOCUS', type: 'weapon_buff', color: 0xffa33a },
  AK47_FIRE_SUPERIORITY: { id: 'AK47_FIRE_SUPERIORITY', type: 'weapon_buff', color: 0xffd166 },
  NEGEV_KILLSTREAK: { id: 'NEGEV_KILLSTREAK', type: 'weapon_buff', color: 0xff8a2d },
  // Item-Affix "Kinetische Ladung". Kein einsammelbares Power-Up, sondern nur ein HUD-Eintrag –
  // dieselbe Rolle wie die AK-47- und Negev-Buffs darueber.
  MOVEMENT_CHARGE: { id: 'MOVEMENT_CHARGE', type: 'weapon_buff', color: 0x7fd4ff },
  // Item-Affixe ohne eigene Pickup-Quelle; diese Definitionen versorgen ausschliesslich die HUD-Zeile.
  GLUTWANDERER: { id: 'GLUTWANDERER', type: 'weapon_buff', color: 0xff8a3d },
  SURROUNDED: { id: 'SURROUNDED', type: 'buff_regen', color: 0xf05a78 },
  // Team-Buff-HUD-Definition. Die Wirkung laeuft bewusst nicht ueber PowerUpSystem.
  TEAM_REGENERATION_SURGE: {
    id: 'TEAM_REGENERATION_SURGE',
    type: 'buff_regen',
    color: 0x63e6be,
  },
  NUKE:                { id: 'NUKE',                type: 'global_nuke',         color: COLORS.RED_2,    spriteKey: 'powerup_nuk' },
  HOLY_HAND_GRENADE:   { id: 'HOLY_HAND_GRENADE',  type: 'holy_hand_grenade',   color: COLORS.GOLD_1,   spriteKey: 'powerup_hhg'  },
  BFG:                 { id: 'BFG',                type: 'bfg',                  color: COLORS.GREEN_3,  spriteKey: 'powerup_bfg'  },
};

export const TIMED_POWERUP_PEDESTAL_COUNT = 4;

export const TIMED_POWERUP_PEDESTAL_CONFIGS: Record<string, TimedPedestalPowerUpConfig> = {
  RAGE: { defId: 'RAGE', weight: 0, respawnMs: 30_000, spawnOnArenaStart: true },
  HEALTH_PACK: {
    defId: 'HEALTH_PACK',
    weight: 300,
    respawnMs: 5_000,
    spawnOnArenaStart: true,
  },
 ARMOR: {
    defId: 'ARMOR',
    weight: 0,
    respawnMs: 10_000,
    spawnOnArenaStart: true,
  },    
  ADRENALINE: {
    defId: 'ADRENALINE',
    weight: 0,
    respawnMs: 10_000,
    spawnOnArenaStart: true,
  },     
  DOUBLE_DAMAGE: {
    defId: 'DOUBLE_DAMAGE',
    weight: 50,
    respawnMs: 20_000,
    spawnOnArenaStart: false,
  },
  NUKE: {
    defId: 'NUKE',
    weight: 0,
    respawnMs: 30_000,
    spawnOnArenaStart: false,
  },     
  HOLY_HAND_GRENADE: {
    defId: 'HOLY_HAND_GRENADE',
    weight: 50,
    respawnMs: 30_000,
    spawnOnArenaStart: false,
  },      
  BFG: {
    defId: 'BFG',
    weight: 0,
    respawnMs: 30_000,
    spawnOnArenaStart: false,
  },   
};

export const POWERUP_PEDESTAL_CONFIG = {
  announceLeadMs: 5_000,
  edgePaddingCells: 2,
  minSpacingCells: 7,
  /** Sockel = vergrößerter Pickup-Token; der Kanal fasst genau ein liegendes Item-Token. */
  renderBaseRadius: 13,
  renderInnerRadius: 10.3,
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

/** Ordinary pickup paths use twice PICKUP_RADIUS as their effective collection radius. */
export function resolvePowerUpPickupRadius(type: PowerUpType, dawnScrapMagnetLevel = 0): number {
  return PICKUP_RADIUS * 2 * (type === 'dawn_scrap' && dawnScrapMagnetLevel >= 1 ? 2.5 : 1);
}

/** Kantenlänge der Power-Up-Symbole in Spieleinheiten, unabhängig von der Texturauflösung. */
export const POWERUP_RENDER_SIZE = 22;

export const POWERUP_SYMBOL_PULSE = { amplitude: 0.03, periodMs: 2400 } as const;

/**
 * Gemeinsame Item-Darstellung: Token am Boden, darüber schwebendes Symbol. Alle Längen in
 * Spieleinheiten; reine Präsentation ohne Gameplay-Wirkung.
 */
export const POWERUP_ITEM_ART = {
  /** Kantenlänge der vorgefilterten Display-Texturen (siehe ensurePowerUpDisplayTexture). */
  displayTextureSize: 64,
  /** Token- und Kanalradius relativ zur halben Canvas-Kante. */
  tokenRadiusRatio: 0.88,
  channelRadiusRatio: 0.7,
  /** Das schwebende Symbol ist näher an der Kamera und darf über den Tokenrand ragen. */
  symbolScale: 1.12,
  /** Schwebehöhe des Symbols über dem Token und deren Amplitude. */
  hoverPx: 2.2,
  hoverAmplitudePx: 0.9,
  /** Bodenring und Halo als Durchmesser. */
  ringDiameter: 31,
  haloDiameter: 30,
  shadowDiameter: 22,
  shadowOffset: { x: 1.1, y: 1.7 },
  /** Symbolschatten auf dem Token: Grundversatz plus Anteil pro Schwebehöhe. */
  symbolShadow: { x: 0.5, y: 0.8, perHover: 0.42, alpha: 0.42 },
  revealMs: 460,
  revealDropPx: 18,
  collectMs: 260,
} as const;

/**
 * Glow colour of a lying pickup, its ring, light and pedestal channel: the definition colour, so
 * the ground signal matches the HUD (health glows green even though its cross is blood red).
 */
export function powerUpWorldColor(defId: string): number {
  return POWERUP_DEFS[defId]?.color ?? 0xffffff;
}

/**
 * Particle cadence (ms between spawns) of resting pickups and pedestals. Resting states stay
 * quiet; the announcement before a respawn keeps a lively signal. 0 disables a stream.
 */
export const POWERUP_IDLE_PARTICLES = {
  itemMoteMs: 1_400,
  pedestal: {
    idle: { ambientMs: 700, sparkMs: 0 },
    ready: { ambientMs: 600, sparkMs: 1_600 },
    announcing: { ambientMs: 160, sparkMs: 220 },
  },
} as const;

/** Pure presentation: identical time/UID gives identical scale, including pause and step. */
export function powerUpSymbolScale(uid: number, presentationTimeMs: number): number {
  const { amplitude, periodMs } = POWERUP_SYMBOL_PULSE;
  return 1 + amplitude * Math.sin(((presentationTimeMs + uid * 137) % periodMs) / periodMs * Math.PI * 2);
}

/** Schwebehöhe des Symbols; derselbe Takt wie der Puls, damit Nähe und Größe zusammenpassen. */
export function powerUpHoverHeight(uid: number, presentationTimeMs: number): number {
  const { periodMs } = POWERUP_SYMBOL_PULSE;
  const phase = ((presentationTimeMs + uid * 137) % periodMs) / periodMs * Math.PI * 2;
  return POWERUP_ITEM_ART.hoverPx + POWERUP_ITEM_ART.hoverAmplitudePx * Math.sin(phase);
}
