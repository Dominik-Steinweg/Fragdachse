import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';

// U-6: immutable Imagegen sources -> exact, co-registered semicircular layers.
// No game runtime, dependency installation, browser or mutable clock is involved.
const root = new URL('../', import.meta.url);
const out = new URL('public/assets/ui/dawn-clock/', root);
const kit = new URL('art/poc/dawn/ui/clock/kit/', root);
const W = 300, H = 160, S = 2, CX = 150, CY = 140;
const INNER = 86, OUTER = 119, FRAME_INNER = 121, FRAME_OUTER = 136;
const clear = { r: 0, g: 0, b: 0, alpha: 0 };
const palette = { day: '#d9cfb6', dusk: '#d9822b', night: '#2f343a', dawn: '#bdc3c1', red: '#8f2f24', bone: '#d9cfb6', dark: '#1b1a17', brass: '#9a8560' };
const assets = new Map();
const digest = b => createHash('sha256').update(b).digest('hex');
const svg = body => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * S}" height="${H * S}" viewBox="0 0 ${W} ${H}">${body}</svg>`);
const imageTag = b => `<image width="${W}" height="${H}" href="data:image/png;base64,${b.toString('base64')}"/>`;
const blank = (w = W * S, h = H * S) => sharp({ create: { width: w, height: h, channels: 4, background: clear } });
const png = b => sharp(b).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
const circle = (x, y, r, fill) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
const rect = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const point = (p, r) => [CX - Math.cos(p * Math.PI) * r, CY - Math.sin(p * Math.PI) * r];
function arcPath(a, b, ri, ro) {
  const p = point(a, ro), q = point(b, ro), r = point(b, ri), t = point(a, ri);
  return `M${p} A${ro},${ro} 0 0 1 ${q} L${r} A${ri},${ri} 0 0 0 ${t} Z`;
}
const arc = (a, b, ri, ro, fill) => `<path d="${arcPath(a, b, ri, ro)}" fill="${fill}"/>`;
const semi = (radius, fill) => `<path d="M${CX - radius},${CY} A${radius},${radius} 0 0 1 ${CX + radius},${CY} Z" fill="${fill}"/>`;
async function save(url, bytes) {
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  try { if ((await readFile(url)).equals(bytes)) return; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await writeFile(url, bytes);
}
async function raw(b) { return sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); }
async function mask(b, body) { return sharp(b).composite([{ input: svg(body), blend: 'dest-in' }]).png().toBuffer(); }
async function stack(layers) { return blank().composite(layers.map(input => ({ input }))).png().toBuffer(); }
async function at(glyph, width, height, x, y) {
  const input = await sharp(glyph).resize(width * S, height * S, { fit: 'contain', background: clear }).png().toBuffer();
  return blank().composite([{ input, left: Math.round((x - width / 2) * S), top: Math.round((y - height / 2) * S) }]).png().toBuffer();
}
function bounds(data, info, threshold = 0) {
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] <= threshold) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  assert(x1 >= x0, 'Empty asset');
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
for (const url of [out, new URL('runtime/', out), kit, new URL('parts/', kit), new URL('previews/', kit)]) await mkdir(url, { recursive: true });
const sources = {};
for (const id of ['frame', 'materials', 'glyphs']) sources[id] = await readFile(new URL(`sources/${id}-source.png`, out));

// Extract real material surfaces, rather than painting texture with procedural noise.
const materials = {};
const mm = await sharp(sources.materials).metadata();
assert.equal(mm.width, mm.height);
const cell = Math.floor(mm.width / 2);
for (const [i, id] of ['paper', 'wood', 'bone', 'brass'].entries()) {
  materials[id] = await sharp(sources.materials).extract({ left: (i % 2) * cell + 30, top: Math.floor(i / 2) * cell + 30, width: cell - 60, height: cell - 60 })
    .resize(W * S, H * S, { fit: 'fill' }).png().toBuffer();
}

