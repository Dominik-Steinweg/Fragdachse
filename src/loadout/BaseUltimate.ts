import type { UltimateConfig } from './LoadoutConfig';
import { BaseLoadoutItem } from './BaseLoadoutItem';

/**
 * Basisklasse für Ultimate-Fähigkeiten.
 * Ultimates sind Rage-basiert – die zeitbasierte canUse()-Logik
 * wird nicht genutzt. LoadoutManager prüft den Rage-Wert direkt.
 */
export abstract class BaseUltimate extends BaseLoadoutItem<UltimateConfig> {}
