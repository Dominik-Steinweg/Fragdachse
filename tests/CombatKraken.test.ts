import { describe, expect, it, vi } from 'vitest';
import { fakeEntity } from './fakeEntity';

vi.mock('phaser', () => {
  class Line { constructor(public x1 = 0, public y1 = 0, public x2 = 0, public y2 = 0) {}
    setTo(x1: number, y1: number, x2: number, y2: number) { Object.assign(this, { x1, y1, x2, y2 }); return this; } }
  class Rectangle { constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
    setTo(x: number, y: number, width: number, height: number) { Object.assign(this, { x, y, width, height }); return this; } }
  return { Geom: { Line: Object.assign(Line, { Length: (l: Line) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) }),
    Rectangle, Circle: class {}, Intersects: { GetLineToCircle: () => [], GetLineToRectangle: () => [] } },
    Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
      Distance: { Between: (x: number, y: number, a: number, b: number) => Math.hypot(a - x, b - y) } } };
});

import { WorldCombatCore } from '../src/combat/WorldCombatCore';
import { CombatGeometry } from '../src/systems/CombatGeometry';
import { CombatProjectileQueryAdapter } from '../src/combat/CombatProjectileQueryAdapter';
import type { BossTargetRef, CombatPartContactSnapshot } from '../src/combat/CombatPartContact';
import type { CombatAreaAttackRequest } from '../src/combat/CombatAreaAttack';
import type { TargetDamageMutationRequest } from '../src/combat/CombatMutation';
import type { ProjectileDirectImpactRequest } from '../src/projectile/ProjectileCombatPort';
import { WorldWeaponExecutionRuntime } from '../src/world/WorldWeaponExecutionRuntime';

const boss: BossTargetRef = { kind: 'enemy', id: 'boss', scope: { worldRevision: 1, runtimeGeneration: 1 },
  instance: { entityGeneration: 1, activityRevision: 1 } };
function contact(partId: string, x: number, y = 0): CombatPartContactSnapshot {
  return { contact: { identity: { boss, partId, partGeneration: 1, cycleId: 1 }, contactId: `${partId}:exposed`,
    hitboxProfileId: 'arm', x, y, angle: 0, targetableFrom: 0, targetableUntil: 5000 },
    shapes: [{ kind: 'capsule', fromX: 0, fromY: 0, toX: 40, toY: 0, radius: 10 }] };
}
function fixture() {
  let hp = 1000, visible = false, now = 1000, generation = 1;
  const parts = [contact('far', 120), contact('near', 40)];
  const player = fakeEntity({ id: 'player', x: 0, y: 60, active: true, body: { enable: true } });
  const enemy = fakeEntity({ id: boss.id, x: 500, y: 500, active: true, faction: 'hostile',
    isBurrowed: () => false, isBoss: () => true, getHp: () => hp, getMaxHp: () => 1000, getKnockbackFactor: () => 1 });
  const state = () => ({ kind: 'combatant' as const, hp, maxHp: 1000, armor: 0, maxArmor: 0, alive: hp > 0 });
  const commitDamage = vi.fn((request: TargetDamageMutationRequest) => {
    const actualDamage = Math.min(hp, request.damage.amount); hp -= actualDamage;
    return { kind: 'damage-applied', ...request, actualDamage, hpLost: actualDamage, armorLost: 0,
      resultingState: state(), transition: { kind: 'none' } };
  });
  const bridge = { isHost: () => true, getPlayerProfile: (id: string) => id === 'player' ? { id } : undefined,
    areTeammates: () => false, broadcastEffect: vi.fn(), broadcastMeleeSwing: vi.fn(), broadcastHitscanTracer: vi.fn() };
  const combat = new WorldCombatCore({ getPlayer: () => player, getAllPlayers: () => [player] } as never, bridge as never);
  combat.bindHostExecutionSources({ nowMs: () => now, random: () => 0.25 });
  combat.initPlayer('player');
  combat.setEnemyManager({ getAllEnemies: () => [enemy], getEnemy: (id: string) => id === boss.id ? enemy : undefined,
    hasEnemy: (id: string) => id === boss.id && hp > 0,
    getCombatTargetRef: (id: string) => id === boss.id ? { ...boss, instance: { ...boss.instance, entityGeneration: generation } } : null,
    readCombatVitals: () => state(), commitDamage } as never);
  const status = vi.fn(() => true), receipt = vi.fn();
  const resolveContact = vi.fn((identity, id) => parts.find(p => p.contact.contactId === id
    && p.contact.identity.partId === identity.partId) ?? null);
  const detach = combat.bindPartContacts({ contacts: { getContacts: () => parts, resolveContact },
    status: { applyPartStatus: status }, isBodyTargetable: () => visible,
    policy: { damageMultiplier: 1, ownHp: false, severable: false, deduplication: 'event-boss-max',
      status: 'contact-only', hiddenBodyDot: 'suppress-ticks-keep-expiry' }, onHit: receipt });
  vi.spyOn(combat, 'hasLineOfSight').mockReturnValue(true);
  return { combat, parts, commitDamage, bridge, status, receipt, detach, resolveContact,
    hp: () => hp, setHp: (v: number) => { hp = v; }, setVisible: (v: boolean) => { visible = v; },
    setNow: (v: number) => { now = v; }, replaceBoss: () => { generation++; }, player };
}
function projectile(id: string, projectileId = 1): ProjectileDirectImpactRequest {
  return { projectileId, target: { kind: 'enemy', id }, impact: { x: 30, y: 0 }, velocity: { x: 1, y: 0 },
    provenance: { gameplaySourceId: 'player', attributionId: 'player', allegiance: { ownerId: 'player', kind: 'player' },
      sourceSlot: 'weapon1', weaponSourceId: 'test' }, directHit: { damage: 10 }, augments: [] };
}
function area(geometry: CombatAreaAttackRequest['claw']['attack']['pose']['geometry']): CombatAreaAttackRequest {
  return { nowMs: 1000, damage: 10, targetPolicy: 'hostile-combatants',
    source: { actor: { kind: 'enemy', id: boss.id }, gameplaySource: { kind: 'enemy', id: boss.id },
      attribution: { kind: 'enemy', id: boss.id }, allegiance: { ownerId: boss.id, kind: 'enemy', factionId: 'hostile' }, origin: 'direct' },
    claw: { worldRevision: 1, activityRevision: 1, enemyId: boss.id, entityGeneration: 1,
      revision: 1, slot: { kind: 'body' }, attack: { attackId: 'attack', weaponId: 'ink',
        pose: { originX: 0, originY: 0, angle: Math.PI / 2, geometry },
        presentation: geometry.kind === 'lane' ? 'slam' : 'ink', startedAt: 0, strikeAt: 50, hitAt: 100, endsAt: 1200 } } };
}

