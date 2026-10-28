import { describe, expect, it, vi } from 'vitest';
import { fakeEntity } from './fakeEntity';

import { PLAYER_SIZE, PLAYER_SPEED } from '../src/config';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import { decodeEnemyUpserts, encodeEnemyUpsert } from '../src/network/enemySnapshotCodec';
import {
  CoopDefenseKaboomtulaSystem,
  type KaboomtulaContact,
  type KaboomtulaHuntTarget,
  type KaboomtulaPorts,
  type KaboomtulaWebPort,
} from '../src/systems/CoopDefenseKaboomtulaSystem';
import { CoopDefenseTurretWebSystem, type TurretWebTarget } from '../src/systems/CoopDefenseTurretWebSystem';
import { skitterAmplitude, skitterWeave } from '../src/systems/kaboomtulaMotion';
import { EMPTY_KABOOMTULA_STATE, type KaboomtulaState } from '../src/systems/KaboomtulaState';

const KIND = 'kaboomtula';
const config = () => getCoopDefenseEnemyConfig(KIND).kaboomtula!;
const STEP_MS = 16;

interface Body { id: string; x: number; y: number; vx: number; vy: number }

/** Host-side spider stub: position, radius and the replicated state slot the system publishes into. */
function spider(x: number, y: number) {
  let state: KaboomtulaState = EMPTY_KABOOMTULA_STATE;
  const knockbackImmune = vi.fn();
  const enemy = fakeEntity({ id: 'e1', kind: KIND, faction: 'hostile', active: true, x, y,
    getHp: () => 60, getCollisionRadius: () => getCoopDefenseEnemyConfig(KIND).size / 2, stopMovement: vi.fn(),
    setKnockbackImmune: knockbackImmune,
    getKaboomtulaState: () => state,
    applyKaboomtulaState: (next: KaboomtulaState) => { if (next.revision > state.revision) state = next; },
  }) as unknown as EnemyEntity;
  return { enemy, knockbackImmune, state: () => state };
}

/**
 * Minimal world: open ground, every lane free, routes lead straight to the point, locomotion moves
 * at the requested speed. Players are plain bodies; `step` integrates the spider's movement override.
 */
function world(options: { spiderAt?: [number, number]; players?: Body[]; base?: { id: string; x: number; y: number };
  sight?: () => boolean; stunned?: () => boolean; web?: KaboomtulaWebPort; huntBase?: boolean } = {}) {
  const [sx, sy] = options.spiderAt ?? [0, 0];
  const body = spider(sx, sy);
  const players = options.players ?? [];
  let alive = true;
  const detonate = vi.fn((_enemy: EnemyEntity, _contact: KaboomtulaContact) => { alive = false; });
  const killedPop = vi.fn();
  const asTarget = (player: Body): KaboomtulaHuntTarget => ({ ref: { kind: 'player', id: player.id }, x: player.x, y: player.y,
    radius: PLAYER_SIZE / 2, pounceable: true });
  const baseTarget = (): KaboomtulaHuntTarget | null => options.base ? { ref: { kind: 'base', id: options.base.id },
    x: options.base.x, y: options.base.y, radius: 0, pounceable: false, baseId: options.base.id } : null;
  const ports: KaboomtulaPorts = {
    enemies: { getHostileEnemies: () => alive ? [body.enemy] : [] },
    isStunned: () => options.stunned?.() ?? false,
    readTarget: () => options.huntBase ? baseTarget() : players[0] ? asTarget(players[0]) : null,
    resolveTarget: (_enemy, ref) => ref.kind === 'base' ? baseTarget()
      : players.find(player => player.id === ref.id) ? asTarget(players.find(player => player.id === ref.id)!) : null,
    canSee: (enemy, target, range) => (options.sight?.() ?? true)
      && Math.hypot(target.x - enemy.sprite.x, target.y - enemy.sprite.y) <= range,
    contactTargets: (_enemy, hunted) => [
      ...players.map(player => ({ ref: { kind: 'player' as const, id: player.id }, x: player.x, y: player.y, radius: PLAYER_SIZE / 2 })),
      ...(hunted?.kind === 'base' && options.base ? [{ ref: hunted, x: options.base.x, y: options.base.y, radius: 0 }] : []),
    ],
    laneClearance: (_x, _y, _angle, length) => length,
    route: (_enemy, _key, point) => point,
    moveNormally: (enemy, point, speed) => {
      const dx = point.x - enemy.sprite.x, dy = point.y - enemy.sprite.y, d = Math.hypot(dx, dy) || 1;
      return { vx: dx / d * speed, vy: dy / d * speed, blocked: false };
    },
    detonate,
    killedPop,
    web: options.web ?? null,
  };
  const system = new CoopDefenseKaboomtulaSystem(ports);
  let now = 1000;
  const step = () => {
    system.hostUpdate(now);
    const velocity = alive ? system.getMovementOverride(body.enemy, now) : null;
    if (velocity) { body.enemy.sprite.x += velocity.vx * STEP_MS / 1000; body.enemy.sprite.y += velocity.vy * STEP_MS / 1000; }
    for (const player of players) { player.x += player.vx * STEP_MS / 1000; player.y += player.vy * STEP_MS / 1000; }
    now += STEP_MS;
  };
  const runUntil = (done: () => boolean, maxMs = 6000) => {
    for (let elapsed = 0; elapsed < maxMs && !done(); elapsed += STEP_MS) step();
  };
  return { system, body, players, detonate, killedPop, step, runUntil, now: () => now, alive: () => alive };
}

