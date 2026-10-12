import { describe, expect, it } from 'vitest';
import { KrakenHabitatRules, type KrakenHabitatQueries } from '../src/systems/KrakenHabitatRules';
import { WaterGeometry } from '../src/arena/WaterGeometry';
import { KRAKEN_BOSS_DEFAULTS } from '../src/config/krakenBoss';
import { resolveCoopDefenseWorldMetrics, worldCellCenter } from '../src/world/WorldMetrics';
import type { KrakenHabitatConfig } from '../src/config/krakenHabitat';
import type { BossTargetRef } from '../src/combat/CombatPartContact';

function setup() {
  const metrics = { ...resolveCoopDefenseWorldMetrics(60, 40), offsetX: 0, offsetY: 0, maxX: 1920, maxY: 1280 };
  const water = new WaterGeometry(Array.from({ length: 20 * 24 }, (_, i) => ({ gridX: 5 + i % 20, gridY: 6 + Math.floor(i / 20) })), metrics);
  const habitat: KrakenHabitatConfig = { id: 'pond', kind: 'water', initialAnchorId: 'center',
    waterAnchors: [{ id: 'center', cell: { gridX: 15, gridY: 18 } }],
    shores: [12, 18, 24].map(y => ({ id: `east-${y}`, waterCell: { gridX: 24, gridY: y }, landCell: { gridX: 25, gridY: y } })),
    exits: [{ id: 'east', fromAnchorId: 'center', shoreId: 'east-18', widthCells: 6,
      path: [{ gridX: 15, gridY: 18 }, { gridX: 25, gridY: 18 }, { gridX: 30, gridY: 18 }] }] };
  let topology = 1, activity = 1;
  const queries: KrakenHabitatQueries = { revisions: () => ({ worldRevision: 1, activityRevision: activity, topologyRevision: topology }),
    circleFree: () => true, segmentFree: () => true, landConnection: () => 'ready' };
  const boss: BossTargetRef = { kind: 'enemy', id: 'boss', scope: { worldRevision: 1, runtimeGeneration: 1 }, instance: { entityGeneration: 1, activityRevision: 1 } };
  const rules = new KrakenHabitatRules(habitat, water, metrics, KRAKEN_BOSS_DEFAULTS, queries);
  return { rules, queries, boss, habitat, water, metrics, topology: () => { topology++; }, activity: () => { activity++; } };
}
describe('Kraken habitat reservations', () => {
  it('selects interior swim legs with full shore clearance and an interior dive destination', () => {
    const f = setup(), from = worldCellCenter(f.metrics, 15, 18), c = KRAKEN_BOSS_DEFAULTS;
    for (let seed = 0; seed < 20; seed++) {
      const to = f.rules.wanderPoint(from, seed / 20)!;
      expect(to).not.toBeNull(); expect(f.rules.canWander(from, to)).toBe(true);
      const d = Math.hypot(to.x - from.x, to.y - from.y);
      expect(d).toBeGreaterThanOrEqual(c.waterWander.minLegPx); expect(d).toBeLessThanOrEqual(c.waterWander.maxLegPx);
      for (let t = 0; t <= 1; t += .1) {
        const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
        const r = c.bodyRadiusPx + c.waterWander.shoreClearancePx;
        expect(p.x - r).toBeGreaterThanOrEqual(5 * 32); expect(p.x + r).toBeLessThanOrEqual(25 * 32);
        expect(p.y - r).toBeGreaterThanOrEqual(6 * 32); expect(p.y + r).toBeLessThanOrEqual(30 * 32);
      }
    }
    const shore = f.rules.waterApproach(from, { x: 1400, y: from.y })!;
    expect(f.rules.isDiveInterior(shore)).toBe(false);
    const dive = f.rules.divePoint(shore)!; expect(f.rules.isDiveInterior(dive)).toBe(true);
    expect(f.rules.canMove(shore, dive, 'water-approach')).toBe(true);
  });
  it('reaches arms out of the pond from the kraken and strikes only inside their arc', () => {
    const f = setup(), c = KRAKEN_BOSS_DEFAULTS.tentacles, kraken = worldCellCenter(f.metrics, 15, 18);
    const arms = f.rules.reserveTentacles(f.boss, 'pond', [{ x: 860, y: 560 }], 2, [], kraken);
    expect(arms.length).toBeGreaterThan(0);
    for (const arm of arms) {
      const radial = Math.atan2(arm.waterEntry.y - kraken.y, arm.waterEntry.x - kraken.x);
      expect(arm.radialAngle).toBeCloseTo(radial);
      // Base in open water, submerged root back towards the kraken in water as well.
      expect(f.water.isCircleBlocked(arm.waterEntry.x, arm.waterEntry.y, 0)).toBe(true);
      const root = { x: arm.waterEntry.x - Math.cos(radial) * c.rootLengthPx, y: arm.waterEntry.y - Math.sin(radial) * c.rootLengthPx };
      expect(f.water.isCircleBlocked(root.x, root.y, 0)).toBe(true);
      // A target behind the arm (towards the kraken) is never struck; one ahead within reach is.
      expect(f.rules.tentacleAim(arm, { x: arm.waterEntry.x - Math.cos(radial) * 150, y: arm.waterEntry.y - Math.sin(radial) * 150 })).toBeNull();
      expect(f.rules.tentacleAim(arm, { x: arm.waterEntry.x + Math.cos(radial) * 150, y: arm.waterEntry.y + Math.sin(radial) * 150 })).toBeCloseTo(radial);
    }
  });
  it('spawns spaced water-band arms and permits oblique strikes only within range and free of solids', () => {
    const f = setup(), c = KRAKEN_BOSS_DEFAULTS;
    const arms = f.rules.reserveTentacles(f.boss, 'pond', [{ x: 820, y: 600 }], c.tentacles.maxConcurrent);
    for (const [i, arm] of arms.entries()) {
      expect(f.water.isCircleBlocked(arm.waterEntry.x, arm.waterEntry.y, 0)).toBe(true);
      const shoreDistance = Math.min(arm.waterEntry.x - 160, 800 - arm.waterEntry.x, arm.waterEntry.y - 192, 960 - arm.waterEntry.y);
      expect(shoreDistance).toBeLessThanOrEqual(c.tentacles.emergeShoreBandPx);
      for (const other of arms.slice(i + 1)) expect(Math.hypot(arm.waterEntry.x - other.waterEntry.x, arm.waterEntry.y - other.waterEntry.y)).toBeGreaterThanOrEqual(c.tentacles.spawnSpacingPx);
    }
    const removed = arms.at(-1)!; f.rules.release(removed.reservationId);
    const replacement = f.rules.reserveTentacles(f.boss, 'pond', [], 1, [removed.waterEntry])[0];
    expect(replacement).toBeDefined();
    expect(Math.hypot(replacement.waterEntry.x - removed.waterEntry.x, replacement.waterEntry.y - removed.waterEntry.y)).toBeGreaterThanOrEqual(c.tentacles.spawnSpacingPx);
    const arm = arms[0], target = { x: arm.waterEntry.x + 100, y: arm.waterEntry.y + 100 };
    const pose = f.rules.aimTentacle(arm, target)!;
    expect(pose.angle).toBeCloseTo(Math.PI / 4); expect(pose.originX).toBe(arm.waterEntry.x);
    expect(f.rules.aimTentacle(arm, { x: target.x + c.tentacles.length, y: target.y })).toBeNull();
    f.queries.circleFree = () => false;
    expect(f.rules.aimTentacle(arm, target)).toBeNull(); expect(f.rules.revalidateLane(arm)).toBe(false);
  });
  it('rejects land segments through water and finds a solid-free recovery route around a blocker', () => {
    const f = setup(), from = { x: 480, y: 576 }, c = KRAKEN_BOSS_DEFAULTS;
    expect(f.rules.canMove({ x: 100, y: 576 }, { x: 900, y: 576 }, 'land')).toBe(false);
    // Block the nearest east/west exits. Recovery must go around, never through the wall.
    f.queries.segmentFree = (a, b) => !(Math.min(a.x, b.x) <= 600 && Math.max(a.x, b.x) >= 600 && Math.min(a.y, b.y) < 800);
    let p = from;
    for (let i = 0; i < 150 && !f.rules.isDryBodyFree(p, c.bodyRadiusPx); i++) {
      const next = f.rules.recoverLand(p, 12)!;
      expect(next).not.toBeNull(); expect(f.queries.segmentFree(p, next, c.bodyRadiusPx)).toBe(true);
      expect(Math.hypot(next.x - p.x, next.y - p.y)).toBeLessThanOrEqual(12 + 1e-9); p = next;
    }
    expect(f.rules.isDryBodyFree(p, c.bodyRadiusPx)).toBe(true);
  });
  it('ranks free land endpoints by target proximity with authored order breaking ties', () => {
    const f = setup(), first = f.habitat.exits[0];
    const near = { ...structuredClone(first), id: 'near', path: [...first.path.slice(0, -1), { gridX: 35, gridY: 22 }] };
    f.habitat.exits.push(near, { ...structuredClone(near), id: 'tied' });
    const target = worldCellCenter(f.metrics, 35, 22);
    const chosen = f.rules.reserveExit(f.boss, 'pond', target);
    expect(chosen.status === 'valid' && chosen.value.corridorId).toBe('near');
    f.queries.circleFree = (x, y) => x !== target.x || y !== target.y;
    const fallback = f.rules.reserveExit(f.boss, 'pond', target);
    expect(fallback.status === 'valid' && fallback.value.corridorId).toBe(first.id);
  });
  it('requires a full wet body and current land navigation, preserving pending', () => {
    const f = setup(); f.queries.landConnection = () => 'pending';
    expect(f.rules.reserveWaterSpawn('pond', KRAKEN_BOSS_DEFAULTS.bodyRadiusPx).status).toBe('pending');
    f.queries.landConnection = () => 'ready';
    const r = f.rules.reserveWaterSpawn('pond', KRAKEN_BOSS_DEFAULTS.bodyRadiusPx);
    expect(r.status).toBe('valid'); if (r.status !== 'valid') throw Error();
    expect(f.rules.revalidate(r.value)).toBe(true);
    expect(f.rules.revalidate({ ...r.value })).toBe(false);
    f.topology(); expect(f.rules.revalidate(r.value)).toBe(false);
    f.habitat.waterAnchors[0].cell.gridX = 24;
    expect(f.rules.reserveWaterSpawn('pond', KRAKEN_BOSS_DEFAULTS.bodyRadiusPx).status).toBe('blocked');
  });
  it('reserves independent water emergence points, rechecks blockers and frees them explicitly', () => {
    const f = setup(), c = KRAKEN_BOSS_DEFAULTS;
    const lanes = f.rules.reserveTentacles(f.boss, 'pond', [{ x: 1000, y: 600 }], c.tentacles.maxConcurrent);
    expect(lanes.length).toBeGreaterThan(1);
    expect(new Set(lanes.map(l => l.shoreId)).size).toBe(lanes.length);
    expect(f.rules.reserveTentacles(f.boss, 'pond', [], c.tentacles.maxConcurrent)).toEqual([]);
    expect(lanes.every(l => f.rules.revalidateLane(l))).toBe(true);
    f.queries.circleFree = () => false; expect(f.rules.revalidateLane(lanes[0])).toBe(false);
    f.queries.circleFree = () => true; f.rules.release(lanes[0].reservationId);
    expect(f.rules.reserveTentacles(f.boss, 'pond', [], 1)).toHaveLength(1);
    f.activity(); expect(f.rules.revalidateLane(lanes[1])).toBe(false);
  });
  it('keeps directed egg landings clearly inland and leaves invalid sectors empty', () => {
    const f = setup(), origin = worldCellCenter(f.metrics, 15, 18), clearance = 100;
    const points = f.rules.eggLandings(origin, 0, KRAKEN_BOSS_DEFAULTS.eggs.volleyCount, clearance);
    expect(points.filter(Boolean).length).toBeGreaterThan(0);
    for (const p of points) if (p) {
      expect(f.water.isCircleBlocked(p.x, p.y, clearance + KRAKEN_BOSS_DEFAULTS.eggs.radiusPx)).toBe(false);
      expect(Math.abs(Math.atan2(p.y - origin.y, p.x - origin.x))).toBeLessThanOrEqual(KRAKEN_BOSS_DEFAULTS.eggs.throwConeDegrees * Math.PI / 360 + 1e-9);
    }
    f.queries.segmentFree = () => false;
    expect(f.rules.eggLandings(origin, 0, points.length, clearance).every(p => p === null)).toBe(true);
  });
  it('stops the approach with the full body in water and never crosses obstacles', () => {
    const f = setup(), from = worldCellCenter(f.metrics, 15, 18);
    const approach = f.rules.waterApproach(from, { x: 1400, y: from.y });
    expect(approach).not.toBeNull(); expect(approach!.x).toBeGreaterThan(from.x);
    expect(approach!.x + KRAKEN_BOSS_DEFAULTS.bodyRadiusPx).toBeLessThanOrEqual(25 * 32);
    f.queries.segmentFree = () => false; expect(f.rules.waterApproach(from, { x: 1400, y: from.y })).toBeNull();
  });
});
