import { COLORS } from '../config';
import type { CoopDefenseClassId, CoopDefenseItemRarity, CoopDefenseItemSlot } from '../types';
import type { CoopDefenseUpgradeEffectMode } from '../utils/coopDefenseUpgrades';

/**
 * Definitionsdaten des dauerhaften Item-Systems.
 *
 * Alle Affixe schreiben in dieselben Additiv-/Prozent-Buckets wie der Upgrade-Baum
 * (`CoopDefenseUpgradeEffectMode`). Dadurch summieren sich Level- und Item-Boni pro Stat
 * additiv – das im Design geforderte Verhalten – und jeder bereits vorhandene Stat-Resolver
 * uebernimmt Item-Werte ohne eigene Verdrahtung.
 *
 * Aufgenommen sind ausschliesslich Stats, die es im Spiel tatsaechlich gibt. `player.outgoingDamage`
 * ist der einzige neu eingefuehrte Key; er wird in `resolveCoopDefenseOutgoingDamage` konsumiert.
 */

/** Ein Sieg auf dieser Map schaltet das Item-System dauerhaft frei. */
export const COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID = '10';

/** Nicht ausgeruestete Items je Kategorie. Ausgeruestete Items zaehlen nicht mit. */
export const COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT = 10;

/** Groesse des Belohnungsangebots nach einem Sieg. */
export const COOP_DEFENSE_ITEM_OFFER_SIZE = 3;

export const COOP_DEFENSE_ITEM_SLOTS: readonly CoopDefenseItemSlot[] = [
  'helmet',
  'gloves',
  'armor',
  'boots',
];

export const COOP_DEFENSE_ITEM_RARITIES: readonly CoopDefenseItemRarity[] = [
  'white',
  'blue',
  'yellow',
];

export interface CoopDefenseItemSlotDefinition {
  readonly id: CoopDefenseItemSlot;
  /** Kategorietypischer Grundwert – auf jedem Item dieses Slots vorhanden. */
  readonly baseStat: string;
  readonly baseMode: CoopDefenseUpgradeEffectMode;
  /** Sollwert auf Item-Level 1. */
  readonly baseValueAtLevel1: number;
  /** Zuwachs des Sollwerts je weiterem Item-Level. */
  readonly baseValuePerLevel: number;
  /**
   * Relative Streuung um den Sollwert (0.2 = plus/minus 20 %). Sorgt dafuer, dass ein gut
   * gerolltes Item einer niedrigeren Map nicht automatisch von jedem neuen Fund ersetzt wird.
   */
  readonly baseValueSpread: number;
}

export const COOP_DEFENSE_ITEM_SLOT_DEFINITIONS:
Readonly<Record<CoopDefenseItemSlot, CoopDefenseItemSlotDefinition>> = Object.freeze({
  helmet: {
    id: 'helmet',
    baseStat: 'player.adrenalineRegenRate',
    baseMode: 'add_percent_per_level',
    baseValueAtLevel1: 0.06,
    baseValuePerLevel: 0.03,
    baseValueSpread: 0.2,
  },
  gloves: {
    id: 'gloves',
    baseStat: 'player.outgoingDamage',
    baseMode: 'add_percent_per_level',
    baseValueAtLevel1: 0.08,
    baseValuePerLevel: 0.04,
    baseValueSpread: 0.2,
  },
  armor: {
    id: 'armor',
    baseStat: 'player.maxHp',
    baseMode: 'add_per_level',
    baseValueAtLevel1: 25,
    baseValuePerLevel: 12,
    baseValueSpread: 0.2,
  },
  boots: {
    id: 'boots',
    baseStat: 'player.runSpeed',
    baseMode: 'add_percent_per_level',
    baseValueAtLevel1: 0.05,
    baseValuePerLevel: 0.02,
    baseValueSpread: 0.2,
  },
});

