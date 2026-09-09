import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Math: { Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)) },
}));
vi.mock('../../src/network/bridge', () => ({
  bridge: { canPlayerReceiveRoundRewards: () => true },
}));
vi.mock('../../src/world/WorldPlayerGameplayRuntime', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/world/WorldPlayerGameplayRuntime')>();
  return { ...actual, WorldPlayerGameplayRuntime: class {
    constructor(options: unknown) {
      // Omit unrelated graph construction; retain the real resource binding and host tick.
      return Object.assign(Object.create(actual.WorldPlayerGameplayRuntime.prototype), {
        options, heldActionUtilityIds: new Map(),
        systems: { burrow: { setWorldGeometryQueries() {} } },
      });
    }
  } };
});

import { composeWorldPlayerGameplay } from '../../src/scenes/arena/ArenaWorldPlayerComposition';
import { TimeBubbleSystem } from '../../src/systems/TimeBubbleSystem';
import { ResourceSystem } from '../../src/systems/ResourceSystem';
import { UTILITY_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../../src/loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals, getCoopDefenseUpgradeDefinition } from '../../src/utils/coopDefenseUpgrades';

describe('Resonance Flow through World composition and passive regeneration', () => {
  it('multiplies the existing regen path, respects pause, burrow, caps and lifetime, and never spends resonance', () => {
    const ids = ['cooldown', 'radius', 'focus', 'prism_spiral', 'resonance', 'overcharge', 'resonance_flow'];
    const upgrades = Object.fromEntries(ids.map(id => {
      const fullId = 'time_bubble_' + id;
      return [fullId, { unlocked: true, level: getCoopDefenseUpgradeDefinition(fullId)!.maxLevel }];
    }));
    upgrades.unlock_time_bubble = { unlocked: true, level: 1 };
    const config = applyCoopDefenseModifiersToUtilityConfig(UTILITY_CONFIGS.TIME_BUBBLE,
      getCoopDefenseResolvedEffectTotals({ upgrades }, 'dachs_nukem'));
    if (config.type !== 'time_bubble') throw Error('Expected TimeBubble');
    const bubbles = new TimeBubbleSystem();
    const resource = new ResourceSystem();
    const gameplay: any = { projectiles: {}, combatSystem: { isAlive: () => true, hpRegenTick() {}, armorRegenTick() {} }, combat: null };
    let burrowed = false;
    let otherMultiplier = 1;
    const player = { id: 'owner', active: true, x: 0, y: 0 };
    composeWorldPlayerGameplay({
      ctx: { decoySystem: { getStealthAdrenalineMultiplier: () => otherMultiplier },
        playerManager: { getAllPlayers: () => [player] } },
      flow: { syncHostPlayerModifiers() {}, getPlayerCapabilities: () => ({ canInteract: true }),
        getCoopMissionRuntime: () => null },
      worldRuntime: { bind() {} }, world: { metrics: {} },
    } as never, gameplay);
    const runtime = gameplay.player;
    runtime.configureResource(resource, {
      getResolvedStat: (_id: string, _stat: string, fallback: number) => fallback,
      getPercentageStat: () => 0, getNumericStat: () => 0,
    }, { getAdrenalineRegenMultiplier: () => otherMultiplier });
    Object.assign(runtime.systems, {
      resource,
      burrow: { isBurrowed: () => burrowed, isStunned: () => false, update() {} },
      heldAction: { clearExpired() {}, clearPlayer() {}, reset() {} },
      loadout: { getEquippedUtilityConfig: () => config, update() {} },
      itemRuntime: { hostUpdate() {}, updateSurroundedPlayers() {}, trackMovement: () => 0 },
      utilityAction: { update() {} }, weaponReaction: { update() {} },
      ultimateBehavior: { update() {} }, tunnel: { update() {} },
    });
    resource.initPlayer(player.id);
    const regen = (now: number, delta = 100) => {
      resource.setAdrenaline(player.id, 0);
      runtime.runHostPrePhysicsStage(delta, now, false);
      return resource.getAdrenaline(player.id);
    };
    const baseRegen = regen(1000);
    expect(baseRegen).toBeGreaterThan(0); // combat binding is installed later in the World graph
    gameplay.combat = { systems: { timeBubble: bubbles } };
    const start = 2000;
    const id = bubbles.hostCreateBubble(player.id, 0, 0, { type: 'time_bubble',
      radius: config.bubbleRadius, duration: config.bubbleDuration, chargeCapacity: config.chargeCapacity,
      resonanceRegenPerDamage: config.resonanceRegenPerDamage, playerSlowFactor: config.playerSlowFactor,
      projectileSlowFactor: config.projectileSlowFactor, trainSlowFactor: config.trainSlowFactor,
    }, start);
    expect(regen(start)).toBe(baseRegen);
    const half = config.chargeCapacity! / 2;
    bubbles.observeProjectile(1, 0, 0, half, start);
    expect(regen(start + 1)).toBeCloseTo(baseRegen * (1 + half * config.resonanceRegenPerDamage!));
    bubbles.observeProjectile(2, 0, 0, half, start + 2);
    const fullFactor = 1 + config.chargeCapacity! * config.resonanceRegenPerDamage!;
    expect(regen(start + 2)).toBeCloseTo(baseRegen * fullFactor);
    otherMultiplier = 1.5;
    expect(regen(start + 3)).toBeCloseTo(baseRegen * fullFactor * otherMultiplier ** 2);
    resource.drainAdrenaline(player.id, 1, start + 4);
    expect(regen(resource.getRegenPausedUntil(player.id) - 1)).toBe(0);
    const pauseEnd = resource.getRegenPausedUntil(player.id);
    expect(regen(pauseEnd)).toBeCloseTo(baseRegen * fullFactor * otherMultiplier ** 2);
    burrowed = true;
    expect(regen(pauseEnd + 1)).toBe(0);
    burrowed = false;
    expect(regen(pauseEnd + 2, 100000)).toBe(resource.getMaxAdrenaline(player.id));
    expect(bubbles.hostUpdate(pauseEnd + 2)[0].charge).toBe(config.chargeCapacity);
    expect(regen(start + config.bubbleDuration)).toBeCloseTo(baseRegen * otherMultiplier ** 2);
    bubbles.removeBubble(id, start + config.bubbleDuration, true);
    bubbles.destroyAll();
    gameplay.combat = null;
    expect(regen(start + config.bubbleDuration + 1)).toBeCloseTo(baseRegen * otherMultiplier ** 2);
    resource.setAdrenalineRegenRateResolver(null);
  });
});
