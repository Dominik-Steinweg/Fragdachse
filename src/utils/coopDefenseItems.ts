import {
  COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS,
  COOP_DEFENSE_ITEM_OFFER_SIZE,
  COOP_DEFENSE_ITEM_RARITIES,
  COOP_DEFENSE_ITEM_RARITY_DEFINITIONS,
  COOP_DEFENSE_ITEM_SALVAGE_XP_PER_LEVEL,
  COOP_DEFENSE_ITEM_SLOTS,
  COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT,
  getCoopDefenseItemAffixDefinition,
  getCoopDefenseItemAffixesForRoll,
  getCoopDefenseItemRarityDefinition,
  getCoopDefenseItemSlotDefinition,
  isCoopDefenseItemRarity,
  isCoopDefenseItemSlot,
  isCoopDefenseItemStatLowerBetter,
  type CoopDefenseItemAffixDefinition,
} from '../config/coopDefenseItems';
import type {
  CoopDefenseClassId,
  CoopDefenseItem,
  CoopDefenseItemAffix,
  CoopDefenseItemRarity,
  CoopDefenseItemSlot,
  CoopDefensePendingItemReward,
} from '../types';

/**
 * Reine Logik des Item-Systems: Wuerfeln, Beschreiben, Vergleichen, Inventarpflege und
 * Sanitisierung. Bewusst frei von Phaser, Netzwerk und `localStorage`, damit die Regeln
 * unabhaengig testbar bleiben.
 */

export type CoopDefenseEquippedItemIds = Partial<Record<CoopDefenseItemSlot, string>>;

export interface CoopDefenseItemStatLine {
  readonly stat: string;
  readonly label: string;
  readonly value: number;
  readonly displayAsPercent: boolean;
  /** Der kategorietypische Grundwert, nicht eine gewuerfelte Zusatzeigenschaft. */
  readonly isBaseStat: boolean;
}

/**
 * Ein Affix, dessen Wirkung sich nicht als Zahlenzeile ausdruecken laesst.
 *
 * Solche Affixe schreiben in keinen Stat-Bucket und tauchen deshalb nicht in
 * {@link CoopDefenseItemStatLine} auf – ohne diese Liste waeren sie im UI unsichtbar.
 */
export interface CoopDefenseItemAffixLine {
  readonly affixId: string;
  readonly label: string;
  readonly value: number;
  readonly displayAsPercent: boolean;
  /** Einzeilige Erklaerung inklusive der festen Parameter des Affixes. */
  readonly text: string;
}

export interface CoopDefenseItemDescription {
  readonly slot: CoopDefenseItemSlot;
  readonly slotLabel: string;
  readonly rarity: CoopDefenseItemRarity;
  readonly rarityLabel: string;
  readonly rarityColor: number;
  readonly itemLevel: number;
  readonly lines: readonly CoopDefenseItemStatLine[];
  /** Nur die Affixe ohne Stat; die Reihenfolge folgt der Reihenfolge auf dem Item. */
  readonly affixLines: readonly CoopDefenseItemAffixLine[];
}

export interface CoopDefenseItemComparisonRow {
  readonly stat: string;
  readonly label: string;
  readonly displayAsPercent: boolean;
  readonly candidateValue: number;
  readonly equippedValue: number;
  readonly delta: number;
}

const RARITY_RANK: Readonly<Record<CoopDefenseItemRarity, number>> = Object.freeze({
  white: 0,
  blue: 1,
  yellow: 2,
});

// ── Wuerfeln ────────────────────────────────────────────────────────────────

/**
 * Quantisiert einen gewuerfelten Wert so, dass die Anzeige stabil bleibt und gespeicherte
 * Items keine Fliesskomma-Schwaenze tragen. Die Stufung richtet sich nach der Groessenordnung,
 * weil derselbe additive Bucket sowohl HP (ganzzahlig) als auch Lifeleech (Bruchteil) fuehrt.
 */
