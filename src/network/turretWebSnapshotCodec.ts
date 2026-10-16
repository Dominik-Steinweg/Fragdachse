import type { SyncedTurretWeb, SyncedTurretWebSnapshot, SyncedWebShot } from '../types';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const turretId = (value: unknown): value is number | string =>
  (typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && value.length > 0);

function readShot(value: unknown): SyncedWebShot | null {
  if (!value || typeof value !== 'object') return null;
  const shot = value as SyncedWebShot;
  return Number.isSafeInteger(shot.id) && turretId(shot.turretId)
    && [shot.sourceX, shot.sourceY, shot.targetX, shot.targetY, shot.launchAt, shot.impactAt].every(finite)
    && shot.launchAt <= shot.impactAt
    ? { id: shot.id, turretId: shot.turretId, sourceX: shot.sourceX, sourceY: shot.sourceY, targetX: shot.targetX,
      targetY: shot.targetY, launchAt: shot.launchAt, impactAt: shot.impactAt } : null;
}

function readWeb(value: unknown): SyncedTurretWeb | null {
  if (!value || typeof value !== 'object') return null;
  const web = value as SyncedTurretWeb;
  return turretId(web.turretId) && [web.x, web.y, web.appliedAt, web.expiresAt].every(finite) && web.appliedAt <= web.expiresAt
    ? { turretId: web.turretId, x: web.x, y: web.y, appliedAt: web.appliedAt, expiresAt: web.expiresAt } : null;
}

/** Validating decode of the `tw` slice; invalid entries are dropped, a missing slice yields null. */
export function decodeTurretWebSnapshot(raw: unknown): SyncedTurretWebSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as { shots?: unknown; webs?: unknown };
  const shots = Array.isArray(value.shots) ? value.shots.map(readShot).filter((shot): shot is SyncedWebShot => !!shot) : [];
  const webs = Array.isArray(value.webs) ? value.webs.map(readWeb).filter((web): web is SyncedTurretWeb => !!web) : [];
  return { shots, webs };
}
