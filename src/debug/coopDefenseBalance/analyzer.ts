import {
  COOP_DEFENSE_MAP_CONFIGS,
  resolveCoopDefenseMapEncounterConfigs,
  resolveCoopDefenseMapPersistentSpawnConfigs,
  type CoopDefenseMapConfig,
  type ResolvedCoopDefenseMapEncounterConfig,
} from '../../config/coopDefenseMaps';
import { resolveCoopDefenseBases } from '../../arena/BaseRegistry';
import {
  getCoopDefenseEnemyConfig,
  resolveCoopDefenseEnemyConfigs,
  type CoopDefenseEnemyKind,
  type ResolvedCoopDefenseEnemyConfig,
} from '../../config/coopDefenseEnemies';
import { DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS, DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS } from '../../config';
import { WEAPON_CONFIGS, UTILITY_CONFIGS } from '../../loadout/LoadoutConfig';
import type {
  BalanceEnemyTotals,
  BalanceMapSnapshot,
  BalanceStrongestEncounter,
  BalancePersistentSource,
} from './types';

const PRESENTATION_ONLY_KEYS = new Set([
  'displayName', 'tutorialText', 'imageKey', 'color', 'glow', 'phaseTwoGlow',
  'spriteRotationOffsetDegrees', 'timeOfDay', 'visualStyle', 'assetKey', 'textureKey',
  'iconKey', 'image', 'imageUrl',
]);

/** Kleine deterministische JSON-Darstellung fuer Signaturen und Tests. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

/** FNV-1a reicht fuer einen lokalen Invalidierungsmarker und braucht keine Dependency. */
export function hashStableString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stripPresentationOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPresentationOnly);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (PRESENTATION_ONLY_KEYS.has(key)) continue;
    result[key] = stripPresentationOnly(entry);
  }
  return result;
}

interface EnemyLifecycleTotals extends BalanceEnemyTotals {
  readonly enemyKinds: Set<string>;
  readonly mechanicTags: Set<string>;
  readonly dynamic: boolean;
}

function emptyTotals(): EnemyLifecycleTotals {
  return { count: 0, hp: 0, xp: 0, enemyKinds: new Set(), mechanicTags: new Set(), dynamic: false };
}

function addTotals(target: {
  count: number;
  hp: number;
  xp: number;
  enemyKinds: Set<string>;
  mechanicTags: Set<string>;
}, source: EnemyLifecycleTotals, multiplier = 1): void {
  target.count += source.count * multiplier;
  target.hp += source.hp * multiplier;
  target.xp += source.xp * multiplier;
  for (const kind of source.enemyKinds) target.enemyKinds.add(kind);
  for (const tag of source.mechanicTags) target.mechanicTags.add(tag);
}

function enemyMechanicTags(config: ResolvedCoopDefenseEnemyConfig): Set<string> {
  const tags = new Set<string>();
  if (config.deathSpawns?.length) tags.add('deathSpawns');
  if (config.spawnThrow) tags.add('spawnThrow');
  if (config.dodge) tags.add('dodge');
  if (config.burrow) tags.add('burrow');
  if (config.timebomb) tags.add('timebomb');
  if (config.translocator) tags.add('translocator');
  if (config.voidHunterBoss) tags.add('boss-phases');
  if (config.voidFireChunks || config.voidFireTrail || config.voidMolotov) tags.add('void-fire');
  if (config.stinkAura) tags.add('stink-aura');
  if (config.combatPositioning) tags.add('combat-positioning');
  if (config.weapons.some((weapon) => weapon.salvo)) tags.add('salvo');
  return tags;
}

/** Rechnet den deterministischen Lifecycle inklusive deathSpawns, aber ohne spawnThrow hoch. */
export function resolveEnemyLifecycleTotals(
  kind: CoopDefenseEnemyKind,
  enemies: Record<string, ResolvedCoopDefenseEnemyConfig> = resolveCoopDefenseEnemyConfigs(1),
  ancestors = new Set<string>(),
): EnemyLifecycleTotals {
  const config = enemies[kind] ?? getCoopDefenseEnemyConfig(kind);
  const totals: {
    count: number;
    hp: number;
    xp: number;
    enemyKinds: Set<string>;
    mechanicTags: Set<string>;
  } = {
    count: 1,
    hp: Math.max(0, config.maxHp),
    xp: Math.max(0, config.xp),
    enemyKinds: new Set([kind]),
    mechanicTags: enemyMechanicTags(config),
  };
  let dynamic = config.spawnThrow !== undefined;
  if (ancestors.has(kind)) {
    return { ...totals, dynamic };
  }
  const nextAncestors = new Set(ancestors).add(kind);
  for (const spawn of config.deathSpawns ?? []) {
    if (spawn.count <= 0) continue;
    const child = resolveEnemyLifecycleTotals(spawn.enemyKind, enemies, nextAncestors);
    addTotals(totals, child, spawn.count);
    dynamic ||= child.dynamic;
  }
  return { ...totals, dynamic };
}

