// Regenerable static review sheets; never write into production runs or runtime assets.
import sharp from 'sharp';
import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const exists = async file => { try { return (await stat(file)).isFile(); } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const inside = (root, file) => { const relative = path.relative(root, file); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); };

export async function safePath(root, relative) {
  const base = path.resolve(root), file = path.resolve(base, relative);
  if (!inside(base, file)) throw new Error(`Unsafe path: ${relative}`);
  // Resolve existing ancestors as well, so a symlink cannot redirect an output.
  async function physical(value) {
    try { return await realpath(value); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return path.join(await physical(path.dirname(value)), path.basename(value));
    }
  }
  if (path.join(await physical(base), path.relative(base, file)) !== await physical(file)) throw new Error(`Unsafe symlink path: ${relative}`);
  return file;
}

export async function comparisonSource(root, spec, override) {
  const describe = async (file, kind, label, transform) => {
    const { width, height } = await sharp(file).metadata();
    return { path: path.relative(root, file).replaceAll('\\', '/'), kind, label, width, height, ...(transform ? { transform } : {}) };
  };
  if (override) return describe(path.resolve(root, override), 'explicit', 'Eigener Vergleich');
  const runtimePath = path.join(root, 'src/config/pipelineAssets.json');
  const runtime = await exists(runtimePath) ? await json(runtimePath) : null;
  const imported = runtime?.assets.find(a => a.id === spec.id);
  if (imported) {
    const revision = imported.revision ?? runtime.revision;
    const variant = imported.variant;
    const base = await safePath(root, `art/poc/pipeline-v2/runs/${revision}/${spec.id}/${variant}`);
    const manifestPath = path.join(base, 'render.json');
    if (await exists(manifestPath)) {
      const m = await json(manifestPath);
      const idle = m.frames.find(f => f.index === m.idleFrame);
      if (idle) {
        const master = await safePath(base, idle.file);
        if (await exists(master)) return describe(master, 'imported-master', `${revision} / ${variant} · Master`);
      }
    }
    const file = await safePath(path.join(root, 'public'), imported.idlePath);
    if (await exists(file)) return describe(file, 'imported-runtime', `${revision} / ${variant} · Runtime, geringere Quellauflösung`);
    return { kind: 'missing', label: 'Importierter Vergleich fehlt lokal' };
  }
  if (spec.reference) {
    const file = await safePath(root, spec.reference);
    if (await exists(file)) return describe(file, 'catalog', 'Katalogreferenz', spec.referenceTransform);
  }
  return { kind: 'missing', label: 'Kein Vergleich vorhanden' };
}

const text = (x, y, value, size = 13, color = '#dce5df') => `<text x="${x}" y="${y}" fill="${color}" font-family="Arial" font-size="${size}">${escape(value)}</text>`;
const canvas = (w, h, content) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#27343b"/>${content}</svg>`);
async function sprite(file, size, angle = 0) {
  return sharp(file).resize(size, size).rotate(angle, { background: '#00000000' }).png().toBuffer();
}
async function centered(layers, input, x, y) {
  const { width, height } = await sharp(input).metadata();
  layers.push({ input, left: Math.round(x - width / 2), top: Math.round(y - height / 2) });
}