function quantizeItemValue(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude >= 10) return Math.round(value);
  if (magnitude >= 1) return Math.round(value * 10) / 10;
  return Math.round(value * 1000) / 1000;
}

function sanitizeItemLevel(itemLevel: number): number {
  if (!Number.isFinite(itemLevel)) return 1;
  return Math.max(1, Math.floor(itemLevel));
}

export function normalizeCoopDefenseRareGuaranteeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(COOP_DEFENSE_ITEM_OFFER_SIZE, Math.floor(value)));
}

function rollBaseValue(slot: CoopDefenseItemSlot, itemLevel: number, random: () => number): number {
  const definition = getCoopDefenseItemSlotDefinition(slot);
  const nominal = definition.baseValueAtLevel1 + definition.baseValuePerLevel * (itemLevel - 1);
  const spread = definition.baseValueSpread * (random() * 2 - 1);
  return quantizeItemValue(nominal * (1 + spread));
}

function rollAffixValue(
  definition: CoopDefenseItemAffixDefinition,
  itemLevel: number,
  random: () => number,
): number {
  const shift = definition.perLevel * (itemLevel - 1);
  const min = definition.minAtLevel1 + shift;
  const max = definition.maxAtLevel1 + shift;
  return quantizeItemValue(min + random() * (max - min));
}

function rollRarity(random: () => number): CoopDefenseItemRarity {
  const totalWeight = COOP_DEFENSE_ITEM_RARITIES.reduce(
    (sum, rarity) => sum + getCoopDefenseItemRarityDefinition(rarity).weight,
    0,
  );
  let ticket = random() * totalWeight;
  for (const rarity of COOP_DEFENSE_ITEM_RARITIES) {
    ticket -= getCoopDefenseItemRarityDefinition(rarity).weight;
    if (ticket < 0) return rarity;
  }
  return COOP_DEFENSE_ITEM_RARITIES[COOP_DEFENSE_ITEM_RARITIES.length - 1];
}

