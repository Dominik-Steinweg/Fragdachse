import type { WeaponConfig } from '../../loadout/LoadoutConfig';
import type {
  WeaponBalanceScenario,
  CapabilityStatus,
  WeaponCapabilityClassification,
  ScenarioCapabilityCheckResult,
} from './scenarioTypes';

export interface WeaponBalanceCapabilityCheck extends ScenarioCapabilityCheckResult {
  /** Alias für unsupportedRelevant zur Abwärtskompatibilität. */
  readonly unsupportedReasons: readonly string[];
}

export class UnsupportedWeaponMechanicError extends Error {
  readonly weaponId: string;
  readonly unsupportedReasons: readonly string[];
  readonly scenario: WeaponBalanceScenario;

  constructor(
    weaponId: string,
    unsupportedReasons: readonly string[],
    scenario: WeaponBalanceScenario = 'single_target_static',
  ) {
    super(
      `[WeaponBalanceLab] Waffe "${weaponId}" verwendet im Szenario "${scenario}" noch nicht unterstützte relevante Mechaniken: ${unsupportedReasons.join(', ')}`,
    );
    this.name = 'UnsupportedWeaponMechanicError';
    this.weaponId = weaponId;
    this.unsupportedReasons = unsupportedReasons;
    this.scenario = scenario;
  }
}

/**
 * Validiert eine WeaponConfig szenariospezifisch gegen die Fähigkeiten des Headless-Simulators.
 *
 * Klassifiziert alle aktiven Eigenschaften in:
 * - `supported`: Wird tatsächlich simuliert.
 * - `scenario_irrelevant`: Existiert auf der Waffe, kann das Ergebnis unter den definierten Szenariobedingungen aber nachweislich nicht beeinflussen.
 * - `unsupported_relevant`: Könnte das Ergebnis beeinflussen, ist aber noch nicht simuliert (blockiert `provenMaximum`).
 */
