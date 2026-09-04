import type { ProjectileSpawnConfig } from '../types';
import type { ProjectileId, ProjectileSpawnPort, ProjectileSpawnResult } from './ProjectileSpawnPort';
import type { ProjectileSpawnRequest } from './ProjectileSpawnRequest';

/** Bestehende Spawn-Senke des Legacy-`ProjectileManager`. */
export interface LegacyProjectileSpawnSink {
  spawnProjectile(
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
  ): ProjectileId;
}

/**
 * Einziger one-way Adapter vom neuen Spawn-Contract auf die bestehende Spawn-Senke.
 *
 * Er übersetzt ausschließlich `ProjectileSpawnRequest` → `ProjectileSpawnConfig`; er besitzt weder
 * State noch Identity noch Lifecycle und ist keine dauerhafte Fassade. Sobald die world-owned
 * Projectile-Runtime den autoritativen Spawn übernimmt, entfällt er ersatzlos.
 *
 * Solange die Senke nur ein `ownerId` kennt, müssen Gameplay-Source, Attribution und Allegiance
 * derselben Entität gehören; die Trennung dieser Dimensionen wird erst hinter der neuen Grenze
 * wirksam.
 */
export class LegacyProjectileSpawnAdapter implements ProjectileSpawnPort {
  constructor(private readonly sink: LegacyProjectileSpawnSink) {}

  spawnProjectile(request: ProjectileSpawnRequest): ProjectileSpawnResult {
    const { origin } = request;
    return this.sink.spawnProjectile(
      origin.x,
      origin.y,
      origin.angle,
      request.provenance.attributionId,
      toLegacyProjectileSpawnConfig(request),
    );
  }
}

