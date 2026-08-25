import { AUDIO_ASSETS } from '../../audio/AudioCatalog';
import {
  COOP_DEFENSE_CONSTRUCTIONS,
} from '../../config/coopDefenseConstructions';
import { POWERUP_DEFS, TIMED_POWERUP_PEDESTAL_CONFIGS } from '../../powerups/PowerUpConfig';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../../config/coopDefenseEnemies';
import { COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS } from '../../config/coopDefenseItems';
import { COOP_DEFENSE_MAP_CONFIGS } from '../../config/coopDefenseMaps';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS } from '../../utils/coopDefenseUpgrades';
import {
  CONFIG_STAT_DESCRIPTORS,
  type ConfigStatDescriptor,
} from '../CoopDefenseLoadoutModifiers';
import {
  DEFAULT_LOADOUT,
  getUtilityConfigLineage,
  LOADOUT_CATALOG_ENTRIES,
  ULTIMATE_CONFIGS,
  UTILITY_CONFIGS,
  WEAPON_CONFIGS,
} from './LoadoutRegistry';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getFiniteNumberAtPath(root: unknown, path: readonly string[]): number | null {
  let current = root;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) return null;
    current = current[segment];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : null;
}

function hasObjectParentAtPath(root: unknown, path: readonly string[]): boolean {
  let current = root;
  for (const segment of path.slice(0, -1)) {
    if (!isRecord(current) || !isRecord(current[segment])) return false;
    current = current[segment];
  }
  return isRecord(current);
}

function hasPath(root: unknown, path: readonly string[]): boolean {
  let current = root;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) return false;
    current = current[segment];
  }
  return true;
}

function matchingConfigs(descriptor: ConfigStatDescriptor): readonly unknown[] {
  if (descriptor.kind === 'weapon') {
    if (descriptor.itemId) return WEAPON_CONFIGS[descriptor.itemId] ? [WEAPON_CONFIGS[descriptor.itemId]] : [];
    return Object.values(WEAPON_CONFIGS).filter((config) => !descriptor.slot || config.allowedSlots.includes(descriptor.slot));
  }
  if (descriptor.kind === 'utility') {
    if (descriptor.itemId) {
      return Object.values(UTILITY_CONFIGS)
        .filter((config) => getUtilityConfigLineage(config.id).includes(descriptor.itemId!));
    }
    return Object.values(UTILITY_CONFIGS).filter((config) => !descriptor.slot || config.allowedSlots.includes(descriptor.slot));
  }
  if (descriptor.itemId) return ULTIMATE_CONFIGS[descriptor.itemId] ? [ULTIMATE_CONFIGS[descriptor.itemId]] : [];
  return Object.values(ULTIMATE_CONFIGS);
}

function isLoadoutConfigStat(stat: string): boolean {
  return stat.startsWith('weapon1.')
    || stat.startsWith('weapon2.')
    || stat === 'utility.cooldown'
    || /^weapon\.[A-Z0-9_]+\./.test(stat)
    || /^utility\.[A-Z0-9_]+\./.test(stat)
    || /^ultimate\.[A-Z0-9_]+\./.test(stat);
}

function validateShotAudio(config: { readonly id: string; readonly shotAudio?: { readonly successKey: string; readonly failureKey?: string } }, issues: string[]): void {
  for (const [field, key] of Object.entries(config.shotAudio ?? {})) {
    if (!(key in AUDIO_ASSETS)) issues.push(`${config.id}.shotAudio.${field}: unbekannter Audio-Key ${key}`);
  }
}

