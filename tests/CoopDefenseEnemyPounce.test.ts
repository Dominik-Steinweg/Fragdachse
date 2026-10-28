import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
import * as enemyConfig from '../src/config/coopDefenseEnemies';
import { PLAYER_SIZE, PLAYER_SPEED } from '../src/config';
import { decodeEnemyUpserts, encodeEnemyUpsert } from '../src/network/enemySnapshotCodec';
import { EnemyManager } from '../src/entities/EnemyManager';
import { pounceClipFrame } from '../src/animations/EnemyPounceAnimation';
import { healthBarTestScene } from './healthBarTestScene';
import { CoopDefenseEnemyPounceSystem } from '../src/systems/CoopDefenseEnemyPounceSystem';
import { EMPTY_ENEMY_POUNCE_STATE, enemyPouncePhaseAt, isEnemyPounceState, type EnemyPounceState } from '../src/systems/EnemyPounceState';
import { boundingGaitFactor, createPounceReticle, predictPounceLanding, stepPounceReticle } from '../src/systems/enemyPounceRules';
import type { EnemyEntity } from '../src/entities/EnemyEntity';

const rabbit = enemyConfig.getCoopDefenseEnemyConfig('rabid-rabbit');
const config = rabbit.pounce!;
const FRAME = 16;
/** Reaction time a player needs before acting on the lock flash. */
const REACTION_MS = 250;

interface Point { x: number; y: number }

function fixture(starts: readonly Point[] = [{ x: 0, y: 0 }], player: Point = { x: 200, y: 0 }) {
  const states = new Map<string, EnemyPounceState>();
  const immune = new Map<string, boolean>();
  const stunned = { value: false };
  const biting = { value: false };
  const blind = { value: false };
  const route = { point: { x: 2000, y: 0 } as Point | null };
  const target = { ...player, vx: 0, vy: 0, active: true };
  const bodies = starts.map((start, index) => {
    const id = `r${index}`;
    states.set(id, EMPTY_ENEMY_POUNCE_STATE);
    return {
      id, kind: 'rabid-rabbit', faction: 'hostile', sprite: { active: true, x: start.x, y: start.y, rotation: 0 },
      positionRevision: 0, getHp: () => 20, isBurrowed: () => false, isAttackMovementPaused: () => false,
      isStationary: () => false, isOrdinaryMovementEnabled: () => true,
      getCollisionRadius: () => rabbit.size / 2, getMoveSpeed: () => rabbit.moveSpeed,
      stopMovement: vi.fn(), faceAngle: vi.fn(), setKnockbackImmune: (value: boolean) => { immune.set(id, value); },
      getPounceState: () => states.get(id)!,
      applyPounceState: (state: EnemyPounceState) => {
        if (isEnemyPounceState(state) && state.revision > states.get(id)!.revision) states.set(id, state);
      },
    };
  });
  const atImpact: Point[] = [];
  const impact = vi.fn(() => { atImpact.push({ x: target.x, y: target.y }); });
  const system = new CoopDefenseEnemyPounceSystem({
    enemies: { getHostileEnemies: () => bodies as unknown as EnemyEntity[] },
    isStunned: () => stunned.value,
    readTarget: () => target.active ? { ref: { kind: 'player', id: 'p1' }, x: target.x, y: target.y, radius: PLAYER_SIZE / 2 } : null,
    resolveTarget: () => target.active ? { ref: { kind: 'player', id: 'p1' }, x: target.x, y: target.y, radius: PLAYER_SIZE / 2 } : null,
    canSee: (enemy, seen, range) => !blind.value && Math.hypot(seen.x - enemy.sprite.x, seen.y - enemy.sprite.y) <= range,
    laneClearance: (_x, _y, _angle, length) => length,
    isFree: () => true,
    isBiting: () => biting.value,
    steeringPoint: () => route.point,
    moveNormally: (enemy, point, speed) => {
      const dx = point.x - enemy.sprite.x, dy = point.y - enemy.sprite.y, length = Math.hypot(dx, dy) || 1;
      return { vx: dx / length * speed, vy: dy / length * speed, blocked: false };
    },
    impact,
  });
  /** Advance host frames, moving bodies along their overrides and the player along its velocity. */
  const run = (from: number, to: number, speedFactor = 1) => {
    for (let now = from; now <= to; now += FRAME) {
      system.hostUpdate(now);
      for (const body of bodies) {
        const v = system.getMovementOverride(body as unknown as EnemyEntity, now);
        if (v) { body.sprite.x += v.vx * speedFactor * FRAME / 1000; body.sprite.y += v.vy * speedFactor * FRAME / 1000; }
      }
      target.x += target.vx * FRAME / 1000; target.y += target.vy * FRAME / 1000;
    }
  };
  /** Runs until the first body publishes an aim; returns its aim time. */
  const runUntilAim = (from = 0, id = 'r0') => {
    for (let now = from; now < from + 5000; now += FRAME) {
      run(now, now);
      if (states.get(id)!.pounce) return now;
    }
    throw new Error('no aim');
  };
  return { bodies, system, run, runUntilAim, target, impact, atImpact, stunned, biting, blind, route, immune,
    state: (id = 'r0') => states.get(id)! };
}

