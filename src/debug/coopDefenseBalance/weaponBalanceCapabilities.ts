import type { ProjectileSpawnConfig } from '../../types';
import type { HitscanShotRequest, MeleeSwingRequest } from '../../loadout/WeaponFireExecutor';
import type { WeaponConfig } from '../../loadout/LoadoutConfig';
import { LOADOUT_ALLOWED_KEYS_BY_PATH } from '../../loadout/content/LoadoutKnownFields';
import type {
  CapabilityStatus,
  WeaponBalanceScenario,
  WeaponCapabilityClassification,
} from './scenarioTypes';

type AnyRecord = Record<string, any>;

export interface WeaponCapabilityDefinition {
  readonly feature: string;
  readonly active: (config: WeaponConfig) => boolean;
  readonly status: (config: WeaponConfig, scenario: WeaponBalanceScenario) => CapabilityStatus;
  readonly rationale: (config: WeaponConfig, scenario: WeaponBalanceScenario) => string;
}

export interface HeadlessPayloadCapabilityDefinition {
  readonly feature: string;
  readonly fields: readonly string[];
  readonly active: (payload: AnyRecord) => boolean;
  readonly status: (payload: AnyRecord, scenario: WeaponBalanceScenario) => CapabilityStatus;
  readonly rationale: (payload: AnyRecord, scenario: WeaponBalanceScenario) => string;
}

const alwaysSupported = (): CapabilityStatus => 'supported';
const alwaysUnsupported = (): CapabilityStatus => 'unsupported_relevant';
const alwaysIrrelevant = (): CapabilityStatus => 'scenario_irrelevant';
const positive = (value: unknown): boolean => typeof value === 'number' && value > 0;
const enabled = (value: unknown): boolean => Boolean(value) && value !== 0;
const objectWithPositive = (value: unknown, keys: readonly string[]): boolean => (
  !!value && typeof value === 'object' && keys.some((key) => positive((value as AnyRecord)[key]))
);

function activeField(key: keyof WeaponConfig): (config: WeaponConfig) => boolean {
  return (config) => positive(config[key]);
}

function configDefinition(
  feature: string,
  active: (config: WeaponConfig) => boolean,
  status: CapabilityStatus | ((config: WeaponConfig, scenario: WeaponBalanceScenario) => CapabilityStatus),
  rationale: string | ((config: WeaponConfig, scenario: WeaponBalanceScenario) => string),
): WeaponCapabilityDefinition {
  return {
    feature,
    active,
    status: typeof status === 'function' ? status : () => status,
    rationale: typeof rationale === 'function' ? rationale : () => rationale,
  };
}

/**
 * Zentrale, szenarioabhaengige Beschreibung der WeaponConfig-Mechaniken.
 * Neue ergebnisrelevante Weapon-Felder muessen hier klassifiziert werden oder werden
 * durch `findUnknownActiveWeaponFields` fail-closed abgelehnt.
 */
