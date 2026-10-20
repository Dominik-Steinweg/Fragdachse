import type { ArenaLayout } from '../../types';

/**
 * Aufteilung des gemeinsamen Hindernis-ID-Raums einer World:
 * authored Felsen `[0, R)`, reaktive Map-Objekte `[R, R + P)`, Runtime-Placeables ab `R + P`.
 *
 * Die Aufteilung wird genau einmal beim Materialisieren bestimmt, solange `layout.rocks` nur
 * authored Felsen enthält; spätere Runtime-Slots (Placeables) verschieben sie nicht.
 */
export interface ObstacleIdPartition {
  readonly firstReactivePropId: number;
  readonly reactivePropCount: number;
  readonly firstRuntimeObstacleId: number;
}

export function resolveObstacleIdPartition(layout: Pick<ArenaLayout, 'rocks' | 'reactiveProps'>): ObstacleIdPartition {
  const firstReactivePropId = layout.rocks.length;
  const reactivePropCount = layout.reactiveProps?.length ?? 0;
  return Object.freeze({
    firstReactivePropId,
    reactivePropCount,
    firstRuntimeObstacleId: firstReactivePropId + reactivePropCount,
  });
}

export function isReactivePropObstacleId(partition: ObstacleIdPartition, id: number): boolean {
  return id >= partition.firstReactivePropId && id < partition.firstRuntimeObstacleId;
}

/** Layout-Index eines reaktiven Objekts oder `-1`, wenn die ID nicht im Prop-Bereich liegt. */
export function reactivePropIndexOf(partition: ObstacleIdPartition, id: number): number {
  return isReactivePropObstacleId(partition, id) ? id - partition.firstReactivePropId : -1;
}
