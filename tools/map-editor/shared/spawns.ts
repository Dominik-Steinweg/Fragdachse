import { getCoopDefenseEnemyConfig, hasCoopDefenseEnemyKind } from '../../../src/config/coopDefenseEnemies';
import { getEnemyName } from '../../../src/i18n/contentPresentation';
import type { SpawnFront } from '../../../src/types';
import { DEFAULT_SPAWN_FRONT, isSpawnFront, SPAWN_FRONTS } from '../../../src/utils/spawnFront';
import { array, at, object, set, type JsonObject, type Path } from './json';

export const FRONT_LABELS: Record<SpawnFront, string> = { west: 'Westen', north: 'Norden', east: 'Osten', south: 'Süden' };
export function spawnsAtEdge(group: JsonObject): boolean {
  const kind = String(group.enemyKind);
  return hasCoopDefenseEnemyKind(kind) && getCoopDefenseEnemyConfig(kind).burrow?.spawnBurrowedAtEdge === true;
}

/** Selector value of a spawn zone in group and source pickers. */
export const zoneMode = (id: string): string => `zone:${id}`;

/**
 * Mutually exclusive raw authoring fields; retain the group's timing and extension fields.
 * `mode` is a front, `zone:<id>` for a World spawn zone, or `area` for a legacy inline rectangle.
 */
export function setGroupSpawn(draft: JsonObject, path: Path, mode: string): void {
  const zoneId = mode.startsWith('zone:') ? mode.slice(5) : undefined;
  if (zoneId !== undefined && !listZones(draft).some(zone => zone.id === zoneId)) throw Error('Unbekannte Spawnzone');
  if (zoneId === undefined && mode !== 'area' && !isSpawnFront(mode)) throw Error('Unbekannte Spawnfront');
  const group = object(at(draft, path));
  set(draft, [...path, 'front'], zoneId !== undefined || mode === 'area' ? undefined : mode);
  set(draft, [...path, 'spawnZoneId'], zoneId);
  set(draft, [...path, 'spawnArea'], mode === 'area' ? group.spawnArea ?? { gridX: 0, gridY: 0, widthCells: 4, heightCells: 4 } : undefined);
}

/** Switching source keeps extension fields but removes incompatible base/zone/front selectors. */
export function setPersistentSpawnSource(draft: JsonObject, index: number, type: 'map' | 'base' | 'zone', id?: string): void {
  const path: Path = ['persistentSpawns', index];
  set(draft, [...path, 'source', 'type'], type);
  set(draft, [...path, 'source', 'baseId'], type === 'base' ? id : undefined);
  set(draft, [...path, 'source', 'zoneId'], type === 'zone' ? id : undefined);
  if (type !== 'map') set(draft, [...path, 'front'], undefined);
}

export interface SpawnZoneEntry { readonly id: string; readonly index: number }
export function listZones(draft: JsonObject): SpawnZoneEntry[] {
  return array(draft.spawnZones).map((zone, index) => ({ id: String(zone.id), index }));
}

/** Every place that names a zone: groups, persistent sources and the boss. */
function zoneReferences(draft: JsonObject, id: string): Path[] {
  const paths: Path[] = [];
  array(draft.encounters).forEach((encounter, i) => array(encounter.groups).forEach((group, j) => {
    if (group.spawnZoneId === id) paths.push(['encounters', i, 'groups', j, 'spawnZoneId']);
  }));
  array(draft.persistentSpawns).forEach((spawn, i) => {
    if (object(spawn.source).zoneId === id) paths.push(['persistentSpawns', i, 'source', 'zoneId']);
  });
  if (object(draft.boss).spawnZoneId === id) paths.push(['boss', 'spawnZoneId']);
  return paths;
}

export function isZoneReferenced(draft: JsonObject, id: string): boolean { return zoneReferences(draft, id).length > 0; }

/** Adds a ground zone with a fresh `zone-N` id; returns that id. */
export function addZone(draft: JsonObject, rect: { gridX: number; gridY: number; widthCells: number; heightCells: number }): string {
  const ids = new Set(listZones(draft).map(zone => zone.id));
  let n = ids.size + 1;
  while (ids.has(`zone-${n}`)) n++;
  const id = `zone-${n}`;
  set(draft, ['spawnZones'], [...array(draft.spawnZones), { id, ...rect }]);
  return id;
}

/** Renames a zone and rewrites every reference to it. */
export function renameZone(draft: JsonObject, from: string, to: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(to)) throw Error('Zonen-ID muss kebab-case sein');
  const zones = listZones(draft);
  if (zones.some(zone => zone.id === to)) throw Error('Zonen-ID ist bereits vergeben');
  const zone = zones.find(entry => entry.id === from);
  if (!zone) throw Error('Unbekannte Spawnzone');
  for (const path of zoneReferences(draft, from)) set(draft, path, to);
  set(draft, ['spawnZones', zone.index, 'id'], to);
}

/** Deletes an unused zone; a referenced zone must be replaced first. */
export function deleteZone(draft: JsonObject, id: string): void {
  if (isZoneReferenced(draft, id)) throw Error('Spawnzone wird noch verwendet');
  set(draft, ['spawnZones'], array(draft.spawnZones).filter(zone => zone.id !== id));
}

export interface SpawnFrontSource { label: string; path: Path }
export interface ActiveSpawnFront { front: SpawnFront; sources: SpawnFrontSource[] }

/** Definition-wide front usage, including the runtime's edge-burrow and boss rules. */
export function activeSpawnFronts(draft: JsonObject): ActiveSpawnFront[] {
  const sources = new Map<SpawnFront, SpawnFrontSource[]>();
  const add = (value: unknown, source: SpawnFrontSource) => {
    const front = value ?? DEFAULT_SPAWN_FRONT;
    if (!isSpawnFront(front)) return;
    const entries = sources.get(front) ?? []; entries.push(source); sources.set(front, entries);
  };
  array(draft.encounters).forEach((encounter, i) => array(encounter.groups).forEach((group, j) => {
    if (Number(group.count) <= 0 || group.spawnArea || group.spawnZoneId) return;
    add(group.front, { path: ['encounters', i, 'groups', j, 'front'], label: `${encounter.id} · Gruppe ${j + 1} · ${getEnemyName(String(group.enemyKind), 'de')}` });
  }));
  array(draft.persistentSpawns).forEach((spawn, i) => {
    if (object(spawn.source).type === 'map' && Number(spawn.countPerTick) > 0) add(spawn.front, { path: ['persistentSpawns', i, 'front'], label: `Permanente Quelle · ${spawn.id} · ${getEnemyName(String(spawn.enemyKind), 'de')}` });
  });
  if (draft.boss && !object(draft.boss).spawnZoneId && !object(draft.boss).habitatId) {
    add(DEFAULT_SPAWN_FRONT, { path: ['boss'], label: `Boss · ${getEnemyName(String(object(draft.boss).enemyKind), 'de')}` });
  }
  return SPAWN_FRONTS.flatMap(front => sources.has(front) ? [{ front, sources: sources.get(front)! }] : []);
}
