import { vi } from 'vitest';
import authored from '../src/loadout/content/data/utilities-tactical.json';
import { ZeusRuntime, type ZeusConfig, type ZeusMovement, type ZeusTarget, type ZeusUse } from '../src/systems/ZeusRuntime';
import type { CombatDamageMutationOutcome } from '../src/combat/CombatMutation';
import type { CombatTargetRef } from '../src/combat/CombatScope';

export function zeusRef(id = 'enemy', generation = 1): CombatTargetRef {
  return { kind: 'enemy', id, scope: { worldRevision: 1, runtimeGeneration: 1 }, instance: { entityGeneration: generation } };
}
export function zeusTarget(id: string, x: number, y = 0, radius = 2): ZeusTarget { return { ref: zeusRef(id), x, y, radius }; }
export function zeusOutcome(target: ZeusTarget, lethal = false): CombatDamageMutationOutcome {
  return { kind: 'damage-applied', target: target.ref, actualDamage: 1,
    transition: lethal ? { kind: 'dead', facts: {} } : { kind: 'none' } } as CombatDamageMutationOutcome;
}
export function zeusFixture(overrides: Partial<ZeusConfig> = {}) {
  const config: ZeusConfig = { ...authored.utilities.ZEUS_TASER.zeus, ballDurationMs: 1500, ...overrides };
  const targets: ZeusTarget[] = [];
  const friendly = [{ id: 'friend', x: 10, y: 0, radius: 1 }];
  const damage = vi.fn((_use: ZeusUse, target: ZeusTarget) => zeusOutcome(target));
  const bolt = vi.fn(), stun = vi.fn(), canHit = vi.fn(() => true), isOwnerActive = vi.fn(() => true);
  const runtime = new ZeusRuntime({ queryTargets: () => targets, damage, bolt, stun, canHit, isOwnerActive,
    friendlyPlayers: () => friendly, random: () => 0.5 });
  const use = runtime.createUse('owner', 0xffffff, 0, 100, 1, config);
  const movement: ZeusMovement = { playerId: 'owner', x: 0, y: 0, radius: 2, positionRevision: 0 };
  return { runtime, config, targets, friendly, damage, bolt, stun, canHit, isOwnerActive, use, movement };
}
