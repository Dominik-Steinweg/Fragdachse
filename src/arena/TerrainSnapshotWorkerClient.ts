import { loadingTimeline } from '../diagnostics/LoadingTimeline';
import type { TerrainSnapshotMaterialSource } from './TerrainSnapshotMaterial';
import type { TerrainSnapshotRequest, TerrainSnapshotResult } from './TerrainSnapshotWorker';

/** One build, one worker, at most `capacity` transferred batches in flight; results return in
 * request order. Destroy never publishes a late result into the next World/build. No global
 * pool or retained World data. */
export class TerrainSnapshotWorkerClient {
  private readonly worker: Worker;
  private readonly sources = new Map<TerrainSnapshotMaterialSource, number>();
  private readonly results: ArrayBuffer[] = [];
  private error: Error | null = null;
  private inFlight = 0;
  private disposed = false;
  private materialKind = '';
  private native=false;
  constructor(create = () => new Worker(new URL('./TerrainSnapshotWorker.ts', import.meta.url), { type: 'module' }),
    private readonly capacity = 1) {
    const measurement = loadingTimeline.capture();
    this.worker = create();
    this.worker.onmessage = (event: MessageEvent<TerrainSnapshotResult>) => {
      if (this.disposed) return;
      this.inFlight--;
      this.results.push(event.data.buffer);
      measurement?.add(this.native?'chunks/material-worker':'terrain-snapshot/material-worker', event.data.cpuMs, 'worker');
      measurement?.add(`${this.native?'chunks':'terrain-snapshot'}/material-worker/${this.materialKind}`, event.data.cpuMs, 'worker');
    };
    this.worker.onerror = event => { if (!this.disposed) this.error = new Error(event.message); };
    this.worker.onmessageerror = () => { if (!this.disposed) this.error = new Error('[TerrainColorSnapshot] Worker decode failed.'); };
  }
  request(source: TerrainSnapshotMaterialSource, side: number, x: number, y: number,
    width: number, height: number, buffer: ArrayBuffer, native=false): void {
    if (!this.canRequest()) throw new Error('[TerrainColorSnapshot] Invalid worker request lifetime.');
    let id = this.sources.get(source);
    if (id === undefined) {
      id = this.sources.size;
      this.sources.set(source, id);
      // Clone immutable source data; never detach the visible renderer's materials.
      this.worker.postMessage({ kind: 'init', id, source } satisfies TerrainSnapshotRequest);
    }
    this.inFlight++;
    this.materialKind = source.kind;this.native=native;
    this.worker.postMessage({ kind: 'bake', id, side, x, y, width, height, buffer, native } satisfies TerrainSnapshotRequest, [buffer]);
  }
  /** Unclaimed results count towards the capacity: every request is taken before the next. */
  canRequest(): boolean {
    return !this.disposed && this.inFlight + this.results.length < this.capacity;
  }
  /** The oldest finished result, in request order. */
  take(): ArrayBuffer | null {
    if (this.error) throw this.error;
    return this.results.shift() ?? null;
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.onmessage = null; this.worker.onerror = null; this.worker.onmessageerror = null;
    this.worker.terminate(); this.sources.clear(); this.results.length = 0;
  }
}
