import type { ProjectileSpawnConfig } from '../types';
import type { ProjectileSpawnRequest } from './ProjectileSpawnRequest';

/**
 * Übersetzt einen aufgelösten Spawn-Auftrag in die noch bestehende Payload-Form der
 * Host-Simulation.
 *
 * Die Abbildung ist eine reine Funktion ohne State, Identity oder Lifecycle. Sie lebt so lange,
 * wie Flight, Kollision und Wirkung den Legacy-Record verwenden, und verschwindet mit dessen
 * Ablösung.
 *
 * Die Payload führt weiterhin nur den für den Legacy-Code nötigen operativen `ownerId`-Anteil.
 * Die vollständige Provenance wird von der World-Runtime separat und unverändert in den
 * kanonischen Runtime-Record übergeben.
 */
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
    pathEffectKind:          interaction.pathEffect?.kind,
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
