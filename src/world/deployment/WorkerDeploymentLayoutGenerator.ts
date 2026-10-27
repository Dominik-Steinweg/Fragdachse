/**
 * Owns the deployment layout worker. Only the factory imports this module, so tests and the
 * inline fallback never load the worker entry.
 */
import type { ArenaLayout } from '../../types';
import type { DeploymentLayoutGenerator, DeploymentLayoutRequest } from './DeploymentLayoutGenerator';
import type { DeploymentLayoutWorkerRequest } from './DeploymentLayoutWorker';

type WorkerResponse = { readonly id: number; readonly layout: ArenaLayout } | { readonly id: number; readonly error: string };

export class WorkerDeploymentLayoutGenerator implements DeploymentLayoutGenerator {
  readonly kind = 'worker' as const;
  private readonly worker: Worker;
  private readonly pending = new Map<number, { resolve: (layout: ArenaLayout) => void; reject: (cause: Error) => void }>();
  private nextId = 1;

  constructor() {
    this.worker = new Worker(new URL('./DeploymentLayoutWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if ('error' in response) pending.reject(new Error(response.error));
      else pending.resolve(response.layout);
    };
    this.worker.onerror = (event: ErrorEvent): void => this.failAll(event.message || 'worker error');
    this.worker.onmessageerror = (): void => this.failAll('worker message could not be deserialized');
  }

  generate(request: DeploymentLayoutRequest): Promise<ArenaLayout> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const message: DeploymentLayoutWorkerRequest = { id, mapConfig: request.mapConfig, seed: request.seed };
      this.worker.postMessage(message);
    });
  }

  destroy(): void {
    this.failAll('deployment layout generator destroyed');
    this.worker.terminate();
  }

  private failAll(reason: string): void {
    for (const pending of this.pending.values()) pending.reject(new Error(reason));
    this.pending.clear();
  }
}
