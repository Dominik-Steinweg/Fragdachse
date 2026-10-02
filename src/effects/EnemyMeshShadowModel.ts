import type { EnemyMeshData } from '../assets/EnemyMeshAssets';
import type { MeshDisplayPose } from './CharacterMeshModel';
import { projectMeshPoint, meshShadowSoftness } from './CharacterMeshModel';

export const ENEMY_SHADOW_CAPACITY = 512;
export const ENEMY_SHADOW_COLUMNS = 32;
export const ENEMY_SHADOW_DEPTH = 9.92;
export const ENEMY_SHADOW_PAD = 5;

/** No extra jump translation: source positions already contain the attack root's Z. */
export function enemyMeshMatrix(sprite: MeshDisplayPose, canvas: number, out: Float32Array): void {
  const c = Math.cos(sprite.rotation), s = Math.sin(sprite.rotation);
  const sx = sprite.scaleX * sprite.frame.realWidth / canvas * (sprite.flipX ? -1 : 1);
  const sy = sprite.scaleY * sprite.frame.realHeight / canvas * (sprite.flipY ? -1 : 1);
  const px = (.5 - sprite.originX) * sprite.displayWidth, py = (.5 - sprite.originY) * sprite.displayHeight;
  out.fill(0); out[0] = c * sx; out[1] = s * sx; out[4] = -s * sy; out[5] = c * sy;
  out[10] = Math.sqrt(Math.abs(sx * sy)); out[12] = sprite.x + c * px - s * py;
  out[13] = sprite.y + s * px + c * py; out[15] = 1;
}
export function enemyMeshPose(frame: string | number, data: EnemyMeshData): number {
  if (frame === '__BASE') return 0;
  const pose = Number(frame);
  return Number.isInteger(pose) && data.asset.mesh.poseIndices.includes(pose) ? pose : -1;
}
/** Conservative all-pose bounds also enclose contacts. Includes a five-texel transparent gutter. */
export function enemyShadowBounds(data: EnemyMeshData, matrix: Float32Array, sun: readonly number[], tileSize: number, out: number[]): void {
  out[0] = out[1] = Infinity; out[2] = out[3] = -Infinity;
  const bounds = data.asset.mesh.bounds;
  for (let i = 0; i < 8; i++) {
    const p = [bounds[i & 1 ? 'max' : 'min'][0], bounds[i & 2 ? 'max' : 'min'][1], bounds[i & 4 ? 'max' : 'min'][2]];
    const q = projectMeshPoint(p, matrix, sun);
    out[0] = Math.min(out[0], q[0]); out[1] = Math.min(out[1], q[1]);
    out[2] = Math.max(out[2], q[0]); out[3] = Math.max(out[3], q[1]);
  }
  const w = Math.max(1, out[2] - out[0]) + 6 * matrix[10], h = Math.max(1, out[3] - out[1]) + 6 * matrix[10];
  const pad = ENEMY_SHADOW_PAD / (tileSize - ENEMY_SHADOW_PAD * 2);
  const kernelPad = meshShadowSoftness(matrix[10], sun[2]) * 4 + 1;
  const px = Math.max(w * pad, kernelPad), py = Math.max(h * pad, kernelPad);
  out[0] -= px + 3 * matrix[10]; out[1] -= py + 3 * matrix[10];
  out[2] = w + 2 * px; out[3] = h + 2 * py;
}