export async function reviewPreview(folder, { root = defaultRoot, compare } = {}) {
  const previews = await safePath(root, 'art/poc/pipeline-v2/previews');
  folder = await safePath(previews, path.relative(previews, folder));
  const manifestFile = await safePath(folder, 'preview.json');
  const m = await json(manifestFile);
  if (m.status !== 'authoring-preview' || !m.indices?.length || m.indices.some(i => !Number.isInteger(i) || i < 0)) throw new Error('Ungültiges Vorschau-Manifest.');
  const size = m.spec.targetSize;
  if (!Number.isInteger(size) || size < 1 || size > 128) throw new Error('Ungültige Nominalgröße.');
  const source = await comparisonSource(root, m.spec, compare);
  const frame = async index => safePath(folder, `frame-${String(index).padStart(4, '0')}.png`);
  const idle = await frame(0);
  const hasIdle = await exists(idle);
  const poses = m.poses ?? m.indices.map(index => {
    let offset = 1;
    for (const clip of m.spec.clips ?? []) {
      if (index >= offset && index < offset + clip.frameCount) return { index, clip: clip.name, phase: (index - offset) / (clip.loop ? clip.frameCount : Math.max(1, clip.frameCount - 1)) };
      offset += clip.frameCount;
    }
    return { index, clip: index === 0 ? 'idle' : 'Pose' };
  });
  const poseLabel = index => {
    const p = poses.find(p => p.index === index);
    return `${p?.clip ?? 'Pose'}${p?.clip !== 'idle' && p?.phase !== undefined ? ` ${Math.round(p.phase * 100)}%` : ''} · Frame ${index}`;
  };
  let rock;
  if (m.spec.category === 'turret') rock = await sharp(path.join(root, 'public/assets/sprites/rocks47blob.png')).extract({ left: 96, top: 96, width: 32, height: 32 }).png().toBuffer();
  const motions = m.indices.filter(i => i !== 0), columns = 4, width = 800;
  const height = 382 + Math.ceil(motions.length / columns) * 225;
  let svg = text(20, 28, `${m.spec.label} · ${m.variant} · Authoring-Vorschau`, 19)
    + text(20, 51, `Vergrößert und ${size} px Spielgröße · statische Posen, keine Bewegungsabnahme`)
    + text(30, 80, 'Bisher: ' + source.label, 12) + text(430, 80, 'Neu: idle', 12);
  const layers = [];
  async function add(file, x, y, transform) {
    for (const [display, cy] of [[220, y], [size, y + 146]]) {
      const angle = (transform?.rotationOffset ?? 0) * 180 / Math.PI;
      const ratio = display / size;
      if (rock) await centered(layers, display === size ? rock : await sharp(rock).resize(Math.round(32 * ratio)).png().toBuffer(), x, cy);
      await centered(layers, await sprite(file, display, angle), x + (transform?.centerCorrectionX ?? 0) * ratio, cy + (transform?.centerCorrectionY ?? 0) * ratio);
    }
  }
  if (source.path) await add(path.resolve(root, source.path), 200, 204, source.transform);
  if (hasIdle) await add(idle, 600, 204);
  else svg += text(430, 204, 'Idle fehlt in dieser alten Vorschau.');
  for (let i = 0; i < motions.length; i++) {
    const x = 100 + i % columns * 200, y = 400 + Math.floor(i / columns) * 225;
    svg += text(x - 85, y, poseLabel(motions[i]), 12);
    await centered(layers, await sprite(await frame(motions[i]), 148), x, y + 83);
    if (rock) await centered(layers, rock, x, y + 186);
    await centered(layers, await sprite(await frame(motions[i]), size), x, y + 186);
  }
  const comparisonFile = await safePath(folder, 'comparison.png');
  await sharp(canvas(width, height, svg)).composite(layers).png().toFile(comparisonFile);

  // Real viewer textures at their native tiling scale; stationary rock under rotated turrets.
  const backgrounds = [['Hell', '#d5d9d5'], ['Dunkel', '#131a21'], ['Gras', 'public/assets/sprites/gras_bg_tile.png'], ['Stahl', 'public/assets/sprites/train/train_material_dark_top.png']];
  let scaleSvg = text(20, 28, `${m.spec.label} · ${size} px · ${m.variant}`, 19)
    + text(20, 51, `0° / 45° / 90° · Originalpixel ohne Hochskalierung${rock ? ' · Fels 32 px' : ''}`);
  const scaleLayers = [];
  const rowHeight = Math.max(100, Math.ceil(size * Math.SQRT2) + 20);
  for (let i = 0; i < backgrounds.length; i++) {
    const [name, bg] = backgrounds[i], y = 82 + i * rowHeight;
    scaleSvg += text(20, y + rowHeight / 2, name);
    for (let j = 0; j < 3; j++) {
      const left = 130 + j * 210, top = y, w = 196, h = rowHeight - 8;
      let background;
      if (bg.startsWith('#')) background = await sharp({ create: { width: w, height: h, channels: 4, background: bg } }).png().toBuffer();
      else {
        const file = path.join(root, bg);
        const metadata = await sharp(file).metadata();
        const tile = await sharp(file).extract({ left: 0, top: 0, width: Math.min(w, metadata.width), height: Math.min(h, metadata.height) }).png().toBuffer();
        background = await sharp({ create: { width: w, height: h, channels: 4, background: '#27343b' } }).composite([{ input: tile, tile: true }]).png().toBuffer();
      }
      scaleLayers.push({ input: background, left, top });
      if (rock) await centered(scaleLayers, rock, left + w / 2, top + h / 2);
      if (hasIdle) await centered(scaleLayers, await sprite(idle, size, j * 45), left + w / 2, top + h / 2);
    }
  }
  if (!hasIdle) scaleSvg += text(20, 72, 'Idle fehlt: leere Vergleichsfelder.');
  const scaleFile = await safePath(folder, 'scale.png');
  await sharp(canvas(800, 90 + 4 * rowHeight, scaleSvg)).composite(scaleLayers).png().toFile(scaleFile);
  m.poses = poses;
  m.comparison = source;
  await writeFile(manifestFile, JSON.stringify(m, null, 2) + '\n');
  console.log(`Vorschau OK: ${m.id} / ${m.variant} · ${m.indices.length} Posen · ${m.durationSeconds ?? '?'} s · ${m.device ?? 'Gerät unbekannt'}\nTechnik: Render vorhanden; Ästhetik und Bewegung separat prüfen.\n${comparisonFile}\n${scaleFile}`);
  return { comparisonFile, scaleFile, source };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  reviewPreview(path.resolve(process.argv[2] || '')).catch(error => { console.error(error.message); process.exitCode = 1; });
}
