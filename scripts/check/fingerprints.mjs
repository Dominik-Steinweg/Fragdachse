#!/usr/bin/env node
// Campaign arena fingerprints, base against the working tree. Both sides run from a source snapshot
// under build/check/ (base: git archive of the merge base; head: tracked + untracked files of the
// working tree), so neither checkout is touched and edits during the run do not leak in.
//   node scripts/check/fingerprints.mjs [--base <ref>] [--allow-changes]
// Exit 1 when a map/seed fingerprint differs, unless --allow-changes (an intended generator change).
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveBase, root, seconds } from './changes.mjs';

const argv = process.argv.slice(2);
const allowChanges = argv.includes('--allow-changes');
const started = Date.now();
const base = resolveBase(argv);
// What the snapshot needs: src, the Vite config and what that config imports. Asset tooling stays out.
const PATHS = ['src', 'scripts', 'vite.config.ts', 'tsconfig.json', 'game-version.json', 'package.json'];
const OMIT = ':(exclude)scripts/asset-pipeline';
const work = join(root, 'build/check/fingerprints');
const template = readFileSync(join(root, 'scripts/check/fingerprints.template.ts'), 'utf8');

function snapshotBase(dir) {
  execFileSync('git', ['-C', root, 'archive', '--format=tar', '-o', join(work, 'base.tar'), base.mergeBase, '--', ...PATHS, OMIT]);
  // Relative paths: GNU tar (Git Bash) would read "C:" in an absolute path as a remote host.
  execFileSync('tar', ['-xf', 'base.tar', '-C', 'base'], { cwd: work });
  rmSync(join(work, 'base.tar'));
}

function snapshotHead(dir) {
  const files = execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '--', ...PATHS, OMIT], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n').map(line => line.trim()).filter(Boolean);
  for (const file of files) {
    try { mkdirSync(dirname(join(dir, file)), { recursive: true }); cpSync(join(root, file), join(dir, file)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; } // deleted but not yet staged
  }
}

function fingerprint(label, makeSnapshot) {
  const dir = join(work, label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'tests'), { recursive: true });
  makeSnapshot(dir);
  // The Vite config derives its runtime asset URL table from public/assets; the generator needs no assets.
  mkdirSync(join(dir, 'public/assets'), { recursive: true });
  writeFileSync(join(dir, 'tests/campaign-fingerprints.test.ts'), template);
  const out = join(work, `${label}.json`);
  rmSync(out, { force: true });
  const t = Date.now();
  // The snapshot lies inside this checkout, so node_modules resolves from here; its own Vite config applies.
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--root', dir, 'tests/campaign-fingerprints.test.ts'],
      { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FP_OUT: out } });
    let log = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk; });
    child.on('close', code => {
      if (code !== 0) { fail(Error(`${label} fingerprints failed (exit ${code})\n${log.slice(-4000)}`)); return; }
      console.log(`  ${label}: ${seconds(Date.now() - t)}`);
      done(JSON.parse(readFileSync(out, 'utf8')));
    });
  });
}

mkdirSync(work, { recursive: true });
console.log(`campaign fingerprints: ${base.ref} @ ${base.short} vs working tree`);
const [before, after] = await Promise.all([fingerprint('base', snapshotBase), fingerprint('head', snapshotHead)]);
const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const changed = keys.filter(key => before[key] !== after[key]);
for (const key of changed) console.log(`  ${key}: ${before[key] ?? '(missing)'} -> ${after[key] ?? '(missing)'}`);
console.log(`${keys.length - changed.length}/${keys.length} map:seed fingerprints equal (${seconds(Date.now() - started)})`);
for (const label of ['base', 'head']) rmSync(join(work, label), { recursive: true, force: true, maxRetries: 3 });
if (changed.length && !allowChanges) {
  console.log('Generator output changed. Intended? Re-run with --allow-changes (check:release passes it through).');
  process.exitCode = 1;
}
