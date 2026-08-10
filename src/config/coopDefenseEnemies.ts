import rawCoopDefenseEnemies from './coopDefenseEnemies.json';
import type { ArmageddonMeteorConfig, UtilityConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type { FireChunkBurstConfig, GroundFireCellEffect } from '../types';
import {
  normalizeCoopDefenseHumanPlayerCount,
  normalizeCoopDefensePlayerScalingFactor,
  resolveCoopDefenseNonNegativeInteger,
  resolveCoopDefensePositiveInteger,
  resolveCoopDefensePositiveNumber,
} from './coopDefenseScaling';

export type CoopDefenseEnemyKind = string;

export type CoopDefenseEnemyMovementTarget = 'bases' | 'players' | 'players-and-armed-constructs';

/** Maximale Kantenlaenge normaler Gegner; Bosse duerfen groesser sein. */
export const MAX_REGULAR_ENEMY_SIZE_PX = 30;

/** Standard-Wegstossfaktor, wenn ein Gegner keinen eigenen Wert konfiguriert. */
export const DEFAULT_ENEMY_KNOCKBACK_FACTOR = 1;

/**
 * `structures` deckt Basen und Felsen ab (plus den Zug ueber trainDamageMult), laesst Spieler und
 * Verbuendete aber aus. Damit koennen Gegner eine reine Belagerungswaffe neben einer reinen
 * Anti-Spieler-Waffe fuehren, ohne dass die Belagerungswaffe auf Spieler anschlaegt.
 */
export type CoopDefenseEnemyWeaponTargetMode = 'all' | 'players' | 'rocks' | 'structures';

export interface CoopDefenseEnemyWeaponConfig {
  readonly weaponId: WeaponConfig['id'];
  readonly targetMode: CoopDefenseEnemyWeaponTargetMode;
  readonly minimumFireDurationMs?: number;
  readonly playerMeleeWindupMs?: number;
}

export interface CoopDefenseEnemyStinkAuraConfig {
  readonly utilityId: UtilityConfig['id'];
}

export interface CoopDefenseEnemyDeathSpawnConfig {
  readonly enemyKind: CoopDefenseEnemyKind;
  readonly count: number;
  readonly offsetPx: number;
}

export interface CoopDefenseEnemyTrainAwarenessConfig {
  readonly safetyDistancePx: number;
  readonly timeSafetyMarginMs: number;
}

export interface CoopDefenseEnemyTrainCollisionConfig {
  readonly damageToEnemy: number;
  readonly destroysTrain: boolean;
}

/**
 * Eigenleuchten eines Gegners: ein additiver Halo um das Sprite plus eine Lichtquelle gleicher
 * Farbe. Der Halo trägt die Wirkung bei Tag (die Lightmap ist dann fast wirkungslos), das Licht
 * bei Nacht – deshalb immer beides.
 *
 * Gedacht als Lesbarkeitswerkzeug für Gegner, die im Getümmel sofort erkennbar sein müssen
 * (Bosse, besonders gefährliche Einheiten), nicht als allgemeine Dekoration.
 */
export interface CoopDefenseEnemyGlowConfig {
  readonly color: number;
  /** Durchmesser des Halos als Vielfaches der Gegnergröße. */
  readonly sizeFactor: number;
  /** Deckkraft des Halos (0…1) vor der Emissive-Dämpfung. */
  readonly alpha: number;
  readonly lightRadiusPx: number;
  readonly lightIntensity: number;
}

export interface CoopDefenseEnemyTranslocatorConfig {
  readonly utilityId: 'TRANSLOCATOR';
  readonly flightTimeMs: number;
  readonly cooldownMs: number;
  readonly minRange: number;
  readonly maxRange: number;
}

/**
 * Einbuddeln fuer Gegner. Unter der Erde gelten dieselben Einschraenkungen wie beim Spieler:
 * keine Kollisionen, keine Angriffe, unverwundbar.
 */
export interface CoopDefenseEnemyBurrowConfig {
  /** Maximale Zeit, die der Gegner am Stueck eingebuddelt bleibt. */
  readonly maxDurationMs: number;
  /** Geschwindigkeitsfaktor unter der Erde (1 = unveraendert). */
  readonly speedFactor: number;
  /** True: Gegner erscheint eingebuddelt am linken Spielfeldrand und graebt sich geradeaus nach rechts frei. */
  readonly spawnBurrowedAtLeftEdge: boolean;
  /** Mindest-Grabstrecke der Anfahrt, bevor der Gegner ueberhaupt auftauchen darf. */
  readonly spawnTunnelMinDistancePx: number;
  /** Not-Aus fuer die Einbuddel-Anfahrt; danach taucht der Gegner auf, wo er gerade steht. */
  readonly spawnTunnelTimeoutMs: number;
  /** True: unterquert eingebuddelt die Gleise, statt auf den vorbeifahrenden Zug zu warten. */
  readonly crossesTrainTracks: boolean;
}

/**
 * Bevorzugter Gefechtsabstand eines Fernkaempfers. Der Gegner laeuft weiterhin grundsaetzlich auf
 * die Spieler zu (`movementTarget: 'players'`), haelt aber ab dieser Distanz an und weicht zurueck,
 * wenn ein Spieler zu nah herankommt – statt in den Nahkampf zu rennen.
 *
 * Bewusst allgemein gehalten: jede Gegner-Art mit diesem Block bekommt das Verhalten, ohne dass
 * dafuer Code angefasst werden muss.
 */
export interface CoopDefenseEnemyCombatPositioningConfig {
  /** Wunschabstand zum naechsten Spieler in Pixeln. */
  readonly preferredDistancePx: number;
  /** Totzone um den Wunschabstand; darin bleibt der Gegner einfach stehen und feuert. */
  readonly toleranceP: number;
  /** Rueckwaerts-Tempo als Anteil der Laufgeschwindigkeit (1 = volles Tempo). */
  readonly retreatSpeedFactor: number;
  /**
   * Nur Spieler mit freier Sichtlinie zaehlen. Ohne Sichtlinie kann der Gegner ohnehin nicht
   * schiessen und laeuft besser weiter auf sein Ziel zu.
   */
  readonly requireLineOfSight: boolean;
}

/**
 * Ausweichschritt. Der Gegner setzt ihn in zwei Situationen ein:
 *  1. seitlich weg von einem Projektil, das ihn sonst treffen wuerde,
 *  2. nach vorne auf einen Spieler zu, der bereits in Naehe ist.
 *
 * Ausgefuehrt wird der Standard-Dash des Spielers (siehe HostPhysicsSystem): Dauer, Kurve und
 * zurueckgelegte Strecke stammen aus den DASH_*-Konstanten und sind deshalb hier nicht
 * konfigurierbar. Konfiguriert wird nur, *wann* der Gegner ausweicht.
 */
export interface CoopDefenseEnemyDodgeConfig {
  /** Optionaler HP-Schwellwert; oberhalb davon bleibt der Dodge vollständig deaktiviert. */
  readonly enabledBelowHpRatio?: number;
  /** Wartezeit nach dem Ende eines Ausweichschritts, bevor der naechste starten darf. */
  readonly cooldownMs: number;
  /** Suchradius fuer bedrohende Projektile. */
  readonly evadeScanRadiusPx: number;
  /** Nur Projektile, die den Gegner innerhalb dieser Zeit erreichen, loesen ein Ausweichen aus. */
  readonly evadeLeadTimeMs: number;
  /** Sicherheitsaufschlag auf den Trefferradius bei der Einschlagsprognose. */
  readonly evadeMissMarginPx: number;
  /** Naeher als das wird nicht nachgesetzt – der Gegner steht bereits im Nahbereich. */
  readonly approachMinDistancePx: number;
  /** Weiter als das lohnt der Sprung nicht; der Gegner laeuft dann normal weiter. */
  readonly approachMaxDistancePx: number;
}

/**
 * Geworfenes Projektil mit Granaten-Flugverhalten, das statt einer Explosion neue Gegner absetzt.
 * Die Zielerfassung entspricht dem gegnerischen Translocator (Wurfgeschwindigkeit aus Distanz und
 * geplanter Flugzeit), da sich diese Ballistik bereits bewaehrt hat.
 */
export interface CoopDefenseEnemySpawnThrowConfig {
  readonly displayName: string;
  /** Gegnerart, die beim Ausloesen entsteht. */
  readonly enemyKind: CoopDefenseEnemyKind;
  readonly count: number;
  readonly spawnOffsetPx: number;
  readonly cooldownMs: number;
  /** Geplante Flugzeit bis zum Zielpunkt; bestimmt die Wurfgeschwindigkeit. */
  readonly flightTimeMs: number;
  /** Verzoegerung ab Wurf bis zum Ausloesen (analog Granaten-Zuendzeit). */
  readonly fuseTimeMs: number;
  readonly minRange: number;
  readonly maxRange: number;
  readonly projectileSpeed: number;
  readonly projectileSize: number;
  readonly maxBounces: number;
  readonly color: number;
}

export interface CoopDefenseVoidHunterBossConfig {
  readonly phaseTwoHpRatio: number;
  readonly phaseTwoSpeedMultiplier: number;
  readonly shotgunRangePx: number;
  readonly gauss: {
    readonly weaponId: 'VOID_HUNTER_GAUSS';
    readonly initialDelayMs: number;
    readonly cooldownMs: number;
    readonly chargeDurationMs: number;
    readonly aimUpdateIntervalMs: number;
    readonly maxAimTurnDegreesPerSecond: number;
  };
  readonly nuke: {
    readonly countdownMs: number;
    readonly emergeDelayMs: number;
    readonly radiusPx: number;
    readonly maxDamage: number;
    readonly minDamage: number;
    readonly fireChunkBurst: FireChunkBurstConfig;
  };
  readonly armageddonDurationMs: number;
  readonly armageddonCooldownMs: number;
  readonly armageddon: ArmageddonMeteorConfig;
}

/** Unregelmaessiger Boss-Auswurf von lila Brandbrocken, die ausschliesslich Spieler treffen. */
export interface CoopDefenseEnemyVoidFireChunkConfig extends FireChunkBurstConfig {
  readonly intervalMinMs: number;
  readonly intervalMaxMs: number;
}

/** Lila, nur fuer Spieler gefaehrliche Brandspur unter dem gesamten Boss-Koerper. */
export interface CoopDefenseEnemyVoidFireTrailConfig extends GroundFireCellEffect {}

/** Dreiphasige, zielgebundene Selbstzuendung des Zeitbombendachses. */
export interface CoopDefenseEnemyTimebombConfig {
  readonly chaseSpeedMultiplier: number;
  readonly activationRadiusPx: number;
  readonly lineOfSightDurationMs: number;
  readonly fuseDistancePx: number;
  readonly fuseDurationMs: number;
  readonly explosionRadiusPx: number;
  readonly explosionDamage: number;
  readonly explosionKnockback: number;
  readonly fireChunks: FireChunkBurstConfig;
  readonly killedPopRadiusPx: number;
  readonly killedPopDamage: number;
}

export interface CoopDefenseEnemyPlayerScaling {
  readonly maxHpFactorPerAdditionalPlayer?: number;
  readonly moveSpeedFactorPerAdditionalPlayer?: number;
}

export interface CoopDefenseEnemySpawnScaling {
  readonly intervalMsFactorPerAdditionalPlayer?: number;
  readonly countPerTickFactorPerAdditionalPlayer?: number;
}

export interface CoopDefenseEnemyConfig {
  readonly maxHp: number;
  readonly xp: number;
  readonly size: number;
  readonly moveSpeed: number;
  /**
   * Faktor auf alle Wegstoss-Impulse (Raketen, Granaten, Laubblaeser, Dash-Aufprall, Schockwellen …).
   * 1 = normales Wegstoessen, >1 = leichter Gegner fliegt weiter, <1 = schwerer Gegner haelt dagegen,
   * 0 = komplett immun. Fehlt der Wert, gilt 1.
   */
  readonly knockbackFactor?: number;
  readonly movementTarget: CoopDefenseEnemyMovementTarget;
  readonly weapons: readonly CoopDefenseEnemyWeaponConfig[];
  readonly attackScanIntervalMs: number;
  readonly attackStopDurationMs: number;
  readonly obstacleAttackDelayMs: number;
  readonly imageKey: string;
  /** Rein visuelle Zusatzdrehung des Sprites; Bewegung, Zielen und Netzwerkrotation bleiben unveraendert. */
  readonly spriteRotationOffsetDegrees?: number;
  readonly isBoss?: boolean;
  readonly displayName?: string;
  readonly color?: number;
  readonly glow?: CoopDefenseEnemyGlowConfig;
  readonly phaseTwoGlow?: CoopDefenseEnemyGlowConfig;
  readonly translocator?: CoopDefenseEnemyTranslocatorConfig;
  readonly burrow?: CoopDefenseEnemyBurrowConfig;
  readonly dodge?: CoopDefenseEnemyDodgeConfig;
  readonly combatPositioning?: CoopDefenseEnemyCombatPositioningConfig;
  readonly voidHunterBoss?: CoopDefenseVoidHunterBossConfig;
  readonly spawnThrow?: CoopDefenseEnemySpawnThrowConfig;
  readonly voidFireChunks?: CoopDefenseEnemyVoidFireChunkConfig;
  readonly voidFireTrail?: CoopDefenseEnemyVoidFireTrailConfig;
  readonly timebomb?: CoopDefenseEnemyTimebombConfig;
  readonly stinkAura?: CoopDefenseEnemyStinkAuraConfig;
  readonly deathSpawns?: readonly CoopDefenseEnemyDeathSpawnConfig[];
  readonly trainAwareness?: CoopDefenseEnemyTrainAwarenessConfig;
  readonly trainCollision?: CoopDefenseEnemyTrainCollisionConfig;
  readonly playerScaling?: CoopDefenseEnemyPlayerScaling;
  readonly spawnScaling?: CoopDefenseEnemySpawnScaling;
}

export type ResolvedCoopDefenseEnemyConfig = Omit<CoopDefenseEnemyConfig, 'playerScaling'>;

export type ResolvedCoopDefenseEnemyConfigs = Record<CoopDefenseEnemyKind, ResolvedCoopDefenseEnemyConfig>;

interface CoopDefenseEnemyRegistryEntry extends CoopDefenseEnemyConfig {
  readonly id: string;
}

interface CoopDefenseEnemyRegistryFile {
  readonly enemies: readonly CoopDefenseEnemyRegistryEntry[];
}

const COOP_DEFENSE_ENEMY_REGISTRY = normalizeEnemyRegistry(rawCoopDefenseEnemies as CoopDefenseEnemyRegistryFile);

export const COOP_DEFENSE_ENEMY_CONFIGS: Record<CoopDefenseEnemyKind, CoopDefenseEnemyConfig> = COOP_DEFENSE_ENEMY_REGISTRY;

/**
 * Stabile, geordnete Liste aller Gegner-Arten. Reihenfolge folgt der Insertion-Order der
 * gebündelten JSON-Registry und ist daher auf Host und Client identisch – nur deshalb darf der
 * Index als kompakter Wire-Wert für `kind` verwendet werden (siehe enemySnapshotCodec.ts).
 */
export const COOP_DEFENSE_ENEMY_KINDS: readonly CoopDefenseEnemyKind[] = Object.keys(COOP_DEFENSE_ENEMY_REGISTRY);

export function getCoopDefenseEnemyKindIndex(kind: CoopDefenseEnemyKind): number {
  return COOP_DEFENSE_ENEMY_KINDS.indexOf(kind);
}

export function getCoopDefenseEnemyKindByIndex(index: number): CoopDefenseEnemyKind | undefined {
  return COOP_DEFENSE_ENEMY_KINDS[index];
}

export function hasCoopDefenseEnemyKind(kind: string): kind is CoopDefenseEnemyKind {
  return Object.prototype.hasOwnProperty.call(COOP_DEFENSE_ENEMY_CONFIGS, kind);
}

export function getCoopDefenseEnemyConfig(kind: CoopDefenseEnemyKind): CoopDefenseEnemyConfig {
  const config = COOP_DEFENSE_ENEMY_CONFIGS[kind];
  if (!config) {
    throw new Error(`[coopDefenseEnemies] Unknown enemy kind: ${kind}`);
  }
  return config;
}

export function getCoopDefenseEnemyXp(kind: CoopDefenseEnemyKind): number {
  return getCoopDefenseEnemyConfig(kind).xp;
}

export function resolveCoopDefenseEnemyConfigs(humanPlayerCount: number): ResolvedCoopDefenseEnemyConfigs {
  const normalizedHumanPlayerCount = normalizeCoopDefenseHumanPlayerCount(humanPlayerCount);

  return Object.fromEntries(
    Object.entries(COOP_DEFENSE_ENEMY_CONFIGS).map(([kind, config]) => [
      kind,
      {
        maxHp: resolveCoopDefensePositiveInteger(
          config.maxHp,
          config.playerScaling?.maxHpFactorPerAdditionalPlayer,
          normalizedHumanPlayerCount,
        ),
        xp: Math.max(0, Math.floor(config.xp)),
        size: config.size,
        moveSpeed: resolveCoopDefensePositiveNumber(
          config.moveSpeed,
          config.playerScaling?.moveSpeedFactorPerAdditionalPlayer,
          normalizedHumanPlayerCount,
        ),
        knockbackFactor: config.knockbackFactor,
        movementTarget: config.movementTarget,
        weapons: config.weapons,
        attackScanIntervalMs: config.attackScanIntervalMs,
        attackStopDurationMs: config.attackStopDurationMs,
        obstacleAttackDelayMs: config.obstacleAttackDelayMs,
        imageKey: config.imageKey,
        spriteRotationOffsetDegrees: config.spriteRotationOffsetDegrees,
        isBoss: config.isBoss,
        displayName: config.displayName,
        color: config.color,
        glow: config.glow,
        phaseTwoGlow: config.phaseTwoGlow,
        translocator: config.translocator,
        burrow: config.burrow,
        dodge: config.dodge,
        combatPositioning: config.combatPositioning,
        voidHunterBoss: config.voidHunterBoss,
        spawnThrow: config.spawnThrow,
        voidFireChunks: config.voidFireChunks,
        voidFireTrail: config.voidFireTrail,
        timebomb: config.timebomb,
        stinkAura: config.stinkAura,
        deathSpawns: config.deathSpawns,
        trainAwareness: config.trainAwareness,
        trainCollision: config.trainCollision,
        spawnScaling: config.spawnScaling,
      },
    ]),
  ) as ResolvedCoopDefenseEnemyConfigs;
}

export function resolveCoopDefenseEnemySpawnConfig(
  kind: CoopDefenseEnemyKind,
  baseSpawnConfig: { intervalMs: number; countPerTick: number },
  humanPlayerCount: number,
): { intervalMs: number; countPerTick: number } {
  const normalizedHumanPlayerCount = normalizeCoopDefenseHumanPlayerCount(humanPlayerCount);
  const config = getCoopDefenseEnemyConfig(kind);

  return {
    intervalMs: resolveCoopDefensePositiveNumber(
      baseSpawnConfig.intervalMs,
      config.spawnScaling?.intervalMsFactorPerAdditionalPlayer,
      normalizedHumanPlayerCount,
    ),
    countPerTick: resolveCoopDefenseNonNegativeInteger(
      baseSpawnConfig.countPerTick,
      config.spawnScaling?.countPerTickFactorPerAdditionalPlayer,
      normalizedHumanPlayerCount,
    ),
  };
}

function normalizeEnemyRegistry(registry: CoopDefenseEnemyRegistryFile): Record<string, CoopDefenseEnemyConfig> {
  const byId: Record<string, CoopDefenseEnemyConfig> = {};
  for (const enemy of registry.enemies) {
    if (typeof enemy.id !== 'string' || enemy.id.trim().length === 0) {
      throw new Error('[coopDefenseEnemies] Enemy id must be a non-empty string');
    }
    if (byId[enemy.id]) {
      throw new Error(`[coopDefenseEnemies] Duplicate enemy id: ${enemy.id}`);
    }
    byId[enemy.id] = normalizeEnemyConfig(enemy);
  }
  for (const [enemyId, config] of Object.entries(byId)) {
    for (const deathSpawn of config.deathSpawns ?? []) {
      if (!byId[deathSpawn.enemyKind]) {
        throw new Error(
          `[coopDefenseEnemies] Enemy ${enemyId} references unknown death-spawn enemy ${deathSpawn.enemyKind}`,
        );
      }
    }
    if (config.spawnThrow && !byId[config.spawnThrow.enemyKind]) {
      throw new Error(
        `[coopDefenseEnemies] Enemy ${enemyId} references unknown spawn-throw enemy ${config.spawnThrow.enemyKind}`,
      );
    }
  }
  return byId;
}

function normalizeEnemyConfig(enemy: CoopDefenseEnemyRegistryEntry): CoopDefenseEnemyConfig {
  const isBoss = enemy.isBoss === true;
  if (!isBoss && enemy.size > MAX_REGULAR_ENEMY_SIZE_PX) {
    throw new Error(
      `[coopDefenseEnemies] Regular enemy ${enemy.id} exceeds ${MAX_REGULAR_ENEMY_SIZE_PX}px: configured size ${enemy.size}px`,
    );
  }

  return {
    maxHp: Math.max(1, Math.floor(enemy.maxHp)),
    xp: Math.max(0, Math.floor(enemy.xp)),
    size: Math.max(1, enemy.size),
    moveSpeed: Math.max(1, enemy.moveSpeed),
    knockbackFactor: normalizeKnockbackFactor(enemy.knockbackFactor),
    movementTarget: normalizeMovementTarget(enemy.movementTarget),
    weapons: normalizeWeapons(enemy.weapons, enemy.id),
    attackScanIntervalMs: Math.max(1, Math.floor(enemy.attackScanIntervalMs)),
    attackStopDurationMs: Math.max(0, Math.floor(enemy.attackStopDurationMs)),
    obstacleAttackDelayMs: Math.max(0, Math.floor(enemy.obstacleAttackDelayMs)),
    imageKey: enemy.imageKey,
    spriteRotationOffsetDegrees: typeof enemy.spriteRotationOffsetDegrees === 'number'
      && Number.isFinite(enemy.spriteRotationOffsetDegrees)
      ? enemy.spriteRotationOffsetDegrees
      : undefined,
    isBoss,
    displayName: typeof enemy.displayName === 'string' && enemy.displayName.trim().length > 0
      ? enemy.displayName.trim()
      : undefined,
    color: typeof enemy.color === 'number' && Number.isFinite(enemy.color)
      ? Math.max(0, Math.floor(enemy.color))
      : undefined,
    glow: normalizeGlowConfig(enemy.glow),
    phaseTwoGlow: normalizeGlowConfig(enemy.phaseTwoGlow),
    translocator: normalizeTranslocatorConfig(enemy.translocator, enemy.id),
    burrow: normalizeBurrowConfig(enemy.burrow),
    dodge: normalizeDodgeConfig(enemy.dodge),
    combatPositioning: normalizeCombatPositioningConfig(enemy.combatPositioning),
    voidHunterBoss: normalizeVoidHunterBossConfig(enemy.voidHunterBoss, enemy.id),
    spawnThrow: normalizeSpawnThrowConfig(enemy.spawnThrow, enemy.id),
    voidFireChunks: normalizeVoidFireChunkConfig(enemy.voidFireChunks),
    voidFireTrail: normalizeVoidFireTrailConfig(enemy.voidFireTrail),
    timebomb: normalizeTimebombConfig(enemy.timebomb),
    stinkAura: normalizeStinkAuraConfig(enemy.stinkAura, enemy.id),
    deathSpawns: normalizeDeathSpawns(enemy.deathSpawns, enemy.id),
    trainAwareness: normalizeTrainAwareness(enemy.trainAwareness),
    trainCollision: normalizeTrainCollision(enemy.trainCollision),
    playerScaling: normalizePlayerScaling(enemy.playerScaling),
    spawnScaling: normalizeSpawnScaling(enemy.spawnScaling),
  };
}

function normalizeTrainAwareness(
  config: CoopDefenseEnemyTrainAwarenessConfig | undefined,
): CoopDefenseEnemyTrainAwarenessConfig | undefined {
  if (!config) return undefined;
  return {
    safetyDistancePx: Math.max(0, config.safetyDistancePx),
    timeSafetyMarginMs: Math.max(0, Math.floor(config.timeSafetyMarginMs)),
  };
}

function normalizeTrainCollision(
  config: CoopDefenseEnemyTrainCollisionConfig | undefined,
): CoopDefenseEnemyTrainCollisionConfig | undefined {
  if (!config) return undefined;
  return {
    damageToEnemy: Math.max(0, config.damageToEnemy),
    destroysTrain: config.destroysTrain === true,
  };
}

function normalizeGlowConfig(
  config: CoopDefenseEnemyGlowConfig | undefined,
): CoopDefenseEnemyGlowConfig | undefined {
  if (!config) return undefined;
  return {
    color: Math.max(0, Math.floor(config.color)),
    sizeFactor: Math.max(1, config.sizeFactor),
    alpha: Math.max(0, Math.min(1, config.alpha)),
    lightRadiusPx: Math.max(1, config.lightRadiusPx),
    lightIntensity: Math.max(0, Math.min(1, config.lightIntensity)),
  };
}

function normalizeTranslocatorConfig(
  config: CoopDefenseEnemyTranslocatorConfig | undefined,
  enemyId: string,
): CoopDefenseEnemyTranslocatorConfig | undefined {
  if (!config) return undefined;
  if (config.utilityId !== 'TRANSLOCATOR') {
    throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} references unsupported translocator utility`);
  }
  const minRange = Math.max(0, config.minRange);
  return {
    utilityId: 'TRANSLOCATOR',
    flightTimeMs: Math.max(1, Math.floor(config.flightTimeMs)),
    cooldownMs: Math.max(1, Math.floor(config.cooldownMs)),
    minRange,
    maxRange: Math.max(minRange, config.maxRange),
  };
}

function normalizeCombatPositioningConfig(
  config: CoopDefenseEnemyCombatPositioningConfig | undefined,
): CoopDefenseEnemyCombatPositioningConfig | undefined {
  if (!config) return undefined;
  return {
    preferredDistancePx: Math.max(0, config.preferredDistancePx),
    toleranceP: Math.max(1, config.toleranceP),
    retreatSpeedFactor: Math.max(0, config.retreatSpeedFactor),
    requireLineOfSight: config.requireLineOfSight !== false,
  };
}

function normalizeDodgeConfig(
  config: CoopDefenseEnemyDodgeConfig | undefined,
): CoopDefenseEnemyDodgeConfig | undefined {
  if (!config) return undefined;
  return {
    enabledBelowHpRatio: config.enabledBelowHpRatio === undefined
      ? undefined
      : Math.max(0, Math.min(1, config.enabledBelowHpRatio)),
    cooldownMs: Math.max(1, Math.floor(config.cooldownMs)),
    evadeScanRadiusPx: Math.max(0, config.evadeScanRadiusPx),
    evadeLeadTimeMs: Math.max(0, Math.floor(config.evadeLeadTimeMs)),
    evadeMissMarginPx: Math.max(0, config.evadeMissMarginPx),
    approachMinDistancePx: Math.max(0, config.approachMinDistancePx),
    approachMaxDistancePx: Math.max(0, config.approachMaxDistancePx),
  };
}

function normalizeBurrowConfig(
  config: CoopDefenseEnemyBurrowConfig | undefined,
): CoopDefenseEnemyBurrowConfig | undefined {
  if (!config) return undefined;
  return {
    maxDurationMs: Math.max(1, Math.floor(config.maxDurationMs)),
    speedFactor: Math.max(0.05, config.speedFactor),
    spawnBurrowedAtLeftEdge: config.spawnBurrowedAtLeftEdge === true,
    spawnTunnelMinDistancePx: Math.max(0, config.spawnTunnelMinDistancePx),
    spawnTunnelTimeoutMs: Math.max(1, Math.floor(config.spawnTunnelTimeoutMs)),
    crossesTrainTracks: config.crossesTrainTracks === true,
  };
}

function normalizeSpawnThrowConfig(
  config: CoopDefenseEnemySpawnThrowConfig | undefined,
  enemyId: string,
): CoopDefenseEnemySpawnThrowConfig | undefined {
  if (!config) return undefined;
  if (typeof config.enemyKind !== 'string' || config.enemyKind.trim().length === 0) {
    throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} has an invalid spawn-throw enemy kind`);
  }
  const minRange = Math.max(0, config.minRange);
  return {
    displayName: config.displayName,
    enemyKind: config.enemyKind,
    count: Math.max(1, Math.floor(config.count)),
    spawnOffsetPx: Math.max(0, config.spawnOffsetPx),
    cooldownMs: Math.max(1, Math.floor(config.cooldownMs)),
    flightTimeMs: Math.max(1, Math.floor(config.flightTimeMs)),
    fuseTimeMs: Math.max(1, Math.floor(config.fuseTimeMs)),
    minRange,
    maxRange: Math.max(minRange, config.maxRange),
    projectileSpeed: Math.max(1, config.projectileSpeed),
    projectileSize: Math.max(1, config.projectileSize),
    maxBounces: Math.max(0, Math.floor(config.maxBounces)),
    color: Math.max(0, Math.floor(config.color)),
  };
}

