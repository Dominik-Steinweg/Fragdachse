import {
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  getCoopDefenseUpgradeLoadoutSelection,
  getCoopDefenseLoadoutUnlockUpgradeId,
  sanitizeCoopDefenseUpgradeProfile,
} from '../../utils/coopDefenseUpgrades';
import { DEFAULT_COOP_DEFENSE_CLASS_ID } from '../../config/coopDefenseClasses';
import type {
  CoopDefenseClassId,
  CoopDefenseUpgradeProfile,
  WeaponSlot,
} from '../../types';

export interface WeaponUpgradeBuild {
  readonly weaponId: string;
  readonly slot: WeaponSlot;
  readonly levels: Readonly<Record<string, number>>;
  readonly spentNormalPoints: number;
  readonly spentBossPoints: number;
  readonly signature: string;
  readonly profile: CoopDefenseUpgradeProfile;
}

export interface GenerateBuildsOptions {
  readonly weaponId: string;
  readonly slot: WeaponSlot;
  readonly normalPointBudget: number;
  readonly bossPointBudget: number;
  readonly classId?: CoopDefenseClassId;
}

/**
 * Erzeugt alle legal erreichbaren waffenspezifischen Upgrade-Builds für das gegebene Punktebudget.
 *
 * Regeln:
 * - Der Waffen-Unlock gilt als vorausgesetzt und kostet 0 Punkte des Stage-Budgets.
 * - Ausschließlich Upgrades, die dieser (slot, weaponId)-Kombination zugeordnet sind, werden berücksichtigt.
 * - Echte Profil-Sanitization prüft alle Abhängigkeiten und Maximal-Level.
 * - Kanonische Signaturen verhindern kombinatorische Permutationsduplikate.
 */
export function generateWeaponUpgradeBuilds(
  options: GenerateBuildsOptions,
): readonly WeaponUpgradeBuild[] {
  const {
    weaponId,
    slot,
    normalPointBudget,
    bossPointBudget,
    classId = DEFAULT_COOP_DEFENSE_CLASS_ID,
  } = options;

  // 1. Alle zugehörigen Upgrades entdecken
  const weaponUpgrades = Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS).filter((def) => {
    const target = getCoopDefenseUpgradeLoadoutSelection(def.id);
    return target !== null && target.slot === slot && target.itemId === weaponId;
  });

  const unlockUpgradeId = getCoopDefenseLoadoutUnlockUpgradeId(slot, weaponId);
  const actionableUpgrades = weaponUpgrades
    .filter((def) => def.id !== unlockUpgradeId)
    .sort((a, b) => a.id.localeCompare(b.id));

  // 2. Evaluator für eine gegebene Level-Kombination
  function evaluateLevels(levels: Record<string, number>): {
    signature: string;
    normalPoints: number;
    bossPoints: number;
    profile: CoopDefenseUpgradeProfile;
    sanitizedLevels: Record<string, number>;
  } {
    const rawProfileUpgrades: Record<string, { unlocked: boolean; level: number }> = {};
    if (unlockUpgradeId) {
      rawProfileUpgrades[unlockUpgradeId] = { unlocked: true, level: 1 };
    }
    for (const [id, lvl] of Object.entries(levels)) {
      if (lvl > 0) {
        rawProfileUpgrades[id] = { unlocked: true, level: lvl };
      }
    }

    const profile = sanitizeCoopDefenseUpgradeProfile({ upgrades: rawProfileUpgrades }, classId);

    let normalPoints = 0;
    let bossPoints = 0;
    const sigParts: string[] = [];
    const sanitizedLevels: Record<string, number> = {};

    for (const def of actionableUpgrades) {
      const lvl = profile.upgrades[def.id]?.level ?? 0;
      if (lvl > 0) {
        const paidLevels = Math.max(0, lvl - def.startingLevel);
        normalPoints += paidLevels * def.costPerLevel;
        bossPoints += paidLevels * def.bossPointCostPerLevel;
        sigParts.push(`${def.id}:${lvl}`);
        sanitizedLevels[def.id] = lvl;
      }
    }

    sigParts.sort();
    const signature = sigParts.length > 0 ? sigParts.join('|') : 'base';
    return { signature, normalPoints, bossPoints, profile, sanitizedLevels };
  }

  // 3. Breitensuche über alle legalen Upgrades
  const queue: Array<Record<string, number>> = [{}];
  const visited = new Set<string>();
  const results: WeaponUpgradeBuild[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const info = evaluateLevels(current);

    if (visited.has(info.signature)) {
      continue;
    }
    visited.add(info.signature);

    results.push({
      weaponId,
      slot,
      levels: info.sanitizedLevels,
      spentNormalPoints: info.normalPoints,
      spentBossPoints: info.bossPoints,
      signature: info.signature,
      profile: info.profile,
    });

    // Nachbarn erkunden
    for (const def of actionableUpgrades) {
      const currentLevel = info.sanitizedLevels[def.id] ?? 0;
      if (currentLevel < def.maxLevel) {
        const next = { ...info.sanitizedLevels, [def.id]: currentLevel + 1 };
        const nextInfo = evaluateLevels(next);
        const nextLevel = nextInfo.sanitizedLevels[def.id] ?? 0;

        // Prüfen, ob der Level-Aufstieg legal war und Budgets eingehalten werden
        if (nextLevel > currentLevel) {
          if (
            nextInfo.normalPoints <= normalPointBudget
            && nextInfo.bossPoints <= bossPointBudget
          ) {
            if (!visited.has(nextInfo.signature)) {
              queue.push(nextInfo.sanitizedLevels);
            }
          }
        }
      }
    }
  }

  return results;
}
