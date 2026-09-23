import type { PlasmaBurnerConfig } from '../src/loadout/PlasmaBurnerConfig';
import type { PlasmaBurnerTarget } from '../src/combat/plasmaBurner/PlasmaBurnerTargetPolicy';
export const burnerRules: PlasmaBurnerConfig = {
  overloadEnabled: 1, chainEnabled: 1, capacitorLevel: 0, retentionLevel: 0,
  cascadeLevel: 0, couplingLevel: 0, chargesLevel: 1, targetLockLevel: 1,
  qMaxByLevel: [100,120,140,160], decayPerSecondByLevel: [25,20,16,12.5],
  jumpsByLevel: [1,2,3,4], couplingRadiusByLevel: [90,110,130,150],
  intervalSecondsByLevel: [1.2,0.9,0.6], toleranceDegreesByLevel: [6,10,14],
  buildPerSecond: 100/3, secondaryFactor: 0.7, secondaryOverloadWeight: 0.5, contactToleranceMs: 50,
  chargeDamage: 12, chargeHeal: 24, chargeSearchRadius: 240, chargeSpeed: 480,
  chargeTurnDegreesPerSecond: 720, chargeLifetimeMs: 1500, outboundMs: 120, size: 6,
};
export function target(id: string, x = 30, patch: Partial<PlasmaBurnerTarget> = {}): PlasmaBurnerTarget {
  return { id, key: 'player:' + id, kind: 'player', category: 'combatant',
    x, y: 0, hp: 50, maxHp: 100, alive: true, damageable: true, supportable: false, self: false, automatic: true, ...patch };
}