function multiplyTotals(kind: string, count: number, enemies: Record<string, ResolvedCoopDefenseEnemyConfig>): EnemyLifecycleTotals {
  const base = resolveEnemyLifecycleTotals(kind, enemies);
  const result = emptyTotals();
  addTotals(result, base, Math.max(0, count));
  return { ...result, dynamic: base.dynamic };
}

function addEncounterTotals(
  target: { count: number; hp: number; xp: number; enemyKinds: Set<string>; mechanicTags: Set<string> },
  encounter: ResolvedCoopDefenseMapEncounterConfig,
  enemies: Record<string, ResolvedCoopDefenseEnemyConfig>,
): boolean {
  let dynamic = false;
  for (const group of encounter.groups) {
    const totals = multiplyTotals(group.enemyKind, group.count, enemies);
    addTotals(target, totals);
    dynamic ||= totals.dynamic;
  }
  return dynamic;
}

function toSortedStrings(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function trackPositionLabel(value: CoopDefenseMapConfig['trackPosition']): string {
  return typeof value === 'string' ? value : `grid:${value?.gridX ?? 0}`;
}

function buildMapSignature(mapConfig: CoopDefenseMapConfig): string {
  const encounters = resolveCoopDefenseMapEncounterConfigs(mapConfig, 1);
  const persistentSpawns = resolveCoopDefenseMapPersistentSpawnConfigs(mapConfig, 1);
  const bases = resolveCoopDefenseBases(mapConfig, 1);
  const enemyKinds = new Set<string>();
  for (const encounter of encounters) {
    for (const group of encounter.groups) enemyKinds.add(group.enemyKind);
  }
  for (const spawn of persistentSpawns) enemyKinds.add(spawn.enemyKind);
  if (mapConfig.boss) enemyKinds.add(mapConfig.boss.enemyKind);
  const pendingEnemyKinds = [...enemyKinds];
  for (let index = 0; index < pendingEnemyKinds.length; index += 1) {
    const config = getCoopDefenseEnemyConfig(pendingEnemyKinds[index]);
    for (const child of config.deathSpawns ?? []) {
      if (enemyKinds.has(child.enemyKind)) continue;
      enemyKinds.add(child.enemyKind);
      pendingEnemyKinds.push(child.enemyKind);
    }
    if (config.spawnThrow && !enemyKinds.has(config.spawnThrow.enemyKind)) {
      enemyKinds.add(config.spawnThrow.enemyKind);
      pendingEnemyKinds.push(config.spawnThrow.enemyKind);
    }
  }
  const enemies = resolveCoopDefenseEnemyConfigs(1);
  const balanceEnemies = [...enemyKinds].sort().map((kind) => {
    const config = enemies[kind];
    const weapons = config.weapons.map((entry) => ({
      ...entry,
      config: stripPresentationOnly((WEAPON_CONFIGS as Record<string, unknown>)[entry.weaponId]),
    }));
    const utilityIds = [
      config.translocator?.utilityId,
      config.voidMolotov?.utilityId,
      config.stinkAura?.utilityId,
    ].filter((id): id is string => typeof id === 'string');
    return {
      kind,
      config: stripPresentationOnly({ ...config, weapons }),
      utilities: utilityIds.map((id) => ({
        id,
        config: stripPresentationOnly((UTILITY_CONFIGS as Record<string, unknown>)[id]),
      })),
    };
  });
  const relevantMap = {
    mapId: mapConfig.mapId,
    arenaWidthCells: mapConfig.arenaWidthCells,
    arenaHeightCells: mapConfig.arenaHeightCells,
    rockFillRatio: mapConfig.rockFillRatio,
    rockField: mapConfig.rockField,
    trackMode: mapConfig.trackMode,
    trackPosition: mapConfig.trackPosition,
    balanceReferenceDurationSec: mapConfig.balanceReferenceDurationSec,
    surviveDurationSec: mapConfig.surviveDurationSec,
    surviveRespawnsPerPlayer: mapConfig.surviveRespawnsPerPlayer,
    objective: mapConfig.objective,
    bases: mapConfig.bases,
    powerUps: mapConfig.powerUps,
    persistentSpawns,
    encounters,
    secondaryObjectives: mapConfig.secondaryObjectives,
    boss: mapConfig.boss,
    mapEvents: mapConfig.mapEvents,
  };
  return hashStableString(stableStringify(stripPresentationOnly({
    map: relevantMap,
    resolvedBases: bases,
    resolvedEncounters: encounters,
    resolvedPersistentSpawns: persistentSpawns,
    enemies: balanceEnemies,
  })));
}

export function getCoopDefenseMapBalanceSignature(mapConfig: CoopDefenseMapConfig): string {
  return buildMapSignature(mapConfig);
}

function strongestEncounter(
  encounters: readonly ResolvedCoopDefenseMapEncounterConfig[],
  enemies: Record<string, ResolvedCoopDefenseEnemyConfig>,
): BalanceStrongestEncounter | null {
  let strongest: BalanceStrongestEncounter | null = null;
  for (const encounter of encounters) {
    const totals = { count: 0, hp: 0, xp: 0, enemyKinds: new Set<string>(), mechanicTags: new Set<string>() };
    addEncounterTotals(totals, encounter, enemies);
    const candidate: BalanceStrongestEncounter = {
      encounterId: encounter.id,
      enemyKinds: toSortedStrings(totals.enemyKinds),
      totals: { count: totals.count, hp: totals.hp, xp: totals.xp },
    };
    if (!strongest || candidate.totals.hp > strongest.totals.hp) strongest = candidate;
  }
  return strongest;
}

export function buildCoopDefenseBalanceMapSnapshot(mapConfig: CoopDefenseMapConfig): BalanceMapSnapshot {
  const enemies = resolveCoopDefenseEnemyConfigs(1);
  const encounters = resolveCoopDefenseMapEncounterConfigs(mapConfig, 1);
  const persistentSpawns = resolveCoopDefenseMapPersistentSpawnConfigs(mapConfig, 1);
  const finite = { count: 0, hp: 0, xp: 0, enemyKinds: new Set<string>(), mechanicTags: new Set<string>() };
  let dynamic = false;
  for (const encounter of encounters) dynamic ||= addEncounterTotals(finite, encounter, enemies);
  if (mapConfig.boss) {
    const boss = multiplyTotals(mapConfig.boss.enemyKind, 1, enemies);
    addTotals(finite, boss);
    dynamic ||= boss.dynamic;
  }

  const persistent = { count: 0, hp: 0, xp: 0, enemyKinds: new Set<string>(), mechanicTags: new Set<string>() };
  const persistentSources: BalancePersistentSource[] = [];
  for (const spawn of persistentSpawns) {
    const activeMs = Math.max(0, mapConfig.balanceReferenceDurationSec * 1000 - spawn.startAtMs);
    const tickCount = activeMs <= 0 || spawn.intervalMs <= 0
      ? 0
      : Math.max(1, Math.ceil(activeMs / spawn.intervalMs));
    const count = tickCount * spawn.countPerTick;
    const totals = multiplyTotals(spawn.enemyKind, count, enemies);
    addTotals(persistent, totals);
    dynamic ||= totals.dynamic;
    persistentSources.push({
      id: spawn.id,
      enemyKind: spawn.enemyKind,
      source: spawn.source.type,
      ...(spawn.source.type === 'base' ? { sourceId: spawn.source.baseId } : {}),
      referenceEnemyCount: totals.count,
      referenceHp: totals.hp,
      referenceXp: totals.xp,
      isReferenceValue: true,
    });
  }

  const bases = resolveCoopDefenseBases(mapConfig, 1);
  const sumBaseHp = (faction: 'friendly' | 'hostile', role: 'main' | 'outpost' | 'spawn-point'): number => (
    bases.filter((base) => base.faction === faction && base.role === role)
      .reduce((sum, base) => sum + Math.max(0, base.hpMax), 0)
  );
  const turretTypes = toSortedStrings(bases.flatMap((base) => base.turrets.map((turret) => turret.weaponId)));
  const usedEnemyKinds = toSortedStrings([...finite.enemyKinds, ...persistent.enemyKinds]);
  const mechanismTags = new Set<string>([...finite.mechanicTags, ...persistent.mechanicTags]);
  const specialEnemyMethods = new Set<string>();
  for (const kind of usedEnemyKinds) {
    const config = enemies[kind];
    if (!config) continue;
    for (const weapon of config.weapons) specialEnemyMethods.add(weapon.weaponId);
  }
  const dynamicFactors: string[] = [];
  if (dynamic) dynamicFactors.push('spawnThrow-Spawns sind laufzeitabhaengig und nicht exakt hochgerechnet');
  if (persistentSources.some((source) => source.source === 'base')) {
    dynamicFactors.push('Basisgebundene Quellen koennen nach Zerstoerung ihrer Quelle enden');
  }
  const widthCells = mapConfig.arenaWidthCells ?? DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS;
  const heightCells = mapConfig.arenaHeightCells ?? DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS;
  const corridorLengths = mapConfig.rockField?.corridors.map((corridor) => corridor.points.reduce((length, point, index, points) => {
    const previous = points[index - 1];
    return previous ? length + Math.hypot(point.gridX - previous.gridX, point.gridY - previous.gridY) : length;
  }, 0)) ?? [];
  const secondaryObjectiveXp = (mapConfig.secondaryObjectives ?? []).reduce((sum, objective) => (
    sum + Math.max(0, Math.floor(objective.rewards?.xpPerTarget ?? 0)) * Math.max(0, objective.targetGoal ?? objective.targets.length)
  ), 0);
  const modelQuality = dynamic
    ? 'DYNAMIC'
    : (persistentSpawns.length > 0 ? 'REFERENCE' : 'EXACT');

  return {
    mapId: mapConfig.mapId,
    displayName: `Map ${mapConfig.mapId}`,
    objective: mapConfig.objective,
    balanceReferenceDurationSec: mapConfig.balanceReferenceDurationSec,
    survivalDurationSec: mapConfig.surviveDurationSec ?? null,
    surviveRespawnsPerPlayer: mapConfig.surviveRespawnsPerPlayer ?? null,
    arena: { widthCells, heightCells, areaCells: widthCells * heightCells },
    terrain: {
      rockField: mapConfig.rockField !== undefined,
      rockFillRatio: mapConfig.rockField ? null : (mapConfig.rockFillRatio ?? null),
      corridorCount: mapConfig.rockField?.corridors.length ?? 0,
      corridorLengths,
      trackMode: mapConfig.trackMode ?? 'rails',
      trackPosition: trackPositionLabel(mapConfig.trackPosition),
    },
    finiteEnemyCount: finite.count,
    finiteEnemyHp: finite.hp,
    finiteEnemyXp: finite.xp,
    persistentReferenceEnemyCount: persistent.count,
    persistentReferenceHp: persistent.hp,
    persistentReferenceXp: persistent.xp,
    persistentReferenceHpPerMinute: persistent.hp / Math.max(1, mapConfig.balanceReferenceDurationSec / 60),
    totalReferenceHp: finite.hp + persistent.hp,
    persistentSources,
    strongestEncounter: strongestEncounter(encounters, enemies),
    usedEnemyKinds,
    boss: mapConfig.boss
      ? { enemyKind: mapConfig.boss.enemyKind, hp: resolveEnemyLifecycleTotals(mapConfig.boss.enemyKind, enemies).hp, xp: resolveEnemyLifecycleTotals(mapConfig.boss.enemyKind, enemies).xp }
      : null,
    mechanicTags: toSortedStrings(mechanismTags),
    dynamicFactors,
    modelQuality,
    friendlyMainBaseHp: sumBaseHp('friendly', 'main'),
    friendlyOutpostHp: sumBaseHp('friendly', 'outpost'),
    friendlySpawnPointHp: sumBaseHp('friendly', 'spawn-point'),
    hostileMainBaseHp: sumBaseHp('hostile', 'main'),
    hostileOutpostHp: sumBaseHp('hostile', 'outpost'),
    hostileSpawnPointHp: sumBaseHp('hostile', 'spawn-point'),
    hostileVictoryTargetHp: mapConfig.objective === 'destroy-hostile-bases' ? sumBaseHp('hostile', 'main') : 0,
    turretCount: bases.reduce((sum, base) => sum + base.turrets.length, 0),
    turretTypes,
    powerUpCount: mapConfig.powerUps.length,
    powerUpTypes: toSortedStrings(mapConfig.powerUps.map((powerUp) => powerUp.defId)),
    powerUpPedestalCount: bases.reduce((sum, base) => sum + base.powerUpPedestals.length, 0),
    secondaryObjectiveXp,
    context: {
      train: (mapConfig.mapEvents ?? []).some((event) => event.type === 'train'),
      airstrike: (mapConfig.mapEvents ?? []).some((event) => event.type === 'airstrike'),
      groundHazard: (mapConfig.mapEvents ?? []).some((event) => event.type === 'ground-hazard'),
      secondaryObjectives: (mapConfig.secondaryObjectives ?? []).map((objective) => `${objective.id}:${objective.type}`),
      fronts: toSortedStrings([
        ...encounters.flatMap((encounter) => encounter.groups.map((group) => group.front ?? 'default')),
        ...persistentSpawns.map((spawn) => spawn.front ?? 'default'),
      ]),
      specialEnemyMethods: toSortedStrings(specialEnemyMethods),
    },
    balanceSignature: buildMapSignature(mapConfig),
  };
}

export function buildAllCoopDefenseBalanceMapSnapshots(): readonly BalanceMapSnapshot[] {
  return COOP_DEFENSE_MAP_CONFIGS.map(buildCoopDefenseBalanceMapSnapshot);
}
