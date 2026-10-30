import { describe, expect, it, vi } from 'vitest';
import rawEnemies from '../src/config/coopDefenseEnemies.json';
import * as enemyConfig from '../src/config/coopDefenseEnemies';
import { decodeEnemyUpserts, encodeEnemyUpsert } from '../src/network/enemySnapshotCodec';
import { CoopDefenseEnemyHeatBurstSystem } from '../src/systems/CoopDefenseEnemyHeatBurstSystem';
import { EMPTY_ENEMY_HEAT_BURST_STATE, enemyHeatAt, enemyHeatBurstPhaseAt, isEnemyHeatBurstState,
  type EnemyHeatBurstState } from '../src/systems/EnemyHeatBurstState';
import { heatFizzleRadius, heatSalvoPauseMs, heatSalvoPauseSpread, heatSpeedFactorOf } from '../src/systems/enemyHeatBurstRules';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyDeathInfo } from '../src/entities/EnemyManager';

const demon = enemyConfig.getCoopDefenseEnemyConfig('demon-badger');
const config = demon.heatBurst!;
const FRAME = 16;

interface Point { x: number; y: number }

function fixture(starts: readonly Point[], faction: 'hostile' | 'allied' = 'hostile') {
  const states = new Map<string, EnemyHeatBurstState>();
  const speed = new Map<string, number>();
  const bodies: ReturnType<typeof body>[] = [];
  const aim = { angle: 0 };
  const train = { evading: false };
  function body(id: string, start: Point) {
    states.set(id, EMPTY_ENEMY_HEAT_BURST_STATE);
    const self = {
      id, kind: 'demon-badger', faction, sprite: { active: true, x: start.x, y: start.y },
      positionRevision: 0, hp: 20, getHp: () => self.hp,
      getHeatBurstState: () => states.get(id)!,
      applyHeatBurstState: (state: EnemyHeatBurstState) => {
        if (isEnemyHeatBurstState(state) && state.revision > states.get(id)!.revision) states.set(id, state);
      },
      setAbilitySpeedFactor: (factor: number) => { speed.set(id, factor); },
      getAimAngle: () => aim.angle,
    };
    return self;
  }
  starts.forEach((start, index) => bodies.push(body(`d${index}`, start)));
  const bursts: { id: string; faction: string; x: number; y: number; at: number }[] = [];
  const removed: string[] = [];
  const fizzles: { id: string; radius: number }[] = [];
  const burst = vi.fn((enemy: EnemyEntity, x: number, y: number, _config: unknown, now: number) => {
    bursts.push({ id: enemy.id, faction: enemy.faction, x, y, at: now });
  });
  const system = new CoopDefenseEnemyHeatBurstSystem({
    enemies: { getAllEnemies: () => bodies.filter(b => b.sprite.active) as unknown as EnemyEntity[] },
    isEvadingTrain: () => train.evading,
    burst,
    removeWithoutKill: enemy => {
      removed.push(enemy.id);
      // The manager destroys the body; the burst port saw it still registered.
      (enemy as unknown as { sprite: { active: boolean } }).sprite.active = false;
    },
    fizzle: (death, radius) => { fizzles.push({ id: death.id, radius }); },
  });
  const run = (from: number, to: number) => {
    for (let now = from; now <= to; now += FRAME) system.hostUpdate(now);
  };
  const entity = (id = 'd0') => bodies.find(b => b.id === id) as unknown as EnemyEntity;
  /** Spits `count` salvos, each when the previous pause has passed; returns the time after the last. */
  const spit = (count: number, from = 0, id = 'd0') => {
    let now = from;
    for (let index = 0; index < count; index++) {
      run(now, now);
      const pause = system.salvoSpent(entity(id), 4, now);
      if (pause === null) return now;
      now += pause;
    }
    return now;
  };
  return { bodies, system, run, spit, entity, bursts, removed, fizzles, burst, speed, aim, train,
    state: (id = 'd0') => states.get(id)! };
}

function death(id: string): EnemyDeathInfo {
  return { id, kind: 'demon-badger', x: 0, y: 0, size: demon.size, faction: 'hostile' } as unknown as EnemyDeathInfo;
}

