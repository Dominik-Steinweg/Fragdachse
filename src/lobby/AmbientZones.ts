import { LOBBY_CENTER_PANEL_COLUMNS, LOBBY_LAYOUT_GRID } from '../arena/MenuArenaPreviewConfig';

/** Rechteckige Zone im Lobby-Gitter, in Zellen. */
export interface AmbientZone {
  id: string;
  minGridX: number;
  maxGridX: number;
  minGridY: number;
  maxGridY: number;
}

const {
  cols,
  rows,
  leftFrameColumn,
  rightFrameColumn,
  frameTopRow,
  frameBottomRow,
} = LOBBY_LAYOUT_GRID;

/**
 * Spielflächen der Ambient-Inszenierung.
 *
 * Abgeleitet aus dem Rahmen der Lobby-Oberfläche statt fest verdrahtet. Zwei Flächen sind
 * ausdrücklich **keine** Zonen:
 *
 * - die beiden Seitenmenüs zwischen den Rahmenzeilen – dort läge das Gefecht hinter dem Text;
 * - die Felslandschaft unter dem Mittelpanel – sie ist die ruhige Fläche hinter dem Text.
 *   Zerstörung darf dort trotzdem Wege öffnen, die innerhalb derselben Sequenz benutzt
 *   werden; sie ist nur kein Startgebiet.
 *
 * Über und unter dem Rahmen ist die volle Breite frei: Dort liegt keine Oberfläche.
 */
export const AMBIENT_ZONES: readonly AmbientZone[] = [
  // Oberhalb des Rahmens, seitlich am Mittelpanel vorbei: dessen Freizone reicht eine Zeile
  // höher als die Rahmenzeile.
  { id: 'top_left',  minGridX: 0, maxGridX: LOBBY_CENTER_PANEL_COLUMNS.min - 1, minGridY: 0, maxGridY: frameTopRow - 1 },
  { id: 'top_right', minGridX: LOBBY_CENTER_PANEL_COLUMNS.max + 1, maxGridX: cols - 1, minGridY: 0, maxGridY: frameTopRow - 1 },
  // Die schmalen Gassen zwischen Rahmensäule und Mittelpanel.
  {
    id: 'left_gap',
    minGridX: leftFrameColumn + 1,
    maxGridX: Math.min(leftFrameColumn + 6, LOBBY_CENTER_PANEL_COLUMNS.min - 1),
    minGridY: frameTopRow,
    maxGridY: frameBottomRow,
  },
  {
    id: 'right_gap',
    minGridX: Math.max(rightFrameColumn - 6, LOBBY_CENTER_PANEL_COLUMNS.max + 1),
    maxGridX: rightFrameColumn - 1,
    minGridY: frameTopRow,
    maxGridY: frameBottomRow,
  },
  // Unterhalb des Rahmens über die volle Breite.
  { id: 'bottom_band', minGridX: 0, maxGridX: cols - 1, minGridY: frameBottomRow + 1, maxGridY: rows - 1 },
];

export function getAmbientZone(id: string): AmbientZone | undefined {
  return AMBIENT_ZONES.find((zone) => zone.id === id);
}
