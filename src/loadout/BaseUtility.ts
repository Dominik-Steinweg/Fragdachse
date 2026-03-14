import type { UtilityConfig } from './LoadoutConfig';
import { BaseLoadoutItem } from './BaseLoadoutItem';

/** Basisklasse für Utility-Items (Granaten, Fallen, …). Konkrete Items setzen nur config. */
export abstract class BaseUtility extends BaseLoadoutItem<UtilityConfig> {}
