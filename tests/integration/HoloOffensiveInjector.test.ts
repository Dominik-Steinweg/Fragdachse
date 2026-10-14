import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFireControlWorldFixture } from '../FireControlTestHelper';
import { holoConfig } from '../InspectorUltimatesTestHelper';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../../src/config/coopDefenseConstructions';
import { HostUpdateCoordinator } from '../../src/scenes/arena/HostUpdateCoordinator';
import { usesRageTint } from '../../src/entities/playerRageTint';
import { BlackHoleSystem } from '../../src/systems/BlackHoleSystem';
import { healthBarTestScene } from '../healthBarTestScene';

vi.mock('../../src/network/bridge', () => ({ bridge: { broadcastExplosionEffect: vi.fn(), broadcastBlackHoleEffect: vi.fn() } }));
let f: ReturnType<typeof createFireControlWorldFixture>;
afterEach(() => { f?.destroy(); vi.restoreAllMocks(); });

function fireCopy(construction: keyof typeof COOP_DEFENSE_CONSTRUCTIONS, enabled: number) {
  f = createFireControlWorldFixture(); f.add(construction); f.spawnEnemy();
  f.binding.getHoloOffensiveCapability()!.tryActivate({ playerId: 'inspector', nowMs: 1000,
    config: { ...holoConfig, injectorProjectionEnabled: enabled }, consumedRage: holoConfig.rageRequired });
  f.tick(1000 + holoConfig.materializeMs);
  const shot = f.projectile.spawn.mock.calls.map(([request]) => request).find(s => s.provenance.sourceTurretId?.startsWith('fc-holo:'))!;
  expect(shot).toBeDefined();
  f.binding.holoOffensive!.stopSpawning('inspector', 1001);
  f.tick(1000 + holoConfig.copyLifetimeMs, false);
  expect(f.binding.getFireControlSnapshot(1000 + holoConfig.copyLifetimeMs).deployments).toEqual([]);
  return shot;
}

function host() {
  const bubble = vi.fn();
  const coordinator = new HostUpdateCoordinator(healthBarTestScene().scene, {
    getWorldCombatCore: () => f.combat, hostPhysics: { applyRadialImpulse: vi.fn() },
  } as never, {} as never, {} as never, {} as never);
  coordinator.setCombatFramePort({ getCombatGameplayBinding: () => ({ systems: { timeBubble: { hostCreateBubble: bubble } } }),
    getTargetingRuntime: () => ({ systems: { energyInjector: f.injector } }) } as never);
  return { coordinator, bubble };
}

describe('frozen Holo injector effects at delayed impacts', () => {
  it('keeps rocket damage after the projection has expired', () => {
    const shot = fireCopy('rocket_turret', 1), effect = shot.interaction.explosion!;
    expect(effect).toBeDefined();
    const enemy = f.spawnEnemy(300, 300), before = enemy.getHp();
    const outcome = f.combat.resolveExplosionCombat({ x: 300, y: 300, effect, provenance: shot.provenance });
    expect(outcome.damagedTargetKeys).toContain(`enemies:${enemy.id}`);
    expect(before - enemy.getHp()).toBe(Math.round(effect.maxDamage));
    expect(shot.provenance.injectorEffect).toEqual(COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.energyInjectorEffect);
  });

  it.each([0, 1])('uses captured gravity without a live construction or injector (upgrade=%s)', enabled => {
    const shot = fireCopy('gravity_turret', enabled), effect = shot.interaction.explosion!;
    const { coordinator } = host();
    const create = vi.spyOn(BlackHoleSystem.prototype, 'create');
    coordinator.resolveProjectileExplosion({ x: 300, y: 300, effect, provenance: shot.provenance });
    const injector = COOP_DEFENSE_CONSTRUCTIONS.gravity_turret.energyInjectorEffect!;
    if (injector.type !== 'gravity_pull') throw Error('gravity');
    expect(create.mock.calls[0][2].pullStrength).toBe(effect.blackHolePullStrength! * (enabled ? injector.pullStrengthMultiplier : 1));
  });

  it.each([0, 1])('converts slow strength once and gives frozen provenance precedence over the registry (upgrade=%s)', enabled => {
    const shot = fireCopy('slow_bubble_turret', enabled), effect = shot.interaction.explosion!;
    const { coordinator, bubble } = host();
    const injector = COOP_DEFENSE_CONSTRUCTIONS.slow_bubble_turret.energyInjectorEffect!;
    if (injector.type !== 'slow_bubble') throw Error('slow bubble');
    if (enabled) vi.spyOn(f.injector, 'getEffect').mockReturnValue({ effect: { ...injector, slowStrengthMultiplier: 100 } } as never);
    coordinator.resolveProjectileExplosion({ x: 300, y: 300, effect, provenance: shot.provenance });
    const result = bubble.mock.calls[0][3], multiplier = enabled ? injector.slowStrengthMultiplier : 1;
    for (const key of ['projectileSlowFactor', 'playerSlowFactor', 'trainSlowFactor'] as const) {
      expect(result[key]).toBeCloseTo(Math.max(.05, 1 - (1 - effect.timeBubble![key]) * multiplier));
    }
  });

  it('only the active honey badger rage produces the shared host/client tint', () => {
    for (const id of ['HOLO_OFFENSIVE', 'BOMBER_SQUADRON', null, undefined]) expect(usesRageTint(true, id)).toBe(false);
    expect(usesRageTint(false, 'HONEY_BADGER_RAGE')).toBe(false);
    expect(usesRageTint(true, 'HONEY_BADGER_RAGE')).toBe(true);
  });
});
