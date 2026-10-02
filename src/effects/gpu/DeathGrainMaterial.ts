import type { DeathTuning } from './DeathTuning';

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t);
};
const hash = (x: number, y: number, seed: number) => {
  let n = Math.imul(x + 17, 374761393) ^ Math.imul(y + seed, 668265263);
  n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296;
};
export interface DeathGrain {
  x: number; y: number; radius: number; mass: number; edge: number;
  dx: number; dy: number; angle: number; spin: number; aspect: number;
}

/** Bounded seeded Poisson sampling in the actual alpha footprint. No regular subcells. */
export function createDeathGrainLayout(source: Uint8ClampedArray, tuning: DeathTuning, variant: number) {
  const size = Math.sqrt(source.length / 4), count = size * size, seed = tuning.grainSeed + variant * 7919;
  const distance = new Float32Array(count), threshold = new Float32Array(count);
  for (let i = 0; i < count; i++) distance[i] = source[i * 4 + 3] > 20 ? size : 0;
  // Chamfer distance to the material edge, including disconnected pieces and holes.
  for (const forward of [true, false]) {
    for (let step = 0; step < count; step++) {
      const i = forward ? step : count - step - 1, x = i % size, y = Math.floor(i / size);
      for (const [dx, dy] of forward ? [[-1, 0], [0, -1], [-1, -1], [1, -1]] : [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        const d = nx < 0 || nx >= size || ny < 0 || ny >= size ? 0 : distance[ny * size + nx];
        distance[i] = Math.min(distance[i], d + (dx && dy ? Math.SQRT2 : 1));
      }
    }
  }
  const maxDepth = Math.max(1, ...distance);
  for (let i = 0; i < count; i++) {
    const depth = distance[i] / maxDepth;
    threshold[i] = 0.6 * (tuning.grainEdgeRelease * depth + (1 - tuning.grainEdgeRelease) * hash(i % size, Math.floor(i / size), seed));
  }
  const grains: DeathGrain[] = [];
  const spacing2 = tuning.grainSpacingPx ** 2;
  for (let attempt = 0; attempt < 6000 && grains.length < 256; attempt++) {
    const rawX = hash(attempt, 31, seed) * size, rawY = hash(attempt, 79, seed) * size;
    const x = Math.floor(rawX) + 0.5 + (rawX % 1 - 0.5) * tuning.grainJitter;
    const y = Math.floor(rawY) + 0.5 + (rawY % 1 - 0.5) * tuning.grainJitter;
    const i = Math.floor(y) * size + Math.floor(x);
    if (source[i * 4 + 3] <= 5 || grains.some(g => (g.x - x) ** 2 + (g.y - y) ** 2 < spacing2)) continue;
    const r = hash(attempt, 123, seed), angle = hash(attempt, 177, seed) * Math.PI * 2;
    grains.push({ x, y, radius: 1 + (2 * r - 1) * tuning.grainSizeVariance,
      mass: 0, edge: 1 - distance[i] / maxDepth, dx: Math.cos(angle), dy: Math.sin(angle),
      angle, spin: (hash(attempt, 213, seed) - 0.5) * 1.6, aspect: 0.82 + hash(attempt, 251, seed) * 0.36 });
  }
  const owners = new Int16Array(count); owners.fill(-1);
  for (let i = 0; i < count; i++) {
    if (!source[i * 4 + 3]) continue;
    const x = i % size + 0.5, y = Math.floor(i / size) + 0.5;
    let best = Infinity;
    for (let g = 0; g < grains.length; g++) {
      const d = (grains[g].x - x) ** 2 + (grains[g].y - y) ** 2;
      if (d < best) { best = d; owners[i] = g; }
    }
    if (owners[i] >= 0) grains[owners[i]].mass += source[i * 4 + 3] / 255;
  }
  return { grains, owners, threshold, size };
}

/** Bake-time only. Eroded alpha is transferred to its persistent grain, not to a replacement cloud. */
export function createOrganicDeathGrainBaker(source: Uint8ClampedArray, tuning: DeathTuning, variant: number) {
  const { grains, owners, threshold, size } = createDeathGrainLayout(source, tuning, variant);
  const alpha = new Float32Array(size * size), released = new Float32Array(grains.length);
  const draw = (g: DeathGrain, x: number, y: number, radius: number, mass: number, turn: number) => {
    if (mass <= 0) return;
    const rx = radius * g.aspect, ry = radius / g.aspect, bound = Math.max(rx, ry) * 1.3;
    const cos = Math.cos(turn), sin = Math.sin(turn), strength = mass * 3 / (Math.PI * radius * radius);
    for (let py = Math.max(0, Math.floor(y - bound)); py < Math.min(size, Math.ceil(y + bound)); py++) {
      for (let px = Math.max(0, Math.floor(x - bound)); px < Math.min(size, Math.ceil(x + bound)); px++) {
        let coverage = 0;
        // Subtexel integration keeps small, off-grid grains rounded, even below one texel radius.
        for (const sy of [0.25, 0.75]) for (const sx of [0.25, 0.75]) {
          const dx = px + sx - x, dy = py + sy - y;
          const nx = (dx * cos + dy * sin) / rx, ny = (-dx * sin + dy * cos) / ry;
          const radial = nx * nx + ny * ny;
          const r2 = radial * (1 + tuning.grainRoughness * 2 * nx * ny / (1 + radial));
          if (r2 < 1) coverage += (1 - r2) ** 2 * 0.25;
        }
        alpha[py * size + px] += strength * coverage;
      }
    }
  };
  return (output: Uint8ClampedArray, progress: number) => {
    const start = Math.max(tuning.fragmentedAt, tuning.dustAt - tuning.dissolveWindowMs / tuning.durationMs);
    const frayStart = Math.max(tuning.fragmentedAt, start - 0.2 * tuning.dissolveWindowMs / tuning.durationMs);
    const dissolve = smooth(frayStart, tuning.dustAt, progress);
    const fine = smooth(tuning.dustAt, tuning.fineDustAt, progress), haze = smooth(tuning.fineDustAt, tuning.hazeAt, progress);
    const tail = 1 - smooth(tuning.vaporAt, 1, progress), travel = smooth(start, tuning.fineDustAt, progress);
    const growth = 1 + (tuning.hazeGrowth - 1) * haze;
    released.fill(0);
    for (let i = 0; i < alpha.length; i++) {
      const a = source[i * 4 + 3] / 255, lost = a * smooth(threshold[i], threshold[i] + 0.4, dissolve);
      alpha[i] = a - lost;
      if (owners[i] >= 0) released[owners[i]] += lost;
    }
    for (let i = 0; i < grains.length; i++) {
      const g = grains[i], bias = tuning.grainFlowBias;
      let dx = bias + (1 - bias) * g.dx, dy = (1 - bias) * g.dy;
      const length = Math.hypot(dx, dy) || 1; dx /= length; dy /= length;
      const drift = tuning.grainDriftPx * travel * (0.45 + 0.55 * g.edge)
        * (1 + tuning.grainEdgeDrift * g.edge) / (1 + tuning.grainEdgeDrift);
      // Keep the complete kernel inside its existing 48px frame, including extreme tuning.
      const x = g.x + dx * Math.min(drift, dx >= 0 ? Math.max(0, size - 1 - g.x) / Math.max(dx, 0.001) : Math.max(0, g.x - 1) / -dx);
      const y = g.y + dy * Math.min(drift, dy >= 0 ? Math.max(0, size - 1 - g.y) / Math.max(dy, 0.001) : Math.max(0, g.y - 1) / -dy);
      const radiusLimit = Math.max(0.3, Math.min(x, y, size - x, size - y) * Math.min(g.aspect, 1 / g.aspect) / 1.3);
      const m = released[i] * tail, turn = g.angle + g.spin * travel;
      // Preserve C2's material budget independently of Poisson density or radius variance.
      draw(g, x, y, Math.min(radiusLimit, tuning.grainRadiusPx * g.radius * growth), m * tuning.grainAlpha * 0.182 * (1 - haze * 0.75), turn);
      const body = tuning.dustBodyAlpha * (1 - fine * 0.18);
      draw(g, x, y, Math.min(radiusLimit, tuning.dustBodyRadiusPx * g.radius * growth),
        m * Math.PI / 3 * (body * (1 - haze) + tuning.hazeAlpha * haze), turn);
    }
    for (let i = 0; i < alpha.length; i++) {
      output[i * 4] = output[i * 4 + 1] = output[i * 4 + 2] = 255;
      output[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, alpha[i])) * 255);
    }
  };
}
