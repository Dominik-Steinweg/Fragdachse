import { isWeaponFeedbackProfileId } from '../../config/weaponFeedback';
import * as v from 'valibot';
import { validateFlightSignature } from '../../projectile/FlightSignature';
import type { GameMode } from '../../types';
import type {
  UltimateConfigShape,
  UtilityConfigShape,
  WeaponConfigShape,
} from '../LoadoutTypes';

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

const recordOfUnknown = v.record(v.string(), v.unknown());

export const CatalogEntrySchema = v.strictObject({
  kind: v.picklist(['weapon', 'utility', 'ultimate']),
  id: v.pipe(v.string(), v.minLength(1)),
  slot: v.picklist(['weapon1', 'weapon2', 'utility', 'ultimate']),
  order: v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0)),
  iconKey: v.nullable(v.pipe(v.string(), v.minLength(1))),
});

export const DefaultLoadoutIdsSchema = v.strictObject({
  weapon1: v.pipe(v.string(), v.minLength(1)),
  weapon2: v.pipe(v.string(), v.minLength(1)),
  utility: v.pipe(v.string(), v.minLength(1)),
  ultimate: v.pipe(v.string(), v.minLength(1)),
});

export const LoadoutContentFileSchema = v.strictObject({
  weapons: v.optional(recordOfUnknown),
  utilities: v.optional(recordOfUnknown),
  ultimates: v.optional(recordOfUnknown),
  catalog: v.optional(v.array(CatalogEntrySchema)),
  defaultLoadout: v.optional(DefaultLoadoutIdsSchema),
});

export type LoadoutContentFile = v.InferOutput<typeof LoadoutContentFileSchema>;
export type LoadoutCatalogEntry = DeepReadonly<v.InferOutput<typeof CatalogEntrySchema>>;
export type DefaultLoadoutIds = DeepReadonly<v.InferOutput<typeof DefaultLoadoutIdsSchema>>;

const GAME_MODES = new Set<GameMode>(['deathmatch', 'team_deathmatch', 'capture_the_beer', 'coop_defense']);
const COLOR_KEYS = new Set([
  'beamColor', 'bubbleColor', 'chargeColor', 'color', 'colorCore', 'colorGlow',
  'explosionColor', 'fieldColor', 'injectorColor', 'projectileColor', 'rocketSmokeTrailColor', 'colorOverride',
]);
const ORDERED_NUMBER_PAIRS: readonly (readonly [string, string])[] = [
  ['minDamage', 'maxDamage'],
  ['explosionMinDamage', 'explosionMaxDamage'],
  ['minKnockback', 'maxKnockback'],
  ['visualBoltThicknessMin', 'visualBoltThicknessMax'],
  ['travelMinDurationMs', 'travelMaxDurationMs'],
];

const FIRE_REQUIRED: Readonly<Record<string, readonly string[]>> = {
  projectile: ['projectileSpeed', 'projectileSize', 'projectileMaxBounces'],
  hitscan: ['traceThickness'],
  melee: ['hitArcDegrees'],
  flamethrower: [
    'projectileSpeed', 'hitboxStartSize', 'hitboxEndSize', 'hitboxGrowRate', 'velocityDecay',
    'burnDurationMs', 'burnDamagePerTick',
  ],
  leaf_blower: [
    'projectileSpeed', 'hitboxStartSize', 'hitboxEndSize', 'hitboxGrowRate', 'velocityDecay',
    'minKnockback', 'maxKnockback', 'selfPush', 'deflectProjectiles',
  ],
  tesla_dome: [
    'radius', 'damagePerTick', 'tickInterval', 'adrenalineDrainPerSecond', 'movementSlowFactor',
    'requireLineOfSight', 'targetTypes', 'visualIndicatorAlpha', 'visualFieldAlpha',
    'visualIdleArcCount', 'visualIdleArcLength', 'visualBoltThicknessMin',
    'visualBoltThicknessMax', 'visualJitter', 'visualBranchChance',
    'visualCoreParticleFrequency', 'visualFieldParticleFrequency', 'visualRimParticleFrequency',
    'visualImpactBurstScale', 'visualWhiteness', 'visualPulseSpeed',
  ],
  healing_aura: ['radius', 'healPerTick', 'tickInterval'],
  energy_shield: [
    'blockArcDegrees', 'anchorDistance', 'visualRadius', 'visualThickness',
    'adrenalineDrainPerSecond', 'movementSlowFactor', 'flashDurationMs', 'flashMaxAlpha',
    'buffMax', 'buffGainFactor', 'buffDecayDelayMs', 'buffDecayPerSecond', 'buffMaxBonus',
    'blockableCategories', 'visualInnerAlpha', 'visualOuterAlpha', 'domeEnabled', 'domeRadius',
    'domeHealPerSecond', 'domeToggleEnabled', 'domeReflectProjectiles',
  ],
  reinforcement_matrix: [
    'projectileSpeed', 'projectileSize', 'radius', 'durationMs', 'damageReduction',
    'vulnerabilityBonus', 'fieldColor',
  ],
  energy_injector: ['projectileSpeed', 'projectileSize', 'durationMs', 'vulnerabilityBonus', 'focusDurationMs', 'injectorColor'],
};

