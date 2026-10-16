// Review board and verification for the kraken sucker glow points (kraken-glow-points.mjs output).
// node scripts/asset-pipeline/kraken-glow-boards.mjs [--revision kraken-v14-glow-<n>] [--preview] [--runs art/poc/pipeline-v2/runs] [--out <png>]
// Verifies every sampled pose: source/helper hashes, frame table length = master pose count, and that
// >= 98 % of the points land on colour alpha > .5. The board shows the GM1 poses: 1x display size over the
// v14 colour frame plus two 4x nearest-neighbour crops on a dusk background, dots coloured by t.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { GM1_SAMPLES, KRAKEN_GLOW_ASSETS, KRAKEN_GLOW_REVISION, KRAKEN_GLOW_SOURCE_REVISION, decodeGlowPoints, masterPose, parseSamples } from './kraken-glow-common.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const revision = arg('--revision') ?? 'kraken-v14-glow-1', preview = process.argv.includes('--preview');
if (!KRAKEN_GLOW_REVISION.test(revision)) throw Error('Expected a kraken-v14-glow-<n> revision');
const runs = path.resolve(arg('--runs') ?? 'art/poc/pipeline-v2/runs');
const boardFile = path.resolve(arg('--out') ?? `build/boards/kraken-glow-points${preview ? '-preview' : ''}.png`);
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const hashFile = async file => sha(await fs.readFile(file));
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const DUSK = { r: 22, g: 19, b: 34, alpha: 1 }, ZOOM = 4, CROP = 112, MIN_COVERAGE = .98;
// Root (deep violet) -> mid (cyan) -> tip (warm yellow); readable on the crimson cups and the dusk ground.
const STOPS = [[0, [122, 60, 255]], [.5, [40, 210, 220]], [1, [255, 214, 80]]];
const tColour = t => {
  const i = t <= .5 ? 0 : 1, [a, ca] = STOPS[i], [b, cb] = STOPS[i + 1], f = (t - a) / (b - a);
  return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * f)).join(',')})`;
};
const label = (w, h, title, subtitle = '') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#14111f"/>`
  + `<text x="12" y="22" fill="#ece6f7" font-family="sans-serif" font-size="16">${esc(title)}</text>`
  + `<text x="12" y="42" fill="#a99fbf" font-family="sans-serif" font-size="12">${esc(subtitle)}</text></svg>`);

/** Densest CROP x CROP window (source px), optionally at least `apart` px away from an earlier one on some axis. */
function densest(points, size, avoid, apart = CROP) {
  let best = null;
  for (let top = 0; top <= size - CROP; top += 8) for (let left = 0; left <= size - CROP; left += 8) {
    if (avoid && Math.abs(left - avoid.left) < apart && Math.abs(top - avoid.top) < apart) continue;
    const n = points.filter(p => p.x * size >= left && p.x * size < left + CROP && p.y * size >= top && p.y * size < top + CROP).length;
    if (!best || n > best.n) best = { left, top, n };
  }
  return best;
}

