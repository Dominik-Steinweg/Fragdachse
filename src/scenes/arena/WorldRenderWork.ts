import type { ChunkedRenderWorkingSet } from '../../arena/chunks/ChunkedRenderSurface';

export interface WorldRenderWork {
  readonly pending: number;
  readonly resident: number;
  readonly renderReady: boolean;
}

/** Combines the view-specific work of all render surfaces used by the load barrier. */
export function resolveWorldRenderWork(
  groundWork: ChunkedRenderWorkingSet | null,
  rockOverlayWork: ChunkedRenderWorkingSet | null,
  shadowWork: ChunkedRenderWorkingSet | null,
): WorldRenderWork {
  return {
    pending: (groundWork?.pendingWork ?? 0)
      + (rockOverlayWork?.pendingWork ?? 0)
      + (shadowWork?.pendingWork ?? 0),
    resident: (groundWork?.residentChunks ?? 0)
      + (rockOverlayWork?.residentChunks ?? 0)
      + (shadowWork?.residentChunks ?? 0),
    renderReady: groundWork?.ready === true
      && rockOverlayWork?.ready === true
      && shadowWork?.ready === true,
  };
}