export const WEAPON_BALANCE_CAPABILITY_DEFINITIONS: readonly WeaponCapabilityDefinition[] = [
  configDefinition(
    'fire.type',
    () => true,
    (config) => ['projectile', 'hitscan', 'melee'].includes(config.fire.type)
      ? 'supported' : 'unsupported_relevant',
    (config) => ['projectile', 'hitscan', 'melee'].includes(config.fire.type)
      ? `Fire-Typ "${config.fire.type}" wird headless vollstaendig simuliert`
      : `Fire-Typ "${config.fire.type}" ist noch nicht headless implementiert`,
  ),
  configDefinition('adrenalinCost', activeField('adrenalinCost'), 'supported', 'Adrenalinkosten werden pro Schuss korrekt abgezogen'),
  configDefinition('adrenalinGain', activeField('adrenalinGain'), 'supported', 'Adrenalingewinn wird pro Direkttreffer korrekt verbucht'),
  configDefinition('hitAdrenaline', activeField('hitAdrenaline'), 'supported', 'hitAdrenaline wird pro Nahkampftreffer vollstaendig simuliert'),
  configDefinition(
    'hitHeal', activeField('hitHeal'),
    (_config, scenario) => scenario === 'single_target_static' || scenario === 'five_target'
      ? 'scenario_irrelevant' : 'unsupported_relevant',
    (_config, scenario) => scenario === 'single_target_static' || scenario === 'five_target'
      ? 'Spieler-HP ist im statischen Dummy-Benchmark keine Zielmetrik'
      : 'hitHeal ist fuer Ueberlebensszenarien noch nicht implementiert',
  ),
  configDefinition(
    'killHeal', activeField('killHeal'),
    (_config, scenario) => scenario === 'single_target_static' || scenario === 'five_target'
      ? 'scenario_irrelevant' : 'unsupported_relevant',
    (_config, scenario) => scenario === 'single_target_static' || scenario === 'five_target'
      ? 'Statische Ziele sind unsterblich; Kill-Heal kann nicht ausgeloest werden'
      : 'killHeal ist fuer Kampfszenarien noch nicht implementiert',
  ),
  configDefinition(
    'killAdrenaline', activeField('killAdrenaline'),
    (_config, scenario) => scenario === 'single_target_static' || scenario === 'five_target'
      ? 'scenario_irrelevant' : 'unsupported_relevant',
    (_config, scenario) => scenario === 'single_target_static' || scenario === 'five_target'
      ? 'Statische Ziele sind unsterblich; Kill-Adrenalin kann nicht ausgeloest werden'
      : 'killAdrenaline ist fuer Kampfszenarien noch nicht implementiert',
  ),
  configDefinition('hitVulnerabilityDurationMs', activeField('hitVulnerabilityDurationMs'), 'unsupported_relevant', 'hitVulnerabilityDurationMs erhoeht Folgeschaden, ist headless aber noch nicht implementiert'),
  configDefinition(
    'hitDebuffChance',
    (config) => positive(config.hitDebuffChance) && positive(config.hitVulnerabilityDurationMs),
    'unsupported_relevant',
    'hitDebuffChance mit aktiver Verwundbarkeit ist noch nicht implementiert',
  ),
  configDefinition(
    'hitSlow',
    (config) => positive(config.hitSlowDurationMs) && positive(config.hitSlowFraction),
    (_config, scenario) => scenario === 'single_target_static' || scenario === 'five_target' ? 'scenario_irrelevant' : 'unsupported_relevant',
    (_config, scenario) => scenario === 'single_target_static' || scenario === 'five_target'
      ? 'Dummy-Ziele sind unbeweglich; Gegner-Verlangsamung aendert Treffer oder Schaden nicht'
      : 'hitSlow beeinflusst Gegnerbewegung in dynamischen Szenarien',
  ),
  configDefinition(
    'shotgunSlow',
    (config) => positive(config.shotgunSlowDurationMs) && positive(config.shotgunSlowFraction),
    (_config, scenario) => scenario === 'single_target_static' || scenario === 'five_target' ? 'scenario_irrelevant' : 'unsupported_relevant',
    (_config, scenario) => scenario === 'single_target_static' || scenario === 'five_target'
      ? 'Dummy-Ziele sind unbeweglich; Shotgun-Slow aendert Treffer oder Schaden nicht'
      : 'shotgunSlow ist fuer dynamische Szenarien noch nicht implementiert',
  ),
  configDefinition('directDamageOverride', activeField('directDamageOverride'), 'unsupported_relevant', 'directDamageOverride ist noch nicht implementiert'),
  configDefinition(
    'chainLightning',
    (config) => positive(config.chainLightning?.maxJumps),
    (_config, scenario) => scenario === 'single_target_static' ? 'scenario_irrelevant' : scenario === 'five_target' ? 'supported' : 'unsupported_relevant',
    (_config, scenario) => scenario === 'single_target_static'
      ? 'Im Single-Target-Szenario existiert kein zweites Ziel fuer Kettenblitz-Spruenge'
      : scenario === 'five_target'
        ? 'Shared Chain-Lightning-Resolver traversiert die statischen Five-Target-Enemies ohne LoS-Blocker'
        : 'chainLightning benoetigt Multi-Target-Simulation',
  ),
  configDefinition('damageReduction', activeField('damageReduction'), 'scenario_irrelevant', 'Dummy greift im Benchmark nicht an'),
  configDefinition('hitKnockback', activeField('hitKnockback'), 'scenario_irrelevant', 'Statische Dummies bleiben im Benchmark ortsfest fixiert'),
  configDefinition('scopeConfig', (config) => config.scopeConfig !== undefined, 'unsupported_relevant', 'scopeConfig ist in Headless noch nicht implementiert'),
  configDefinition(
    'awpCharge',
    (config) => objectWithPositive(config.awpCharge, ['maxDamageBonus', 'corridorEnabled']),
    'unsupported_relevant',
    'awpCharge ist noch nicht implementiert',
  ),
  configDefinition(
    'burnOnHit',
    (config) => objectWithPositive(config.burnOnHit, ['damagePerTick', 'durationMs']),
    'supported',
    'burnOnHit wird ueber die geteilte BurnStateMachine vollstaendig simuliert',
  ),
  configDefinition('warmupBurnThreshold', activeField('warmupBurnThreshold'), 'unsupported_relevant', 'warmupBurnThreshold ist noch nicht implementiert'),
  configDefinition(
    'impactExplosion',
    (config) => config.fire.type === 'projectile' && objectWithPositive(config.fire.impactExplosion, ['maxDamage', 'radius']),
    'unsupported_relevant',
    'impactExplosion ist noch nicht headless implementiert',
  ),
  configDefinition(
    'enemyHitExplosion',
    (config) => config.fire.type === 'projectile' && objectWithPositive(config.fire.enemyHitExplosion, ['maxDamage', 'radius']),
    'unsupported_relevant',
    'enemyHitExplosion ist noch nicht headless implementiert',
  ),
  configDefinition(
    'homing',
    (config) => config.fire.type === 'projectile' && !!config.fire.homing && (config.homingEnabled === undefined || config.homingEnabled > 0),
    'unsupported_relevant',
    'Homing veraendert Trefferwahrscheinlichkeit, ist headless aber noch nicht implementiert',
  ),
  configDefinition('splitCount', activeField('splitCount'), 'unsupported_relevant', 'Hydra-Splitting ist noch nicht headless implementiert'),
  configDefinition('penetrationCount', activeField('penetrationCount'), 'unsupported_relevant', 'penetrationCount ist noch nicht headless implementiert'),
  configDefinition('detonable', (config) => !!config.detonable, 'unsupported_relevant', 'detonable ist noch nicht headless implementiert'),
  configDefinition('proximityPulse', (config) => positive(config.proximityPulse?.damage), 'unsupported_relevant', 'proximityPulse ist noch nicht headless implementiert'),
  configDefinition('sideBurst', (config) => positive(config.sideBurstEveryShots) && (config.sideBurstCount ?? 0) >= 2, 'unsupported_relevant', 'sideBurst ist noch nicht headless implementiert'),
  configDefinition('plasmaSwarm', activeField('plasmaSwarmEnabled'), 'unsupported_relevant', 'plasmaSwarm ist noch nicht headless implementiert'),
  configDefinition(
    'ak47Focus',
    (config) => objectWithPositive(config.ak47Focus, ['maxStacks', 'fireSuperiorityShots']),
    'unsupported_relevant',
    'ak47Focus ist noch nicht headless implementiert',
  ),
  configDefinition(
    'negevKillstreak',
    (config) => positive(config.negevKillstreak?.damageBonusPerKill),
    (_config, scenario) => scenario === 'single_target_static' || scenario === 'five_target' ? 'scenario_irrelevant' : 'unsupported_relevant',
    (_config, scenario) => scenario === 'single_target_static' || scenario === 'five_target'
      ? 'Statische Ziele sterben nicht; Killstreak-Stacks koennen nicht aufgebaut werden'
      : 'negevKillstreak ist fuer Kampfszenarien noch nicht implementiert',
  ),
  configDefinition('shotgunLightning', activeField('shotgunLightningDamage'), 'unsupported_relevant', 'shotgunLightning ist noch nicht headless implementiert'),
  configDefinition('shotgunProximity', activeField('shotgunProximityMaxDamageBonus'), 'unsupported_relevant', 'shotgunProximity ist noch nicht headless implementiert'),
  configDefinition(
    'shotgunChain',
    activeField('shotgunChainEnabled'),
    (_config, scenario) => scenario === 'single_target_static' ? 'scenario_irrelevant' : 'unsupported_relevant',
    (_config, scenario) => scenario === 'single_target_static'
      ? 'Kein zweites Ziel fuer Shotgun-Kettenblitz vorhanden'
      : 'shotgunChain benoetigt Multi-Target-Simulation',
  ),
  configDefinition('miniRocketCascade', activeField('miniRocketCascadeDamageBonusPerExplosion'), 'unsupported_relevant', 'miniRocketCascade ist noch nicht headless implementiert'),
  configDefinition('miniRocketReturn', activeField('miniRocketReturnEnabled'), 'unsupported_relevant', 'miniRocketReturn ist noch nicht headless implementiert'),
  configDefinition('multiExplosionCount', (config) => (config.multiExplosionCount ?? 0) > 1, 'unsupported_relevant', 'multiExplosionCount ist noch nicht headless implementiert'),
];

