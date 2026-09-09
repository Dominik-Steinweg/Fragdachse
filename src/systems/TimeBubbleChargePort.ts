import type { RadialDamageFalloffConfig } from '../types';

/** Passive host observations. These never consume attacks or publish damage against a bubble. */
export interface TimeBubbleChargePort {
  observeProjectile(id: number, x: number, y: number, damage: number, now: number): void;
  observeHitscan(x: number, y: number, endX: number, endY: number, width: number, damage: number, now: number): void;
  observeMelee(x: number, y: number, angle: number, range: number, halfArc: number, damage: number,
    now: number, isBlocked: (contactX: number, contactY: number) => boolean): void;
  observeExplosion(x: number, y: number, radius: number, damage: number, now: number, falloff?: RadialDamageFalloffConfig): void;
}

export interface TimeBubbleRelease {
  readonly id: number;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly charge: number;
}

export function closestSegmentPoint(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq)) : 0;
  return { x: ax + dx * t, y: ay + dy * t };
}

/** Nearest contact along a ray inside the swing, including circle/arc-edge tangencies. */
export function meleeCircleContact(x: number, y: number, angle: number, range: number, halfArc: number,
  cx: number, cy: number, radius: number): { x: number; y: number } | null {
  const dx = cx - x, dy = cy - y;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius) return { x, y };
  if (range <= 0 || distance > range + radius) return null;
  const offset = Math.atan2(Math.sin(Math.atan2(dy, dx) - angle), Math.cos(Math.atan2(dy, dx) - angle));
  let closest: { x: number; y: number };
  if (Math.abs(offset) <= halfArc) {
    const factor = Math.min(range, distance) / distance;
    closest = { x: x + dx * factor, y: y + dy * factor };
  } else {
    const a = closestSegmentPoint(cx, cy, x, y, x + Math.cos(angle - halfArc) * range, y + Math.sin(angle - halfArc) * range);
    const b = closestSegmentPoint(cx, cy, x, y, x + Math.cos(angle + halfArc) * range, y + Math.sin(angle + halfArc) * range);
    closest = Math.hypot(a.x - cx, a.y - cy) <= Math.hypot(b.x - cx, b.y - cy) ? a : b;
  }
  if (Math.hypot(closest.x - cx, closest.y - cy) > radius + 1e-8) return null;
  const length = Math.hypot(closest.x - x, closest.y - y);
  if (length === 0) return { x, y };
  const ux = (closest.x - x) / length, uy = (closest.y - y) / length;
  const along = dx * ux + dy * uy;
  const cross = dx * uy - dy * ux;
  const entry = Math.max(0, along - Math.sqrt(Math.max(0, radius * radius - cross * cross)));
  return { x: x + ux * entry, y: y + uy * entry };
}
