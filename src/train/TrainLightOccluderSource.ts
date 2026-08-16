import type { SyncedTrainState } from '../types';
import type { DynamicLightOccluderSource } from '../effects/DynamicLightOccluders';
import type { RectOccluderVisitor } from '../effects/LightOccluderIndex';
import { ALL_EDGES_EXPOSED } from '../effects/lightShadowGeometry';
import { TRAIN } from './TrainConfig';

interface TrainSegmentRect {
  readonly active: boolean;
  readonly x: number;
  readonly y: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly body?: unknown;
}

/**
 * Schlanker Adapter fuer die beweglichen Zug-Hitboxen.
 *
 * Der Host stellt die bereits bewegten Rectangle-Objekte aus `TrainManager` bereit.
 * Clients rekonstruieren dieselben AABBs aus dem interpolierten `SyncedTrainState`.
 * Es wird kein Index gebaut: ein Zug hat nur eine kleine, feste Segmentzahl und jedes
 * verdeckende Licht prueft sie direkt per exaktem Kreis-AABB-Schnitt.
 */
export class TrainLightOccluderSource implements DynamicLightOccluderSource {
  private liveSegments: readonly TrainSegmentRect[] | null = null;
  private syncedState: SyncedTrainState | null = null;

  setTrain(
    liveSegments: readonly TrainSegmentRect[] | null,
    syncedState: SyncedTrainState | null,
  ): void {
    this.liveSegments = liveSegments;
    this.syncedState = syncedState?.alive ? syncedState : null;
  }

  clear(): void {
    this.liveSegments = null;
    this.syncedState = null;
  }

  hasOccluders(): boolean {
    return this.liveSegments !== null || this.syncedState !== null;
  }

  queryCircle(
    x: number,
    y: number,
    radius: number,
    visitRect: RectOccluderVisitor,
  ): number {
    const segments = this.liveSegments;
    if (segments) return this.queryLiveSegments(segments, x, y, radius, visitRect);

    const state = this.syncedState;
    if (!state) return 0;
    return this.querySyncedSegments(state, x, y, radius, visitRect);
  }

  private queryLiveSegments(
    segments: readonly TrainSegmentRect[],
    x: number,
    y: number,
    radius: number,
    visitRect: RectOccluderVisitor,
  ): number {
    let tested = 0;
    for (const segment of segments) {
      const body = segment.body as { readonly enable?: boolean } | null | undefined;
      if (!segment.active || body?.enable === false) continue;
      tested += 1;
      const halfWidth = segment.displayWidth * 0.5;
      const halfHeight = segment.displayHeight * 0.5;
      this.visitIfIntersecting(
        x,
        y,
        radius,
        segment.x - halfWidth,
        segment.y - halfHeight,
        segment.x + halfWidth,
        segment.y + halfHeight,
        visitRect,
      );
    }
    return tested;
  }

  private querySyncedSegments(
    state: SyncedTrainState,
    x: number,
    y: number,
    radius: number,
    visitRect: RectOccluderVisitor,
  ): number {
    const halfWidth = TRAIN.HITBOX_WIDTH * 0.5;
    let centerY = state.y;
    let previousHeight = TRAIN.LOCO_HEIGHT;

    for (let index = 0; index <= TRAIN.WAGON_COUNT; index += 1) {
      const height = index === 0 ? TRAIN.LOCO_HEIGHT : TRAIN.WAGON_HEIGHT;
      if (index > 0) {
        centerY -= state.dir * (previousHeight * 0.5 + TRAIN.SEGMENT_GAP + height * 0.5);
      }
      const halfHeight = height * 0.5;
      this.visitIfIntersecting(
        x,
        y,
        radius,
        state.x - halfWidth,
        centerY - halfHeight,
        state.x + halfWidth,
        centerY + halfHeight,
        visitRect,
      );
      previousHeight = height;
    }

    return TRAIN.WAGON_COUNT + 1;
  }

  private visitIfIntersecting(
    circleX: number,
    circleY: number,
    radius: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
    visitRect: RectOccluderVisitor,
  ): void {
    const dx = circleX < left ? left - circleX : (circleX > right ? circleX - right : 0);
    const dy = circleY < top ? top - circleY : (circleY > bottom ? circleY - bottom : 0);
    if (dx * dx + dy * dy > radius * radius) return;
    visitRect(left, top, right, bottom, ALL_EDGES_EXPOSED);
  }
}