describe('pounce host decisions', () => {
  it('waits for its spawn grace, aims at a player in range and locks the landing before the take-off', () => {
    const f = fixture();
    const aimAt = f.runUntilAim();
    expect(aimAt).toBeGreaterThanOrEqual(config.initialDelayMs);
    const aim = f.state().pounce!;
    expect(aim.target).toEqual({ kind: 'player', id: 'p1' });
    expect(aim.landing).toBeNull();
    expect(aim.lockAt - aim.aimAt).toBe(config.aimMs);
    expect(enemyPouncePhaseAt(f.state(), aimAt + 1)).toBe('aim');
    expect(f.system.blocksRegularAttacks('r0', aimAt + 1)).toBe(true);
    expect(f.system.getMovementOverride(f.bodies[0] as unknown as EnemyEntity, aimAt + 1)).toMatchObject({ vx: 0, vy: 0 });
    f.run(aimAt + FRAME, aim.lockAt + FRAME);
    const locked = f.state().pounce!;
    const landing = locked.landing!;
    expect(landing.armed).toBe(true);
    expect(landing.takeoffAt - locked.lockAt).toBeGreaterThanOrEqual(config.lockMs);
    expect(landing.landAt - landing.takeoffAt).toBeGreaterThanOrEqual(config.airMinMs);
    expect(landing.landAt - landing.takeoffAt).toBeLessThanOrEqual(config.airMaxMs);
    const range = Math.hypot(landing.x - locked.originX, landing.y - locked.originY);
    expect(range).toBeGreaterThanOrEqual(config.minRangePx - 1);
    expect(range).toBeLessThanOrEqual(config.maxRangePx + 1);
    expect(f.immune.get('r0')).not.toBe(true);
  });

  it('hits only the announced zone on arrival: a straight runner is met, a player who turns after the lock is not', () => {
    for (const turns of [false, true]) {
      const f = fixture([{ x: 0, y: 0 }], { x: 220, y: -120 });
      const aimAt = f.runUntilAim();
      f.target.vy = PLAYER_SPEED;
      const lockAt = f.state().pounce!.lockAt;
      f.run(aimAt + FRAME, lockAt + FRAME);
      const landing = f.state().pounce!.landing!;
      if (turns) { f.target.vx = -PLAYER_SPEED; f.target.vy = 0; }
      f.run(lockAt + 2 * FRAME, landing.landAt - FRAME);
      expect(f.system.isAirborne('r0', landing.takeoffAt + 1)).toBe(true);
      expect(f.immune.get('r0')).toBe(true);
      f.run(landing.landAt, landing.recoverUntil + FRAME);
      expect(f.impact).toHaveBeenCalledTimes(1);
      const [, x, y, area] = f.impact.mock.calls[0]!;
      expect([x, y]).toEqual([landing.x, landing.y]);
      expect(area).toEqual(config.impact);
      expect(Math.hypot(f.bodies[0]!.sprite.x - landing.x, f.bodies[0]!.sprite.y - landing.y)).toBeLessThanOrEqual(3);
      expect(f.immune.get('r0')).toBe(false);
      const miss = Math.hypot(f.atImpact[0]!.x - x, f.atImpact[0]!.y - y) - PLAYER_SIZE / 2;
      if (turns) expect(miss).toBeGreaterThan(config.impact.radiusPx);
      else expect(miss).toBeLessThan(config.impact.radiusPx);
    }
  });

  it('aborts a stunned flight where the body is without an impact, and a cancelled aim holds a lockout', () => {
    const f = fixture();
    const aimAt = f.runUntilAim();
    const lockAt = f.state().pounce!.lockAt;
    f.run(aimAt + FRAME, lockAt + FRAME);
    const landing = f.state().pounce!.landing!;
    f.run(lockAt + 2 * FRAME, landing.takeoffAt + 5 * FRAME);
    f.stunned.value = true;
    f.run(landing.takeoffAt + 6 * FRAME, landing.takeoffAt + 7 * FRAME);
    const aborted = f.state().pounce!.landing!;
    expect(aborted.armed).toBe(false);
    expect(aborted.landAt).toBeLessThan(landing.landAt);
    f.run(landing.takeoffAt + 8 * FRAME, landing.landAt + 500);
    expect(f.impact).not.toHaveBeenCalled();

    const g = fixture();
    const second = g.runUntilAim();
    g.stunned.value = true;
    g.run(second + FRAME, second + FRAME);
    expect(g.state().pounce).toBeNull();
    g.stunned.value = false;
    expect(() => g.runUntilAim(second + 2 * FRAME)).not.toThrow();
    expect(g.state().pounce!.aimAt - second).toBeGreaterThanOrEqual(config.cancelLockoutMs);
  });

  it('stretches a slowed flight and keeps the announced landing point', () => {
    const f = fixture();
    const aimAt = f.runUntilAim();
    const lockAt = f.state().pounce!.lockAt;
    f.run(aimAt + FRAME, lockAt + FRAME);
    const planned = f.state().pounce!.landing!;
    f.run(lockAt + 2 * FRAME, planned.landAt + 2000, 0.5);
    const flown = f.state().pounce!.landing!;
    expect([flown.x, flown.y]).toEqual([planned.x, planned.y]);
    expect(flown.landAt).toBeGreaterThan(planned.landAt);
    expect(f.impact).toHaveBeenCalledTimes(1);
  });

  it('lets at most the pack budget aim at one player, with staggered starts', () => {
    const f = fixture([{ x: 0, y: -60 }, { x: 0, y: 0 }, { x: 0, y: 60 }, { x: 20, y: 120 }], { x: 230, y: 30 });
    let maxEngaged = 0;
    const aimStarts = new Set<number>();
    for (let now = 0; now < 2400; now += FRAME) {
      f.run(now, now);
      let engaged = 0;
      for (const body of f.bodies) {
        const state = f.state(body.id), phase = enemyPouncePhaseAt(state, now);
        if (phase === 'aim' || phase === 'lock' || phase === 'air') { engaged++; aimStarts.add(state.pounce!.aimAt); }
      }
      maxEngaged = Math.max(maxEngaged, engaged);
    }
    expect(maxEngaged).toBe(config.pack.maxPerTarget);
    const starts = [...aimStarts].sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(config.pack.staggerMs);
  });

  it('never aims outside its range or while the bite holds the body', () => {
    const close = fixture([{ x: 0, y: 0 }], { x: config.minRangePx - 20, y: 0 });
    close.run(0, 3000);
    expect(close.state().pounce).toBeNull();
    const far = fixture([{ x: 0, y: 0 }], { x: config.maxRangePx + 40, y: 0 });
    far.run(0, 3000);
    expect(far.state().pounce).toBeNull();
    const biting = fixture();
    biting.biting.value = true;
    biting.run(0, 3000);
    expect(biting.state().pounce).toBeNull();
  });

  it('cuts sideways off its route while running at a far target, alternating sides', () => {
    const f = fixture([{ x: 0, y: 0 }], { x: 900, y: 0 });
    const cuts = config.sideCuts!;
    const headings: number[] = [];
    for (let now = 0; now < 2 * cuts.intervalMaxMs + 500; now += FRAME) {
      f.system.hostUpdate(now);
      const v = f.system.getMovementOverride(f.bodies[0] as unknown as EnemyEntity, now);
      if (v) headings.push(Math.atan2(v.vy, v.vx));
    }
    expect(headings.length).toBeGreaterThan(0);
    const degrees = headings.map(angle => Math.abs(angle) * 180 / Math.PI);
    expect(Math.min(...degrees)).toBeGreaterThanOrEqual(cuts.angleMinDeg - 0.5);
    expect(Math.max(...degrees)).toBeLessThanOrEqual(cuts.angleMaxDeg + 0.5);
    expect(headings.some(angle => angle > 0) && headings.some(angle => angle < 0)).toBe(true);
  });
});

