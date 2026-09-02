import {
  getStoredCoopDefenseLoadout,
  getStoredCoopDefenseProgress,
  claimStoredPendingCoopDefenseItemReward,
  equipStoredCoopDefenseItem,
  markStoredCoopDefenseItemsSeen,
  resetStoredCoopDefenseCharacter,
  resetStoredCoopDefenseUpgradeProfiles,
  restoreStoredCoopDefenseProgress,
  salvageStoredCoopDefenseItem,
  setStoredCoopDefenseCheatProgress,
  setStoredCoopDefenseItemsUnlocked,
  setStoredCoopDefenseLoadoutSlot,
  setStoredPendingCoopDefenseItemReward,
  setStoredCoopDefenseUpgradeProfile,
  setStoredLoadoutSlot,
  switchStoredCoopDefenseClassLoadout,
  unequipStoredCoopDefenseItem,
  unlockStoredCoopDefenseItemsAfterVictory,
} from '../../utils/localPreferences';
import type { ArenaMetaProgressStore } from './ArenaMetaController';

/**
 * Adapter fuer den persoenlichen Meta-Stand. Das Persistenzformat und seine Validierung bleiben
 * vollstaendig in `localPreferences`; ArenaMetaController erhaelt nur diesen kleinen Vertrag.
 */
export function createArenaMetaProgressStore(): ArenaMetaProgressStore {
  return {
    getProgress: getStoredCoopDefenseProgress,
    restoreProgress: restoreStoredCoopDefenseProgress,
    getClassLoadout: getStoredCoopDefenseLoadout,
    setClassLoadoutSlot: setStoredCoopDefenseLoadoutSlot,
    setSharedLoadoutSlot: setStoredLoadoutSlot,
    switchClassLoadout: switchStoredCoopDefenseClassLoadout,
    setUpgradeProfile: setStoredCoopDefenseUpgradeProfile,
    resetUpgradeProfiles: resetStoredCoopDefenseUpgradeProfiles,
    setDebugProgress: setStoredCoopDefenseCheatProgress,
    resetCharacter: resetStoredCoopDefenseCharacter,
    setItemsUnlocked: setStoredCoopDefenseItemsUnlocked,
    unlockItemsAfterVictory: unlockStoredCoopDefenseItemsAfterVictory,
    markItemsSeen: markStoredCoopDefenseItemsSeen,
    equipItem: equipStoredCoopDefenseItem,
    unequipItem: unequipStoredCoopDefenseItem,
    salvageItem: salvageStoredCoopDefenseItem,
    setPendingItemReward: setStoredPendingCoopDefenseItemReward,
    claimPendingItemReward: claimStoredPendingCoopDefenseItemReward,
  };
}
