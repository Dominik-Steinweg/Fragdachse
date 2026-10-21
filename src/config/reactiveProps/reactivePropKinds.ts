import rawKinds from './reactivePropKinds.json';
import type { ProjectileExplosionConfig } from '../../types';

/**
 * Authored Kinds reaktiver Map-Objekte. V1 kennt nur das explosive Fass; Pilzsporen
 * (`dot_zone` + Aufladen) und Bienenstock (`swarm` + Aufladen) erweitern die Unions additiv.
 */
export type ReactivePropObstacleClass = 'high' | 'veryHigh';

export interface ReactivePropBurnPriming {
  readonly kind: 'burn';
  readonly selfDamagePerSecond: number;
}
export type ReactivePropPriming = ReactivePropBurnPriming;

export interface ReactivePropExplosionEffect {
  readonly kind: 'explosion';
  readonly sourceId: string;
  /** Zeit zwischen „HP erschöpft“ und Explosion; Ketten addieren einen Host-Jitter. */
  readonly fuseMs: number;
  readonly chainFuseJitterMs: readonly [number, number];
  readonly explosion: ProjectileExplosionConfig;
}
export type ReactivePropEffectConfig = ReactivePropExplosionEffect;
export type ReactivePropAfterEffect = { readonly kind: 'destroyed' };

export interface ReactivePropGlow {
  readonly color: number;
  readonly radiusPx: number;
  readonly intensity: number;
}
export interface ReactivePropVariantVisual {
  readonly textureKey: string;
  readonly glow: ReactivePropGlow | null;
}

export interface ReactivePropKindConfig {
  readonly id: string;
  readonly obstacleClass: ReactivePropObstacleClass;
  readonly integrity: { readonly mode: 'destructible'; readonly maxHp: number };
  /** Faktor auf den vollen Treffer, unabhängig vom `rockDamageMult` der Waffe. */
  readonly damage: { readonly factor: number };
  readonly priming: ReactivePropPriming;
  readonly trigger: { readonly on: 'depleted' };
  readonly effect: ReactivePropEffectConfig;
  readonly afterEffect: ReactivePropAfterEffect;
  readonly visual: {
    readonly variants: Readonly<Record<string, ReactivePropVariantVisual>>;
    readonly variantIds: readonly string[];
    readonly defaultVariant: string;
    readonly displaySizePx: number;
  };
}

export interface ReactivePropScatterSpec {
  readonly kind: string;
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

function parseKind(id: string, raw: unknown): ReactivePropKindConfig {
  const field = `kinds.${id}`;
  const value = record(raw, field);
  known(value, field, ['obstacleClass', 'integrity', 'damage', 'priming', 'trigger', 'effect', 'afterEffect', 'visual']);
  if (value.obstacleClass !== 'high' && value.obstacleClass !== 'veryHigh') fail(`${field}.obstacleClass`);
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
  const visual = record(value.visual, `${field}.visual`);
  known(visual, `${field}.visual`, ['variants', 'defaultVariant', 'displaySizePx']);
  const rawVariants = record(visual.variants, `${field}.visual.variants`);
  const variants: Record<string, ReactivePropVariantVisual> = {};
  for (const [variantId, rawVariant] of Object.entries(rawVariants)) {
    const vField = `${field}.visual.variants.${string(variantId, `${field}.visual.variant id`)}`;
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
  if (variantIds.length === 0) fail(`${field}.visual.variants`);
  const defaultVariant = string(visual.defaultVariant, `${field}.visual.defaultVariant`);
  if (!variantIds.includes(defaultVariant)) fail(`${field}.visual.defaultVariant`);
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
    visual: Object.freeze({
      variants: Object.freeze(variants),
      variantIds,
      defaultVariant,
      displaySizePx: integer(visual.displaySizePx, `${field}.visual.displaySizePx`, 8, 128),
    }),
  });
}

/** Validiert eine Streu-Spezifikation; Map-Authoring und Arena-Defaults nutzen dieselbe Regel. */
export function parseReactivePropScatterSpec(raw: unknown, field: string,
  kinds: ReadonlyMap<string, ReactivePropKindConfig> = REACTIVE_PROP_KINDS): ReactivePropScatterSpec {
  const value = record(raw, field);
  known(value, field, ['kind', 'clusters', 'clusterSize', 'minSpacingCells', 'variant']);
  const kind = kinds.get(string(value.kind, `${field}.kind`)) ?? fail(`${field}.kind`);
  const clusterSize = range(value.clusterSize, `${field}.clusterSize`, true);
  if (clusterSize[0] < 1 || clusterSize[1] > 6) fail(`${field}.clusterSize`);
  const variant = value.variant === undefined ? undefined : string(value.variant, `${field}.variant`);
  if (variant !== undefined && !kind.visual.variantIds.includes(variant)) fail(`${field}.variant`);
  return Object.freeze({
    kind: kind.id,
    clusters: integer(value.clusters, `${field}.clusters`, 0, 64),
    clusterSize,
    minSpacingCells: integer(value.minSpacingCells, `${field}.minSpacingCells`, 2, 64),
    ...(variant ? { variant } : {}),
  });
}

function parseCatalog(raw: unknown): {
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
    return [mode, Object.freeze((specs as unknown[]).map((spec, i) => parseReactivePropScatterSpec(spec, `arenaScatter.${mode}[${i}]`, kinds)))];
  })) as Record<ReactivePropArenaMode, readonly ReactivePropScatterSpec[]>;
  return { kinds, arenaScatter: Object.freeze(arenaScatter) };
}

const CATALOG = parseCatalog(rawKinds);
export const REACTIVE_PROP_KINDS: ReadonlyMap<string, ReactivePropKindConfig> = CATALOG.kinds;
export const REACTIVE_PROP_ARENA_SCATTER = CATALOG.arenaScatter;

export function getReactivePropKind(id: string): ReactivePropKindConfig {
  const kind = REACTIVE_PROP_KINDS.get(id);
  if (!kind) throw new Error(`[reactiveProps] Unknown kind: ${id}`);
  return kind;
}

export function isReactivePropKind(id: string): boolean {
  return REACTIVE_PROP_KINDS.has(id);
}

/** Authored Variante, sonst die Default-Variante des Kinds. */
export function resolveReactivePropVariant(kind: ReactivePropKindConfig, variant?: string | null): string {
  return variant && kind.visual.variantIds.includes(variant) ? variant : kind.visual.defaultVariant;
}
