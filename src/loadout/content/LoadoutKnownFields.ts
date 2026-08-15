/** Generated once from the complete legacy runtime registries; extend deliberately with schema changes. */
export const LOADOUT_ALLOWED_KEYS_BY_PATH: Readonly<Record<string, ReadonlySet<string>>> = {
  "ultimate": new Set(["activation","allowTeamDamage","allowedModes","armageddon","armorPerTick","armorTickIntervalMs","aura","buildLabel","bulletVisualPreset","catalogVisible","chargeColor","chargeDuration","cooldown","damage","damageMultiplier","delayMs","duration","id","maxDamage","minDamage","movementSlowFactor","placement","projectileColor","projectileSize","projectileSpeed","projectileStyle","projectileVisualScale","radius","rageCost","rageDrainDuration","rageRequired","range","rockDamageMult","selfDamageMult","shotAudio","shotRecoilDuration","shotRecoilForce","speedMultiplier","tracerConfig","trainDamageMult","travelMaxDurationMs","travelMinDurationMs","travelSpeed","type"]),
  "ultimate.activation": new Set(["type"]),
  "ultimate.armageddon": new Set(["cometChunkCountFactor","cometDamageFactor","cometFallDurationFactor","cometRadiusFactor","cometSpawnRateDivisor","cometStormEnabled","fireChunkBurst","meteorDamage","meteorDamageFalloff","meteorDamageRadius","meteorFallDuration","meteorRadiusJitter","meteorSpawnRadius","meteorsPerSecond","rockDamageMult","selfDamageMult","trainDamageMult"]),
  "ultimate.armageddon.fireChunkBurst": new Set(["burnDamagePerTick","burnDurationMs","count","durationMs","flightMs","igniteCenter","searchRadius","sourceId"]),
  "ultimate.armageddon.meteorDamageFalloff": new Set(["minDamage"]),
  "ultimate.aura": new Set(["damagePerTick","radius","tickIntervalMs"]),
  "ultimate.placement": new Set(["entranceRadius","kind","ownerTintStrength","previewAlpha","range","spawnShakeDuration","spawnShakeIntensity"]),
  "ultimate.shotAudio": new Set(["failureKey","successKey"]),
  "ultimate.tracerConfig": new Set(["alphaCore","alphaGlow","colorCore","colorGlow","fadeMs","maxLength","segments","widthCore","widthGlow"]),
  "utility": new Set(["activation","airFrictionDecayPerSec","allowTeamDamage","allowedSlots","aoeDamage","aoeRadius","bounceFrictionMultiplier","bubbleColor","bubbleDistortion","bubbleDuration","bubbleRadius","cloudDamagePerTick","cloudDuration","cloudRadius","cloudTickInterval","continuous","cooldown","damage","damageFalloff","decoyLifetimeMs","directDamage","dissipateDustBurst","explosionVisualStyle","fireBurnDamagePerTick","fireBurnDurationMs","fireDamagePerTick","fireLingerDuration","fireRadius","frictionDelayMs","fuseTime","grenadeVisualPreset","hitArcDegrees","id","maxBounces","placeable","playerSlowFactor","projectileColor","projectileSize","projectileSlowFactor","projectileSpeed","projectileStyle","proximityPulse","range","rockDamageMult","shotAudio","skipCooldownPublish","smokeDissipateDuration","smokeDotDamagePerTick","smokeDotTickIntervalMs","smokeExpandDuration","smokeLingerDuration","smokeMaxAlpha","smokeRadius","stealthAlphaMax","stealthAlphaMin","stealthDurationMs","stealthGlowOuterStrength","stopSpeedThreshold","trainDamageMult","trainSlowFactor","type","visualPreset","visualVariant","weaponId","wildfireEnabled","wildfirePanicSpeedMultiplier","wildfireTrailDamagePerTick","wildfireTrailDurationMs","wobblePeriodMs"]),
  "utility.activation": new Set(["fullChargeDuration","minThrowSpeed","type"]),
  "utility.damageFalloff": new Set(["minDamage"]),
  "utility.placeable": new Set(["deathCloudRadius","energyInjectorEffect","footprint","kind","lifetimeMs","maxHp","muzzleOffset","ownerTintStrength","previewAlpha","range","spawnShakeDuration","spawnShakeIntensity","targetRange","warningPulseMs"]),
  "utility.placeable.energyInjectorEffect": new Set(["damageMultiplier","pullStrengthMultiplier","respawnTimeMultiplier","slowStrengthMultiplier","type"]),
  "utility.placeable.footprint[]": new Set(["dx","dy"]),
  "utility.shotAudio": new Set(["failureKey","successKey"]),
  "weapon": new Set(["adrenalinCost","adrenalinGain","ak47Focus","allowedModes","allowedSlots","awpCharge","bloodEffectMultiplier","bulletVisualPreset","burnOnHit","chainLightning","cooldown","damage","detonable","detonator","directDamageOverride","energyBallVariant","fire","grenadeVisualPreset","hitAdrenaline","hitHeal","hitKnockback","hitKnockbackDurationMs","hitSlowDurationMs","hitSlowFraction","holdSpeedFactor","homingEnabled","id","matchPrimaryRange","maxDynamicSpread","miniRocketCascadeDamageBonusPerExplosion","miniRocketPickupAdrenalineRefundFraction","miniRocketPickupArmor","miniRocketPickupRadius","miniRocketReturnEnabled","miniRocketReturnRangeBuffer","miniRocketSafetyLifetimeMs","multiExplosionCoastMs","multiExplosionCount","negevKillstreak","pelletCount","pelletCountMultiplier","pelletSpreadAngle","penetratesRocks","projectileBurnVisualStyle","projectileColor","projectileStyle","projectileVisualScale","proximityPulse","range","rockDamageMult","rocketSmokeTrailColor","scopeConfig","shotAudio","shotRecoilDuration","shotRecoilForce","shotScreenShake","shotgunChainDamageRetention","shotgunChainEnabled","shotgunChainRadiusRetention","shotgunLightningAppliesSlow","shotgunLightningDamage","shotgunLightningRadius","shotgunProximityMaxDamageBonus","shotgunSlowDurationMs","shotgunSlowFraction","showCrosshair","splitCount","splitFactor","splitSpread","spreadMoving","spreadPerShot","spreadRecoveryDelay","spreadRecoveryRate","spreadRecoverySpeed","spreadStanding","tracerConfig","trainDamageMult","turretBurst","warmupBurnThreshold","warmupSpeedMultiplier"]),
  "weapon.turretBurst": new Set(["count","intervalMs"]),
  "weapon.ak47Focus": new Set(["damagePerStack","explosiveTargetAcquisitionLevel","fireControlEnabled","fireControlProjectileSpeedPerStack","fireControlRangePerStack","fireControlSpreadPerStack","fireSuperiorityShots","maxStacks","strategicTargetDamageBonus","strategicTargetEnabled","targetPrioritizationEnabled"]),
  "weapon.awpCharge": new Set(["corridorDamage","corridorDotDurationMs","corridorDotTickIntervalMs","corridorEnabled","corridorHalfWidth","corridorKnockback","corridorKnockbackDurationMs","durationMs","fireTrailBurnDamagePerTick","fireTrailBurnDurationMs","fireTrailDurationMs","fireTrailHalfWidthCells","fullChargeDamageBonus","maxDamageBonus"]),
  "weapon.burnOnHit": new Set(["damagePerTick","durationMs"]),
  "weapon.chainLightning": new Set(["damageFalloffPerJump","detonableTags","maxJumps","searchRadius","targetEnemies","thicknessFalloffPerJump"]),
  "weapon.detonable": new Set(["allowCrossTeam","aoeDamage","aoeRadius","comboAdrenalineGain","damageFalloff","dotArea","explosionVisualStyle","knockback","selfKnockbackMult","tag"]),
  "weapon.detonable.damageFalloff": new Set(["minDamage"]),
  "weapon.detonable.dotArea": new Set(["damagePerTick","durationMs","radiusScale","style","tickIntervalMs"]),
  "weapon.detonator": new Set(["triggerTags"]),
  "weapon.fire": new Set(["adrenalineDrainPerSecond","anchorDistance","beamColor","blockArcDegrees","blockableCategories","buffDecayDelayMs","buffDecayPerSecond","buffGainFactor","buffMax","buffMaxBonus","burnDamagePerTick","burnDurationMs","burningGround","chargeColor","chargeIntervalMs","damageBonusPerCharge","damageMultiplier","damageMultiplierPerStack","damagePerTick","damageTargets","domeEnabled","domeHealPerSecond","domeRadius","domeReflectProjectiles","domeToggleEnabled","durationMs","enemyHitExplosion","fieldColor","fireRateMultiplier","fireRing","fireball","flashDurationMs","flashMaxAlpha","healPerHit","healPerTick","hitArcDegrees","hitboxEndSize","hitboxGrowRate","hitboxStartSize","homing","impactCloud","impactExplosion","kamikaze","limitRangeToCursor","maxChargeStacks","maxKnockback","maxStacks","minKnockback","movementSlowFactor","piercingCount","projectileMaxBounces","projectileSize","projectileSpeed","radius","radiusBonusPerCharge","reflectionDamageFactor","requireLineOfSight","selfPush","supportEffect","targetTypes","tickInterval","traceThickness","type","velocityDecay","visualBoltThicknessMax","visualBoltThicknessMin","visualBranchChance","visualCoreParticleFrequency","visualFieldAlpha","visualFieldParticleFrequency","visualIdleArcCount","visualIdleArcLength","visualImpactBurstScale","visualIndicatorAlpha","visualInnerAlpha","visualJitter","visualOuterAlpha","visualPreset","visualPulseSpeed","visualRadius","visualRimParticleFrequency","visualThickness","visualWhiteness"]),
  "weapon.fire.supportEffect": new Set(["beamColor","damagePerHit","healPerHit","type"]),
  "weapon.fire.burningGround": new Set(["cellSize","createOnFlameExpiry","durationMs","igniteProjectiles"]),
  "weapon.fire.enemyHitExplosion": new Set(["color","knockback","maxDamage","minDamage","radius","rockDamageMult","selfDamageMult","trainDamageMult","visualStyle"]),
  "weapon.fire.fireball": new Set(["chunkCount","chunkFlightMs","chunkSearchRadius","enabled","explosionKnockback","explosionMaxDamage","explosionMinDamage","explosionRadius","groundBurnDamagePerTick","groundDurationMs","projectileSize","projectileSpeed","selfDamageMult","trailEnabled"]),
  "weapon.fire.fireRing": new Set(["igniteProjectiles","radius","thickness"]),
  "weapon.fire.homing": new Set(["acquireDelayMs","distanceWeight","excludeOwner","forwardWeight","maxTurnDegreesPerStep","requireLineOfSight","retargetIntervalMs","searchRadius","targetTypes"]),
  "weapon.fire.impactCloud": new Set(["damagePerTick","duration","radius","rockDamageMult","tickInterval","trainDamageMult","visualVariant"]),
  "weapon.fire.impactExplosion": new Set(["blackHoleDurationMs","blackHolePullStrength","color","falloffReduction","groundFire","knockback","maxDamage","minDamage","radius","rockDamageMult","selfDamageMult","timeBubble","trainDamageMult","visualStyle"]),
  "weapon.fire.impactExplosion.timeBubble": new Set(["color","distortion","duration","friendlyImmunity","playerSlowFactor","projectileSlowFactor","radius","trainSlowFactor","type"]),
  "weapon.fire.impactExplosion.groundFire": new Set(["burnDamagePerTick","burnDurationMs","damagePerTick","lingerDuration","radius","rockDamageMult","sourceId","trainDamageMult","type"]),
  "weapon.fire.kamikaze": new Set(["enabled","inheritMolotovBonuses"]),
  "weapon.negevKillstreak": new Set(["armorPerKill","damageBonusPerKill","explosionBaseKnockback","explosionBaseRadius","explosionDamagePerKill","explosionEnabled","explosionKnockbackPerKill","explosionRadiusPerKill","fireChunkBurnDamagePerTick","fireChunkBurnDurationMs","fireChunkDurationMs","healPerKill"]),
  "utility.proximityPulse": new Set(["damage","radius","scanIntervalMs"]),
  "weapon.proximityPulse": new Set(["damage","radius","scanIntervalMs"]),
  "weapon.scopeConfig": new Set(["edgeSoftnessPx","fullScopeViewRadius","scopeInMs","unscopeSpeedMs","unscopedSpreadDeg"]),
  "weapon.shotAudio": new Set(["failureKey","successKey"]),
  "weapon.shotScreenShake": new Set(["duration","intensity"]),
  "weapon.tracerConfig": new Set(["alphaCore","alphaGlow","colorCore","colorGlow","fadeMs","maxLength","segments","widthCore","widthGlow"]),
};

