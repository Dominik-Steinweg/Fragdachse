import type { LoadoutSlot } from '../types';
import type { ResolvedLoadoutSelection } from './LoadoutRules';
import { WEAPON_CONFIGS, type UltimateConfig, type UtilityConfig, type WeaponConfig } from './LoadoutConfig';

export interface CoopDefenseEffectTotalsSource {
  additive: Readonly<Record<string, number>>;
  percentage: Readonly<Record<string, number>>;
}

type ConfigKind = 'weapon' | 'utility' | 'ultimate';
type ModifierOperation = 'scale' | 'inverse_scale' | 'add';

interface PathTarget {
  path: readonly string[];
  operation: ModifierOperation;
}

interface ConfigStatDescriptor {
  kind: ConfigKind;
  slot?: LoadoutSlot;
  itemId?: string;
  targets: readonly PathTarget[];
}

const CONFIG_STAT_DESCRIPTORS: Readonly<Record<string, ConfigStatDescriptor>> = Object.freeze({
  'weapon1.adrenalinGain': {
    kind: 'weapon',
    slot: 'weapon1',
    targets: [{ path: ['adrenalinGain'], operation: 'scale' }],
  },
  'weapon1.fireRate': {
    kind: 'weapon',
    slot: 'weapon1',
    targets: [{ path: ['cooldown'], operation: 'inverse_scale' }],
  },
  'weapon1.damage': {
    kind: 'weapon',
    slot: 'weapon1',
    targets: [{ path: ['damage'], operation: 'scale' }],
  },
  'weapon2.adrenalinCost': {
    kind: 'weapon',
    slot: 'weapon2',
    targets: [{ path: ['adrenalinCost'], operation: 'scale' }],
  },
  'weapon2.fireRate': {
    kind: 'weapon',
    slot: 'weapon2',
    targets: [{ path: ['cooldown'], operation: 'inverse_scale' }],
  },
  'weapon2.damage': {
    kind: 'weapon',
    slot: 'weapon2',
    targets: [
      { path: ['damage'], operation: 'scale' },
      { path: ['fire', 'fireball', 'explosionMaxDamage'], operation: 'scale' },
      { path: ['fire', 'fireball', 'explosionMinDamage'], operation: 'scale' },
    ],
  },
  'weapon.GLOCK.burnOnHit.durationMs': {
    kind: 'weapon',
    itemId: 'GLOCK',
    targets: [{ path: ['burnOnHit', 'durationMs'], operation: 'add' }],
  },
  'weapon.GLOCK.burnOnHit.damagePerTick': {
    kind: 'weapon',
    itemId: 'GLOCK',
    targets: [{ path: ['burnOnHit', 'damagePerTick'], operation: 'scale' }],
  },
  'weapon.PLASMA.homing.maxTurnDegreesPerStep': {
    kind: 'weapon',
    itemId: 'PLASMA',
    targets: [{ path: ['fire', 'homing', 'maxTurnDegreesPerStep'], operation: 'scale' }],
  },
  'weapon.PLASMA.projectileSpeed': {
    kind: 'weapon',
    itemId: 'PLASMA',
    targets: [{ path: ['fire', 'projectileSpeed'], operation: 'scale' }],
  },
  'weapon.PLASMA.adrenalinGain': {
    kind: 'weapon',
    itemId: 'PLASMA',
    targets: [{ path: ['fire', 'adrenalinGain'], operation: 'scale' }],
  },
  'weapon.ASMD_PRIM.range': {
    kind: 'weapon',
    itemId: 'ASMD_PRIM',
    targets: [{ path: ['range'], operation: 'scale' }],
  },
  'weapon.ASMD_PRIM.cooldown': {
    kind: 'weapon',
    itemId: 'ASMD_PRIM',
    targets: [{ path: ['cooldown'], operation: 'scale' }],
  },
  'weapon.ASMD_PRIM.damage': {
    kind: 'weapon',
    itemId: 'ASMD_PRIM',
    targets: [{ path: ['damage'], operation: 'scale' }],
  },
  'weapon.ASMD_PRIM.chainLightning.maxJumps': {
    kind: 'weapon',
    itemId: 'ASMD_PRIM',
    targets: [{ path: ['chainLightning', 'maxJumps'], operation: 'add' }],
  },
  'weapon.BITE.range': {
    kind: 'weapon',
    itemId: 'BITE',
    targets: [{ path: ['range'], operation: 'scale' }],
  },
  'weapon.BITE.damage': {
    kind: 'weapon',
    itemId: 'BITE',
    targets: [{ path: ['damage'], operation: 'scale' }],
  },
  'weapon.BITE.damageReduction': {
    kind: 'weapon',
    itemId: 'BITE',
    targets: [{ path: ['damageReduction'], operation: 'add' }],
  },
  'weapon.BITE.hitHeal': {
    kind: 'weapon',
    itemId: 'BITE',
    targets: [{ path: ['hitHeal'], operation: 'add' }],
  },
  'weapon.BITE.hitAdrenaline': {
    kind: 'weapon',
    itemId: 'BITE',
    targets: [{ path: ['hitAdrenaline'], operation: 'add' }],
  },
  'weapon.BITE.bloodEffectMultiplier': {
    kind: 'weapon',
    itemId: 'BITE',
    targets: [{ path: ['bloodEffectMultiplier'], operation: 'scale' }],
  },
  'weapon.HYDRA.splitCount': {
    kind: 'weapon',
    itemId: 'HYDRA',
    targets: [{ path: ['splitCount'], operation: 'add' }],
  },
  'weapon.HYDRA.range': {
    kind: 'weapon',
    itemId: 'HYDRA',
    targets: [{ path: ['range'], operation: 'scale' }],
  },
  'weapon.HYDRA.projectileSpeed': {
    kind: 'weapon',
    itemId: 'HYDRA',
    targets: [{ path: ['fire', 'projectileSpeed'], operation: 'scale' }],
  },
  'weapon.XBOW.range': {
    kind: 'weapon',
    itemId: 'XBOW',
    targets: [{ path: ['range'], operation: 'scale' }],
  },
  'weapon.XBOW.projectileSpeed': {
    kind: 'weapon',
    itemId: 'XBOW',
    targets: [{ path: ['fire', 'projectileSpeed'], operation: 'scale' }],
  },
  'weapon.XBOW.pelletCount': {
    kind: 'weapon',
    itemId: 'XBOW',
    targets: [{ path: ['pelletCount'], operation: 'add' }],
  },
  'weapon.XBOW.enemyHitExplosion.radius': {
    kind: 'weapon',
    itemId: 'XBOW',
    targets: [{ path: ['fire', 'enemyHitExplosion', 'radius'], operation: 'add' }],
  },
  'weapon.XBOW.enemyHitExplosion.maxDamage': {
    kind: 'weapon',
    itemId: 'XBOW',
    targets: [{ path: ['fire', 'enemyHitExplosion', 'maxDamage'], operation: 'add' }],
  },
  'weapon.LAUBBLAESER.maxKnockback': {
    kind: 'weapon',
    itemId: 'LAUBBLAESER',
    targets: [{ path: ['fire', 'maxKnockback'], operation: 'scale' }],
  },
  'weapon.LAUBBLAESER.hitboxEndSize': {
    kind: 'weapon',
    itemId: 'LAUBBLAESER',
    targets: [{ path: ['fire', 'hitboxEndSize'], operation: 'scale' }],
  },
  'weapon.LAUBBLAESER.adrenalinGain': {
    kind: 'weapon',
    itemId: 'LAUBBLAESER',
    targets: [{ path: ['adrenalinGain'], operation: 'scale' }],
  },
  'weapon.P90.range': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['range'], operation: 'scale' }],
  },
  'weapon.P90.spread': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [
      { path: ['spreadStanding'], operation: 'scale' },
      { path: ['spreadMoving'], operation: 'scale' },
      { path: ['spreadPerShot'], operation: 'scale' },
      { path: ['maxDynamicSpread'], operation: 'scale' },
    ],
  },
  'weapon.P90.damage': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['damage'], operation: 'scale' }],
  },
  'weapon.P90.adrenalinCost': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['adrenalinCost'], operation: 'scale' }],
  },
  'weapon.P90.pelletCount': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['pelletCount'], operation: 'add' }],
  },
  'weapon.P90.pelletSpreadAngle': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['pelletSpreadAngle'], operation: 'add' }],
  },
  'weapon.P90.cooldown': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['cooldown'], operation: 'scale' }],
  },
  // Separater, nachgelagerter Faktor: reduziert den bereits durch Homing-Overdrive
  // vervierfachten Cooldown, statt dessen starken Malus mit ihm zu verrechnen.
  'weapon.P90.homingCooldownReduction': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['cooldown'], operation: 'scale' }],
  },
  'weapon.P90.homingEnabled': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['homingEnabled'], operation: 'add' }],
  },
  'weapon.P90.homing.maxTurnDegreesPerStep': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['fire', 'homing', 'maxTurnDegreesPerStep'], operation: 'scale' }],
  },
  'weapon.ROCKET_LAUNCHER.impactExplosion.radius': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [
      { path: ['fire', 'impactExplosion', 'radius'], operation: 'scale' },
      { path: ['fire', 'impactExplosion', 'groundFire', 'radius'], operation: 'scale' },
    ],
  },
  'weapon.ROCKET_LAUNCHER.cooldown': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [{ path: ['cooldown'], operation: 'scale' }],
  },
  'weapon.ROCKET_LAUNCHER.adrenalinCost': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [{ path: ['adrenalinCost'], operation: 'scale' }],
  },
  'weapon.ROCKET_LAUNCHER.damage': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [{ path: ['damage'], operation: 'scale' }],
  },
  'weapon.ROCKET_LAUNCHER.blackHoleDurationMs': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [{ path: ['fire', 'impactExplosion', 'blackHoleDurationMs'], operation: 'add' }],
  },
  'weapon.ROCKET_LAUNCHER.blackHolePullStrength': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [{ path: ['fire', 'impactExplosion', 'blackHolePullStrength'], operation: 'scale' }],
  },
  'weapon.ROCKET_LAUNCHER.burnOnHit.durationMs': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [{ path: ['fire', 'impactExplosion', 'burnOnHit', 'durationMs'], operation: 'add' }],
  },
  'weapon.ROCKET_LAUNCHER.burnOnHit.damagePerTick': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [{ path: ['fire', 'impactExplosion', 'burnOnHit', 'damagePerTick'], operation: 'scale' }],
  },
  'weapon.AK47.range': {
    kind: 'weapon',
    itemId: 'AK47',
    targets: [{ path: ['range'], operation: 'scale' }],
  },
  'weapon.AK47.spread': {
    kind: 'weapon',
    itemId: 'AK47',
    targets: [
      { path: ['spreadStanding'], operation: 'scale' },
      { path: ['spreadMoving'], operation: 'scale' },
      { path: ['spreadPerShot'], operation: 'scale' },
      { path: ['maxDynamicSpread'], operation: 'scale' },
    ],
  },
  'weapon.AK47.damage': {
    kind: 'weapon',
    itemId: 'AK47',
    targets: [{ path: ['damage'], operation: 'scale' }],
  },
  'weapon.AK47.adrenalinCost': {
    kind: 'weapon',
    itemId: 'AK47',
    targets: [{ path: ['adrenalinCost'], operation: 'scale' }],
  },
  'weapon.SHOTGUN.pelletCount': {
    kind: 'weapon',
    itemId: 'SHOTGUN',
    targets: [{ path: ['pelletCount'], operation: 'add' }],
  },
  'weapon.SHOTGUN.pelletSpreadAngle': {
    kind: 'weapon',
    itemId: 'SHOTGUN',
    targets: [{ path: ['pelletSpreadAngle'], operation: 'add' }],
  },
  'weapon.ASMD_SEC.detonable.aoeRadius': {
    kind: 'weapon',
    itemId: 'ASMD_SEC',
    targets: [{ path: ['detonable', 'aoeRadius'], operation: 'scale' }],
  },
  'weapon.ASMD_SEC.projectileSpeed': {
    kind: 'weapon',
    itemId: 'ASMD_SEC',
    targets: [{ path: ['fire', 'projectileSpeed'], operation: 'scale' }],
  },
  'weapon.ASMD_SEC.damage': {
    kind: 'weapon',
    itemId: 'ASMD_SEC',
    targets: [{ path: ['damage'], operation: 'scale' }],
  },
  'weapon.ASMD_SEC.dotArea.durationMs': {
    kind: 'weapon',
    itemId: 'ASMD_SEC',
    targets: [{ path: ['detonable', 'dotArea', 'durationMs'], operation: 'add' }],
  },
  'weapon.ASMD_SEC.dotArea.damagePerTick': {
    kind: 'weapon',
    itemId: 'ASMD_SEC',
    targets: [{ path: ['detonable', 'dotArea', 'damagePerTick'], operation: 'scale' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.impactExplosion.radius': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['fire', 'impactExplosion', 'radius'], operation: 'scale' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.homing.maxTurnDegreesPerStep': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['fire', 'homing', 'maxTurnDegreesPerStep'], operation: 'scale' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.impactExplosion.falloffReduction': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['fire', 'impactExplosion', 'falloffReduction'], operation: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.impactExplosion.damage': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [
      { path: ['fire', 'impactExplosion', 'maxDamage'], operation: 'scale' },
      { path: ['fire', 'impactExplosion', 'minDamage'], operation: 'scale' },
    ],
  },
  'weapon.MINI_ROCKET_LAUNCHER.multiExplosionCount': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['multiExplosionCount'], operation: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.multiExplosionCoastMs': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['multiExplosionCoastMs'], operation: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.miniRocketReturnEnabled': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['miniRocketReturnEnabled'], operation: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.miniRocketPickupAdrenalineRefundFraction': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['miniRocketPickupAdrenalineRefundFraction'], operation: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.miniRocketPickupArmor': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['miniRocketPickupArmor'], operation: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.miniRocketCascadeInitialDamageBonus': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['miniRocketCascadeInitialDamageBonus'], operation: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.miniRocketCascadeDamageBonusPerExplosion': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['miniRocketCascadeDamageBonusPerExplosion'], operation: 'add' }],
  },
  'weapon.AWP.cooldown': {
    kind: 'weapon',
    itemId: 'AWP',
    targets: [{ path: ['cooldown'], operation: 'scale' }],
  },
  'weapon.AWP.aimDuration': {
    kind: 'weapon',
    itemId: 'AWP',
    targets: [{ path: ['scopeConfig', 'scopeInMs'], operation: 'scale' }],
  },
  'weapon.AWP.adrenalinCost': {
    kind: 'weapon',
    itemId: 'AWP',
    targets: [{ path: ['adrenalinCost'], operation: 'scale' }],
  },
  'weapon.FLAMETHROWER.burnDurationMs': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'burnDurationMs'], operation: 'scale' }],
  },
  'weapon.FLAMETHROWER.burnDamagePerTick': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'burnDamagePerTick'], operation: 'scale' }],
  },
  'weapon.FLAMETHROWER.hitboxEndSize': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'hitboxEndSize'], operation: 'scale' }],
  },
  'weapon.FLAMETHROWER.piercing': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'piercingCount'], operation: 'add' }],
  },
  'weapon.FLAMETHROWER.adrenalinCost': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['adrenalinCost'], operation: 'scale' }],
  },
  'weapon.FLAMETHROWER.range': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['range'], operation: 'scale' }],
  },
  'weapon.FLAMETHROWER.kamikaze.enabled': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'kamikaze', 'enabled'], operation: 'add' }],
  },
  'weapon.FLAMETHROWER.kamikaze.inheritMolotovBonuses': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'kamikaze', 'inheritMolotovBonuses'], operation: 'add' }],
  },
  'weapon.FLAMETHROWER.burningGround.cellSize': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'burningGround', 'cellSize'], operation: 'add' }],
  },
  'weapon.FLAMETHROWER.burningGround.durationMs': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'burningGround', 'durationMs'], operation: 'add' }],
  },
  'weapon.FLAMETHROWER.burningGround.igniteProjectiles': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'burningGround', 'igniteProjectiles'], operation: 'add' }],
  },
  'weapon.FLAMETHROWER.burningGround.createOnFlameExpiry': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'burningGround', 'createOnFlameExpiry'], operation: 'add' }],
  },
  'weapon.FLAMETHROWER.fireRing.radius': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'fireRing', 'radius'], operation: 'scale' }],
  },
  'weapon.FLAMETHROWER.fireRing.thickness': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'fireRing', 'thickness'], operation: 'add' }],
  },
  'weapon.FLAMETHROWER.fireRing.igniteProjectiles': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'fireRing', 'igniteProjectiles'], operation: 'add' }],
  },
  'weapon.NEGEV.range': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['range'], operation: 'scale' }],
  },
  'weapon.NEGEV.holdSpeedBonus': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['holdSpeedFactor'], operation: 'add' }],
  },
  'weapon.NEGEV.projectileMaxBounces': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['fire', 'projectileMaxBounces'], operation: 'add' }],
  },
  'weapon.NEGEV.warmupDuration': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['warmupSpeedMultiplier'], operation: 'inverse_scale' }],
  },
  'weapon.NEGEV.burnOnHit.durationMs': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['burnOnHit', 'durationMs'], operation: 'add' }],
  },
  'weapon.NEGEV.burnOnHit.damagePerTick': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['burnOnHit', 'damagePerTick'], operation: 'scale' }],
  },
  'weapon.TESLA_DOME.radius': {
    kind: 'weapon',
    itemId: 'TESLA_DOME',
    targets: [{ path: ['fire', 'radius'], operation: 'scale' }],
  },
  'weapon.TESLA_DOME.damagePerTick': {
    kind: 'weapon',
    itemId: 'TESLA_DOME',
    targets: [{ path: ['fire', 'damagePerTick'], operation: 'scale' }],
  },
  'weapon.TESLA_DOME.movementSlowFactor': {
    kind: 'weapon',
    itemId: 'TESLA_DOME',
    targets: [{ path: ['fire', 'movementSlowFactor'], operation: 'add' }],
  },
  'weapon.TESLA_DOME.adrenalineDrain': {
    kind: 'weapon',
    itemId: 'TESLA_DOME',
    targets: [{ path: ['fire', 'adrenalineDrainPerSecond'], operation: 'scale' }],
  },
  'weapon.ENERGY_SHIELD.blockArcDegrees': {
    kind: 'weapon',
    itemId: 'ENERGY_SHIELD',
    targets: [{ path: ['fire', 'blockArcDegrees'], operation: 'scale' }],
  },
  'weapon.ENERGY_SHIELD.buffMax': {
    kind: 'weapon',
    itemId: 'ENERGY_SHIELD',
    targets: [{ path: ['fire', 'buffMax'], operation: 'scale' }],
  },
  'utility.cooldown': {
    kind: 'utility',
    slot: 'utility',
    targets: [{ path: ['cooldown'], operation: 'scale' }],
  },
  'utility.HE_GRENADE.aoeRadius': {
    kind: 'utility',
    itemId: 'HE_GRENADE',
    targets: [{ path: ['aoeRadius'], operation: 'scale' }],
  },
  'utility.HE_GRENADE.aoeDamage': {
    kind: 'utility',
    itemId: 'HE_GRENADE',
    targets: [{ path: ['aoeDamage'], operation: 'scale' }],
  },
  'utility.HE_GRENADE.cooldown': {
    kind: 'utility',
    itemId: 'HE_GRENADE',
    targets: [{ path: ['cooldown'], operation: 'scale' }],
  },
  'utility.TIME_BUBBLE.bubbleRadius': {
    kind: 'utility',
    itemId: 'TIME_BUBBLE',
    targets: [{ path: ['bubbleRadius'], operation: 'scale' }],
  },
  'utility.TIME_BUBBLE.bubbleDuration': {
    kind: 'utility',
    itemId: 'TIME_BUBBLE',
    targets: [{ path: ['bubbleDuration'], operation: 'scale' }],
  },
  'utility.TIME_BUBBLE.playerSlowFactor': {
    kind: 'utility',
    itemId: 'TIME_BUBBLE',
    targets: [{ path: ['playerSlowFactor'], operation: 'scale' }],
  },
  'utility.TIME_BUBBLE.projectileSlowReduction': {
    kind: 'utility',
    itemId: 'TIME_BUBBLE',
    targets: [{ path: ['projectileSlowFactor'], operation: 'add' }],
  },
  'utility.SMOKE_GRENADE.smokeRadius': {
    kind: 'utility',
    itemId: 'SMOKE_GRENADE',
    targets: [{ path: ['smokeRadius'], operation: 'scale' }],
  },
  'utility.SMOKE_GRENADE.smokeLingerDuration': {
    kind: 'utility',
    itemId: 'SMOKE_GRENADE',
    targets: [{ path: ['smokeLingerDuration'], operation: 'scale' }],
  },
  'utility.SMOKE_GRENADE.dotDamage': {
    kind: 'utility',
    itemId: 'SMOKE_GRENADE',
    targets: [{ path: ['smokeDotDamagePerTick'], operation: 'add' }],
  },
  'utility.MOLOTOV_GRENADE.fireRadius': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['fireRadius'], operation: 'scale' }],
  },
  'utility.MOLOTOV_GRENADE.cooldown': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['cooldown'], operation: 'scale' }],
  },
  'utility.MOLOTOV_GRENADE.fireLingerDuration': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['fireLingerDuration'], operation: 'scale' }],
  },
  'utility.MOLOTOV_GRENADE.fireBurnDamagePerTick': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['fireBurnDamagePerTick'], operation: 'scale' }],
  },
  'utility.MOLOTOV_GRENADE.fireBurnDurationMs': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['fireBurnDurationMs'], operation: 'scale' }],
  },
  'utility.MOLOTOV_GRENADE.wildfireEnabled': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['wildfireEnabled'], operation: 'add' }],
  },
  'utility.MOLOTOV_GRENADE.wildfirePanicSpeedMultiplier': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['wildfirePanicSpeedMultiplier'], operation: 'add' }],
  },
  'utility.MOLOTOV_GRENADE.wildfireTrailDurationMs': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['wildfireTrailDurationMs'], operation: 'add' }],
  },
  'utility.MOLOTOV_GRENADE.wildfireTrailDamagePerTick': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['wildfireTrailDamagePerTick'], operation: 'add' }],
  },
  'utility.STINKDRUESEN.cloudRadius': {
    kind: 'utility',
    itemId: 'STINKDRUESEN',
    targets: [{ path: ['cloudRadius'], operation: 'scale' }],
  },
  'utility.STINKDRUESEN.cloudDamagePerTick': {
    kind: 'utility',
    itemId: 'STINKDRUESEN',
    targets: [{ path: ['cloudDamagePerTick'], operation: 'scale' }],
  },
  'utility.TRANSLOCATOR.projectileSpeed': {
    kind: 'utility',
    itemId: 'TRANSLOCATOR',
    targets: [{ path: ['projectileSpeed'], operation: 'scale' }],
  },
  'utility.TRANSLOCATOR.maxBounces': {
    kind: 'utility',
    itemId: 'TRANSLOCATOR',
    targets: [{ path: ['maxBounces'], operation: 'add' }],
  },
  'utility.FELSBAU.placeable.maxHp': {
    kind: 'utility',
    itemId: 'FELSBAU',
    targets: [{ path: ['placeable', 'maxHp'], operation: 'scale' }],
  },
  'utility.FELSBAU.placeable.lifetimeMs': {
    kind: 'utility',
    itemId: 'FELSBAU',
    targets: [{ path: ['placeable', 'lifetimeMs'], operation: 'scale' }],
  },
  'utility.FLIEGENPILZ.placeable.maxHp': {
    kind: 'utility',
    itemId: 'FLIEGENPILZ',
    targets: [{ path: ['placeable', 'maxHp'], operation: 'scale' }],
  },
  'utility.FLIEGENPILZ.cooldown': {
    kind: 'utility',
    itemId: 'FLIEGENPILZ',
    targets: [{ path: ['cooldown'], operation: 'scale' }],
  },
  'utility.FLIEGENPILZ.placeable.targetRange': {
    kind: 'utility',
    itemId: 'FLIEGENPILZ',
    targets: [{ path: ['placeable', 'targetRange'], operation: 'scale' }],
  },
  'utility.ZEUS_TASER.range': {
    kind: 'utility',
    itemId: 'ZEUS_TASER',
    targets: [{ path: ['range'], operation: 'scale' }],
  },
  'utility.ZEUS_TASER.hitArcDegrees': {
    kind: 'utility',
    itemId: 'ZEUS_TASER',
    targets: [{ path: ['hitArcDegrees'], operation: 'scale' }],
  },
  'utility.DECOY.decoyLifetimeMs': {
    kind: 'utility',
    itemId: 'DECOY',
    targets: [{ path: ['decoyLifetimeMs'], operation: 'scale' }],
  },
  'utility.DECOY.stealthDurationMs': {
    kind: 'utility',
    itemId: 'DECOY',
    targets: [{ path: ['stealthDurationMs'], operation: 'scale' }],
  },
  'ultimate.ARMAGEDDON.damage': {
    kind: 'ultimate',
    itemId: 'ARMAGEDDON',
    targets: [{ path: ['armageddon', 'meteorDamage'], operation: 'scale' }],
  },
  'ultimate.ARMAGEDDON.duration': {
    kind: 'ultimate',
    itemId: 'ARMAGEDDON',
    targets: [
      { path: ['duration'], operation: 'scale' },
      { path: ['rageDrainDuration'], operation: 'scale' },
      { path: ['armageddon', 'meteorsPerSecond'], operation: 'scale' },
    ],
  },
  'ultimate.GAUSS_RIFLE.damage': {
    kind: 'ultimate',
    itemId: 'GAUSS_RIFLE',
    targets: [{ path: ['damage'], operation: 'scale' }],
  },
  'ultimate.GAUSS_RIFLE.chargeDuration': {
    kind: 'ultimate',
    itemId: 'GAUSS_RIFLE',
    targets: [{ path: ['chargeDuration'], operation: 'scale' }],
  },
  'ultimate.AIRSTRIKE.radius': {
    kind: 'ultimate',
    itemId: 'AIRSTRIKE',
    targets: [{ path: ['radius'], operation: 'scale' }],
  },
  'ultimate.AIRSTRIKE.delayMs': {
    kind: 'ultimate',
    itemId: 'AIRSTRIKE',
    targets: [{ path: ['delayMs'], operation: 'scale' }],
  },
  'ultimate.HONEY_BADGER_RAGE.aura.radius': {
    kind: 'ultimate',
    itemId: 'HONEY_BADGER_RAGE',
    targets: [{ path: ['aura', 'radius'], operation: 'scale' }],
  },
  'ultimate.HONEY_BADGER_RAGE.aura.damagePerTick': {
    kind: 'ultimate',
    itemId: 'HONEY_BADGER_RAGE',
    targets: [{ path: ['aura', 'damagePerTick'], operation: 'scale' }],
  },
});

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as T;
  }
  if (isObjectRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      clone[key] = cloneValue(entry);
    }
    return clone as T;
  }
  return value;
}

