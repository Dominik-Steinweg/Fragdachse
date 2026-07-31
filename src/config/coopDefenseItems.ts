import { COLORS } from '../config';
import type { CoopDefenseItemRarity, CoopDefenseItemSlot } from '../types';
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
    color: COLORS.BLUE_2,
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
  readonly stat: string;
  readonly mode: CoopDefenseUpgradeEffectMode;
  /** Untere und obere Grenze des Wurfs auf Item-Level 1 (vorzeichenrichtig, min <= max). */
  readonly minAtLevel1: number;
  readonly maxAtLevel1: number;
  /** Verschiebung beider Grenzen je weiterem Item-Level. */
  readonly perLevel: number;
  /**
   * Betragsmaessige Obergrenze fuer die Summe aller Items auf diesem Stat. Verhindert, dass
   * problematische Werte (Laufgeschwindigkeit, Lifeleech) ueber die Ausruestung eskalieren.
   */
  readonly maxTotalFromItems: number;
  /** Kategorien, auf denen diese Eigenschaft vorkommen darf. */
  readonly slots: readonly CoopDefenseItemSlot[];
  /** Anzeige als Prozentwert im UI. */
  readonly displayAsPercent: boolean;
  /**
   * Kosten-Stat: der kleinere Wert ist der bessere. Der Vergleich faerbt solche Zeilen umgekehrt,
   * sonst erschiene ein gesenkter Verbrauch als Verschlechterung.
   */
  readonly lowerIsBetter?: boolean;
}

/**
 * Startpool: klein, kontrollierbar und pro Kategorie mit erkennbarer Identitaet
 * (Helm = Adrenalin, Handschuhe = Offensive, Ruestung = Defensive, Stiefel = Mobilitaet).
 */
export const COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS: readonly CoopDefenseItemAffixDefinition[] =
Object.freeze([
  {
    id: 'max_hp',
    label: 'Leben',
    stat: 'player.maxHp',
    mode: 'add_per_level',
    minAtLevel1: 10,
    maxAtLevel1: 25,
    perLevel: 8,
    maxTotalFromItems: 200,
    slots: ['armor', 'boots'],
    displayAsPercent: false,
  },
  {
    id: 'hp_regen',
    label: 'Lebensregeneration',
    stat: 'player.hpRegenPerSecond',
    mode: 'add_per_level',
    minAtLevel1: 1,
    maxAtLevel1: 3,
    perLevel: 1,
    maxTotalFromItems: 20,
    slots: ['armor', 'boots'],
    displayAsPercent: false,
  },
  {
    id: 'max_armor',
    label: 'Ruestungsmaximum',
    stat: 'player.maxArmor',
    mode: 'add_per_level',
    minAtLevel1: 10,
    maxAtLevel1: 25,
    perLevel: 8,
    maxTotalFromItems: 200,
    slots: ['armor'],
    displayAsPercent: false,
  },
  {
    id: 'armor_regen',
    label: 'Ruestungsregeneration',
    stat: 'player.armorRegenPerSecond',
    mode: 'add_per_level',
    minAtLevel1: 1,
    maxAtLevel1: 4,
    perLevel: 1.5,
    maxTotalFromItems: 25,
    slots: ['armor'],
    displayAsPercent: false,
  },
  {
    id: 'armor_gain',
    label: 'Ruestungsgewinn',
    stat: 'player.armorGain',
    mode: 'add_percent_per_level',
    minAtLevel1: 0.04,
    maxAtLevel1: 0.1,
    perLevel: 0.03,
    maxTotalFromItems: 0.6,
    slots: ['armor'],
    displayAsPercent: true,
  },
  {
    id: 'life_leech',
    label: 'Lifeleech',
    stat: 'player.lifeLeechFraction',
    mode: 'add_per_level',
    minAtLevel1: 0.01,
    maxAtLevel1: 0.03,
    perLevel: 0.01,
    maxTotalFromItems: 0.15,
    slots: ['gloves'],
    displayAsPercent: true,
  },
  {
    id: 'outgoing_damage',
    label: 'Schaden',
    stat: 'player.outgoingDamage',
    mode: 'add_percent_per_level',
    minAtLevel1: 0.03,
    maxAtLevel1: 0.08,
    perLevel: 0.03,
    maxTotalFromItems: 0.6,
    slots: ['gloves'],
    displayAsPercent: true,
  },
  {
    id: 'run_speed',
    label: 'Bewegungsgeschwindigkeit',
    stat: 'player.runSpeed',
    mode: 'add_percent_per_level',
    minAtLevel1: 0.02,
    maxAtLevel1: 0.05,
    perLevel: 0.015,
    // Bewusst der engste Rahmen im Pool: Laufgeschwindigkeit steigt bereits ueber Upgrades
    // (+15 %) und den Klassenmultiplikator (x1.2).
    maxTotalFromItems: 0.12,
    slots: ['boots'],
    displayAsPercent: true,
  },
  {
    id: 'max_adrenaline',
    label: 'Maximales Adrenalin',
    stat: 'player.maxAdrenaline',
    mode: 'add_per_level',
    minAtLevel1: 5,
    maxAtLevel1: 12,
    perLevel: 4,
    maxTotalFromItems: 80,
    slots: ['helmet', 'boots'],
    displayAsPercent: false,
  },
  {
    id: 'adrenaline_regen',
    label: 'Adrenalinregeneration',
    stat: 'player.adrenalineRegenRate',
    mode: 'add_percent_per_level',
    minAtLevel1: 0.03,
    maxAtLevel1: 0.08,
    perLevel: 0.03,
    maxTotalFromItems: 0.6,
    slots: ['helmet'],
    displayAsPercent: true,
  },
  {
    id: 'adrenaline_gain',
    label: 'Adrenalingewinn',
    stat: 'player.adrenalineGain',
    mode: 'add_percent_per_level',
    minAtLevel1: 0.04,
    maxAtLevel1: 0.1,
    perLevel: 0.03,
    maxTotalFromItems: 0.6,
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
    minAtLevel1: -0.08,
    maxAtLevel1: -0.03,
    perLevel: -0.02,
    maxTotalFromItems: 0.4,
    slots: ['helmet'],
    displayAsPercent: true,
    lowerIsBetter: true,
  },
  {
    id: 'dash_range',
    label: 'Dash-Reichweite',
    stat: 'player.dashRange',
    mode: 'add_percent_per_level',
    minAtLevel1: 0.04,
    maxAtLevel1: 0.1,
    perLevel: 0.03,
    maxTotalFromItems: 0.6,
    slots: ['boots'],
    displayAsPercent: true,
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
    .map((definition) => definition.stat),
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

export function getCoopDefenseItemAffixesForSlot(
  slot: CoopDefenseItemSlot,
): readonly CoopDefenseItemAffixDefinition[] {
  return AFFIXES_BY_SLOT[slot];
}
