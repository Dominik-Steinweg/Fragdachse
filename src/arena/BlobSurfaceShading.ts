import type { BlobSurfaceProfile } from './BlobSurfaceProfile';

export type BlobSurfaceCornerTints = readonly [number, number, number, number];
export type BlobSurfaceOccupancy = (gridX: number, gridY: number) => boolean;

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashCorner(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix + 0x1f83d9ab, 0x27d4eb2d)
    ^ Math.imul(iy + 0x5be0cd19, 0x165667b1)
    ^ Math.imul(salt + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, period: number, salt: number): number {
  const fx = x / period;
  const fy = y / period;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smoothStep(fx - x0);
  const ty = smoothStep(fy - y0);
  const top = lerp(hashCorner(x0, y0, salt), hashCorner(x0 + 1, y0, salt), tx);
  const bottom = lerp(hashCorner(x0, y0 + 1, salt), hashCorner(x0 + 1, y0 + 1, salt), tx);
  return lerp(top, bottom, ty);
}

function resolveCornerLambert(cornerX: number, cornerY: number, isOccupied: BlobSurfaceOccupancy, lightDirection: readonly [number, number]): number {
  const nw = isOccupied(cornerX - 1, cornerY - 1) ? 1 : 0;
  const ne = isOccupied(cornerX, cornerY - 1) ? 1 : 0;
  const sw = isOccupied(cornerX - 1, cornerY) ? 1 : 0;
  const se = isOccupied(cornerX, cornerY) ? 1 : 0;
  const normalX = (nw + sw - ne - se) * 0.5;
  const normalY = (nw + ne - sw - se) * 0.5;
  return -(normalX * lightDirection[0] + normalY * lightDirection[1]);
}

function resolveCornerTint(profile: BlobSurfaceProfile, cornerX: number, cornerY: number, isOccupied: BlobSurfaceOccupancy): number {
  const { shading } = profile;
  const directionalConfig = shading.directional;
  const lambert = directionalConfig
    ? resolveCornerLambert(cornerX, cornerY, isOccupied, directionalConfig.lightDirection)
    : 0;
  const directional = !directionalConfig ? 0 : lambert >= 0
    ? lambert * directionalConfig.edgeLift
    : lambert * directionalConfig.edgeShade;
  const [longPeriod, shortPeriod] = shading.washValuePeriods;
  const valueField = valueNoise(cornerX, cornerY, longPeriod, profile.seedSalt + 1) * 0.72
    + valueNoise(cornerX, cornerY, shortPeriod, profile.seedSalt + 2) * 0.28;
  const level = clamp(shading.baseLevel + directional + (valueField - 0.5) * 2 * shading.washValueAmount, 0.55, 1);
  const hueField = valueNoise(cornerX, cornerY, shading.washHuePeriod, profile.seedSalt + 3);
  const hueIndex = Math.min(shading.washHues.length - 1, Math.floor(hueField * shading.washHues.length));
  const hue = shading.washHues[hueIndex];
  const hueAmount = Math.abs(hueField * shading.washHues.length % 1 - 0.5) * 2 * shading.washHueAmount;
  const mixChannel = (from: number, to: number) => from + (to - from) * hueAmount;
  return (Math.round(mixChannel(255, (hue >> 16) & 0xff) * level) << 16)
    | (Math.round(mixChannel(255, (hue >> 8) & 0xff) * level) << 8)
    | Math.round(mixChannel(255, hue & 0xff) * level);
}

/** Four corner tints; shared corners are independent of the cell being drawn. */
export function resolveBlobSurfaceCornerTints(
  profile: BlobSurfaceProfile,
  gridX: number,
  gridY: number,
  isOccupied: BlobSurfaceOccupancy,
): BlobSurfaceCornerTints {
  return [
    resolveCornerTint(profile, gridX, gridY, isOccupied),
    resolveCornerTint(profile, gridX + 1, gridY, isOccupied),
    resolveCornerTint(profile, gridX, gridY + 1, isOccupied),
    resolveCornerTint(profile, gridX + 1, gridY + 1, isOccupied),
  ];
}

/** Multiplies state tint (damage/owner) by a surface tint without losing proportionality. */
export function multiplyTint(base: number, surface: number): number {
  const red = (((base >> 16) & 0xff) * ((surface >> 16) & 0xff)) / 255;
  const green = (((base >> 8) & 0xff) * ((surface >> 8) & 0xff)) / 255;
  const blue = ((base & 0xff) * (surface & 0xff)) / 255;
  return (Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue);
}
