#!/usr/bin/env node
// Guarded fast-forward of main in the main checkout. Never pushes.
//   npm run ff-main -- <branch> --expect <main-hash> [--repo <main checkout>] [--dry-run] [--strict]
//                      [--allow-unbumped-wire]
// Checks, in order: the main checkout has main checked out, no merge/rebase in progress, no staged or
// unstaged changes to tracked files (--strict: no untracked files either), main equals the expected
// hash (so nobody moved it since your gates ran), main is an ancestor of <branch>, and the branch's
// peer protocol version fits main (check/protocol.mjs). Only then `git merge --ff-only <branch>`;
// afterwards main must equal the branch tip.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateProtocol } from './check/protocol.mjs';

// Expected refusals print one line; DEBUG=1 shows the stack.
process.on('uncaughtException', error => { console.error(`✗ ${process.env.DEBUG ? error.stack : error.message}`); process.exit(1); });
const argv = process.argv.slice(2);
const options = {}, positional = [];
for (let i = 0; i < argv.length; i++) {
  if (['--expect', '--repo'].includes(argv[i])) options[argv[i].slice(2)] = argv[++i];
  else if (['--dry-run', '--strict', '--allow-unbumped-wire', '--help'].includes(argv[i])) options[argv[i].slice(2)] = true;
  else if (argv[i].startsWith('--')) throw Error(`Unknown flag ${argv[i]}`);
  else positional.push(argv[i]);
}
if (options.help) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 7).join('\n')); process.exit(0); }
const [branch] = positional;
if (!branch || positional.length > 1 || !options.expect) throw Error('usage: ff-main <branch> --expect <main-hash> [--repo <dir>] [--dry-run] [--strict]');

const here = fileURLToPath(new URL('..', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const ok = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).status === 0;
// Default: the main checkout, i.e. the first entry of `git worktree list`.
const repo = resolve(options.repo ?? git(here, 'worktree', 'list', '--porcelain').split('\n')[0].replace(/^worktree /u, ''));
const fail = message => { console.error(`✗ ${message}\nNothing was merged.`); process.exit(1); };
const pass = message => console.log(`✓ ${message}`);

const head = spawnSync('git', ['-C', repo, 'symbolic-ref', '--quiet', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
if (head !== 'refs/heads/main') fail(`${repo} has ${head || 'a detached HEAD'} checked out, not main`);
pass(`${repo} is on main`);

const gitDir = resolve(repo, git(repo, 'rev-parse', '--git-dir'));
const busy = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'].filter(name => existsSync(join(gitDir, name)));
if (busy.length) fail(`an operation is in progress in ${repo} (${busy.join(', ')})`);
const tracked = git(repo, 'status', '--porcelain', '--untracked-files=no');
if (tracked) fail(`${repo} has uncommitted changes to tracked files:\n${tracked}`);
const untracked = git(repo, 'status', '--porcelain', '--untracked-files=normal').split('\n').filter(line => line.startsWith('??'));
if (untracked.length && options.strict) fail(`${repo} has untracked files (--strict):\n${untracked.join('\n')}`);
pass(`working tree clean${untracked.length ? ` (tracked files; ${untracked.length} untracked path${untracked.length > 1 ? 's' : ''} left alone)` : ''}`);

const main = git(repo, 'rev-parse', 'refs/heads/main');
if (!ok(repo, 'rev-parse', '--verify', '--quiet', `${options.expect}^{commit}`)) fail(`--expect ${options.expect} is not a known commit`);
const expected = git(repo, 'rev-parse', `${options.expect}^{commit}`);
if (main !== expected) fail(`main is ${main.slice(0, 8)}, expected ${expected.slice(0, 8)}: main moved since your gates ran`);
pass(`main is the expected ${main.slice(0, 8)}`);

if (!ok(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)) fail(`no local branch ${branch}`);
const tip = git(repo, 'rev-parse', `refs/heads/${branch}`);
if (tip === main) fail(`${branch} is already at main (${main.slice(0, 8)}); nothing to fast-forward`);
if (!ok(repo, 'merge-base', '--is-ancestor', main, tip)) fail(`main ${main.slice(0, 8)} is not an ancestor of ${branch} ${tip.slice(0, 8)}: merge main into the branch and rerun the gates`);
const count = git(repo, 'rev-list', '--count', `${main}..${tip}`);
pass(`main is an ancestor of ${branch} (${count} new commit${count === '1' ? '' : 's'})`);

const show = (ref, path) => spawnSync('git', ['-C', repo, 'show', `${ref}:${path}`], { encoding: 'utf8' }).stdout || null;
const protocol = evaluateProtocol({
  targetLabel: 'main', mergeBase: main, allowUnbumpedWire: !!options['allow-unbumped-wire'],
  changed: git(repo, 'diff', '--name-only', '--no-renames', main, tip).split('\n').filter(Boolean),
  read: (ref, path) => show(ref === 'target' ? main : ref, path), readHead: path => show(tip, path),
});
if (!protocol.ok) fail(`protocol: ${protocol.errors.join(' ')}`);
pass(`protocol: ${protocol.notes.join('; ')}`);

if (options['dry-run']) { console.log(`dry run: would fast-forward main ${main.slice(0, 8)} -> ${tip.slice(0, 8)}`); process.exit(0); }
const merge = spawnSync('git', ['-C', repo, 'merge', '--ff-only', branch], { stdio: 'inherit' });
if (merge.status !== 0) fail('git merge --ff-only failed (an untracked file in the way?)');
const after = git(repo, 'rev-parse', 'refs/heads/main');
if (after !== tip) { console.error(`✗ main is ${after.slice(0, 8)} after the merge, expected ${tip.slice(0, 8)}; inspect ${repo}`); process.exit(1); }
console.log(`main fast-forwarded ${main.slice(0, 8)} -> ${after.slice(0, 8)} (${branch}). Not pushed.`);
