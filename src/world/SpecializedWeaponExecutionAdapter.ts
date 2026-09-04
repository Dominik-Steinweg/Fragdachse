import type {
  EnergyInjectorWeaponFireConfig,
  FlamethrowerWeaponFireConfig,
  LeafBlowerWeaponFireConfig,
  ReinforcementMatrixWeaponFireConfig,
  WeaponConfig,
} from '../loadout/LoadoutConfig';
import type {
  SpecializedWeaponExecutionCapability,
  WeaponFireParams,
} from '../loadout/WeaponFireExecutor';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';
import { createSingleOwnerProvenance } from '../projectile/ProjectileSpawnRequest';

/**
 * Führt die unmittelbaren Spezial-Projektiltypen aus, die bewusst nicht zum gemeinsamen
 * Projectile-/Hitscan-/Melee-Executor gehören.
 *
 * Der Adapter besitzt weder Player-Lifecycle noch Ressourcen-, Cooldown- oder Commit-State.
 * Alle Owner-, Slot-, Muzzle- und automatischen Quellenangaben kommen aus dem Auftrag; jede
 * Spezialwirkung verlässt die Execution als aufgelöster Spawn-Auftrag.
 */
export class SpecializedWeaponExecutionAdapter implements SpecializedWeaponExecutionCapability {
  constructor(private readonly projectileSpawn: ProjectileSpawnPort) {}

  fire(config: WeaponConfig, params: WeaponFireParams): boolean {
    switch (config.fire.type) {
      case 'flamethrower':
        return this.fireFlamethrower(config, config.fire, params);
      case 'leaf_blower':
        return this.fireLeafBlower(config, config.fire, params);
      case 'reinforcement_matrix':
        return this.fireReinforcementMatrix(config, config.fire, params);
      case 'energy_injector':
        return this.fireEnergyInjector(config, config.fire, params);
      default:
        return false;
    }
  }

  private fireFlamethrower(
    config: WeaponConfig,
    fireConfig: FlamethrowerWeaponFireConfig,
    params: WeaponFireParams,
  ): boolean {
    const fireball = fireConfig.fireball;
    const sourceSlot = resolveSourceSlot(params);
    if ((fireball?.enabled ?? 0) > 0) {
      const groundEffect = {
        durationMs: fireball?.groundDurationMs ?? 2000,
        burnDurationMs: fireConfig.burnDurationMs,
        burnDamagePerTick: fireball?.groundBurnDamagePerTick ?? 0.5,
        sourceId: 'weapon.fireball_fire',
        baseDamageMult: config.baseDamageMult ?? 1,
      };
      const chunkCount = Math.max(0, Math.floor(fireball?.chunkCount ?? 0));
      this.projectileSpawn.spawnProjectile({
        origin: { x: params.x, y: params.y, angle: params.angle, gameplayMuzzleOrigin: params.gameplayMuzzleOrigin },
        flight: {
          speed: fireball?.projectileSpeed ?? 450,
          size: fireball?.projectileSize ?? 28,
          lifetimeMs: config.range / Math.max(1, fireball?.projectileSpeed ?? 450) * 1000,
          maxBounces: 0,
          isGrenade: false,
          collisionFilter: {
            ignoreBaseCollisions: params.options?.ignoreBaseCollisions,
            ignoreRockIndex: params.options?.ignoreRockIndex,
          },
        },
        provenance: createSingleOwnerProvenance(params.ownerId, {
          weaponSourceId: 'weapon.fireball_launcher',
          sourceSlot,
          sourceTurretId: params.options?.sourceTurretId,
        }),
        interaction: {
          directHit: {
            damage: config.damage,
            adrenalinGain: config.adrenalinGain,
            rockDamageMult: 1,
            trainDamageMult: 1.15,
          },
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
          pathEffect: (fireball?.trailEnabled ?? 0) > 0 ? { fireTrail: groundEffect } : undefined,
        },
        presentation: {
          color: 0xff7417,
          style: 'fireball',
          ownerColor: params.ownerColor,
          shotAudioKey: config.shotAudio?.successKey,
          visualMuzzleOrigin: params.visualMuzzleOrigin,
        },
      });
      return true;
    }

    const lifetime = calculateDecayLifetime(config.range, fireConfig.projectileSpeed, fireConfig.velocityDecay);
    this.projectileSpawn.spawnProjectile({
      origin: { x: params.x, y: params.y, angle: params.angle, gameplayMuzzleOrigin: params.gameplayMuzzleOrigin },
      flight: {
        speed: fireConfig.projectileSpeed,
        size: fireConfig.hitboxStartSize,
        lifetimeMs: lifetime,
        maxBounces: 999999,
        isGrenade: false,
        isFlame: true,
        flamePiercing: (fireConfig.piercingCount ?? 0) > 0,
        collisionFilter: {
          ignoreBaseCollisions: params.options?.ignoreBaseCollisions,
          ignoreRockIndex: params.options?.ignoreRockIndex,
        },
        hitboxGrowth: { growRatePerSec: fireConfig.hitboxGrowRate, maxSize: fireConfig.hitboxEndSize },
        drag: { velocityDecayPerSec: fireConfig.velocityDecay },
      },
      provenance: createSingleOwnerProvenance(params.ownerId, {
        weaponSourceId: config.id,
        sourceSlot,
        sourceTurretId: params.options?.sourceTurretId,
      }),
      interaction: {
        directHit: {
          damage: config.damage,
          adrenalinGain: config.adrenalinGain,
          rockDamageMult: config.rockDamageMult,
          trainDamageMult: config.trainDamageMult,
        },
        burn: {
          durationMs: fireConfig.burnDurationMs,
          damagePerTick: fireConfig.burnDamagePerTick,
          visualStyle: config.projectileBurnVisualStyle,
        },
      },
      presentation: {
        color: config.projectileColor ?? params.ownerColor,
        style: 'flame',
        ownerColor: params.ownerColor,
        shotAudioKey: config.shotAudio?.successKey,
        visualMuzzleOrigin: params.visualMuzzleOrigin,
      },
    });
    return true;
  }