function getNumberAtPath(root: unknown, path: readonly string[]): number | null {
  let current: unknown = root;
  for (const segment of path) {
    if (!isObjectRecord(current) || !(segment in current)) return null;
    current = current[segment];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : null;
}

function setNumberAtPath(root: Record<string, unknown>, path: readonly string[], value: number): boolean {
  let current: Record<string, unknown> = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const next = current[segment];
    if (!isObjectRecord(next)) return false;
    current = next;
  }
  const leaf = path[path.length - 1];
  if (leaf in current && typeof current[leaf] !== 'number') return false;
  current[leaf] = value;
  return true;
}

function getAutomaticDescriptor(stat: string): ConfigStatDescriptor | null {
  const parts = stat.split('.');
  if (parts.length < 3) return null;
  const prefix = parts.shift();
  const itemId = parts.shift();
  if (!itemId || (prefix !== 'weapon' && prefix !== 'utility' && prefix !== 'ultimate')) return null;
  return {
    kind: prefix,
    itemId,
    targets: [{ path: parts, operation: 'scale' }],
  };
}

function applyOperation(baseValue: number, additive: number, percentage: number, operation: ModifierOperation): number {
  const safeMultiplier = Math.max(0.0001, 1 + percentage);
  switch (operation) {
    case 'add':
      return Math.max(0, baseValue + additive);
    case 'inverse_scale':
      return Math.max(0, (baseValue + additive) / safeMultiplier);
    case 'scale':
    default:
      return Math.max(0, (baseValue + additive) * safeMultiplier);
  }
}

