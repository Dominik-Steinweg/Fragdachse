import { describe, expect, it, vi } from 'vitest';
import * as enemyConfig from '../src/config/coopDefenseEnemies';
import { CoopDefenseShieldChargerSystem, type ShieldChargeContactTarget } from '../src/systems/CoopDefenseShieldChargerSystem';
import { EMPTY_SHIELD_CHARGE_STATE, isShieldChargeState, type ShieldChargeState } from '../src/systems/ShieldChargeState';
import { stepTurnRateFacing } from '../src/entities/turnRateFacing';
import { decodeEnemyUpserts, encodeEnemyUpsert } from '../src/network/enemySnapshotCodec';
import { isWithinShieldArc } from '../src/systems/enemyFrontalShield';
import type { EnemyEntity } from '../src/entities/EnemyEntity';

const config = enemyConfig.getCoopDefenseEnemyConfig('shield-charger-badger').shieldCharger!;
const RADIUS = 15;

function fixture(options: { facing?: number; target?: { x: number; y: number }; clearance?: number } = {}) {
  let charge: ShieldChargeState = EMPTY_SHIELD_CHARGE_STATE;
  const immune = vi.fn();
  const enemy = {
    id: 'e1', kind: 'shield-charger-badger', faction: 'hostile', sprite: { active: true, x: 0, y: 0 },
    getHp: () => 120, isBurrowed: () => false, isAttackMovementPaused: () => false,
    getAimAngle: () => options.facing ?? 0, getCollisionRadius: () => RADIUS, stopMovement: vi.fn(), faceAngle: vi.fn(),
    setKnockbackImmune: immune,
    getShieldChargeState: () => charge,
    applyShieldChargeState: (state: ShieldChargeState) => { if (state.revision > charge.revision) charge = state; },
  } as unknown as EnemyEntity;
  const target = { ...(options.target ?? { x: 300, y: 0 }) };
  const players: ShieldChargeContactTarget[] = [{ id: 'p1', x: target.x, y: target.y, radius: 16 }];
  const strike = vi.fn(() => true), knockback = vi.fn(), stunned = { value: false };
  const hasClearLineOfFire = vi.fn(() => true);
  const system = new CoopDefenseShieldChargerSystem({
    enemies: { getAllEnemies: () => [enemy] },
    combat: { hasClearLineOfFire, isStunned: () => stunned.value },
    readTarget: () => target,
    contactTargets: () => players,
    laneClearance: (_x, _y, _a, length) => Math.min(length, options.clearance ?? Infinity),
    strike, knockback,
  });
  /** Advance the run like physics would: move along the override for dt. */
  const move = (dtMs: number) => {
    const v = system.getMovementOverride(enemy);
    if (v) { enemy.sprite.x += v.vx * dtMs / 1000; enemy.sprite.y += v.vy * dtMs / 1000; }
  };
  return { enemy, system, target, players, strike, knockback, stunned, immune, hasClearLineOfFire, move, charge: () => charge };
}