describe('Combat area geometry', () => {
  it('uses exact rotated circle/rectangle corners and retains melee sector center-angle semantics', () => {
    const pose = { originX: 10, originY: 20, angle: Math.PI / 2, geometry: { kind: 'lane' as const, length: 80, width: 20 } };
    expect(CombatGeometry.areaContainsCircle(pose, -3, 104, 5)).toBe(true);
    expect(CombatGeometry.areaContainsCircle(pose, -4, 104, 5)).toBe(false);
    expect(CombatGeometry.areaContainsCircle(pose, 10, 15, 5)).toBe(true);
    const sector = { originX: 0, originY: 0, angle: 0, geometry: { kind: 'sector' as const, range: 80, arcDegrees: 60 } };
    expect(CombatGeometry.areaContainsCircle(sector, 85, 0, 5)).toBe(true);
    expect(CombatGeometry.areaContainsCircle(sector, 20, 20, 20)).toBe(false);
  });
  it.each([{ kind: 'lane' as const, length: 80, width: 20 }, { kind: 'sector' as const, range: 80, arcDegrees: 60 }])(
    'resolves host area once with the exact addressed confirmation: %j', geometry => {
      const f = fixture(), request = area(geometry), hp = f.combat.getHP('player');
      const execution = new WorldWeaponExecutionRuntime({ combatSystem: f.combat, areaAttacks: f.combat, projectileSpawn: { spawnProjectile: () => null } as never });
      expect(execution.resolveAreaAttack(request).accepted).toBe(true);
      expect(f.combat.getHP('player')).toBe(hp - request.damage);
      expect(execution.resolveAreaAttack(request).accepted).toBe(false);
      expect(f.bridge.broadcastMeleeSwing).toHaveBeenCalledTimes(1);
      expect(f.bridge.broadcastMeleeSwing.mock.calls[0][0]).toMatchObject({ areaClaw: request.claw });
      expect(f.commitDamage).not.toHaveBeenCalled();
    });
});

