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

export const DEATH_MORPH_FRAME_COUNT = 128;
export const DEATH_MORPH_FRAME_SIZE = 48;

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
export function sampleDeathMorphBlend(progress: number): DeathMorphBlend {
  const t = Math.max(0, Math.min(1, progress));
  let index = 0;
  while (index < KEYFRAMES.length - 2 && t > KEYFRAMES[index + 1].at) index += 1;
  const from = KEYFRAMES[index];
  const to = KEYFRAMES[index + 1];
  return { from: from.texture, to: to.texture, mix: (t - from.at) / (to.at - from.at) };
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
