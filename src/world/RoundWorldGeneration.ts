import { ArenaGenerator, ARENA_GENERATOR_VERSION } from '../arena/ArenaGenerator';
import type { CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import type { DawnRoundPlans } from '../dawn/composition/DawnRoundComposition';
import { toDawnActivityDefinitionId, toDawnWorldDefinitionId } from '../dawn/contracts/DawnIds';
import type { ArenaLayout, GameMode } from '../types';
import type { ActivityDescriptor } from './ActivityDescriptor';
import { toActivityDefinitionId, toActivityKind, toWorldDefinitionId } from './arenaDescriptorAdapter';
import type { WorldDescriptor, WorldParameters } from './WorldDescriptor';
import { resolveCoopDefenseMapConfig } from './WorldDefinitionResolution';
import { generateRoundWorldLayout } from './RoundWorldLayout';

/** Was der Host fuer eine neue Runden-World festgelegt hat, bevor das Layout existiert. */
export interface RoundWorldGenerationRequest {
  readonly roundRevision: number;
  readonly gameMode: GameMode;
  readonly seed: number;
  /** Lobby-gewaehlte Kampagnenkarte; fuer Dawn und Nicht-Coop-Modi `null`. */
  readonly campaignMapConfig: CoopDefenseMapConfig | null;
  /** Host-komponierte Dawn-Plaene; ersetzen die Kampagnenkarte. */
  readonly dawn: DawnRoundPlans | null;
  readonly worldParameters: WorldParameters | undefined;
}

export interface GeneratedRoundWorld {
  readonly world: WorldDescriptor;
  readonly activity: ActivityDescriptor;
  readonly layout: ArenaLayout;
  readonly mapConfig: CoopDefenseMapConfig | null;
}

/**
 * Host: erzeugt Layout und Identitaet einer neuen Runden-World.
 *
 * Fuer Dawn loest der Host seine Coop-Config ueber denselben Owner auf wie jeder Client, also aus
 * den Descriptor-Plaenen selbst. Damit kann die Host-Generierung nicht von der Client-Aufloesung
 * abweichen, ohne dass der Fingerprint-Vergleich der Clients es meldet.
 */
export function generateRoundWorld(request: RoundWorldGenerationRequest): GeneratedRoundWorld {
  if (request.dawn && request.campaignMapConfig) {
    throw new Error('[RoundWorldGeneration] A Dawn round has no campaign map');
  }
  const kind = toActivityKind(request.gameMode);
  const identity = request.dawn
    ? {
      worldDefinitionId: toDawnWorldDefinitionId(request.dawn.world.templateId),
      activityDefinitionId: toDawnActivityDefinitionId(request.dawn.world.templateId),
      worldParameters: { ...request.worldParameters, dawn: request.dawn.world },
      activityParameters: { dawn: request.dawn.activity },
    }
    : {
      worldDefinitionId: toWorldDefinitionId(request.campaignMapConfig?.mapId ?? null),
      activityDefinitionId: toActivityDefinitionId(kind, request.campaignMapConfig?.mapId ?? null),
      worldParameters: request.worldParameters,
      activityParameters: undefined,
    };
  const activity: ActivityDescriptor = {
    activityRevision: request.roundRevision,
    worldRevision: request.roundRevision,
    kind,
    definitionId: identity.activityDefinitionId,
    ...(identity.activityParameters ? { parameters: identity.activityParameters } : {}),
  };
  const worldIdentity = {
    definitionId: identity.worldDefinitionId,
    ...(identity.worldParameters ? { parameters: identity.worldParameters } : {}),
  };
  const mapConfig = request.dawn
    ? resolveCoopDefenseMapConfig(worldIdentity, activity)
    : request.campaignMapConfig;
  const layout = generateRoundWorldLayout(request.gameMode, mapConfig, request.seed);
  const world: WorldDescriptor = {
    worldRevision: request.roundRevision,
    seed: request.seed,
    generatorVersion: ARENA_GENERATOR_VERSION,
    layoutFingerprint: ArenaGenerator.fingerprint(layout),
    ...worldIdentity,
  };
  return { world, activity, layout, mapConfig };
}
