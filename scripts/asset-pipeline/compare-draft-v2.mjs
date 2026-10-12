// Matched clip-local frame comparison; no source renders are modified.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { repoRoot, resizeMaster } from './export.mjs';
import { digest } from './draft-v2.mjs';

export async function compareDraft(argv, root = repoRoot) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    label: { type: 'string' }, run: { type: 'string', default: 'kraken-v13' }, clip: { type: 'string', default: '__rest' }, frame: { type: 'string', default: '0' },
  } });
  const id = positionals[0];
  if (positionals.length !== 1 || [id, values.run, ...(values.label ? [values.label] : [])].some(s => !/^[a-z0-9][a-z0-9-]*$/.test(s))) throw Error('Asset, run and label identifiers required');
  if (values.clip !== '__rest' && !/^[a-z0-9][a-z0-9-]*$/.test(values.clip)) throw Error('Invalid clip');
  const index = Number(values.frame);
  if (!Number.isInteger(index) || index < 0) throw Error('Invalid clip frame');
  const json = async file => JSON.parse(await readFile(file, 'utf8'));
  const base = path.join(root, 'art/poc/pipeline-v2/drafts');
  const label = values.label ?? (await json(path.join(base, id, 'latest.json'))).label;
  const draft = path.join(base, id, label), production = path.join(root, 'art/poc/pipeline-v2/runs', values.run, id, 'standard');
  const [record, manifest] = await Promise.all([json(path.join(draft, 'draft.json')), json(path.join(production, 'render.json'))]);
  const draftFile = record.records[values.clip]?.frames[index]?.beauty;
  const frame = values.clip === '__rest' && index === 0 ? manifest.idleFrame : manifest.clips.find(c => c.name === values.clip)?.frames[index];
  const productionFile = manifest.frames[frame]?.file;
  if (!draftFile || !productionFile) throw Error('Clip-local frame missing in one source');
  const files = [path.join(draft, 'standard', draftFile), path.join(production, productionFile)];
  const bytes = await Promise.all(files.map(file => readFile(file)));
  const size = Math.round(manifest.targetSize * (manifest.displayScale ?? 1));
  const images = await Promise.all(bytes.map(buffer => resizeMaster(buffer, size)));
  const width = size * 2 + 48, height = size + 72;
  const header = Buffer.from(`<svg width="${width}" height="${height}"><style>text{font:14px sans-serif;fill:white}</style><text x="16" y="24">Draft: ${label}</text><text x="${size + 32}" y="24">Production: ${values.run}</text><text x="16" y="${height - 12}">${id} / ${values.clip} / ${index} — same canvas ${size}px</text></svg>`);
  const out = path.join(base, 'compare', `${id}-${values.clip.replace('__', '')}-${index}.png`);
  await mkdir(path.dirname(out), { recursive: true });
  await sharp({ create: { width, height, channels: 4, background: '#34404b' } })
    .composite([{ input: images[0], left: 16, top: 36 }, { input: images[1], left: size + 32, top: 36 }, { input: header }]).png().toFile(out);
  await writeFile(out.replace(/\.png$/, '.json'), JSON.stringify({ id, label, run: values.run, clip: values.clip, clipFrame: index,
    productionSourceFrame: frame, sources: files.map((file, i) => ({ file: path.relative(root, file).replaceAll('\\', '/'), sha256: digest(bytes[i]) })) }, null, 2) + '\n');
  console.log(out); return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  compareDraft(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
}
