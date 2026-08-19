import type { WeaponConfig } from '../../loadout/LoadoutConfig';

export interface WeaponBalanceCapabilityCheck {
  readonly supported: boolean;
  readonly unsupportedReasons: readonly string[];
}

export class UnsupportedWeaponMechanicError extends Error {
  readonly weaponId: string;
  readonly unsupportedReasons: readonly string[];

  constructor(weaponId: string, unsupportedReasons: readonly string[]) {
    super(
      `[WeaponBalanceLab] Waffe "${weaponId}" verwendet noch nicht unterstützte Mechaniken für Headless-Single-Target: ${unsupportedReasons.join(', ')}`,
    );
    this.name = 'UnsupportedWeaponMechanicError';
    this.weaponId = weaponId;
    this.unsupportedReasons = unsupportedReasons;
  }
}

/**
 * Validiert, ob eine WeaponConfig für den Headless-Single-Target-Benchmark in V0.2 unterstützt wird.
 *
 * Liefert eine strukturierte Auswertung ohne stillschweigend relevante Schadens- oder
 * Verhaltensmechaniken zu ignorieren.
 */
export function validateWeaponBalanceCapabilities(config: WeaponConfig): WeaponBalanceCapabilityCheck {
  const unsupportedReasons: string[] = [];

  const fireType = config.fire.type;
  if (fireType !== 'projectile' && fireType !== 'hitscan' && fireType !== 'melee') {
    unsupportedReasons.push(`Fire-Typ "${fireType}" ist in V0.2 noch nicht headless implementiert`);
  }

  if (config.burnOnHit && (config.burnOnHit.damagePerTick > 0 || config.burnOnHit.durationMs > 0)) {
    unsupportedReasons.push('burnOnHit (Brand-DoT) ist in V0.2 noch nicht headless implementiert');
  }

  if (fireType === 'projectile') {
    const projFire = config.fire;
    if (projFire.impactExplosion && projFire.impactExplosion.maxDamage > 0 && projFire.impactExplosion.radius > 0) {
      unsupportedReasons.push('impactExplosion (Flächenschaden) ist in V0.2 noch nicht headless implementiert');
    }
    if (projFire.enemyHitExplosion && projFire.enemyHitExplosion.maxDamage > 0 && projFire.enemyHitExplosion.radius > 0) {
      unsupportedReasons.push('enemyHitExplosion ist in V0.2 noch nicht headless implementiert');
    }
    if (projFire.homing && (config.homingEnabled === undefined || config.homingEnabled > 0)) {
      unsupportedReasons.push('Homing (Zielverfolgung) ist in V0.2 noch nicht headless implementiert');
    }
  }

  if (config.splitCount !== undefined && config.splitCount > 0) {
    unsupportedReasons.push('Hydra-Splitting (splitCount) ist in V0.2 noch nicht headless implementiert');
  }

  if (config.chainLightning && config.chainLightning.maxJumps > 0) {
    unsupportedReasons.push('chainLightning (Kettenblitze) ist in V0.2 noch nicht headless implementiert');
  }

  if (config.penetrationCount !== undefined && config.penetrationCount > 0) {
    unsupportedReasons.push('penetrationCount (Durchschlag) ist in V0.2 noch nicht headless implementiert');
  }

  if (config.detonable) {
    unsupportedReasons.push('detonable (ASMD-Ball-Detonation) ist in V0.2 noch nicht headless implementiert');
  }

  if (config.proximityPulse && config.proximityPulse.damage > 0) {
    unsupportedReasons.push('proximityPulse ist in V0.2 noch nicht headless implementiert');
  }

  return {
    supported: unsupportedReasons.length === 0,
    unsupportedReasons,
  };
}

/**
 * Wirft einen expliziten Fehler, falls die Waffe noch nicht unterstützte Mechaniken enthält.
 */
export function assertWeaponBalanceSupported(config: WeaponConfig): void {
  const check = validateWeaponBalanceCapabilities(config);
  if (!check.supported) {
    throw new UnsupportedWeaponMechanicError(config.id, check.unsupportedReasons);
  }
}
