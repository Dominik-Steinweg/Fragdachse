import { describe, expect, it } from 'vitest';
import {
  cloneRadialActionRef,
  isSameRadialActionRef,
  radialActionKey,
  resolveRadialActions,
  type RadialActionRef,
} from '../src/systems/RadialActionModel';

describe('Radial Action Model', () => {
  it('normalizes shared construction utilities and sorts the flat ring deterministically', () => {
    const actions = resolveRadialActions({
      gameMode: 'coop_defense',
      tools: [
        { kind: 'construction', id: 'rocket_turret' },
        { kind: 'utility', id: 'HE_GRENADE' },
        { kind: 'utility', id: 'ROCK_BARRIER' },
        { kind: 'construction', id: 'rock_barrier' },
      ],
      persistentRewardIds: ['base_health_pedestal'],
      usedCapacity: 0,
      capacityMax: 100,
      now: 1_000,
      canUseUtility: true,
      canPlace: true,
      canManage: true,
      managementActions: ['dismantle', 'dismantle-own-all'],
    });

    expect(actions.map((entry) => radialActionKey(entry.ref))).toEqual([
      'utility:HE_GRENADE',
      'construction:rocket_turret',
      'construction:rock_barrier',
      'persistentReward:base_health_pedestal',
      'management:dismantle',
      'management:dismantle-own-all',
    ]);
  });

  it('keeps temporarily blocked actions visible with one explicit reason', () => {
    const now = 5_000;
    const actions = resolveRadialActions({
      gameMode: 'coop_defense',
      tools: [
        { kind: 'utility', id: 'HE_GRENADE' },
        { kind: 'construction', id: 'rocket_turret' },
      ],
      persistentRewardIds: ['base_health_pedestal'],
      usedCapacity: 100,
      capacityMax: 100,
      now,
      canUseUtility: true,
      canPlace: true,
      canManage: false,
      managementActions: ['dismantle'],
      getCooldownUntil: (ref) => ref.kind === 'utility' ? now + 750 : 0,
    });

    expect(actions).toHaveLength(4);
    expect(actions[0]).toMatchObject({
      ref: { kind: 'utility', utilityId: 'HE_GRENADE' },
      visible: true,
      available: false,
      disabledReason: 'cooldown',
      cooldownUntil: now + 750,
    });
    expect(actions[1]).toMatchObject({
      ref: { kind: 'construction', constructionId: 'rocket_turret' },
      visible: true,
      available: false,
      disabledReason: 'capacity',
    });
    expect(actions[2]).toMatchObject({
      ref: { kind: 'persistent-reward', rewardId: 'base_health_pedestal' },
      available: true,
    });
    expect(actions[3]).toMatchObject({
      ref: { kind: 'management', action: 'dismantle' },
      visible: true,
      available: false,
      disabledReason: 'player-blocked',
    });
  });

  it('uses stable value identity rather than UI object identity', () => {
    const ref: RadialActionRef = { kind: 'construction', constructionId: 'rocket_turret' };
    const clone = cloneRadialActionRef(ref);
    expect(clone).not.toBe(ref);
    expect(isSameRadialActionRef(ref, clone)).toBe(true);
    expect(isSameRadialActionRef(ref, { kind: 'construction', constructionId: 'flame_turret' })).toBe(false);
  });
});
