import { describe, expect, it, vi } from 'vitest';
import { KRAKEN_BOSS_DEFAULTS } from '../src/config/krakenBoss';
import { CoopDefenseKrakenSystem, type KrakenHostDependencies } from '../src/systems/CoopDefenseKrakenSystem';
import { readKrakenState, type KrakenState, type KrakenLaneReservation } from '../src/systems/KrakenState';
import type { BossTargetRef } from '../src/combat/CombatPartContact';
import { krakenExitDistance } from '../src/systems/CoopDefenseKrakenMotion';

const boss: BossTargetRef = { kind: 'enemy', id: 'kraken', scope: { worldRevision: 1, runtimeGeneration: 1 }, instance: { entityGeneration: 1, activityRevision: 1 } };
function setup() {
  const config = structuredClone(KRAKEN_BOSS_DEFAULTS);
  const entity = { x: 0, y: 0, angle: 0, hp: 100, maxHp: 100, alive: true, stunned: false };
  let now = 0, serial = 0, lanesEnabled = true;
  const publications: KrakenState[] = [];
  const deps: KrakenHostDependencies = {
    entity: { readBoss: () => entity, setBodyTargetability: vi.fn(), setFacing: (_, angle) => { entity.angle = angle; },
      setMovement: vi.fn((_, _mode, point) => { if (point) Object.assign(entity, point); }) },
    intent: { readTarget: () => ({ target: boss, x: 450, y: 0 }), readSecondaryTargets: () => [] },
    habitat: { reserveWaterSpawn: vi.fn(), revalidate: () => true, release: vi.fn(),
      reserveTentacles: (_boss, _habitat, _targets, count) => !lanesEnabled ? [] : Array.from({ length: count }, (_, i): KrakenLaneReservation => ({
        reservationId: `lane-${++serial}`, topologyRevision: 1, shoreId: `shore-${serial}`, waterEntry: { x: 100, y: i * 200 }, radialAngle: 0,
        pose: { originX: 110, originY: i * 200, angle: 0, geometry: { kind: 'lane', length: config.tentacles.length, width: config.tentacles.width } } })),
      revalidateLane: () => true,
      tentacleAim: (r, target) => Math.hypot(target.x - r.waterEntry.x, target.y - r.waterEntry.y) <= config.tentacles.length - config.tentacles.safetyMarginPx
        ? Math.atan2(target.y - r.waterEntry.y, target.x - r.waterEntry.x) : null,
      aimTentacle: (r, target) => Math.hypot(target.x - r.waterEntry.x, target.y - r.waterEntry.y) <= config.tentacles.length - config.tentacles.safetyMarginPx
        ? { ...r.pose, angle: Math.atan2(target.y - r.waterEntry.y, target.x - r.waterEntry.x) } : null,
      canWander: () => true, wanderPoint: () => null, divePoint: () => ({ x: 0, y: 0 }), isDiveInterior: () => true, recoverLand: () => null,
      reserveExit: () => ({ status: 'valid', value: { reservationId: 'exit', topologyRevision: 1, corridorId: 'east', widthPx: 200, path: [{ x: 0, y: 0 }, { x: 300, y: 0 }] } }),
      revalidateExit: r => ({ status: 'valid', value: r }) },
    combat: { resolveAreaAttack: vi.fn(() => ({} as never)) }, projectiles: { spawnProjectile: vi.fn(() => ++serial) },
    brood: { reserveEgg: () => true, released: vi.fn(), cancelEgg: vi.fn(), clearBoss: vi.fn(), retireBossEggs: vi.fn(), hostUpdate: vi.fn(), getEggs: () => [] } as never,
    publish: { publish: s => { if (s) { expect(readKrakenState(s)).not.toBeNull(); publications.push(s); } } },
    claw: vi.fn(), waterApproach: () => null, canMove: () => true, landPoseValid: () => true, flightFree: () => true, bodyTravelLimit: (_p, _a, distance) => distance,
    eggLandings: (_p, _angle, count) => Array.from({ length: count }, (_, i) => ({ x: 600 + i * 50, y: i * 100 })),
    diagnostic: vi.fn(),
  };
  const system = new CoopDefenseKrakenSystem(config, deps);
  system.start(boss, 'pond', 0, 0);
  const tick = (at: number) => { system.preMovement(at, at - now); now = at; system.hostUpdateActions(at); };
  const dive = () => { tick(config.dive.intervalMs); tick(config.dive.intervalMs + config.dive.durationMs); };
  return { system, deps, config, entity, tick, dive, publications, noLanes: () => { lanesEnabled = false; } };
}