export interface CoopDefenseItemRarityDefinition {
  readonly id: CoopDefenseItemRarity;
  /** Seltenheit bestimmt ausschliesslich die Anzahl der Zusatzeigenschaften. */
  readonly affixCount: number;
  /** Relatives Gewicht der gewichteten Ziehung. */
  readonly weight: number;
  readonly color: number;
  /** Basis-XP beim Zerlegen, vor dem Item-Level-Faktor. */
  readonly salvageXp: number;
}

export const COOP_DEFENSE_ITEM_RARITY_DEFINITIONS:
Readonly<Record<CoopDefenseItemRarity, CoopDefenseItemRarityDefinition>> = Object.freeze({
  white: {
    id: 'white',
    affixCount: 0,
    weight: 55,
    color: COLORS.GREY_2,
    salvageXp: 5,
  },
  blue: {
    id: 'blue',
    affixCount: 1,
    weight: 33,
    color: COLORS.BLUE_3,
    salvageXp: 12,
  },
  yellow: {
    id: 'yellow',
    affixCount: 2,
    weight: 12,
    color: COLORS.GOLD_2,
    salvageXp: 25,
  },
});

/** Zuschlag auf die Zerlege-XP je Item-Level ueber 1. */
export const COOP_DEFENSE_ITEM_SALVAGE_XP_PER_LEVEL = 0.15;

export interface CoopDefenseItemAffixDefinition {
  readonly id: string;
  /**
   * Stat im gemeinsamen Upgrade-/Item-Bucket. Fehlt er, traegt das Affix seinen Wert
   * ausschliesslich ueber einen Laufzeit-Handler und schreibt in keinen Bucket.
   */
  readonly stat?: string;
  readonly mode?: CoopDefenseUpgradeEffectMode;
  /**
   * Relatives Ziehungsgewicht innerhalb des Slot-Pools. Keine feste Prozentchance: Gewicht 20
   * ist in derselben Ziehung halb so wahrscheinlich wie Gewicht 40. Gewicht <= 0 ist nicht
   * ziehbar – der einzige Weg, ein definiertes Affix aus dem Drop-Pool zu nehmen, ohne seine
   * ID zu entfernen und damit gespeicherte Items zu entwerten.
   */
  readonly weight: number;
  /** Untere und obere Grenze des Wurfs auf Item-Level 1 (vorzeichenrichtig, min <= max). */
  readonly minAtLevel1: number;
  readonly maxAtLevel1: number;
  /** Verschiebung beider Grenzen je weiterem Item-Level. */
  readonly perLevel: number;
  /** Kategorien, auf denen diese Eigenschaft vorkommen darf. */
  readonly slots: readonly CoopDefenseItemSlot[];
  /**
   * Klassen, mit denen das Affix gerollt werden darf. Fehlt die Angabe, ist das Affix
   * klassenoffen. Ein bereits gerolltes Item bleibt mit jeder Klasse ausruestbar; der Effekt
   * ist mit einer anderen Klasse nur wirkungslos.
   */
  readonly classIds?: readonly CoopDefenseClassId[];
  /** Anzeige als Prozentwert im UI. */
  readonly displayAsPercent: boolean;
  /**
   * Kosten-Stat: der kleinere Wert ist der bessere. Der Vergleich faerbt solche Zeilen umgekehrt,
   * sonst erschiene ein gesenkter Verbrauch als Verschlechterung.
   */
  readonly lowerIsBetter?: boolean;
  /**
   * Einzeilige Erklaerung fuer Affixe, deren Wirkung sich nicht aus `label` und Zahl ergibt.
   *
   * Nur statlose Affixe brauchen sie: ein Stat-Affix erklaert sich ueber seine Zahlenzeile
   * bereits vollstaendig. Die festen Parameter kommen aus {@link COOP_DEFENSE_AFFIX_RULES},
   * damit Text und Laufzeitverhalten nicht auseinanderlaufen koennen.
   */
}

/**
 * Feste Parameter der Laufzeit-Affixe.
 *
 * Bewusst eine einzige Quelle: jeder Wert wird sowohl vom Tooltip-Text als auch vom
 * `CoopDefenseItemRuntimeSystem` gelesen. Der gewuerfelte Hauptwert des Affixes steht
 * dagegen auf dem Item, nicht hier.
 */
