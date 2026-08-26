/**
 * Der eine, kampagnenweite Grundriss der persistenten Basis.
 *
 * Die persistente Basis ist bewusst **kein** Map-Inhalt mehr: Weder Größe, Form, HP noch
 * Ausstattung werden je Map definiert. Eine Map legt ausschließlich fest, *wo* der persistente
 * Bereich auf ihr liegt; alles Übrige kommt aus diesem Modul – für Missionen und für den
 * Basis-Editor gleichermaßen. Dadurch sind Kies-Zone, Bauzone und Basiskern per Konstruktion
 * deckungsgleich, und das Basisbau-Menü der Lobby ist von der Kartenauswahl unabhängig.
 */
import type { CoopBaseConfig } from '../config/coopDefenseMaps';
import type { PersistentBaseAnchor } from './PersistentBaseTypes';

/** Stabile Identität des Basiskerns; identisch auf jeder Karte und im Editor. */
export const PERSISTENT_BASE_CORE_ID = 'persistent-base';

/** Kantenlänge des Kerns in Zellen. Ungerade, damit er exakt auf dem Zonenmittelpunkt sitzt. */
export const PERSISTENT_BASE_CORE_SIZE_CELLS = 3;

/**
 * Zentraler HP-Wert des Kerns. Die Basis ist kampagnenweit dieselbe Struktur, deshalb skaliert
 * sie nicht je Karte. Türme und Power-Up-Podeste hat sie bewusst keine – sie ist der Bauplatz
 * des Spielers, nicht ein vorgefertigtes Missionsziel.
 */
export const PERSISTENT_BASE_CORE_HP_MAX = 3000;

/** Der Kern belegt ein ungerades Quadrat, dessen Mitte der Zonenanker ist. */
export function getPersistentBaseCoreOrigin(anchor: PersistentBaseAnchor): {
  readonly gridX: number;
  readonly gridY: number;
} {
  const half = Math.floor(PERSISTENT_BASE_CORE_SIZE_CELLS / 2);
  return { gridX: anchor.gridX - half, gridY: anchor.gridY - half };
}

/**
 * Baut die Basiskonfiguration des Kerns. Sie durchläuft anschließend denselben
 * `resolveBaseSpec`-Pfad wie jede authored Basis; es gibt keinen zweiten Geometriecode.
 */
export function createPersistentBaseCoreConfig(anchor: PersistentBaseAnchor): CoopBaseConfig {
  const origin = getPersistentBaseCoreOrigin(anchor);
  return {
    id: PERSISTENT_BASE_CORE_ID,
    hpMax: PERSISTENT_BASE_CORE_HP_MAX,
    faction: 'friendly',
    role: 'main',
    anchor: { kind: 'grid', gridX: origin.gridX, gridY: origin.gridY },
    shape: {
      kind: 'rectangle',
      widthCells: PERSISTENT_BASE_CORE_SIZE_CELLS,
      heightCells: PERSISTENT_BASE_CORE_SIZE_CELLS,
    },
  };
}

/**
 * Die eine, aufgelöste Sicht auf den persistenten Bereich der gerade aufgebauten Welt.
 *
 * Jeder Konsument – Kies, Bauzone, Zonenvorschau, Platzierungsprüfung – liest dieselbe Instanz.
 * Ein zweites Auflösen aus Map-Konfiguration und Spielerzahl ist ausdrücklich nicht vorgesehen;
 * genau dadurch lagen Kiesfläche und Basiskern früher an unterschiedlichen Stellen.
 */
export interface PersistentBaseSiteView {
  readonly anchor: PersistentBaseAnchor;
  readonly radiusCells: number;
}
