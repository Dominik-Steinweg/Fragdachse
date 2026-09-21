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

/** Mutually exclusive raw authoring fields; retain the group's timing and extension fields. */
export function setGroupSpawn(draft: JsonObject, path: Path, mode: string): void {
  if (mode !== 'area' && !isSpawnFront(mode)) throw Error('Unbekannte Spawnfront');
  const group = object(at(draft, path));
  set(draft, [...path, 'front'], mode === 'area' ? undefined : mode);
  set(draft, [...path, 'spawnArea'], mode === 'area' ? group.spawnArea ?? { gridX: 0, gridY: 0, widthCells: 4, heightCells: 4 } : undefined);
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
    if (Number(group.count) <= 0 || group.spawnArea && !spawnsAtEdge(group)) return;
    add(group.front, { path: ['encounters', i, 'groups', j, 'front'], label: `${encounter.id} · Gruppe ${j + 1} · ${getEnemyName(String(group.enemyKind), 'de')}${group.spawnArea ? ' (Randspawn; Spawn-Area unwirksam)' : ''}` });
  }));
  array(draft.persistentSpawns).forEach((spawn, i) => {
    if (object(spawn.source).type === 'map' && Number(spawn.countPerTick) > 0) add(spawn.front, { path: ['persistentSpawns', i, 'front'], label: `Permanente Quelle · ${spawn.id} · ${getEnemyName(String(spawn.enemyKind), 'de')}` });
  });
  if (draft.boss) add(DEFAULT_SPAWN_FRONT, { path: ['boss'], label: `Boss · ${getEnemyName(String(object(draft.boss).enemyKind), 'de')}` });
  return SPAWN_FRONTS.flatMap(front => sources.has(front) ? [{ front, sources: sources.get(front)! }] : []);
}
