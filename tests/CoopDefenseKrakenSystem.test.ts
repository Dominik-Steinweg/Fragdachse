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
    intent: { readTarget: () => ({ target: boss, x: 500, y: 0 }), readSecondaryTargets: () => [] },
    habitat: { reserveWaterSpawn: vi.fn(), revalidate: () => true, release: vi.fn(),
      reserveLanes: (_boss, _habitat, _targets, count) => !lanesEnabled ? [] : Array.from({ length: count }, (_, i): KrakenLaneReservation => ({
        reservationId: `lane-${++serial}`, topologyRevision: 1, shoreId: `shore-${serial}`, waterEntry: { x: 100, y: i * 200 },
        pose: { originX: 110, originY: i * 200, angle: 0, geometry: { kind: 'lane', length: config.tentacles.length, width: config.tentacles.width } } })),
      revalidateLane: () => true,
      reserveExit: () => ({ status: 'valid', value: { reservationId: 'exit', topologyRevision: 1, corridorId: 'east', widthPx: 200, path: [{ x: 0, y: 0 }, { x: 300, y: 0 }] } }),
      revalidateExit: r => ({ status: 'valid', value: r }) },
    combat: { resolveAreaAttack: vi.fn(() => ({} as never)) }, projectiles: { spawnProjectile: vi.fn(() => ++serial) },
    brood: { reserveEgg: () => true, released: vi.fn(), cancelEgg: vi.fn(), clearBoss: vi.fn(), retireBossEggs: vi.fn(), hostUpdate: vi.fn(), getEggs: () => [] } as never,
    publish: { publish: s => { if (s) { expect(readKrakenState(s)).not.toBeNull(); publications.push(s); } } },
    claw: vi.fn(), waterApproach: () => null, canMove: () => true, flightFree: () => true,
    eggLandings: (_p, _angle, count) => Array.from({ length: count }, (_, i) => ({ x: 600 + i * 50, y: i * 100 })),
    random: () => .25, diagnostic: vi.fn(),
  };
  const system = new CoopDefenseKrakenSystem(config, deps);
  system.start(boss, 'pond', 0, 0);
  const tick = (at: number) => { system.preMovement(at, at - now); now = at; system.hostUpdateActions(at); };
  const dive = () => { tick(config.dive.intervalMs); tick(config.dive.intervalMs + config.dive.durationMs); };
  return { system, deps, config, entity, tick, dive, publications, noLanes: () => { lanesEnabled = false; } };
}

describe('Kraken host owner', () => {
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
    const f = setup(); f.deps.waterApproach = () => ({ x: 200, y: 0 });
    f.system.preMovement(100, 100);
    expect(f.entity.x).toBeCloseTo(f.config.waterApproachSpeedPxPerSec / 10);
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
    const f = setup(); f.dive();
    const state = f.system.getState()!;
    expect(state.phase.kind).toBe('submerged'); expect(state.bodyTargetability.mode).toBe('hidden');
    expect(state.tentacles).toHaveLength(f.config.tentacles.maxConcurrent);
    const part = state.tentacles[0];
    f.tick(part.contact.targetableFrom);
    expect(f.system.contacts.getContacts(part.contact.targetableFrom)).toHaveLength(state.tentacles.length);
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
