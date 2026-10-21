import rawKinds from './reactivePropKinds.json';
import type { ProjectileExplosionConfig } from '../../types';

/**
 * Authored Kinds reaktiver Map-Objekte. Zwei Familien teilen Hindernisraum, Platzierung und
 * Drahtformat: explosive Kinds (Fass) brennen herunter und verschwinden; Lade-Kinds
 * (Riesenbovist, Strohkorb) lösen bei jedem Treffer aus, laden wieder auf und bleiben stehen.
 */
export type ReactivePropObstacleClass = 'high' | 'veryHigh';

/** Darstellungsfamilie; legt Clips und Effekte des Renderers fest, nicht das Gameplay. */
export type ReactivePropPresentation = 'barrel' | 'puffball' | 'hive';

export interface ReactivePropBurnPriming {
  readonly kind: 'burn';
  readonly selfDamagePerSecond: number;
}
export type ReactivePropPriming = ReactivePropBurnPriming | { readonly kind: 'none' };

export interface ReactivePropExplosionEffect {
  readonly kind: 'explosion';
  readonly sourceId: string;
  /** Zeit zwischen „HP erschöpft“ und Explosion; Ketten addieren einen Host-Jitter. */
  readonly fuseMs: number;
  readonly chainFuseJitterMs: readonly [number, number];
  readonly explosion: ProjectileExplosionConfig;
}

/** Sporenwolke des Auslösers: Schaden über Zeit und Verlangsamung für dessen Gegner. */
export interface ReactivePropDotZoneEffect {
  readonly kind: 'dot_zone';
  readonly sourceId: string;
  /** Vorlauf zwischen Treffer und Wirkung; spätere Treffer übernehmen den Besitz. */
  readonly anticipationMs: number;
  readonly radius: number;
  readonly durationMs: number;
  readonly damagePerTick: number;
  readonly tickIntervalMs: number;
  readonly slowFraction: number;
  /** Mindestens ein Tick, damit der Slow in der Wolke lückenlos anliegt. */
  readonly slowDurationMs: number;
}

/** Bienenschwarm des Auslösers: jagt nacheinander dessen nächste Gegner und kehrt zurück. */
export interface ReactivePropSwarmEffect {
  readonly kind: 'swarm';
  readonly sourceId: string;
  readonly anticipationMs: number;
  /** Jagddauer ab dem Ausschwärmen. */
  readonly durationMs: number;
  readonly speedPxPerSec: number;
  readonly acquireRadiusPx: number;
  /** Maximaler Abstand des Schwarms vom Korb. */
  readonly leashRadiusPx: number;
  readonly swarmRadiusPx: number;
  readonly stingReachPx: number;
  readonly stingDamage: number;
  readonly stingIntervalMs: number;
  readonly stingsPerTarget: number;
  readonly maxTargetMs: number;
  /** Ohne gültiges Ziel kehrt der Schwarm nach dieser Zeit vorzeitig heim. */
  readonly idleGraceMs: number;
  /** Zerstreut (Feuer, Explosion): so lange ohne Stiche, dann Rückflug. */
  readonly dispersalMs: number;
  readonly maxReturnMs: number;
}

export type ReactivePropFollowUpEffect = ReactivePropDotZoneEffect | ReactivePropSwarmEffect;
export type ReactivePropEffectConfig = ReactivePropExplosionEffect | ReactivePropFollowUpEffect;
export type ReactivePropAfterEffect = { readonly kind: 'destroyed' } | { readonly kind: 'recharge'; readonly rechargeMs: number };

export interface ReactivePropGlow {
  readonly color: number;
  readonly radiusPx: number;
  readonly intensity: number;
}
export interface ReactivePropVariantVisual {
  readonly textureKey: string;
  readonly glow: ReactivePropGlow | null;
}

export interface ReactivePropVisualConfig {
  readonly presentation: ReactivePropPresentation;
  readonly variants: Readonly<Record<string, ReactivePropVariantVisual>>;
  readonly variantIds: readonly string[];
  readonly defaultVariant: string;
  readonly displaySizePx: number;
}

