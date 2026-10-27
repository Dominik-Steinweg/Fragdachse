import { ArenaGenerator, ARENA_GENERATOR_VERSION } from '../../arena/ArenaGenerator';
import type { CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import type { ArenaLayout } from '../../types';
import type { DeploymentLayoutGenerator } from './DeploymentLayoutGenerator';

/** A generated deployment layout together with the fingerprint the round start will check. */
export interface DeploymentLayout {
  readonly mapId: string;
  readonly seed: number;
  readonly layout: ArenaLayout;
  readonly fingerprint: string;
}

const CAPACITY = 2;

/**
 * Layouts of upcoming rounds, keyed by generator version, map and deployment seed.
 *
 * Generation is expensive, so a layout is generated once in the background and kept; opening the
 * base editor again or toggling between two maps does not generate again. Concurrent requests for
 * the same key share one generation. Handed-out layouts are clones: runtime code mutates layouts.
 */
export class DeploymentLayoutCache {
  private readonly entries = new Map<string, Promise<DeploymentLayout>>();
  private readonly settled = new Map<string, DeploymentLayout>();
  private destroyed = false;

  constructor(private readonly generator: DeploymentLayoutGenerator) {}

  static key(mapId: string, seed: number): string {
    return `${ARENA_GENERATOR_VERSION}|${mapId}|${seed}`;
  }

  /** The finished layout, if it is ready; never starts a generation. */
  peek(mapId: string, seed: number): DeploymentLayout | null {
    const entry = this.settled.get(DeploymentLayoutCache.key(mapId, seed));
    return entry ? cloneDeploymentLayout(entry) : null;
  }

  request(mapConfig: CoopDefenseMapConfig, seed: number): Promise<DeploymentLayout> {
    if (this.destroyed) return Promise.reject(new Error('deployment layout cache destroyed'));
    const key = DeploymentLayoutCache.key(mapConfig.mapId, seed);
    let entry = this.entries.get(key);
    if (!entry) {
      const generation = this.generator.generate({ mapConfig, seed }).then((layout) => {
        const result = { mapId: mapConfig.mapId, seed, layout, fingerprint: ArenaGenerator.fingerprint(layout) };
        if (this.entries.get(key) === generation) this.settled.set(key, result);
        return result;
      });
      // A failed generation is not cached; the next request tries again.
      generation.catch(() => { if (this.entries.get(key) === generation) this.entries.delete(key); });
      this.entries.set(key, generation);
      this.evict();
      entry = generation;
    }
    return entry.then(cloneDeploymentLayout);
  }

  destroy(): void {
    this.destroyed = true;
    this.entries.clear();
    this.settled.clear();
    this.generator.destroy();
  }

  private evict(): void {
    while (this.entries.size > CAPACITY) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
      this.settled.delete(oldest);
    }
  }
}

function cloneDeploymentLayout(entry: DeploymentLayout): DeploymentLayout {
  return { ...entry, layout: structuredClone(entry.layout) };
}
