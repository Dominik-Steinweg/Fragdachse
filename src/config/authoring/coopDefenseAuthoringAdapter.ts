import type {
  CoopDefenseMapConfig,
  CoopDefenseMapTrackMode,
  CoopDefenseMapTrackPosition,
} from '../coopDefenseMaps';
import type { CoopMissionDefinition, CoopMissionTutorialDefinition } from './ActivityDefinition';
import type { AuthoredScenario } from './AuthoredScenario';
import type { WorldDefinition } from './WorldDefinition';

/**
 * Compatibility-Adapter der Uebergangsphase.
 *
 * Der authored Content liegt weiterhin als `CoopDefenseMapConfig` in
 * `src/config/coopDefenseMaps/*.json` und wird dort geladen und validiert. Dieser Adapter
 * projiziert eine bereits normalisierte Map auf die beiden getrennten Authoring-Vertraege –
 * und wieder zurueck.
 *
 * Er trifft ausdruecklich keine eigenen Inhaltsentscheidungen: keine Defaults, keine
 * Validierung, keine Umrechnung. Jedes Feld landet unveraendert auf genau einer Seite. Die
 * Rueckrichtung {@link toCoopDefenseMapConfig} existiert, damit der Split beweisbar
 * verlustfrei ist und die Runtime schrittweise migriert werden kann, ohne dass Authoring und
 * Laufzeit auseinanderlaufen.
 *
 * Trennlinie: **World ist, was ohne laufende Mission existiert. Activity ist, was es nur gibt,
 * solange eine Mission laeuft.**
 */

/** Map-Felder, die zur World gehoeren. Gegenstueck: {@link COOP_MISSION_SOURCE_FIELDS}. */
export const WORLD_SOURCE_FIELDS = [
  'arenaWidthCells',
  'arenaHeightCells',
  'rockFillRatio',
  'treeCount',
  'rockField',
  'rockWalls',
  'trackMode',
  'trackPosition',
  'timeOfDay',
  'bases',
  'persistentBase',
] as const satisfies readonly (keyof CoopDefenseMapConfig)[];

/** Map-Felder, die zur Coop-Mission-Activity gehoeren. */
export const COOP_MISSION_SOURCE_FIELDS = [
  'objective',
  'surviveDurationSec',
  'balanceReferenceDurationSec',
  'respawnsPerPlayer',
  'encounters',
  'persistentSpawns',
  'mapEvents',
  'secondaryObjectives',
  'missionProgress',
  'boss',
  'powerUps',
  'itemDrop',
  'dynamicTimeOfDay',
  'tutorialDurationMs',
  'tutorialPersistent',
  'tutorialShowControls',
  'tutorialAnchor',
  'tutorialSteps',
  'tutorialRockArmorDropMult',
] as const satisfies readonly (keyof CoopDefenseMapConfig)[];

/** Gemeinsamer Schluessel beider Seiten; er ist Identitaet, nicht Inhalt. */
export const SHARED_SOURCE_FIELDS = ['mapId'] as const satisfies readonly (keyof CoopDefenseMapConfig)[];

export function getWorldDefinitionId(mapId: string): string {
  return `world:coop-defense:${mapId}`;
}

export function getCoopMissionDefinitionId(mapId: string): string {
  return `activity:coop-mission:${mapId}`;
}

export function toWorldDefinition(mapConfig: CoopDefenseMapConfig): WorldDefinition {
  const resolved = requireNormalizedWorldFields(mapConfig);
  return {
    id: getWorldDefinitionId(mapConfig.mapId),
    sourceMapId: mapConfig.mapId,
    metrics: {
      widthCells: resolved.widthCells,
      heightCells: resolved.heightCells,
    },
    terrain: {
      rockFillRatio: mapConfig.rockFillRatio,
      treeCount: mapConfig.treeCount,
      rockField: mapConfig.rockField,
      rockWalls: mapConfig.rockWalls,
    },
    bases: mapConfig.bases,
    tracks: {
      mode: resolved.trackMode,
      position: resolved.trackPosition,
    },
    persistentBaseSite: mapConfig.persistentBase,
    initialTimeOfDay: resolved.timeOfDay,
  };
}