const UTILITY_REQUIRED: Readonly<Record<string, readonly string[]>> = {
  explosive: ['aoeRadius', 'aoeDamage'],
  smoke: [
    'smokeRadius', 'smokeExpandDuration', 'smokeLingerDuration', 'smokeDissipateDuration',
    'smokeMaxAlpha', 'smokeDotDamagePerTick', 'smokeDotTickIntervalMs', 'smokeBehavior',
  ],
  molotov: ['fireRadius', 'fireDamagePerTick', 'fireLingerDuration', 'wildfireChunkCount', 'wildfireChunkRadius', 'wildfireChunkFlightMs', 'firewalkerDurationMs'],
  time_bubble: ['bubbleRadius', 'bubbleDuration', 'projectileSlowFactor', 'playerSlowFactor', 'trainSlowFactor'],
  bfg: ['range', 'directDamage', 'proximityPulse'],
  nuke: [],
  stinkcloud: ['cloudRadius', 'cloudDuration', 'cloudDamagePerTick', 'cloudTickInterval'],
  taser: ['damage', 'range', 'hitArcDegrees', 'visualPreset'],
  decoy: [
    'refundRadius', 'refundPerEnemyMs', 'lureRadius', 'stealthMoveSpeedBonus',
    'stealthHpRegenPerSecond', 'stealthAdrenalineRegenBonus', 'fireTrailDurationMs', 'fireChunkBurst',
    'decoyLifetimeMs', 'stealthDurationMs', 'stealthAlphaMin', 'stealthAlphaMax',
    'stealthGlowOuterStrength', 'wobblePeriodMs', 'dissipateDustBurst',
  ],
  translocator: [],
  placeable_rock: ['placeable'],
  placeable_turret: ['placeable', 'weaponId'],
  placeable_pedestal: ['placeable', 'rewardObjectiveId', 'powerUpDefId'],
};

const ULTIMATE_REQUIRED: Readonly<Record<string, readonly string[]>> = {
  buff: ['duration', 'speedMultiplier', 'damageMultiplier', 'armorPerTick', 'armorTickIntervalMs', 'rageDrainDuration'],
  gauss: [
    'rageCost', 'chargeDuration', 'chargeColor', 'movementSlowFactor', 'projectileSpeed',
    'projectileSize', 'projectileColor', 'bulletVisualPreset', 'tracerConfig', 'damage', 'range',
    'rockDamageMult', 'shotRecoilForce', 'shotRecoilDuration',
  ],
  airstrike: [
    'rageCost', 'delayMs', 'radius', 'maxDamage', 'minDamage', 'allowTeamDamage',
    'selfDamageMult', 'rockDamageMult', 'trainDamageMult',
  ],
  tunnel: [
    'activation', 'rageCost', 'placement', 'travelSpeed', 'travelMinDurationMs',
    'travelMaxDurationMs', 'buildLabel',
  ],
};

const ACTIVATION_REQUIRED: Readonly<Record<string, readonly string[]>> = {
  instant: [],
  charged_throw: ['minThrowSpeed', 'fullChargeDuration'],
  charged_gate: ['fullChargeDuration'],
  targeted_click: [],
  placement_mode: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireFields(record: Record<string, unknown>, fields: readonly string[], issues: string[], prefix: string): void {
  for (const field of fields) {
    if (!(field in record)) issues.push(`${prefix}.${field}: Pflichtfeld fehlt`);
  }
}

function validateFiniteNumbers(value: unknown, path: string, issues: string[]): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    issues.push(`${path}: Zahl muss endlich sein`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateFiniteNumbers(entry, `${path}[${index}]`, issues));
  } else if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) validateFiniteNumbers(entry, `${path}.${key}`, issues);
  }
}

