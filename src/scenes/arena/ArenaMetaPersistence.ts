import {
  getStoredCoopDefenseLoadout,
  getStoredCoopDefenseProgress,
  resetStoredCoopDefenseCharacter,
  resetStoredCoopDefenseUpgradeProfiles,
  restoreStoredCoopDefenseProgress,
  setStoredCoopDefenseCheatProgress,
  setStoredCoopDefenseLoadoutSlot,
  setStoredCoopDefenseUpgradeProfile,
  setStoredLoadoutSlot,
  switchStoredCoopDefenseClassLoadout,
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
  };
}
