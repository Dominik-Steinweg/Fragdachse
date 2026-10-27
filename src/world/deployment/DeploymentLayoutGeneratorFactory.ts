/**
 * Chooses the execution substrate. Only this file pulls the worker generator, and with it the
 * worker entry, into the graph; Vite must see `new Worker(new URL(...))` statically to bundle it.
 */
import { InlineDeploymentLayoutGenerator, type DeploymentLayoutGenerator } from './DeploymentLayoutGenerator';
import { WorkerDeploymentLayoutGenerator } from './WorkerDeploymentLayoutGenerator';

export function createDeploymentLayoutGenerator(): DeploymentLayoutGenerator {
  if (typeof Worker === 'undefined') return new InlineDeploymentLayoutGenerator();
  try {
    return new WorkerDeploymentLayoutGenerator();
  } catch {
    return new InlineDeploymentLayoutGenerator();
  }
}
