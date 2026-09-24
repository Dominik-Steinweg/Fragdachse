import authored from './attackDrone.json';

for (const [key, value] of Object.entries(authored)) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`[attackDrone] Invalid ${key}`);
}
if (authored.burstMs % authored.shotIntervalMs !== 0
  || authored.magazine % (authored.burstMs / authored.shotIntervalMs) !== 0
  || authored.serviceReductionPerLevel * 3 >= 1
  || authored.catchupEndRadius >= authored.catchupStartRadius) {
  throw new Error('[attackDrone] Inconsistent timing, magazine or flight rules');
}

export const ATTACK_DRONE_RULES = Object.freeze(authored);
export const ATTACK_DRONE_STAT_PREFIX = 'construction.attack_drone_station.';
export const ATTACK_DRONE_SOURCE = Object.freeze({
  gun: 'ATTACK_DRONE_GUN', bomb: 'ATTACK_DRONE_BOMB', chunk: 'ATTACK_DRONE_CHUNK', fire: 'ground_fire.attack_drone',
});

export interface AttackDroneStats {
  readonly patrolSpeed: number;
  readonly attackSpeed: number;
  readonly travelSpeed: number;
  readonly regenerationPerMs: number;
  readonly serviceMs: number;
  readonly penetration: number;
  readonly bombsEnabled: boolean;
  readonly bombCount: number;
  readonly chunksPerBomb: number;
}

export function resolveAttackDroneStats(numeric: (stat: string) => number = () => 0): AttackDroneStats {
  const level = (name: string, max = 3) => {
    const value = numeric(ATTACK_DRONE_STAT_PREFIX + name);
    return Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
  };
  const r = ATTACK_DRONE_RULES;
  const speed = 1 + r.speedPerLevel * level('flight');
  const bombsEnabled = level('bombBay', 1) > 0;
  return {
    patrolSpeed: r.patrolSpeed * speed, attackSpeed: r.attackSpeed * speed, travelSpeed: r.travelSpeed * speed,
    regenerationPerMs: r.magazine * r.regenerationPerLevel * level('selfLoader') / 1000,
    serviceMs: r.serviceMs * (1 - r.serviceReductionPerLevel * level('service')),
    penetration: level('penetration'), bombsEnabled,
    bombCount: r.bombCount + (bombsEnabled ? r.bombsPerLevel * level('bombCount') : 0),
    chunksPerBomb: bombsEnabled ? level('fireChunks') : 0,
  };
}

export const attackDroneBurstShots = () => ATTACK_DRONE_RULES.burstMs / ATTACK_DRONE_RULES.shotIntervalMs;

/** Complete bursts within the horizon; no regeneration during gun fire. */
export function forecastAttackDroneBursts(ammo: number, regenerationPerMs: number, readyInMs = 0,
  horizonMs = ATTACK_DRONE_RULES.forecastMs, exhausted = false): number {
  const r = ATTACK_DRONE_RULES, needed = attackDroneBurstShots();
  let t = Math.max(0, readyInMs), rounds = Math.min(r.magazine, ammo + t * regenerationPerMs), bursts = 0;
  while (t < horizonMs) {
    if (rounds < 1) exhausted = true;
    if (rounds + 1e-8 >= needed) exhausted = false;
    if (exhausted) {
      if (regenerationPerMs <= 0) break;
      t += (needed - rounds) / regenerationPerMs;
      rounds = needed;
      exhausted = false;
    }
    const shots = Math.min(needed, Math.floor(rounds + 1e-8));
    const duration = shots === needed ? r.burstMs : (shots - 1) * r.shotIntervalMs;
    if (t + duration > horizonMs + 1e-8) break;
    rounds -= shots;
    if (shots === needed) bursts++;
    exhausted = rounds < 1;
    t += duration + r.pauseMs;
    rounds = Math.min(r.magazine, rounds + r.pauseMs * regenerationPerMs);
  }
  return bursts;
}

export function shouldServiceAttackDrone(input: {
  ammo: number; stats: AttackDroneStats; outboundDistance: number; inboundDistance: number;
  gunReadyInMs: number; hasTargets: boolean;
  exhausted?: boolean;
}): boolean {
  const r = ATTACK_DRONE_RULES, s = input.stats;
  if (!input.hasTargets) return s.regenerationPerMs === 0 && input.ammo < r.magazine;
  if (input.ammo >= attackDroneBurstShots()) return false;
  if (s.regenerationPerMs === 0) return true;
  const travelMs = (input.outboundDistance + input.inboundDistance) / s.travelSpeed * 1000 + s.serviceMs;
  const stay = forecastAttackDroneBursts(input.ammo, s.regenerationPerMs, input.gunReadyInMs, r.forecastMs, input.exhausted);
  const station = forecastAttackDroneBursts(r.magazine, s.regenerationPerMs,
    Math.max(0, input.gunReadyInMs - travelMs), Math.max(0, r.forecastMs - travelMs));
  return station >= stay + r.returnBurstAdvantage;
}
