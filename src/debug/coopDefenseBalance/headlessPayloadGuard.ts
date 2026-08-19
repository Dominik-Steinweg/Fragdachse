import type { ProjectileSpawnConfig } from '../../types';
import type { HitscanShotRequest, MeleeSwingRequest } from '../../loadout/WeaponFireExecutor';
import type { WeaponBalanceScenario } from './scenarioTypes';
import { UnsupportedWeaponMechanicError } from './weaponCapabilityValidator';

/**
 * Deklarativer Vertrag für Headless-Fire-Requests.
 *
 * Jedes zur Laufzeit empfangene Feld muss einer bekannten Kategorie angehören:
 * - `SUPPORTED`: Wird im Headless-Simulator simuliert.
 * - `SCENARIO_IRRELEVANT`: Existiert im Request, hat aber im aktuellen Szenario keinen Einfluss auf Damage/Ressourcen.
 * - `UNSUPPORTED_RELEVANT`: Relevanter Gameplay-Effekt, der im Headless-Simulator noch nicht unterstützt wird.
 *
 * Neu auftauchende, nicht klassifizierte Felder werden fail-closed abgefangen.
 */

// ── Projektil-Contract ───────────────────────────────────────────────────────

const PROJECTILE_KNOWN_FIELDS = new Set<string>([
  // Supported
  'speed', 'size', 'damage', 'lifetime', 'maxBounces', 'adrenalinGain', 'sourceId',
  'allowTeamDamage', 'ignoreBaseCollisions', 'ignoreRockIndex', 'burnDurationMs', 'burnDamagePerTick',
  // Scenario-irrelevant (Visuals / Audio / Single-Target Inactive)
  'color', 'ownerColor', 'visualMuzzleOrigin', 'projectileVisualScale', 'projectileStyle',
  'bulletVisualPreset', 'grenadeVisualPreset', 'energyBallVariant', 'tracerConfig',
  'smokeTrailColor', 'sporeVisualVariant', 'projectileBurnVisualStyle', 'suppressSpawnFx',
  'shotAudioKey', 'sourceTurretId', 'sourceSlot', 'rockDamageMult', 'trainDamageMult',
  'baseDamageMult', 'frictionDelayMs', 'airFrictionDecayPerSec', 'bounceFrictionMultiplier',
  'stopSpeedThreshold', 'initialBounceCount', 'remainingRangePx', 'detonator', 'canReceiveFireImbue',
  'shotgunOriginX', 'shotgunOriginY', 'shotgunResolvedRange', 'shotgunSlowFraction', 'shotgunSlowDurationMs',
  'hitSlowFraction', 'hitSlowDurationMs', 'hitKnockback', 'hitKnockbackDurationMs',
  'penetrationDamageRetention', 'penetratesRocks', 'multiExplosionCoastMs', 'miniRocketStageRangePx',
  'miniRocketReturnRangeBuffer', 'miniRocketPickupRadius', 'miniRocketPickupAdrenalineRefundFraction',
  'miniRocketPickupArmor', 'miniRocketAdrenalineCostPaid', 'miniRocketSafetyLifetimeMs',
  'fireTrailHalfWidthCells', 'awpCorridorHalfWidth', 'awpCorridorDotDurationMs',
  'awpCorridorDotTickIntervalMs', 'awpCorridorKnockback', 'awpCorridorKnockbackDurationMs',
  'ak47ShotId', 'ak47DamageMultiplier',
  // Unsupported Relevant
  'isGrenade', 'fuseTime', 'grenadeEffect', 'isFlame', 'hitboxGrowRate', 'hitboxMaxSize',
  'velocityDecay', 'flamePiercing', 'supplementalBurnOnHit',
  'fireTrail', 'explosion', 'enemyHitExplosion', 'impactCloud', 'homing', 'splitHoming',
  'piercesTargets', 'penetrationCount', 'isBfg', 'splitCount', 'splitSpread', 'splitFactor',
  'detonable', 'proximityPulse', 'plasmaSwarmEnabled', 'plasmaSwarmProjectile',
  'plasmaSwarmOriginEnemyId', 'plasmaSwarmProjectileCount', 'plasmaSwarmExplosionRadius',
  'plasmaSwarmExplosionDamage', 'plasmaSwarmExplosionSlowFraction', 'energyInjectorPayload',
  'leafBlowerMinKnockback', 'leafBlowerMaxKnockback', 'leafBlowerSelfPush', 'leafBlowerDeflectsProjectiles',
  'shotgunProximityMaxDamageBonus', 'multiExplosionCount', 'miniRocketReturnEnabled',
  'miniRocketCascadeDamageBonusPerExplosion', 'awpCorridorDamage', 'ak47FireSuperiorityShot',
]);

