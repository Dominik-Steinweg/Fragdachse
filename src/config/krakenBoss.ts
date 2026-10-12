import * as v from 'valibot';
import rawDefaults from './krakenBoss.json';
import { CombatPartHitShapeSchema, CombatPartTransferPolicySchema } from '../combat/CombatPartContact';
import type { CoopDefenseEnemyConfig } from './coopDefenseEnemies';
import type { PipelineBossAsset } from './pipelineAssetContracts';

const positive = v.pipe(v.number(), v.finite(), v.minValue(Number.MIN_VALUE));
const nonnegative = v.pipe(v.number(), v.finite(), v.minValue(0));
const count = v.pipe(positive, v.safeInteger());
const id = v.pipe(v.string(), v.trim(), v.minLength(1));
const offset = v.strictObject({ x: v.pipe(v.number(), v.finite()), y: v.pipe(v.number(), v.finite()) });
const shapes = v.pipe(v.array(CombatPartHitShapeSchema), v.minLength(1));
const lane = { length: positive, width: positive, damage: positive,
  windupMs: positive, strikeMs: positive, recoveryMs: positive };

export const KrakenBossConfigSchema = v.pipe(v.strictObject({
  assets: v.strictObject({ water: id, land: id, tentacle: id, egg: id, spine: id }),
  bodyRadiusPx: positive, phaseTwoHpRatio: v.pipe(positive, v.maxValue(1)), hpGate: v.literal(false),
  firstAttackDelayMs: nonnegative, actionPauseMs: nonnegative, turnRateDegPerSec: positive,
  waterApproachSpeedPxPerSec: positive, waterShoreDistancePx: nonnegative, landMoveSpeedPxPerSec: positive, landTurnRateDegPerSec: positive,
  /** Phase 1 roaming: organic swim legs between interior pond points; dives start well inside the pond. */
  waterWander: v.strictObject({ speedPxPerSec: positive, turnRateDegPerSec: positive, minLegPx: positive, maxLegPx: positive,
    pauseMs: nonnegative, shoreClearancePx: nonnegative, diveInteriorRatio: v.pipe(nonnegative, v.maxValue(1)) }),
  dive: v.strictObject({ intervalMs: positive, durationMs: positive, submergedAtMs: positive,
    submergedDurationMs: positive, surfaceDurationMs: positive, vulnerableAtMs: positive, recoveryMs: nonnegative }),
  ink: v.strictObject({ range: positive, arcDegrees: v.pipe(positive, v.maxValue(360)), damage: positive,
    mouthOffset: offset, windupMs: positive, spitDelayMs: positive, recoveryMs: positive, cloudFadeMs: positive }),
  tentacles: v.strictObject({ ...lane, maxConcurrent: count, retractMs: positive, retryMs: positive,
    safetyMarginPx: nonnegative, hitboxProfileId: id, riseMs: positive,
    targetableAfterRiseMs: nonnegative, untargetableAfterRetractMs: nonnegative,
    /** An arm reaches out of the pond from the submerged kraken: its base sits in open water near the shore, its
     * submerged root points back towards the kraken and it only strikes inside an arc around that radial direction.
     * It lurks upright, turns smoothly onto a reachable target, may strike several times (lifting back up in between)
     * and sinks when it runs out of strikes or targets. */
    emergeShoreBandPx: positive, spawnSpacingPx: nonnegative, repositionDelayMs: nonnegative, sinkMs: positive,
    baseClearancePx: positive, rootLengthPx: positive, strikeArcDegrees: v.pipe(positive, v.maxValue(180)),
    idealReachPx: positive, aimTurnRateDegPerSec: positive, firstStrikeDelayMs: nonnegative,
    restrikeDelayMs: nonnegative, liftMs: positive, idleTimeoutMs: positive, maxStrikes: count, staggerMs: nonnegative }),
  hitboxProfiles: v.pipe(v.array(v.strictObject({ id,
    rise: shapes, hover: shapes, slam: shapes, retract: shapes })), v.minLength(1)),
  transfer: CombatPartTransferPolicySchema,
  slam: v.strictObject({ ...lane, lungeDistancePx: positive, frontArcDegrees: v.pipe(positive, v.maxValue(180)) }),
  /** Phase-1 ranged attack: six dorsal spines become fast homing projectiles and regrow during the cooldown. */
  spines: v.strictObject({ volleyCount: v.literal(6), range: positive, damage: positive, speedPxPerSec: positive,
    turnRateDegPerSec: positive, hitRadiusPx: positive, lifetimeMs: positive, windupMs: positive, raiseMs: positive,
    releaseSpacingMs: positive, recoveryMs: nonnegative, regrowDelayMs: nonnegative, regrowMs: positive, cooldownMs: positive,
    originOffsets: v.pipe(v.array(offset), v.length(6)),
    /** Launch heading of each spine relative to the facing; homing converges the fan on the target. */
    launchFanDegrees: v.pipe(v.array(v.pipe(v.number(), v.minValue(-90), v.maxValue(90))), v.length(6)) }),
  /** Pause after the land body was stepped back from a margin it cannot occupy. */
  landMarginHoldMs: positive,
  /** Tolerated overlap of the full land body with bank, rocks or map edge before it steps back. */
  landPoseTolerancePx: nonnegative,
  landCooldowns: v.strictObject({ slamMs: positive, inkMs: positive, eggsMs: positive, spinesMs: positive }),
  exit: v.strictObject({ warningMs: positive, durationMs: positive, recoveryMs: nonnegative,
    roarAfterMs: nonnegative, gripAfterMs: positive, gripHoldMs: nonnegative, heaveAfterMs: positive,
    gripDistanceRatio: positive, heaveDistanceRatio: v.pipe(positive, v.maxValue(1)),
    protected: v.literal(true), contactDamage: v.literal(0), blockedPolicy: v.literal('wait-or-alternate'),
    retryMs: positive, diagnosticAfterMs: positive }),
  eggs: v.strictObject({ enemyKind: id, maxHp: positive, radiusPx: positive, volleyCount: count,
    maxPendingAndLive: count, windupMs: positive, flightMs: positive, recoveryMs: positive,
    throwDistancePx: positive, minimumShoreDistancePx: positive, releaseSpacingMs: positive,
    /** Eggs land inside a cone around the facing towards the target, matching the forward throw. */
    throwConeDegrees: v.pipe(positive, v.maxValue(180)),
    presentationPreset: v.picklist(['he', 'he_cluster_shard', 'he_demolition_shard', 'smoke', 'molotov', 'molotov_void', 'time_bubble', 'fur_ball', 'molotov_allied']),
    incubationMs: positive, hatchSpawnAfterMs: nonnegative, hatchDurationMs: positive,
    spawnRetryMs: positive, spawnRetryWindowMs: positive,
    releaseOffsets: v.pipe(v.array(offset), v.minLength(1)),
    targetableInFlight: v.literal(false), drops: v.literal(false), xp: v.literal(0),
    necromancy: v.literal(false), countsForEncounter: v.literal(false),
    broodTable: v.strictObject({ id, entries: v.pipe(v.array(v.strictObject({ enemyKind: id, weight: positive })), v.minLength(1)) }),
  }),
  victory: v.literal('boss-defeated'),
  death: v.strictObject({ waterMs: positive, landMs: positive }),
  residency: v.strictObject({ waterBudgetMiB: positive, landBudgetMiB: positive, pixelsPerDisplayPixel: v.literal(1),
    landPrefetchHpRatio: v.pipe(positive, v.maxValue(1)) }),
}), v.check(c => c.dive.submergedAtMs <= c.dive.durationMs && c.dive.vulnerableAtMs <= c.dive.surfaceDurationMs,
'Submersion markers must fit their host clips'),
v.check(c => c.exit.roarAfterMs < c.exit.warningMs && c.exit.gripAfterMs + c.exit.gripHoldMs < c.exit.heaveAfterMs
  && c.exit.heaveAfterMs < c.exit.durationMs && c.exit.gripDistanceRatio < c.exit.heaveDistanceRatio
  && c.slam.lungeDistancePx < c.slam.length, 'Invalid exit/lunge anchors'),
v.check(c => c.eggs.hatchSpawnAfterMs < c.eggs.hatchDurationMs
  && c.eggs.volleyCount <= c.eggs.maxPendingAndLive && c.eggs.releaseOffsets.length >= c.eggs.volleyCount,
'Invalid egg capacity/anchors'),
v.check(c => c.tentacles.targetableAfterRiseMs <= c.tentacles.riseMs
  && c.tentacles.riseMs < c.tentacles.windupMs
  && c.tentacles.untargetableAfterRetractMs <= c.tentacles.retractMs, 'Invalid tentacle visibility anchors'),
v.check(c => new Set(Object.values(c.assets)).size === 5, 'Boss assets need distinct IDs'),
v.check(c => c.tentacles.idealReachPx < c.tentacles.length && c.waterWander.minLegPx <= c.waterWander.maxLegPx
  && c.spines.raiseMs <= c.spines.windupMs && c.spines.regrowDelayMs + c.spines.regrowMs <= c.spines.cooldownMs,
'Invalid lurk/wander/spine anchors'),
v.check(c => new Set(c.hitboxProfiles.map(p => p.id)).size === c.hitboxProfiles.length
  && c.hitboxProfiles.some(p => p.id === c.tentacles.hitboxProfileId), 'Unknown/duplicate hitbox profile'),
v.check(c => new Set(c.eggs.broodTable.entries.map(e => e.enemyKind)).size === c.eggs.broodTable.entries.length,
'Duplicate brood kind'));
export type KrakenBossConfig = v.InferOutput<typeof KrakenBossConfigSchema>;

