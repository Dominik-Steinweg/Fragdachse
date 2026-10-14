import {
  EMPTY_BOMBER_SQUADRON_SNAPSHOT,
  type BomberSquadronDeploymentSnapshot,
  type BomberSquadronPlanParams,
  type BomberSquadronSnapshot,
} from '../systems/bomberSquadron/BomberSquadronSnapshot';

/**
 * bq replaces all squadrons; [] clears them, including on a full bootstrap.
 * Squadron: [id, owner, color, startedAt, endsAt, angle1000, params, anchors, stoppedAt?].
 * Params follow planKeys below. Only anchor positions (x10/y10) and angles are quantized;
 * frozen plan values and absolute host times retain their precision.
 * An anchor is [x10, y10], or 0 while its drone has no confirmed launch anchor.
 */
const planKeys = [
  'droneCount', 'bombsPerPass', 'passCount', 'launchIntervalMs', 'approachMs',
  'approachDistancePx', 'runSpeedPxPerSec', 'corridorLeadPx', 'corridorLengthPx',
  'corridorWidthPx', 'turnMs', 'departureMs', 'bombFallMs', 'explosionRadius',
] as const satisfies readonly (keyof BomberSquadronPlanParams)[];
type WireSquadron = [number, string, number, number, number, number, number[], (0 | [number, number])[], number?];
export type EncodedBomberSquadronSnapshot = WireSquadron[];

const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const natural = (v: unknown): v is number => integer(v) && v >= 0;
const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
// Wire safety ceilings, deliberately above authored tuning; bound plan expansion on receivers.
const count = (v: unknown): v is number => natural(v) && v > 0 && v <= 64;

export function encodeBomberSquadronSnapshot(snapshot: BomberSquadronSnapshot): EncodedBomberSquadronSnapshot {
  return snapshot.squadrons.map(d => [d.id, d.ownerId, d.ownerColor, d.startedAt, d.endsAt,
    Math.round(d.angle * 1000), planKeys.map(key => d.params[key]),
    d.anchors.map(a => a === null ? 0 : [Math.round(a.x * 10), Math.round(a.y * 10)]),
    ...(d.stoppedAt === null ? [] : [d.stoppedAt]),
  ] as WireSquadron);
}

// Cache only decoded facts, never mutable host snapshots or caller-owned wire arrays.
const decodedWire = new WeakMap<BomberSquadronSnapshot, EncodedBomberSquadronSnapshot>();
decodedWire.set(EMPTY_BOMBER_SQUADRON_SNAPSHOT, []);
function sameWire(raw: unknown, previous: readonly unknown[]): boolean {
  return Array.isArray(raw) && raw.length === previous.length && previous.every((value, i) =>
    Array.isArray(value) ? sameWire(raw[i], value) : raw[i] === value);
}

/** Reject malformed slices atomically; identical wire facts keep the entire snapshot identity. */
export function decodeBomberSquadronSnapshot(
  raw: unknown,
  previous: BomberSquadronSnapshot = EMPTY_BOMBER_SQUADRON_SNAPSHOT,
): BomberSquadronSnapshot | null {
  const previousWire = decodedWire.get(previous);
  if (previousWire && sameWire(raw, previousWire)) return previous;
  if (!Array.isArray(raw) || raw.length > 64) return null;
  if (raw.length === 0) return EMPTY_BOMBER_SQUADRON_SNAPSHOT;
  const squadrons: BomberSquadronDeploymentSnapshot[] = [];
  const ids = new Set<number>();
  for (const d of raw) {
    if (!Array.isArray(d) || (d.length !== 8 && d.length !== 9)
      || !natural(d[0]) || ids.has(d[0]) || typeof d[1] !== 'string' || !d[1].length || d[1].length > 200
      || !natural(d[2]) || d[2] > 0xffffff || !time(d[3]) || !time(d[4]) || d[4] < d[3]
      || !integer(d[5]) || !Array.isArray(d[6]) || d[6].length !== planKeys.length
      || !Array.isArray(d[7]) || (d.length === 9 && (!time(d[8]) || d[8] < d[3]))) return null;
    const p = d[6];
    if (!count(p[0]) || !count(p[1]) || (p[2] !== 1 && p[2] !== 2) || d[7].length !== p[0]) return null;
    for (let i = 3; i < planKeys.length; i++) {
      if (!time(p[i]) || p[i] > (planKeys[i].endsWith('Ms') ? 60_000 : 1_000_000)) return null;
    }
    if (p[6] <= 0 || p[8] <= 0) return null;
    const anchors: BomberSquadronDeploymentSnapshot['anchors'][number][] = [];
    for (const a of d[7]) {
      if (a === 0) anchors.push(null);
      else {
        if (!Array.isArray(a) || a.length !== 2 || !integer(a[0]) || !integer(a[1])) return null;
        anchors.push({ x: a[0] / 10, y: a[1] / 10 });
      }
    }
    ids.add(d[0]);
    const params = Object.fromEntries(planKeys.map((key, i) => [key, p[i]])) as unknown as BomberSquadronPlanParams;
    squadrons.push({ id: d[0], ownerId: d[1], ownerColor: d[2], startedAt: d[3], endsAt: d[4],
      angle: d[5] / 1000, params, anchors, stoppedAt: d.length === 9 ? d[8] : null });
  }
  const snapshot = { squadrons };
  decodedWire.set(snapshot, encodeBomberSquadronSnapshot(snapshot));
  return snapshot;
}