/** Zieht `count` verschiedene Eintraege gleichverteilt; nie mehr, als der Pool hergibt. */
function pickDistinct<T>(pool: readonly T[], count: number, random: () => number): T[] {
  const remaining = [...pool];
  const picked: T[] = [];
  const wanted = Math.min(count, remaining.length);
  for (let i = 0; i < wanted; i++) {
    const index = Math.min(remaining.length - 1, Math.floor(random() * remaining.length));
    picked.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return picked;
}

/** Gewicht <= 0, NaN oder Infinity bedeutet einheitlich "nicht ziehbar". */
function sanitizeWeight(weight: number): number {
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

/**
 * Zieht `count` verschiedene Eintraege gewichtet und ohne Zuruecklegen.
 *
 * Das Gewicht ist keine feste Prozentchance, sondern nur ein Verhaeltnis innerhalb derselben
 * Ziehung: Gewicht 20 ist halb so wahrscheinlich wie Gewicht 40. Weil nach jeder Ziehung der
 * gezogene Eintrag entfaellt, verschiebt sich das Verhaeltnis fuer die zweite Ziehung – genau
 * das verhindert, dass ein Item dasselbe Affix zweimal traegt.
 */
export function pickWeightedDistinct<T>(
  pool: readonly T[],
  count: number,
  getWeight: (entry: T) => number,
  random: () => number,
): T[] {
  const remaining = pool.filter((entry) => sanitizeWeight(getWeight(entry)) > 0);
  const picked: T[] = [];
  const wanted = Math.min(count, remaining.length);

  for (let i = 0; i < wanted; i++) {
    const totalWeight = remaining.reduce((sum, entry) => sum + sanitizeWeight(getWeight(entry)), 0);
    let ticket = random() * totalWeight;
    // Der letzte Eintrag ist der Fallback: bei `random() === 1` laeuft das Ticket sonst durch.
    let index = remaining.length - 1;
    for (let candidate = 0; candidate < remaining.length; candidate++) {
      ticket -= sanitizeWeight(getWeight(remaining[candidate]));
      if (ticket < 0) { index = candidate; break; }
    }
    picked.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return picked;
}

function createItemUid(random: () => number): string {
  const chunk = (): string => Math.floor(random() * 0xffffffff).toString(36).padStart(7, '0');
  return `it_${chunk()}${chunk()}`;
}

/**
 * Wuerfelt ein Item der Kategorie.
 *
 * `classId` ist die Klasse, mit der die Runde abgeschlossen wurde; sie schraenkt nur den
 * ziehbaren Affix-Pool ein. Blau und Gelb greifen auf denselben vollstaendigen Pool zu – die
 * Seltenheit bestimmt ausschliesslich die Anzahl der Affixe, nicht ihre Qualitaet.
 */
export function rollCoopDefenseItem(
  slot: CoopDefenseItemSlot,
  itemLevel: number,
  classId: CoopDefenseClassId | null = null,
  random: () => number = Math.random,
): CoopDefenseItem {
  const level = sanitizeItemLevel(itemLevel);
  const rarity = rollRarity(random);
  const affixCount = getCoopDefenseItemRarityDefinition(rarity).affixCount;
  const affixes = pickWeightedDistinct(
    getCoopDefenseItemAffixesForRoll(slot, classId),
    affixCount,
    (definition) => definition.weight,
    random,
  )
    .map((definition) => ({
      affixId: definition.id,
      value: rollAffixValue(definition, level, random),
    }));

  return {
    uid: createItemUid(random),
    slot,
    rarity,
    itemLevel: level,
    baseValue: rollBaseValue(slot, level, random),
    affixes,
  };
}

/**
 * Angebot nach einem Sieg. Die Kategorien sind garantiert verschieden, damit die Auswahl nicht
 * auf einen einzigen Slot zusammenfaellt.
 *
 * Die UIDs werden zusaetzlich gegeneinander eindeutig gemacht: das Angebot wird persistiert und
 * die Auswahl laeuft ueber die UID, eine Kollision waere hier also ein echter Fehler.
 */
export function rollCoopDefenseItemOffer(
  itemLevel: number,
  classId: CoopDefenseClassId | null = null,
  random: () => number = Math.random,
): CoopDefenseItem[] {
  let offers: CoopDefenseItem[] = [];
  // Die Kategorien werden weiterhin gleichverteilt gezogen; nur die Affixe sind gewichtet.
  for (const slot of pickDistinct(COOP_DEFENSE_ITEM_SLOTS, COOP_DEFENSE_ITEM_OFFER_SIZE, random)) {
    offers = addCoopDefenseItem(offers, rollCoopDefenseItem(slot, itemLevel, classId, random));
  }
  return offers;
}

/**
 * Hebt die niedrigsten Angebote bis zur autoritativen Mindestanzahl auf mindestens selten an.
 * Die Anhebung ist bewusst in place: UID, Slot, Item-Level, Basiswert und bereits gezogene
 * Affixe bleiben unverändert. Nur die fehlenden Affixe werden nach denselben Slot-, Klassen- und
 * Gewichtsregeln ergänzt, die auch beim normalen Roll gelten.
 */
export function applyCoopDefenseRareGuarantee(
  offers: readonly CoopDefenseItem[],
  rareGuaranteeCount: number,
  classId: CoopDefenseClassId | null = null,
  random: () => number = Math.random,
): CoopDefenseItem[] {
  const guaranteed = normalizeCoopDefenseRareGuaranteeCount(rareGuaranteeCount);
  if (guaranteed === 0 || offers.length === 0) return [...offers];

  const rareCount = offers.filter((item) => RARITY_RANK[item.rarity] >= RARITY_RANK.blue).length;
  let missingGuarantees = Math.max(0, guaranteed - rareCount);
  if (missingGuarantees === 0) return [...offers];

  const upgraded = [...offers];
  const candidates = offers
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.rarity === 'white')
    .sort((left, right) => left.index - right.index);

  for (const candidate of candidates) {
    if (missingGuarantees <= 0) break;
    const raised = raiseCoopDefenseItemToRare(candidate.item, classId, random);
    if (!raised) continue;
    upgraded[candidate.index] = raised;
    missingGuarantees -= 1;
  }
  return upgraded;
}

function raiseCoopDefenseItemToRare(
  item: CoopDefenseItem,
  classId: CoopDefenseClassId | null,
  random: () => number,
): CoopDefenseItem | null {
  const requiredAffixes = getCoopDefenseItemRarityDefinition('blue').affixCount;
  const missingAffixes = Math.max(0, requiredAffixes - item.affixes.length);
  const existingAffixIds = new Set(item.affixes.map((affix) => affix.affixId));
  const newAffixDefinitions = pickWeightedDistinct(
    getCoopDefenseItemAffixesForRoll(item.slot, classId)
      .filter((definition) => !existingAffixIds.has(definition.id)),
    missingAffixes,
    (definition) => definition.weight,
    random,
  );
  if (newAffixDefinitions.length < missingAffixes) return null;

  return {
    ...item,
    rarity: 'blue',
    affixes: [
      ...item.affixes,
      ...newAffixDefinitions.map((definition) => ({
        affixId: definition.id,
        value: rollAffixValue(definition, item.itemLevel, random),
      })),
    ],
  };
}

// ── Beschreiben und Vergleichen ─────────────────────────────────────────────

export function getCoopDefenseItemStatLines(item: CoopDefenseItem): CoopDefenseItemStatLine[] {
  const slotDefinition = getCoopDefenseItemSlotDefinition(item.slot);
  const lines: CoopDefenseItemStatLine[] = [{
    stat: slotDefinition.baseStat,
    label: slotDefinition.baseLabel,
    value: item.baseValue,
    displayAsPercent: slotDefinition.baseMode === 'add_percent_per_level',
    isBaseStat: true,
  }];

  for (const affix of item.affixes) {
    const definition = getCoopDefenseItemAffixDefinition(affix.affixId);
    // Affixe ohne Stat tragen ihren Wert ausschliesslich ueber einen Laufzeit-Handler und
    // gehoeren damit nicht in die stat-basierte Zeilenliste.
    if (!definition?.stat) continue;
    lines.push({
      stat: definition.stat,
      label: definition.label,
      value: affix.value,
      displayAsPercent: definition.displayAsPercent,
      isBaseStat: false,
    });
  }
  return lines;
}

/**
 * Affixe, die ausschliesslich ueber einen Laufzeit-Handler wirken, mit ihrer Erklaerung.
 *
 * Das Gegenstueck zu {@link getCoopDefenseItemStatLines}: zusammen decken beide Listen jedes
 * Affix eines Items genau einmal ab.
 */
export function getCoopDefenseItemAffixLines(item: CoopDefenseItem): CoopDefenseItemAffixLine[] {
  const lines: CoopDefenseItemAffixLine[] = [];
  for (const affix of item.affixes) {
    const definition = getCoopDefenseItemAffixDefinition(affix.affixId);
    if (!definition || definition.stat) continue;
    lines.push({
      affixId: definition.id,
      label: definition.label,
      value: affix.value,
      displayAsPercent: definition.displayAsPercent,
      text: definition.shortText?.(affix.value) ?? definition.label,
    });
  }
  return lines;
}

export function describeCoopDefenseItem(item: CoopDefenseItem): CoopDefenseItemDescription {
  const slotDefinition = getCoopDefenseItemSlotDefinition(item.slot);
  const rarityDefinition = getCoopDefenseItemRarityDefinition(item.rarity);
  return {
    slot: item.slot,
    slotLabel: slotDefinition.label,
    rarity: item.rarity,
    rarityLabel: rarityDefinition.label,
    rarityColor: rarityDefinition.color,
    itemLevel: item.itemLevel,
    lines: getCoopDefenseItemStatLines(item),
    affixLines: getCoopDefenseItemAffixLines(item),
  };
}

/** `+12`, `+8.5 %`, `-5 %` – vorzeichenbehaftet, damit Vergleiche lesbar bleiben. */
export function formatCoopDefenseItemValue(value: number, displayAsPercent: boolean): string {
  const shown = displayAsPercent ? value * 100 : value;
  const rounded = Math.round(shown * 10) / 10;
  const text = Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
  const sign = rounded > 0 ? '+' : '';
  return displayAsPercent ? `${sign}${text} %` : `${sign}${text}`;
}

function collectStatTotals(item: CoopDefenseItem | null): Map<string, CoopDefenseItemStatLine> {
  const totals = new Map<string, CoopDefenseItemStatLine>();
  if (!item) return totals;
  for (const line of getCoopDefenseItemStatLines(item)) {
    const existing = totals.get(line.stat);
    totals.set(line.stat, existing
      ? { ...existing, value: existing.value + line.value }
      : line);
  }
  return totals;
}

/**
 * Zeilenweiser Vergleich mit dem aktuell ausgeruesteten Item derselben Kategorie. Stats, die nur
 * auf einer Seite vorkommen, erscheinen mit `0` auf der anderen.
 */
export function compareCoopDefenseItems(
  candidate: CoopDefenseItem,
  equipped: CoopDefenseItem | null,
): CoopDefenseItemComparisonRow[] {
  const candidateTotals = collectStatTotals(candidate);
  const equippedTotals = collectStatTotals(equipped);
  const rows: CoopDefenseItemComparisonRow[] = [];

  for (const stat of new Set([...candidateTotals.keys(), ...equippedTotals.keys()])) {
    const line = candidateTotals.get(stat) ?? equippedTotals.get(stat)!;
    const candidateValue = candidateTotals.get(stat)?.value ?? 0;
    const equippedValue = equippedTotals.get(stat)?.value ?? 0;
    rows.push({
      stat,
      label: line.label,
      displayAsPercent: line.displayAsPercent,
      candidateValue,
      equippedValue,
      delta: quantizeItemValue(candidateValue - equippedValue),
    });
  }
  return rows;
}

/**
 * Ist die Veraenderung eine Verbesserung? Bei Kosten-Stats (z.B. Adrenalinverbrauch) ist der
 * kleinere Wert der bessere, dort zaehlt ein negatives Delta als Gewinn.
 */
export function isCoopDefenseItemImprovement(stat: string, delta: number): boolean {
  return isCoopDefenseItemStatLowerBetter(stat) ? delta < 0 : delta > 0;
}

// ── Zerlegen ────────────────────────────────────────────────────────────────

/**
 * Zerlege-XP: klein gehalten, damit Zerlegen niemals die effizienteste XP-Quelle wird. Ein
 * Bossgegner allein bringt 100–400 XP.
 */
export function getCoopDefenseItemSalvageXp(item: CoopDefenseItem): number {
  const base = getCoopDefenseItemRarityDefinition(item.rarity).salvageXp;
  const levelFactor = 1 + COOP_DEFENSE_ITEM_SALVAGE_XP_PER_LEVEL * (item.itemLevel - 1);
  return Math.max(1, Math.round(base * levelFactor));
}

// ── Inventarpflege ──────────────────────────────────────────────────────────

export function findCoopDefenseItem(
  items: readonly CoopDefenseItem[],
  uid: string | undefined,
): CoopDefenseItem | null {
  if (!uid) return null;
  return items.find((item) => item.uid === uid) ?? null;
}

export function getEquippedCoopDefenseItem(
  items: readonly CoopDefenseItem[],
  equippedIds: CoopDefenseEquippedItemIds,
  slot: CoopDefenseItemSlot,
): CoopDefenseItem | null {
  const item = findCoopDefenseItem(items, equippedIds[slot]);
  return item?.slot === slot ? item : null;
}

export function getEquippedCoopDefenseItems(
  items: readonly CoopDefenseItem[],
  equippedIds: CoopDefenseEquippedItemIds,
): CoopDefenseItem[] {
  return COOP_DEFENSE_ITEM_SLOTS
    .map((slot) => getEquippedCoopDefenseItem(items, equippedIds, slot))
    .filter((item): item is CoopDefenseItem => item !== null);
}

/** Nicht ausgeruestete Items einer Kategorie – genau die, die aufs Limit zaehlen. */
export function getCoopDefenseStashItems(
  items: readonly CoopDefenseItem[],
  equippedIds: CoopDefenseEquippedItemIds,
  slot: CoopDefenseItemSlot,
): CoopDefenseItem[] {
  const equippedUid = equippedIds[slot];
  return items.filter((item) => item.slot === slot && item.uid !== equippedUid);
}

export function getFreeCoopDefenseStashSlots(
  items: readonly CoopDefenseItem[],
  equippedIds: CoopDefenseEquippedItemIds,
  slot: CoopDefenseItemSlot,
): number {
  const used = getCoopDefenseStashItems(items, equippedIds, slot).length;
  return Math.max(0, COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT - used);
}

export function isCoopDefenseStashFull(
  items: readonly CoopDefenseItem[],
  equippedIds: CoopDefenseEquippedItemIds,
  slot: CoopDefenseItemSlot,
): boolean {
  return getFreeCoopDefenseStashSlots(items, equippedIds, slot) <= 0;
}

/** Haengt ein Item an und vergibt bei einer UID-Kollision eine neue eindeutige UID. */
export function addCoopDefenseItem(
  items: readonly CoopDefenseItem[],
  item: CoopDefenseItem,
): CoopDefenseItem[] {
  let candidate = item;
  let suffix = 1;
  while (items.some((existing) => existing.uid === candidate.uid)) {
    candidate = { ...item, uid: `${item.uid}_${suffix}` };
    suffix++;
  }
  return [...items, candidate];
}

export function removeCoopDefenseItem(
  items: readonly CoopDefenseItem[],
  uid: string,
): CoopDefenseItem[] {
  return items.filter((item) => item.uid !== uid);
}

export type CoopDefenseItemSortMode = 'rarity' | 'itemLevel';

/** Stabile Sortierung: absteigend nach dem Hauptkriterium, dann nach dem jeweils anderen. */
export function sortCoopDefenseItems(
  items: readonly CoopDefenseItem[],
  mode: CoopDefenseItemSortMode,
): CoopDefenseItem[] {
  return [...items].sort((a, b) => {
    const rarityDelta = RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity];
    const levelDelta = b.itemLevel - a.itemLevel;
    const primary = mode === 'rarity' ? rarityDelta : levelDelta;
    if (primary !== 0) return primary;
    const secondary = mode === 'rarity' ? levelDelta : rarityDelta;
    if (secondary !== 0) return secondary;
    return a.uid.localeCompare(b.uid);
  });
}

// ── Sanitisierung ───────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clampToAffixRange(definition: CoopDefenseItemAffixDefinition, value: number, itemLevel: number): number {
  const shift = definition.perLevel * (itemLevel - 1);
  const min = definition.minAtLevel1 + shift;
  const max = definition.maxAtLevel1 + shift;
  return quantizeItemValue(Math.min(Math.max(value, Math.min(min, max)), Math.max(min, max)));
}

