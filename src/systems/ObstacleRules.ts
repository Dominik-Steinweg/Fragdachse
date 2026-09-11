/** World geometry semantics. Height is a class, never a simulated flight coordinate. */
export type ObstacleClass = 'ground' | 'low' | 'high' | 'veryHigh';
export type ObstacleQueryPurpose = 'physical' | 'directFire' | 'support';
export type ObstacleObjectKind = 'ground' | 'wall' | 'turret' | 'base' | 'rock' | 'trunk' | 'barrier' | 'train';

const CLASSES: Record<ObstacleObjectKind, ObstacleClass> = {
  ground: 'ground', wall: 'low', turret: 'low', base: 'high',
  rock: 'veryHigh', trunk: 'veryHigh', barrier: 'veryHigh', train: 'veryHigh',
};

export function obstacleClassFor(kind: ObstacleObjectKind): ObstacleClass {
  const result = CLASSES[kind];
  if (!result) throw new Error(`Unclassified obstacle kind: ${kind}`);
  return result;
}

export function obstacleBlocks(value: ObstacleClass, purpose: ObstacleQueryPurpose): boolean {
  switch (value) {
    case 'ground': return false;
    case 'low': return purpose !== 'directFire';
    case 'high': case 'veryHigh': return true;
    default: throw new Error(`Unclassified solid obstacle: ${value}`);
  }
}

export interface ObstacleShotOptions {
  readonly halfWidth?: number;
  readonly halfHeight?: number;
  readonly purpose?: ObstacleQueryPurpose;
  readonly sourceCarrierBaseId?: string;
  readonly ignoreRocks?: boolean;
  /** Support eligibility is independent of obstacle height. */
  readonly acceptsLowTarget?: (rockId: number) => boolean;
}

/** Unclipped slab interval. A start inside the rectangle has enter <= 0. */
export function segmentRectInterval(sx: number, sy: number, ex: number, ey: number,
  left: number, top: number, right: number, bottom: number): { enter: number; exit: number } | null {
  let enter = -Infinity, exit = Infinity;
  const dx = ex - sx, dy = ey - sy;
  if (dx === 0) { if (sx < left || sx > right) return null; }
  else { const a = (left - sx) / dx, b = (right - sx) / dx;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b)); }
  if (dy === 0) { if (sy < top || sy > bottom) return null; }
  else { const a = (top - sy) / dy, b = (bottom - sy) / dy;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b)); }
  return enter <= exit && exit >= 0 && enter <= 1 ? { enter, exit } : null;
}
