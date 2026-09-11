import { emptyMgAttritionSnapshot, type MgAttritionSnapshot, type MgVisualTarget, type MgTransfer } from '../systems/MgAttritionRuntime';

export function encodeMgAttrition(snapshot: MgAttritionSnapshot): unknown {
  return { q: snapshot.transferSequence,
    t: snapshot.targets.map(({ target: t, expiresAt, bleedUntil }) => [t.kind, t.id, t.scope.worldRevision,
      t.scope.runtimeGeneration, t.instance.entityGeneration, t.instance.activityRevision ?? null,
      t.instance.lifeRevision ?? null, expiresAt, bleedUntil]),
    e: snapshot.transfers.map(e => [e.sequence, e.fromX, e.fromY, e.toX, e.toY, e.createdAt]) };
}
export function decodeMgAttrition(raw: unknown): MgAttritionSnapshot {
  if (!raw || typeof raw !== 'object') return emptyMgAttritionSnapshot();
  const r = raw as { q?: unknown; t?: unknown; e?: unknown };
  const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!integer(r.q) || !Array.isArray(r.t) || !Array.isArray(r.e)) return emptyMgAttritionSnapshot();
  const targets: MgVisualTarget[] = [], transfers: MgTransfer[] = [];
  for (const t of r.t) {
    if (!Array.isArray(t) || t.length !== 9 || (t[0] !== 'enemy' && t[0] !== 'base')
      || typeof t[1] !== 'string' || !t[1] || ![t[2], t[3], t[4]].every(integer)
      || (t[5] !== null && !integer(t[5])) || (t[6] !== null && !integer(t[6]))
      || !time(t[7]) || !time(t[8]) || t[8] > t[7]) continue;
    targets.push({ target: { kind: t[0], id: t[1], scope: { worldRevision: t[2], runtimeGeneration: t[3] },
      instance: { entityGeneration: t[4], ...(t[5] === null ? {} : { activityRevision: t[5] }),
        ...(t[6] === null ? {} : { lifeRevision: t[6] }) } }, expiresAt: t[7], bleedUntil: t[8] });
  }
  for (const e of r.e) if (Array.isArray(e) && e.length === 6 && e.every(Number.isFinite)
    && integer(e[0]) && e[0] > 0 && e[0] <= r.q && time(e[5])) {
    transfers.push({ sequence: e[0], fromX: e[1], fromY: e[2], toX: e[3], toY: e[4], createdAt: e[5] });
  }
  return { targets, transfers, transferSequence: r.q };
}
