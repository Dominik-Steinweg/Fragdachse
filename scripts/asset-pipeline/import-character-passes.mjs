/** Prepared for 21d. Default is read-only; --apply is an explicit publication. */
import { readFile, writeFile, mkdir, access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { digest } from './character-pass-contract.mjs';
import { verifyCharacterBundle, runTool } from './character-pass-bundle.mjs';

export function runtimePassManifest(atlas, selection, receipt) {
  if (selection.id !== 'badger' || !/^[a-z0-9][a-zA-Z0-9-]*$/.test(selection.revision)
    || atlas.status !== 'production-unreviewed' || atlas.poses.length !== 37
    || atlas.poses.some((p, i) => p.index !== i)) throw Error('Only a complete badger production can be imported');
  const folder = `assets/sprites/pipeline-v2/badger/passes/${selection.revision}`;
  const pages = atlas.pages.map((page, index) => {
    // "mask"/"normal" keep DATA PNGs out of A2 colour conversion. Include full
    // content hash in every filename; immutable URLs work before the next A2 scan.
    const name = `${page.pass === 'shadow' ? 'shadow-mask' : page.pass}-${index}-${page.sha256}.png`;
    return { ...page, file: `${folder}/${name}`, url: `${folder}/${name}?v=${page.sha256}`,
      textureRole: page.pass === 'albedo' ? 'colour' : 'data', colourSpace: page.pass === 'albedo' ? 'srgb' : 'linear',
      unpackPremultiplyAlpha: false, unpackColorSpaceConversion: 'none' };
  });
  return { ...atlas, schema: 'fd-character-pass-runtime', revision: selection.revision, assetId: selection.id,
    sourceSelectionSha256: receipt.selectionSha256, sourceArchiveSha256: receipt.archiveSha256,
    pages, publication: { folder, source: 'PNG byte-preserving; resolve page.file via runtimeAssetUrl after A2 publication',
      activation: '21d must explicitly register/load these passes; beauty registry remains independent' } };
}

export async function importCharacterPasses(root, { apply = false, python = 'D:/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' } = {}) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const { selection, atlas, receipt, stats } = await verifyCharacterBundle(root, { production: true });
  // Use current trusted verifier, never execute a script from the input archive.
  await runTool(python, ['-B', path.join(repo, 'scripts/asset-pipeline/archive-character-passes.py'),
    '--verify', path.join(root, 'source-bundle.zip'), receipt.selectionSha256], repo);
  const manifest = runtimePassManifest(atlas, selection, receipt);
  const relativeManifest = `src/assets/manifests/character-badger-${selection.revision}.json`;
  const destination = path.join(repo, 'public', manifest.publication.folder);
  const manifestFile = path.join(repo, relativeManifest);
  // Preflight all bytes and existing destinations before the first write.
  const copies = await Promise.all(atlas.pages.map(async (page, index) => {
    const bytes = await readFile(path.join(root, page.file));
    if (digest(bytes) !== page.sha256) throw Error('Atlas changed before import');
    return { bytes, file: path.join(repo, 'public', manifest.pages[index].file) };
  }));
  for (const target of [destination, manifestFile]) {
    if (await access(target).then(() => true, () => false)) throw Error('Immutable import destination exists: ' + target);
    let parent = path.dirname(target);
    while (!(await access(parent).then(() => true, () => false))) parent = path.dirname(parent);
    const rel = path.relative(await realpath(repo), await realpath(parent));
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Destination escapes repository');
  }
  const result = { status: apply ? 'imported-for-21d' : 'dry-run-no-writes', destination, manifestFile, ...stats };
  if (apply) {
    await mkdir(path.dirname(destination), { recursive: true });
    await mkdir(destination); // exclusive revision; partial failures never overwrite a previous import
    for (const { bytes, file } of copies) await writeFile(file, bytes, { flag: 'wx' });
    const text = JSON.stringify(manifest, null, 2) + '\n';
    await writeFile(path.join(destination, 'manifest.json'), text, { flag: 'wx' });
    await writeFile(manifestFile, text, { flag: 'wx' });
    for (const { bytes, file } of copies) if (digest(await readFile(file)) !== digest(bytes)) throw Error('Import readback failed');
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    apply: { type: 'boolean', default: false }, python: { type: 'string' },
  } });
  if (positionals.length !== 1) throw Error('Usage: node import-character-passes.mjs <revision-folder> [--apply]');
  console.log(JSON.stringify(await importCharacterPasses(path.resolve(positionals[0]), values), null, 2));
}
