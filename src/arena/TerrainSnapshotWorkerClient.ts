import { loadingTimeline } from '../diagnostics/LoadingTimeline';
import type { TerrainSnapshotMaterialSource } from './TerrainSnapshotMaterial';
import type { TerrainSnapshotRequest, TerrainSnapshotResult } from './TerrainSnapshotWorker';

/** One build, one worker, one transferred batch in flight. Destroy never publishes
 * a late result into the next World/build. No global pool or retained World data. */
export class TerrainSnapshotWorkerClient {
  private readonly worker: Worker;
  private readonly sources = new Map<TerrainSnapshotMaterialSource, number>();
  private result: ArrayBuffer | null = null;
  private error: Error | null = null;
  private busy = false;
  private disposed = false;
  private materialKind = '';
  private native=false;
  constructor(create = () => new Worker(new URL('./TerrainSnapshotWorker.ts', import.meta.url), { type: 'module' })) {
    const measurement = loadingTimeline.capture();
    this.worker = create();
    this.worker.onmessage = (event: MessageEvent<TerrainSnapshotResult>) => {
      if (this.disposed) return;
      this.busy = false;
      this.result = event.data.buffer;
      measurement?.add(this.native?'chunks/material-worker':'terrain-snapshot/material-worker', event.data.cpuMs, 'worker');
      measurement?.add(`${this.native?'chunks':'terrain-snapshot'}/material-worker/${this.materialKind}`, event.data.cpuMs, 'worker');
    };
    this.worker.onerror = event => { if (!this.disposed) this.error = new Error(event.message); };
    this.worker.onmessageerror = () => { if (!this.disposed) this.error = new Error('[TerrainColorSnapshot] Worker decode failed.'); };
  }
  request(source: TerrainSnapshotMaterialSource, side: number, x: number, y: number,
    width: number, height: number, buffer: ArrayBuffer, native=false): void {
    if (this.disposed || this.busy || this.result) throw new Error('[TerrainColorSnapshot] Invalid worker request lifetime.');
    let id = this.sources.get(source);
    if (id === undefined) {
      id = this.sources.size;
      this.sources.set(source, id);
      // Clone immutable source data; never detach the visible renderer's materials.
      this.worker.postMessage({ kind: 'init', id, source } satisfies TerrainSnapshotRequest);
    }
    this.busy = true;
    this.materialKind = source.kind;this.native=native;
    this.worker.postMessage({ kind: 'bake', id, side, x, y, width, height, buffer, native } satisfies TerrainSnapshotRequest, [buffer]);
  }
  take(): ArrayBuffer | null {
    if (this.error) throw this.error;
    const result = this.result;
    this.result = null;
    return result;
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.onmessage = null; this.worker.onerror = null; this.worker.onmessageerror = null;
    this.worker.terminate(); this.sources.clear(); this.result = null;
  }
}
