/** R3 publication of an accepted, sealed R1 bundle. Dry-run unless --apply. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { validateEnemyMeshManifest, relativeMember } from './enemy-mesh-contract.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function importEnemyMeshes(root, apply = false) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const registryPath = path.join(repo, 'src/config/pipelineAssets.json');
  const registry = JSON.parse(await readFile(registryPath));
  const receipt = JSON.parse(await readFile(path.join(root, 'archive-receipt.json')));
  if (!receipt.verified || hash(await readFile(path.join(root, relativeMember(receipt.file)))) !== receipt.sha256)
    throw Error('Enemy archive hash mismatch');
  const copies = [], assets = [];
  for (const id of ['zombie-badger', 'rabid-badger']) {
    const source = path.join(root, id), manifestBytes = await readFile(path.join(source, 'enemy-mesh.json'));
    const m = JSON.parse(manifestBytes); validateEnemyMeshManifest(m);
    if (m.id !== id || m.status !== 'reviewed-not-imported' || m.validation.minimumIou < .95
      || m.validation.minimumFineIou < .95 || m.validation.beautyOutsideRepairAlphaPixels !== 0)
      throw Error('Unaccepted enemy revision');
    const live = registry.assets.find(a => a.id === id);
    if (!live || JSON.stringify(live.layout) !== JSON.stringify(m.layout)
      || JSON.stringify(live.pivot) !== JSON.stringify(m.coordinates.pivot)
      || live.clips.some(c => !m.clips.some(x => x.name === c.name && x.frameRate === c.frameRate
        && x.loop === c.loop && JSON.stringify(x.frames) === JSON.stringify(c.frames))))
      throw Error('Enemy presentation contract changed');
    const folder = `assets/sprites/pipeline-v2/${id}/mesh/${m.revision}`;
    const { audit, ...mesh } = m.mesh;
    for (const part of ['positions', 'indices']) {
      const spec = m.mesh[part], bytes = await readFile(path.join(source, relativeMember(spec.file)));
      if (hash(bytes) !== spec.sha256 || bytes.length !== spec.bytes) throw Error('Changed mesh binary');
      const file = `${folder}/${id}-${part}-${spec.sha256}.bin`;
      mesh[part] = { ...spec, file, url: `${file}?v=${spec.sha256}` }; copies.push({ file, bytes });
    }
    const images = {}, inheritedEyeAnchorSource = { ...live.eyeAnchors.source };
    for (const pass of ['beauty', 'albedo', 'normal']) for (const size of [64, 128]) {
      const member = `${pass}/sheet-${size}.png`, bytes = await readFile(path.join(source, member));
      if (hash(bytes) !== m.images[member]) throw Error('Changed image ' + member);
      const file = `${folder}/${pass}-${size}.png`;
      copies.push({ file, bytes }); images[`${pass}${size}`] = { file, sha256: hash(bytes) };
      if (pass === 'beauty' && size === live.sourceSize) {
        const idle = await sharp(bytes).extract({ left: live.layout.margin, top: live.layout.margin, width: size, height: size }).png().toBuffer();
        copies.push({ file: live.sheetPath.replace(/^\.\//, ''), bytes }, { file: live.idlePath.replace(/^\.\//, ''), bytes: idle });
        live.hashes.sheet = hash(bytes); live.hashes.idle = hash(idle); live.revision = m.revision;
        // Eye geometry was not altered by the local proximal leg repair. Preserve the authored sockets,
        // but bind their inherited provenance to this new Beauty selection as well.
        live.eyeAnchors.source = { revision: m.revision, variant: live.variant,
          blendSha256: m.validation.evidence['candidate.blend'], sheetSha256: live.hashes.sheet, idleSha256: live.hashes.idle };
      }
    }
    assets.push({ id, revision: m.revision, coordinates: m.coordinates, poses: m.poses, contacts: m.contacts,
      provenance: m.provenance, mesh, images, materialEncoding: m.materialEncoding, sourceManifestSha256: hash(manifestBytes),
      sourceArchiveSha256: receipt.sha256, inheritedEyeAnchorSource, validation: m.validation });
  }
  const manifest = { schema: 'fd-enemy-mesh-runtime', version: 1, revision: assets[0].revision, assets };
  if (apply) {
    for (const c of copies) { const target = path.join(repo, 'public', c.file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, c.bytes); }
    await writeFile(path.join(repo, 'src/assets/manifests/enemy-mesh-pilot.json'), JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(registryPath, JSON.stringify(registry, null, 2) + '\n');
    for (const c of copies) if (hash(await readFile(path.join(repo, 'public', c.file))) !== hash(c.bytes)) throw Error('Import readback failed');
  }
  return { applied: apply, revision: manifest.revision, files: copies.length, bytes: copies.reduce((n, c) => n + c.bytes.length, 0) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  console.log(JSON.stringify(await importEnemyMeshes(path.resolve(process.argv[2]), process.argv.includes('--apply')), null, 2));