describe('shield charger host decisions', () => {
  it('starts only aligned, in range and with sight; the shield drops for the whole windup', () => {
    const misaligned = fixture({ facing: Math.PI / 2 });
    misaligned.system.hostUpdate(0);
    expect(misaligned.charge().phase).toBe('none');
    expect(misaligned.system.getFrontalShield('e1')).toMatchObject({ arcDegrees: config.shieldArcDegrees });

    const far = fixture({ target: { x: config.triggerMaxDistancePx + 10, y: 0 } });
    far.system.hostUpdate(0);
    expect(far.charge().phase).toBe('none');

    const blind = fixture(); blind.hasClearLineOfFire.mockReturnValue(false); blind.system.hostUpdate(0);
    expect(blind.charge().phase).toBe('none');

    const f = fixture();
    f.system.hostUpdate(0);
    expect(f.charge()).toMatchObject({ phase: 'windup', lane: { originX: 0, originY: 0, angle: 0, startedAt: 0, runAt: config.windupMs } });
    expect(f.charge().lane!.length).toBe(Math.min(config.maxRunPx, 300 + config.overshootPx));
    expect(f.system.getFrontalShield('e1')).toBeNull();
    expect(f.system.blocksRegularAttacks('e1')).toBe(true);
    expect(f.system.getMovementOverride(f.enemy)).toEqual({ vx: 0, vy: 0 });
  });

  it('aims the lane exactly at a standing target even when the body is slightly off, and hits it at long range', () => {
    const off = config.alignToleranceDegrees * 0.8 * Math.PI / 180;
    const distance = config.triggerMaxDistancePx - 10;
    const f = fixture({ facing: off, target: { x: distance, y: 0 } });
    f.system.hostUpdate(0);
    expect(f.charge().lane!.angle).toBeCloseTo(0, 6);
    expect(f.enemy.faceAngle).toHaveBeenCalledWith(0);
    for (let now = 0; now <= config.windupMs + 2000 && f.charge().phase !== 'recover'; now += 16) { f.system.hostUpdate(now); f.move(16); }
    expect(f.strike).toHaveBeenCalledWith('p1', 'e1', config.hitDamage, expect.any(Number), expect.any(Number), expect.any(Number));
  });

  it('keeps the announced lane when the target moves, then runs past it and recovers', () => {
    const f = fixture();
    f.system.hostUpdate(0);
    const lane = f.charge().lane!;
    f.target.x = -500; f.target.y = 400; // target switch / decoy after the telegraph started
    f.system.hostUpdate(config.windupMs - 1);
    expect(f.charge().lane).toEqual(lane);
    f.system.hostUpdate(config.windupMs);
    expect(f.charge().phase).toBe('run');
    expect(f.immune).toHaveBeenLastCalledWith(true);
    for (let t = config.windupMs; t < config.windupMs + 3000 && f.charge().phase === 'run'; t += 16) { f.move(16); f.system.hostUpdate(t + 16); }
    expect(f.charge().phase).toBe('recover');
    expect(f.enemy.sprite.x).toBeGreaterThan(300); // passed the original target point
    expect(Math.abs(f.enemy.sprite.y)).toBeLessThan(1);
    expect(f.enemy.sprite.x).toBeLessThanOrEqual(lane.length + 1);
    expect(f.immune).toHaveBeenLastCalledWith(false);
    const recover = f.charge().lane!;
    expect(f.system.getFrontalShield('e1')).toBeNull();
    f.system.hostUpdate(recover.recoverUntil);
    expect(f.charge().phase).toBe('none');
    expect(f.system.getFrontalShield('e1')).not.toBeNull();
    // Cooldown runs from the run start, independent of recovery.
    f.enemy.sprite.x = 0; f.target.x = 300; f.target.y = 0;
    f.system.hostUpdate(lane.runAt + config.cooldownMs - 1);
    expect(f.charge().phase).toBe('none');
    f.system.hostUpdate(lane.runAt + config.cooldownMs);
    expect(f.charge().phase).toBe('windup');
  });

  it('strikes each body at most once per charge, even with coarse frames, and only inside the swept capsule', () => {
    for (const dt of [8, 16, 100]) {
      const f = fixture();
      f.players.push({ id: 'p2', x: 200, y: RADIUS + 16 + 5, radius: 16 }); // just outside the corridor
      f.system.hostUpdate(0); f.system.hostUpdate(config.windupMs);
      for (let t = config.windupMs; f.charge().phase === 'run' && t < config.windupMs + 4000; t += dt) { f.move(dt); f.system.hostUpdate(t + dt); }
      expect(f.strike.mock.calls.map(call => call[0])).toEqual(['p1']);
      expect(f.knockback).toHaveBeenCalledOnce();
      const [, vx, vy] = f.knockback.mock.calls[0];
      expect(Math.hypot(vx, vy)).toBeCloseTo(config.hitKnockbackSpeed);
    }
  });

  it('a clipped lane stops at the blocker, and a geometry stall ends the run early with a shorter lane', () => {
    const f = fixture({ clearance: 360 });
    f.system.hostUpdate(0);
    expect(f.charge().lane!.length).toBe(360);
    const blocked = fixture({ clearance: 200 });
    blocked.system.hostUpdate(0);
    expect(blocked.charge().phase).toBe('none'); // cannot even reach the target

    const stall = fixture();
    stall.system.hostUpdate(0); stall.system.hostUpdate(config.windupMs);
    stall.move(16); stall.system.hostUpdate(config.windupMs + 16);
    stall.system.hostUpdate(config.windupMs + 200); // no movement: an unknown blocker held the body
    expect(stall.charge().phase).toBe('recover');
    expect(stall.charge().lane!.length).toBeLessThan(30);
  });

  it('stun or displacement cancel a windup into recovery with a retry lockout; death and clear release everything', () => {
    const stun = fixture();
    stun.system.hostUpdate(0); stun.stunned.value = true; stun.system.hostUpdate(100);
    expect(stun.charge().phase).toBe('recover');
    stun.stunned.value = false;
    stun.system.hostUpdate(stun.charge().lane!.recoverUntil);
    stun.system.hostUpdate(stun.charge().lane?.recoverUntil ?? 100 + config.recoverMs + 1);
    expect(stun.charge().phase).toBe('none');
    stun.system.hostUpdate(100 + config.cancelLockoutMs - 1);
    expect(stun.charge().phase).toBe('none');

    const pushed = fixture();
    pushed.system.hostUpdate(0); pushed.enemy.sprite.y = config.windupDisplacementCancelPx + 1; pushed.system.hostUpdate(16);
    expect(pushed.charge().phase).toBe('recover');

    const dead = fixture();
    dead.system.hostUpdate(0); dead.system.hostUpdate(config.windupMs);
    dead.system.handleKilled({ id: 'e1' });
    expect(dead.charge().phase).toBe('none');
    expect(dead.immune).toHaveBeenLastCalledWith(false);
    expect(dead.system.isRunning('e1')).toBe(false);
  });

  it('publishes strictly increasing revisions so stale deltas never restart a telegraph', () => {
    const f = fixture();
    const revisions: number[] = [];
    f.system.hostUpdate(0); revisions.push(f.charge().revision);
    f.system.hostUpdate(config.windupMs); revisions.push(f.charge().revision);
    expect(revisions[1]).toBeGreaterThan(revisions[0]);
    expect(isShieldChargeState(f.charge())).toBe(true);
  });
});