/** Flacht einen aufgelösten Spawn-Auftrag auf die bestehende Payload-Form ab. */
export function toLegacyProjectileSpawnConfig(request: ProjectileSpawnRequest): ProjectileSpawnConfig {
  const { flight, provenance, interaction, presentation } = request;
  const directHit = interaction.directHit;
  const swarm = directHit?.plasmaSwarm;
  const lineage = provenance.lineage;
  const corridor = interaction.pathEffect?.awpCorridor;
  const miniRocket = flight.miniRocket;

  return {
    speed:  flight.speed,
    size:   flight.size,
    damage: directHit?.damage ?? 0,
    color:  presentation.color,
    lifetime:   flight.lifetimeMs,
    maxBounces: flight.maxBounces,
    isGrenade:  flight.isGrenade,
    adrenalinGain: directHit?.adrenalinGain ?? 0,

    gameplayMuzzleOrigin: request.origin.gameplayMuzzleOrigin,
    visualMuzzleOrigin:   presentation.visualMuzzleOrigin,
    allowTeamDamage: provenance.allegiance.allowTeamDamage,
    sourceId:        provenance.weaponSourceId,
    sourceSlot:      provenance.sourceSlot,
    sourceTurretId:  provenance.sourceTurretId,
    reflected:       lineage?.reflected,
    ak47ShotId:      provenance.correlation?.ak47ShotId,

    ignoreBaseCollisions: flight.collisionFilter?.ignoreBaseCollisions,
    ignoreRockIndex:      flight.collisionFilter?.ignoreRockIndex,
    initialBounceCount:   flight.initialBounceCount,
    remainingRangePx:     flight.remainingRangePx,
    fuseTime:             flight.fuseTimeMs,
    homing:               flight.homing,
    piercesTargets:       flight.piercesTargets,
    penetrationCount:           flight.penetration?.count,
    penetrationDamageRetention: flight.penetration?.damageRetention,
    penetratesRocks:            flight.penetration?.penetratesRocks,
    velocityDecay:           flight.drag?.velocityDecayPerSec,
    frictionDelayMs:         flight.drag?.frictionDelayMs,
    airFrictionDecayPerSec:  flight.drag?.airFrictionDecayPerSec,
    bounceFrictionMultiplier: flight.drag?.bounceFrictionMultiplier,
    stopSpeedThreshold:      flight.drag?.stopSpeedThreshold,
    hitboxGrowRate: flight.hitboxGrowth?.growRatePerSec,
    hitboxMaxSize:  flight.hitboxGrowth?.maxSize,
    splitCount:  flight.split?.count,
    splitSpread: flight.split?.spread,
    splitFactor: flight.split?.speedFactor,
    splitHoming: flight.split?.homing,
    isFlame:       flight.isFlame,
    flamePiercing: flight.flamePiercing,
    isBfg:         flight.isBfg,
    miniRocketStageRangePx:   miniRocket?.stageRangePx,
    miniRocketReturnEnabled:  miniRocket?.returnEnabled,
    miniRocketReturnRangeBuffer: miniRocket?.returnRangeBuffer,
    miniRocketPickupRadius:   miniRocket?.pickupRadius,
    miniRocketPickupAdrenalineRefundFraction: miniRocket?.pickupAdrenalineRefundFraction,
    miniRocketPickupArmor:    miniRocket?.pickupArmor,
    miniRocketAdrenalineCostPaid: miniRocket?.adrenalineCostPaid,
    miniRocketSafetyLifetimeMs:   miniRocket?.safetyLifetimeMs,
    miniRocketCascadeDamageBonusPerExplosion: miniRocket?.cascadeDamageBonusPerExplosion,

    rockDamageMult:  directHit?.rockDamageMult,
    trainDamageMult: directHit?.trainDamageMult,
    baseDamageMult:  directHit?.baseDamageMult,
    hitSlowFraction:            directHit?.slowFraction,
    hitSlowDurationMs:          directHit?.slowDurationMs,
    hitVulnerabilityDurationMs: directHit?.vulnerabilityDurationMs,
    hitKnockback:               directHit?.knockback,
    hitKnockbackDurationMs:     directHit?.knockbackDurationMs,
    shotgunOriginX:        directHit?.shotgun?.originX,
    shotgunOriginY:        directHit?.shotgun?.originY,
    shotgunResolvedRange:  directHit?.shotgun?.resolvedRange,
    shotgunProximityMaxDamageBonus: directHit?.shotgun?.proximityMaxDamageBonus,
    shotgunSlowFraction:   directHit?.shotgun?.slowFraction,
    shotgunSlowDurationMs: directHit?.shotgun?.slowDurationMs,
    gaussChainRadius:       directHit?.gaussChain?.radius,
    gaussChainDamageFactor: directHit?.gaussChain?.damageFactor,
    ak47DamageMultiplier:    directHit?.ak47?.damageMultiplier,
    ak47FireSuperiorityShot: directHit?.ak47?.fireSuperiorityShot,
    plasmaSwarmEnabled:        swarm === undefined ? undefined : true,
    plasmaSwarmProjectileCount: swarm?.projectileCount,
    plasmaSwarmExplosionRadius: swarm?.explosionRadius,
    plasmaSwarmExplosionDamage: swarm?.explosionDamage,
    plasmaSwarmExplosionSlowFraction: swarm?.explosionSlowFraction,
    plasmaSwarmProjectile:     lineage?.plasmaSwarmChild,
    plasmaSwarmOriginEnemyId:  lineage?.plasmaSwarmOriginEnemyId,

    explosion:         interaction.explosion,
    enemyHitExplosion: interaction.enemyHitExplosion,
    multiExplosionCount:   interaction.multiExplosion?.count,
    multiExplosionCoastMs: interaction.multiExplosion?.coastMs,
    impactCloud:   interaction.impactCloud,
    grenadeEffect: interaction.grenadeEffect,
    burnDurationMs:            interaction.burn?.durationMs,
    burnDamagePerTick:         interaction.burn?.damagePerTick,
    projectileBurnVisualStyle: interaction.burn?.visualStyle,
    supplementalBurnOnHit:     interaction.burn?.supplemental,
    canReceiveFireImbue:       interaction.burn?.canReceiveFireImbue,
    fireTrail:               interaction.pathEffect?.fireTrail,
    fireTrailHalfWidthCells: interaction.pathEffect?.fireTrailHalfWidthCells,
    awpCorridorHalfWidth:          corridor?.halfWidth,
    awpCorridorDamage:             corridor?.damage,
    awpCorridorDotDurationMs:      corridor?.dotDurationMs,
    awpCorridorDotTickIntervalMs:  corridor?.dotTickIntervalMs,
    awpCorridorKnockback:          corridor?.knockback,
    awpCorridorKnockbackDurationMs: corridor?.knockbackDurationMs,
    leafBlowerMinKnockback: interaction.impulse?.minKnockback,
    leafBlowerMaxKnockback: interaction.impulse?.maxKnockback,
    leafBlowerSelfPush:     interaction.impulse?.selfPush,
    leafBlowerDeflectsProjectiles: interaction.impulse?.deflectsProjectiles,
    energyInjectorPayload: interaction.support?.energyInjector,
    detonable:      interaction.detonable,
    detonator:      interaction.detonator,
    proximityPulse: interaction.proximityPulse,

    projectileStyle:       presentation.style,
    ownerColor:            presentation.ownerColor,
    projectileVisualScale: presentation.visualScale,
    bulletVisualPreset:    presentation.bulletPreset,
    grenadeVisualPreset:   presentation.grenadePreset,
    energyBallVariant:     presentation.energyBallVariant,
    sporeVisualVariant:    presentation.sporeVariant,
    smokeTrailColor:       presentation.smokeTrailColor,
    tracerConfig:          presentation.tracer,
    shotAudioKey:          presentation.shotAudioKey,
    suppressSpawnFx:       presentation.suppressSpawnFx,
  };
}