describe('heat stages', () => {
  it('heats one stage per spent salvo, runs faster and spits sooner, and keeps the heat', () => {
    const f = fixture([{ x: 0, y: 0 }]);
    f.run(0, 0);
    expect(f.state().stage).toBe(0);
    // A salvo that fired nothing (an aborted gather) does not heat the body.
    expect(f.system.salvoSpent(f.entity(), 0, 10)).toBeNull();
    expect(f.state().stage).toBe(0);
    const pauses: number[] = [], speeds: number[] = [];
    let now = 100;
    for (let stage = 1; stage < config.stages; stage++) {
      const pause = f.system.salvoSpent(f.entity(), 4, now)!;
      pauses.push(pause);
      expect(f.state()).toMatchObject({ stage, stageAt: now, telegraphAt: 0, burstAt: 0 });
      f.run(now, now + pause);
      speeds.push(f.speed.get('d0')!);
      now += pause + FRAME;
    }
    const spread = heatSalvoPauseSpread('d0', config);
    expect(pauses).toEqual(config.salvoPauseMsByStage.slice(0, config.stages - 1).map(ms => Math.round(ms * spread)));
    for (let index = 1; index < pauses.length; index++) {
      expect(pauses[index]).toBeLessThan(pauses[index - 1]);
      expect(speeds[index]).toBeGreaterThan(speeds[index - 1]);
    }
    expect(speeds[0]).toBeGreaterThan(1);
    // Without further salvos the heat and its speed stay.
    f.run(now, now + 20_000);
    expect(f.state().stage).toBe(config.stages - 1);
    expect(f.speed.get('d0')).toBe(speeds.at(-1));
  });

  it('spreads the pause per body within the authored jitter, fixed for each body', () => {
    const spreads = Array.from({ length: 40 }, (_, index) => heatSalvoPauseSpread(`enemy-${index}`, config));
    for (const spread of spreads) {
      expect(spread).toBeGreaterThanOrEqual(1 - config.salvoPauseJitter);
      expect(spread).toBeLessThanOrEqual(1 + config.salvoPauseJitter);
    }
    expect(heatSalvoPauseSpread('enemy-3', config)).toBe(spreads[3]);
    expect(new Set(spreads.map(spread => spread.toFixed(3))).size).toBeGreaterThan(30);
    expect(heatSalvoPauseMs(0, 'enemy-3', config)).toBe(Math.round(config.salvoPauseMsByStage[0] * spreads[3]));
  });

  it('lets a pack that starts spitting together melt down spread out, not at once', () => {
    const f = fixture(Array.from({ length: 8 }, (_, index) => ({ x: index * 30, y: 0 })));
    for (const b of f.bodies) f.spit(config.stages, 0, b.id);
    const bursts = f.bodies.map(b => f.state(b.id).burstAt).sort((a, b) => a - b);
    // The per-body spread of the pauses alone carries the pack apart over a good part of a second.
    expect(bursts[bursts.length - 1] - bursts[0]).toBeGreaterThan(400);
    expect(new Set(bursts.map(at => Math.round(at / FRAME))).size).toBeGreaterThanOrEqual(6);
  });
});

