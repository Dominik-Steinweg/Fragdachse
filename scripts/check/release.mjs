#!/usr/bin/env node
// check:release: the gate before a fast-forward to main. Always the peer protocol guard, `check` (core,
// architecture, three builds), integration and assets; stress, the sampled Dawn multi-seed run, balance lab
// and campaign fingerprints only when the diff against the base touches generator, map, Dawn or balance
// paths (see FAMILIES in changes.mjs), their own tests, or build infrastructure. Steps run serially and all
// run; the summary lists every red. The full Dawn sweep stays opt-in: npm run test:stress:dawn-sweep.
//   npm run check:release [-- --base <ref>] [--all] [--bail] [--list] [--allow-fingerprint-changes]
//                         [--allow-unbumped-wire]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles, classify, resolveBase, root, run, summary } from './changes.mjs';

const argv = process.argv.slice(2);
const FLAGS = ['--all', '--bail', '--list', '--allow-fingerprint-changes', '--allow-unbumped-wire', '--help'];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--base') i++;
  else if (!FLAGS.includes(argv[i]) && !argv[i].startsWith('--base=')) throw Error(`Unknown flag ${argv[i]}`);
}
if (argv.includes('--help')) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 7).join('\n')); process.exit(0); }
const started = Date.now();
const base = resolveBase(argv);
const changed = changedFiles(base.mergeBase);
const hits = classify(changed, base.mergeBase);
const own = prefix => changed.filter(path => path.startsWith(prefix));
const all = argv.includes('--all');

/** Why a conditional step runs: the first evidence path per reason, or null to skip it. */
const because = (...reasons) => {
  if (all) return '--all';
  const found = reasons.filter(([, paths]) => paths.length).map(([name, paths]) => `${name}: ${paths[0]}${paths.length > 1 ? ` +${paths.length - 1}` : ''}`);
  return found.length ? found.join('; ') : null;
};
const fingerprintArgs = ['--base', base.mergeBase, ...(argv.includes('--allow-fingerprint-changes') ? ['--allow-changes'] : [])];
const steps = [
  { label: 'protocol', command: process.execPath, args: [join(root, 'scripts/check/protocol.mjs'), '--base', base.ref,
    ...(argv.includes('--allow-unbumped-wire') ? ['--allow-unbumped-wire'] : [])], reason: 'always' },
  { label: 'check', command: 'npm', args: ['run', 'check'], reason: 'always' },
  { label: 'test:integration', command: 'npm', args: ['run', 'test:integration'], reason: 'always' },
  { label: 'test:assets', command: 'npm', args: ['run', 'test:assets'], reason: 'always' },
  { label: 'fingerprints', command: process.execPath, args: [join(root, 'scripts/check/fingerprints.mjs'), ...fingerprintArgs],
    reason: because(['generator', hits.generator], ['map', hits.map], ['infra', hits.infra], ['script', own('scripts/check/fingerprints')]) },
  { label: 'test:stress', command: 'npm', args: ['run', 'test:stress'],
    reason: because(['generator', hits.generator], ['map', hits.map], ['infra', hits.infra],
      ['tests', own('tests/stress/').filter(path => !path.startsWith('tests/stress/dawn/'))]) },
  // Dawn arenas do not read campaign maps: their sampled multi-seed run follows generator and Dawn paths only.
  { label: 'test:stress:dawn', command: 'npm', args: ['run', 'test:stress:dawn'],
    reason: because(['generator', hits.generator], ['dawn', hits.dawn], ['infra', hits.infra], ['tests', own('tests/stress/dawn/')]) },
  { label: 'test:balance-lab', command: 'npm', args: ['run', 'test:balance-lab'],
    reason: because(['balance', hits.balance], ['map', hits.map], ['infra', hits.infra], ['tests', own('tests/balance-lab/')]) },
];

console.log(`check:release against ${base.ref} (merge base ${base.short}): ${changed.length} changed paths`);
for (const step of steps) console.log(`  ${step.reason ? 'run ' : 'skip'} ${step.label.padEnd(18)} ${step.reason ?? 'no generator/map/balance change'}`);
if (argv.includes('--list')) process.exit(0);

const results = [];
for (const step of steps) {
  if (!step.reason) { results.push({ label: step.label, code: 0, ms: 0, skipped: 'skipped (paths)' }); continue; }
  const result = await run(step.label, step.command, step.args);
  results.push(result);
  if (result.code !== 0 && argv.includes('--bail')) break;
}
for (const step of steps.slice(results.length)) results.push({ label: step.label, code: 0, ms: 0, skipped: 'not run (--bail)' });
process.exitCode = summary(`check:release against ${base.ref} @ ${base.short}`, results, Date.now() - started);
