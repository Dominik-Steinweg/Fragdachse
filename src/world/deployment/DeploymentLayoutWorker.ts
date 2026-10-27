/**
 * Worker entry for deployment layouts. Kept thin: generation is the same function the inline
 * fallback and the round start use. The worker global is typed locally, as in the flowfield worker.
 */
import { generateDeploymentLayout, type DeploymentLayoutRequest } from './DeploymentLayoutGenerator';

interface DeploymentLayoutWorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: DeploymentLayoutWorkerRequest }) => void) | null;
}

export interface DeploymentLayoutWorkerRequest extends DeploymentLayoutRequest {
  readonly id: number;
}

const scope = globalThis as unknown as DeploymentLayoutWorkerScope;

scope.onmessage = (event: { data: DeploymentLayoutWorkerRequest }): void => {
  const { id } = event.data;
  try {
    scope.postMessage({ id, layout: generateDeploymentLayout(event.data) });
  } catch (cause) {
    scope.postMessage({ id, error: cause instanceof Error ? cause.message : String(cause) });
  }
};
