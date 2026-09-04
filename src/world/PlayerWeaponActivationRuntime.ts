import * as Phaser from 'phaser';
import type {
  LoadoutSlot,
  LoadoutUseParams,
  LoadoutUseResult,
  WeaponSlot,
} from '../types';
import type {
  EnergyShieldWeaponFireConfig,
  MeleeWeaponFireConfig,
  ProjectileWeaponFireConfig,
  WeaponConfig,
} from '../loadout/LoadoutConfig';
import { PLAYER_SIZE, type MuzzleOrigin } from '../config';
import { isVelocityMoving } from '../loadout/SpreadMath';
import { resolveShotPlan } from '../loadout/ShotPlanResolver';
import {
  getHeldWeaponGameplayMuzzleOrigin,
  getHeldWeaponMuzzleOrigin,
} from '../loadout/HeldItemVisuals';
import type {
  SpecializedWeaponExecutionCapability,
  WeaponExecutionCapability,
  WeaponFireOptions,
} from '../loadout/WeaponFireExecutor';
import type { Ak47BehaviorPort } from '../loadout/Ak47BehaviorPort';
import type { NegevBehaviorPort } from '../loadout/NegevBehaviorPort';

/** Equipment/readiness boundary owned by the World Loadout, consumed by weapon activation. */
export interface PlayerWeaponActivationLoadoutPort {
  isWeaponOnCooldown(playerId: string, slot: WeaponSlot, nowMs: number): boolean;
  getDynamicSpread(playerId: string, slot: WeaponSlot): number;
  addWeaponSpread(playerId: string, slot: WeaponSlot): void;
  recordWeaponUse(playerId: string, slot: WeaponSlot, nowMs: number): void;
  noteWeaponUsed(playerId: string, slot: WeaponSlot, nowMs: number): void;
}

/** Minimal player read needed for host-authoritative immediate weapon activation. */
export interface PlayerWeaponActivationPlayer {
  readonly x: number;
  readonly y: number;
  readonly color: number;
  readonly rotation?: number;
  readonly body?: { readonly velocity?: { readonly x?: number; readonly y?: number } };
  readonly displayObject?: { readonly displayWidth?: number };
}

export interface PlayerWeaponActivationPlayerPort {
  getPlayer(playerId: string): PlayerWeaponActivationPlayer | undefined;
}

export interface PlayerWeaponActivationResourcePort {
  resolveAdrenalineCost(playerId: string, baseCost: number): number;
  getAdrenaline(playerId: string): number;
  drainAdrenaline(playerId: string, amount: number, nowMs: number): void;
}

export interface PlayerWeaponActivationPhysicsPort {
  addRecoil(id: string, vx: number, vy: number, durationMs?: number): void;
}

export interface PlayerWeaponActivationRuntimeOptions {
  readonly playerManager: PlayerWeaponActivationPlayerPort;
  readonly loadout: PlayerWeaponActivationLoadoutPort;
  readonly resourceSystem: PlayerWeaponActivationResourcePort;
  readonly physicsSystem?: PlayerWeaponActivationPhysicsPort | null;
  readonly weaponExecution: WeaponExecutionCapability;
  readonly specializedWeaponExecution: SpecializedWeaponExecutionCapability;
  readonly ak47Behavior?: Pick<Ak47BehaviorPort, 'isFireSuperiorityAvailable' | 'prepareShot' | 'commitShot'> | null;
  readonly negevBehavior?: Pick<NegevBehaviorPort, 'prepareShot' | 'commitShot' | 'terminateStreak'> | null;
  readonly consumeMovementCharge?: ((playerId: string) => number) | null;
  readonly registerWeaponFired?: ((playerId: string, sourceSlot: WeaponSlot, nowMs: number) => void) | null;
  readonly broadcastShotFx?: ((shooterId: string, durationMs: number, intensity: number) => void) | null;
}

/** Semantic host request for one immediate equipped-weapon activation. */
export interface PlayerWeaponActivationRequest {
  readonly playerId: string;
  readonly slot: WeaponSlot;
  readonly config: WeaponConfig;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly nowMs: number;
  readonly shotId?: number;
  readonly params?: LoadoutUseParams;
}

/**
 * World-owned immediate weapon activation boundary.
 *
 * Equipment state/readiness remains in LoadoutManager. This owner performs the action-specific
 * resource commit and delegates the actual projectile/hitscan/melee payload to world-composed
 * capabilities. Behavior state is addressed through its narrow semantic ports.
 */
export class PlayerWeaponActivationRuntime {
  private destroyed = false;
  private readonly shotCounters = new Map<string, number>();
  private readonly okResult: LoadoutUseResult = { ok: true };

