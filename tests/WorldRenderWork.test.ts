import { describe, expect, it } from 'vitest';
import { resolveWorldRenderWork } from '../src/scenes/arena/WorldRenderWork';
import type { ChunkedRenderWorkingSet } from '../src/arena/chunks/ChunkedRenderSurface';

function work(overrides: Partial<ChunkedRenderWorkingSet> = {}): ChunkedRenderWorkingSet {
  return {
    residentChunks: 4,
    pendingWork: 0,
    ready: true,
    ...overrides,
  };
}

describe('World-Render-Work', () => {
  it('weist ein blockierendes Shadow-Working-Set als nicht bereit aus', () => {
    const renderWork = resolveWorldRenderWork(
      work(),
      work(),
      work({
        residentChunks: 3,
        pendingWork: 2,
        ready: false,
      }),
    );

    expect(renderWork.renderReady).toBe(false);
    expect(renderWork.pending).toBe(2);
    expect(renderWork.resident).toBe(11);
  });

  it('summiert offene Working-Set-Arbeit und residente Chunks', () => {
    const renderWork = resolveWorldRenderWork(
      work({ residentChunks: 2, pendingWork: 3, ready: false }),
      work({ residentChunks: 5, pendingWork: 1, ready: false }),
      work({ residentChunks: 7, pendingWork: 0, ready: true }),
    );

    expect(renderWork.pending).toBe(4);
    expect(renderWork.resident).toBe(14);
    expect(renderWork.renderReady).toBe(false);
  });

  it('meldet ein vollstaendig fertiges Working Set als ready ohne Pending-Arbeit', () => {
    const renderWork = resolveWorldRenderWork(work(), work(), work());

    expect(renderWork.renderReady).toBe(true);
    expect(renderWork.pending).toBe(0);
  });
});
