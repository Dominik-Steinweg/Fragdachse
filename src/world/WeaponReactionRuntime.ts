import * as Phaser from 'phaser';
import type {
  WeaponKillReactionOutcome,
  WeaponReactionCombatPort,
  WeaponReactionLoadoutReadPort,
  WeaponReactionNetworkPort,
  WeaponReactionPort,
  WeaponReactionResourcePort,
} from '../loadout/WeaponReactionPort';

interface ShotgunLightningEvent {
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly generation: number;
}

export interface WeaponReactionRuntimeOptions {
  readonly loadout: WeaponReactionLoadoutReadPort;
  readonly combatSystem: WeaponReactionCombatPort;
  readonly resourceSystem: WeaponReactionResourcePort;
  readonly network: WeaponReactionNetworkPort;
}

/** World-owned player weapon reactions that are not loadout responsibilities. */
export class WeaponReactionRuntime implements WeaponReactionPort {
  private readonly shotgunLightningQueue: ShotgunLightningEvent[] = [];
  private destroyed = false;

  constructor(private readonly options: WeaponReactionRuntimeOptions) {}

  registerKill(outcome: WeaponKillReactionOutcome): void {
    if (this.destroyed) return;

    const weaponConfigs = [
      this.options.loadout.getEquippedWeaponConfig(outcome.killerId, 'weapon1'),
      this.options.loadout.getEquippedWeaponConfig(outcome.killerId, 'weapon2'),
    ];
    const shotgun = weaponConfigs.find((config) => config?.id === 'SHOTGUN');
    if (shotgun) this.queueShotgunLightning(outcome, shotgun);

    const sourceConfig = weaponConfigs.find((config) => config?.id === outcome.sourceId);
    if (!sourceConfig) return;
    if ((sourceConfig.killHeal ?? 0) > 0) this.options.combatSystem.heal(outcome.killerId, sourceConfig.killHeal ?? 0);
    if ((sourceConfig.killAdrenaline ?? 0) > 0) {
      this.options.resourceSystem.addAdrenaline(outcome.killerId, sourceConfig.killAdrenaline ?? 0);
    }
  }

  update(): void {
    if (this.destroyed || this.shotgunLightningQueue.length === 0) return;

    // Große Ketten werden über mehrere Frames verteilt, aber logisch nicht begrenzt.
    const events = this.shotgunLightningQueue.splice(0, 256);
    for (const event of events) {
      const shotgun = this.options.loadout.getEquippedWeaponConfig(event.ownerId, 'weapon2');
      if (!shotgun || shotgun.id !== 'SHOTGUN') continue;

      const baseRadius = shotgun.shotgunLightningRadius ?? 0;
      const baseDamage = shotgun.shotgunLightningDamage ?? 0;
      if (baseRadius <= 0 || baseDamage <= 0) continue;

      const damageRetention = event.generation > 0
        ? Phaser.Math.Clamp(shotgun.shotgunChainDamageRetention ?? 0, 0, 1)
        : 1;
      const radiusRetention = event.generation > 0
        ? Phaser.Math.Clamp(shotgun.shotgunChainRadiusRetention ?? 0, 0, 1)
        : 1;
      if (event.generation > 0 && ((shotgun.shotgunChainEnabled ?? 0) <= 0 || damageRetention <= 0 || radiusRetention <= 0)) continue;

      const damage = baseDamage * Math.pow(damageRetention, event.generation);
      const radius = baseRadius * Math.pow(radiusRetention, event.generation);
      if (damage < 0.5 || radius < 4) continue;

      this.options.combatSystem.applyAoeDamage(event.x, event.y, radius, damage, event.ownerId, false, {
        category: 'explosion',
        allowTeamDamage: false,
        sourceId: 'weapon.SHOTGUN.lightning',
        sourceSlot: 'weapon2',
        enemySlowFraction: (shotgun.shotgunLightningAppliesSlow ?? 0) > 0 ? shotgun.shotgunSlowFraction ?? 0 : 0,
        enemySlowDurationMs: shotgun.shotgunSlowDurationMs ?? 0,
        killSource: { shotgunLightningGeneration: event.generation },
      });
      this.options.network.broadcastExplosionEffect(event.x, event.y, radius, 0x78dfff, 'lightning');
    }
  }

  resetPlayer(playerId: string): void {
    if (this.destroyed) return;
    this.removeQueuedEvents(playerId);
  }

  removePlayer(playerId: string): void {
    this.removeQueuedEvents(playerId);
  }

  clear(): void {
    this.shotgunLightningQueue.length = 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clear();
  }

  private queueShotgunLightning(
    outcome: WeaponKillReactionOutcome,
    shotgun: NonNullable<ReturnType<WeaponReactionLoadoutReadPort['getEquippedWeaponConfig']>>,
  ): void {
    if (
      outcome.sourceId === shotgun.id
      && (shotgun.shotgunLightningRadius ?? 0) > 0
      && (shotgun.shotgunLightningDamage ?? 0) > 0
    ) {
      this.shotgunLightningQueue.push({
        ownerId: outcome.killerId,
        x: outcome.x,
        y: outcome.y,
        generation: 0,
      });
      return;
    }

    if (
      outcome.sourceId === 'weapon.SHOTGUN.lightning'
      && (shotgun.shotgunChainEnabled ?? 0) > 0
      && outcome.source?.shotgunLightningGeneration !== undefined
    ) {
      this.shotgunLightningQueue.push({
        ownerId: outcome.killerId,
        x: outcome.x,
        y: outcome.y,
        generation: outcome.source.shotgunLightningGeneration + 1,
      });
    }
  }

  private removeQueuedEvents(playerId: string): void {
    for (let i = this.shotgunLightningQueue.length - 1; i >= 0; i -= 1) {
      if (this.shotgunLightningQueue[i]?.ownerId === playerId) this.shotgunLightningQueue.splice(i, 1);
    }
  }
}
