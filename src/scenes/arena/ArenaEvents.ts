export const ARENA_MAP_GRID_CHANGED_EVENT = 'arena-map-grid-changed';

export type ArenaMapGridChangeReason =
  | 'static_rock_destroyed'
  | 'placeable_added'
  | 'placeable_removed'
  | 'placeable_expired';

export type ArenaMapGridChangeSource = 'static_rock' | 'placeable_rock' | 'placeable_turret';

export interface ArenaMapGridChangedEvent {
  readonly reason: ArenaMapGridChangeReason;
  readonly source: ArenaMapGridChangeSource;
  readonly obstacleId?: number;
  readonly gridX?: number;
  readonly gridY?: number;
}

export interface ArenaEventBus {
  on(event: string, fn: (...args: any[]) => void, context?: unknown): this;
  off(event: string, fn?: (...args: any[]) => void, context?: unknown, once?: boolean): this;
  emit(event: string, ...args: any[]): boolean;
}

export function emitArenaMapGridChanged(
  eventBus: ArenaEventBus | null | undefined,
  payload: ArenaMapGridChangedEvent,
): boolean {
  return eventBus?.emit(ARENA_MAP_GRID_CHANGED_EVENT, payload) ?? false;
}