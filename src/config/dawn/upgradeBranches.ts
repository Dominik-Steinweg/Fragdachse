import rawBranches from './upgradeBranches.json';
import rawUpgrades from '../coopDefenseUpgrades.json';

export interface DawnUpgradeBranch {
  readonly id: string;
  readonly rootUpgradeId: string;
}

/** Validate authored references without a dependency on runtime/profile utilities. */
export function validateDawnUpgradeBranches(raw: unknown): readonly DawnUpgradeBranch[] {
  const branches = (raw as { branches?: unknown } | null)?.branches;
  if (!Array.isArray(branches)) throw new Error('Dawn upgrade branches must be an array');
  const upgradeIds = new Set(rawUpgrades.categories.flatMap(category => category.upgrades.map(upgrade => upgrade.id)));
  const ids = new Set<string>();
  const roots = new Set<string>();
  return Object.freeze(branches.map(branch => {
    if (!branch || typeof branch.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(branch.id)
      || ids.has(branch.id) || typeof branch.rootUpgradeId !== 'string'
      || !upgradeIds.has(branch.rootUpgradeId) || roots.has(branch.rootUpgradeId)) {
      throw new Error('Invalid or duplicate Dawn upgrade branch');
    }
    ids.add(branch.id);
    roots.add(branch.rootUpgradeId);
    return Object.freeze({ id: branch.id, rootUpgradeId: branch.rootUpgradeId });
  }));
}

export const DAWN_UPGRADE_BRANCHES = validateDawnUpgradeBranches(rawBranches);
