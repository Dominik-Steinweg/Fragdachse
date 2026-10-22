// Lobby structures: render passes in Blender, derive the collision outline, publish runtime files.
// node scripts/asset-pipeline/export-lobby-structures.mjs --label <revision> [--ids a,b] [--samples 64] [--publish]
// Renders go to D:/Fragdachse-render/base-buildings/runs/<label>/<id>/. --publish copies the passes to
// public/assets/sprites/pipeline-v2/<id>/, rewrites src/assets/manifests/lobby-structures.json and
// the derived rects in src/config/authoring/lobbyStructureOutlines.json. Never re-renders on publish.
import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { repoRoot, resolveBlender, renderProcess } from './preview-v2.mjs';
import { digest, pythonSources } from './draft-v2.mjs';

/** Runtime structure id per catalog asset (the merchant structure shows the scrap stall). */
export const LOBBY_STRUCTURE_ASSETS = {
  'lobby-workshop': 'lobby-workshop', 'lobby-yard': 'lobby-yard', 'lobby-armory': 'lobby-armory', 'lobby-scrap-stall': 'lobby-merchant-stall',
};
const CELL = 32, STEP = 8, MIN_SIDE = 2, MAX_RECTS = 16;
/** Same bits as src/effects/lightShadowGeometry.ts EDGE_*. */
const EDGE = { TOP: 1, BOTTOM: 2, LEFT: 4, RIGHT: 8 };

const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const exists = file => access(file).then(() => true, () => false);

/** Footprint of 5 x 4 cells, turned by quarter turns; returned in game pixels. */
export function footprint(turn) {
  return turn % 2 ? { width: 4 * CELL, height: 5 * CELL } : { width: 5 * CELL, height: 4 * CELL };
}

/** Disc dilation/erosion; out-of-range samples clamp to the border so edge shapes are not eroded. */
function morph(grid, cols, rows, radius, dilate) {
  const out = new Uint8Array(grid.length);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let result = dilate ? 0 : 1;
    search: for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + radius) continue;
      const xx = Math.min(cols - 1, Math.max(0, x + dx)), yy = Math.min(rows - 1, Math.max(0, y + dy));
      const v = grid[yy * cols + xx];
      if (dilate && v) { result = 1; break search; }
      if (!dilate && !v) { result = 0; break search; }
    }
    out[y * cols + x] = result;
  }
  return out;
}

/**
 * Fills straight gaps of at most `maxGap` cells between solid cells, row by row and column by
 * column: a notch only a little wider than the player (32 px) would trap a sliding body.
 */
function fillGaps(grid, cols, rows, maxGap) {
  const out = grid.slice();
  const run = (index, step, count) => {
    let last = -1;
    for (let i = 0; i < count; i++) {
      if (!grid[index(i)]) continue;
      if (last >= 0 && i - last - 1 > 0 && i - last - 1 <= maxGap) for (let j = last + 1; j < i; j++) out[index(j)] = 1;
      last = i;
    }
  };
  for (let y = 0; y < rows; y++) run(i => y * cols + i, 1, cols);
  for (let x = 0; x < cols; x++) run(i => i * cols + x, cols, rows);
  return out;
}

/** Largest axis-aligned rectangle of free cells with both sides at least `min` cells. */
function largestRect(grid, cols, rows, min) {
  const heights = new Int32Array(cols);
  let best = null;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) heights[x] = grid[y * cols + x] ? heights[x] + 1 : 0;
    for (let x = 0; x < cols; x++) {
      let h = Infinity;
      for (let x2 = x; x2 < cols && heights[x2] > 0; x2++) {
        h = Math.min(h, heights[x2]);
        const w = x2 - x + 1;
        if (w >= min && h >= min && (!best || w * h > best.w * best.h)) best = { x, y: y - h + 1, w, h };
      }
    }
  }
  return best;
}

/** Same rule as StructureOutline.deriveStructureEdges: any open stretch exposes the edge. */
export function deriveEdges(rects) {
  const inside = (x, y) => rects.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  const half = STEP / 2;
  return rects.map(r => {
    let edges = 0;
    for (let x = r.x + half; x < r.x + r.width; x += STEP) {
      if (!inside(x, r.y - half)) edges |= EDGE.TOP;
      if (!inside(x, r.y + r.height + half)) edges |= EDGE.BOTTOM;
    }
    for (let y = r.y + half; y < r.y + r.height; y += STEP) {
      if (!inside(r.x - half, y)) edges |= EDGE.LEFT;
      if (!inside(r.x + r.width + half, y)) edges |= EDGE.RIGHT;
    }
    return edges;
  });
}

/**
 * Solid coverage -> 8 px majority grid inside the footprint -> close/open -> greedy maximal rects.
 * Slivers thinner than two steps are dropped (at most 8 px of outline); a closing that still
 * needs more than MAX_RECTS rects is retried with a wider radius.
 */
