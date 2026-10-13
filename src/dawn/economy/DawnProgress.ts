import { DAWN_UPGRADE_BRANCHES } from '../../config/dawn/upgradeBranches';

// Storage bounds, not economy tuning. Leave headroom for sums of independently earned points.
export const DAWN_MAX_SCRAP = 2_147_483_647;
export const DAWN_MAX_PURCHASED_BOSS_POINTS = 2_147_483_647;
export const DAWN_MAX_EXPANSION_LEVEL = 9;

export interface DawnProgress {
  scrap: number;
  expansionLevel: number;
  purchasedBossPoints: number;
  unlockedBranchIds: string[];
  infrastructure: Record<string, number>;
  crafting: { recalibrationCores: number };
  stats: { roundsPlayed: number; victories: number; defeats: number; currentStreak: number; bestStreak: number };
  notices: { necromancyMovedToMerchant: boolean };
}

export function createDefaultDawnProgress(): DawnProgress {
  return {
    scrap: 0, expansionLevel: 0, purchasedBossPoints: 0, unlockedBranchIds: [], infrastructure: {},
    crafting: { recalibrationCores: 0 },
    stats: { roundsPlayed: 0, victories: 0, defeats: 0, currentStreak: 0, bestStreak: 0 },
    notices: { necromancyMovedToMerchant: false },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCounter(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

/** The current subdocument is required; omitted fields are optional and default individually. */
export function sanitizeDawnProgress(raw: unknown): DawnProgress | null {
  if (!isRecord(raw)) return null;
  const result = createDefaultDawnProgress();
  for (const [key, max] of [
    ['scrap', DAWN_MAX_SCRAP], ['expansionLevel', DAWN_MAX_EXPANSION_LEVEL],
    ['purchasedBossPoints', DAWN_MAX_PURCHASED_BOSS_POINTS],
  ] as const) {
    if (raw[key] === undefined) continue;
    if (!isCounter(raw[key], max)) return null;
    result[key] = raw[key];
  }
  if (raw.unlockedBranchIds !== undefined) {
    const ids = raw.unlockedBranchIds;
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) return null;
    // A branch retired from the registry must not invalidate the whole personal progress.
    result.unlockedBranchIds = [...new Set<string>(ids)]
      .filter(id => DAWN_UPGRADE_BRANCHES.some(branch => branch.id === id))
      .sort();
  }
  if (raw.infrastructure !== undefined) {
    if (!isRecord(raw.infrastructure)) return null;
    for (const [id, level] of Object.entries(raw.infrastructure)) {
      if (!/^[a-z][a-z0-9-]{0,47}$/.test(id) || !isCounter(level, 10)) return null;
      Object.defineProperty(result.infrastructure, id, { value: level, enumerable: true, writable: true, configurable: true });
    }
  }
  for (const key of ['crafting', 'stats'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!isRecord(value)) return null;
    const target: Record<string, number> = result[key];
    for (const field of Object.keys(target)) {
      if (value[field] === undefined) continue;
      if (!isCounter(value[field])) return null;
      target[field] = value[field];
    }
  }
  if (raw.notices !== undefined) {
    if (!isRecord(raw.notices)) return null;
    const notice = raw.notices.necromancyMovedToMerchant;
    if (notice !== undefined && typeof notice !== 'boolean') return null;
    result.notices.necromancyMovedToMerchant = notice ?? false;
  }
  return result;
}
