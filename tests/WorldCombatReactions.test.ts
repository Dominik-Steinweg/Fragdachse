import { describe, expect, it, vi } from 'vitest';
import { WorldCombatReactions } from '../src/world/WorldCombatReactions';
import { COOP_DEFENSE_ENEMY_KINDS, getCoopDefenseEnemyXp } from '../src/config/coopDefenseEnemies';
import type { KillSourceContext } from '../src/combat/WorldCombatCore';
import type { CombatTargetRef } from '../src/combat/CombatScope';

const playerLife: CombatTargetRef = { kind: 'player', id: 'credited',
  scope: { worldRevision: 1, runtimeGeneration: 1 }, instance: { entityGeneration: 1, lifeRevision: 1 } };

function fixture() {
  const damage = vi.fn(), xp = vi.fn(), frag = vi.fn(), popup = vi.fn(), itemKill = vi.fn(), registerKill = vi.fn();
  const owner = new WorldCombatReactions({
    isCoopMission: () => true, isActivityActive: () => true,
    combatSystem: { applyDamage: damage, isCurrentCombatantTarget: () => true } as never,
    getPlayerCombatIntegration: () => ({
      resource: { addAdrenaline: vi.fn() }, modifier: { getClassDefinition: () => null },
      reactions: { registerKill, handleCoopDefenseItemKill: itemKill,
        handlePlayerDamageTaken: () => ({ reflectedDamage: 5, reflectTargetId: 'source', adrenalineGain: 0 }) },
    }) as never,
    getPowerUpSystem: () => null,
    network: {
      authority: { isHost: () => true, isEnemyPair: () => true,
        getPlayerProfile: id => id === 'credited' ? { id, name: id, colorHex: 0 } as never : undefined,
        getConnectedPlayers: () => [{ id: 'credited' }] as never },
      round: { canPlayerReceiveRoundRewards: () => true, addCoopDefenseRoundXp: xp } as never,
      stats: { incrementPlayerFrags: frag, recordPlayerKill: vi.fn(), recordPlayerDamageTaken: vi.fn() } as never,
      effects: { broadcastCoopDefenseXpPopup: popup } as never,
    },
  });
  return { owner, damage, xp, frag, popup, itemKill, registerKill };
}

describe('World Combat reaction policies', () => {
  it('does not re-reflect reflected damage even when an item proposes another reflection', () => {
    const f = fixture();
    f.owner.handlePlayerDamageTaken('credited', 'source', 10, 0, 'reflect', 1000, playerLife, () => true);
    expect(f.damage).not.toHaveBeenCalled();
    f.owner.handlePlayerDamageTaken('credited', 'source', 10, 0, 'direct', 1000, playerLife, () => true);
    expect(f.damage).toHaveBeenCalledTimes(1);
    expect(f.damage.mock.calls[0]?.[6]).toMatchObject({ damageKind: 'reflect' });
  });

  it('awards removed hostile victims from terminal facts while keeping actor and reward recipient separate', () => {
    const f = fixture(), enemyKind = COOP_DEFENSE_ENEMY_KINDS[0];
    const source: KillSourceContext = {
      enemyKind, victimFaction: 'hostile', victimKind: 'enemy', nowMs: 1234,
      damageOrigin: { kind: 'reaction', slot: 'weapon1' },
      provenance: { gameplaySource: { kind: 'enemy', id: 'removed-summon' },
        attribution: { kind: 'player', id: 'credited' }, allegiance: { ownerId: 'different-team' }, origin: 'reaction' },
    };
    f.owner.handleKill('credited', 'removed-victim', 'cull', 10, 20, source, () => true);
    expect(f.frag).toHaveBeenCalledExactlyOnceWith('credited');
    expect(f.xp).toHaveBeenCalledExactlyOnceWith(getCoopDefenseEnemyXp(enemyKind));
    expect(f.popup).toHaveBeenCalledWith(10, 20, getCoopDefenseEnemyXp(enemyKind));
    expect(f.registerKill.mock.calls[0]?.[0].source.provenance).toEqual(source.provenance);
    expect(f.itemKill.mock.calls[0]?.[5]).toEqual(source.damageOrigin);
  });

  it('does not replace a missing reward recipient with another connected player', () => {
    const f = fixture();
    f.owner.handleKill('missing', 'removed-victim', 'summon', 10, 20, {
      enemyKind: COOP_DEFENSE_ENEMY_KINDS[0], victimFaction: 'hostile',
      provenance: { gameplaySource: { kind: 'enemy', id: 'removed-summon' },
        attribution: { kind: 'player', id: 'missing' }, allegiance: { ownerId: 'credited' }, origin: 'direct' },
    }, () => true);
    expect(f.frag).not.toHaveBeenCalled(); expect(f.xp).not.toHaveBeenCalled();
    expect(f.registerKill).not.toHaveBeenCalled();
  });
});
