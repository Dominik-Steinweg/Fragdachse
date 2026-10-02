import { GAME_WIDTH, GAME_HEIGHT } from '../../config';
import type { SyncedTrainState } from '../../types';

export interface TrainViewBounds { left: number; right: number; top: number; bottom: number }
export interface TrainShowcaseState {
  state: SyncedTrainState | null;
  speed: number;
  bounds: TrainViewBounds;
  trackBounds: TrainViewBounds;
  explosionCenter: { x: number; y: number } | null;
}

export function trainView(center: { x: number; y: number }, zoom: number): TrainViewBounds {
  return { left: center.x - GAME_WIDTH / zoom / 2, right: center.x + GAME_WIDTH / zoom / 2,
    top: center.y - GAME_HEIGHT / zoom / 2, bottom: center.y + GAME_HEIGHT / zoom / 2 };
}

export function trainVisibility(train: TrainShowcaseState, view: TrainViewBounds) {
  const b = train.bounds;
  const visible = !!train.state?.alive && b.right >= view.left && b.left <= view.right && b.bottom >= view.top && b.top <= view.bottom;
  return { visible, fullyVisible: visible && b.left >= view.left && b.right <= view.right && b.top >= view.top && b.bottom <= view.bottom };
}

/** Keep the complete train plus debris room in view, around the real replicated main blast. */
export function trainExplosionZoom(train: TrainShowcaseState, requestedZoom: number): number {
  const c = train.explosionCenter!;
  const b = train.bounds;
  const width = 2 * Math.max(Math.abs(b.left - c.x), Math.abs(b.right - c.x)) + 400;
  const height = 2 * Math.max(Math.abs(b.top - c.y), Math.abs(b.bottom - c.y)) + 400;
  return Math.min(requestedZoom, GAME_WIDTH / width, GAME_HEIGHT / height);
}

/** Do not detonate the first sliver of the locomotive at the map entrance. */
export function trainHasEntered(train: TrainShowcaseState): boolean {
  const middle = (train.bounds.top + train.bounds.bottom) / 2;
  return !!train.state?.alive && !!train.explosionCenter
    && middle >= train.trackBounds.top && middle <= train.trackBounds.bottom;
}

export function trainObserverPosition(positions: readonly { x: number; y: number }[], train: TrainShowcaseState) {
  const trackX = (train.trackBounds.left + train.trackBounds.right) / 2;
  const middleY = (train.trackBounds.top + train.trackBounds.bottom) / 2;
  let best: { x: number; y: number } | null = null, score = Infinity;
  for (const p of positions) {
    if (p.x > train.trackBounds.left - 128 && p.x < train.trackBounds.right + 128) continue;
    const distance = Math.abs(p.x - trackX) + Math.abs(p.y - middleY);
    if (distance < score) { best = p; score = distance; }
  }
  return best;
}
