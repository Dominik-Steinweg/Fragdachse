import {
  EMPTY_FIRE_CONTROL_SNAPSHOT,
  fireControlHoloSourceId,
  type FireControlCopySnapshot,
  type FireControlDeploymentSnapshot,
  type FireControlEntrySnapshot,
  type FireControlHoloCopySnapshot,
  type FireControlSnapshot,
} from '../systems/fireControl/FireControlSnapshot';

/**
 * fc is a complete replacement, including [] for cleanup (also in the full bootstrap).
 * Deployment: [kind, id, owner, color, x10, y10, startedAt, expiresAt, flag, sources].
 * Holo deployment (kind 2) appends [copyLifetimeMs, materializeMs, spawnUntil]; its flag is 0.
 * Copy: [source, original, construction, weapon, x10, y10, angle1000, status, materializedAt, paused].
 * Entry: [source, identity, mode, x10, y10, angle1000, lastTransportAt?].
 * Holo copy: [seq, weapon, x10, y10, angle1000, spawnedAt]; the source ID is derived from deployment and seq.
 * kind is copies/portal/holo = 0/1/2; status/flags are 0/1; entry modes are portal/waiting/local = 0/1/2.
 * Times remain absolute host milliseconds, without quantization or local-clock conversion.
 */
type WireRow = (number | string | WireRow[])[];
export type EncodedFireControlSnapshot = WireRow[];
const modes = ['portal', 'waiting', 'local'] as const;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const natural = (v: unknown): v is number => integer(v) && v >= 0;
const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const bit = (v: unknown): v is 0 | 1 => v === 0 || v === 1;

function encodeDeployment(d: FireControlDeploymentSnapshot): WireRow {
  const base: WireRow = [d.id, d.ownerId, d.ownerColor, Math.round(d.x * 10), Math.round(d.y * 10), d.startedAt, d.expiresAt];
  if (d.kind === 'copies') {
    return [0, ...base, Number(d.parallel), d.copies.map(c => [c.sourceId, c.originalId, c.constructionId, c.weaponId,
      Math.round(c.x * 10), Math.round(c.y * 10), Math.round(c.angle * 1000),
      c.status === 'materializing' ? 0 : 1, c.materializedAt, Number(c.originalPaused)])];
  }
  if (d.kind === 'portal') {
    return [1, ...base, Number(d.localFireRelease), d.entries.map(e => [e.sourceId, e.identityId, modes.indexOf(e.mode),
      Math.round(e.x * 10), Math.round(e.y * 10), Math.round(e.angle * 1000),
      ...(e.lastTransportAt === undefined ? [] : [e.lastTransportAt])])];
  }
  return [2, ...base, 0, d.copies.map(c => [c.seq, c.weaponId, Math.round(c.x * 10), Math.round(c.y * 10),
    Math.round(c.angle * 1000), c.spawnedAt]), d.copyLifetimeMs, d.materializeMs, d.spawnUntil];
}

export function encodeFireControlSnapshot(snapshot: FireControlSnapshot): EncodedFireControlSnapshot {
  return snapshot.deployments.map(encodeDeployment);
}

// Only decoded snapshots are cached: callers may replace or mutate their host-side facts.
const decodedWire = new WeakMap<FireControlSnapshot, EncodedFireControlSnapshot>();
decodedWire.set(EMPTY_FIRE_CONTROL_SNAPSHOT, []);
function sameWire(raw: unknown, previous: readonly unknown[]): boolean {
  return Array.isArray(raw) && raw.length === previous.length && previous.every((value, i) =>
    Array.isArray(value) ? sameWire(raw[i], value) : raw[i] === value);
}

