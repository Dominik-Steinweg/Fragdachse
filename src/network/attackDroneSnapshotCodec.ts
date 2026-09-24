import type { AttackDronePhase, SyncedAttackDrone, SyncedAttackDroneBomb } from '../types';

const phases: readonly AttackDronePhase[] = ['catchup', 'patrol', 'gun', 'bomb_approach', 'bomb_run', 'returning', 'servicing', 'docked'];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
const natural = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;

export function encodeAttackDrones(drones: readonly SyncedAttackDrone[]): unknown[] {
  return drones.map(d => [d.id, d.stationId, d.ownerId, d.ownerColor, d.x, d.y, d.flightAngle, d.gunAngle,
    phases.indexOf(d.phase), d.phaseStartedAt, d.lastShotAt, d.shotSequence]);
}
export function decodeAttackDrones(raw: unknown): SyncedAttackDrone[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  return raw.flatMap(d => {
    if (!Array.isArray(d) || d.length !== 12 || !id(d[0]) || !natural(d[1]) || !id(d[2])
      || !natural(d[3]) || !d.slice(4, 8).every(finite) || !natural(d[8]) || !phases[d[8]]
      || !finite(d[9]) || !finite(d[10]) || !natural(d[11]) || seen.has(d[1])) return [];
    seen.add(d[1]);
    return [{ id: d[0], stationId: d[1], ownerId: d[2], ownerColor: d[3], x: d[4], y: d[5],
      flightAngle: d[6], gunAngle: d[7], phase: phases[d[8]], phaseStartedAt: d[9], lastShotAt: d[10], shotSequence: d[11] }];
  });
}
export function encodeAttackDroneBombs(bombs: readonly SyncedAttackDroneBomb[]): unknown[] {
  return bombs.map(b => [b.id, b.stationId, b.ownerId, b.x, b.y, b.droppedAt, b.landsAt]);
}
export function decodeAttackDroneBombs(raw: unknown): SyncedAttackDroneBomb[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap(b => {
    if (!Array.isArray(b) || b.length !== 7 || !id(b[0]) || !natural(b[1]) || !id(b[2])
      || !b.slice(3).every(finite) || b[6] < b[5] || seen.has(b[0])) return [];
    seen.add(b[0]);
    return [{ id: b[0], stationId: b[1], ownerId: b[2], x: b[3], y: b[4], droppedAt: b[5], landsAt: b[6] }];
  });
}
