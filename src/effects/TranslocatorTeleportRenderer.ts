import type { PortalPair } from '../systems/PortalTraversal';
import type { PortalPresentation } from './portal/PortalPresentation';
import { translocatorPortalStyle } from './portal/PortalStyle';
import type { PortalEndView } from './portal/PortalViews';

const OWNER = 'translocator';
const OPEN_MS = 180;
const CLOSE_MS = 160;
/** A pair first seen this soon after its creation announces itself with an opening burst. */
const OPENING_BURST_MAX_AGE_MS = 250;

/** Both ends of each replicated translocator pair, in the shared portal look. */
export function translocatorPortalViews(pairs: readonly PortalPair[], now: number): PortalEndView[] {
  const views: PortalEndView[] = [];
  for (const pair of pairs) {
    const age = Math.max(0, now - pair.createdAt);
    const remaining = Math.max(0, pair.expiresAt - now);
    const lifetime = Math.max(1, pair.expiresAt - pair.createdAt);
    const opening = Math.min(1, age / OPEN_MS);
    const open = (1 - (1 - opening) ** 3) * Math.min(1, remaining / CLOSE_MS);
    const meter = Math.min(1, remaining / lifetime);
    for (const [end, point, partner] of [['a', pair.a, pair.b], ['b', pair.b, pair.a]] as const) {
      views.push({ key: `${pair.id}:${end}`, x: point.x, y: point.y, radius: pair.radius,
        style: translocatorPortalStyle(end), open, partner, ground: 1, meter });
    }
  }
  return views;
}

/** Translocator adapter: replicated pairs and teleport/collapse RPCs onto the shared portals. */
export class TranslocatorTeleportRenderer {
  private readonly announced = new Set<string>();
  private destroyed = false;
  constructor(private readonly portals: PortalPresentation) {}

  syncPortals(pairs: readonly PortalPair[], now: number): void {
    if (this.destroyed) return;
    const present = new Set<string>();
    for (const pair of pairs) {
      present.add(pair.id);
      if (this.announced.has(pair.id)) continue;
      this.announced.add(pair.id);
      if (now - pair.createdAt >= OPENING_BURST_MAX_AGE_MS) continue;
      for (const [end, point] of [['a', pair.a], ['b', pair.b]] as const) {
        this.portals.playTransfer({ x: point.x, y: point.y, radius: pair.radius, style: translocatorPortalStyle(end),
          side: 'exit', dirX: 0, dirY: 0, strength: 0.6 });
      }
    }
    for (const id of this.announced) if (!present.has(id)) this.announced.delete(id);
    this.portals.submit(OWNER, translocatorPortalViews(pairs, now));
  }

  /** Teleport RPC: a point and the end colour; the shared presentation finds end and direction. */
  playFlash(x: number, y: number, color: number, type: 'start' | 'end'): void {
    if (!this.destroyed) this.portals.playFlashAt(x, y, color, type);
  }

  playCollapse(a: { x: number; y: number }, b: { x: number; y: number }, radius: number): void {
    if (this.destroyed) return;
    this.portals.playCollapse([a], radius, translocatorPortalStyle('a'));
    this.portals.playCollapse([b], radius, translocatorPortalStyle('b'));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.portals.clear(OWNER);
    this.announced.clear();
  }
}
