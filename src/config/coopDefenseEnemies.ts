import rawCoopDefenseEnemies from './coopDefenseEnemies.json';
import { normalizeKrakenBossConfig, normalizeKrakenEggConfig, validateKrakenBroodRegistry,
  type KrakenBossConfig, type KrakenEggConfig } from './krakenBoss';
import { findWeaponConfig } from '../loadout/LoadoutConfig';
import { requirePawCount, type PawCount } from './movementEffects';
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

/**
 * Salve statt Einzelschuss: `count` Schuesse im Abstand von `intervalMs`, danach ist die Waffe
 * fuer `cooldownMs` gesperrt. Der Salventakt laeuft bewusst neben dem Zielscan-Raster des
 * Gegners – sonst wuerde er auf dessen `attackScanIntervalMs` einrasten (analog `turretBurst`).
 */
export interface CoopDefenseEnemyWeaponSalvoConfig {
  readonly count: number;
  readonly intervalMs: number;
  readonly cooldownMs: number;
  /**
   * Optionales Zielmuster fuer Salven. `round_robin` prueft pro Geschoss alle gueltigen
   * Spielerziele neu und verteilt die Salve deterministisch auf sie.
   */
  readonly targetDistribution?: 'locked' | 'round_robin';
}

export interface CoopDefenseEnemyWeaponConfig {
  readonly weaponId: WeaponConfig['id'];
  readonly targetMode: CoopDefenseEnemyWeaponTargetMode;
  readonly minimumFireDurationMs?: number;
  readonly meleeTiming?: import('../systems/EnemyClawAttack').EnemyMeleeTiming;
  /**
   * Anteil der Laufgeschwindigkeit waehrend der Angriffspause dieser Waffe. Fehlt der Wert,
   * bleibt der Gegner wie bisher stehen (0). 1 bedeutet ungebremstes Weiterlaufen.
   */
  readonly attackMovementSpeedFactor?: number;
  /** Mindest-Zieldistanz; naeher gilt die Waffe als unpassend und eine andere uebernimmt. */
  readonly minTargetDistancePx?: number;
  readonly salvo?: CoopDefenseEnemyWeaponSalvoConfig;
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

/**
 * Lesbarkeit eines Bosses ohne HUD-Rahmen: umschwärmende Ambient-Glühwürmchen und seine
 * normalen Fußspuren, in der Bossfarbe leuchtend. Rein präsentational; Gameplay liest das nie.
 */
export interface CoopDefenseEnemyBossPresenceConfig {
  readonly fireflyCount: number;
  readonly footprintGlowColor: number;
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
  /** True: Gegner erscheint eingebuddelt am authored arena edge and tunnels inward. */
  readonly spawnBurrowedAtEdge: boolean;
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
 * Dauer und Kurve stammen aus den Gegner-Dash-Konstanten. Distanzmodi skalieren die
 * Geschwindigkeit bei gleicher Dauer; ohne Faktoren bleibt die bisherige Strecke erhalten.
 */
export interface CoopDefenseEnemyDodgeConfig {
  readonly distanceFactors?: { readonly short: number; readonly long: number };
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

/**
 * Gegnerischer Brandsatz auf Basis des Spieler-Molotovs. Radius, Schaden, Zuendzeit und
 * Flugphysik stammen aus der referenzierten Utility; hier stehen nur die KI-Werte – Einsatzband,
 * Cooldown und die lesbare Wurf-Standzeit. Die entstehende Flaeche uebernimmt die lila
 * Void-Brandfamilie und trifft ausschliesslich Spieler.
 */
export interface CoopDefenseEnemyVoidMolotovConfig {
  readonly utilityId: 'MOLOTOV_GRENADE';
  readonly minRange: number;
  readonly maxRange: number;
  readonly cooldownMs: number;
  /** Standzeit vor dem Wurf; macht die Aktion lesbar und bindet den Gegner sichtbar. */
  readonly windupMs: number;
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
export interface CoopDefenseEnemyMortarConfig {
  /** Forward distance from body center to muzzle, in world pixels; omitted means centered. */
  readonly muzzleForwardPx?: number;
  readonly minRangePx: number;
  readonly preferredRangeMinPx: number;
  readonly preferredRangeMaxPx: number;
  readonly coverSearchActivationMarginPx: number;
  readonly localSearchRadiusPx: number;
  readonly positionCandidateRings: number;
  readonly positionCandidateDirections: number;
  readonly maxLocalSearchCells: number;
  readonly topTargetCandidates: number;
  readonly threatScanRadiusPx: number;
  readonly maxCoverThreats: number;
  readonly playerThreatRangePx: number;
  readonly rangeQualityWeight: number;
  readonly coverQualityWeight: number;
  readonly exposurePenaltyWeight: number;
  readonly movementCostPerPx: number;
  readonly minRepositionImprovement: number;
  readonly threatCheckIntervalMs: number;
  readonly threatChangeDistancePx: number;
  readonly spacingSpeedFactor: number;
  readonly spacingProbeDistancePx: number;
  readonly positionArrivalTolerancePx: number;
  /** A player closer than this turns retreat into a committed bite rush. */
  readonly engageEnterPx: number;
  /** The rush ends only beyond this distance (hysteresis) and after `engageMinDwellMs`. */
  readonly engageExitPx: number;
  readonly engageMinDwellMs: number;
  /** Fraction of move speed used to close in on the engaged player. */
  readonly engageSpeedFactor: number;
  readonly maxRangePx: number;
  readonly windupMs: number;
  readonly flightMs: number;
  readonly postImpactDelayMs: number;
  readonly impactRadiusPx: number;
  readonly maxDamage: number;
  readonly minDamage: number;
  readonly baseDamageMult: number;
  readonly constructionDamageMult: number;
  readonly rockDamageMult: number;
  readonly trainDamageMult: number;
  readonly targetWeights: Readonly<Record<'base' | 'armedConstruct' | 'construct' | 'barrier' | 'player', number>>;
  readonly alliedTargetCandidateLimit: number;
  /** Relative density contribution of bosses; [0, 1] never gives them a bonus. */
  readonly alliedBossWeight: number;
  readonly overlapPenalty: number;
  readonly overlapMarginPx: number;
  readonly reevaluateIntervalMs: number;
}

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

export interface CoopDefenseEnemyFirestarterConfig {
  readonly positioning: {
    readonly minDistancePx: number;
    readonly maxDistancePx: number;
    readonly minDwellMs: number;
    readonly reevaluateIntervalMs: number;
    readonly movementCostPerPx: number;
    readonly minImprovement: number;
  };
  readonly charges: { readonly maxCharges: number; readonly rechargeIntervalMs: number };
  readonly fireballIntervalMs: number;
  readonly lance: { readonly telegraphMs: number; readonly commitMs: number; readonly cooldownMs: number; readonly rangePx: number };
  readonly crossAttackGapMs: number;
  readonly comboRadiusPx: number;
  /** Lance-tip socket from the asset, in game px: ahead of the body centre and to its right. */
  readonly muzzle: { readonly forwardPx: number; readonly sidePx: number };
  readonly fireballWeaponId: string;
  readonly lanceWeaponId: string;
  readonly biteWeaponId: string;
}

export interface CoopDefenseEnemyConfig {
  readonly firestarter?: CoopDefenseEnemyFirestarterConfig;
  readonly krakenBoss?: KrakenBossConfig;
  readonly krakenEgg?: KrakenEggConfig;
  readonly pawCount: PawCount;
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
  readonly color?: number;
  readonly glow?: CoopDefenseEnemyGlowConfig;
  readonly eyeGlow?: { readonly color: number };
  readonly bossPresence?: CoopDefenseEnemyBossPresenceConfig;
  readonly phaseTwoGlow?: CoopDefenseEnemyGlowConfig;
  readonly translocator?: CoopDefenseEnemyTranslocatorConfig;
  readonly burrow?: CoopDefenseEnemyBurrowConfig;
  readonly dodge?: CoopDefenseEnemyDodgeConfig;
  readonly combatPositioning?: CoopDefenseEnemyCombatPositioningConfig;
  readonly voidHunterBoss?: CoopDefenseVoidHunterBossConfig;
  readonly spawnThrow?: CoopDefenseEnemySpawnThrowConfig;
  readonly voidFireChunks?: CoopDefenseEnemyVoidFireChunkConfig;
  readonly voidFireTrail?: CoopDefenseEnemyVoidFireTrailConfig;
  readonly voidMolotov?: CoopDefenseEnemyVoidMolotovConfig;
  readonly timebomb?: CoopDefenseEnemyTimebombConfig;
  readonly mortar?: CoopDefenseEnemyMortarConfig;
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

/** Diagnostic-only activation; selected boss atlases are bound by the presentation residency.
 * __WHITE is an existing engine texture, never a legacy boss image/preload URL. */
export function registerKrakenDiagnosticEnemies(config: import('./krakenBoss').KrakenBossConfig): () => void {
  const bossKind = 'abyssal-kraken', eggKind = config.eggs.enemyKind;
  if (COOP_DEFENSE_ENEMY_CONFIGS[bossKind] || COOP_DEFENSE_ENEMY_CONFIGS[eggKind]) return () => {};
  const base = COOP_DEFENSE_ENEMY_CONFIGS[config.eggs.broodTable.entries[0].enemyKind];
  const registry = normalizeEnemyRegistry({ enemies: [
    ...Object.entries(COOP_DEFENSE_ENEMY_CONFIGS).map(([id, value]) => ({ id, ...value })),
    { ...base, id: bossKind, imageKey: '__WHITE', maxHp: 12000, size: config.bodyRadiusPx * 2,
      isBoss: true, weapons: [], krakenBoss: config, movementTarget: 'players', knockbackFactor: 0,
      playerScaling: undefined, spawnScaling: undefined },
    { ...base, id: eggKind, imageKey: '__WHITE', maxHp: config.eggs.maxHp, size: config.eggs.radiusPx * 2,
      moveSpeed: 0, xp: 0, weapons: [], knockbackFactor: 0, playerScaling: undefined, spawnScaling: undefined,
      krakenEgg: { assetId: config.assets.egg, stationary: true, drops: false, necromancy: false,
        countsForEncounter: false, navigation: false } },
  ] });
  for (const id of [bossKind, eggKind]) COOP_DEFENSE_ENEMY_CONFIGS[id] = registry[id];
  const kinds = COOP_DEFENSE_ENEMY_KINDS as string[];
  kinds.push(bossKind, eggKind);
  return () => {
    for (const id of [bossKind, eggKind]) {
      if (COOP_DEFENSE_ENEMY_CONFIGS[id] !== registry[id]) continue;
      delete COOP_DEFENSE_ENEMY_CONFIGS[id];
      const index = kinds.indexOf(id); if (index >= 0) kinds.splice(index, 1);
    }
  };
}

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
        moveSpeed: config.krakenEgg ? 0 : resolveCoopDefensePositiveNumber(
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
        pawCount: config.pawCount,
        spriteRotationOffsetDegrees: config.spriteRotationOffsetDegrees,
        isBoss: config.isBoss,
        color: config.color,
        glow: config.glow,
        eyeGlow: config.eyeGlow,
        bossPresence: config.bossPresence,
        phaseTwoGlow: config.phaseTwoGlow,
        translocator: config.translocator,
        burrow: config.burrow,
        dodge: config.dodge,
        combatPositioning: config.combatPositioning,
        voidHunterBoss: config.voidHunterBoss,
        krakenBoss: config.krakenBoss,
        krakenEgg: config.krakenEgg,
        spawnThrow: config.spawnThrow,
        voidFireChunks: config.voidFireChunks,
        voidFireTrail: config.voidFireTrail,
        voidMolotov: config.voidMolotov,
        timebomb: config.timebomb,
        mortar: config.mortar ? { ...config.mortar, targetWeights: { ...config.mortar.targetWeights } } : undefined,
        firestarter: config.firestarter ? { ...config.firestarter, charges: { ...config.firestarter.charges }, lance: { ...config.firestarter.lance } } : undefined,
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

export function normalizeEnemyRegistry(registry: CoopDefenseEnemyRegistryFile): Record<string, CoopDefenseEnemyConfig> {
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
    if (config.krakenBoss) {
      validateKrakenBroodRegistry(config.krakenBoss, byId, id => findWeaponConfig(id)?.fire.type === 'melee', MAX_REGULAR_ENEMY_SIZE_PX);
      const egg = byId[config.krakenBoss.eggs.enemyKind];
      if (!egg?.krakenEgg || egg.krakenEgg.assetId !== config.krakenBoss.assets.egg) {
        throw new Error(`[coopDefenseEnemies] Invalid kraken egg reference: ${enemyId}`);
      }
    }
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
  const krakenBoss = enemy.krakenBoss === undefined ? undefined : normalizeKrakenBossConfig(enemy.krakenBoss);
  const krakenEgg = enemy.krakenEgg === undefined ? undefined : normalizeKrakenEggConfig(enemy.krakenEgg);
  if ((krakenBoss || krakenEgg) && (enemy.voidHunterBoss || enemy.timebomb || enemy.spawnThrow
    || enemy.translocator || enemy.burrow || enemy.dodge || enemy.combatPositioning
    || enemy.voidFireChunks || enemy.voidFireTrail || enemy.voidMolotov || enemy.stinkAura || enemy.deathSpawns?.length)) {
    throw new Error(`[coopDefenseEnemies] Conflicting kraken ability owner: ${enemy.id}`);
  }
  if ((krakenBoss && (!isBoss || krakenEgg || enemy.weapons.length || enemy.size !== krakenBoss.bodyRadiusPx * 2))
    || (krakenEgg && (isBoss || enemy.weapons.length || enemy.moveSpeed !== 0 || enemy.xp !== 0 || enemy.deathSpawns?.length))) {
    throw new Error(`[coopDefenseEnemies] Invalid exclusive kraken role: ${enemy.id}`);
  }
  if (!isBoss && enemy.size > MAX_REGULAR_ENEMY_SIZE_PX) {
    throw new Error(
      `[coopDefenseEnemies] Regular enemy ${enemy.id} exceeds ${MAX_REGULAR_ENEMY_SIZE_PX}px: configured size ${enemy.size}px`,
    );
  }

  return {
    maxHp: Math.max(1, Math.floor(enemy.maxHp)),
    xp: Math.max(0, Math.floor(enemy.xp)),
    size: Math.max(1, enemy.size),
    moveSpeed: krakenEgg ? 0 : Math.max(1, enemy.moveSpeed),
    knockbackFactor: normalizeKnockbackFactor(enemy.knockbackFactor),
    movementTarget: normalizeMovementTarget(enemy.movementTarget),
    weapons: krakenBoss || krakenEgg ? [] : normalizeWeapons(enemy.weapons, enemy.id),
    krakenBoss,
    krakenEgg,
    attackScanIntervalMs: Math.max(1, Math.floor(enemy.attackScanIntervalMs)),
    attackStopDurationMs: Math.max(0, Math.floor(enemy.attackStopDurationMs)),
    obstacleAttackDelayMs: Math.max(0, Math.floor(enemy.obstacleAttackDelayMs)),
    imageKey: enemy.imageKey,
    pawCount: requirePawCount(enemy.pawCount, enemy.id),
    spriteRotationOffsetDegrees: typeof enemy.spriteRotationOffsetDegrees === 'number'
      && Number.isFinite(enemy.spriteRotationOffsetDegrees)
      ? enemy.spriteRotationOffsetDegrees
      : undefined,
    isBoss,
    color: typeof enemy.color === 'number' && Number.isFinite(enemy.color)
      ? Math.max(0, Math.floor(enemy.color))
      : undefined,
    glow: normalizeGlowConfig(enemy.glow),
    eyeGlow: normalizeEyeGlowConfig(enemy.eyeGlow),
    bossPresence: normalizeBossPresenceConfig(enemy.bossPresence),
    phaseTwoGlow: normalizeGlowConfig(enemy.phaseTwoGlow),
    translocator: normalizeTranslocatorConfig(enemy.translocator, enemy.id),
    burrow: normalizeBurrowConfig(enemy.burrow),
    dodge: normalizeDodgeConfig(enemy.dodge),
    combatPositioning: normalizeCombatPositioningConfig(enemy.combatPositioning),
    voidHunterBoss: normalizeVoidHunterBossConfig(enemy.voidHunterBoss, enemy.id),
    spawnThrow: normalizeSpawnThrowConfig(enemy.spawnThrow, enemy.id),
    voidFireChunks: normalizeVoidFireChunkConfig(enemy.voidFireChunks),
    voidFireTrail: normalizeVoidFireTrailConfig(enemy.voidFireTrail),
    voidMolotov: normalizeVoidMolotovConfig(enemy.voidMolotov, enemy.id),
    timebomb: normalizeTimebombConfig(enemy.timebomb),
    mortar: normalizeMortarConfig(enemy.mortar),
    firestarter: normalizeFirestarterConfig(enemy.firestarter),
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

function normalizeBossPresenceConfig(
  value: CoopDefenseEnemyBossPresenceConfig | undefined,
): CoopDefenseEnemyBossPresenceConfig | undefined {
  if (value === undefined) return undefined;
  const valid = Number.isInteger(value.fireflyCount) && value.fireflyCount >= 0 && value.fireflyCount <= 32
    && Number.isInteger(value.footprintGlowColor) && value.footprintGlowColor > 0 && value.footprintGlowColor <= 0xffffff;
  if (!valid) throw new Error('[coopDefenseEnemies] Invalid boss presence config');
  return { fireflyCount: value.fireflyCount, footprintGlowColor: value.footprintGlowColor };
}

function normalizeEyeGlowConfig(value: { readonly color: number } | undefined): { readonly color: number } | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value.color) || value.color < 0 || value.color > 0xffffff) {
    throw new Error('[coopDefenseEnemies] Invalid eye glow color');
  }
  return { color: value.color };
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

export function normalizeDodgeConfig(
  config: CoopDefenseEnemyDodgeConfig | undefined,
): CoopDefenseEnemyDodgeConfig | undefined {
  if (!config) return undefined;
  const factors = config.distanceFactors ?? { short: 1, long: 1 };
  if (!Number.isFinite(factors.short) || !Number.isFinite(factors.long)
    || factors.short <= 0 || factors.long < factors.short) throw new Error('Invalid dodge distance relation');
  return {
    distanceFactors: { ...factors },
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
    spawnBurrowedAtEdge: config.spawnBurrowedAtEdge === true,
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
    sourceId: config.sourceId,
    visualStyle: 'void',
    damageTarget: 'players',
    intervalMinMs,
    intervalMaxMs: Math.max(intervalMinMs, Math.floor(config.intervalMaxMs)),
  };
}

function normalizeVoidMolotovConfig(
  config: CoopDefenseEnemyVoidMolotovConfig | undefined,
  enemyId: string,
): CoopDefenseEnemyVoidMolotovConfig | undefined {
  if (!config) return undefined;
  if (config.utilityId !== 'MOLOTOV_GRENADE') {
    throw new Error(`[coopDefenseEnemies] Enemy ${enemyId} references unsupported void molotov utility`);
  }
  const minRange = Math.max(0, config.minRange);
  return {
    utilityId: 'MOLOTOV_GRENADE',
    minRange,
    maxRange: Math.max(minRange, config.maxRange),
    cooldownMs: Math.max(1, Math.floor(config.cooldownMs)),
    windupMs: Math.max(0, Math.floor(config.windupMs)),
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
    sourceId: config.sourceId,
    visualStyle: 'void',
    damageTarget: 'players',
  };
}

function normalizeStinkAuraConfig(
  config: CoopDefenseEnemyStinkAuraConfig | undefined,
  enemyId: string,
): CoopDefenseEnemyStinkAuraConfig | undefined {
  if (!config) return undefined;
  if (config.utilityId !== 'ENEMY_STINK_CLOUD') {
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
      meleeTiming: normalizeMeleeTiming(weapon.meleeTiming),
      attackMovementSpeedFactor: weapon.attackMovementSpeedFactor === undefined
        ? undefined
        : Math.max(0, Math.min(1, weapon.attackMovementSpeedFactor)),
      minTargetDistancePx: weapon.minTargetDistancePx === undefined
        ? undefined
        : Math.max(0, weapon.minTargetDistancePx),
      salvo: normalizeWeaponSalvoConfig(weapon.salvo),
    };
  });
}

function normalizeMeleeTiming(timing: CoopDefenseEnemyWeaponConfig['meleeTiming']): CoopDefenseEnemyWeaponConfig['meleeTiming'] {
  if (!timing) return undefined;
  if (![timing.hitDelayMs, timing.strikeMs, timing.recoveryMs].every(value => Number.isFinite(value) && value > 0)
    || timing.strikeMs >= timing.hitDelayMs) throw new Error('[coopDefenseEnemies] Invalid melee timing');
  return { ...timing };
}

function normalizeWeaponSalvoConfig(
  config: CoopDefenseEnemyWeaponSalvoConfig | undefined,
): CoopDefenseEnemyWeaponSalvoConfig | undefined {
  if (!config) return undefined;
  if (config.targetDistribution !== undefined
    && config.targetDistribution !== 'locked'
    && config.targetDistribution !== 'round_robin') {
    throw new Error(`[coopDefenseEnemies] Unsupported salvo target distribution: ${String(config.targetDistribution)}`);
  }
  return {
    count: Math.max(1, Math.floor(config.count)),
    intervalMs: Math.max(1, Math.floor(config.intervalMs)),
    cooldownMs: Math.max(1, Math.floor(config.cooldownMs)),
    targetDistribution: config.targetDistribution ?? 'locked',
  };
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

export function normalizeMortarConfig(config: CoopDefenseEnemyMortarConfig | undefined): CoopDefenseEnemyMortarConfig | undefined {
  if (!config) return undefined;
  const normalized = { ...config, muzzleForwardPx: config.muzzleForwardPx ?? 0, trainDamageMult: config.trainDamageMult ?? 0, targetWeights: { ...config.targetWeights } };
  for (const key of ['muzzleForwardPx', 'minRangePx', 'preferredRangeMinPx', 'maxRangePx', 'windupMs', 'flightMs',
    'postImpactDelayMs', 'impactRadiusPx', 'maxDamage', 'minDamage', 'baseDamageMult',
    'constructionDamageMult', 'rockDamageMult', 'trainDamageMult', 'overlapPenalty', 'overlapMarginPx', 'reevaluateIntervalMs',
    'preferredRangeMaxPx', 'coverSearchActivationMarginPx', 'localSearchRadiusPx', 'positionCandidateRings',
    'positionCandidateDirections', 'maxLocalSearchCells', 'topTargetCandidates', 'threatScanRadiusPx', 'maxCoverThreats',
    'playerThreatRangePx', 'rangeQualityWeight', 'coverQualityWeight', 'exposurePenaltyWeight', 'movementCostPerPx',
    'minRepositionImprovement', 'threatCheckIntervalMs', 'threatChangeDistancePx', 'spacingSpeedFactor',
    'spacingProbeDistancePx', 'positionArrivalTolerancePx', 'engageEnterPx', 'engageExitPx', 'engageMinDwellMs',
    'engageSpeedFactor'] as const) {
    const value = normalized[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid mortar.${key}`);
  }
  for (const key of ['base', 'armedConstruct', 'construct', 'barrier', 'player'] as const) {
    if (!Number.isFinite(normalized.targetWeights[key]) || normalized.targetWeights[key] <= 0) throw new Error(`Invalid mortar.targetWeights.${key}`);
  }
  if (!Number.isSafeInteger(config.alliedTargetCandidateLimit) || config.alliedTargetCandidateLimit < 1)
    throw new Error('Invalid mortar.alliedTargetCandidateLimit');
  if (!Number.isFinite(config.alliedBossWeight) || config.alliedBossWeight < 0 || config.alliedBossWeight > 1)
    throw new Error('Invalid mortar.alliedBossWeight');
  for (const [key, cap] of [['positionCandidateRings', 4], ['positionCandidateDirections', 16],
    ['maxLocalSearchCells', 4096], ['topTargetCandidates', 5], ['maxCoverThreats', 6]] as const) {
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > cap) throw new Error(`Invalid mortar.${key}`);
  }
  if (!(config.minRangePx < config.preferredRangeMinPx && config.preferredRangeMinPx <= config.preferredRangeMaxPx
    && config.preferredRangeMaxPx <= config.maxRangePx)
    || config.localSearchRadiusPx <= 0 || config.threatScanRadiusPx < config.minRangePx
    || config.playerThreatRangePx < config.minRangePx || config.threatCheckIntervalMs <= 0
    || config.threatChangeDistancePx <= 0 || config.spacingSpeedFactor > 1
    || config.spacingProbeDistancePx <= 0 || config.positionArrivalTolerancePx <= 0
    || !(config.engageEnterPx > 0 && config.engageEnterPx < config.engageExitPx && config.engageExitPx <= config.minRangePx)
    || config.engageSpeedFactor <= 0 || config.engageSpeedFactor > 1.5
    || config.windupMs <= 0 || config.flightMs <= 0 || config.impactRadiusPx <= 0
    || config.reevaluateIntervalMs <= 0 || config.minDamage > config.maxDamage) throw new Error('Invalid mortar ranges, timing or damage');
  return normalized;
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

/** Reject malformed timing and mismatched weapon roles at the authored boundary. */
export function normalizeFirestarterConfig(config: CoopDefenseEnemyFirestarterConfig | undefined): CoopDefenseEnemyFirestarterConfig | undefined {
  if (!config) return undefined;
  if (!config.charges || !config.lance) throw new Error('Invalid firestarter timing blocks');
  const positioning = config.positioning;
  if (!positioning || [positioning.minDistancePx, positioning.maxDistancePx, positioning.minDwellMs,
    positioning.reevaluateIntervalMs, positioning.movementCostPerPx, positioning.minImprovement]
    .some(value => !Number.isFinite(value) || value <= 0)
    || positioning.minDistancePx >= positioning.maxDistancePx
    || positioning.maxDistancePx > config.lance.rangePx
    || positioning.reevaluateIntervalMs > positioning.minDwellMs
    || positioning.minImprovement >= 1) throw new Error('Invalid firestarter positioning relation');
  for (const value of [config.charges.maxCharges, config.charges.rechargeIntervalMs, config.fireballIntervalMs,
    config.lance.telegraphMs, config.lance.commitMs, config.lance.cooldownMs, config.lance.rangePx, config.comboRadiusPx]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid firestarter positive value');
  }
  if (!Number.isSafeInteger(config.charges.maxCharges) || !Number.isFinite(config.crossAttackGapMs)
    || config.crossAttackGapMs < 0 || config.lance.commitMs > config.lance.telegraphMs
    || config.comboRadiusPx > config.lance.rangePx) throw new Error('Invalid firestarter timing/range relation');
  if (!config.muzzle || !Number.isFinite(config.muzzle.forwardPx) || !Number.isFinite(config.muzzle.sidePx)
    || config.muzzle.forwardPx < 0) throw new Error('Invalid firestarter muzzle socket');
  const ball = findWeaponConfig(config.fireballWeaponId);
  const lance = findWeaponConfig(config.lanceWeaponId);
  const bite = findWeaponConfig(config.biteWeaponId);
  if (ball?.fire.type !== 'projectile' || !ball.detonable
    || lance?.fire.type !== 'hitscan' || !lance.detonator?.stopsAtDetonable
    || !lance.detonator.triggerTags.includes(ball.detonable.tag) || bite?.fire.type !== 'melee'
    || lance.range !== config.lance.rangePx) throw new Error('Invalid firestarter weapon relation');
  return { ...config, positioning: { ...positioning }, charges: { ...config.charges }, lance: { ...config.lance }, muzzle: { ...config.muzzle } };
}

/**
 * Lance aim through a fixed world point: the shot leaves the lance tip and passes the point.
 * The tip sits `sidePx` beside the body axis, so the aim turns by asin(side / distance);
 * the forward offset only moves the origin along the line.
 */
export function resolveFirestarterAim(
  muzzle: CoopDefenseEnemyFirestarterConfig['muzzle'], x: number, y: number, targetX: number, targetY: number,
): { readonly angle: number; readonly x: number; readonly y: number } {
  const reach = Math.hypot(targetX - x, targetY - y);
  const turn = reach > Math.abs(muzzle.sidePx) ? Math.asin(muzzle.sidePx / reach) : 0;
  const angle = Math.atan2(targetY - y, targetX - x) - turn;
  const origin = resolveFirestarterMuzzle(muzzle, x, y, angle);
  return { angle, x: origin.x, y: origin.y };
}

/** World position of the lance tip for a body at (x, y) aiming along `angle`. */
export function resolveFirestarterMuzzle(
  muzzle: CoopDefenseEnemyFirestarterConfig['muzzle'], x: number, y: number, angle: number,
): { readonly x: number; readonly y: number } {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: x + cos * muzzle.forwardPx - sin * muzzle.sidePx, y: y + sin * muzzle.forwardPx + cos * muzzle.sidePx };
}
