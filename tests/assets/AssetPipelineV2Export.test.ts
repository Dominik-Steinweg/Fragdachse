import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { archiveManifestV2, exportRunV2, exportVariantV2, selectVariantV2, sheetLayout, validateManifestV2, verifySelectionV2 } from '../../scripts/asset-pipeline/export-v2.mjs';
import { prepareReviewV2 } from '../../scripts/asset-pipeline/prepare-review-v2.mjs';

const roots: string[] = [];
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const save = async (file: string, data: unknown) => writeFile(file, JSON.stringify(data, null, 2) + '\n');
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep + 'fd-asset-v2-')) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

async function frame(color: string) {
  const center = await sharp({ create: { width: 32, height: 32, channels: 4, background: color } }).png().toBuffer();
  return sharp({ create: { width: 64, height: 64, channels: 4, background: '#00000000' } })
    .composite([{ input: center, left: 16, top: 16 }]).png().toBuffer();
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'fd-asset-v2-')); roots.push(root);
  const run = path.join(root, 'art/poc/pipeline-v2/runs/reference-test');
  const asset = path.join(run, 'fixture');
  const frames = await Promise.all(['#ef3010', '#25bb55', '#3355dd', '#ddaa22'].map(frame));
  const source = 'def build(context, spec):\n    return {}\n';
  const files = { 'scripts/asset-pipeline/recipes/fixture.py': Buffer.from(source), 'art/poc/pipeline-v2/textures/organic.png': frames[0] };
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(asset, 'archive-source', name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  await save(path.join(asset, 'build.json'), { status: 'complete', inputHash: hash('resolved fixture') });
  for (const variant of ['calm', 'rich']) {
    const folder = path.join(asset, variant);
    await mkdir(path.join(folder, 'masters'), { recursive: true });
    const manifest = {
      pipelineVersion: 2, id: 'fixture', label: 'Fixture', revision: 'reference-test', category: 'character', variant,
      targetSize: 16, sourceSizes: [32], masterSize: 64, pivot: [.5, .5], forward: 'north',
      camera: { type: 'ORTHO', rotation: [0, 0, 0], location: [0, 0, 8], orthoScale: 2, transparent: true },
      sources: { 'scripts/asset-pipeline/recipes/fixture.py': hash(source) },
      textures: { organic: { path: 'art/poc/pipeline-v2/textures/organic.png', sha256: hash(frames[0]) } },
      idleFrame: 0,
      frames: frames.map((data, index) => ({ index, file: `masters/frame-${String(index).padStart(4, '0')}.png`, blenderFrame: index + 1, sha256: hash(data), bounds: [16, 16, 47, 47] })),
      clips: [{ name: 'move', motion: 'biped-walk', frameRate: 12, loop: true, frames: [1, 2, 3] }],
    };
    await save(path.join(folder, 'render.json'), manifest);
    await writeFile(path.join(folder, 'asset.blend'), 'Packed Blender fixture');
    for (const f of manifest.frames) await writeFile(path.join(folder, f.file), frames[f.index]);
  }
  const folder = path.join(asset, 'calm');
  const manifest = JSON.parse(await readFile(path.join(folder, 'render.json'), 'utf8'));
  return { root, run, asset, folder, manifest, frames };
}

