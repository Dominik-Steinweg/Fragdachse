/**
 * Gemeinsamer Katalog fuer die Darstellung und Auswahl von Loadout-Items.
 *
 * Vorher lagen Item-Listen, Icon-Schluessel, Anzeigenamen und Akzentfarben verstreut im
 * Lobby-Karussell, im Upgrade-Overlay und im Utility-Rad – jeweils als identische Ad-hoc-Ausdruecke.
 * Dieses Modul ist die eine Quelle dafuer; UI-Code fragt nur noch hier.
 */
import { COLORS } from '../config';
import { getCoopDefenseConstructionDefinition } from '../config/coopDefenseConstructions';
import { isCoopDefenseMode } from '../gameModes';
import type {
  CoopDefenseClassId,
  CoopDefenseUpgradeProfile,
  GameMode,
  LoadoutSlot,
  LoadoutToolRef,
} from '../types';
import {
  getCoopDefenseUpgradeTextureKey,
  hasCoopDefenseDedicatedUpgradeIcon,
  isCoopDefenseLoadoutItemSelectable,
} from '../utils/coopDefenseUpgrades';
import {
  DEFAULT_LOADOUT,
  getAvailableUltimateConfigs,
  LOADOUT_CATALOG_ENTRIES,
  isWeaponAllowedInMode,
  ULTIMATE_CONFIGS,
  UTILITY_CONFIGS,
  WEAPON_CONFIGS,
} from './LoadoutConfig';

/** Minimalbeschreibung eines waehlbaren Loadout-Items. */
export interface LoadoutItemRef {
  readonly id: string;
  readonly displayName: string;
}

/** Alles, was die UI zum Zeichnen eines Loadout-Eintrags braucht. */
export interface LoadoutItemPresentation {
  readonly displayName: string;
  /** Texture-Key; fehlt die Textur, zeigt die UI den Anzeigenamen als Fallback. */
  readonly textureKey: string | null;
  readonly accentColor: number;
}

/** Deutsche Slot-Bezeichnungen (Lobby-Karussell und Upgrade-Overlay teilen sie). */
export const LOADOUT_SLOT_LABELS: Record<LoadoutSlot, string> = {
  weapon1: 'Waffe 1',
  weapon2: 'Waffe 2',
  utility: 'Utility',
  ultimate: 'Ultimate',
};

/** Die vier Coop-Ultimates haben im Upgrade-Baum eigene Symbole, die auch im Slot gelten. */
const COOP_DEFENSE_ULTIMATE_UNLOCK_BY_ITEM_ID: Readonly<Record<string, string>> = Object.freeze({
  ARMAGEDDON: 'unlock_armageddon',
  GAUSS_RIFLE: 'unlock_gauss_rifle',
  AIRSTRIKE: 'unlock_airstrike',
  HONEY_BADGER_RAGE: 'unlock_honey_badger_rage',
});

/** Die drei Inspector-Supportwaffen verwenden im Waffe-2-Slot ebenfalls ihre Upgrade-Symbole. */
const INSPECTOR_WEAPON2_UNLOCK_BY_ITEM_ID: Readonly<Record<string, string>> = Object.freeze({
  REPARATURSTRAHL: 'unlock_reparaturstrahl',
  OVERCHARGE_CORE: 'unlock_overcharge_core',
  ENERGIEINJEKTOR: 'unlock_energieinjektor',
});

function buildStaticSlotItems(slot: Exclude<LoadoutSlot, 'ultimate'>): readonly LoadoutItemRef[] {
  const configs: LoadoutItemRef[] = [];
  for (const entry of LOADOUT_CATALOG_ENTRIES) {
    if (entry.slot !== slot) continue;
    if (entry.kind === 'utility') {
      const config = UTILITY_CONFIGS[entry.id];
      if (config) configs.push(config);
      continue;
    }
    const config = WEAPON_CONFIGS[entry.id];
    if (config) configs.push(config);
  }
  return configs;
}

const STATIC_SLOT_ITEMS: Record<Exclude<LoadoutSlot, 'ultimate'>, readonly LoadoutItemRef[]> = {
  weapon1: buildStaticSlotItems('weapon1'),
  weapon2: buildStaticSlotItems('weapon2'),
  utility: buildStaticSlotItems('utility'),
};

