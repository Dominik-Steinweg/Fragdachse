import type { CoopDefenseClassId, CoopDefenseUpgradeProfile, GameMode, LoadoutCommitSnapshot } from '../types';
import { isCoopDefenseMode } from '../gameModes';
import { getCoopDefenseResolvedEffectTotals, isCoopDefenseUpgradeProfileEqual, sanitizeCoopDefenseUpgradeProfile } from '../utils/coopDefenseUpgrades';
import { applyCoopDefenseModifiersToLoadoutSelection } from './CoopDefenseLoadoutModifiers';
import { getSelectableLoadoutItems } from './LoadoutCatalog';
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

/**
 * Loadout-Konfigurationen sind reine, serialisierbare Datenobjekte. Ein ID-Vergleich
 * reicht im Coop-Modus nicht aus, weil Upgrades dieselbe Basiswaffe um effektive
 * Werte und Effekte erweitern. Referenzgleichheit hält den normalen Pfad günstig;
 * nur neu aufgelöste Konfigurationen benötigen den strukturellen Vergleich.
 */
export function areLoadoutConfigsEquivalent<T extends { id: string }>(
  current: T | undefined,
  next: T,
): boolean {
  if (current === next) return true;
  return current?.id === next.id
    && JSON.stringify(current) === JSON.stringify(next);
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

export function resolveEffectiveLoadoutSelection(
  selection: LoadoutSelection | undefined,
  mode: GameMode,
  coopDefenseProfile: CoopDefenseUpgradeProfile | null = null,
  coopDefenseClassId: CoopDefenseClassId | null = null,
): ResolvedLoadoutSelection {
  const sanitized = sanitizeLoadoutSelectionForMode(selection, mode);
  if (!isCoopDefenseMode(mode) || !coopDefenseProfile) return sanitized;
  return applyCoopDefenseModifiersToLoadoutSelection(
    sanitized,
    getCoopDefenseResolvedEffectTotals(
      sanitizeCoopDefenseUpgradeProfile(coopDefenseProfile, coopDefenseClassId ?? undefined),
      coopDefenseClassId ?? undefined,
    ),
  );
}

export function resolveLoadoutSelectionIds(
  selection: LoadoutSelection | undefined,
  mode: GameMode,
  coopDefenseProfile: CoopDefenseUpgradeProfile | null = null,
  coopDefenseClassId: CoopDefenseClassId | null = null,
): LoadoutCommitSnapshot {
  const sanitized = sanitizeLoadoutSelectionForMode(selection, mode);
  const committedCoopDefenseProfile = isCoopDefenseMode(mode) && coopDefenseProfile
    ? sanitizeCoopDefenseUpgradeProfile(coopDefenseProfile, coopDefenseClassId ?? undefined)
    : null;
  const selectableWeapon2 = committedCoopDefenseProfile && coopDefenseClassId
    ? getSelectableLoadoutItems('weapon2', mode, committedCoopDefenseProfile, coopDefenseClassId)
    : [];
  const committedWeapon2 = selectableWeapon2.find((item) => item.id === sanitized.weapon2.id)
    ?? selectableWeapon2[0]
    ?? sanitized.weapon2;
  return {
    weapon1: sanitized.weapon1.id,
    weapon2: committedWeapon2.id,
    utility: sanitized.utility.id,
    ultimate: sanitized.ultimate.id,
    coopDefenseClassId: isCoopDefenseMode(mode) ? coopDefenseClassId : null,
    coopDefenseProfile: committedCoopDefenseProfile,
    tools: coopDefenseClassId === 'inspector_gadachs'
      ? committedCoopDefenseProfile?.toolLoadout?.map((tool) => ({ ...tool }))
      : undefined,
  };
}

/**
 * Verbindlicher Coop-Ready-Vertrag fuer den klassenabhaengigen Waffe-2-Slot.
 * Insbesondere traegt der Inspector seit dem Ueberladungskern eine echte Waffen-ID statt `null`.
 */
export function isCoopDefenseReadyLoadoutComplete(snapshot: LoadoutCommitSnapshot): boolean {
  const { coopDefenseClassId: classId, coopDefenseProfile: profile, weapon2 } = snapshot;
  return profile != null
    && classId != null
    && weapon2 != null
    && getSelectableLoadoutItems('weapon2', 'coop_defense', profile, classId)
      .some((item) => item.id === weapon2);
}

export function sanitizeCommittedLoadoutForMode(
  snapshot: LoadoutCommitSnapshot | null,
  mode: GameMode,
): LoadoutCommitSnapshot | null {
  if (!snapshot) return null;
  const selection: LoadoutSelection = {
    weapon1: WEAPON_CONFIGS[snapshot.weapon1 as keyof typeof WEAPON_CONFIGS],
    weapon2: snapshot.weapon2
      ? WEAPON_CONFIGS[snapshot.weapon2 as keyof typeof WEAPON_CONFIGS]
      : undefined,
    utility: UTILITY_CONFIGS[snapshot.utility as keyof typeof UTILITY_CONFIGS],
    ultimate: ULTIMATE_CONFIGS[snapshot.ultimate as keyof typeof ULTIMATE_CONFIGS],
  };
  return resolveLoadoutSelectionIds(
    selection,
    mode,
    snapshot.coopDefenseProfile,
    snapshot.coopDefenseClassId,
  );
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
    && left.ultimate === right.ultimate
    && left.coopDefenseClassId === right.coopDefenseClassId
    && JSON.stringify(left.tools ?? []) === JSON.stringify(right.tools ?? [])
    && isCoopDefenseUpgradeProfileEqual(
      left.coopDefenseProfile,
      right.coopDefenseProfile,
      left.coopDefenseClassId ?? undefined,
    );
}
