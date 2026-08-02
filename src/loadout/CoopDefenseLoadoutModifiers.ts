import type { LoadoutSlot } from '../types';
import { validateResolvedUltimate, validateResolvedUtility, validateResolvedWeapon } from './content/LoadoutSchemas';
import { EXPLICIT_LOADOUT_MODIFIER_DESCRIPTORS } from './ExplicitLoadoutModifierDescriptors';
import type { ResolvedLoadoutSelection } from './LoadoutRules';
import { getUtilityConfigLineage, ULTIMATE_CONFIGS, UTILITY_CONFIGS, WEAPON_CONFIGS, type UltimateConfig, type UtilityConfig, type WeaponConfig } from './LoadoutConfig';

export interface CoopDefenseEffectTotalsSource {
  additive: Readonly<Record<string, number>>;
  percentage: Readonly<Record<string, number>>;
}

type ConfigKind = 'weapon' | 'utility' | 'ultimate';
export type ModifierFormula = 'scale' | 'inverse_scale' | 'add';
export type ModifierBucket = 'additive' | 'percentage';

export interface PathTarget {
  readonly path: readonly string[];
  readonly formula: ModifierFormula;
  readonly createIfMissing?: boolean;
  readonly optionalWhenMissing?: boolean;
}
export interface ModifierTargetContract extends PathTarget {
  readonly operations: readonly ModifierBucket[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly integer: boolean;
  readonly stage: number;
}

export interface ConfigStatDescriptor {
  kind: ConfigKind;
  slot?: LoadoutSlot;
  itemId?: string;
  targets: readonly PathTarget[];
}

export const CONFIG_STAT_DESCRIPTORS: Readonly<Record<string, ConfigStatDescriptor>> = Object.freeze({
  ...EXPLICIT_LOADOUT_MODIFIER_DESCRIPTORS,
  'weapon1.adrenalinGain': {
    kind: 'weapon',
    slot: 'weapon1',
    targets: [{ path: ['adrenalinGain'], formula: 'scale' }],
  },
  'weapon1.fireRate': {
    kind: 'weapon',
    slot: 'weapon1',
    targets: [{ path: ['cooldown'], formula: 'inverse_scale' }],
  },
  'weapon1.damage': {
    kind: 'weapon',
    slot: 'weapon1',
    targets: [{ path: ['damage'], formula: 'scale' }],
  },
  'weapon2.adrenalinCost': {
    kind: 'weapon',
    slot: 'weapon2',
    targets: [{ path: ['adrenalinCost'], formula: 'scale' }],
  },
  'weapon2.fireRate': {
    kind: 'weapon',
    slot: 'weapon2',
    targets: [{ path: ['cooldown'], formula: 'inverse_scale' }],
  },
  'weapon2.damage': {
    kind: 'weapon',
    slot: 'weapon2',
    targets: [
      { path: ['damage'], formula: 'scale' },
      { path: ['fire', 'fireball', 'explosionMaxDamage'], formula: 'scale', optionalWhenMissing: true },
      { path: ['fire', 'fireball', 'explosionMinDamage'], formula: 'scale', optionalWhenMissing: true },
    ],
  },
  'weapon.GLOCK.burnOnHit.durationMs': {
    kind: 'weapon',
    itemId: 'GLOCK',
    targets: [{ path: ['burnOnHit', 'durationMs'], formula: 'add' }],
  },
  'weapon.GLOCK.burnOnHit.damagePerTick': {
    kind: 'weapon',
    itemId: 'GLOCK',
    targets: [{ path: ['burnOnHit', 'damagePerTick'], formula: 'scale' }],
  },
  'weapon.PLASMA.homing.maxTurnDegreesPerStep': {
    kind: 'weapon',
    itemId: 'PLASMA',
    targets: [{ path: ['fire', 'homing', 'maxTurnDegreesPerStep'], formula: 'scale' }],
  },
  'weapon.PLASMA.projectileSpeed': {
    kind: 'weapon',
    itemId: 'PLASMA',
    targets: [{ path: ['fire', 'projectileSpeed'], formula: 'scale' }],
  },
  'weapon.PLASMA.adrenalinGain': {
    kind: 'weapon',
    itemId: 'PLASMA',
    targets: [{ path: ['adrenalinGain'], formula: 'scale' }],
  },
  'weapon.ASMD_PRIM.range': {
    kind: 'weapon',
    itemId: 'ASMD_PRIM',
    targets: [{ path: ['range'], formula: 'scale' }],
  },
  'weapon.ASMD_PRIM.cooldown': {
    kind: 'weapon',
    itemId: 'ASMD_PRIM',
    targets: [{ path: ['cooldown'], formula: 'scale' }],
  },
  'weapon.ASMD_PRIM.damage': {
    kind: 'weapon',
    itemId: 'ASMD_PRIM',
    targets: [{ path: ['damage'], formula: 'scale' }],
  },
  'weapon.ASMD_PRIM.chainLightning.maxJumps': {
    kind: 'weapon',
    itemId: 'ASMD_PRIM',
    targets: [{ path: ['chainLightning', 'maxJumps'], formula: 'add' }],
  },
  'weapon.BITE.range': {
    kind: 'weapon',
    itemId: 'BITE',
    targets: [{ path: ['range'], formula: 'scale' }],
  },
  'weapon.BITE.damage': {
    kind: 'weapon',
    itemId: 'BITE',
    targets: [{ path: ['damage'], formula: 'scale' }],
  },
  'weapon.BITE.damageReduction': {
    kind: 'weapon',
    itemId: 'BITE',
    targets: [{ path: ['damageReduction'], formula: 'add', createIfMissing: true }],
  },
  'weapon.BITE.hitHeal': {
    kind: 'weapon',
    itemId: 'BITE',
    targets: [{ path: ['hitHeal'], formula: 'add' }],
  },
  'weapon.BITE.hitAdrenaline': {
    kind: 'weapon',
    itemId: 'BITE',
    targets: [{ path: ['hitAdrenaline'], formula: 'add' }],
  },
  'weapon.BITE.bloodEffectMultiplier': {
    kind: 'weapon',
    itemId: 'BITE',
    targets: [{ path: ['bloodEffectMultiplier'], formula: 'scale' }],
  },
  'weapon.HYDRA.splitCount': {
    kind: 'weapon',
    itemId: 'HYDRA',
    targets: [{ path: ['splitCount'], formula: 'add' }],
  },
  'weapon.HYDRA.range': {
    kind: 'weapon',
    itemId: 'HYDRA',
    targets: [{ path: ['range'], formula: 'scale' }],
  },
  'weapon.HYDRA.projectileSpeed': {
    kind: 'weapon',
    itemId: 'HYDRA',
    targets: [{ path: ['fire', 'projectileSpeed'], formula: 'scale' }],
  },
  'weapon.XBOW.range': {
    kind: 'weapon',
    itemId: 'XBOW',
    targets: [{ path: ['range'], formula: 'scale' }],
  },
  'weapon.XBOW.projectileSpeed': {
    kind: 'weapon',
    itemId: 'XBOW',
    targets: [{ path: ['fire', 'projectileSpeed'], formula: 'scale' }],
  },
  'weapon.XBOW.pelletCount': {
    kind: 'weapon',
    itemId: 'XBOW',
    targets: [{ path: ['pelletCount'], formula: 'add' }],
  },
  'weapon.XBOW.enemyHitExplosion.radius': {
    kind: 'weapon',
    itemId: 'XBOW',
    targets: [{ path: ['fire', 'enemyHitExplosion', 'radius'], formula: 'add' }],
  },
  'weapon.XBOW.enemyHitExplosion.maxDamage': {
    kind: 'weapon',
    itemId: 'XBOW',
    targets: [{ path: ['fire', 'enemyHitExplosion', 'maxDamage'], formula: 'add' }],
  },
  'weapon.LAUBBLAESER.maxKnockback': {
    kind: 'weapon',
    itemId: 'LAUBBLAESER',
    targets: [{ path: ['fire', 'maxKnockback'], formula: 'scale' }],
  },
  'weapon.LAUBBLAESER.hitboxEndSize': {
    kind: 'weapon',
    itemId: 'LAUBBLAESER',
    targets: [{ path: ['fire', 'hitboxEndSize'], formula: 'scale' }],
  },
  'weapon.LAUBBLAESER.adrenalinGain': {
    kind: 'weapon',
    itemId: 'LAUBBLAESER',
    targets: [{ path: ['adrenalinGain'], formula: 'scale' }],
  },
  'weapon.P90.range': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['range'], formula: 'scale' }],
  },
  'weapon.P90.spread': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [
      { path: ['spreadStanding'], formula: 'scale' },
      { path: ['spreadMoving'], formula: 'scale' },
      { path: ['spreadPerShot'], formula: 'scale' },
      { path: ['maxDynamicSpread'], formula: 'scale' },
    ],
  },
  'weapon.P90.damage': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['damage'], formula: 'scale' }],
  },
  'weapon.P90.adrenalinCost': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['adrenalinCost'], formula: 'scale' }],
  },
  'weapon.P90.pelletCount': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['pelletCount'], formula: 'add' }],
  },
  'weapon.P90.pelletSpreadAngle': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['pelletSpreadAngle'], formula: 'add' }],
  },
  'weapon.P90.cooldown': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['cooldown'], formula: 'scale' }],
  },
  // Separater, nachgelagerter Faktor: reduziert den bereits durch Homing-Overdrive
  // vervierfachten Cooldown, statt dessen starken Malus mit ihm zu verrechnen.
  'weapon.P90.homingCooldownReduction': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['cooldown'], formula: 'scale' }],
  },
  'weapon.P90.homingEnabled': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['homingEnabled'], formula: 'add' }],
  },
  'weapon.P90.homing.maxTurnDegreesPerStep': {
    kind: 'weapon',
    itemId: 'P90',
    targets: [{ path: ['fire', 'homing', 'maxTurnDegreesPerStep'], formula: 'scale' }],
  },
  'weapon.ROCKET_LAUNCHER.impactExplosion.radius': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [
      { path: ['fire', 'impactExplosion', 'radius'], formula: 'scale' },
      { path: ['fire', 'impactExplosion', 'groundFire', 'radius'], formula: 'scale' },
    ],
  },
  'weapon.ROCKET_LAUNCHER.cooldown': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [{ path: ['cooldown'], formula: 'scale' }],
  },
  'weapon.ROCKET_LAUNCHER.adrenalinCost': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [{ path: ['adrenalinCost'], formula: 'scale' }],
  },
  'weapon.ROCKET_LAUNCHER.damage': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [{ path: ['damage'], formula: 'scale' }],
  },
  'weapon.ROCKET_LAUNCHER.blackHoleDurationMs': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [{ path: ['fire', 'impactExplosion', 'blackHoleDurationMs'], formula: 'add' }],
  },
  'weapon.ROCKET_LAUNCHER.blackHolePullStrength': {
    kind: 'weapon',
    itemId: 'ROCKET_LAUNCHER',
    targets: [{ path: ['fire', 'impactExplosion', 'blackHolePullStrength'], formula: 'scale' }],
  },
  'weapon.AK47.range': {
    kind: 'weapon',
    itemId: 'AK47',
    targets: [{ path: ['range'], formula: 'scale' }],
  },
  'weapon.AK47.spread': {
    kind: 'weapon',
    itemId: 'AK47',
    targets: [
      { path: ['spreadStanding'], formula: 'scale' },
      { path: ['spreadMoving'], formula: 'scale' },
      { path: ['spreadPerShot'], formula: 'scale' },
      { path: ['maxDynamicSpread'], formula: 'scale' },
    ],
  },
  'weapon.AK47.damage': {
    kind: 'weapon',
    itemId: 'AK47',
    targets: [{ path: ['damage'], formula: 'scale' }],
  },
  'weapon.AK47.adrenalinCost': {
    kind: 'weapon',
    itemId: 'AK47',
    targets: [{ path: ['adrenalinCost'], formula: 'scale' }],
  },
  'weapon.SHOTGUN.pelletCount': {
    kind: 'weapon',
    itemId: 'SHOTGUN',
    targets: [{ path: ['pelletCount'], formula: 'add' }],
  },
  'weapon.SHOTGUN.pelletSpreadAngle': {
    kind: 'weapon',
    itemId: 'SHOTGUN',
    targets: [{ path: ['pelletSpreadAngle'], formula: 'add' }],
  },
  'weapon.ASMD_SEC.detonable.aoeRadius': {
    kind: 'weapon',
    itemId: 'ASMD_SEC',
    targets: [{ path: ['detonable', 'aoeRadius'], formula: 'scale' }],
  },
  'weapon.ASMD_SEC.projectileSpeed': {
    kind: 'weapon',
    itemId: 'ASMD_SEC',
    targets: [{ path: ['fire', 'projectileSpeed'], formula: 'scale' }],
  },
  'weapon.ASMD_SEC.damage': {
    kind: 'weapon',
    itemId: 'ASMD_SEC',
    targets: [
      { path: ['damage'], formula: 'scale' },
      { path: ['detonable', 'aoeDamage'], formula: 'scale' },
      { path: ['detonable', 'damageFalloff', 'minDamage'], formula: 'scale' },
    ],
  },
  'weapon.ASMD_SEC.dotArea.durationMs': {
    kind: 'weapon',
    itemId: 'ASMD_SEC',
    targets: [{ path: ['detonable', 'dotArea', 'durationMs'], formula: 'add' }],
  },
  'weapon.ASMD_SEC.dotArea.damagePerTick': {
    kind: 'weapon',
    itemId: 'ASMD_SEC',
    targets: [{ path: ['detonable', 'dotArea', 'damagePerTick'], formula: 'scale' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.impactExplosion.radius': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['fire', 'impactExplosion', 'radius'], formula: 'scale' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.homing.maxTurnDegreesPerStep': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['fire', 'homing', 'maxTurnDegreesPerStep'], formula: 'scale' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.impactExplosion.falloffReduction': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['fire', 'impactExplosion', 'falloffReduction'], formula: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.impactExplosion.damage': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [
      { path: ['fire', 'impactExplosion', 'maxDamage'], formula: 'scale' },
      { path: ['fire', 'impactExplosion', 'minDamage'], formula: 'scale' },
    ],
  },
  'weapon.MINI_ROCKET_LAUNCHER.multiExplosionCount': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['multiExplosionCount'], formula: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.multiExplosionCoastMs': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['multiExplosionCoastMs'], formula: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.miniRocketReturnEnabled': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['miniRocketReturnEnabled'], formula: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.miniRocketPickupAdrenalineRefundFraction': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['miniRocketPickupAdrenalineRefundFraction'], formula: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.miniRocketPickupArmor': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['miniRocketPickupArmor'], formula: 'add' }],
  },
  'weapon.MINI_ROCKET_LAUNCHER.miniRocketCascadeDamageBonusPerExplosion': {
    kind: 'weapon',
    itemId: 'MINI_ROCKET_LAUNCHER',
    targets: [{ path: ['miniRocketCascadeDamageBonusPerExplosion'], formula: 'add' }],
  },
  'weapon.AWP.cooldown': {
    kind: 'weapon',
    itemId: 'AWP',
    targets: [{ path: ['cooldown'], formula: 'scale' }],
  },
  'weapon.AWP.aimDuration': {
    kind: 'weapon',
    itemId: 'AWP',
    targets: [{ path: ['scopeConfig', 'scopeInMs'], formula: 'scale' }],
  },
  'weapon.AWP.adrenalinCost': {
    kind: 'weapon',
    itemId: 'AWP',
    targets: [{ path: ['adrenalinCost'], formula: 'scale' }],
  },
  'weapon.FLAMETHROWER.burnDurationMs': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'burnDurationMs'], formula: 'scale' }],
  },
  'weapon.FLAMETHROWER.burnDamagePerTick': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'burnDamagePerTick'], formula: 'scale' }],
  },
  'weapon.FLAMETHROWER.hitboxEndSize': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'hitboxEndSize'], formula: 'scale' }],
  },
  'weapon.FLAMETHROWER.piercing': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'piercingCount'], formula: 'add' }],
  },
  'weapon.AWP.spreadMoving': {
    kind: 'weapon',
    itemId: 'AWP',
    targets: [{ path: ['spreadMoving'], formula: 'scale' }],
  },
  'weapon.AWP.scopeViewRadius': {
    kind: 'weapon',
    itemId: 'AWP',
    targets: [{ path: ['scopeConfig', 'fullScopeViewRadius'], formula: 'scale' }],
  },
  'weapon.FLAMETHROWER.adrenalinCost': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['adrenalinCost'], formula: 'scale' }],
  },
  'weapon.FLAMETHROWER.range': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['range'], formula: 'scale' }],
  },
  'weapon.FLAMETHROWER.kamikaze.enabled': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'kamikaze', 'enabled'], formula: 'add' }],
  },
  'weapon.FLAMETHROWER.kamikaze.inheritMolotovBonuses': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'kamikaze', 'inheritMolotovBonuses'], formula: 'add' }],
  },
  'weapon.FLAMETHROWER.burningGround.cellSize': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'burningGround', 'cellSize'], formula: 'add' }],
  },
  'weapon.FLAMETHROWER.burningGround.durationMs': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'burningGround', 'durationMs'], formula: 'add' }],
  },
  'weapon.FLAMETHROWER.burningGround.igniteProjectiles': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'burningGround', 'igniteProjectiles'], formula: 'add' }],
  },
  'weapon.FLAMETHROWER.burningGround.createOnFlameExpiry': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'burningGround', 'createOnFlameExpiry'], formula: 'add' }],
  },
  'weapon.FLAMETHROWER.fireRing.radius': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'fireRing', 'radius'], formula: 'scale' }],
  },
  'weapon.FLAMETHROWER.fireRing.thickness': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'fireRing', 'thickness'], formula: 'add' }],
  },
  'weapon.FLAMETHROWER.fireRing.igniteProjectiles': {
    kind: 'weapon',
    itemId: 'FLAMETHROWER',
    targets: [{ path: ['fire', 'fireRing', 'igniteProjectiles'], formula: 'add' }],
  },
  'weapon.NEGEV.range': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['range'], formula: 'scale' }],
  },
  'weapon.NEGEV.holdSpeedBonus': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['holdSpeedFactor'], formula: 'add' }],
  },
  'weapon.NEGEV.projectileMaxBounces': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['fire', 'projectileMaxBounces'], formula: 'add' }],
  },
  'weapon.NEGEV.warmupDuration': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['warmupSpeedMultiplier'], formula: 'inverse_scale' }],
  },
  'weapon.NEGEV.burnOnHit.durationMs': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['burnOnHit', 'durationMs'], formula: 'add' }],
  },
  'weapon.NEGEV.burnOnHit.damagePerTick': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['burnOnHit', 'damagePerTick'], formula: 'scale' }],
  },
  'weapon.TESLA_DOME.radius': {
    kind: 'weapon',
    itemId: 'TESLA_DOME',
    targets: [{ path: ['fire', 'radius'], formula: 'scale' }],
  },
  'weapon.TESLA_DOME.damagePerTick': {
    kind: 'weapon',
    itemId: 'TESLA_DOME',
    targets: [{ path: ['fire', 'damagePerTick'], formula: 'scale' }],
  },
  'weapon.TESLA_DOME.movementSlowFactor': {
    kind: 'weapon',
    itemId: 'TESLA_DOME',
    targets: [{ path: ['fire', 'movementSlowFactor'], formula: 'add' }],
  },
  'weapon.TESLA_DOME.adrenalineDrain': {
    kind: 'weapon',
    itemId: 'TESLA_DOME',
    targets: [{ path: ['fire', 'adrenalineDrainPerSecond'], formula: 'scale' }],
  },
  'utility.cooldown': {
    kind: 'utility',
    slot: 'utility',
    targets: [{ path: ['cooldown'], formula: 'scale' }],
  },
  'utility.HE_GRENADE.aoeRadius': {
    kind: 'utility',
    itemId: 'HE_GRENADE',
    targets: [{ path: ['aoeRadius'], formula: 'scale' }],
  },
  'utility.HE_GRENADE.aoeDamage': {
    kind: 'utility',
    itemId: 'HE_GRENADE',
    targets: [{ path: ['aoeDamage'], formula: 'scale' }],
  },
  'utility.HE_GRENADE.cooldown': {
    kind: 'utility',
    itemId: 'HE_GRENADE',
    targets: [{ path: ['cooldown'], formula: 'scale' }],
  },
  'utility.TIME_BUBBLE.bubbleRadius': {
    kind: 'utility',
    itemId: 'TIME_BUBBLE',
    targets: [{ path: ['bubbleRadius'], formula: 'scale' }],
  },
  'utility.TIME_BUBBLE.bubbleDuration': {
    kind: 'utility',
    itemId: 'TIME_BUBBLE',
    targets: [{ path: ['bubbleDuration'], formula: 'scale' }],
  },
  'utility.TIME_BUBBLE.playerSlowFactor': {
    kind: 'utility',
    itemId: 'TIME_BUBBLE',
    targets: [{ path: ['playerSlowFactor'], formula: 'scale' }],
  },
  'utility.TIME_BUBBLE.projectileSlowReduction': {
    kind: 'utility',
    itemId: 'TIME_BUBBLE',
    targets: [{ path: ['projectileSlowFactor'], formula: 'add' }],
  },
  'utility.SMOKE_GRENADE.smokeRadius': {
    kind: 'utility',
    itemId: 'SMOKE_GRENADE',
    targets: [{ path: ['smokeRadius'], formula: 'scale' }],
  },
  'utility.SMOKE_GRENADE.smokeLingerDuration': {
    kind: 'utility',
    itemId: 'SMOKE_GRENADE',
    targets: [{ path: ['smokeLingerDuration'], formula: 'scale' }],
  },
  'utility.SMOKE_GRENADE.dotDamage': {
    kind: 'utility',
    itemId: 'SMOKE_GRENADE',
    targets: [{ path: ['smokeDotDamagePerTick'], formula: 'add' }],
  },
  'utility.MOLOTOV_GRENADE.fireRadius': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['fireRadius'], formula: 'scale' }],
  },
  'weapon.NEGEV.adrenalinCost': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['adrenalinCost'], formula: 'scale' }],
  },
  'weapon.NEGEV.rockDamageMult': {
    kind: 'weapon',
    itemId: 'NEGEV',
    targets: [{ path: ['rockDamageMult'], formula: 'scale' }],
  },
  'utility.MOLOTOV_GRENADE.cooldown': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['cooldown'], formula: 'scale' }],
  },
  'utility.MOLOTOV_GRENADE.fireLingerDuration': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['fireLingerDuration'], formula: 'scale' }],
  },
  'utility.MOLOTOV_GRENADE.fireBurnDamagePerTick': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['fireBurnDamagePerTick'], formula: 'scale' }],
  },
  'utility.MOLOTOV_GRENADE.fireBurnDurationMs': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['fireBurnDurationMs'], formula: 'scale' }],
  },
  'utility.MOLOTOV_GRENADE.wildfireEnabled': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['wildfireEnabled'], formula: 'add' }],
  },
  'utility.MOLOTOV_GRENADE.wildfirePanicSpeedMultiplier': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['wildfirePanicSpeedMultiplier'], formula: 'add' }],
  },
  'utility.MOLOTOV_GRENADE.wildfireTrailDurationMs': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['wildfireTrailDurationMs'], formula: 'add' }],
  },
  'utility.MOLOTOV_GRENADE.wildfireTrailDamagePerTick': {
    kind: 'utility',
    itemId: 'MOLOTOV_GRENADE',
    targets: [{ path: ['wildfireTrailDamagePerTick'], formula: 'add' }],
  },
  'utility.STINKDRUESEN.cloudRadius': {
    kind: 'utility',
    itemId: 'STINKDRUESEN',
    targets: [{ path: ['cloudRadius'], formula: 'scale' }],
  },
  'utility.STINKDRUESEN.cloudDamagePerTick': {
    kind: 'utility',
    itemId: 'STINKDRUESEN',
    targets: [{ path: ['cloudDamagePerTick'], formula: 'scale' }],
  },
  'utility.TRANSLOCATOR.projectileSpeed': {
    kind: 'utility',
    itemId: 'TRANSLOCATOR',
    targets: [{ path: ['projectileSpeed'], formula: 'scale' }],
  },
  'utility.TRANSLOCATOR.maxBounces': {
    kind: 'utility',
    itemId: 'TRANSLOCATOR',
    targets: [{ path: ['maxBounces'], formula: 'add' }],
  },
  'utility.FELSBAU.placeable.maxHp': {
    kind: 'utility',
    itemId: 'FELSBAU',
    targets: [{ path: ['placeable', 'maxHp'], formula: 'scale' }],
  },
  'utility.FELSBAU.placeable.lifetimeMs': {
    kind: 'utility',
    itemId: 'FELSBAU',
    targets: [{ path: ['placeable', 'lifetimeMs'], formula: 'scale' }],
  },
  'utility.FLIEGENPILZ.placeable.maxHp': {
    kind: 'utility',
    itemId: 'FLIEGENPILZ',
    targets: [{ path: ['placeable', 'maxHp'], formula: 'scale' }],
  },
  'utility.FLIEGENPILZ.cooldown': {
    kind: 'utility',
    itemId: 'FLIEGENPILZ',
    targets: [{ path: ['cooldown'], formula: 'scale' }],
  },
  'utility.FLIEGENPILZ.placeable.targetRange': {
    kind: 'utility',
    itemId: 'FLIEGENPILZ',
    targets: [{ path: ['placeable', 'targetRange'], formula: 'scale' }],
  },
  'utility.ZEUS_TASER.range': {
    kind: 'utility',
    itemId: 'ZEUS_TASER',
    targets: [{ path: ['range'], formula: 'scale' }],
  },
  'utility.ZEUS_TASER.hitArcDegrees': {
    kind: 'utility',
    itemId: 'ZEUS_TASER',
    targets: [{ path: ['hitArcDegrees'], formula: 'scale' }],
  },
  'utility.DECOY.decoyLifetimeMs': {
    kind: 'utility',
    itemId: 'DECOY',
    targets: [{ path: ['decoyLifetimeMs'], formula: 'scale' }],
  },
  'utility.DECOY.stealthDurationMs': {
    kind: 'utility',
    itemId: 'DECOY',
    targets: [{ path: ['stealthDurationMs'], formula: 'scale' }],
  },
  'ultimate.ARMAGEDDON.damage': {
    kind: 'ultimate',
    itemId: 'ARMAGEDDON',
    targets: [
      { path: ['armageddon', 'meteorDamage'], formula: 'scale' },
      { path: ['armageddon', 'meteorDamageFalloff', 'minDamage'], formula: 'scale' },
    ],
  },
  'ultimate.ARMAGEDDON.duration': {
    kind: 'ultimate',
    itemId: 'ARMAGEDDON',
    targets: [
      { path: ['duration'], formula: 'scale' },
      { path: ['rageDrainDuration'], formula: 'scale' },
    ],
  },
  'ultimate.ARMAGEDDON.meteorCount': {
    kind: 'ultimate',
    itemId: 'ARMAGEDDON',
    targets: [{ path: ['armageddon', 'meteorsPerSecond'], formula: 'scale' }],
  },
  'ultimate.ARMAGEDDON.rageRequired': {
    kind: 'ultimate',
    itemId: 'ARMAGEDDON',
    targets: [{ path: ['rageRequired'], formula: 'scale' }],
  },
  'ultimate.ARMAGEDDON.radius': {
    kind: 'ultimate',
    itemId: 'ARMAGEDDON',
    targets: [{ path: ['armageddon', 'meteorDamageRadius'], formula: 'scale' }],
  },
  'ultimate.ARMAGEDDON.fireChunks': {
    kind: 'ultimate',
    itemId: 'ARMAGEDDON',
    targets: [{ path: ['armageddon', 'fireChunkBurst', 'count'], formula: 'add' }],
  },
  'ultimate.GAUSS_RIFLE.damage': {
    kind: 'ultimate',
    itemId: 'GAUSS_RIFLE',
    targets: [{ path: ['damage'], formula: 'scale' }],
  },
  'ultimate.GAUSS_RIFLE.chargeDuration': {
    kind: 'ultimate',
    itemId: 'GAUSS_RIFLE',
    targets: [{ path: ['chargeDuration'], formula: 'scale' }],
  },
  'ultimate.AIRSTRIKE.radius': {
    kind: 'ultimate',
    itemId: 'AIRSTRIKE',
    targets: [{ path: ['radius'], formula: 'scale' }],
  },
  'ultimate.AIRSTRIKE.delayMs': {
    kind: 'ultimate',
    itemId: 'AIRSTRIKE',
    targets: [{ path: ['delayMs'], formula: 'scale' }],
  },
  'ultimate.HONEY_BADGER_RAGE.aura.radius': {
    kind: 'ultimate',
    itemId: 'HONEY_BADGER_RAGE',
    targets: [{ path: ['aura', 'radius'], formula: 'scale' }],
  },
  'ultimate.HONEY_BADGER_RAGE.aura.damagePerTick': {
    kind: 'ultimate',
    itemId: 'HONEY_BADGER_RAGE',
    targets: [{ path: ['aura', 'damagePerTick'], formula: 'scale' }],
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

function getDescriptorStage(stat: string): number {
  if (stat === 'weapon.P90.homingCooldownReduction') return 200;
  if (/^(weapon1|weapon2|utility)\./.test(stat)) return 0;
  return 100;
}

function isIntegerTarget(path: readonly string[]): boolean {
  const leaf = path[path.length - 1] ?? '';
  return /(?:Count|maxJumps|maxBounces|piercingCount|enabled|Enabled)$/.test(leaf);
}

function getTargetContract(stat: string, target: PathTarget): ModifierTargetContract {
  return {
    ...target,
    operations: target.formula === 'add' ? ['additive'] : ['additive', 'percentage'],
    minimum: 0,
    maximum: undefined,
    integer: isIntegerTarget(target.path),
    stage: getDescriptorStage(stat),
  };
}

export function getLoadoutModifierTargetContracts(): Readonly<Record<string, readonly ModifierTargetContract[]>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(CONFIG_STAT_DESCRIPTORS).map(([stat, descriptor]) => [
      stat,
      Object.freeze(descriptor.targets.map((target) => Object.freeze(getTargetContract(stat, target)))),
    ]),
  ));
}