const WEAPON_STRUCTURAL_FIELDS = new Set([
  'id', 'cooldown', 'damage', 'range', 'fire', 'allowedSlots', 'allowedModes',
  'adrenalinCost', 'adrenalinGain', 'spreadStanding', 'spreadMoving', 'spreadPerShot',
  'maxDynamicSpread', 'spreadRecoveryDelay', 'spreadRecoveryRate', 'spreadRecoverySpeed',
]);

const WEAPON_CAPABILITY_FIELDS = new Set(
  WEAPON_BALANCE_CAPABILITY_DEFINITIONS.flatMap((definition) => {
    switch (definition.feature) {
      case 'hitSlow': return ['hitSlowFraction', 'hitSlowDurationMs'];
      case 'shotgunSlow': return ['shotgunSlowFraction', 'shotgunSlowDurationMs'];
      case 'shotgunLightning': return ['shotgunLightningDamage', 'shotgunLightningRadius'];
      default: return [definition.feature];
    }
  }),
);

/** Known top-level WeaponConfig fields; unknown active fields fail closed. */
export const KNOWN_WEAPON_CONFIG_FIELDS = new Set<string>([
  ...WEAPON_STRUCTURAL_FIELDS,
  ...WEAPON_CAPABILITY_FIELDS,
  ...Array.from(LOADOUT_ALLOWED_KEYS_BY_PATH.weapon),
  'turretBurst', 'pelletCount', 'pelletSpreadAngle', 'pelletCountMultiplier',
  'splitSpread', 'splitFactor', 'splitHomingEnabled', 'killHeal', 'killAdrenaline',
  'bloodEffectMultiplier', 'sideBurstAngleDegrees', 'sideBurstDamageFactor',
  'penetrationDamageRetention', 'penetratesRocks', 'matchPrimaryRange',
  'projectileColor', 'projectileStyle', 'projectileVisualScale', 'bulletVisualPreset',
  'grenadeVisualPreset', 'energyBallVariant', 'projectileBurnVisualStyle',
  'rocketSmokeTrailColor', 'holdSpeedFactor', 'warmupSpeedMultiplier',
  'shotRecoilForce', 'shotRecoilDuration', 'shotScreenShake', 'tracerConfig',
  'showCrosshair', 'shotAudio', 'detonator', 'chainLightning', 'proximityPulse',
  'burnOnHit', 'awpCharge', 'negevKillstreak', 'ak47Focus', 'ak47ShotId',
  'ak47DamageMultiplier', 'ak47FireSuperiorityShot', 'scopeConfig', 'fire',
]);

