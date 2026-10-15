// Shared helpers for the staged check scripts (check:quick, check:release): the diff base, the
// changed paths against it and timed child processes. Paths are repo-relative with forward slashes.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));

const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const lines = text => text.split('\n').map(line => line.trim()).filter(Boolean);

/** `--base <ref>` / `--base=<ref>`, else CHECK_BASE, else `main`; diffs start at the merge base with HEAD. */
export function resolveBase(argv) {
  const index = argv.findIndex(arg => arg === '--base' || arg.startsWith('--base='));
  const ref = index < 0 ? process.env.CHECK_BASE || 'main'
    : argv[index].includes('=') ? argv[index].slice('--base='.length) : argv[index + 1];
  if (!ref) throw Error('--base needs a git ref');
  let mergeBase;
  try { mergeBase = git('merge-base', 'HEAD', ref); } catch { throw Error(`No merge base between HEAD and ${ref}`); }
  return { ref, mergeBase, short: mergeBase.slice(0, 8) };
}

/** Committed, staged, unstaged and untracked (not ignored) paths that differ from `mergeBase`. */
export function changedFiles(mergeBase) {
  const tracked = lines(git('diff', '--name-only', '--no-renames', mergeBase, '--'));
  const untracked = lines(git('ls-files', '--others', '--exclude-standard'));
  return [...new Set([...tracked, ...untracked])].map(path => path.replaceAll('\\', '/')).sort();
}

export const exists = path => existsSync(resolve(root, path));

/** Infrastructure that every test and build depends on: a change means "run everything". */
export const INFRA = /^(?:package(?:-lock)?\.json|vite\.config\.ts|tsconfig[^/]*\.json|tests\/[^/]*\.(?:cjs|mjs|js)|tests\/setup[^/]*)$/u;

/**
 * Path families that decide the conditional release suites. Deliberately broad: a false positive
 * costs one suite run, a false negative a red integration. `--all` runs every suite regardless.
 */
export const FAMILIES = {
  generator: [
    /^src\/arena\/(?:ArenaGenerat|AutoTiler|BaseRegistry|CellHash|DecalConfig|OrganicDirtMargin|SolidRockFormation|WaterGeometry)/u,
    /^src\/arena\/(?:rocks|trees|chunks)\//u,
    /^src\/world\/(?:WorldMetrics|RoundWorldGeneration)/u,
    /^src\/utils\/spawnFront/u,
    /^src\/systems\/(?:navigation|flowfield)\//u,
    /^src\/systems\/EnemyFlowFieldService/u,
    /^src\/config\.ts$/u,
    /^src\/config\/coopDefenseWater/u,
  ],
  map: [
    /^src\/config\/coopDefenseMap/u,
    /^src\/config\/authoring\//u,
    /^src\/config\/dawn\/(?:arenaTemplates\/|site)/u,
    /^src\/dawn\/(?:composition|resolution)\//u,
  ],
  balance: [
    /^src\/config\.ts$/u,
    /^src\/config\/[^/]+\.json$/u,
    /^src\/config\/(?:coopDefense(?:Enemies|Turrets|Upgrades|Items|Classes|Scaling|Constructions)|attackDrone|mgTurret|krakenBoss)/u,
    /^src\/config\/dawn\//u,
    /^src\/dawn\/(?:economy|rules)\//u,
    /^src\/loadout\//u,
  ],
};

/** package.json counts as infrastructure only when more than its "scripts" block changed. */
function packageJsonChanged(mergeBase) {
  const strip = text => { const { scripts, ...rest } = JSON.parse(text); return JSON.stringify(rest); };
  try { return strip(git('show', `${mergeBase}:package.json`)) !== strip(readFileSync(resolve(root, 'package.json'), 'utf8')); }
  catch { return true; }
}

/** Which families (plus INFRA) the changed paths touch, with the first matching paths as evidence. */
export function classify(paths, mergeBase) {
  const hits = { infra: paths.filter(path => INFRA.test(path) && (path !== 'package.json' || !mergeBase || packageJsonChanged(mergeBase))) };
  for (const [family, patterns] of Object.entries(FAMILIES)) hits[family] = paths.filter(path => patterns.some(p => p.test(path)));
  return hits;
}

/** Runs a command with inherited output; resolves with its exit code and wall time. */
export function run(label, command, args, { quiet = false, env } = {}) {
  const started = Date.now();
  if (!quiet) console.log(`\n▶ ${label}: ${command} ${args.join(' ')}`);
  return new Promise(done => {
    // npm/npx are .cmd shims on Windows and need a shell; node runs directly (no 8k cmd.exe limit).
    const shell = process.platform === 'win32' && /^np[mx]$/u.test(command);
    const child = spawn(command, args, { cwd: root, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', shell,
      env: { ...process.env, ...env } });
    let output = '';
    if (quiet) for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; });
    child.on('error', error => done({ label, code: 1, ms: Date.now() - started, output: String(error) }));
    child.on('close', code => done({ label, code: code ?? 1, ms: Date.now() - started, output }));
  });
}

export const seconds = ms => `${(ms / 1000).toFixed(1)} s`;

export function summary(title, results, totalMs) {
  console.log(`\n${title}`);
  for (const r of results) console.log(`  ${r.skipped ? 'skip' : r.code === 0 ? 'ok  ' : 'FAIL'}  ${r.label.padEnd(34)} ${r.skipped ?? seconds(r.ms)}`);
  console.log(`  total ${seconds(totalMs)}`);
  return results.some(r => !r.skipped && r.code !== 0) ? 1 : 0;
}
