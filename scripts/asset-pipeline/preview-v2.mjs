// Disposable authoring only: production build/select/archive/import stay separate.
import { spawn } from 'node:child_process';
import { open, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { reviewPreview, safePath } from './review-preview-v2.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const identifier = value => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value ?? '')) throw new Error('Asset/Label: Kleinbuchstaben, Zahlen und Bindestriche verwenden.');
  return value;
};

export function previewIndices(spec, selection) {
  const clips = spec.clips ?? [];
  if (clips.some(c => !Number.isInteger(c.frameCount) || c.frameCount < 1)) throw new Error('Ungültige Clip-Länge.');
  const count = 1 + clips.reduce((n, c) => n + c.frameCount, 0);
  const first = clips[0];
  const indices = selection === 'all' ? Array.from({ length: count }, (_, i) => i)
    : selection === undefined ? (first ? [0, ...[.25, .75].map(p => 1 + Math.min(first.frameCount - 1, Math.round(p * (first.loop ? first.frameCount : first.frameCount - 1))))] : [0])
    : /^\d+(,\d+)*$/.test(selection) ? selection.split(',').map(Number) : [];
  if (!indices.length || indices.some(i => i < 0 || i >= count)) throw new Error(`Ungültige Posen; erlaubt: 0–${count - 1} oder all.`);
  // Idle is needed for comparison even when the explicit selection omits it.
  return [...new Set([0, ...indices])];
}

export async function resolveBlender(explicit, env = process.env) {
  const configured = explicit || env.BLENDER_PATH;
  const executable = process.platform === 'win32' ? 'blender.exe' : 'blender';
  const candidates = configured ? [path.resolve(configured)] : (env.PATH ?? '').split(path.delimiter).filter(Boolean).map(p => path.join(p.replace(/^"|"$/g, ''), executable));
  for (const candidate of candidates) if (await access(candidate).then(() => true, () => false)) return candidate;
  throw new Error('Blender nicht gefunden. Aufruf: npm run assets:preview -- <id> --blender "<Pfad zur Blender-Programmdatei>" (alternativ BLENDER_PATH oder PATH).');
}

export async function renderProcess(executable, args, log, cwd) {
  const handle = await open(log, 'wx');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ['ignore', handle.fd, handle.fd] });
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`Blender fehlgeschlagen (Exit ${code ?? signal}).`)));
    });
  } catch (error) {
    const tail = (await readFile(log, 'utf8')).trim().split(/\r?\n/).filter(Boolean).slice(-12).join('\n');
    throw new Error(`${error.message}\n${tail}\nLog: ${log}`);
  } finally { await handle.close(); }
}

export async function preview(argv, root = repoRoot) {
  const { values: args, positionals } = parseArgs({ args: argv, allowPositionals: true, options: Object.fromEntries(
    ['blender', 'label', 'variant', 'indices', 'device', 'patch', 'compare', 'review'].map(k => [k, { type: 'string' }]).concat([['help', { type: 'boolean' }]])) });
  if (args.help) {
    console.log('npm run assets:preview -- <id> [--variant calm|rich] [--indices 0,4,10|all] [--label name] [--device AUTO|OPTIX|CUDA|CPU] [--blender path] [--patch path] [--compare image]\nOhne Blender erneut auswerten: npm run assets:preview -- --review <Vorschauordner> [--compare image]');
    return;
  }
  if (args.review) {
    if (positionals.length || Object.keys(args).some(k => !['review', 'compare'].includes(k))) throw new Error('--review nur mit --compare kombinieren.');
    return reviewPreview(path.resolve(root, args.review), { root, compare: args.compare });
  }
  if (positionals.length !== 1) throw new Error('Eine Asset-ID angeben; siehe --help.');
  const id = identifier(positionals[0]);
  const catalog = JSON.parse(await readFile(path.join(root, 'scripts/asset-pipeline/catalog-v2.json'), 'utf8'));
  let spec = catalog.assets.find(a => a.id === id);
  if (!spec || spec.production === 'planned') throw new Error(`Keine ausführbare Rezeptur: ${id}`);
  let patch;
  if (args.patch) {
    patch = path.resolve(root, args.patch);
    const parsed = JSON.parse((await readFile(patch, 'utf8')).replace(/^\uFEFF/, ''));
    const updates = parsed.assets ?? parsed;
    const update = Array.isArray(updates) ? updates.find(a => a.id === id) : updates[id];
    if (!update) throw new Error(`Patch enthält ${id} nicht.`);
    if (update.id && update.id !== id) throw new Error('Patch darf die Asset-ID nicht ändern.');
    spec = { ...spec, ...update };
  }
  const indices = previewIndices(spec, args.indices);
  const variant = args.variant ?? 'rich', device = args.device ?? 'AUTO';
  if (!['calm', 'rich'].includes(variant) || !['AUTO', 'CPU', 'CUDA', 'OPTIX'].includes(device)) throw new Error('Ungültige Variante oder Gerät; siehe --help.');
  const label = identifier(args.label ?? `preview-${new Date().toISOString().replace(/[^0-9]/g, '')}-${randomUUID().slice(0, 8)}`);
  const previews = await safePath(root, 'art/poc/pipeline-v2/previews');
  const folder = await safePath(previews, `${label}/${id}`);
  if (await access(path.dirname(folder)).then(() => true, () => false)) throw new Error('Preview-Label existiert bereits; neues Label verwenden.');
  const blender = await resolveBlender(args.blender);
  await mkdir(path.dirname(folder), { recursive: true });
  const log = path.join(path.dirname(folder), 'blender.log');
  const started = Date.now();
  await renderProcess(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python',
    path.join(root, 'scripts/asset-pipeline/preview-v2.py'), '--', '--repo', root, '--asset', id, '--label', label,
    '--variant', variant, '--indices', indices.join(','), '--device', device, ...(patch ? ['--patch', patch] : [])], log, root);
  const manifestFile = path.join(folder, 'preview.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.durationSeconds = Math.round((Date.now() - started) / 100) / 10;
  manifest.log = path.relative(root, log).replaceAll('\\', '/');
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return reviewPreview(folder, { root, compare: args.compare });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  preview(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
