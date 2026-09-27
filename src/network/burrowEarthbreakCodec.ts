import type { EarthbreakPoint, SyncedBurrowEarthbreak } from '../systems/BurrowEarthbreakRuntime';

type Point = [number, number];
type WireTrace = [number, string, Point[], Point | null, number | null];

export function encodeBurrowEarthbreak(traces: readonly SyncedBurrowEarthbreak[]): WireTrace[] {
  return traces.map(t => [t.id, t.ownerId, t.points.map(p => [p.x, p.y]),
    t.exit ? [t.exit.x, t.exit.y] : null, t.detonatedAt]);
}

function point(raw: unknown): EarthbreakPoint | null {
  return Array.isArray(raw) && raw.length === 2 && raw.every(n => typeof n === 'number' && Number.isFinite(n))
    ? { x: raw[0], y: raw[1] } : null;
}

/** Whole active traces are refreshed every snapshot, including the empty collection. */
export function decodeBurrowEarthbreak(raw: unknown): SyncedBurrowEarthbreak[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<number>();
  const result: SyncedBurrowEarthbreak[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 5) continue;
    const [id, ownerId, positions, exitRaw, detonatedAt] = entry;
    if (!Number.isSafeInteger(id) || id < 1 || ids.has(id) || typeof ownerId !== 'string' || !ownerId
      || !Array.isArray(positions)) continue;
    const points = positions.map(point);
    if (points.some(p => p === null)) continue;
    const exit = point(exitRaw);
    if (detonatedAt === null ? exitRaw !== null
      : typeof detonatedAt !== 'number' || !Number.isFinite(detonatedAt) || !exit) continue;
    ids.add(id);
    result.push({ id, ownerId, points: points as EarthbreakPoint[], exit, detonatedAt,
      phase: detonatedAt === null ? 'digging' : 'detonating' });
  }
  return result;
}
