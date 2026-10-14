import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBomberCombatFixture, bomberConfig } from '../BomberSquadronTestHelper';
import { holoConfig } from '../InspectorUltimatesTestHelper';
import { PlayerUltimateBehaviorRuntime } from '../../src/world/PlayerUltimateBehaviorRuntime';

let f: ReturnType<typeof createBomberCombatFixture>;
afterEach(() => { f?.destroy(); vi.restoreAllMocks(); });

describe('Inspector deployment lifetime', () => {
  it.each(['resetPlayer', 'removePlayer'] as const)('ultimate %s forwards removal, whereas combat interruption leaves both deployments active', action => {
    f = createBomberCombatFixture(); const world = f.world; world.add();
    const holo = world.binding.getHoloOffensiveCapability()!, bomber = world.binding.getBomberSquadronCapability()!;
    const ultimate = new PlayerUltimateBehaviorRuntime({ gaussExecution: null } as never);
    ultimate.setHoloOffensiveCapability(holo); ultimate.setBomberSquadronCapability(bomber);
    holo.tryActivate({ playerId: 'inspector', config: holoConfig, consumedRage: holoConfig.rageRequired, nowMs: 1000 });
    bomber.tryActivate({ playerId: 'inspector', config: bomberConfig, angle: 0, nowMs: 1000 });
    ultimate.interruptCombat('inspector', 1001);
    expect(holo.isActive('inspector')).toBe(true); expect(bomber.isActive('inspector')).toBe(true);
    ultimate[action]('inspector');
    expect(holo.isActive('inspector')).toBe(false); expect(bomber.isActive('inspector')).toBe(false);
    ultimate.destroy();
  });
  it('death stops new launches but lets launched drones finish both passes', () => {
    f = createBomberCombatFixture({ secondPassEnabled: 1 }); f.activate();
    const deathAt = 1000 + f.config.launchIntervalMs / 2;
    f.binding.runtime.cancelUnlaunched('inspector', deathAt); f.setAvailable(false);
    const squadron = f.binding.runtime.getSnapshot().squadrons[0];
    const launched = squadron.anchors.filter(Boolean).length;
    expect(launched).toBeGreaterThan(0); expect(launched).toBeLessThan(f.config.droneCount);
    f.binding.advance(squadron.endsAt);
    expect(f.explode).toHaveBeenCalledTimes(launched * f.config.bombsPerPass * (1 + f.config.secondPassEnabled));
    expect(f.binding.runtime.isActive('inspector')).toBe(false);
    expect(f.binding.runtime.getSnapshot().squadrons).toEqual([]);
  });

  it.each(['removeOwner', 'clear', 'destroy'] as const)('%s cancels already dropped bombs and all future launches', action => {
    f = createBomberCombatFixture({ secondPassEnabled: 1 }); f.activate();
    const plan = f.plan(), first = Math.min(...plan.map(b => b.dropAt));
    f.binding.advance(first); expect(f.explode).not.toHaveBeenCalled();
    if (action === 'removeOwner') f.binding.runtime.removeOwner('inspector');
    else f.binding[action]();
    f.binding.advance(Math.max(...plan.map(b => b.impactAt)));
    expect(f.explode).not.toHaveBeenCalled(); expect(f.chunks).not.toHaveBeenCalled();
    expect(f.binding.runtime.getSnapshot().squadrons).toEqual([]);
  });

  it('production combat death callback stops Holo spawns and unlaunched bombers without deleting live copies', () => {
    f = createBomberCombatFixture(); const world = f.world; world.add();
    const holo = world.binding.getHoloOffensiveCapability()!, bomber = world.binding.getBomberSquadronCapability()!;
    expect(holo.tryActivate({ playerId: 'inspector', config: holoConfig, consumedRage: holoConfig.rageRequired, nowMs: 1000 }).ok).toBe(true);
    expect(bomber.tryActivate({ playerId: 'inspector', config: bomberConfig, angle: 0, nowMs: 1000 }).ok).toBe(true);
    const deathAt = 1000 + Math.min(holoConfig.spawnIntervalMs, bomberConfig.launchIntervalMs) / 2;
    world.player.body = { enable: true };
    world.combat.runHostExecution(() => world.combat.applyDamage('inspector', 100000, false), deathAt);
    expect(world.combat.isAlive('inspector')).toBe(false);
    const h = world.binding.getFireControlSnapshot(deathAt).deployments.find(d => d.kind === 'holo')!;
    expect(h).toMatchObject({ spawnUntil: deathAt });
    expect(holo.isActive('inspector')).toBe(true);
    expect(world.binding.getBomberSquadronSnapshot(deathAt).squadrons[0]).toMatchObject({ stoppedAt: deathAt });
    world.binding.advanceFireControl(1000 + holoConfig.copyLifetimeMs);
    expect(holo.isActive('inspector')).toBe(false);
  });

  it.each(['clearActivityBindings', 'destroy'] as const)('World owner %s clears both deployment capabilities', action => {
    f = createBomberCombatFixture(); const world = f.world; world.add();
    const holo = world.binding.getHoloOffensiveCapability()!, bomber = world.binding.getBomberSquadronCapability()!;
    holo.tryActivate({ playerId: 'inspector', config: holoConfig, consumedRage: holoConfig.rageRequired, nowMs: 1000 });
    bomber.tryActivate({ playerId: 'inspector', config: bomberConfig, angle: 0, nowMs: 1000 });
    world.binding[action]();
    expect(holo.isActive('inspector')).toBe(false); expect(bomber.isActive('inspector')).toBe(false);
    expect(world.binding.getFireControlSnapshot(2000).deployments).toEqual([]);
    expect(world.binding.getBomberSquadronSnapshot(2000).squadrons).toEqual([]);
  });
});
