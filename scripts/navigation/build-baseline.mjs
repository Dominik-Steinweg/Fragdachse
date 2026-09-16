import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = resolve('build/navigation-baseline-source');
if (!existsSync(resolve(source, 'src/entities/EnemyManager.ts'))) {
  throw new Error('Frozen baseline missing. Restore navigation-baseline-source.zip first; never build a baseline from the candidate tree.');
}
const result = spawnSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--mode', 'navigation-baseline',
  '--outDir', resolve('build/navigation-baseline')], { cwd: source, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