describe('pounce aim resilience', () => {
  it('keeps an aim through a short push and a brief loss of sight, and takes off where the body stands', () => {
    const f = fixture();
    const aimAt = f.runUntilAim();
    const body = f.bodies[0]!;
    body.sprite.x += config.cancelDisplacementPx * 0.6;
    f.blind.value = true;
    f.run(aimAt + FRAME, aimAt + FRAME + Math.min(config.lostSightGraceMs, config.aimMs) - 2 * FRAME);
    expect(f.state().pounce).not.toBeNull();
    f.blind.value = false;
    const lockAt = f.state().pounce!.lockAt;
    f.run(aimAt + Math.min(config.lostSightGraceMs, config.aimMs), lockAt + FRAME);
    const locked = f.state().pounce!;
    expect(locked.landing?.armed).toBe(true);
    expect([locked.originX, locked.originY]).toEqual([Math.round(body.sprite.x), Math.round(body.sprite.y)]);
  });

  it('drops an aim whose target stays out of sight longer than the grace', () => {
    const f = fixture();
    const aimAt = f.runUntilAim();
    f.blind.value = true;
    f.run(aimAt + FRAME, aimAt + config.lostSightGraceMs + 3 * FRAME);
    expect(f.state().pounce).toBeNull();
  });

  it('turns the lead of the aim point at a limited rate while the target part follows at once', () => {
    const origin = { x: 0, y: 0 }, target = { x: 220, y: 0 };
    const reticle = createPounceReticle(target.x, target.y, 0, origin.x, origin.y, config);
    // The predicted landing flips 160 px to the other side of the target: the lead swings over.
    stepPounceReticle(reticle, target.x, target.y, target.x, target.y + 160, 1000, origin.x, origin.y, config);
    stepPounceReticle(reticle, target.x, target.y, target.x, target.y - 160, 1100, origin.x, origin.y, config);
    expect(Math.abs(reticle.offsetY - 160)).toBeCloseTo(config.aimTrackSpeedPx * 0.1, 6);
    // A target moving on keeps its lead: the aim point moves with it in the same step.
    stepPounceReticle(reticle, target.x + 30, target.y, target.x + 30, target.y + reticle.offsetY, 1116, origin.x, origin.y, config);
    expect(reticle.x).toBeCloseTo(Math.min(target.x + 30, config.maxRangePx), 6);
  });
});

