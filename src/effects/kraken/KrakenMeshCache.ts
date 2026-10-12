import type { PipelineBossAsset } from '../../config/pipelineAssetContracts';
import type { KrakenShadowMesh } from './KrakenLightShadowModel';

/** Activity-scoped CPU pose cache. GPU buffers are bounded separately by each live caster. */
export class KrakenMeshCache {
  private abort = new AbortController();
  private readonly entries = new Map<string, { mesh?: KrakenShadowMesh; pending?: Promise<void> }>();
  constructor(private readonly diagnostic: (message: string) => void, private readonly capacity = 32) {}
  get bytes(): number { return [...this.entries.values()].reduce((n, e) => n + (e.mesh ? e.mesh.positions.byteLength + e.mesh.indices.byteLength : 0), 0); }
  get(asset: PipelineBossAsset, sourceFrame: number, analytic = false): KrakenShadowMesh | undefined {
    if (this.abort.signal.aborted) return;
    const record = asset.shadowMesh?.frames[sourceFrame];
    if (!record) return;
    const key = `${asset.id}:${asset.revision}:${sourceFrame}`;
    // Low and egg contacts need only authored bounds. Do not fetch proxy geometry,
    // or cache a bounds-only entry that could mask a later High/Medium request.
    if (analytic || asset.id === 'abyssal-kraken-egg') return {
      id: `${key}:bounds`, positions: new Float32Array(), indices: new Uint16Array(), bounds: record.bounds,
    };
    const old = this.entries.get(key);
    if (old) { this.entries.delete(key); this.entries.set(key, old); return old.mesh; }
    if (this.entries.size >= this.capacity) {
      const evict = [...this.entries].find(([, value]) => !value.pending);
      if (!evict) return;
      this.entries.delete(evict[0]);
    }
    const entry: { mesh?: KrakenShadowMesh; pending?: Promise<void> } = {};
    const ownerSignal = this.abort.signal;
    this.entries.set(key, entry);
    const read = async (r: typeof record.positions) => {
      const response = await fetch(`${r.file}?v=${r.sha256}`, { signal: AbortSignal.any([ownerSignal, AbortSignal.timeout(30000)]) });
      if (!response.ok) throw Error(`Mesh HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
      if (bytes.byteLength !== r.bytes || hash !== r.sha256) throw Error('Mesh hash/size mismatch');
      return bytes;
    };
    entry.pending = Promise.all([read(record.positions), read(record.indices)]).then(([p, i]) => {
      if (ownerSignal.aborted) return;
      const packed = new DataView(p), positions = new Float32Array(record.vertexCount * 3), indices = new Uint16Array(i);
      for (let j = 0; j < positions.length; j++) {
        const axis = j % 3;
        positions[j] = record.bounds.min[axis] + packed.getUint16(j * 2, true) / 65535 * (record.bounds.max[axis] - record.bounds.min[axis]);
      }
      if (indices.some(v => v >= record.vertexCount)) throw Error('Mesh index outside pose');
      entry.mesh = { id: key, positions, indices, bounds: record.bounds };
    }).catch(error => { if (!ownerSignal.aborted) this.diagnostic(String(error)); if (this.entries.get(key) === entry) this.entries.delete(key); })
      .finally(() => { entry.pending = undefined; });
    return undefined;
  }
  /** A completed boss releases CPU poses and pending fetches; the Activity may start another boss. */
  clear(): void {
    if (this.abort.signal.aborted) return;
    this.abort.abort(); this.entries.clear(); this.abort = new AbortController();
  }
  destroy(): void { this.abort.abort(); this.entries.clear(); }
}