export const COOP_DEFENSE_AFFIX_RULES = Object.freeze({
  /** Kampfaufladung: Stapelgrenze und Haltedauer je Kill. */
  killChargeMaxStacks: 5,
  killChargeDurationMs: 3_000,
  /** Fokusfeuer: Staerke und Dauer der Verwundbarkeit. */
  vulnerabilityBonus: 0.2,
  vulnerabilityDurationMs: 5_000,
  /** Hinrichtung: HP-Anteil, unterhalb dessen der Gegner hingerichtet werden kann. */
  cullingHpThreshold: 0.2,
  /** Blutrausch und Unter Druck / Letzte Bastion: gemeinsame Niedrig-HP-Schwelle. */
  lowHpThreshold: 0.4,
  /** Blutrausch: fester Lifeleech-Zuschlag zusaetzlich zum gewuerfelten Schadensbonus. */
  bloodRageLifeLeechBonus: 0.03,
  /** Unversehrt: HP-Anteil, ab dem der Schadensbonus gilt. */
  highHpThreshold: 0.9,
  /** Brandzerfall: Anzahl und Streuradius der Brocken sowie Dauer des Bodenbrands. */
  fireChunkCount: 3,
  fireChunkRadius: 96,
  fireChunkGroundDurationMs: 2_000,
  fireChunkBurnDurationMs: 2_000,
  /** Identisch mit dem Brandexplosion-Upgrade (`player.fire.deathGround.burnDamagePerTick`). */
  fireChunkBurnDamagePerTick: 0.25,
  /** Unterdrueckungsmunition: Staerke und Dauer der Verlangsamung. */
  suppressionSlowFraction: 0.2,
  suppressionSlowDurationMs: 2_000,
  /** Notfallreparatur: Zeit ohne tatsaechlichen Schaden, bevor die Zusatzregeneration greift. */
  emergencyRepairDelayMs: 4_000,
  /** Nachbrenner: Dauer des Tempobonus nach einem abgeschlossenen Dash. */
  afterburnerDurationMs: 2_000,
  /** Kreuzfeuer: Dauer des Primaerwaffen-Schadensbonus nach einem Einsatz von Waffe 2. */
  crossfireDurationMs: 5_000,
  /** Kinetische Ladung: Wegstrecke je Ladung. */
  movementChargeDistancePx: 500,
  /** Glutwanderer: Wegstrecke je Feuerbrocken-Burst. */
  glutwandererDistancePx: 500,
  /** Umzingelt: Gegnerzahl, Radius und Nachlaufzeit der Adrenalinregeneration. */
  surroundedEnemyCount: 5,
  surroundedRadiusPx: 160,
  surroundedLingerMs: 500,
});

/**
 * Ein gemeinsamer Pool fuer alle Seltenheiten. Die Seltenheit bestimmt ausschliesslich die
 * Anzahl der Affixe (0/1/2), nicht ihre Qualitaet; seltene Effekte entstehen allein ueber ein
 * niedrigeres `weight`. Es gibt bewusst keine sichtbaren Affix-Kategorien.
 *
 * Pro Kategorie bleibt die Identitaet erkennbar (Helm = Adrenalin und Wut, Handschuhe =
 * Offensive, Ruestung = Defensive, Stiefel = Mobilitaet), einzelne Affixe duerfen aber ueber
 * mehrere Slots vorkommen und addieren sich dann vollstaendig.
 */
