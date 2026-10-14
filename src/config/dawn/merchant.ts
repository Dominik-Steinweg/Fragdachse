import authored from './merchant.json';
import { DAWN_UPGRADE_BRANCHES } from './upgradeBranches';
import type { CoopDefenseItemRarity } from '../../types';

/**
 * Infrastruktur, die der Haendler verkauft. Die Stufe steht persoenlich in
 * `DawnProgress.infrastructure[id]` (0 = nicht gekauft); die Runde nutzt die Stufen des Hosts.
 */
export const DAWN_INFRASTRUCTURE_IDS = ['repair-drones', 'scrap-magnet', 'scrap-scanner'] as const;
export type DawnInfrastructureId = typeof DAWN_INFRASTRUCTURE_IDS[number];

export const DAWN_MERCHANT_CATEGORIES = ['expansion', 'infrastructure', 'upgrades', 'equipment'] as const;
export type DawnMerchantCategory = typeof DAWN_MERCHANT_CATEGORIES[number];

const ITEM_RARITIES: readonly CoopDefenseItemRarity[] = ['white', 'blue', 'yellow'];
export const DAWN_MAX_ITEM_OFFERS = 6;

/**
 * Haendlerkatalog: was es gibt und was es kostet. Die Expansion bleibt in `economy.json`.
 * Persoenliche Progressionsdaten wie dort, bewusst ausserhalb des Szenario-Content-Hashes.
 */
export interface DawnMerchantCatalog {
  readonly upgrades: {
    /** Jeder Upgrade-Zweig aus `upgradeBranches.json` genau einmal. */
    readonly branches: readonly { readonly branchId: string; readonly price: number }[];
    /** Preis des n-ten gekauften Boss-Punkts (Index = bereits gekaufte Punkte); die Laenge ist die Kaufgrenze. */
    readonly bossPointPrices: readonly number[];
  };
  /** Jede Infrastruktur genau einmal; `levelPrices[n]` kostet der Schritt von Stufe n auf n + 1. */
  readonly infrastructure: readonly { readonly id: DawnInfrastructureId; readonly levelPrices: readonly number[] }[];
  readonly equipment: {
    /** Item-Angebote pro Runde (persistiert in `DawnProgress.shopOffer`). */
    readonly itemOfferCount: number;
    /** Grundpreis bei Threat 1 je Seltenheit. */
    readonly itemPriceByRarity: Readonly<Record<CoopDefenseItemRarity, number>>;
    /** Preisaufschlag je Threat-Stufe ueber 1, multiplikativ: Grundpreis × (1 + g)^(Threat − 1). */
    readonly itemPriceGrowthPerThreat: number;
    readonly recalibrationCorePrice: number;
  };
}

function isPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isPriceList(value: unknown, minLength: number, maxLength: number): value is number[] {
  return Array.isArray(value) && value.length >= minLength && value.length <= maxLength && value.every(isPrice);
}

function fail(reason: string): never {
  throw new Error(`[DawnMerchant] ${reason}`);
}

export function validateDawnMerchantCatalog(raw: unknown): DawnMerchantCatalog {
  const value = raw as Partial<DawnMerchantCatalog> | null;
  if (!value || typeof value !== 'object') fail('Catalog must be an object');
  const { upgrades, infrastructure, equipment } = value;

  if (!upgrades || !Array.isArray(upgrades.branches)) fail('upgrades.branches is required');
  const branchIds = upgrades.branches.map((entry) => entry?.branchId);
  const knownBranchIds = DAWN_UPGRADE_BRANCHES.map((branch) => branch.id);
  if (branchIds.length !== knownBranchIds.length || !knownBranchIds.every((id) => branchIds.includes(id))
    || !upgrades.branches.every((entry) => isPrice(entry.price))) {
    fail('upgrades.branches must price every upgrade branch exactly once');
  }
  if (!isPriceList(upgrades.bossPointPrices, 0, 1000)) fail('upgrades.bossPointPrices must be positive integers');

  if (!Array.isArray(infrastructure)
    || infrastructure.length !== DAWN_INFRASTRUCTURE_IDS.length
    || !DAWN_INFRASTRUCTURE_IDS.every((id) => infrastructure.filter((entry) => entry?.id === id).length === 1)
    || !infrastructure.every((entry) => isPriceList(entry.levelPrices, 1, 10))) {
    fail('infrastructure must price every infrastructure id exactly once with 1..10 levels');
  }

  if (!equipment || !Number.isSafeInteger(equipment.itemOfferCount)
    || equipment.itemOfferCount < 1 || equipment.itemOfferCount > DAWN_MAX_ITEM_OFFERS) {
    fail(`equipment.itemOfferCount must be 1..${DAWN_MAX_ITEM_OFFERS}`);
  }
  const prices = equipment.itemPriceByRarity;
  if (!prices || !ITEM_RARITIES.every((rarity) => isPrice(prices[rarity]))
    || Object.keys(prices).length !== ITEM_RARITIES.length) {
    fail('equipment.itemPriceByRarity must price every rarity');
  }
  const growth = equipment.itemPriceGrowthPerThreat;
  if (typeof growth !== 'number' || !Number.isFinite(growth) || growth < 0 || growth > 2) {
    fail('equipment.itemPriceGrowthPerThreat must be 0..2');
  }
  if (!isPrice(equipment.recalibrationCorePrice)) fail('equipment.recalibrationCorePrice must be a positive integer');

  return Object.freeze({
    upgrades: Object.freeze({
      branches: Object.freeze(upgrades.branches.map((entry) => Object.freeze({ branchId: entry.branchId, price: entry.price }))),
      bossPointPrices: Object.freeze([...upgrades.bossPointPrices]),
    }),
    infrastructure: Object.freeze(DAWN_INFRASTRUCTURE_IDS.map((id) => {
      const entry = infrastructure.find((candidate) => candidate.id === id)!;
      return Object.freeze({ id, levelPrices: Object.freeze([...entry.levelPrices]) });
    })),
    equipment: Object.freeze({
      itemOfferCount: equipment.itemOfferCount,
      itemPriceByRarity: Object.freeze({ white: prices.white, blue: prices.blue, yellow: prices.yellow }),
      itemPriceGrowthPerThreat: growth,
      recalibrationCorePrice: equipment.recalibrationCorePrice,
    }),
  });
}

export const DAWN_MERCHANT = validateDawnMerchantCatalog(authored);

/** Hoechste kaufbare Stufe einer Infrastruktur. */
export function getDawnInfrastructureMaxLevel(id: DawnInfrastructureId, catalog: DawnMerchantCatalog = DAWN_MERCHANT): number {
  return catalog.infrastructure.find((entry) => entry.id === id)?.levelPrices.length ?? 0;
}