// Normalize the generated arch's elliptical / hand-drawn contour to a true circle.
// Each ray samples ONLY the outer frame run (not the generated hub or opening).
// This preserves the brass straps, gouges and wood, while registration is exact.
const frameRaw = await raw(sources.frame);
assert.equal(frameRaw.info.width, 1774, 'Re-review frame polar calibration when replacing source');
assert.equal(frameRaw.info.height, 887);
const srcCx = 887, srcCy = 744, srcRx = 820, srcRy = 720;
function sourcePixel(x, y) {
  const ix = Math.max(0, Math.min(frameRaw.info.width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(frameRaw.info.height - 1, Math.round(y)));
  return (iy * frameRaw.info.width + ix) * 4;
}
const rays = [];
for (let n = 0; n <= 1440; n++) {
  const t = -Math.PI + n / 1440 * Math.PI;
  let outside = 1, inside = 0.88, found = false;
  for (let k = 1150; k >= 750; k--) {
    const r = k / 1000, i = sourcePixel(srcCx + Math.cos(t) * srcRx * r, srcCy + Math.sin(t) * srcRy * r);
    if (!found && frameRaw.data[i + 3] > 192) { outside = r; found = true; }
    else if (found && frameRaw.data[i + 3] < 128) { inside = r + 0.002; break; }
  }
  inside = Math.max(inside, outside - 0.15);
  rays.push({ t, inside, outside: outside - 0.002 });
}
const archPixels = Buffer.alloc(W * S * H * S * 4);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) {
  const dx = (x + 0.5) / S - CX, dy = (y + 0.5) / S - CY, r = Math.hypot(dx, dy);
  if (dy > 0 || r < FRAME_INNER - 1 || r > FRAME_OUTER + 1) continue;
  const t = Math.atan2(dy, dx), n = Math.max(0, Math.min(1440, Math.round((t + Math.PI) / Math.PI * 1440)));
  const ray = rays[n], u = Math.max(0, Math.min(1, (r - FRAME_INNER) / (FRAME_OUTER - FRAME_INNER)));
  const sr = ray.inside + (ray.outside - ray.inside) * u;
  const i = sourcePixel(srcCx + Math.cos(t) * srcRx * sr, srcCy + Math.sin(t) * srcRy * sr), j = (y * W * S + x) * 4;
  archPixels[j] = frameRaw.data[i]; archPixels[j + 1] = frameRaw.data[i + 1]; archPixels[j + 2] = frameRaw.data[i + 2]; archPixels[j + 3] = 255;
}
const mappedArch = await mask(await sharp(archPixels, { raw: { width: W * S, height: H * S, channels: 4 } }).png().toBuffer(), arc(0, 1, FRAME_INNER, FRAME_OUTER, 'white'));
const rail = await mask(materials.wood, rect(6, 138, 288, 16, 'white'));
const endCaps = await mask(materials.brass, rect(6, 138, 10, 16, 'white') + rect(283, 138, 11, 16, 'white'));
const railDetail = svg(rect(17, 140, 266, 1, '#8a7655') + rect(17, 151, 266, 1, '#151411') + circle(11, 146, 1.8, '#24221c') + circle(288, 146, 1.8, '#24221c'));
const innerLip = await mask(materials.brass, arc(0, 1, 121, 122, 'white'));
const frame = await stack([mappedArch, innerLip, rail, endCaps, railDetail]);

// Uniformly dark paper under all phase geometry.
const faceRaw = await raw(materials.paper);
for (let i = 0; i < faceRaw.data.length; i += 4) {
  const d = Math.round((faceRaw.data[i] - 30) * 0.16);
  faceRaw.data[i] = Math.max(22, Math.min(38, 27 + d));
  faceRaw.data[i + 1] = Math.max(21, Math.min(36, 26 + d));
  faceRaw.data[i + 2] = Math.max(18, Math.min(31, 23 + d));
}
const face = await mask(await sharp(faceRaw.data, { raw: faceRaw.info }).png().toBuffer(), semi(122, 'white'));
// Grayscale RGB plus restrained alpha: normal over blending, no colored fringes.
const grainRaw = await raw(materials.bone);
for (let i = 0; i < grainRaw.data.length; i += 4) {
  const luminance = grainRaw.data[i] * 0.3 + grainRaw.data[i + 1] * 0.6 + grainRaw.data[i + 2] * 0.1;
  grainRaw.data[i] = grainRaw.data[i + 1] = grainRaw.data[i + 2] = 0;
  grainRaw.data[i + 3] = Math.round(Math.min(58, Math.max(3, (230 - luminance) * 0.52)));
}
const grain = await mask(await sharp(grainRaw.data, { raw: grainRaw.info }).png().toBuffer(), arc(0, 1, INNER, OUTER, 'white'));