describe('physical Kraken contacts and canonical damage', () => {
  it('retains one Plasma reaction at the part and rejects a reentrant duplicate before reactions', () => {
    const f = fixture(), part = f.combat.readPartTargets()[1];
    const registerDirectContact = vi.fn(() => ({ shouldProc: true }));
    f.combat.setPlasmaSwarmMechanicPort({ registerDirectContact } as never);
    const request = { ...projectile(part.id), directHit: { damage: 10, plasmaSwarm: { projectileCount: 4 } } };
    const spawn = vi.fn(() => { expect(f.combat.resolveDirectImpact(request).accepted).toBe(false); });
    f.combat.setPlasmaSwarmReactionHandler(spawn);
    expect(f.combat.resolveDirectImpact(request).accepted).toBe(true);
    expect(registerDirectContact).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ enemyId: boss.id, x: request.impact.x, y: request.impact.y }));
    expect(f.commitDamage).toHaveBeenCalledTimes(1);
  });
  it('hits exposed parts with hitscan and melee while chain returns cannot multiply the boss hit', () => {
    const f = fixture();
    f.player.y = 100;
    const melee = { shooterId: 'player', x: 0, y: 0, angle: 0, range: 200, arcDegrees: 90,
      damage: 10, adrenalinGain: 0, sourceId: 'test', color: 0xffffff,
      rockDamageMult: 0, trainDamageMult: 0, baseDamageMult: 0,
      damageTargets: ['enemies' as const], chain: { count: 5, radius: 300, damageFactor: 1 } };
    expect(f.combat.resolveImmediateAttack({ kind: 'melee', payload: melee, origin: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, range: 200 }).accepted).toBe(true);
    expect(f.commitDamage).toHaveBeenCalledTimes(1);
    const trace = f.combat.traceHitscan({ shooterId: 'player', startX: 0, startY: 0, angle: 0,
      range: 300, traceThickness: 0, applyFavorTheShooter: false });
    expect(trace.distance).toBe(30);
    expect(trace.hitEnemyId).toContain('combat-part:');
    const hitscan = { shooterId: 'player', startX: 0, startY: 0, angle: 0, range: 300,
      damage: 10, traceThickness: 0, color: 0xffffff, adrenalinGain: 0, sourceId: 'test',
      chainLightning: { maxJumps: 5, searchRadius: 400, damageFalloffPerJump: 0, targetEnemies: true } };
    f.combat.resolveImmediateAttack({ kind: 'hitscan', payload: hitscan, origin: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, range: 300 });
    expect(f.commitDamage).toHaveBeenCalledTimes(2);
  });

  it('homing chooses physical exposed contact positions and drops them at expiry', () => {
    const f = fixture();
    const adapter = new CombatProjectileQueryAdapter(f.combat, { queryTargets: (_c, _o, _x, _y, _r, emit) => emit('boss', 'enemies', 500, 500) });
    const emit = vi.fn(), config = { targetTypes: ['enemies' as const] } as never;
    adapter.queryTargets(config, 'player', 0, 0, 200, emit);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.every(c => c[0] !== boss.id)).toBe(true);
    const id = emit.mock.calls[1][0];
    expect(adapter.readTargetPosition(config, 'player', id, 'enemies', 0, 0)).toMatchObject({ x: 30, y: 0 });
    f.setNow(5000);
    expect(adapter.readTargetPosition(config, 'player', id, 'enemies', 0, 0)).toBeNull();
  });

  it('suppresses hidden body burn ticks while expiry advances and restores only future visible ticks', () => {
    const f = fixture(); f.setVisible(true);
    f.combat.applyBurnHit(boss.id, 'player', 1000, 3, 'burn', 'test');
    f.setVisible(false); f.setNow(1250); f.combat.updateBurnEffects(1250);
    expect(f.commitDamage).not.toHaveBeenCalled();
    f.setVisible(true); f.setNow(1500); f.combat.updateBurnEffects(1500);
    expect(f.commitDamage).toHaveBeenCalledTimes(1);
    f.setVisible(false); f.setNow(2500); f.combat.updateBurnEffects(2500);
    f.setVisible(true); f.setNow(2750); f.combat.updateBurnEffects(2750);
    expect(f.commitDamage).toHaveBeenCalledTimes(1);
  });
  it('queries exposed shapes, excludes hidden body and rejects envelope-only capsule hits', () => {
    const f = fixture(), adapter = new CombatProjectileQueryAdapter(f.combat), targets: string[] = [];
    adapter.readCollisionTargets((_kind, id) => { targets.push(String(id)); });
    expect(targets).not.toContain(boss.id);
    const part = f.combat.readPartTargets()[1];
    expect(adapter.getWorldTargetHit({ kind: 'enemy', id: part.id }, 0, 0, 100, 0, 0, 0)).toMatchObject({ distance: 30 });
    expect(adapter.getWorldTargetHit({ kind: 'enemy', id: part.id }, 0, 11, 100, 11, 0, 0)).toBeNull();
    expect(f.combat.resolveDirectImpact(projectile(boss.id)).accepted).toBe(false);
    f.replaceBoss();
    expect(adapter.getWorldTargetHit({ kind: 'enemy', id: part.id }, 0, 0, 100, 0, 0, 0)).toBeNull();
  });
  it('transfers once per projectile/boss, resolves factors once, and keeps feedback/status at the part', () => {
    const f = fixture(), [far, near] = f.combat.readPartTargets();
    const outgoing = vi.fn((_a, _b, amount: number) => ({ amount: amount * 3, isCritical: false }));
    f.combat.setPlayerOutgoingDamageResolver(outgoing);
    f.combat.setEnemyIncomingDamageMultiplierResolver(() => 0.5);
    const request = { ...projectile(near.id), directHit: { damage: 20,
      appliedSourceDamageFactors: [{ kind: 'runtime-power' as const, multiplier: 2, resolvedAt: 'execution' as const }],
      stunDurationMs: 300, slowFraction: 0.5, slowDurationMs: 400 } };
    expect(f.combat.resolveDirectImpact(request)).toMatchObject({ accepted: true, actualDamage: 30 });
    expect(f.combat.resolveDirectImpact({ ...request, target: { kind: 'enemy', id: far.id } }).accepted).toBe(false);
    expect(f.commitDamage).toHaveBeenCalledTimes(1); expect(outgoing).toHaveBeenCalledTimes(1);
    expect(f.commitDamage.mock.calls[0][0].target).toEqual(boss);
    expect(f.receipt).toHaveBeenCalledTimes(1);
    expect(f.receipt.mock.calls[0][0]).toMatchObject({ part: near.snapshot.contact.identity, x: 30, y: 0 });
    expect(f.status).toHaveBeenCalledWith(near.snapshot.contact.identity, 'stun', 1300);
    expect(f.status).toHaveBeenCalledWith(near.snapshot.contact.identity, 'slow', 1400);
    expect(f.combat.resolveDirectImpact(projectile(near.id, 2)).accepted).toBe(true);
    expect(f.commitDamage).toHaveBeenCalledTimes(2);
  });
  it('chooses the greatest valid AoE contribution regardless of part order and suppresses center damage', () => {
    const f = fixture();
    f.combat.applyExplosionDamage(0, 0, { radius: 200, maxDamage: 100, minDamage: 0, damageTarget: 'enemies' } as never, 'player');
    expect(f.commitDamage).toHaveBeenCalledTimes(1);
    expect(f.receipt.mock.calls[0][0].part.partId).toBe('near');
    f.parts.reverse();
    f.combat.applyExplosionDamage(0, 0, { radius: 200, maxDamage: 100, minDamage: 0, damageTarget: 'enemies' } as never, 'player');
    expect(f.commitDamage.mock.calls[0][0].damage.amount).toBe(f.commitDamage.mock.calls[1][0].damage.amount);
  });
  it('revalidates exposure, blockers, boss life and detach without consuming the shot', () => {
    const f = fixture(), part = f.combat.readPartTargets()[0];
    f.setNow(5000); expect(f.combat.resolveDirectImpact(projectile(part.id)).accepted).toBe(false);
    f.setNow(1000); vi.mocked(f.combat.hasLineOfSight).mockReturnValue(false);
    expect(f.combat.resolveDirectImpact(projectile(part.id)).accepted).toBe(false);
    vi.mocked(f.combat.hasLineOfSight).mockReturnValue(true); f.setHp(0);
    expect(f.combat.resolveDirectImpact(projectile(part.id)).accepted).toBe(false);
    f.setHp(1000); f.detach();
    expect(f.combat.resolveDirectImpact(projectile(part.id)).accepted).toBe(false);
    expect(f.commitDamage).not.toHaveBeenCalled();
  });
});