/** Alle im Modus grundsaetzlich waehlbaren Items eines Slots, ohne Freischaltungsfilter. */
export function getLoadoutSlotItems(slot: LoadoutSlot, mode: GameMode): readonly LoadoutItemRef[] {
  if (slot === 'ultimate') return getAvailableUltimateConfigs(mode);
  return STATIC_SLOT_ITEMS[slot].filter((item) => {
    if (slot === 'utility') return true;
    const config = WEAPON_CONFIGS[item.id as keyof typeof WEAPON_CONFIGS];
    return config !== undefined && isWeaponAllowedInMode(config, mode);
  });
}

/**
 * Im Coop-Defense zusaetzlich auf freigeschaltete Items gefiltert. Die Liste ist nie leer:
 * faellt alles weg, bleibt das Default-Item des Slots uebrig, damit kein Slot unbesetzt ist.
 */
export function getSelectableLoadoutItems(
  slot: LoadoutSlot,
  mode: GameMode,
  profile: CoopDefenseUpgradeProfile | null,
  classId: CoopDefenseClassId,
): readonly LoadoutItemRef[] {
  const base = getLoadoutSlotItems(slot, mode);
  if (!isCoopDefenseMode(mode) || !profile) return base;

  const filtered = base.filter((item) => isCoopDefenseLoadoutItemSelectable(profile, slot, item.id, classId));
  if (filtered.length > 0) return filtered;

  const fallback = DEFAULT_LOADOUT[slot];
  return [{ id: fallback.id, displayName: fallback.displayName }];
}

/** Anzeigename eines Items, unabhaengig davon, in welcher Config es steht. */
export function getLoadoutItemDisplayName(slot: LoadoutSlot, itemId: string): string {
  const config = slot === 'ultimate'
    ? ULTIMATE_CONFIGS[itemId as keyof typeof ULTIMATE_CONFIGS]
    : slot === 'utility'
      ? UTILITY_CONFIGS[itemId as keyof typeof UTILITY_CONFIGS]
      : WEAPON_CONFIGS[itemId as keyof typeof WEAPON_CONFIGS];
  return config?.displayName ?? itemId.replace(/_/g, ' ');
}

const SLOT_ACCENT_COLORS: Record<LoadoutSlot, number> = {
  weapon1: COLORS.BLUE_2,
  weapon2: COLORS.BLUE_3,
  utility: COLORS.GOLD_2,
  ultimate: COLORS.RED_2,
};

export function describeLoadoutItem(slot: LoadoutSlot, itemId: string): LoadoutItemPresentation {
  const metadata = LOADOUT_CATALOG_ENTRIES.find((entry) => entry.slot === slot && entry.id === itemId);
  const dedicatedUnlockId = slot === 'ultimate'
    ? COOP_DEFENSE_ULTIMATE_UNLOCK_BY_ITEM_ID[itemId]
    : slot === 'weapon2'
      ? INSPECTOR_WEAPON2_UNLOCK_BY_ITEM_ID[itemId]
      : undefined;
  const dedicatedTextureKey = dedicatedUnlockId && hasCoopDefenseDedicatedUpgradeIcon(dedicatedUnlockId)
    ? getCoopDefenseUpgradeTextureKey(dedicatedUnlockId)
    : null;
  return {
    displayName: getLoadoutItemDisplayName(slot, itemId),
    textureKey: dedicatedTextureKey ?? metadata?.iconKey ?? null,
    accentColor: SLOT_ACCENT_COLORS[slot],
  };
}

/**
 * Konstruktionen und Utilities belegen dieselben Slots. Beide Herkuenfte sind gleichwertig
 * und tragen deshalb dieselbe Akzentfarbe wie regulaere Utilities.
 */
export function describeLoadoutTool(tool: LoadoutToolRef): LoadoutItemPresentation {
  if (tool.kind === 'construction') {
    const definition = getCoopDefenseConstructionDefinition(tool.id);
    return {
      displayName: definition.displayName,
      // Slot und Unlock-Knoten teilen das dedizierte, mechanikbasierte Upgrade-Icon.
      textureKey: definition.iconKey ?? getCoopDefenseUpgradeTextureKey(definition.unlockUpgradeId),
      accentColor: COLORS.GOLD_2,
    };
  }
  return {
    displayName: getLoadoutItemDisplayName('utility', tool.id),
    textureKey: tool.id,
    accentColor: COLORS.GOLD_2,
  };
}

/** Stabiler Schluessel eines Utility-Slot-Eintrags fuer Vergleiche und Sets. */
export function loadoutToolKey(tool: LoadoutToolRef | null | undefined): string {
  return tool ? `${tool.kind}:${tool.id}` : '';
}