function sanitizeAffixes(raw: unknown, slot: CoopDefenseItemSlot, itemLevel: number): CoopDefenseItemAffix[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const affixes: CoopDefenseItemAffix[] = [];

  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.affixId !== 'string') continue;
    const definition = getCoopDefenseItemAffixDefinition(entry.affixId);
    // Unbekannte oder kategoriefremde Eigenschaften werden verworfen, nicht geraten.
    if (!definition || !definition.slots.includes(slot)) continue;
    if (seen.has(definition.id)) continue;
    const value = typeof entry.value === 'number' && Number.isFinite(entry.value) ? entry.value : 0;
    seen.add(definition.id);
    affixes.push({ affixId: definition.id, value: clampToAffixRange(definition, value, itemLevel) });
    if (affixes.length >= 2) break;
  }
  return affixes;
}

/** Erzwingt die Seltenheits-Regel: die Affix-Anzahl folgt der Seltenheit, nicht der Datei. */
function reconcileRarity(rarity: CoopDefenseItemRarity, affixes: CoopDefenseItemAffix[]): {
  rarity: CoopDefenseItemRarity;
  affixes: CoopDefenseItemAffix[];
} {
  const expected = getCoopDefenseItemRarityDefinition(rarity).affixCount;
  if (affixes.length === expected) return { rarity, affixes };
  if (affixes.length > expected) return { rarity, affixes: affixes.slice(0, expected) };
  // Zu wenige gueltige Eigenschaften: auf die passende, niedrigere Seltenheit zurueckstufen.
  const downgraded = COOP_DEFENSE_ITEM_RARITIES.find(
    (candidate) => getCoopDefenseItemRarityDefinition(candidate).affixCount === affixes.length,
  ) ?? 'white';
  return { rarity: downgraded, affixes };
}

