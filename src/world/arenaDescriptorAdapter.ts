import type { ActivityKind } from '../config/authoring/ActivityDefinition';
import {
  getCoopMissionDefinitionId,
  getWorldDefinitionId,
} from '../config/authoring/coopDefenseAuthoringAdapter';
import type { ArenaDescriptor, GameMode } from '../types';
import type { ActivityDescriptor } from './ActivityDescriptor';
import {
  PROCEDURAL_ARENA_WORLD_DEFINITION_ID,
  type WorldDescriptor,
  type WorldParameters,
} from './WorldDescriptor';

/**
 * Compatibility-Adapter der Uebergangsphase zwischen dem heutigen `ArenaDescriptor` und den
 * kanonischen World-/Activity-Descriptoren.
 *
 * Der heutige Descriptor mischt beide Ebenen: `seed`, `arenaGeneratorVersion`,
 * `layoutFingerprint` und `mapId` sind World-Identitaet, `roundRevision` und `gameMode` sind
 * Activity-Identitaet. Diese Datei ist der einzige Ort, an dem die Zuordnung steht – in beide
 * Richtungen, damit sie beweisbar verlustfrei bleibt, solange die Runtime noch den alten
 * Kanal liest.
 *
 * Waehrend der Uebergangsphase teilen sich beide Ebenen den Zaehler `roundRevision`. Das ist
 * ausdruecklich erlaubt: die Revisionen duerfen aus derselben monotonen Quelle stammen. Sie
 * bleiben trotzdem verschiedene Identitaeten, weshalb die Rueckrichtung `roundRevision` aus
 * der Activity liest und nicht aus der World.
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

export function toWorldDescriptor(
  descriptor: ArenaDescriptor,
  parameters?: WorldParameters,
): WorldDescriptor {
  const world: WorldDescriptor = {
    worldRevision: descriptor.roundRevision,
    definitionId: toWorldDefinitionId(descriptor.mapId),
    seed: descriptor.seed,
    generatorVersion: descriptor.arenaGeneratorVersion,
    layoutFingerprint: descriptor.layoutFingerprint,
  };
  return parameters === undefined ? world : { ...world, parameters };
}

export function toActivityDescriptor(descriptor: ArenaDescriptor): ActivityDescriptor {
  const kind = toActivityKind(descriptor.gameMode);
  return {
    activityRevision: descriptor.roundRevision,
    worldRevision: descriptor.roundRevision,
    kind,
    definitionId: toActivityDefinitionId(kind, descriptor.mapId),
  };
}

export function toWorldAndActivityDescriptors(
  descriptor: ArenaDescriptor,
  parameters?: WorldParameters,
): { readonly world: WorldDescriptor; readonly activity: ActivityDescriptor } {
  return {
    world: toWorldDescriptor(descriptor, parameters),
    activity: toActivityDescriptor(descriptor),
  };
}

/**
 * Rueckrichtung. `WorldDescriptor.parameters` hat im alten Vertrag keinen Platz – der
 * persistente Basisradius reist dort weiterhin im `RoundState` mit und geht hier bewusst
 * verloren. Alles andere bleibt exakt erhalten.
 */
export function toArenaDescriptor(world: WorldDescriptor, activity: ActivityDescriptor): ArenaDescriptor {
  if (activity.worldRevision !== world.worldRevision) {
    throw new Error(
      `[arenaDescriptorAdapter] Activity ${activity.definitionId} belongs to world revision `
      + `${activity.worldRevision}, not ${world.worldRevision}`,
    );
  }
  return {
    roundRevision: activity.activityRevision,
    gameMode: toGameMode(activity.kind),
    mapId: toMapId(world.definitionId),
    seed: world.seed,
    arenaGeneratorVersion: world.generatorVersion,
    layoutFingerprint: world.layoutFingerprint,
  };
}

/** Der eine World-Wert, den heute noch der Activity-Vertrag `RoundState` mitfuehrt. */
export interface LegacyRoundStateWorldParameters {
  readonly persistentBaseRadiusCells?: number;
}

/**
 * Liest die World-Parameter, die heute noch im `RoundState` stehen – also in einem
 * Activity-Vertrag. Der kanonische Platz ist {@link WorldDescriptor.parameters}; bis der
 * World-Kanal existiert, ist das hier die einzige Uebersetzung. Die Signatur bleibt bewusst
 * strukturell, damit die World-Schicht nicht von der Netzwerkgrenze abhaengt.
 */
export function toWorldParameters(
  roundState: LegacyRoundStateWorldParameters | null | undefined,
): WorldParameters | undefined {
  const radiusCells = roundState?.persistentBaseRadiusCells;
  return radiusCells === undefined ? undefined : { persistentBaseRadiusCells: radiusCells };
}
