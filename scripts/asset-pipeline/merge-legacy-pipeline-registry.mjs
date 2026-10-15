// Transition helper for branches that still edit a former single-file document: the runtime registry
// src/config/pipelineAssets.json or the demand catalog scripts/asset-pipeline/catalog-v2.json. During
// `git merge <branch>`, resolve each such modify/delete conflict with `git rm <file>`, then run
//   node scripts/asset-pipeline/merge-legacy-pipeline-registry.mjs <branch>
// It applies only what <branch> changed since the merge base to the per-asset documents and stops on
// entries that both sides changed differently.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { DEMAND_CATALOG_DIR, PIPELINE_REGISTRY_DIR, readPipelineRegistry, writePipelineRegistry } from './pipeline-registry.mjs';

const LEGACY = { 'src/config/pipelineAssets.json': PIPELINE_REGISTRY_DIR, 'scripts/asset-pipeline/catalog-v2.json': DEMAND_CATALOG_DIR };
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
  const git = (args, stderr = 'inherit') => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', stderr] });
  const base = git(['merge-base', 'HEAD', branch]).trim();
  for (const [legacy, store] of Object.entries(LEGACY)) {
    const read = revision => { try { return JSON.parse(git(['show', `${revision}:${legacy}`], 'ignore')); } catch { return null; } };
    const before = read(base), after = read(branch);
    // Branches cut after the split no longer carry the legacy file; their per-asset edits merge normally.
    if (!before || !after) { console.log(`${legacy}: not on both ${branch} and the merge base`); continue; }
    const { registry, changed } = mergeLegacyRegistry(await readPipelineRegistry(process.cwd(), store), before, after);
    await writePipelineRegistry(process.cwd(), registry, store);
    console.log(changed.length ? `${legacy}: applied ${branch}: ${changed.join(', ')}` : `${legacy}: no changes on ${branch}`);
  }
}
