#!/usr/bin/env node
// Safe teardown of a lane worktree:
//   npm run worktree:remove -- <name|path|branch> [--force] [--delete-branch] [--dry-run]
// 1. refuses the main checkout, the current directory and (without --force) uncommitted changes
// 2. unlinks every junction/symlink near the top of the worktree (node_modules first) BEFORE any
//    recursive delete: a recursive delete follows a junction and would empty the main node_modules
// 3. git worktree remove, then releases the registry port; --delete-branch runs git branch -d
//    (-D with --force). The branch is kept by default.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, rmdirSync, unlinkSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, releasePort } from './lib/worktree-ports.mjs';

const here = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const flags = new Set(argv.filter(arg => arg.startsWith('--')));
for (const flag of flags) if (!['--force', '--delete-branch', '--dry-run', '--help'].includes(flag)) throw Error(`Unknown flag ${flag}`);
if (flags.has('--help')) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 8).join('\n')); process.exit(0); }
const [target, ...extra] = argv.filter(arg => !arg.startsWith('--'));
if (!target || extra.length) throw Error('usage: worktree-remove <name|path|branch> [--force] [--delete-branch] [--dry-run]');
const force = flags.has('--force'), dry = flags.has('--dry-run');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const worktrees = git(here, 'worktree', 'list', '--porcelain').split(/\n\n+/u).map(block => {
  const field = key => block.split('\n').find(line => line.startsWith(key + ' '))?.slice(key.length + 1);
  return { path: field('worktree'), branch: field('branch')?.replace('refs/heads/', '') ?? null, locked: block.includes('\nlocked') };
}).filter(entry => entry.path);
const main = worktrees[0];
const wanted = normalizePath(target);
const matches = worktrees.filter(w => normalizePath(w.path) === wanted || basename(w.path) === target || w.branch === target);
if (matches.length !== 1) throw Error(matches.length ? `"${target}" is ambiguous: ${matches.map(w => w.path).join(', ')}` : `No worktree matches "${target}" (git worktree list)`);
const [wt] = matches;
const path = resolve(wt.path);

if (normalizePath(path) === normalizePath(main.path)) throw Error('Refusing to remove the main checkout');
if (normalizePath(process.cwd()).startsWith(normalizePath(path))) throw Error('Run this from outside the worktree that is being removed');
if (wt.locked && !force) throw Error(`${path} is locked (git worktree unlock, or --force)`);
const dirty = existsSync(path) ? git(path, 'status', '--porcelain') : '';
if (dirty && !force) throw Error(`${path} has uncommitted changes (commit them, or --force to discard):\n${dirty}`);

// Links near the top: node_modules, build/ helpers. Real directories are entered two levels deep,
// never through a link, and never into a real node_modules or .git.
const links = [];
const scan = (dir, depth) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (lstatSync(full).isSymbolicLink()) links.push(full);
    else if (entry.isDirectory() && depth > 0 && !['.git', 'node_modules'].includes(entry.name)) scan(full, depth - 1);
  }
};
if (existsSync(path)) scan(path, 2);

console.log(`worktree ${path}\n  branch ${wt.branch ?? '(detached)'}${dirty ? '\n  uncommitted changes will be discarded (--force)' : ''}`);
for (const link of links) console.log(`  unlink ${link} -> ${readlinkSync(link)}`);
if (dry) { console.log('dry run: nothing changed'); process.exit(0); }

for (const link of links) {
  const destination = resolve(path, readlinkSync(link));
  const before = existsSync(destination) ? readdirSync(destination).length : null;
  try { unlinkSync(link); } catch { rmdirSync(link); } // rmdir removes a junction itself, never its target
  if (existsSync(link)) throw Error(`Could not unlink ${link}; stopping before anything is deleted`);
  if (before !== null && (!existsSync(destination) || readdirSync(destination).length !== before)) throw Error(`Link target ${destination} changed while unlinking; stopping`);
}

const removal = spawnSync('git', ['-C', here, 'worktree', 'remove', ...(force ? ['--force'] : []), ...(wt.locked ? ['--force'] : []), path], { stdio: 'inherit' });
if (removal.status !== 0) throw Error('git worktree remove failed; the links are already gone, so deleting the folder by hand is safe');
const port = await releasePort(here, path);
console.log(`removed ${path}${port ? `, released port ${port}` : ''}`);

if (flags.has('--delete-branch') && wt.branch) {
  const result = spawnSync('git', ['-C', here, 'branch', force ? '-D' : '-d', wt.branch], { stdio: 'inherit' });
  if (result.status !== 0) console.warn(`branch ${wt.branch} kept (not merged; --force deletes it anyway)`);
} else if (wt.branch) {
  console.log(`branch ${wt.branch} kept`);
}
const mainModules = join(main.path, 'node_modules');
if (existsSync(join(mainModules, '.bin'))) console.log(`main node_modules intact: ${mainModules}`);
