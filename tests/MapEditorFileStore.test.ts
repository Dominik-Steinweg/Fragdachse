import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { MapFileStore } from '../tools/map-editor/server/MapFileStore';
import { validateDocument } from '../tools/map-editor/shared/validation';
import { clone } from '../tools/map-editor/shared/json';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    const parent = resolve(tmpdir());
    if (relative(parent, resolve(folder)).startsWith('..') || !folder.includes('fd-map-editor-')) throw Error('Unexpected test path');
    await rm(folder, { recursive: true, force: true });
  }
});
async function setup(replace?: ConstructorParameters<typeof MapFileStore>[3]) {
  const directory = await mkdtemp(join(tmpdir(), 'fd-map-editor-')); folders.push(directory);
  const text = await readFile(new URL('../src/config/coopDefenseMaps/00-test.json', import.meta.url), 'utf8');
  await writeFile(join(directory, 'map.json'), text);
  const store = new MapFileStore(directory, [{ file: 'map.json', mapId: '0' }], validateDocument, replace);
  return { store, directory, original: text, loaded: await store.load('map.json') };
}
describe('Map editor local file replacement', () => {
  it('does not touch an unchanged file and saves the authoring document without defaults', async () => {
    const { store, loaded, directory } = await setup();
    expect(await store.save('map.json', loaded.revision, loaded.document)).toEqual(loaded);
    const next = clone(loaded.document); next.treeCount = Number(next.treeCount ?? 3) + 1;
    const saved = await store.save('map.json', loaded.revision, next);
    expect(saved.document).toEqual(next); expect(saved.revision).not.toBe(loaded.revision);
    expect(JSON.parse(await readFile(join(directory, 'map.json'), 'utf8'))).toEqual(next);
    expect(await readdir(directory)).toEqual(['map.json']);
  });
  it('retains external edits and rejects stale revisions', async () => {
    const { store, loaded, directory, original } = await setup();
    const externallyEdited = original + '\n'; await writeFile(join(directory, 'map.json'), externallyEdited);
    const next = clone(loaded.document); next.treeCount = 1;
    await expect(store.save('map.json', loaded.revision, next)).rejects.toMatchObject({ status: 409 });
    expect(await readFile(join(directory, 'map.json'), 'utf8')).toBe(externallyEdited);
  });
  it('retains the original if atomic replacement fails and removes the prepared temporary file', async () => {
    const replace = vi.fn(async () => { throw Error('Sharing violation'); });
    const { store, loaded, directory, original } = await setup(replace);
    const next = clone(loaded.document); next.treeCount = Number(next.treeCount ?? 3) + 1;
    await expect(store.save('map.json', loaded.revision, next)).rejects.toThrow('Sharing violation');
    expect(await readFile(join(directory, 'map.json'), 'utf8')).toBe(original);
    expect(await readdir(directory)).toEqual(['map.json']);
  });
  it('serializes competing saves so that only one matching baseline wins', async () => {
    const { store, loaded } = await setup();
    const a = clone(loaded.document), b = clone(loaded.document); a.treeCount = 8; b.treeCount = 9;
    const results = await Promise.allSettled([store.save('map.json', loaded.revision, a), store.save('map.json', loaded.revision, b)]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((await store.load('map.json')).document.treeCount).toBe(8);
  });
  it('rejects file traversal and writes outside the supported editing surface', async () => {
    const { store, loaded } = await setup();
    await expect(store.load('../map.json')).rejects.toThrow('Unbekannte');
    const next = clone(loaded.document); next.balanceReferenceDurationSec = 1;
    await expect(store.save('map.json', loaded.revision, next)).rejects.toThrow('Schreibgeschützt');
  });
});
