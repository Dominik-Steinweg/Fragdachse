import type { ZeusGround, ZeusPoint } from '../systems/ZeusRuntime';
import { ZEUS_FX } from '../config/zeusEffects';

export interface ElectricNode extends ZeusPoint { readonly expiresAt: number }
export interface ElectricSpan { readonly from: ElectricNode; readonly to: ElectricNode }
export interface ElectricGroundGeometry { readonly nodes: readonly ElectricNode[]; readonly spans: readonly ElectricSpan[] }

/** Arc-length sampling joins adjacent simulation steps, but never bridges a portal/discontinuity.
 * Shared samples make brightness independent of snapshot frequency and duplicate sources. */
export function buildElectricGroundGeometry(ground: readonly ZeusGround[], now: number): ElectricGroundGeometry {
  const segments = ground.filter(g => g.expiresAt > now)
    .sort((a, b) => a.ownerId.localeCompare(b.ownerId) || a.createdAt - b.createdAt || a.id - b.id);
  const length = segments.reduce((n, g) => n + Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y), 0);
  const spacing = Math.max(ZEUS_FX.sampleSpacing, length / ZEUS_FX.maxGroundSamples);
  const nodes = new Map<string, ElectricNode>(), spans = new Map<string, ElectricSpan>();
  const key = (p: ZeusPoint) => `${Math.round(p.x * 2)}:${Math.round(p.y * 2)}`;
  const add = (p: ElectricNode): ElectricNode => {
    const k = key(p), old = nodes.get(k);
    if (!old || old.expiresAt < p.expiresAt || old.radius < p.radius) nodes.set(k, p);
    return p;
  };
  const connect = (a: ElectricNode, b: ElectricNode) => {
    add(a); add(b);
    const ka = key(a), kb = key(b);
    if (ka === kb) return;
    const k = ka < kb ? `${ka}/${kb}` : `${kb}/${ka}`;
    const old = spans.get(k);
    if (!old || Math.min(a.expiresAt, b.expiresAt) > Math.min(old.from.expiresAt, old.to.expiresAt)) spans.set(k, { from: a, to: b });
  };
  let previous: ZeusGround | null = null, last: ElectricNode | null = null, carry = 0;
  for (const g of segments) {
    const continuous = previous?.ownerId === g.ownerId
      && Math.hypot(previous.to.x - g.from.x, previous.to.y - g.from.y) < 0.01;
    if (!continuous) {
      if (previous && last) connect(last, { ...previous.to, expiresAt: previous.expiresAt });
      last = add({ ...g.from, expiresAt: g.expiresAt }); carry = 0;
    } else if (previous && last) {
      const ax = previous.to.x - previous.from.x, ay = previous.to.y - previous.from.y;
      const bx = g.to.x - g.from.x, by = g.to.y - g.from.y;
      const lengthProduct = Math.hypot(ax, ay) * Math.hypot(bx, by);
      if (lengthProduct > 0 && (ax * bx + ay * by) / lengthProduct < 0.97) {
        const corner = { ...g.from, expiresAt: Math.min(previous.expiresAt, g.expiresAt) };
        connect(last, corner); last = corner; carry = 0;
      }
    }
    const dx = g.to.x - g.from.x, dy = g.to.y - g.from.y, distance = Math.hypot(dx, dy);
    for (let d = spacing - carry; d <= distance; d += spacing) {
      const t = d / distance;
      const p = { x: g.from.x + dx * t, y: g.from.y + dy * t,
        radius: g.from.radius + (g.to.radius - g.from.radius) * t, expiresAt: g.expiresAt };
      if (last) connect(last, p);
      last = p;
    }
    carry = (carry + distance) % spacing;
    previous = g;
  }
  if (previous && last) connect(last, { ...previous.to, expiresAt: previous.expiresAt });
  return { nodes: [...nodes.values()], spans: [...spans.values()] };
}

/** Smooth shared displacement at a world point: adjoining strands never get unrelated endpoints. */
export function electricDisplacement(x: number, y: number, time: number, radius: number): readonly [number, number] {
  const t = time / 1000, a = Math.min(3, radius * 0.22);
  return [a * Math.sin(x * 0.17 + y * 0.11 + t * 9), a * Math.sin(y * 0.19 - x * 0.09 - t * 11)];
}
