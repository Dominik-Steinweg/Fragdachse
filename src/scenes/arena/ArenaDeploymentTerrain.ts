import type { CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import { isCoopDefenseMode } from '../../gameModes';
import { toWorldDefinitionId } from '../../world/arenaDescriptorAdapter';
import { resolveCoopDefenseMapConfig } from '../../world/WorldDefinitionResolution';
import { DeploymentLayoutCache, type DeploymentLayout } from '../../world/deployment/DeploymentLayoutCache';
import { createDeploymentLayoutGenerator } from '../../world/deployment/DeploymentLayoutGeneratorFactory';
import type { GameMode, GamePhase } from '../../types';

/** What the lobby currently announces for the next round. */
export interface DeploymentTerrainSource {
  getGamePhase(): GamePhase;
  getGameMode(): GameMode;
  getCoopProgram(): { readonly kind: string };
  getCoopDefenseMapId(): string;
  getDeploymentSeed(): number | null;
}

/** The next round's campaign map and seed, when its terrain can be previewed. */
export interface Deployment {
  readonly mapConfig: CoopDefenseMapConfig;
  readonly seed: number;
}

/**
 * Terrain of the next round, generated in the lobby before the round starts.
 *
 * Every peer generates it from the host's lobby snapshot (map and deployment seed) in the
 * background, so the base editor can show the real terrain around the base. Only campaign maps
 * with a persistent base have a preview: Dawn plans depend on the host's progress.
 */
export class ArenaDeploymentTerrain {
  private cache: DeploymentLayoutCache | null = null;
  private prefetchedKey: string | null = null;

  constructor(private readonly source: DeploymentTerrainSource) {}

  /** The deployment the lobby announces, or `null` when there is no previewable terrain. */
  current(): Deployment | null {
    if (!isCoopDefenseMode(this.source.getGameMode()) || this.source.getCoopProgram().kind !== 'campaign') return null;
    const seed = this.source.getDeploymentSeed();
    const mapConfig = resolveCoopDefenseMapConfig({ definitionId: toWorldDefinitionId(this.source.getCoopDefenseMapId()) }, null);
    return seed === null || !mapConfig?.persistentBase ? null : { mapConfig, seed };
  }

  /** Generates the announced terrain once per map and seed while the room is in the lobby. */
  prefetch(): void {
    if (this.source.getGamePhase() !== 'LOBBY') return;
    const deployment = this.current();
    const key = deployment ? DeploymentLayoutCache.key(deployment.mapConfig.mapId, deployment.seed) : null;
    if (!deployment || key === this.prefetchedKey) return;
    this.prefetchedKey = key;
    // A failed generation is reported to whoever asks for this terrain; the prefetch stays quiet.
    this.layouts().request(deployment.mapConfig, deployment.seed).catch(() => { this.prefetchedKey = null; });
  }

  /** The finished terrain of the announced deployment, if it is ready. */
  peek(deployment: Deployment): DeploymentLayout | null {
    return this.cache?.peek(deployment.mapConfig.mapId, deployment.seed) ?? null;
  }

  request(deployment: Deployment): Promise<DeploymentLayout> {
    return this.layouts().request(deployment.mapConfig, deployment.seed);
  }

  destroy(): void {
    this.cache?.destroy();
    this.cache = null;
  }

  private layouts(): DeploymentLayoutCache {
    this.cache ??= new DeploymentLayoutCache(createDeploymentLayoutGenerator());
    return this.cache;
  }
}
