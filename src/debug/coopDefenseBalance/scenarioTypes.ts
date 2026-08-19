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
