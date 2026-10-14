import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Source art is immutable Imagegen material. All coordinates below are integer pixels.
// Masters are authored at 2x; design-space insets and source-space insets are both exported.
const root = new URL('../', import.meta.url);
const assets = new URL('public/assets/ui/dawn-merchant/', root);
const review = new URL('art/poc/dawn/ui/kit/', root);
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
const colors = { bone: '#d9cfb6', charcoal: '#1b1a17', brass: '#9a8560', red: '#8f2f24' };
const registry = new Map();
const hash = data => createHash('sha256').update(data).digest('hex');
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const rect = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const blank = (w, h, background = transparent) => sharp({ create: { width: w, height: h, channels: 4, background } });
const png = input => sharp(input).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
async function save(url, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  try { if ((await readFile(url)).equals(bytes)) return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(url, bytes);
}
await mkdir(new URL('runtime/', assets), { recursive: true });
await mkdir(review, { recursive: true });
const sources = {};
for (const name of ['materials', 'corner', 'icons', 'panorama']) sources[name] = await readFile(new URL(`sources/${name}.png`, assets));

async function raw(input) { return sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); }
// Blend only narrow paired edge bands. The central artwork is untouched.
// Unlike a mirror repeat, this preserves the direction of the original wood/forest.
async function periodic(input, axes = 'xy') {
  const { data, info } = await raw(input);
  const { width: w, height: h, channels: c } = info;
  if (axes.includes('x')) for (let y = 0; y < h; y++) for (let k = 0; k < 3; k++) {
    const band = Math.min(48, Math.floor(w / 8));
    for (let x = 0; x < band; x++) {
      const first = (y * w + x) * c + k, last = (y * w + w - 1 - x) * c + k;
      const a = data[first], b = data[last], blend = 0.5 * (1 - x / band);
      data[first] = Math.round(a + (b - a) * blend); data[last] = Math.round(b + (a - b) * blend);
    }
  }
  if (axes.includes('y')) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
    const band = Math.min(48, Math.floor(h / 8));
    for (let y = 0; y < band; y++) {
      const first = (y * w + x) * c + k, last = ((h - 1 - y) * w + x) * c + k;
      const a = data[first], b = data[last], blend = 0.5 * (1 - y / band);
      data[first] = Math.round(a + (b - a) * blend); data[last] = Math.round(b + (a - b) * blend);
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

const materials = {};
const materialMeta = await sharp(sources.materials).metadata();
const quadrant = Math.floor(materialMeta.width / 2);
for (const [index, name] of ['paper', 'wood', 'red', 'brass'].entries()) {
  const tile = await sharp(sources.materials).extract({ left: (index % 2) * quadrant + 50, top: Math.floor(index / 2) * quadrant + 50, width: quadrant - 100, height: quadrant - 100 }).resize(512, 512).modulate({ saturation: name === 'red' ? 0.75 : 0.9, brightness: name === 'red' ? 0.78 : 1 }).png().toBuffer();
  let prepared = tile;
  if (name === 'paper') {
    const pixels = await raw(tile);
    for (let p = 0; p < pixels.data.length; p += 4) {
      const grain = Math.round((pixels.data[p] - 25) * 0.14);
      pixels.data[p] = Math.max(22, Math.min(33, 27 + grain));
      pixels.data[p + 1] = Math.max(21, Math.min(32, 26 + grain));
      pixels.data[p + 2] = Math.max(18, Math.min(29, 23 + grain));
    }
    prepared = await sharp(pixels.data, { raw: pixels.info }).png().toBuffer();
  }
  materials[name] = await periodic(prepared);
}
async function tile(input, w, h) {
  const m = await sharp(input).metadata(), layers = [];
  for (let y = 0; y < h; y += m.height) for (let x = 0; x < w; x += m.width) {
    const width = Math.min(m.width, w - x), height = Math.min(m.height, h - y);
    layers.push({ input: await sharp(input).extract({ left: 0, top: 0, width, height }).png().toBuffer(), left: x, top: y });
  }
  return blank(w, h).composite(layers).png().toBuffer();
}
async function masked(input, mask) { return sharp(input).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer(); }
async function surface(w, h, type, inset = 0) {
  return masked(await tile(materials[type], w, h), svg(w, h, rect(inset, inset, w - 2 * inset, h - 2 * inset, 'white')));
}
async function ring(w, h, thickness, color, inset = 0) {
  // Four opaque integer rectangles: no fractional stroke / antialiasing seam.
  return png(svg(w, h, rect(inset, inset, w - 2 * inset, thickness, color) + rect(inset, h - inset - thickness, w - 2 * inset, thickness, color)
    + rect(inset, inset + thickness, thickness, h - 2 * inset - 2 * thickness, color) + rect(w - inset - thickness, inset + thickness, thickness, h - 2 * inset - 2 * thickness, color)));
}
async function texturedRing(w, h, thickness, type, inset = 0) {
  return masked(await tile(materials[type], w, h), await ring(w, h, thickness, '#fff', inset));
}
async function add(key, image, width, height, usage, options = {}) {
  const master = await png(image), m = await sharp(master).metadata();
  if (m.width !== width * 2 || m.height !== height * 2) throw new Error(`${key}: master must be 2x design dimensions`);
  registry.set(key, { key, image: master, width, height, usage, ...options });
}
const allInsets = n => ({ left: n, top: n, right: n, bottom: n });

// Clean atlas glyphs by color/alpha, then retain meaningful connected components.
// This removes isolated generation fringe pixels without inventing new silhouettes.
async function cleanGlyph(input) {
  const { data, info } = await raw(input), w = info.width, h = info.height;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2];
    mask[i] = data[p + 3] > 120 && r > 75 && g > 65 && b > 40 && Math.max(r, g, b) - Math.min(r, g, b) < 105 ? 1 : 0;
  }
  const seen = new Uint8Array(mask.length), components = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const pixels = [start]; seen[start] = 1;
    for (let index = 0; index < pixels.length; index++) {
      const i = pixels[index], x = i % w, y = Math.floor(i / w);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy, n = ny * w + nx;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[n] && !seen[n]) { seen[n] = 1; pixels.push(n); }
      }
    }
    components.push(pixels);
  }
  const keep = new Uint8Array(mask.length), largest = Math.max(...components.map(c => c.length));
  for (const component of components) if (component.length >= Math.max(50, largest * 0.007)) for (const i of component) keep[i] = 1;
  let left = w, top = h, right = 0, bottom = 0;
  for (let i = 0; i < keep.length; i++) {
    const p = i * 4;
    if (!keep[i]) { data.fill(0, p, p + 4); continue; }
    // Quantized ink prevents generated glossy outlines and stray colored fringes.
    const shade = data[p] < 145 ? 0.72 : 1;
    data[p] = Math.round(217 * shade); data[p + 1] = Math.round(207 * shade); data[p + 2] = Math.round(182 * shade); data[p + 3] = 255;
    left = Math.min(left, i % w); right = Math.max(right, i % w); top = Math.min(top, Math.floor(i / w)); bottom = Math.max(bottom, Math.floor(i / w));
  }
  return sharp(data, { raw: info }).extract({ left, top, width: right - left + 1, height: bottom - top + 1 }).png().toBuffer();
}
const iconMeta = await sharp(sources.icons).metadata(), cellW = Math.floor(iconMeta.width / 3), cellH = Math.floor(iconMeta.height / 3);
const glyphs = {};
for (const [index, key] of ['close', 'icon-lock', 'icon-check', 'icon-cart', 'icon-search', 'icon-filter', 'category-sensors', 'category-supply', 'category-crafting'].entries()) {
  const correctedCrops = {
    'icon-search': { left: 430, top: 435, width: 395, height: 365 },
    'category-supply': { left: 440, top: 800, width: 370, height: 425 },
    'category-sensors': { left: 30, top: 808, width: 390, height: 410 },
  };
  const cell = await sharp(sources.icons).extract(correctedCrops[key] ?? { left: (index % 3) * cellW, top: Math.floor(index / 3) * cellH, width: cellW, height: cellH }).png().toBuffer();
  glyphs[key] = await cleanGlyph(cell);
}
async function fittedGlyph(key, w, h, pad = 4) {
  return sharp(glyphs[key]).resize(w - pad * 2, h - pad * 2, { fit: 'contain', background: transparent }).extend({ left: pad, right: pad, top: pad, bottom: pad, background: transparent }).png().toBuffer();
}

