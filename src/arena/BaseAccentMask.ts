/** Space for the soft rim plus a transparent texel against atlas bleeding. */
export const BASE_ACCENT_PADDING = 4;

export interface BaseAccentFrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Extracts the selected accent hue; neutral metal and transparent pixels stay dark. */
export function buildBaseAccentMask(
  rgba: ArrayLike<number>,
  sourceWidth: number,
  frame: BaseAccentFrameRect,
  hue: 'blue' | 'violet' = 'blue',
) {
  const padding = BASE_ACCENT_PADDING;
  const width = frame.width + padding * 2, height = frame.height + padding * 2;
  const alpha = new Float32Array(width * height);
  let hasAccent = false;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const i = ((frame.y + y) * sourceWidth + frame.x + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const accent = hue === 'violet' ? r : g;
      const neutral = hue === 'violet' ? g : r;
      const coverage = b >= accent * 0.9 ? Math.min(1, Math.max(0, (Math.min(accent, b) - neutral - 16) / 42)) : 0;
      const value = coverage * rgba[i + 3];
      alpha[(y + padding) * width + x + padding] = value;
      if (value >= 0.5) hasAccent = true;
    }
  }

  // A small separable Gaussian is baked once, independently per padded source frame.
  const radius = padding - 1;
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * 1.1 ** 2)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  const horizontal = new Float32Array(alpha.length);
  const core = new Uint8ClampedArray(alpha.length * 4);
  const halo = new Uint8ClampedArray(alpha.length * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let offset = -radius; offset <= radius; offset++) {
        if (x + offset >= 0 && x + offset < width) {
          horizontal[y * width + x] += alpha[y * width + x + offset] * kernel[offset + radius] / sum;
        }
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let blurred = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        if (y + offset >= 0 && y + offset < height) {
          blurred += horizontal[(y + offset) * width + x] * kernel[offset + radius] / sum;
        }
      }
      core[i * 4] = core[i * 4 + 1] = core[i * 4 + 2] = 255;
      halo[i * 4] = halo[i * 4 + 1] = halo[i * 4 + 2] = 255;
      core[i * 4 + 3] = alpha[i];
      halo[i * 4 + 3] = blurred;
    }
  }
  return { width, height, core, halo, hasAccent };
}