interface ReactivePropKindBase {
  readonly id: string;
  readonly obstacleClass: ReactivePropObstacleClass;
  /** Faktor auf den vollen Treffer, unabhängig vom `rockDamageMult` der Waffe. */
  readonly damage: { readonly factor: number };
  readonly visual: ReactivePropVisualConfig;
}

/** Fass: jeder Treffer zündet, der Brand frisst die HP, danach eine einmalige Explosion. */
export interface ExplosiveReactivePropKind extends ReactivePropKindBase {
  readonly integrity: { readonly mode: 'destructible'; readonly maxHp: number };
  readonly priming: ReactivePropBurnPriming;
  readonly trigger: { readonly on: 'depleted' };
  readonly effect: ReactivePropExplosionEffect;
  readonly afterEffect: { readonly kind: 'destroyed' };
}

/** Lade-Kind: jeder Treffer ab `minDamage` löst nach dem Vorlauf aus, danach Aufladen; nie entfernt. */
export interface RechargingReactivePropKind extends ReactivePropKindBase {
  readonly integrity: { readonly mode: 'indestructible' };
  readonly priming: { readonly kind: 'none' };
  readonly trigger: { readonly on: 'hit'; readonly minDamage: number };
  readonly effect: ReactivePropFollowUpEffect;
  readonly afterEffect: { readonly kind: 'recharge'; readonly rechargeMs: number };
}

export type ReactivePropKindConfig = ExplosiveReactivePropKind | RechargingReactivePropKind;

export function isExplosiveReactivePropKind(kind: ReactivePropKindConfig): kind is ExplosiveReactivePropKind {
  return kind.effect.kind === 'explosion';
}

/** Vorlauf plus Wirkdauer plus längster Rückweg; die Ladezeit muss mindestens so lang sein. */
export function reactivePropEffectLifetimeMs(effect: ReactivePropFollowUpEffect): number {
  return effect.kind === 'dot_zone'
    ? effect.anticipationMs + effect.durationMs
    : effect.anticipationMs + effect.durationMs + effect.dispersalMs + effect.maxReturnMs;
}

/** `open`: freier Boden; `chokepoints`: neben Engstellen auf den Gegnerrouten (strategisch). */
export type ReactivePropScatterPlacement = 'open' | 'chokepoints';

export interface ReactivePropScatterSpec {
  readonly kind: string;
  readonly placement?: ReactivePropScatterPlacement;
  readonly clusters: number;
  /** [min, max] Fässer je Gruppe; der Validator verlangt genau zwei Werte. */
  readonly clusterSize: readonly number[];
  readonly minSpacingCells: number;
  readonly variant?: string;
}

export type ReactivePropArenaMode = 'deathmatch' | 'team_deathmatch' | 'capture_the_beer';

