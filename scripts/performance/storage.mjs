import { createHash, randomUUID } from 'node:crypto';
import { copyFile, link, lstat, mkdir, readFile, readdir, rename, statfs, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';

export const MINIMUM_FREE_BYTES = 1024 ** 3;
// Leave room for the failure manifest, Chrome cleanup and concurrent OS writes.
export const DISK_HEADROOM_BYTES = 128 * 1024 ** 2;

export async function checkDiskSpace(path, additionalBytes = 0, readStats = statfs) {
  const disk = await readStats(path);
  const freeBytes = disk.bavail * disk.bsize;
  const requiredBytes = MINIMUM_FREE_BYTES + DISK_HEADROOM_BYTES + additionalBytes;
  if (freeBytes < requiredBytes) {
    const error = new Error(`Performance-Lab: zu wenig freier Speicher (${(freeBytes / 1024 ** 3).toFixed(2)} GiB); 1 GiB Reserve plus Schreibbedarf müssen frei bleiben.`);
    error.code = 'PERF_DISK_SPACE';
    throw error;
  }
  return freeBytes;
}

/** Only completed private blob copies are linked. Never link a mutable working file. */
export function createBuildStorage(objectDirectory, buildDirectory, checkSpace = async () => {}, signal) {
  const root = resolve(buildDirectory);
  const statistics = { logicalBytes: 0, storedBytes: 0, reusedBytes: 0, linkedFiles: 0, copiedFiles: 0 };
  const withinBuild = path => {
    const name = relative(root, resolve(path));
    if (!name || name === '..' || name.startsWith(`..\\`) || name.startsWith('../') || isAbsolute(name)) throw new Error('Archive path escapes build directory');
  };
  const archiveFile = async (source, target) => {
    signal?.throwIfAborted();
    withinBuild(target);
    const info = await lstat(source);
    if (!info.isFile()) throw new Error(`Only regular files can be archived: ${source}`);
    const data = await readFile(source);
    const hash = createHash('sha256').update(data).digest('hex');
    const blob = join(objectDirectory, hash.slice(0, 2), hash.slice(2));
    await mkdir(dirname(blob), { recursive: true });
    let exists = false;
    try { const cached = await lstat(blob); exists = cached.isFile() && cached.size === data.length; if (!exists) throw new Error(`Invalid cached build object: ${blob}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!exists) {
      await checkSpace(data.length);
      const temporary = `${blob}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, data, { flag: 'wx' });
        try { await rename(temporary, blob); statistics.storedBytes += data.length; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    } else statistics.reusedBytes += data.length;
    await mkdir(dirname(target), { recursive: true });
    signal?.throwIfAborted();
    // A failed build may be retried. Replace its directory entry atomically instead
    // of writing through a shared hardlink or losing the old file on a failed copy.
    try {
      const previous = await lstat(target);
      if (!previous.isFile()) throw new Error(`Archive target is not a regular file: ${target}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const replacement = `${target}.${randomUUID()}.tmp`;
    try {
      try { await link(blob, replacement); statistics.linkedFiles++; }
      catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EMLINK'].includes(error.code)) throw error;
        await checkSpace(data.length);
        await copyFile(blob, replacement); statistics.copiedFiles++; statistics.storedBytes += data.length;
      }
      signal?.throwIfAborted();
      await rename(replacement, target);
    } finally {
      await unlink(replacement).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    statistics.logicalBytes += data.length;
  };
  const archiveTree = async (source, target) => {
    signal?.throwIfAborted();
    const info = await lstat(source);
    if (info.isDirectory()) {
      for (const entry of (await readdir(source)).sort()) await archiveTree(join(source, entry), join(target, entry));
    } else await archiveFile(source, target);
  };
  return { statistics, archiveTree, deduplicateTree: path => archiveTree(path, path) };
}