export const COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS: readonly CoopDefenseItemAffixDefinition[] =
Object.freeze([
  {
    id: 'max_hp',
    stat: 'player.maxHp',
    mode: 'add_per_level',
    weight: 100,
    minAtLevel1: 10,
    maxAtLevel1: 25,
    perLevel: 8,
    slots: ['armor', 'boots'],
    displayAsPercent: false,
  },
  {
    id: 'hp_regen',
    stat: 'player.hpRegenPerSecond',
    mode: 'add_per_level',
    weight: 75,
    minAtLevel1: 1,
    maxAtLevel1: 3,
    perLevel: 1,
    slots: ['armor', 'boots'],
    displayAsPercent: false,
  },
  {
    id: 'max_armor',
    stat: 'player.maxArmor',
    mode: 'add_per_level',
    weight: 100,
    minAtLevel1: 10,
    maxAtLevel1: 25,
    perLevel: 8,
    slots: ['armor'],
    displayAsPercent: false,
  },
  {
    id: 'armor_regen',
    stat: 'player.armorRegenPerSecond',
    mode: 'add_per_level',
    weight: 75,
    minAtLevel1: 1,
    maxAtLevel1: 4,
    perLevel: 1.5,
    slots: ['armor'],
    displayAsPercent: false,
  },
  {
    id: 'armor_gain',
    stat: 'player.armorGain',
    mode: 'add_percent_per_level',
    weight: 70,
    minAtLevel1: 0.04,
    maxAtLevel1: 0.1,
    perLevel: 0.03,
    slots: ['armor'],
    displayAsPercent: true,
  },
  {
    // Wirkt nach einer vollstaendigen Schildabwehr und vor der Verteilung auf Ruestung und HP.
    // Die Summe bleibt ungedeckelt; nur der fertige Schaden wird bei null abgefangen, damit
    // sehr hohe Reduktion den Spieler nicht durch negativen Schaden heilt.
    id: 'damage_reduction',
    stat: 'player.damageReduction',
    mode: 'add_percent_per_level',
    weight: 70,
    minAtLevel1: 0.02,
    maxAtLevel1: 0.04,
    perLevel: 0.0075,
    slots: ['armor'],
    displayAsPercent: true,
  },
  {
    id: 'low_hp_damage_reduction',
    weight: 35,
    minAtLevel1: 0.05,
    maxAtLevel1: 0.1,
    perLevel: 0.015,
    slots: ['armor'],
    displayAsPercent: true,
  },
  {
    id: 'surrounded',
    weight: 24,
    minAtLevel1: 0.1,
    maxAtLevel1: 0.18,
    perLevel: 0.03,
    slots: ['armor'],
    displayAsPercent: true,
  },
  {
    id: 'out_of_combat_armor_repair',
    weight: 45,
    minAtLevel1: 4,
    maxAtLevel1: 8,
    perLevel: 1.5,
    slots: ['armor'],
    displayAsPercent: false,
  },
  {
    id: 'damage_reflection',
    weight: 25,
    minAtLevel1: 0.05,
    maxAtLevel1: 0.1,
    perLevel: 0.015,
    slots: ['armor'],
    displayAsPercent: true,
  },
  {
    id: 'life_leech',
    stat: 'player.lifeLeechFraction',
    mode: 'add_per_level',
    weight: 55,
    minAtLevel1: 0.01,
    maxAtLevel1: 0.03,
    perLevel: 0.01,
    slots: ['gloves'],
    displayAsPercent: true,
  },
  {
    id: 'outgoing_damage',
    stat: 'player.outgoingDamage',
    mode: 'add_percent_per_level',
    weight: 80,
    minAtLevel1: 0.03,
    maxAtLevel1: 0.08,
    perLevel: 0.03,
    slots: ['gloves'],
    displayAsPercent: true,
  },
  {
    // Klassenoffen: der Krit-Schaden hat einen Grundwert ohne Klassenbezug
    // (`COOP_DEFENSE_BASE_CRITICAL_DAMAGE_MULTIPLIER`), damit Krit-Chance mit jeder Klasse und
    // auch ganz ohne Klasse wirkt. Dachs Nukem bringt Grundchance und hoeheren Klassenwert mit
    // und profitiert dadurch am staerksten.
    id: 'critical_chance',
    stat: 'player.criticalChance',
    mode: 'add_per_level',
    weight: 55,
    minAtLevel1: 0.02,
    maxAtLevel1: 0.05,
    perLevel: 0.015,
    slots: ['gloves', 'helmet'],
    displayAsPercent: true,
  },
  {
    // Addiert sich auf den Krit-Multiplikator, nicht auf den Schaden: ohne Krit-Chance aus
    // Klasse oder Items bleibt das Affix wirkungslos.
    id: 'critical_damage',
    stat: 'player.criticalDamage',
    mode: 'add_per_level',
    weight: 55,
    minAtLevel1: 0.1,
    maxAtLevel1: 0.25,
    perLevel: 0.08,
    slots: ['gloves', 'helmet'],
    displayAsPercent: true,
  },
  {
    id: 'crossfire',
    weight: 30,
    minAtLevel1: 0.1,
    maxAtLevel1: 0.2,
    perLevel: 0.03,
    slots: ['gloves'],
    displayAsPercent: true,
  },
  {
    // Erhoeht ausschliesslich das persoenliche Maximum. Die Kapazitaetskosten der einzelnen
    // Konstrukte bleiben bewusst spielerunabhaengig.
    id: 'construction_capacity',
    stat: 'construction.capacity',
    mode: 'add_per_level',
    weight: 35,
    minAtLevel1: 5,
    maxAtLevel1: 12,
    perLevel: 3,
    slots: ['gloves'],
    classIds: ['inspector_gadachs'],
    displayAsPercent: false,
  },
  {
    id: 'remote_control',
    weight: 18,
    minAtLevel1: 0.1,
    maxAtLevel1: 0.18,
    perLevel: 0.03,
    slots: ['gloves'],
    classIds: ['inspector_gadachs'],
    displayAsPercent: true,
  },
  {
    id: 'primary_vulnerability',
    weight: 15,
    minAtLevel1: 0.015,
    maxAtLevel1: 0.035,
    perLevel: 0.0025,
    slots: ['gloves'],
    displayAsPercent: true,
  },
  {
    id: 'primary_culling',
    weight: 10,
    minAtLevel1: 0.01,
    maxAtLevel1: 0.025,
    perLevel: 0.0025,
    slots: ['gloves'],
    displayAsPercent: true,
  },
  {
    id: 'primary_slow',
    weight: 40,
    minAtLevel1: 0.06,
    maxAtLevel1: 0.12,
    perLevel: 0.01,
    slots: ['gloves'],
    displayAsPercent: true,
  },
  {
    id: 'primary_kill_fire_chunks',
    weight: 15,
    minAtLevel1: 0.04,
    maxAtLevel1: 0.08,
    perLevel: 0.01,
    slots: ['gloves'],
    displayAsPercent: true,
  },
  {
    id: 'low_hp_blood_rage',
    weight: 25,
    minAtLevel1: 0.08,
    maxAtLevel1: 0.14,
    perLevel: 0.015,
    slots: ['gloves'],
    displayAsPercent: true,
  },
  {
    // Bewusst der Gegenpol zu Blutrausch: beide koennen nie gleichzeitig aktiv sein.
    id: 'high_hp_damage',
    weight: 45,
    minAtLevel1: 0.06,
    maxAtLevel1: 0.12,
    perLevel: 0.02,
    slots: ['gloves', 'armor'],
    displayAsPercent: true,
  },
  {
    id: 'run_speed',
    stat: 'player.runSpeed',
    mode: 'add_percent_per_level',
    weight: 75,
    minAtLevel1: 0.02,
    maxAtLevel1: 0.05,
    perLevel: 0.015,
    slots: ['boots'],
    displayAsPercent: true,
  },
  {
    // Derselbe Bucket wie das Upgrade "Einbuddeltempo": beide skalieren den Tempofaktor unter
    // der Erde, nicht die Laufgeschwindigkeit an der Oberflaeche.
    id: 'burrow_speed',
    stat: 'player.burrowSpeed',
    mode: 'add_percent_per_level',
    weight: 60,
    minAtLevel1: 0.04,
    maxAtLevel1: 0.1,
    perLevel: 0.03,
    slots: ['boots'],
    displayAsPercent: true,
  },
  {
    // Weniger Adrenalin je Verbrauchstick unter der Erde – man bleibt laenger unten. Negativ ist
    // hier wie bei `adrenaline_cost` der Vorteil; `minAtLevel1` bleibt die kleinere Grenze.
    id: 'burrow_cost',
    stat: 'player.burrowCost',
    mode: 'add_percent_per_level',
    weight: 55,
    minAtLevel1: -0.1,
    maxAtLevel1: -0.04,
    perLevel: -0.03,
    slots: ['boots'],
    displayAsPercent: true,
    lowerIsBetter: true,
  },
  {
    id: 'max_adrenaline',
    stat: 'player.maxAdrenaline',
    mode: 'add_per_level',
    weight: 90,
    minAtLevel1: 5,
    maxAtLevel1: 12,
    perLevel: 4,
    slots: ['helmet', 'boots'],
    displayAsPercent: false,
  },
  {
    id: 'adrenaline_regen',
    stat: 'player.adrenalineRegenRate',
    mode: 'add_percent_per_level',
    weight: 85,
    minAtLevel1: 0.03,
    maxAtLevel1: 0.08,
    perLevel: 0.03,
    slots: ['helmet'],
    displayAsPercent: true,
  },
  {
    id: 'adrenaline_gain',
    stat: 'player.adrenalineGain',
    mode: 'add_percent_per_level',
    weight: 75,
    minAtLevel1: 0.04,
    maxAtLevel1: 0.1,
    perLevel: 0.03,
    slots: ['helmet', 'gloves'],
    displayAsPercent: true,
  },
  {
    // Negativ ist hier der Vorteil: weniger Adrenalinverbrauch. `minAtLevel1` bleibt trotzdem
    // die numerisch kleinere Grenze, damit der Wurf ein normales Intervall bleibt.
    id: 'adrenaline_cost',
    stat: 'player.adrenalineCost',
    mode: 'add_percent_per_level',
    weight: 65,
    minAtLevel1: -0.08,
    maxAtLevel1: -0.03,
    perLevel: -0.02,
    slots: ['helmet'],
    displayAsPercent: true,
    lowerIsBetter: true,
  },
  {
    // Derselbe prozentuale Bucket wie das Upgrade "Rage-Gewinn". Welche Schadensarten ueberhaupt
    // Wut erzeugen, bleibt unberuehrt – die Synergie mit "Gepanzerte Wut" gilt damit weiter.
    id: 'rage_gain',
    stat: 'ultimate.rageGainPerDamage',
    mode: 'add_percent_per_level',
    weight: 75,
    minAtLevel1: 0.04,
    maxAtLevel1: 0.1,
    perLevel: 0.03,
    slots: ['helmet'],
    displayAsPercent: true,
  },
  {
    id: 'max_rage',
    stat: 'ultimate.maxRage',
    mode: 'add_percent_per_level',
    weight: 85,
    minAtLevel1: 0.05,
    maxAtLevel1: 0.12,
    perLevel: 0.04,
    slots: ['helmet'],
    displayAsPercent: true,
  },
  {
    // Skaliert das `cooldown`-Feld des ausgeruesteten Utility-Configs. Waffen-, Ultimate-,
    // Dash- und per Item konfigurierten Konstruktions-Cooldowns bleiben unberuehrt.
    id: 'utility_cooldown',
    stat: 'utility.cooldown',
    mode: 'add_percent_per_level',
    weight: 55,
    minAtLevel1: -0.07,
    maxAtLevel1: -0.03,
    perLevel: -0.015,
    slots: ['helmet'],
    displayAsPercent: true,
    lowerIsBetter: true,
  },
  {
    id: 'adrenaline_kill_charge',
    weight: 45,
    minAtLevel1: 0.02,
    maxAtLevel1: 0.04,
    perLevel: 0.005,
    slots: ['helmet'],
    displayAsPercent: true,
  },
  {
    id: 'adrenaline_from_damage',
    weight: 40,
    minAtLevel1: 0.04,
    maxAtLevel1: 0.08,
    perLevel: 0.01,
    slots: ['helmet', 'armor'],
    displayAsPercent: true,
  },
  {
    id: 'dash_range',
    stat: 'player.dashRange',
    mode: 'add_percent_per_level',
    weight: 75,
    minAtLevel1: 0.04,
    maxAtLevel1: 0.1,
    perLevel: 0.03,
    slots: ['boots'],
    displayAsPercent: true,
  },
  {
    id: 'dash_speed',
    weight: 45,
    minAtLevel1: 0.1,
    maxAtLevel1: 0.18,
    perLevel: 0.02,
    slots: ['boots'],
    displayAsPercent: true,
  },
  {
    id: 'low_hp_speed',
    weight: 45,
    minAtLevel1: 0.1,
    maxAtLevel1: 0.18,
    perLevel: 0.02,
    slots: ['armor', 'boots'],
    displayAsPercent: true,
  },
  {
    id: 'movement_charge_damage',
    weight: 28,
    minAtLevel1: 0.15,
    maxAtLevel1: 0.3,
    perLevel: 0.03,
    slots: ['boots'],
    displayAsPercent: true,
  },
  {
    id: 'glutwanderer',
    weight: 24,
    minAtLevel1: 2,
    maxAtLevel1: 4,
    perLevel: 1,
    slots: ['boots'],
    displayAsPercent: false,
  },
]);