export function sanitizeCoopDefenseItem(raw: unknown): CoopDefenseItem | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.uid !== 'string' || raw.uid.length === 0) return null;
  if (!isCoopDefenseItemSlot(raw.slot)) return null;
  if (!isCoopDefenseItemRarity(raw.rarity)) return null;

  const itemLevel = sanitizeItemLevel(typeof raw.itemLevel === 'number' ? raw.itemLevel : 1);
  const slotDefinition = getCoopDefenseItemSlotDefinition(raw.slot);
  const nominal = slotDefinition.baseValueAtLevel1 + slotDefinition.baseValuePerLevel * (itemLevel - 1);
  const maxBaseValue = nominal * (1 + slotDefinition.baseValueSpread);
  const rawBaseValue = typeof raw.baseValue === 'number' && Number.isFinite(raw.baseValue) ? raw.baseValue : 0;
  const baseValue = quantizeItemValue(Math.min(Math.max(rawBaseValue, 0), maxBaseValue));

  const { rarity, affixes } = reconcileRarity(raw.rarity, sanitizeAffixes(raw.affixes, raw.slot, itemLevel));
  return { uid: raw.uid, slot: raw.slot, rarity, itemLevel, baseValue, affixes };
}

/**
 * Sanitisiert eine Item-Liste, entfernt UID-Duplikate und erzwingt das Kategorielimit. Ohne
 * `equippedIds` gilt das Limit fuer alle Items der Kategorie; mit `equippedIds` bleibt das
 * ausgeruestete Teil zusaetzlich erhalten.
 */