export async function deriveOutline(solidFile, sourceSize, displaySize, turn) {
  const { data, info } = await sharp(solidFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const scale = info.width / displaySize;
  const { width, height } = footprint(turn);
  const ox = (displaySize - width) / 2, oy = (displaySize - height) / 2;
  const cols = width / STEP, rows = height / STEP;
  const base = new Uint8Array(cols * rows);
  let outside = 0, solidPixels = 0;
  for (let py = 0; py < info.height; py++) for (let px = 0; px < info.width; px++) {
    if (data[(py * info.width + px) * 4 + 3] < 128) continue;
    solidPixels++;
    const gx = px / scale - ox, gy = py / scale - oy;
    if (gx < 0 || gy < 0 || gx >= width || gy >= height) outside++;
  }
  const block = STEP * scale;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let count = 0;
    for (let yy = 0; yy < block; yy++) for (let xx = 0; xx < block; xx++) {
      const px = Math.floor((ox + x * STEP) * scale + xx), py = Math.floor((oy + y * STEP) * scale + yy);
      if (data[(py * info.width + px) * 4 + 3] >= 128) count++;
    }
    base[y * cols + x] = count * 2 >= block * block ? 1 : 0;
  }
  // Up to two player diameters: a body pressed into such a notch cannot slide out along the wall.
  const bridged = fillGaps(base, cols, rows, 8);
  for (const closeRadius of [2, 3, 4]) {
    const closed = morph(morph(bridged, cols, rows, closeRadius, true), cols, rows, closeRadius, false);
    const shaped = morph(morph(closed, cols, rows, 1, false), cols, rows, 1, true);
    const remaining = shaped.slice();
    const cellsRects = [];
    for (let r = largestRect(remaining, cols, rows, MIN_SIDE); r; r = largestRect(remaining, cols, rows, MIN_SIDE)) {
      cellsRects.push(r);
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) remaining[y * cols + x] = 0;
    }
    if (cellsRects.length > MAX_RECTS) continue;
    const rects = cellsRects.map(r => ({ x: r.x * STEP, y: r.y * STEP, width: r.w * STEP, height: r.h * STEP }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const edges = deriveEdges(rects);
    let union = 0, intersection = 0;
    const covered = (x, y) => rects.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const a = base[y * cols + x], b = covered(x * STEP + 4, y * STEP + 4) ? 1 : 0;
      union += a | b; intersection += a & b;
    }
    return { rects: rects.map((r, i) => ({ ...r, edges: edges[i] })), closeRadius, iou: union ? intersection / union : 0,
      solidOutsideFootprint: solidPixels ? outside / solidPixels : 0, grid: { cols, rows, base: [...base] } };
  }
  throw Error(`${solidFile}: outline needs more than ${MAX_RECTS} rects`);
}

/**
 * Shadow casters at two display px per texel: the solid geometry's height (ropes, pegs and walkable
 * floors excluded by the solid pass), max-pooled so posts and rafters stay continuous under the
 * runtime's linear filtering. Opaque grayscale: R is the height between the manifest's min and max.
 */
