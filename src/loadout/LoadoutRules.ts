import { DEFAULT_COOP_DEFENSE_CLASS_ID } from '../config/coopDefenseClasses';
import type { CoopDefenseClassId, CoopDefenseItem, CoopDefenseUpgradeProfile, GameMode, LoadoutCommitSnapshot } from '../types';
import { isCoopDefenseMode } from '../gameModes';
import { getCoopDefenseCommittedEffectTotals } from '../utils/coopDefenseItemEffects';
import { isCoopDefenseUpgradeProfileEqual, sanitizeCoopDefenseUpgradeProfile } from '../utils/coopDefenseUpgrades';
import { applyCoopDefenseModifiersToLoadoutSelection } from './CoopDefenseLoadoutModifiers';
import { getSelectableLoadoutItems } from './LoadoutCatalog';
import {
  DEFAULT_LOADOUT,
  getUtilityConfigForMode,
  sanitizeUltimateForMode,
  sanitizeWeaponForMode,
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

function areSemanticValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => areSemanticValuesEqual(entry, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && areSemanticValuesEqual(leftRecord[key], rightRecord[key]));
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
    && areSemanticValuesEqual(current, next);
}

export function sanitizeLoadoutSelectionForMode(
  selection: LoadoutSelection | undefined,
  mode: GameMode,
): ResolvedLoadoutSelection {
  const utility = getUtilityConfigForMode(selection?.utility ?? DEFAULT_LOADOUT.utility, mode)
    ?? DEFAULT_LOADOUT.utility;
  return {
    weapon1: sanitizeWeaponForMode(selection?.weapon1, 'weapon1', mode),
    weapon2: sanitizeWeaponForMode(selection?.weapon2, 'weapon2', mode),
    utility,
    ultimate: sanitizeUltimateForMode(selection?.ultimate, mode),
  };
}

/**
 * Loadout inklusive aller Coop-Defense-Modifikatoren.
 *
 * Upgrades **und** ausgeruestete Items laufen ueber denselben Einstiegspunkt wie im
 * `CoopDefensePlayerModifierSystem`, damit ein Item-Affix wie der Utility-Cooldown schon die
 * initial ausgeruestete Utility trifft und nicht erst eine spaetere Neuaufloesung. Ausruestung
 * wirkt dabei auch ohne Upgrade-Profil – nur ohne beides gibt es nichts zu modifizieren.
 */
export function resolveEffectiveLoadoutSelection(
  selection: LoadoutSelection | undefined,
  mode: GameMode,
  coopDefenseProfile: CoopDefenseUpgradeProfile | null = null,
  coopDefenseClassId: CoopDefenseClassId | null = null,
  equippedItems: readonly CoopDefenseItem[] = [],
): ResolvedLoadoutSelection {
  const sanitized = sanitizeLoadoutSelectionForMode(selection, mode);
  if (!isCoopDefenseMode(mode) || (!coopDefenseProfile && equippedItems.length === 0)) return sanitized;
  return applyCoopDefenseModifiersToLoadoutSelection(
    sanitized,
    getCoopDefenseCommittedEffectTotals(
      coopDefenseProfile
        ? sanitizeCoopDefenseUpgradeProfile(coopDefenseProfile, coopDefenseClassId ?? undefined)
        : null,
      coopDefenseClassId,
      equippedItems,
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
  const selectableWeapon2 = committedCoopDefenseProfile
    ? getSelectableLoadoutItems(
      'weapon2',
      mode,
      committedCoopDefenseProfile,
      coopDefenseClassId ?? DEFAULT_COOP_DEFENSE_CLASS_ID,
    )
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
 * Insbesondere traegt der Inspector mit dem Plasmabrenner eine echte Waffen-ID statt `null`.
 */
export function isCoopDefenseReadyLoadoutComplete(snapshot: LoadoutCommitSnapshot): boolean {
  const { coopDefenseClassId: classId, coopDefenseProfile: profile, weapon2 } = snapshot;
  return profile != null
    && weapon2 != null
    && getSelectableLoadoutItems(
      'weapon2',
      'coop_defense',
      profile,
      classId ?? DEFAULT_COOP_DEFENSE_CLASS_ID,
    )
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
    && (left.tools ?? []).length === (right.tools ?? []).length
    && (left.tools ?? []).every((tool, index) => {
      const other = (right.tools ?? [])[index];
      return tool.kind === other?.kind && tool.id === other.id;
    })
    && isCoopDefenseUpgradeProfileEqual(
      left.coopDefenseProfile,
      right.coopDefenseProfile,
      left.coopDefenseClassId ?? undefined,
    );
}