export function sanitizeCoopDefenseItems(
  raw: unknown,
  equippedIds: CoopDefenseEquippedItemIds = {},
): CoopDefenseItem[] {
  if (!Array.isArray(raw)) return [];
  const seenUids = new Set<string>();
  const perSlotCount: Partial<Record<CoopDefenseItemSlot, number>> = {};
  const items: CoopDefenseItem[] = [];

  for (const entry of raw) {
    const item = sanitizeCoopDefenseItem(entry);
    if (!item || seenUids.has(item.uid)) continue;

    const isEquipped = equippedIds[item.slot] === item.uid;
    if (!isEquipped) {
      const used = perSlotCount[item.slot] ?? 0;
      if (used >= COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT) continue;
      perSlotCount[item.slot] = used + 1;
    }
    seenUids.add(item.uid);
    items.push(item);
  }
  return items;
}

/**
 * Sanitisiert die ausgeruesteten Teile fuer den Loadout-Commit: hoechstens ein Item je Kategorie,
 * unbekannte Eintraege fallen weg. Das ist die Validierung an der Netzwerkgrenze.
 */
export function sanitizeCoopDefenseEquippedItems(raw: unknown): CoopDefenseItem[] {
  if (!Array.isArray(raw)) return [];
  const bySlot = new Map<CoopDefenseItemSlot, CoopDefenseItem>();
  for (const entry of raw) {
    const item = sanitizeCoopDefenseItem(entry);
    if (!item || bySlot.has(item.slot)) continue;
    bySlot.set(item.slot, item);
  }
  return COOP_DEFENSE_ITEM_SLOTS
    .map((slot) => bySlot.get(slot))
    .filter((item): item is CoopDefenseItem => item !== undefined);
}

