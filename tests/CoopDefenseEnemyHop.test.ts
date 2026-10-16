import { describe, expect, it, vi } from 'vitest';
import * as enemyConfig from '../src/config/coopDefenseEnemies';
import { CoopDefenseEnemyHopSystem, type EnemyHopCombatIntent } from '../src/systems/CoopDefenseEnemyHopSystem';
import { EMPTY_ENEMY_HOP_STATE, enemyHopPhaseAt, isEnemyHopState, type EnemyHopState } from '../src/systems/EnemyHopState';
import type { EnemyEntity } from '../src/entities/EnemyEntity';

const config = enemyConfig.getCoopDefenseEnemyConfig('plague-medic').hop!;
const heal = config.heal!;
const FRAME = 16;
const GOAL = { x: 2000, y: 0 };

interface FakeBody { id: string; faction: string; sprite: { active: boolean; x: number; y: number }; hp: number; maxHp: number }

function fixture(options: { faction?: 'hostile' | 'allied' } = {}) {
  let hop: EnemyHopState = EMPTY_ENEMY_HOP_STATE;
  const immune = vi.fn();
  const toad = {
    id: 'toad', kind: 'plague-medic', faction: options.faction ?? 'hostile', sprite: { active: true, x: 0, y: 0 },
    positionRevision: 0, getHp: () => 180, getMaxHp: () => 180, isBurrowed: () => false, isAttackMovementPaused: () => false,
    getCollisionRadius: () => 15, getMoveSpeed: () => enemyConfig.getCoopDefenseEnemyConfig('plague-medic').moveSpeed,
    stopMovement: vi.fn(), faceAngle: vi.fn(), setKnockbackImmune: immune,
    getHopState: () => hop,
    applyHopState: (state: EnemyHopState) => { if (isEnemyHopState(state) && state.revision > hop.revision) hop = state; },
  };
  const allies: FakeBody[] = [];
  const asEnemy = (body: FakeBody) => ({ ...body, kind: 'zombie-badger', getHp: () => body.hp, getMaxHp: () => body.maxHp,
    isBurrowed: () => false, getCollisionRadius: () => 15, get sprite() { return body.sprite; } });
  const healed: string[] = [];
  const stunned = { value: false };
  const intent: { value: EnemyHopCombatIntent | null } = { value: null };
  const players: { x: number; y: number }[] = [];
  const landingShock = vi.fn();
  const system = new CoopDefenseEnemyHopSystem({
    enemies: {
      getAllEnemies: () => [toad, ...allies.map(asEnemy)] as unknown as EnemyEntity[],
      applyHealing: (id: string, amount: number) => {
        healed.push(id);
        const ally = allies.find(body => body.id === id);
        if (ally) ally.hp = Math.min(ally.maxHp, ally.hp + amount);
        return null as never;
      },
    },
    combat: { isStunned: () => stunned.value, hasClearLineOfFire: () => true },
    readSteering: enemy => ({ point: GOAL, originCost: GOAL.x - enemy.sprite.x, costAt: x => GOAL.x - x }),
    isFree: () => true,
    canMove: () => true,
    combatIntent: () => intent.value,
    shockTargets: () => players,
    landingShock,
  });
  const enemy = toad as unknown as EnemyEntity;
  /** Advance host frames, moving the body along the override like physics would. */
  const run = (from: number, to: number, speedFactor = 1) => {
    for (let now = from; now <= to; now += FRAME) {
      system.hostUpdate(now);
      const v = system.getMovementOverride(enemy, now);
      if (v) { toad.sprite.x += v.vx * speedFactor * FRAME / 1000; toad.sprite.y += v.vy * speedFactor * FRAME / 1000; }
    }
  };
  return { toad, enemy, allies, system, run, healed, stunned, intent, players, landingShock, immune, hop: () => hop };
}

