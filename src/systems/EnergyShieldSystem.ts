import Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { EnergyShieldWeaponFireConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type { ShieldBlockCategory, SyncedEnergyShield } from '../types';
import { dequantizeAngle } from '../utils/angle';
import type { ResourceSystem } from './ResourceSystem';
import type { ShieldBuffSystem } from './ShieldBuffSystem';

interface ActiveEnergyShield {
  ownerId: string;
  color: number;
  config: WeaponConfig & { fire: EnergyShieldWeaponFireConfig };
  lastRefreshAt: number;
  lastDrainAt: number;
  flashUntil: number;
}

interface ShieldBlockAttempt {
  targetId: string;
  category: ShieldBlockCategory;
  damage: number;
  sourceX: number;
  sourceY: number;
  now: number;
}

export class EnergyShieldSystem {
  private readonly activeShields = new Map<string, ActiveEnergyShield>();
  private static readonly HOLD_GRACE_MS = 150;

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly resourceSystem: ResourceSystem,
    private readonly bridge: NetworkBridge,
    private readonly shieldBuffSystem: ShieldBuffSystem,
  ) {}

  hostRefresh(
    ownerId: string,
    now: number,
    config: WeaponConfig & { fire: EnergyShieldWeaponFireConfig },
    color: number,
  ): void {
    const existing = this.activeShields.get(ownerId);
    if (existing) {
      existing.lastRefreshAt = now;
      existing.config = config;
      existing.color = color;
      return;
    }

    this.activeShields.set(ownerId, {
      ownerId,
      color,
      config,
      lastRefreshAt: now,
      lastDrainAt: now,
      flashUntil: 0,
    });
  }

  hostDeactivateForPlayer(playerId: string): void {
    this.activeShields.delete(playerId);
  }

  isActive(playerId: string): boolean {
    return this.activeShields.has(playerId);
  }

  getEquippedFireConfig(playerId: string): EnergyShieldWeaponFireConfig | null {
    return this.activeShields.get(playerId)?.config.fire ?? null;
  }

  tryBlockDamage(attempt: ShieldBlockAttempt): boolean {
    const shield = this.activeShields.get(attempt.targetId);
    if (!shield) return false;
    if (!shield.config.fire.blockableCategories.includes(attempt.category)) return false;

    const player = this.playerManager.getPlayer(attempt.targetId);
    if (!player?.sprite.active) return false;

    const aimAngle = this.getAimAngle(attempt.targetId, player.sprite.rotation);
    const dx = attempt.sourceX - player.sprite.x;
    const dy = attempt.sourceY - player.sprite.y;
    if (dx === 0 && dy === 0) return false;

    const sourceAngle = Math.atan2(dy, dx);
    const halfArcRad = Phaser.Math.DegToRad(shield.config.fire.blockArcDegrees) * 0.5;
    const angleDiff = Phaser.Math.Angle.Wrap(sourceAngle - aimAngle);
    if (Math.abs(angleDiff) > halfArcRad) return false;

    shield.flashUntil = Math.max(shield.flashUntil, attempt.now + shield.config.fire.flashDurationMs);
    this.shieldBuffSystem.addBlockedDamage(attempt.targetId, attempt.damage, shield.config.fire, attempt.now);
    return true;
  }

  hostUpdate(now: number): SyncedEnergyShield[] {
    const synced: SyncedEnergyShield[] = [];

    for (const [ownerId, shield] of this.activeShields) {
      if (now - shield.lastRefreshAt > EnergyShieldSystem.HOLD_GRACE_MS) {
        this.activeShields.delete(ownerId);
        continue;
      }

      const player = this.playerManager.getPlayer(ownerId);
      if (!player || !player.sprite.active) {
        this.activeShields.delete(ownerId);
        continue;
      }

      if (this.resourceSystem.getAdrenaline(ownerId) <= 0) {
        this.activeShields.delete(ownerId);
        continue;
      }

      const elapsedDrainMs = Math.max(0, now - shield.lastDrainAt);
      if (elapsedDrainMs > 0) {
        const drain = shield.config.fire.adrenalineDrainPerSecond * (elapsedDrainMs / 1000);
        if (drain > 0) this.resourceSystem.drainAdrenaline(ownerId, drain);
        shield.lastDrainAt = now;
      }

      if (this.resourceSystem.getAdrenaline(ownerId) <= 0) {
        this.activeShields.delete(ownerId);
        continue;
      }

      const aimAngle = this.getAimAngle(ownerId, player.sprite.rotation);
      const anchorX = player.sprite.x + Math.cos(aimAngle) * shield.config.fire.anchorDistance;
      const anchorY = player.sprite.y + Math.sin(aimAngle) * shield.config.fire.anchorDistance;
      const flashRemaining = Math.max(0, shield.flashUntil - now);
      const flashFrac = shield.config.fire.flashDurationMs > 0
        ? flashRemaining / shield.config.fire.flashDurationMs
        : 0;

      synced.push({
        ownerId,
        x: Math.round(anchorX),
        y: Math.round(anchorY),
        angle: aimAngle,
        radius: shield.config.fire.visualRadius,
        thickness: shield.config.fire.visualThickness,
        arcDegrees: shield.config.fire.blockArcDegrees,
        color: shield.color,
        alpha: shield.config.fire.visualInnerAlpha,
        flashAlpha: shield.config.fire.flashMaxAlpha * flashFrac,
      });
    }

    return synced;
  }

  private getAimAngle(playerId: string, fallback: number): number {
    const input = this.bridge.getPlayerInput(playerId);
    if (input) return dequantizeAngle(input.aim);
    return fallback;
  }
}