import type { EcologyPlacement } from './WoodlandEcologyField';
import { voidCreepAt, type VoidCreepField } from './VoidCreepField';

/** World pixels per stain texel; the water shader warps and breaks it up at full resolution. */
export const VOID_STAIN_TEXEL_PX = 8;
/** Dense ink under and right around a plant, as a share of its display size (the leaf fills ~0.36). */
const CORE_INNER = 0.25, CORE_OUTER = 0.62;
/** Faint halo the ink has spread into, weaker and much wider. */
const HALO_INNER = 0.3, HALO_OUTER = 1.25, HALO_STRENGTH = 0.36;
/** One plant never stains its water fully; overlapping plants add up softly. */
const MAX_PER_PLANT = 0.85;
/** Creep reaching the water inks whole stretches of it, softer than the pads' own ink. */
const CREEP_FROM = 0.2, CREEP_FULL = 0.9, CREEP_STRENGTH = 0.55;

/**
 * Void stain of the water around infested lily pads (GDD Nachtsicht N-6), presentation only.
 * One byte per texel in [0, 1], frame-local from `offsetX`/`offsetY`.
 */
export interface VoidWaterStain {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly texelPx: number;
}

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Soft ink field from the infested pond plants: each plant stains its water by its own infestation,
 * densely under the leaves and faintly far around them. The World's void creep inks larger stretches
 * of water where the takeover is established. Overlaps combine like translucent layers, so plants and
 * creep merge into one patch instead of stacking circles. Null without either.
 */
export function buildVoidWaterStain(placements: readonly EcologyPlacement[],
  frame: { offsetX: number; offsetY: number; width: number; height: number },
  creep: VoidCreepField | null = null): VoidWaterStain | null {
  const plants = placements.filter(p => p.kind === 'pond' && p.void && (p.voidAmount ?? 0) > 0);
  if (!plants.length && !creep) return null;
  const texel = VOID_STAIN_TEXEL_PX;
  const width = Math.max(1, Math.ceil(frame.width / texel)), height = Math.max(1, Math.ceil(frame.height / texel));
  const clear = new Float32Array(width * height).fill(1);
  if (creep) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const amount = voidCreepAt(creep, frame.offsetX + (x + .5) * texel, frame.offsetY + (y + .5) * texel);
    clear[y * width + x] = 1 - smoothstep(CREEP_FROM, CREEP_FULL, amount) * CREEP_STRENGTH;
  }
  for (const p of plants) {
    const amount = Math.min(1, p.voidAmount ?? 0), reach = p.size * HALO_OUTER;
    const cx = (p.x - frame.offsetX) / texel - 0.5, cy = (p.y - frame.offsetY) / texel - 0.5;
    const x0 = Math.max(0, Math.floor(cx - reach / texel)), x1 = Math.min(width - 1, Math.ceil(cx + reach / texel));
    const y0 = Math.max(0, Math.floor(cy - reach / texel)), y1 = Math.min(height - 1, Math.ceil(cy + reach / texel));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const distance = Math.hypot(x - cx, y - cy) * texel;
      const core = 1 - smoothstep(p.size * CORE_INNER, p.size * CORE_OUTER, distance);
      const halo = (1 - smoothstep(p.size * HALO_INNER, reach, distance)) * HALO_STRENGTH;
      const stain = Math.max(core, halo) * amount * MAX_PER_PLANT;
      if (stain > 0) clear[y * width + x] *= 1 - stain;
    }
  }
  // A one-texel tent removes the texel grid before the shader adds its own drift.
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0, weight = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const w = (2 - Math.abs(dx)) * (2 - Math.abs(dy));
      sum += (1 - clear[yy * width + xx]) * w; weight += w;
    }
    data[y * width + x] = Math.round(sum / weight * 255);
  }
  return { data, width, height, offsetX: frame.offsetX, offsetY: frame.offsetY, texelPx: texel };
}
