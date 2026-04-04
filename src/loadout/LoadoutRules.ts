import type { GameMode, LoadoutCommitSnapshot } from '../types';
import {
  DEFAULT_LOADOUT,
  sanitizeUltimateForMode,
  ULTIMATE_CONFIGS,
  UTILITY_CONFIGS,
  WEAPON_CONFIGS,
  type UltimateConfig,
  type UtilityConfig,
  type WeaponConfig,
} from './LoadoutConfig';
import type { LoadoutSelection } from './LoadoutManager';

export interface ResolvedLoadoutSelection {
  weapon1: WeaponConfig;
  weapon2: WeaponConfig;
  utility: UtilityConfig;
  ultimate: UltimateConfig;
}

export function sanitizeLoadoutSelectionForMode(
  selection: LoadoutSelection | undefined,
  mode: GameMode,
): ResolvedLoadoutSelection {
  return {
    weapon1: selection?.weapon1 ?? DEFAULT_LOADOUT.weapon1,
    weapon2: selection?.weapon2 ?? DEFAULT_LOADOUT.weapon2,
    utility: selection?.utility ?? DEFAULT_LOADOUT.utility,
    ultimate: sanitizeUltimateForMode(selection?.ultimate, mode),
  };
}

export function resolveLoadoutSelectionIds(selection: LoadoutSelection | undefined, mode: GameMode): LoadoutCommitSnapshot {
  const sanitized = sanitizeLoadoutSelectionForMode(selection, mode);
  return {
    weapon1: sanitized.weapon1.id,
    weapon2: sanitized.weapon2.id,
    utility: sanitized.utility.id,
    ultimate: sanitized.ultimate.id,
  };
}

export function sanitizeCommittedLoadoutForMode(
  snapshot: LoadoutCommitSnapshot | null,
  mode: GameMode,
): LoadoutCommitSnapshot | null {
  if (!snapshot) return null;
  const selection: LoadoutSelection = {
    weapon1: WEAPON_CONFIGS[snapshot.weapon1 as keyof typeof WEAPON_CONFIGS],
    weapon2: WEAPON_CONFIGS[snapshot.weapon2 as keyof typeof WEAPON_CONFIGS],
    utility: UTILITY_CONFIGS[snapshot.utility as keyof typeof UTILITY_CONFIGS],
    ultimate: ULTIMATE_CONFIGS[snapshot.ultimate as keyof typeof ULTIMATE_CONFIGS],
  };
  return resolveLoadoutSelectionIds(selection, mode);
}

export function isCommittedLoadoutEqual(
  left: LoadoutCommitSnapshot | null,
  right: LoadoutCommitSnapshot | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.weapon1 === right.weapon1
    && left.weapon2 === right.weapon2
    && left.utility === right.utility
    && left.ultimate === right.ultimate;
}
