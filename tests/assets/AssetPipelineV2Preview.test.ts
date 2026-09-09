import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { preview, previewIndices, renderProcess, resolveBlender } from '../../scripts/asset-pipeline/preview-v2.mjs';
import { comparisonSource, safePath } from '../../scripts/asset-pipeline/review-preview-v2.mjs';

const roots: string[] = [];
const save = async (file: string, data: unknown) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
};
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'fd-preview-'));
  roots.push(root);
  const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#aaaaff80' } }).png().toBuffer();
  const image = async (relative: string) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, png);
    return file;
  };
  return { root, image };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(path.join(tmpdir(), 'fd-preview-'))) throw new Error('Unsafe cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

describe('Disposable V2 authoring previews', () => {
  it('samples the first clip, includes idle and validates explicit/all selections', () => {
    const spec = { clips: [{ frameCount: 12, loop: true }, { frameCount: 8, loop: false }] };
    expect(previewIndices(spec)).toEqual([0, 4, 10]);
    expect(previewIndices(spec, 'all')).toHaveLength(21);
    expect(previewIndices(spec, '5,5,19')).toEqual([0, 5, 19]);
    expect(previewIndices({ clips: [] })).toEqual([0]);
    expect(() => previewIndices(spec, '21')).toThrow(/Posen/);
    expect(() => previewIndices(spec, '1,,3')).toThrow(/Posen/);
    expect(previewIndices({ clips: [{ frameCount: 9, loop: false }] })).toEqual([0, 3, 7]);
  });

  it('uses the per-asset imported revision and falls back to its runtime image', async () => {
    const { root, image } = await fixture();
    const spec = { id: 'example', reference: 'reference.png' };
    await image(spec.reference);
    const config = { revision: 'old', assets: [{ id: spec.id, revision: 'new', variant: 'calm', idlePath: './assets/idle.png' }] };
    await save(path.join(root, 'src/config/pipelineAssets.json'), config);
    await image('public/assets/idle.png');
    expect((await comparisonSource(root, spec)).kind).toBe('imported-runtime');
    const base = 'art/poc/pipeline-v2/runs/new/example/calm';
    await image(`${base}/masters/frame-0000.png`);
    await save(path.join(root, base, 'render.json'), { idleFrame: 0, frames: [{ index: 0, file: 'masters/frame-0000.png' }] });
    expect(await comparisonSource(root, spec)).toMatchObject({ kind: 'imported-master', path: `${base}/masters/frame-0000.png` });
    expect((await comparisonSource(root, spec, spec.reference)).kind).toBe('explicit');
  });

  it('uses catalog transforms only for a catalog reference and handles missing references', async () => {
    const { root, image } = await fixture();
    const spec = { id: 'example', reference: 'reference.png', referenceTransform: { rotationOffset: Math.PI } };
    expect((await comparisonSource(root, spec)).kind).toBe('missing');
    await image(spec.reference);
    expect(await comparisonSource(root, spec)).toMatchObject({ kind: 'catalog', transform: spec.referenceTransform });
    expect(await comparisonSource(root, spec, spec.reference)).not.toHaveProperty('transform');
  });

  it('regenerates old preview manifests without Blender and preserves production files', async () => {
    const { root, image } = await fixture();
    const folder = 'art/poc/pipeline-v2/previews/test/example';
    const manifest = { status: 'authoring-preview', id: 'example', variant: 'rich', indices: [0, 2], spec: { id: 'example', label: 'A & B', targetSize: 32, clips: [{ name: 'move', frameCount: 4, loop: true }] } };
    await save(path.join(root, folder, 'preview.json'), manifest);
    for (const index of manifest.indices) await image(`${folder}/frame-${String(index).padStart(4, '0')}.png`);
    await image('public/assets/sprites/gras_bg_tile.png');
    await image('public/assets/sprites/train/train_material_dark_top.png');
    const sentinel = path.join(root, 'src/config/pipelineAssets.json');
    await save(sentinel, { revision: 'keep', assets: [] });
    const before = await readFile(sentinel);
    // No catalog or Blender exists in this fixture: --review must bypass both.
    await preview(['--review', folder], root);
    const first = await readFile(path.join(root, folder, 'comparison.png'));
    await preview(['--review', folder], root);
    expect(await readFile(path.join(root, folder, 'comparison.png'))).toEqual(first);
    expect((await sharp(path.join(root, folder, 'scale.png')).metadata()).width).toBeGreaterThan(0);
    expect(await readFile(sentinel)).toEqual(before);
    expect(JSON.parse(await readFile(path.join(root, folder, 'preview.json'), 'utf8'))).toMatchObject({ comparison: { kind: 'missing' }, poses: [{ index: 0, clip: 'idle' }, { index: 2, clip: 'move', phase: .25 }] });
  });

  it('rejects traversal, production outputs and redirected preview directories', async () => {
    const { root } = await fixture();
    await expect(safePath(root, '../outside')).rejects.toThrow(/Unsafe/);
    await expect(preview(['--review', 'art/poc/pipeline-v2/runs/released/example'], root)).rejects.toThrow(/Unsafe/);
    const target = path.join(root, 'production');
    const link = path.join(root, 'redirect');
    await mkdir(target);
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    try { await expect(safePath(root, 'redirect/new.png')).rejects.toThrow(/symlink/); }
    finally { await rm(link); }
  });

  it('resolves explicit Blender before the environment and reports missing installation clearly', async () => {
    const { root } = await fixture();
    const explicit = path.join(root, 'explicit.exe'), environment = path.join(root, 'env.exe');
    await writeFile(explicit, ''); await writeFile(environment, '');
    expect(await resolveBlender(explicit, { BLENDER_PATH: environment })).toBe(explicit);
    expect(await resolveBlender(undefined, { BLENDER_PATH: environment })).toBe(environment);
    await expect(resolveBlender(undefined, { PATH: '' })).rejects.toThrow(/--blender/);
  });

  it('keeps full process output in a log and forwards a short failure with the exit status', async () => {
    const { root } = await fixture();
    const log = path.join(root, 'blender.log');
    await expect(renderProcess(process.execPath, ['-e', 'console.log("verbose\\n".repeat(30)); console.error("Render failed: fixture"); process.exit(7)'], log, root)).rejects.toThrow(/Exit 7[\s\S]*Render failed: fixture[\s\S]*Log:/);
    expect((await readFile(log, 'utf8')).split('\n').length).toBeGreaterThan(30);
  });
});
