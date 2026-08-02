export interface SpectatorCameraAdvanceInput {
  currentScrollX: number;
  deltaMs: number;
  moveLeft: boolean;
  moveRight: boolean;
  arenaWidth: number;
  viewportWidth: number;
  speedPxPerSecond?: number;
}

export function getSpectatorCameraMaxScroll(arenaWidth: number, viewportWidth: number): number {
  return Math.max(0, arenaWidth - viewportWidth);
}

/** Pure Kameramodell fuer A/D-Spectatorbewegung, inklusive Arena-Grenzen. */
export function advanceSpectatorCameraScroll({
  currentScrollX,
  deltaMs,
  moveLeft,
  moveRight,
  arenaWidth,
  viewportWidth,
  speedPxPerSecond = 420,
}: SpectatorCameraAdvanceInput): number {
  const direction = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
  const maxScrollX = getSpectatorCameraMaxScroll(arenaWidth, viewportWidth);
  const next = currentScrollX + direction * speedPxPerSecond * Math.max(0, deltaMs) / 1000;
  return Math.min(maxScrollX, Math.max(0, next));
}
