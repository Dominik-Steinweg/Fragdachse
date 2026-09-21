import { resolveCoopDefenseEnemyConfigs, type ResolvedCoopDefenseEnemyConfig } from './coopDefenseEnemies';

export interface EnemyLifecycleTotals {
  count: number;
  hp: number;
  xp: number;
  directXp: number;
  followXp: number;
  enemyKinds: Set<string>;
  mechanicTags: Set<string>;
  dynamic: boolean;
  complete: boolean;
  issues: string[];
}

export function emptyEnemyLifecycleTotals(): EnemyLifecycleTotals {
  return { count: 0, hp: 0, xp: 0, directXp: 0, followXp: 0, enemyKinds: new Set(),
    mechanicTags: new Set(), dynamic: false, complete: true, issues: [] };
}

function mechanicTags(config: ResolvedCoopDefenseEnemyConfig): Set<string> {
  const tags = new Set<string>();
  if (config.deathSpawns?.length) tags.add('deathSpawns');
  for (const key of ['spawnThrow', 'dodge', 'burrow', 'timebomb', 'translocator', 'combatPositioning'] as const) {
    if (config[key]) tags.add(key);
  }
  if (config.voidHunterBoss) tags.add('boss-phases');
  if (config.voidFireChunks || config.voidFireTrail || config.voidMolotov) tags.add('void-fire');
  if (config.stinkAura) tags.add('stink-aura');
  if (config.weapons.some(weapon => weapon.salvo)) tags.add('salvo');
  return tags;
}

/** Fixed lifecycle potential; runtime summons are deliberately not extrapolated. */
export function resolveEnemyLifecycleTotals(
  kind: string,
  enemies: Record<string, ResolvedCoopDefenseEnemyConfig> = resolveCoopDefenseEnemyConfigs(1),
  ancestors = new Set<string>(),
): EnemyLifecycleTotals {
  const result = emptyEnemyLifecycleTotals();
  const config = enemies[kind];
  if (!config || ancestors.has(kind)) {
    result.complete = false;
    result.issues.push(!config ? `Unbekannte Gegnerart: ${kind}` : `Zyklische Folgegegner: ${[...ancestors, kind].join(' → ')}`);
    return result;
  }
  result.count = 1;
  result.hp = Math.max(0, config.maxHp);
  result.directXp = result.xp = Math.max(0, config.xp);
  result.enemyKinds.add(kind);
  result.mechanicTags = mechanicTags(config);
  result.dynamic = config.spawnThrow !== undefined;
  const next = new Set(ancestors).add(kind);
  for (const spawn of config.deathSpawns ?? []) {
    if (spawn.count <= 0) continue;
    const child = resolveEnemyLifecycleTotals(spawn.enemyKind, enemies, next);
    result.count += child.count * spawn.count;
    result.hp += child.hp * spawn.count;
    result.followXp += child.xp * spawn.count;
    result.dynamic ||= child.dynamic;
    result.complete &&= child.complete;
    result.issues.push(...child.issues);
    for (const value of child.enemyKinds) result.enemyKinds.add(value);
    for (const value of child.mechanicTags) result.mechanicTags.add(value);
  }
  result.xp += result.followXp;
  return result;
}
