import { COOP_DEFENSE_MAP_CONFIGS, getDiagnosticMapConfigs } from '../../config/coopDefenseMaps';
import { COOP_DEFENSE_CLASS_IDS } from '../../config/coopDefenseClasses';
import { COOP_DEFENSE_ENEMY_KINDS, type CoopDefenseEnemyKind } from '../../config/coopDefenseEnemies';
import { COOP_DEFENSE_CONSTRUCTIONS, COOP_DEFENSE_CONSTRUCTION_IDS } from '../../config/coopDefenseConstructions';
import { DEFAULT_LOADOUT, WEAPON_CONFIGS, ULTIMATE_CONFIGS, UTILITY_CONFIGS } from '../../loadout/LoadoutConfig';
import { getSelectableLoadoutItems } from '../../loadout/LoadoutCatalog';
import { resolveLoadoutSelectionIds } from '../../loadout/LoadoutRules';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS as upgrades, isCoopDefenseUpgradeAvailableForClass, sanitizeCoopDefenseUpgradeProfile } from '../../utils/coopDefenseUpgrades';
import { sanitizeCoopDefenseEquippedItems } from '../../utils/coopDefenseItems';
import type { CoopDefenseClassId, ConstructionId, CoopDefenseItem, LoadoutToolRef } from '../../types';

export interface GridPoint { gridX: number; gridY: number }
export interface DevScenario {
  version: 1;
  mapId: string;
  seed: number;
  classId: CoopDefenseClassId;
  weapon1: string;
  weapon2: string;
  ultimate: string;
  tools: LoadoutToolRef[];
  upgrades: Record<string, number>;
  items: CoopDefenseItem[];
  player: GridPoint | null;
  enemies: (GridPoint & { kind: CoopDefenseEnemyKind; pinned: boolean; hp: number | null })[];
  constructions: (GridPoint & { id: ConstructionId })[];
  timeOfDay: number;
  suppressWaves: boolean;
  refillAdrenaline: boolean;
  refillHp: boolean;
}

export const scenarioMaps = () => [...COOP_DEFENSE_MAP_CONFIGS, ...getDiagnosticMapConfigs()];

/** Unlock access separately from upgrade strength. Dependencies use their real minimum levels. */
export function buildScenarioProfile(classId: CoopDefenseClassId, levels: Record<string, number>, tools: LoadoutToolRef[]) {
  const requested: Record<string, number> = {};
  const visiting = new Set<string>();
  const include = (id: string, level: number): void => {
    const definition = upgrades[id];
    if (!definition || !isCoopDefenseUpgradeAvailableForClass(id, classId)) throw new Error(`Upgrade für ${classId} nicht verfügbar: ${id}`);
    if (!Number.isInteger(level) || level < 0 || level > definition.maxLevel) throw new Error(`Ungültige Upgrade-Stufe: ${id}=${level}`);
    if (visiting.has(id)) throw new Error(`Zyklische Upgrade-Voraussetzung: ${id}`);
    requested[id] = Math.max(requested[id] ?? 0, level);
    if (level > 0) {
      visiting.add(id);
      for (const dependency of definition.requires) include(dependency.upgradeId, dependency.minLevel);
      visiting.delete(id);
    }
  };
  for (const definition of Object.values(upgrades)) {
    if (definition.kind === 'unlock' && isCoopDefenseUpgradeAvailableForClass(definition.id, classId)) include(definition.id, 1);
  }
  for (const [id, level] of Object.entries(levels)) include(id, level);
  const profile = sanitizeCoopDefenseUpgradeProfile({ upgrades: Object.fromEntries(Object.entries(requested)
    .map(([id, level]) => [id, { unlocked: level > 0, level }])), toolLoadout: tools }, classId);
  for (const [id, level] of Object.entries(requested)) {
    if (profile.upgrades[id]?.level !== level) throw new Error(`Upgrade wurde vom Spiel verworfen: ${id}=${level}`);
  }
  for (const [id, level] of Object.entries(levels)) {
    if (profile.upgrades[id]?.level !== level) throw new Error(`Explizite Stufe ${id}=${level} widerspricht einer Freischaltung oder Voraussetzung.`);
  }
  if (JSON.stringify(profile.toolLoadout) !== JSON.stringify(tools)) throw new Error('Werkzeuge ungültig, doppelt oder zu viele Slots.');
  return profile;
}

export function scenarioLoadout(config: DevScenario) {
  const profile = buildScenarioProfile(config.classId, config.upgrades, config.tools);
  for (const slot of ['weapon1', 'weapon2', 'ultimate'] as const) {
    if (!getSelectableLoadoutItems(slot, 'coop_defense', profile, config.classId).some(item => item.id === config[slot])) {
      throw new Error(`${slot}: ${config[slot]} ist für diese Klasse nicht auswählbar.`);
    }
  }
  const commit = resolveLoadoutSelectionIds({ ...DEFAULT_LOADOUT, weapon1: WEAPON_CONFIGS[config.weapon1],
    weapon2: WEAPON_CONFIGS[config.weapon2], ultimate: ULTIMATE_CONFIGS[config.ultimate] }, 'coop_defense', profile, config.classId);
  const sanitized = sanitizeCoopDefenseEquippedItems(config.items);
  // Compare items by UID: sanitizer sorts slots, which is not a semantic modification.
  if (sanitized.length !== config.items.length || sanitized.some(item => {
    const source = config.items.find(value => value.uid === item.uid);
    return !source || item.slot !== source.slot || item.rarity !== source.rarity || item.itemLevel !== source.itemLevel
      || item.baseValue !== source.baseValue || JSON.stringify(item.affixes) !== JSON.stringify(source.affixes);
  })) throw new Error('Items enthalten ungültige Werte, Affixe oder doppelte Slots/UIDs.');
  commit.equippedItems = sanitized;
  return commit;
}