// Window: 24px straight rails, 64px fixed corner footprints, transparent center.
const frameW = 512, frameH = 512;
const cornerMeta = await sharp(sources.corner).metadata();
if (cornerMeta.width !== 1254 || cornerMeta.height !== 1254) throw new Error('Corner source dimensions changed: re-review crop');
let corner = await sharp(sources.corner).extract({ left: 155, top: 151, width: 450, height: 450 }).resize(128, 128).png().toBuffer();
// Keep ornament in the fixed corner, square off the rail junctions to exactly 48px.
corner = await masked(corner, svg(128, 128, rect(0, 0, 90, 90, '#fff') + rect(90, 0, 38, 48, '#fff') + rect(0, 90, 48, 38, '#fff')));
const frameLayers = [{ input: await texturedRing(frameW, frameH, 48, 'wood'), left: 0, top: 0 }, { input: await ring(frameW, frameH, 2, '#64513a', 0), left: 0, top: 0 }, { input: await ring(frameW, frameH, 2, '#9a8560', 46), left: 0, top: 0 }];
for (const [left, top, flop, flip] of [[0, 0, false, false], [384, 0, true, false], [0, 384, false, true], [384, 384, true, true]]) {
  frameLayers.push({ input: await sharp(corner).flop(flop).flip(flip).png().toBuffer(), left, top });
}
await add('window-frame', await blank(frameW, frameH).composite(frameLayers).png().toBuffer(), 256, 256, 'Äußerer Fensterrahmen; Innenfläche separat darunter kacheln.', { insets: allInsets(64), borderWidth: 24, contentInsets: allInsets(28), transparentCenter: true });
await add('panel-fill', materials.paper, 256, 256, 'Ruhige Holzkohle-/Papierfläche hinter Text; in X und Y kacheln.', { tile: 'xy' });
const panoramaMeta = await sharp(sources.panorama).metadata();
const panorama = await sharp(sources.panorama).extract({ left: 0, top: Math.round(panoramaMeta.height * 0.13), width: panoramaMeta.width, height: Math.round(panoramaMeta.height * 0.66) }).resize(2048, 320).png().toBuffer();
await add('header-panorama', await periodic(panorama, 'x'), 1024, 160, 'Sekundäres Walddekor im Kopf; horizontal kacheln, bei wenig Höhe beschneiden.', { tile: 'x' });

