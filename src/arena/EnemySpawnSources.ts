import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import type { CoopDefenseMapConfig, CoopDefenseMapEncounterStart, CoopDefenseMapSpawnAreaConfig } from '../config/coopDefenseMapAuthoring';
import { spawnZoneArea } from '../config/spawnZones';
import type { SpawnFront } from '../types';
import { DEFAULT_SPAWN_FRONT } from '../utils/spawnFront';

/** Where enemies of an authored source appear. */
export type EnemySpawnSourcePlace =
  | { readonly kind: 'area'; readonly area: CoopDefenseMapSpawnAreaConfig }
  /** The opening of a spawn structure's brood pit. */
  | { readonly kind: 'mouth'; readonly baseId: string }
  /** The whole band along one arena edge. */
  | { readonly kind: 'front'; readonly front: SpawnFront };

/** One authored place enemies come from, with the enemies and encounters that use it. */
export interface EnemySpawnSource {
  readonly place: EnemySpawnSourcePlace;
  readonly enemyKinds: readonly CoopDefenseEnemyKind[];
  /** Start conditions of the encounters whose groups leave here; empty for persistent spawns and the boss. */
  readonly encounterStarts: readonly EnemySpawnSourceStart[];
  /** Persistent spawns and the boss start with the mission. */
  readonly fromMissionStart: boolean;
}

export interface EnemySpawnSourceStart {
  readonly encounterId: string;
  readonly start: CoopDefenseMapEncounterStart;
}

type SpawnSourceMapConfig = Pick<Partial<CoopDefenseMapConfig>, 'encounters' | 'persistentSpawns' | 'boss' | 'spawnZones'>;

/**
 * The authored enemy sources of a map: encounter groups, persistent spawns and the boss.
 *
 * Order is stable and part of the contract: areas and pit mouths in authoring order, then each
 * edge band once in the order it was first used. The generator's route checks and the base
 * editor's situation map read this one list.
 */
export function listEnemySpawnSources(mapConfig: SpawnSourceMapConfig): EnemySpawnSource[] {
  const places: { place: EnemySpawnSourcePlace; kinds: CoopDefenseEnemyKind[]; starts: EnemySpawnSourceStart[]; missionStart: boolean }[] = [];
  const fronts = new Map<SpawnFront, (typeof places)[number]>();
  const addFront = (front: SpawnFront, kind: CoopDefenseEnemyKind, start: EnemySpawnSourceStart | null): void => {
    let entry = fronts.get(front);
    if (!entry) { entry = { place: { kind: 'front', front }, kinds: [], starts: [], missionStart: false }; fronts.set(front, entry); }
    if (!entry.kinds.includes(kind)) entry.kinds.push(kind);
    if (start) entry.starts.push(start); else entry.missionStart = true;
  };
  for (const encounter of mapConfig.encounters ?? []) {
    const start = { encounterId: encounter.id, start: encounter.start };
    for (const group of encounter.groups) {
      // A group with an authored area never starts on the edge band.
      if (group.spawnArea) places.push({ place: { kind: 'area', area: group.spawnArea }, kinds: [group.enemyKind], starts: [start], missionStart: false });
      else addFront(group.front ?? DEFAULT_SPAWN_FRONT, group.enemyKind, start);
    }
  }
  const zoneArea = (zoneId: string) => {
    const zone = mapConfig.spawnZones?.find(({ id }) => id === zoneId);
    return zone ? spawnZoneArea(zone) : null;
  };
  for (const spawn of mapConfig.persistentSpawns ?? []) {
    const source = spawn.source;
    if (source.type === 'map') addFront(spawn.front ?? DEFAULT_SPAWN_FRONT, spawn.enemyKind, null);
    else if (source.type === 'zone') {
      const area = zoneArea(source.zoneId);
      if (area) places.push({ place: { kind: 'area', area }, kinds: [spawn.enemyKind], starts: [], missionStart: true });
    } else {
      places.push({ place: { kind: 'mouth', baseId: source.baseId }, kinds: [spawn.enemyKind], starts: [], missionStart: true });
    }
  }
  if (mapConfig.boss) {
    const area = mapConfig.boss.spawnZoneId ? zoneArea(mapConfig.boss.spawnZoneId) : null;
    if (area) places.push({ place: { kind: 'area', area }, kinds: [mapConfig.boss.enemyKind], starts: [], missionStart: true });
    else addFront(DEFAULT_SPAWN_FRONT, mapConfig.boss.enemyKind, null);
  }
  return [...places, ...fronts.values()].map((entry) => ({
    place: entry.place,
    enemyKinds: entry.kinds,
    encounterStarts: entry.starts,
    fromMissionStart: entry.missionStart,
  }));
}
