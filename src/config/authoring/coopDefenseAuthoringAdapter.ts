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
  'treeGroves',
  'rockField',
  'rockWalls',
  'reactiveProps',
  'water',
  'bridges',
  'krakenHabitat',
  'spawnZones',
  'trackMode',
  'trackPosition',
  'timeOfDay',
  'fogStrength',
  'moonlight',
  'voidDanger',
  'persistentBase',
  'siteClearings',
  'portalAnchors',
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
  'surface',
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
  'activeFromStart',
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
  'enemyTargeting',
  'encounters',
  'persistentSpawns',
  'mapEvents',
  'secondaryObjectives',
  'portalLinks',
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
  'abyssCameo',
  'tutorialSteps',
  'persistentBasePreview',
  'respawnDelaySchedule',
] as const satisfies readonly (keyof CoopDefenseMapConfig)[];

/** Gemeinsamer Schluessel beider Seiten; er ist Identitaet, nicht Inhalt. */
export const SHARED_SOURCE_FIELDS = ['mapId'] as const satisfies readonly (keyof CoopDefenseMapConfig)[];

export function getWorldDefinitionId(mapId: string): string {
  return `world:coop-defense:${mapId}`;
}

export function getCoopMissionDefinitionId(mapId: string): string {
  return `activity:coop-mission:${mapId}`;
}

/**
 * Explizite Definitions-IDs fuer Szenarien ausserhalb der Kampagnenregistry.
 *
 * Ohne Override leiten sich beide IDs wie bisher aus `mapId` ab. Generierte Szenarien (Dawn)
 * besitzen einen eigenen Namensraum; die `mapId` bleibt dann nur Kompatibilitaetsschluessel der
 * aufgeloesten Config und ist kein Registry-Eintrag.
 */
export interface AuthoredScenarioIds {
  readonly worldDefinitionId: string;
  readonly activityDefinitionId: string;
}

export function toWorldDefinition(
  mapConfig: ArenaGenerationMapConfig,
  worldDefinitionId: string = getWorldDefinitionId(mapConfig.mapId),
): WorldDefinition {
  const resolved = requireNormalizedWorldFields(mapConfig);
  return {
    id: worldDefinitionId,
    sourceMapId: mapConfig.mapId,
    metrics: {
      widthCells: resolved.widthCells,
      heightCells: resolved.heightCells,
    },
    krakenHabitat: mapConfig.krakenHabitat,
    ...(mapConfig.spawnZones === undefined ? {} : { spawnZones: mapConfig.spawnZones }),
    terrain: {
      rockFillRatio: mapConfig.rockFillRatio,
      treeCount: mapConfig.treeCount,
      ...(mapConfig.treeGroves ? { treeGroves: mapConfig.treeGroves } : {}),
      rockField: mapConfig.rockField,
      rockWalls: mapConfig.rockWalls,
      ...(mapConfig.reactiveProps ? { reactiveProps: mapConfig.reactiveProps } : {}),
      water: mapConfig.water,
      ...(mapConfig.bridges === undefined ? {} : { bridges: mapConfig.bridges }),
      ...(mapConfig.siteClearings === undefined ? {} : { siteClearings: mapConfig.siteClearings }),
      ...(mapConfig.portalAnchors === undefined ? {} : { portalAnchors: mapConfig.portalAnchors }),
    },
    bases: mapConfig.bases.map(toWorldBaseDefinition),
    tracks: {
      mode: resolved.trackMode,
      position: resolved.trackPosition,
    },
    actionPolicy: { combat: false },
    persistentBaseSite: mapConfig.persistentBase,
    initialTimeOfDay: resolved.timeOfDay,
    fogStrength: mapConfig.fogStrength,
    moonlight: mapConfig.moonlight,
    voidDanger: mapConfig.voidDanger,
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
    ...(world.terrain.treeGroves ? { treeGroves: world.terrain.treeGroves } : {}),
    rockField: world.terrain.rockField,
    rockWalls: world.terrain.rockWalls,
    ...(world.terrain.reactiveProps ? { reactiveProps: world.terrain.reactiveProps } : {}),
    water: world.terrain.water,
    ...(world.terrain.bridges === undefined ? {} : { bridges: world.terrain.bridges }),
    siteClearings: world.terrain.siteClearings,
    ...(world.terrain.portalAnchors === undefined ? {} : { portalAnchors: world.terrain.portalAnchors }),
    krakenHabitat: world.krakenHabitat,
    ...(world.spawnZones === undefined ? {} : { spawnZones: world.spawnZones }),
    trackMode: world.tracks?.mode,
    trackPosition: world.tracks?.position,
    timeOfDay: world.initialTimeOfDay,
    persistentBase: world.persistentBaseSite,
    bases: world.bases.map((base) => toCoopBaseConfig(base, undefined)),
    fogStrength: world.fogStrength,
    ...(world.moonlight === undefined ? {} : { moonlight: world.moonlight }),
    ...(world.voidDanger === undefined ? {} : { voidDanger: world.voidDanger }),
    powerUps: [],
  };
}

