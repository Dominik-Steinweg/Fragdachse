import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import { normalizeCoopDefenseMapConfig } from '../src/config/coopDefenseMapAuthoring';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';
import { generatePreview } from '../tools/map-editor/client/preview/generate';
import { geometryRevision, PreviewController } from '../tools/map-editor/client/preview/PreviewController';
import { MapDocumentSession } from '../tools/map-editor/client/document/MapDocumentSession';
import { mapObjects, moveMapObject } from '../tools/map-editor/client/map/objects';
import { clone, type JsonObject } from '../tools/map-editor/shared/json';
import { planTutorialSweep } from '../src/systems/CoopDefenseAirstrikeEventHandler';
import { applyArenaMetricsForMode, CELL_SIZE } from '../src/config';
import { COOP_DEFENSE_ENEMY_KINDS, getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { activeSpawnFronts } from '../tools/map-editor/shared/spawns';

const raw = () => JSON.parse(readFileSync(new URL('../src/config/coopDefenseMaps/11-bombergeschwader.json', import.meta.url), 'utf8'));
afterEach(() => { vi.unstubAllGlobals(); applyArenaMetricsForMode('deathmatch', 'LOBBY'); });

describe('map editor geometry and real generator', () => {
  const contentMap = (): JsonObject => ({ mapId: 'editor-content-test', balanceReferenceDurationSec: 60, objective: 'survive', surviveDurationSec: 60, respawnsPerPlayer: 0, bases: [], powerUps: [], rockFillRatio: 0, treeCount: 0 });
  const sessionFor = (document: JsonObject) => new MapDocumentSession('map.json', { sourceKey: 'map.json', mapId: String(document.mapId), document, revision: 'r', text: JSON.stringify(document) });
  it('shows only defined map fronts while retaining separate spawn areas and every source reference', () => {
    const document = contentMap(); document.arenaWidthCells = 100; document.arenaHeightCells = 50;
    document.encounters = [{ id: 'waves', groups: [
      { enemyKind: 'zombie-badger', count: 1 },
      { enemyKind: 'zombie-badger', count: 2, front: 'north' },
      { enemyKind: 'zombie-badger', count: 3, front: 'north' },
      { enemyKind: 'zombie-badger', count: 4, spawnArea: { gridX: 3, gridY: 4, widthCells: 5, heightCells: 6 } },
    ] }];
    document.persistentSpawns = [
      { id: 'east-source', enemyKind: 'zombie-badger', countPerTick: 1, source: { type: 'map' }, front: 'east' },
      { id: 'base-source', enemyKind: 'zombie-badger', countPerTick: 1, source: { type: 'base', baseId: 'base' }, front: 'south' },
    ];
    document.boss = { enemyKind: COOP_DEFENSE_ENEMY_KINDS.find(kind => getCoopDefenseEnemyConfig(kind).isBoss)! };
    const session = sessionFor(document), before = clone(document), items = mapObjects(session);
    const fronts = items.filter(item => item.kind === 'front');
    expect(fronts.map(item => item.front)).toEqual(['west', 'north', 'east']);
    expect(fronts.find(item => item.front === 'north')).toMatchObject({ x: 0, y: 0, w: 100, h: 1, sources: [{ path: ['encounters', 0, 'groups', 1, 'front'] }, { path: ['encounters', 0, 'groups', 2, 'front'] }] });
    expect(fronts.find(item => item.front === 'east')).toMatchObject({ x: 99, y: 0, w: 1, h: 50 });
    expect(fronts.find(item => item.front === 'west')?.sources).toHaveLength(2);
    expect(items.filter(item => item.layer === 'spawns')).toHaveLength(1);
    moveMapObject(session.draft, fronts[0], 2, 3); expect(session.draft).toEqual(before);
    session.change(['encounters', 0, 'groups', 1, 'front'], 'south');
    expect(activeSpawnFronts(session.draft).map(item => item.front)).toEqual(['west', 'north', 'east', 'south']);
    session.removeIndices(['encounters', 0, 'groups'], [1, 2]);
    expect(activeSpawnFronts(session.draft).map(item => item.front)).toEqual(['west', 'east']);
    session.undo(); expect(activeSpawnFronts(session.draft).map(item => item.front)).toContain('south');
  });
  it('accounts for edge-burrow enemies even when an ineffective spawn area is authored', () => {
    const kind = COOP_DEFENSE_ENEMY_KINDS.find(kind => getCoopDefenseEnemyConfig(kind).burrow?.spawnBurrowedAtEdge)!;
    expect(kind).toBeDefined();
    const document = contentMap(); document.encounters = [{ id: 'edge', groups: [{ enemyKind: kind, count: 1, spawnArea: { gridX: 5, gridY: 5, widthCells: 3, heightCells: 3 } }] }];
    expect(activeSpawnFronts(document).map(item => item.front)).toEqual(['west']);
  });
  it('disables the entire railway reservation while retaining its position and rejecting train events', () => {
    const document = contentMap(); document.trackMode = 'none'; document.trackPosition = { kind: 'grid', gridX: 10 };
    document.waterAreas = [{ gridX: 10, gridY: 5, widthCells: 2, heightCells: 2 }];
    const result = generatePreview(document, 1234);
    expect(result.layout.tracks).toEqual([]); expect(result.layout.water).toHaveLength(4);
    document.trackMode = 'rails'; expect(() => generatePreview(document, 1234)).toThrow(/railway/);
    document.trackMode = 'none'; document.mapEvents = [{ id: 'train', type: 'train', start: { type: 'time', atMs: 0 } }];
    expect(() => generatePreview(document, 1234)).toThrow(/train event but no rails/);
  });
  it('moves railways horizontally and regenerates at the authored column', () => {
    const session = sessionFor(contentMap()), preview = generatePreview(session.draft, 1234);
    const item = mapObjects(session, session.draft, preview).find(i => i.kind === 'track')!;
    session.transact('drag', draft => moveMapObject(draft, item, 3, 5));
    expect(session.draft.trackPosition).toEqual({ kind: 'grid', gridX: item.x + 3 });
    const moved = generatePreview(session.draft, 1234);
    expect(moved.layout.tracks.every(track => track.gridX === item.x + 3)).toBe(true);
    session.undo(); expect(session.draft.trackPosition).toBeUndefined();
  });
  it('pins automatic power-ups to dragged cells and preserves linked offsets, unknown fields and undo', () => {
    const document = contentMap(); document.trackMode = 'none';
    document.powerUps = [{ defId: 'ARMOR', region: 'middle', respawnMs: 5000, extension: 'keep' }];
    const session = sessionFor(document), preview = generatePreview(document, 1234);
    const item = mapObjects(session, session.draft, preview).find(i => i.kind === 'powerup')!;
    expect(item.hidden).toBe(false);
    session.transact('drag', draft => moveMapObject(draft, item, 1, 0));
    (session.draft.powerUps as JsonObject[])[0].defId = 'HEALTH_PACK';
    const moved = generatePreview(session.draft, 1234);
    expect(moved.layout.powerUpPedestals[0]).toMatchObject({ defId: 'HEALTH_PACK', gridX: item.x + 1, gridY: item.y });
    expect((session.draft.powerUps as JsonObject[])[0].extension).toBe('keep');
    session.undo(); expect(session.draft).toEqual(document);
    session.draft.bases = [{ id: 'b', anchor: { kind: 'grid', gridX: 10, gridY: 10 }, shape: { kind: 'rectangle', widthCells: 2, heightCells: 2 }, powerUpPedestals: [{ id: 'p', defId: 'ARMOR', cellOffset: { gridX: 2, gridY: 0 } }] }];
    const linked = mapObjects(session).find(i => i.id === 'base-powerup:b:p')!;
    expect(linked.x).toBe(12); expect(linked.y).toBe(10);
    moveMapObject(session.draft, linked, 3, -1);
    expect(mapObjects(session).find(i => i.id === linked.id)).toMatchObject({ x: 15, y: 9 });
  });
  it('uses the same full map and explicit metrics as runtime generation', () => {
    const draft = raw(), normalized = normalizeCoopDefenseMapConfig(clone(draft));
    const metrics = resolveCoopDefenseWorldMetrics(normalized.arenaWidthCells, normalized.arenaHeightCells);
    const expected = ArenaGenerator.generate(123456, resolveArenaGenerationInput('coop_defense', metrics), normalized);
    applyArenaMetricsForMode('deathmatch', 'LOBBY');
    const actual = generatePreview(draft, 123456);
    expect(actual.fingerprint).toBe(ArenaGenerator.fingerprint(expected)); expect(actual.layout).toEqual(expected);
  });
  it('does not invalidate for quantity/timing changes but does for source geometry and membership', () => {
    const draft = raw(), original = geometryRevision(draft);
    draft.encounters[0].groups[0].count += 1; draft.encounters[0].groups[0].delayMs = 999;
    expect(geometryRevision(draft)).toBe(original);
    draft.encounters[0].groups[0].front = 'east'; expect(geometryRevision(draft)).not.toBe(original);
    const changed = geometryRevision(draft); draft.encounters[0].groups.push(clone(draft.encounters[0].groups[0]));
    expect(geometryRevision(draft)).not.toBe(changed);
  });
  it('moves a tutorial through its real anchor in one undoable transaction', () => {
    const document = raw(); document.tutorialAnchor = { gridX: 15, gridY: 5 };
    const session = new MapDocumentSession('map.json', { sourceKey: 'map.json', mapId: document.mapId, document, revision: 'r', text: JSON.stringify(document) });
    const item = mapObjects(session).find(i => i.id === 'tutorial:main')!;
    session.transact('drag', draft => moveMapObject(draft, item, 4, 2));
    expect(session.draft.tutorialAnchor).toEqual({ gridX: 19, gridY: 7 });
    session.undo(); expect(session.draft).toEqual(document);
  });
  it('positions tutorial airstrikes relative to authored anchors regardless of active globals', () => {
    const metrics = resolveCoopDefenseWorldMetrics(120, 50);
    const before = planTutorialSweep(120, 50, false, 3, () => .5, metrics, { gridX: 30, gridY: 10 });
    applyArenaMetricsForMode('deathmatch', 'LOBBY');
    const after = planTutorialSweep(120, 50, false, 3, () => .5, metrics, { gridX: 40, gridY: 15 });
    after.forEach((point, i) => { expect(point.x - before[i].x).toBeCloseTo(10 * CELL_SIZE); expect(point.y - before[i].y).toBeCloseTo(5 * CELL_SIZE); });
  });
  it('discards cancelled worker jobs and runs a bounded variant sequence', async () => {
    const workers: FakeWorker[] = [];
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      stopped = false;
      constructor() { workers.push(this); }
      terminate() { this.stopped = true; }
      postMessage() {}
      finish(seed: number) { this.onmessage?.({ data: { result: { requestedSeed: seed } } }); }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new PreviewController(), old = vi.fn(), current = vi.fn();
    const a = controller.run(raw(), 1, 1, old);
    const b = controller.run(raw(), 2, 2, current);
    workers[0].finish(1); workers[1].finish(2);
    await vi.waitFor(() => expect(workers).toHaveLength(3)); workers[2].finish(3);
    await Promise.all([a, b]); expect(old).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledTimes(2); expect(controller.busy).toBe(false);
  });
});