describe('shield charger contracts', () => {
  it('turns at the authored rate: a 180° turn takes visible time and moving sideways is slow', () => {
    const rate = 105 * Math.PI / 180 / 1000;
    let angle = 0, elapsed = 0;
    while (Math.abs(Math.atan2(Math.sin(Math.PI - angle), Math.cos(Math.PI - angle))) > 1e-6 && elapsed < 5000) {
      angle = stepTurnRateFacing(angle, Math.PI, rate, 16).angle; elapsed += 16;
    }
    expect(elapsed).toBeGreaterThanOrEqual(1700);
    expect(stepTurnRateFacing(0, Math.PI / 2, rate, 0).locomotion).toBeCloseTo(0.25);
    expect(stepTurnRateFacing(0, 0, rate, 16).locomotion).toBe(1);
  });

  it('shares the player shield arc rule', () => {
    expect(isWithinShieldArc(0, 0, 0, 120, 100, 0)).toBe(true);
    expect(isWithinShieldArc(0, 0, 0, 120, 100, 170)).toBe(true);   // ~59.5°
    expect(isWithinShieldArc(0, 0, 0, 120, 100, 175)).toBe(false);  // ~60.3°
    expect(isWithinShieldArc(0, 0, 0, 120, -100, 0)).toBe(false);
  });

  it('round-trips the host-fixed lane on an appended snapshot field', () => {
    const state: ShieldChargeState = { revision: 7, phase: 'run', lane: { originX: 120.5, originY: -40, angle: 2.3456,
      length: 640, halfWidth: 15, startedAt: 1000, runAt: 1700, runEndsAt: 2427, recoverUntil: 3177 } };
    const wire: (number | string)[] = [];
    encodeEnemyUpsert(wire, { id: 'e1', shieldCharge: state });
    const decoded = decodeEnemyUpserts(wire)[0].shieldCharge!;
    expect(decoded).toMatchObject({ revision: 7, phase: 'run', lane: { originX: 120.5, length: 640, runAt: 1700 } });
    expect(decoded.lane!.angle).toBeCloseTo(2.3456, 4);
    // Older fields keep their wire bits: a legacy upsert decodes unchanged.
    const legacy: (number | string)[] = [];
    encodeEnemyUpsert(legacy, { id: 'e1', specialAction: 'fire-lance-charge', specialActionEndsAt: 5 });
    expect(decodeEnemyUpserts(legacy)[0]).toMatchObject({ specialAction: 'fire-lance-charge' });
    expect(decodeEnemyUpserts(legacy)[0].shieldCharge).toBeUndefined();
  });

  it('rejects inconsistent authored relationships', () => {
    for (const bad of [
      { ...config, triggerMinDistancePx: config.triggerMaxDistancePx },
      { ...config, maxRunPx: config.triggerMaxDistancePx - 1 },
      { ...config, cooldownMs: config.windupMs - 1 },
      { ...config, windupMs: 0 },
    ]) expect(() => enemyConfig.normalizeShieldChargerConfig(bad)).toThrow(/shield charger/);
    expect(() => enemyConfig.normalizeTurnRate(0)).toThrow();
  });
});

describe('shield charger clip frames', () => {
  const lane = { originX: 0, originY: 0, angle: 0, length: 600, halfWidth: 15, startedAt: 1000, runAt: 1700, runEndsAt: 2400, recoverUntil: 3100 };
  const clips: Record<string, { frames: number[]; markers?: Record<string, number> }> = {
    windup: { frames: [10, 11, 12, 13, 14], markers: { ready: 4 } },
    charge: { frames: [20, 21, 22] },
    recover: { frames: [30, 31, 32, 33, 34, 35], markers: { raise: 3 } },
  };
  const clip = (name: string) => clips[name] as never;
  it('reaches and holds the ready pose during the windup, loops the run and lifts the shield at the end of recovery', async () => {
    const { shieldChargeClipFrame } = await import('../src/animations/EnemyShieldChargeAnimation');
    const at = (phase: 'windup' | 'run' | 'recover', now: number) => shieldChargeClipFrame({ revision: 1, phase, lane }, now, clip);
    expect(at('windup', 1000)).toBe(10);
    expect(at('windup', 1000 + 0.4 * 700)).toBe(14);
    expect(at('windup', 1690)).toBe(14);
    expect([at('run', 1700), at('run', 1745), at('run', 1790), at('run', 1835)]).toEqual([20, 21, 22, 20]);
    expect(at('recover', 2400)).toBe(30);
    expect(at('recover', 2400 + 0.69 * 700)).toBe(33);
    expect(at('recover', 3100)).toBe(35);
    expect(shieldChargeClipFrame({ revision: 1, phase: 'none', lane: null }, 2000, clip)).toBeNull();
    expect(shieldChargeClipFrame({ revision: 1, phase: 'run', lane }, 2000, () => undefined)).toBeNull();
  });
});
