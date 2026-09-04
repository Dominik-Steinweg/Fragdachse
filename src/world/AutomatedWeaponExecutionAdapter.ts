import type {
  GaussUltimateConfig,
  WeaponConfig,
} from '../loadout/LoadoutConfig';
import { calcPelletAngles } from '../loadout/SpreadMath';
import type {
  SpecializedWeaponExecutionCapability,
  WeaponExecutionCapability,
  WeaponFireOptions,
} from '../loadout/WeaponFireExecutor';
import type { ProjectileExplosionConfig } from '../types';
import type { MuzzleOrigin } from '../config';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';
import { createSingleOwnerProvenance } from '../projectile/ProjectileSpawnRequest';
import { SpecializedWeaponExecutionAdapter } from './SpecializedWeaponExecutionAdapter';

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
  readonly gameplayMuzzleOrigin?: MuzzleOrigin;
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
    private readonly projectileSpawn: ProjectileSpawnPort,
    private readonly specializedExecution: SpecializedWeaponExecutionCapability = new SpecializedWeaponExecutionAdapter(projectileSpawn),
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
    this.projectileSpawn.spawnProjectile({
      origin: {
        x: params.x,
        y: params.y,
        angle: params.angle,
        gameplayMuzzleOrigin: params.gameplayMuzzleOrigin,
      },
      flight: {
        speed: config.projectileSpeed,
        size: config.projectileSize,
        lifetimeMs: lifetime,
        maxBounces: 0,
        isGrenade: false,
        remainingRangePx: config.range,
      },
      provenance: createSingleOwnerProvenance(params.ownerId, { weaponSourceId: config.id }),
      interaction: {
        directHit: {
          damage: config.damage,
          rockDamageMult: config.rockDamageMult,
          trainDamageMult: config.trainDamageMult,
          baseDamageMult: config.baseDamageMult,
          gaussChain: { radius: config.chainRadius, damageFactor: config.chainDamageFactor },
        },
      },
      presentation: {
        color: config.projectileColor,
        style: config.projectileStyle ?? 'gauss',
        ownerColor: params.ownerColor,
        visualScale: config.projectileVisualScale,
        bulletPreset: config.bulletVisualPreset,
        tracer: config.tracerConfig,
        shotAudioKey: config.shotAudio?.successKey,
      },
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
      case 'leaf_blower':
      case 'reinforcement_matrix':
      case 'energy_injector':
        return this.specializedExecution.fire(config, {
          ...params,
          sourceSlot: params.options?.sourceSlot,
        });
      case 'tesla_dome':
      case 'healing_aura':
      case 'energy_shield':
        return false;
      default:
        return false;
    }
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
