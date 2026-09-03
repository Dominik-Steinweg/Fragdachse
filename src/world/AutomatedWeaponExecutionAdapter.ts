import type { ProjectileManager } from '../entities/ProjectileManager';
import type {
  EnergyInjectorWeaponFireConfig,
  FlamethrowerWeaponFireConfig,
  GaussUltimateConfig,
  LeafBlowerWeaponFireConfig,
  ReinforcementMatrixWeaponFireConfig,
  WeaponConfig,
} from '../loadout/LoadoutConfig';
import { calcPelletAngles } from '../loadout/SpreadMath';
import type { WeaponExecutionCapability, WeaponFireOptions } from '../loadout/WeaponFireExecutor';
import type { ProjectileExplosionConfig } from '../types';

type AutomatedWeaponProjectileSink = Pick<ProjectileManager, 'spawnProjectile'>;

/** Request data owned by an automatic source; timing/readiness stays with that source. */
export interface AutomatedWeaponFireParams {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly ownerId: string;
  readonly ownerColor: number;
  readonly options?: WeaponFireOptions;
}

export interface AutomatedGaussFireParams {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly ownerId: string;
  readonly ownerColor: number;
}

/**
 * Small adapter for non-player weapon sources.
 *
 * Common Projectile/Hitscan/Melee semantics enter the world-composed
 * `WeaponExecutionCapability`. The few automatic payloads that are not part of that shared
 * capability stay explicit here, instead of making LoadoutManager a shared fire service or
 * widening the common executor into a universal one.
 */
export interface AutomatedWeaponExecution {
  fire(config: WeaponConfig, params: AutomatedWeaponFireParams): boolean;
  fireGauss(config: GaussUltimateConfig, params: AutomatedGaussFireParams): boolean;
}

export class AutomatedWeaponExecutionAdapter implements AutomatedWeaponExecution {
  constructor(
    private readonly sharedExecution: WeaponExecutionCapability,
    private readonly projectileManager: AutomatedWeaponProjectileSink,
  ) {}

  fire(config: WeaponConfig, params: AutomatedWeaponFireParams): boolean {
    const resolvedConfig = scaleAutomatedWeaponDamage(
      config,
      params.options?.directDamageMultiplier ?? 1,
      params.options?.payloadDamageMultiplier ?? params.options?.directDamageMultiplier ?? 1,
    );
    const pelletCount = Math.max(
      1,
      Math.round((resolvedConfig.pelletCount ?? 1) * (resolvedConfig.pelletCountMultiplier ?? 1)),
    );
    if (pelletCount <= 1) return this.fireSingle(resolvedConfig, params);

    const pelletOffsets = calcPelletAngles(pelletCount, resolvedConfig.pelletSpreadAngle ?? 0);
    let didFire = false;
    for (let pelletIndex = 0; pelletIndex < pelletOffsets.length; pelletIndex += 1) {
      const pelletConfig = pelletIndex === 0
        ? resolvedConfig
        : { ...resolvedConfig, shotAudio: undefined };
      const pelletFired = this.fireSingle(pelletConfig, {
        ...params,
        angle: params.angle + pelletOffsets[pelletIndex],
      });
      didFire = pelletFired || didFire;
    }
    return didFire;
  }

  fireGauss(config: GaussUltimateConfig, params: AutomatedGaussFireParams): boolean {
    const lifetime = (config.range / config.projectileSpeed) * 1000;
    this.projectileManager.spawnProjectile(params.x, params.y, params.angle, params.ownerId, {
      speed: config.projectileSpeed,
      size: config.projectileSize,
      damage: config.damage,
      color: config.projectileColor,
      ownerColor: params.ownerColor,
      projectileVisualScale: config.projectileVisualScale,
      lifetime,
      maxBounces: 0,
      isGrenade: false,
      adrenalinGain: 0,
      sourceId: config.id,
      projectileStyle: config.projectileStyle ?? 'gauss',
      bulletVisualPreset: config.bulletVisualPreset,
      tracerConfig: config.tracerConfig,
      rockDamageMult: config.rockDamageMult,
      trainDamageMult: config.trainDamageMult,
      baseDamageMult: config.baseDamageMult,
      shotAudioKey: config.shotAudio?.successKey,
      gaussChainRadius: config.chainRadius,
      gaussChainDamageFactor: config.chainDamageFactor,
      remainingRangePx: config.range,
    });
    return true;
  }