// Circular brass medallion, dark icon recess 32 px, all concentric with the pivot.
const brassDisc = await mask(materials.brass, circle(CX, CY, 20, 'white'));
const medallion = await stack([brassDisc, svg(`<circle cx="150" cy="140" r="19" fill="none" stroke="#b9a275" stroke-width="0.7"/>` + circle(CX, CY, 16, '#211f19') + `<circle cx="150" cy="140" r="15.5" fill="none" stroke="#695737" stroke-width="0.7"/>` + circle(150, 122.5, 0.65, '#30291c') + circle(150, 157.5, 0.65, '#30291c'))]);
// Neutral hub plug is integrated into the medallion, covered by the modifier at night.
const hubPlug = await mask(materials.brass, circle(CX, CY, 11.5, 'white'));
const medallionComplete = await stack([medallion, hubPlug, svg(`<circle cx="150" cy="140" r="10.5" fill="none" stroke="#6f5d3d" stroke-width="0.7"/>`)]);
const handOutline = '<path d="M150,31 L158,116 L155,146 L145,146 L142,116 Z" fill="#191813"/>';
const handBody = '<path d="M150,34 L155.5,116 L153,144 L147,144 L145,116 Z" fill="white"/>';
const hand = await stack([svg(handOutline), await mask(materials.bone, handBody), svg('<path d="M150,43 L153.5,116 L151.8,132 L150.5,118 Z" fill="#a9956a" opacity="0.7"/>')]);

// Recover only printed ink, remove opaque atlas ground, preserve large cut marks.
const gm = await sharp(sources.glyphs).metadata(), gw = Math.floor(gm.width / 3);
const glyphs = {};
for (const [n, id] of ['sun', 'moon', 'sunrise'].entries()) {
  const cellImage = await sharp(sources.glyphs).extract({ left: n * gw, top: 0, width: gw, height: gm.height }).png().toBuffer();
  const rr = await raw(cellImage);
  for (let i = 0; i < rr.data.length; i += 4) {
    const a = Math.max(0, Math.min(255, Math.round((rr.data[i] - 75) * 2.2)));
    rr.data[i] = 217; rr.data[i + 1] = 207; rr.data[i + 2] = 182; rr.data[i + 3] = a;
  }
  const crop = bounds(rr.data, rr.info, 100);
  glyphs[id] = await sharp(rr.data, { raw: rr.info }).extract(crop).png().toBuffer();
}
const icons = {};
for (const id of ['sun', 'moon', 'sunrise']) icons[id] = await at(glyphs[id], 24, 24, 150, 37);
const tips = {};
for (const id of ['sun', 'moon']) tips[id] = await stack([svg(circle(150, 37, 9.5, '#201e19')), await at(glyphs[id], 15, 15, 150, 37)]);
const redRaw = await raw(materials.bone);
for (let i = 0; i < redRaw.data.length; i += 4) {
  const d = Math.max(0.65, Math.min(1, redRaw.data[i] / 215));
  redRaw.data[i] = Math.round(143 * d); redRaw.data[i + 1] = Math.round(47 * d); redRaw.data[i + 2] = Math.round(36 * d);
}
const red = await sharp(redRaw.data, { raw: redRaw.info }).png().toBuffer();
const waveShape = '<path d="M147,10 L153,10 L152.5,19 L150,23 L147.5,19 Z" fill="white"/>';
const finalShape = '<path d="M144,8 L148.5,8 L150,15 L151.5,8 L156,8 L155,19 L150,25 L145,19 Z" fill="white"/>';
const wave = await stack([svg('<path d="M146.5,9.5 L153.5,9.5 L153,19 L150,24 L147,19 Z" fill="#b5a47c"/>'), await mask(red, waveShape)]);
const finale = await stack([svg('<path d="M143.5,7.5 L149,7.5 L150,12 L151,7.5 L156.5,7.5 L155.5,19.5 L150,26 L144.5,19.5 Z" fill="#b5a47c"/>'), await mask(red, finalShape)]);

