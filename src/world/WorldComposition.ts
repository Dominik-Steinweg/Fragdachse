import * as Phaser from 'phaser';
import { ArenaBuilder, type ArenaBuilderResult } from '../arena/ArenaBuilder';
import { ArenaGenerator, ARENA_GENERATOR_VERSION, resolveArenaGenerationInput } from '../arena/ArenaGenerator';
import type { BaseSpec } from '../arena/BaseRegistry';
import { resolveCoopDefenseActivityBases } from '../arena/BaseRegistry';
import { RockRegistry } from '../arena/RockRegistry';
import type { GroundSurfacePersistentBaseGravelZone } from '../arena/chunks/GroundSurfaceStreamer';
import {
  getArenaMetricsProfile,
  getAuthoredWorldMetricsProfile,
  type ArenaMetricsProfile,
} from '../config';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import { toWorldGenerationConfig } from '../config/authoring/coopDefenseAuthoringAdapter';
import { getWorldDefinition } from '../config/authoring/authoredScenarios';
import type { CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { getCoopDefenseMapConfig } from '../config/coopDefenseMaps';
import type { BaseDestructionHooks } from '../effects/BaseDestructionRenderer';
import type { LightingSystem } from '../effects/LightingSystem';
import { BaseManager } from '../entities/BaseManager';
import type { PlayerManager } from '../entities/PlayerManager';
import { resolveActiveGameMode, toMapId } from './arenaDescriptorAdapter';
import type { ActivityDescriptor } from './ActivityDescriptor';
import { generateWorldLayout } from './WorldLayout';
import { WorldMaterialization } from './WorldMaterialization';
import { WorldPresentationBinding } from './WorldPresentationBinding';
import type { WorldPresentationHandoff } from './WorldPresentationHandoff';
import { PersistentBaseWorldBinding, type PersistentBaseWorldBindingSink } from './PersistentBaseWorldBinding';
import { createWorldRuntimeContext, type WorldRuntimeContext } from './WorldRuntimeContext';
import type { WorldRuntime } from './WorldRuntime';
import type { WorldDescriptor } from './WorldDescriptor';
import { PlacementSystem } from '../systems/PlacementSystem';
import type { ArenaLayout, GameMode } from '../types';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';

/** Vollstaendig aufgeloeste, aber noch nicht materialisierte Grundlage genau einer World. */
export interface PreparedWorldComposition {
  readonly world: WorldRuntimeContext;
  readonly mode: GameMode;
  readonly mapConfig: CoopDefenseMapConfig | null;
  readonly isCoopMission: boolean;
  readonly humanPlayerCount: number;
  readonly bases: readonly BaseSpec[];
  readonly locallyGeneratedLayout: ArenaLayout;
}

export interface PrepareWorldCompositionInput {
  readonly descriptor: WorldDescriptor;
  readonly activity: ActivityDescriptor | null;
  readonly roomGameMode: GameMode;
  readonly humanPlayerCount: number;
  readonly preparedLayout?: {
    readonly descriptor: Pick<WorldDescriptor, 'seed' | 'layoutFingerprint'>;
    readonly layout: ArenaLayout;
  } | null;
}

export interface WorldCompositionProfile {
  readonly mode: GameMode;
  readonly mapConfig: CoopDefenseMapConfig | null;
  readonly definition: WorldDefinition | null;
  readonly metricsProfile: ArenaMetricsProfile;
}

/** Loest die authored World-Quelle ohne Layout-Materialisierung auf. */
export function resolveWorldCompositionProfile(
  descriptor: WorldDescriptor,
  activity: ActivityDescriptor | null,
  roomGameMode: GameMode,
): WorldCompositionProfile {
  const mapId = toMapId(descriptor.definitionId);
  const mapConfig = mapId !== null ? getCoopDefenseMapConfig(mapId) : null;
  const definition: WorldDefinition | null = getWorldDefinition(descriptor.definitionId);
  const mode = resolveActiveGameMode({
    activityKind: activity?.kind ?? null,
    roomGameMode,
    worldDefinitionId: descriptor.definitionId,
  });
  return {
    mode,
    mapConfig,
    definition,
    metricsProfile: definition
      ? getAuthoredWorldMetricsProfile(definition.metrics.widthCells, definition.metrics.heightCells)
      : getArenaMetricsProfile(mode, 'ARENA'),
  };
}

/**
 * Loest World-Kontext, Layout und world-lokale Basen ohne Scene-State auf.
 *
 * Die Funktion ist eine konkrete Composition-Grenze, kein Owner: Sie speichert nichts und gibt
 * nur den Graphen zurueck, den anschliessend eine `WorldRuntime` besitzen wird.
 */
export function prepareWorldComposition(input: PrepareWorldCompositionInput): PreparedWorldComposition {
  const { descriptor, activity } = input;
  if (descriptor.generatorVersion !== ARENA_GENERATOR_VERSION) {
    throw new Error(
      `[WorldComposition] Unsupported arena generator version ${descriptor.generatorVersion}; `
      + `expected ${ARENA_GENERATOR_VERSION}`,
    );
  }

  const { mode, mapConfig, definition, metricsProfile } = resolveWorldCompositionProfile(
    descriptor,
    activity,
    input.roomGameMode,
  );
  const isCoopMission = activity?.kind === 'coop-mission';
  if (isCoopMission && mapConfig === null) {
    throw new Error('[WorldComposition] Coop activity has no authored World map');
  }
  const humanPlayerCount = isCoopMission
    ? Math.max(1, Math.floor(input.humanPlayerCount))
    : 1;
  const world = createWorldRuntimeContext({ descriptor, metricsProfile, definition });
  const bases = isCoopMission && mapConfig
    ? resolveCoopDefenseActivityBases(mapConfig, humanPlayerCount, world.metrics)
    : world.bases;
  const generationMapConfig = isCoopMission && mapConfig
    ? mapConfig
    : definition
      ? toWorldGenerationConfig(definition)
      : undefined;
  const prepared = input.preparedLayout;
  const locallyGeneratedLayout = prepared
    && prepared.descriptor.seed === descriptor.seed
    && prepared.descriptor.layoutFingerprint === descriptor.layoutFingerprint
    ? prepared.layout
    : generateWorldLayout({
      definitionId: descriptor.definitionId,
      seed: descriptor.seed,
      generation: resolveArenaGenerationInput(mode, world.metrics),
      mapConfig: generationMapConfig,
    });
  const actualFingerprint = ArenaGenerator.fingerprint(locallyGeneratedLayout);
  if (actualFingerprint !== descriptor.layoutFingerprint) {
    throw new Error(
      `[WorldComposition] Arena fingerprint mismatch: expected ${descriptor.layoutFingerprint}, `
      + `got ${actualFingerprint}`,
    );
  }

  return {
    world,
    mode,
    mapConfig,
    isCoopMission,
    humanPlayerCount,
    bases,
    locallyGeneratedLayout,
  };
}

export interface MaterializeWorldCompositionInput {
  readonly scene: Phaser.Scene;
  readonly runtime: WorldRuntime;
  readonly prepared: PreparedWorldComposition;
  readonly presentationRequired: boolean;
  readonly reusablePresentation: WorldPresentationBinding | null;
  readonly handoff: WorldPresentationHandoff;
  readonly persistentBaseGravel: GroundSurfacePersistentBaseGravelZone | null;
  readonly playerManager: PlayerManager;
  readonly persistentBaseSink: PersistentBaseWorldBindingSink;
  readonly baseDestructionHooks: BaseDestructionHooks;
  readonly lighting: LightingSystem;
  readonly damageBases: boolean;
  readonly createRockRegistry: boolean;
}

export interface MaterializedWorldComposition {
  readonly materialization: WorldMaterialization;
  readonly presentation: WorldPresentationBinding;
  readonly persistentBase: PersistentBaseWorldBinding;
  readonly layout: ArenaLayout;
  readonly arena: ArenaBuilderResult;
  readonly placement: PlacementSystem;
  readonly bases: BaseManager | null;
  readonly reusedPresentation: boolean;
}

/** Baut den konkreten World-Graph und uebergibt jeden Child-Owner sofort an die WorldRuntime. */
export function materializeWorldComposition(
  input: MaterializeWorldCompositionInput,
): MaterializedWorldComposition {
  const {
    prepared,
    presentationRequired,
    reusablePresentation,
  } = input;
  const { world, bases, locallyGeneratedLayout } = prepared;
  const reusableArena = reusablePresentation?.arena ?? null;
  const reusableLayout = reusablePresentation?.layout ?? null;
  const canReusePresentation = reusableArena !== null
    && reusableLayout !== null
    && presentationRequired
    && reusableArena.groundSurface !== null
    && reusableArena.rockOverlaySurface !== null
    && reusableArena.rockVisualSystem !== null;
  const layout = canReusePresentation ? reusableLayout : locallyGeneratedLayout;

  const materialization = new WorldMaterialization();
  input.runtime.materialize(materialization);
  const persistentBase = new PersistentBaseWorldBinding(input.persistentBaseSink);
  input.runtime.setPersistentBase(persistentBase);

  const builder = new ArenaBuilder(input.scene);
  let arena: ArenaBuilderResult;
  let adoptedPresentation: WorldPresentationBinding | null = null;
  if (canReusePresentation && reusableArena && reusableLayout) {
    const freshRuntime = builder.buildDynamic(locallyGeneratedLayout, {
      worldMetrics: world.metrics,
      presentation: false,
    });
    builder.rebindPresentation(
      reusableArena,
      reusableLayout,
      locallyGeneratedLayout,
      world.metrics,
      presentationRequired,
    );
    arena = ArenaBuilder.compose(freshRuntime, reusableArena);
    adoptedPresentation = input.handoff.adopt();
  } else {
    input.handoff.discard();
    arena = builder.buildDynamic(layout, {
      worldMetrics: world.metrics,
      presentation: presentationRequired,
      enablePersistentBaseGravel: input.persistentBaseGravel !== null,
      persistentBaseGravel: input.persistentBaseGravel ?? undefined,
    });
  }
  const presentation = adoptedPresentation
    ?? new WorldPresentationBinding(layout, ArenaBuilder.presentationOf(arena), {
      destroyPresentation: (shown) => { ArenaBuilder.destroyPresentation(shown); },
    });
  input.runtime.setPresentation(presentation);
  materialization.setArena(arena, (built) => { ArenaBuilder.destroyGameplay(built); });
  arena.groundSurface?.setPersistentBaseGravel(input.persistentBaseGravel);
  ArenaBuilder.updateSurfaceResidency(arena, getVisibleWorldView(input.scene.cameras.main));

  const placement = new PlacementSystem(
    layout,
    arena.rockGrid,
    input.playerManager,
    world.metrics,
    bases,
  );
  materialization.setPlacement(placement);
  const baseManager = bases.length > 0
    ? new BaseManager(
      input.scene,
      bases,
      world.metrics,
      input.baseDestructionHooks,
      presentationRequired,
      input.damageBases,
    )
    : null;
  materialization.setBases(baseManager);
  baseManager?.setLightingSystem(input.lighting);
  if (input.createRockRegistry) materialization.setRocks(new RockRegistry(layout));

  return {
    materialization,
    presentation,
    persistentBase,
    layout,
    arena,
    placement,
    bases: baseManager,
    reusedPresentation: canReusePresentation,
  };
}