  private fireSingle(config: WeaponConfig, params: AutomatedWeaponFireParams): boolean {
    switch (config.fire.type) {
      case 'projectile':
      case 'hitscan':
      case 'melee':
        return this.sharedExecution.fire(config, {
          ...params,
          sourceSlot: params.options?.sourceSlot,
        });
      case 'flamethrower':
        return this.fireFlamethrower(config, config.fire, params);
      case 'leaf_blower':
        return this.fireLeafBlower(config, config.fire, params);
      case 'reinforcement_matrix':
        return this.fireReinforcementMatrix(config, config.fire, params);
      case 'energy_injector':
        return this.fireEnergyInjector(config, config.fire, params);
      case 'tesla_dome':
      case 'healing_aura':
      case 'energy_shield':
        return false;
      default:
        return false;
    }
  }

  private fireFlamethrower(
    config: WeaponConfig,
    fireConfig: FlamethrowerWeaponFireConfig,
    params: AutomatedWeaponFireParams,
  ): boolean {
    const fireball = fireConfig.fireball;
    if ((fireball?.enabled ?? 0) > 0) {
      const groundEffect = {
        durationMs: fireball?.groundDurationMs ?? 2000,
        burnDurationMs: fireConfig.burnDurationMs,
        burnDamagePerTick: fireball?.groundBurnDamagePerTick ?? 0.5,
        sourceId: 'weapon.fireball_fire',
        baseDamageMult: config.baseDamageMult ?? 1,
      };
      const chunkCount = Math.max(0, Math.floor(fireball?.chunkCount ?? 0));
      this.projectileManager.spawnProjectile(params.x, params.y, params.angle, params.ownerId, {
        speed: fireball?.projectileSpeed ?? 450,
        ignoreBaseCollisions: params.options?.ignoreBaseCollisions,
        ignoreRockIndex: params.options?.ignoreRockIndex,
        size: fireball?.projectileSize ?? 28,
        damage: config.damage,
        color: 0xff7417,
        ownerColor: params.ownerColor,
        lifetime: config.range / Math.max(1, fireball?.projectileSpeed ?? 450) * 1000,
        maxBounces: 0,
        isGrenade: false,
        adrenalinGain: config.adrenalinGain,
        sourceId: 'weapon.fireball_launcher',
        projectileStyle: 'fireball',
        rockDamageMult: 1,
        trainDamageMult: 1.15,
        explosion: {
          radius: fireball?.explosionRadius ?? 120,
          maxDamage: fireball?.explosionMaxDamage ?? 90,
          minDamage: fireball?.explosionMinDamage ?? 20,
          knockback: fireball?.explosionKnockback ?? 1250,
          selfDamageMult: fireball?.selfDamageMult ?? 0.25,
          rockDamageMult: 1,
          trainDamageMult: 1.15,
          baseDamageMult: config.baseDamageMult ?? 1,
          color: 0xff6a14,
          visualStyle: 'rocket',
          burnOnHit: { durationMs: fireConfig.burnDurationMs, damagePerTick: fireConfig.burnDamagePerTick },
          burnOrigin: 'flamethrower_direct',
          fireChunkBurst: {
            ...groundEffect,
            count: chunkCount,
            searchRadius: fireball?.chunkSearchRadius ?? 96,
            flightMs: fireball?.chunkFlightMs ?? 320,
            igniteCenter: true,
          },
        },
        fireTrail: (fireball?.trailEnabled ?? 0) > 0 ? groundEffect : undefined,
        sourceSlot: params.options?.sourceSlot,
        sourceTurretId: params.options?.sourceTurretId,
        shotAudioKey: config.shotAudio?.successKey,
      });
      return true;
    }

    const lifetime = calculateDecayLifetime(config.range, fireConfig.projectileSpeed, fireConfig.velocityDecay);
    this.projectileManager.spawnProjectile(params.x, params.y, params.angle, params.ownerId, {
      speed: fireConfig.projectileSpeed,
      ignoreBaseCollisions: params.options?.ignoreBaseCollisions,
      ignoreRockIndex: params.options?.ignoreRockIndex,
      size: fireConfig.hitboxStartSize,
      damage: config.damage,
      color: config.projectileColor ?? params.ownerColor,
      ownerColor: params.ownerColor,
      lifetime,
      maxBounces: 999999,
      isGrenade: false,
      adrenalinGain: config.adrenalinGain,
      sourceId: config.id,
      projectileStyle: 'flame',
      rockDamageMult: config.rockDamageMult,
      trainDamageMult: config.trainDamageMult,
      isFlame: true,
      hitboxGrowRate: fireConfig.hitboxGrowRate,
      hitboxMaxSize: fireConfig.hitboxEndSize,
      velocityDecay: fireConfig.velocityDecay,
      burnDurationMs: fireConfig.burnDurationMs,
      burnDamagePerTick: fireConfig.burnDamagePerTick,
      projectileBurnVisualStyle: config.projectileBurnVisualStyle,
      flamePiercing: (fireConfig.piercingCount ?? 0) > 0,
      sourceSlot: params.options?.sourceSlot,
      sourceTurretId: params.options?.sourceTurretId,
      shotAudioKey: config.shotAudio?.successKey,
    });
    return true;
  }