function normalizeVoidFireChunkConfig(
  config: CoopDefenseEnemyVoidFireChunkConfig | undefined,
): CoopDefenseEnemyVoidFireChunkConfig | undefined {
  if (!config) return undefined;
  const intervalMinMs = Math.max(1, Math.floor(config.intervalMinMs));
  return {
    count: Math.max(0, Math.floor(config.count)),
    searchRadius: Math.max(0, config.searchRadius),
    flightMs: Math.max(1, Math.floor(config.flightMs)),
    igniteCenter: config.igniteCenter === true,
    durationMs: Math.max(0, Math.floor(config.durationMs)),
    burnDurationMs: Math.max(0, Math.floor(config.burnDurationMs)),
    burnDamagePerTick: Math.max(0, config.burnDamagePerTick),
    weaponName: config.weaponName,
    visualStyle: 'void',
    damageTarget: 'players',
    intervalMinMs,
    intervalMaxMs: Math.max(intervalMinMs, Math.floor(config.intervalMaxMs)),
  };
}

function normalizeVoidHunterBossConfig(
  config: CoopDefenseVoidHunterBossConfig | undefined,
  enemyId: string,
): CoopDefenseVoidHunterBossConfig | undefined {
  if (!config) return undefined;
  if (config.gauss.weaponId !== 'VOID_HUNTER_GAUSS') {
    throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} must use VOID_HUNTER_GAUSS`);
  }
  return {
    phaseTwoHpRatio: Math.max(0, Math.min(1, config.phaseTwoHpRatio)),
    phaseTwoSpeedMultiplier: Math.max(1, config.phaseTwoSpeedMultiplier),
    shotgunRangePx: Math.max(0, config.shotgunRangePx),
    gauss: {
      weaponId: 'VOID_HUNTER_GAUSS',
      initialDelayMs: Math.max(0, Math.floor(config.gauss.initialDelayMs)),
      cooldownMs: Math.max(1, Math.floor(config.gauss.cooldownMs)),
      chargeDurationMs: Math.max(1, Math.floor(config.gauss.chargeDurationMs)),
      aimUpdateIntervalMs: Math.max(1, Math.floor(config.gauss.aimUpdateIntervalMs)),
      maxAimTurnDegreesPerSecond: Math.max(1, config.gauss.maxAimTurnDegreesPerSecond),
    },
    nuke: {
      countdownMs: Math.max(1, Math.floor(config.nuke.countdownMs)),
      emergeDelayMs: Math.max(0, Math.floor(config.nuke.emergeDelayMs)),
      radiusPx: Math.max(1, config.nuke.radiusPx),
      maxDamage: Math.max(0, config.nuke.maxDamage),
      minDamage: Math.max(0, Math.min(config.nuke.maxDamage, config.nuke.minDamage)),
      fireChunkBurst: {
        ...config.nuke.fireChunkBurst,
        count: Math.max(0, Math.floor(config.nuke.fireChunkBurst.count)),
        visualStyle: 'void',
        damageTarget: 'players',
      },
    },
    armageddonDurationMs: Math.max(1, Math.floor(config.armageddonDurationMs)),
    armageddonCooldownMs: Math.max(1, Math.floor(config.armageddonCooldownMs)),
    armageddon: {
      ...config.armageddon,
      variant: 'void',
      meteorSpawnRadius: Math.max(0, config.armageddon.meteorSpawnRadius),
      meteorDamageRadius: Math.max(1, config.armageddon.meteorDamageRadius),
      meteorDamage: Math.max(0, config.armageddon.meteorDamage),
      meteorFallDuration: Math.max(1, Math.floor(config.armageddon.meteorFallDuration)),
      meteorsPerSecond: Math.max(0.1, config.armageddon.meteorsPerSecond),
      fireChunkBurst: {
        ...config.armageddon.fireChunkBurst,
        count: Math.max(0, Math.floor(config.armageddon.fireChunkBurst.count)),
        visualStyle: 'void',
        damageTarget: 'players',
      },
    },
  };
}

function normalizeVoidFireTrailConfig(
  config: CoopDefenseEnemyVoidFireTrailConfig | undefined,
): CoopDefenseEnemyVoidFireTrailConfig | undefined {
  if (!config) return undefined;
  return {
    durationMs: Math.max(0, Math.floor(config.durationMs)),
    burnDurationMs: Math.max(0, Math.floor(config.burnDurationMs)),
    burnDamagePerTick: Math.max(0, config.burnDamagePerTick),
    weaponName: config.weaponName,
    visualStyle: 'void',
    damageTarget: 'players',
  };
}

function normalizeStinkAuraConfig(
  config: CoopDefenseEnemyStinkAuraConfig | undefined,
  enemyId: string,
): CoopDefenseEnemyStinkAuraConfig | undefined {
  if (!config) return undefined;
  if (config.utilityId !== 'ENEMY_STINKDRUESEN') {
    throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} references unsupported stink aura utility`);
  }
  return { utilityId: config.utilityId };
}

