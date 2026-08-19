import type { ProjectileSpawnConfig } from '../../types';
import type { HitscanShotRequest, MeleeSwingRequest } from '../../loadout/WeaponFireExecutor';
import { UnsupportedWeaponMechanicError } from './weaponCapabilityValidator';

/**
 * Zweite Sicherheitsgrenze auf den tatsächlich empfangenen Fire-Requests am Headless-Sink.
 *
 * Verhindert, dass zukünftige oder veränderte Projektil-/Hitscan-/Melee-Payloads (wie Burn,
 * Explosionen, Kettenblitze, Homing oder Treffer-Ressourcen) in der Simulation stillschweigend
 * ignoriert oder fehlerhaft ohne ihre Gameplay-Wirkung berechnet werden.
 */

export function validateProjectileSpawnPayload(cfg: ProjectileSpawnConfig): void {
  const reasons: string[] = [];

  if (cfg.isGrenade || (cfg.fuseTime !== undefined && cfg.fuseTime > 0) || cfg.grenadeEffect) {
    reasons.push('Granaten-Payload (fuseTime/grenadeEffect) ist headless nicht implementiert');
  }

  if (cfg.isFlame || (cfg.burnDamagePerTick !== undefined && cfg.burnDamagePerTick > 0) || cfg.supplementalBurnOnHit) {
    reasons.push('Flammen-/Brand-Payload ist headless nicht implementiert');
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

  if (reasons.length > 0) {
    throw new UnsupportedWeaponMechanicError(cfg.sourceId ?? 'projectile', reasons);
  }
}

export function validateHitscanShotPayload(request: HitscanShotRequest): void {
  const reasons: string[] = [];

  if (request.chainLightning && request.chainLightning.maxJumps > 0) {
    reasons.push('chainLightning-Payload (Kettenblitz) ist headless nicht implementiert');
  }

  if (request.burnOnHit && ((request.burnOnHit.damagePerTick ?? 0) > 0 || (request.burnOnHit.durationMs ?? 0) > 0)) {
    reasons.push('burnOnHit-Payload (Brand-DoT) ist headless nicht implementiert');
  }

  if (request.supportEffect) {
    reasons.push('supportEffect-Payload ist headless nicht implementiert');
  }

  if (reasons.length > 0) {
    throw new UnsupportedWeaponMechanicError(request.sourceId ?? 'hitscan', reasons);
  }
}

export function validateMeleeSwingPayload(request: MeleeSwingRequest): void {
  const reasons: string[] = [];

  if (request.burnOnHit && ((request.burnOnHit.damagePerTick ?? 0) > 0 || (request.burnOnHit.durationMs ?? 0) > 0)) {
    reasons.push('burnOnHit-Payload (Brand-DoT) ist headless nicht implementiert');
  }

  if (request.hitAdrenaline > 0) {
    reasons.push('hitAdrenaline (Treffer-Adrenalin) ist headless nicht implementiert');
  }

  if (request.hitHeal > 0) {
    reasons.push('hitHeal (Treffer-Heilung) ist headless nicht implementiert');
  }

  if (reasons.length > 0) {
    throw new UnsupportedWeaponMechanicError(request.sourceId ?? 'melee', reasons);
  }
}
