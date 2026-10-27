import type { PersistentBaseAnchor } from './PersistentBaseTypes';

/**
 * Bezugsrahmen der persistenten Basis einer konkreten World.
 *
 * Blueprints und Reward-Platzierungen werden ausschliesslich kanonisch gespeichert: relativ zum
 * Anker und ungedreht. Der Raum-Host kann die ganze Basis in Vierteldrehungen ausrichten; diese
 * Drehung gehoert zu seinem Basisdokument, nicht zur Map. Dieses Modul ist die einzige Stelle, die
 * zwischen kanonischen und Welt-Koordinaten umrechnet: Zellen, Grundflaechen und Turmwinkel.
 *
 * Der Kern und jeder Baubereich sind unter Vierteldrehungen deckungsgleich. Gueltigkeitspruefungen
 * bleiben deshalb kanonisch; nur die Lage in der Welt haengt am Rahmen.
 */
export type PersistentBaseQuarterTurns = 0 | 1 | 2 | 3;

export interface PersistentBaseFrame {
  readonly anchor: PersistentBaseAnchor;
  /** Vierteldrehungen im Uhrzeigersinn auf dem Bildschirm (y zeigt nach unten). */
  readonly quarterTurns: PersistentBaseQuarterTurns;
}

export interface PersistentBaseCellOffset {
  readonly dx: number;
  readonly dy: number;
}

export interface PersistentBaseWorldFootprint {
  /** Obere linke Weltzelle der gedrehten Grundflaeche, wie sie die Runtime-Objekte tragen. */
  readonly gridX: number;
  readonly gridY: number;
  /** Gedrehte Grundflaeche relativ zu `gridX/gridY`; jede Komponente ist mindestens 0. */
  readonly footprint: readonly PersistentBaseCellOffset[];
}

const SINGLE_CELL: readonly PersistentBaseCellOffset[] = Object.freeze([{ dx: 0, dy: 0 }]);

export function isPersistentBaseQuarterTurns(value: unknown): value is PersistentBaseQuarterTurns {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** Die naechste Ausrichtung nach einer Vierteldrehung im Uhrzeigersinn. */
export function rotatePersistentBaseQuarterTurnsClockwise(
  quarterTurns: PersistentBaseQuarterTurns,
): PersistentBaseQuarterTurns {
  return ((quarterTurns + 1) % 4) as PersistentBaseQuarterTurns;
}

/** Dreht einen kanonischen Offset um den Anker; eine Vierteldrehung bildet (x, y) auf (-y, x) ab. */
export function rotatePersistentBaseOffset(
  dx: number,
  dy: number,
  quarterTurns: PersistentBaseQuarterTurns,
): PersistentBaseCellOffset {
  // `0 - v` statt `-v`: Zellkoordinaten sollen nie als -0 in Schluessel oder Vergleiche geraten.
  switch (quarterTurns) {
    case 0: return { dx, dy };
    case 1: return { dx: 0 - dy, dy: dx };
    case 2: return { dx: 0 - dx, dy: 0 - dy };
    case 3: return { dx: dy, dy: 0 - dx };
  }
}

function inverseQuarterTurns(quarterTurns: PersistentBaseQuarterTurns): PersistentBaseQuarterTurns {
  return ((4 - quarterTurns) % 4) as PersistentBaseQuarterTurns;
}

export function toWorldCell(
  frame: PersistentBaseFrame,
  relativeGridX: number,
  relativeGridY: number,
): { readonly gridX: number; readonly gridY: number } {
  const offset = rotatePersistentBaseOffset(relativeGridX, relativeGridY, frame.quarterTurns);
  return { gridX: frame.anchor.gridX + offset.dx, gridY: frame.anchor.gridY + offset.dy };
}

export function toCanonicalCell(
  frame: PersistentBaseFrame,
  gridX: number,
  gridY: number,
): { readonly relativeGridX: number; readonly relativeGridY: number } {
  const offset = rotatePersistentBaseOffset(
    gridX - frame.anchor.gridX,
    gridY - frame.anchor.gridY,
    inverseQuarterTurns(frame.quarterTurns),
  );
  return { relativeGridX: offset.dx, relativeGridY: offset.dy };
}

/** Kleinster Offset der gedrehten Grundflaeche; er verschiebt den Ursprung auf die obere linke Zelle. */
function rotatedFootprintMinimum(
  footprint: readonly PersistentBaseCellOffset[],
  quarterTurns: PersistentBaseQuarterTurns,
): PersistentBaseCellOffset {
  let minX = Infinity;
  let minY = Infinity;
  for (const cell of footprint.length > 0 ? footprint : SINGLE_CELL) {
    const rotated = rotatePersistentBaseOffset(cell.dx, cell.dy, quarterTurns);
    minX = Math.min(minX, rotated.dx);
    minY = Math.min(minY, rotated.dy);
  }
  return { dx: minX, dy: minY };
}

/**
 * Lage einer kanonisch gespeicherten Grundflaeche in der Welt.
 *
 * Runtime-Objekte werden ueber ihre obere linke Zelle adressiert. Nach einer Drehung liegt diese
 * nicht mehr am kanonischen Ursprung; sie wird hier einmal bestimmt.
 */
export function toWorldFootprint(
  frame: PersistentBaseFrame,
  relativeGridX: number,
  relativeGridY: number,
  footprint: readonly PersistentBaseCellOffset[],
): PersistentBaseWorldFootprint {
  const cells = footprint.length > 0 ? footprint : SINGLE_CELL;
  const origin = toWorldCell(frame, relativeGridX, relativeGridY);
  const minimum = rotatedFootprintMinimum(cells, frame.quarterTurns);
  return {
    gridX: origin.gridX + minimum.dx,
    gridY: origin.gridY + minimum.dy,
    footprint: cells.map((cell) => {
      const rotated = rotatePersistentBaseOffset(cell.dx, cell.dy, frame.quarterTurns);
      return { dx: rotated.dx - minimum.dx, dy: rotated.dy - minimum.dy };
    }),
  };
}

/** Umkehrung von {@link toWorldFootprint}: kanonischer Ursprung zu einer oberen linken Weltzelle. */
export function toCanonicalFootprintOrigin(
  frame: PersistentBaseFrame,
  gridX: number,
  gridY: number,
  footprint: readonly PersistentBaseCellOffset[],
): { readonly relativeGridX: number; readonly relativeGridY: number } {
  const minimum = rotatedFootprintMinimum(footprint, frame.quarterTurns);
  return toCanonicalCell(frame, gridX - minimum.dx, gridY - minimum.dy);
}

/** Startwinkel in der Welt; eine Vierteldrehung im Uhrzeigersinn addiert pi/2. */
export function toWorldAngle(frame: PersistentBaseFrame, canonicalAngle: number): number {
  return turnAngle(canonicalAngle, frame.quarterTurns);
}

export function toCanonicalAngle(frame: PersistentBaseFrame, worldAngle: number): number {
  return turnAngle(worldAngle, inverseQuarterTurns(frame.quarterTurns));
}

function turnAngle(angle: number, quarterTurns: PersistentBaseQuarterTurns): number {
  if (!Number.isFinite(angle)) return 0;
  // Ohne Drehung bleibt der Wert bitgleich; gespeicherte Winkel werden mit `===` verglichen.
  if (quarterTurns === 0) return angle;
  const turned = angle + quarterTurns * Math.PI / 2;
  return Math.atan2(Math.sin(turned), Math.cos(turned));
}