/**
 * Liest die Slot-Zuordnung rein strukturell, ohne die Item-Liste zu kennen.
 *
 * Wird beim Laden gebraucht, weil {@link sanitizeCoopDefenseItems} die Slot-Zuordnung bereits
 * benoetigt (um das ausgeruestete Teil vom Kategorielimit auszunehmen), die Zuordnung selbst
 * aber erst gegen die fertige Liste geprueft werden kann.
 */
export function readCoopDefenseEquippedItemIdCandidates(raw: unknown): CoopDefenseEquippedItemIds {
  const equipped: CoopDefenseEquippedItemIds = {};
  if (!isRecord(raw)) return equipped;
  for (const slot of COOP_DEFENSE_ITEM_SLOTS) {
    const uid = raw[slot];
    if (typeof uid === 'string' && uid.length > 0) equipped[slot] = uid;
  }
  return equipped;
}

/** Verwirft Slot-Zuweisungen ohne passendes Item; ein leerer Slot ist ein gueltiger Zustand. */
export function sanitizeCoopDefenseEquippedItemIds(
  raw: unknown,
  items: readonly CoopDefenseItem[],
): CoopDefenseEquippedItemIds {
  const equipped: CoopDefenseEquippedItemIds = {};
  if (!isRecord(raw)) return equipped;

  for (const slot of COOP_DEFENSE_ITEM_SLOTS) {
    const uid = raw[slot];
    if (typeof uid !== 'string') continue;
    const item = items.find((candidate) => candidate.uid === uid);
    if (item?.slot === slot) equipped[slot] = uid;
  }
  return equipped;
}

