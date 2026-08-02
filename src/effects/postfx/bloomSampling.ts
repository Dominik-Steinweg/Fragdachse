import type { GraphicsQuality } from '../../graphics/GraphicsQuality';

export interface WorldBloomSampling {
  readonly blurQuality: 0 | 1 | 2;
  /** Blur offset in backing-store pixels. */
  readonly blurOffsetPx: number;
  readonly blurSteps: number;
}

interface WorldBloomSamplingPreset {
  readonly blurQuality: 0 | 1 | 2;
  /** The visual blur offset in the 1920x1080 design space. */
  readonly designOffsetPx: number;
  readonly blurSteps: number;
}

/**
 * The bloom kernel is sampled in the camera framebuffer, not in design pixels. Keep the
 * visual radius stable when RenderResolution changes, but deliberately do not round the
 * result: fractional offsets prevent the kernel from locking onto a repeating pixel grid.
 */
const PRESETS: Readonly<Record<GraphicsQuality, WorldBloomSamplingPreset>> = {
  high: { blurQuality: 2, designOffsetPx: 2.75, blurSteps: 4 },
  medium: { blurQuality: 1, designOffsetPx: 4.5, blurSteps: 4 },
  low: { blurQuality: 0, designOffsetPx: 0, blurSteps: 1 },
};

const MIN_RENDER_SCALE = 0.5;
const MAX_RENDER_SCALE = 2;

export function resolveWorldBloomSampling(
  quality: GraphicsQuality,
  renderScale: number,
): WorldBloomSampling {
  const preset = PRESETS[quality];
  const safeScale = Number.isFinite(renderScale)
    ? Math.min(MAX_RENDER_SCALE, Math.max(MIN_RENDER_SCALE, renderScale))
    : 1;

  return {
    blurQuality: preset.blurQuality,
    blurOffsetPx: preset.designOffsetPx * safeScale,
    blurSteps: preset.blurSteps,
  };
}