function applyOperation(
  baseValue: number,
  additive: number,
  percentage: number,
  contract: ModifierTargetContract,
): number {
  if (![baseValue, additive, percentage].every(Number.isFinite)) {
    throw new Error('Basiswert und Modifier müssen endlich sein');
  }
  if (percentage !== 0 && !contract.operations.includes('percentage')) {
    throw new Error('Prozentualer Modifier ist für diesen Zielpfad nicht erlaubt');
  }
  const multiplier = 1 + percentage;
  if (contract.formula === 'inverse_scale' && multiplier <= 0) {
    throw new Error(`inverse_scale verlangt einen positiven Nenner, erhalten: ${multiplier}`);
  }
  let result: number;
  switch (contract.formula) {
    case 'add':
      result = baseValue + additive;
      break;
    case 'inverse_scale':
      result = (baseValue + additive) / multiplier;
      break;
    case 'scale':
    default:
      result = (baseValue + additive) * multiplier;
      break;
  }
  if (!Number.isFinite(result)) throw new Error(`Modifier-Ergebnis ist nicht endlich: ${result}`);
  if (contract.minimum !== undefined && result < contract.minimum) throw new Error(`Modifier-Ergebnis ${result} liegt unter ${contract.minimum}`);
  if (contract.maximum !== undefined && result > contract.maximum) throw new Error(`Modifier-Ergebnis ${result} liegt über ${contract.maximum}`);
  if (contract.integer && !Number.isInteger(result)) throw new Error(`Modifier-Ergebnis ${result} muss ganzzahlig sein`);
  return result;
}

