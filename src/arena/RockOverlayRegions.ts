import { CELL_SIZE } from '../config';
import type { RockCell } from '../types';
import { ROCK_BLOB_SURFACE_PROFILE, getBlobSurfaceMottleReachPx } from './BlobSurfaceProfile';
import { ROCK_VEGETATION_MASK_MARGIN_PX } from './RockVegetationConfig';

/**
 * Geometrie der lokalen Fels-Overlay-Neubauten: stabile Materialquelle und Dirty-Chunks.
 *
 * Bewusst ohne Phaser-Abhaengigkeit und damit direkt testbar – wie {@link ./RockMossField} und
 * {@link ./RockVegetationField}. Hier liegen genau die beiden Regeln, an denen die Pixelstabilitaet
 * unveraenderter Felsflaechen haengt:
 *
 * 1. Die Materialquelle (welche Zellen Flecken, Moos und Matten erzeugen) ist der **vollstaendige**
 *    Felsbestand der Runde und schrumpft nie. Nur die aktuelle Silhouette entscheidet, was davon
 *    sichtbar bleibt.
 * 2. Der Dirty-Bereich einer Aenderung ist die Reichweite der betroffenen *Masken*, nicht die
 *    Zelle selbst. Wer zu klein waehlt, hinterlaesst Saeume an den Chunkgrenzen; wer zu gross
 *    waehlt, backt Flaeche neu, die sich nicht aendern kann.
 */

export const ROCK_OVERLAY_CHUNK_SIZE = 128;

export interface RockOverlayChunk {
  localX: number;
  localY: number;
}

/** Nur die Ausdehnung des Bestandsrahmens; der Weltversatz spielt fuer Chunks keine Rolle. */
export interface RockOverlayFrameSize {
  width: number;
  height: number;
}

/**
 * Materialquelle der felsgebundenen Overlays: jede Zelle, auf der in dieser Runde je ein Fels
 * stand, dedupliziert. Eintraege werden nie entfernt – siehe Modulkommentar, Regel 1.
 */
export interface RockOverlaySource {
  cells: RockCell[];
  keys: Set<number>;
}

/**
 * Die Karten bleiben weit unter 65536 Zellen je Achse; ein einzelner Zahlenschluessel ist deshalb
 * eindeutig und spart den String-Aufbau in einer Schleife ueber den gesamten Bestand.
 */
const ROCK_CELL_KEY_STRIDE = 1 << 16;

export function createRockOverlaySource(): RockOverlaySource {
  return { cells: [], keys: new Set<number>() };
}

export function rockCellKey(cell: { gridX: number; gridY: number }): number {
  return cell.gridX * ROCK_CELL_KEY_STRIDE + cell.gridY;
}

/** Zellschluessel aller Felsen, die gerade stehen – Grundlage jeder "steht da noch was?"-Frage. */
export function collectRockCellKeys(cells: readonly RockCell[]): Set<number> {
  const keys = new Set<number>();
  for (const cell of cells) keys.add(rockCellKey(cell));
  return keys;
}

/**
 * Nimmt neu aufgetauchte Felszellen in die Materialquelle auf und meldet genau sie zurueck.
 *
 * Zerstoerte Felsen bleiben bewusst enthalten: Ihre Flecken reichen bis zu
 * {@link getBlobSurfaceMottleReachPx} weit auf die Nachbarfelsen, und wuerde die Quelle mit ihnen
 * schrumpfen, spraengen dort bei jeder Zerstoerung Materialstrukturen um.
 *
 * Neu **hinzukommende** Zellen gibt es trotzdem: Gebaute Felsen belegen zur Laufzeit freie Slots in
 * `layout.rocks`. Ihre Flecken existieren in den bereits gebackenen Layern noch nicht, deshalb muss
 * der Aufrufer die Rueckgabe an die Chunk-Auswahl weiterreichen.
 */
export function syncRockOverlaySource(
  source: RockOverlaySource,
  rocks: readonly (RockCell | undefined)[],
): RockCell[] {
  const added: RockCell[] = [];
  for (const cell of rocks) {
    if (!cell) continue;
    const key = rockCellKey(cell);
    if (source.keys.has(key)) continue;
    source.keys.add(key);
    source.cells.push(cell);
    added.push(cell);
  }
  return added;
}

/**
 * Steht auf jeder je belegten Felszelle noch ein Fels? Solange das gilt, ist die Stanzform der
 * Fels-Decals leer und der ganze Schnitt kann entfallen – der Normalfall beim Rundenaufbau.
 */