export function toCoopMissionDefinition(mapConfig: CoopDefenseMapConfig): CoopMissionDefinition {
  return {
    kind: 'coop-mission',
    id: getCoopMissionDefinitionId(mapConfig.mapId),
    worldDefinitionId: getWorldDefinitionId(mapConfig.mapId),
    sourceMapId: mapConfig.mapId,
    objective: mapConfig.objective,
    surviveDurationSec: mapConfig.surviveDurationSec,
    balanceReferenceDurationSec: mapConfig.balanceReferenceDurationSec,
    respawnsPerPlayer: mapConfig.respawnsPerPlayer,
    encounters: mapConfig.encounters,
    persistentSpawns: mapConfig.persistentSpawns,
    mapEvents: mapConfig.mapEvents,
    secondaryObjectives: mapConfig.secondaryObjectives,
    missionProgress: mapConfig.missionProgress as CoopMissionDefinition['missionProgress'],
    boss: mapConfig.boss,
    powerUps: mapConfig.powerUps,
    itemDrop: mapConfig.itemDrop,
    dynamicTimeOfDay: mapConfig.dynamicTimeOfDay,
    tutorial: {
      durationMs: mapConfig.tutorialDurationMs,
      persistent: mapConfig.tutorialPersistent === true,
      showControls: mapConfig.tutorialShowControls === true,
      anchor: mapConfig.tutorialAnchor,
      steps: mapConfig.tutorialSteps as CoopMissionTutorialDefinition['steps'],
      rockArmorDropMult: mapConfig.tutorialRockArmorDropMult,
    },
  };
}

export function toAuthoredScenario(mapConfig: CoopDefenseMapConfig): AuthoredScenario {
  return {
    world: toWorldDefinition(mapConfig),
    activity: toCoopMissionDefinition(mapConfig),
  };
}

/**
 * Rueckrichtung des Adapters. Solange Runtime, Generator und Systeme `CoopDefenseMapConfig`
 * lesen, bleibt das der Weg von getrenntem Authoring zurueck in den bestehenden Vertrag.
 *
 * Eine World ohne Coop-Mission besitzt keinen `CoopDefenseMapConfig` – genau das ist der Punkt
 * der Trennung. Der Fehler ist deshalb Teil des Vertrags und kein Sonderfall.
 */
export function toCoopDefenseMapConfig(scenario: AuthoredScenario): CoopDefenseMapConfig {
  const { world, activity } = scenario;
  if (activity?.kind !== 'coop-mission') {
    throw new Error(
      `[coopDefenseAuthoringAdapter] World ${world.id} has no coop mission activity; there is no CoopDefenseMapConfig for it`,
    );
  }
  const { tutorial } = activity;
  return {
    mapId: world.sourceMapId ?? world.id,
    arenaWidthCells: world.metrics.widthCells,
    arenaHeightCells: world.metrics.heightCells,
    tutorialDurationMs: tutorial?.durationMs,
    tutorialPersistent: tutorial?.persistent === true,
    tutorialShowControls: tutorial?.showControls === true,
    rockFillRatio: world.terrain.rockFillRatio,
    treeCount: world.terrain.treeCount,
    rockField: world.terrain.rockField,
    rockWalls: world.terrain.rockWalls,
    tutorialAnchor: tutorial?.anchor,
    tutorialSteps: tutorial?.steps,
    trackMode: world.tracks.mode,
    trackPosition: world.tracks.position,
    mapEvents: activity.mapEvents,
    timeOfDay: world.initialTimeOfDay,
    dynamicTimeOfDay: activity.dynamicTimeOfDay,
    tutorialRockArmorDropMult: tutorial?.rockArmorDropMult,
    surviveDurationSec: activity.surviveDurationSec,
    balanceReferenceDurationSec: activity.balanceReferenceDurationSec,
    bases: world.bases,
    powerUps: activity.powerUps,
    persistentSpawns: activity.persistentSpawns,
    encounters: activity.encounters,
    secondaryObjectives: activity.secondaryObjectives,
    missionProgress: activity.missionProgress,
    boss: activity.boss,
    objective: activity.objective,
    respawnsPerPlayer: activity.respawnsPerPlayer,
    itemDrop: activity.itemDrop,
    persistentBase: world.persistentBaseSite,
  };
}

interface NormalizedWorldFields {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly trackMode: CoopDefenseMapTrackMode;
  readonly trackPosition: CoopDefenseMapTrackPosition;
  readonly timeOfDay: string;
}

/**
 * Der Adapter erwaehlt bewusst keine eigenen Defaults. Arena-Groesse, Gleismodus und Uhrzeit
 * besitzen ihre Standardwerte in `normalizeCoopDefenseMapConfig()`; eine unnormalisierte Map
 * hier still aufzufuellen wuerde eine zweite Regelquelle schaffen.
 */
function requireNormalizedWorldFields(mapConfig: CoopDefenseMapConfig): NormalizedWorldFields {
  const { arenaWidthCells, arenaHeightCells, trackMode, trackPosition, timeOfDay } = mapConfig;
  if (arenaWidthCells === undefined
    || arenaHeightCells === undefined
    || trackMode === undefined
    || trackPosition === undefined
    || timeOfDay === undefined) {
    throw new Error(
      `[coopDefenseAuthoringAdapter] Map ${mapConfig.mapId} must pass normalizeCoopDefenseMapConfig() `
      + 'before it can be split into World and Activity',
    );
  }
  return { widthCells: arenaWidthCells, heightCells: arenaHeightCells, trackMode, trackPosition, timeOfDay };
}