describe('meltdown', () => {
  it('stands after the last salvo, warns after its pause, bursts once and leaves without a kill', () => {
    const f = fixture([{ x: 0, y: 0 }]);
    f.aim.angle = 1.2;
    const end = f.spit(config.stages - 1);
    const lastPause = f.system.salvoSpent(f.entity(), 4, end)!;
    const booked = f.state();
    expect(booked.stage).toBe(config.stages);
    expect(booked.telegraphAt).toBe(end + Math.max(200, lastPause));
    expect(booked.burstAt - booked.telegraphAt).toBe(config.telegraphMs);
    expect(enemyHeatBurstPhaseAt(booked, end + 1)).toBe('heat');
    // From the last salvo on the body stands, faces its target and neither bites nor spits.
    f.run(end, end);
    for (const at of [end + 1, booked.telegraphAt + 1, booked.burstAt - 1]) {
      expect(f.system.getMovementOverride(f.entity(), at)).toEqual({ vx: 0, vy: 0, aimAngle: 1.2 });
    }
    expect(f.system.blocksRegularAttacks('d0')).toBe(true);
    // A train still moves it off the track.
    f.train.evading = true;
    expect(f.system.getMovementOverride(f.entity(), booked.telegraphAt + 1)).toBeNull();
    f.train.evading = false;
    // No further salvo heats a melting body or shifts its meltdown.
    expect(f.system.salvoSpent(f.entity(), 4, end + 50)).toBeNull();
    expect(f.state()).toEqual(booked);
    // Pushed by a knockback during the warning, it bursts where it stands at the burst moment.
    f.bodies[0].sprite.x = 30;
    f.run(end + FRAME, booked.burstAt + 4 * FRAME);
    expect(f.bursts).toEqual([{ id: 'd0', faction: 'hostile', x: 30, y: 0, at: expect.any(Number) }]);
    expect(f.bursts[0].at).toBeGreaterThanOrEqual(booked.burstAt);
    expect(f.removed).toEqual(['d0']);
    expect(f.system.getDevStatus('d0', booked.burstAt + 100)).toBeNull();
    expect(f.fizzles).toEqual([]);
  });

  it('restarts a warning once after a real teleport, but not for repositioning in place', () => {
    const f = fixture([{ x: 0, y: 0 }]);
    const end = f.spit(config.stages);
    let now = end;
    while (enemyHeatBurstPhaseAt(f.state(), now) !== 'telegraph') { f.run(now, now); now += FRAME; }
    const planned = f.state().burstAt;
    // Re-placed on the same spot every frame (a pinned body): the warning runs on unchanged.
    for (; now < planned - 200; now += FRAME) { f.bodies[0].positionRevision += 1; f.run(now, now); }
    expect(f.state().burstAt).toBe(planned);
    // A portal jump restarts it in full at the new place, once.
    f.bodies[0].positionRevision += 1; f.bodies[0].sprite.x += 400;
    f.run(now, now);
    expect(f.state().burstAt).toBe(now + config.telegraphMs);
    f.bodies[0].positionRevision += 1; f.bodies[0].sprite.x += 400;
    f.run(now + FRAME, now + FRAME);
    expect(f.state().burstAt).toBe(now + config.telegraphMs);
    f.run(now + 2 * FRAME, now + config.telegraphMs + FRAME);
    expect(f.bursts.map(entry => entry.x)).toEqual([800]);
  });

  it('melts an allied body down the same way; its burst keeps the allied faction', () => {
    const f = fixture([{ x: 0, y: 0 }], 'allied');
    const end = f.spit(config.stages);
    expect(f.system.getMovementOverride(f.entity(), end + 1)).toMatchObject({ vx: 0, vy: 0 });
    f.run(end, f.state().burstAt + FRAME);
    expect(f.bursts).toEqual([expect.objectContaining({ id: 'd0', faction: 'allied' })]);
    expect(f.removed).toEqual(['d0']);
  });
});

describe('heat death', () => {
  it('fizzles a heated body by its stage without any burst damage', () => {
    const f = fixture([{ x: 0, y: 0 }, { x: 1000, y: 0 }]);
    f.spit(3);
    f.system.handleKilled(death('d0'), 10_000);
    expect(f.fizzles).toHaveLength(1);
    expect(f.fizzles[0].radius).toBeGreaterThan(config.fizzle.minRadiusPx);
    expect(f.fizzles[0].radius).toBeLessThan(config.fizzle.maxRadiusPx);
    // A cold body dies without a fizzle; nothing ever bursts.
    f.run(10_000, 10_000);
    f.system.handleKilled(death('d1'), 10_000);
    expect(f.fizzles).toHaveLength(1);
    expect(f.burst).not.toHaveBeenCalled();
    expect(f.removed).toEqual([]);
    expect(heatFizzleRadius(config.stages, config)).toBe(config.fizzle.maxRadiusPx);
    expect(heatFizzleRadius(0, config)).toBeNull();
  });

  it('defuses a body killed during its warning', () => {
    const f = fixture([{ x: 0, y: 0 }]);
    const end = f.spit(config.stages);
    f.run(end, f.state().telegraphAt + 200);
    f.bodies[0].hp = 0;
    f.system.handleKilled(death('d0'), f.state().telegraphAt + 200);
    f.bodies[0].sprite.active = false;
    f.run(f.state().telegraphAt + 200, f.state().burstAt + 200);
    expect(f.burst).not.toHaveBeenCalled();
    expect(f.fizzles).toEqual([{ id: 'd0', radius: config.fizzle.maxRadiusPx }]);
  });
});

