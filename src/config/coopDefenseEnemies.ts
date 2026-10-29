import rawCoopDefenseEnemies from './coopDefenseEnemies.json';
import { DAWN_SCRAP_DEFS } from '../powerups/PowerUpConfig';
import { KRAKEN_BOSS_DEFAULTS, normalizeKrakenBossConfig, normalizeKrakenEggConfig, validateKrakenBroodRegistry,
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

export type CoopDefenseEnemyMovementTarget = 'bases' | 'players' | 'players-and-armed-constructs' | 'flee';

export interface CoopDefenseEnemyFleeConfig {
  readonly playerAvoidanceRadiusPx: number;
  readonly arrivalRadiusPx: number;
  /** The pickup definition owns the scrap amount and visual tier. */
  readonly scrapPickupDefId: string;
}

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
  /** Visual muzzle ahead of the body centre along its aim (e.g. a mouth); gameplay still fires from the centre. */
  readonly muzzleForwardPx?: number;
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

/**
 * Kabummtula: hunting kamikaze spider. On sight it holds a short threat pose, rushes faster than a
 * player in a spider-like skitter, telegraphs a leap out of the run and explodes on any contact.
 * Opportunistically it spits webs that disable nearby turrets for a few seconds.
 */
export interface CoopDefenseEnemyKaboomtulaConfig {
  /** A visible target inside this distance starts the alert pose. */
  readonly activationRadiusPx: number;
  /** Threat pause before the rush (the body stands still facing the target). */
  readonly alertMs: number;
  /** Rush speed in px/s; must beat the player's run speed on average, skitter included. */
  readonly rushSpeedPx: number;
  /** A rush that has not reached its target after this long gives up and recovers. */
  readonly rushMaxMs: number;
  /** The rush survives a target out of sight for this long (corners, smoke) before it recovers. */
  readonly lostSightGraceMs: number;
  readonly skitter: {
    /** One full left-right weave lasts within [weavePeriodMinMs, weavePeriodMaxMs], fixed per body. */
    readonly weavePeriodMinMs: number;
    readonly weavePeriodMaxMs: number;
    /** Peak offset of the weave from the route heading (< 90). */
    readonly weaveDegrees: number;
    /** Speed swing of the scurry rhythm: 1 ± surge, fastest while crossing the route. */
    readonly surge: number;
    /** Share of the weave the body turns into; the rest it keeps facing its prey. */
    readonly facingLean: number;
    /** Within this distance of the target the weave amplitude fades so the spider closes in reliably. */
    readonly calmWithinPx: number;
    /** Distance of the steering point along the weave direction. */
    readonly probePx: number;
  };
  readonly pounce: {
    /** The telegraph starts once the rushing spider is this close to a player or decoy. */
    readonly triggerPx: number;
    readonly telegraphMs: number;
    /** No new telegraph this long after a cancelled one. */
    readonly cancelLockoutMs: number;
  };
  readonly leap: {
    /** Fixed flight time of every leap; the lane length sets the speed. */
    readonly airMs: number;
    /** Share of the target's velocity x (telegraphMs + airMs) the lane committed at the telegraph start leads (0 = aim at the current position). */
    readonly leadFactor: number;
    /** The lane continues this far beyond the aim point ... */
    readonly overshootPx: number;
    /** ... but never longer than this (before world-geometry clipping). */
    readonly maxLengthPx: number;
  };
  /** Stationary recovery after a missed leap; afterwards the hunt restarts with a new alert. */
  readonly recoverMs: number;
  /** Extra reach of the body contact on top of both radii (absorbs frame timing only). */
  readonly contactMarginPx: number;
  readonly blast: {
    readonly radiusPx: number;
    /** Full damage for the touched target; everything else in the radius takes a distance falloff. */
    readonly damage: number;
    /** Damage to a base the spider detonated against (kamikaze). */
    readonly baseDamage: number;
    readonly knockback: number;
    readonly fireChunks?: FireChunkBurstConfig;
  };
  /** Small pop when the spider is killed: players and decoys only. */
  readonly killedPop: { readonly radiusPx: number; readonly damage: number };
  readonly web: {
    readonly rangePx: number;
    /** Stationary spit windup; the web leaves the fangs at its end. */
    readonly windupMs: number;
    /** Stationary follow-through after the spit. */
    readonly tailMs: number;
    readonly flightMs: number;
    /** Disable time of a webbed turret; a new web refreshes it instead of stacking. */
    readonly durationMs: number;
    readonly cooldownMs: number;
    /** A webbed turret is only re-webbed once less than this remains. */
    readonly refreshWindowMs: number;
    /** Retry lock after a cancelled spit. */
    readonly lockoutMs: number;
    /** Fang position ahead of the body centre in game px. */
    readonly mouthForwardPx: number;
  };
}

/**
 * A player hunter that prefers the base when the base is much cheaper to reach than every player
 * (or no player is reachable). Hysteresis keeps it from flip-flopping; a visible nearby player
 * always wins.
 */
export interface CoopDefenseEnemyBasePreferenceConfig {
  readonly playerCostRatio: number;
  /** Committed to the base, it returns to players only once their cost drops below this ratio. */
  readonly releaseCostRatio: number;
  readonly minDwellMs: number;
  readonly playerOverridePx: number;
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

/** Schild-Anstürmer: frontal shield while approaching, telegraphed straight charge, recovery window. */
export interface CoopDefenseEnemyShieldChargerConfig {
  /** Full blocking arc of the raised shield in degrees (player energy shield: 120); 0 = no shield (a leap). */
  readonly shieldArcDegrees: number;
  /** Presentation of the run: a shielded charge or a leap through the air (same lane, timing and path damage). */
  readonly style?: 'shield' | 'leap';
  /** Share of hitDamage dealt to friendly bases and constructions the run passes through (default 0). */
  readonly structureDamageMult?: number;
  /** A charge may start only with the target inside this distance band (centre to centre). */
  readonly triggerMinDistancePx: number;
  readonly triggerMaxDistancePx: number;
  /** The body must already face the target within this tolerance; no instant turn at the start. */
  readonly alignToleranceDegrees: number;
  /** Shield down, lane fixed, attackable. */
  readonly windupMs: number;
  readonly runSpeedPx: number;
  /** The lane continues this far beyond the target point captured at the start ... */
  readonly overshootPx: number;
  /** ... but never longer than this (before world-geometry clipping). */
  readonly maxRunPx: number;
  readonly recoverMs: number;
  /** Next charge earliest this long after the previous run started. */
  readonly cooldownMs: number;
  /** Retry lock after a cancelled windup or run (stun, displacement). */
  readonly cancelLockoutMs: number;
  /** Being pushed farther than this during the windup cancels it. */
  readonly windupDisplacementCancelPx: number;
  readonly hitDamage: number;
  /** Knockback recoil speed (px/s) and duration given to a struck target. */
  readonly hitKnockbackSpeed: number;
  readonly hitKnockbackMs: number;
}

/**
 * Energie-Fächer: stationary, telegraphed filled circular sector fired once at `hitAt`. Separate
 * from the regular weapon priority so ranged weapons stay available outside the windup and recovery.
 */
export interface CoopDefenseEnemyEnergyConeConfig {
  /** A cone may start only with the target inside this distance band (centre to centre). */
  readonly triggerMinDistancePx: number;
  readonly triggerMaxDistancePx: number;
  /** Full opening angle in degrees. */
  readonly arcDegrees: number;
  /** Reach of the impulse before cover clipping. */
  readonly rangePx: number;
  /** Visible warning; origin, direction and range are fixed at its start. */
  readonly windupMs: number;
  /** Stationary pause after the impulse before regular attacks and movement resume. */
  readonly recoverMs: number;
  /** Next cone earliest this long after the previous impulse. */
  readonly cooldownMs: number;
  /** Retry lock after a cancelled windup (stun, burrow, displacement). */
  readonly cancelLockoutMs: number;
  /** Being pushed farther than this during the windup cancels it. */
  readonly windupDisplacementCancelPx: number;
  /** Host refresh interval of the replicated cover profile during the windup. */
  readonly coverRefreshMs: number;
  readonly damage: number;
}

/** Swims through water when that route is faster: submerged (untargetable, no attacks) until it surfaces at a shore. */
export interface CoopDefenseEnemyAmphibiousConfig {
  /** Speed multiplier while submerged; the swim route is costed with the same ratio. */
  readonly swimSpeedFactor: number;
}

/** A siege enemy turns on a nearby player and returns to the base once the player is gone (mortar-style hysteresis). */
export interface CoopDefenseEnemyEngageConfig {
  readonly enterPx: number;
  readonly exitPx: number;
  /** An engaged player is kept at least this long, even beyond exitPx. */
  readonly minDwellMs: number;
}

/** Area burst at the death position: full damage to players and allies, structureDamageMult to bases and constructions. */
export interface CoopDefenseEnemyDeathBurstConfig {
  readonly radiusPx: number;
  readonly damage: number;
  readonly structureDamageMult: number;
  /** Splash look; ink (default) is the brood's goo, plague the toad's rot. */
  readonly presentation?: 'ink' | 'plague';
}

/** Upper bound of replicated heal links per hopping healer (wire cap). */
export const MAX_HOP_HEAL_LINKS = 6;

/** Heal channel of a resting hopper: links to the most injured allies in reach, ticking while it stands. */
export interface CoopDefenseEnemyHopHealConfig {
  readonly radiusPx: number;
  readonly maxLinks: number;
  readonly healPerTick: number;
  readonly tickIntervalMs: number;
}

/** Area hit of an announced landing: full damage at the centre, half at the edge; the push moves players only. */
export interface CoopDefenseEnemyLandingImpactConfig {
  readonly radiusPx: number;
  readonly damage: number;
  readonly knockbackSpeed: number;
  readonly knockbackMs: number;
}

/** Splash at a landing point that a player stood near when the hop was decided. */
export interface CoopDefenseEnemyLandingShockConfig extends CoopDefenseEnemyLandingImpactConfig {
  /** A player this close to the landing point at take-off arms (and telegraphs) the shock. */
  readonly armRadiusPx: number;
}

/** Landing choice weights: route progress, heal value and penalties for turning away and crowding. */
export interface CoopDefenseEnemyHopWeights {
  readonly progress: number;
  readonly heal: number;
  readonly deviation: number;
  readonly crowd: number;
}

/**
 * Hop locomotion: crouch, airborne arc, landing, then an adaptive rest. Hop distance scales with the
 * body's current move speed relative to the authored one; the rest is the only heal window.
 */
export interface CoopDefenseEnemyHopConfig {
  readonly minHopPx: number;
  readonly maxHopPx: number;
  readonly crouchMs: number;
  readonly airMs: number;
  readonly landMs: number;
  /** Rest without anything to heal or attack before the next hop. */
  readonly breathMs: number;
  /** Hard cap of one rest; the body must hop on afterwards. */
  readonly restMaxMs: number;
  /** Wait before retrying when no landing point was valid. */
  readonly retryMs: number;
  readonly fanHalfAngleDeg: number;
  readonly fanSteps: number;
  readonly weights: CoopDefenseEnemyHopWeights;
  /** Without heal value a landing must reach this share of the best available progress. */
  readonly minProgressShare: number;
  /** With heal value a landing may lose at most this much route progress (ground pixels). */
  readonly maxRegressPx: number;
  readonly crouchDisplacementCancelPx: number;
  readonly cancelLockoutMs: number;
  readonly heal?: CoopDefenseEnemyHopHealConfig;
  readonly landingShock?: CoopDefenseEnemyLandingShockConfig;
}

/** Bounding run: the speed pulses once per bound around the authored speed; the mean stays. */
export interface CoopDefenseEnemyBoundingGaitConfig {
  readonly periodMinMs: number;
  readonly periodMaxMs: number;
  /** Pulse amplitude as a share of the speed, in [0, 0.9). */
  readonly surge: number;
}

/** Sharp side-cuts of a body running at its target while no attack holds it. */
export interface CoopDefenseEnemySideCutConfig {
  readonly intervalMinMs: number;
  readonly intervalMaxMs: number;
  readonly angleMinDeg: number;
  readonly angleMaxDeg: number;
  readonly durationMs: number;
  /** Cuts stop once the target is this close, so the bite is not delayed. */
  readonly minTargetDistancePx: number;
}

/**
 * Targeted attack jump: the body stands and aims (the landing zone follows the target's predicted
 * path), locks the landing point, flies on a fixed line and hits the announced zone on arrival.
 * Between pounces the body runs and bites normally.
 */
export interface CoopDefenseEnemyPounceConfig {
  readonly minRangePx: number;
  readonly maxRangePx: number;
  readonly aimMs: number;
  /** Fixed zone before the take-off: the dodge window starts here. */
  readonly lockMs: number;
  /** Nominal flight speed; the air time is the lane length at this speed within [airMinMs, airMaxMs]. */
  readonly airSpeedPx: number;
  readonly airMinMs: number;
  readonly airMaxMs: number;
  readonly recoverMs: number;
  readonly cooldownMinMs: number;
  readonly cooldownMaxMs: number;
  /** Grace after the first sighting of a body before its first pounce. */
  readonly initialDelayMs: number;
  /** Share of the target's predicted travel until the landing added to the landing point (1 = full lead). */
  readonly leadFactor: number;
  readonly maxLeadPx: number;
  /** The lead of the aim point turns at most this fast (px/s), so the zone does not flip with every change of direction. */
  readonly aimTrackSpeedPx: number;
  /** An aiming body yields to the bite when its target comes this close. */
  readonly closeCancelPx: number;
  /** An aim survives a target out of sight this long (a pillar, smoke) before it is dropped. */
  readonly lostSightGraceMs: number;
  readonly cancelDisplacementPx: number;
  readonly cancelLockoutMs: number;
  readonly impact: CoopDefenseEnemyLandingImpactConfig;
  /** At most `maxPerTarget` bodies aim at or fly to one target; their aims start `staggerMs` apart. */
  readonly pack: { readonly maxPerTarget: number; readonly staggerMs: number };
  readonly gait?: CoopDefenseEnemyBoundingGaitConfig;
  readonly sideCuts?: CoopDefenseEnemySideCutConfig;
}

/** Area hit of a heat burst around the body; structures take their own multipliers, rocks never. */
export interface CoopDefenseEnemyHeatBurstImpactConfig {
  readonly radiusPx: number;
  readonly damage: number;
  /** Damage at the edge of the radius (linear falloff from `damage` in the centre). */
  readonly minDamage: number;
  /** Push for players only. */
  readonly knockbackSpeed: number;
  readonly knockbackMs: number;
  readonly friendlyBaseDamageMult: number;
  readonly constructionDamageMult: number;
  readonly trainDamageMult: number;
}

/**
 * Heat cycle of a body that charges while it runs and releases the heat as a burst around itself.
 * Charging raises its speed; a full body announces the burst with the shared red zone that travels
 * with it, bursts, cools down and charges again. Bursts of nearby bodies roll through a pack in a
 * fixed order (cascade), never at once. A full body nobody can see holds its heat.
 */
export interface CoopDefenseEnemyHeatBurstConfig {
  /** Charge time from cold to full; each body gets its own value in this range (hashed from its id). */
  readonly chargeMinMs: number;
  readonly chargeMaxMs: number;
  readonly telegraphMs: number;
  /** Cold phase right after a burst: heat 0 and the ordinary speed. */
  readonly ventMs: number;
  /** Grace after the first sighting of a body before its first charge completes. */
  readonly initialDelayMs: number;
  /** Speed share added at full heat (0.6 = ×1.6). */
  readonly speedBoost: number;
  /** Ease of the speed rise: boost × heat^exponent. */
  readonly speedCurveExponent: number;
  readonly cascade: {
    /** Bursts sit on a shared grid of this step; two bodies within `neighbourRadiusPx` never share a slot. */
    readonly stepMs: number;
    /** Per-body offset in [-jitterMs, jitterMs] on its slot, so the rhythm is not mechanical. */
    readonly jitterMs: number;
    readonly neighbourRadiusPx: number;
    /** Bursts per grid slot across the whole world (bounds the effect rate of large waves). */
    readonly maxPerSlot: number;
    /**
     * A booked warning pulls charged bodies of its kind within this radius along: their charge
     * completes one step later, so a pack goes off as a rolling chain instead of single bursts.
     */
    readonly chainRadiusPx: number;
    /** Least heat a body needs to be pulled into a chain. */
    readonly chainMinHeat: number;
  };
  /** While the warning runs the body keeps running but turns its heading at most this fast. */
  readonly telegraphTurnRateDegPerSec: number;
  /** An allied body only books its burst while a hostile is this close (it never bursts beside its owner for nothing). */
  readonly alliedTriggerRadiusPx: number;
  readonly burst: CoopDefenseEnemyHeatBurstImpactConfig;
  /** Burning chunks thrown by the burst; fire style and targets follow the body's faction. */
  readonly fireChunks?: FireChunkBurstConfig;
  /** A killed body with at least `minHeat` fizzles harmlessly; the radius grows with its heat. */
  readonly fizzle: { readonly minHeat: number; readonly minRadiusPx: number; readonly maxRadiusPx: number };
}

/** Reaction time and player speed of the dodge-window contract of every authored heat burst. */
export const HEAT_BURST_FAIRNESS = { reactionMs: 250, playerSpeedPxPerSec: 280, playerRadiusPx: 16 } as const;

export interface CoopDefenseEnemyConfig {
  readonly flee?: CoopDefenseEnemyFleeConfig;
  readonly hop?: CoopDefenseEnemyHopConfig;
  readonly pounce?: CoopDefenseEnemyPounceConfig;
  readonly heatBurst?: CoopDefenseEnemyHeatBurstConfig;
  readonly amphibious?: CoopDefenseEnemyAmphibiousConfig;
  readonly engage?: CoopDefenseEnemyEngageConfig;
  readonly deathBurst?: CoopDefenseEnemyDeathBurstConfig;
  readonly firestarter?: CoopDefenseEnemyFirestarterConfig;
  readonly shieldCharger?: CoopDefenseEnemyShieldChargerConfig;
  readonly energyCone?: CoopDefenseEnemyEnergyConeConfig;
  /**
   * Authoritative turn-rate limit in degrees per second. Body, shields and attack direction share
   * this facing, and locomotion slows while the body is turned away from its heading.
   */
  readonly turnRateDegPerSec?: number;
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
  /** Blood colour (0xRRGGBB) of hits on this kind: spray, pools and clouds. Absent = the default red. */
  readonly bloodColor?: number;
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
  readonly kaboomtula?: CoopDefenseEnemyKaboomtulaConfig;
  readonly basePreference?: CoopDefenseEnemyBasePreferenceConfig;
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
/** Registers the kraken boss and its egg; returns a release only for entries it created itself. */
export function registerKrakenEnemies(config: import('./krakenBoss').KrakenBossConfig): () => void {
  const bossKind = 'abyssal-kraken', eggKind = config.eggs.enemyKind;
  if (COOP_DEFENSE_ENEMY_CONFIGS[bossKind] || COOP_DEFENSE_ENEMY_CONFIGS[eggKind]) return () => {};
  // Boss and egg are explicit entities; they must not inherit abilities of whatever the eggs hatch.
  const base = { pawCount: 4 as const, xp: 3, moveSpeed: 180, movementTarget: 'players' as const,
    attackScanIntervalMs: 200, attackStopDurationMs: 100, obstacleAttackDelayMs: 500 };
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

// Map 20 places the kraken in the campaign: boss and egg are regular registry entries.
registerKrakenEnemies(KRAKEN_BOSS_DEFAULTS);

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
        flee: config.flee,
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
        kaboomtula: config.kaboomtula,
        basePreference: config.basePreference ? { ...config.basePreference } : undefined,
        mortar: config.mortar ? { ...config.mortar, targetWeights: { ...config.mortar.targetWeights } } : undefined,
        firestarter: config.firestarter ? { ...config.firestarter, charges: { ...config.firestarter.charges }, lance: { ...config.firestarter.lance } } : undefined,
        shieldCharger: config.shieldCharger ? { ...config.shieldCharger } : undefined,
        energyCone: config.energyCone ? { ...config.energyCone } : undefined,
        amphibious: config.amphibious ? { ...config.amphibious } : undefined,
        engage: config.engage ? { ...config.engage } : undefined,
        deathBurst: config.deathBurst ? { ...config.deathBurst } : undefined,
        hop: config.hop ? { ...config.hop, weights: { ...config.hop.weights },
          heal: config.hop.heal ? { ...config.hop.heal } : undefined,
          landingShock: config.hop.landingShock ? { ...config.hop.landingShock } : undefined } : undefined,
        pounce: config.pounce ? clonePounceConfig(config.pounce) : undefined,
        heatBurst: config.heatBurst ? cloneHeatBurstConfig(config.heatBurst) : undefined,
        turnRateDegPerSec: config.turnRateDegPerSec,
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
  const flee = normalizeEnemyFleeConfig(enemy.flee);
  if ((enemy.movementTarget === 'flee') !== !!flee
    || (flee && (enemy.weapons.length || enemy.isBoss || enemy.krakenBoss || enemy.krakenEgg
      || enemy.firestarter || enemy.mortar || enemy.kaboomtula || enemy.voidHunterBoss || enemy.spawnThrow
      || enemy.translocator || enemy.burrow || enemy.dodge || enemy.combatPositioning
      || enemy.voidFireChunks || enemy.voidFireTrail || enemy.voidMolotov || enemy.stinkAura || enemy.deathSpawns?.length))) {
    throw new Error(`[coopDefenseEnemies] Fleeing enemy must be non-combatant: ${enemy.id}`);
  }
  const isBoss = enemy.isBoss === true;
  const krakenBoss = enemy.krakenBoss === undefined ? undefined : normalizeKrakenBossConfig(enemy.krakenBoss);
  const krakenEgg = enemy.krakenEgg === undefined ? undefined : normalizeKrakenEggConfig(enemy.krakenEgg);
  if ((krakenBoss || krakenEgg) && (enemy.voidHunterBoss || enemy.kaboomtula || enemy.spawnThrow
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
  // Hopping is exclusive locomotion: no second owner may move or hold the same body.
  if (enemy.hop && (flee || krakenBoss || krakenEgg || enemy.shieldCharger || enemy.energyCone || enemy.firestarter
    || enemy.mortar || enemy.kaboomtula || enemy.pounce || enemy.burrow || enemy.dodge || enemy.amphibious || enemy.combatPositioning)) {
    throw new Error(`[coopDefenseEnemies] Hopping enemy has a second locomotion owner: ${enemy.id}`);
  }
  // The spider owns its whole body (alert, rush, leap, spit): no second movement or attack owner.
  if (enemy.kaboomtula && (flee || krakenBoss || krakenEgg || enemy.shieldCharger || enemy.energyCone || enemy.firestarter
    || enemy.mortar || enemy.pounce || enemy.burrow || enemy.dodge || enemy.amphibious || enemy.combatPositioning || enemy.engage)) {
    throw new Error(`[coopDefenseEnemies] Kabummtula has a second movement owner: ${enemy.id}`);
  }
  // The pounce owns aim stance, flight and side-cuts of a player hunter: no second movement owner.
  if (enemy.pounce && (flee || krakenBoss || krakenEgg || enemy.shieldCharger || enemy.energyCone || enemy.firestarter
    || enemy.mortar || enemy.burrow || enemy.dodge || enemy.amphibious || enemy.combatPositioning || enemy.voidHunterBoss
    || enemy.engage || enemy.movementTarget !== 'players')) {
    throw new Error(`[coopDefenseEnemies] Pouncing enemy has a second movement owner or no player target: ${enemy.id}`);
  }
  // The heat cycle owns the speed ramp, the warning run and the death fizzle: no second ability owner on the body.
  if (enemy.heatBurst && (flee || krakenBoss || krakenEgg || enemy.hop || enemy.kaboomtula || enemy.pounce || enemy.shieldCharger
    || enemy.energyCone || enemy.firestarter || enemy.mortar || enemy.burrow || enemy.dodge || enemy.amphibious
    || enemy.deathBurst || enemy.voidHunterBoss)) {
    throw new Error(`[coopDefenseEnemies] Heat-burst enemy has a second ability owner: ${enemy.id}`);
  }
  if (enemy.basePreference && enemy.movementTarget !== 'players') {
    throw new Error(`[coopDefenseEnemies] basePreference needs movementTarget players: ${enemy.id}`);
  }

  return {
    maxHp: Math.max(1, Math.floor(enemy.maxHp)),
    xp: Math.max(0, Math.floor(enemy.xp)),
    size: Math.max(1, enemy.size),
    moveSpeed: krakenEgg ? 0 : Math.max(1, enemy.moveSpeed),
    knockbackFactor: normalizeKnockbackFactor(enemy.knockbackFactor),
    movementTarget: normalizeMovementTarget(enemy.movementTarget),
    weapons: krakenBoss || krakenEgg || flee ? [] : normalizeWeapons(enemy.weapons, enemy.id),
    flee,
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
    bloodColor: normalizeBloodColor(enemy.bloodColor, enemy.id),
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
    kaboomtula: normalizeKaboomtulaConfig(enemy.kaboomtula, enemy.id),
    basePreference: normalizeBasePreferenceConfig(enemy.basePreference, enemy.id),
    mortar: normalizeMortarConfig(enemy.mortar),
    firestarter: normalizeFirestarterConfig(enemy.firestarter),
    shieldCharger: normalizeShieldChargerConfig(enemy.shieldCharger),
    energyCone: normalizeEnergyConeConfig(enemy.energyCone),
    amphibious: normalizeAmphibiousConfig(enemy.amphibious),
    engage: normalizeEngageConfig(enemy.engage),
    deathBurst: normalizeDeathBurstConfig(enemy.deathBurst),
    hop: normalizeHopConfig(enemy.hop),
    pounce: normalizePounceConfig(enemy.pounce),
    heatBurst: normalizeHeatBurstConfig(enemy.heatBurst, enemy.id),
    turnRateDegPerSec: normalizeTurnRate(enemy.turnRateDegPerSec),
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

function normalizeBloodColor(value: number | undefined, enemyId: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new Error(`[coopDefenseEnemies] Invalid blood color: ${enemyId}`);
  }
  return value;
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
      muzzleForwardPx: weapon.muzzleForwardPx === undefined ? undefined : Math.max(0, weapon.muzzleForwardPx),
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
  if (target === 'bases' || target === 'players' || target === 'players-and-armed-constructs' || target === 'flee') {
    return target;
  }
  throw new Error(`[coopDefenseEnemies] Unsupported movementTarget: ${String(target)}`);
}

export function normalizeEnemyFleeConfig(config: CoopDefenseEnemyFleeConfig | undefined): CoopDefenseEnemyFleeConfig | undefined {
  if (config === undefined) return undefined;
  if (!config || !Number.isFinite(config.playerAvoidanceRadiusPx) || config.playerAvoidanceRadiusPx <= 0
    || !Number.isFinite(config.arrivalRadiusPx) || config.arrivalRadiusPx <= 0
    || !Object.prototype.hasOwnProperty.call(DAWN_SCRAP_DEFS, config.scrapPickupDefId)) {
    throw new Error('[coopDefenseEnemies] Invalid flee config');
  }
  return { ...config };
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

function normalizeKaboomtulaConfig(
  config: CoopDefenseEnemyKaboomtulaConfig | undefined,
  enemyId: string,
): CoopDefenseEnemyKaboomtulaConfig | undefined {
  if (!config) return undefined;
  const ms = (value: number) => Math.max(0, Math.floor(value));
  const { skitter, pounce, leap, blast, killedPop, web } = config;
  const normalized: CoopDefenseEnemyKaboomtulaConfig = {
    activationRadiusPx: Math.max(1, config.activationRadiusPx),
    alertMs: ms(config.alertMs),
    rushSpeedPx: Math.max(1, config.rushSpeedPx),
    rushMaxMs: Math.max(1, ms(config.rushMaxMs)),
    lostSightGraceMs: ms(config.lostSightGraceMs),
    skitter: {
      weavePeriodMinMs: Math.max(1, ms(skitter.weavePeriodMinMs)),
      weavePeriodMaxMs: Math.max(1, ms(skitter.weavePeriodMaxMs)),
      weaveDegrees: Math.max(0, skitter.weaveDegrees),
      surge: Math.max(0, Math.min(0.9, skitter.surge)),
      facingLean: Math.max(0, Math.min(1, skitter.facingLean)),
      calmWithinPx: Math.max(0, skitter.calmWithinPx),
      probePx: Math.max(1, skitter.probePx),
    },
    pounce: { triggerPx: Math.max(1, pounce.triggerPx), telegraphMs: Math.max(1, ms(pounce.telegraphMs)),
      cancelLockoutMs: ms(pounce.cancelLockoutMs) },
    leap: { airMs: Math.max(1, ms(leap.airMs)), leadFactor: Math.max(0, leap.leadFactor),
      overshootPx: Math.max(0, leap.overshootPx), maxLengthPx: Math.max(1, leap.maxLengthPx) },
    recoverMs: ms(config.recoverMs),
    contactMarginPx: Math.max(0, config.contactMarginPx),
    blast: {
      radiusPx: Math.max(1, blast.radiusPx), damage: Math.max(0, blast.damage), baseDamage: Math.max(0, blast.baseDamage),
      knockback: Math.max(0, blast.knockback),
      fireChunks: blast.fireChunks ? {
        ...blast.fireChunks,
        count: Math.max(0, Math.floor(blast.fireChunks.count)),
        searchRadius: Math.max(0, blast.fireChunks.searchRadius),
        flightMs: Math.max(1, ms(blast.fireChunks.flightMs)),
        igniteCenter: blast.fireChunks.igniteCenter === true,
        durationMs: ms(blast.fireChunks.durationMs),
        burnDurationMs: ms(blast.fireChunks.burnDurationMs),
        burnDamagePerTick: Math.max(0, blast.fireChunks.burnDamagePerTick),
        visualStyle: 'void',
        damageTarget: 'players',
      } : undefined,
    },
    killedPop: { radiusPx: Math.max(1, killedPop.radiusPx), damage: Math.max(0, killedPop.damage) },
    web: {
      rangePx: Math.max(1, web.rangePx), windupMs: Math.max(1, ms(web.windupMs)), tailMs: ms(web.tailMs),
      flightMs: Math.max(1, ms(web.flightMs)), durationMs: Math.max(1, ms(web.durationMs)),
      cooldownMs: ms(web.cooldownMs), refreshWindowMs: ms(web.refreshWindowMs), lockoutMs: ms(web.lockoutMs),
      mouthForwardPx: Math.max(0, web.mouthForwardPx),
    },
  };
  const n = normalized;
  if (n.skitter.weavePeriodMinMs > n.skitter.weavePeriodMaxMs || n.skitter.weaveDegrees >= 90
    || n.pounce.triggerPx >= n.activationRadiusPx
    || n.leap.maxLengthPx < n.pounce.triggerPx + n.leap.overshootPx) {
    throw new Error(`[coopDefenseEnemies] Invalid Kabummtula ranges or timing: ${enemyId}`);
  }
  return normalized;
}

function normalizeBasePreferenceConfig(
  config: CoopDefenseEnemyBasePreferenceConfig | undefined,
  enemyId: string,
): CoopDefenseEnemyBasePreferenceConfig | undefined {
  if (!config) return undefined;
  const normalized = {
    playerCostRatio: config.playerCostRatio, releaseCostRatio: config.releaseCostRatio,
    minDwellMs: Math.max(0, Math.floor(config.minDwellMs)), playerOverridePx: Math.max(0, config.playerOverridePx),
  };
  if (!(normalized.releaseCostRatio >= 1 && normalized.releaseCostRatio <= normalized.playerCostRatio)) {
    throw new Error(`[coopDefenseEnemies] basePreference needs 1 <= releaseCostRatio <= playerCostRatio: ${enemyId}`);
  }
  return normalized;
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

export function normalizeTurnRate(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid enemy turnRateDegPerSec');
  return value;
}

/** Reject malformed timing and inconsistent distances at the authored boundary. */
export function normalizeShieldChargerConfig(config: CoopDefenseEnemyShieldChargerConfig | undefined): CoopDefenseEnemyShieldChargerConfig | undefined {
  if (!config) return undefined;
  const positive = [config.triggerMaxDistancePx, config.alignToleranceDegrees, config.windupMs,
    config.runSpeedPx, config.maxRunPx, config.recoverMs, config.cooldownMs, config.windupDisplacementCancelPx, config.hitKnockbackMs];
  const nonNegative = [config.shieldArcDegrees, config.triggerMinDistancePx, config.overshootPx, config.cancelLockoutMs, config.hitDamage,
    config.hitKnockbackSpeed, config.structureDamageMult ?? 0];
  if (positive.some(v => !Number.isFinite(v) || v <= 0) || nonNegative.some(v => !Number.isFinite(v) || v < 0)) {
    throw new Error('Invalid shield charger value');
  }
  if (config.style !== undefined && config.style !== 'shield' && config.style !== 'leap') throw new Error('Invalid shield charger style');
  if ((config.style === 'leap') !== (config.shieldArcDegrees === 0)) throw new Error('A leap has no shield; a shielded charge needs one');
  if (config.shieldArcDegrees > 360 || config.alignToleranceDegrees >= 90
    || config.triggerMinDistancePx >= config.triggerMaxDistancePx || config.maxRunPx < config.triggerMaxDistancePx
    || config.cooldownMs < config.windupMs) throw new Error('Invalid shield charger relation');
  return { ...config };
}

export function normalizeAmphibiousConfig(config: CoopDefenseEnemyAmphibiousConfig | undefined): CoopDefenseEnemyAmphibiousConfig | undefined {
  if (!config) return undefined;
  if (!Number.isFinite(config.swimSpeedFactor) || config.swimSpeedFactor < .25 || config.swimSpeedFactor > 4) throw new Error('Invalid amphibious swim speed');
  return { swimSpeedFactor: config.swimSpeedFactor };
}

export function normalizeEngageConfig(config: CoopDefenseEnemyEngageConfig | undefined): CoopDefenseEnemyEngageConfig | undefined {
  if (!config) return undefined;
  if ([config.enterPx, config.exitPx].some(v => !Number.isFinite(v) || v <= 0) || !Number.isFinite(config.minDwellMs) || config.minDwellMs < 0
    || config.enterPx >= config.exitPx) throw new Error('Invalid engage config');
  return { ...config };
}

/** Reject malformed hop timing, weights and inconsistent distances at the authored boundary. */
export function normalizeHopConfig(config: CoopDefenseEnemyHopConfig | undefined): CoopDefenseEnemyHopConfig | undefined {
  if (!config) return undefined;
  const invalid = (positive: readonly number[], nonNegative: readonly number[]) =>
    positive.some(v => !Number.isFinite(v) || v <= 0) || nonNegative.some(v => !Number.isFinite(v) || v < 0);
  const weights = config.weights;
  if (!weights || invalid([config.minHopPx, config.maxHopPx, config.crouchMs, config.airMs, config.landMs, config.breathMs,
    config.restMaxMs, config.retryMs, config.fanHalfAngleDeg, config.crouchDisplacementCancelPx],
  [config.maxRegressPx, config.cancelLockoutMs, config.minProgressShare, weights.progress, weights.heal, weights.deviation, weights.crowd])) {
    throw new Error('Invalid hop value');
  }
  if (!Number.isInteger(config.fanSteps) || config.fanSteps < 3 || config.fanSteps % 2 === 0 || config.minHopPx > config.maxHopPx
    || config.restMaxMs < config.breathMs || config.minProgressShare > 1 || config.fanHalfAngleDeg > 180) {
    throw new Error('Invalid hop relation');
  }
  const heal = config.heal, shock = config.landingShock;
  if (heal && (invalid([heal.radiusPx, heal.healPerTick, heal.tickIntervalMs], [])
    || !Number.isInteger(heal.maxLinks) || heal.maxLinks < 1 || heal.maxLinks > MAX_HOP_HEAL_LINKS)) {
    throw new Error('Invalid hop heal config');
  }
  if (shock && (invalid([shock.radiusPx, shock.armRadiusPx], [shock.damage, shock.knockbackSpeed, shock.knockbackMs])
    || shock.armRadiusPx < shock.radiusPx)) {
    throw new Error('Invalid hop landing shock config');
  }
  return { ...config, weights: { ...weights }, heal: heal ? { ...heal } : undefined,
    landingShock: shock ? { ...shock } : undefined };
}

function clonePounceConfig(config: CoopDefenseEnemyPounceConfig): CoopDefenseEnemyPounceConfig {
  return { ...config, impact: { ...config.impact }, pack: { ...config.pack },
    gait: config.gait ? { ...config.gait } : undefined, sideCuts: config.sideCuts ? { ...config.sideCuts } : undefined };
}

/** Reject malformed pounce timing, ranges and inconsistent relations at the authored boundary. */
export function normalizePounceConfig(config: CoopDefenseEnemyPounceConfig | undefined): CoopDefenseEnemyPounceConfig | undefined {
  if (!config) return undefined;
  const invalid = (positive: readonly number[], nonNegative: readonly number[]) =>
    positive.some(v => !Number.isFinite(v) || v <= 0) || nonNegative.some(v => !Number.isFinite(v) || v < 0);
  const impact = config.impact, pack = config.pack;
  if (!impact || !pack || invalid([config.minRangePx, config.maxRangePx, config.aimMs, config.lockMs, config.airSpeedPx,
    config.airMinMs, config.airMaxMs, config.recoverMs, config.cooldownMinMs, config.cancelDisplacementPx, impact.radiusPx,
    config.aimTrackSpeedPx],
  [config.cooldownMaxMs, config.initialDelayMs, config.leadFactor, config.maxLeadPx, config.closeCancelPx, config.cancelLockoutMs,
    config.lostSightGraceMs, impact.damage, impact.knockbackSpeed, impact.knockbackMs, pack.staggerMs])) {
    throw new Error('Invalid pounce value');
  }
  // The zone never covers the take-off point, and an aim that yields to the bite starts outside bite reach.
  if (config.minRangePx >= config.maxRangePx || config.minRangePx <= impact.radiusPx || config.closeCancelPx >= config.minRangePx
    || config.airMinMs > config.airMaxMs || config.cooldownMinMs > config.cooldownMaxMs || config.leadFactor > 1.5
    || !Number.isInteger(pack.maxPerTarget) || pack.maxPerTarget < 1) {
    throw new Error('Invalid pounce relation');
  }
  const gait = config.gait, cuts = config.sideCuts;
  if (gait && (invalid([gait.periodMinMs, gait.periodMaxMs], [gait.surge]) || gait.periodMinMs > gait.periodMaxMs || gait.surge >= 0.9)) {
    throw new Error('Invalid pounce gait');
  }
  if (cuts && (invalid([cuts.intervalMinMs, cuts.intervalMaxMs, cuts.angleMinDeg, cuts.angleMaxDeg, cuts.durationMs],
    [cuts.minTargetDistancePx]) || cuts.intervalMinMs > cuts.intervalMaxMs || cuts.angleMinDeg > cuts.angleMaxDeg
    || cuts.angleMaxDeg >= 90 || cuts.durationMs >= cuts.intervalMinMs)) {
    throw new Error('Invalid pounce side-cuts');
  }
  return clonePounceConfig(config);
}

function cloneHeatBurstConfig(config: CoopDefenseEnemyHeatBurstConfig): CoopDefenseEnemyHeatBurstConfig {
  return { ...config, cascade: { ...config.cascade }, burst: { ...config.burst }, fizzle: { ...config.fizzle },
    fireChunks: config.fireChunks ? { ...config.fireChunks } : undefined };
}

/**
 * Reject malformed heat timing, ranges and an unfair warning at the authored boundary. A body that
 * keeps running during its warning must leave a player time to react and step out of the zone sideways.
 */
export function normalizeHeatBurstConfig(config: CoopDefenseEnemyHeatBurstConfig | undefined,
  enemyId: string): CoopDefenseEnemyHeatBurstConfig | undefined {
  if (!config) return undefined;
  const invalid = (positive: readonly number[], nonNegative: readonly number[]) =>
    positive.some(v => !Number.isFinite(v) || v <= 0) || nonNegative.some(v => !Number.isFinite(v) || v < 0);
  const { cascade, burst, fizzle, fireChunks } = config;
  if (!cascade || !burst || !fizzle || invalid([config.chargeMinMs, config.chargeMaxMs, config.telegraphMs,
    config.speedCurveExponent, config.telegraphTurnRateDegPerSec, config.alliedTriggerRadiusPx, cascade.stepMs,
    cascade.neighbourRadiusPx, cascade.chainRadiusPx, burst.radiusPx, fizzle.minRadiusPx, fizzle.maxRadiusPx],
  [config.ventMs, config.initialDelayMs, config.speedBoost, cascade.jitterMs, burst.damage, burst.minDamage,
    burst.knockbackSpeed, burst.knockbackMs, burst.friendlyBaseDamageMult, burst.constructionDamageMult, burst.trainDamageMult,
    fizzle.minHeat, cascade.chainMinHeat])) {
    throw new Error(`[coopDefenseEnemies] Invalid heat-burst value: ${enemyId}`);
  }
  if (config.chargeMinMs > config.chargeMaxMs || burst.minDamage > burst.damage || cascade.jitterMs * 2 >= cascade.stepMs
    || !Number.isInteger(cascade.maxPerSlot) || cascade.maxPerSlot < 1 || fizzle.minHeat > 1 || cascade.chainMinHeat > 1
    || fizzle.minRadiusPx > fizzle.maxRadiusPx || config.speedBoost > 2) {
    throw new Error(`[coopDefenseEnemies] Invalid heat-burst relation: ${enemyId}`);
  }
  const { reactionMs, playerSpeedPxPerSec, playerRadiusPx } = HEAT_BURST_FAIRNESS;
  if (config.telegraphMs < reactionMs + (burst.radiusPx + playerRadiusPx) / playerSpeedPxPerSec * 1000) {
    throw new Error(`[coopDefenseEnemies] Heat-burst warning too short to step out of the zone: ${enemyId}`);
  }
  if (fireChunks && invalid([fireChunks.flightMs], [fireChunks.count, fireChunks.searchRadius, fireChunks.durationMs,
    fireChunks.burnDurationMs, fireChunks.burnDamagePerTick])) {
    throw new Error(`[coopDefenseEnemies] Invalid heat-burst fire chunks: ${enemyId}`);
  }
  return cloneHeatBurstConfig({ ...config, fireChunks: fireChunks ? { ...fireChunks,
    count: Math.floor(fireChunks.count), igniteCenter: fireChunks.igniteCenter === true } : undefined });
}

export function normalizeDeathBurstConfig(config: CoopDefenseEnemyDeathBurstConfig | undefined): CoopDefenseEnemyDeathBurstConfig | undefined {
  if (!config) return undefined;
  if (!Number.isFinite(config.radiusPx) || config.radiusPx <= 0 || [config.damage, config.structureDamageMult].some(v => !Number.isFinite(v) || v < 0)
    || (config.presentation !== undefined && config.presentation !== 'ink' && config.presentation !== 'plague')) {
    throw new Error('Invalid death burst config');
  }
  return { ...config };
}

/** Reject malformed timing and inconsistent distances at the authored boundary. */
export function normalizeEnergyConeConfig(config: CoopDefenseEnemyEnergyConeConfig | undefined): CoopDefenseEnemyEnergyConeConfig | undefined {
  if (!config) return undefined;
  const positive = [config.triggerMaxDistancePx, config.arcDegrees, config.rangePx, config.windupMs, config.recoverMs,
    config.cooldownMs, config.windupDisplacementCancelPx, config.coverRefreshMs];
  const nonNegative = [config.triggerMinDistancePx, config.cancelLockoutMs, config.damage];
  if (positive.some(v => !Number.isFinite(v) || v <= 0) || nonNegative.some(v => !Number.isFinite(v) || v < 0)) {
    throw new Error('Invalid energy cone value');
  }
  if (config.arcDegrees >= 180 || config.triggerMinDistancePx >= config.triggerMaxDistancePx
    || config.triggerMaxDistancePx > config.rangePx || config.coverRefreshMs > config.windupMs) throw new Error('Invalid energy cone relation');
  return { ...config };
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
