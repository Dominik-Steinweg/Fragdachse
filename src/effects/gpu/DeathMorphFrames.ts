import {
  TEX_DEATH_MORPH_COMPACT,
  TEX_DEATH_MORPH_FRAYED,
  TEX_DEATH_MORPH_POROUS,
  TEX_DEATH_MORPH_FRAGMENTED,
  TEX_DEATH_MORPH_DUST,
  TEX_DEATH_MORPH_FINE_DUST,
  TEX_DEATH_MORPH_HAZE,
  TEX_DEATH_MORPH_VAPOR,
} from './GpuVfxSourceTextures';
import { DEATH_TUNING_DEFAULTS, type DeathTuning } from './DeathTuning';
import { createOrganicDeathGrainBaker } from './DeathGrainMaterial';

export const DEATH_MORPH_FRAME_COUNT = 128;
export const DEATH_MORPH_FRAME_SIZE = 48;
export const DEATH_MORPH_VARIANTS = 4;

const KEYFRAMES = [
  { at: 0, texture: TEX_DEATH_MORPH_COMPACT },
  { at: 0.125, texture: TEX_DEATH_MORPH_FRAYED },
  { at: 0.25, texture: TEX_DEATH_MORPH_POROUS },
  { at: 0.3125, texture: TEX_DEATH_MORPH_FRAGMENTED },
  { at: 0.375, texture: TEX_DEATH_MORPH_DUST },
  { at: 0.4375, texture: TEX_DEATH_MORPH_FINE_DUST },
  { at: 0.5, texture: TEX_DEATH_MORPH_HAZE },
  { at: 0.875, texture: TEX_DEATH_MORPH_HAZE },
  { at: 1, texture: TEX_DEATH_MORPH_VAPOR },
] as const;

export interface DeathMorphBlend {
  readonly from: string;
  readonly to: string;
  readonly mix: number;
}

/** Einmal beim Atlasbau abtasten; die GPU spielt danach nur die fertige Folge ab. */
export function sampleDeathMorphBlend(progress: number, timing: import('./DeathTuning').DeathMorphTiming = DEATH_TUNING_DEFAULTS): DeathMorphBlend {
  const keys = timing ? KEYFRAMES.map((key, i) => ({ ...key,
    at: [0, timing.frayedAt, timing.porousAt, timing.fragmentedAt, timing.dustAt,
      timing.fineDustAt, timing.hazeAt, timing.vaporAt, 1][i],
  })) : KEYFRAMES;
  const t = Math.max(0, Math.min(1, progress));
  let index = 0;
  while (index < keys.length - 2 && t > keys[index + 1].at) index += 1;
  const from = keys[index];
  const to = keys[index + 1];
  return { from: from.texture, to: to.texture, mix: (t - from.at) / (to.at - from.at) };
}

