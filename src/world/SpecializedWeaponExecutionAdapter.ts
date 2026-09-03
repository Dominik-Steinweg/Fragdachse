import type { ProjectileManager } from '../entities/ProjectileManager';
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

type SpecializedWeaponProjectileSink = Pick<ProjectileManager, 'spawnProjectile'>;

/**
 * Führt die unmittelbaren Spezial-Projektiltypen aus, die bewusst nicht zum gemeinsamen
 * Projectile-/Hitscan-/Melee-Executor gehören.
 *
 * Der Adapter besitzt weder Player-Lifecycle noch Ressourcen-, Cooldown- oder Commit-State.
 * Alle Owner-, Slot-, Muzzle- und automatischen Quellenangaben kommen aus dem Auftrag; die
 * bestehende ProjectileManager-Senke bleibt die einzige Payload-/Treffer-Pipeline.
 */
export class SpecializedWeaponExecutionAdapter implements SpecializedWeaponExecutionCapability {
  constructor(private readonly projectileManager: SpecializedWeaponProjectileSink) {}

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
        sourceSlot,
        sourceTurretId: params.options?.sourceTurretId,
        gameplayMuzzleOrigin: params.gameplayMuzzleOrigin,
        visualMuzzleOrigin: params.visualMuzzleOrigin,
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
      sourceSlot,
      sourceTurretId: params.options?.sourceTurretId,
      gameplayMuzzleOrigin: params.gameplayMuzzleOrigin,
      visualMuzzleOrigin: params.visualMuzzleOrigin,
      shotAudioKey: config.shotAudio?.successKey,
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
      sourceSlot: resolveSourceSlot(params),
      sourceTurretId: params.options?.sourceTurretId,
      gameplayMuzzleOrigin: params.gameplayMuzzleOrigin,
      visualMuzzleOrigin: params.visualMuzzleOrigin,
      shotAudioKey: config.shotAudio?.successKey,
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
      gameplayMuzzleOrigin: params.gameplayMuzzleOrigin,
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
      sourceSlot: resolveSourceSlot(params) ?? 'weapon2',
      visualMuzzleOrigin: params.visualMuzzleOrigin,
      shotAudioKey: config.shotAudio?.successKey,
    });
    return true;
  }

  private fireEnergyInjector(
    config: WeaponConfig,
    fireConfig: EnergyInjectorWeaponFireConfig,
    params: WeaponFireParams,
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
      sourceSlot: resolveSourceSlot(params) ?? 'weapon2',
      gameplayMuzzleOrigin: params.gameplayMuzzleOrigin,
      visualMuzzleOrigin: params.visualMuzzleOrigin,
      shotAudioKey: config.shotAudio?.successKey,
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
