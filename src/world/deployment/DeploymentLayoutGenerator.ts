import type { CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../../gameModes';
import type { ArenaLayout } from '../../types';
import { generateRoundWorldLayout } from '../RoundWorldLayout';

/** One campaign layout to generate: the full map config and the deployment seed. */
export interface DeploymentLayoutRequest {
  readonly mapConfig: CoopDefenseMapConfig;
  readonly seed: number;
}

/** Generates deployment layouts off the frame that asked for them. */
export interface DeploymentLayoutGenerator {
  readonly kind: 'worker' | 'inline';
  generate(request: DeploymentLayoutRequest): Promise<ArenaLayout>;
  destroy(): void;
}

/** The layout a deployment request yields; the worker entry and the inline fallback share it. */
export function generateDeploymentLayout(request: DeploymentLayoutRequest): ArenaLayout {
  return generateRoundWorldLayout(COOP_DEFENSE_MODE, request.mapConfig, request.seed);
}

/** Fallback without workers (tests, old browsers): still asynchronous, so callers see one contract. */
export class InlineDeploymentLayoutGenerator implements DeploymentLayoutGenerator {
  readonly kind = 'inline' as const;
  private destroyed = false;

  generate(request: DeploymentLayoutRequest): Promise<ArenaLayout> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (this.destroyed) { reject(new Error('deployment layout generator destroyed')); return; }
        try { resolve(generateDeploymentLayout(request)); } catch (cause) { reject(cause); }
      }, 0);
    });
  }

  destroy(): void {
    this.destroyed = true;
  }
}
