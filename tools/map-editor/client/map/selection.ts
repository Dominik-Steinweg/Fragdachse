import type { MapObject } from './objects';

/** Visible foreground objects take precedence over the large target area of a fire front. */
export function pickMapObject(items: readonly MapObject[], point: { x: number; y: number }, scale: number, cycleAfter?: string | null): MapObject | undefined {
  const near = (p: { x: number; y: number }) => Math.hypot(p.x - point.x, p.y - point.y) * scale < 9;
  const hits = [...items].reverse().filter(item => {
    if (item.hidden) return false;
    if (item.kind === 'corridor') return item.points?.some((p, n) => {
      const current = { x: p.x + .5, y: p.y + .5 }, previous = item.points?.[n - 1];
      if (!previous) return near(current);
      const x = previous.x + .5, y = previous.y + .5, dx = current.x - x, dy = current.y - y;
      const t = Math.max(0, Math.min(1, ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy || 1)));
      return near({ x: x + t * dx, y: y + t * dy });
    });
    if (item.kind === 'point') return Math.hypot(point.x - item.x - .5, point.y - item.y - .5) < (item.radius ?? 1);
    return point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h;
  });
  // Keep visual stacking order within each group. Selecting a fire front must not lock out its contents.
  hits.sort((a, b) => Number(a.layer === 'hazards') - Number(b.layer === 'hazards'));
  const index = cycleAfter ? hits.findIndex(item => item.id === cycleAfter) : -1;
  return hits[(index + 1) % hits.length];
}