describe('pounce rules and config', () => {
  it('leads the landing along the target course, capped and kept within range', () => {
    const still = predictPounceLanding(0, 0, 200, 0, 0, 0, config.lockMs, config);
    expect([still.x, still.y]).toEqual([200, 0]);
    const running = predictPounceLanding(0, 0, 200, 0, 0, PLAYER_SPEED, config.lockMs, config);
    expect(running.y).toBeGreaterThan(0);
    expect(running.y).toBeLessThanOrEqual(config.maxLeadPx + 1e-6);
    const near = predictPounceLanding(0, 0, 40, 0, 0, 0, config.lockMs, config);
    expect(near.length).toBeCloseTo(config.minRangePx, 6);
  });

  it('keeps every authored pounce dodgeable after the lock flash', () => {
    for (const kind of enemyConfig.COOP_DEFENSE_ENEMY_KINDS) {
      const pounce = enemyConfig.getCoopDefenseEnemyConfig(kind).pounce;
      if (!pounce) continue;
      const escapeMs = (pounce.impact.radiusPx + PLAYER_SIZE / 2) / PLAYER_SPEED * 1000;
      expect(pounce.lockMs + pounce.airMinMs, kind).toBeGreaterThanOrEqual(REACTION_MS + escapeMs);
    }
  });

  it('pulses the bounding gait around the authored speed', () => {
    const gait = config.gait!;
    const samples = Array.from({ length: 2000 }, (_, i) => boundingGaitFactor('r0', i * 3, gait));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(1 - gait.surge - 1e-9);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1 + gait.surge + 1e-9);
    expect(samples.reduce((sum, value) => sum + value, 0) / samples.length).toBeCloseTo(1, 1);
  });

  it('rejects malformed pounces and a second movement owner, and requires a player hunter', () => {
    expect(() => enemyConfig.normalizePounceConfig({ ...config, minRangePx: config.maxRangePx })).toThrow();
    expect(() => enemyConfig.normalizePounceConfig({ ...config, minRangePx: config.impact.radiusPx })).toThrow();
    expect(() => enemyConfig.normalizePounceConfig({ ...config, pack: { ...config.pack, maxPerTarget: 0 } })).toThrow();
    expect(() => enemyConfig.normalizePounceConfig({ ...config, gait: { ...config.gait!, surge: 0.95 } })).toThrow();
    const hop = enemyConfig.getCoopDefenseEnemyConfig('plague-medic').hop;
    expect(() => enemyConfig.normalizeEnemyRegistry({ enemies: [{ ...rabbit, id: 'rabbit', hop }] } as never)).toThrow();
    expect(() => enemyConfig.normalizeEnemyRegistry({ enemies: [{ ...rabbit, id: 'rabbit', movementTarget: 'bases' }] } as never))
      .toThrow(/player target/);
  });

  it('keeps the rabbit at the badger slot of the wire kind order', () => {
    expect(enemyConfig.getCoopDefenseEnemyKindIndex('rabid-rabbit')).toBe(2);
    expect(enemyConfig.hasCoopDefenseEnemyKind('rabid-badger')).toBe(false);
  });
});

