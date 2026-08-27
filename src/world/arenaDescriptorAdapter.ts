import type { ActivityKind } from '../config/authoring/ActivityDefinition';
import {
  getCoopMissionDefinitionId,
  getWorldDefinitionId,
} from '../config/authoring/coopDefenseAuthoringAdapter';
import type { GameMode } from '../types';
import {
  PROCEDURAL_ARENA_WORLD_DEFINITION_ID,
} from './WorldDescriptor';

/**
 * Kleine Zuordnungshilfen an der Authoring-/Modus-Grenze.
 *
 * World- und Activity-Descriptoren werden direkt erzeugt und gelesen. Eine gemischte
 * Arena-Kompatibilitaetssicht gibt es nicht mehr; diese Datei enthaelt nur noch
 * stabile ID-/Modus-Zuordnungen, die mehrere Produktionsgrenzen benoetigen.
 */

const ACTIVITY_KIND_BY_GAME_MODE: Readonly<Record<GameMode, ActivityKind>> = {
  coop_defense: 'coop-mission',
  deathmatch: 'deathmatch',
  team_deathmatch: 'team-deathmatch',
  capture_the_beer: 'capture-the-beer',
};

const GAME_MODE_BY_ACTIVITY_KIND: Readonly<Record<ActivityKind, GameMode>> = {
  'coop-mission': 'coop_defense',
  deathmatch: 'deathmatch',
  'team-deathmatch': 'team_deathmatch',
  'capture-the-beer': 'capture_the_beer',
};

export function toActivityKind(mode: GameMode): ActivityKind {
  return ACTIVITY_KIND_BY_GAME_MODE[mode];
}

export function toGameMode(kind: ActivityKind): GameMode {
  return GAME_MODE_BY_ACTIVITY_KIND[kind];
}

/** Eine Runde ohne authored Map realisiert die prozedurale Arena-World. */
export function toWorldDefinitionId(mapId: string | null): string {
  return mapId === null ? PROCEDURAL_ARENA_WORLD_DEFINITION_ID : getWorldDefinitionId(mapId);
}

export function toMapId(worldDefinitionId: string): string | null {
  if (worldDefinitionId === PROCEDURAL_ARENA_WORLD_DEFINITION_ID) return null;
  const prefix = getWorldDefinitionId('');
  return worldDefinitionId.startsWith(prefix) ? worldDefinitionId.slice(prefix.length) : null;
}

export function toActivityDefinitionId(kind: ActivityKind, mapId: string | null): string {
  if (kind === 'coop-mission' && mapId !== null) return getCoopMissionDefinitionId(mapId);
  return `activity:${kind}`;
}
