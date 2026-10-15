#!/usr/bin/env node
// check:quick: the fast gate while a lane is still working. Typecheck runs next to one Vitest run that
// covers the core tests related to the change against the base (import graph, plus tests that name a
// changed path because they read it from disk), the whole architecture suite and the core guardrails
// that walk src/ (depth catalog). No builds and no special suites; check:release adds those.
//   npm run check:quick [-- --base <ref>] [--list] [--serial] [--full]
//   --list: print the selection only. --serial: typecheck before Vitest. --full: whole core suite.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles, classify, exists, resolveBase, root, run, summary } from './changes.mjs';

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--base') i++;
  else if (!['--list', '--serial', '--full', '--help'].includes(argv[i]) && !argv[i].startsWith('--base=')) throw Error(`Unknown flag ${argv[i]}`);
}
if (argv.includes('--help')) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 7).join('\n')); process.exit(0); }
const started = Date.now();
const base = resolveBase(argv);
const changed = changedFiles(base.mergeBase);

// Same scope as `npm test` plus the architecture suite.
const SPECIAL = /^tests\/(?:integration|assets|stress|balance-lab)\//u;
const BASE_EXCLUDES = ['.claude/**', 'build/**', 'art/**', 'tools/audio-studio/**', 'tools/voice-workshop/**'];
const testFiles = [];
const walk = dir => {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path);
    else if (/\.test\.[cm]?[jt]sx?$/u.test(entry.name)) testFiles.push(path);
  }
};
walk('tests');
const coreTests = testFiles.filter(path => !SPECIAL.test(path) && !path.startsWith('tests/architecture/'));
const text = new Map(coreTests.map(path => [path, readFileSync(join(root, path), 'utf8')]));

const architecture = testFiles.filter(path => path.startsWith('tests/architecture/'));
// Core tests that enumerate src/ themselves; no import graph links them to a new or moved file.
const walkers = coreTests.filter(path => /\b(?:readdirSync|readdir|globSync)\(\s*(?:resolve\(\s*)?['"`]src\b/u.test(text.get(path)));
const sources = changed.filter(path => exists(path) && /\.(?:[cm]?[jt]sx?|json|glsl|frag|vert|wgsl|txt|csv)$/u.test(path));
// Tests that read a changed file by path (source contracts, map JSON) without importing it.
const readable = sources.filter(source => source.includes('/') && !source.startsWith('tests/'));
const named = coreTests.filter(path => readable.some(source => text.get(path).includes(source)));
const special = changed.filter(path => SPECIAL.test(path) && /\.test\.[cm]?[jt]sx?$/u.test(path) && exists(path));
const infra = classify(changed, base.mergeBase).infra;
const full = argv.includes('--full') || infra.length > 0;

console.log(`check:quick against ${base.ref} (merge base ${base.short}): ${changed.length} changed paths, ${sources.length} module candidates`);
if (infra.length) console.log(`  infrastructure changed (${infra.join(', ')}): whole core suite`);
console.log(`  always: ${architecture.length} architecture + ${walkers.length} src walkers (${walkers.join(', ')})`);
if (named.length) console.log(`  named by path: ${named.join(', ')}`);
if (special.length) console.log(`  changed special-suite tests: ${special.join(', ')}`);
const assetTests = special.filter(path => path.startsWith('tests/assets/'));
if (assetTests.length) console.log('  asset tests need prepared runtime assets: run `npm run test:assets` for them');
if (argv.includes('--list')) { for (const path of changed) console.log(`    ${path}`); process.exit(0); }

const node = process.execPath;
const vitestBin = join(root, 'node_modules/vitest/vitest.mjs');
const vitestArgs = ['--pool=threads', ...BASE_EXCLUDES.flatMap(glob => ['--exclude', glob])];
const coreExcludes = ['tests/integration/**', 'tests/assets/**', 'tests/stress/**', 'tests/balance-lab/**'].flatMap(glob => ['--exclude', glob]);
const related = [...new Set([...sources, ...architecture, ...walkers, ...named])];
// Child processes start without a shell, so the Windows limit is CreateProcess's 32k characters.
const tooLong = related.join(' ').length > 28000;
if (tooLong) console.log('  related list exceeds the command-line budget: whole core suite');

const vitestCore = full || tooLong
  ? () => run('vitest core + architecture', node, [vitestBin, 'run', ...vitestArgs, ...coreExcludes])
  : () => run('vitest related + guardrails', node, [vitestBin, 'related', '--run', '--passWithNoTests', ...vitestArgs, ...coreExcludes, ...related]);
const vitestSpecial = () => run('vitest changed special tests', node, [vitestBin, 'run', ...vitestArgs, ...special.filter(path => !assetTests.includes(path))]);
const typecheck = () => run('typecheck', node, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], { quiet: !argv.includes('--serial') });

const results = [];
if (argv.includes('--serial')) {
  results.push(await typecheck(), await vitestCore());
} else {
  console.log('\n▶ typecheck (tsc --noEmit) runs alongside Vitest; its output follows at the end');
  const pending = typecheck();
  results.push(await vitestCore());
  const tsc = await pending;
  if (tsc.output.trim()) console.log(`\n── typecheck output ──\n${tsc.output.trim()}`);
  results.unshift(tsc);
}
if (special.length > assetTests.length) results.push(await vitestSpecial());
process.exitCode = summary(`check:quick against ${base.ref} @ ${base.short}`, results, Date.now() - started);
if (process.exitCode === 0) console.log('  before a merge to main: npm run check:release');
