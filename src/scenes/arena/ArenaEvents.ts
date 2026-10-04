export const ARENA_MAP_GRID_CHANGED_EVENT = 'arena-map-grid-changed';
export const ARENA_ROCK_DESTROYED_EVENT = 'arena-rock-destroyed';

export type ArenaMapGridChangeReason =
  | 'static_rock_destroyed'
  | 'placeable_added'
  | 'placeable_removed'
  | 'placeable_expired'
  | 'placeables_batch_removed';

export type ArenaMapGridChangeSource = 'static_rock' | 'placeable_rock' | 'placeable_turret' | 'placeable_pedestal';

export interface ArenaMapGridChangedEvent {
  readonly reason: ArenaMapGridChangeReason;
  readonly source: ArenaMapGridChangeSource;
  readonly obstacleId?: number;
  readonly gridX?: number;
  readonly gridY?: number;
  /** Runtime provenance: collisionless placeables reserve placement cells but not obstacles. */
  readonly collisionMode?: 'obstacle' | 'none';
  /** Local batch provenance; consumers can update only the removed cells. */
  readonly removedObstacles?: readonly { readonly id: number; readonly gridX: number; readonly gridY: number }[];
}

export interface ArenaRockDestroyedEvent {
  readonly rockId: number;
  readonly source: 'static_rock' | 'placeable_rock';
  readonly reason: 'damage' | 'decay';
}

interface ArenaEventPayloads {
  [ARENA_MAP_GRID_CHANGED_EVENT]: ArenaMapGridChangedEvent;
  [ARENA_ROCK_DESTROYED_EVENT]: ArenaRockDestroyedEvent;
}

export interface ArenaEventBus {
  on<Event extends keyof ArenaEventPayloads>(
    event: Event, fn: (payload: ArenaEventPayloads[Event]) => void, context?: unknown,
  ): this;
  off<Event extends keyof ArenaEventPayloads>(
    event: Event, fn?: (payload: ArenaEventPayloads[Event]) => void, context?: unknown, once?: boolean,
  ): this;
  emit<Event extends keyof ArenaEventPayloads>(event: Event, payload: ArenaEventPayloads[Event]): boolean;
}

export function emitArenaMapGridChanged(
  eventBus: ArenaEventBus | null | undefined,
  payload: ArenaMapGridChangedEvent,
): boolean {
  return eventBus?.emit(ARENA_MAP_GRID_CHANGED_EVENT, payload) ?? false;
}

export function emitArenaRockDestroyed(
  eventBus: ArenaEventBus | null | undefined,
  payload: ArenaRockDestroyedEvent,
): boolean {
  return eventBus?.emit(ARENA_ROCK_DESTROYED_EVENT, payload) ?? false;
}
