import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { MapFileStore } from '../tools/map-editor/server/MapFileStore';
import { validateDocument } from '../tools/map-editor/shared/validation';
import { clone, set } from '../tools/map-editor/shared/json';
import { assertSupportedMapEdit } from '../tools/map-editor/shared/editPolicy';
import { generatePreview } from '../tools/map-editor/client/preview/generate';
import { MAX_PERSISTENT_BASE_RADIUS_CELLS, PERSISTENT_BASE_CLEARANCE_CELLS } from '../src/config/persistentBase';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    const parent = resolve(tmpdir());
    if (relative(parent, resolve(folder)).startsWith('..') || !folder.includes('fd-map-editor-')) throw Error('Unexpected test path');
    await rm(folder, { recursive: true, force: true });
  }
});
async function setup(replace?: ConstructorParameters<typeof MapFileStore>[3], source = '00-test.json') {
  const directory = await mkdtemp(join(tmpdir(), 'fd-map-editor-')); folders.push(directory);
  const text = await readFile(new URL(`../src/config/coopDefenseMaps/${source}`, import.meta.url), 'utf8');
  await writeFile(join(directory, 'map.json'), text);
  const store = new MapFileStore(directory, [{ file: 'map.json', mapId: JSON.parse(text).mapId }], validateDocument, replace);
  return { store, directory, original: text, loaded: await store.load('map.json') };
}
describe('Map editor local file replacement', () => {
  it('round-trips fire-front bounds and times without materializing defaults or replacing protected effect fields', async () => {
    const { store, loaded, directory } = await setup(undefined, '14-brandschneise.json');
    const next = clone(loaded.document);
    set(next, ['mapEvents', 0, 'area', 'widthCells'], 25);
    set(next, ['mapEvents', 0, 'area', 'heightCells'], 30);
    set(next, ['mapEvents', 0, 'start', 'atMs'], 12500);
    set(next, ['mapEvents', 0, 'delayMs'], undefined);
    set(next, ['mapEvents', 0, 'spread', 'durationMs'], 45000);
    set(next, ['mapEvents', 0, 'spread', 'warningLeadMs'], 1000);
    set(next, ['mapEvents', 0, 'effect', 'burnDurationMs'], 2500);
    const saved = await store.save('map.json', loaded.revision, next);
    expect((await store.load('map.json')).document).toEqual(next);
    expect(JSON.parse(await readFile(join(directory, 'map.json'), 'utf8'))).toEqual(next);
    const invalid = clone(next); set(invalid, ['mapEvents', 0, 'spread', 'durationMs'], 0);
    await expect(store.save('map.json', saved.revision, invalid)).rejects.toThrow(/spread/);
    expect((await store.load('map.json')).document).toEqual(next);
  });
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
  it('round-trips new power-up anchors and disabled tracks through the protected writer', async () => {
    const { store, loaded } = await setup();
    const next = clone(loaded.document); next.trackMode = 'none'; next.trackPosition = { kind: 'grid', gridX: 12 };
    next.powerUps = [{ defId: 'HEALTH_PACK', region: 'middle', anchor: { gridX: 15, gridY: 8 }, respawnMs: 5000 }];
    const saved = await store.save('map.json', loaded.revision, next);
    expect((await store.load('map.json')).document).toEqual(next);
    const removed = clone(saved.document); removed.powerUps = [];
    expect((await store.save('map.json', saved.revision, removed)).document.powerUps).toEqual([]);
  });
  it.each([false, true])('uses the same water clearance for saving and previews (persistent: %s)', async persistent => {
    const { store, directory } = await setup();
    const fixture = {
      mapId: '0', arenaWidthCells: 60, arenaHeightCells: 40, balanceReferenceDurationSec: 60,
      objective: 'survive', surviveDurationSec: 60, respawnsPerPlayer: 0,
      trackMode: 'none', rockFillRatio: 0, treeCount: 0, powerUps: [],
      bases: persistent ? [] : [{ id: 'outpost', role: 'outpost', hpMax: 100,
        anchor: { kind: 'grid', gridX: 30, gridY: 20 },
        shape: { kind: 'rectangle', widthCells: 3, heightCells: 3 } }],
      ...(persistent ? { persistentBase: { baseId: 'home', anchor: { gridX: 30, gridY: 20 } } } : {}),
    };
    await writeFile(join(directory, 'map.json'), JSON.stringify(fixture));
    const loaded = await store.load('map.json');
    const allowedX = persistent ? 30 + MAX_PERSISTENT_BASE_RADIUS_CELLS + PERSISTENT_BASE_CLEARANCE_CELLS + 1 : 34;
    const next = clone(loaded.document);
    next.waterAreas = [{ gridX: allowedX, gridY: 20, widthCells: 1, heightCells: 1 }];
    const saved = await store.save('map.json', loaded.revision, next);
    expect(generatePreview(next, 183).layout.water).toEqual([{ gridX: allowedX, gridY: 20 }]);
    expect((await store.load('map.json')).document).toEqual(next);
    const invalid = clone(next);
    invalid.waterAreas = [{ gridX: allowedX - 1, gridY: 20, widthCells: 1, heightCells: 1 }];
    const issue = validateDocument(invalid).issues.find(issue => issue.severity === 'error')!;
    expect(issue.message).toMatch(/Water overlaps/);
    const message = `${issue.path}: ${issue.message}`;
    expect(() => generatePreview(invalid, 183)).toThrow(message);
    await expect(store.save('map.json', saved.revision, invalid)).rejects.toThrow(message);
    expect((await store.load('map.json')).document).toEqual(next);
  });
  it('retains the original if atomic replacement fails and removes the prepared temporary file', async () => {
    const replace = vi.fn(async () => { throw Error('Sharing violation'); });
    const { store, loaded, directory, original } = await setup(replace);
    const next = clone(loaded.document); next.treeCount = Number(next.treeCount ?? 3) + 1;
    await expect(store.save('map.json', loaded.revision, next)).rejects.toThrow('Sharing violation');
    expect(await readFile(join(directory, 'map.json'), 'utf8')).toBe(original);
    expect(await readdir(directory)).toEqual(['map.json']);
  });
  it('saves permanent sources and planning duration without changing the mission timer or writing optional defaults', async () => {
    const { store, loaded } = await setup();
    const next = clone(loaded.document); next.balanceReferenceDurationSec = 120;
    next.persistentSpawns = [{ id: 'pressure', enemyKind: 'zombie-badger', countPerTick: 2, intervalMs: 5000, source: { type: 'map' }, front: 'north' }];
    const saved = await store.save('map.json', loaded.revision, next);
    expect((await store.load('map.json')).document).toEqual(next);
    expect(saved.document.surviveDurationSec).toEqual(loaded.document.surviveDurationSec);
    expect((saved.document.persistentSpawns as object[])[0]).not.toHaveProperty('startAtMs');
    const removed = clone(saved.document); removed.persistentSpawns = [];
    expect((await store.save('map.json', saved.revision, removed)).document.persistentSpawns).toEqual([]);
  });
  it('serializes competing saves so that only one matching baseline wins', async () => {
    const { store, loaded } = await setup();
    const a = clone(loaded.document), b = clone(loaded.document); a.treeCount = 8; b.treeCount = 9;
    const results = await Promise.allSettled([store.save('map.json', loaded.revision, a), store.save('map.json', loaded.revision, b)]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((await store.load('map.json')).document.treeCount).toBe(8);
  });
  it('uses the current edit rules for each save while still protecting unsupported fields', async () => {
    const { directory, loaded, original } = await setup();
    let checkEdit: typeof assertSupportedMapEdit = () => { throw Error('Schreibgeschütztes Feld geändert: /persistentSpawns'); };
    const store = new MapFileStore(directory, [{ file: 'map.json', mapId: '0' }], validateDocument, undefined, (before, after) => checkEdit(before, after));
    const next = clone(loaded.document);
    next.persistentSpawns = [{ id: 'pressure', enemyKind: 'zombie-badger', intervalMs: 5000, countPerTick: 1, source: { type: 'map' } }];
    await expect(store.save('map.json', loaded.revision, next)).rejects.toThrow('/persistentSpawns');
    expect(await readFile(join(directory, 'map.json'), 'utf8')).toBe(original);
    checkEdit = assertSupportedMapEdit;
    const saved = await store.save('map.json', loaded.revision, next);
    expect(saved.document).toEqual(next);
    const unsupported = clone(next); unsupported.respawnsPerPlayer = Number(next.respawnsPerPlayer ?? 0) + 1;
    await expect(store.save('map.json', saved.revision, unsupported)).rejects.toThrow('Schreibgeschützt');
    expect((await store.load('map.json')).document).toEqual(next);
  });
  it('rejects file traversal and writes outside the supported editing surface', async () => {
    const { store, loaded } = await setup();
    await expect(store.load('../map.json')).rejects.toThrow('Unbekannte');
    const next = clone(loaded.document); next.respawnsPerPlayer = Number(next.respawnsPerPlayer ?? 0) + 1;
    await expect(store.save('map.json', loaded.revision, next)).rejects.toThrow('Schreibgeschützt');
  });
});
