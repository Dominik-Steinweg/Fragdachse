#!/usr/bin/env node
// Creates a lane worktree ready to work and capture in one step:
//   npm run worktree:new -- <name> [--from main] [--branch <name>] [--path <dir>] [--merge <branch>[,<branch>]]
//                           [--deps auto|link|ci|none]
// 1. git worktree add (new branch <name> from --from, or the existing branch), default path
//    <parent of the main checkout>/Fragdachse-worktrees/<name>
// 2. optional merges, e.g. an asset branch (a conflicting merge is aborted, the worktree stays)
// 3. node_modules: auto = junction to the main checkout's node_modules when both package-lock.json are
//    identical, else npm ci. Remove the worktree with worktree:remove, which unlinks the junction first.
// 4. capture kit: tools/capture-kit when the branch has it, else a copy in build/capture-kit (ignored)
// 5. a free Vite port from the shared registry (8098+, 8090 never), checked against listening sockets
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, statfsSync, symlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignPort } from './lib/worktree-ports.mjs';

// Expected refusals print one line; DEBUG=1 shows the stack.
process.on('uncaughtException', error => { console.error(`✗ ${process.env.DEBUG ? error.stack : error.message}`); process.exit(1); });
const here = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const VALUED = ['--from', '--branch', '--path', '--merge', '--deps'];
const options = {}, positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--help') { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n')); process.exit(0); }
  if (VALUED.includes(argv[i])) options[argv[i].slice(2)] = argv[++i];
  else if (argv[i].startsWith('--')) throw Error(`Unknown flag ${argv[i]}`);
  else positional.push(argv[i]);
}
const [name] = positional;
if (!name || positional.length > 1 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) throw Error('usage: worktree-new <name> [--from main] [--merge <branch>] [--deps auto|link|ci|none] (see --help)');
const deps = options.deps ?? 'auto';
if (!['auto', 'link', 'ci', 'none'].includes(deps)) throw Error('--deps: auto|link|ci|none');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const tryGit = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
// The main checkout is the first entry of `git worktree list`; its node_modules is the link target.
const mainCheckout = resolve(git(here, 'worktree', 'list', '--porcelain').split('\n')[0].replace(/^worktree /u, ''));
const branch = options.branch ?? name;
const from = options.from ?? 'main';
const path = resolve(options.path ?? join(dirname(mainCheckout), 'Fragdachse-worktrees', name));
if (existsSync(path)) throw Error(`${path} already exists`);
const branchExists = tryGit(here, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`).status === 0;

const step = (label, detail = '') => console.log(`\n▶ ${label}${detail ? ': ' + detail : ''}`);
step('worktree', `${path} (${branchExists ? `existing branch ${branch}` : `new branch ${branch} from ${from}`})`);
execFileSync('git', ['-C', here, 'worktree', 'add', ...(branchExists ? [path, branch] : ['-b', branch, path, from])], { stdio: 'inherit' });

for (const merge of options.merge?.split(',').filter(Boolean) ?? []) {
  step('merge', merge);
  const result = spawnSync('git', ['-C', path, 'merge', '--no-edit', merge], { stdio: 'inherit' });
  if (result.status !== 0) {
    tryGit(path, 'merge', '--abort');
    console.error(`\nMerge of ${merge} failed and was aborted; ${path} stays at its previous commit.`);
    console.error(`Resolve it there (git merge ${merge}) or remove the worktree: npm run worktree:remove -- ${name}`);
    process.exit(1);
  }
}

const sameLock = () => {
  try { return readFileSync(join(mainCheckout, 'package-lock.json'), 'utf8') === readFileSync(join(path, 'package-lock.json'), 'utf8'); }
  catch { return false; }
};
const source = join(mainCheckout, 'node_modules');
let depsResult = 'none';
if (deps === 'link' || (deps === 'auto' && sameLock() && existsSync(source))) {
  if (!existsSync(source)) throw Error(`${source} does not exist; use --deps ci`);
  if (!sameLock()) console.warn(`warning: package-lock.json differs from ${mainCheckout}; the linked node_modules may not match`);
  step('node_modules', `junction -> ${source}`);
  symlinkSync(source, join(path, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  depsResult = `junction to ${source}`;
} else if (deps === 'ci' || deps === 'auto') {
  const free = statfsSync(path).bavail * statfsSync(path).bsize;
  step('node_modules', `npm ci (${deps === 'auto' ? 'package-lock.json differs from the main checkout' : 'requested'}; ${(free / 2 ** 30).toFixed(1)} GiB free)`);
  if (free < 2 * 2 ** 30) throw Error('Less than 2 GiB free; free space or use --deps link');
  const result = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: path, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw Error('npm ci failed');
  depsResult = 'npm ci';
}

let kit = join(path, 'tools/capture-kit/capture.mjs');
if (!existsSync(kit)) {
  // Branches older than the versioned kit get a copy in the ignored build/ folder.
  const copy = join(path, 'build/capture-kit');
  step('capture kit', `${basename(from)} has no tools/capture-kit; copying to ${copy}`);
  cpSync(join(here, 'tools/capture-kit'), copy, { recursive: true, filter: file => !/[\\/](?:out|\.tmp)(?:[\\/]|$)/u.test(file.slice(here.length)) });
  kit = join(copy, 'capture.mjs');
}

const port = await assignPort(here, path, branch);
console.log(`\nworktree ready
  path          ${path}
  branch        ${branch} @ ${git(path, 'rev-parse', '--short', 'HEAD')}
  node_modules  ${depsResult}
  port          ${port}  (registry; capture.mjs picks it up automatically)
  dev server    npx vite --host 127.0.0.1 --port ${port} --strictPort
  capture       node ${kit.replaceAll('\\', '/')} <spec.json> --root ${path.replaceAll('\\', '/')}
  remove        npm run worktree:remove -- ${name}`);