/** Validates references that intentionally live outside the pure loadout loader. */
export function validateGameContentReferences(): void {
  const issues: string[] = [];

  for (const [enemyId, enemy] of Object.entries(COOP_DEFENSE_ENEMY_CONFIGS)) {
    for (const weapon of enemy.weapons) {
      if (!WEAPON_CONFIGS[weapon.weaponId]) issues.push(`enemy:${enemyId}.weapons: unbekannte Waffe ${weapon.weaponId}`);
    }
    if (enemy.translocator && !UTILITY_CONFIGS[enemy.translocator.utilityId]) {
      issues.push(`enemy:${enemyId}.translocator: unbekanntes Utility ${enemy.translocator.utilityId}`);
    }
    if (enemy.stinkAura && !UTILITY_CONFIGS[enemy.stinkAura.utilityId]) {
      issues.push(`enemy:${enemyId}.stinkAura: unbekanntes Utility ${enemy.stinkAura.utilityId}`);
    }
    const gaussWeaponId = enemy.voidHunterBoss?.gauss.weaponId;
    if (gaussWeaponId && !ULTIMATE_CONFIGS[gaussWeaponId]) {
      issues.push(`enemy:${enemyId}.voidHunterBoss.gauss: unbekanntes Ultimate ${gaussWeaponId}`);
    }
  }

  for (const map of COOP_DEFENSE_MAP_CONFIGS) {
    for (const base of map.bases) {
      for (const turret of base.turrets ?? []) {
        if (!WEAPON_CONFIGS[turret.weaponId]) issues.push(`map:${map.mapId}.base:${base.id}.turret:${turret.id}: unbekannte Waffe ${turret.weaponId}`);
      }
    }
  }

  for (const construction of Object.values(COOP_DEFENSE_CONSTRUCTIONS)) {
    if (construction.kind === 'turret') {
      if (!WEAPON_CONFIGS[construction.weaponId]) issues.push(`construction:${construction.id}: unbekannte Waffe ${construction.weaponId}`);
    } else if (construction.kind === 'pedestal'
      && (!POWERUP_DEFS[construction.powerUpDefId] || !TIMED_POWERUP_PEDESTAL_CONFIGS[construction.powerUpDefId])) {
      issues.push(`construction:${construction.id}: unbekanntes Podest-Power-up ${construction.powerUpDefId}`);
    }
  }

  for (const utility of Object.values(UTILITY_CONFIGS)) {
    if (utility.type === 'placeable_turret' && !WEAPON_CONFIGS[utility.weaponId]) {
      issues.push(`utility:${utility.id}.weaponId: unbekannte Waffe ${utility.weaponId}`);
    }
  }

  for (const upgrade of Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)) {
    const unlock = upgrade.loadoutUnlock;
    if (unlock) {
      const config = unlock.slot === 'utility'
        ? UTILITY_CONFIGS[unlock.itemId]
        : unlock.slot === 'ultimate'
          ? ULTIMATE_CONFIGS[unlock.itemId]
          : WEAPON_CONFIGS[unlock.itemId];
      if (!config) issues.push(`upgrade:${upgrade.id}.loadoutUnlock: unbekannte ID ${unlock.itemId}`);
      if (unlock.slot !== 'ultimate' && config && 'allowedSlots' in config && !config.allowedSlots.includes(unlock.slot)) {
        issues.push(`upgrade:${upgrade.id}.loadoutUnlock: ${unlock.itemId} ist nicht für ${unlock.slot} erlaubt`);
      }
    }

    for (const effect of upgrade.effects) {
      if (!isLoadoutConfigStat(effect.stat)) continue;
      const descriptor = CONFIG_STAT_DESCRIPTORS[effect.stat];
      if (!descriptor) {
        issues.push(`upgrade:${upgrade.id}.effects.${effect.stat}: expliziter Modifier-Descriptor fehlt`);
        continue;
      }
      const requiredOperation = effect.mode === 'add_per_level' ? 'additive' : 'percentage';
      const supportsOperation = descriptor.targets.every((target) => (
        target.formula === 'add'
          ? requiredOperation === 'additive'
          : requiredOperation === 'additive' || requiredOperation === 'percentage'
      ));
      if (!supportsOperation) {
        issues.push(`upgrade:${upgrade.id}.effects.${effect.stat}: ${requiredOperation} ist für mindestens einen Zielpfad nicht erlaubt`);
      }
    }
  }

  for (const affix of COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS) {
    if (!affix.stat || !isLoadoutConfigStat(affix.stat)) continue;
    const descriptor = CONFIG_STAT_DESCRIPTORS[affix.stat];
    if (!descriptor) {
      issues.push(`item-affix:${affix.id}.${affix.stat}: expliziter Modifier-Descriptor fehlt`);
      continue;
    }
    const requiredOperation = affix.mode === 'add_per_level' ? 'additive' : 'percentage';
    if (descriptor.targets.some((target) => target.formula === 'add' && requiredOperation === 'percentage')) {
      issues.push(`item-affix:${affix.id}.${affix.stat}: ${requiredOperation} ist nicht erlaubt`);
    }
  }

  for (const [stat, descriptor] of Object.entries(CONFIG_STAT_DESCRIPTORS)) {
    const configs = matchingConfigs(descriptor);
    if (configs.length === 0) {
      issues.push(`modifier:${stat}: adressiert keine Config`);
      continue;
    }
    for (const target of descriptor.targets) {
      for (const config of configs) {
        if (getFiniteNumberAtPath(config, target.path) !== null
          || (target.createIfMissing && hasObjectParentAtPath(config, target.path))
          || (target.optionalWhenMissing && !hasPath(config, target.path))) continue;
        const configId = isRecord(config) && typeof config.id === 'string' ? config.id : '?';
        issues.push(`modifier:${stat}.${target.path.join('.')}:${configId}: kein numerischer Zielpfad`);
      }
    }
  }

  for (const config of Object.values(WEAPON_CONFIGS)) validateShotAudio(config, issues);
  for (const config of Object.values(UTILITY_CONFIGS)) validateShotAudio(config, issues);
  for (const config of Object.values(ULTIMATE_CONFIGS)) validateShotAudio(config, issues);

  const requiredWeapons = ['SPORES', 'BASE_SPORES', 'TURRET_SPORES'];
  const requiredUtilities = [
    'HE_GRENADE', 'SPORE_TURRET', 'ROCK_BARRIER',
    'BFG', 'NUKE', 'HOLY_HAND_GRENADE',
  ];
  const requiredUltimates = ['ARMAGEDDON', 'HONEY_BADGER_RAGE', 'DACHS_TUNNEL', 'VOID_HUNTER_GAUSS'];
  for (const id of requiredWeapons) if (!WEAPON_CONFIGS[id]) issues.push(`system-fallback: fehlende Waffe ${id}`);
  for (const id of requiredUtilities) if (!UTILITY_CONFIGS[id]) issues.push(`system-fallback: fehlendes Utility ${id}`);
  for (const id of requiredUltimates) if (!ULTIMATE_CONFIGS[id]) issues.push(`system-fallback: fehlendes Ultimate ${id}`);

  if (DEFAULT_LOADOUT.weapon1 !== WEAPON_CONFIGS[DEFAULT_LOADOUT.weapon1.id]
    || DEFAULT_LOADOUT.weapon2 !== WEAPON_CONFIGS[DEFAULT_LOADOUT.weapon2.id]
    || DEFAULT_LOADOUT.utility !== UTILITY_CONFIGS[DEFAULT_LOADOUT.utility.id]
    || DEFAULT_LOADOUT.ultimate !== ULTIMATE_CONFIGS[DEFAULT_LOADOUT.ultimate.id]) {
    issues.push('defaultLoadout: Einträge sind nicht identisch mit den Registry-Objekten');
  }

  const catalogKeys = new Set(LOADOUT_CATALOG_ENTRIES.map((entry) => `${entry.slot}:${entry.id}`));
  for (const config of Object.values(WEAPON_CONFIGS)) {
    for (const slot of config.allowedSlots) if (!catalogKeys.has(`${slot}:${config.id}`)) issues.push(`catalog:${config.id}: Eintrag für ${slot} fehlt`);
  }
  for (const config of Object.values(UTILITY_CONFIGS)) {
    const lineage = getUtilityConfigLineage(config.id);
    const catalogBaseId = lineage[lineage.length - 1] ?? config.id;
    for (const slot of config.allowedSlots) {
      if (!catalogKeys.has(`${slot}:${config.id}`) && !catalogKeys.has(`${slot}:${catalogBaseId}`)) {
        issues.push(`catalog:${config.id}: Eintrag für ${slot} fehlt`);
      }
    }
  }
  for (const config of Object.values(ULTIMATE_CONFIGS)) {
    if (config.catalogVisible !== false && !catalogKeys.has(`ultimate:${config.id}`)) {
      issues.push(`catalog:${config.id}: Ultimate-Eintrag fehlt`);
    }
  }

  if (issues.length > 0) throw new Error(`[game-content] ${issues.length} Referenzfehler:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
}
