import { CHARACTER_MESH_MANIFEST as manifest, type CharacterMeshSpec } from '../assets/CharacterMeshAssets';
import { getHeldItemSpriteSpec } from '../loadout/HeldItemVisuals';
import { getHeldItemAnchor, HELD_ITEM_TEXTURE_SIZE } from '../config';
import { CHARACTER_SHADOW_CONFIG as config } from './ShadowConfig';

export const meshPose = (frame: string | number): number => {
  const pose = Number(frame); return Number.isInteger(pose) && pose >= 0 && pose < manifest.poses.length ? pose : 0;
};
export interface MeshDisplayPose {
  x: number; y: number; rotation: number; scaleX: number; scaleY: number;
  displayWidth: number; displayHeight: number; originX: number; originY: number;
  flipX: boolean; flipY: boolean; frame: { name: string | number; realWidth: number; realHeight: number };
}
/** World-space Gaussian step, shared by figure renderers regardless of target resolution. */
export function meshShadowSoftness(scale: number, sunZ: number): number {
  return scale * (.65 + .65 * (1 - Math.max(0, sunZ)));
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
  // The baked right-palm position/orientation is anatomical, not the authored
  // held-item grip. Share the lobby's visual anchor and displayed scale/facing;
  // only the weapon's height comes from the current mesh pose. Recoil is added
  // by HeldItemVisual, and the shadow reads that final image transform.
  const anchor = getHeldItemAnchor(sprite.x, sprite.y, sprite.rotation, sprite.displayWidth / HELD_ITEM_TEXTURE_SIZE);
  return { x: anchor.x, y: anchor.y, z: m[10] * p[2], yaw: sprite.rotation };
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
export function extendMeshBounds(bounds: number[], mesh: Pick<CharacterMeshSpec, 'bounds'>, matrix: Float32Array, sun: readonly number[]): void {
  const min = mesh.bounds.min, max = mesh.bounds.max, m = matrix;
  const sunZ = Math.max(0.05, sun[2]);
  for (let i = 0; i < 8; i++) {
    // Same operation order as projectMeshPoint, without sixteen short-lived arrays per caster.
    const px = (i & 1 ? max : min)[0], py = (i & 2 ? max : min)[1], pz = (i & 4 ? max : min)[2];
    const x = m[0] * px + m[4] * py + m[8] * pz + m[12];
    const y = m[1] * px + m[5] * py + m[9] * pz + m[13];
    const z = m[2] * px + m[6] * py + m[10] * pz + m[14];
    const reach = Math.max(0, z) / sunZ, qx = x - sun[0] * reach, qy = y - sun[1] * reach;
    bounds[0] = Math.min(bounds[0], qx); bounds[1] = Math.min(bounds[1], qy);
    bounds[2] = Math.max(bounds[2], qx); bounds[3] = Math.max(bounds[3], qy);
  }
}
export function meshShadowOpacity(strength: number, elevation: number): number {
  if (!(strength > 0 && elevation > 0)) return 0;
  const lowCot = 1 / Math.tan(35 * Math.PI / 180), highCot = 1;
  const t = Math.max(0, Math.min(1, (lowCot - 1 / Math.tan(elevation)) / (lowCot - highCot)));
  return Math.min(1, strength) * (config.lowSunOpacity + (config.directOpacity - config.lowSunOpacity) * t * t * t);
}
