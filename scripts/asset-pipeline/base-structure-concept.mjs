// Concept renders of the rustic base styles: core, outpost sheet and 47-mask kit per style.
// node scripts/asset-pipeline/base-structure-concept.mjs --output D:/Fragdachse-render/base-rustic/concept/<label>
//   [--styles burg,fort,feld,wall] [--layouts core,core-gravel,core-loam,wide-loam,outposts,kit] [--samples 24] [--variant 0]
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot, resolveBlender, renderProcess } from './preview-v2.mjs';
import { digest, pythonSources } from './draft-v2.mjs';

const { values } = parseArgs({ options: {
  output: { type: 'string' }, styles: { type: 'string', default: 'burg,fort,feld,wall' },
  layouts: { type: 'string', default: 'core,outposts,kit' }, samples: { type: 'string', default: '24' },
  variant: { type: 'string', default: '0' }, device: { type: 'string', default: 'OPTIX' }, blender: { type: 'string' },
} });
if (!values.output) throw Error('--output required');

// Canvas per layout: orthoScale in metres, aspect = height / width, views to render.
const LAYOUTS = {
  core: { orthoScale: 11, aspect: 1, views: ['day', 'mask', 'oblique', 'lamp'], model: { layout: 'core' } },
  'core-gravel': { orthoScale: 11, aspect: 1, views: ['day', 'mask', 'oblique', 'lamp'], model: { layout: 'core', master: true, ground: 'gravel' } },
  'core-loam': { orthoScale: 11, aspect: 1, views: ['day', 'mask', 'oblique', 'lamp'], model: { layout: 'core', master: true, ground: 'loam' } },
  'wide-loam': { orthoScale: 16, aspect: 1, pxPerMetre: 32, views: ['day', 'mask', 'lamp'],
    model: { layout: 'core', master: true, ground: 'loam', buildStage: 2 } },
  outposts: { orthoScale: 17, aspect: 10 / 17, views: ['top', 'day', 'mask', 'lamp'], model: { layout: 'outposts' } },
  kit: { orthoScale: 14, aspect: 1, views: ['top'], model: { layout: 'kit' } },
};

const blender = await resolveBlender(values.blender);
const base = JSON.parse(await readFile(path.join(repoRoot, 'scripts/asset-pipeline/catalog-v2/assets/base-structure.json'), 'utf8'));
const sources = await pythonSources(repoRoot, `recipes_v2/${base.recipe}.py`);
// The recipe reads its outpost shapes from JSON, which the Python source digest does not see.
sources['base-structure-shapes.json'] = await readFile(path.join(repoRoot, 'scripts/asset-pipeline/base-structure-shapes.json'), 'utf8');
for (const style of values.styles.split(',')) {
  for (const layout of values.layouts.split(',')) {
    const canvas = LAYOUTS[layout];
    const spec = { ...base, orthoScale: canvas.orthoScale,
      model: { ...base.model, style, variant: Number(values.variant), conceptGround: layout !== 'kit', ...canvas.model } };
    const modelHash = digest({ spec, sources });
    const output = path.join(values.output, `${style}-${layout}`);
    await mkdir(output, { recursive: true });
    const job = { spec, modelHash, model: path.join(values.output, '.models', modelHash + '.blend'), output,
      settings: { samples: Number(values.samples), device: values.device, denoise: true },
      pxPerMetre: canvas.pxPerMetre ?? 64, aspect: canvas.aspect, views: canvas.views };
    const file = path.join(output, 'job.json');
    await writeFile(file, JSON.stringify(job, null, 2));
    const started = performance.now();
    await renderProcess(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python',
      path.join(repoRoot, 'scripts/asset-pipeline/base-structure-concept.py'), '--', file], path.join(output, 'blender.log'), repoRoot);
    console.log(`${style}-${layout}: ${((performance.now() - started) / 1000).toFixed(1)} s -> ${output}`);
  }
}