describe('V2 animated asset export contracts', () => {
  it('requires evaluated support evidence for every frame of a mounted turret', async () => {
    const { manifest } = await fixture();
    const m = { ...manifest, category: 'turret', forward: 'east', mount: { rockSize: 32, maxBaseDiameter: 27 },
      frames: manifest.frames.map(frame => ({ ...frame, baseDiameter: 25 })),
      clips: [{ ...manifest.clips[0], name: 'fire', motion: 'mechanical_fire', loop: false }] };
    expect(() => validateManifestV2(m)).not.toThrow();
    expect(() => validateManifestV2({ ...m, frames: m.frames.map((frame, i) => i === 2 ? { ...frame, baseDiameter: 28 } : frame) })).toThrow(/footprint/);
    expect(() => validateManifestV2({ ...m, frames: manifest.frames })).toThrow(/footprint/);
    expect(() => validateManifestV2({ ...m, mount: { rockSize: 32, maxBaseDiameter: 32 } })).toThrow(/32-pixel rock/);
  });

  it('validates frame indices, clip references, required behavior and source provenance', async () => {
    const { manifest: m } = await fixture();
    expect(() => validateManifestV2(m)).not.toThrow();
    expect(() => validateManifestV2({ ...m, idleFrame: 1 })).toThrow(/idleFrame/);
    expect(() => validateManifestV2({ ...m, frames: [{ ...m.frames[0], index: 2 }, ...m.frames.slice(1)] })).toThrow(/frame/);
    expect(() => validateManifestV2({ ...m, clips: [{ ...m.clips[0], frames: [99] }] })).toThrow(/clip/);
    expect(() => validateManifestV2({ ...m, clips: [{ ...m.clips[0], loop: false }] })).toThrow(/loop/);
    expect(() => validateManifestV2({ ...m, clips: [{ ...m.clips[0], name: 'fire' }] })).toThrow(/move/);
    expect(() => validateManifestV2({ ...m, sources: { '../outside.py': hash('outside') } })).toThrow(/path/);
    expect(() => validateManifestV2({ ...m, clips: [m.clips[0], m.clips[0]] })).toThrow(/clip/);
  });

  it('packs untrimmed frames with transparent gutters and exports the true idle frame', async () => {
    const f = await fixture();
    const exported = await exportVariantV2(f.folder, f.root);
    expect(sheetLayout(32, 9)).toMatchObject({ columns: 8, rows: 2, width: 288, height: 72, margin: 2, spacing: 4 });
    expect(exported.sheets[32]).toMatchObject({ width: 144, height: 36, frameWidth: 32, frameHeight: 32, frameCount: 4 });
    const sheet = await readFile(path.join(f.folder, 'sheet-32.png'));
    const { data, info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
    expect(pixel(18, 18)).toEqual([239, 48, 16, 255]);
    expect(pixel(54, 18)).toEqual([37, 187, 85, 255]);
    for (const x of [0, 1, 34, 35, 36, 37, 142, 143]) expect(pixel(x, 18)[3]).toBe(0);
    expect(exported.outputs['sheet-32.png']).toBe(hash(sheet));
    const idle = await readFile(path.join(f.folder, 'sprite-32.png'));
    expect(await sharp(idle).metadata()).toMatchObject({ width: 32, height: 32 });
    expect(exported.outputs['sprite-32.png']).toBe(hash(idle));
    const report = await readFile(path.join(f.folder, 'export.json'));
    await exportVariantV2(f.folder, f.root);
    expect(await readFile(path.join(f.folder, 'export.json'))).toEqual(report);
    expect(await readFile(path.join(f.folder, 'sheet-32.png'))).toEqual(sheet);
  });

  it('rejects incomplete builds, changed masters, packed source or archived input', async () => {
    const f = await fixture();
    await save(path.join(f.asset, 'build.json'), { status: 'rendering', inputHash: hash('resolved fixture') });
    await expect(exportVariantV2(f.folder, f.root)).rejects.toThrow(/incomplete/);
    await save(path.join(f.asset, 'build.json'), { status: 'complete', inputHash: hash('resolved fixture') });
    await exportVariantV2(f.folder, f.root);
    await writeFile(path.join(f.folder, 'masters/frame-0002.png'), f.frames[0]);
    await expect(exportVariantV2(f.folder, f.root)).rejects.toThrow(/Master frame changed/);
    await writeFile(path.join(f.folder, 'masters/frame-0002.png'), f.frames[2]);
    await writeFile(path.join(f.folder, 'asset.blend'), 'changed model');
    await expect(exportVariantV2(f.folder, f.root)).rejects.toThrow(/revision changed/);
    await writeFile(path.join(f.folder, 'asset.blend'), 'Packed Blender fixture');
    await writeFile(path.join(f.asset, 'archive-source/scripts/asset-pipeline/recipes/fixture.py'), 'changed recipe');
    await expect(exportVariantV2(f.folder, f.root)).rejects.toThrow(/Archived source changed/);
  });

  it('publishes consistent sheet metadata and rejects divergent variant clips', async () => {
    const f = await fixture();
    expect(await exportRunV2(f.run, f.root)).toEqual(['fixture']);
    const catalog = JSON.parse(await readFile(path.join(f.run, 'catalog.json'), 'utf8'));
    expect(catalog.version).toBe(2);
    const asset = catalog.assets[0];
    expect(asset.variants).toHaveLength(2);
    expect(asset.variants[0]).toMatchObject({ idleFrame: 0, frameCount: 4, clips: f.manifest.clips });
    expect(asset.variants[0].sources.find((s: { size: number }) => s.size === 32)).toMatchObject({
      url: '/art/poc/pipeline-v2/runs/reference-test/fixture/calm/sheet-32.png',
      idleUrl: '/art/poc/pipeline-v2/runs/reference-test/fixture/calm/sprite-32.png', margin: 2, spacing: 4,
    });
    expect(await sharp(path.join(f.asset, 'review.png')).metadata()).toMatchObject({ format: 'png' });
    const other = await fixture();
    const manifestFile = path.join(other.asset, 'rich/render.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    manifest.clips[0].frameRate = 15;
    await save(manifestFile, manifest);
    await expect(exportRunV2(other.run, other.root)).rejects.toThrow(/Variants disagree/);
  });

  it('binds every selected animation/source file immutably and verifies archive inventory', async () => {
    const f = await fixture();
    await exportRunV2(f.run, f.root);
    const selection = await selectVariantV2(f.asset, 'calm', 32, 'Readable stance and continuous walk.');
    expect(selection).toMatchObject({ version: 2, variant: 'calm', size: 32, idleFrame: 0, clips: f.manifest.clips });
    expect(Object.keys(selection.files)).toEqual(expect.arrayContaining(['calm/sprite-32.png', 'calm/sheet-32.png', 'calm/asset.blend',
      'calm/render.json', 'calm/export.json', 'calm/masters/frame-0003.png', 'build.json', 'archive-source/scripts/asset-pipeline/recipes/fixture.py',
      'archive-source/art/poc/pipeline-v2/textures/organic.png']));
    expect(await verifySelectionV2(f.asset)).toEqual(selection);
    const archive = await archiveManifestV2(f.asset);
    expect(archive.files).toMatchObject(selection.files);
    expect(archive.selectionSha256).toBe(hash(await readFile(path.join(f.asset, 'selection.json'))));
    await expect(selectVariantV2(f.asset, 'rich', 32, 'overwrite')).rejects.toThrow(/already exists/);
    await writeFile(path.join(f.folder, 'sheet-32.png'), f.frames[0]);
    await expect(archiveManifestV2(f.asset)).rejects.toThrow(/Selected export changed/);
  });

  it('archives reference images, raw review JSON and its helper without changing render/export provenance', async () => {
    const f = await fixture();
    const reference = 'public/assets/reference.png', previous = 'art/poc/previous.png';
    for (const relative of [reference, previous]) {
      await mkdir(path.dirname(path.join(f.root, relative)), { recursive: true });
      await writeFile(path.join(f.root, relative), f.frames[0]);
    }
    for (const variant of ['calm', 'rich']) {
      const file = path.join(f.asset, variant, 'render.json');
      const manifest = JSON.parse(await readFile(file, 'utf8'));
      await save(file, { ...manifest, reference, previousReference: { label: 'Previous', path: previous } });
    }
    await exportRunV2(f.run, f.root);
    const immutable = ['build.json', 'calm/render.json', 'rich/render.json', 'calm/export.json', 'rich/export.json'];
    const before = await Promise.all(immutable.map(file => readFile(path.join(f.asset, file))));
    const reportFile = path.join(f.root, 'art/poc/qa.json');
    const rawReport = '{ "nominalSize": "readable", "browserVerified": false }\n';
    await writeFile(reportFile, rawReport);
    const result = await prepareReviewV2(f.asset, reportFile, f.root);
    expect(result.references).toEqual([
      { role: 'reference', path: reference, sha256: hash(f.frames[0]) },
      { role: 'previousReference', path: previous, sha256: hash(f.frames[0]) },
    ]);
    expect(result.review).toEqual({ path: 'art/poc/qa.json', assetPath: 'review.json', sha256: hash(rawReport) });
    expect(await readFile(path.join(f.asset, 'review.json'), 'utf8')).toBe(rawReport);
    expect(await readFile(path.join(f.asset, 'archive-source/art/poc/qa.json'), 'utf8')).toBe(rawReport);
    for (const [relative, expected] of Object.entries(result.files)) expect(hash(await readFile(path.join(f.asset, 'archive-source', relative)))).toBe(expected);
    expect(await prepareReviewV2(f.asset, reportFile, f.root)).toEqual(result);
    for (const [index, file] of immutable.entries()) expect(await readFile(path.join(f.asset, file))).toEqual(before[index]);
    const selected = await selectVariantV2(f.asset, 'calm', 32, 'Review input archive fixture.');
    expect(Object.keys(selected.files)).toEqual(expect.arrayContaining(['archive-source/review-inputs.json', `archive-source/${reference}`,
      `archive-source/${previous}`, 'archive-source/art/poc/qa.json', 'archive-source/scripts/asset-pipeline/prepare-review-v2.mjs']));
    await expect(prepareReviewV2(f.asset, reportFile, f.root)).rejects.toThrow(/Selection already exists/);
  });

  it('rejects escaping review references and conflicting source snapshots before writing review files', async () => {
    const f = await fixture();
    const reportFile = path.join(f.root, 'qa.json');
    await save(reportFile, { checked: true });
    for (const variant of ['calm', 'rich']) {
      const file = path.join(f.asset, variant, 'render.json');
      await save(file, { ...f.manifest, variant, reference: '../outside.png' });
    }
    await expect(prepareReviewV2(f.asset, reportFile, f.root)).rejects.toThrow(/repository-relative/);
    await expect(readFile(path.join(f.asset, 'review.json'))).rejects.toThrow(/ENOENT/);
    await expect(prepareReviewV2(f.asset, path.join(f.root, '../outside.json'), f.root)).rejects.toThrow(/escapes/);
    const reference = 'public/reference.png';
    await mkdir(path.join(f.root, 'public'));
    await writeFile(path.join(f.root, reference), f.frames[0]);
    for (const variant of ['calm', 'rich']) await save(path.join(f.asset, variant, 'render.json'), { ...f.manifest, variant, reference });
    const linkedDestination = path.join(f.asset, 'archive-source/public');
    await symlink(path.join(f.root, 'public'), linkedDestination, 'junction');
    await expect(prepareReviewV2(f.asset, reportFile, f.root)).rejects.toThrow(/escapes|symlinks|junctions/);
    await unlink(linkedDestination);
    await mkdir(path.join(f.asset, 'archive-source/public'));
    await writeFile(path.join(f.asset, 'archive-source', reference), f.frames[1]);
    await expect(prepareReviewV2(f.asset, reportFile, f.root)).rejects.toThrow(/Archived review input changed/);
    expect(await readFile(path.join(f.asset, 'archive-source', reference))).toEqual(f.frames[1]);
    await expect(readFile(path.join(f.asset, 'review.json'))).rejects.toThrow(/ENOENT/);
  });
});
