import type * as Phaser from 'phaser';
import manifest from './manifests/character-mesh-badger-player-mesh-22-production-r3.json';
import { runtimeAssetUrl } from './RuntimeAssetUrls';
import { preloadCharacterMaterialAssets, assertCharacterMaterialAssetsReady } from './CharacterMaterialAssets';

export { manifest as CHARACTER_MESH_MANIFEST };
export type CharacterMeshSpec = (typeof manifest.meshes)[number];
export interface CharacterMeshData { spec: CharacterMeshSpec; positions: Float32Array; indices: Uint16Array }
const key = (id: string, part: string): string => `character-mesh:${manifest.revision}:${id}:${part}`;
const decoded = new WeakMap<object, ReadonlyMap<string, CharacterMeshData>>();

/** Binary loader/cache, never an Image/Canvas/PMA or colour-publication path. */
export function preloadCharacterMeshAssets(scene: Phaser.Scene): void {
  preloadCharacterMaterialAssets(scene);
  for (const mesh of manifest.meshes) for (const part of ['positions', 'indices'] as const) {
    if (!scene.cache.binary.exists(key(mesh.id, part)))
      scene.load.binary(key(mesh.id, part), runtimeAssetUrl('./' + mesh[part].url));
  }
}
export function decodeCharacterMesh(spec: CharacterMeshSpec, positions: ArrayBuffer, indices: ArrayBuffer): CharacterMeshData {
  if (positions.byteLength !== spec.positions.bytes || indices.byteLength !== spec.indices.bytes)
    throw new Error(`Character mesh byte count: ${spec.id}`);
  const input = new DataView(positions), positionsOut = new Float32Array(spec.vertexCount * spec.poseIndices.length * 3);
  const indexInput = new DataView(indices), indicesOut = new Uint16Array(spec.triangleCount * 3);
  for (let i = 0; i < positionsOut.length; i++) {
    const axis = i % 3;
    positionsOut[i] = spec.bounds.min[axis] + input.getUint16(i * 2, true) / 65535 * (spec.bounds.max[axis] - spec.bounds.min[axis]);
  }
  for (let i = 0; i < indicesOut.length; i++) {
    const index = indexInput.getUint16(i * 2, true);
    if (index >= spec.vertexCount) throw new Error(`Character mesh index: ${spec.id}`);
    indicesOut[i] = index;
  }
  return { spec, positions: positionsOut, indices: indicesOut };
}
export function getCharacterMeshes(scene: Phaser.Scene): ReadonlyMap<string, CharacterMeshData> | null {
  const cache = scene.cache.binary, prior = decoded.get(cache);
  if (prior) return prior;
  const result = new Map<string, CharacterMeshData>();
  for (const spec of manifest.meshes) {
    const p = cache.get(key(spec.id, 'positions')), i = cache.get(key(spec.id, 'indices'));
    if (!p || !i) return null;
    result.set(spec.id, decodeCharacterMesh(spec, p, i));
  }
  decoded.set(cache, result); return result;
}
export function assertCharacterMeshAssetsReady(scene: Phaser.Scene): void {
  assertCharacterMaterialAssetsReady(scene);
  if (!getCharacterMeshes(scene)) throw new Error('Character mesh buffers are incomplete.');
}