function shouldApplyDescriptor(
  descriptor: ConfigStatDescriptor,
  kind: ConfigKind,
  slot: LoadoutSlot,
  configId: string,
): boolean {
  if (descriptor.kind !== kind) return false;
  if (descriptor.slot && descriptor.slot !== slot) return false;
  if (descriptor.itemId && descriptor.itemId !== configId) return false;
  return true;
}

function applyConfiguredStats<T extends { id: string }>(
  config: T,
  kind: ConfigKind,
  slot: LoadoutSlot,
  totals: CoopDefenseEffectTotalsSource,
): T {
  let nextConfig: Record<string, unknown> | null = null;

  for (const [stat, descriptor] of Object.entries(CONFIG_STAT_DESCRIPTORS)) {
    if (!shouldApplyDescriptor(descriptor, kind, slot, config.id)) continue;

    const additive = totals.additive[stat] ?? 0;
    const percentage = totals.percentage[stat] ?? 0;
    if (additive === 0 && percentage === 0) continue;

    const targetConfig: Record<string, unknown> = nextConfig ?? cloneValue(config as Record<string, unknown>);
    let changed = false;
    for (const target of descriptor.targets) {
      const baseValue = getNumberAtPath(targetConfig, target.path);
      if (baseValue === null) continue;
      const nextValue = applyOperation(baseValue, additive, percentage, target.operation);
      changed = setNumberAtPath(targetConfig, target.path, nextValue) || changed;
    }
    if (changed) nextConfig = targetConfig;
  }


  const allStats = new Set([...Object.keys(totals.additive), ...Object.keys(totals.percentage)]);
  for (const stat of allStats) {
    if (stat in CONFIG_STAT_DESCRIPTORS) continue;
    const descriptor = getAutomaticDescriptor(stat);
    if (!descriptor || !shouldApplyDescriptor(descriptor, kind, slot, config.id)) continue;
    const additive = totals.additive[stat] ?? 0;
    const percentage = totals.percentage[stat] ?? 0;
    const targetConfig = nextConfig ?? cloneValue(config as Record<string, unknown>);
    let changed = false;
    for (const target of descriptor.targets) {
      const baseValue = getNumberAtPath(targetConfig, target.path) ?? 0;
      changed = setNumberAtPath(
        targetConfig,
        target.path,
        applyOperation(baseValue, additive, percentage, target.operation),
      ) || changed;
    }
    if (changed) nextConfig = targetConfig;
  }

  return (nextConfig ?? config) as T;
}

