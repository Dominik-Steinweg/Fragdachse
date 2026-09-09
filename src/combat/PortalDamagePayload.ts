/**
 * Damage leaves of resolved attack payloads. Multipliers, rewards, support values and
 * geometry deliberately are not members. The payload is copied so a child never mutates
 * the frozen parent/configuration from which it was created.
 */
const damageLeaves = new Set([
  'damage', 'maxDamage', 'minDamage', 'damagePerTick', 'burnDamagePerTick',
  'dotDamagePerTick', 'aoeDamage', 'trailDamagePerTick', 'plasmaSwarmExplosionDamage',
  'awpCorridorDamage', 'explosionDamage',
]);

export function scalePortalDamagePayload<T>(payload: T, ratio: number): T {
  if (ratio === 1 || payload === null || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map(value => scalePortalDamagePayload(value, ratio)) as T;
  // Runtime sets (contact memory, exclusions) are identities, never authored payloads.
  if (Object.getPrototypeOf(payload) !== Object.prototype) return payload;
  // Every smoke sub-attack (including its storm) resolves this captured multiplier
  // when it materializes. Scaling the authored leaves too would apply the bonus twice.
  if ('type' in payload && payload.type === 'smoke') {
    const smoke = payload as T & { sourceDamageMultiplier?: number };
    return { ...smoke, sourceDamageMultiplier: (smoke.sourceDamageMultiplier ?? 1) * ratio };
  }
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    copy[key] = damageLeaves.has(key) && typeof value === 'number'
      ? value * ratio : scalePortalDamagePayload(value, ratio);
  }
  return copy as T;
}
