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
  readonly label: string;
  /** Kategorietypischer Grundwert – auf jedem Item dieses Slots vorhanden. */
  readonly baseStat: string;
  readonly baseLabel: string;
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
    label: 'Helm',
    baseStat: 'player.adrenalineRegenRate',
    baseLabel: 'Adrenalinregeneration',
    baseMode: 'add_percent_per_level',
    baseValueAtLevel1: 0.06,
    baseValuePerLevel: 0.03,
    baseValueSpread: 0.2,
  },
  gloves: {
    id: 'gloves',
    label: 'Handschuhe',
    baseStat: 'player.outgoingDamage',
    baseLabel: 'Schaden',
    baseMode: 'add_percent_per_level',
    baseValueAtLevel1: 0.08,
    baseValuePerLevel: 0.04,
    baseValueSpread: 0.2,
  },
  armor: {
    id: 'armor',
    label: 'Ruestung',
    baseStat: 'player.maxHp',
    baseLabel: 'Maximale HP',
    baseMode: 'add_per_level',
    baseValueAtLevel1: 25,
    baseValuePerLevel: 12,
    baseValueSpread: 0.2,
  },
  boots: {
    id: 'boots',
    label: 'Stiefel',
    baseStat: 'player.runSpeed',
    baseLabel: 'Bewegungsgeschwindigkeit',
    baseMode: 'add_percent_per_level',
    baseValueAtLevel1: 0.05,
    baseValuePerLevel: 0.02,
    baseValueSpread: 0.2,
  },
});

export interface CoopDefenseItemRarityDefinition {
  readonly id: CoopDefenseItemRarity;
  readonly label: string;
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
    label: 'Gewoehnlich',
    affixCount: 0,
    weight: 55,
    color: COLORS.GREY_2,
    salvageXp: 5,
  },
  blue: {
    id: 'blue',
    label: 'Selten',
    affixCount: 1,
    weight: 33,
    color: COLORS.BLUE_3,
    salvageXp: 12,
  },
  yellow: {
    id: 'yellow',
    label: 'Episch',
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
  readonly label: string;
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
  readonly shortText?: (value: number) => string;
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
  /** Kinetische Ladung: Wegstrecke je Ladung. */
  movementChargeDistancePx: 500,
});

/** `3,2` statt `3.2000000000000004` – Prozentwerte im Tooltip bleiben lesbar. */
function percentText(fraction: number): string {
  const rounded = Math.round(fraction * 1000) / 10;
  return `${rounded}`.replace('.', ',');
}