describe('pounce replication and presentation', () => {
  const state: EnemyPounceState = { revision: 7, pounce: { target: { kind: 'player', id: 'p1' }, originX: 10, originY: -4,
    aimAt: 1000, lockAt: 1450, landing: { x: 210, y: 36, takeoffAt: 1700, landAt: 2100, recoverUntil: 2550, armed: true } } };

  it('round-trips aim and landing, and keeps later entries aligned after an invalid pounce', () => {
    const wire: (number | string)[] = [];
    const aiming: EnemyPounceState = { revision: 6, pounce: { ...state.pounce!, landing: null } };
    encodeEnemyUpsert(wire, { id: 'e1', pounce: state });
    encodeEnemyUpsert(wire, { id: 'e2', pounce: aiming });
    encodeEnemyUpsert(wire, { id: 'e3', pounce: { ...state, pounce: { ...state.pounce!, landing: { ...state.pounce!.landing!, landAt: 1600 } } } });
    encodeEnemyUpsert(wire, { id: 'e4', hp: 5, maxHp: 10 });
    const [first, second, invalid, last] = decodeEnemyUpserts(wire);
    expect(first!.pounce).toEqual(state);
    expect(second!.pounce).toEqual(aiming);
    expect(invalid).toEqual({ id: 'e3' });
    expect(last).toEqual({ id: 'e4', hp: 5, maxHp: 10 });
  });

  it('replicates pounces to remote rabbits, ignores stale revisions and places a flying rabbit on its line', () => {
    const configs = enemyConfig.resolveCoopDefenseEnemyConfigs(1);
    configs['rabid-rabbit'] = { ...configs['rabid-rabbit'], glow: undefined, imageKey: 'test-enemy' };
    const host = new EnemyManager(healthBarTestScene().scene, configs);
    const client = new EnemyManager(healthBarTestScene().scene, configs);
    try {
      const body = host.hostSpawnAtWorld(10, -4, 'rabid-rabbit', { originId: 'wave' });
      host.requestFullNetSnapshot();
      client.applySnapshot(JSON.parse(JSON.stringify(host.getNetSnapshot())));
      expect(client.getEnemy(body.id)!.getPounceState().revision).toBe(0);
      body.applyPounceState(state);
      client.applySnapshot(JSON.parse(JSON.stringify(host.getNetSnapshot())));
      const remote = client.getEnemy(body.id)!;
      expect(remote.getPounceState()).toEqual(state);
      const stale: (number | string)[] = [];
      encodeEnemyUpsert(stale, { id: body.id, pounce: { revision: 3, pounce: null } });
      client.applySnapshot({ c: 1, u: stale, r: [] });
      expect(remote.getPounceState().revision).toBe(state.revision);
      const ground = remote.sprite.displayWidth;
      client.updateClientInterpolation(0.1, 1900);
      expect(remote.sprite.x).toBeCloseTo(110, 0);
      expect(remote.sprite.y).toBeCloseTo(16, 0);
      expect(remote.sprite.displayWidth).toBeGreaterThan(ground * 1.2);
      client.updateClientInterpolation(0.1, 2600);
      expect(remote.sprite.displayWidth).toBeCloseTo(ground, 5);
    } finally { client.destroy(); host.destroy(); }
  });

  it('maps aim, flight and recovery onto windup and leap clips, and onto the claw lunge of older sheets', () => {
    const landing = state.pounce!.landing!;
    const clips: Record<string, { frames: number[]; markers?: Record<string, number>; frameRate?: number }> = {
      leap: { frames: Array.from({ length: 20 }, (_, i) => 100 + i), markers: { launch: 6, land: 14 } },
      windup: { frames: [200, 201, 202, 203], frameRate: 10 },
    };
    const clip = (name: string) => clips[name];
    expect(pounceClipFrame(state, 1000, clip)).toBe(200);
    expect(pounceClipFrame(state, 1250, clip)).toBe(202);
    expect(pounceClipFrame(state, landing.takeoffAt, clip)).toBe(106);
    expect(pounceClipFrame(state, landing.landAt, clip)).toBe(114);
    expect(pounceClipFrame(state, landing.recoverUntil - 1, clip)).toBe(119);
    expect(pounceClipFrame(state, landing.recoverUntil + 1, clip)).toBeNull();
    const claw = { frames: Array.from({ length: 18 }, (_, i) => 300 + i), markers: { strike: 8, impact: 11 } };
    const older = (name: string) => name === 'claw' ? claw : undefined;
    expect(pounceClipFrame(state, 1000, older)).toBe(300);
    expect(pounceClipFrame(state, landing.takeoffAt, older)).toBe(308);
    expect(pounceClipFrame(state, landing.landAt, older)).toBe(311);
    expect(pounceClipFrame(state, landing.takeoffAt, () => undefined)).toBeNull();
  });
});