  private fireLeafBlower(
    config: WeaponConfig,
    fireConfig: LeafBlowerWeaponFireConfig,
    params: WeaponFireParams,
  ): boolean {
    const lifetime = calculateDecayLifetime(config.range, fireConfig.projectileSpeed, fireConfig.velocityDecay);
    // Der Debuff-Wurf fällt pro Luftstoß: ein Stoß verbraucht sich am ersten Ziel.
    const debuffHit = (config.hitDebuffChance ?? 0) > 0 && Math.random() < (config.hitDebuffChance ?? 0);
    this.projectileSpawn.spawnProjectile({
      origin: { x: params.x, y: params.y, angle: params.angle, gameplayMuzzleOrigin: params.gameplayMuzzleOrigin },
      flight: {
        speed: fireConfig.projectileSpeed,
        size: fireConfig.hitboxStartSize,
        lifetimeMs: lifetime,
        maxBounces: 999999,
        isGrenade: false,
        collisionFilter: {
          ignoreBaseCollisions: params.options?.ignoreBaseCollisions,
          ignoreRockIndex: params.options?.ignoreRockIndex,
        },
        hitboxGrowth: { growRatePerSec: fireConfig.hitboxGrowRate, maxSize: fireConfig.hitboxEndSize },
        drag: { velocityDecayPerSec: fireConfig.velocityDecay },
      },
      provenance: createSingleOwnerProvenance(params.ownerId, {
        weaponSourceId: config.id,
        sourceSlot: resolveSourceSlot(params),
        sourceTurretId: params.options?.sourceTurretId,
      }),
      interaction: {
        directHit: {
          damage: config.directDamageOverride ?? config.damage,
          adrenalinGain: config.adrenalinGain,
          rockDamageMult: config.rockDamageMult,
          trainDamageMult: config.trainDamageMult,
          slowFraction: debuffHit ? config.hitSlowFraction : undefined,
          slowDurationMs: debuffHit ? config.hitSlowDurationMs : undefined,
          vulnerabilityDurationMs: debuffHit ? config.hitVulnerabilityDurationMs : undefined,
        },
        impulse: {
          minKnockback: fireConfig.minKnockback,
          maxKnockback: fireConfig.maxKnockback,
          selfPush: fireConfig.selfPush,
          deflectsProjectiles: fireConfig.deflectProjectiles > 0,
        },
      },
      presentation: {
        color: config.projectileColor ?? params.ownerColor,
        style: 'leaf_blower',
        ownerColor: params.ownerColor,
        shotAudioKey: config.shotAudio?.successKey,
        visualMuzzleOrigin: params.visualMuzzleOrigin,
      },
    });
    return true;
  }

