import type { ArenaLoadStage } from '../../types';

export interface ArenaLoadProgressResult {
  progress: number;
  stage: ArenaLoadStage;
  ready: boolean;
}

/** Converts chunk statistics into the coarse, low-traffic progress sent to peers. */
export function resolveArenaLoadProgress(
  pendingWork: number,
  residentWork: number,
  localRenderReady: boolean,
  hostStartupReady: boolean,
): ArenaLoadProgressResult {
  if (localRenderReady && hostStartupReady) {
    return { progress: 100, stage: 'ready', ready: true };
  }
  if (localRenderReady) {
    return { progress: 95, stage: 'building', ready: false };
  }
  const pending = Math.max(0, pendingWork);
  const resident = Math.max(0, residentWork);
  const renderProgress = pending <= 0
    ? 100
    : Math.max(0, Math.min(99, Math.round((resident / Math.max(1, resident + pending)) * 100)));
  return {
    progress: 70 + Math.round(renderProgress * 0.25),
    stage: 'rendering',
    ready: false,
  };
}
