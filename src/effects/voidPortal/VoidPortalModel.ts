import type { ResolvedCoopDefensePortalLinkConfig } from '../../config/coopDefensePortalLinks';
import type { PortalLinkEndpoints, PortalLinkPhase, PortalLinkStateEntry } from '../../systems/portal/PortalLinkSystem';
import type { PortalPoint } from '../../systems/PortalTraversal';
import type { PortalEndView } from '../portal/PortalViews';

/** Renderer-free view of one generator portal link at a mission time. */
export interface VoidPortalLinkView {
  readonly id: string;
  readonly a: PortalPoint;
  readonly b: PortalPoint;
  readonly radius: number;
  readonly phase: PortalLinkPhase;
  /** 0..1 while charging, 1 once open. */
  readonly chargeFraction: number;
  /** Mission time since the link opened; 0 before. */
  readonly openAgeMs: number;
}

export function resolveVoidPortalViews(
  links: readonly ResolvedCoopDefensePortalLinkConfig[],
  endpoints: ReadonlyMap<string, PortalLinkEndpoints>,
  entries: readonly PortalLinkStateEntry[] | null,
  elapsedMs: number,
): VoidPortalLinkView[] {
  if (!entries) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const views: VoidPortalLinkView[] = [];
  for (const link of links) {
    const entry = byId.get(link.id), ends = endpoints.get(link.id);
    if (!entry || !ends || entry.phase === 'waiting' || entry.phase === 'collapsed') continue;
    const chargeFraction = entry.phase === 'open' ? 1
      : Math.max(0, Math.min(1, (elapsedMs - (entry.chargeStartedAtMs ?? elapsedMs)) / Math.max(1, link.chargeDurationMs)));
    views.push({ id: link.id, a: ends.a, b: ends.b, radius: link.radiusPx, phase: entry.phase, chargeFraction,
      openAgeMs: entry.phase === 'open' ? Math.max(0, elapsedMs - (entry.openedAtMs ?? elapsedMs)) : 0 });
  }
  return views;
}

export interface VoidPortalCollapseEvent { readonly id: string; readonly wasOpen: boolean }

/**
 * Turns replicated lifecycle snapshots into one-shot collapse events. The first snapshot after a
 * reset is only a baseline, so a late joiner never replays a collapse that happened before.
 */
export class VoidPortalTransitionTracker {
  private previous: Map<string, PortalLinkPhase> | null = null;

  observe(entries: readonly PortalLinkStateEntry[] | null): VoidPortalCollapseEvent[] {
    if (!entries) { this.previous = null; return []; }
    const next = new Map(entries.map((entry) => [entry.id, entry.phase]));
    const before = this.previous;
    this.previous = next;
    if (!before) return [];
    const events: VoidPortalCollapseEvent[] = [];
    for (const [id, phase] of next) {
      const was = before.get(id);
      if (phase === 'collapsed' && was !== undefined && was !== 'collapsed') events.push({ id, wasOpen: was === 'open' });
    }
    return events;
  }

  reset(): void { this.previous = null; }
}

const OPEN_MS = 400;

/**
 * Both ends of a generator link in the shared portal look. Charging ends are still forming. The
 * link works both ways, so neither end shows a preferred direction; transfers do.
 */
export function voidPortalEndViews(view: VoidPortalLinkView): PortalEndView[] {
  const charging = view.phase === 'charging';
  const open = charging ? 1 : Math.min(1, view.openAgeMs / OPEN_MS);
  const common = { radius: view.radius, style: 'void' as const, open: 1 - (1 - open) ** 3, ground: 1,
    ...(charging ? { charge: view.chargeFraction } : {}) };
  return [
    { ...common, key: `${view.id}:a`, x: view.a.x, y: view.a.y, partner: view.b },
    { ...common, key: `${view.id}:b`, x: view.b.x, y: view.b.y, partner: view.a },
  ];
}
