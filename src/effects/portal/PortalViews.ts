import type { PortalStyleId } from './PortalStyle';

/**
 * Presentation read model of one portal end. Owners derive it from replicated or local state each
 * frame; the shared presentation never decides gameplay.
 */
export interface PortalEndView {
  /** Stable per owner; seeds particles and keys the end's light. */
  readonly key: string;
  readonly x: number;
  readonly y: number;
  /** Aperture radius in world px (the trigger radius where one exists). */
  readonly radius: number;
  readonly style: PortalStyleId;
  /** Iris opening 0..1 (opening and closing animations). */
  readonly open: number;
  /** Overall strength 0..1; dimmed modes lower it. Defaults to 1. */
  readonly intensity?: number;
  /** Breathes slowly instead of holding steady (waiting modes). */
  readonly pulse?: boolean;
  /** World position of the partner end; drives the direction cue and the destination view. */
  readonly partner?: { readonly x: number; readonly y: number } | null;
  /** 0..1 how much of the destination ground shows through; 0 keeps a dark throat. */
  readonly ground?: number;
  /** Remaining lifetime 0..1 shown as a clockwise arc; omitted for open-ended portals. */
  readonly meter?: number;
  /** 0..1 while the aperture is still forming (generator charge); omitted once open. */
  readonly charge?: number;
  /** 0..1 recent transfer flare driven by the owner (e.g. per transported shot). */
  readonly flash?: number;
  /** Elliptic aperture across a firing line: rotation of the line and its squash (>= 1). */
  readonly ellipse?: { readonly angle: number; readonly aspect: number };
  /** Ambient particle density 0..1; tiny muzzle portals use fewer motes. Defaults to 1. */
  readonly particles?: number;
  /** Ambient motes spiral into the throat (default) or out of it (one-way exits). */
  readonly flow?: 'in' | 'out';
}

/** A transfer through a portal, seen at one end. `dir` is the world travel direction (unit). */
export interface PortalTransferEvent {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly style: PortalStyleId;
  /** `enter`: swallowed at the entry; `exit`: released at the exit. */
  readonly side: 'enter' | 'exit';
  readonly dirX: number;
  readonly dirY: number;
  /** 0..1; frequent transfers (turret shots) use a lighter variant. Defaults to 1. */
  readonly strength?: number;
}

/** Unit vector from an end to its partner, or null when there is none or they coincide. */
export function portalPartnerDirection(end: Pick<PortalEndView, 'x' | 'y' | 'partner'>): { x: number; y: number } | null {
  if (!end.partner) return null;
  const dx = end.partner.x - end.x, dy = end.partner.y - end.y, length = Math.hypot(dx, dy);
  return length > 1 ? { x: dx / length, y: dy / length } : null;
}

/**
 * Resolves a flash position reported by the transport to the end it belongs to. The teleport RPC
 * carries only a point; the end and its partner give the transfer its direction.
 */
export function findPortalEndAt<T extends Pick<PortalEndView, 'x' | 'y' | 'radius'>>(
  ends: Iterable<T>, x: number, y: number, slackPx = 14): T | null {
  let best: T | null = null, bestDistance = Infinity;
  for (const end of ends) {
    const distance = Math.hypot(end.x - x, end.y - y);
    if (distance <= end.radius + slackPx && distance < bestDistance) { best = end; bestDistance = distance; }
  }
  return best;
}
