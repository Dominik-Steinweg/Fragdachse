/**
 * Szenario-Kontext für das Weapon Balance Lab.
 *
 * Verschiedene Benchmarks stellen unterschiedliche Anforderungen an die Simulation:
 * - `single_target_static`: 1 unsterblicher, unbeweglicher Dummy auf fester Distanz.
 * - `five_target`: 5 Ziele (z.B. für Kettenblitze, Penetration, Spaltung).
 * - `combat_scenario`: Kampfszenario mit KI, Bewegung und Spawn-Wellen (gemäß GDD ohne direkte Gegnerangriffe auf den Spieler im Standard-DPS-Benchmark).
 */
export type WeaponBalanceScenario =
  | 'single_target_static'
  | 'five_target'
  | 'combat_scenario';

/**
 * Benchmark-Policy fuer die Zielausrichtung.
 *
 * Das ist eine Annahme des Balance-Labs, keine universelle Gameplay-Regel.
 */
export type SingleTargetAimPolicy = 'target_center';

/**
 * Benchmark-Policy fuer die Schussfreigabe.
 *
 * `spread_coverage_and_recovery` wartet, bis der Spread-Kegel das Ziel abdeckt,
 * und wartet nach einem Schuss die konfigurierte Spread-Recovery ab.
 */
export type SingleTargetTriggerPolicy = 'spread_coverage_and_recovery';

/** Versionierter Vertrag fuer den statischen Single-Target-Benchmark. */
export interface SingleTargetScenarioConfig {
  /** Semantische Szenario-ID inklusive Version. */
  readonly id: 'single_target_static.v1';
  readonly version: 1;
  readonly targetRadius: number;
  readonly targetDistance: number;
  readonly attackWindowMs: number;
  readonly warmupMs: number;
  readonly settleLimitMs: number;
  readonly triggerPolicy: SingleTargetTriggerPolicy;
  readonly aimPolicy: SingleTargetAimPolicy;
}

/**
 * Kanonische Geometrie und Zeitbasis fuer alle Waffen des V1-Szenarios.
 * 150px ist die kanonische Fernkampf-Distanz. Nahkampf verwendet das separat versionierte
 * `MELEE_SINGLE_TARGET_SCENARIO_CONFIG`, damit BITE nicht durch eine implizite Reichweiten-
 * Berechnung aus dem Benchmark faellt. Zielradius 16 entspricht der Runtime-Spielergroesse.
 */
export const DEFAULT_SINGLE_TARGET_SCENARIO_CONFIG: SingleTargetScenarioConfig = Object.freeze({
  id: 'single_target_static.v1',
  version: 1,
  targetRadius: 16,
  targetDistance: 150,
  attackWindowMs: 30_000,
  warmupMs: 0,
  settleLimitMs: 5_000,
  triggerPolicy: 'spread_coverage_and_recovery',
  aimPolicy: 'target_center',
});

/** Explizites Profil fuer den Reichweiten-Sonderfall der Nahkampfwaffen. */
export const MELEE_SINGLE_TARGET_SCENARIO_CONFIG: SingleTargetScenarioConfig = Object.freeze({
  ...DEFAULT_SINGLE_TARGET_SCENARIO_CONFIG,
  targetDistance: 40,
});

/**
 * Waehlt nur zwischen versionierten Profilen; Distanz wird nie aus `range` rekonstruiert.
 * Aufrufer mit eigenem Profil umgehen diese Auswahl ueber `scenarioConfig`.
 */
export function resolveSingleTargetScenarioProfile(
  fireType: string,
): SingleTargetScenarioConfig {
  return fireType === 'melee'
    ? MELEE_SINGLE_TARGET_SCENARIO_CONFIG
    : DEFAULT_SINGLE_TARGET_SCENARIO_CONFIG;
}

/** Validiert benutzerdefinierte Scenario-Profile an der Benchmark-Grenze. */
export function assertSingleTargetScenarioConfig(config: SingleTargetScenarioConfig): void {
  if (config.id !== 'single_target_static.v1' || config.version !== 1) {
    throw new Error(`[WeaponBalanceLab] Unbekannte Single-Target-Szenario-Version "${config.id}"`);
  }
  if (!Number.isFinite(config.targetRadius) || config.targetRadius <= 0) {
    throw new Error('[WeaponBalanceLab] Single-Target targetRadius muss positiv sein.');
  }
  if (!Number.isFinite(config.targetDistance) || config.targetDistance <= 0) {
    throw new Error('[WeaponBalanceLab] Single-Target targetDistance muss positiv sein.');
  }
  if (!Number.isFinite(config.attackWindowMs) || config.attackWindowMs <= 0) {
    throw new Error('[WeaponBalanceLab] Single-Target attackWindowMs muss positiv sein.');
  }
  if (!Number.isFinite(config.warmupMs) || config.warmupMs < 0) {
    throw new Error('[WeaponBalanceLab] Single-Target warmupMs darf nicht negativ sein.');
  }
  if (!Number.isFinite(config.settleLimitMs) || config.settleLimitMs < 0) {
    throw new Error('[WeaponBalanceLab] Single-Target settleLimitMs darf nicht negativ sein.');
  }
}

export type CapabilityStatus =
  | 'supported'
  | 'scenario_irrelevant'
  | 'unsupported_relevant';

export interface WeaponCapabilityClassification {
  readonly feature: string;
  readonly status: CapabilityStatus;
  readonly rationale: string;
}

export interface ScenarioCapabilityCheckResult {
  readonly scenario: WeaponBalanceScenario;
  readonly supported: boolean;
  readonly supportedRelevant: readonly string[];
  readonly ignoredScenarioIrrelevant: readonly string[];
  readonly unsupportedRelevant: readonly string[];
  readonly classifications: readonly WeaponCapabilityClassification[];
}
