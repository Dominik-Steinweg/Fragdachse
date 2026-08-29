import type {
  CoopBaseConfig,
  CoopDefenseMapConfig,
  CoopDefenseMapTrackMode,
  CoopDefenseMapTrackPosition,
} from '../coopDefenseMaps';
import type { ArenaGenerationMapConfig } from '../../arena/ArenaGenerator';
import type {
  CoopMissionBaseOverlay,
  CoopMissionDefinition,
  CoopMissionTutorialDefinition,
} from './ActivityDefinition';
import { createAuthoredScenario, isActivityOfWorldDefinition, type AuthoredScenario } from './AuthoredScenario';
import type { WorldBaseDefinition, WorldDefinition } from './WorldDefinition';

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
  'persistentBase',
] as const satisfies readonly (keyof CoopDefenseMapConfig)[];

/**
 * Map-Felder, die selbst noch beide Ebenen mischen und deshalb feldweise aufgeteilt werden.
 *
 * `bases` beschreibt Bauwerke (World) und zugleich, was eine laufende Mission aus ihnen macht
 * (Activity). Die Aufteilung steht in {@link WORLD_BASE_FIELDS} und
 * {@link COOP_MISSION_BASE_FIELDS}.
 */
export const SPLIT_SOURCE_FIELDS = ['bases'] as const satisfies readonly (keyof CoopDefenseMapConfig)[];

/** Felder einer Basis, die das Bauwerk selbst beschreiben. */
export const WORLD_BASE_FIELDS = [
  'hpMax',
  'faction',
  'role',
  'anchor',
  'shape',
  'turrets',
  'spawnCenter',
] as const satisfies readonly (keyof CoopBaseConfig)[];

/** Felder einer Basis, die erst durch eine laufende Mission entstehen. */
export const COOP_MISSION_BASE_FIELDS = [
  'startHpFactor',
  'playerScaling',
  'dormant',
  'powerUpPedestals',
] as const satisfies readonly (keyof CoopBaseConfig)[];

/** Gemeinsamer Schluessel beider Basis-Seiten; er ist Identitaet, nicht Inhalt. */
export const SHARED_BASE_FIELDS = ['id'] as const satisfies readonly (keyof CoopBaseConfig)[];

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
  'persistentBaseRewardsOnVictory',
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
  'persistentBasePreview',
] as const satisfies readonly (keyof CoopDefenseMapConfig)[];

/** Gemeinsamer Schluessel beider Seiten; er ist Identitaet, nicht Inhalt. */
export const SHARED_SOURCE_FIELDS = ['mapId'] as const satisfies readonly (keyof CoopDefenseMapConfig)[];

export function getWorldDefinitionId(mapId: string): string {
  return `world:coop-defense:${mapId}`;
}

export function getCoopMissionDefinitionId(mapId: string): string {
  return `activity:coop-mission:${mapId}`;
}

export function toWorldDefinition(mapConfig: ArenaGenerationMapConfig): WorldDefinition {
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
    bases: mapConfig.bases.map(toWorldBaseDefinition),
    tracks: {
      mode: resolved.trackMode,
      position: resolved.trackPosition,
    },
    actionPolicy: { combat: false },
    persistentBaseSite: mapConfig.persistentBase,
    initialTimeOfDay: resolved.timeOfDay,
  };
}

/**
 * Projects a WorldDefinition into the generator's authoring boundary without reintroducing
 * Activity data. The old map-shaped input remains available only when a live mission needs its
 * barriers, hazards, pickups and other Activity-owned generation features.
 */
export function toWorldGenerationConfig(world: WorldDefinition): ArenaGenerationMapConfig {
  return {
    mapId: world.sourceMapId ?? world.id,
    arenaWidthCells: world.metrics.widthCells,
    arenaHeightCells: world.metrics.heightCells,
    rockFillRatio: world.terrain.rockFillRatio,
    treeCount: world.terrain.treeCount,
    rockField: world.terrain.rockField,
    rockWalls: world.terrain.rockWalls,
    trackMode: world.tracks?.mode,
    trackPosition: world.tracks?.position,
    persistentBase: world.persistentBaseSite,
    bases: world.bases.map((base) => toCoopBaseConfig(base, undefined)),
    powerUps: [],
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
    persistentBaseRewardsOnVictory: mapConfig.persistentBaseRewardsOnVictory,
    missionProgress: mapConfig.missionProgress as CoopMissionDefinition['missionProgress'],
    boss: mapConfig.boss,
    baseOverlays: mapConfig.bases.map(toCoopMissionBaseOverlay),
    powerUps: mapConfig.powerUps,
    itemDrop: mapConfig.itemDrop,
    persistentBasePreview: mapConfig.persistentBasePreview,
    dynamicTimeOfDay: mapConfig.dynamicTimeOfDay,
    tutorial: {
      durationMs: mapConfig.tutorialDurationMs,
      persistent: mapConfig.tutorialPersistent === true,
      showControls: mapConfig.tutorialShowControls === true,
      anchor: mapConfig.tutorialAnchor,
      steps: mapConfig.tutorialSteps as CoopMissionTutorialDefinition['steps'],
    },
  };
}