function normalizeDeathSpawns(
  configs: readonly CoopDefenseEnemyDeathSpawnConfig[] | undefined,
  enemyId: string,
): readonly CoopDefenseEnemyDeathSpawnConfig[] | undefined {
  if (!configs) return undefined;
  return configs.map((config) => {
    if (typeof config.enemyKind !== 'string' || config.enemyKind.trim().length === 0) {
      throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} has an invalid death-spawn enemy kind`);
    }
    return {
      enemyKind: config.enemyKind,
      count: Math.max(0, Math.floor(config.count)),
      offsetPx: Math.max(0, config.offsetPx),
    };
  });
}

function normalizeWeapons(
  weapons: readonly CoopDefenseEnemyWeaponConfig[],
  enemyId: string,
): readonly CoopDefenseEnemyWeaponConfig[] {
  if (!Array.isArray(weapons) || weapons.length === 0) {
    throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} must have at least one weapon`);
  }

  const weaponIds = new Set<string>();
  return weapons.map((weapon) => {
    if (typeof weapon.weaponId !== 'string' || weapon.weaponId.trim().length === 0) {
      throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} has an invalid weapon id`);
    }
    if (weaponIds.has(weapon.weaponId)) {
      throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} has duplicate weapon ${weapon.weaponId}`);
    }
    weaponIds.add(weapon.weaponId);
    return {
      weaponId: weapon.weaponId,
      targetMode: normalizeWeaponTargetMode(weapon.targetMode, enemyId),
      minimumFireDurationMs: weapon.minimumFireDurationMs === undefined
        ? undefined
        : Math.max(0, Math.floor(weapon.minimumFireDurationMs)),
      playerMeleeWindupMs: weapon.playerMeleeWindupMs === undefined
        ? undefined
        : Math.max(0, Math.floor(weapon.playerMeleeWindupMs)),
    };
  });
}

