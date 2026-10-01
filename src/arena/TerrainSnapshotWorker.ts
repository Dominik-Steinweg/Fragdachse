import { TerrainSnapshotMaterial, type TerrainSnapshotMaterialSource } from './TerrainSnapshotMaterial';
export type TerrainSnapshotRequest =
  | { kind: 'init'; id: number; source: TerrainSnapshotMaterialSource }
  | { kind: 'bake'; id: number; side: number; x: number; y: number; width: number; height: number; buffer: ArrayBuffer };
export interface TerrainSnapshotResult { buffer: ArrayBuffer; cpuMs: number }
const materials = new Map<number, TerrainSnapshotMaterial>();
self.onmessage = (event: MessageEvent<TerrainSnapshotRequest>): void => {
  const request = event.data;
  if (request.kind === 'init') { materials.set(request.id, new TerrainSnapshotMaterial(request.source)); return; }
  const material = materials.get(request.id);
  if (!material) throw new Error('[TerrainColorSnapshot] Missing worker material.');
  const started = performance.now();
  material.write(new Uint8ClampedArray(request.buffer), request.side, request.x, request.y, request.width, request.height);
  self.postMessage({ buffer: request.buffer, cpuMs: performance.now() - started } satisfies TerrainSnapshotResult,
    { transfer: [request.buffer] });
};
