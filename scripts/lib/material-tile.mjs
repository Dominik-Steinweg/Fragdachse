/**
 * Shared offline material tiling for authored ground and rock sources: deterministic image
 * quilting to a seamless tile at native world scale, edge reconciliation and a mild grade.
 */
/** Offline quilting preserves authored blade/grain scale. Overlapping patches
 * are joined along minimum-error paths, without a new noise or detail layer. */
export function quilt(input, nativeSize, seed, { size, patch = 128, overlap = 32 }) {
  const step = patch - overlap;
  const data = Buffer.alloc(size * size * 3);
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sourcePixel = (p, x, y, c) => {
    let u = p.flip ? patch - 1 - x : x, v = y;
    for (let r = 0; r < p.rotation; r++) [u, v] = [patch - 1 - v, u];
    return input[((p.y + v) * nativeSize + p.x + u) * 3 + c];
  };
  for (let oy = 0; oy < size; oy += step) for (let ox = 0; ox < size; ox += step) {
    const w = Math.min(patch, size - ox), h = Math.min(patch, size - oy);
    let best, score = Infinity;
    const error = (p, x, y) => {
      let sum = 0;
      for (let c = 0; c < 3; c++) sum += (data[((oy + y) * size + ox + x) * 3 + c] - sourcePixel(p, x, y, c)) ** 2;
      return sum;
    };
    for (let candidate = 0; candidate < 24; candidate++) {
      const p = { x: Math.floor(random() * (nativeSize - patch + 1)), y: Math.floor(random() * (nativeSize - patch + 1)),
        flip: random() < .5, rotation: Math.floor(random() * 4) };
      let total = 0;
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
        if ((ox && x < overlap) || (oy && y < overlap)) total += error(p, x, y);
      }
      if (total < score) { best = p; score = total; }
    }
    const cut = (length, across, horizontal) => {
      const cost = new Float64Array(length * across), parent = new Int16Array(cost.length);
      for (let i = 0; i < length; i++) for (let j = 0; j < across; j++) {
        let prev = j;
        if (i) for (let k = Math.max(0, j - 1); k <= Math.min(across - 1, j + 1); k++) {
          if (cost[(i - 1) * across + k] < cost[(i - 1) * across + prev]) prev = k;
        }
        cost[i * across + j] = error(best, horizontal ? i : j, horizontal ? j : i)
          + (i ? cost[(i - 1) * across + prev] : 0);
        parent[i * across + j] = prev;
      }
      let j = 0;
      for (let k = 1; k < across; k++) if (cost[(length - 1) * across + k] < cost[(length - 1) * across + j]) j = k;
      const path = new Int16Array(length);
      for (let i = length - 1; i >= 0; i--) { path[i] = j; j = parent[i * across + j]; }
      return path;
    };
    const left = ox ? cut(h, Math.min(overlap, w), false) : null;
    const top = oy ? cut(w, Math.min(overlap, h), true) : null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((left && x < left[y]) || (top && y < top[x])) continue;
      for (let c = 0; c < 3; c++) data[((oy + y) * size + ox + x) * 3 + c] = sourcePixel(best, x, y, c);
    }
  }
  return data;
}

/** Blends a narrow band at the wrap edges so the tile repeats without a seam. */
export function reconcileTileEdges(data, size, band = 8) {
  for (let axis = 0; axis < 2; axis++) for (let line = 0; line < size; line++) {
    for (let offset = 0; offset < band; offset++) {
      const t = 1 - offset / band, weight = t * t * (3 - 2 * t) * .5;
      const a = (axis === 0 ? line * size + offset : offset * size + line) * 3;
      const b = (axis === 0 ? line * size + size - 1 - offset : (size - 1 - offset) * size + line) * 3;
      for (let c = 0; c < 3; c++) {
        const first = data[a + c], last = data[b + c];
        data[a + c] = Math.round(first + (last - first) * weight);
        data[b + c] = Math.round(last + (first - last) * weight);
      }
    }
  }
}
/** Grade in linear-ish display space: per-channel gain, saturation about luma, gamma. */
export function grade(data, { gain = [1, 1, 1], saturation = 1, gamma = 1 } = {}) {
  for (let i = 0; i < data.length; i += 3) {
    let r = data[i] * gain[0] / 255, g = data[i + 1] * gain[1] / 255, b = data[i + 2] * gain[2] / 255;
    const luma = r * .3 + g * .59 + b * .11;
    r = luma + (r - luma) * saturation; g = luma + (g - luma) * saturation; b = luma + (b - luma) * saturation;
    data[i] = Math.round(255 * Math.max(0, Math.min(1, r)) ** gamma);
    data[i + 1] = Math.round(255 * Math.max(0, Math.min(1, g)) ** gamma);
    data[i + 2] = Math.round(255 * Math.max(0, Math.min(1, b)) ** gamma);
  }
}
