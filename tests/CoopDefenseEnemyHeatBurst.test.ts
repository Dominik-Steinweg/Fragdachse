import { describe, expect, it, vi } from 'vitest';
import * as enemyConfig from '../src/config/coopDefenseEnemies';
import { decodeEnemyUpserts, encodeEnemyUpsert } from '../src/network/enemySnapshotCodec';
import { CoopDefenseEnemyHeatBurstSystem, type EnemyViewProximity } from '../src/systems/CoopDefenseEnemyHeatBurstSystem';
import { EMPTY_ENEMY_HEAT_BURST_STATE, enemyHeatAt, enemyHeatBurstPhaseAt, isEnemyHeatBurstState,
  type EnemyHeatBurstState } from '../src/systems/EnemyHeatBurstState';
import { heatFizzleRadius, heatSpeedFactorAt } from '../src/systems/enemyHeatBurstRules';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyDeathInfo } from '../src/entities/EnemyManager';

const demon = enemyConfig.getCoopDefenseEnemyConfig('demon-badger');
const config = demon.heatBurst!;
const FRAME = 16;
/** Least gap between two neighbour bursts on the grid: one step minus both jitters. */
const MIN_NEIGHBOUR_GAP = config.cascade.stepMs - 2 * config.cascade.jitterMs;

interface Point { x: number; y: number }

function fixture(starts: readonly Point[], faction: 'hostile' | 'allied' = 'hostile') {
  const states = new Map<string, EnemyHeatBurstState>();
  const speed = new Map<string, number>();
  const bodies: ReturnType<typeof body>[] = [];
  const view = { gap: 0 };
  const hostileNear = { value: true };
  const route = { point: { x: 4000, y: 0 } as Point | null };
  function body(id: string, start: Point) {
    states.set(id, EMPTY_ENEMY_HEAT_BURST_STATE);
    const self = {
      id, kind: 'demon-badger', faction, sprite: { active: true, x: start.x, y: start.y },
      positionRevision: 0, hp: 20, getHp: () => self.hp, isBurrowed: () => false,
      getHeatBurstState: () => states.get(id)!,
      applyHeatBurstState: (state: EnemyHeatBurstState) => {
        if (isEnemyHeatBurstState(state) && state.revision > states.get(id)!.revision) states.set(id, state);
      },
      setAbilitySpeedFactor: (factor: number) => { speed.set(id, factor); },
      getMoveSpeed: () => demon.moveSpeed * (speed.get(id) ?? 1),
      getDesiredVelocity: () => ({ vx: 1, vy: 0 }),
      getAimAngle: () => 0,
    };
    return self;
  }
  starts.forEach((start, index) => bodies.push(body(`d${index}`, start)));
  const bursts: { id: string; x: number; y: number; at: number }[] = [];
  const fizzles: { id: string; radius: number }[] = [];
  const burst = vi.fn((enemy: EnemyEntity, x: number, y: number, _config: unknown, _cycle: number, now: number) => {
    bursts.push({ id: enemy.id, x, y, at: now });
  });
  const views: EnemyViewProximity = { viewGap: () => view.gap, nearMarginPx: 400, farMarginPx: 600 };
  const system = new CoopDefenseEnemyHeatBurstSystem({
    enemies: { getAllEnemies: () => bodies.filter(b => b.sprite.active) as unknown as EnemyEntity[] },
    steeringPoint: () => route.point,
    moveNormally: (enemy, point, moveSpeed) => {
      const dx = point.x - enemy.sprite.x, dy = point.y - enemy.sprite.y, length = Math.hypot(dx, dy) || 1;
      return { vx: dx / length * moveSpeed, vy: dy / length * moveSpeed, blocked: false };
    },
    hasHostileWithin: () => hostileNear.value,
    burst,
    fizzle: (death, radius) => { fizzles.push({ id: death.id, radius }); },
  });
  const run = (from: number, to: number) => {
    for (let now = from; now <= to; now += FRAME) system.hostUpdate(now, views);
  };
  const add = (start: Point) => { const added = body(`d${bodies.length}`, start); bodies.push(added); return added; };
  return { bodies, system, run, add, bursts, fizzles, burst, view, hostileNear, route, speed,
    state: (id = 'd0') => states.get(id)! };
}

function death(id: string): EnemyDeathInfo {
  return { id, kind: 'demon-badger', x: 0, y: 0, size: demon.size, faction: 'hostile' } as unknown as EnemyDeathInfo;
}