export function applyCoopDefenseModifiersToWeaponConfig(
  config: WeaponConfig,
  slot: 'weapon1' | 'weapon2',
  totals: CoopDefenseEffectTotalsSource,
): WeaponConfig {
  return applyConfiguredStats(config, 'weapon', slot, totals);
}

export function applyCoopDefenseModifiersToUtilityConfig(
  config: UtilityConfig,
  totals: CoopDefenseEffectTotalsSource,
): UtilityConfig {
  return applyConfiguredStats(config, 'utility', 'utility', totals);
}

export function applyCoopDefenseModifiersToUltimateConfig(
  config: UltimateConfig,
  totals: CoopDefenseEffectTotalsSource,
): UltimateConfig {
  return applyConfiguredStats(config, 'ultimate', 'ultimate', totals);
}

export function applyCoopDefenseModifiersToLoadoutSelection(
  selection: ResolvedLoadoutSelection,
  totals: CoopDefenseEffectTotalsSource,
): ResolvedLoadoutSelection {
  const weapon1 = applyCoopDefenseModifiersToWeaponConfig(selection.weapon1, 'weapon1', totals);
  let weapon2 = applyCoopDefenseModifiersToWeaponConfig(selection.weapon2, 'weapon2', totals);
  if (weapon2.id === 'ASMD_SEC' && (weapon2.matchPrimaryRange ?? 0) > 0) {
    const resolvedPrimary = weapon1.id === 'ASMD_PRIM'
      ? weapon1
      : applyCoopDefenseModifiersToWeaponConfig(WEAPON_CONFIGS.ASMD_PRIM, 'weapon1', totals);
    weapon2 = { ...weapon2, range: resolvedPrimary.range };
  }
  return {
    weapon1,
    weapon2,
    utility: applyCoopDefenseModifiersToUtilityConfig(selection.utility, totals),
    ultimate: applyCoopDefenseModifiersToUltimateConfig(selection.ultimate, totals),
  };
}
