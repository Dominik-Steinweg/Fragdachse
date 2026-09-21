import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import { normalizeCoopDefenseMapConfig } from '../src/config/coopDefenseMapAuthoring';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';
import { generatePreview } from '../tools/map-editor/client/preview/generate';
import { geometryRevision, PreviewController } from '../tools/map-editor/client/preview/PreviewController';
import { MapDocumentSession } from '../tools/map-editor/client/document/MapDocumentSession';
import { mapObjects, moveMapObject } from '../tools/map-editor/client/map/objects';
import { clone } from '../tools/map-editor/shared/json';
import { planTutorialSweep } from '../src/systems/CoopDefenseAirstrikeEventHandler';
import { applyArenaMetricsForMode, CELL_SIZE } from '../src/config';

const raw = () => JSON.parse(readFileSync(new URL('../src/config/coopDefenseMaps/11-bombergeschwader.json', import.meta.url), 'utf8'));
afterEach(() => { vi.unstubAllGlobals(); applyArenaMetricsForMode('deathmatch', 'LOBBY'); });

describe('map editor geometry and real generator', () => {
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
