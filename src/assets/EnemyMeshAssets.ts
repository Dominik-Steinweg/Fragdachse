import type * as Phaser from 'phaser';
import manifest from './manifests/enemy-mesh-families.json';
import { runtimeAssetUrl } from './RuntimeAssetUrls';

export { manifest as ENEMY_MESH_MANIFEST };
export type EnemyMeshAsset = (typeof manifest.assets)[number];
export interface EnemyMeshData { asset: EnemyMeshAsset; positions: Float32Array; indices: Uint16Array }
type Pending = { asset: EnemyMeshAsset; positions: DataView; result: EnemyMeshData; pose: number };
const assets = new Map(manifest.assets.map(a => [a.id, a]));

/** Optional, game-owned CPU cache. Fetch is deduplicated; decoding consumes one pose per pump.
 * No scene loader callbacks survive world teardown and no shader is published before all poses exist. */
export class EnemyMeshAssets {
  readonly ready = new Map<string, EnemyMeshData>();
  private readonly pending: Pending[] = [];
  private readonly requests = new Set<string>();
  private readonly failures = new Map<string, { attempts: number; retryAt: number }>();
  private lastFrame = -1;
  prefetch(types: Iterable<string>): void {
    for (const id of types) {
      const asset = assets.get(id), failure = this.failures.get(id);
      if (!asset || this.requests.has(id) || this.ready.has(id)
        || failure && (failure.attempts >= 3 || performance.now() < failure.retryAt)) continue;
      this.requests.add(id);
      void Promise.all(['positions', 'indices'].map(async part => {
        const spec = asset.mesh[part as 'positions' | 'indices'];
        const response = await fetch(runtimeAssetUrl('./' + spec.url));
        if (!response.ok) throw Error(`Enemy mesh HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== spec.bytes) throw Error('Enemy mesh byte count');
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hash = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
        if (hash !== spec.sha256) throw Error('Enemy mesh hash mismatch');
        return bytes;
      })).then(([positions, indices]) => {
        const input = new DataView(indices), output = new Uint16Array(asset.mesh.triangleCount * 3);
        for (let i = 0; i < output.length; i++) {
          output[i] = input.getUint16(i * 2, true);
          if (output[i] >= asset.mesh.vertexCount) throw Error('Enemy mesh index');
        }
        this.pending.push({ asset, positions: new DataView(positions), pose: 0,
          result: { asset, positions: new Float32Array(asset.mesh.vertexCount * 3 * asset.poses.length), indices: output } });
      }).catch(error => {
        this.requests.delete(id);
        this.failures.set(id, { attempts: (failure?.attempts ?? 0) + 1, retryAt: performance.now() + 5000 });
        console.warn('[EnemyMeshAssets] Ellipse fallback:', id, error);
      });
    }
  }
  pump(frame: number): void {
    if (this.lastFrame === frame) return;
    this.lastFrame = frame;
    const item = this.pending[0]; if (!item) return;
    const n = item.asset.mesh.vertexCount * 3, start = item.pose * n, bounds = item.asset.mesh.bounds;
    for (let i = start; i < start + n; i++) {
      const axis = i % 3;
      item.result.positions[i] = bounds.min[axis] + item.positions.getUint16(i * 2, true) / 65535 * (bounds.max[axis] - bounds.min[axis]);
    }
    if (++item.pose === item.asset.poses.length) {
      this.ready.set(item.asset.id, item.result); this.pending.shift();
    }
  }
  inspect() { return { ready: [...this.ready.keys()], pending: this.pending.length, failed: [...this.failures.keys()] }; }
}
const owners = new WeakMap<object, EnemyMeshAssets>();
export function getEnemyMeshAssets(scene: Phaser.Scene): EnemyMeshAssets {
  let owner = owners.get(scene.game);
  if (!owner) { owner = new EnemyMeshAssets(); owners.set(scene.game, owner); }
  return owner;
}