describe('heat on clients, config and wire', () => {
  it('derives phase, heat and speed on clients from the replicated state alone', () => {
    const state: EnemyHeatBurstState = { revision: 3, stage: 2, stageAt: 4000, telegraphAt: 0, burstAt: 0 };
    expect(enemyHeatAt(state, config.stages)).toBeCloseTo(2 / config.stages, 5);
    expect(enemyHeatBurstPhaseAt(state, 9000)).toBe('heat');
    expect(heatSpeedFactorOf(state, config)).toBeCloseTo(1 + config.speedBoost * 2 / config.stages, 5);
    const melting = { ...state, revision: 4, stage: config.stages, stageAt: 6000, telegraphAt: 6600, burstAt: 6600 + config.telegraphMs };
    expect(enemyHeatBurstPhaseAt(melting, 6400)).toBe('heat');
    expect(enemyHeatBurstPhaseAt(melting, 6700)).toBe('telegraph');
    expect(enemyHeatBurstPhaseAt(melting, melting.burstAt)).toBe('burst');
    expect(heatSpeedFactorOf(melting, config)).toBeCloseTo(1 + config.speedBoost, 5);
  });

  it('leaves every authored warning long enough to leave the zone and rejects malformed heat', () => {
    const { reactionMs, playerSpeedPxPerSec, playerRadiusPx } = enemyConfig.HEAT_BURST_FAIRNESS;
    for (const kind of enemyConfig.COOP_DEFENSE_ENEMY_KINDS) {
      const heat = enemyConfig.getCoopDefenseEnemyConfig(kind).heatBurst;
      if (!heat) continue;
      expect(heat.telegraphMs, kind).toBeGreaterThanOrEqual(reactionMs + (heat.burst.radiusPx + playerRadiusPx) / playerSpeedPxPerSec * 1000);
      expect(heat.salvoPauseMsByStage, kind).toHaveLength(heat.stages);
    }
    const normalize = (patch: Partial<typeof config>) => enemyConfig.normalizeHeatBurstConfig({ ...config, ...patch }, 'test');
    expect(() => normalize({ telegraphMs: 300 })).toThrow(/too short/);
    expect(() => normalize({ salvoPauseMsByStage: [1000, 800] })).toThrow(/relation/);
    expect(() => normalize({ salvoPauseJitter: 0.5 })).toThrow(/relation/);
    expect(() => normalize({ stages: 2.5 })).toThrow();
    // Heat comes only from salvos: a heat body without a salvo weapon is rejected.
    const entry = rawEnemies.enemies.find(enemy => enemy.id === 'demon-badger')!;
    const withoutSalvo = { ...entry, id: 'probe', weapons: entry.weapons.map(({ salvo: _salvo, ...weapon }) => weapon) };
    expect(() => enemyConfig.normalizeEnemyRegistry({ enemies: [withoutSalvo] } as never)).toThrow(/salvo weapon/);
  });

  it('round-trips the heat state and stays aligned after an invalid state', () => {
    const state: EnemyHeatBurstState = { revision: 5, stage: 5, stageAt: 6000, telegraphAt: 6600, burstAt: 8000 };
    const invalid = { revision: 6, stage: 2, stageAt: 9000, telegraphAt: 7000, burstAt: 0 };
    const out: (number | string)[] = [];
    encodeEnemyUpsert(out, { id: 'e1', heatBurst: invalid as EnemyHeatBurstState });
    encodeEnemyUpsert(out, { id: 'e2', heatBurst: state, hp: 12, maxHp: 20 });
    const [first, second] = decodeEnemyUpserts(out);
    expect(first.heatBurst).toBeUndefined();
    expect(second).toMatchObject({ id: 'e2', heatBurst: state, hp: 12, maxHp: 20 });
  });
});