describe('hop host decisions', () => {
  it('rests a breath without injured allies, then hops towards the goal on a computed timeline', () => {
    const f = fixture();
    f.run(0, config.breathMs - FRAME);
    expect(f.hop().jump).toBeNull();
    f.run(config.breathMs, config.breathMs + FRAME);
    const jump = f.hop().jump!;
    expect(jump.takeoffAt - jump.crouchAt).toBe(config.crouchMs);
    expect(jump.landAt - jump.takeoffAt).toBe(config.airMs);
    expect(jump.targetX).toBeGreaterThan(0);
    expect(enemyHopPhaseAt(f.hop(), jump.crouchAt + 1)).toBe('crouch');
    expect(enemyHopPhaseAt(f.hop(), jump.takeoffAt + 1)).toBe('air');
    expect(enemyHopPhaseAt(f.hop(), jump.landAt + 1)).toBe('land');
    expect(enemyHopPhaseAt(f.hop(), jump.settleUntil)).toBe('rest');
    expect(f.system.blocksRegularAttacks('toad', jump.crouchAt + 1)).toBe(true);
    expect(f.system.isAirborne('toad', jump.takeoffAt + 1)).toBe(true);
    expect(f.system.getMovementOverride(f.enemy, jump.crouchAt + 1)).toEqual({ vx: 0, vy: 0 });
    f.run(config.breathMs + 2 * FRAME, jump.settleUntil + FRAME);
    expect(Math.abs(f.toad.sprite.x - jump.targetX)).toBeLessThanOrEqual(3);
    expect(f.system.getMovementOverride(f.enemy, jump.settleUntil + FRAME)).toEqual({ vx: 0, vy: 0, keepsRouting: true });
    expect(f.immune).toHaveBeenLastCalledWith(false);
  });

  it('heals linked allies only while resting and hops on after the rest cap', () => {
    const f = fixture();
    f.allies.push({ id: 'hurt', faction: 'hostile', sprite: { active: true, x: 60, y: 0 }, hp: 10, maxHp: 400 });
    f.run(0, config.restMaxMs - FRAME);
    expect(f.hop().links).toEqual(['hurt']);
    expect(f.hop().jump).toBeNull();
    expect(f.healed.length).toBeGreaterThan(0);
    f.run(config.restMaxMs, config.restMaxMs + FRAME);
    const jump = f.hop().jump!;
    expect(f.hop().links).toEqual([]);
    const healedBeforeFlight = f.healed.length;
    f.run(config.restMaxMs + 2 * FRAME, jump.settleUntil - FRAME);
    expect(f.healed.length).toBe(healedBeforeFlight);
    f.run(jump.settleUntil, jump.settleUntil + heal.tickIntervalMs + 2 * FRAME);
    expect(f.healed.length).toBeGreaterThan(healedBeforeFlight);
  });

  it('drops its links while stunned', () => {
    const f = fixture();
    f.allies.push({ id: 'hurt', faction: 'hostile', sprite: { active: true, x: 60, y: 0 }, hp: 10, maxHp: 400 });
    f.run(0, 600);
    expect(f.hop().links).toEqual(['hurt']);
    f.stunned.value = true;
    const before = f.healed.length;
    f.run(616, 1200);
    expect(f.hop().links).toEqual([]);
    expect(f.healed.length).toBe(before);
  });

  it('stands while the attack owner aims or winds up, and never jumps out of a committed windup', () => {
    const f = fixture();
    f.intent.value = { aimAngle: 1 };
    f.run(0, config.restMaxMs - FRAME);
    expect(f.hop().jump).toBeNull();
    expect(f.toad.faceAngle).toHaveBeenCalledWith(1);
    f.intent.value = { aimAngle: 1, committed: true };
    f.run(config.restMaxMs, config.restMaxMs + 500);
    expect(f.hop().jump).toBeNull();
    f.intent.value = null;
    f.run(config.restMaxMs + 516, config.restMaxMs + 600);
    expect(f.hop().jump).not.toBeNull();
  });

  it('cancels a crouch on stun and aborts a flight where the body is, both without a shock', () => {
    const crouch = fixture();
    crouch.players.push({ x: 104, y: 0 });
    crouch.run(0, config.breathMs + FRAME);
    expect(crouch.hop().jump!.shock).toBe(true);
    crouch.stunned.value = true;
    crouch.run(config.breathMs + 2 * FRAME, config.breathMs + 3 * FRAME);
    const cancelled = crouch.hop().jump!;
    expect(cancelled).toMatchObject({ targetX: 0, targetY: 0, shock: false });
    crouch.run(config.breathMs + 4 * FRAME, config.breathMs + 1500);
    expect(crouch.landingShock).not.toHaveBeenCalled();

    const flight = fixture();
    flight.run(0, config.breathMs + FRAME);
    const takeoffAt = flight.hop().jump!.takeoffAt;
    flight.run(config.breathMs + 2 * FRAME, takeoffAt + 100);
    flight.stunned.value = true;
    flight.run(takeoffAt + 116, takeoffAt + 140);
    const aborted = flight.hop().jump!;
    expect(aborted.targetX).toBe(Math.round(flight.toad.sprite.x));
    expect(aborted.landAt).toBeLessThanOrEqual(takeoffAt + 140);
    expect(aborted.targetX).toBeLessThan(config.maxHopPx);
  });

  it('stretches a slowed flight around the current progress and keeps the landing point', () => {
    const f = fixture();
    f.run(0, config.breathMs + FRAME);
    const planned = f.hop().jump!;
    f.run(config.breathMs + 2 * FRAME, planned.landAt + 200, 0.5);
    const stretched = f.hop().jump!;
    expect(stretched.targetX).toBe(planned.targetX);
    expect(stretched.landAt).toBeGreaterThan(planned.landAt);
    let now = planned.landAt + 216;
    while (enemyHopPhaseAt(f.hop(), now) === 'air' && now < planned.landAt + 3000) { f.run(now, now, 0.5); now += FRAME; }
    expect(enemyHopPhaseAt(f.hop(), now)).toBe('land');
    expect(Math.abs(f.toad.sprite.x - planned.targetX)).toBeLessThanOrEqual(3);
  });

  it('shocks only an armed landing at the announced point, and never for an allied toad', () => {
    const f = fixture();
    f.players.push({ x: 104, y: 0 });
    f.run(0, config.breathMs + FRAME);
    const jump = f.hop().jump!;
    expect(jump.shock).toBe(true);
    f.run(config.breathMs + 2 * FRAME, jump.settleUntil + FRAME);
    expect(f.landingShock).toHaveBeenCalledExactlyOnceWith(f.enemy, expect.any(Number), expect.any(Number), config.landingShock, expect.any(Number));

    const unarmed = fixture();
    unarmed.players.push({ x: -400, y: 0 });
    unarmed.run(0, 2000);
    expect(unarmed.landingShock).not.toHaveBeenCalled();

    const allied = fixture({ faction: 'allied' });
    allied.players.push({ x: 104, y: 0 });
    allied.run(0, 2000);
    expect(allied.hop().jump?.shock ?? false).toBe(false);
    expect(allied.landingShock).not.toHaveBeenCalled();
  });
});

