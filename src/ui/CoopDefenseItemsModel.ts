import { COLORS } from '../config';
import {
  COOP_DEFENSE_ITEM_SLOTS,
  COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT,
  getCoopDefenseItemRarityDefinition,
  getCoopDefenseItemSlotDefinition,
} from '../config/coopDefenseItems';
import type { CoopDefenseItem, CoopDefenseItemSlot } from '../types';
import {
  compareCoopDefenseItems,
  describeCoopDefenseItem,
  formatCoopDefenseItemValue,
  getCoopDefenseItemSalvageXp,
  getCoopDefenseStashItems,
  getEquippedCoopDefenseItem,
  isCoopDefenseItemImprovement,
  sortCoopDefenseItems,
  type CoopDefenseEquippedItemIds,
  type CoopDefenseItemSortMode,
} from '../utils/coopDefenseItems';

/**
 * View-Model des Item-Menues: Rasteraufteilung, Tooltip-Inhalte, Gesamtwerte und die Regeln fuer
 * Drag & Drop. Bewusst Phaser-frei, damit die Darstellung im Overlay duenn bleibt und die Logik
 * unter `node` testbar ist – gleiches Vorgehen wie bei `MatchResultsModel`.
 */

/** Strukturgleich zu `UiTooltipLine`; haelt dieses Modul frei von Phaser-Abhaengigkeiten. */
export interface CoopDefenseItemTooltipLine {
  readonly text: string;
  readonly color: number;
  readonly bold?: boolean;
}

export interface CoopDefenseItemTooltipContent {
  readonly title: string;
  readonly titleColor: number;
  readonly lines: readonly CoopDefenseItemTooltipLine[];
}

export interface CoopDefenseInventoryColumn {
  readonly slot: CoopDefenseItemSlot;
  readonly label: string;
  readonly equipped: CoopDefenseItem | null;
  /** Immer `COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT` Eintraege – leere Plaetze sind `null`. */
  readonly cells: readonly (CoopDefenseItem | null)[];
  readonly used: number;
  readonly capacity: number;
}

export interface CoopDefenseEquippedStatLine {
  readonly label: string;
  readonly text: string;
}

export interface CoopDefenseEquippedSpecialEffectLine {
  readonly label: string;
  readonly text: string;
}

export interface CoopDefenseItemDragSource {
  readonly item: CoopDefenseItem;
  /** `true`, wenn das Teil aus einem Ausruestungsplatz gezogen wird. */
  readonly equipped: boolean;
}

export interface CoopDefenseItemDropTarget {
  readonly slot: CoopDefenseItemSlot;
  readonly kind: 'equipment' | 'stash';
}

export type CoopDefenseItemDropAction = 'equip' | 'unequip';

/**
 * Vier Spalten in fester Reihenfolge, je ein 2x5-Raster. Ausgeruestete Teile erscheinen bewusst
 * nicht im Raster: sie liegen in der Ausruestungsansicht und zaehlen nicht aufs Inventarlimit.
 */
export function buildCoopDefenseInventoryGrid(
  items: readonly CoopDefenseItem[],
  equippedItemIds: CoopDefenseEquippedItemIds,
  sortMode: CoopDefenseItemSortMode,
): CoopDefenseInventoryColumn[] {
  return COOP_DEFENSE_ITEM_SLOTS.map((slot) => {
    const stash = sortCoopDefenseItems(
      getCoopDefenseStashItems(items, equippedItemIds, slot),
      sortMode,
    );
    const cells: (CoopDefenseItem | null)[] = [];
    for (let index = 0; index < COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT; index++) {
      cells.push(stash[index] ?? null);
    }
    return {
      slot,
      label: getCoopDefenseItemSlotDefinition(slot).label,
      equipped: getEquippedCoopDefenseItem(items, equippedItemIds, slot),
      cells,
      used: stash.length,
      capacity: COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT,
    };
  });
}

/**
 * Voller Tooltip-Inhalt eines Items. Erst hier stehen die genauen Werte – die Zelle selbst zeigt
 * nur Symbol, Seltenheitsrahmen und Stufe.
 */
