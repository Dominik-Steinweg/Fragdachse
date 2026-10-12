import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { packAtlas } from './atlas-v2.mjs';
import { resizeMaster } from './export.mjs';

const revision = process.argv[2];
if (!/^kraken-v\d+[a-z]?$/.test(revision ?? '')) throw Error('Supply a production Kraken revision');
const selectedId = process.argv[3];
if (selectedId && !['abyssal-kraken', 'abyssal-kraken-land', 'abyssal-kraken-tentacle', 'abyssal-kraken-egg'].includes(selectedId)) throw Error('Unknown Kraken review asset');
const root = path.resolve('art/poc/pipeline-v2/runs', revision), assets = [];
const sha = b => createHash('sha256').update(b).digest('hex');
for (const [role, id, clips] of [
  ['water', 'abyssal-kraken', ['idle', 'move', 'ink-spit', 'egg-throw', 'intro-rise']],
  ['land', 'abyssal-kraken-land', ['idle', 'move', 'slam']],
  ['tentacle', 'abyssal-kraken-tentacle', ['rise', 'hover', 'slam', 'retract']],
  ['egg', 'abyssal-kraken-egg', ['idle', 'hatch']],
]) {
  if (selectedId && id !== selectedId) continue;
  if (!selectedId && !await fs.access(path.join(root, id)).then(() => true, () => false)) continue;
  const folder = path.join(root, id, 'standard'), e = JSON.parse(await fs.readFile(path.join(folder, 'export.json'), 'utf8'));
  const m = e.manifest, size = Math.round(m.targetSize * (m.displayScale ?? 1)), material = e.materialPass;
  const asset = { id, role, size, canvasWorld: size, worldPxPerBU: material.worldPxPerBU, pivot: m.pivot,
    encoding: material.normal, colorPass: material.color, emissionEncoding: material.emission,
    emissionRange: material.emissionRange, tint: material.tint, saturation: material.saturation,
    heightRange: [m.elevation.min, m.elevation.max], exposureCalibration: { suggested: material.exposure }, poses: [] };
  for (const name of clips) {
    const clip = m.clips.find(c => c.name === name);
    const indices = [...new Set([0, Math.floor(clip.frames.length / 2), clip.frames.length - 1, ...Object.values(clip.markers ?? {})])];
    for (const index of indices) {
      const sourceFrame = clip.frames[index], poseName = `${name}-${index}`, frameName = `${name}/${String(index).padStart(4, '0')}`;
      const passes = {};
      for (const pass of ['color', 'elevation', 'emission']) {
        const page = e.atlases[size][pass][name].pages.find(p => p.frameNames.includes(frameName));
        passes[pass] = { ...page, gpuBytes: page.gpuBytesRGBA8 };
      }
      const beauty = await resizeMaster(path.join(folder, m.frames[sourceFrame].file), size);
      const [page] = await packAtlas([beauty], { frameNames: [frameName], sourceFrames: [sourceFrame], size, pivot: m.pivot, prefix: `review/${poseName}-beauty` });
      await fs.mkdir(path.join(folder, 'review'), { recursive: true });
      const json = JSON.stringify(page.metadata, null, 2) + '\n';
      await fs.writeFile(path.join(folder, page.image), page.png); await fs.writeFile(path.join(folder, page.json), json);
      passes.beauty = { image: page.image, json: page.json, sha256: sha(page.png), jsonSha256: sha(json),
        width: page.width, height: page.height, gpuBytes: page.gpuBytesRGBA8, frameNames: [frameName] };
      asset.poses.push({ name: poseName, frameName, sourceFrame, mesh: m.shadowMesh.frames[sourceFrame], passes,
        gpuBytes: ['color', 'elevation', 'emission'].reduce((sum, pass) => sum + passes[pass].gpuBytes, 0) });
    }
  }
  assets.push(asset);
}
await fs.writeFile(path.join(root, 'ls-pilot.json'), JSON.stringify({ version: 1, revision, assets }, null, 2) + '\n');
console.log(JSON.stringify(assets.map(a => ({ asset: a.id, reviewPoses: a.poses.length }))));