function isMeaningful(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false && value !== 0;
}

export function findUnknownActiveWeaponFields(config: WeaponConfig): readonly string[] {
  return Object.keys(config)
    .filter((key) => !KNOWN_WEAPON_CONFIG_FIELDS.has(key))
    .filter((key) => isMeaningful((config as AnyRecord)[key]))
    .map((key) => `Unbekanntes / nicht klassifiziertes WeaponConfig-Feld "${key}"`);
}

export function classifyWeaponCapabilities(
  config: WeaponConfig,
  scenario: WeaponBalanceScenario,
): readonly WeaponCapabilityClassification[] {
  return WEAPON_BALANCE_CAPABILITY_DEFINITIONS
    .filter((definition) => definition.active(config))
    .map((definition) => ({
      feature: definition.feature,
      status: definition.status(config, scenario),
      rationale: definition.rationale(config, scenario),
    }));
}

// ── Shared Headless payload contract ─────────────────────────────────────────

function payloadDefinition(
  feature: string,
  fields: readonly string[],
  active: (payload: AnyRecord) => boolean,
  status: CapabilityStatus | ((payload: AnyRecord, scenario: WeaponBalanceScenario) => CapabilityStatus),
  rationale: string | ((payload: AnyRecord, scenario: WeaponBalanceScenario) => string),
): HeadlessPayloadCapabilityDefinition {
  return {
    feature,
    fields,
    active,
    status: typeof status === 'function' ? status : () => status,
    rationale: typeof rationale === 'function' ? rationale : () => rationale,
  };
}