const definitions = [
  ['frame', frame, { role: 'Fixed wooden arch and brass fittings, transparent opening', radii: { inner: 121, outer: 136 }, baseRail: { x: 6, y: 138, width: 288, height: 16 } }],
  ['face', face, { role: 'Dark semicircular paper foundation', radius: 122 }],
  ['arc-grain', grain, { role: 'Grayscale black grain; normal alpha-over on procedural sectors', radii: { inner: INNER, outer: OUTER }, blend: 'normal', opacity: 1 }],
  ['medallion', medallionComplete, { role: 'Brass pivot and neutral hub; modifier covers central plug', center: [CX, CY], outerRadius: 20, iconSlot: { center: [CX, CY], diameter: 32, recommendedIconSize: [24, 32], clipRadius: 16 } }],
  ['hand', hand, { role: 'Bone/wood pointer, points up', pivot: [CX, CY], length: 106, silhouetteLength: 109, tipCenter: [150, 37], boundsWidth: 16, rearLength: 6 }],
  ['tip-sun', tips.sun, { role: 'Day pointer tip', center: [150, 37], size: [19, 19], glyphSize: [15, 15], rotatesWithHand: true }],
  ['tip-moon', tips.moon, { role: 'Night pointer tip', center: [150, 37], size: [19, 19], glyphSize: [15, 15], rotatesWithHand: true }],
  ...['sun', 'moon', 'sunrise'].map(id => [`icon-${id}`, icons[id], { role: 'Upright movable arc symbol', center: [150, 37], size: [24, 24], radialDistance: 103, keepUpright: true }]),
  ['notch-wave', wave, { role: 'Single dark-red night-wave notch', center: [150, 16.5], size: [7, 14.5], radialDistance: 123.5 }],
  ['notch-final', finale, { role: 'Larger forked dark-red finale notch', center: [150, 16.5], size: [13, 18.5], radialDistance: 123.5 }],
];
const manifest = {
  schemaVersion: 1, id: 'dawn-clock-semicircle-v1', designCanvas: { width: W, height: H },
  scales: [1, 2], pivot: { x: CX, y: CY }, normalizedOrigin: { x: CX / W, y: CY / H },
  arc: { center: [CX, CY], innerRadius: INNER, outerRadius: OUTER, sweepDegrees: 180, startDegrees: 180, endDegrees: 360, coordinateSystem: 'screen x right / y down; degrees from +x, increasing clockwise', direction: 'left -> top -> right', progressFormula: 'angleDegrees = 180 + 180 * clamp(progress, 0, 1)' },
  hand: { pivot: [CX, CY], length: 106, neutralDirection: 'up', rotationFormula: 'rotationDegrees = -90 + 180 * clamp(progress, 0, 1)', tipCenter: [150, 37] },
  displaySizes: [{ width: 150, height: 80 }, { width: 120, height: 64 }],
  layerOrder: ['face', 'procedural-sectors', 'arc-grain', 'elapsed-darkening', 'frame', 'arc-icons', 'notches', 'hand', 'tip', 'medallion', 'modifier'],
  palette, sourceFiles: {}, assets: {},
  proof: { examplePhaseFractions: [0.37, 0.08, 0.50, 0.05], waveProgress: [0.47, 0.585, 0.70], finaleProgress: 0.81, states: [{ id: 'day', progress: 0.185 }, { id: 'night', progress: 0.625, modifier: 'night-blood-moon' }, { id: 'sunrise', progress: 0.985 }], note: 'Illustrative geometry only; runtime must resolve actual schedule/wave plan, not these sample timings.' },
};
for (const id of Object.keys(sources)) manifest.sourceFiles[id] = { path: `../sources/${id}-source.png`, sha256: digest(sources[id]) };

