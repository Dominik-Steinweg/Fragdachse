/**
 * Modul-Level-Singleton der NetworkBridge.
 * Wird einmal in main.ts erzeugt und über den gesamten Spiellebenszyklus genutzt.
 * Alle Szenen importieren diese Instanz statt eine eigene NetworkBridge zu erstellen.
 */
import { NetworkBridge } from './NetworkBridge';

export const bridge = new NetworkBridge();