  constructor(private readonly options: PlayerWeaponActivationRuntimeOptions) {}

  activateWeapon(request: PlayerWeaponActivationRequest): LoadoutUseResult {
    if (this.destroyed) return { ok: false, reason: 'invalid' };

    const player = this.options.playerManager.getPlayer(request.playerId);
    if (!player) return { ok: false, reason: 'invalid' };

    if (this.options.loadout.isWeaponOnCooldown(request.playerId, request.slot, request.nowMs)) {
      return { ok: false, reason: 'cooldown' };
    }

    const cfg = request.config;
    const fireSuperiorityCanFire = cfg.id === 'AK47'
      && (this.options.ak47Behavior?.isFireSuperiorityAvailable(request.playerId) ?? false);

    const effectiveAdrenalineCost = fireSuperiorityCanFire
      ? 0
      : this.options.resourceSystem.resolveAdrenalineCost(request.playerId, cfg.adrenalinCost);
    if (effectiveAdrenalineCost > 0
      && this.options.resourceSystem.getAdrenaline(request.playerId) < effectiveAdrenalineCost) {
      if (cfg.id === 'NEGEV') {
        this.options.negevBehavior?.terminateStreak(request.playerId, request.nowMs);
      }
      return { ok: false, reason: 'resource', resourceKind: 'adrenaline' };
    }

    const isMoving = isVelocityMoving(
      player.body?.velocity?.x ?? 0,
      player.body?.velocity?.y ?? 0,
    );
    const scopeProgress = request.params?.scopeProgress;
    const warmupFraction = cfg.maxDynamicSpread < 0
      ? Math.min(
        1,
        Math.abs(this.options.loadout.getDynamicSpread(request.playerId, request.slot))
          / Math.max(0.0001, Math.abs(cfg.maxDynamicSpread)),
      )
      : 0;
    let shotCfg = (cfg.warmupBurnThreshold ?? 0) > 0
      && warmupFraction < (cfg.warmupBurnThreshold ?? 0)
      ? { ...cfg, burnOnHit: undefined }
      : cfg;

    if (cfg.id === 'AWP' && cfg.awpCharge) {
      const chargeProgress = Phaser.Math.Clamp(request.params?.scopeChargeProgress ?? 0, 0, 1);
      const fullyCharged = chargeProgress >= 0.999;
      const fullChargeMultiplier = fullyCharged ? 1 + cfg.awpCharge.fullChargeDamageBonus : 1;
      const corridorActive = fullyCharged && cfg.awpCharge.corridorEnabled > 0;
      shotCfg = {
        ...shotCfg,
        damage: shotCfg.damage * (1 + chargeProgress * cfg.awpCharge.maxDamageBonus) * fullChargeMultiplier,
        bulletVisualPreset: corridorActive
          ? 'awp_corridor'
          : fullyCharged ? 'awp_charged' : shotCfg.bulletVisualPreset,
        awpCharge: {
          ...cfg.awpCharge,
          fireTrailBurnDamagePerTick: cfg.awpCharge.fireTrailBurnDamagePerTick * fullChargeMultiplier,
          corridorEnabled: corridorActive ? cfg.awpCharge.corridorEnabled : 0,
          corridorDamage: cfg.awpCharge.corridorDamage * fullChargeMultiplier,
          fireTrailHalfWidthCells: fullyCharged ? cfg.awpCharge.fireTrailHalfWidthCells : 0,
        },
      };
    }

    const negevShot = cfg.id === 'NEGEV'
      ? this.options.negevBehavior?.prepareShot(request.playerId, shotCfg) ?? null
      : null;
    if (negevShot) shotCfg = negevShot.shotConfig;
    const ak47Shot = cfg.id === 'AK47'
      ? this.options.ak47Behavior?.prepareShot(request.playerId, shotCfg) ?? null
      : null;
    if (ak47Shot) shotCfg = ak47Shot.shotConfig;

    const fireControlSpreadMultiplier = ak47Shot?.fireControlSpreadMultiplier ?? 1;
    if (request.slot === 'weapon1') {
      const kineticBonus = this.options.consumeMovementCharge?.(request.playerId) ?? 0;
      if (kineticBonus > 0) shotCfg = { ...shotCfg, damage: shotCfg.damage * (1 + kineticBonus) };
    }

    const shotPlan = resolveShotPlan({
      config: shotCfg,
      aimAngle: request.angle,
      dynamicSpread: this.options.loadout.getDynamicSpread(request.playerId, request.slot),
      isMoving,
      scopeProgress,
      fireControlSpreadMultiplier,
      random: Math.random,
    });

    let didFire = false;
    for (const shot of shotPlan.shots) {
      const fired = this.dispatchWeaponFire(
        shot.config,
        request.x,
        request.y,
        shot.angle,
        request.targetX,
        request.targetY,
        request.playerId,
        player.color,
        request.slot,
        request.shotId,
        undefined,
        this.getGameplayMuzzleOrigin(request.playerId, shot.config.id, request.x, request.y, shot.angle),
      );
      if (fired) didFire = true;
    }
    if (!didFire) return { ok: false, reason: 'blocked' };

    if (negevShot) this.options.negevBehavior?.commitShot(request.playerId, request.nowMs);
    if (ak47Shot) {
      this.options.ak47Behavior?.commitShot(
        request.playerId,
        ak47Shot.shotId,
        ak47Shot.fireSuperiorityShot,
      );
    }

    if ((shotCfg.sideBurstEveryShots ?? 0) > 0 && (shotCfg.sideBurstCount ?? 0) >= 2) {
      const counterKey = `${request.playerId}:${request.slot}:${shotCfg.id}`;
      const count = (this.shotCounters.get(counterKey) ?? 0) + 1;
      this.shotCounters.set(counterKey, count);
      if (count % (shotCfg.sideBurstEveryShots ?? 1) === 0) {
        const sideAngle = (shotCfg.sideBurstAngleDegrees ?? 0) * Math.PI / 180;
        const sideCfg = {
          ...shotCfg,
          damage: shotCfg.damage * (shotCfg.sideBurstDamageFactor ?? 0),
          sideBurstEveryShots: 0,
          shotAudio: undefined,
        };
        this.dispatchWeaponFire(
          sideCfg,
          request.x,
          request.y,
          request.angle - sideAngle,
          request.targetX,
          request.targetY,
          request.playerId,
          player.color,
          request.slot,
          request.shotId,
          undefined,
          this.getGameplayMuzzleOrigin(request.playerId, sideCfg.id, request.x, request.y, request.angle - sideAngle),
        );
        this.dispatchWeaponFire(
          sideCfg,
          request.x,
          request.y,
          request.angle + sideAngle,
          request.targetX,
          request.targetY,
          request.playerId,
          player.color,
          request.slot,
          request.shotId,
          undefined,
          this.getGameplayMuzzleOrigin(request.playerId, sideCfg.id, request.x, request.y, request.angle + sideAngle),
        );
      }
    }

    if (effectiveAdrenalineCost > 0) {
      this.options.resourceSystem.drainAdrenaline(
        request.playerId,
        cfg.adrenalinCost,
        request.nowMs,
      );
    }

    this.options.loadout.addWeaponSpread(request.playerId, request.slot);
    this.options.loadout.recordWeaponUse(request.playerId, request.slot, request.nowMs);

    if (cfg.shotRecoilForce) {
      this.options.physicsSystem?.addRecoil(
        request.playerId,
        -Math.cos(request.angle) * cfg.shotRecoilForce,
        -Math.sin(request.angle) * cfg.shotRecoilForce,
        cfg.shotRecoilDuration ?? 180,
      );
    }

    if (cfg.shotScreenShake) {
      this.options.broadcastShotFx?.(
        request.playerId,
        cfg.shotScreenShake.duration,
        cfg.shotScreenShake.intensity,
      );
    }

    return this.okResult;
  }