function validateNumericContracts(value: unknown, path: string, issues: string[], configId: string): void {
  if (typeof value === 'number') {
    const pathSegments = path.split('.');
    const key = pathSegments[pathSegments.length - 1] ?? '';
    const negativeNegevSpread = configId === 'NEGEV'
      && (path === '$.spreadPerShot' || path === '$.maxDynamicSpread');
    if (value < 0 && !negativeNegevSpread) issues.push(`${path}: negative Zahl ist für dieses Feld nicht erlaubt`);
    if (COLOR_KEYS.has(key) && (!Number.isInteger(value) || value < 0 || value > 0xffffff)) {
      issues.push(`${path}: Farbe muss eine Ganzzahl zwischen 0x000000 und 0xffffff sein`);
    }
    if (/(?:Alpha|Chance|Probability|Fraction)$/.test(key) && (value < 0 || value > 1)) {
      issues.push(`${path}: Wert muss zwischen 0 und 1 liegen`);
    }
    if (/(?:Count|maxJumps|maxBounces|piercingCount|enabled|Enabled)$/.test(key) && !Number.isInteger(value)) {
      issues.push(`${path}: Ganzzahl erforderlich`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateNumericContracts(entry, `${path}[${index}]`, issues, configId));
    return;
  }
  if (!isRecord(value)) return;
  for (const [minimumKey, maximumKey] of ORDERED_NUMBER_PAIRS) {
    const minimum = value[minimumKey];
    const maximum = value[maximumKey];
    // A zero maximum disables several legacy optional damage payloads while their
    // minimum remains documented for a future re-enable. Active ranges stay ordered.
    if (typeof minimum === 'number' && typeof maximum === 'number' && maximum > 0 && minimum > maximum) {
      issues.push(`${path}.${minimumKey}: darf ${maximumKey} nicht überschreiten`);
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    validateNumericContracts(entry, `${path}.${key}`, issues, configId);
  }
}

function validateCommonConfig(record: Record<string, unknown>, issues: string[]): void {
  if (record.tracerConfig !== undefined && !validateFlightSignature(record.tracerConfig)) {
    issues.push('tracerConfig: Ungueltiges Flight-Signature-Profil oder Tuning');
  }
  if (typeof record.id !== 'string' || record.id.length === 0) issues.push('id: nichtleere ID erforderlich');
  validateFiniteNumbers(record, '$', issues);
  validateNumericContracts(record, '$', issues, typeof record.id === 'string' ? record.id : '');
}

export function validateResolvedWeapon(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ['$: WeaponConfig muss ein Objekt sein'];
  validateCommonConfig(value, issues);
  requireFields(value, [
    'cooldown', 'damage', 'range', 'fire', 'allowedSlots', 'adrenalinCost', 'adrenalinGain',
    'spreadStanding', 'spreadMoving', 'spreadPerShot', 'maxDynamicSpread',
    'spreadRecoveryDelay', 'spreadRecoveryRate', 'spreadRecoverySpeed',
  ], issues, '$');
  if (!Array.isArray(value.allowedSlots) || value.allowedSlots.some((slot) => slot !== 'weapon1' && slot !== 'weapon2')) {
    issues.push('$.allowedSlots: ungültiger Slot');
  }
  if (value.allowedModes !== undefined && (
    !Array.isArray(value.allowedModes) || value.allowedModes.some((mode) => !GAME_MODES.has(mode as GameMode))
  )) {
    issues.push('$.allowedModes: ungültiger Spielmodus');
  }
  if (!isRecord(value.fire) || typeof value.fire.type !== 'string' || !(value.fire.type in FIRE_REQUIRED)) {
    issues.push('$.fire.type: unbekannter Weapon-Fire-Typ');
  } else {
    requireFields(value.fire, FIRE_REQUIRED[value.fire.type], issues, '$.fire');
  }
  if (value.shotFeedbackProfile !== undefined && !isWeaponFeedbackProfileId(value.shotFeedbackProfile)) {
    issues.push('$.shotFeedbackProfile: unbekanntes Schuss-Feedback-Profil');
  }
  if (value.proximityPulse !== undefined) {
    if (!isRecord(value.proximityPulse)) {
      issues.push('$.proximityPulse: Objekt erforderlich');
    } else {
      requireFields(value.proximityPulse, ['radius', 'damage', 'scanIntervalMs'], issues, '$.proximityPulse');
    }
  }
  for (const field of ['cooldown', 'damage', 'range', 'adrenalinCost', 'adrenalinGain']) {
    if (typeof value[field] !== 'number' || value[field] < 0) issues.push(`$.${field}: endliche nichtnegative Zahl erforderlich`);
  }
  return issues;
}

export function validateResolvedUtility(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ['$: UtilityConfig muss ein Objekt sein'];
  validateCommonConfig(value, issues);
  if (value.type === 'time_bubble' && value.prismEmitter !== undefined) {
    const e = value.prismEmitter;
    const positive = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n > 0;
    const nonnegative = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n >= 0;
    if (!isRecord(e) || !isRecord(e.homing)) {
      issues.push('$.prismEmitter: complete emitter and homing config required');
    } else {
      if (e.enabled !== 0 && e.enabled !== 1) issues.push('$.prismEmitter.enabled: expected zero or one');
      for (const key of ['intervalMs', 'rotationPeriodMs', 'speed', 'size', 'rangePx', 'slowDurationMs']) {
        if (!positive(e[key])) issues.push('$.prismEmitter.' + key + ': positive finite number required');
      }
      if (!nonnegative(e.damage) || !nonnegative(e.slowFraction) || (e.slowFraction as number) > 0.95)
        issues.push('$.prismEmitter: invalid damage or slow fraction');
      for (const key of ['acquireDelayMs', 'maxTurnDegreesPerStep', 'distanceWeight', 'forwardWeight']) {
        if (!nonnegative(e.homing[key])) issues.push('$.prismEmitter.homing.' + key + ': nonnegative finite number required');
      }
      if (!positive(e.homing.searchRadius) || !positive(e.homing.retargetIntervalMs)
        || !Array.isArray(e.homing.targetTypes) || e.homing.targetTypes.length !== 1 || e.homing.targetTypes[0] !== 'enemies'
        || e.homing.requireLineOfSight !== true || e.homing.excludeOwner !== true)
        issues.push('$.prismEmitter.homing: enemy targeting with line of sight and positive search timing required');
    }
  }
  if (value.type === 'molotov') {
    for (const key of ['wildfireChunkCount', 'wildfireChunkRadius', 'wildfireChunkFlightMs', 'firewalkerDurationMs']) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || (value[key] as number) < 0)
        issues.push('$.molotov.' + key + ': nonnegative finite number required');
    }
    if (!Number.isSafeInteger(value.wildfireChunkCount))
      issues.push('$.wildfireChunkCount: integer count required');
  }
  if (value.type === 'decoy') {
    for (const key of ['refundRadius', 'refundPerEnemyMs', 'lureRadius', 'stealthMoveSpeedBonus',
      'stealthHpRegenPerSecond', 'stealthAdrenalineRegenBonus', 'fireTrailDurationMs']) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || (value[key] as number) < 0)
        issues.push('$.decoy.' + key + ': nonnegative finite number required');
    }
    const fire = value.fireChunkBurst;
    if (!isRecord(fire)) issues.push('$.fireChunkBurst: complete fire profile required');
    else {
      for (const key of ['count', 'searchRadius', 'flightMs', 'durationMs', 'burnDurationMs', 'burnDamagePerTick']) {
        if (typeof fire[key] !== 'number' || !Number.isFinite(fire[key]) || (fire[key] as number) < 0)
          issues.push('$.fireChunkBurst.' + key + ': nonnegative finite number required');
      }
      if (!Number.isSafeInteger(fire.count) || typeof fire.igniteCenter !== 'boolean'
        || typeof fire.sourceId !== 'string' || fire.sourceId.length === 0)
        issues.push('$.fireChunkBurst: integer count, center flag and source identity required');
    }
    if (value.explosionMinDamage !== undefined && typeof value.explosionDamage === 'number' && (value.explosionMinDamage as number) > value.explosionDamage)
      issues.push('$.explosionMinDamage: cannot exceed center damage');
  }
  if (value.type === 'smoke') {
    const b = value.smokeBehavior;
    const fields = ["confusionFraction","aftereffectMs","directionMinMs","directionMaxMs","recoveryFadeMs","retentionBias","retentionEdgeFraction","nearSightPx","bossNearSightPx","bossConfusionFactor","bossAftereffectFactor","vulnerabilityEnabled","chargeDurationMs","dischargeCount","dischargeCooldownMs","dischargeDamage","dischargeSpeed","dischargeRange","dischargeSize","growthMaxProcs","growthDurationMs","growthRadiusFraction","growthTransitionMs"];
    if (!isRecord(b) || fields.some(k => typeof b[k] !== 'number' || !Number.isFinite(b[k]) || (b[k] as number) < 0)
      || !isRecord(b.dischargeHoming)) issues.push('$.smokeBehavior: complete nonnegative finite tuning required');
    else {
      for (const k of ['confusionFraction', 'retentionBias', 'retentionEdgeFraction', 'bossConfusionFactor', 'bossAftereffectFactor']) {
        if ((b[k] as number) > 1) issues.push('$.smokeBehavior.' + k + ': expected fraction');
      }
      for (const k of ['dischargeCount', 'growthMaxProcs', 'vulnerabilityEnabled']) {
        if (!Number.isSafeInteger(b[k])) issues.push('$.smokeBehavior.' + k + ': expected integer');
      }
      if ((b.directionMaxMs as number) < (b.directionMinMs as number) || (b.dischargeSpeed as number) <= 0) issues.push('$.smokeBehavior: invalid timing or speed');
      for (const k of ['searchRadius', 'maxTurnDegreesPerStep', 'retargetIntervalMs', 'acquireDelayMs', 'distanceWeight', 'forwardWeight']) {
        const n = b.dischargeHoming[k];
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) issues.push('$.smokeBehavior.dischargeHoming.' + k + ': invalid value');
      }
    }
  }
  if (value.charges !== undefined) {
    const c = value.charges;
    if (!isRecord(c) || !Number.isSafeInteger(c.maxCharges) || (c.maxCharges as number) < 1
      || typeof c.burstLockoutMs !== 'number' || !Number.isFinite(c.burstLockoutMs) || c.burstLockoutMs < 0) {
      issues.push('$.charges: positive integer capacity and nonnegative lockout required');
    }
  }
  if (value.impactFuseEnabled !== undefined
    && (!Number.isInteger(value.impactFuseEnabled) || (value.impactFuseEnabled !== 0 && value.impactFuseEnabled !== 1))) {
    issues.push('$.impactFuseEnabled: expected zero or one');
  }
  if (value.fragmentation !== undefined) {
    const f = value.fragmentation;
    const range = (v: unknown): boolean => Array.isArray(v) && v.length === 2
      && v.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) && v[1] >= v[0];
    const positive = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n > 0;
    if (!isRecord(f) || !isRecord(f.demolition)) {
      issues.push('$.fragmentation: flight and demolition config required');
    } else {
      const d = f.demolition;
      if (![f.shortDistance, f.longDistance, f.fuseMs, d.distance, d.fuseMs].every(range)
        || ![f.projectileSize, d.projectileSize, d.radiusFactor].every(positive)
        || ![f.stationaryHalfAngleDeg, f.movingHalfAngleDeg].every(positive)
        || typeof f.shortFraction !== 'number' || !Number.isFinite(f.shortFraction) || f.shortFraction < 0 || f.shortFraction > 1
        || typeof f.speedDistanceBias !== 'number' || !Number.isFinite(f.speedDistanceBias) || f.speedDistanceBias < 0 || f.speedDistanceBias > 1
        || !Number.isSafeInteger(d.count) || (d.count as number) < 1
        || !Array.isArray(d.damageFactors) || d.damageFactors.length === 0 || !d.damageFactors.every(positive)) {
        issues.push('$.fragmentation: invalid fragment tuning');
      }
      const level = value.demolitionLevel ?? 0;
      if (!Number.isSafeInteger(level) || (level as number) < 0
        || (Array.isArray(d.damageFactors) && (level as number) > d.damageFactors.length)) issues.push('$.demolitionLevel: invalid level');
    }
  }
  requireFields(value, [
    'type', 'cooldown', 'activation', 'projectileSpeed', 'projectileSize', 'fuseTime',
    'maxBounces', 'allowedSlots',
  ], issues, '$');
  if (typeof value.type !== 'string' || !(value.type in UTILITY_REQUIRED)) {
    issues.push('$.type: unbekannter Utility-Typ');
  } else {
    requireFields(value, UTILITY_REQUIRED[value.type], issues, '$');
  }
  if (!isRecord(value.activation) || typeof value.activation.type !== 'string' || !(value.activation.type in ACTIVATION_REQUIRED)) {
    issues.push('$.activation.type: unbekannter Activation-Typ');
  } else {
    requireFields(value.activation, ACTIVATION_REQUIRED[value.activation.type], issues, '$.activation');
  }
  if (!Array.isArray(value.allowedSlots) || value.allowedSlots.some((slot) => slot !== 'utility')) {
    issues.push('$.allowedSlots: ungültiger Slot');
  }
  if (value.type === 'placeable_rock' && isRecord(value.placeable) && value.placeable.kind !== 'rock') {
    issues.push('$.placeable.kind: placeable_rock verlangt kind=rock');
  }
  if (value.type === 'placeable_turret' && isRecord(value.placeable) && value.placeable.kind !== 'turret') {
    issues.push('$.placeable.kind: placeable_turret verlangt kind=turret');
  }
  if (value.type === 'placeable_pedestal' && isRecord(value.placeable) && value.placeable.kind !== 'pedestal') {
    issues.push('$.placeable.kind: placeable_pedestal verlangt kind=pedestal');
  }
  if (value.proximityPulse !== undefined) {
    if (!isRecord(value.proximityPulse)) {
      issues.push('$.proximityPulse: Objekt erforderlich');
    } else {
      requireFields(value.proximityPulse, ['radius', 'damage', 'scanIntervalMs'], issues, '$.proximityPulse');
    }
  }
  if (value.visualVariant !== undefined && !['stink', 'spore', 'spore_void', 'electric'].includes(String(value.visualVariant))) {
    issues.push('$.visualVariant: unbekannte Stinkwolken-Variante');
  }
  const numericFields = ['cooldown', 'projectileSpeed', 'projectileSize', 'fuseTime', 'maxBounces'];
  if (value.type === 'bfg') numericFields.push('range');
  for (const field of numericFields) {
    if (typeof value[field] !== 'number' || value[field] < 0) issues.push(`$.${field}: endliche nichtnegative Zahl erforderlich`);
  }
  return issues;
}

