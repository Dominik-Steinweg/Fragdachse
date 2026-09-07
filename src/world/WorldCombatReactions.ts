import { getCoopDefenseEnemyXp } from '../config/coopDefenseEnemies';
import { COOP_DEFENSE_BASE_TURRET_OWNER_ID, COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID } from '../config';
import type { KillSourceContext } from '../systems/CombatSystem';
import type { WorldCombatGameplayBindingOptions } from './WorldCombatGameplayBinding';
import type { CombatDamageKind } from '../types';
import type { CombatTargetRef } from '../combat/CombatScope';

type CombatReactionOptions = Pick<WorldCombatGameplayBindingOptions,
  'network' | 'combatSystem' | 'getPlayerCombatIntegration' | 'getPowerUpSystem' | 'isCoopMission' | 'isActivityActive'>;

/** Concrete ordered gameplay reactions to committed Combat facts. */
export class WorldCombatReactions {
  constructor(private readonly options: CombatReactionOptions) {}

  handleDirectPrimaryHit(attackerId: string, enemyId: string, hp: number, maxHp: number, isBoss: boolean,
    nowMs: number, target: CombatTargetRef, scopeCurrent: () => boolean): void {
    const o = this.options;
    const current = () => scopeCurrent() && o.combatSystem.isCurrentCombatantTarget(target);
    if (!current()) return;
    const result = o.getPlayerCombatIntegration()?.reactions.handleDirectPrimaryHit(attackerId, enemyId, hp, maxHp, isBoss, nowMs);
    if (!result || !current()) return;
    if (result.slowFraction > 0) o.combatSystem.applyEnemySlow(enemyId, result.slowFraction, result.slowDurationMs);
    if (!current()) return;
    if (result.shouldCull) o.combatSystem.applyDamage(enemyId, hp, false, attackerId, 'Hinrichtung', undefined, {
      damageKind: 'reaction', sourceSlot: 'weapon1', allowCritical: false, skipLifeLeech: true,
    });
  }

  handlePlayerDamageTaken(playerId: string, attackerId: string | undefined, hpLost: number, armorLost: number,
    damageKind: CombatDamageKind, nowMs: number, current: () => boolean): void {
    const o = this.options, playerCombat = o.getPlayerCombatIntegration();
    const result = playerCombat?.reactions.handlePlayerDamageTaken(playerId, attackerId, hpLost, armorLost, damageKind, nowMs);
    if (!current()) return;
    if (result && result.adrenalineGain > 0) playerCombat?.resource.addAdrenaline(playerId, result.adrenalineGain);
    if (!current()) return;
    if (damageKind !== 'reflect' && result && result.reflectedDamage > 0 && result.reflectTargetId) {
      o.combatSystem.applyDamage(result.reflectTargetId, result.reflectedDamage, false, playerId, 'Dornenplatten', undefined,
        { damageKind: 'reflect', allowCritical: false });
    }
    if (current()) o.network.stats.recordPlayerDamageTaken(playerId, hpLost, armorLost);
  }

  handleKill(killerId: string, victimId: string, sourceId: string, x: number, y: number,
    source: KillSourceContext | undefined, current: () => boolean): void {
    const o = this.options;
    if (!current() || !o.network.authority.isHost()) return;
    const killerProfile = o.network.authority.getPlayerProfile(killerId);
    const victimProfile = o.network.authority.getPlayerProfile(victimId);
    const victimIsPlayer = source?.victimKind === 'player' || !!victimProfile;
    const hostileEnemy = source?.victimFaction === 'hostile';
    const enemyXp = hostileEnemy && source?.enemyKind ? getCoopDefenseEnemyXp(source.enemyKind) : 0;
    const eligibleKiller = source?.provenance
      ? source.provenance.attribution.kind === 'player' && !!killerProfile : !!killerProfile;
    const reactionSource = { ...source, enemyXp };

    if (eligibleKiller) {
      o.getPlayerCombatIntegration()?.reactions.registerKill({ killerId, victimId, sourceId, x, y, source: reactionSource });
      if (!current()) return;
      if (hostileEnemy && o.isCoopMission()) {
        o.getPlayerCombatIntegration()?.reactions.handleCoopDefenseItemKill(killerId, victimId, x, y,
          source?.nowMs ?? 0, source?.damageOrigin);
        if (!current()) return;
      }
    }

    if (eligibleKiller && (hostileEnemy || victimIsPlayer)) {
      o.network.stats.incrementPlayerFrags(killerId);
      if (hostileEnemy) o.network.stats.recordPlayerKill(killerId, 'pve');
      else if (o.network.authority.isEnemyPair(killerId, victimId)) o.network.stats.recordPlayerKill(killerId, 'pvp');
    }
    if (!current()) return;
    if (hostileEnemy && o.isCoopMission()) {
      const eligibleReward = eligibleKiller ? o.network.round.canPlayerReceiveRoundRewards(killerId)
        : source?.provenance?.gameplaySource.id === COOP_DEFENSE_BASE_TURRET_OWNER_ID
          && o.network.authority.getConnectedPlayers().some(profile => o.network.round.canPlayerReceiveRoundRewards(profile.id));
      if (eligibleReward && enemyXp > 0) {
        o.network.round.addCoopDefenseRoundXp(enemyXp);
        if (!current()) return;
        o.network.effects.broadcastCoopDefenseXpPopup(x, y, enemyXp);
      }
      if (!current()) return;
      o.getPowerUpSystem()?.onCoopDefenseEnemyKilled(killerId, enemyXp, x, y);
      if (!current()) return;
      for (const profile of o.network.authority.getConnectedPlayers()) {
        const playerCombat = o.getPlayerCombatIntegration();
        const gain = playerCombat?.modifier.getClassDefinition(profile.id)?.adrenalinePerEnemyDeath ?? 0;
        if (gain > 0) playerCombat?.resource.addAdrenaline(profile.id, gain);
        if (!current()) return;
      }
    }
    const allowDrop = o.isActivityActive() && !o.isCoopMission();
    if (killerId === '__train__' || killerId === COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID) {
      if (killerId === '__train__' && allowDrop) o.getPowerUpSystem()?.onPlayerKilled(x, y);
      if (!current()) return;
      if (victimProfile) o.network.effects.broadcastKillEvent({
        killerId, killerName: killerId === '__train__' ? 'RB 54' : 'Zombie-Bomber',
        killerColor: killerId === '__train__' ? 0xcf573c : 0xff9933,
        sourceId: killerId === '__train__' ? 'environment.train_push' : 'environment.airstrike',
        victimId, victimName: victimProfile.name, victimColor: victimProfile.colorHex,
      });
      return;
    }
    if (eligibleKiller && victimProfile) {
      if (allowDrop) o.getPowerUpSystem()?.onPlayerKilled(x, y);
      if (!current()) return;
      o.network.effects.broadcastKillEvent({
        killerId, killerName: killerProfile!.name, killerColor: killerProfile!.colorHex,
        sourceId, victimId, victimName: victimProfile.name, victimColor: victimProfile.colorHex,
      });
    }
  }
}
