/** Shared-atlas material, drawn directly from above. Frames share a fixed centre and scale;
 * the continuous radial boundary has no corners, detached shards or changing light source. */
export const ESSENCE_LIQUID_FRAME_SIZE = 32;
export const ESSENCE_LIQUID_BODY_DIAMETER = 23;
export const ESSENCE_LIQUID_PHASES = 8;
export const ESSENCE_LIQUID_VARIANTS = 3;
export const ESSENCE_LIQUID_TAIL_FRAME = 'essence-liquid-tail';
export const ESSENCE_LIQUID_FRAMES = Array.from({ length: ESSENCE_LIQUID_VARIANTS * ESSENCE_LIQUID_PHASES }, (_, index) => ({
  variant: Math.floor(index / ESSENCE_LIQUID_PHASES), phase: index % ESSENCE_LIQUID_PHASES,
  frame: `essence-liquid-${Math.floor(index / ESSENCE_LIQUID_PHASES)}-${index % ESSENCE_LIQUID_PHASES}`,
}));

/** Writes unpremultiplied, antialiased cyan material pixels; no per-frame canvas or texture. */
export function writeEssenceLiquidPixels(out: Uint8ClampedArray, variant: number, phase: number): void {
  const motion = phase / ESSENCE_LIQUID_PHASES * Math.PI * 2;
  const offset = variant * 2.13;
  const centre = ESSENCE_LIQUID_FRAME_SIZE / 2;
  for (let y = 0; y < ESSENCE_LIQUID_FRAME_SIZE; y++) {
    for (let x = 0; x < ESSENCE_LIQUID_FRAME_SIZE; x++) {
      const px = x + 0.5 - centre;
      const py = y + 0.5 - centre;
      const angle = Math.atan2(py, px);
      const radius = ESSENCE_LIQUID_BODY_DIAMETER / 2 * (1 + 0.055 * Math.sin(angle * 3 + offset)
        + 0.03 * Math.cos(angle * 2 - motion + offset) + 0.017 * Math.sin(angle * 5 + motion));
      const r = Math.hypot(px, py) / radius;
      const alpha = smooth((1 - r) * radius / 1.25 + 0.5);
      const i = (y * ESSENCE_LIQUID_FRAME_SIZE + x) * 4;
      if (alpha === 0) { out.fill(0, i, i + 4); continue; }
      const nx = px / radius;
      const ny = py / radius;
      const interior = smooth((1 - r) / 0.28);
      // Broad fixed upper-left reflection drifts gently with the fluid, never spins around it.
      const reflexX = nx + 0.27 + 0.035 * Math.sin(motion + offset);
      const reflexY = ny + 0.3 + 0.025 * Math.cos(motion);
      const broad = Math.exp(-(reflexX * reflexX / 0.19 + reflexY * reflexY / 0.085));
      const pool = Math.exp(-((nx - 0.18) ** 2 / 0.38 + (ny - 0.24) ** 2 / 0.24));
      const edgeReflection = Math.exp(-(((r - 0.8) / 0.13) ** 2)) * Math.max(0, -ny * 0.6 - nx * 0.25);
      out[i] = 13 + interior * 18 + pool * 14 + broad * 119 + edgeReflection * 25;
      out[i + 1] = 80 + interior * 99 + pool * 22 + broad * 55 + edgeReflection * 28;
      out[i + 2] = 123 + interior * 80 + pool * 13 + broad * 24 + edgeReflection * 24;
      out[i + 3] = alpha * 255;
    }
  }
}

/** Soft tapered wake, facing +X; its rounded head joins the separate liquid pearl. */
export function writeEssenceLiquidTailPixels(out: Uint8ClampedArray): void {
  const size = ESSENCE_LIQUID_FRAME_SIZE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const along = (x + 0.5 - 2) / 28;
      const width = 0.5 + 4.3 * Math.max(0, along) ** 1.3;
      const centreY = size / 2 + Math.sin(along * Math.PI) * 0.5;
      const edge = smooth((width - Math.abs(y + 0.5 - centreY)) / 1.4 + 0.5);
      const ends = smooth(along / 0.3) * smooth((1 - along) / 0.18);
      const alpha = edge * ends * Math.max(0, along);
      const i = (y * size + x) * 4;
      out[i] = alpha ? 38 : 0;
      out[i + 1] = alpha ? 196 : 0;
      out[i + 2] = alpha ? 222 : 0;
      out[i + 3] = 255 * alpha;
    }
  }
}

function smooth(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}
