import { describe, expect, it, vi } from 'vitest';
import { COOP_DEFENSE_TURRET_RULES, validateCoopDefenseTurretRules } from '../src/config/coopDefenseTurrets';

describe('authored automatic turret base damage factor', () => {
  it('defaults to neutral damage and accepts finite nonnegative factors', () => {
    expect(COOP_DEFENSE_TURRET_RULES.baseDamageMultiplier).toBe(1);
    for (const baseDamageMultiplier of [0, 0.25, 1, 2]) {
      expect(() => validateCoopDefenseTurretRules({ baseDamageMultiplier })).not.toThrow();
    }
    for (const baseDamageMultiplier of [-1, NaN, Infinity, -Infinity]) {
      expect(() => validateCoopDefenseTurretRules({ baseDamageMultiplier })).toThrow('baseDamageMultiplier');
    }
  });
});
import type { ProjectileWeaponFireConfig, WeaponConfig } from '../src/loadout/LoadoutConfig';
import { canWeaponDamageBases, computeExposedBaseFaces, ExposedBaseFaceCache, rankBaseAimPoints,
  type BaseCell, type ExposedBaseFace } from '../src/systems/TurretBaseTargeting';

const projectileFire: ProjectileWeaponFireConfig = { type: 'projectile', projectileSpeed: 100, projectileSize: 2, projectileMaxBounces: 0 };
const projectile: WeaponConfig = {
  id: 'synthetic', cooldown: 100, damage: 0, range: 100,
  fire: projectileFire,
  allowedSlots: [], adrenalinCost: 0, adrenalinGain: 0, spreadStanding: 0, spreadMoving: 0,
  spreadPerShot: 0, maxDynamicSpread: 0, spreadRecoveryDelay: 0, spreadRecoveryRate: 0, spreadRecoverySpeed: 100,
};
const explosion = { radius: 10, maxDamage: 5, knockback: 0, selfDamageMult: 0 };
const cloud = { radius: 10, duration: 1000, damagePerTick: 2, tickInterval: 100 };
const withPayload = (payload: Partial<ProjectileWeaponFireConfig>): WeaponConfig => ({ ...projectile, fire: { ...projectileFire, ...payload } });

describe('automated base damage capability', () => {
  it('uses direct overrides and the base multiplier, independently of rock damage', () => {
    expect(canWeaponDamageBases({ ...projectile, damage: 5, rockDamageMult: 0 })).toBe(true);
    expect(canWeaponDamageBases({ ...projectile, damage: 5, baseDamageMult: 0 })).toBe(false);
    expect(canWeaponDamageBases({ ...projectile, damage: 5, directDamageOverride: 0 })).toBe(false);
    expect(canWeaponDamageBases({ ...projectile, directDamageOverride: 2 })).toBe(true);
  });

  it('checks independent explosion and cloud payloads, including zero direct damage', () => {
    expect(canWeaponDamageBases({ ...withPayload({ impactExplosion: explosion }), baseDamageMult: 0 })).toBe(true);
    expect(canWeaponDamageBases(withPayload({ impactExplosion: { ...explosion, baseDamageMult: 0 } }))).toBe(false);
    expect(canWeaponDamageBases(withPayload({ impactCloud: cloud }))).toBe(true);
    expect(canWeaponDamageBases(withPayload({ impactCloud: { ...cloud, baseDamageMult: 0 } }))).toBe(false);
    expect(canWeaponDamageBases(withPayload({ impactCloud: { ...cloud, duration: cloud.tickInterval } }))).toBe(false);
  });

  it('does not count suppressed direct hits, character-only burn or enemy-hit explosions', () => {
    expect(canWeaponDamageBases({ ...withPayload({ impactExplosion: { ...explosion, maxDamage: 0 } }), damage: 5 })).toBe(false);
    expect(canWeaponDamageBases({ ...withPayload({ impactCloud: { ...cloud, damagePerTick: 0 } }), damage: 5 })).toBe(true);
    expect(canWeaponDamageBases(withPayload({ enemyHitExplosion: explosion }))).toBe(false);
    expect(canWeaponDamageBases({ ...projectile, burnOnHit: { durationMs: 1000, damagePerTick: 10 } })).toBe(false);
  });

  it('counts ground-fire damage but not burn stacks alone', () => {
    const groundFire = { type: 'fire' as const, radius: 10, lingerDuration: 1000, damagePerTick: 2 };
    expect(canWeaponDamageBases(withPayload({ impactExplosion: { ...explosion, maxDamage: 0, groundFire } }))).toBe(true);
    expect(canWeaponDamageBases(withPayload({ impactExplosion: { ...explosion, maxDamage: 0,
      groundFire: { ...groundFire, damagePerTick: 0, burnDurationMs: 1000, burnDamagePerTick: 5 } } }))).toBe(false);
  });

  it('keeps control fields and Tesla out of the automatic shot path', () => {
    expect(canWeaponDamageBases(projectile)).toBe(false);
    expect(canWeaponDamageBases(withPayload({ impactExplosion: { ...explosion, maxDamage: 0,
      blackHoleDurationMs: 1000, blackHolePullStrength: 100 } }))).toBe(false);
    expect(canWeaponDamageBases(withPayload({ impactExplosion: { ...explosion,
      timeBubble: { type: 'time_bubble', radius: 10, duration: 1000,
        projectileSlowFactor: .5, playerSlowFactor: .5, trainSlowFactor: .5 } } }))).toBe(false);
    expect(canWeaponDamageBases({ ...projectile, fire: { type: 'tesla_dome', radius: 10,
      damagePerTick: 10, tickInterval: 100, adrenalineDrainPerSecond: 0, movementSlowFactor: 1,
      requireLineOfSight: true, targetTypes: ['bases'], visualIndicatorAlpha: 0, visualFieldAlpha: 0,
      visualIdleArcCount: 0, visualBoltThicknessMin: 1, visualBoltThicknessMax: 1, visualJitter: 0,
      visualBranchChance: 0, visualImpactBurstScale: 1, visualWhiteness: 0, visualPulseSpeed: 0 } })).toBe(false);
  });

  it('matches flame hitboxes, whose current adapter omits baseDamageMult and does not burn bases', () => {
    const flame: WeaponConfig = { ...projectile, baseDamageMult: 0, fire: { type: 'flamethrower',
      projectileSpeed: 100, hitboxStartSize: 2, hitboxEndSize: 10, hitboxGrowRate: 10,
      velocityDecay: 1, burnDurationMs: 1000, burnDamagePerTick: 5 } };
    expect(canWeaponDamageBases(flame)).toBe(false);
    expect(canWeaponDamageBases({ ...flame, damage: 2 })).toBe(true);
  });
});