function normalizeWeaponTargetMode(
  targetMode: CoopDefenseEnemyWeaponTargetMode,
  enemyId: string,
): CoopDefenseEnemyWeaponTargetMode {
  if (
    targetMode === 'all'
    || targetMode === 'players'
    || targetMode === 'rocks'
    || targetMode === 'structures'
  ) return targetMode;
  throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} has unsupported weapon target mode: ${String(targetMode)}`);
}

/** Fehlender oder ungueltiger Wert bedeutet normales Wegstoessen; negative Werte sind sinnlos. */
function normalizeKnockbackFactor(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_ENEMY_KNOCKBACK_FACTOR;
  return Math.max(0, value);
}

function normalizeMovementTarget(target: CoopDefenseEnemyMovementTarget): CoopDefenseEnemyMovementTarget {
  if (target === 'bases' || target === 'players' || target === 'players-and-armed-constructs') {
    return target;
  }
  throw new Error(`[coopDefenseEnemies] Unsupported movementTarget: ${String(target)}`);
}

function normalizeTimebombConfig(
  config: CoopDefenseEnemyTimebombConfig | undefined,
): CoopDefenseEnemyTimebombConfig | undefined {
  if (!config) return undefined;
  return {
    chaseSpeedMultiplier: Math.max(0.1, config.chaseSpeedMultiplier),
    activationRadiusPx: Math.max(1, config.activationRadiusPx),
    lineOfSightDurationMs: Math.max(0, Math.floor(config.lineOfSightDurationMs)),
    fuseDistancePx: Math.max(1, config.fuseDistancePx),
    fuseDurationMs: Math.max(1, Math.floor(config.fuseDurationMs)),
    explosionRadiusPx: Math.max(1, config.explosionRadiusPx),
    explosionDamage: Math.max(0, config.explosionDamage),
    explosionKnockback: Math.max(0, config.explosionKnockback),
    fireChunks: {
      ...config.fireChunks,
      count: Math.max(0, Math.floor(config.fireChunks.count)),
      searchRadius: Math.max(0, config.fireChunks.searchRadius),
      flightMs: Math.max(1, Math.floor(config.fireChunks.flightMs)),
      igniteCenter: config.fireChunks.igniteCenter === true,
      durationMs: Math.max(0, Math.floor(config.fireChunks.durationMs)),
      burnDurationMs: Math.max(0, Math.floor(config.fireChunks.burnDurationMs)),
      burnDamagePerTick: Math.max(0, config.fireChunks.burnDamagePerTick),
      visualStyle: 'void',
      damageTarget: 'players',
    },
    killedPopRadiusPx: Math.max(1, config.killedPopRadiusPx),
    killedPopDamage: Math.max(0, config.killedPopDamage),
  };
}

function normalizePlayerScaling(
  scaling: CoopDefenseEnemyPlayerScaling | undefined,
): CoopDefenseEnemyPlayerScaling | undefined {
  if (!scaling) return undefined;
  return {
    maxHpFactorPerAdditionalPlayer: normalizeCoopDefensePlayerScalingFactor(scaling.maxHpFactorPerAdditionalPlayer),
    moveSpeedFactorPerAdditionalPlayer: normalizeCoopDefensePlayerScalingFactor(scaling.moveSpeedFactorPerAdditionalPlayer),
  };
}

function normalizeSpawnScaling(
  scaling: CoopDefenseEnemySpawnScaling | undefined,
): CoopDefenseEnemySpawnScaling | undefined {
  if (!scaling) return undefined;
  return {
    intervalMsFactorPerAdditionalPlayer: normalizeCoopDefensePlayerScalingFactor(scaling.intervalMsFactorPerAdditionalPlayer),
    countPerTickFactorPerAdditionalPlayer: normalizeCoopDefensePlayerScalingFactor(scaling.countPerTickFactorPerAdditionalPlayer),
  };
}