export function sanitizeCoopDefensePendingItemReward(raw: unknown): CoopDefensePendingItemReward | null {
  if (!isRecord(raw)) return null;
  const roundEndedAt = typeof raw.roundEndedAt === 'number' && Number.isFinite(raw.roundEndedAt)
    ? Math.floor(raw.roundEndedAt)
    : 0;
  if (roundEndedAt <= 0) return null;

  const offers = Array.isArray(raw.offers)
    ? raw.offers
      .map((entry) => sanitizeCoopDefenseItem(entry))
      .filter((item): item is CoopDefenseItem => item !== null)
      .slice(0, COOP_DEFENSE_ITEM_OFFER_SIZE)
    : [];
  if (offers.length === 0) return null;
  const rareGuaranteeCount = normalizeCoopDefenseRareGuaranteeCount(raw.rareGuaranteeCount);
  return rareGuaranteeCount > 0
    ? { roundEndedAt, offers, rareGuaranteeCount }
    : { roundEndedAt, offers };
}

/** Für Tests und Diagnose: alle Affix-IDs, die eine Kategorie tragen kann. */
export function getCoopDefenseItemAffixIdsForSlot(slot: CoopDefenseItemSlot): string[] {
  return COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS
    .filter((definition) => definition.slots.includes(slot))
    .map((definition) => definition.id);
}
