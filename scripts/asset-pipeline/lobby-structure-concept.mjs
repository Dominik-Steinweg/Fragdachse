// Concept renders for the lobby structures: every catalog id x variant in one disposable folder.
// node scripts/asset-pipeline/lobby-structure-concept.mjs --output D:/Fragdachse-render/base-buildings/concept/<label> [--ids a,b] [--variants a,b]
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot, resolveBlender, renderProcess } from './preview-v2.mjs';
import { digest, pythonSources } from './draft-v2.mjs';

const { values } = parseArgs({ options: {
  output: { type: 'string' }, ids: { type: 'string', default: 'lobby-workshop,lobby-yard,lobby-armory,lobby-scrap-stall' },
  variants: { type: 'string', default: 'a,b' }, samples: { type: 'string', default: '48' }, device: { type: 'string', default: 'OPTIX' },
  blender: { type: 'string' },
} });
if (!values.output) throw Error('--output required');
const blender = await resolveBlender(values.blender);
for (const id of values.ids.split(',')) {
  const spec = JSON.parse(await readFile(path.join(repoRoot, 'scripts/asset-pipeline/catalog-v2/assets', id + '.json'), 'utf8'));
  const sources = await pythonSources(repoRoot, `recipes_v2/${spec.recipe}.py`);
  for (const variant of values.variants.split(',')) {
    const modelSpec = { ...spec, clips: [], requiredClips: [], draft: { variant } };
    const modelHash = digest({ spec: modelSpec, sources });
    const output = path.join(values.output, `${id}-${variant}`);
    await mkdir(output, { recursive: true });
    const job = { spec: modelSpec, modelHash, model: path.join(values.output, '.models', modelHash + '.blend'), output,
      settings: { samples: Number(values.samples), device: values.device, denoise: true }, topSize: spec.sourceSizes.at(-1), oblique: [960, 720] };
    const file = path.join(output, 'job.json');
    await writeFile(file, JSON.stringify(job, null, 2));
    const started = performance.now();
    await renderProcess(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python',
      path.join(repoRoot, 'scripts/asset-pipeline/lobby-structure-concept.py'), '--', file], path.join(output, 'blender.log'), repoRoot);
    console.log(`${id}-${variant}: ${((performance.now() - started) / 1000).toFixed(1)} s -> ${output}`);
  }
}