export async function deriveCasterHeight(run, displaySize) {
  const read = file => sharp(path.join(run, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [elevation, solid] = await Promise.all([read('elevation.png'), read('solid.png')]);
  const source = elevation.info.width, size = displaySize / 2, block = source / size;
  if (solid.info.width !== source || !Number.isInteger(block)) throw Error(`${run}: caster grid does not divide the passes`);
  const out = Buffer.alloc(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let height = 0;
    for (let yy = 0; yy < block; yy++) for (let xx = 0; xx < block; xx++) {
      const i = ((y * block + yy) * source + x * block + xx) * 4;
      if (solid.data[i + 3] >= 128 && elevation.data[i + 3] >= 128) height = Math.max(height, elevation.data[i]);
    }
    out[y * size + x] = height;
  }
  return sharp(out, { raw: { width: size, height: size, channels: 1 } }).png({ compressionLevel: 9 }).toBuffer();
}

async function overlay(run, outline, displaySize, turn) {
  const { width, height } = footprint(turn);
  const ox = (displaySize - width) / 2, oy = (displaySize - height) / 2;
  const scale = 2;
  const boxes = outline.rects.map(r => `<rect x="${(ox + r.x) * scale}" y="${(oy + r.y) * scale}" width="${r.width * scale}" height="${r.height * scale}" fill="rgba(255,60,40,.18)" stroke="#ff3c28" stroke-width="2"/>`).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${displaySize * scale}" height="${displaySize * scale}">${boxes}</svg>`);
  const top = await sharp(path.join(run, 'top.png')).resize(displaySize * scale, displaySize * scale).toBuffer();
  await sharp({ create: { width: displaySize * scale, height: displaySize * scale, channels: 4, background: '#3c4a2a' } })
    .composite([{ input: top }, { input: svg }]).png().toFile(path.join(run, 'outline-overlay.png'));
}

async function main() {
  const { values } = parseArgs({ options: {
    label: { type: 'string' }, ids: { type: 'string', default: Object.keys(LOBBY_STRUCTURE_ASSETS).join(',') },
    samples: { type: 'string', default: '64' }, device: { type: 'string', default: 'OPTIX' }, blender: { type: 'string' },
    publish: { type: 'boolean' }, 'skip-render': { type: 'boolean' },
  } });
  if (!values.label || !/^[a-z0-9][a-z0-9-]*$/.test(values.label)) throw Error('--label <revision> required (lowercase-kebab)');
  const runs = path.join('D:/Fragdachse-render/base-buildings/runs', values.label);
  const blender = values['skip-render'] ? null : await resolveBlender(values.blender);
  const manifestFile = path.join(repoRoot, 'src/assets/manifests/lobby-structures.json');
  const outlinesFile = path.join(repoRoot, 'src/config/authoring/lobbyStructureOutlines.json');
  const manifest = await exists(manifestFile) ? JSON.parse(await readFile(manifestFile, 'utf8')) : { structures: {} };
  const outlines = JSON.parse(await readFile(outlinesFile, 'utf8'));
  for (const id of values.ids.split(',')) {
    const spec = JSON.parse(await readFile(path.join(repoRoot, 'scripts/asset-pipeline/catalog-v2/assets', id + '.json'), 'utf8'));
    const run = path.join(runs, id);
    const size = spec.sourceSizes.at(-1), displaySize = spec.targetSize, turn = spec.model.turn ?? 0;
    if (!values['skip-render']) {
      const sources = await pythonSources(repoRoot, `recipes_v2/${spec.recipe}.py`);
      const modelSpec = { ...spec, clips: [], requiredClips: [] };
      const modelHash = digest({ spec: modelSpec, sources });
      await mkdir(run, { recursive: true });
      const job = { spec: modelSpec, modelHash, model: path.join(runs, '.models', modelHash + '.blend'), output: run, size,
        settings: { samples: Number(values.samples), device: values.device, denoise: true } };
      await writeFile(path.join(run, 'job.json'), JSON.stringify(job, null, 2));
      const started = performance.now();
      await renderProcess(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python',
        path.join(repoRoot, 'scripts/asset-pipeline/lobby-structure-passes.py'), '--', path.join(run, 'job.json')], path.join(run, 'blender.log'), repoRoot);
      console.log(`${id}: rendered in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    }
    const passes = JSON.parse(await readFile(path.join(run, 'passes.json'), 'utf8'));
    const outline = await deriveOutline(path.join(run, 'solid.png'), size, displaySize, turn);
    await overlay(run, outline, displaySize, turn);
    await writeFile(path.join(run, 'outline.json'), JSON.stringify(outline, null, 2));
    console.log(`${id}: ${outline.rects.length} rects, IoU ${outline.iou.toFixed(3)}, close ${outline.closeRadius}, `
      + `${(outline.solidOutsideFootprint * 100).toFixed(1)} % solid outside the footprint`);
    if (!values.publish) continue;
    const structureId = LOBBY_STRUCTURE_ASSETS[id];
    const target = path.join(repoRoot, 'public/assets/sprites/pipeline-v2', id);
    await mkdir(target, { recursive: true });
    const files = { beauty: 'top.png', albedo: 'color.png', elevation: 'elevation.png', solid: 'solid.png',
      ...Object.fromEntries(passes.layers.map(layer => [`emission-${layer}`, `emission-${layer}.png`])) };
    await writeFile(path.join(run, 'caster-height.png'), await deriveCasterHeight(run, displaySize));
    files['caster-height'] = 'caster-height.png';
    const hashes = {};
    for (const [name, source] of Object.entries(files)) {
      const buffer = await readFile(path.join(run, source));
      await copyFile(path.join(run, source), path.join(target, name + '.png'));
      hashes[name] = sha(buffer);
    }
    const { width, height } = footprint(turn);
    const canvasOffset = { x: -(displaySize - width) / 2, y: -(displaySize - height) / 2 };
    const px = CELL / 1; // one BU is one metre is one cell
    manifest.revision = values.label;
    manifest.structures[structureId] = {
      asset: id, sourceSize: size, displaySize, canvasOffset, turn,
      heightPx: { min: spec.elevation.min * px, max: spec.elevation.max * px },
      layers: passes.layers,
      sockets: Object.fromEntries(Object.entries(passes.sockets).map(([name, s]) => [name, {
        x: Math.round((s.x * displaySize + canvasOffset.x) * 10) / 10, y: Math.round((s.y * displaySize + canvasOffset.y) * 10) / 10,
        z: Math.round(s.z * px * 10) / 10 }])),
      sha256: hashes,
    };
    const entry = outlines.find(candidate => candidate.id === structureId);
    if (!entry) throw Error(`No outline entry ${structureId}`);
    // A republish of the same solid pass keeps its outline revision.
    if (entry.sourceSha256 !== hashes.solid || JSON.stringify(entry.rects) !== JSON.stringify(outline.rects)) entry.revision += 1;
    entry.sourceSha256 = hashes.solid;
    entry.rects = outline.rects;
  }
  if (values.publish) {
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(outlinesFile, JSON.stringify(outlines, null, 2) + '\n');
    console.log('published', manifestFile);
  }
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}`) await main();