function shouldApplyDescriptor(
  descriptor: ConfigStatDescriptor,
  kind: ConfigKind,
  slot: LoadoutSlot,
  configId: string,
): boolean {
  if (descriptor.kind !== kind) return false;
  if (descriptor.slot && descriptor.slot !== slot) return false;
  if (descriptor.itemId) {
    const lineage = kind === 'utility' ? getUtilityConfigLineage(configId) : [];
    if (lineage.length > 0 ? !lineage.includes(descriptor.itemId) : descriptor.itemId !== configId) return false;
  }
  return true;
}

function applyConfiguredStats<T extends { id: string }>(
  config: T,
  kind: ConfigKind,
  slot: LoadoutSlot,
  totals: CoopDefenseEffectTotalsSource,
): T {
  try {
    let nextConfig: Record<string, unknown> | null = null;
    const descriptors = Object.entries(CONFIG_STAT_DESCRIPTORS)
      .sort(([leftStat], [rightStat]) => getDescriptorStage(leftStat) - getDescriptorStage(rightStat)
        || leftStat.localeCompare(rightStat));

    for (const [stat, descriptor] of descriptors) {
      if (!shouldApplyDescriptor(descriptor, kind, slot, config.id)) continue;
      const additive = totals.additive[stat] ?? 0;
      const percentage = totals.percentage[stat] ?? 0;
      if (additive === 0 && percentage === 0) continue;

      const targetConfig: Record<string, unknown> = nextConfig ?? cloneValue(config as Record<string, unknown>);
      let changed = false;
      for (const target of descriptor.targets) {
        const existingValue = getNumberAtPath(targetConfig, target.path);
        if (existingValue === null && target.optionalWhenMissing) continue;
        if (existingValue === null && !target.createIfMissing) {
          throw new Error(`${stat} @ ${target.path.join('.')}: erforderlicher numerischer Zielpfad fehlt`);
        }
        const baseValue = existingValue ?? 0;
        let nextValue: number;
        try {
          nextValue = applyOperation(baseValue, additive, percentage, getTargetContract(stat, target));
        } catch (error) {
          throw new Error(
            `${stat} @ ${target.path.join('.')} (base=${baseValue}, additive=${additive}, percentage=${percentage}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (!setNumberAtPath(targetConfig, target.path, nextValue)) {
          throw new Error(`${stat} @ ${target.path.join('.')} (base=${baseValue}, additive=${additive}, percentage=${percentage}): Zielpfad ist nicht numerisch`);
        }
        changed = true;
      }
      if (changed) nextConfig = targetConfig;
    }

    const result = (nextConfig ?? config) as T;
    const schemaIssues = kind === 'weapon'
      ? validateResolvedWeapon(result)
      : kind === 'utility'
        ? validateResolvedUtility(result)
        : validateResolvedUltimate(result);
    if (schemaIssues.length > 0) throw new Error(schemaIssues.join('; '));
    return result;
  } catch (error) {
    const message = `[loadout-modifier] ${kind}:${config.id}: ${error instanceof Error ? error.message : String(error)}`;
    if (!import.meta.env.PROD) throw new Error(message);
    if (!REPORTED_PRODUCTION_MODIFIER_ERRORS.has(message)) {
      REPORTED_PRODUCTION_MODIFIER_ERRORS.add(message);
      console.error(message);
    }
    return config;
  }
}

const REPORTED_PRODUCTION_MODIFIER_ERRORS = new Set<string>();

export function applyCoopDefenseModifiersToWeaponConfig(
  config: WeaponConfig,
  slot: 'weapon1' | 'weapon2',
  totals: CoopDefenseEffectTotalsSource,
): WeaponConfig {
  const baseConfig = WEAPON_CONFIGS[config.id] ?? config;
  const resolved = applyConfiguredStats(baseConfig, 'weapon', slot, totals);
  if (
    baseConfig.id !== 'FLAMETHROWER'
    || baseConfig.fire.type !== 'flamethrower'
    || resolved.fire.type !== 'flamethrower'
    || (resolved.fire.fireball?.enabled ?? 0) <= 0
    || baseConfig.cooldown <= 0
  ) {
    return resolved;
  }

  // Der Feuerball feuert langsamer, soll bei Dauerfeuer aber denselben
  // Adrenalinverbrauch pro Zeit haben. Den Faktor aus den effektiven und
  // ursprünglichen Cooldowns ableiten, damit spätere Feuerratenänderungen
  // automatisch mitgezogen werden.
  return {
    ...resolved,
    adrenalinCost: resolved.adrenalinCost * (resolved.cooldown / baseConfig.cooldown),
  };
}

export function applyCoopDefenseModifiersToUtilityConfig(
  config: UtilityConfig,
  totals: CoopDefenseEffectTotalsSource,
): UtilityConfig {
  return applyConfiguredStats(UTILITY_CONFIGS[config.id] ?? config, 'utility', 'utility', totals);
}

export function applyCoopDefenseModifiersToUltimateConfig(
  config: UltimateConfig,
  totals: CoopDefenseEffectTotalsSource,
): UltimateConfig {
  return applyConfiguredStats(ULTIMATE_CONFIGS[config.id] ?? config, 'ultimate', 'ultimate', totals);
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
