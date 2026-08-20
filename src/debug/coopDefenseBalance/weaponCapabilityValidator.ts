import type { WeaponConfig } from '../../loadout/LoadoutConfig';
import type {
  WeaponBalanceScenario,
  CapabilityStatus,
  WeaponCapabilityClassification,
  ScenarioCapabilityCheckResult,
} from './scenarioTypes';
import {
  classifyWeaponCapabilities,
  findUnknownActiveWeaponFields,
} from './weaponBalanceCapabilities';

export interface WeaponBalanceCapabilityCheck extends ScenarioCapabilityCheckResult {
  /** Alias fuer unsupportedRelevant zur Abwaertskompatibilitaet. */
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
      `[WeaponBalanceLab] Waffe "${weaponId}" verwendet im Szenario "${scenario}" noch nicht unterstuetzte relevante Mechaniken: ${unsupportedReasons.join(', ')}`,
    );
    this.name = 'UnsupportedWeaponMechanicError';
    this.weaponId = weaponId;
    this.unsupportedReasons = unsupportedReasons;
    this.scenario = scenario;
  }
}

/**
 * Validiert WeaponConfig und klassifiziert aktive Mechaniken ueber den zentralen
 * Capability-Katalog. Unbekannte aktive Top-Level-Felder bleiben fail-closed.
 */
export function validateWeaponBalanceCapabilities(
  config: WeaponConfig,
  scenario: WeaponBalanceScenario = 'single_target_static',
): WeaponBalanceCapabilityCheck {
  const classifications: WeaponCapabilityClassification[] = [
    ...classifyWeaponCapabilities(config, scenario),
    ...findUnknownActiveWeaponFields(config).map((feature): WeaponCapabilityClassification => ({
      feature,
      status: 'unsupported_relevant' as CapabilityStatus,
      rationale: 'Neue aktive WeaponConfig-Felder muessen zuerst zentral klassifiziert werden',
    })),
  ];

  const supportedRelevant = classifications
    .filter((entry) => entry.status === 'supported')
    .map((entry) => entry.feature);
  const ignoredScenarioIrrelevant = classifications
    .filter((entry) => entry.status === 'scenario_irrelevant')
    .map((entry) => entry.feature);
  const unsupportedRelevant = classifications
    .filter((entry) => entry.status === 'unsupported_relevant')
    .map((entry) => entry.feature);

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

/** Wirft explizit, wenn eine relevante Mechanik im Szenario nicht unterstuetzt ist. */
export function assertWeaponBalanceSupported(
  config: WeaponConfig,
  scenario: WeaponBalanceScenario = 'single_target_static',
): void {
  const check = validateWeaponBalanceCapabilities(config, scenario);
  if (!check.supported) {
    throw new UnsupportedWeaponMechanicError(config.id, check.unsupportedRelevant, scenario);
  }
}
