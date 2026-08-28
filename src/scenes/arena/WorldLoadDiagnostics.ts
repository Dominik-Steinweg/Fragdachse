import type { ChunkedRenderWorkingSetStats } from '../../arena/chunks/ChunkedRenderSurface';

export interface WorldRenderWork {
  readonly pending: number;
  readonly resident: number;
  readonly renderReady: boolean;
  readonly groundReady: boolean;
  readonly rockOverlayReady: boolean;
  readonly shadowReady: boolean;
  readonly groundStats: ChunkedRenderWorkingSetStats | null;
  readonly rockOverlayStats: ChunkedRenderWorkingSetStats | null;
  readonly shadowStats: ChunkedRenderWorkingSetStats | null;
}

export function resolveWorldRenderWork(
  groundStats: ChunkedRenderWorkingSetStats | null,
  rockOverlayStats: ChunkedRenderWorkingSetStats | null,
  shadowStats: ChunkedRenderWorkingSetStats | null,
): WorldRenderWork {
  const groundReady = groundStats?.ready === true;
  const rockOverlayReady = rockOverlayStats?.ready === true;
  const shadowReady = shadowStats?.ready === true;
  return {
    pending: (groundStats?.pendingWork ?? 0)
      + (rockOverlayStats?.pendingWork ?? 0)
      + (shadowStats?.pendingWork ?? 0),
    resident: (groundStats?.residentChunks ?? 0)
      + (rockOverlayStats?.residentChunks ?? 0)
      + (shadowStats?.residentChunks ?? 0),
    renderReady: groundReady && rockOverlayReady && shadowReady,
    groundReady,
    rockOverlayReady,
    shadowReady,
    groundStats,
    rockOverlayStats,
    shadowStats,
  };
}

export const WORLD_LOAD_STALL_THRESHOLD_MS = 4_000;
export const WORLD_LOAD_STALL_REPEAT_MS = 30_000;

/** Revisionsgebundene, nicht-invasive Beobachtung eines lokalen World-Load-Stalls. */
export class WorldLoadStallWatchdog {
  private worldRevision = 0;
  private signature: string | null = null;
  private stalledSinceMs: number | null = null;
  private lastReportedSignature: string | null = null;
  private lastReportedAtMs = Number.NEGATIVE_INFINITY;

  observe(
    worldRevision: number,
    signature: string,
    nowMs: number,
    report: () => void,
  ): void {
    if (worldRevision <= 0 || !Number.isFinite(nowMs)) {
      this.reset();
      return;
    }
    if (this.worldRevision !== worldRevision || this.signature !== signature) {
      this.worldRevision = worldRevision;
      this.signature = signature;
      this.stalledSinceMs = nowMs;
      this.lastReportedSignature = null;
      this.lastReportedAtMs = Number.NEGATIVE_INFINITY;
    }
    if (this.stalledSinceMs === null || nowMs - this.stalledSinceMs < WORLD_LOAD_STALL_THRESHOLD_MS) return;
    const sameReportTooSoon = this.lastReportedSignature === signature
      && nowMs - this.lastReportedAtMs < WORLD_LOAD_STALL_REPEAT_MS;
    if (sameReportTooSoon) return;
    this.lastReportedSignature = signature;
    this.lastReportedAtMs = nowMs;
    report();
  }

  reset(): void {
    this.worldRevision = 0;
    this.signature = null;
    this.stalledSinceMs = null;
    this.lastReportedSignature = null;
    this.lastReportedAtMs = Number.NEGATIVE_INFINITY;
  }
}
