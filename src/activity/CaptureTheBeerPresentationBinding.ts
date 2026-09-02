import type { SyncedCaptureTheBeerBeer, SyncedCaptureTheBeerState } from '../types';
import type { CaptureTheBeerActivityRuntime } from './CaptureTheBeerActivityRuntime';

/** Der einzige Renderer-Anschluss des Activity-spezifischen CTB-Client-Bindings. */
export interface CaptureTheBeerPresentationRendererPort {
  readonly sync: (beers: readonly SyncedCaptureTheBeerBeer[]) => void;
}

/**
 * Activity-scoped client projection for Capture the Beer.
 *
 * The binding owns no network access and no rules. The lifecycle coordinator binds the current
 * activity runtime; the Scene supplies the already read snapshot at the historical frame point.
 */
export class CaptureTheBeerPresentationBinding {
  private runtime: CaptureTheBeerActivityRuntime | null = null;
  private destroyed = false;

  constructor(private readonly renderer: CaptureTheBeerPresentationRendererPort) {}

  bind(runtime: CaptureTheBeerActivityRuntime): void {
    if (this.destroyed || this.runtime === runtime) return;
    this.runtime = runtime;
  }

  detach(): void {
    this.runtime = null;
  }

  syncClient(snapshot: SyncedCaptureTheBeerState | null, worldPresentationRequired: boolean): void {
    if (this.destroyed || !worldPresentationRequired) return;
    this.renderer.sync(snapshot?.beers ?? []);
    this.runtime?.system.syncSnapshot(snapshot);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.runtime = null;
  }
}