export function validateProjectileSpawnPayload(
  cfg: ProjectileSpawnConfig,
  scenario: WeaponBalanceScenario = 'single_target_static',
): void {
  const reasons: string[] = [];

  // 1. Fail-closed Check auf unbekannte Felder
  for (const key of Object.keys(cfg)) {
    if (!PROJECTILE_KNOWN_FIELDS.has(key)) {
      const val = (cfg as unknown as Record<string, unknown>)[key];
      if (val !== undefined && val !== null && val !== false && val !== 0) {
        reasons.push(`Unbekanntes / nicht klassifiziertes Projektil-Feld "${key}" am Headless-Sink`);
      }
    }
  }

  // 2. Semantische Prüfungen auf unsupported_relevant
  if (cfg.isGrenade || (cfg.fuseTime !== undefined && cfg.fuseTime > 0) || cfg.grenadeEffect) {
    reasons.push('Granaten-Payload (fuseTime/grenadeEffect) ist headless nicht implementiert');
  }

  if (cfg.isFlame || cfg.supplementalBurnOnHit) {
    reasons.push('Flammen-/Supplemental-Brand-Payload ist headless nicht implementiert');
  }

  if (cfg.explosion && (cfg.explosion.maxDamage > 0 || cfg.explosion.radius > 0)) {
    reasons.push('Explosions-Payload (Flächenschaden) ist headless nicht implementiert');
  }

  if (cfg.enemyHitExplosion && (cfg.enemyHitExplosion.maxDamage > 0 || cfg.enemyHitExplosion.radius > 0)) {
    reasons.push('enemyHitExplosion-Payload ist headless nicht implementiert');
  }

  if (cfg.homing) {
    reasons.push('Homing-Payload (Zielsuche) ist headless nicht implementiert');
  }

  if (cfg.piercesTargets || (cfg.penetrationCount !== undefined && cfg.penetrationCount > 0) || cfg.flamePiercing || cfg.isBfg) {
    reasons.push('Piercing/BFG-Payload (Durchschlag) ist headless nicht implementiert');
  }

  if (cfg.splitCount !== undefined && cfg.splitCount > 0) {
    reasons.push('Split-Payload (Hydra) ist headless nicht implementiert');
  }

  if (cfg.detonable) {
    reasons.push('Detonable-Payload (ASMD-Ball) ist headless nicht implementiert');
  }

  if (cfg.proximityPulse && cfg.proximityPulse.damage > 0) {
    reasons.push('proximityPulse-Payload ist headless nicht implementiert');
  }

  if (cfg.plasmaSwarmEnabled || cfg.plasmaSwarmProjectile) {
    reasons.push('plasmaSwarm-Payload ist headless nicht implementiert');
  }

  if (cfg.energyInjectorPayload || cfg.impactCloud) {
    reasons.push('Injector-/Cloud-Payload ist headless nicht implementiert');
  }

  if (cfg.shotgunProximityMaxDamageBonus !== undefined && cfg.shotgunProximityMaxDamageBonus > 0) {
    reasons.push('shotgunProximity-Payload ist headless nicht implementiert');
  }

  if (cfg.multiExplosionCount !== undefined && cfg.multiExplosionCount > 1) {
    reasons.push('multiExplosion-Payload ist headless nicht implementiert');
  }

  if (cfg.miniRocketReturnEnabled) {
    reasons.push('miniRocketReturn-Payload ist headless nicht implementiert');
  }

  if (cfg.miniRocketCascadeDamageBonusPerExplosion !== undefined && cfg.miniRocketCascadeDamageBonusPerExplosion > 0) {
    reasons.push('miniRocketCascade-Payload ist headless nicht implementiert');
  }

  if (cfg.awpCorridorDamage !== undefined && cfg.awpCorridorDamage > 0) {
    reasons.push('awpCorridor-Payload ist headless nicht implementiert');
  }

  if (cfg.ak47FireSuperiorityShot) {
    reasons.push('ak47FireSuperiority-Payload ist headless nicht implementiert');
  }

  if (reasons.length > 0) {
    throw new UnsupportedWeaponMechanicError(cfg.sourceId ?? 'projectile', reasons, scenario);
  }
}