describe('heat burst cycle', () => {
  it('charges with a rising speed, warns at full heat, bursts where the body is and starts over', () => {
    const f = fixture([{ x: 0, y: 0 }]);
    f.run(0, 0);
    const first = f.state();
    expect(first.fullAt - first.chargeStartAt).toBeGreaterThanOrEqual(config.chargeMinMs);
    expect(first.fullAt - first.chargeStartAt).toBeLessThanOrEqual(config.chargeMaxMs);
    expect(first.fullAt).toBeGreaterThanOrEqual(config.initialDelayMs + config.chargeMinMs);
    let previous = 0;
    for (let now = first.chargeStartAt; now < first.fullAt; now += 250) {
      f.run(now, now);
      const factor = f.speed.get('d0')!;
      expect(factor).toBeGreaterThanOrEqual(previous);
      previous = factor;
    }
    f.run(first.fullAt, first.fullAt + 400);
    const booked = f.state();
    expect(booked.telegraphAt).toBeGreaterThanOrEqual(booked.fullAt);
    expect(booked.burstAt - booked.telegraphAt).toBe(config.telegraphMs);
    expect(f.speed.get('d0')).toBeCloseTo(1 + config.speedBoost, 5);
    // The body keeps moving through its warning; the burst happens where it is at the burst moment.
    f.bodies[0].sprite.x = 300;
    f.run(first.fullAt + 400 + FRAME, booked.burstAt + FRAME);
    expect(f.bursts).toEqual([{ id: 'd0', x: 300, y: 0, at: expect.any(Number) }]);
    expect(f.bursts[0].at).toBeGreaterThanOrEqual(booked.burstAt);
    const next = f.state();
    expect(enemyHeatBurstPhaseAt(next, booked.burstAt + FRAME * 2)).toBe('vent');
    expect(f.speed.get('d0')).toBe(1);
    expect(next.chargeStartAt - next.ventFromAt).toBe(config.ventMs);
    expect(next.telegraphAt).toBe(0);
  });

  it('derives heat and speed on clients from the replicated timeline alone', () => {
    const state: EnemyHeatBurstState = { revision: 3, ventFromAt: 1000, chargeStartAt: 1400, fullAt: 6400, telegraphAt: 0, burstAt: 0 };
    expect(enemyHeatAt(state, 1200)).toBe(0);
    expect(enemyHeatAt(state, 3900)).toBeCloseTo(0.5, 5);
    expect(enemyHeatBurstPhaseAt(state, 7000)).toBe('hold');
    expect(heatSpeedFactorAt(state, config, 1200)).toBe(1);
    expect(heatSpeedFactorAt(state, config, 7000)).toBeCloseTo(1 + config.speedBoost, 5);
    const booked = { ...state, revision: 4, telegraphAt: 7100, burstAt: 7100 + config.telegraphMs };
    expect(enemyHeatBurstPhaseAt(booked, 7200)).toBe('telegraph');
    // Past the booked burst the client shows the cool-down before the host's next cycle arrives.
    expect(enemyHeatBurstPhaseAt(booked, booked.burstAt)).toBe('vent');
  });
});

describe('heat burst cascade', () => {
  it('rolls a pack spawned together through its bursts in spawn order, never two neighbours at once', () => {
    const f = fixture(Array.from({ length: 8 }, (_, index) => ({ x: index * 20, y: 0 })));
    f.run(0, 40_000);
    const firstRound = f.bursts.slice(0, 8);
    expect(firstRound.map(entry => entry.id)).toEqual(f.bodies.map(b => b.id));
    const times = [...f.bursts].sort((a, b) => a.at - b.at).map(entry => entry.at);
    for (let index = 1; index < times.length; index++) {
      expect(times[index] - times[index - 1]).toBeGreaterThanOrEqual(MIN_NEIGHBOUR_GAP - FRAME);
    }
    // Every body keeps bursting cycle after cycle.
    for (const b of f.bodies) expect(f.bursts.filter(entry => entry.id === b.id).length).toBeGreaterThanOrEqual(4);
  });

  it('orders a staggered group by arrival as well', () => {
    const f = fixture([{ x: 0, y: 0 }]);
    f.run(0, 0);
    f.add({ x: 30, y: 10 });
    f.run(FRAME, 120);
    f.add({ x: 60, y: -10 });
    f.run(120 + FRAME, 20_000);
    expect(f.bursts.slice(0, 3).map(entry => entry.id)).toEqual(['d0', 'd1', 'd2']);
  });

  it('lets distant bodies share a slot, up to the world cap per slot', () => {
    const far = config.cascade.neighbourRadiusPx * 2;
    const f = fixture(Array.from({ length: config.cascade.maxPerSlot + 2 }, (_, index) => ({ x: index * far, y: 0 })));
    f.run(0, 30_000);
    const perSlot = new Map<number, number>();
    for (const entry of f.bursts) {
      const slot = Math.round(entry.at / config.cascade.stepMs);
      perSlot.set(slot, (perSlot.get(slot) ?? 0) + 1);
    }
    expect(Math.max(...perSlot.values())).toBeLessThanOrEqual(config.cascade.maxPerSlot);
    expect(Math.max(...perSlot.values())).toBeGreaterThan(1);
  });
});