export const HEADLESS_PAYLOAD_CAPABILITY_DEFINITIONS: readonly HeadlessPayloadCapabilityDefinition[] = [
  payloadDefinition('grenade', ['isGrenade', 'fuseTime', 'grenadeEffect'], (p) => enabled(p.isGrenade) || positive(p.fuseTime) || !!p.grenadeEffect, alwaysUnsupported, 'Granaten-Payload ist headless nicht implementiert'),
  payloadDefinition('flame', ['isFlame', 'supplementalBurnOnHit'], (p) => enabled(p.isFlame) || !!p.supplementalBurnOnHit, alwaysUnsupported, 'Flammen-/Supplemental-Brand-Payload ist headless nicht implementiert'),
  payloadDefinition('impactExplosion', ['explosion'], (p) => objectWithPositive(p.explosion, ['maxDamage', 'radius']), alwaysUnsupported, 'Explosions-Payload ist headless nicht implementiert'),
  payloadDefinition('enemyHitExplosion', ['enemyHitExplosion'], (p) => objectWithPositive(p.enemyHitExplosion, ['maxDamage', 'radius']), alwaysUnsupported, 'enemyHitExplosion-Payload ist headless nicht implementiert'),
  payloadDefinition('fireTrail', ['fireTrail'], (p) => !!p.fireTrail, alwaysUnsupported, 'fireTrail-Payload ist headless nicht implementiert'),
  payloadDefinition('flamePhysics', ['hitboxGrowRate', 'hitboxMaxSize', 'velocityDecay'], (p) => positive(p.hitboxGrowRate) || positive(p.hitboxMaxSize) || positive(p.velocityDecay), alwaysUnsupported, 'Flammen-Projektilphysik ist headless nicht implementiert'),
  payloadDefinition('homing', ['homing'], (p) => !!p.homing, alwaysUnsupported, 'Homing-Payload ist headless nicht implementiert'),
  payloadDefinition('piercing', ['piercesTargets', 'penetrationCount', 'flamePiercing', 'isBfg'], (p) => enabled(p.piercesTargets) || positive(p.penetrationCount) || enabled(p.flamePiercing) || enabled(p.isBfg), alwaysUnsupported, 'Piercing/BFG-Payload ist headless nicht implementiert'),
  payloadDefinition('split', ['splitCount', 'splitHoming', 'splitSpread', 'splitFactor'], (p) => positive(p.splitCount) || !!p.splitHoming || positive(p.splitSpread) || positive(p.splitFactor), alwaysUnsupported, 'Split-Payload ist headless nicht implementiert'),
  payloadDefinition('detonable', ['detonable'], (p) => !!p.detonable, alwaysUnsupported, 'Detonable-Payload ist headless nicht implementiert'),
  payloadDefinition('proximityPulse', ['proximityPulse'], (p) => objectWithPositive(p.proximityPulse, ['damage']), alwaysUnsupported, 'proximityPulse-Payload ist headless nicht implementiert'),
  payloadDefinition('plasmaSwarm', ['plasmaSwarmEnabled', 'plasmaSwarmProjectile'], (p) => enabled(p.plasmaSwarmEnabled) || !!p.plasmaSwarmProjectile, alwaysUnsupported, 'plasmaSwarm-Payload ist headless nicht implementiert'),
  payloadDefinition('injectorCloud', ['energyInjectorPayload', 'impactCloud'], (p) => !!p.energyInjectorPayload || !!p.impactCloud, alwaysUnsupported, 'Injector-/Cloud-Payload ist headless nicht implementiert'),
  payloadDefinition('shotgunProximity', ['shotgunProximityMaxDamageBonus'], (p) => positive(p.shotgunProximityMaxDamageBonus), alwaysUnsupported, 'shotgunProximity-Payload ist headless nicht implementiert'),
  payloadDefinition('multiExplosion', ['multiExplosionCount'], (p) => (p.multiExplosionCount ?? 0) > 1, alwaysUnsupported, 'multiExplosion-Payload ist headless nicht implementiert'),
  payloadDefinition('miniRocketReturn', ['miniRocketReturnEnabled'], (p) => enabled(p.miniRocketReturnEnabled), alwaysUnsupported, 'miniRocketReturn-Payload ist headless nicht implementiert'),
  payloadDefinition('miniRocketCascade', ['miniRocketCascadeDamageBonusPerExplosion'], (p) => positive(p.miniRocketCascadeDamageBonusPerExplosion), alwaysUnsupported, 'miniRocketCascade-Payload ist headless nicht implementiert'),
  payloadDefinition('awpCorridor', ['awpCorridorDamage'], (p) => positive(p.awpCorridorDamage), alwaysUnsupported, 'awpCorridor-Payload ist headless nicht implementiert'),
  payloadDefinition('ak47FireSuperiority', ['ak47FireSuperiorityShot'], (p) => enabled(p.ak47FireSuperiorityShot), alwaysUnsupported, 'ak47FireSuperiority-Payload ist headless nicht implementiert'),
  payloadDefinition('leafBlower', ['leafBlowerMinKnockback', 'leafBlowerMaxKnockback', 'leafBlowerSelfPush', 'leafBlowerDeflectsProjectiles'], (p) => positive(p.leafBlowerMinKnockback) || positive(p.leafBlowerMaxKnockback) || positive(p.leafBlowerSelfPush) || enabled(p.leafBlowerDeflectsProjectiles), alwaysUnsupported, 'Leaf-Blower-Payload ist headless nicht implementiert'),
  payloadDefinition(
    'chainLightning',
    ['chainLightning'],
    (p) => positive(p.chainLightning?.maxJumps),
    (_p, scenario) => scenario === 'single_target_static' ? 'scenario_irrelevant' : scenario === 'five_target' ? 'supported' : 'unsupported_relevant',
    (_p, scenario) => scenario === 'single_target_static'
      ? 'Kein zweites Ziel fuer Kettenblitz-Spruenge vorhanden'
      : scenario === 'five_target'
        ? 'HitscanShotRequest.chainLightning wird im statischen Five-Target-World-Kern ueber denselben Resolver ausgefuehrt'
        : 'chainLightning ist fuer Multi-Target noch nicht implementiert',
  ),
  payloadDefinition('supportEffect', ['supportEffect'], (p) => !!p.supportEffect, alwaysUnsupported, 'supportEffect-Payload ist headless nicht implementiert'),
];

