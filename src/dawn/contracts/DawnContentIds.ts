/**
 * Vertrag M3: die IDs der Dawn-Inhalte, auf die sich Komposition, Resolver, Laufzeit und Darstellung
 * beziehen. Authored Daten (`src/config/dawn/**`) verwenden genau diese IDs; ihre Validatoren lehnen
 * fremde IDs ab. Asset-Keys sind die vereinbarten Texture-/Icon-Keys der Leit-Session; fehlt ein
 * Asset zur Laufzeit, zeichnet die Darstellung still nichts.
 */

/** Site-Archetypen (siehe GDD §6 und D-34). */
export const DAWN_SITE_ARCHETYPE_IDS = [
  'wreck', 'extractor', 'brood-nest', 'supply', 'scrap-heaps', 'scavenger',
] as const;
export type DawnSiteArchetypeId = typeof DAWN_SITE_ARCHETYPE_IDS[number];

/** Visuelle Wrack-Varianten (`DawnSitePlan.variant`); `drone` ist die Standardvariante. */
export const DAWN_WRECK_VARIANTS = ['drone', 'tractor', 'minecart'] as const;
export type DawnWreckVariant = typeof DAWN_WRECK_VARIANTS[number];

/** Nacht-Modifikatoren (`DawnActivityPlan.nightModifierId`). */
export const DAWN_NIGHT_MODIFIER_IDS = ['blood-moon', 'fog', 'bombers', 'fire'] as const;
export type DawnNightModifierId = typeof DAWN_NIGHT_MODIFIER_IDS[number];

/** Elite-Affixe; der Host vergibt sie beim Spawn, der Gegner-Snapshot traegt die Affix-ID. */
export const DAWN_ELITE_AFFIX_IDS = ['swift', 'armored', 'volatile', 'regenerating', 'shielding'] as const;
export type DawnEliteAffixId = typeof DAWN_ELITE_AFFIX_IDS[number];

/** Infrastruktur, die versteckte Sites (`DawnSitePlan.hidden`) mit Navigationsmarkern zeigt. */
export const DAWN_SCRAP_SCANNER_INFRASTRUCTURE_ID = 'scrap-scanner';

/** Vereinbarte Asset-Keys der M3-Inhalte (Produktion in der Leit-Session, Branch `dawn-assets`). */
export const DAWN_M3_ASSET_KEYS = {
  wreckVariant: (variant: DawnWreckVariant, tier: number) => variant === 'drone'
    ? `construction_dawn_wreck_t${tier}` : `construction_dawn_wreck_${variant}_t${tier}`,
  broodNest: 'construction_dawn_broodnest',
  supplyCapsule: 'construction_dawn_supply_capsule',
  supplyCrate: 'dawn_supply_crate',
  supplyCrateCarried: 'dawn_supply_crate_carried',
  scavengerCamp: (tier: number) => `dawn_scavenger_camp_t${tier}`,
  scrapHeap: (tier: number) => `dawn_scrap_heap_t${tier}`,
  scavenger: 'enemy_dawn_scavenger',
  /** UI-Icons unter `public/assets/ui/dawn/runtime/<name>-{32,64,128}.webp`. */
  eliteAffixIcon: (affix: DawnEliteAffixId) => `elite-${affix}`,
  nightModifierIcon: (modifier: DawnNightModifierId) => `night-${modifier}`,
  scrapScannerIcon: 'scrap-scanner',
} as const;
