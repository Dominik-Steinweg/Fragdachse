import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import sources from '../src/config/coopDefenseMapSources.json';
import { MapDocumentSession, type LoadedMap } from '../tools/map-editor/client/document/MapDocumentSession';
import { validateDocument } from '../tools/map-editor/shared/validation';
import { assertSupportedMapEdit } from '../tools/map-editor/shared/editPolicy';
import { updateJsonText } from '../tools/map-editor/server/jsonText';
import { collectCoopDefenseMapReferences } from '../src/config/coopDefenseMapReferences';
import { at, clone, object, set, type JsonObject } from '../tools/map-editor/shared/json';
import { activeSpawnFronts, setGroupSpawn, setPersistentSpawnSource } from '../tools/map-editor/shared/spawns';

function load(file = sources.maps[0].file): LoadedMap {
  const text = readFileSync(new URL(`../src/config/coopDefenseMaps/${file}`, import.meta.url), 'utf8');
  const document = JSON.parse(text);
  return { text, document, revision: 'original', sourceKey: file, mapId: document.mapId };
}

describe('Map editor authoring documents', () => {
  it('accepts optional fog strength and validates its shared range', () => {
    const loaded = load(), draft = clone(loaded.document); draft.fogStrength = 0;
    expect(() => assertSupportedMapEdit(loaded.document, draft)).not.toThrow();
    expect(validateDocument(draft).issues.filter(i => i.severity === 'error')).toEqual([]);
    draft.fogStrength = 2.1; expect(validateDocument(draft).issues.some(i => i.severity === 'error')).toBe(true);
    delete draft.fogStrength; expect(validateDocument(draft).issues.filter(i => i.severity === 'error')).toEqual([]);
  });
  it('edits only fire-front geometry and timing while retaining event identity, behavior and extensions', () => {
    const loaded = load('14-brandschneise.json');
    const event = object(at(loaded.document, ['mapEvents', 0]));
    event.extension = { keep: true }; object(event.area).extension = 'keep'; object(event.spread).extension = 'keep';
    const session = new MapDocumentSession(loaded.sourceKey, loaded);
    session.transact('Feuerfront', draft => {
      set(draft, ['mapEvents', 0, 'area', 'widthCells'], 25);
      set(draft, ['mapEvents', 0, 'start', 'atMs'], 12345);
      set(draft, ['mapEvents', 0, 'delayMs'], 1500);
      set(draft, ['mapEvents', 0, 'spread', 'durationMs'], 45000);
      set(draft, ['mapEvents', 0, 'spread', 'warningLeadMs'], 2000);
      set(draft, ['mapEvents', 0, 'spread', 'roughnessCells'], 1);
      set(draft, ['mapEvents', 0, 'effect', 'burnDurationMs'], 3500);
    });
    expect(() => assertSupportedMapEdit(loaded.document, session.draft)).not.toThrow();
    expect(validateDocument(session.draft).normalized?.mapEvents?.[0]).toMatchObject({
      start: { type: 'time', atMs: 12345 }, delayMs: 1500, area: { widthCells: 25 },
      spread: { durationMs: 45000, warningLeadMs: 2000, roughnessCells: 1 }, effect: { burnDurationMs: 3500 },
    });
    expect(object(at(session.draft, ['mapEvents', 0])).extension).toEqual({ keep: true });
    session.undo(); expect(session.draft).toEqual(loaded.document); session.redo();
    for (const path of [['id'], ['type'], ['start', 'type'], ['area', 'type'], ['area', 'baseClearanceCells'],
      ['spread', 'direction'], ['effect', 'sourceId'], ['effect', 'burnDamagePerTick'], ['spread', 'extension']]) {
      const invalid = clone(session.draft); set(invalid, ['mapEvents', 0, ...path], 'changed');
      expect(() => assertSupportedMapEdit(loaded.document, invalid)).toThrow();
    }
    const added = clone(session.draft); (added.mapEvents as JsonObject[]).push(clone(event));
    expect(() => assertSupportedMapEdit(loaded.document, added)).toThrow();
    const removed = clone(session.draft); removed.mapEvents = [];
    expect(() => assertSupportedMapEdit(loaded.document, removed)).toThrow();
    const other = clone(loaded.document); other.mapEvents = [{ id: 'train', type: 'train', start: { type: 'time', atMs: 100 } }];
    const changed = clone(other); set(changed, ['mapEvents', 0, 'start', 'atMs'], 200);
    expect(() => assertSupportedMapEdit(other, changed)).toThrow('Schreibgeschützt');
    const triggered = clone(loaded.document); set(triggered, ['mapEvents', 0, 'start'], { type: 'after-encounter', encounterId: 'wave' });
    const retimed = clone(triggered); set(retimed, ['mapEvents', 0, 'delayMs'], 2500);
    expect(() => assertSupportedMapEdit(triggered, retimed)).not.toThrow();
    set(retimed, ['mapEvents', 0, 'start', 'atMs'], 100);
    expect(() => assertSupportedMapEdit(triggered, retimed)).toThrow('Schreibgeschützt');
  });

  it('rejects invalid fire-front sizes and times before either saving or generation', () => {
    for (const [path, value] of [
      [['area', 'widthCells'], 0], [['area', 'heightCells'], 1.5], [['area', 'gridX'], -1],
      [['start', 'atMs'], -1], [['delayMs'], -1], [['spread', 'durationMs'], 0],
      [['spread', 'warningLeadMs'], -1], [['spread', 'roughnessCells'], 1000], [['effect', 'burnDurationMs'], 0],
    ] as const) {
      const draft = load('14-brandschneise.json').document;
      set(draft, ['mapEvents', 0, ...path], value);
      const result = validateDocument(draft);
      expect(result.normalized, path.join('.')).toBeUndefined();
      expect(result.issues.some(issue => issue.severity === 'error'), path.join('.')).toBe(true);
    }
  });
  it('switches permanent sources atomically, preserving extensions and updating active fronts through undo', () => {
    const loaded = load(); loaded.document.encounters = []; delete loaded.document.boss;
    loaded.document.persistentSpawns = [{ id: 'pressure', enemyKind: 'zombie-badger', intervalMs: 2000, countPerTick: 2, front: 'north', source: { type: 'map', extension: 'keep' }, extension: { keep: true } }];
    const session = new MapDocumentSession(loaded.sourceKey, loaded);
    session.transact('bind base', draft => setPersistentSpawnSource(draft, 0, 'base', 'spawn-base'));
    expect((session.draft.persistentSpawns as JsonObject[])[0]).toMatchObject({ source: { type: 'base', baseId: 'spawn-base', extension: 'keep' }, extension: { keep: true } });
    expect((session.draft.persistentSpawns as JsonObject[])[0]).not.toHaveProperty('front');
    expect(activeSpawnFronts(session.draft)).toEqual([]);
    expect(() => assertSupportedMapEdit(loaded.document, session.draft)).not.toThrow();
    session.undo(); expect(activeSpawnFronts(session.draft).map(f => f.front)).toEqual(['north']);
    session.redo(); session.transact('map source', draft => setPersistentSpawnSource(draft, 0, 'map'));
    expect((session.draft.persistentSpawns as JsonObject[])[0].source).toEqual({ type: 'map', extension: 'keep' });
    expect(activeSpawnFronts(session.draft).map(f => f.front)).toEqual(['west']);
    expect(() => assertSupportedMapEdit(loaded.document, session.draft)).not.toThrow();
    ((session.draft.persistentSpawns as JsonObject[])[0].source as JsonObject).extension = 'changed';
    expect(() => assertSupportedMapEdit(loaded.document, session.draft)).toThrow('Schreibgeschützt');
  });
  it('rejects invalid permanent spawn numbers rather than silently rounding or clamping them', () => {
    const draft = load().document;
    draft.persistentSpawns = [{ id: 'pressure', enemyKind: 'zombie-badger', countPerTick: 0, intervalMs: 0, startAtMs: -1, source: { type: 'map' } }];
    draft.balanceReferenceDurationSec = 0.5;
    const paths = validateDocument(draft).issues.filter(i => i.severity === 'error').map(i => i.path);
    expect(paths).toEqual(expect.arrayContaining(['/persistentSpawns/0/countPerTick', '/persistentSpawns/0/intervalMs', '/persistentSpawns/0/startAtMs', '/balanceReferenceDurationSec']));
  });
  it('edits repeated enemy kinds independently and switches between area and front without losing other group data', () => {
    const loaded = load();
    const area = { gridX: 3, gridY: 4, widthCells: 5, heightCells: 6 };
    loaded.document.encounters = [{ id: 'separate', groups: [
      { enemyKind: 'zombie-badger', count: 2, front: 'north', delayMs: 1000 },
      { enemyKind: 'zombie-badger', count: 3, spawnArea: area, delayMs: 2000, spawnStaggerMs: 500, extension: 'keep' },
    ] }];
    const session = new MapDocumentSession(loaded.sourceKey, loaded), path = ['encounters', 0, 'groups', 1];
    const groups = () => (session.draft.encounters as JsonObject[])[0].groups as JsonObject[];
    session.transact('front', draft => setGroupSpawn(draft, path, 'east'));
    expect(groups()[0]).toEqual({ enemyKind: 'zombie-badger', count: 2, front: 'north', delayMs: 1000 });
    expect(groups()[1]).toEqual({ enemyKind: 'zombie-badger', count: 3, front: 'east', delayMs: 2000, spawnStaggerMs: 500, extension: 'keep' });
    session.undo(); expect(groups()[1].spawnArea).toEqual(area);
    session.transact('area', draft => setGroupSpawn(draft, path, 'area'));
    expect(groups()[1].spawnArea).toEqual(area); expect(groups()[1].front).toBeUndefined();
    session.change([...path, 'delayMs'], 2500); session.change([...path, 'spawnArea', 'gridX'], 7);
    expect(groups()[0].delayMs).toBe(1000); expect(groups()[1].delayMs).toBe(2500);
    expect(groups()[1].spawnArea).toEqual({ ...area, gridX: 7 });
    expect(() => assertSupportedMapEdit(loaded.document, session.draft)).not.toThrow();
  });
  it('accepts all existing registered authoring documents without materializing defaults', () => {
    for (const source of sources.maps) {
      const { document } = load(source.file), before = clone(document);
      const result = validateDocument(document);
      expect(result.issues.filter(i => i.severity === 'error'), source.file).toEqual([]);
      expect(result.normalized).toBeDefined(); expect(document).toEqual(before);
    }
  });
  it('preserves raw water areas, missing fields and unknown fields across edits and undo', () => {
    const loaded = load(); loaded.document.extension = { futureField: ['preserve'], count: 'opaque', gridX: -99, gridY: -99 };
    expect(validateDocument(loaded.document).normalized).toBeDefined();
    const session = new MapDocumentSession(loaded.sourceKey, loaded);
    expect(session.dirty).toBe(false);
    session.change(['waterAreas'], [{ gridX: 1, gridY: 1, widthCells: 2, heightCells: 2 }]);
    expect(session.draft.extension).toEqual(loaded.document.extension);
    session.undo(); expect(session.draft).toEqual(loaded.document); expect(session.dirty).toBe(false);
    session.redo(); expect(session.draft.waterAreas).toBeDefined();
    expect(session.draft.water).toEqual(loaded.document.water);
  });
  it('acknowledges only the snapshot sent to save and retains later edits', () => {
    const loaded = load(), session = new MapDocumentSession(loaded.sourceKey, loaded);
    session.change(['treeCount'], 2); const sent = clone(session.draft);
    session.change(['treeCount'], 3); session.acceptSaved({ ...loaded, document: sent, revision: 'saved' });
    expect(session.dirty).toBe(true); session.undo(); expect(session.dirty).toBe(false);
    session.undo(); expect(session.dirty).toBe(true); expect(session.revision).toBe('saved');
  });
  it('keeps array selection keys stable after removing an earlier group, undo and encounter reordering', () => {
    const loaded = load(); loaded.document.encounters = [{ id: 'a', start: { type: 'time', atMs: 0 }, groups: [{ enemyKind: 'one', count: 1 }, { enemyKind: 'two', count: 1 }] }, { id: 'b', groups: [] }];
    const session = new MapDocumentSession(loaded.sourceKey, loaded), path = ['encounters', 0, 'groups'];
    const key = session.key(path, 1); session.splice(path, 0, 1); expect(session.key(path, 0)).toBe(key);
    session.undo(); expect(session.key(path, 1)).toBe(key);
    session.transact('reorder', d => (d.encounters as JsonObject[]).reverse());
    expect(session.key(['encounters', 1, 'groups'], 1)).toBe(key);
  });
  it('retains formatting outside a changed scalar and does not write a no-op', () => {
    const text = '{\r\n  "mapId": "x",\r\n  "treeCount": 2,\r\n  "unknown": { "a": [1,2] }\r\n}\r\n';
    const parsed = JSON.parse(text); expect(updateJsonText(text, parsed)).toBe(text);
    parsed.treeCount = 3; expect(updateJsonText(text, parsed)).toBe(text.replace('"treeCount": 2', '"treeCount": 3'));
    parsed.rockFillRatio = .3; const result = updateJsonText(text, parsed);
    expect(JSON.parse(result)).toEqual(parsed); expect(result).toContain('"unknown": { "a": [1,2] }');
    delete parsed.treeCount; expect(JSON.parse(updateJsonText(result, parsed))).toEqual(parsed);
  });
  it('removes all groups of a kind atomically without changing other selection keys or metadata', () => {
    const loaded = load();
    loaded.document.encounters = [{ id: 'a', groups: [{ enemyKind: 'one', count: 1 }, { enemyKind: 'two', count: 3, future: 'keep' }, { enemyKind: 'one', count: 2 }] }];
    const session = new MapDocumentSession(loaded.sourceKey, loaded), path = ['encounters', 0, 'groups'];
    const keptKey = session.key(path, 1);
    session.removeIndices(path, [0, 2]);
    expect((session.draft.encounters as JsonObject[])[0].groups).toEqual([{ enemyKind: 'two', count: 3, future: 'keep' }]);
    expect(session.key(path, 0)).toBe(keptKey);
    session.undo(); expect(session.draft).toEqual(loaded.document); expect(session.key(path, 1)).toBe(keptKey);
    expect(session.canUndo).toBe(false);
    session.redo(); expect(session.key(path, 0)).toBe(keptKey);
  });
  it('permits power-up and track edits while protecting linked pedestal identity and timing', () => {
    const before: JsonObject = { powerUps: [{ defId: 'ARMOR', region: 'front', respawnMs: 5000, extension: 'keep' }], bases: [{ id: 'base', powerUpPedestals: [{ id: 'p', defId: 'ARMOR', cellOffset: { gridX: 0, gridY: 0 }, respawnMs: 1000 }] }] };
    const after = clone(before);
    after.trackMode = 'none'; after.trackPosition = { kind: 'grid', gridX: 10 };
    (after.powerUps as JsonObject[])[0].anchor = { gridX: 15, gridY: 8 };
    (after.powerUps as JsonObject[])[0].defId = 'HEALTH_PACK';
    const linked = ((after.bases as JsonObject[])[0].powerUpPedestals as JsonObject[])[0];
    linked.defId = 'HEALTH_PACK'; linked.cellOffset = { gridX: -2, gridY: 3 };
    expect(() => assertSupportedMapEdit(before, after)).not.toThrow();
    linked.respawnMs = 2000; expect(() => assertSupportedMapEdit(before, after)).toThrow();
    linked.respawnMs = 1000; linked.id = 'replacement'; expect(() => assertSupportedMapEdit(before, after)).toThrow();
  });
  it('rejects unsupported edits but permits preserved extension fields and copied groups', () => {
    const before = load().document; before.extension = { keep: true };
    let after = clone(before); after.treeCount = 1; expect(() => assertSupportedMapEdit(before, after)).not.toThrow();
    after = clone(before); after.objective = 'advance'; expect(() => assertSupportedMapEdit(before, after)).toThrow('Schreibgeschützt');
    after = clone(before); delete after.extension; expect(() => assertSupportedMapEdit(before, after)).toThrow();
    before.encounters = [{ id: 'one', start: { type: 'time', atMs: 0 }, groups: [{ enemyKind: 'test', count: 1, future: 'keep' }] }];
    after = clone(before); (after.encounters as JsonObject[]).push({ ...clone((before.encounters as JsonObject[])[0]), id: 'two' });
    expect(() => assertSupportedMapEdit(before, after)).not.toThrow();
    (after.encounters as JsonObject[])[0].surprise = true;
    expect(() => assertSupportedMapEdit(before, after)).toThrow();
  });
  it('finds read-only event, checkpoint and objective references and rejects invalid quantities', () => {
    const map = load().document;
    map.encounters = [{ id: 'one', start: { type: 'time', atMs: 0 }, groups: [{ enemyKind: 'unknown', count: 1.5 }] }];
    map.mapEvents = [{ id: 'event', type: 'train', start: { type: 'after-encounter', encounterId: 'one' } }];
    map.missionProgress = { checkpoints: [{ id: 'cp', gridX: 2, gridY: 2, completeOn: { type: 'after-encounter', encounterId: 'one' } }] };
    const refs = collectCoopDefenseMapReferences(map as never);
    expect(refs.filter(r => r.kind === 'encounter').map(r => r.path)).toEqual(['/mapEvents/0/start/encounterId', '/missionProgress/checkpoints/0/completeOn/encounterId']);
    expect(validateDocument(map).issues.some(i => i.code === 'integer')).toBe(true);
  });
});
