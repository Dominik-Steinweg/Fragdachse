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

/** Versionierte Geometrieprofile fuer den statischen 5T-Benchmark. */
export type FiveTargetLayoutProfile = 'forward_cluster_v1' | 'melee_arc_v1';

/** Explizite Aim-Policy des statischen Multi-Target-Benchmarks. */
export type FiveTargetAimPolicy = 'coverage_aware_v1';

/** Explizite Trigger-Policy des statischen Multi-Target-Benchmarks. */
export type FiveTargetTriggerPolicy = 'spread_coverage_and_recovery_v1';

export interface FiveTargetLayoutRegion {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Versionierter Vertrag fuer den statischen Five-Target-Benchmark. */
export interface FiveTargetScenarioConfig {
  /** Semantische Szenario-ID inklusive Version. */
  readonly id: 'five_target_static.v1';
  readonly version: 1;
  readonly targetCount: 5;
  readonly targetRadius: number;
  /** Versioniert die Geometrie unabhaengig von WeaponConfig und Upgrade-Build. */
  readonly layoutVersion: 1;
  readonly layoutProfile: FiveTargetLayoutProfile;
  readonly layoutRegion: FiveTargetLayoutRegion;
  /** Zusaetzlicher Abstand zwischen den Zielmittelpunkten neben dem Durchmesser. */
  readonly minimumTargetGap: number;
  readonly attackWindowMs: number;
  readonly warmupMs: number;
  readonly settleLimitMs: number;
  readonly triggerPolicy: FiveTargetTriggerPolicy;
  readonly aimPolicy: FiveTargetAimPolicy;
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
 * Kanonisches Fernkampfprofil fuer fuenf statische, unsterbliche Spieler-Dummies.
 * Die Region ist absichtlich unabhaengig von WeaponConfig.range; Reichweite bestimmt nur,
 * welche dieser bereits erzeugten Ziele eine Waffe erreichen kann.
 */
export const DEFAULT_FIVE_TARGET_SCENARIO_CONFIG: FiveTargetScenarioConfig = Object.freeze({
  id: 'five_target_static.v1',
  version: 1,
  targetCount: 5,
  targetRadius: 16,
  layoutVersion: 1,
  layoutProfile: 'forward_cluster_v1',
  layoutRegion: Object.freeze({ minX: 110, maxX: 250, minY: -120, maxY: 120 }),
  minimumTargetGap: 4,
  attackWindowMs: 30_000,
  warmupMs: 0,
  settleLimitMs: 5_000,
  triggerPolicy: 'spread_coverage_and_recovery_v1',
  aimPolicy: 'coverage_aware_v1',
});

/** Explizites kanonisches Nahkampfprofil fuer fuenf Dummies im Melee-Arc. */
export const MELEE_FIVE_TARGET_SCENARIO_CONFIG: FiveTargetScenarioConfig = Object.freeze({
  ...DEFAULT_FIVE_TARGET_SCENARIO_CONFIG,
  layoutProfile: 'melee_arc_v1',
  layoutRegion: Object.freeze({ minX: 2, maxX: 66, minY: -64, maxY: 64 }),
  minimumTargetGap: 2,
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

/** Waehlt nur zwischen versionierten 5T-Profilen; keine Reichweitenheuristik. */
export function resolveFiveTargetScenarioProfile(
  fireType: string,
): FiveTargetScenarioConfig {
  return fireType === 'melee'
    ? MELEE_FIVE_TARGET_SCENARIO_CONFIG
    : DEFAULT_FIVE_TARGET_SCENARIO_CONFIG;
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

/** Validiert ein 5T-Profil an der Benchmark-Grenze. */
export function assertFiveTargetScenarioConfig(config: FiveTargetScenarioConfig): void {
  if (config.id !== 'five_target_static.v1' || config.version !== 1) {
    throw new Error(`[WeaponBalanceLab] Unbekannte Five-Target-Szenario-Version "${config.id}"`);
  }
  if (config.targetCount !== 5) {
    throw new Error('[WeaponBalanceLab] Five-Target targetCount muss exakt 5 sein.');
  }
  if (!Number.isFinite(config.targetRadius) || config.targetRadius <= 0) {
    throw new Error('[WeaponBalanceLab] Five-Target targetRadius muss positiv sein.');
  }
  if (config.layoutVersion !== 1) {
    throw new Error(`[WeaponBalanceLab] Unbekannte Five-Target layoutVersion "${config.layoutVersion}"`);
  }
  if (config.layoutProfile !== 'forward_cluster_v1' && config.layoutProfile !== 'melee_arc_v1') {
    throw new Error(`[WeaponBalanceLab] Unbekanntes Five-Target layoutProfile "${config.layoutProfile}"`);
  }
  if (config.triggerPolicy !== 'spread_coverage_and_recovery_v1') {
    throw new Error(`[WeaponBalanceLab] Unbekannte Five-Target triggerPolicy "${config.triggerPolicy}"`);
  }
  if (config.aimPolicy !== 'coverage_aware_v1') {
    throw new Error(`[WeaponBalanceLab] Unbekannte Five-Target aimPolicy "${config.aimPolicy}"`);
  }
  const region = config.layoutRegion;
  if (
    !region
    || !Number.isFinite(region.minX)
    || !Number.isFinite(region.maxX)
    || !Number.isFinite(region.minY)
    || !Number.isFinite(region.maxY)
    || region.minX > region.maxX
    || region.minY > region.maxY
  ) {
    throw new Error('[WeaponBalanceLab] Five-Target layoutRegion ist ungueltig.');
  }
  if (!Number.isFinite(config.minimumTargetGap) || config.minimumTargetGap < 0) {
    throw new Error('[WeaponBalanceLab] Five-Target minimumTargetGap darf nicht negativ sein.');
  }
  if (!Number.isFinite(config.attackWindowMs) || config.attackWindowMs <= 0) {
    throw new Error('[WeaponBalanceLab] Five-Target attackWindowMs muss positiv sein.');
  }
  if (!Number.isFinite(config.warmupMs) || config.warmupMs < 0) {
    throw new Error('[WeaponBalanceLab] Five-Target warmupMs darf nicht negativ sein.');
  }
  if (!Number.isFinite(config.settleLimitMs) || config.settleLimitMs < 0) {
    throw new Error('[WeaponBalanceLab] Five-Target settleLimitMs darf nicht negativ sein.');
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