const PROJECTILE_STRUCTURAL_FIELDS = new Set([
  'speed', 'size', 'damage', 'lifetime', 'maxBounces', 'adrenalinGain', 'sourceId',
  'allowTeamDamage', 'ignoreBaseCollisions', 'ignoreRockIndex', 'burnDurationMs', 'burnDamagePerTick',
]);
const PROJECTILE_CONTEXT_FIELDS = new Set([
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
]);
const HITSCAN_FIELDS = new Set([
  'shooterId', 'startX', 'startY', 'angle', 'range', 'damage', 'traceThickness',
  'adrenalinGain', 'sourceId', 'burnOnHit', 'color', 'visualPreset', 'shotAudioKey',
  'visualMuzzleOrigin', 'sourceSlot', 'shotId', 'rockDamageMult', 'trainDamageMult',
  'baseDamageMult', 'detonator', 'chainLightning', 'supportEffect',
]);
const MELEE_FIELDS = new Set([
  'shooterId', 'x', 'y', 'angle', 'range', 'arcDegrees', 'damage', 'adrenalinGain',
  'hitAdrenaline', 'sourceId', 'burnOnHit', 'color', 'visualPreset', 'shotAudioKey',
  'bloodEffectMultiplier', 'sourceSlot', 'damageTargets', 'rockDamageMult', 'trainDamageMult',
  'baseDamageMult', 'hitHeal',
]);

