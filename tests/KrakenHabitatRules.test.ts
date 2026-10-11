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
  it('reserves independent dry lanes, rechecks blockers and frees them explicitly', () => {
    const f = setup(), c = KRAKEN_BOSS_DEFAULTS;
    const lanes = f.rules.reserveLanes(f.boss, 'pond', [{ x: 1000, y: 600 }], c.tentacles.maxConcurrent);
    expect(lanes.length).toBeGreaterThan(1);
    expect(new Set(lanes.map(l => l.shoreId)).size).toBe(lanes.length);
    expect(f.rules.reserveLanes(f.boss, 'pond', [], c.tentacles.maxConcurrent)).toEqual([]);
    expect(lanes.every(l => f.rules.revalidateLane(l))).toBe(true);
    f.queries.circleFree = () => false; expect(f.rules.revalidateLane(lanes[0])).toBe(false);
    f.queries.circleFree = () => true; f.rules.release(lanes[0].reservationId);
    expect(f.rules.reserveLanes(f.boss, 'pond', [], 1)).toHaveLength(1);
    f.activity(); expect(f.rules.revalidateLane(lanes[1])).toBe(false);
  });
  it('keeps radial egg landings clearly inland and leaves invalid sectors empty', () => {
    const f = setup(), origin = worldCellCenter(f.metrics, 15, 18), clearance = 100;
    const points = f.rules.eggLandings(origin, 0, KRAKEN_BOSS_DEFAULTS.eggs.volleyCount, clearance);
    expect(points.filter(Boolean).length).toBeGreaterThan(0);
    for (const p of points) if (p) expect(f.water.isCircleBlocked(p.x, p.y, clearance + KRAKEN_BOSS_DEFAULTS.eggs.radiusPx)).toBe(false);
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