const AFFIX_BY_ID: ReadonlyMap<string, CoopDefenseItemAffixDefinition> = new Map(
  COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS.map((definition) => [definition.id, definition]),
);

const AFFIXES_BY_SLOT: Readonly<Record<CoopDefenseItemSlot, readonly CoopDefenseItemAffixDefinition[]>> =
  Object.freeze(Object.fromEntries(COOP_DEFENSE_ITEM_SLOTS.map((slot) => [
    slot,
    Object.freeze(COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS.filter((definition) => definition.slots.includes(slot))),
  ])) as Record<CoopDefenseItemSlot, readonly CoopDefenseItemAffixDefinition[]>);

/** Stats, auf denen der kleinere Wert der bessere ist – abgeleitet aus dem Affix-Pool. */
const LOWER_IS_BETTER_STATS: ReadonlySet<string> = new Set(
  COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS
    .filter((definition) => definition.lowerIsBetter)
    .map((definition) => definition.stat)
    .filter((stat): stat is string => stat !== undefined),
);

export function isCoopDefenseItemStatLowerBetter(stat: string): boolean {
  return LOWER_IS_BETTER_STATS.has(stat);
}

export function isCoopDefenseItemSlot(value: unknown): value is CoopDefenseItemSlot {
  return typeof value === 'string' && COOP_DEFENSE_ITEM_SLOTS.includes(value as CoopDefenseItemSlot);
}