export function buildCoopDefenseItemTooltip(
  item: CoopDefenseItem,
  equipped: CoopDefenseItem | null,
  isEquipped: boolean,
): CoopDefenseItemTooltipContent {
  const description = describeCoopDefenseItem(item);
  const lines: CoopDefenseItemTooltipLine[] = [
    { text: `${description.rarityLabel} · Stufe ${description.itemLevel}`, color: description.rarityColor, bold: true },
    { text: '', color: COLORS.GREY_5 },
  ];

  for (const line of description.lines) {
    lines.push({
      text: `${formatCoopDefenseItemValue(line.value, line.displayAsPercent)} ${line.label}`,
      color: line.isBaseStat ? COLORS.GREY_1 : description.rarityColor,
    });
  }

  // Affixe ohne Stat haben keine Zahlenzeile; ohne ihre Erklaerung waeren sie unsichtbar.
  for (const affix of description.affixLines) {
    lines.push({ text: affix.label, color: description.rarityColor, bold: true });
    lines.push({ text: affix.text, color: COLORS.GREY_2 });
  }

  // Der Vergleich hilft nur bei einem Teil, das noch nicht getragen wird.
  if (!isEquipped) {
    lines.push({ text: '', color: COLORS.GREY_5 });
    lines.push({
      text: equipped ? 'GEGENÜBER AUSGERÜSTET' : 'SLOT IST LEER',
      color: COLORS.GREY_4,
      bold: true,
    });
    const changes = compareCoopDefenseItems(item, equipped).filter((change) => change.delta !== 0);
    if (changes.length === 0) {
      lines.push({ text: 'identisch zum ausgerüsteten Teil', color: COLORS.GREY_4 });
    } else {
      for (const change of changes) {
        lines.push({
          text: `${formatCoopDefenseItemValue(change.delta, change.displayAsPercent)} ${change.label}`,
          color: isCoopDefenseItemImprovement(change.stat, change.delta) ? COLORS.GREEN_2 : COLORS.RED_2,
        });
      }
    }
  }

  lines.push({ text: '', color: COLORS.GREY_5 });
  lines.push({ text: `Zerlegen bringt +${getCoopDefenseItemSalvageXp(item)} XP`, color: COLORS.GREY_4 });
  lines.push({
    text: isEquipped ? 'Klick: Menü · Ziehen: Ablegen' : 'Klick: Menü · Ziehen: Ausrüsten',
    color: COLORS.GREY_5,
  });

  return {
    title: `${description.slotLabel} · Stufe ${description.itemLevel}`,
    titleColor: description.rarityColor,
    lines,
  };
}

/** Kurzform fuer die Belohnungsvorschau: eine Zeile je Item. */
export function describeCoopDefenseItemShort(item: CoopDefenseItem): string {
  const description = describeCoopDefenseItem(item);
  return `${description.slotLabel} · ${description.rarityLabel} · Stufe ${description.itemLevel}`;
}

/**
 * Summe aller Werte der getragenen Teile. Ersetzt die Zahlen, die durch die reine
 * Symboldarstellung von den Ausruestungsplaetzen verschwinden.
 */
export function summariseEquippedCoopDefenseItems(
  equippedItems: readonly CoopDefenseItem[],
): CoopDefenseEquippedStatLine[] {
  const totals = new Map<string, { label: string; value: number; displayAsPercent: boolean }>();
  for (const item of equippedItems) {
    for (const line of describeCoopDefenseItem(item).lines) {
      const existing = totals.get(line.stat);
      totals.set(line.stat, {
        // Derselbe Stat traegt je nach Herkunft unterschiedliche Beschriftungen
        // (Basiswert "Maximale HP" vs. Affix "Leben"); die zuerst gesehene gewinnt.
        label: existing?.label ?? line.label,
        value: (existing?.value ?? 0) + line.value,
        displayAsPercent: line.displayAsPercent,
      });
    }
  }
  return [...totals.values()].map((entry) => ({
    label: entry.label,
    text: formatCoopDefenseItemValue(entry.value, entry.displayAsPercent),
  }));
}

/** Laufzeit-Affixe der getragenen Teile fuer den separaten Sondereffekt-Bereich. */
export function listEquippedCoopDefenseSpecialEffects(
  equippedItems: readonly CoopDefenseItem[],
): CoopDefenseEquippedSpecialEffectLine[] {
  return equippedItems.flatMap((item) => describeCoopDefenseItem(item).affixLines.map((affix) => ({
    label: affix.label,
    text: `${formatCoopDefenseItemValue(affix.value, affix.displayAsPercent)} ${affix.label}`,
  })));
}

/** Nur die eigene Kategorie nimmt ein Teil an; alles andere ist ein ungueltiger Ablageort. */
export function resolveCoopDefenseItemDrop(
  source: CoopDefenseItemDragSource,
  target: CoopDefenseItemDropTarget,
): CoopDefenseItemDropAction | null {
  if (source.item.slot !== target.slot) return null;
  if (source.equipped) return target.kind === 'stash' ? 'unequip' : null;
  return target.kind === 'equipment' ? 'equip' : null;
}

/** Rahmenfarbe einer Zelle: Seltenheit fuer belegte, gedaempftes Grau fuer leere Plaetze. */
export function getCoopDefenseItemCellColor(item: CoopDefenseItem | null): number {
  return item ? getCoopDefenseItemRarityDefinition(item.rarity).color : COLORS.GREY_6;
}