/** Strict authoring boundary: reject missing/invalid fields, never silently retune authored values. */
export function normalizeKrakenBossConfig(raw: unknown): KrakenBossConfig {
  return v.parse(KrakenBossConfigSchema, raw);
}

/** Staged authored block; register boss/egg entities when the production assets are selected. */
export const KRAKEN_BOSS_DEFAULTS = normalizeKrakenBossConfig(rawDefaults);

export function validateKrakenBroodRegistry(config: KrakenBossConfig,
  registry: Readonly<Record<string, CoopDefenseEnemyConfig>>, isMeleeWeapon: (id: string) => boolean,
  maxRegularSizePx: number): void {
  for (const entry of config.eggs.broodTable.entries) {
    const enemy = registry[entry.enemyKind];
    if (!enemy || enemy.isBoss || enemy.krakenBoss || enemy.krakenEgg || enemy.size > maxRegularSizePx
      || enemy.deathSpawns?.length || enemy.spawnThrow || enemy.timebomb || enemy.voidHunterBoss
      || !enemy.weapons.length || !enemy.weapons.every(w => isMeleeWeapon(w.weaponId))) {
      throw new Error(`[krakenBoss] Invalid small melee brood kind: ${entry.enemyKind}`);
    }
  }
}

export const KrakenEggConfigSchema = v.strictObject({
  assetId: id, stationary: v.literal(true), drops: v.literal(false), necromancy: v.literal(false),
  countsForEncounter: v.literal(false), navigation: v.literal(false),
});
export type KrakenEggConfig = v.InferOutput<typeof KrakenEggConfigSchema>;
export function normalizeKrakenEggConfig(raw: unknown): KrakenEggConfig { return v.parse(KrakenEggConfigSchema, raw); }

