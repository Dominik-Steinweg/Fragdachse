import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { enemyCoordinates, enemyPoses, enemyReviewSamples, relativeMember } from './enemy-mesh-contract.mjs';

export const enemyFileHash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));

/** Read-only preflight: bind selected source, atlas and masters, never select the newest run. */
export async function selectedEnemySource(repo, pilot) {
  const registry = await json(path.join(repo, 'src/config/pipelineAssets.json'));
  const asset = registry.assets.find(a => a.id === pilot.id && a.category === 'enemy');
  if (!asset || asset.revision !== pilot.sourceRevision) throw Error('Enemy selection revision changed: ' + pilot.id);
  const folder = path.join(repo, 'art/poc/pipeline-v2/runs', relativeMember(asset.revision), relativeMember(asset.id));
  const selection = await json(path.join(folder, 'selection.json'));
  const variant = relativeMember(selection.variant), base = path.join(folder, variant);
  const render = await json(path.join(base, 'render.json'));
  if (selection.id !== pilot.id || render.id !== pilot.id || render.revision !== asset.revision
    || render.inputHash !== selection.inputHash || render.variant !== variant || asset.variant !== variant
    || selection.size !== asset.sourceSize || selection.displayScale !== asset.displayScale
    || render.displayScale !== asset.displayScale || JSON.stringify(selection.layout) !== JSON.stringify(asset.layout))
    throw Error('Enemy source/registry disagreement: ' + pilot.id);
  const sourceFiles = {}, files = [];
  async function bind(member, file, expected) {
    relativeMember(member);
    const hash = await enemyFileHash(file);
    if (expected && expected !== hash) throw Error('Enemy hash mismatch: ' + file);
    sourceFiles[member] = hash; files.push({ member, file: path.resolve(file), sha256: hash });
  }
  async function selected(member, relative) {
    relativeMember(relative);
    const expected = selection.files?.[relative];
    if (!expected) throw Error('Unselected enemy source: ' + relative);
    await bind(member, path.join(folder, relative), expected);
  }
  await selected('source.blend', variant + '/asset.blend');
  await selected('source-render.json', variant + '/render.json');
  await bind('source-selection.json', path.join(folder, 'selection.json'));
  await bind('source-bundle.zip', path.join(folder, 'source-bundle.zip'));
  for (const kind of ['idle', 'sheet']) {
    await selected('source-' + kind + '.png', selection[kind]);
    const published = path.join(repo, 'public', relativeMember(asset[kind + 'Path'].replace(/^\.\//, '')));
    if (await enemyFileHash(published) !== asset.hashes[kind] || sourceFiles['source-' + kind + '.png'] !== asset.hashes[kind])
      throw Error('Enemy source does not match imported ' + kind);
  }
  const poses = enemyPoses(render);
  for (const frame of render.frames) {
    if (selection.files[variant + '/' + frame.file] !== frame.sha256) throw Error('Unselected enemy master');
    await selected('source-beauty/' + path.posix.basename(frame.file), variant + '/' + frame.file);
  }
  await bind('source-registry.json', path.join(repo, 'src/config/pipelineAssets.json'));
  await bind('source-pilot.json', path.join(repo, 'scripts/asset-pipeline', relativeMember(pilot.sourceContract ?? 'enemy-mesh-pilot.json')));
  return { id: pilot.id, pilot, render, layout: asset.layout, coordinates: enemyCoordinates(render),
    poses, reviewSamples: enemyReviewSamples(render), sourceFiles, files };
}