describe('Kraken host owner', () => {
  it('keeps dev selection capability-gated and rejects illegal phases, range and HP', () => {
    const f = setup();
    expect(() => f.system.requestDevAction('ink')).toThrow('isolated dev host');
    f.deps.devAuthorized = () => true;
    expect(() => f.system.requestDevAction('lunge')).toThrow('phase surfaced');
    expect(() => f.system.requestDevAction('ashore')).toThrow('HP threshold');
    expect(() => f.system.requestDevAction('spines')).toThrow('outside ink range');
    f.deps.intent.readTarget = () => null;
    expect(() => f.system.requestDevAction('eggs')).toThrow('valid host target');
    f.system.clear();
    expect(() => f.system.requestDevAction('dive')).toThrow('living Kraken');
  });
  it('selects a queued action once, preserves the active attack, and skips only its wait', () => {
    const f = setup(); f.deps.devAuthorized = () => true;
    f.system.requestDevAction('ink'); f.tick(1);
    const ink = f.system.getBodyClaw().attack!;
    expect(ink.weaponId).toBe('kraken-ink');
    f.system.requestDevAction('eggs');
    expect(() => f.system.requestDevAction('dive')).toThrow('already pending');
    f.tick(ink.endsAt - 1);
    expect(f.system.getBodyClaw().attack?.attackId).toBe(ink.attackId);
    f.tick(ink.endsAt); f.tick(ink.endsAt + 1);
    expect(f.system.getState()?.bodyAction?.kind).toBe('eggs');
    expect(f.system.getDevAction()).toMatchObject({ act: 'eggs', status: 'started' });
    const detached = f.system.getDevAction()!; detached.status = 'failed';
    expect(f.system.getDevAction()?.status).toBe('started');
    f.system.clear(); expect(f.system.getDevAction()).toBeNull();
  });
  it('accepts ink reachable by turning without granting extra range', () => {
    const f = setup(); f.deps.devAuthorized = () => true; f.entity.angle = Math.PI;
    f.deps.intent.readTarget = () => ({ target: boss, x: f.config.ink.range + f.config.ink.mouthOffset.x - 10, y: 0 });
    f.system.requestDevAction('ink'); f.tick(1);
    expect(f.system.getDevAction()?.status).toBe('pending');
    expect(f.system.getState()?.bodyAction).toBeNull();
    f.deps.intent.readTarget = () => ({ target: boss, x: f.config.spines.range + 1, y: 0 });
    f.tick(2);
    expect(f.system.getDevAction()).toMatchObject({ status: 'failed', error: expect.stringContaining('out of range') });
  });
  it('waits for real facing, regrowth and dive interior and revalidates pending requests', () => {
    const f = setup(); f.deps.devAuthorized = () => true;
    f.deps.intent.readTarget = () => ({ target: boss, x: 0, y: f.config.spines.range - 1 });
    f.system.requestDevAction('spines'); f.tick(1);
    expect(f.system.getState()?.bodyAction).toBeNull();
    let now = 1;
    while (f.system.getDevAction()?.status === 'pending' && now < 2000) f.tick(now += 20);
    const action = f.system.getState()!.bodyAction!;
    if (action.kind !== 'spines') throw Error('spine selection failed');
    f.tick(action.endsAt);
    f.system.requestDevAction('spines'); f.tick(action.endsAt + 1);
    expect(f.system.getDevAction()?.status).toBe('pending');
    expect(f.system.getState()?.bodyAction).toBeNull();
    f.deps.devAuthorized = () => false; f.tick(action.endsAt + 2);
    expect(f.system.getDevAction()).toMatchObject({ status: 'failed', error: 'Isolated dev host no longer active' });
    const d = setup(); d.deps.devAuthorized = () => true;
    d.deps.habitat.isDiveInterior = () => false;
    d.system.requestDevAction('dive'); d.tick(1);
    expect(d.system.getState()?.phase.kind).toBe('surfaced');
    d.deps.habitat.isDiveInterior = () => true; d.tick(2);
    expect(d.system.getState()?.phase.kind).toBe('diving');
    expect(d.system.getDevAction()?.status).toBe('started');
  });
  it('uses the real exit and land lunge collision paths for dev actions', () => {
    const f = setup(); f.deps.devAuthorized = () => true;
    f.entity.hp = f.entity.maxHp * f.config.phaseTwoHpRatio;
    f.system.requestDevAction('ashore'); f.tick(1);
    const phase = f.system.getState()!.phase;
    if (phase.kind !== 'ashore') throw Error('no exit');
    f.tick(phase.recoveryEndsAt);
    expect(f.system.getState()?.phase.kind).toBe('land');
    f.deps.bodyTravelLimit = () => 20;
    f.system.requestDevAction('lunge'); f.tick(phase.recoveryEndsAt + 1);
    const attack = f.system.getBodyClaw().attack!;
    const from = f.entity.x;
    f.tick(attack.hitAt);
    expect(f.entity.x - from).toBeLessThanOrEqual(20);
    expect(f.system.getState()?.phase.kind).toBe('land');
  });
  it('reports blocked exits and unusable egg casts rather than claiming a dev start', () => {
    const f = setup(); f.deps.devAuthorized = () => true;
    f.deps.eggLandings = () => [];
    f.system.requestDevAction('eggs'); f.tick(1);
    expect(f.system.getDevAction()).toMatchObject({ status: 'failed', error: expect.stringContaining('landing') });
    const e = setup(); e.deps.devAuthorized = () => true; e.entity.hp = 1;
    e.deps.habitat.reserveExit = () => ({ status: 'invalid', reason: 'No corridor' });
    e.system.requestDevAction('ashore'); e.tick(1);
    expect(e.system.getDevAction()).toMatchObject({ status: 'failed', error: expect.stringContaining('No corridor') });
  });
  it('faces the target before freezing the egg throw cone', () => {
    const f = setup();
    f.deps.intent.readTarget = () => ({ target: boss, x: 0, y: f.config.spines.range + 100 });
    const landings = vi.fn(f.deps.eggLandings); f.deps.eggLandings = landings;
    f.tick(f.config.firstAttackDelayMs);
    expect(f.system.getState()!.bodyAction).toBeNull(); expect(landings).not.toHaveBeenCalled();
    let at = f.config.firstAttackDelayMs;
    while (!f.system.getState()!.bodyAction && at < 5000) { at += 20; f.tick(at); }
    expect(f.system.getState()!.bodyAction?.kind).toBe('eggs');
    expect(landings).toHaveBeenCalledOnce();
    expect(landings.mock.calls[0][1]).toBe(f.entity.angle);
    expect(Math.abs(f.entity.angle - Math.PI / 2)).toBeLessThanOrEqual(Math.PI / 36);
  });
  it('uses the authored mouth range for ink selection and the frozen hit cone', () => {
    const f = setup(), range = f.config.ink.range;
    f.deps.intent.readTarget = () => ({ target: boss, x: f.config.ink.mouthOffset.x + range, y: 0 });
    f.tick(f.config.firstAttackDelayMs);
    expect(f.system.getBodyClaw().attack?.pose.geometry).toEqual({ kind: 'sector', range, arcDegrees: f.config.ink.arcDegrees });
    const distant = setup();
    distant.deps.intent.readTarget = () => ({ target: boss, x: distant.config.ink.mouthOffset.x + range + 1, y: 0 });
    distant.tick(distant.config.firstAttackDelayMs);
    expect(distant.system.getState()!.bodyAction?.kind).not.toBe('ink');
  });
  it('wanders deterministically with bounded turning and pauses without an action', () => {
    const a = setup(), b = setup();
    for (const f of [a, b]) {
      f.deps.intent.readTarget = () => null;
      f.deps.habitat.wanderPoint = (from, random) => ({ x: from.x + 150, y: from.y + 100 + random * 30 });
    }
    let previous = a.entity.angle;
    for (let now = 20; now < 5000; now += 20) {
      a.tick(now); b.tick(now);
      expect(Math.abs(a.entity.angle - previous)).toBeLessThanOrEqual(a.config.waterWander.turnRateDegPerSec * Math.PI / 180 * .02 + 1e-9);
      expect(a.entity).toEqual(b.entity);
      previous = a.entity.angle;
    }
    expect(a.entity.x).toBeGreaterThan(0); expect(a.entity.y).toBeGreaterThan(0);
    expect(a.system.getState()?.bodyAction).toBeNull();
  });
  it('swims into the pond interior before diving and holds that point through surfacing', () => {
    const f = setup(); f.entity.x = 200; f.entity.angle = Math.PI;
    f.config.dive.intervalMs = 100; f.config.firstAttackDelayMs = 1e6;
    f.system.start(boss, 'pond', 0, 0);
    f.deps.habitat.isDiveInterior = p => Math.abs(p.x) <= 40;
    let previous = f.entity.x, now = 100;
    for (; f.system.getState()?.phase.kind === 'surfaced'; now += 50) {
      f.tick(now);
      expect(Math.abs(f.entity.x - previous)).toBeLessThanOrEqual(f.config.waterApproachSpeedPxPerSec * .1 + 1e-9);
      previous = f.entity.x;
      if (now > 10000) throw Error('dive did not start');
    }
    expect(f.deps.habitat.isDiveInterior(f.entity)).toBe(true);
    const point = { x: f.entity.x, y: f.entity.y };
    f.noLanes(); f.tick(now + f.config.dive.durationMs);
    f.tick(now + f.config.dive.durationMs + f.config.dive.submergedDurationMs);
    expect(f.system.getState()?.phase.kind).toBe('surfacing');
    expect({ x: f.entity.x, y: f.entity.y }).toEqual(point);
  });
  it('lurks with no warning, sinks without damage and repositions only after the delay', () => {
    const f = setup(); f.config.tentacles.maxConcurrent = 1;
    f.deps.intent.readTarget = () => null; f.dive();
    const part = f.system.getState()!.tentacles[0];
    f.tick(part.hoverAt); expect(f.system.getState()!.tentacles[0]).toMatchObject({ phase: 'hover', claw: { attack: null } });
    f.tick(part.retractAt);
    expect(f.system.getState()!.tentacles[0]).toMatchObject({ phase: 'retract', claw: { attack: null } });
    expect(part.endsAt - part.retractAt).toBe(f.config.tentacles.sinkMs);
    f.tick(part.endsAt); expect(f.system.getState()!.tentacles).toEqual([]);
    f.tick(part.endsAt + f.config.tentacles.repositionDelayMs - 1); expect(f.system.getState()!.tentacles).toEqual([]);
    f.tick(part.endsAt + f.config.tentacles.repositionDelayMs);
    expect(f.system.getState()!.tentacles[0].contact.identity.partId).not.toBe(part.contact.identity.partId);
    expect(f.deps.combat.resolveAreaAttack).not.toHaveBeenCalled();
  });
  it('turns a lurking arm smoothly onto a reachable diagonal target before a full warning', () => {
    const f = setup(); f.config.tentacles.maxConcurrent = 1; f.dive();
    const part = f.system.getState()!.tentacles[0]; f.tick(part.hoverAt);
    expect(f.system.getState()!.tentacles[0].claw.attack).toBeNull();
    f.deps.intent.readTarget = () => ({ target: boss, x: part.contact.x + 100, y: part.contact.y + 100 });
    let at = part.hoverAt, armed = f.system.getState()!.tentacles[0], previous = armed.contact.angle;
    const maxStep = f.config.tentacles.aimTurnRateDegPerSec * Math.PI / 180 * .016 + 1e-9;
    while (!armed.claw.attack && at < part.hoverAt + 3000) {
      f.tick(at += 16); armed = f.system.getState()!.tentacles[0];
      if (!armed.claw.attack) expect(Math.abs(armed.contact.angle - previous)).toBeLessThanOrEqual(maxStep);
      previous = armed.contact.angle;
    }
    const attack = armed.claw.attack!;
    expect(attack.startedAt).toBeGreaterThanOrEqual(part.hoverAt + f.config.tentacles.firstStrikeDelayMs);
    expect(attack.strikeAt - attack.startedAt).toBe(f.config.tentacles.windupMs);
    expect(armed.contact.angle).toBeCloseTo(Math.PI / 4);
    f.tick(attack.hitAt); f.tick(attack.hitAt);
    expect(f.deps.combat.resolveAreaAttack).toHaveBeenCalledOnce();
  });
  it('lets an arm strike again after lifting back up, then retreat after its last strike', () => {
    const f = setup(); f.config.tentacles.maxConcurrent = 1; f.config.tentacles.maxStrikes = 2; f.dive();
    const part = f.system.getState()!.tentacles[0];
    f.deps.intent.readTarget = () => ({ target: boss, x: part.contact.x + 150, y: part.contact.y });
    const strikes: string[] = [];
    let at = part.hoverAt, state = f.system.getState()!.tentacles[0];
    while (at < part.hoverAt + 12000 && f.system.getState()!.tentacles.length) {
      f.tick(at += 16); state = f.system.getState()!.tentacles[0] ?? state;
      const attack = state.claw.attack;
      if (attack && !strikes.includes(attack.attackId)) strikes.push(attack.attackId);
      if (state.phase === 'retract') break;
    }
    expect(strikes).toHaveLength(2);
    expect(state.phase).toBe('retract');
  });
  it('releases six homing spines once under reentrancy, regrows them and respects cooldown', () => {
    const f = setup(); f.config.spines.cooldownMs = 10000;
    f.deps.intent.readTarget = () => ({ target: boss, x: f.config.spines.range - 1, y: 0 });
    f.tick(f.config.firstAttackDelayMs);
    const action = f.system.getState()!.bodyAction!; if (action.kind !== 'spines') throw Error('no spines');
    expect(action.raiseAt).toBe(action.startedAt + f.config.spines.raiseMs);
    let now = action.releaseAt[0];
    vi.mocked(f.deps.projectiles.spawnProjectile).mockImplementation(() => { f.system.hostUpdateActions(now); return 1; });
    for (let i = 0; i < action.releaseAt.length; i++) {
      now = action.releaseAt[i]; f.tick(now); f.tick(now);
      expect(f.deps.projectiles.spawnProjectile).toHaveBeenCalledTimes(i + 1);
      const spine = f.system.getState()!.spines[i];
      expect(spine).toMatchObject({ index: i, firedAt: now, regrowStartsAt: now + f.config.spines.regrowDelayMs,
        readyAt: now + f.config.spines.regrowDelayMs + f.config.spines.regrowMs });
      const request = vi.mocked(f.deps.projectiles.spawnProjectile).mock.calls[i][0];
      expect(request.origin.x).toBe(f.config.spines.originOffsets[i].x);
      expect(request.flight.homing?.maxTurnDegreesPerSecond).toBe(f.config.spines.turnRateDegPerSec);
      expect(request.provenance.weaponSourceId).toBe('kraken_spine');
      expect(request.interaction.directHit?.damage).toBe(f.config.spines.damage);
    }
    const readyAt = f.system.getState()!.spines.at(-1)!.readyAt;
    f.tick(action.endsAt); f.entity.stunned = true; f.tick(readyAt);
    expect(f.system.getState()!.spines).toEqual([]);
    f.entity.stunned = false; f.tick(readyAt + 1);
    expect(f.system.getState()!.bodyAction?.kind).not.toBe('spines');
    f.entity.stunned = true; f.tick(readyAt + 2); f.entity.stunned = false;
    f.tick(action.startedAt + f.config.spines.cooldownMs);
    expect(f.system.getState()!.bodyAction?.kind).toBe('spines');
  });
  it('holds facing through overlap and hysteresis, then turns at the authored land rate', () => {
    const f = setup(); f.entity.hp = 40; f.tick(1);
    const exit = f.system.getState()!.phase; if (exit.kind !== 'ashore') throw Error();
    f.tick(exit.recoveryEndsAt); f.entity.angle = .4;
    let x = f.entity.x + 1;
    f.deps.intent.readTarget = () => ({ target: boss, x, y: f.entity.y });
    for (let i = 1; i < 10; i++) { x = f.entity.x + (i % 2 ? -1 : 1); f.tick(exit.recoveryEndsAt + i * 16); expect(f.entity.angle).toBe(.4); }
    x = f.entity.x - f.config.bodyRadiusPx * 1.1; f.tick(exit.recoveryEndsAt + 160); expect(f.entity.angle).toBe(.4);
    x = f.entity.x - f.config.bodyRadiusPx * 2; f.tick(exit.recoveryEndsAt + 176);
    expect(f.entity.angle).toBeGreaterThan(.4);
    expect(f.entity.angle - .4).toBeLessThanOrEqual(f.config.landTurnRateDegPerSec * Math.PI / 180 * .016 + 1e-9);
  });
  it('reaches the shore before grip even when an authored corridor starts behind the swimming body', () => {
    const coarse = setup(), fine = setup();
    for (const f of [coarse, fine]) {
      f.entity.x = 100; f.system.start(boss, 'pond', 0, 0);
      f.deps.canMove = (_from, to, mode) => mode !== 'water-approach' || to.x < 220;
      f.entity.hp = 40; f.tick(1);
    }
    const p = coarse.system.getState()!.phase; if (p.kind !== 'ashore') throw Error();
    expect(p.gripAt - p.moveAt).toBeGreaterThan(coarse.config.exit.gripAfterMs);
    for (let t = 17; t < p.gripAt; t += 17) fine.tick(t);
    fine.tick(p.gripAt); coarse.tick(p.gripAt);
    expect(coarse.entity.x).toBeCloseTo(220 - coarse.config.waterShoreDistancePx, 1);
    expect(fine.entity.x).toBeCloseTo(coarse.entity.x, 6);
    const grip = coarse.entity.x;
    coarse.tick(p.gripAt + coarse.config.exit.gripHoldMs);
    expect(coarse.entity.x).toBeCloseTo(grip, 6);
    coarse.tick(p.recoveryEndsAt);
    expect(coarse.entity.x).toBeCloseTo(300, 6);
    expect(coarse.system.getState()?.phase.kind).toBe('land');
  });
  it('completes a diagonal exit at 60 Hz despite subpixel distance roundoff', () => {
    const f = setup();
    const path = [{ x: 1136, y: 720 }, { x: 1392, y: 1008 }, { x: 1392, y: 1264 }];
    Object.assign(f.entity, path[0]); f.system.start(boss, 'pond', 0, 0);
    f.deps.habitat.reserveExit = () => ({ status: 'valid', value: {
      reservationId: 'diagonal', topologyRevision: 1, corridorId: 'south', widthPx: 160, path } });
    f.entity.hp = 40; f.tick(1);
    const phase = f.system.getState()!.phase; if (phase.kind !== 'ashore') throw Error();
    for (let frame = 1; frame * 1000 / 60 <= phase.recoveryEndsAt + 1000; frame++) f.tick(Math.floor(frame * 1000 / 60));
    expect(f.system.getState()?.phase.kind).toBe('land');
    expect(f.entity.x).toBeCloseTo(1392, 6); expect(f.entity.y).toBeCloseTo(1264, 6);
  });
  it('finishes an egg volley across half HP without retiring landed eggs or flights', () => {
    const f = setup(); f.tick(f.config.firstAttackDelayMs);
    const ink = f.system.getBodyClaw().attack!; f.tick(ink.endsAt); f.tick(ink.endsAt + f.config.actionPauseMs);
    const cast = f.system.getState()!.bodyAction!; if (cast.kind !== 'eggs') throw Error();
    f.tick(cast.releaseAt); f.entity.hp = 40;
    for (let i = 1; i < f.config.eggs.volleyCount; i++) f.tick(cast.releaseAt + i * f.config.eggs.releaseSpacingMs);
    expect(f.deps.projectiles.spawnProjectile).toHaveBeenCalledTimes(f.config.eggs.volleyCount);
    expect(f.deps.brood.retireBossEggs).not.toHaveBeenCalled(); expect(f.deps.brood.cancelEgg).not.toHaveBeenCalled();
    expect(f.deps.brood.clearBoss).not.toHaveBeenCalled();
    f.tick(cast.endsAt); f.tick(cast.endsAt + 1); expect(f.system.getState()!.phase.kind).toBe('ashore');
    f.entity.alive = false; f.tick(cast.endsAt + 2); expect(f.deps.brood.clearBoss).toHaveBeenCalledOnce();
  });

  it('samples the same marker curve with coarse and fine host steps, holding at grip', () => {
    const coarse = setup(), fine = setup();
    for (const f of [coarse, fine]) { f.entity.hp = 40; f.tick(1); }
    const p = coarse.system.getState()!.phase; if (p.kind !== 'ashore') throw Error();
    const at = p.heaveAt + (p.endsAt - p.heaveAt) / 2;
    for (let t = 17; t < at; t += 17) fine.tick(t);
    fine.tick(at); coarse.tick(at);
    expect(coarse.entity.x).toBeCloseTo(fine.entity.x, 8);
    expect(coarse.entity.x / 300).toBeCloseTo(krakenExitDistance(p, at, coarse.config.exit), 8);
    expect(krakenExitDistance(p, p.gripAt, coarse.config.exit)).toBe(krakenExitDistance(p, p.gripAt + coarse.config.exit.gripHoldMs, coarse.config.exit));
    expect(krakenExitDistance(p, p.endsAt, coarse.config.exit)).toBe(1);
  });

  it('sweeps a land lunge, freezes the lane and commits only once at impact', () => {
    const f = setup(); f.entity.hp = 40; f.tick(1);
    const p = f.system.getState()!.phase; if (p.kind !== 'ashore') throw Error();
    f.tick(p.recoveryEndsAt); f.tick(p.recoveryEndsAt + f.config.actionPauseMs);
    const attack = f.system.getBodyClaw().attack!; expect(attack.presentation).toBe('slam');
    const start = f.entity.x, wall = start + f.config.slam.lungeDistancePx / 2;
    f.deps.canMove = (_from, to, mode) => mode !== 'land' || to.x <= wall;
    f.deps.intent.readTarget = () => ({ target: boss, x: -500, y: 700 });
    f.tick(attack.strikeAt); expect(f.entity.x).toBe(start);
    f.tick(attack.hitAt - 1); expect(f.entity.x).toBeGreaterThan(start); expect(f.entity.x).toBeLessThanOrEqual(wall);
    expect(f.deps.combat.resolveAreaAttack).not.toHaveBeenCalled();
    f.tick(attack.hitAt); f.tick(attack.hitAt);
    expect(f.entity.x).toBeLessThanOrEqual(wall); expect(f.system.getBodyClaw().attack!.pose).toEqual(attack.pose);
    expect(f.deps.combat.resolveAreaAttack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.deps.combat.resolveAreaAttack).mock.calls[0][0].claw.attack.pose).toEqual(attack.pose);
  });

  it('waits for camera return, freezes ink geometry and commits each impact once under reentrancy', () => {
    const f = setup(); f.system.clear(); f.system.start(boss, 'pond', 1, 100, 0);
    f.tick(99); expect(f.system.getState()?.bodyAction).toBeNull();
    f.tick(100 + f.config.firstAttackDelayMs);
    const attack = f.system.getBodyClaw().attack!;
    expect(attack.presentation).toBe('ink');
    f.entity.x = 50;
    vi.mocked(f.deps.combat.resolveAreaAttack).mockImplementation(() => { f.system.hostUpdateActions(attack.hitAt); return {} as never; });
    f.tick(attack.hitAt);
    expect(f.deps.combat.resolveAreaAttack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.deps.combat.resolveAreaAttack).mock.calls[0][0].claw.attack.pose).toEqual(attack.pose);
    expect(f.system.getState()?.inkClouds).toHaveLength(1);
  });

  it('alternates ink and six staggered egg releases without direct damage', () => {
    const f = setup(); f.tick(f.config.firstAttackDelayMs);
    const ink = f.system.getBodyClaw().attack!; f.tick(ink.endsAt);
    f.tick(ink.endsAt + f.config.actionPauseMs);
    const cast = f.system.getState()!.bodyAction!;
    expect(cast.kind).toBe('eggs'); if (cast.kind !== 'eggs') throw Error();
    for (let i = 0; i < f.config.eggs.volleyCount; i++) {
      f.tick(cast.releaseAt + i * f.config.eggs.releaseSpacingMs);
      expect(f.deps.projectiles.spawnProjectile).toHaveBeenCalledTimes(i + 1);
    }
    f.tick(cast.endsAt + 1);
    expect(f.deps.projectiles.spawnProjectile).toHaveBeenCalledTimes(f.config.eggs.volleyCount);
    for (const [request] of vi.mocked(f.deps.projectiles.spawnProjectile).mock.calls) {
      expect(request.interaction.directHit).toBeUndefined(); expect(request.interaction.explosion).toBeUndefined();
      expect(request.interaction.grenadeEffect?.type).toBe('kraken_egg_land');
      expect(request.presentation).toMatchObject({ style: 'grenade', grenadePreset: f.config.eggs.presentationPreset });
    }
  });

  it('swims explicitly before ordinary movement, at bounded speed', () => {
    const f = setup(); f.deps.habitat.wanderPoint = () => ({ x: 200, y: 0 });
    f.system.preMovement(100, 100);
    expect(f.entity.x).toBeCloseTo(f.config.waterWander.speedPxPerSec / 10);
    expect(f.system.getState()?.movement).toBe('water-approach');
  });

  it('keeps delayed throws staggered after a long host step and cancels unreleased eggs on death', () => {
    const f = setup(); f.tick(f.config.firstAttackDelayMs);
    const ink = f.system.getBodyClaw().attack!; f.tick(ink.endsAt); f.tick(ink.endsAt + f.config.actionPauseMs);
    const cast = f.system.getState()!.bodyAction!; if (cast.kind !== 'eggs') throw Error();
    f.tick(cast.endsAt + 5000);
    expect(f.deps.projectiles.spawnProjectile).toHaveBeenCalledTimes(1);
    f.entity.alive = false; f.tick(cast.endsAt + 5001);
    expect(f.deps.brood.cancelEgg).toHaveBeenCalledTimes(f.config.eggs.volleyCount - 1);
    expect(f.deps.projectiles.spawnProjectile).toHaveBeenCalledTimes(1);
  });

  it('waits safely on blocked exits and resumes instead of teleporting through obstacles', () => {
    const f = setup(); f.entity.hp = 40; f.tick(1);
    const phase = f.system.getState()!.phase; if (phase.kind !== 'ashore') throw Error();
    f.deps.habitat.revalidateExit = () => ({ status: 'pending', reason: 'navigation' });
    f.tick(phase.endsAt + 10); expect(f.entity.x).toBe(0);
    expect(f.system.getState()?.phase).toMatchObject({ kind: 'ashore', blocked: true });
    f.deps.habitat.revalidateExit = r => ({ status: 'valid', value: r });
    f.tick(phase.endsAt + 110); expect(f.entity.x).toBeGreaterThan(0); expect(f.entity.x).toBeLessThan(300);
  });

  it('keeps multiple targetable part slots independent; stun retracts only that part', () => {
    const f = setup(); f.deps.intent.readTarget = () => ({ target: boss, x: 200, y: 80 }); f.dive();
    const submergedAt = f.config.dive.intervalMs + f.config.dive.durationMs;
    // Arms surface staggered and each turns onto the target before striking; wait until all strike at once.
    let at = submergedAt;
    for (; at < submergedAt + 8000; at += 16) {
      f.tick(at);
      const s = f.system.getState()!;
      if (s.tentacles.length === f.config.tentacles.maxConcurrent && s.tentacles.every(p => p.claw.attack && at < p.claw.attack.endsAt)) break;
    }
    const state = f.system.getState()!;
    expect(state.phase.kind).toBe('submerged'); expect(state.bodyTargetability.mode).toBe('hidden');
    expect(state.tentacles).toHaveLength(f.config.tentacles.maxConcurrent);
    const part = state.tentacles[0];
    expect(f.system.contacts.getContacts(at)).toHaveLength(state.tentacles.length);
    f.system.contacts.applyPartStatus(part.contact.identity, 'stun', part.endsAt);
    const next = f.system.getState()!;
    expect(next.tentacles[0].claw.attack).toBeNull();
    expect(next.tentacles.slice(1).every(p => p.claw.attack)).toBe(true);
    expect(f.system.contacts.resolveContact({ ...part.contact.identity, cycleId: 999 }, part.contact.contactId, part.contact.targetableFrom)).toBeNull();
  });

  it.each(['surfaced', 'diving', 'submerged', 'surfacing'] as const)('transitions from %s at half HP without an HP clamp', phase => {
    const f = setup();
    if (phase !== 'surfaced') f.tick(f.config.dive.intervalMs);
    if (phase === 'submerged' || phase === 'surfacing') f.tick(f.config.dive.intervalMs + f.config.dive.durationMs);
    if (phase === 'surfacing') {
      f.noLanes();
      f.tick(f.config.dive.intervalMs + f.config.dive.durationMs + f.config.dive.submergedDurationMs + 5000);
    }
    expect(f.system.getState()?.phase.kind).toBe(phase);
    f.entity.hp = 20;
    let t = f.publications.at(-1)!.phase.kind === 'surfaced' ? 1 : f.config.dive.intervalMs + f.config.dive.durationMs + f.config.dive.submergedDurationMs + 5001;
    // Advance bounded simulation steps until the authored exit/recovery completes.
    for (let i = 0; i < 80 && f.system.getState()?.phase.kind !== 'land'; i++, t += 250) f.tick(t);
    expect(f.entity.hp).toBe(20); expect(f.system.getState()?.phase.kind).toBe('land');
    expect(f.system.getState()?.tentacles).toEqual([]);
  });

  it('surfaces after the bounded underwater window even without any valid shore', () => {
    const f = setup(); f.noLanes(); f.dive();
    f.tick(f.config.dive.intervalMs + f.config.dive.durationMs + f.config.dive.submergedDurationMs);
    expect(f.system.getState()?.phase.kind).toBe('surfacing');
  });

  it('death through a part immediately invalidates remaining contacts, cancels brood and waits for its terminal anchor', () => {
    const f = setup(); f.dive(); const part = f.system.getState()!.tentacles[0];
    f.entity.hp = 0; f.entity.alive = false;
    expect(f.system.contacts.getContacts(part.contact.targetableFrom)).toEqual([]);
    f.tick(part.contact.targetableFrom);
    const death = f.system.getState()!.phase; expect(death.kind).toBe('dying'); if (death.kind !== 'dying') throw Error();
    expect(death.submerged).toBe(true); expect(f.deps.brood.clearBoss).toHaveBeenCalled();
    expect(f.system.isDefeatComplete()).toBe(false); f.tick(death.endsAt);
    expect(f.system.isDefeatComplete()).toBe(true);
    f.system.clear(); expect(f.system.getState()).toBeNull();
  });
});