const report = { revision, preview, assets: [] }, rows = [];
const gm1 = parseSamples(GM1_SAMPLES);
for (const [role, id] of KRAKEN_GLOW_ASSETS) {
  const out = path.join(runs, revision, id, 'standard', ...(preview ? ['preview'] : []));
  const result = JSON.parse(await fs.readFile(path.join(out, 'glow-points.json'), 'utf8'));
  const job = JSON.parse(await fs.readFile(path.join(out, 'glow-job.json'), 'utf8'));
  const registryFile = path.resolve('src/config/pipelineAssets/assets', `${id}.json`), asset = JSON.parse(await fs.readFile(registryFile, 'utf8'));
  const source = path.join(runs, KRAKEN_GLOW_SOURCE_REVISION, id, asset.variant), render = JSON.parse(await fs.readFile(path.join(source, 'render.json'), 'utf8'));
  const bin = await fs.readFile(path.join(out, result.file));
  const checks = {
    blend: await hashFile(path.join(source, 'asset.blend')) === job.provenance.blend && result.provenance.blend === job.provenance.blend,
    render: await hashFile(path.join(source, 'render.json')) === job.provenance.render,
    registry: await hashFile(registryFile) === job.provenance.registry,
    helpers: (await Promise.all(Object.entries(job.helperHashes).map(async ([f, h]) => await hashFile(path.join('scripts/asset-pipeline', f)) === h))).every(Boolean),
    bin: sha(bin) === result.sha256 && bin.length === result.bytes && bin.length === result.records * 10,
    frameTable: result.frames.length === asset.socketFrames.length && result.frames.length === render.frames.length,
    complete: result.complete === !preview,
  };
  let points = 0, covered = 0, ranges = true;
  const perFrame = [];
  for (const index of result.sampled) {
    const [first, count] = result.frames[index], decoded = decodeGlowPoints(bin, first, count, asset.elevation);
    const { data, info } = await sharp(path.join(source, render.frames[index].file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let hit = 0;
    for (const p of decoded) {
      const px = Math.min(info.width - 1, Math.floor(p.x * info.width)), py = Math.min(info.height - 1, Math.floor(p.y * info.height));
      if (data[(py * info.width + px) * 4 + 3] > 127.5) hit++;
      ranges &&= p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && p.z >= asset.elevation.min && p.z <= asset.elevation.max;
    }
    points += count; covered += hit; perFrame.push({ index, points: count, onAlpha: hit });
  }
  checks.ranges = ranges;
  const coverage = points ? covered / points : 1;
  checks.coverage = coverage >= MIN_COVERAGE;
  report.assets.push({ id, role, checks, coverage, points, stats: result.stats, worstFrames: perFrame.filter(f => f.onAlpha < f.points).slice(0, 20) });

  const debug = preview ? JSON.parse(await fs.readFile(path.join(out, 'glow-debug.json'), 'utf8').catch(() => '[]')) : [];
  const size = asset.sourceSize;
  for (const s of gm1.filter(s => s.role === role)) {
    const index = masterPose(asset, s.clip, s.selector);
    if (!result.sampled.includes(index)) throw Error(`${id}: pose ${index} was not sampled`);
    const [first, count] = result.frames[index], decoded = decodeGlowPoints(bin, first, count, asset.elevation);
    const colour = await sharp(path.join(source, render.frames[index].file)).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
    const ground = await sharp({ create: { width: size, height: size, channels: 4, background: DUSK } }).composite([{ input: colour }]).png().toBuffer();
    const dots = decoded.map(p => `<circle cx="${(p.x * size).toFixed(2)}" cy="${(p.y * size).toFixed(2)}" r="${Math.max(1.1, p.radiusPx * .55).toFixed(2)}" fill="${tColour(p.t)}" fill-opacity="${(.45 + .55 * p.vis).toFixed(2)}"/>`).join('');
    const full = await sharp(ground).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${dots}</svg>`) }]).png().toBuffer();
    const rejected = (debug.find(d => d.index === index)?.cups ?? []).filter(c => c.vis < .2);
    const crops = [];
    const first4 = densest(decoded, size), disjoint = densest(decoded, size, first4);
    const second4 = disjoint.n * 4 >= first4.n ? disjoint : densest(decoded, size, first4, CROP / 2);
    for (const win of [first4, second4]) {
      const w = CROP * ZOOM, inside = p => p.x * size >= win.left && p.x * size < win.left + CROP && p.y * size >= win.top && p.y * size < win.top + CROP;
      const at = p => [(p.x * size - win.left) * ZOOM, (p.y * size - win.top) * ZOOM];
      const marks = rejected.filter(inside).map(p => { const [x, y] = at(p); return `<circle cx="${x}" cy="${y}" r="2.5" fill="#8a8396" fill-opacity=".75"/>`; }).join('')
        + decoded.filter(inside).map(p => { const [x, y] = at(p); const c = tColour(p.t);
          return `<circle cx="${x}" cy="${y}" r="${(p.radiusPx * ZOOM).toFixed(1)}" fill="none" stroke="${c}" stroke-width="2" stroke-opacity="${(.5 + .5 * p.vis).toFixed(2)}"/><circle cx="${x}" cy="${y}" r="3" fill="${c}"/>`; }).join('');
      const zoomed = await sharp(ground).extract({ left: win.left, top: win.top, width: CROP, height: CROP }).resize(w, w, { kernel: 'nearest' }).png().toBuffer();
      crops.push(await sharp(zoomed).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}">${marks}</svg>`) }]).png().toBuffer());
    }
    const frame = perFrame.find(f => f.index === index);
    rows.push({ title: `${id} · ${s.clip}:${s.selector} · master pose ${index} · ${count} points (${frame.onAlpha} on alpha > .5)`,
      subtitle: `1× ${size} px über v14-Farbbild · 4×-Ausschnitte ${CROP} px nächster Nachbar (Ring = Saugnapfradius${preview ? ', grau = verworfen, vis < .2' : ''})`,
      size, full, crops });
  }
}
const legend = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="24"><defs><linearGradient id="g">${STOPS.map(([o, c]) => `<stop offset="${o}" stop-color="rgb(${c})"/>`).join('')}</linearGradient></defs>`
  + `<text x="0" y="17" fill="#ece6f7" font-family="sans-serif" font-size="13">t: Wurzel</text><rect x="72" y="5" width="260" height="14" fill="url(#g)"/><text x="340" y="17" fill="#ece6f7" font-family="sans-serif" font-size="13">Spitze</text></svg>`);
const gap = 12, cropSize = CROP * ZOOM, width = Math.max(...rows.map(r => r.size)) + 2 * cropSize + 4 * gap, header = 64;
const heights = rows.map(r => 52 + Math.max(r.size, cropSize) + gap);
const layers = [{ input: label(width, header, `Kraken-Saugnapf-Glühpunkte ${revision}${preview ? ' · Vorschau GM1' : ''}`,
  report.assets.map(a => `${a.id}: ${a.points} Punkte, ${(a.coverage * 100).toFixed(2)} % auf Alpha`).join(' · ')), left: 0, top: 0 }, { input: legend, left: width - 432, top: 36 }];
let y = header;
rows.forEach((r, i) => {
  layers.push({ input: label(width, 50, r.title, r.subtitle), left: 0, top: y },
    { input: r.full, left: gap, top: y + 52 }, { input: r.crops[0], left: 2 * gap + r.size, top: y + 52 }, { input: r.crops[1], left: 3 * gap + r.size + cropSize, top: y + 52 });
  y += heights[i];
});
await fs.mkdir(path.dirname(boardFile), { recursive: true });
await sharp({ create: { width, height: y, channels: 4, background: DUSK } }).composite(layers).png().toFile(boardFile);
report.passed = report.assets.every(a => Object.values(a.checks).every(Boolean));
await fs.writeFile(path.join(runs, revision, `verification${preview ? '-preview' : ''}.json`), JSON.stringify(report, null, 2) + '\n');
for (const a of report.assets) console.log(`${a.id}: ${a.points} points, coverage ${(a.coverage * 100).toFixed(2)} %, checks ${JSON.stringify(a.checks)}`);
console.log(boardFile);
if (!report.passed) { console.error('FAIL: kraken glow-point verification'); process.exitCode = 1; }