/** Invalid slices are rejected atomically. Unchanged wire facts retain all array identities. */
export function decodeFireControlSnapshot(
  raw: unknown,
  previous: FireControlSnapshot = EMPTY_FIRE_CONTROL_SNAPSHOT,
): FireControlSnapshot | null {
  const previousWire = decodedWire.get(previous);
  if (previousWire && sameWire(raw, previousWire)) return previous;
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return EMPTY_FIRE_CONTROL_SNAPSHOT;
  const deployments: FireControlDeploymentSnapshot[] = [];
  const deploymentIds = new Set<number>();
  const copyIds = new Set<string>();
  for (const d of raw) {
    if (!Array.isArray(d) || !(d[0] === 0 || d[0] === 1 || d[0] === 2) || d.length !== (d[0] === 2 ? 13 : 10)
      || !natural(d[1]) || deploymentIds.has(d[1])
      || !id(d[2]) || !natural(d[3]) || d[3] > 0xffffff || !integer(d[4]) || !integer(d[5])
      || !time(d[6]) || !time(d[7]) || d[7] < d[6] || !bit(d[8]) || !Array.isArray(d[9])) return null;
    deploymentIds.add(d[1]);
    const base = { id: d[1], ownerId: d[2], ownerColor: d[3], x: d[4] / 10, y: d[5] / 10,
      startedAt: d[6], expiresAt: d[7] };
    if (d[0] === 0) {
      const copies: FireControlCopySnapshot[] = [];
      for (const c of d[9]) {
        if (!Array.isArray(c) || c.length !== 10 || !id(c[0]) || copyIds.has(c[0]) || !natural(c[1])
          || !id(c[2]) || !id(c[3]) || !integer(c[4]) || !integer(c[5]) || !integer(c[6])
          || !bit(c[7]) || !time(c[8]) || !bit(c[9])) return null;
        copyIds.add(c[0]);
        copies.push({ sourceId: c[0], originalId: c[1], constructionId: c[2], weaponId: c[3],
          x: c[4] / 10, y: c[5] / 10, angle: c[6] / 1000, status: c[7] === 0 ? 'materializing' : 'active',
          materializedAt: c[8], originalPaused: c[9] === 1 });
      }
      deployments.push({ ...base, kind: 'copies', parallel: d[8] === 1, copies });
    } else if (d[0] === 1) {
      const entries: FireControlEntrySnapshot[] = [];
      const sourceIds = new Set<string | number>();
      for (const e of d[9]) {
        if (!Array.isArray(e) || (e.length !== 6 && e.length !== 7) || (!id(e[0]) && !natural(e[0]))
          || sourceIds.has(e[0]) || !natural(e[1]) || !natural(e[2]) || !modes[e[2]]
          || !integer(e[3]) || !integer(e[4]) || !integer(e[5]) || (e.length === 7 && !time(e[6]))) return null;
        sourceIds.add(e[0]);
        entries.push({ sourceId: e[0], identityId: e[1], mode: modes[e[2]], x: e[3] / 10,
          y: e[4] / 10, angle: e[5] / 1000, ...(e.length === 7 ? { lastTransportAt: e[6] } : {}) });
      }
      deployments.push({ ...base, kind: 'portal', localFireRelease: d[8] === 1, entries });
    } else {
      if (d[8] !== 0 || !natural(d[10]) || !natural(d[11]) || !time(d[12]) || d[12] < d[6]) return null;
      const copies: FireControlHoloCopySnapshot[] = [];
      const seqs = new Set<number>();
      for (const c of d[9]) {
        if (!Array.isArray(c) || c.length !== 6 || !natural(c[0]) || seqs.has(c[0]) || !id(c[1])
          || !integer(c[2]) || !integer(c[3]) || !integer(c[4]) || !time(c[5])) return null;
        seqs.add(c[0]);
        copies.push({ seq: c[0], sourceId: fireControlHoloSourceId(d[1], c[0]), weaponId: c[1] as FireControlHoloCopySnapshot['weaponId'],
          x: c[2] / 10, y: c[3] / 10, angle: c[4] / 1000, spawnedAt: c[5] });
      }
      deployments.push({ ...base, kind: 'holo', copyLifetimeMs: d[10], materializeMs: d[11], spawnUntil: d[12], copies });
    }
  }
  const snapshot = { deployments };
  decodedWire.set(snapshot, encodeFireControlSnapshot(snapshot));
  return snapshot;
}