export function defaultScenario(classId: CoopDefenseClassId = 'dachs_nukem'): DevScenario {
  const tools: LoadoutToolRef[] = [{ kind: 'utility', id: 'HE_GRENADE' }];
  const profile = buildScenarioProfile(classId, {}, tools);
  return { version: 1, mapId: '1', seed: 12345, classId,
    weapon1: getSelectableLoadoutItems('weapon1', 'coop_defense', profile, classId)[0].id,
    weapon2: getSelectableLoadoutItems('weapon2', 'coop_defense', profile, classId)[0].id,
    ultimate: getSelectableLoadoutItems('ultimate', 'coop_defense', profile, classId)[0].id,
    tools, upgrades: {}, items: [], player: null, enemies: [], constructions: [], timeOfDay: 720,
    suppressWaves: true, refillAdrenaline: true, refillHp: true };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name}: Objekt erwartet.`);
  return value as Record<string, unknown>;
}
function number(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name}: Zahl ${min}…${max} erwartet.`);
  return value;
}
function point(value: unknown): GridPoint {
  const raw = object(value, 'Position');
  return { gridX: number(raw.gridX, 'gridX', 0, 10000), gridY: number(raw.gridY, 'gridY', 0, 10000) };
}
export function parseScenario(value: unknown): DevScenario {
  const raw = object(value, 'Szenario');
  if (raw.version !== 1) throw new Error('Unbekannte Szenario-Version.');
  if (!COOP_DEFENSE_CLASS_IDS.includes(raw.classId as CoopDefenseClassId)) throw new Error('Unbekannte Klasse.');
  const config = { ...defaultScenario(raw.classId as CoopDefenseClassId), ...raw } as DevScenario;
  for (const key of Object.keys(raw)) if (!(key in defaultScenario(config.classId))) throw new Error(`Unbekanntes Feld: ${key}`);
  if (!scenarioMaps().some(map => map.mapId === config.mapId)) throw new Error(`Unbekannte Map: ${config.mapId}`);
  number(config.seed, 'seed', 0, 0xffffffff);
  if (!Number.isInteger(config.seed)) throw new Error('seed muss ganzzahlig sein.');
  number(config.timeOfDay, 'timeOfDay', 0, 1439);
  for (const key of ['suppressWaves', 'refillAdrenaline', 'refillHp'] as const) if (typeof config[key] !== 'boolean') throw new Error(`${key}: Boolean erwartet.`);
  for (const key of ['items', 'tools', 'enemies', 'constructions'] as const) if (!Array.isArray(config[key])) throw new Error(`${key}: Array erwartet.`);
  if (config.enemies.length > 200 || config.constructions.length > 100 || config.items.length > 20 || config.tools.length > 6) throw new Error('Szenario überschreitet die Objektgrenze.');
  object(config.upgrades, 'upgrades');
  config.tools = config.tools.map(value => {
    const tool = object(value, 'Werkzeug');
    if (tool.kind === 'construction' && COOP_DEFENSE_CONSTRUCTION_IDS.includes(tool.id as ConstructionId)) return { kind: 'construction', id: tool.id as ConstructionId };
    if (tool.kind === 'utility' && typeof tool.id === 'string' && Object.prototype.hasOwnProperty.call(UTILITY_CONFIGS, tool.id)) return { kind: 'utility', id: tool.id };
    throw new Error('Unbekanntes Werkzeug.');
  });
  config.player = config.player === null ? null : point(config.player);
  config.enemies = config.enemies.map(value => {
    const enemy = object(value, 'Gegner');
    if (!COOP_DEFENSE_ENEMY_KINDS.includes(enemy.kind as CoopDefenseEnemyKind) || typeof enemy.pinned !== 'boolean') throw new Error('Gegnerart oder pinned ungültig.');
    return { ...point(value), kind: enemy.kind as CoopDefenseEnemyKind, pinned: enemy.pinned,
      hp: enemy.hp === null ? null : number(enemy.hp, 'hp', 1, 10000000) };
  });
  config.constructions = config.constructions.map(value => {
    const construction = object(value, 'Bauwerk');
    if (!Object.prototype.hasOwnProperty.call(COOP_DEFENSE_CONSTRUCTIONS, String(construction.id))) throw new Error('Unbekanntes Bauwerk.');
    return { ...point(value), id: construction.id as ConstructionId };
  });
  scenarioLoadout(config);
  return config;
}

export function encodeScenario(config: DevScenario): string { return '#scenario=' + encodeURIComponent(JSON.stringify(config)); }
export function decodeScenario(hash: string): DevScenario | null {
  if (!hash.startsWith('#scenario=')) return null;
  if (hash.length > 250000) throw new Error('Szenario-Link zu groß.');
  return parseScenario(JSON.parse(decodeURIComponent(hash.slice(10))));
}
