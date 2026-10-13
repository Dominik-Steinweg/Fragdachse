import { COOP_DEFENSE_CLASS_IDS } from '../src/config/coopDefenseClasses';
import { LOADOUT_CATALOG_ENTRIES, resolveUtilityIdForMode } from '../src/loadout/LoadoutConfig';
import { getCoopDefenseLoadoutUnlockUpgradeId, isCoopDefenseUpgradeAvailableForClass } from '../src/utils/coopDefenseUpgrades';

/**
 * Katalogeinträge, die ein Spieler tatsächlich ausrüsten kann. Bildverträge (Held-Item-Sprites, Modelle)
 * gelten nur für sie; eine Coop-Utility, deren Freischaltung noch keiner Klasse offensteht, fällt heraus.
 */
export const EQUIPABLE_LOADOUT_CATALOG_ENTRIES = LOADOUT_CATALOG_ENTRIES.filter(entry => {
  if (entry.kind !== 'utility' || resolveUtilityIdForMode(entry.id, 'deathmatch')) return true;
  const unlockId = getCoopDefenseLoadoutUnlockUpgradeId('utility', entry.id);
  return unlockId !== null && COOP_DEFENSE_CLASS_IDS.some(classId =>
    isCoopDefenseUpgradeAvailableForClass(unlockId, classId));
});