export function validateWeaponBalanceCapabilities(
  config: WeaponConfig,
  scenario: WeaponBalanceScenario = 'single_target_static',
): WeaponBalanceCapabilityCheck {
  const classifications: WeaponCapabilityClassification[] = [];

  const add = (feature: string, status: CapabilityStatus, rationale: string) => {
    classifications.push({ feature, status, rationale });
  };

  const fireType = config.fire.type;
  if (fireType !== 'projectile' && fireType !== 'hitscan' && fireType !== 'melee') {
    add(`fire.type:${fireType}`, 'unsupported_relevant', `Fire-Typ "${fireType}" ist noch nicht headless implementiert`);
  } else {
    add(`fire.type:${fireType}`, 'supported', `Fire-Typ "${fireType}" wird headless vollständig simuliert`);
  }

  // 1. Ressourcen
  if (config.adrenalinCost > 0) {
    add('adrenalinCost', 'supported', 'Adrenalinkosten werden pro Schuss korrekt abgezogen');
  }
  if (config.adrenalinGain > 0) {
    add('adrenalinGain', 'supported', 'Adrenalingewinn wird pro Direkttreffer korrekt verbucht');
  }
  if (config.hitAdrenaline !== undefined && config.hitAdrenaline > 0) {
    add('hitAdrenaline', 'unsupported_relevant', 'hitAdrenaline beeinflusst die Adrenalingenerierung, ist headless aber noch nicht implementiert');
  }
  if (config.hitHeal !== undefined && config.hitHeal > 0) {
    if (scenario === 'single_target_static') {
      add('hitHeal', 'scenario_irrelevant', 'Spieler-HP ist im Single-Target-Dummy-Benchmark keine Zielmetrik');
    } else {
      add('hitHeal', 'unsupported_relevant', 'hitHeal ist für Überlebensszenarien noch nicht implementiert');
    }
  }

  // 2. Debuffs & Schadensmodifikatoren auf Treffer
  if (config.hitVulnerabilityDurationMs !== undefined && config.hitVulnerabilityDurationMs > 0) {
    add('hitVulnerabilityDurationMs', 'unsupported_relevant', 'hitVulnerabilityDurationMs erhöht Folgeschaden, ist headless aber noch nicht implementiert');
  }
  if (config.hitDebuffChance !== undefined && config.hitDebuffChance > 0) {
    if ((config.hitVulnerabilityDurationMs ?? 0) > 0) {
      add('hitDebuffChance', 'unsupported_relevant', 'hitDebuffChance mit aktiver Verwundbarkeit ist noch nicht implementiert');
    }
  }
  if ((config.hitSlowDurationMs ?? 0) > 0 && (config.hitSlowFraction ?? 0) > 0) {
    if (scenario === 'single_target_static') {
      add('hitSlow', 'scenario_irrelevant', 'Dummy ist unbeweglich; Gegner-Verlangsamung ändert Treffer oder Schaden nicht');
    } else {
      add('hitSlow', 'unsupported_relevant', 'hitSlow beeinflusst Gegnerbewegung in dynamischen Szenarien');
    }
  }
  if ((config.shotgunSlowDurationMs ?? 0) > 0 && (config.shotgunSlowFraction ?? 0) > 0) {
    if (scenario === 'single_target_static') {
      add('shotgunSlow', 'scenario_irrelevant', 'Dummy ist unbeweglich; Shotgun-Slow ändert Treffer oder Schaden nicht');
    } else {
      add('shotgunSlow', 'unsupported_relevant', 'shotgunSlow ist für dynamische Szenarien noch nicht implementiert');
    }
  }
  if (config.directDamageOverride !== undefined) {
    add('directDamageOverride', 'unsupported_relevant', 'directDamageOverride ist noch nicht implementiert');
  }

  // 3. Kettenblitze (Chain Lightning)
  if (config.chainLightning && config.chainLightning.maxJumps > 0) {
    if (scenario === 'single_target_static') {
      add(
        'chainLightning',
        'scenario_irrelevant',
        'Im Single-Target-Dummy-Szenario existiert kein zweites Ziel für Kettenblitz-Sprünge und keine ASMD-Bälle zum Detonieren',
      );
    } else {
      add('chainLightning', 'unsupported_relevant', 'chainLightning benötigt Multi-Target-Simulation');
    }
  }

  // 4. Defensive & Knockback
  if (config.damageReduction !== undefined && config.damageReduction > 0) {
    add('damageReduction', 'scenario_irrelevant', 'Dummy greift im Benchmark nicht an; Schadensreduktion des Spielers ist irrelevant');
  }
  if (config.hitKnockback !== undefined && config.hitKnockback > 0) {
    add('hitKnockback', 'scenario_irrelevant', 'Dummy ist im Single-Target-Benchmark ortsfest fixiert');
  }

  // 5. Scopes & Aim
  if (config.scopeConfig !== undefined) {
    add('scopeConfig', 'unsupported_relevant', 'scopeConfig (Scharfschützen-Scope) ist in Headless noch nicht implementiert');
  }
  if (config.awpCharge && ((config.awpCharge.maxDamageBonus ?? 0) > 0 || (config.awpCharge.corridorEnabled ?? 0) > 0)) {
    add('awpCharge', 'unsupported_relevant', 'awpCharge (Scope-Aufladung / Schneise) ist noch nicht implementiert');
  }

  // 6. Brand & DoT
  if (config.burnOnHit && ((config.burnOnHit.damagePerTick ?? 0) > 0 || (config.burnOnHit.durationMs ?? 0) > 0)) {
    add('burnOnHit', 'unsupported_relevant', 'burnOnHit (Brand-DoT) verursacht relevanten Schaden, ist headless aber noch nicht implementiert');
  }
  if (config.warmupBurnThreshold !== undefined && config.warmupBurnThreshold > 0) {
    add('warmupBurnThreshold', 'unsupported_relevant', 'warmupBurnThreshold (Brand-Aufwärmung) ist noch nicht implementiert');
  }

  // 7. Projektil-Sonderpayloads & Explosionen
  if (fireType === 'projectile') {
    const projFire = config.fire;
    if (projFire.impactExplosion && projFire.impactExplosion.maxDamage > 0 && projFire.impactExplosion.radius > 0) {
      add('impactExplosion', 'unsupported_relevant', 'impactExplosion (Flächenschaden) ist noch nicht headless implementiert');
    }
    if (projFire.enemyHitExplosion && projFire.enemyHitExplosion.maxDamage > 0 && projFire.enemyHitExplosion.radius > 0) {
      add('enemyHitExplosion', 'unsupported_relevant', 'enemyHitExplosion ist noch nicht headless implementiert');
    }
    if (projFire.homing && (config.homingEnabled === undefined || config.homingEnabled > 0)) {
      add('homing', 'unsupported_relevant', 'Homing (Zielverfolgung) verändert Trefferwahrscheinlichkeit, ist headless aber noch nicht implementiert');
    }
  }

  // 8. Spaltung, Durchschlag & Detonationen
  if (config.splitCount !== undefined && config.splitCount > 0) {
    add('splitCount', 'unsupported_relevant', 'Hydra-Splitting (splitCount) ist noch nicht headless implementiert');
  }
  if (config.penetrationCount !== undefined && config.penetrationCount > 0) {
    add('penetrationCount', 'unsupported_relevant', 'penetrationCount (Durchschlag) ist noch nicht headless implementiert');
  }
  if (config.detonable) {
    add('detonable', 'unsupported_relevant', 'detonable (ASMD-Ball-Detonation) ist noch nicht headless implementiert');
  }
  if (config.proximityPulse && config.proximityPulse.damage > 0) {
    add('proximityPulse', 'unsupported_relevant', 'proximityPulse ist noch nicht headless implementiert');
  }

  // 9. Spezifische Waffenmechaniken
  if (config.sideBurstEveryShots !== undefined && config.sideBurstEveryShots > 0 && (config.sideBurstCount ?? 0) >= 2) {
    add('sideBurst', 'unsupported_relevant', 'sideBurst (zusätzliche Seitenschüsse) ist noch nicht headless implementiert');
  }
  if (config.plasmaSwarmEnabled !== undefined && config.plasmaSwarmEnabled > 0) {
    add('plasmaSwarm', 'unsupported_relevant', 'plasmaSwarm (Funken-Schwarm) ist noch nicht headless implementiert');
  }
  if (config.ak47Focus && ((config.ak47Focus.maxStacks ?? 0) > 0 || (config.ak47Focus.fireSuperiorityShots ?? 0) > 0)) {
    add('ak47Focus', 'unsupported_relevant', 'ak47Focus (Fokus-Stacks / Überlegenheit) ist noch nicht headless implementiert');
  }
  if (config.negevKillstreak && (config.negevKillstreak.damageBonusPerKill ?? 0) > 0) {
    if (scenario === 'single_target_static') {
      add('negevKillstreak', 'scenario_irrelevant', 'Dummy stirbt nicht; Killstreak-Stacks können im Dummy-Benchmark nicht aufgebaut werden');
    } else {
      add('negevKillstreak', 'unsupported_relevant', 'negevKillstreak ist für Kampfszenarien noch nicht implementiert');
    }
  }
  if (config.shotgunLightningDamage !== undefined && config.shotgunLightningDamage > 0) {
    add('shotgunLightning', 'unsupported_relevant', 'shotgunLightning (Kugelblitz) ist noch nicht headless implementiert');
  }
  if (config.shotgunProximityMaxDamageBonus !== undefined && config.shotgunProximityMaxDamageBonus > 0) {
    add('shotgunProximity', 'unsupported_relevant', 'shotgunProximity (Distanzschadensbonus) ist noch nicht headless implementiert');
  }
  if (config.shotgunChainEnabled !== undefined && config.shotgunChainEnabled > 0) {
    if (scenario === 'single_target_static') {
      add('shotgunChain', 'scenario_irrelevant', 'Kein zweites Ziel für Shotgun-Kettenblitz vorhanden');
    } else {
      add('shotgunChain', 'unsupported_relevant', 'shotgunChain benötigt Multi-Target-Simulation');
    }
  }
  if (config.miniRocketCascadeDamageBonusPerExplosion !== undefined && config.miniRocketCascadeDamageBonusPerExplosion > 0) {
    add('miniRocketCascade', 'unsupported_relevant', 'miniRocketCascade (Kaskaden-Bonus) ist noch nicht headless implementiert');
  }
  if (config.miniRocketReturnEnabled !== undefined && config.miniRocketReturnEnabled > 0) {
    add('miniRocketReturn', 'unsupported_relevant', 'miniRocketReturn (Rückkehr) ist noch nicht headless implementiert');
  }
  if (config.multiExplosionCount !== undefined && config.multiExplosionCount > 1) {
    add('multiExplosionCount', 'unsupported_relevant', 'multiExplosionCount (Mehrfachexplosionen) ist noch nicht headless implementiert');
  }

  const supportedRelevant = classifications
    .filter((c) => c.status === 'supported')
    .map((c) => c.feature);

  const ignoredScenarioIrrelevant = classifications
    .filter((c) => c.status === 'scenario_irrelevant')
    .map((c) => c.feature);

  const unsupportedRelevant = classifications
    .filter((c) => c.status === 'unsupported_relevant')
    .map((c) => c.feature);

  return {
    scenario,
    supported: unsupportedRelevant.length === 0,
    supportedRelevant,
    ignoredScenarioIrrelevant,
    unsupportedRelevant,
    unsupportedReasons: unsupportedRelevant,
    classifications,
  };
}

/**
 * Wirft einen expliziten Fehler, falls die Waffe im gegebenen Szenario nicht unterstützte relevante Mechaniken enthält.
 */
export function assertWeaponBalanceSupported(
  config: WeaponConfig,
  scenario: WeaponBalanceScenario = 'single_target_static',
): void {
  const check = validateWeaponBalanceCapabilities(config, scenario);
  if (!check.supported) {
    throw new UnsupportedWeaponMechanicError(config.id, check.unsupportedRelevant, scenario);
  }
}