  /** Applies post-dispatch observations that remain owned by the equipped Loadout. */
  noteWeaponFired(playerId: string, slot: WeaponSlot, nowMs: number): void {
    if (this.destroyed) return;
    if (slot === 'weapon2') this.options.registerWeaponFired?.(playerId, slot, nowMs);
    this.options.loadout.noteWeaponUsed(playerId, slot, nowMs);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.shotCounters.clear();
  }

  private dispatchWeaponFire(
    config: WeaponConfig,
    x: number,
    y: number,
    angle: number,
    targetX: number,
    targetY: number,
    playerId: string,
    playerColor: number,
    sourceSlot?: LoadoutSlot,
    shotId?: number,
    options?: WeaponFireOptions,
    gameplayMuzzleOrigin?: MuzzleOrigin,
  ): boolean {
    const visualMuzzleOrigin = this.getVisualMuzzleOrigin(playerId, config.id);
    switch (config.fire.type) {
      case 'projectile':
        return this.fireProjectileWeapon(config, config.fire, x, y, angle, targetX, targetY, playerId, playerColor, sourceSlot, options, visualMuzzleOrigin, gameplayMuzzleOrigin);
      case 'hitscan':
        return this.fireHitscanWeapon(config, config.fire, x, y, angle, targetX, targetY, playerId, playerColor, sourceSlot as WeaponSlot | undefined, shotId, visualMuzzleOrigin, gameplayMuzzleOrigin);
      case 'melee':
        return this.fireMeleeWeapon(config, config.fire, x, y, angle, playerId, playerColor, sourceSlot as WeaponSlot | undefined);
      case 'flamethrower':
      case 'leaf_blower':
      case 'reinforcement_matrix':
      case 'energy_injector':
        return this.options.specializedWeaponExecution.fire(config, {
          x,
          y,
          angle,
          targetX,
          targetY,
          ownerId: playerId,
          ownerColor: playerColor,
          sourceSlot,
          options,
          visualMuzzleOrigin,
          gameplayMuzzleOrigin: config.fire.type === 'reinforcement_matrix'
            ? this.getGameplayMuzzleOrigin(
              playerId,
              config.id,
              x,
              y,
              resolveReinforcementAimAngle(x, y, angle, targetX, targetY),
            )
            : gameplayMuzzleOrigin,
        });
      case 'tesla_dome':
      case 'healing_aura':
      case 'energy_shield':
        return false;
      default:
        return false;
    }
  }

