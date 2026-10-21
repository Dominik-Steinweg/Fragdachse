import { combatTargetInstanceKey, isSameCombatTargetInstance, type CombatTargetRef } from '../combat/CombatScope';
import { isPlayerSideCombatSource } from '../combat/CombatRelationshipPolicy';
import type { WorldCombatCore } from '../combat/WorldCombatCore';
import type { FireSystem } from '../effects/FireSystem';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import { BeeSwarmSystem, type BeeSwarmState, type BeeSwarmTarget } from '../systems/beeSwarm/BeeSwarmSystem';
import type { SyncedBeeSwarm } from '../types';
import type { ReactivePropFollowUp } from './reactiveProps/ReactivePropRuntime';
import type { ReactivePropSwarmEffect } from '../config/reactiveProps/reactivePropKinds';
import { PLAYER_SIZE } from '../config';

interface Target extends BeeSwarmTarget { readonly ref: CombatTargetRef }

export interface WorldBeeSwarmOptions {
  readonly combat: WorldCombatCore;
  readonly players: PlayerManager;
  readonly enemies: () => EnemyManager | null;
  readonly fire: FireSystem;
  /** Present, interactive and not burrowed: only such players can be hunted. */
  readonly isPlayerHuntable: (playerId: string) => boolean;
}

/**
 * World adapter of the bee swarms: target projection from players and enemies, relationship of
 * the captured trigger source, sting damage through the combat core and host explosion
 * observation. Host only; peers render from the replicated swarm slice.
 */
export class WorldBeeSwarmBinding {
  readonly system: BeeSwarmSystem<Target>;
  private readonly targets = new Map<string, Target>();
  /** Subscribed with the first swarm: Worlds without hives never observe explosions. */
  private unobserve: (() => void) | null = null;
  private lastNow = 0;

  constructor(private readonly options: WorldBeeSwarmOptions) {
    this.system = new BeeSwarmSystem<Target>({
      targets: () => this.refreshTargets(),
      readTarget: key => this.readTarget(key),
      canTarget: (swarm, target) => this.canTarget(swarm, target),
      isBurning: (x, y, radius) => options.fire.collectContacts(x, y, radius).length > 0,
      sting: (swarm, target, at) => this.sting(swarm, target, at),
    });
  }

  /** A hive released its swarm; the swarm belongs to the hive's captured trigger. */
  release(effect: ReactivePropFollowUp<'swarm', ReactivePropSwarmEffect>): void {
    this.unobserve ??= this.options.combat.observeRadialExplosions((x, y, radius, now) => this.system.observeExplosion(x, y, radius, now));
    this.system.release({ hiveIndex: effect.index, x: effect.x, y: effect.y, at: effect.at, source: effect.source,
      config: effect.config, hostile: !isPlayerSideCombatSource(effect.source) });
  }

  advance(now: number): void {
    this.lastNow = now;
    this.system.update(now);
  }

  getSnapshot(): SyncedBeeSwarm[] {
    return this.system.getSwarms().map(swarm => ({
      id: swarm.id, hiveIndex: swarm.hiveIndex, phase: swarm.phase, phaseStartedAt: swarm.phaseStartedAt,
      releasedAt: swarm.releasedAt, x: swarm.x, y: swarm.y,
      target: swarm.target ? { kind: swarm.target.kind, id: swarm.target.id } : null,
      hostile: swarm.hostile, stingSequence: swarm.stingSequence,
    }));
  }

  /** Activity ended: enemy targets of the old Activity vanish, swarms fly home. */
  clearActivity(): void {
    this.targets.clear();
    this.system.invalidateActivity(this.lastNow);
  }

  destroy(): void {
    this.unobserve?.();
    this.unobserve = null;
    this.targets.clear();
    this.system.clear();
  }

  private refreshTargets(): readonly Target[] {
    this.targets.clear();
    const { combat, players, enemies, isPlayerHuntable } = this.options;
    for (const player of players.getAllPlayers()) {
      if (!combat.isAlive(player.id) || !isPlayerHuntable(player.id)) continue;
      const ref = combat.getCurrentCombatantTarget(player.id);
      if (ref?.kind !== 'player') continue;
      const key = combatTargetInstanceKey(ref);
      this.targets.set(key, { key, ref, kind: 'player', id: player.id, x: player.x, y: player.y, radius: PLAYER_SIZE / 2 });
    }
    const manager = enemies();
    for (const enemy of manager?.getAllEnemies() ?? []) {
      if (enemy.getHp() <= 0 || !enemy.sprite.active || enemy.isBurrowed()) continue;
      const ref = manager!.getCombatTargetRef(enemy.id);
      if (!ref) continue;
      const key = combatTargetInstanceKey(ref);
      this.targets.set(key, { key, ref, kind: 'enemy', id: enemy.id, x: enemy.sprite.x, y: enemy.sprite.y,
        radius: enemy.getCollisionRadius() });
    }
    return [...this.targets.values()];
  }

  private readTarget(key: string): Target | null {
    const held = this.targets.get(key);
    if (!held) return null;
    const { combat } = this.options;
    if (held.kind === 'player') {
      const player = this.options.players.getPlayer(held.id);
      const current = combat.getCurrentCombatantTarget(held.id);
      return player && current && isSameCombatTargetInstance(current, held.ref) && combat.isAlive(held.id)
        && this.options.isPlayerHuntable(held.id) ? { ...held, x: player.x, y: player.y } : null;
    }
    const manager = this.options.enemies();
    const enemy = manager?.getEnemy(held.id);
    const current = manager?.getCombatTargetRef(held.id);
    return enemy && current && isSameCombatTargetInstance(current, held.ref) && enemy.sprite.active && enemy.getHp() > 0
      && !enemy.isBurrowed() ? { ...held, x: enemy.sprite.x, y: enemy.sprite.y } : null;
  }

  /** The captured relationship decides; the trigger itself is never a target ('self' may be damaged). */
  private canTarget(swarm: BeeSwarmState<Target>, target: Target): boolean {
    const source = swarm.source;
    if (target.id === source.allegiance.ownerId || target.id === source.attribution.id) return false;
    return this.options.combat.resolveCombatRelationship(source, target.ref).canDamage;
  }

  private sting(swarm: BeeSwarmState<Target>, target: Target, at: number): void {
    const { combat } = this.options;
    const source = swarm.source, damage = swarm.config.stingDamage;
    combat.runHostExecution(() => {
      combat.applyDamage(target.id, damage, false, source.attribution.id, source.authoredSourceId,
        { sourceX: swarm.x, sourceY: swarm.y }, {
          source, target: target.ref, damageKind: 'direct', allowCritical: false, skipLifeLeech: true,
          basis: { kind: 'source-resolved', amount: damage, sourceFactors: [] },
        });
    }, at);
  }
}