  private fireReinforcementMatrix(
    config: WeaponConfig,
    fireConfig: ReinforcementMatrixWeaponFireConfig,
    params: WeaponFireParams,
  ): boolean {
    const dx = params.targetX - params.x;
    const dy = params.targetY - params.y;
    const cursorDistance = Math.hypot(dx, dy);
    const travelDistance = Math.min(config.range, cursorDistance);
    const angle = cursorDistance > 0.001 ? Math.atan2(dy, dx) : params.angle;
    const lifetime = (travelDistance / fireConfig.projectileSpeed) * 1000;
    this.projectileSpawn.spawnProjectile({
      origin: { x: params.x, y: params.y, angle, gameplayMuzzleOrigin: params.gameplayMuzzleOrigin },
      flight: {
        speed: fireConfig.projectileSpeed,
        size: fireConfig.projectileSize,
        lifetimeMs: lifetime,
        maxBounces: 0,
        isGrenade: false,
        remainingRangePx: travelDistance,
      },
      provenance: createSingleOwnerProvenance(params.ownerId, {
        weaponSourceId: config.id,
        sourceSlot: resolveSourceSlot(params) ?? 'weapon2',
      }),
      interaction: {
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
      },
      presentation: {
        color: config.projectileColor ?? fireConfig.fieldColor,
        style: config.projectileStyle,
        ownerColor: params.ownerColor,
        visualScale: config.projectileVisualScale,
        smokeTrailColor: config.rocketSmokeTrailColor ?? fireConfig.fieldColor,
        shotAudioKey: config.shotAudio?.successKey,
        visualMuzzleOrigin: params.visualMuzzleOrigin,
      },
    });
    return true;
  }

  private fireEnergyInjector(
    config: WeaponConfig,
    fireConfig: EnergyInjectorWeaponFireConfig,
    params: WeaponFireParams,
  ): boolean {
    this.projectileSpawn.spawnProjectile({
      origin: { x: params.x, y: params.y, angle: params.angle, gameplayMuzzleOrigin: params.gameplayMuzzleOrigin },
      flight: {
        speed: fireConfig.projectileSpeed,
        size: fireConfig.projectileSize,
        lifetimeMs: (config.range / fireConfig.projectileSpeed) * 1000,
        maxBounces: 0,
        isGrenade: false,
        remainingRangePx: config.range,
      },
      provenance: createSingleOwnerProvenance(params.ownerId, {
        weaponSourceId: config.id,
        sourceSlot: resolveSourceSlot(params) ?? 'weapon2',
      }),
      interaction: {
        directHit: { damage: 0, rockDamageMult: 0, trainDamageMult: 0 },
        support: {
          energyInjector: {
            durationMs: fireConfig.durationMs,
            focusDurationMs: fireConfig.focusDurationMs,
            vulnerabilityBonus: fireConfig.vulnerabilityBonus,
            color: fireConfig.injectorColor,
          },
        },
      },
      presentation: {
        color: config.projectileColor ?? fireConfig.injectorColor,
        style: config.projectileStyle,
        ownerColor: params.ownerColor,
        visualScale: config.projectileVisualScale,
        energyBallVariant: config.energyBallVariant,
        shotAudioKey: config.shotAudio?.successKey,
        visualMuzzleOrigin: params.visualMuzzleOrigin,
      },
    });
    return true;
  }
}

function resolveSourceSlot(params: Pick<WeaponFireParams, 'sourceSlot' | 'options'>) {
  return params.sourceSlot ?? params.options?.sourceSlot;
}

function calculateDecayLifetime(range: number, projectileSpeed: number, decay: number): number {
  if (decay >= 1 || decay <= 0) return (range / projectileSpeed) * 1000;

  const lnDecay = Math.log(decay);
  const maxDist = projectileSpeed / -lnDecay;
  const distRatio = range / maxDist;
  if (distRatio >= 1) return 3000;

  return Math.log(1 - distRatio) / lnDecay * 1000;
}
