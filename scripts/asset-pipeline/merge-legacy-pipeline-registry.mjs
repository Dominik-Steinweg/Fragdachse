// Transition helper for branches that still edit the former single-file registry
// src/config/pipelineAssets.json. During `git merge <branch>`, resolve that file's modify/delete
// conflict with `git rm src/config/pipelineAssets.json`, then run
//   node scripts/asset-pipeline/merge-legacy-pipeline-registry.mjs <branch>
// It applies only what <branch> changed since the merge base to the per-asset registry and stops on
// entries that both sides changed differently.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readPipelineRegistry, writePipelineRegistry } from './pipeline-registry.mjs';

const LEGACY = 'src/config/pipelineAssets.json';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Three-way merge of legacy documents into the current registry; returns the changed ids. */
export function mergeLegacyRegistry(current, base, theirs) {
  const index = registry => new Map(registry.assets.map(asset => [asset.id, asset]));
  const ours = index(current), before = index(base), after = index(theirs), changed = [], conflicts = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(id), next = after.get(id);
    if (same(was, next)) continue;
    const now = ours.get(id);
    if (!same(now, was) && !same(now, next)) { conflicts.push(id); continue; }
    if (next) ours.set(id, next); else ours.delete(id);
    changed.push(id);
  }
  const { assets: _base, ...baseMeta } = base, { assets: _theirs, ...theirMeta } = theirs, { assets: _ours, ...meta } = current;
  if (!same(baseMeta, theirMeta)) {
    if (!same(meta, baseMeta) && !same(meta, theirMeta)) conflicts.push('registry.json');
    else Object.assign(meta, theirMeta);
  }
  if (conflicts.length) throw new Error(`Both sides changed: ${conflicts.join(', ')}`);
  return { registry: { ...meta, assets: [...ours.values()] }, changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const branch = process.argv[2];
  if (!branch) throw new Error('Usage: merge-legacy-pipeline-registry.mjs <branch>');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  const base = git('merge-base', 'HEAD', branch).trim();
  const legacy = revision => JSON.parse(git('show', `${revision}:${LEGACY}`));
  const { registry, changed } = mergeLegacyRegistry(await readPipelineRegistry(), legacy(base), legacy(branch));
  await writePipelineRegistry(process.cwd(), registry);
  console.log(changed.length ? `Applied ${branch}: ${changed.join(', ')}` : `No registry changes on ${branch}`);
}
