import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { validateClipContracts, validateExtensions } from './contracts-v2.mjs';
import { elevationEncoding } from './elevation-v2.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const markerEntries = clip => Object.entries(clip.markers ?? {}).sort((a, b) => a[1] - b[1]);
export const isBossRuntime = entry => entry.runtimeContract === 'boss';

/** Verify the actual selected/published atlas bytes; never trust declared budgets alone.
 * read(relative) resolves bundle-relative or already published paths at the caller's boundary.
 */
export async function verifyBossRuntime(entry, asset, read) {
  if (!isBossRuntime(entry)) throw new Error('Expected boss runtime contract');
  validateExtensions(entry);
  validateClipContracts(asset.clips);
  if (asset.runtimeContract !== 'boss' || asset.category !== entry.category || asset.runtimeBudgetMB !== entry.runtimeBudgetMB || !same(asset.elevation, entry.elevation)
    || !asset.elevationPass || asset.elevationPass.encoding !== elevationEncoding
    || asset.elevationPass.min !== entry.elevation.min || asset.elevationPass.max !== entry.elevation.max
    || asset.elevationPass.scale !== (entry.elevation.scale ?? .5) || asset.elevationPass.waterline !== 0
    || asset.elevationPass.alpha !== 'beauty-coverage' || asset.elevationPass.colorSpace !== 'non-color'
    || asset.elevationPass.premultiplied !== false) throw new Error('Boss elevation contract mismatch');
  if (asset.clips.length !== entry.clips.length) throw new Error('Boss clips differ from catalog');
  for (const clip of asset.clips) {
    const authored = entry.clips.find(c => c.name === clip.name);
    if (!authored || clip.frames.length !== authored.frameCount || clip.loop !== authored.loop || clip.frameRate !== authored.frameRate
      || !same(markerEntries(clip), markerEntries(authored)) || (clip.end ?? 'rest') !== (authored.end ?? 'rest')
      || clip.start !== authored.start || clip.next !== authored.next) throw new Error('Boss markers or clip contract differ from catalog');
  }
  const groups = [{ name: '__rest', frames: [asset.idleFrame] }, ...asset.clips];
  const totals = { color: 0, elevation: 0, total: 0 }, clips = {}, files = new Set();
  for (const pass of ['color', 'elevation']) {
    const atlases = asset.atlases?.[pass];
    if (!atlases || !same(Object.keys(atlases).sort(), groups.map(c => c.name).sort())) throw new Error('Boss atlases missing clips or rest pose');
    const size = pass === 'color' ? asset.sourceSize : Math.round(asset.sourceSize * (entry.elevation.scale ?? .5));
    for (const clip of groups) {
      const atlas = atlases[clip.name], names = clip.frames.map((_, i) => `${clip.name}/${String(i).padStart(4, '0')}`);
      if (!atlas.pages?.length || !same(atlas.frameNames, names) || !same(atlas.sourceFrames, clip.frames)
        || atlas.sourceSize !== size || atlas.logicalSourceSize !== asset.sourceSize || !same(atlas.pivot, entry.pivot)) throw new Error('Boss atlas frame mapping differs');
      const found = new Set();
      const budget = clips[clip.name] ??= { color: 0, elevation: 0, total: 0 };
      for (const page of atlas.pages) {
        if (files.has(page.image) || files.has(page.json)) throw new Error('Duplicate atlas page');
        files.add(page.image); files.add(page.json);
        const [image, json] = await Promise.all([read(page.image), read(page.json)]);
        if (digest(image) !== page.sha256 || digest(json) !== page.jsonSha256) throw new Error('Boss atlas hash mismatch');
        const info = await sharp(image).metadata(), metadata = JSON.parse(json.toString('utf8'));
        if (!info.hasAlpha || info.width !== page.width || info.height !== page.height || info.width > 4096 || info.height > 4096
          || page.gpuBytesRGBA8 !== info.width * info.height * 4 || metadata.meta?.size?.w !== info.width || metadata.meta?.size?.h !== info.height
          || metadata.meta?.image !== page.image.split('/').at(-1)) throw new Error('Boss atlas dimensions or GPU bytes invalid');
        for (const [name, frame] of Object.entries(metadata.frames)) {
          if (!names.includes(name) || found.has(name)) throw new Error('Boss atlas frame names inconsistent');
          found.add(name);
          const r = frame.frame, s = frame.spriteSourceSize;
          if (![r?.x, r?.y, r?.w, r?.h, s?.x, s?.y, s?.w, s?.h].every(Number.isInteger)
            || r.x < 0 || r.y < 0 || r.w < 1 || r.h < 1 || r.x + r.w > info.width || r.y + r.h > info.height
            || s.x < 0 || s.y < 0 || s.w !== r.w || s.h !== r.h || s.x + s.w > size || s.y + s.h > size
            || frame.sourceSize?.w !== size || frame.sourceSize?.h !== size || frame.pivot?.x !== entry.pivot[0] || frame.pivot?.y !== entry.pivot[1]
            || frame.rotated !== false || frame.trimmed !== (s.w !== size || s.h !== size)
            || frame.sourceFrame !== clip.frames[names.indexOf(name)]) throw new Error('Boss atlas loses logical canvas/pivot');
        }
        budget[pass] += page.gpuBytesRGBA8;
      }
      if (found.size !== names.length) throw new Error('Boss atlas frames missing');
    }
  }
  for (const budget of Object.values(clips)) {
    budget.total = budget.color + budget.elevation;
    for (const key of Object.keys(totals)) totals[key] += budget[key];
  }
  if (!same(Object.keys(asset.budget?.clips ?? {}).sort(), Object.keys(clips).sort())
    || Object.entries(clips).some(([name, values]) => Object.entries(values).some(([pass, bytes]) => asset.budget.clips[name]?.[pass] !== bytes))
    || Object.entries(totals).some(([pass, bytes]) => asset.budget?.totals?.[pass] !== bytes)) throw new Error('Boss budget does not match actual atlas pages');
  if (totals.total > entry.runtimeBudgetMB * 1024 * 1024) throw new Error('Boss runtimeBudgetMB exceeded');
  return { clips, totals };
}
