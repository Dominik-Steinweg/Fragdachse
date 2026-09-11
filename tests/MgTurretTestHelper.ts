import { MgAttritionRuntime, type MgOwner, type MgTarget } from '../src/systems/MgAttritionRuntime';
import type { MgTurretStats } from '../src/config/mgTurret';
import { MG_TURRET_RULES } from '../src/config/mgTurretRules';

export function mgOwner(id = 'p1', stats: Partial<MgTurretStats> = {}, group = 'team'): MgOwner {
  return { id, group, stats: { damage: MG_TURRET_RULES.damage, cooldownMs: MG_TURRET_RULES.cooldownMs,
    targetRange: 550, projectileRange: 600, perHitPercent: 2, maximumPercent: 80,
    network: false, bleedLevel: 0, transferFraction: 0, ...stats } };
}
export function mgTarget(id = 'e1', x = 0, kind: 'enemy' | 'base' = 'enemy', generation = 1): MgTarget {
  return { ref: { kind, id, scope: { worldRevision: 1, runtimeGeneration: 1 }, instance: { entityGeneration: generation } }, x, y: 0 };
}
export function mgHarness(owners: readonly MgOwner[] = [mgOwner()]) {
  let targets = [mgTarget()];
  let blocked = false;
  const damage: { target: string; amount: number; owner: string; at: number }[] = [];
  let onDamage: ((target: string, at: number) => void) | undefined;
  const runtime = new MgAttritionRuntime({ targets: () => targets, canAffect: () => true,
    transferContact: (from, to, radius) => !blocked && Math.hypot(to.x - from.x, to.y - from.y) <= radius ? to : null,
    bleed: (target, amount, owner, at) => { damage.push({ target: String(target.id), amount, owner, at }); onDamage?.(String(target.id), at); },
  });
  runtime.setOwners(owners, 0);
  return { runtime, damage, target: targets[0], total: () => damage.reduce((sum, hit) => sum + hit.amount, 0),
    setTargets: (next: MgTarget[]) => { targets = next; }, setBlocked: (value: boolean) => { blocked = value; },
    setDamageHandler: (handler: (target: string, at: number) => void) => { onDamage = handler; } };
}