// ── Hitscan-Contract ────────────────────────────────────────────────────────

const HITSCAN_KNOWN_FIELDS = new Set<string>([
  // Supported
  'shooterId', 'startX', 'startY', 'angle', 'range', 'damage', 'traceThickness',
  'adrenalinGain', 'sourceId', 'burnOnHit',
  // Scenario-irrelevant
  'color', 'visualPreset', 'shotAudioKey', 'visualMuzzleOrigin', 'sourceSlot', 'shotId',
  'rockDamageMult', 'trainDamageMult', 'baseDamageMult', 'detonator', 'chainLightning',
  // Unsupported Relevant
  'supportEffect',
]);

export function validateHitscanShotRequest(
  request: HitscanShotRequest,
  scenario: WeaponBalanceScenario = 'single_target_static',
): void {
  const reasons: string[] = [];

  // 1. Fail-closed Check auf unbekannte Felder
  for (const key of Object.keys(request)) {
    if (!HITSCAN_KNOWN_FIELDS.has(key)) {
      const val = (request as unknown as Record<string, unknown>)[key];
      if (val !== undefined && val !== null && val !== false && val !== 0) {
        reasons.push(`Unbekanntes / nicht klassifiziertes Hitscan-Feld "${key}" am Headless-Sink`);
      }
    }
  }

  // 2. Semantische Prüfungen
  if (request.chainLightning && request.chainLightning.maxJumps > 0) {
    if (scenario !== 'single_target_static') {
      reasons.push('chainLightning-Payload (Kettenblitz) ist für Multi-Target noch nicht implementiert');
    }
  }

  if (request.supportEffect) {
    reasons.push('supportEffect-Payload ist headless nicht implementiert');
  }

  if (reasons.length > 0) {
    throw new UnsupportedWeaponMechanicError(request.sourceId ?? 'hitscan', reasons, scenario);
  }
}

export const validateHitscanShotPayload = validateHitscanShotRequest;

// ── Melee-Contract ──────────────────────────────────────────────────────────

const MELEE_KNOWN_FIELDS = new Set<string>([
  // Supported
  'shooterId', 'x', 'y', 'angle', 'range', 'arcDegrees', 'damage', 'adrenalinGain', 'hitAdrenaline', 'sourceId', 'burnOnHit',
  // Scenario-irrelevant
  'color', 'visualPreset', 'shotAudioKey', 'bloodEffectMultiplier', 'sourceSlot',
  'damageTargets', 'rockDamageMult', 'trainDamageMult', 'baseDamageMult', 'hitHeal',
  // Unsupported Relevant
]);

export function validateMeleeSwingPayload(
  request: MeleeSwingRequest,
  scenario: WeaponBalanceScenario = 'single_target_static',
): void {
  const reasons: string[] = [];

  // 1. Fail-closed Check auf unbekannte Felder
  for (const key of Object.keys(request)) {
    if (!MELEE_KNOWN_FIELDS.has(key)) {
      const val = (request as unknown as Record<string, unknown>)[key];
      if (val !== undefined && val !== null && val !== false && val !== 0) {
        reasons.push(`Unbekanntes / nicht klassifiziertes Melee-Feld "${key}" am Headless-Sink`);
      }
    }
  }

  // 2. Semantische Prüfungen
  if (reasons.length > 0) {
    throw new UnsupportedWeaponMechanicError(request.sourceId ?? 'melee', reasons, scenario);
  }
}
