import sharp from 'sharp';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { grade, quilt, reconcileTileEdges } from './lib/material-tile.mjs';
import { ROCK_47_SPRITESHEET_ORDER } from '../src/arena/AutoTiler.ts';
import {
  ROCK_BASE_AUTOTILE_SLOTS,
  ROCK_BASE_FRAME_MARGIN,
  ROCK_BASE_FRAME_SIZE,
  ROCK_BASE_PHASE_CELLS,
  ROCK_BASE_PHASES,
} from '../src/arena/RockBaseConfig.ts';

/**
 * Rock base atlas (see src/arena/RockBaseConfig.ts): row = 47-Blob frame, column = material
 * phase. The silhouette follows the occupied cells; only exposed convex corners are rounded
 * and exposed edges drawn in by a few pixels. Edges shared with a neighbour stay fully opaque,
 * so the material runs on across cells. Recipe: tools/source-art/rock-base/material.json.
 */
const sourceDir = 'tools/source-art/rock-base';
const recipe = JSON.parse(await readFile(sourceDir + '/material.json', 'utf8'));
const edge = recipe.edge;
const CELL = ROCK_BASE_FRAME_SIZE, N = ROCK_BASE_PHASE_CELLS, TILE = CELL * N;
const PITCH = CELL + ROCK_BASE_FRAME_MARGIN * 2;

// ── Material: seamless tile over the full phase period ──────────────────────
const nativeSize = Math.round(recipe.sourceMetres * recipe.pixelsPerMetre);
const native = await sharp(sourceDir + '/' + recipe.source).resize(nativeSize, nativeSize, { kernel: 'lanczos3' })
  .removeAlpha().raw().toBuffer();
const material = quilt(native, nativeSize, recipe.seed, { size: TILE, patch: 64, overlap: 16 });
reconcileTileEdges(material, TILE, 6);
grade(material, recipe.grade);

// ── Periodic edge noise in material space, continuous across neighbouring cells ─
let seed = recipe.seed ^ 0x5bd1e995;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
function periodicNoise(cells) {
  const lattice = Float32Array.from({ length: cells * cells }, random);
  const fade = v => v * v * (3 - 2 * v);
  return (x, y) => {
    const u = x / TILE * cells, v = y / TILE * cells, i = Math.floor(u), j = Math.floor(v);
    const tx = fade(u - i), ty = fade(v - j);
    const at = (a, b) => lattice[(((b % cells) + cells) % cells) * cells + (((a % cells) + cells) % cells)];
    return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
  };
}
const coarse = periodicNoise(TILE / 16), fine = periodicNoise(TILE / 6 | 0);

// ── Silhouette distance per 47-Blob mask ────────────────────────────────────
const NEIGHBOURS = [[0, -1, 1], [1, -1, 2], [1, 0, 4], [1, 1, 8], [0, 1, 16], [-1, 1, 32], [-1, 0, 64], [-1, -1, 128]];
const R = edge.cornerRadius, STEP = .25;

/**
 * Signed distance (px, positive inside) of the cell union opened by a disc of radius R: straight
 * edges stay in place, exposed convex corners become quarter circles. Concave corners would be
 * filled outside the owning cell and are left sharp.
 */
function silhouetteDistance(mask) {
  const empty = NEIGHBOURS.filter(([, , bit]) => !(mask & bit)).map(([dx, dy]) => [dx * CELL, dy * CELL]);
  // Capped: a fully enclosed cell has no empty neighbour, and the edge terms only need a few px.
  const outside = (x, y) => {
    let best = CELL * 2;
    for (const [left, top] of empty) {
      const dx = Math.max(left - x, 0, x - (left + CELL)), dy = Math.max(top - y, 0, y - (top + CELL));
      best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  };
  // Eroded set on a fine grid around the cell: points at least R away from any empty cell.
  const lo = -R - 2, span = Math.ceil((CELL + 2 * R + 4) / STEP);
  const eroded = new Uint8Array(span * span);
  for (let j = 0; j < span; j++) for (let i = 0; i < span; i++) {
    eroded[j * span + i] = outside(lo + i * STEP, lo + j * STEP) >= R ? 1 : 0;
  }
  const reach = Math.ceil((R + 2) / STEP);
  const distance = new Float32Array(CELL * CELL);
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const px = x + .5, py = y + .5, depth = outside(px, py);
    if (depth >= R) { distance[y * CELL + x] = depth; continue; }
    const ci = Math.round((px - lo) / STEP), cj = Math.round((py - lo) / STEP);
    let nearest = Infinity;
    for (let j = Math.max(0, cj - reach); j <= Math.min(span - 1, cj + reach); j++) {
      for (let i = Math.max(0, ci - reach); i <= Math.min(span - 1, ci + reach); i++) {
        if (eroded[j * span + i]) nearest = Math.min(nearest, Math.hypot(lo + i * STEP - px, lo + j * STEP - py));
      }
    }
    distance[y * CELL + x] = R - nearest;
  }
  return distance;
}