  private fireLeafBlower(
    config: WeaponConfig,
    fireConfig: LeafBlowerWeaponFireConfig,
    params: AutomatedWeaponFireParams,
  ): boolean {
    const lifetime = calculateDecayLifetime(config.range, fireConfig.projectileSpeed, fireConfig.velocityDecay);
    const debuffHit = (config.hitDebuffChance ?? 0) > 0 && Math.random() < (config.hitDebuffChance ?? 0);
    this.projectileManager.spawnProjectile(params.x, params.y, params.angle, params.ownerId, {
      speed: fireConfig.projectileSpeed,
      ignoreBaseCollisions: params.options?.ignoreBaseCollisions,
      ignoreRockIndex: params.options?.ignoreRockIndex,
      size: fireConfig.hitboxStartSize,
      damage: config.directDamageOverride ?? config.damage,
      color: config.projectileColor ?? params.ownerColor,
      ownerColor: params.ownerColor,
      lifetime,
      maxBounces: 999999,
      isGrenade: false,
      adrenalinGain: config.adrenalinGain,
      sourceId: config.id,
      projectileStyle: 'leaf_blower',
      rockDamageMult: config.rockDamageMult,
      trainDamageMult: config.trainDamageMult,
      hitboxGrowRate: fireConfig.hitboxGrowRate,
      hitboxMaxSize: fireConfig.hitboxEndSize,
      velocityDecay: fireConfig.velocityDecay,
      leafBlowerMinKnockback: fireConfig.minKnockback,
      leafBlowerMaxKnockback: fireConfig.maxKnockback,
      leafBlowerSelfPush: fireConfig.selfPush,
      leafBlowerDeflectsProjectiles: fireConfig.deflectProjectiles > 0,
      hitSlowFraction: debuffHit ? config.hitSlowFraction : undefined,
      hitSlowDurationMs: debuffHit ? config.hitSlowDurationMs : undefined,
      hitVulnerabilityDurationMs: debuffHit ? config.hitVulnerabilityDurationMs : undefined,
      sourceSlot: params.options?.sourceSlot,
      sourceTurretId: params.options?.sourceTurretId,
      shotAudioKey: config.shotAudio?.successKey,
    });
    return true;
  }

  private fireReinforcementMatrix(
    config: WeaponConfig,
    fireConfig: ReinforcementMatrixWeaponFireConfig,
    params: AutomatedWeaponFireParams,
  ): boolean {
    const dx = params.targetX - params.x;
    const dy = params.targetY - params.y;
    const cursorDistance = Math.hypot(dx, dy);
    const travelDistance = Math.min(config.range, cursorDistance);
    const angle = cursorDistance > 0.001 ? Math.atan2(dy, dx) : params.angle;
    const lifetime = (travelDistance / fireConfig.projectileSpeed) * 1000;
    this.projectileManager.spawnProjectile(params.x, params.y, angle, params.ownerId, {
      speed: fireConfig.projectileSpeed,
      size: fireConfig.projectileSize,
      damage: 0,
      color: config.projectileColor ?? fireConfig.fieldColor,
      ownerColor: params.ownerColor,
      projectileVisualScale: config.projectileVisualScale,
      smokeTrailColor: config.rocketSmokeTrailColor ?? fireConfig.fieldColor,
      lifetime,
      remainingRangePx: travelDistance,
      maxBounces: 0,
      isGrenade: false,
      adrenalinGain: 0,
      sourceId: config.id,
      explosion: {
        radius: fireConfig.radius,
        maxDamage: 0,
        knockback: 0,
        selfDamageMult: 0,
        rockDamageMult: 0,
        trainDamageMult: 0,
        color: fireConfig.fieldColor,
        reinforcementMatrix: {
          durationMs: fireConfig.durationMs,
          damageReduction: fireConfig.damageReduction,
          vulnerabilityBonus: fireConfig.vulnerabilityBonus,
          color: fireConfig.fieldColor,
        },
      },
      projectileStyle: config.projectileStyle,
      sourceSlot: params.options?.sourceSlot ?? 'weapon2',
      shotAudioKey: config.shotAudio?.successKey,
    });
    return true;
  }

