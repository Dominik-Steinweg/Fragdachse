import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
function sourceIdentity(root) {
  const hash = createHash('sha256');
  const visit = (folder) => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else { hash.update(path.replaceAll('\\', '/')); hash.update(readFileSync(join(root, path))); }
    }
  };
  visit('src');
  return hash.digest('hex');
}
const sourceHash = sourceIdentity('.');
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--pool=threads',
  '--exclude', 'build/**', 'tests/stress/NavigationMovementStress.test.ts'], { stdio: 'inherit',
  env: { ...process.env, NAVIGATION_SOURCE_IDENTITY: sourceHash, NAVIGATION_STRESS: '1',
    NAVIGATION_SMOKE: process.argv.includes('--smoke') ? '1' : '0' } });
process.exitCode = result.status ?? 1;