// Export invariant checks: same canvas, clear margins, circular masks, no colored grain.
for (const [id, master, details] of definitions) {
  const rr = await raw(master);
  assert.equal(rr.info.width, W * S, `${id}: width`); assert.equal(rr.info.height, H * S, `${id}: height`);
  for (const [x, y] of [[0, 0], [W * S - 1, 0], [0, H * S - 1], [W * S - 1, H * S - 1]]) assert.equal(rr.data[(y * W * S + x) * 4 + 3], 0, `${id}: corner alpha`);
  if (id === 'frame') assert.equal(rr.data[(100 * S * W * S + CX * S) * 4 + 3], 0, 'Frame opening must be clear');
  if (id === 'arc-grain' || id === 'face') for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) {
    const i = (y * W * S + x) * 4, r = Math.hypot((x + 0.5) / S - CX, (y + 0.5) / S - CY);
    if (rr.data[i + 3] === 0) continue;
    assert(y / S <= CY && r <= (id === 'face' ? 122 : OUTER) + 1, `${id}: outside semicircle`);
    if (id === 'arc-grain') { assert(r >= INNER - 1, 'Grain inside central opening'); assert.equal(rr.data[i], rr.data[i + 1]); assert.equal(rr.data[i], rr.data[i + 2]); }
  }
  assets.set(id, master);
  await save(new URL(`parts/${id}.png`, kit), await png(master));
  const entry = { ...details, canvas: { width: W, height: H }, origin: [CX, CY], alphaBounds2x: bounds(rr.data, rr.info), files: {} };
  for (const scale of [1, 2]) {
    const webp = await sharp(master).resize(W * scale, H * scale, { kernel: 'lanczos3' }).webp({ lossless: true, effort: 6 }).toBuffer();
    entry.files[`${scale}x`] = { path: `${id}-${scale}x.webp`, width: W * scale, height: H * scale, sha256: digest(webp), bytes: webp.length };
    await save(new URL(`runtime/${id}-${scale}x.webp`, out), webp);
  }
  manifest.assets[id] = entry;
}
await save(new URL('runtime/manifest.json', out), `${JSON.stringify(manifest, null, 2)}\n`);

// Mounted proof uses the exported layers and the same pivot/geometry as the manifest.
async function rotated(id, p) { return png(svg(`<g transform="rotate(${-90 + 180 * p} ${CX} ${CY})">${imageTag(assets.get(id))}</g>`)); }
async function upright(id, p, radius = 103) {
  const [x, y] = point(p, radius);
  return png(svg(`<g transform="translate(${x - 150} ${y - 37})">${imageTag(assets.get(id))}</g>`));
}
const modifierSource = await readFile(new URL('public/assets/ui/dawn/runtime/night-blood-moon-64.webp', root));
const modifier = await mask(await at(modifierSource, 30, 30, CX, CY), circle(CX, CY, 15, 'white'));
async function mounted(state) {
  const layers = [assets.get('face')];
  let start = 0, sectors = '';
  for (const [i, fraction] of manifest.proof.examplePhaseFractions.entries()) {
    sectors += arc(start, start + fraction, INNER, OUTER, [palette.day, palette.dusk, palette.night, palette.dawn][i]); start += fraction;
  }
  layers.push(await png(svg(sectors)), assets.get('arc-grain'), await png(svg(`<g opacity="0.15">${arc(0, state.progress, INNER, OUTER, '#000')}</g>`)), assets.get('frame'));
  for (const [id, p] of [['sun', 0.065], ['moon', 0.45], ['sunrise', 0.935]]) {
    const [x, y] = point(p, 103);
    layers.push(await png(svg(circle(x, y, 13, '#24231f'))), await upright(`icon-${id}`, p));
  }
  for (const p of manifest.proof.waveProgress) layers.push(await rotated('notch-wave', p));
  layers.push(await rotated('notch-final', manifest.proof.finaleProgress), await rotated('hand', state.progress), await rotated(state.id === 'night' ? 'tip-moon' : 'tip-sun', state.progress), assets.get('medallion'));
  if (state.modifier) layers.push(modifier);
  return stack(layers);
}
const previews = [];
for (const state of manifest.proof.states) { const b = await mounted(state); previews.push(b); await save(new URL(`previews/clock-${state.id}.png`, kit), b); }

