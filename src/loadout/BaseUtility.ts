import type { UtilityConfig } from './LoadoutConfig';
import { BaseLoadoutItem } from './BaseLoadoutItem';

/** Basisklasse für Utility-Items (Granaten, Fallen, …). Konkrete Items erweitern diese Klasse. */
export abstract class BaseUtility extends BaseLoadoutItem<UtilityConfig> {
  constructor(config: UtilityConfig) { super(config); }
}