describe('hop config validation', () => {
  it('rejects malformed hops and a second locomotion owner', () => {
    expect(() => enemyConfig.normalizeHopConfig({ ...config, fanSteps: 6 })).toThrow();
    expect(() => enemyConfig.normalizeHopConfig({ ...config, minHopPx: config.maxHopPx + 1 })).toThrow();
    expect(() => enemyConfig.normalizeHopConfig({ ...config, restMaxMs: config.breathMs - 1 })).toThrow();
    expect(() => enemyConfig.normalizeHopConfig({ ...config, heal: { ...heal, maxLinks: enemyConfig.MAX_HOP_HEAL_LINKS + 1 } })).toThrow();
    expect(() => enemyConfig.normalizeHopConfig({ ...config,
      landingShock: { ...config.landingShock!, armRadiusPx: config.landingShock!.radiusPx - 1 } })).toThrow();
    const toad = enemyConfig.getCoopDefenseEnemyConfig('plague-medic');
    const charger = enemyConfig.getCoopDefenseEnemyConfig('shield-charger-badger');
    expect(() => enemyConfig.normalizeEnemyRegistry({ enemies: [{ ...toad, id: 'toad', shieldCharger: charger.shieldCharger }] } as never))
      .toThrow(/second locomotion owner/);
  });
});