// Fixed local gameplay crops avoid depending on the sibling Dawn worktree on repeat runs.
const scenes = {};
for (const id of ['day', 'night']) scenes[id] = await readFile(new URL(`sources/game-${id}.png`, kit));
const BW = 1600, BH = 1960, boardLayers = [];
const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
let labels = '';
function text(s, x, y, size = 18, color = '#d9cfb6', weight = 400) { labels += `<text x="${x}" y="${y}" fill="${color}" font-family="DejaVu Sans, sans-serif" font-size="${size}" font-weight="${weight}">${esc(s)}</text>`; }
text('DAWN / SONNENUHR-KOMPASS / ASSET-KIT', 32, 45, 30, '#d9cfb6', 700);
text('300 x 160 Design | Pivot 150 / 140 | Skalenbogen R 86-119 | 180 Grad: links nach rechts', 32, 78, 18, '#b8ab8e');
text('Einzelteile: voller gemeinsamer Canvas, hier 300 x 160. Schachgrund = Transparenz.', 32, 113, 17);
for (let i = 0; i < definitions.length; i++) {
  const [id] = definitions[i], x = 32 + (i % 4) * 392, y = 140 + Math.floor(i / 4) * 200;
  text(id, x, y, 18, '#c8b98f', 700);
  const checker = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><defs><pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#33332e"/><path d="M0 0h10v10H0z M10 10h10v10H10z" fill="#41413a"/></pattern></defs><rect width="300" height="160" fill="url(#p)"/></svg>`);
  boardLayers.push({ input: await png(checker), left: x, top: y + 10 }, { input: await sharp(assets.get(id)).resize(300, 160).png().toBuffer(), left: x, top: y + 10 });
}
text('MONTAGE / BEISPIELSEGMENTE 37 % TAG - 8 % DAEMMERUNG - 50 % NACHT - 5 % MORGEN', 32, 754, 20, '#d9cfb6', 700);
for (let i = 0; i < 3; i++) {
  const x = 80 + 500 * i;
  text(['TAG-MITTE', 'NACHT / BLUTMOND IM MEDAILLON', 'KURZ VOR SONNENAUFGANG'][i], x, 790, 17, '#c8b98f');
  boardLayers.push({ input: await sharp(previews[i]).resize(360, 192).png().toBuffer(), left: x, top: 804 });
}
text('GROESSENPROBE / oben mittig im echten Spielausschnitt / bei 100 % ansehen', 32, 1040, 22, '#d9cfb6', 700);
for (let c = 0; c < 4; c++) text(['TAG 150 x 80', 'TAG 120 x 64', 'NACHT 150 x 80', 'NACHT 120 x 64'][c], 32 + c * 392, 1080, 17, '#c8b98f');
for (let i = 0; i < 3; i++) {
  const y = 1110 + i * 255;
  text(['Tag-Mitte / Sonnenzeiger', 'Nacht / Mondzeiger + Modifikator', 'Vor Sonnenaufgang / Sonnenzeiger'][i], 32, y, 17);
  for (let c = 0; c < 4; c++) {
    const width = c % 2 === 0 ? 150 : 120, height = width * H / W, x = 32 + c * 392;
    const crop = scenes[c < 2 ? 'day' : 'night'];
    const clock = await sharp(previews[i]).resize(width, height, { kernel: 'lanczos3' }).png().toBuffer();
    const image = await sharp(crop).composite([{ input: clock, left: (360 - width) / 2, top: 8 }]).png().toBuffer();
    boardLayers.push({ input: image, left: x, top: y + 14 });
  }
}
text('3 Wellenkerben + groesseres Finale. Zeitwerte illustrativ; Laufzeit nutzt den Phasenplan. Keine Browser-/Action-Pruefung.', 32, 1905, 16, '#b8ab8e');
text('Imagegen-Material + praezise Sharp-Masken | 12 Teile / 24 verlustfreie WebPs | Ursprung fuer ALLE Layer identisch.', 32, 1935, 16, '#b8ab8e');
boardLayers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${BW}" height="${BH}">${labels}</svg>`), left: 0, top: 0 });
const board = await sharp({ create: { width: BW, height: BH, channels: 4, background: '#1b1a17' } }).composite(boardLayers).png({ compressionLevel: 9 }).toBuffer();
await save(new URL('clock-kit-board.png', kit), board);