const smooth = (a: number, b: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const noise = (x: number, y: number): number => {
  let v = Math.imul(x + 17, 374761393) ^ Math.imul(y + 29, 668265263);
  v = Math.imul(v ^ v >>> 13, 1274126177);
  return ((v ^ v >>> 16) >>> 0) / 4294967296;
};

/** Bake-time only: every cell is a persistent piece of the Fragmented source, not a new motif. */
export function createDeathGrainBaker(fragmented: Uint8ClampedArray, tuning: DeathTuning = DEATH_TUNING_DEFAULTS, variant = 0) {
  return tuning.grainOrganic ? createOrganicDeathGrainBaker(fragmented, tuning, variant) : createC2GridGrainBaker(fragmented, tuning);
}

function createC2GridGrainBaker(fragmented: Uint8ClampedArray, tuning: DeathTuning) {
  const size = DEATH_MORPH_FRAME_SIZE, cellSize = 3, columns = size / cellSize;
  const cells: { x: number; y: number; weight: number; threshold: number; dx: number; dy: number }[] = [];
  for (let cy = 0; cy < columns; cy++) for (let cx = 0; cx < columns; cx++) {
    let mass = 0, x = 0, y = 0;
    for (let sy = 0; sy < cellSize; sy++) for (let sx = 0; sx < cellSize; sx++) {
      const px = cx * cellSize + sx, py = cy * cellSize + sy;
      const a = fragmented[(py * size + px) * 4 + 3] / 255;
      mass += a; x += (px + 0.5) * a; y += (py + 0.5) * a;
    }
    const angle = noise(cx + 81, cy) * Math.PI * 2;
    cells.push({ x: mass ? x / mass : 0, y: mass ? y / mass : 0, weight: mass / 9,
      threshold: noise(cx, cy) * 0.65, dx: Math.cos(angle), dy: Math.sin(angle) });
  }
  // The local grain drift must not introduce a second, unrelated cloud trajectory.
  const weight = cells.reduce((sum, c) => sum + c.weight, 0);
  const meanX = weight ? cells.reduce((sum, c) => sum + c.dx * c.weight, 0) / weight : 0;
  const meanY = weight ? cells.reduce((sum, c) => sum + c.dy * c.weight, 0) / weight : 0;
  for (const c of cells) { c.dx = (c.dx - meanX) / 2; c.dy = (c.dy - meanY) / 2; }
  const alpha = new Float32Array(size * size), releases = new Float32Array(cells.length);
  // A soft elliptical grain, accumulated in alpha only. White RGB even at alpha zero avoids fringes.
  const grain = (x: number, y: number, radius: number, strength: number, aspect: number) => {
    if (strength <= 0) return;
    const rx = radius * aspect, ry = radius / aspect;
    for (let py = Math.max(0, Math.floor(y - ry)); py < Math.min(size, Math.ceil(y + ry)); py++) {
      for (let px = Math.max(0, Math.floor(x - rx)); px < Math.min(size, Math.ceil(x + rx)); px++) {
        const r2 = ((px + 0.5 - x) / rx) ** 2 + ((py + 0.5 - y) / ry) ** 2;
        if (r2 < 1) alpha[py * size + px] += strength * (1 - r2) ** 2;
      }
    }
  };
  return (output: Uint8ClampedArray, progress: number): void => {
    // Erosion runs in the same stretched morph clock as all 128 frames (150 ms nominal).
    const start = Math.max(tuning.fragmentedAt, tuning.dustAt - tuning.dissolveWindowMs / tuning.durationMs);
    const dissolve = smooth(start, tuning.dustAt, progress);
    const fine = smooth(tuning.dustAt, tuning.fineDustAt, progress);
    const haze = smooth(tuning.fineDustAt, tuning.hazeAt, progress);
    const tail = 1 - smooth(tuning.vaporAt, 1, progress);
    const drift = tuning.grainDriftPx * smooth(start, tuning.vaporAt, progress);
    const growth = 1 + (tuning.hazeGrowth - 1) * haze;
    for (let i = 0; i < cells.length; i++) releases[i] = smooth(cells[i].threshold, cells[i].threshold + 0.35, dissolve);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x, cell = Math.floor(y / cellSize) * columns + Math.floor(x / cellSize);
      alpha[i] = fragmented[i * 4 + 3] / 255 * (1 - releases[cell]);
    }
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c.weight || !releases[i]) continue;
      const x = c.x + c.dx * drift, y = c.y + c.dy * drift;
      const aspect = 0.9 + noise(i, 73) * 0.2;
      const released = c.weight * releases[i] * tail;
      // Dense soft material and detailed grains occupy exactly the same centres. As grains widen,
      // area compensation prevents the late haze from gaining mass/brightness or revealing new lobes.
      grain(x, y, tuning.grainRadiusPx * growth,
        released * tuning.grainAlpha * (1 - haze * 0.75) / (growth * growth), aspect);
      const body = tuning.dustBodyAlpha * (1 - fine * 0.18);
      grain(x, y, tuning.dustBodyRadiusPx * growth,
        released * (body * (1 - haze) + tuning.hazeAlpha * haze) / (growth * growth), aspect);
    }
    for (let i = 0; i < alpha.length; i++) {
      output[i * 4] = output[i * 4 + 1] = output[i * 4 + 2] = 255;
      output[i * 4 + 3] = Math.round(Math.min(1, alpha[i]) * 255);
    }
  };
}

/**
 * Nur Alpha mischen: source-over wuerde ueberlappende Formen in der Mitte abdunkeln.
 * Auch transparente Texel bleiben weiss, damit Filterung keine dunklen Saeume erzeugt.
 * Der Ausgabepuffer wird fuer alle Frames wiederverwendet.
 */
export function writeDeathMorphPixels(
  output: Uint8ClampedArray,
  from: Uint8ClampedArray,
  to: Uint8ClampedArray,
  mix: number,
): void {
  for (let offset = 0; offset < output.length; offset += 4) {
    output[offset] = 255;
    output[offset + 1] = 255;
    output[offset + 2] = 255;
    output[offset + 3] = Math.round(from[offset + 3] * (1 - mix) + to[offset + 3] * mix);
  }
}
