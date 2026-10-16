import type { CoopDefenseEnemyHopHealConfig } from '../config/coopDefenseEnemies';

/** Body view the rest-heal rules need; the host builds it from live enemies. */
export interface RestHealBody {
  readonly id: string;
  readonly faction: string;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly active: boolean;
  /** Burrowed or submerged bodies cannot be reached by a heal link. */
  readonly hidden: boolean;
}

/** An existing link survives slightly beyond the heal radius so bodies at its edge do not flicker. */
export const REST_HEAL_LINK_EXIT_FACTOR = 1.15;
/** Allies already linked by another healer count this much toward a landing's heal value. */
export const REST_HEAL_SHARED_TARGET_WEIGHT = 0.5;

/** Injured, living, visible allies of the healer's faction; never the healer itself. */
export function isRestHealCandidate(healer: Pick<RestHealBody, 'id' | 'faction'>, target: RestHealBody): boolean {
  return target.id !== healer.id && target.faction === healer.faction && target.active && !target.hidden
    && target.hp > 0 && target.hp < target.maxHp;
}

/** Healing one rest can deliver to a single ally at most (the rest is capped). */
export function restHealCapacity(heal: CoopDefenseEnemyHopHealConfig, restMaxMs: number): number {
  return heal.healPerTick * Math.max(1, Math.floor(restMaxMs / heal.tickIntervalMs));
}

/**
 * Links of a resting healer: kept links stay while valid (within the exit radius and visible),
 * free slots go to the most injured visible allies in reach (missing HP, then distance, then id).
 */
export function selectRestHealLinks(healer: RestHealBody, candidates: readonly RestHealBody[], previous: readonly string[],
  heal: CoopDefenseEnemyHopHealConfig, canSee: (target: RestHealBody) => boolean): string[] {
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const exitSq = (heal.radiusPx * REST_HEAL_LINK_EXIT_FACTOR) ** 2, radiusSq = heal.radiusPx ** 2;
  const links: string[] = [];
  for (const id of previous) {
    const target = byId.get(id);
    if (links.length >= heal.maxLinks || !target || !isRestHealCandidate(healer, target)
      || distanceSq(healer, target) > exitSq || !canSee(target)) continue;
    links.push(id);
  }
  if (links.length >= heal.maxLinks) return links;
  const fresh = candidates
    .filter(target => !links.includes(target.id) && isRestHealCandidate(healer, target) && distanceSq(healer, target) <= radiusSq)
    .sort((left, right) => (right.maxHp - right.hp) - (left.maxHp - left.hp)
      || distanceSq(healer, left) - distanceSq(healer, right) || left.id.localeCompare(right.id));
  for (const target of fresh) {
    if (links.length >= heal.maxLinks) break;
    if (canSee(target)) links.push(target.id);
  }
  return links;
}

/**
 * Healing a rest at `point` could deliver: the best `maxLinks` allies in reach, each counted up to
 * the per-rest capacity, so a group outweighs one badly hurt ally. Allies another healer already
 * links count only partly, which spreads several healers over several groups.
 */
export function restHealClusterValue(point: { readonly x: number; readonly y: number }, healer: Pick<RestHealBody, 'id' | 'faction'>,
  candidates: readonly RestHealBody[], heal: CoopDefenseEnemyHopHealConfig, capacity: number,
  sharedIds: ReadonlySet<string>): number {
  const radiusSq = heal.radiusPx ** 2;
  const values: number[] = [];
  for (const target of candidates) {
    if (!isRestHealCandidate(healer, target) || distanceSq(point, target) > radiusSq) continue;
    const value = Math.min(target.maxHp - target.hp, capacity);
    values.push(sharedIds.has(target.id) ? value * REST_HEAL_SHARED_TARGET_WEIGHT : value);
  }
  values.sort((left, right) => right - left);
  let sum = 0;
  for (let i = 0; i < Math.min(heal.maxLinks, values.length); i++) sum += values[i]!;
  return sum;
}

function distanceSq(a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
