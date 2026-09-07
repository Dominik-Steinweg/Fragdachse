/** Authored locomotion anatomy; independent of artwork and animation availability. */
export type PawCount = 2 | 4;
export type FootprintVariant = 'compact' | 'clawed' | 'broad';

export const PLAYER_MOVEMENT_VISUAL = { pawCount: 2, footprint: 'compact' } as const;

export function requirePawCount(value: unknown, figureId: string): PawCount {
  if (value !== 2 && value !== 4) {
    throw new Error(`[movementEffects] Figure ${figureId} requires pawCount 2 or 4.`);
  }
  return value;
}

const CLAWED = new Set(['demon-badger', 'rabid-badger', 'alien-badger', 'void-stalker', 'void-hunter']);
const BROAD = new Set(['grave-titan', 'inferno-colossus', 'stink-broodmother']);

export function getEnemyFootprintVariant(kind: string): FootprintVariant {
  return BROAD.has(kind) ? 'broad' : CLAWED.has(kind) ? 'clawed' : 'compact';
}

export const MOVEMENT_FX = {
  footprintCapacity: 3072,
  dustCapacity: 1024,
  playerFootprintReserve: 256,
  playerDustReserve: 128,
  footprintLifeMinMs: 3000,
  footprintLifeMaxMs: 4000,
  // Read at normal camera distance: a paw occupies roughly 10 x 14 world pixels.
  footprint: { scale: 1.2, alphaMin: 0.58, alphaMax: 0.7, ink: 0x211c16, inkMix: 0.8 },
  walkDust: { scale: 0.52, alpha: 0.84, count: 3, speedMin: 18, speedMax: 34, lifeFactor: 1 },
  dashDust: {
    // Halve both puff diameter and spread; the shorter tail keeps the dash compact in motion.
    scale: 0.475, alpha: 0.9, trailCount: 3, speedMin: 27.5, speedMax: 47.5, lifeFactor: 0.7,
    playerStartCount: 12, enemyStartCount: 6, playerEndCount: 6, enemyEndCount: 3,
  },
  dustGrowth: 2.4,
  dustTint: 0xebe0c3,
  dustTintMix: 0.68,
  dustLifeMinMs: 450,
  dustLifeMaxMs: 800,
  maxFrameMs: 120,
  cullMargin: 64,
} as const;
