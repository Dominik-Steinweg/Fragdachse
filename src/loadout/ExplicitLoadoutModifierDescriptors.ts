import type { ConfigStatDescriptor } from './CoopDefenseLoadoutModifiers';

/** Explicit contracts for formerly convention-resolved upgrade paths. */
export const EXPLICIT_LOADOUT_MODIFIER_DESCRIPTORS = {
  "ultimate.AIRSTRIKE.carpetDamageFactor": {
    kind: "ultimate",
    itemId: "AIRSTRIKE",
    targets: [{ path: ["carpetDamageFactor"], formula: "add", createIfMissing: true }],
  },
  "ultimate.AIRSTRIKE.carpetIntervalMs": {
    kind: "ultimate",
    itemId: "AIRSTRIKE",
    targets: [{ path: ["carpetIntervalMs"], formula: "add", createIfMissing: true }],
  },
  "ultimate.AIRSTRIKE.carpetOffset": {
    kind: "ultimate",
    itemId: "AIRSTRIKE",
    targets: [{ path: ["carpetOffset"], formula: "add", createIfMissing: true }],
  },
  "ultimate.AIRSTRIKE.carpetRadiusFactor": {
    kind: "ultimate",
    itemId: "AIRSTRIKE",
    targets: [{ path: ["carpetRadiusFactor"], formula: "add", createIfMissing: true }],
  },
  "ultimate.AIRSTRIKE.carpetStrikeCount": {
    kind: "ultimate",
    itemId: "AIRSTRIKE",
    targets: [{ path: ["carpetStrikeCount"], formula: "add", createIfMissing: true }],
  },
  "ultimate.ARMAGEDDON.armageddon.cometChunkCountFactor": {
    kind: "ultimate",
    itemId: "ARMAGEDDON",
    targets: [{ path: ["armageddon","cometChunkCountFactor"], formula: "scale" }],
  },
  "ultimate.ARMAGEDDON.armageddon.cometDamageFactor": {
    kind: "ultimate",
    itemId: "ARMAGEDDON",
    targets: [{ path: ["armageddon","cometDamageFactor"], formula: "scale" }],
  },
  "ultimate.ARMAGEDDON.armageddon.cometFallDurationFactor": {
    kind: "ultimate",
    itemId: "ARMAGEDDON",
    targets: [{ path: ["armageddon","cometFallDurationFactor"], formula: "scale" }],
  },
  "ultimate.ARMAGEDDON.armageddon.cometRadiusFactor": {
    kind: "ultimate",
    itemId: "ARMAGEDDON",
    targets: [{ path: ["armageddon","cometRadiusFactor"], formula: "scale" }],
  },
  "ultimate.ARMAGEDDON.armageddon.cometSpawnRateDivisor": {
    kind: "ultimate",
    itemId: "ARMAGEDDON",
    targets: [{ path: ["armageddon","cometSpawnRateDivisor"], formula: "add" }],
  },
  "ultimate.ARMAGEDDON.armageddon.cometStormEnabled": {
    kind: "ultimate",
    itemId: "ARMAGEDDON",
    targets: [{ path: ["armageddon","cometStormEnabled"], formula: "add" }],
  },
  "ultimate.GAUSS_RIFLE.chainDamageFactor": {
    kind: "ultimate",
    itemId: "GAUSS_RIFLE",
    targets: [{ path: ["chainDamageFactor"], formula: "add", createIfMissing: true }],
  },
  "ultimate.GAUSS_RIFLE.chainRadius": {
    kind: "ultimate",
    itemId: "GAUSS_RIFLE",
    targets: [{ path: ["chainRadius"], formula: "add", createIfMissing: true }],
  },
  "ultimate.HONEY_BADGER_RAGE.aura.allyArmorPerTick": {
    kind: "ultimate",
    itemId: "HONEY_BADGER_RAGE",
    targets: [{ path: ["aura","allyArmorPerTick"], formula: "add", createIfMissing: true }],
  },
  "ultimate.HONEY_BADGER_RAGE.aura.allyDamageMultiplier": {
    kind: "ultimate",
    itemId: "HONEY_BADGER_RAGE",
    targets: [{ path: ["aura","allyDamageMultiplier"], formula: "add", createIfMissing: true }],
  },
  "ultimate.HONEY_BADGER_RAGE.aura.allySpeedMultiplier": {
    kind: "ultimate",
    itemId: "HONEY_BADGER_RAGE",
    targets: [{ path: ["aura","allySpeedMultiplier"], formula: "add", createIfMissing: true }],
  },
  "ultimate.HONEY_BADGER_RAGE.aura.lingerMs": {
    kind: "ultimate",
    itemId: "HONEY_BADGER_RAGE",
    targets: [{ path: ["aura","lingerMs"], formula: "add", createIfMissing: true }],
  },
  "utility.DECOY.explosionDamage": {
    kind: "utility",
    itemId: "DECOY",
    targets: [{ path: ["explosionDamage"], formula: "add", createIfMissing: true }],
  },
  "utility.DECOY.explosionKnockback": {
    kind: "utility",
    itemId: "DECOY",
    targets: [{ path: ["explosionKnockback"], formula: "add", createIfMissing: true }],
  },
  "utility.DECOY.explosionRadius": {
    kind: "utility",
    itemId: "DECOY",
    targets: [{ path: ["explosionRadius"], formula: "add", createIfMissing: true }],
  },
  "utility.FELSBAU.placeable.enemyDestroyedExplosionDamage": {
    kind: "utility",
    itemId: "FELSBAU",
    targets: [{ path: ["placeable","enemyDestroyedExplosionDamage"], formula: "add", createIfMissing: true }],
  },
  "utility.FELSBAU.placeable.enemyDestroyedExplosionKnockback": {
    kind: "utility",
    itemId: "FELSBAU",
    targets: [{ path: ["placeable","enemyDestroyedExplosionKnockback"], formula: "add", createIfMissing: true }],
  },
  "utility.FELSBAU.placeable.enemyDestroyedExplosionRadius": {
    kind: "utility",
    itemId: "FELSBAU",
    targets: [{ path: ["placeable","enemyDestroyedExplosionRadius"], formula: "add", createIfMissing: true }],
  },
  "utility.FELSBAU.placeable.range": {
    kind: "utility",
    itemId: "FELSBAU",
    targets: [{ path: ["placeable","range"], formula: "scale" }],
  },
  "utility.FLIEGENPILZ.placeable.plasmaWeaponEnabled": {
    kind: "utility",
    itemId: "FLIEGENPILZ",
    targets: [{ path: ["placeable","plasmaWeaponEnabled"], formula: "add", createIfMissing: true }],
  },
  "utility.FLIEGENPILZ.placeable.range": {
    kind: "utility",
    itemId: "FLIEGENPILZ",
    targets: [{ path: ["placeable","range"], formula: "scale" }],
  },
  "utility.FLIEGENPILZ.placeable.secondProjectileDamageFactor": {
    kind: "utility",
    itemId: "FLIEGENPILZ",
    targets: [{ path: ["placeable","secondProjectileDamageFactor"], formula: "add", createIfMissing: true }],
  },
  "utility.HE_GRENADE.clusterCount": {
    kind: "utility",
    itemId: "HE_GRENADE",
    targets: [{ path: ["clusterCount"], formula: "add", createIfMissing: true }],
  },
  "utility.HE_GRENADE.clusterDamageFactor": {
    kind: "utility",
    itemId: "HE_GRENADE",
    targets: [{ path: ["clusterDamageFactor"], formula: "add", createIfMissing: true }],
  },
  "utility.HE_GRENADE.clusterRadiusFactor": {
    kind: "utility",
    itemId: "HE_GRENADE",
    targets: [{ path: ["clusterRadiusFactor"], formula: "add", createIfMissing: true }],
  },
  "utility.STINKDRUESEN.afterCloudDamageFactor": {
    kind: "utility",
    itemId: "STINKDRUESEN",
    targets: [{ path: ["afterCloudDamageFactor"], formula: "add", createIfMissing: true }],
  },
  "utility.STINKDRUESEN.afterCloudDurationMs": {
    kind: "utility",
    itemId: "STINKDRUESEN",
    targets: [{ path: ["afterCloudDurationMs"], formula: "add", createIfMissing: true }],
  },
  "utility.STINKDRUESEN.afterCloudRadiusFactor": {
    kind: "utility",
    itemId: "STINKDRUESEN",
    targets: [{ path: ["afterCloudRadiusFactor"], formula: "add", createIfMissing: true }],
  },
  "utility.TIME_BUBBLE.friendlyImmunity": {
    kind: "utility",
    itemId: "TIME_BUBBLE",
    targets: [{ path: ["friendlyImmunity"], formula: "add", createIfMissing: true }],
  },
  "utility.TRANSLOCATOR.telefragDamage": {
    kind: "utility",
    itemId: "TRANSLOCATOR",
    targets: [{ path: ["telefragDamage"], formula: "add", createIfMissing: true }],
  },
  "utility.TRANSLOCATOR.telefragKnockback": {
    kind: "utility",
    itemId: "TRANSLOCATOR",
    targets: [{ path: ["telefragKnockback"], formula: "add", createIfMissing: true }],
  },
  "utility.TRANSLOCATOR.telefragRadius": {
    kind: "utility",
    itemId: "TRANSLOCATOR",
    targets: [{ path: ["telefragRadius"], formula: "add", createIfMissing: true }],
  },
  "utility.ZEUS_TASER.chainCount": {
    kind: "utility",
    itemId: "ZEUS_TASER",
    targets: [{ path: ["chainCount"], formula: "add", createIfMissing: true }],
  },
  "utility.ZEUS_TASER.chainDamageFactor": {
    kind: "utility",
    itemId: "ZEUS_TASER",
    targets: [{ path: ["chainDamageFactor"], formula: "add", createIfMissing: true }],
  },
  "utility.ZEUS_TASER.chainRadius": {
    kind: "utility",
    itemId: "ZEUS_TASER",
    targets: [{ path: ["chainRadius"], formula: "add", createIfMissing: true }],
  },
  "weapon.AK47.ak47Focus.applyDamageToPrimaryWeapon": {
    kind: "weapon",
    itemId: "AK47",
    targets: [{ path: ["ak47Focus","applyDamageToPrimaryWeapon"], formula: "add" }],
  },
  "weapon.AK47.ak47Focus.damagePerStack": {
    kind: "weapon",
    itemId: "AK47",
    targets: [{ path: ["ak47Focus","damagePerStack"], formula: "add" }],
  },
  "weapon.AK47.ak47Focus.fireSuperiorityDamageBonus": {
    kind: "weapon",
    itemId: "AK47",
    targets: [{ path: ["ak47Focus","fireSuperiorityDamageBonus"], formula: "add" }],
  },
  "weapon.AK47.ak47Focus.fireSuperiorityShots": {
    kind: "weapon",
    itemId: "AK47",
    targets: [{ path: ["ak47Focus","fireSuperiorityShots"], formula: "add" }],
  },
  "weapon.AK47.ak47Focus.maxStacks": {
    kind: "weapon",
    itemId: "AK47",
    targets: [{ path: ["ak47Focus","maxStacks"], formula: "add" }],
  },
  "weapon.ASMD_SEC.detonable.comboAdrenalineGain": {
    kind: "weapon",
    itemId: "ASMD_SEC",
    targets: [{ path: ["detonable","comboAdrenalineGain"], formula: "add" }],
  },
  "weapon.ASMD_SEC.matchPrimaryRange": {
    kind: "weapon",
    itemId: "ASMD_SEC",
    targets: [{ path: ["matchPrimaryRange"], formula: "add" }],
  },
  "weapon.ASMD_SEC.proximityArc.damage": {
    kind: "weapon",
    itemId: "ASMD_SEC",
    targets: [{ path: ["proximityArc","damage"], formula: "scale" }],
  },
  "weapon.ASMD_SEC.proximityArc.radius": {
    kind: "weapon",
    itemId: "ASMD_SEC",
    targets: [{ path: ["proximityArc","radius"], formula: "scale" }],
  },
  "weapon.ASMD_SEC.proximityArc.scanIntervalMs": {
    kind: "weapon",
    itemId: "ASMD_SEC",
    targets: [{ path: ["proximityArc","scanIntervalMs"], formula: "add" }],
  },
  "weapon.AWP.awpCharge.corridorEnabled": {
    kind: "weapon",
    itemId: "AWP",
    targets: [{ path: ["awpCharge","corridorEnabled"], formula: "add" }],
  },
  "weapon.AWP.awpCharge.durationMs": {
    kind: "weapon",
    itemId: "AWP",
    targets: [{ path: ["awpCharge","durationMs"], formula: "scale" }],
  },
  "weapon.AWP.awpCharge.fireTrailDurationMs": {
    kind: "weapon",
    itemId: "AWP",
    targets: [{ path: ["awpCharge","fireTrailDurationMs"], formula: "add" }],
  },
  "weapon.AWP.awpCharge.fireTrailHalfWidthCells": {
    kind: "weapon",
    itemId: "AWP",
    targets: [{ path: ["awpCharge","fireTrailHalfWidthCells"], formula: "add" }],
  },
  "weapon.AWP.awpCharge.fullChargeDamageBonus": {
    kind: "weapon",
    itemId: "AWP",
    targets: [{ path: ["awpCharge","fullChargeDamageBonus"], formula: "add" }],
  },
  "weapon.AWP.awpCharge.maxDamageBonus": {
    kind: "weapon",
    itemId: "AWP",
    targets: [{ path: ["awpCharge","maxDamageBonus"], formula: "add" }],
  },
  "weapon.AWP.penetratesRocks": {
    kind: "weapon",
    itemId: "AWP",
    targets: [{ path: ["penetratesRocks"], formula: "add" }],
  },
  "weapon.AWP.penetrationCount": {
    kind: "weapon",
    itemId: "AWP",
    targets: [{ path: ["penetrationCount"], formula: "add", createIfMissing: true }],
  },
  "weapon.AWP.penetrationDamageRetention": {
    kind: "weapon",
    itemId: "AWP",
    targets: [{ path: ["penetrationDamageRetention"], formula: "add", createIfMissing: true }],
  },
  "weapon.ENERGY_SHIELD.fire.adrenalineDrainPerSecond": {
    kind: "weapon",
    itemId: "ENERGY_SHIELD",
    targets: [{ path: ["fire","adrenalineDrainPerSecond"], formula: "scale" }],
  },
  "weapon.ENERGY_SHIELD.fire.buffDecayDelayMs": {
    kind: "weapon",
    itemId: "ENERGY_SHIELD",
    targets: [{ path: ["fire","buffDecayDelayMs"], formula: "scale" }],
  },
  "weapon.ENERGY_SHIELD.fire.buffDecayPerSecond": {
    kind: "weapon",
    itemId: "ENERGY_SHIELD",
    targets: [{ path: ["fire","buffDecayPerSecond"], formula: "scale" }],
  },
  "weapon.ENERGY_SHIELD.fire.buffMaxBonus": {
    kind: "weapon",
    itemId: "ENERGY_SHIELD",
    targets: [{ path: ["fire","buffMaxBonus"], formula: "add" }],
  },
  "weapon.ENERGY_SHIELD.fire.domeEnabled": {
    kind: "weapon",
    itemId: "ENERGY_SHIELD",
    targets: [{ path: ["fire","domeEnabled"], formula: "add" }],
  },
  "weapon.ENERGY_SHIELD.fire.domeHealPerSecond": {
    kind: "weapon",
    itemId: "ENERGY_SHIELD",
    targets: [{ path: ["fire","domeHealPerSecond"], formula: "add" }],
  },
  "weapon.ENERGY_SHIELD.fire.domeRadius": {
    kind: "weapon",
    itemId: "ENERGY_SHIELD",
    targets: [{ path: ["fire","domeRadius"], formula: "scale" }],
  },
  "weapon.ENERGY_SHIELD.fire.domeReflectProjectiles": {
    kind: "weapon",
    itemId: "ENERGY_SHIELD",
    targets: [{ path: ["fire","domeReflectProjectiles"], formula: "add" }],
  },
  "weapon.ENERGY_SHIELD.fire.domeToggleEnabled": {
    kind: "weapon",
    itemId: "ENERGY_SHIELD",
    targets: [{ path: ["fire","domeToggleEnabled"], formula: "add" }],
  },
  "weapon.ENERGY_SHIELD.fire.movementSlowFactor": {
    kind: "weapon",
    itemId: "ENERGY_SHIELD",
    targets: [{ path: ["fire","movementSlowFactor"], formula: "add" }],
  },
  "weapon.FLAMETHROWER.cooldown": {
    kind: "weapon",
    itemId: "FLAMETHROWER",
    targets: [{ path: ["cooldown"], formula: "add" }],
  },
  "weapon.FLAMETHROWER.damage": {
    kind: "weapon",
    itemId: "FLAMETHROWER",
    targets: [{ path: ["damage"], formula: "add" }],
  },
  "weapon.FLAMETHROWER.fire.fireball.chunkCount": {
    kind: "weapon",
    itemId: "FLAMETHROWER",
    targets: [{ path: ["fire","fireball","chunkCount"], formula: "add" }],
  },
  "weapon.FLAMETHROWER.fire.fireball.enabled": {
    kind: "weapon",
    itemId: "FLAMETHROWER",
    targets: [{ path: ["fire","fireball","enabled"], formula: "add" }],
  },
  "weapon.FLAMETHROWER.fire.fireball.trailEnabled": {
    kind: "weapon",
    itemId: "FLAMETHROWER",
    targets: [{ path: ["fire","fireball","trailEnabled"], formula: "add" }],
  },
  "weapon.GLOCK.adrenalinGain": {
    kind: "weapon",
    itemId: "GLOCK",
    targets: [{ path: ["adrenalinGain"], formula: "scale" }],
  },
  "weapon.GLOCK.hitKnockback": {
    kind: "weapon",
    itemId: "GLOCK",
    targets: [{ path: ["hitKnockback"], formula: "add" }],
  },
  "weapon.HYDRA.damage": {
    kind: "weapon",
    itemId: "HYDRA",
    targets: [{ path: ["damage"], formula: "scale" }],
  },
  "weapon.HYDRA.splitFactor": {
    kind: "weapon",
    itemId: "HYDRA",
    targets: [{ path: ["splitFactor"], formula: "scale" }],
  },
  "weapon.HYDRA.splitHomingEnabled": {
    kind: "weapon",
    itemId: "HYDRA",
    targets: [{ path: ["splitHomingEnabled"], formula: "add", createIfMissing: true }],
  },
  "weapon.LAUBBLAESER.directDamageOverride": {
    kind: "weapon",
    itemId: "LAUBBLAESER",
    targets: [{ path: ["directDamageOverride"], formula: "add" }],
  },
  "weapon.NEGEV.hitSlowFraction": {
    kind: "weapon",
    itemId: "NEGEV",
    targets: [{ path: ["hitSlowFraction"], formula: "add" }],
  },
  "weapon.NEGEV.negevKillstreak.armorPerKill": {
    kind: "weapon",
    itemId: "NEGEV",
    targets: [{ path: ["negevKillstreak","armorPerKill"], formula: "add" }],
  },
  "weapon.NEGEV.negevKillstreak.damageBonusPerKill": {
    kind: "weapon",
    itemId: "NEGEV",
    targets: [{ path: ["negevKillstreak","damageBonusPerKill"], formula: "add" }],
  },
  "weapon.NEGEV.negevKillstreak.explosionEnabled": {
    kind: "weapon",
    itemId: "NEGEV",
    targets: [{ path: ["negevKillstreak","explosionEnabled"], formula: "add" }],
  },
  "weapon.NEGEV.negevKillstreak.healPerKill": {
    kind: "weapon",
    itemId: "NEGEV",
    targets: [{ path: ["negevKillstreak","healPerKill"], formula: "add" }],
  },
  "weapon.NEGEV.warmupBurnThreshold": {
    kind: "weapon",
    itemId: "NEGEV",
    targets: [{ path: ["warmupBurnThreshold"], formula: "add" }],
  },
  "weapon.OVERCHARGE_CORE.adrenalinCost": {
    kind: "weapon",
    itemId: "OVERCHARGE_CORE",
    targets: [{ path: ["adrenalinCost"], formula: "scale" }],
  },
  "weapon.OVERCHARGE_CORE.fire.damageMultiplier": {
    kind: "weapon",
    itemId: "OVERCHARGE_CORE",
    targets: [{ path: ["fire","damageMultiplier"], formula: "add" }],
  },
  "weapon.OVERCHARGE_CORE.fire.durationMs": {
    kind: "weapon",
    itemId: "OVERCHARGE_CORE",
    targets: [{ path: ["fire","durationMs"], formula: "scale" }],
  },
  "weapon.OVERCHARGE_CORE.fire.fireRateMultiplier": {
    kind: "weapon",
    itemId: "OVERCHARGE_CORE",
    targets: [{ path: ["fire","fireRateMultiplier"], formula: "add" }],
  },
  "weapon.OVERCHARGE_CORE.fire.radius": {
    kind: "weapon",
    itemId: "OVERCHARGE_CORE",
    targets: [{ path: ["fire","radius"], formula: "scale" }],
  },
  "weapon.PLASMA.killSplitAngleDegrees": {
    kind: "weapon",
    itemId: "PLASMA",
    targets: [{ path: ["killSplitAngleDegrees"], formula: "add", createIfMissing: true }],
  },
  "weapon.PLASMA.killSplitCount": {
    kind: "weapon",
    itemId: "PLASMA",
    targets: [{ path: ["killSplitCount"], formula: "add", createIfMissing: true }],
  },
  "weapon.PLASMA.killSplitDamageFactor": {
    kind: "weapon",
    itemId: "PLASMA",
    targets: [{ path: ["killSplitDamageFactor"], formula: "add", createIfMissing: true }],
  },
  "weapon.ROCKET_LAUNCHER.fire.impactExplosion.groundFire.burnDamagePerTick": {
    kind: "weapon",
    itemId: "ROCKET_LAUNCHER",
    targets: [{ path: ["fire","impactExplosion","groundFire","burnDamagePerTick"], formula: "scale" }],
  },
  "weapon.ROCKET_LAUNCHER.fire.impactExplosion.groundFire.lingerDuration": {
    kind: "weapon",
    itemId: "ROCKET_LAUNCHER",
    targets: [{ path: ["fire","impactExplosion","groundFire","lingerDuration"], formula: "add" }],
  },
  "weapon.SHOTGUN.range": {
    kind: "weapon",
    itemId: "SHOTGUN",
    targets: [{ path: ["range"], formula: "scale" }],
  },
  "weapon.SHOTGUN.shotgunChainDamageRetention": {
    kind: "weapon",
    itemId: "SHOTGUN",
    targets: [{ path: ["shotgunChainDamageRetention"], formula: "add" }],
  },
  "weapon.SHOTGUN.shotgunChainEnabled": {
    kind: "weapon",
    itemId: "SHOTGUN",
    targets: [{ path: ["shotgunChainEnabled"], formula: "add" }],
  },
  "weapon.SHOTGUN.shotgunChainRadiusRetention": {
    kind: "weapon",
    itemId: "SHOTGUN",
    targets: [{ path: ["shotgunChainRadiusRetention"], formula: "add" }],
  },
  "weapon.SHOTGUN.shotgunLightningAppliesSlow": {
    kind: "weapon",
    itemId: "SHOTGUN",
    targets: [{ path: ["shotgunLightningAppliesSlow"], formula: "add" }],
  },
  "weapon.SHOTGUN.shotgunLightningDamage": {
    kind: "weapon",
    itemId: "SHOTGUN",
    targets: [{ path: ["shotgunLightningDamage"], formula: "scale" }],
  },
  "weapon.SHOTGUN.shotgunLightningRadius": {
    kind: "weapon",
    itemId: "SHOTGUN",
    targets: [{ path: ["shotgunLightningRadius"], formula: "scale" }],
  },
  "weapon.SHOTGUN.shotgunProximityMaxDamageBonus": {
    kind: "weapon",
    itemId: "SHOTGUN",
    targets: [{ path: ["shotgunProximityMaxDamageBonus"], formula: "add" }],
  },
  "weapon.SHOTGUN.shotgunSlowFraction": {
    kind: "weapon",
    itemId: "SHOTGUN",
    targets: [{ path: ["shotgunSlowFraction"], formula: "add" }],
  },
  "weapon.TESLA_DOME.fire.chargeIntervalMs": {
    kind: "weapon",
    itemId: "TESLA_DOME",
    targets: [{ path: ["fire","chargeIntervalMs"], formula: "add" }],
  },
  "weapon.TESLA_DOME.fire.damageBonusPerCharge": {
    kind: "weapon",
    itemId: "TESLA_DOME",
    targets: [{ path: ["fire","damageBonusPerCharge"], formula: "add" }],
  },
  "weapon.TESLA_DOME.fire.maxChargeStacks": {
    kind: "weapon",
    itemId: "TESLA_DOME",
    targets: [{ path: ["fire","maxChargeStacks"], formula: "add" }],
  },
  "weapon.TESLA_DOME.fire.radiusBonusPerCharge": {
    kind: "weapon",
    itemId: "TESLA_DOME",
    targets: [{ path: ["fire","radiusBonusPerCharge"], formula: "add" }],
  },
} as const satisfies Readonly<Record<string, ConfigStatDescriptor>>;