export function hasFallenRockCells(
  source: RockOverlaySource,
  activeCellKeys: ReadonlySet<number>,
): boolean {
  for (const cell of source.cells) {
    if (!activeCellKeys.has(rockCellKey(cell))) return true;
  }
  return false;
}

/**
 * Wie weit ueber ihre eigene Zelle hinaus eine Silhouettenaenderung sichtbar werden kann.
 *
 * Eine Zellgroesse davon geht auf das Autotiling: Faellt ein Fels, wechseln alle acht Nachbarn
 * ihren 47-Blob-Frame und damit ihre eigene Silhouette. Der Maskenrand der Vegetation kommt oben
 * drauf, weil deren Reichweitenmaske ueber die Kachel hinausragt und ein Fels im Nachbarchunk
 * damit noch in diesen hineindeckt.
 */
export function getRockOverlaySilhouetteReachPx(): number {
  return CELL_SIZE + ROCK_VEGETATION_MASK_MARGIN_PX;
}

/**
 * Reichweite einer *neuen* Quellzelle. Ihre Materialflecken sitzen frei ueber der Zelle und reichen
 * weiter als jede Maske; entlang dieser Strecke muss neu gebacken werden, sonst fehlten die Flecken
 * genau dort, wo der Chunk-Neubau aufhoert.
 */
export function getRockOverlaySourceReachPx(): number {
  return Math.max(
    getRockOverlaySilhouetteReachPx(),
    getBlobSurfaceMottleReachPx(ROCK_BLOB_SURFACE_PROFILE),
  );
}

/**
 * Alle 128er-Chunks, deren sichtbares Ergebnis sich durch die uebergebene Aenderungswelle
 * tatsaechlich aendern kann.
 *
 * `dirtyCells` sind zerstoerte oder gesetzte Felsen – bei ihnen aendert sich die Stanzform, nicht
 * die Platzierung. `addedSourceCells` sind zusaetzlich neu in die Materialquelle gekommen und
 * bringen eigene Flecken mit, tragen also die groessere Reichweite.
 */
export function collectRockOverlayChunks(
  dirtyCells: readonly RockCell[],
  addedSourceCells: readonly RockCell[],
  frame: RockOverlayFrameSize,
): RockOverlayChunk[] {
  const chunks = new Map<number, RockOverlayChunk>();
  for (const cell of dirtyCells) {
    addChunkRange(chunks, cell, getRockOverlaySilhouetteReachPx(), frame);
  }
  for (const cell of addedSourceCells) {
    addChunkRange(chunks, cell, getRockOverlaySourceReachPx(), frame);
  }
  return [...chunks.values()];
}

function addChunkRange(
  chunks: Map<number, RockOverlayChunk>,
  cell: RockCell,
  reachPx: number,
  frame: RockOverlayFrameSize,
): void {
  const minX = Math.max(0, cell.gridX * CELL_SIZE - reachPx);
  const maxX = Math.min(frame.width - 1, cell.gridX * CELL_SIZE + CELL_SIZE - 1 + reachPx);
  const minY = Math.max(0, cell.gridY * CELL_SIZE - reachPx);
  const maxY = Math.min(frame.height - 1, cell.gridY * CELL_SIZE + CELL_SIZE - 1 + reachPx);
  if (minX > maxX || minY > maxY) return;

  const firstChunkX = Math.floor(minX / ROCK_OVERLAY_CHUNK_SIZE) * ROCK_OVERLAY_CHUNK_SIZE;
  const lastChunkX = Math.floor(maxX / ROCK_OVERLAY_CHUNK_SIZE) * ROCK_OVERLAY_CHUNK_SIZE;
  const firstChunkY = Math.floor(minY / ROCK_OVERLAY_CHUNK_SIZE) * ROCK_OVERLAY_CHUNK_SIZE;
  const lastChunkY = Math.floor(maxY / ROCK_OVERLAY_CHUNK_SIZE) * ROCK_OVERLAY_CHUNK_SIZE;

  for (let localY = firstChunkY; localY <= lastChunkY; localY += ROCK_OVERLAY_CHUNK_SIZE) {
    for (let localX = firstChunkX; localX <= lastChunkX; localX += ROCK_OVERLAY_CHUNK_SIZE) {
      chunks.set(localX * ROCK_CELL_KEY_STRIDE + localY, { localX, localY });
    }
  }
}