/** Clip-local marker names, not exported frame numbers or gameplay clock decisions. */
export const KRAKEN_ASSET_REQUIREMENTS = {
  water: { clips: { idle: [], move: [], 'intro-rise': ['eyes-open'], 'ink-spit': ['charge', 'spit'],
    'egg-throw': ['release-1', 'release-2', 'release-3', 'release-4', 'release-5', 'release-6'], dive: ['submerged'], surface: ['eyes-open'],
    'spine-volley': ['raise', 'release-1', 'release-2', 'release-3', 'release-4', 'release-5', 'release-6'] },
    sockets: ['mouth', 'egg1', 'egg2', 'egg3', 'egg4', 'egg5', 'egg6',
      'spine1', 'spine2', 'spine3', 'spine4', 'spine5', 'spine6', 'spine1Tip', 'spine2Tip', 'spine3Tip', 'spine4Tip', 'spine5Tip', 'spine6Tip'] },
  land: { clips: { idle: [], move: [], ashore: ['grip', 'heave'], 'ink-spit': ['charge', 'spit'],
    slam: ['strike', 'impact'], 'egg-throw': ['release-1', 'release-2', 'release-3', 'release-4', 'release-5', 'release-6'], death: [] }, sockets: ['mouth', 'egg1', 'egg2', 'egg3', 'egg4', 'egg5', 'egg6'] },
  tentacle: { clips: { rise: [], hover: [], slam: ['strike', 'impact'], retract: [] }, sockets: ['waterEntry'] },
  egg: { clips: { idle: [], hatch: ['spawn'] }, sockets: [] },
  /** One detachable dorsal spine: drawn at the body's spine sockets, regrowing by scale, and as the projectile. */
  spine: { clips: { idle: [] }, sockets: ['base', 'tip'] },
} as const;

/** Call only with normalized selected assets at promotion/integration, never fall back to PoC URLs. */
export function validateKrakenAssetBindings(config: KrakenBossConfig, assets: readonly PipelineBossAsset[]): void {
  for (const role of ['water', 'land', 'tentacle', 'egg', 'spine'] as const) {
    const asset = assets.find(a => a.id === config.assets[role]), required = KRAKEN_ASSET_REQUIREMENTS[role];
    if (!asset || asset.clips.some(c => c.name === 'tentacle-call')) throw new Error(`[krakenBoss] Missing/obsolete ${role} asset`);
    const clips: Readonly<Record<string, readonly string[]>> = required.clips;
    for (const [name, markers] of Object.entries(clips)) {
      const clip = asset.clips.find(c => c.name === name);
      if (!clip || markers.some(m => clip.markers?.[m] === undefined)) throw new Error(`[krakenBoss] Missing ${role}/${name} markers`);
    }
    if (required.sockets.some(s => !asset.sockets[s])) throw new Error(`[krakenBoss] Missing ${role} sockets`);
  }
}