  private fireEnergyInjector(
    config: WeaponConfig,
    fireConfig: EnergyInjectorWeaponFireConfig,
    params: AutomatedWeaponFireParams,
  ): boolean {
    this.projectileManager.spawnProjectile(params.x, params.y, params.angle, params.ownerId, {
      speed: fireConfig.projectileSpeed,
      size: fireConfig.projectileSize,
      damage: 0,
      color: config.projectileColor ?? fireConfig.injectorColor,
      ownerColor: params.ownerColor,
      projectileVisualScale: config.projectileVisualScale,
      lifetime: (config.range / fireConfig.projectileSpeed) * 1000,
      remainingRangePx: config.range,
      maxBounces: 0,
      isGrenade: false,
      adrenalinGain: 0,
      sourceId: config.id,
      rockDamageMult: 0,
      trainDamageMult: 0,
      energyInjectorPayload: {
        durationMs: fireConfig.durationMs,
        focusDurationMs: fireConfig.focusDurationMs,
        vulnerabilityBonus: fireConfig.vulnerabilityBonus,
        color: fireConfig.injectorColor,
      },
      projectileStyle: config.projectileStyle,
      energyBallVariant: config.energyBallVariant,
      sourceSlot: params.options?.sourceSlot ?? 'weapon2',
      shotAudioKey: config.shotAudio?.successKey,
    });
    return true;
  }
}

function calculateDecayLifetime(range: number, projectileSpeed: number, decay: number): number {
  if (decay >= 1 || decay <= 0) return (range / projectileSpeed) * 1000;

  const lnDecay = Math.log(decay);
  const maxDist = projectileSpeed / -lnDecay;
  const distRatio = range / maxDist;
  if (distRatio >= 1) return 3000;

  return Math.log(1 - distRatio) / lnDecay * 1000;
}

function scaleAutomatedWeaponDamage(
  config: WeaponConfig,
  directDamageMultiplier: number,
  payloadDamageMultiplier: number,
): WeaponConfig {
  const directFactor = Math.max(0, directDamageMultiplier);
  const payloadFactor = Math.max(0, payloadDamageMultiplier);
  const baseConfig: WeaponConfig = {
    ...config,
    damage: config.damage * directFactor,
    directDamageOverride: config.directDamageOverride === undefined
      ? undefined
      : config.directDamageOverride * directFactor,
    burnOnHit: config.burnOnHit
      ? { ...config.burnOnHit, damagePerTick: config.burnOnHit.damagePerTick * payloadFactor }
      : undefined,
  };

  if (config.fire.type === 'projectile') {
    return {
      ...baseConfig,
      fire: {
        ...config.fire,
        impactExplosion: scaleAutomatedExplosion(config.fire.impactExplosion, payloadFactor),
        enemyHitExplosion: scaleAutomatedExplosion(config.fire.enemyHitExplosion, payloadFactor),
        impactCloud: config.fire.impactCloud
          ? { ...config.fire.impactCloud, damagePerTick: config.fire.impactCloud.damagePerTick * payloadFactor }
          : undefined,
      },
    };
  }

  if (config.fire.type === 'flamethrower') {
    return {
      ...baseConfig,
      fire: {
        ...config.fire,
        burnDamagePerTick: config.fire.burnDamagePerTick * payloadFactor,
        fireball: config.fire.fireball
          ? {
            ...config.fire.fireball,
            explosionMaxDamage: config.fire.fireball.explosionMaxDamage * payloadFactor,
            explosionMinDamage: config.fire.fireball.explosionMinDamage * payloadFactor,
            groundBurnDamagePerTick: config.fire.fireball.groundBurnDamagePerTick * payloadFactor,
          }
          : undefined,
      },
    };
  }

  if (config.fire.type === 'tesla_dome') {
    return {
      ...baseConfig,
      fire: {
        ...config.fire,
        damagePerTick: config.fire.damagePerTick * payloadFactor,
      },
    };
  }

  return baseConfig;
}

function scaleAutomatedExplosion(
  effect: ProjectileExplosionConfig | undefined,
  multiplier: number,
): ProjectileExplosionConfig | undefined {
  if (!effect) return undefined;
  return {
    ...effect,
    maxDamage: effect.maxDamage * multiplier,
    minDamage: effect.minDamage === undefined ? undefined : effect.minDamage * multiplier,
    burnOnHit: effect.burnOnHit
      ? { ...effect.burnOnHit, damagePerTick: effect.burnOnHit.damagePerTick * multiplier }
      : undefined,
    groundFire: effect.groundFire
      ? {
        ...effect.groundFire,
        damagePerTick: effect.groundFire.damagePerTick * multiplier,
        burnDamagePerTick: effect.groundFire.burnDamagePerTick === undefined
          ? undefined
          : effect.groundFire.burnDamagePerTick * multiplier,
      }
      : undefined,
    fireChunkBurst: effect.fireChunkBurst
      ? {
        ...effect.fireChunkBurst,
        burnDamagePerTick: effect.fireChunkBurst.burnDamagePerTick * multiplier,
      }
      : undefined,
  };
}
