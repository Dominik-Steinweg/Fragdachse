import type { ArenaLayout, ExplosionVisualStyle, SyncedNukeStrike } from '../types';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem } from '../systems/CombatSystem';
import type { WorldMetrics } from './WorldMetrics';
import { PowerUpSystem, type PowerUpSystemOptions } from '../powerups/PowerUpSystem';
import { UTILITY_CONFIGS, type UtilityConfig } from '../loadout/LoadoutConfig';
import type { WorldScopedBinding } from './WorldRuntime';

/** World-owned PowerUp construction and teardown boundary. */
export interface WorldPowerUpRuntimeOptions {
  readonly playerManager: PlayerManager;
  readonly combatSystem: CombatSystem;
  readonly layout: ArenaLayout;
  readonly worldMetrics: WorldMetrics;
  readonly recordPowerUpCollected: (playerId: string) => void;
  readonly addTemporaryUtility: (playerId: string, config: UtilityConfig) => boolean;
  readonly claimObjectiveReward: (objectiveId: string, playerId: string) => boolean;
  readonly reportDiagnosticEvent: (type: string, fields: Record<string, unknown>) => void;
  readonly broadcastExplosion: (
    x: number,
    y: number,
    radius: number,
    color: number,
    style: ExplosionVisualStyle,
  ) => void;
  readonly applyNukeEnvironmentDamage: (x: number, y: number, radius: number, triggeredBy: string) => void;
  readonly notifyVoidHunterNuke: (strike: SyncedNukeStrike) => void;
  readonly coopDefenseMapXpReference: number;
  readonly isAdrenalineDropEnabled: (playerId: string) => boolean;
  readonly getAdrenalineDropChanceMultiplier: (playerId: string) => number;
  readonly getAdrenalineSyringeDurationMultiplier: (playerId: string) => number;
  readonly isLinkedBaseActive: (baseId: string) => boolean;
  readonly getConstructionRespawnMultiplier: (constructionId: number) => number;
  readonly onDestroy?: (runtime: WorldPowerUpRuntime) => void;
}

/**
 * Owns the one PowerUpSystem for a World. Activity pedestal bindings are directed into it, but
 * their authored membership remains Activity-owned. Construction and Persistent-Base pedestals
 * are likewise only registered through their respective World owners.
 */
export class WorldPowerUpRuntime implements WorldScopedBinding {
  readonly system: PowerUpSystem;
  private destroyed = false;

  constructor(private readonly options: WorldPowerUpRuntimeOptions) {
    this.system = new PowerUpSystem(
      options.playerManager,
      options.combatSystem,
      options.layout,
      this.createSystemOptions(),
      options.worldMetrics,
    );
    this.system.setConstructionRespawnMultiplierProvider(
      options.getConstructionRespawnMultiplier,
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.system.setConstructionRespawnMultiplierProvider(null);
    this.system.reset();
    this.options.onDestroy?.(this);
  }

  private createSystemOptions(): PowerUpSystemOptions {
    return {
      onPickupCollected: (playerId) => this.options.recordPowerUpCollected(playerId),
      onNukePickup: (playerId) => this.options.addTemporaryUtility(playerId, UTILITY_CONFIGS.NUKE),
      onNukeExploded: (x, y, radius, triggeredBy) => {
        this.options.reportDiagnosticEvent('nuke:explode', {
          variant: 'standard',
          radius,
          triggeredBy,
        });
        this.options.broadcastExplosion(x, y, radius, 0xffd26a, 'nuke');
        this.options.applyNukeEnvironmentDamage(x, y, radius, triggeredBy);
      },
      onConfiguredNukeExploded: (strike) => {
        if (strike.variant !== 'void') return;
        this.options.reportDiagnosticEvent('nuke:explode', {
          variant: strike.variant,
          radius: strike.radius,
          triggeredBy: strike.triggeredBy,
        });
        this.options.broadcastExplosion(strike.x, strike.y, strike.radius, 0xa631ff, 'void_nuke');
        this.options.notifyVoidHunterNuke(strike);
      },
      onHolyHandGrenadePickup: (playerId) => (
        this.options.addTemporaryUtility(playerId, UTILITY_CONFIGS.HOLY_HAND_GRENADE)
      ),
      onBfgPickup: (playerId) => this.options.addTemporaryUtility(playerId, UTILITY_CONFIGS.BFG),
      onObjectiveRewardPickup: (objectiveId, playerId) => (
        this.options.claimObjectiveReward(objectiveId, playerId)
      ),
      coopDefenseMapXpReference: this.options.coopDefenseMapXpReference,
      isAdrenalineDropEnabled: this.options.isAdrenalineDropEnabled,
      getAdrenalineDropChanceMultiplier: this.options.getAdrenalineDropChanceMultiplier,
      getAdrenalineSyringeDurationMultiplier: this.options.getAdrenalineSyringeDurationMultiplier,
      isLinkedBaseActive: this.options.isLinkedBaseActive,
      includeActivityLinkedPedestals: false,
    };
  }
}