const fail = (field: string): never => { throw new Error(`[reactiveProps] Invalid ${field}`); };
const record = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(field);
  return value as Record<string, unknown>;
};
const number = (value: unknown, field: string, min: number, max = Infinity): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail(field);
  return value;
};
const integer = (value: unknown, field: string, min: number, max = Infinity): number => {
  const result = number(value, field, min, max);
  return Number.isInteger(result) ? result : fail(field);
};
const string = (value: unknown, field: string): string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]*$/.test(value) ? value : fail(field);
const known = (value: Record<string, unknown>, field: string, keys: readonly string[]): void => {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${field}.${key}`);
};
const color = (value: unknown, field: string): number =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? Number.parseInt(value.slice(1), 16) : fail(field);
const range = (value: unknown, field: string, integers: boolean): readonly [number, number] => {
  if (!Array.isArray(value) || value.length !== 2) return fail(field);
  const read = integers ? integer : number;
  const min = read(value[0], `${field}[0]`, 0);
  const max = read(value[1], `${field}[1]`, min);
  return Object.freeze([min, max] as const);
};

/** Explosionen dieser Kinds verwenden nur Felder, die Fässer heute brauchen; Rest wird abgelehnt. */
const EXPLOSION_STYLES = ['barrel', 'default', 'rocket', 'mortar', 'meteor'] as const;

function parseExplosion(raw: unknown, field: string, sourceId: string): ProjectileExplosionConfig {
  const value = record(raw, field);
  known(value, field, ['radius', 'maxDamage', 'minDamage', 'knockback', 'selfDamageMult', 'allowTeamDamage',
    'rockDamageMult', 'trainDamageMult', 'baseDamageMult', 'visualStyle', 'color', 'groundFire', 'fireChunkBurst']);
  const style = value.visualStyle;
  if (!EXPLOSION_STYLES.includes(style as typeof EXPLOSION_STYLES[number])) fail(`${field}.visualStyle`);
  if (value.allowTeamDamage !== false) fail(`${field}.allowTeamDamage`);
  const maxDamage = number(value.maxDamage, `${field}.maxDamage`, Number.EPSILON);
  const ground = record(value.groundFire, `${field}.groundFire`);
  known(ground, `${field}.groundFire`, ['type', 'radius', 'damagePerTick', 'lingerDuration', 'rockDamageMult',
    'trainDamageMult', 'burnDurationMs', 'burnDamagePerTick', 'sourceId']);
  if (ground.type !== 'fire') fail(`${field}.groundFire.type`);
  const chunks = record(value.fireChunkBurst, `${field}.fireChunkBurst`);
  known(chunks, `${field}.fireChunkBurst`, ['count', 'searchRadius', 'flightMs', 'igniteCenter', 'durationMs',
    'burnDurationMs', 'burnDamagePerTick', 'sourceId']);
  if (typeof chunks.igniteCenter !== 'boolean') fail(`${field}.fireChunkBurst.igniteCenter`);
  return Object.freeze({
    radius: number(value.radius, `${field}.radius`, 1),
    maxDamage,
    minDamage: number(value.minDamage, `${field}.minDamage`, 0, maxDamage),
    knockback: number(value.knockback, `${field}.knockback`, 0),
    selfDamageMult: number(value.selfDamageMult, `${field}.selfDamageMult`, 0, 1),
    allowTeamDamage: false,
    rockDamageMult: number(value.rockDamageMult, `${field}.rockDamageMult`, 0),
    trainDamageMult: number(value.trainDamageMult, `${field}.trainDamageMult`, 0),
    baseDamageMult: number(value.baseDamageMult, `${field}.baseDamageMult`, 0),
    visualStyle: style as typeof EXPLOSION_STYLES[number],
    color: color(value.color, `${field}.color`),
    audioSourceId: sourceId,
    groundFire: Object.freeze({
      type: 'fire' as const,
      radius: number(ground.radius, `${field}.groundFire.radius`, 1),
      damagePerTick: number(ground.damagePerTick, `${field}.groundFire.damagePerTick`, 0),
      lingerDuration: number(ground.lingerDuration, `${field}.groundFire.lingerDuration`, 1),
      allowTeamDamage: false,
      rockDamageMult: number(ground.rockDamageMult, `${field}.groundFire.rockDamageMult`, 0),
      trainDamageMult: number(ground.trainDamageMult, `${field}.groundFire.trainDamageMult`, 0),
      burnDurationMs: number(ground.burnDurationMs, `${field}.groundFire.burnDurationMs`, 0),
      burnDamagePerTick: number(ground.burnDamagePerTick, `${field}.groundFire.burnDamagePerTick`, 0),
      sourceId: string(ground.sourceId, `${field}.groundFire.sourceId`),
    }),
    fireChunkBurst: Object.freeze({
      count: integer(chunks.count, `${field}.fireChunkBurst.count`, 0, 64),
      searchRadius: number(chunks.searchRadius, `${field}.fireChunkBurst.searchRadius`, 1),
      flightMs: number(chunks.flightMs, `${field}.fireChunkBurst.flightMs`, 1),
      igniteCenter: chunks.igniteCenter as boolean,
      durationMs: number(chunks.durationMs, `${field}.fireChunkBurst.durationMs`, 1),
      burnDurationMs: number(chunks.burnDurationMs, `${field}.fireChunkBurst.burnDurationMs`, 0),
      burnDamagePerTick: number(chunks.burnDamagePerTick, `${field}.fireChunkBurst.burnDamagePerTick`, 0),
      sourceId: string(chunks.sourceId, `${field}.fireChunkBurst.sourceId`),
    }),
  });
}

const PRESENTATIONS: readonly ReactivePropPresentation[] = ['barrel', 'puffball', 'hive'];
/** Darstellung und Wirkung gehören zusammen: der Renderer kennt Clips und Effekte je Familie. */
const PRESENTATION_BY_EFFECT: Readonly<Record<ReactivePropEffectConfig['kind'], ReactivePropPresentation>> = {
  explosion: 'barrel', dot_zone: 'puffball', swarm: 'hive',
};

function parseKind(id: string, raw: unknown): ReactivePropKindConfig {
  const field = `kinds.${id}`;
  const value = record(raw, field);
  known(value, field, ['obstacleClass', 'integrity', 'damage', 'priming', 'trigger', 'effect', 'afterEffect', 'visual']);
  if (value.obstacleClass !== 'high' && value.obstacleClass !== 'veryHigh') fail(`${field}.obstacleClass`);
  const effectKind = record(value.effect, `${field}.effect`).kind;
  const kind = effectKind === 'explosion' ? parseExplosiveKind(id, field, value)
    : effectKind === 'dot_zone' || effectKind === 'swarm' ? parseRechargingKind(id, field, value)
      : fail(`${field}.effect.kind`);
  if (kind.visual.presentation !== PRESENTATION_BY_EFFECT[kind.effect.kind]) fail(`${field}.visual.presentation`);
  return kind;
}

function parseVisual(raw: unknown, field: string): ReactivePropVisualConfig {
  const visual = record(raw, field);
  known(visual, field, ['presentation', 'variants', 'defaultVariant', 'displaySizePx']);
  const presentation = visual.presentation;
  if (!PRESENTATIONS.includes(presentation as ReactivePropPresentation)) fail(`${field}.presentation`);
  const rawVariants = record(visual.variants, `${field}.variants`);
  const variants: Record<string, ReactivePropVariantVisual> = {};
  for (const [variantId, rawVariant] of Object.entries(rawVariants)) {
    const vField = `${field}.variants.${string(variantId, `${field}.variant id`)}`;
    const variant = record(rawVariant, vField);
    known(variant, vField, ['textureKey', 'glow']);
    let glow: ReactivePropGlow | null = null;
    if (variant.glow !== null) {
      const rawGlow = record(variant.glow, `${vField}.glow`);
      known(rawGlow, `${vField}.glow`, ['color', 'radiusPx', 'intensity']);
      glow = Object.freeze({
        color: color(rawGlow.color, `${vField}.glow.color`),
        radiusPx: number(rawGlow.radiusPx, `${vField}.glow.radiusPx`, 1),
        intensity: number(rawGlow.intensity, `${vField}.glow.intensity`, 0, 2),
      });
    }
    variants[variantId] = Object.freeze({ textureKey: string(variant.textureKey, `${vField}.textureKey`), glow });
  }
  const variantIds = Object.freeze(Object.keys(variants));
  if (variantIds.length === 0) fail(`${field}.variants`);
  const defaultVariant = string(visual.defaultVariant, `${field}.defaultVariant`);
  if (!variantIds.includes(defaultVariant)) fail(`${field}.defaultVariant`);
  return Object.freeze({
    presentation: presentation as ReactivePropPresentation,
    variants: Object.freeze(variants),
    variantIds,
    defaultVariant,
    displaySizePx: integer(visual.displaySizePx, `${field}.displaySizePx`, 8, 128),
  });
}

function parseRechargingKind(id: string, field: string, value: Record<string, unknown>): RechargingReactivePropKind {
  const integrity = record(value.integrity, `${field}.integrity`);
  known(integrity, `${field}.integrity`, ['mode']);
  if (integrity.mode !== 'indestructible') fail(`${field}.integrity.mode`);
  const damage = record(value.damage, `${field}.damage`);
  known(damage, `${field}.damage`, ['factor']);
  const priming = record(value.priming, `${field}.priming`);
  known(priming, `${field}.priming`, ['kind']);
  if (priming.kind !== 'none') fail(`${field}.priming.kind`);
  const trigger = record(value.trigger, `${field}.trigger`);
  known(trigger, `${field}.trigger`, ['on', 'minDamage']);
  if (trigger.on !== 'hit') fail(`${field}.trigger.on`);
  const raw = record(value.effect, `${field}.effect`);
  const effect = raw.kind === 'dot_zone' ? parseDotZone(raw, `${field}.effect`) : parseSwarm(raw, `${field}.effect`);
  const after = record(value.afterEffect, `${field}.afterEffect`);
  known(after, `${field}.afterEffect`, ['kind', 'rechargeMs']);
  if (after.kind !== 'recharge') fail(`${field}.afterEffect.kind`);
  const rechargeMs = number(after.rechargeMs, `${field}.afterEffect.rechargeMs`, 1);
  // Nie zwei Wirkungen desselben Objekts gleichzeitig: Aufladen deckt die ganze Wirkdauer ab.
  if (rechargeMs < reactivePropEffectLifetimeMs(effect)) fail(`${field}.afterEffect.rechargeMs`);
  return Object.freeze({
    id,
    obstacleClass: value.obstacleClass as ReactivePropObstacleClass,
    integrity: Object.freeze({ mode: 'indestructible' as const }),
    damage: Object.freeze({ factor: number(damage.factor, `${field}.damage.factor`, 0) }),
    priming: Object.freeze({ kind: 'none' as const }),
    trigger: Object.freeze({ on: 'hit' as const, minDamage: number(trigger.minDamage, `${field}.trigger.minDamage`, Number.EPSILON) }),
    effect,
    afterEffect: Object.freeze({ kind: 'recharge' as const, rechargeMs }),
    visual: parseVisual(value.visual, `${field}.visual`),
  });
}

function parseDotZone(value: Record<string, unknown>, field: string): ReactivePropDotZoneEffect {
  known(value, field, ['kind', 'sourceId', 'anticipationMs', 'radius', 'durationMs', 'damagePerTick', 'tickIntervalMs',
    'slowFraction', 'slowDurationMs']);
  const tickIntervalMs = number(value.tickIntervalMs, `${field}.tickIntervalMs`, 50);
  return Object.freeze({
    kind: 'dot_zone' as const,
    sourceId: string(value.sourceId, `${field}.sourceId`),
    anticipationMs: number(value.anticipationMs, `${field}.anticipationMs`, 0, 2000),
    radius: number(value.radius, `${field}.radius`, 8, 400),
    durationMs: number(value.durationMs, `${field}.durationMs`, tickIntervalMs),
    damagePerTick: number(value.damagePerTick, `${field}.damagePerTick`, 0),
    tickIntervalMs,
    slowFraction: number(value.slowFraction, `${field}.slowFraction`, Number.EPSILON, 0.9),
    slowDurationMs: number(value.slowDurationMs, `${field}.slowDurationMs`, tickIntervalMs),
  });
}

function parseSwarm(value: Record<string, unknown>, field: string): ReactivePropSwarmEffect {
  known(value, field, ['kind', 'sourceId', 'anticipationMs', 'durationMs', 'speedPxPerSec', 'acquireRadiusPx',
    'leashRadiusPx', 'swarmRadiusPx', 'stingReachPx', 'stingDamage', 'stingIntervalMs', 'stingsPerTarget', 'maxTargetMs',
    'idleGraceMs', 'dispersalMs', 'maxReturnMs']);
  const acquireRadiusPx = number(value.acquireRadiusPx, `${field}.acquireRadiusPx`, 32);
  return Object.freeze({
    kind: 'swarm' as const,
    sourceId: string(value.sourceId, `${field}.sourceId`),
    anticipationMs: number(value.anticipationMs, `${field}.anticipationMs`, 0, 2000),
    durationMs: number(value.durationMs, `${field}.durationMs`, 500),
    speedPxPerSec: number(value.speedPxPerSec, `${field}.speedPxPerSec`, 20, 1000),
    acquireRadiusPx,
    leashRadiusPx: number(value.leashRadiusPx, `${field}.leashRadiusPx`, acquireRadiusPx),
    swarmRadiusPx: number(value.swarmRadiusPx, `${field}.swarmRadiusPx`, 4, 200),
    stingReachPx: number(value.stingReachPx, `${field}.stingReachPx`, 0, 100),
    stingDamage: number(value.stingDamage, `${field}.stingDamage`, 0),
    stingIntervalMs: number(value.stingIntervalMs, `${field}.stingIntervalMs`, 50),
    stingsPerTarget: integer(value.stingsPerTarget, `${field}.stingsPerTarget`, 1, 64),
    maxTargetMs: number(value.maxTargetMs, `${field}.maxTargetMs`, 100),
    idleGraceMs: number(value.idleGraceMs, `${field}.idleGraceMs`, 0),
    dispersalMs: number(value.dispersalMs, `${field}.dispersalMs`, 0),
    maxReturnMs: number(value.maxReturnMs, `${field}.maxReturnMs`, 100),
  });
}

function parseExplosiveKind(id: string, field: string, value: Record<string, unknown>): ExplosiveReactivePropKind {
  const integrity = record(value.integrity, `${field}.integrity`);
  known(integrity, `${field}.integrity`, ['mode', 'maxHp']);
  if (integrity.mode !== 'destructible') fail(`${field}.integrity.mode`);
  const damage = record(value.damage, `${field}.damage`);
  known(damage, `${field}.damage`, ['factor']);
  const priming = record(value.priming, `${field}.priming`);
  known(priming, `${field}.priming`, ['kind', 'selfDamagePerSecond']);
  if (priming.kind !== 'burn') fail(`${field}.priming.kind`);
  const trigger = record(value.trigger, `${field}.trigger`);
  known(trigger, `${field}.trigger`, ['on']);
  if (trigger.on !== 'depleted') fail(`${field}.trigger.on`);
  const effect = record(value.effect, `${field}.effect`);
  known(effect, `${field}.effect`, ['kind', 'sourceId', 'fuseMs', 'chainFuseJitterMs', 'explosion']);
  if (effect.kind !== 'explosion') fail(`${field}.effect.kind`);
  const sourceId = string(effect.sourceId, `${field}.effect.sourceId`);
  const after = record(value.afterEffect, `${field}.afterEffect`);
  known(after, `${field}.afterEffect`, ['kind']);
  if (after.kind !== 'destroyed') fail(`${field}.afterEffect.kind`);
  return Object.freeze({
    id,
    obstacleClass: value.obstacleClass as ReactivePropObstacleClass,
    integrity: Object.freeze({ mode: 'destructible' as const, maxHp: number(integrity.maxHp, `${field}.integrity.maxHp`, 1) }),
    damage: Object.freeze({ factor: number(damage.factor, `${field}.damage.factor`, 0) }),
    priming: Object.freeze({
      kind: 'burn' as const,
      selfDamagePerSecond: number(priming.selfDamagePerSecond, `${field}.priming.selfDamagePerSecond`, Number.EPSILON),
    }),
    trigger: Object.freeze({ on: 'depleted' as const }),
    effect: Object.freeze({
      kind: 'explosion' as const,
      sourceId,
      fuseMs: number(effect.fuseMs, `${field}.effect.fuseMs`, 0),
      chainFuseJitterMs: range(effect.chainFuseJitterMs, `${field}.effect.chainFuseJitterMs`, false),
      explosion: parseExplosion(effect.explosion, `${field}.effect.explosion`, sourceId),
    }),
    afterEffect: Object.freeze({ kind: 'destroyed' as const }),
    visual: parseVisual(value.visual, `${field}.visual`),
  });
}

/** Validiert eine Streu-Spezifikation; Map-Authoring und Arena-Defaults nutzen dieselbe Regel. */
export function parseReactivePropScatterSpec(raw: unknown, field: string,
  kinds: ReadonlyMap<string, ReactivePropKindConfig> = REACTIVE_PROP_KINDS): ReactivePropScatterSpec {
  const value = record(raw, field);
  known(value, field, ['kind', 'placement', 'clusters', 'clusterSize', 'minSpacingCells', 'variant']);
  if (value.placement !== undefined && value.placement !== 'open' && value.placement !== 'chokepoints') fail(`${field}.placement`);
  const kind = kinds.get(string(value.kind, `${field}.kind`)) ?? fail(`${field}.kind`);
  const clusterSize = range(value.clusterSize, `${field}.clusterSize`, true);
  if (clusterSize[0] < 1 || clusterSize[1] > 6) fail(`${field}.clusterSize`);
  const variant = value.variant === undefined ? undefined : string(value.variant, `${field}.variant`);
  if (variant !== undefined && !kind.visual.variantIds.includes(variant)) fail(`${field}.variant`);
  return Object.freeze({
    kind: kind.id,
    ...(value.placement === 'chokepoints' ? { placement: 'chokepoints' as const } : {}),
    clusters: integer(value.clusters, `${field}.clusters`, 0, 64),
    clusterSize,
    minSpacingCells: integer(value.minSpacingCells, `${field}.minSpacingCells`, 2, 64),
    ...(variant ? { variant } : {}),
  });
}

/** Validiert einen vollständigen Katalog; Tests prüfen damit die Ablehnungsregeln. */
export function parseReactivePropCatalog(raw: unknown): {
  kinds: ReadonlyMap<string, ReactivePropKindConfig>;
  arenaScatter: Readonly<Record<ReactivePropArenaMode, readonly ReactivePropScatterSpec[]>>;
} {
  const value = record(raw, 'catalog');
  known(value, 'catalog', ['kinds', 'arenaScatter']);
  const kinds = new Map<string, ReactivePropKindConfig>();
  for (const [id, kind] of Object.entries(record(value.kinds, 'kinds'))) kinds.set(string(id, 'kind id'), parseKind(id, kind));
  const scatter = record(value.arenaScatter, 'arenaScatter');
  const modes: readonly ReactivePropArenaMode[] = ['deathmatch', 'team_deathmatch', 'capture_the_beer'];
  known(scatter, 'arenaScatter', modes);
  const arenaScatter = Object.fromEntries(modes.map(mode => {
    const specs = scatter[mode] ?? [];
    if (!Array.isArray(specs)) fail(`arenaScatter.${mode}`);
    return [mode, Object.freeze((specs as unknown[]).map((spec, i) => {
      const parsed = parseReactivePropScatterSpec(spec, `arenaScatter.${mode}[${i}]`, kinds);
      // PvP-Arenen kennen nur explosive Kinds; Lade-Kinds sind Kampagnen- und Dawn-Inhalt.
      if (!isExplosiveReactivePropKind(kinds.get(parsed.kind)!)) fail(`arenaScatter.${mode}[${i}].kind`);
      return parsed;
    }))];
  })) as Record<ReactivePropArenaMode, readonly ReactivePropScatterSpec[]>;
  return { kinds, arenaScatter: Object.freeze(arenaScatter) };
}

const CATALOG = parseReactivePropCatalog(rawKinds);
export const REACTIVE_PROP_KINDS: ReadonlyMap<string, ReactivePropKindConfig> = CATALOG.kinds;
export const REACTIVE_PROP_ARENA_SCATTER = CATALOG.arenaScatter;

export function getReactivePropKind(id: string): ReactivePropKindConfig {
  const kind = REACTIVE_PROP_KINDS.get(id);
  if (!kind) throw new Error(`[reactiveProps] Unknown kind: ${id}`);
  return kind;
}

/** Für Darstellung und Tests, die ein Fass voraussetzen. */
export function getExplosiveReactivePropKind(id: string): ExplosiveReactivePropKind {
  const kind = getReactivePropKind(id);
  if (!isExplosiveReactivePropKind(kind)) throw new Error(`[reactiveProps] Kind ${id} is not explosive`);
  return kind;
}

export function isReactivePropKind(id: string): boolean {
  return REACTIVE_PROP_KINDS.has(id);
}

/** Authored Variante, sonst die Default-Variante des Kinds. */
export function resolveReactivePropVariant(kind: ReactivePropKindConfig, variant?: string | null): string {
  return variant && kind.visual.variantIds.includes(variant) ? variant : kind.visual.defaultVariant;
}