/** `2` statt `2.0` – Sekunden aus Millisekunden, ohne unnoetige Nachkommastelle. */
function secondsText(durationMs: number): string {
  return `${Math.round(durationMs / 100) / 10}`.replace('.', ',');
}

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
    label: 'Leben',
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
    label: 'Lebensregeneration',
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
    label: 'Ruestungsmaximum',
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
    label: 'Ruestungsregeneration',
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
    label: 'Ruestungsgewinn',
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
    label: 'Schadensreduktion',
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
    label: 'Letzte Bastion',
    weight: 35,
    minAtLevel1: 0.05,
    maxAtLevel1: 0.1,
    perLevel: 0.015,
    slots: ['armor'],
    displayAsPercent: true,
    shortText: (value) => `Unter ${percentText(COOP_DEFENSE_AFFIX_RULES.lowHpThreshold)} % HP:`
      + ` ${percentText(value)} % Schadensreduktion`,
  },
  {
    id: 'out_of_combat_armor_repair',
    label: 'Notfallreparatur',
    weight: 45,
    minAtLevel1: 4,
    maxAtLevel1: 8,
    perLevel: 1.5,
    slots: ['armor'],
    displayAsPercent: false,
    shortText: (value) => `${secondsText(COOP_DEFENSE_AFFIX_RULES.emergencyRepairDelayMs)} s ohne Schaden:`
      + ` +${Math.round(value * 10) / 10} Ruestung/s`,
  },
  {
    id: 'damage_reflection',
    label: 'Dornenplatten',
    weight: 25,
    minAtLevel1: 0.05,
    maxAtLevel1: 0.1,
    perLevel: 0.015,
    slots: ['armor'],
    displayAsPercent: true,
    shortText: (value) => `Wirft ${percentText(value)} % des erlittenen Schadens auf den Verursacher zurueck`,
  },
  {
    id: 'life_leech',
    label: 'Lifeleech',
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
    label: 'Schaden',
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
    // Erhoeht ausschliesslich das persoenliche Maximum. Die Kapazitaetskosten der einzelnen
    // Konstrukte bleiben bewusst spielerunabhaengig.
    id: 'construction_capacity',
    label: 'Baukapazitaet',
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
    id: 'primary_vulnerability',
    label: 'Fokusfeuer',
    weight: 15,
    minAtLevel1: 0.015,
    maxAtLevel1: 0.035,
    perLevel: 0.0025,
    slots: ['gloves'],
    displayAsPercent: true,
    shortText: (value) => `${percentText(value)} % Chance bei Primaerwaffentreffern:`
      + ` Ziel erleidet ${secondsText(COOP_DEFENSE_AFFIX_RULES.vulnerabilityDurationMs)} s lang`
      + ` ${percentText(COOP_DEFENSE_AFFIX_RULES.vulnerabilityBonus)} % mehr Schaden aus allen Quellen`,
  },
  {
    id: 'primary_culling',
    label: 'Hinrichtung',
    weight: 10,
    minAtLevel1: 0.01,
    maxAtLevel1: 0.025,
    perLevel: 0.0025,
    slots: ['gloves'],
    displayAsPercent: true,
    shortText: (value) => `${percentText(value)} % Chance, einen Gegner unter`
      + ` ${percentText(COOP_DEFENSE_AFFIX_RULES.cullingHpThreshold)} % HP sofort zu toeten (nicht bei Bossen)`,
  },
  {
    id: 'primary_slow',
    label: 'Unterdrueckungsmunition',
    weight: 40,
    minAtLevel1: 0.06,
    maxAtLevel1: 0.12,
    perLevel: 0.01,
    slots: ['gloves'],
    displayAsPercent: true,
    shortText: (value) => `${percentText(value)} % Chance bei Primaerwaffentreffern:`
      + ` Ziel ${secondsText(COOP_DEFENSE_AFFIX_RULES.suppressionSlowDurationMs)} s lang`
      + ` ${percentText(COOP_DEFENSE_AFFIX_RULES.suppressionSlowFraction)} % langsamer`,
  },
  {
    id: 'primary_kill_fire_chunks',
    label: 'Brandzerfall',
    weight: 15,
    minAtLevel1: 0.04,
    maxAtLevel1: 0.08,
    perLevel: 0.01,
    slots: ['gloves'],
    displayAsPercent: true,
    shortText: (value) => `${percentText(value)} % Chance bei einem Primaerwaffen-Kill:`
      + ` schleudert ${COOP_DEFENSE_AFFIX_RULES.fireChunkCount} brennende Brocken auf nahe Bodenstellen`,
  },
  {
    id: 'low_hp_blood_rage',
    label: 'Blutrausch',
    weight: 25,
    minAtLevel1: 0.08,
    maxAtLevel1: 0.14,
    perLevel: 0.015,
    slots: ['gloves'],
    displayAsPercent: true,
    shortText: (value) => `Unter ${percentText(COOP_DEFENSE_AFFIX_RULES.lowHpThreshold)} % HP:`
      + ` +${percentText(value)} % Schaden und`
      + ` +${percentText(COOP_DEFENSE_AFFIX_RULES.bloodRageLifeLeechBonus)} % Lifeleech`,
  },
  {
    // Bewusst der Gegenpol zu Blutrausch: beide koennen nie gleichzeitig aktiv sein.
    id: 'high_hp_damage',
    label: 'Unversehrt',
    weight: 45,
    minAtLevel1: 0.06,
    maxAtLevel1: 0.12,
    perLevel: 0.02,
    slots: ['gloves', 'armor'],
    displayAsPercent: true,
    shortText: (value) => `Ab ${percentText(COOP_DEFENSE_AFFIX_RULES.highHpThreshold)} % HP:`
      + ` +${percentText(value)} % Schaden`,
  },
  {
    id: 'run_speed',
    label: 'Bewegungsgeschwindigkeit',
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
    id: 'max_adrenaline',
    label: 'Maximales Adrenalin',
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
    label: 'Adrenalinregeneration',
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
    label: 'Adrenalingewinn',
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
    label: 'Adrenalinverbrauch',
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
    label: 'Wutgewinn',
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
    label: 'Maximale Wut',
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
    // Skaliert das `cooldown`-Feld des ausgeruesteten Utility-Configs. Waffen-, Ultimate- und
    // Dash-Cooldowns sowie der feste Bau-Cooldown der Konstruktionen bleiben unberuehrt.
    id: 'utility_cooldown',
    label: 'Utility-Cooldown',
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
    label: 'Kampfaufladung',
    weight: 45,
    minAtLevel1: 0.02,
    maxAtLevel1: 0.04,
    perLevel: 0.005,
    slots: ['helmet'],
    displayAsPercent: true,
    shortText: (value) => `Eigene Kills geben ${secondsText(COOP_DEFENSE_AFFIX_RULES.killChargeDurationMs)} s lang`
      + ` +${percentText(value)} % Adrenalinregeneration je Stapel`
      + ` (max. ${COOP_DEFENSE_AFFIX_RULES.killChargeMaxStacks})`,
  },
  {
    id: 'adrenaline_from_damage',
    label: 'Schockreaktion',
    weight: 40,
    minAtLevel1: 0.04,
    maxAtLevel1: 0.08,
    perLevel: 0.01,
    slots: ['helmet', 'armor'],
    displayAsPercent: true,
    shortText: (value) => `${percentText(value)} % des tatsaechlich erlittenen Schadens werden als Adrenalin gutgeschrieben`,
  },
  {
    id: 'dash_range',
    label: 'Dash-Reichweite',
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
    label: 'Nachbrenner',
    weight: 45,
    minAtLevel1: 0.1,
    maxAtLevel1: 0.18,
    perLevel: 0.02,
    slots: ['boots'],
    displayAsPercent: true,
    shortText: (value) => `Nach einem Dash ${secondsText(COOP_DEFENSE_AFFIX_RULES.afterburnerDurationMs)} s lang`
      + ` +${percentText(value)} % Bewegungsgeschwindigkeit`,
  },
  {
    id: 'low_hp_speed',
    label: 'Unter Druck',
    weight: 45,
    minAtLevel1: 0.1,
    maxAtLevel1: 0.18,
    perLevel: 0.02,
    slots: ['armor', 'boots'],
    displayAsPercent: true,
    shortText: (value) => `Unter ${percentText(COOP_DEFENSE_AFFIX_RULES.lowHpThreshold)} % HP:`
      + ` +${percentText(value)} % Bewegungsgeschwindigkeit`,
  },
  {
    id: 'movement_charge_damage',
    label: 'Kinetische Ladung',
    weight: 28,
    minAtLevel1: 0.15,
    maxAtLevel1: 0.3,
    perLevel: 0.03,
    slots: ['boots'],
    displayAsPercent: true,
    shortText: (value) => `Je ${COOP_DEFENSE_AFFIX_RULES.movementChargeDistancePx} zurueckgelegte Pixel:`
      + ` naechster Primaerangriff +${percentText(value)} % Schaden`,
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