describe('Kabummtula', () => {
  it('is a player hunter whose only weapon bites obstacles', () => {
    const enemy = getCoopDefenseEnemyConfig(KIND);
    expect(enemy.movementTarget).toBe('players');
    expect(enemy.basePreference).toBeDefined();
    expect(enemy.weapons).toEqual([expect.objectContaining({ targetMode: 'rocks' })]);
    expect(config().pounce.triggerPx).toBeLessThan(config().activationRadiusPx);
  });

  it('explodes exactly once on contact, even while still approaching', () => {
    const w = world({ players: [{ id: 'p1', x: 10, y: 0, vx: 0, vy: 0 }], sight: () => false });
    w.step(); w.step();
    expect(w.detonate).toHaveBeenCalledTimes(1);
    expect(w.detonate.mock.calls[0][1].ref).toEqual({ kind: 'player', id: 'p1' });
  });

  it('holds the alert pose for alertMs with continuous sight, then rushes; lost sight cancels the alert', () => {
    let sight = true;
    const w = world({ players: [{ id: 'p1', x: 400, y: 0, vx: 0, vy: 0 }], sight: () => sight });
    w.step();
    expect(w.body.state().phase).toBe('alert');
    const alertAt = w.now() - STEP_MS;
    w.runUntil(() => w.body.state().phase !== 'alert');
    expect(w.body.state().phase).toBe('rush');
    expect(w.now() - alertAt).toBeGreaterThanOrEqual(config().alertMs);

    const blind = world({ players: [{ id: 'p1', x: 400, y: 0, vx: 0, vy: 0 }], sight: () => sight });
    sight = true; blind.step();
    sight = false; blind.step();
    expect(blind.body.state().phase).toBe('approach');
  });

  it('skitters faster than a running player on average in a smooth weave without freezes', () => {
    const skitter = config().skitter;
    let forward = 0, sides = 0, previous = skitterWeave('e-speed', 0, skitter), sign = 0;
    expect(Math.abs(previous.angle)).toBeLessThan(1e-9);
    for (let elapsed = 10; elapsed <= 20000; elapsed += 10) {
      const weave = skitterWeave('e-speed', elapsed, skitter);
      forward += Math.cos(weave.angle) * weave.speedFactor;
      // Gameplay before realism: no stop and no sudden turn between two host frames.
      expect(weave.speedFactor).toBeGreaterThan(0.5);
      expect(Math.abs(weave.angle - previous.angle)).toBeLessThan(4 * Math.PI / 180);
      const side = Math.sign(weave.angle);
      if (side !== 0 && side !== sign) { sides++; sign = side; }
      previous = weave;
    }
    expect(config().rushSpeedPx * forward / 2000).toBeGreaterThan(PLAYER_SPEED);
    // Still a spider: it keeps weaving from side to side rather than running straight.
    expect(sides).toBeGreaterThan(20);
    expect(skitterAmplitude(0, skitter)).toBeLessThan(1);
  });

  it('telegraphs out of the run and leaps onto a standing player', () => {
    const w = world({ players: [{ id: 'p1', x: 300, y: 0, vx: 0, vy: 0 }] });
    w.runUntil(() => w.body.state().phase === 'pounce');
    const pounce = w.body.state();
    expect(pounce.target).toEqual({ kind: 'player', id: 'p1' });
    expect(pounce.endsAt - pounce.startedAt).toBe(config().pounce.telegraphMs);
    w.runUntil(() => w.body.state().phase === 'leap' || !w.alive());
    expect(w.body.state().leap).not.toBeNull();
    expect(w.system.isAirborne('e1')).toBe(true);
    expect(w.body.knockbackImmune).toHaveBeenLastCalledWith(true);
    w.runUntil(() => !w.alive(), 1000);
    expect(w.detonate).toHaveBeenCalledTimes(1);
  });

  it('leads a player who keeps running across the lane', () => {
    const w = world({ players: [{ id: 'p1', x: 300, y: 0, vx: 0, vy: PLAYER_SPEED }] });
    w.runUntil(() => !w.alive(), 3000);
    expect(w.detonate).toHaveBeenCalledTimes(1);
  });

  it('commits its lane at the telegraph start, so turning around during the telegraph dodges', () => {
    const w = world({ players: [{ id: 'p1', x: 300, y: 0, vx: 0, vy: PLAYER_SPEED }] });
    w.runUntil(() => w.body.state().phase === 'pounce');
    const planned = w.body.state().leap!;
    expect(planned).not.toBeNull();
    w.players[0].vy = -PLAYER_SPEED;
    w.runUntil(() => w.body.state().phase === 'leap' || !w.alive(), 1000);
    const leap = w.body.state().leap!;
    expect(leap.endX).toBeCloseTo(planned.endX, 0);
    expect(leap.endY).toBeCloseTo(planned.endY, 0);
    w.runUntil(() => w.body.state().phase === 'recover' || !w.alive(), 1000);
    expect(w.detonate).not.toHaveBeenCalled();
  });

  it('misses a sidestep at the lock, recovers and starts over with a new alert', () => {
    const w = world({ players: [{ id: 'p1', x: 300, y: 0, vx: 0, vy: 0 }] });
    w.runUntil(() => w.body.state().phase === 'leap');
    const leap = w.body.state().leap!;
    const angle = Math.atan2(leap.endY - leap.originY, leap.endX - leap.originX);
    // Out of the lane by more than half its width plus the player's radius.
    const side = getCoopDefenseEnemyConfig(KIND).size / 2 + PLAYER_SIZE / 2 + config().contactMarginPx + 20;
    w.players[0].x += -Math.sin(angle) * side; w.players[0].y += Math.cos(angle) * side;
    w.runUntil(() => w.body.state().phase === 'recover' || !w.alive(), 1000);
    expect(w.detonate).not.toHaveBeenCalled();
    expect(w.body.state().phase).toBe('recover');
    expect(w.body.knockbackImmune).toHaveBeenLastCalledWith(false);
    w.runUntil(() => w.body.state().phase === 'alert' || !w.alive(), config().recoverMs + 200);
    expect(w.body.state().phase).toBe('alert');
  });

  it('falls back to approach when stunned mid-hunt and aborts a leap into recovery', () => {
    let stunned = false;
    const w = world({ players: [{ id: 'p1', x: 400, y: 0, vx: 0, vy: 0 }], stunned: () => stunned });
    w.runUntil(() => w.body.state().phase === 'rush');
    stunned = true; w.step();
    expect(w.body.state().phase).toBe('approach');

    stunned = false;
    const leaping = world({ players: [{ id: 'p1', x: 300, y: 0, vx: 0, vy: 0 }], stunned: () => stunned });
    leaping.runUntil(() => leaping.body.state().phase === 'leap');
    stunned = true; leaping.step();
    expect(leaping.body.state().phase).toBe('recover');
  });

  it('only pops when killed and suppresses the generic death', () => {
    const w = world({ players: [{ id: 'p1', x: 400, y: 0, vx: 0, vy: 0 }] });
    w.step();
    const death = { id: 'e1', kind: KIND, x: 0, y: 0, faction: 'hostile' } as Parameters<CoopDefenseKaboomtulaSystem['handleKilled']>[0];
    expect(w.system.handleKilled(death, w.now())).toBe(true);
    expect(w.killedPop).toHaveBeenCalledTimes(1);
    expect(w.detonate).not.toHaveBeenCalled();
    expect(w.system.handleKilled({ ...death, kind: 'rabid-rabbit' }, w.now())).toBe(false);
  });

  it('rams a hunted base without a leap and explodes on its surface', () => {
    const w = world({ base: { id: 'core', x: 300, y: 0 }, huntBase: true });
    w.runUntil(() => !w.alive());
    expect(w.detonate).toHaveBeenCalledTimes(1);
    expect(w.detonate.mock.calls[0][1].ref).toEqual({ kind: 'base', id: 'core' });
  });

  it('spits at the nearest unwebbed turret and gives way to a player', () => {
    const now = () => 0;
    const turrets: TurretWebTarget[] = [{ id: 1, x: 200, y: 0 }, { id: 'base-t', x: 120, y: 0 }, { id: 3, x: 100, y: 0 }];
    const web = new CoopDefenseTurretWebSystem({ turrets: () => turrets, canSee: () => true });
    const launch = vi.spyOn(web, 'launch');
    // Turret 3 is already webbed for long: the spider picks the nearest unwebbed one (the base turret).
    web.reserve(3, 'other'); web.launch({ turretId: 3, enemyId: 'other', sourceX: 0, sourceY: 0, targetX: 100, targetY: 0,
      launchAt: 0, impactAt: 0, durationMs: 60_000 });
    web.hostUpdate(now());
    launch.mockClear();
    const players: Body[] = [];
    const w = world({ players, web, sight: () => true });
    w.runUntil(() => launch.mock.calls.length > 0, 2000);
    expect(launch.mock.calls[0][0].turretId).toBe('base-t');
    expect(w.body.state().phase).toBe('spit');

    const busy = world({ players, web, sight: () => true });
    busy.runUntil(() => busy.body.state().phase === 'spit', 1000);
    players.push({ id: 'p1', x: 400, y: 0, vx: 0, vy: 0 });
    busy.step();
    expect(busy.body.state().phase).toBe('alert');
  });
});

