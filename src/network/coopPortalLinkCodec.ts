import type { PortalLinkPhase, PortalLinkStateEntry } from '../systems/portal/PortalLinkSystem';

/**
 * Wire form of the generator portal links (`cpl`). It carries only the lifecycle by link id and
 * mission time; both peers resolve the geometry from the authored Activity. A malformed or
 * foreign-round snapshot is rejected as a whole.
 */
export interface WirePortalLinkEntry {
  readonly i: string;
  readonly s: 'w' | 'c' | 'o' | 'x';
  readonly c?: number;
  readonly o?: number;
  readonly x?: number;
}
export interface WirePortalLinkState {
  readonly rr: number;
  readonly l: readonly WirePortalLinkEntry[];
}

export const MAX_WIRE_PORTAL_LINKS = 4;
const LINK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const TO_WIRE: Record<PortalLinkPhase, WirePortalLinkEntry['s']> = { waiting: 'w', charging: 'c', open: 'o', collapsed: 'x' };
const FROM_WIRE: Record<WirePortalLinkEntry['s'], PortalLinkPhase> = { w: 'waiting', c: 'charging', o: 'open', x: 'collapsed' };

export function encodePortalLinkState(roundRevision: number, entries: readonly PortalLinkStateEntry[]): WirePortalLinkState {
  return { rr: roundRevision, l: entries.map((entry) => ({
    i: entry.id, s: TO_WIRE[entry.phase],
    ...(entry.chargeStartedAtMs === undefined ? {} : { c: Math.round(entry.chargeStartedAtMs) }),
    ...(entry.openedAtMs === undefined ? {} : { o: Math.round(entry.openedAtMs) }),
    ...(entry.collapsedAtMs === undefined ? {} : { x: Math.round(entry.collapsedAtMs) }),
  })) };
}

export function decodePortalLinkState(raw: unknown, expectedRoundRevision: number | null): readonly PortalLinkStateEntry[] | null {
  if (expectedRoundRevision === null || !raw || typeof raw !== 'object') return null;
  const { rr, l } = raw as Partial<WirePortalLinkState>;
  if (rr !== expectedRoundRevision || !Array.isArray(l) || l.length > MAX_WIRE_PORTAL_LINKS) return null;
  const ids = new Set<string>();
  const entries: PortalLinkStateEntry[] = [];
  for (const wire of l as unknown[]) {
    const entry = decodeEntry(wire);
    if (!entry || ids.has(entry.id)) return null;
    ids.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

function decodeEntry(raw: unknown): PortalLinkStateEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const { i, s, c, o, x } = raw as Record<string, unknown>;
  if (typeof i !== 'string' || !LINK_ID.test(i) || typeof s !== 'string' || !(s in FROM_WIRE)) return null;
  const phase = FROM_WIRE[s as WirePortalLinkEntry['s']];
  const times = [c, o, x].map((value) => value === undefined ? undefined
    : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);
  if (times.includes(null)) return null;
  const [chargeStartedAtMs, openedAtMs, collapsedAtMs] = times as (number | undefined)[];
  // Each phase carries exactly the times it has passed, in order.
  const shapeOk = phase === 'waiting' ? c === undefined && o === undefined && x === undefined
    : phase === 'charging' ? chargeStartedAtMs !== undefined && o === undefined && x === undefined
      : phase === 'open' ? chargeStartedAtMs !== undefined && openedAtMs !== undefined && x === undefined
        : collapsedAtMs !== undefined && (openedAtMs === undefined || chargeStartedAtMs !== undefined);
  if (!shapeOk) return null;
  const ordered = [chargeStartedAtMs, openedAtMs, collapsedAtMs].filter((value): value is number => value !== undefined);
  if (ordered.some((value, index) => index > 0 && value < ordered[index - 1])) return null;
  return { id: i, phase,
    ...(chargeStartedAtMs === undefined ? {} : { chargeStartedAtMs }),
    ...(openedAtMs === undefined ? {} : { openedAtMs }),
    ...(collapsedAtMs === undefined ? {} : { collapsedAtMs }) };
}
