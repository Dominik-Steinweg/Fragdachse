import type { SyncedBeeSwarm } from '../types';

/** Wire order of the swarm phases (matches `BEE_SWARM_PHASE_CODES`). */
const phases: readonly SyncedBeeSwarm['phase'][] = ['hunting', 'dispersed', 'returning'];
const targetKinds = [null, 'player', 'enemy'] as const;
export const BEE_SWARM_MAX_SWARMS = 32;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const natural = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const targetId = (value: unknown): value is string => typeof value === 'string' && value.length <= 200;

/**
 * Slice `sw`: `[id, hiveIndex, phase, phaseStartedAt, releasedAt, x*10, y*10, targetKind, targetId,
 * flags, stingSequence]` per swarm. Positions travel in tenths of a pixel.
 */
export function encodeBeeSwarms(swarms: readonly SyncedBeeSwarm[]): unknown[] {
  return swarms.slice(0, BEE_SWARM_MAX_SWARMS).map(s => [s.id, s.hiveIndex, phases.indexOf(s.phase), s.phaseStartedAt,
    s.releasedAt, Math.round(s.x * 10), Math.round(s.y * 10), s.target ? targetKinds.indexOf(s.target.kind) : 0,
    s.target?.id ?? '', s.hostile ? 1 : 0, s.stingSequence]);
}

/** Malformed entries are dropped one by one; a duplicate id keeps its first entry. */
export function decodeBeeSwarms(raw: unknown): SyncedBeeSwarm[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const swarms: SyncedBeeSwarm[] = [];
  for (const s of raw.slice(0, BEE_SWARM_MAX_SWARMS)) {
    if (!Array.isArray(s) || s.length !== 11 || !natural(s[0]) || !natural(s[1]) || !natural(s[2]) || !phases[s[2]]
      || !finite(s[3]) || !finite(s[4]) || !finite(s[5]) || !finite(s[6]) || !natural(s[7]) || s[7] >= targetKinds.length
      || !targetId(s[8]) || (s[7] !== 0 && s[8] === '') || (s[9] !== 0 && s[9] !== 1) || !natural(s[10]) || seen.has(s[0])) continue;
    seen.add(s[0]);
    const kind = targetKinds[s[7]];
    swarms.push({ id: s[0], hiveIndex: s[1], phase: phases[s[2]], phaseStartedAt: s[3], releasedAt: s[4],
      x: s[5] / 10, y: s[6] / 10, target: kind ? { kind, id: s[8] } : null, hostile: s[9] === 1, stingSequence: s[10] });
  }
  return swarms;
}