export const HEADLESS_PAYLOAD_KNOWN_FIELDS = Object.freeze({
  projectile: new Set([
    ...PROJECTILE_STRUCTURAL_FIELDS,
    ...PROJECTILE_CONTEXT_FIELDS,
    ...HEADLESS_PAYLOAD_CAPABILITY_DEFINITIONS.flatMap((definition) => definition.fields),
  ]),
  hitscan: new Set([...HITSCAN_FIELDS]),
  melee: new Set([...MELEE_FIELDS]),
});

export function classifyHeadlessPayload(
  payload: ProjectileSpawnConfig | HitscanShotRequest | MeleeSwingRequest,
  kind: 'projectile' | 'hitscan' | 'melee',
  scenario: WeaponBalanceScenario,
): readonly WeaponCapabilityClassification[] {
  const record = payload as unknown as AnyRecord;
  return HEADLESS_PAYLOAD_CAPABILITY_DEFINITIONS
    .filter((definition) => definition.active(record) && definition.fields.some((field) => field in record))
    .map((definition) => ({
      feature: definition.feature,
      status: definition.status(record, scenario),
      rationale: definition.rationale(record, scenario),
    }));
}

export function findUnknownActivePayloadFields(
  payload: Record<string, unknown>,
  kind: 'projectile' | 'hitscan' | 'melee',
): readonly string[] {
  const known = HEADLESS_PAYLOAD_KNOWN_FIELDS[kind];
  return Object.keys(payload)
    .filter((key) => !known.has(key))
    .filter((key) => isMeaningful(payload[key]))
    .map((key) => `Unbekanntes / nicht klassifiziertes ${kind}-Feld "${key}" am Headless-Sink`);
}