describe('heat burst holds and triggers', () => {
  it('holds full heat while nobody can see the body and books once it comes into view', () => {
    const f = fixture([{ x: 0, y: 0 }]);
    f.view.gap = 5000;
    f.run(0, 0);
    const fullAt = f.state().fullAt;
    f.run(FRAME, fullAt + 3000);
    expect(f.state().telegraphAt).toBe(0);
    expect(enemyHeatBurstPhaseAt(f.state(), fullAt + 3000)).toBe('hold');
    expect(f.burst).not.toHaveBeenCalled();
    f.view.gap = 0;
    f.run(fullAt + 3000 + FRAME, fullAt + 3000 + 400 + config.telegraphMs + config.cascade.stepMs * 2);
    expect(f.burst).toHaveBeenCalledTimes(1);
  });

  it('drops a booking when the body leaves every view before its warning, never during the warning', () => {
    const f = fixture([{ x: 0, y: 0 }]);
    f.run(0, 0);
    const fullAt = f.state().fullAt;
    // Booked shortly before full heat; leaving every view before the warning starts drops the slot.
    f.run(FRAME, fullAt - 200 + FRAME);
    expect(f.state().burstAt).toBeGreaterThan(0);
    f.view.gap = 5000;
    f.run(fullAt - 200 + FRAME * 2, fullAt - 200 + FRAME * 2);
    expect(f.state().burstAt).toBe(0);
    // Back in view it books again; once the warning runs, leaving the view no longer cancels it.
    f.view.gap = 0;
    let now = fullAt - 200 + FRAME * 3;
    while (enemyHeatBurstPhaseAt(f.state(), now) !== 'telegraph') { f.run(now, now); now += FRAME; }
    f.view.gap = 5000;
    f.run(now, f.state().burstAt + FRAME);
    expect(f.burst).toHaveBeenCalledTimes(1);
  });

  it('restarts a warning once after a real teleport, but not for repositioning in place', () => {
    const f = fixture([{ x: 0, y: 0 }]);
    f.run(0, 0);
    const fullAt = f.state().fullAt;
    let now = FRAME;
    while (enemyHeatBurstPhaseAt(f.state(), now) !== 'telegraph') { f.run(now, now); now += FRAME; }
    const planned = f.state().burstAt;
    // Re-placed on the same spot every frame (a pinned body): the warning runs on unchanged.
    for (; now < planned - 200; now += FRAME) { f.bodies[0].positionRevision += 1; f.run(now, now); }
    expect(f.state().burstAt).toBe(planned);
    // A portal jump restarts it in full at the new place, once per cycle.
    f.bodies[0].positionRevision += 1; f.bodies[0].sprite.x += 400;
    f.run(now, now);
    expect(f.state().burstAt).toBe(now + config.telegraphMs);
    f.bodies[0].positionRevision += 1; f.bodies[0].sprite.x += 400;
    f.run(now + FRAME, now + FRAME);
    expect(f.state().burstAt).toBe(now + config.telegraphMs);
    f.run(now + 2 * FRAME, now + config.telegraphMs + FRAME);
    expect(f.bursts.map(entry => entry.x)).toEqual([800]);
    expect(fullAt).toBeLessThan(planned);
  });

  it('lets an allied body burst only into nearby hostiles', () => {
    const f = fixture([{ x: 0, y: 0 }], 'allied');
    f.hostileNear.value = false;
    f.run(0, 0);
    const fullAt = f.state().fullAt;
    f.run(FRAME, fullAt + 3000);
    expect(f.burst).not.toHaveBeenCalled();
    f.hostileNear.value = true;
    f.run(fullAt + 3000 + FRAME, fullAt + 6000);
    expect(f.burst).toHaveBeenCalled();
    // Allies run normally through their warning: no override, no attack block.
    expect(f.system.blocksRegularAttacks('d0')).toBe(false);
  });

  it('keeps a warning body running but turns its heading at most at the authored rate', () => {
    const f = fixture([{ x: 0, y: 0 }]);
    f.run(0, 0);
    const fullAt = f.state().fullAt;
    f.run(FRAME, fullAt + 400);
    const booked = f.state();
    f.run(fullAt + 400 + FRAME, booked.telegraphAt);
    const enemy = f.bodies[0] as unknown as EnemyEntity;
    expect(f.system.blocksRegularAttacks('d0')).toBe(true);
    const start = f.system.getMovementOverride(enemy, booked.telegraphAt)!;
    expect(Math.hypot(start.vx, start.vy)).toBeGreaterThan(demon.moveSpeed);
    // The route swings to the opposite side; the heading follows at the turn rate only.
    f.route.point = { x: -4000, y: 0 };
    const later = f.system.getMovementOverride(enemy, booked.telegraphAt + 100)!;
    const turned = Math.abs(Math.atan2(later.vy, later.vx) - Math.atan2(start.vy, start.vx));
    expect(turned).toBeLessThanOrEqual(config.telegraphTurnRateDegPerSec * Math.PI / 180 * 0.1 + 1e-6);
  });
});

