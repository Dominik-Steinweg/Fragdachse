import { CHARACTER_MESH_MANIFEST as manifest, type CharacterMeshSpec } from '../assets/CharacterMeshAssets';
import { getHeldItemSpriteSpec } from '../loadout/HeldItemVisuals';
import { CHARACTER_SHADOW_CONFIG as config } from './ShadowConfig';

export const meshPose = (frame: string | number): number => {
  const pose = Number(frame); return Number.isInteger(pose) && pose >= 0 && pose < manifest.poses.length ? pose : 0;
};
export interface MeshDisplayPose {
  x: number; y: number; rotation: number; scaleX: number; scaleY: number;
  displayWidth: number; displayHeight: number; originX: number; originY: number;
  flipX: boolean; flipY: boolean; frame: { name: string | number; realWidth: number; realHeight: number };
}
/** Column-major asset-to-world matrix; X right, Y south, clockwise rotation, Z up. */
export function bodyMeshMatrix(sprite: MeshDisplayPose, out = new Float32Array(16)): Float32Array {
  const c = Math.cos(sprite.rotation), s = Math.sin(sprite.rotation), size = manifest.coordinates.bodyCanvasWorldPx;
  const sx = sprite.scaleX * sprite.frame.realWidth / size * (sprite.flipX ? -1 : 1);
  const sy = sprite.scaleY * sprite.frame.realHeight / size * (sprite.flipY ? -1 : 1);
  const px = (.5 - sprite.originX) * sprite.displayWidth, py = (.5 - sprite.originY) * sprite.displayHeight;
  out.fill(0); out[0] = c * sx; out[1] = s * sx; out[4] = -s * sy; out[5] = c * sy;
  out[10] = Math.sqrt(Math.abs(sx * sy)); out[12] = sprite.x + c * px - s * py;
  out[13] = sprite.y + s * px + c * py; out[15] = 1; return out;
}
export function characterHandSocket(sprite: MeshDisplayPose) {
  const m = bodyMeshMatrix(sprite), socket = manifest.sockets[meshPose(sprite.frame.name)].weapon, p = socket.position;
  // The baked socket locates the grip. Its yaw describes the sculpted palm,
  // not weapon aim: north-authored held items follow the displayed facing.
  // Recoil is added by HeldItemVisual; the shadow reads that final image pose.
  return { x: m[12] + m[0] * p[0] + m[4] * p[1], y: m[13] + m[1] * p[0] + m[5] * p[1],
    z: m[10] * p[2], yaw: sprite.rotation };
}
export const meshForHeldTexture = new Map<string, CharacterMeshSpec>();
for (const spec of manifest.meshes) for (const id of 'gameIds' in spec ? spec.gameIds ?? [] : []) {
  const visual = getHeldItemSpriteSpec(id); if (visual) meshForHeldTexture.set(visual.textureKey, spec);
}
/** The displayed image already includes socket yaw and recoil. Z comes from the same baked socket.
 * Current production sockets are planar yaw rotations; the asset test guards that contract. */
export function weaponMeshMatrix(weapon: MeshDisplayPose, body: MeshDisplayPose, out = new Float32Array(16)): Float32Array {
  bodyMeshMatrix(weapon, out);
  // Image origin is the authored grip, while mesh positions are already grip-local.
  out[12] = weapon.x; out[13] = weapon.y; out[14] = characterHandSocket(body).z;
  return out;
}
/** Reference for bounds/tests; the GPU uses exactly this projection after the model transform. */
export function projectMeshPoint(p: readonly number[], m: Float32Array, sun: readonly number[]): [number, number] {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const reach = Math.max(0, z) / Math.max(0.05, sun[2]);
  return [x - sun[0] * reach, y - sun[1] * reach];
}
export function extendMeshBounds(bounds: number[], mesh: CharacterMeshSpec, matrix: Float32Array, sun: readonly number[]): void {
  for (let i = 0; i < 8; i++) {
    const p = [mesh.bounds[(i & 1) ? 'max' : 'min'][0], mesh.bounds[(i & 2) ? 'max' : 'min'][1], mesh.bounds[(i & 4) ? 'max' : 'min'][2]];
    const q = projectMeshPoint(p, matrix, sun);
    bounds[0] = Math.min(bounds[0], q[0]); bounds[1] = Math.min(bounds[1], q[1]);
    bounds[2] = Math.max(bounds[2], q[0]); bounds[3] = Math.max(bounds[3], q[1]);
  }
}
export function meshShadowOpacity(strength: number, elevation: number): number {
  if (!(strength > 0 && elevation > 0)) return 0;
  const lowCot = 1 / Math.tan(35 * Math.PI / 180), highCot = 1;
  const t = Math.max(0, Math.min(1, (lowCot - 1 / Math.tan(elevation)) / (lowCot - highCot)));
  return Math.min(1, strength) * (config.lowSunOpacity + (config.directOpacity - config.lowSunOpacity) * t * t * t);
}
