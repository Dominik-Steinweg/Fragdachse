import type { SpawnFront } from '../types';

export const SPAWN_FRONTS: readonly SpawnFront[] = ['west', 'north', 'east', 'south'];
export const DEFAULT_SPAWN_FRONT: SpawnFront = 'west';

export function isSpawnFront(value: unknown): value is SpawnFront {
  return typeof value === 'string' && (SPAWN_FRONTS as readonly string[]).includes(value);
}

export function getSpawnFrontInwardVector(front: SpawnFront): { x: number; y: number } {
  switch (front) {
    case 'north': return { x: 0, y: 1 };
    case 'east': return { x: -1, y: 0 };
    case 'south': return { x: 0, y: -1 };
    case 'west': return { x: 1, y: 0 };
  }
}