async function band(width, height, state, sub = false, buy = false) {
  const w = width * 2, h = height * 2, leftInset = sub ? 32 : 0;
  const base = await surface(w, h, state === 'active' || (buy && state !== 'disabled') ? 'red' : 'paper');
  const mask = svg(w, h, rect(leftInset, 0, w - leftInset, h, '#fff'));
  const layers = [{ input: base, left: 0, top: 0 }, { input: await texturedRing(w, h, buy ? 8 : 2, 'brass'), left: 0, top: 0 }];
  if (state === 'hover') layers.push({ input: await ring(w, h, 2, colors.bone, buy ? 8 : 3), left: 0, top: 0 });
  if (state === 'active') layers.push({ input: svg(w, h, rect(leftInset + 6, 10, 5, h - 20, colors.bone)), left: 0, top: 0 });
  if (buy) {
    const rivets = [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="#b6a079"/><circle cx="${x}" cy="${y}" r="1.5" fill="#2a241d"/>`).join('');
    layers.push({ input: svg(w, h, rivets), left: 0, top: 0 });
  }
  if (sub) layers.push({ input: svg(w, h, rect(32, 0, 2, h, state === 'active' ? colors.bone : '#655640')), left: 0, top: 0 });
  let result = await blank(w, h).composite(layers).png().toBuffer();
  if (state === 'disabled') result = await sharp(result).modulate({ saturation: 0.25, brightness: 0.62 }).png().toBuffer();
  return masked(result, mask);
}
for (const sub of [false, true]) for (const state of ['normal', 'hover', 'active']) {
  await add(`${sub ? 'subcategory' : 'category'}-row-${state}`, await band(288, 56, state, sub), 288, 56,
    `${sub ? 'Unterkategorie: 16px transparente Einrückung eingebaut; Inhalt zusätzlich ab x=32.' : 'Kategorie: Platz für separates Icon, Label und Zähler.'} Zustand ${state}.`,
    { insets: { left: sub ? 32 : 16, top: 12, right: 16, bottom: 12 }, contentInsets: { left: sub ? 32 : 16, top: 10, right: 16, bottom: 10 } });
}
for (const state of ['normal', 'hover', 'selected', 'locked', 'owned']) {
  const w = 400, h = 440;
  const shades = { normal: '#a99d80', hover: colors.bone, selected: colors.bone, locked: '#514b40', owned: '#968e76' };
  const layers = [{ input: await texturedRing(w, h, 10, 'wood'), left: 0, top: 0 }, { input: await ring(w, h, state === 'selected' ? 4 : 2, shades[state], 2), left: 0, top: 0 }];
  if (state === 'hover') layers.push({ input: await ring(w, h, 2, colors.bone, 10), left: 0, top: 0 });
  if (state === 'selected') layers.push({ input: svg(w, h, `<path d="M352 0H400V48Z" fill="${colors.red}"/><path d="M377 10l9 9-9 9-9-9Z" fill="${colors.bone}"/>`), left: 0, top: 0 });
  if (state === 'locked' || state === 'owned') {
    layers.push({ input: svg(48, 48, rect(0, 0, 48, 48, '#25231e')), left: w - 48, top: 0 });
    layers.push({ input: await fittedGlyph(state === 'locked' ? 'icon-lock' : 'icon-check', 40, 40, 6), left: w - 44, top: 4 });
  }
  await add(`card-frame-${state}`, await blank(w, h).composite(layers).png().toBuffer(), 200, 220, `Transparenter Kartenrahmen ${state}; Füllung und Angebotsinhalt separat. Status sitzt im festen rechten oberen Eck.`, { insets: allInsets(28), contentInsets: allInsets(12), transparentCenter: true, borderWidth: 5 });
}
for (const [name, color] of [['white', '#d9cfb6'], ['blue', '#718b9c'], ['yellow', '#b6a16b']]) await add(`card-rarity-${name}`, await ring(400, 440, 4, color, 14), 200, 220, `Matte ${name}-Innenkante; über dem Kartenrahmen, unter Status/Badge. Kein Leuchten.`, { insets: allInsets(28), transparentCenter: true, overlay: true });
const badgePoints = Array.from({ length: 24 }, (_, i) => { const a = Math.PI * 2 * i / 24 - Math.PI / 2, r = i % 2 ? 37 : 46; return `${48 + Math.cos(a) * r},${48 + Math.sin(a) * r}`; }).join(' ');
const badge = await masked(await surface(96, 96, 'red'), svg(96, 96, `<polygon points="${badgePoints}" fill="white"/>`));
await add('badge-new', await sharp(badge).composite([{ input: svg(96, 96, `<circle cx="48" cy="48" r="29" fill="none" stroke="${colors.bone}" stroke-width="2"/><path d="M48 27l5 15 15 6-15 5-5 16-5-16-15-5 15-6Z" fill="${colors.bone}"/>`) }]).png().toBuffer(), 48, 48, 'Textloses rotes Drucksiegel mit Stern; NEU als zugänglichen UI-Text ergänzen.');

// Exact uppercase stencil lettering, drawn as paths so export does not depend on fonts.
const letters = {
  G: 'M26 0H4L0 4V32L4 36H26V17H14V23H20V30H7V6H26Z',
  E: 'M0 0H26V6H7V14H23V21H7V30H26V36H0Z',
  K: 'M0 0H7V14L18 0H27L13 17L28 36H19L7 21V36H0Z',
  A: 'M0 36L9 0H19L28 36H21L19 27H9L7 36ZM10 21H18L14 7Z',
  U: 'M0 0H7V29H20V0H27V31L22 36H5L0 31Z',
  F: 'M0 0H26V6H7V15H23V22H7V36H0Z',
  T: 'M0 0H28V7H18V36H10V7H0Z',
};
async function stamp(withText) {
  const w = 440, h = 128;
  let shapes = `<path d="M7 7H433V121H7Z" fill="none" stroke="white" stroke-width="5"/><path d="M15 16H425V112H15Z" fill="none" stroke="white" stroke-width="2"/>`;
  if (withText) shapes += [...'GEKAUFT'].map((letter, i) => `<path d="${letters[letter]}" fill="white" fill-rule="evenodd" transform="translate(${27 + i * 56} 29) scale(1.65 1.85)"/>`).join('');
  else shapes += '<path d="M180 61l24 23 51-47" fill="none" stroke="white" stroke-width="12"/>';
  const ink = await raw(await tile(materials.red, w, h)), mask = await raw(svg(w, h, shapes));
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    // Fixed material-derived erosion: repeatable, sparse ink loss inside letters.
    const wear = ink.data[p] > 125 ? 0.25 : ink.data[p] > 105 ? 0.65 : 1;
    ink.data[p] = 166; ink.data[p + 1] = 76; ink.data[p + 2] = 56; ink.data[p + 3] = Math.round(mask.data[p + 3] * wear);
  }
  return sharp(ink.data, { raw: ink.info }).png().toBuffer();
}
await add('stamp-purchased', await stamp(true), 220, 64, 'Temporärer Kaufstempel GEKAUFT; nach bestätigtem Kauf einblenden. Nicht 9-slicen.');
await add('stamp-purchased-blank', await stamp(false), 220, 64, 'Textlose Kaufstempel-Alternative mit Häkchen. Nicht 9-slicen.');
for (const state of ['normal', 'hover', 'disabled']) await add(`button-buy-${state}`, await band(256, 56, state, false, true), 256, 56, `Textloser Kaufen-/Aktionsknopf ${state}; Label und optionales Cart-Icon separat.`, { insets: allInsets(12), contentInsets: { left: 20, top: 12, right: 20, bottom: 12 } });
const close = await band(48, 48, 'normal', false, true);
await add('button-close', await sharp(close).composite([{ input: await fittedGlyph('close', 64, 64, 8), left: 16, top: 16 }]).png().toBuffer(), 48, 48, 'Fester Schließen-Knopf mit X; proportional skalieren.');
for (const key of ['icon-lock', 'icon-check', 'icon-cart', 'icon-search', 'icon-filter', 'category-sensors', 'category-supply', 'category-crafting']) {
  const category = key.startsWith('category-'), size = category ? 64 : 32;
  const descriptions = { 'category-sensors': 'Peilgerät mit Antenne und Rundskala.', 'category-supply': 'Versorgungskiste am Fallschirm.', 'category-crafting': 'Gekreuzter Hammer und Zange.' };
  await add(key, await fittedGlyph(key, size * 2, size * 2, category ? 10 : 6), size, size, descriptions[key] ?? `Freigestelltes ${key.slice(5)}-Drucksymbol; Knochenfarbe, ohne Fläche.`);
}
for (const filled of [false, true]) {
  const shape = filled ? '<path d="M16 2L30 16 16 30 2 16Z" fill="#d9cfb6"/>' : '<path d="M16 3L29 16 16 29 3 16Z" fill="none" stroke="#a99d80" stroke-width="3"/>';
  await add(`pip-${filled ? 'filled' : 'empty'}`, await png(svg(32, 32, shape)), 16, 16, `${filled ? 'Gefüllter' : 'Leerer'} Stufen-Pip; Rautenform, proportional skalieren.`);
}
await add('scrollbar-track', await blank(24, 256, '#12120f').composite([{ input: await texturedRing(24, 256, 2, 'brass') }]).png().toBuffer(), 12, 128, 'Vertikale Schiene; feste Breite, Höhe über 9-Slice anpassen.', { insets: { left: 3, top: 8, right: 3, bottom: 8 } });
await add('scrollbar-thumb', await blank(16, 96).composite([{ input: await surface(16, 96, 'brass') }, { input: svg(16, 96, [40, 48, 56].map(y => rect(4, y, 8, 2, '#30281e')).join('')) }]).png().toBuffer(), 8, 48, 'Vertikaler Griff; mindestens 37px sichtbare Höhe und größere unsichtbare Trefferfläche.', { insets: { left: 2, top: 18, right: 2, bottom: 18 } });
await add('field-search', await blank(640, 96, '#171713').composite([{ input: await texturedRing(640, 96, 4, 'brass') }, { input: await ring(640, 96, 2, '#3d382c', 5) }]).png().toBuffer(), 320, 48, 'Textloses Suchfeld; Lupe links separat, auch als Filterfeld verwendbar.', { insets: allInsets(10), contentInsets: { left: 14, top: 10, right: 14, bottom: 10 } });

// Render true nine-slice geometry for the review montage; never scale whole frames.
async function nineSlice(key, width, height) {
  const spec = registry.get(key);
  if (!spec.insets) return sharp(spec.image).resize(width, height).png().toBuffer();
  const { left: l, top: t, right: r, bottom: b } = spec.insets;
  if (width <= l + r || height <= t + b) throw new Error(`${key}: target smaller than fixed caps`);
  const sx = [0, l * 2, (spec.width - r) * 2], sy = [0, t * 2, (spec.height - b) * 2];
  const sw = [l * 2, (spec.width - l - r) * 2, r * 2], sh = [t * 2, (spec.height - t - b) * 2, b * 2];
  const dx = [0, l, width - r], dy = [0, t, height - b], dw = [l, width - l - r, r], dh = [t, height - t - b, b];
  const layers = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) layers.push({ input: await sharp(spec.image).extract({ left: sx[col], top: sy[row], width: sw[col], height: sh[row] }).resize(dw[col], dh[row], { fit: 'fill' }).png().toBuffer(), left: dx[col], top: dy[row] });
  return blank(width, height).composite(layers).png().toBuffer();
}

const manifest = { version: 1, namespace: 'dawn-merchant', designSpace: { width: 1920, height: 1080 }, masterScale: 2, sharpVersion: sharp.versions.sharp, sources: Object.fromEntries(Object.entries(sources).map(([name, bytes]) => [name, { file: `sources/${name}.png`, sha256: hash(bytes) }])), assets: {} };
for (const spec of registry.values()) {
  await save(new URL(`${spec.key}.png`, assets), spec.image);
  const exports = [];
  for (const scale of [1, 2]) {
    let pixels = await sharp(spec.image).resize(spec.width * scale, spec.height * scale).png().toBuffer();
    if (spec.tile && scale === 1) pixels = await periodic(pixels, spec.tile);
    const file = `${spec.key}@${scale}x.webp`, bytes = await sharp(pixels).webp({ lossless: true, effort: 6 }).toBuffer();
    // Lossless means pixel equality, including alpha (hidden RGB under alpha=0 is irrelevant).
    const expected = await raw(pixels), decoded = await raw(bytes);
    for (let i = 0; i < expected.data.length; i += 4) for (let c = 0; c < 4; c++) {
      if ((c === 3 || expected.data[i + 3] !== 0) && expected.data[i + c] !== decoded.data[i + c]) throw new Error(`${file}: non-lossless encode`);
    }
    await save(new URL(`runtime/${file}`, assets), bytes);
    exports.push({ key: `dawn-merchant/${spec.key}@${scale}x`, file, scale, width: spec.width * scale, height: spec.height * scale, insets: spec.insets ? Object.fromEntries(Object.entries(spec.insets).map(([k, v]) => [k, v * scale])) : null, sha256: hash(bytes) });
  }
  manifest.assets[spec.key] = { key: `dawn-merchant/${spec.key}`, original: `../${spec.key}.png`, originalWidth: spec.width * 2, originalHeight: spec.height * 2, sha256: hash(spec.image), width: spec.width, height: spec.height, insets: spec.insets ?? null, contentInsets: spec.contentInsets ?? null, borderWidth: spec.borderWidth ?? null, tile: spec.tile ?? null, transparentCenter: spec.transparentCenter ?? false, usage: spec.usage, exports };
}
await save(new URL('runtime/manifest.json', assets), JSON.stringify(manifest, null, 2) + '\n');

const readme = `# Dawn Merchant UI-Kit\n\n37 Teile für die Gestaltungsvorgabe Händler-UI V1. Imagegen liefert Materialität, Wald, Eckornament und Glyphen; sharp bereinigt Alpha, schneidet zu und montiert pixelgenaue Zustände. Kein Runtime-Code ist integriert.\n\n## Export\n\n\`node scripts/export-dawn-merchant-ui.mjs\`\n\nAlle PNG-Master liegen hier mit **2× Designauflösung**. Unveränderte Imagegen-Quellen und exakte Prompts liegen in \`sources/\`. Der Export braucht nur diese Quellen, Node und das vorhandene sharp; keine API, keine Fonts, kein Browser. Zweiter Lauf erzeugt dieselben Bytes und schreibt unveränderte Dateien nicht neu. Für bytegleiche Exporte dieselbe sharp/libvips-Version verwenden.\n\n\`runtime/manifest.json\` führt pro logischem Key Designgröße, PNG-Master, SHA-256, Verwendung, Insets und 1×/2×-WebP-Varianten. \`exports[].file\` ist relativ zum Manifest, \`original\` ebenfalls; \`sources.*.file\` ist relativ zu diesem Ordner. Alle WebPs sind verlustfrei; dekodierte Pixel werden bei jedem Export verglichen.\n\n## 9-Slice und Ebenen\n\nInsets unten sind **Designpixel**, Reihenfolge links/oben/rechts/unten. Bei 2×-Texturen verdoppeln; die skalierten Werte stehen zusätzlich je Export im Manifest. Ecken und Statuszeichen bleiben fest, Mittelsegmente skalieren. Die Rahmenbreite ist nicht der Slice-Inset: Fenster 24px sichtbare Schiene, 64px feste Ecken. Mindestens 1px skalierbare Mitte belassen. Griff mindestens 37px hoch, da seine festen Kappen je 18px benötigen.\n\nUnter den transparenten Fenster-/Kartenrahmen \`panel-fill\` kacheln. Dann Inhalte, Raritäts-Innenkante, Rahmenzustand und zuletzt Status/Siegel. Icon-/Textabstände nach \`contentInsets\`; Unterkategorien enthalten bereits 16px transparenten linken Einzug, also nicht doppelt einrücken. \`category-row\` bleibt 56px hoch. Kartenzustände besitzen identische Maße und Insets. Locked dimmt den Rahmen; Icon/Text muss die UI zusätzlich dimmen. Owned enthält ein Häkchen. Selected trägt eine rote Eckmarke. Hover hat eine zusätzliche helle Kontur. Kostenrot und zugängliche Statusnamen werden durch die spätere UI gesetzt.\n\n\`panel-fill\` ist XY-kachelbar, \`header-panorama\` horizontal. Gegenüberliegende Randpixel werden bei beiden Exportgrößen exakt angeglichen. Struktur und Raritäten bleiben matt; Blau/Gelb sind gezielte semantische Innenkanten-Ausnahmen zur sonst roten Akzentpalette. Status nicht ausschließlich über Farbe vermitteln. Keine Labels in den Bildern außer GEKAUFT. Siegel und Pips sind formbasierte Ergänzungen; keine Schriftdateien erforderlich.\n\n## Teile\n\n| Key (Präfix dawn-merchant/) | Designgröße | Insets L/O/R/U | Verwendung |\n|---|---|---|---|\n${[...registry.values()].map(s => `| ${s.key} | ${s.width}×${s.height} | ${s.insets ? [s.insets.left, s.insets.top, s.insets.right, s.insets.bottom].join('/') : '–'} | ${s.usage} |`).join('\n')}\n\n## Prüfbögen\n\n- \`art/poc/dawn/ui/kit/kit-board.png\`: alle Teile einzeln auf Schachbrett sowie zusammengesetztes 16:9-Probe-Layout.\n- \`art/poc/dawn/ui/kit/probe-layout.png\`: Probe-Layout separat bei 1920×1080, Fenster 1690×928 (88%×86%), Text als Balken.\n- \`art/poc/dawn/ui/kit/seam-board.png\`: wiederholte Texturen, 9-Slice-Streckproben und Icons bei 24/32/64px.\n\nDas Probe-Layout montiert ausschließlich Kit-Teile plus bereits vorhandene Dawn-Icons und das vorhandene Händlerporträt. Diese vorhandenen Referenzbilder sind optional und werden nicht neu exportiert. Ohne sie verwendet der Prüfbogen die neuen Platzhalter.\n`;
await save(new URL('README.md', assets), readme);

const layers = [], bars = [];
const put = async (key, x, y, w, h) => layers.push({ input: await nineSlice(key, w, h), left: x, top: y });
const bar = (x, y, w, h = 9, fill = '#a99d80') => bars.push(rect(x, y, w, h, fill));
const paper1 = await sharp(materials.paper).resize(256, 256).png().toBuffer();
layers.push({ input: await tile(paper1, 1690, 928), left: 115, top: 76 });
await put('window-frame', 115, 76, 1690, 928);
// Reference-only images are optional, so the actual kit export is self-contained.
async function reference(relative, fallback, w, h) {
  try { return await sharp(await readFile(new URL(relative, root))).resize(w, h, { fit: 'cover' }).png().toBuffer(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return nineSlice(fallback, w, h); }
}
layers.push({ input: await reference('public/assets/ui/dawn/art/dealer-portrait.png', 'category-crafting', 112, 112), left: 151, top: 110 });
bar(284, 124, 310, 20, colors.bone); bar(322, 170, 157, 13); await put('icon-cart', 282, 164, 28, 28);
await put('header-panorama', 645, 105, 1040, 123); await put('button-close', 1714, 126, 48, 48);
bars.push(rect(149, 239, 1622, 2, '#655640'));
const catKeys = ['category-crafting', 'category-sensors', 'category-supply', 'category-crafting', 'category-sensors', 'category-supply', 'category-crafting', 'category-sensors'];
for (let i = 0; i < 8; i++) {
  const y = 266 + i * 78, sub = i === 1 || i === 2;
  await put(`${sub ? 'subcategory' : 'category'}-row-${i === 0 ? 'active' : i === 3 ? 'hover' : 'normal'}`, 153, y, 292, 56);
  await put(catKeys[i], sub ? 183 : 167, y + 10, 36, 36);
  bar(sub ? 231 : 215, y + 17, sub ? 132 : 148, 9); bar(401, y + 20, 23, 7);
}
await put('scrollbar-track', 454, 265, 12, 665); await put('scrollbar-thumb', 456, 292, 8, 130);
await put('field-search', 492, 266, 430, 48); await put('icon-search', 508, 278, 24, 24); bar(546, 283, 215);
await put('field-search', 934, 266, 224, 48); await put('icon-filter', 951, 278, 24, 24); bar(990, 283, 141);
const states = ['selected', 'hover', 'normal', 'normal', 'owned', 'locked', 'normal', 'normal', 'normal'];
for (let i = 0; i < 9; i++) {
  const x = 492 + (i % 3) * 226, y = 333 + Math.floor(i / 3) * 209, w = 214, h = 197;
  await put(`card-frame-${states[i]}`, x, y, w, h);
  if (i === 1 || i === 4 || i === 7) await put(`card-rarity-${i === 1 ? 'white' : i === 4 ? 'blue' : 'yellow'}`, x, y, w, h);
  const references = ['dealer-infrastructure', 'scrap-magnet', 'dealer-equipment'];
  layers.push({ input: await reference(`public/assets/ui/dawn/${references[i % 3]}.png`, catKeys[i % 8], 106, 106), left: x + 54, top: y + 12 });
  bar(x + 14, y + 124, 158, 9, states[i] === 'locked' ? '#5c584c' : colors.bone); bar(x + 14, y + 141, 122, 7);
  for (let j = 0; j < 4; j++) await put(`pip-${j < (i % 3) + 1 ? 'filled' : 'empty'}`, x + 14 + j * 16, y + 158, 12, 12);
  bar(x + 139, y + 162, 48, 8);
  if (i === 2) await put('badge-new', x + w - 40, y + 4, 36, 36);
}
await put('scrollbar-track', 1175, 333, 12, 617); await put('scrollbar-thumb', 1177, 354, 8, 148);
bars.push(rect(1205, 266, 2, 684, '#655640'));
layers.push({ input: await reference('public/assets/ui/dawn/dealer-infrastructure.png', 'category-sensors', 146, 146), left: 1230, top: 268 });
bar(1396, 280, 338, 20, colors.bone); bar(1396, 317, 252, 10); bar(1396, 345, 164, 8);
for (let i = 0; i < 5; i++) await put(`pip-${i < 2 ? 'filled' : 'empty'}`, 1396 + i * 24, 378, 18, 18);
for (let i = 0; i < 12; i++) bar(1230, 445 + i * 23 + Math.floor(i / 4) * 12, [487, 462, 476, 351][i % 4], 8);
await put('scrollbar-track', 1742, 443, 12, 313); await put('scrollbar-thumb', 1744, 456, 8, 100);
for (let i = 0; i < 3; i++) { await put(i === 2 ? 'icon-lock' : 'icon-check', 1232, 785 + i * 30, 24, 24); bar(1272, 794 + i * 30, [305, 347, 251][i]); }
await put('icon-cart', 1233, 911, 30, 30); bar(1280, 918, 126, 14, colors.bone);
await put('button-buy-normal', 1450, 900, 290, 56); await put('icon-cart', 1468, 912, 30, 30); bar(1522, 923, 174, 10, colors.bone);
layers.push({ input: svg(1920, 1080, bars.join('')), left: 0, top: 0 });
const probe = await blank(1920, 1080, '#10120f').composite(layers).png().toBuffer();
await save(new URL('probe-layout.png', review), probe);

const boardW = 1920, cols = 5, cellWidth = 384, cellHeight = 250, sheetTop = 1160;
const boardH = sheetTop + Math.ceil(registry.size / cols) * cellHeight + 48;
const boardLayers = [{ input: probe, left: 0, top: 64 }], labels = [];
const text = (x, y, content, size = 16, color = colors.bone) => `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" fill="${color}">${content}</text>`;
labels.push(text(24, 38, 'DAWN / MERCHANT UI KIT — 37 PARTS + ASSEMBLED 16:9 LAYOUT', 25));
const checker = svg(32, 32, rect(0, 0, 32, 32, '#34362f') + rect(0, 0, 16, 16, '#292c26') + rect(16, 16, 16, 16, '#292c26'));
for (const [index, spec] of [...registry.values()].entries()) {
  const x = (index % cols) * cellWidth + 12, y = sheetTop + Math.floor(index / cols) * cellHeight;
  boardLayers.push({ input: await tile(checker, 360, 196), left: x, top: y + 36 });
  const factor = Math.min(1, 342 / spec.width, 174 / spec.height), w = Math.max(1, Math.round(spec.width * factor)), h = Math.max(1, Math.round(spec.height * factor));
  boardLayers.push({ input: await sharp(spec.image).resize(w, h).png().toBuffer(), left: x + Math.floor((360 - w) / 2), top: y + 45 + Math.floor((178 - h) / 2) });
  labels.push(text(x + 2, y + 18, spec.key, 17), text(x + 2, y + 249, `${spec.width}x${spec.height} | ${spec.insets ? 'slice ' + Object.values(spec.insets).join('/') : spec.tile ? 'tile ' + spec.tile : 'fixed'}`, 13, '#aca58d'));
}
boardLayers.push({ input: svg(boardW, boardH, labels.join('')), left: 0, top: 0 });
await save(new URL('kit-board.png', review), await blank(boardW, boardH, '#1b1a17').composite(boardLayers).png().toBuffer());

const seamLayers = [], seamLabels = [];
seamLayers.push({ input: await tile(await sharp(registry.get('header-panorama').image).resize(1024, 160).png().toBuffer(), 2048, 160), left: 16, top: 48 });
seamLabels.push(text(16, 30, 'PANORAMA / TWO HORIZONTAL REPEATS', 20));
seamLayers.push({ input: await tile(paper1, 768, 256), left: 16, top: 260 });
seamLabels.push(text(16, 242, 'PANEL FILL / THREE REPEATS', 20));
seamLayers.push({ input: await nineSlice('window-frame', 460, 256), left: 814, top: 260 }, { input: await nineSlice('card-frame-selected', 300, 180), left: 1300, top: 260 }, { input: await nineSlice('button-buy-hover', 420, 56), left: 1630, top: 260 });
seamLabels.push(text(814, 242, '9-SLICE / UNCHANGED CAPS', 20));
const smallKeys = ['icon-lock', 'icon-check', 'icon-cart', 'icon-search', 'icon-filter', 'category-sensors', 'category-supply', 'category-crafting'];
for (const [i, key] of smallKeys.entries()) {
  const x = 16 + i * 254;
  seamLabels.push(text(x, 572, key, 17));
  for (const [j, size] of [24, 32, 64].entries()) seamLayers.push({ input: await nineSlice(key, size, size), left: x + j * 76, top: 594 });
}
seamLayers.push({ input: await nineSlice('stamp-purchased', 220, 64), left: 16, top: 705 }, { input: await nineSlice('stamp-purchased-blank', 220, 64), left: 264, top: 705 });
seamLayers.push({ input: svg(2080, 800, seamLabels.join('')), left: 0, top: 0 });
await save(new URL('seam-board.png', review), await blank(2080, 800, '#24251f').composite(seamLayers).png().toBuffer());
console.log(`Exported ${registry.size} PNG masters, ${registry.size * 2} lossless WebPs, manifest, README and three review boards.`);