export function toAuthoredScenario(mapConfig: CoopDefenseMapConfig): AuthoredScenario {
  return createAuthoredScenario(toWorldDefinition(mapConfig), toCoopMissionDefinition(mapConfig));
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
  // Beide Haelften muessen dieselbe World meinen, sonst entstuende hier eine Mischkonfiguration.
  if (!isActivityOfWorldDefinition(activity, world)) {
    throw new Error(
      `[coopDefenseAuthoringAdapter] Activity ${activity.id} belongs to world ${activity.worldDefinitionId}, not ${world.id}`,
    );
  }
  const { tutorial } = activity;
  const overlaysByBaseId = new Map((activity.baseOverlays ?? []).map((overlay) => [overlay.baseId, overlay]));
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
    trackMode: world.tracks?.mode,
    trackPosition: world.tracks?.position,
    mapEvents: activity.mapEvents,
    // Nur hier setzt sich eine Basis wieder aus Bauwerk und Missionsanteil zusammen.
    timeOfDay: world.initialTimeOfDay,
    dynamicTimeOfDay: activity.dynamicTimeOfDay,
    surviveDurationSec: activity.surviveDurationSec,
    balanceReferenceDurationSec: activity.balanceReferenceDurationSec,
    bases: world.bases.map((base) => toCoopBaseConfig(base, overlaysByBaseId.get(base.id))),
    powerUps: activity.powerUps,
    persistentSpawns: activity.persistentSpawns,
    encounters: activity.encounters,
    secondaryObjectives: activity.secondaryObjectives,
    persistentBaseRewardsOnVictory: activity.persistentBaseRewardsOnVictory,
    missionProgress: activity.missionProgress,
    boss: activity.boss,
    objective: activity.objective,
    respawnsPerPlayer: activity.respawnsPerPlayer,
    itemDrop: activity.itemDrop,
    persistentBasePreview: activity.persistentBasePreview,
    persistentBase: world.persistentBaseSite,
  };
}

function toWorldBaseDefinition(base: CoopBaseConfig): WorldBaseDefinition {
  return {
    id: base.id,
    hpMax: base.hpMax,
    faction: base.faction,
    role: base.role,
    anchor: base.anchor,
    shape: base.shape,
    turrets: base.turrets,
    spawnCenter: base.spawnCenter,
  };
}

function toCoopMissionBaseOverlay(base: CoopBaseConfig): CoopMissionBaseOverlay {
  const overlay: CoopMissionBaseOverlay = {
    baseId: base.id,
    playerScaling: base.playerScaling,
    dormant: base.dormant,
    powerUpPedestals: base.powerUpPedestals,
  };
  // `startHpFactor` ist das einzige Basisfeld, dessen blosse Anwesenheit die Normalisierung
  // unterscheidet. Es darf deshalb nicht als `undefined` wieder auftauchen.
  return base.startHpFactor === undefined ? overlay : { ...overlay, startHpFactor: base.startHpFactor };
}

function toCoopBaseConfig(
  base: WorldBaseDefinition,
  overlay: CoopMissionBaseOverlay | undefined,
): CoopBaseConfig {
  const restored: CoopBaseConfig = {
    id: base.id,
    hpMax: base.hpMax,
    playerScaling: overlay?.playerScaling,
    faction: base.faction,
    role: base.role,
    dormant: overlay?.dormant,
    anchor: base.anchor,
    shape: base.shape,
    turrets: base.turrets,
    powerUpPedestals: overlay?.powerUpPedestals,
    spawnCenter: base.spawnCenter,
  };
  return overlay?.startHpFactor === undefined
    ? restored
    : { ...restored, startHpFactor: overlay.startHpFactor };
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
function requireNormalizedWorldFields(mapConfig: ArenaGenerationMapConfig): NormalizedWorldFields {
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