  private getVisualMuzzleOrigin(playerId: string, itemId: string): MuzzleOrigin | undefined {
    const player = this.options.playerManager.getPlayer(playerId);
    if (!player) return undefined;
    return getHeldWeaponMuzzleOrigin(
      itemId,
      player.x,
      player.y,
      player.rotation ?? 0,
      player.displayObject?.displayWidth ?? PLAYER_SIZE,
    ) ?? undefined;
  }

  private getGameplayMuzzleOrigin(
    playerId: string,
    itemId: string,
    gameplayX: number,
    gameplayY: number,
    angle: number,
  ): MuzzleOrigin | undefined {
    const player = this.options.playerManager.getPlayer(playerId);
    if (!player) return undefined;
    return getHeldWeaponGameplayMuzzleOrigin(
      itemId,
      gameplayX,
      gameplayY,
      angle,
      player.displayObject?.displayWidth ?? PLAYER_SIZE,
    ) ?? undefined;
  }

  private fireProjectileWeapon(
    config: WeaponConfig,
    fireConfig: ProjectileWeaponFireConfig,
    x: number,
    y: number,
    angle: number,
    targetX: number,
    targetY: number,
    playerId: string,
    playerColor: number,
    sourceSlot?: LoadoutSlot,
    options?: WeaponFireOptions,
    visualMuzzleOrigin?: MuzzleOrigin,
    gameplayMuzzleOrigin?: MuzzleOrigin,
  ): boolean {
    void fireConfig;
    return this.options.weaponExecution.fire(config, {
      x,
      y,
      angle,
      targetX,
      targetY,
      ownerId: playerId,
      ownerColor: playerColor,
      sourceSlot,
      options,
      gameplayMuzzleOrigin,
      visualMuzzleOrigin,
      resolvePaidAdrenalineCost: () => Math.min(
        this.options.resourceSystem.getAdrenaline(playerId),
        this.options.resourceSystem.resolveAdrenalineCost(playerId, config.adrenalinCost),
      ),
    });
  }

  private fireHitscanWeapon(
    config: WeaponConfig,
    fireConfig: import('../loadout/LoadoutConfig').HitscanWeaponFireConfig,
    x: number,
    y: number,
    angle: number,
    targetX: number,
    targetY: number,
    playerId: string,
    playerColor: number,
    sourceSlot: WeaponSlot | undefined,
    shotId: number | undefined,
    visualMuzzleOrigin?: MuzzleOrigin,
    gameplayMuzzleOrigin?: MuzzleOrigin,
  ): boolean {
    void fireConfig;
    return this.options.weaponExecution.fire(config, {
      x,
      y,
      angle,
      targetX,
      targetY,
      ownerId: playerId,
      ownerColor: playerColor,
      sourceSlot,
      shotId,
      gameplayMuzzleOrigin,
      visualMuzzleOrigin,
    });
  }

  private fireMeleeWeapon(
    config: WeaponConfig,
    fireConfig: MeleeWeaponFireConfig,
    x: number,
    y: number,
    angle: number,
    playerId: string,
    playerColor: number,
    sourceSlot?: WeaponSlot,
  ): boolean {
    void fireConfig;
    return this.options.weaponExecution.fire(config, {
      x,
      y,
      angle,
      targetX: x,
      targetY: y,
      ownerId: playerId,
      ownerColor: playerColor,
      sourceSlot,
    });
  }
}

function resolveReinforcementAimAngle(
  x: number,
  y: number,
  fallbackAngle: number,
  targetX: number,
  targetY: number,
): number {
  const dx = targetX - x;
  const dy = targetY - y;
  return Math.hypot(dx, dy) > 0.001 ? Math.atan2(dy, dx) : fallbackAngle;
}
