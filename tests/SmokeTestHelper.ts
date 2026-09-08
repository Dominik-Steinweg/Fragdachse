import { vi } from 'vitest';
import authored from '../src/loadout/content/data/utilities-grenades.json';
import type { SmokeGrenadeEffect } from '../src/types';
import type { SmokeBehaviorConfig } from '../src/systems/SmokeRules';
import { SmokeRuntime, type SmokeTarget } from '../src/systems/SmokeRuntime';
import { TargetStatusSystem } from '../src/systems/TargetStatusSystem';
import type { CombatSource } from '../src/combat/CombatScope';
import type { TargetDamageAppliedOutcome } from '../src/combat/CombatMutation';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals } from '../src/utils/coopDefenseUpgrades';

export const fullSmokeLevels = {
  unlock_smoke_grenade: 1, smoke_grenade_radius: 3, smoke_grenade_duration: 3,
  smoke_grenade_disorientation: 3, smoke_grenade_vulnerability: 1, smoke_grenade_storm: 1,
  smoke_grenade_discharge: 3, smoke_grenade_growth: 3,
};
export function resolvedSmoke(levels: Record<string, number> = fullSmokeLevels) {
  const profile = { upgrades: Object.fromEntries(Object.entries(levels).map(([id, level]) => [id, { unlocked: level > 0, level }])) };
  const config = applyCoopDefenseModifiersToUtilityConfig(UTILITY_CONFIGS.SMOKE_GRENADE, getCoopDefenseResolvedEffectTotals(profile, 'dachs_nukem'));
  if (config.type !== 'smoke') throw Error('Expected smoke config');
  return config;
}

export function smokeEffect(behavior: Partial<SmokeBehaviorConfig> = {}, overrides: Partial<SmokeGrenadeEffect> = {}): SmokeGrenadeEffect {
  return { type: 'smoke', radius: 100, spreadDuration: 100, lingerDuration: 1000, dissipateDuration: 100,
    maxAlpha: 0.7, dotDamagePerTick: 3, dotTickIntervalMs: 50,
    behavior: { ...structuredClone(authored.utilities.SMOKE_GRENADE.smokeBehavior), aftereffectMs: 200, recoveryFadeMs: 50,
      dischargeCount: 2, growthMaxProcs: 2, growthTransitionMs: 100, ...behavior }, ...overrides };
}
export function smokeTarget(id = 'enemy-1', x = 0, y = 0, boss = false, generation = 1): SmokeTarget {
  return { x, y, boss, ref: { kind: 'enemy', id, scope: { worldRevision: 1, runtimeGeneration: 1 },
    instance: { entityGeneration: generation, activityRevision: 1 } } };
}
export function smokeSource(id = 'player-1'): CombatSource {
  return { gameplaySource: { kind: 'player', id }, attribution: { kind: 'player', id },
    allegiance: { kind: 'player', ownerId: id }, authoredSourceId: 'SMOKE_GRENADE', sourceSlot: 'utility', origin: 'ground' };
}
export function smokeDamage(target: SmokeTarget, source = smokeSource(), id = 'hit', dead = false, amount = 1): TargetDamageAppliedOutcome {
  return { kind: 'damage-applied', outcomeId: id, target: target.ref, source, actualDamage: amount, hpLost: amount, armorLost: 0, integrityLost: 0,
    damage: { amount, damageKind: source.origin === 'support' ? 'ground' : source.origin, basis: { kind: 'authored', amount }, sourceFactors: [], targetFactors: [], isCritical: false },
    resultingState: { kind: 'combatant', hp: dead ? 0 : 100, maxHp: 100, armor: 0, maxArmor: 0, alive: !dead },
    ...(dead ? { transition: { kind: 'dead' as const, facts: { target: target.ref, position: { x: target.x, y: target.y } } } }
      : { transition: { kind: 'none' as const }, rescueHealing: 0 }) };
}
export function smokeHarness(hasClearLine: (sx: number, sy: number, ex: number, ey: number) => boolean = () => true) {
  const status = new TargetStatusSystem(); const spawn = vi.fn();
  const runtime = new SmokeRuntime({ hasClearLine, spawnProjectile: spawn, random: () => 0.25,
    hasVisibleSegment: (cx, cy, ax, ay, bx, by) => hasClearLine(cx, cy, ax, ay) || hasClearLine(cx, cy, bx, by),
    isFriendlySource: source => source.attribution.kind === 'player',
    setVulnerability: (target, until) => status.setVulnerabilityContribution(`smoke:${target.instance.entityGeneration}`,
      { targetType: 'enemy', targetId: String(target.id) }, until),
  });
  const charge = (target: SmokeTarget, cloudId: number, now: number, id = 'storm', dead = false) => {
    const source = { ...smokeSource(), lineage: { smokeKind: 'storm' as const, smokeCloudId: cloudId } };
    runtime.onDamage(smokeDamage(target, source, id, dead), target.x, target.y, now);
  };
  return { runtime, status, spawn, charge };
}
