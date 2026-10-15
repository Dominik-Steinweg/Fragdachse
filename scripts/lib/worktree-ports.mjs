// Port registry shared by every worktree of this repository: one Vite port per worktree for dev
// servers and capture runs. It lives in the git common dir (never versioned, same file for all
// worktrees). Ports start at 8098; 8090 belongs to a foreign process and is never handed out.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

export const FIRST_PORT = 8098;
export const LAST_PORT = 8199;
export const RESERVED_PORTS = new Set([8090]);

/** Absolute, slash-normalised and on Windows case-folded, so registry keys compare reliably. */
export const normalizePath = path => {
  const absolute = resolve(path).replaceAll('\\', '/');
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
};

export function registryPath(cwd) {
  const common = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  return resolve(cwd, common, 'fragdachse-worktree-ports.json');
}

export function readRegistry(cwd) {
  const file = registryPath(cwd);
  try { return { file, data: JSON.parse(readFileSync(file, 'utf8')) }; }
  catch { return { file, data: { version: 1, ports: {} } }; }
}

/** True when nothing listens on the port, checked on loopback and on all interfaces. */
export async function isPortFree(port) {
  for (const host of ['127.0.0.1', '0.0.0.0']) {
    const free = await new Promise(done => {
      const server = createServer().once('error', () => done(false));
      server.listen({ host, port, exclusive: true }, () => server.close(() => done(true)));
    });
    if (!free) return false;
  }
  return true;
}

async function withLock(file, action) {
  const lock = `${file}.lock`;
  for (let attempt = 0; ; attempt++) {
    try { closeSync(openSync(lock, 'wx')); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // A crashed run leaves its lock behind; it never takes more than a few seconds.
      if (Date.now() - statSync(lock, { throwIfNoEntry: false })?.mtimeMs > 30000) rmSync(lock, { force: true });
      else if (attempt > 100) throw Error(`Port registry is locked: ${lock}`);
      else await new Promise(done => setTimeout(done, 100));
    }
  }
  try { return await action(); } finally { rmSync(lock, { force: true }); }
}

const prune = data => {
  for (const [port, entry] of Object.entries(data.ports)) if (!existsSync(entry.path)) delete data.ports[port];
};

/** The registered port of a worktree, or null. */
export function portOf(cwd, worktree = cwd) {
  const key = normalizePath(worktree);
  const entry = Object.entries(readRegistry(cwd).data.ports).find(([, value]) => normalizePath(value.path) === key);
  return entry ? Number(entry[0]) : null;
}

/** Keeps an existing assignment; otherwise the first registered-free and actually free port. */
export async function assignPort(cwd, worktree, branch) {
  return withLock(registryPath(cwd), async () => {
    const { file, data } = readRegistry(cwd);
    prune(data);
    const key = normalizePath(worktree);
    const own = Object.entries(data.ports).find(([, value]) => normalizePath(value.path) === key);
    if (own) return Number(own[0]);
    for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
      if (RESERVED_PORTS.has(port) || data.ports[port] || !(await isPortFree(port))) continue;
      data.ports[port] = { path: resolve(worktree).replaceAll('\\', '/'), branch, assignedAt: new Date().toISOString() };
      writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
      return port;
    }
    throw Error(`No free port in ${FIRST_PORT}..${LAST_PORT}`);
  });
}

/** Removes the worktree's assignment (and entries of worktrees that no longer exist). */
export async function releasePort(cwd, worktree) {
  return withLock(registryPath(cwd), async () => {
    const { file, data } = readRegistry(cwd);
    const key = normalizePath(worktree);
    let released = null;
    for (const [port, entry] of Object.entries(data.ports)) if (normalizePath(entry.path) === key) { released = Number(port); delete data.ports[port]; }
    prune(data);
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    return released;
  });
}