describe('heat burst death', () => {
  it('fizzles a charged body by its heat without any burst damage', () => {
    const f = fixture([{ x: 0, y: 0 }, { x: 1000, y: 0 }]);
    f.run(0, 0);
    const late = f.state('d0');
    const now = late.chargeStartAt + (late.fullAt - late.chargeStartAt) * 0.9;
    f.run(FRAME, now);
    f.system.handleKilled(death('d0'), now);
    expect(f.fizzles).toHaveLength(1);
    const radius = f.fizzles[0].radius;
    expect(radius).toBeGreaterThan(config.fizzle.minRadiusPx);
    expect(radius).toBeLessThanOrEqual(config.fizzle.maxRadiusPx);
    f.system.handleKilled(death('d1'), f.state('d1').chargeStartAt);
    expect(f.fizzles).toHaveLength(1);
    expect(f.burst).not.toHaveBeenCalled();
    expect(heatFizzleRadius(1, config)).toBe(config.fizzle.maxRadiusPx);
    expect(heatFizzleRadius(config.fizzle.minHeat - 0.01, config)).toBeNull();
  });
});

describe('heat burst config and wire', () => {
  it('leaves every authored warning long enough to step out of the zone sideways', () => {
    const { reactionMs, playerSpeedPxPerSec, playerRadiusPx } = enemyConfig.HEAT_BURST_FAIRNESS;
    for (const kind of enemyConfig.COOP_DEFENSE_ENEMY_KINDS) {
      const heat = enemyConfig.getCoopDefenseEnemyConfig(kind).heatBurst;
      if (!heat) continue;
      expect(heat.telegraphMs, kind).toBeGreaterThanOrEqual(reactionMs + (heat.burst.radiusPx + playerRadiusPx) / playerSpeedPxPerSec * 1000);
    }
    expect(() => enemyConfig.normalizeHeatBurstConfig({ ...config, telegraphMs: 300 }, 'test')).toThrow(/too short/);
    expect(() => enemyConfig.normalizeHeatBurstConfig({ ...config, cascade: { ...config.cascade, jitterMs: config.cascade.stepMs } }, 'test'))
      .toThrow(/relation/);
  });

  it('round-trips the heat timeline and stays aligned after an invalid state', () => {
    const state: EnemyHeatBurstState = { revision: 5, ventFromAt: 1000, chargeStartAt: 1400, fullAt: 6400, telegraphAt: 6600, burstAt: 7500 };
    const invalid = { revision: 6, ventFromAt: 0, chargeStartAt: 9000, fullAt: 1000, telegraphAt: 0, burstAt: 0 };
    const out: (number | string)[] = [];
    encodeEnemyUpsert(out, { id: 'e1', heatBurst: invalid as EnemyHeatBurstState });
    encodeEnemyUpsert(out, { id: 'e2', heatBurst: state, hp: 12, maxHp: 20 });
    const [first, second] = decodeEnemyUpserts(out);
    expect(first.heatBurst).toBeUndefined();
    expect(second).toMatchObject({ id: 'e2', heatBurst: state, hp: 12, maxHp: 20 });
  });
});
