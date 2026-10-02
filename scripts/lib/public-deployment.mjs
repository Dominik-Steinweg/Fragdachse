import { readFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { sha256 } from './runtime-colours.mjs';

/** Explicit, manifest-proven replacements only. Authoring files stay in public/ on disk. */
export async function publicDeploymentExclusions() {
  const colours = JSON.parse(await readFile('src/assets/manifests/runtime-colours.json', 'utf8')).assets;
  const atlases = JSON.parse(await readFile('src/assets/manifests/runtime-atlases.json', 'utf8')).groups;
  const excluded = new Set();
  for (const asset of Object.values(colours)) {
    // The newly imported character passes and powerups keep their complete publication unchanged.
    if (/^assets\/sprites\/pipeline-v2\/(badger\/passes|powerups)\//.test(asset.source)) continue;
    if (sha256(await readFile('public/' + asset.file)) !== asset.sha256
      || sha256(await readFile('public/' + asset.source)) !== asset.sourceSha256) throw Error(`Stale colour publication: ${asset.source}`);
    excluded.add(asset.source);
  }
  const currentAtlasFiles = new Set();
  for (const group of Object.values(atlases)) {
    for (const page of group.pages) {
      for (const [file, hash] of [[page.image, page.sha256], [page.data, page.dataSha256]]) {
        if (sha256(await readFile('public/' + file)) !== hash) throw Error(`Stale atlas publication: ${file}`);
        currentAtlasFiles.add(file);
      }
    }
    for (const source of group.sources) {
      if (sha256(await readFile('public/' + source.file)) !== source.sha256) throw Error(`Stale atlas source: ${source.file}`);
      excluded.add(source.source); excluded.add(source.file);
    }
  }
  // A repack can use fewer pages; stale generator outputs must not reach deployment.
  for (const file of await readdir('public/assets/atlases')) {
    if (/^(icons|decals|groundcover)-\d+\.(json|webp)$/.test(file) && !currentAtlasFiles.has('assets/atlases/' + file)) excluded.add('assets/atlases/' + file);
  }
  return excluded;
}

export async function publicDeploymentFiles() {
  const excluded = await publicDeploymentExclusions(), files = [];
  const visit = async (relative = '') => {
    for (const entry of (await readdir(resolve('public', relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(file);
      else if (!excluded.has(file)) files.push(file);
    }
  };
  await visit(); return files;
}

export function publicDeployment() {
  let destination;
  return {
    name: 'manifest-public-deployment',
    configResolved(config) {
      // Profiling archives use the same selection with their content-addressed storage.
      if (config.command === 'build' && config.mode === 'production') destination = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      if (!destination) return;
      for (const file of await publicDeploymentFiles()) {
        const target = resolve(destination, file);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(resolve('public', file), target);
      }
    },
  };
}