describe('Kabummtula turret webs', () => {
  const shot = (turretId: number | string, impactAt: number, durationMs = 4000) => ({ turretId, enemyId: 'e1', sourceX: 0, sourceY: 0,
    targetX: 0, targetY: 0, launchAt: impactAt - 300, impactAt, durationMs });

  it('applies at impact by numeric and string ids, refreshes instead of stacking and expires', () => {
    const turrets: TurretWebTarget[] = [{ id: 7, x: 10, y: 0 }, { id: 'base:north:0', x: 50, y: 0 }];
    const web = new CoopDefenseTurretWebSystem({ turrets: () => turrets, canSee: () => true });
    web.launch(shot(7, 1000)); web.launch(shot('base:north:0', 1000));
    web.hostUpdate(999);
    expect(web.isWebbed(7, 999)).toBe(false);
    web.hostUpdate(1000);
    expect(web.isWebbed(7, 1000)).toBe(true);
    expect(web.isWebbed('base:north:0', 1000)).toBe(true);
    expect(web.isWebbed('7', 1000)).toBe(false);
    web.launch(shot(7, 3000)); web.hostUpdate(3000);
    expect(web.getSnapshot().webs.find(entry => entry.turretId === 7)).toMatchObject({ appliedAt: 3000, expiresAt: 7000 });
    web.hostUpdate(7000);
    expect(web.isWebbed(7, 7000)).toBe(false);
  });

  it('lets a web fizzle on a removed turret and reports reservations of other spiders', () => {
    const turrets: TurretWebTarget[] = [{ id: 1, x: 0, y: 0 }];
    const web = new CoopDefenseTurretWebSystem({ turrets: () => turrets, canSee: () => true });
    const enemy = fakeEntity({ id: 'e2', x: 0, y: 0 }) as unknown as EnemyEntity;
    web.reserve(1, 'e1');
    expect(web.candidates(enemy, 100, 0)[0].reserved).toBe(true);
    web.release(1, 'e1');
    expect(web.candidates(enemy, 100, 0)[0].reserved).toBe(false);
    web.launch(shot(1, 500));
    turrets.length = 0;
    web.hostUpdate(500);
    expect(web.getSnapshot()).toEqual({ shots: [], webs: [] });
  });
});

describe('Kabummtula replication', () => {
  it('round-trips the spider state and keeps the following entry aligned', () => {
    const kaboomtula: KaboomtulaState = { revision: 4, phase: 'leap', startedAt: 1200, endsAt: 1410,
      target: { kind: 'player', id: 'peer-1' }, leap: { originX: 10, originY: 20, endX: 180, endY: 40, takeoffAt: 1200, landAt: 1410 } };
    const out: (number | string)[] = [];
    encodeEnemyUpsert(out, { id: 'e1', kaboomtula });
    encodeEnemyUpsert(out, { id: 'e2', x: 5, y: 6 });
    const decoded = decodeEnemyUpserts(out);
    expect(decoded[0].kaboomtula).toEqual(kaboomtula);
    expect(decoded[1]).toMatchObject({ id: 'e2', x: 5, y: 6 });

    const open: (number | string)[] = [];
    encodeEnemyUpsert(open, { id: 'e1', kaboomtula: { ...kaboomtula, phase: 'approach', target: null, leap: null } });
    expect(decodeEnemyUpserts(open)[0].kaboomtula).toMatchObject({ phase: 'approach', target: null, leap: null });
  });
});