// Schadensfaktor gegen feindliche Coop-Basen. Diese Sets werden aus dem Content-Router
// erzeugt; die Erweiterung bleibt hier bewusst zentral, damit verschachtelte Payloads
// denselben Vertrag teilen.
const mutableAllowedKeysByPath = LOADOUT_ALLOWED_KEYS_BY_PATH as Readonly<Record<string, Set<string>>>;
for (const key of [
  'plasmaSwarmEnabled',
  'plasmaSwarmProjectileCount',
  'plasmaSwarmExplosionRadius',
  'plasmaSwarmExplosionDamage',
  'plasmaSwarmExplosionSlowFraction',
]) mutableAllowedKeysByPath.weapon.add(key);
for (const path of [
  'ultimate',
  'ultimate.armageddon',
  'ultimate.armageddon.fireChunkBurst',
  'ultimate.aura',
  'utility',
  'weapon',
  'weapon.detonable',
  'weapon.detonable.dotArea',
  'weapon.fire.enemyHitExplosion',
  'weapon.fire.impactCloud',
  'weapon.fire.impactExplosion',
  'weapon.fire.impactExplosion.groundFire',
]) {
  mutableAllowedKeysByPath[path]?.add('baseDamageMult');
}
mutableAllowedKeysByPath['weapon.fire.supportEffect']?.add('baseDamageMult');
mutableAllowedKeysByPath.ultimate?.add('friendlyBaseDamageMult');