// ── Atlas ───────────────────────────────────────────────────────────────────
const width = ROCK_BASE_PHASES * PITCH, height = ROCK_BASE_AUTOTILE_SLOTS * PITCH;
const atlas = Buffer.alloc(width * height * 4);
const smooth = v => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
// Light from the top-left, as in the existing directional rock tints.
const LIGHT = [-Math.SQRT1_2, -Math.SQRT1_2];

for (let slot = 0; slot < ROCK_BASE_AUTOTILE_SLOTS; slot++) {
  const mask = ROCK_47_SPRITESHEET_ORDER[slot];
  if (mask === undefined || mask < 0) continue;
  const sd = silhouetteDistance(mask);
  const at = (x, y) => sd[Math.max(0, Math.min(CELL - 1, y)) * CELL + Math.max(0, Math.min(CELL - 1, x))];
  for (let phase = 0; phase < ROCK_BASE_PHASES; phase++) {
    const phaseX = phase % N, phaseY = Math.floor(phase / N);
    const frameX = phase * PITCH + ROCK_BASE_FRAME_MARGIN, frameY = slot * PITCH + ROCK_BASE_FRAME_MARGIN;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const u = phaseX * CELL + x, v = phaseY * CELL + y;
      const base = sd[y * CELL + x];
      // Inset only near exposed edges: interior and shared edges keep their full depth.
      const inset = edge.insetMean + (coarse(u, v) - .5) * edge.insetVariation * 1.4 + (fine(u, v) - .5) * edge.insetVariation * .6;
      const distance = base - Math.max(-.5, inset) * (1 - smooth((base - 3) / 4));
      const alpha = Math.max(0, Math.min(1, distance + .5));
      const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1);
      const length = Math.hypot(gx, gy) || 1;
      // Outward normal is the negative distance gradient.
      const facing = (-gx / length) * LIGHT[0] + (-gy / length) * LIGHT[1];
      const rim = 1 - smooth(distance / edge.rimWidth);
      const shade = 1 + rim * (edge.lightLift * Math.max(0, facing) - edge.shadeDrop * Math.max(0, -facing))
        - edge.rimDarken * rim * rim
        // Narrow dark contour right at exposed edges: separates the rock from any ground value.
        - (edge.outline ?? 0) * (1 - smooth(distance / (edge.outlineWidth ?? 1)));
      const source = (((v % TILE) * TILE) + (u % TILE)) * 3;
      const target = ((frameY + y) * width + frameX + x) * 4;
      for (let c = 0; c < 3; c++) atlas[target + c] = Math.max(0, Math.min(255, Math.round(material[source + c] * shade)));
      atlas[target + 3] = Math.round(alpha * 255);
    }
    // Extrude the frame border so linear filtering never reaches into the neighbouring frame.
    for (let i = -1; i <= CELL; i++) {
      const clamp = k => Math.max(0, Math.min(CELL - 1, k));
      for (const [x, y] of [[i, -1], [i, CELL], [-1, i], [CELL, i]]) {
        const from = ((frameY + clamp(y)) * width + frameX + clamp(x)) * 4;
        const to = ((frameY + y) * width + frameX + x) * 4;
        atlas.copy(atlas, to, from, from + 4);
      }
    }
  }
}

await mkdir('public/assets/sprites', { recursive: true });
// Publish only a complete PNG: the dev server may serve the current atlas during generation.
const outputPath = 'public/assets/sprites/rock_base.png';
const temporaryPath = `${outputPath}.${process.pid}.tmp`;
try {
  await sharp(atlas, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 })
    .toFile(temporaryPath);
  // Windows refuses to replace a file another process (dev server, open game tab) is reading.
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporaryPath, outputPath); break; } catch (error) {
      if (attempt >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
} finally {
  await rm(temporaryPath, { force: true });
}
console.log(`rock_base: ${width} x ${height}, ${ROCK_BASE_PHASES} phases per frame from ${recipe.source}`);
