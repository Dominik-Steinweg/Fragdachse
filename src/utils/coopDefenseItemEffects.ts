import {
  getCoopDefenseItemAffixDefinition,
  getCoopDefenseItemSlotDefinition,
} from '../config/coopDefenseItems';
import type { CoopDefenseClassId, CoopDefenseItem, CoopDefenseUpgradeProfile } from '../types';
import { EMPTY_COOP_DEFENSE_EFFECT_TOTALS } from './coopDefenseStats';
import {
  getCoopDefenseResolvedEffectTotals,
  type CoopDefenseResolvedEffectTotals,
} from './coopDefenseUpgrades';

/**
 * Uebersetzt ausgeruestete Items in dieselbe Effekt-Struktur wie der Upgrade-Baum.
 *
 * Damit stapeln Level- und Item-Boni pro Stat additiv im gemeinsamen Bucket – 10 % aus Upgrades
 * und 5 % aus Items ergeben x1.15, keine multiplikative Verkettung – und jeder vorhandene
 * Stat-Resolver uebernimmt Item-Werte, ohne selbst etwas von Items zu wissen.
 *
 * Die Summe ist bewusst unbegrenzt: konsequente Spezialisierung auf einen Wert soll sich
 * vollstaendig auszahlen. Balanciert wird ueber Affixwerte, Gewichte, erlaubte Slots und
 * Bedingungen, nicht ueber eine Gesamtobergrenze. Einzelne Verbraucher duerfen den fertigen
 * Wert weiterhin klemmen, wo die Physik es verlangt (z. B. Schadensreduktion auf [0,1], damit
 * Schaden nicht negativ wird) – das ist keine Begrenzung der gesammelten Item-Werte.
 */

type MutableTotals = { additive: Record<string, number>; percentage: Record<string, number> };

function addEffect(totals: MutableTotals, stat: string, mode: string, value: number): void {
  if (!Number.isFinite(value) || value === 0) return;
  const bucket = mode === 'add_percent_per_level' ? totals.percentage : totals.additive;
  bucket[stat] = (bucket[stat] ?? 0) + value;
}

export function getCoopDefenseItemEffectTotals(
  items: readonly CoopDefenseItem[],
): CoopDefenseResolvedEffectTotals {
  if (items.length === 0) return EMPTY_COOP_DEFENSE_EFFECT_TOTALS;

  const totals: MutableTotals = { additive: {}, percentage: {} };
  for (const item of items) {
    const slotDefinition = getCoopDefenseItemSlotDefinition(item.slot);
    addEffect(totals, slotDefinition.baseStat, slotDefinition.baseMode, item.baseValue);

    for (const affix of item.affixes) {
      const definition = getCoopDefenseItemAffixDefinition(affix.affixId);
      // Affixe ohne Stat wirken ausschliesslich ueber einen Laufzeit-Handler.
      if (!definition?.stat || !definition.mode) continue;
      addEffect(totals, definition.stat, definition.mode, affix.value);
    }
  }

  return {
    additive: Object.freeze(totals.additive),
    percentage: Object.freeze(totals.percentage),
  };
}

/**
 * Summiert mehrere Effekt-Quellen in einen gemeinsamen Bucket. Enthaelt nur eine Quelle Werte,
 * wird deren Objekt unveraendert durchgereicht, damit referenzbasierte Caches weiter greifen.
 */
export function mergeCoopDefenseEffectTotals(
  ...sources: readonly CoopDefenseResolvedEffectTotals[]
): CoopDefenseResolvedEffectTotals {
  const contributing = sources.filter((source) => (
    Object.keys(source.additive).length > 0 || Object.keys(source.percentage).length > 0
  ));
  if (contributing.length === 0) return EMPTY_COOP_DEFENSE_EFFECT_TOTALS;
  if (contributing.length === 1) return contributing[0];

  const additive: Record<string, number> = {};
  const percentage: Record<string, number> = {};
  for (const source of contributing) {
    for (const [stat, value] of Object.entries(source.additive)) {
      additive[stat] = (additive[stat] ?? 0) + value;
    }
    for (const [stat, value] of Object.entries(source.percentage)) {
      percentage[stat] = (percentage[stat] ?? 0) + value;
    }
  }
  return { additive: Object.freeze(additive), percentage: Object.freeze(percentage) };
}

const EMPTY_ITEMS: readonly CoopDefenseItem[] = Object.freeze([]);

interface CommittedTotalsCacheEntry {
  profile: CoopDefenseUpgradeProfile | null;
  classId: CoopDefenseClassId | null;
  items: readonly CoopDefenseItem[];
  value: CoopDefenseResolvedEffectTotals;
}

/**
 * Einschluessiger Cache auf der Referenz-Kombination. Der Client fragt die Max-Werte des HUD pro
 * Frame mehrfach ab, waehrend Profil und Ausruestung sich nur ausserhalb der Runde aendern.
 */
let committedTotalsCache: CommittedTotalsCacheEntry | null = null;

/**
 * Gesamte Effekt-Summen eines Spielers: Upgrade-Baum plus ausgeruestete Items.
 *
 * Der einzige Einstiegspunkt fuer alle Verbraucher, damit Host und Client nicht unterschiedliche
 * Teilmengen kombinieren. Ohne Items wird das Upgrade-Objekt unveraendert durchgereicht.
 */
export function getCoopDefenseCommittedEffectTotals(
  profile: CoopDefenseUpgradeProfile | null,
  classId: CoopDefenseClassId | null,
  items: readonly CoopDefenseItem[] = EMPTY_ITEMS,
): CoopDefenseResolvedEffectTotals {
  const cached = committedTotalsCache;
  if (cached && cached.profile === profile && cached.classId === classId && cached.items === items) {
    return cached.value;
  }

  const upgrades = profile
    ? getCoopDefenseResolvedEffectTotals(profile, classId ?? undefined)
    : EMPTY_COOP_DEFENSE_EFFECT_TOTALS;
  const value = items.length === 0
    ? upgrades
    : mergeCoopDefenseEffectTotals(upgrades, getCoopDefenseItemEffectTotals(items));

  committedTotalsCache = { profile, classId, items, value };
  return value;
}