const facesFor = (cells: readonly BaseCell[], isCoveredCell = (_x: number, _y: number) => false) =>
  computeExposedBaseFaces({ cells, cellSize: 10, offsetX: 0, offsetY: 0, isCoveredCell });

describe('exposed base geometry and aim ranking', () => {
  it.each([0, 1])('returns the trimmed face segment containing its aim point (offset %s)', offset => {
    const faces = facesFor([{ gridX: 0, gridY: 0 }]);
    const points = rankBaseAimPoints(faces, -5, -5, 100, 4, offset, 2);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ hitSegment: { x1: 0 - offset, y1: 2, x2: 0 - offset, y2: 8 } });
    expect(points[1]).toMatchObject({ hitSegment: { x1: 2, y1: 0 - offset, x2: 8, y2: 0 - offset } });
    for (const point of points) {
      const s = point.hitSegment;
      expect(point.x).toBeGreaterThanOrEqual(Math.min(s.x1, s.x2));
      expect(point.x).toBeLessThanOrEqual(Math.max(s.x1, s.x2));
      expect(point.y).toBeGreaterThanOrEqual(Math.min(s.y1, s.y2));
      expect(point.y).toBeLessThanOrEqual(Math.max(s.y1, s.y2));
    }
    expect(rankBaseAimPoints(faces, -5, -5, 100, 1, offset, 50)[0]).toMatchObject({
      hitSegment: { x1: 0 - offset, y1: 5, x2: 0 - offset, y2: 5 } });
  });

  it('preserves a U-shaped opening with inward courtyard faces pointing into empty space', () => {
    const cells = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0]]
      .map(([gridX, gridY]) => ({ gridX, gridY }));
    const faces = facesFor(cells);
    const inner = faces.filter(f => f.x1 === 10 && f.x2 === 10 && f.y1 < 20
      || f.x1 === 20 && f.x2 === 20 && f.y1 < 20 || f.y1 === 20 && f.y2 === 20 && f.x1 === 10);
    expect(inner).toHaveLength(5);
    for (const f of inner) {
      const intoOpening = { x: (f.x1 + f.x2) / 2 + f.normalX, y: (f.y1 + f.y2) / 2 + f.normalY };
      expect(intoOpening.x).toBeGreaterThan(10);
      expect(intoOpening.x).toBeLessThan(20);
      expect(intoOpening.y).toBeLessThan(20);
    }
    expect(rankBaseAimPoints(inner, 15, -5, 100, 10)).toHaveLength(5);
    expect(rankBaseAimPoints(inner.filter(f => f.normalY === -1), 15, 35, 100, 10)).toEqual([]);
  });

  it('excludes shared and covered edges and applies world offsets', () => {
    const faces = computeExposedBaseFaces({ cells: [{ gridX: 0, gridY: 0 }, { gridX: 1, gridY: 0 }],
      cellSize: 10, offsetX: -40, offsetY: 100, isCoveredCell: (x, y) => x === -1 && y === 0 });
    expect(faces).toHaveLength(5);
    expect(faces.some(f => f.normalX === -1)).toBe(false);
    expect(faces.some(f => f.x1 === -30 && f.x2 === -30)).toBe(false);
    expect(faces).toContainEqual({ x1: -20, y1: 100, x2: -20, y2: 110, normalX: 1, normalY: 0 });
  });

  it('reaches a nearby outer wall even when the base center is out of range', () => {
    const faces = facesFor(Array.from({ length: 30 }, (_, gridX) => ({ gridX, gridY: 0 })));
    expect(Math.hypot(150 - (-5), 5 - 5)).toBeGreaterThan(5);
    expect(rankBaseAimPoints(faces, -5, 5, 5, 2)).toMatchObject([{ x: -1, y: 5, distance: 5 }]);
    expect(rankBaseAimPoints(faces, -5, 5, 4.99, 2)).toEqual([]);
  });

  it('rejects back and tangent faces, clamps to endpoints and stably limits equal distances', () => {
    const faces = facesFor([{ gridX: 0, gridY: 0 }]);
    expect(rankBaseAimPoints(faces, -5, 5, 100, 10)).toMatchObject([{ x: -1, y: 5, distance: 5 }]);
    const tied = rankBaseAimPoints(faces, -5, -5, 100, 2, 2);
    expect(tied).toMatchObject([{ x: -2, y: 0, distance: Math.sqrt(50) }, { x: 0, y: -2, distance: Math.sqrt(50) }]);
    expect(rankBaseAimPoints(faces, -5, -5, 100, 1, 2)).toEqual(tied.slice(0, 1));
    expect(rankBaseAimPoints(faces, -5, -5, 100, 0)).toEqual([]);
    expect(rankBaseAimPoints([], 0, 0, 100, 3)).toEqual([]);
  });

  it('keeps aim points away from convex corners, at most at the face midpoint', () => {
    const faces = facesFor([{ gridX: 0, gridY: 0 }]);
    const [corner] = rankBaseAimPoints(faces, -5, -5, 100, 1, 1, 2);
    expect(corner).toMatchObject({ x: -1, y: 2, distance: Math.hypot(5, 7) });
    // Ein Inset über die halbe Kantenlänge hinaus zielt auf die Kantenmitte.
    expect(rankBaseAimPoints(faces, -5, -5, 100, 1, 1, 50)[0]).toMatchObject({ x: -1, y: 5 });
    // Frontal bleibt der nächste Punkt unverändert.
    expect(rankBaseAimPoints(faces, -5, 5, 100, 1, 1, 2)[0]).toMatchObject({ x: -1, y: 5, distance: 5 });
  });

  it('keeps the nearest limited set when closer faces arrive late, with stable ties', () => {
    const faces = [90, 50, 70, 30, 10, 30, 20].map((x, i) => ({
      x1: x, x2: x, y1: -10 - i, y2: 10 + i, normalX: -1, normalY: 0,
    }));
    const points = rankBaseAimPoints(faces, 0, 0, 100, 4);
    expect(points.map(p => p.distance)).toEqual([10, 20, 30, 30]);
    expect(points.slice(2).map(p => p.hitSegment.y1)).toEqual([-13, -15]);
    expect(rankBaseAimPoints(faces, 0, 0, 20, 4).map(p => p.distance)).toEqual([10, 20]);
  });
});

it('caches even empty geometry and invalidates every base on generation changes and clear', () => {
  const cache = new ExposedBaseFaceCache();
  const compute = vi.fn((): readonly ExposedBaseFace[] => []);
  const a = cache.get('a', 1, compute), b = cache.get('b', 1, compute);
  expect(cache.get('a', 1, compute)).toBe(a);
  expect(cache.get('b', 1, compute)).toBe(b);
  expect(compute).toHaveBeenCalledTimes(2);
  expect(cache.get('a', 2, compute)).not.toBe(a);
  expect(cache.get('b', 2, compute)).not.toBe(b);
  expect(compute).toHaveBeenCalledTimes(4);
  cache.clear();
  cache.get('a', 2, compute);
  expect(compute).toHaveBeenCalledTimes(5);
});