export function toCoopMissionDefinition(
  mapConfig: CoopDefenseMapConfig,
  ids: AuthoredScenarioIds = {
    worldDefinitionId: getWorldDefinitionId(mapConfig.mapId),
    activityDefinitionId: getCoopMissionDefinitionId(mapConfig.mapId),
  },
): CoopMissionDefinition {
  return {
    kind: 'coop-mission',
    id: ids.activityDefinitionId,
    worldDefinitionId: ids.worldDefinitionId,
    sourceMapId: mapConfig.mapId,
    objective: mapConfig.objective,
    surviveDurationSec: mapConfig.surviveDurationSec,
    balanceReferenceDurationSec: mapConfig.balanceReferenceDurationSec,
    respawnsPerPlayer: mapConfig.respawnsPerPlayer,
    ...(mapConfig.enemyTargeting === undefined ? {} : { enemyTargeting: mapConfig.enemyTargeting }),
    encounters: mapConfig.encounters,
    persistentSpawns: mapConfig.persistentSpawns,
    mapEvents: mapConfig.mapEvents,
    secondaryObjectives: mapConfig.secondaryObjectives,
    ...(mapConfig.portalLinks === undefined ? {} : { portalLinks: mapConfig.portalLinks }),
    persistentBaseRewardsOnVictory: mapConfig.persistentBaseRewardsOnVictory,
    missionProgress: mapConfig.missionProgress as CoopMissionDefinition['missionProgress'],
    boss: mapConfig.boss,
    baseOverlays: mapConfig.bases.map(toCoopMissionBaseOverlay),
    powerUps: mapConfig.powerUps,
    itemDrop: mapConfig.itemDrop,
    persistentBasePreview: mapConfig.persistentBasePreview,
    ...(mapConfig.abyssCameo === undefined ? {} : { abyssCameo: mapConfig.abyssCameo }),
    ...(mapConfig.respawnDelaySchedule === undefined ? {} : { respawnDelaySchedule: mapConfig.respawnDelaySchedule }),
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

export function toAuthoredScenario(mapConfig: CoopDefenseMapConfig, ids?: AuthoredScenarioIds): AuthoredScenario {
  return createAuthoredScenario(
    toWorldDefinition(mapConfig, ids?.worldDefinitionId),
    toCoopMissionDefinition(mapConfig, ids),
  );
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
    ...(world.terrain.treeGroves ? { treeGroves: world.terrain.treeGroves } : {}),
    rockField: world.terrain.rockField,
    rockWalls: world.terrain.rockWalls,
    ...(world.terrain.reactiveProps ? { reactiveProps: world.terrain.reactiveProps } : {}),
    water: world.terrain.water,
    ...(world.terrain.bridges === undefined ? {} : { bridges: world.terrain.bridges }),
    krakenHabitat: world.krakenHabitat,
    ...(world.spawnZones === undefined ? {} : { spawnZones: world.spawnZones }),
    tutorialAnchor: tutorial?.anchor,
    tutorialSteps: tutorial?.steps,
    trackMode: world.tracks?.mode,
    trackPosition: world.tracks?.position,
    mapEvents: activity.mapEvents,
    // Nur hier setzt sich eine Basis wieder aus Bauwerk und Missionsanteil zusammen.
    timeOfDay: world.initialTimeOfDay,
    fogStrength: world.fogStrength,
    ...(world.moonlight === undefined ? {} : { moonlight: world.moonlight }),
    ...(world.voidDanger === undefined ? {} : { voidDanger: world.voidDanger }),
    dynamicTimeOfDay: activity.dynamicTimeOfDay,
    surviveDurationSec: activity.surviveDurationSec,
    balanceReferenceDurationSec: activity.balanceReferenceDurationSec,
    bases: world.bases.map((base) => toCoopBaseConfig(base, overlaysByBaseId.get(base.id))),
    powerUps: activity.powerUps,
    persistentSpawns: activity.persistentSpawns,
    encounters: activity.encounters,
    secondaryObjectives: activity.secondaryObjectives,
    ...(activity.portalLinks === undefined ? {} : { portalLinks: activity.portalLinks }),
    persistentBaseRewardsOnVictory: activity.persistentBaseRewardsOnVictory,
    missionProgress: activity.missionProgress,
    boss: activity.boss,
    objective: activity.objective,
    respawnsPerPlayer: activity.respawnsPerPlayer,
    ...(activity.enemyTargeting === undefined ? {} : { enemyTargeting: activity.enemyTargeting }),
    itemDrop: activity.itemDrop,
    persistentBasePreview: activity.persistentBasePreview,
    ...(activity.abyssCameo === undefined ? {} : { abyssCameo: activity.abyssCameo }),
    ...(activity.respawnDelaySchedule === undefined ? {} : { respawnDelaySchedule: activity.respawnDelaySchedule }),
    persistentBase: world.persistentBaseSite,
    ...(world.terrain.siteClearings === undefined ? {} : { siteClearings: world.terrain.siteClearings }),
    ...(world.terrain.portalAnchors === undefined ? {} : { portalAnchors: world.terrain.portalAnchors }),
  };
}

function toWorldBaseDefinition(base: CoopBaseConfig): WorldBaseDefinition {
  return {
    ...(base.surface === undefined ? {} : { surface: base.surface }),
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
  // `startHpFactor` und `activeFromStart` sind Basisfelder, deren blosse Anwesenheit die
  // Normalisierung unterscheidet. Sie duerfen deshalb nicht als `undefined` wieder auftauchen.
  return {
    ...overlay,
    ...(base.startHpFactor === undefined ? {} : { startHpFactor: base.startHpFactor }),
    ...(base.activeFromStart === undefined ? {} : { activeFromStart: base.activeFromStart }),
  };
}

function toCoopBaseConfig(
  base: WorldBaseDefinition,
  overlay: CoopMissionBaseOverlay | undefined,
): CoopBaseConfig {
  const restored: CoopBaseConfig = {
    ...(base.surface === undefined ? {} : { surface: base.surface }),
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
  return {
    ...restored,
    ...(overlay?.startHpFactor === undefined ? {} : { startHpFactor: overlay.startHpFactor }),
    ...(overlay?.activeFromStart === undefined ? {} : { activeFromStart: overlay.activeFromStart }),
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