export function isCoopDefenseItemRarity(value: unknown): value is CoopDefenseItemRarity {
  return typeof value === 'string' && COOP_DEFENSE_ITEM_RARITIES.includes(value as CoopDefenseItemRarity);
}

export function getCoopDefenseItemSlotDefinition(slot: CoopDefenseItemSlot): CoopDefenseItemSlotDefinition {
  return COOP_DEFENSE_ITEM_SLOT_DEFINITIONS[slot];
}

export function getCoopDefenseItemRarityDefinition(
  rarity: CoopDefenseItemRarity,
): CoopDefenseItemRarityDefinition {
  return COOP_DEFENSE_ITEM_RARITY_DEFINITIONS[rarity];
}

export function getCoopDefenseItemAffixDefinition(
  affixId: string,
): CoopDefenseItemAffixDefinition | undefined {
  return AFFIX_BY_ID.get(affixId);
}

/**
 * Ziehbarer Pool einer Kategorie fuer eine konkrete Klasse.
 *
 * Nur die Ziehung ist klassenabhaengig – ein bereits gerolltes Item bleibt mit jeder Klasse
 * ausruestbar und gespeichert. Ohne Klasse (bonuslose Default-Klasse vor Abschluss von Map 5)
 * fallen klassengebundene Affixe heraus.
 */
export function getCoopDefenseItemAffixesForRoll(
  slot: CoopDefenseItemSlot,
  classId: CoopDefenseClassId | null,
): readonly CoopDefenseItemAffixDefinition[] {
  return AFFIXES_BY_SLOT[slot].filter(
    (definition) => !definition.classIds || (classId !== null && definition.classIds.includes(classId)),
  );
}
