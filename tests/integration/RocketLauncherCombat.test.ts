import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Geom: { Line: class {}, Rectangle: class {}, Circle: class {} },
  Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
    Distance: { Between: (x: number, y: number, tx: number, ty: number) => Math.hypot(tx-x, ty-y) } },
}));
import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { createSingleOwnerProvenance } from '../../src/projectile/ProjectileSpawnRequest';
import { resolveRocketExplosion } from '../../src/loadout/RocketLauncherConfig';
import { WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { computeProjectileExplosionDamage } from '../../src/utils/radialDamage';
import { fakeEntity } from '../fakeEntity';

function fixture() {
  let now = 1000, power = 2;
  const players = ['owner', 'ally', 'enemy'].map(id => fakeEntity({ id, x: 0, y: 0, body: { enable: true } }));
  const combat = new WorldCombatCore({ getAllPlayers: () => players, getPlayer: (id: string) => players.find(p => p.id === id) } as never,
    { isHost: () => true, areTeammates: (a: string, b: string) => a !== 'enemy' && b !== 'enemy',
      getPlayerProfile: (id: string) => players.some(p => p.id === id) ? { id } : undefined, broadcastEffect: vi.fn() } as never);
  const world = combat.bindPlayerVitalsScope({ worldRevision: 4, runtimeGeneration: 1 });
  combat.bindHostExecutionSources({ nowMs: () => now, random: () => 0.5 });
  combat.setPlayerMaxHpResolver(() => 1000);
  players.forEach(p => combat.initPlayer(p.id));
  players.forEach(p => combat.applyDamage(p.id, 500, false, p.id));
  combat.setPowerUpSystem({ getDamageMultiplier: () => power, removePlayer() {} });
  const base = WEAPON_CONFIGS.ROCKET_LAUNCHER;
  if (base.fire.type !== 'projectile') throw Error('rocket');
  const config = { ...base.rocketLauncher!, healFraction: 0.5, pressureShieldDurationMs: 3000, aftershockEnabled: 1 };
  const effect = resolveRocketExplosion({ ...base.fire.impactExplosion!, maxDamage: 40, minDamage: 8, radius: 80 }, config);
  const provenance = createSingleOwnerProvenance('owner', { weaponSourceId: 'ROCKET_LAUNCHER', sourceSlot: 'weapon2' });
  const explode = () => combat.resolveExplosionCombat({ x: 0, y: 0, effect, provenance });
  return { combat, world, players, effect, explode, setNow: (v: number) => { now = v; }, setPower: (v: number) => { power = v; } };
}

describe('Rocket combat support integration', () => {
  it('heals owner and ally from full radial source damage regardless of armor and reduction, without overheal', () => {
    const f = fixture(); f.players[1].x = 20;
    f.combat.setPlayerDamageReductionResolver(id => id === 'owner' ? 0.9 : 0.3);
    f.combat.addArmor('owner', 40); f.combat.addArmor('ally', 20);
    const ownerHP = f.combat.getHP('owner'), allyHP = f.combat.getHP('ally');
    const ownerArmor = f.combat.getArmor('owner');
    f.explode();
    expect(f.combat.getHP('owner') - ownerHP).toBeCloseTo(computeProjectileExplosionDamage(0, f.effect) * 2 * 0.5);
    expect(f.combat.getHP('ally') - allyHP).toBeCloseTo(computeProjectileExplosionDamage(20, f.effect) * 2 * 0.5);
    expect(f.combat.getArmor('owner')).toBe(ownerArmor);
    expect(f.combat.getHP('enemy')).toBeLessThan(500);
    f.combat.heal('owner', 10000); f.explode(); expect(f.combat.getHP('owner')).toBe(1000);
    expect(f.combat.getRocketSupportState('owner', 1000).rocketHealSequence).toBe(1);
    f.world.destroy();
  });

  it('freezes the main source multiplier for aftershocks and shields friends without healing them', () => {
    const f = fixture();
    const outcome = f.explode();
    const landing = outcome.resolvedEffect!.fireChunkBurst!.landingExplosion!;
    const before = f.combat.getHP('owner'), enemyBefore = f.combat.getHP('enemy');
    const source = f.combat.captureWorldDamageSource('owner', 'ROCKET_LAUNCHER', 'explosion');
    f.setPower(5); f.setNow(1200);
    f.combat.applyExplosionDamage(0, 0, landing, 'owner', 'weapon2', 'ROCKET_LAUNCHER.aftershock', source);
    expect(f.combat.getHP('owner')).toBe(before);
    expect(enemyBefore - f.combat.getHP('enemy')).toBe(Math.round(landing.maxDamage));
    expect(f.combat.getRocketSupportState('owner', 1200).pressureShieldUntil).toBe(4200);
    expect(landing).not.toHaveProperty('fireChunkBurst');
    expect(outcome.resolvedEffect!.fireChunkBurst!.burnDamagePerTick).toBe(f.effect.fireChunkBurst!.burnDamagePerTick);
    f.world.destroy();
  });

  it('adds shield reduction, preserves a longer expiry and clears it on death and world detach', () => {
    const f = fixture(); f.setPower(1); f.explode();
    f.combat.setPlayerDamageReductionResolver(() => 0.3);
    const before = f.combat.getHP('ally');
    f.combat.applyDamage('ally', 100, false, 'enemy');
    expect(before - f.combat.getHP('ally')).toBe(50);
    f.setNow(1100);
    f.combat.applyExplosionDamage(0, 0, { ...f.effect, rocketSupport: { ...f.effect.rocketSupport!, pressureShieldDurationMs: 100 } }, 'owner');
    expect(f.combat.getRocketSupportState('ally', 1100).pressureShieldUntil).toBe(4000);
    f.combat.setPlayerDamageReductionResolver(() => 0.95);
    const protectedHP = f.combat.getHP('ally'); f.combat.applyDamage('ally', 100, false, 'enemy');
    expect(f.combat.getHP('ally')).toBe(protectedHP);
    f.combat.setPlayerDamageReductionResolver(() => 0); f.combat.applyDamage('ally', 10000, false, 'enemy');
    expect(f.combat.getRocketSupportState('ally', 1200).pressureShieldUntil).toBe(0);
    f.world.destroy(); expect(f.combat.getRocketSupportState('owner', 1200).pressureShieldUntil).toBe(0);
  });
});


it('includes source-only attack bonuses in self healing and freezes them for delayed aftershocks', () => {
  const f = fixture();
  let outgoing = 1.5;
  f.combat.setPlayerOutgoingDamageResolver((owner, target, amount) => ({
    amount: owner === target ? amount : amount * outgoing, isCritical: false,
  }));
  const before = f.combat.getHP('owner');
  const effect = f.explode().resolvedEffect!;
  expect(f.combat.getHP('owner') - before).toBeCloseTo(f.effect.maxDamage * 2 * outgoing * 0.5);
  const enemyBefore = f.combat.getHP('enemy');
  const landing = effect.fireChunkBurst!.landingExplosion!;
  f.setPower(9); outgoing = 4; f.setNow(1200);
  f.combat.applyExplosionDamage(0, 0, landing, 'owner', 'weapon2');
  expect(enemyBefore - f.combat.getHP('enemy')).toBe(Math.round(landing.maxDamage));
  f.world.destroy();
});
