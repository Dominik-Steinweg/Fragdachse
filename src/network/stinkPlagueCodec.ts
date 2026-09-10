import type { StinkPlagueSnapshot, SyncedPlagueTarget, PlagueTransfer } from '../systems/StinkPlagueRuntime';

export function emptyStinkPlagueSnapshot(): StinkPlagueSnapshot { return { targets: [], transfers: [], transferSequence: 0 }; }

export function encodeStinkPlague(snapshot: StinkPlagueSnapshot): unknown {
  return { q: snapshot.transferSequence,
    t: snapshot.targets.map(t => [t.enemyId, t.entityGeneration, t.expiresAt, t.infectiousUntil]),
    e: snapshot.transfers.map(e => [e.sequence, e.fromX, e.fromY, e.toX, e.toY, e.createdAt]) };
}

export function decodeStinkPlague(raw: unknown): StinkPlagueSnapshot {
  if (!raw || typeof raw !== 'object') return emptyStinkPlagueSnapshot();
  const r = raw as { q?: unknown; t?: unknown; e?: unknown };
  if (!Number.isSafeInteger(r.q) || Number(r.q) < 0 || !Array.isArray(r.t) || !Array.isArray(r.e)) return emptyStinkPlagueSnapshot();
  const targets: SyncedPlagueTarget[] = [], transfers: PlagueTransfer[] = [];
  for (const t of r.t) if (Array.isArray(t) && t.length === 4 && typeof t[0] === 'string' && t[0].length
    && Number.isSafeInteger(t[1]) && t[1] >= 0 && Number.isFinite(t[2]) && t[2] >= 0
    && Number.isFinite(t[3]) && t[3] >= 0 && t[3] <= t[2]) {
    targets.push({ enemyId: t[0], entityGeneration: t[1], expiresAt: t[2], infectiousUntil: t[3] });
  }
  for (const e of r.e) if (Array.isArray(e) && e.length === 6 && e.every(Number.isFinite)
    && Number.isSafeInteger(e[0]) && e[0] > 0 && e[0] <= Number(r.q) && e[5] >= 0) {
    transfers.push({ sequence: e[0], fromX: e[1], fromY: e[2], toX: e[3], toY: e[4], createdAt: e[5] });
  }
  return { targets, transfers, transferSequence: Number(r.q) };
}
