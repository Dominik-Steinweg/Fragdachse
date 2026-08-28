import { describe, expect, it, vi } from 'vitest';
import {
  resolveWorldRenderWork,
  WORLD_LOAD_STALL_REPEAT_MS,
  WORLD_LOAD_STALL_THRESHOLD_MS,
  WorldLoadStallWatchdog,
} from '../src/scenes/arena/WorldLoadDiagnostics';
import type { ChunkedRenderWorkingSetStats } from '../src/arena/chunks/ChunkedRenderSurface';

function stats(overrides: Partial<ChunkedRenderWorkingSetStats> = {}): ChunkedRenderWorkingSetStats {
  return {
    requiredChunks: 4,
    residentChunks: 4,
    missingChunks: 0,
    notReadyChunks: 0,
    pendingRegions: 0,
    pendingTextureAcquisitions: 0,
    pendingWork: 0,
    ready: true,
    requiredChunkBounds: { minCx: 0, maxCx: 1, minCy: 0, maxCy: 1 },
    missingChunkCoords: [],
    notReadyChunkCoords: [],
    ...overrides,
  };
}

describe('World-Load-Diagnose', () => {
  it('zeigt einen allein blockierenden Terrain-Snapshot trotz fertiger Surfaces', () => {
    const work = resolveWorldRenderWork(stats(), stats(), stats());
    const terrainSnapshotReady = false;

    expect(work.groundReady).toBe(true);
    expect(work.rockOverlayReady).toBe(true);
    expect(work.shadowReady).toBe(true);
    expect(work.renderReady).toBe(true);
    expect(work.renderReady && terrainSnapshotReady).toBe(false);
  });

  it('weist ein allein blockierendes Shadow-Working-Set als Shadow-Gate aus', () => {
    const work = resolveWorldRenderWork(
      stats(),
      stats(),
      stats({
        residentChunks: 3,
        notReadyChunks: 1,
        pendingRegions: 2,
        pendingWork: 2,
        ready: false,
        notReadyChunkCoords: [{ cx: 1, cy: 0, localX: 512, localY: 0 }],
      }),
    );

    expect(work.groundReady).toBe(true);
    expect(work.rockOverlayReady).toBe(true);
    expect(work.shadowReady).toBe(false);
    expect(work.renderReady).toBe(false);
    expect(work.shadowStats?.notReadyChunks).toBe(1);
    expect(work.shadowStats?.pendingWork).toBeGreaterThan(0);
  });

  it('setzt den Stall nach der Schwelle einmal und bindet ihn an die World-Revision', () => {
    const watchdog = new WorldLoadStallWatchdog();
    const report = vi.fn();

    watchdog.observe(42, 'blocked', 0, report);
    watchdog.observe(42, 'blocked', WORLD_LOAD_STALL_THRESHOLD_MS - 1, report);
    expect(report).not.toHaveBeenCalled();
    watchdog.observe(42, 'blocked', WORLD_LOAD_STALL_THRESHOLD_MS, report);
    expect(report).toHaveBeenCalledTimes(1);

    watchdog.observe(42, 'blocked', WORLD_LOAD_STALL_THRESHOLD_MS + 1, report);
    expect(report).toHaveBeenCalledTimes(1);
    watchdog.observe(43, 'blocked', WORLD_LOAD_STALL_THRESHOLD_MS + 2, report);
    watchdog.observe(43, 'blocked', WORLD_LOAD_STALL_THRESHOLD_MS * 2 + 2, report);
    expect(report).toHaveBeenCalledTimes(2);

    watchdog.observe(
      43,
      'blocked',
      WORLD_LOAD_STALL_THRESHOLD_MS * 2 + 2 + WORLD_LOAD_STALL_REPEAT_MS,
      report,
    );
    expect(report).toHaveBeenCalledTimes(3);
  });
});
