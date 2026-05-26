/**
 * Zentrale Konfiguration aller Coop-Defense-Basen.
 *
 * Hier (und nur hier) wird festgelegt:
 *   - wie viele Basen es pro Runde gibt,
 *   - wo sie startenden Anker haben,
 *   - welche Form sie haben (Rechteck oder beliebige Zellliste),
 *   - wie viele HP jede Basis hat.
 *
 * Die Werte werden vom `BaseRegistry` gelesen, das daraus `BaseSpec`-Instanzen
 * mit aufgelösten Absolutkoordinaten und abgeleiteter Bounding-Box erzeugt.
 */

export interface CoopBaseCellOffset {
  readonly gridX: number;
  readonly gridY: number;
}

/**
 * Anker bestimmt, wohin (0,0) der relativen Zellen verschoben wird.
 *
 *  - `right-center`:  rechter Arena-Rand, vertikal mittig.
 *                     edgeInsetCells = 0 → rechte Bounding-Box-Kante = GRID_COLS-1.
 *  - `left-center`:   linker Arena-Rand, vertikal mittig.
 *  - `center-offset`: Bounding-Box vom Arena-Zentrum aus verschieben
 *                     (dxCells/dyCells in Grid-Zellen).
 */
export type CoopBaseAnchor =
  | { kind: 'right-center'; edgeInsetCells: number }
  | { kind: 'left-center'; edgeInsetCells: number }
  | { kind: 'center-offset'; dxCells: number; dyCells: number };

export type CoopBaseShape =
  | { kind: 'rectangle'; widthCells: number; heightCells: number }
  | { kind: 'cells'; cells: readonly CoopBaseCellOffset[] };

export interface CoopBaseConfig {
  readonly id: string;
  readonly hpMax: number;
  readonly anchor: CoopBaseAnchor;
  readonly shape: CoopBaseShape;
}

/**
 * Aktive Basis-Konfiguration für den Coop-Defense-Modus.
 *
 * Einträge hinzufügen / entfernen ⇒ mehr / weniger Basen.
 * Reihenfolge ist irrelevant (IDs müssen eindeutig sein).
 */
export const COOP_DEFENSE_BASES: readonly CoopBaseConfig[] = [
  {
    id: 'coop-base-1',
    hpMax: 1000,
    anchor: { kind: 'right-center', edgeInsetCells: 0 },
    shape: { kind: 'rectangle', widthCells: 2, heightCells: 4 },
  },
  {
    id: 'coop-base-2',
    hpMax: 800,
    // Ungefähr Arena-Mitte, leicht links von den (mittig gespawnten) Gleisen.
    anchor: { kind: 'center-offset', dxCells: -4, dyCells: -2 },
    // C-Form, 2 Spalten × 4 Zeilen, Öffnung nach rechts:
    //   ##
    //   #
    //   #
    //   ##
    shape: {
      kind: 'cells',
      cells: [
        { gridX: 0, gridY: 0 }, { gridX: 1, gridY: 0 },
        { gridX: 0, gridY: 1 },
        { gridX: 0, gridY: 2 },
        { gridX: 0, gridY: 3 }, { gridX: 1, gridY: 3 },
      ],
    },
  },
];