const readme = `# Dawn clock / semicircular asset kit

Concept C, following docs/GDDs/Fragdachse_From_Dachs_Till_Dawn_Uhr_V1.md and the Dawn Druck art direction.
Generated materials and glyphs: built-in Imagegen, prompts in sources/PROMPTS.json. Exact masks, registration, export and proof: Sharp.

## Rebuild

Run \`node scripts/export-dawn-clock.mjs\` from the repository (also works from other working directories).
Uses existing Sharp; no install, runtime code, browser, or package.json change. Sources are immutable.
The second run writes no changed bytes. No timestamps/randomness in outputs. Same Sharp/libvips versions are needed for byte-identical encoding.

## Files and geometry

- 12 parts, 24 lossless WebPs: runtime/<part>-1x.webp (300 x 160) and -2x.webp (600 x 320).
- Canonical manifest: [runtime/manifest.json](runtime/manifest.json). All geometry is in 1x design pixels; multiply ALL coordinates/radii by two for 2x pixels.
- Every layer uses the full canvas. Common pivot (150, 140), normalized origin (0.5, 0.875); do not trim layers independently.
- Upper semicircular scale: inner radius 86, outer radius 119. Frame: 121-136, bottom rail y=138..154.
- Screen coordinates x right/y down: arc angle = 180 + 180 * progress. Left/start=180, top=270, right/finish=360.
- Hand points up: rotation = -90 + 180 * progress degrees. Bone tip length 106; dark outline reaches 109; rear length 6. Tip glyph center (150,37), radius 103.
- Medallion radius 20 at pivot; dark icon slot diameter 32. Modifier icon 24-32, clipped to radius 16, drawn ABOVE the medallion plug. The proof uses 30.
- Arc symbols fit 24 x 24; pointer symbols 19 x 19 including dark backing (glyph 15 x 15). Wave notch 7 x 14.5; forked finale 13 x 18.5. Sizes include contrast edging.

## Composition

Follow manifest.layerOrder. Sectors are NOT baked into face/frame; derive boundaries from the actual schedule and resolved wave plan.
Arc-grain is black grayscale ink with encoded alpha, only within R86-119; normal over blending at opacity 1. No color tint needed.
Hand and notches rotate about the common pivot. Symbols are stored at canonical center (150,37): translate to their target arc points and keep upright; the proof adds a dark round backing for contrast on pale sectors.
Tip symbols rotate with the hand. The hand's charcoal edge preserves visibility across both light and dark backgrounds.
Medallion covers the hand root. The neutral brass plug remains when there is no modifier.
Recommended assembled display 150 x 80; lower bound 120 x 64. At 150 px width all design values halve (modifier 15 px in this proof).
Wave pulse and phase-glint are runtime behavior, not baked into these assets.

## Proof and provenance

- [Contact sheet](../../../../art/poc/dawn/ui/clock/kit/clock-kit-board.png): all 12 parts; three mounted states; each at 150 x 80 / 120 x 64 over both day/night crops (12 combinations).
- 2x PNG parts and mounted previews are under art/poc/dawn/ui/clock/kit/.
- Example fractions 37/8/50/5 percent, waves at progress .47/.585/.70 and finale .81. These are proof data, NOT runtime defaults.
- Night modifier comes from public/assets/ui/dawn/runtime/night-blood-moon-64.webp.
- Gameplay crops: original G1 board__lichtung-day.png / board__lichtung-night.png from sibling dawn/build/dawn/G1, native crop x330/y290/360x210, copied into kit/sources for repeatability. Older 2026-10-13 captures serve only as backdrops.
- Source hashes and output hashes in manifest. Export validates common dimensions, alpha corners, frame opening, semicircular face/arc bounds, and grayscale grain.
- Static asset/proof inspection only; no live gameplay or animation verification.

Knowledge writeback: No durable project knowledge discovered.
`;
await save(new URL('README.md', out), readme);
console.log(`Dawn clock: ${assets.size} registered parts, 24 lossless WebPs, manifest, README and proof board exported.`);
