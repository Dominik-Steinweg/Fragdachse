import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import sources from '../src/config/coopDefenseMapSources.json';
import { MapDocumentSession, type LoadedMap } from '../tools/map-editor/client/document/MapDocumentSession';
import { validateDocument } from '../tools/map-editor/shared/validation';
import { assertSupportedMapEdit } from '../tools/map-editor/shared/editPolicy';
import { updateJsonText } from '../tools/map-editor/server/jsonText';
import { collectCoopDefenseMapReferences } from '../src/config/coopDefenseMapReferences';
import { clone, type JsonObject } from '../tools/map-editor/shared/json';

function load(file = sources.maps[0].file): LoadedMap {
  const text = readFileSync(new URL(`../src/config/coopDefenseMaps/${file}`, import.meta.url), 'utf8');
  const document = JSON.parse(text);
  return { text, document, revision: 'original', sourceKey: file, mapId: document.mapId };
}

describe('Map editor authoring documents', () => {
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
