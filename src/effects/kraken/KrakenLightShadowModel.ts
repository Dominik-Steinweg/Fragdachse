/** Versioned pilot contract. No implicit reinterpretation of scalar elevation. */
export const KRAKEN_PACKED_NORMAL_ENCODING = 'linear-unorm8-z-oct-normal-v1' as const;
export interface KrakenShadowMesh {
  readonly id: string;
  readonly positions: Float32Array;
  readonly indices: Uint16Array;
  readonly bounds: { min: readonly number[]; max: readonly number[] };
}
export function decodeKrakenOctNormal(x: number, y: number): [number, number, number] {
  let nx = x * 2 - 1, ny = y * 2 - 1;
  const nz = 1 - Math.abs(nx) - Math.abs(ny), t = Math.max(0, -nz);
  nx += nx >= 0 ? -t : t; ny += ny >= 0 ? -t : t;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
/** Orthographic source canvas determines BU -> world pixels, never CELL_SIZE. */
export function krakenMeshMatrix(sprite: { x: number; y: number; rotation: number; displayWidth: number; displayHeight: number;
  originX: number; originY: number; flipX: boolean; flipY: boolean }, canvas: number, out: Float32Array): void {
  const c = Math.cos(sprite.rotation), s = Math.sin(sprite.rotation);
  const sx = sprite.displayWidth / canvas * (sprite.flipX ? -1 : 1), sy = sprite.displayHeight / canvas * (sprite.flipY ? -1 : 1);
  const dx = (.5 - sprite.originX) * sprite.displayWidth, dy = (.5 - sprite.originY) * sprite.displayHeight;
  out.fill(0); out[0] = c * sx; out[1] = s * sx; out[4] = -s * sy; out[5] = c * sy;
  out[10] = Math.sqrt(Math.abs(sx * sy)); out[12] = sprite.x + dx * c - dy * s;
  out[13] = sprite.y + dx * s + dy * c; out[15] = 1;
}
export function krakenProjectedBounds(mesh: KrakenShadowMesh, matrix: Float32Array, sun: readonly number[], pad: number): number[] {
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const x of [mesh.bounds.min[0], mesh.bounds.max[0]]) for (const y of [mesh.bounds.min[1], mesh.bounds.max[1]])
    for (const z of [0, mesh.bounds.min[2], mesh.bounds.max[2]]) {
      const height = Math.max(0, z * matrix[10]), wx = matrix[0] * x + matrix[4] * y + matrix[12], wy = matrix[1] * x + matrix[5] * y + matrix[13];
      for (const p of [[wx, wy], [wx - sun[0] * height / Math.max(.05, sun[2]), wy - sun[1] * height / Math.max(.05, sun[2])]])
        for (let axis = 0; axis < 2; axis++) { lo[axis] = Math.min(lo[axis], p[axis]); hi[axis] = Math.max(hi[axis], p[axis]); }
    }
  return [lo[0] - pad, lo[1] - pad, Math.max(1, hi[0] - lo[0]) + pad * 2, Math.max(1, hi[1] - lo[1]) + pad * 2];
}