export function validateResolvedUltimate(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ['$: UltimateConfig muss ein Objekt sein'];
  validateCommonConfig(value, issues);
  requireFields(value, ['type', 'cooldown', 'rageRequired'], issues, '$');
  if (typeof value.type !== 'string' || !(value.type in ULTIMATE_REQUIRED)) {
    issues.push('$.type: unbekannter Ultimate-Typ');
  } else {
    requireFields(value, ULTIMATE_REQUIRED[value.type], issues, '$');
  }
  if (value.allowedModes !== undefined && (
    !Array.isArray(value.allowedModes) || value.allowedModes.some((mode) => !GAME_MODES.has(mode as GameMode))
  )) {
    issues.push('$.allowedModes: ungültiger Spielmodus');
  }
  if (value.type === 'tunnel' && isRecord(value.activation) && value.activation.type !== 'placement_mode') {
    issues.push('$.activation.type: Tunnel verlangt placement_mode');
  }
  if (value.type === 'tunnel' && isRecord(value.placement) && value.placement.kind !== 'tunnel') {
    issues.push('$.placement.kind: Tunnel verlangt kind=tunnel');
  }
  for (const field of ['cooldown', 'rageRequired']) {
    if (typeof value[field] !== 'number' || value[field] < 0) issues.push(`$.${field}: endliche nichtnegative Zahl erforderlich`);
  }
  return issues;
}

export const WeaponConfigSchema = v.custom<WeaponConfigShape>(
  (value): value is WeaponConfigShape => validateResolvedWeapon(value).length === 0,
  'Ungültige WeaponConfig',
);
export const UtilityConfigSchema = v.custom<UtilityConfigShape>(
  (value): value is UtilityConfigShape => validateResolvedUtility(value).length === 0,
  'Ungültige UtilityConfig',
);
export const UltimateConfigSchema = v.custom<UltimateConfigShape>(
  (value): value is UltimateConfigShape => validateResolvedUltimate(value).length === 0,
  'Ungültige UltimateConfig',
);

export type WeaponConfig = DeepReadonly<v.InferOutput<typeof WeaponConfigSchema>>;
export type UtilityConfig = DeepReadonly<v.InferOutput<typeof UtilityConfigSchema>>;
export type UltimateConfig = DeepReadonly<v.InferOutput<typeof UltimateConfigSchema>>;
