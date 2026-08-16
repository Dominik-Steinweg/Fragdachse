import type { RectOccluderVisitor } from './LightOccluderIndex';

/**
 * Bewegliche Rechteck-Occluder, die nicht in den statischen Arena-Index gehoeren.
 *
 * Die Quelle bleibt Eigentuemerin ihres Zustands. `LightingSystem` fragt sie nur fuer
 * Lichter ab, die im aktuellen Qualitaetsprofil tatsaechlich einen Occlusion-Slot
 * erhalten. `queryCircle` muss exakt filtern und liefert die Zahl der dafuer geprueften
 * Rechtecke fuer die Performance-Diagnose.
 */
export interface DynamicLightOccluderSource {
  hasOccluders(): boolean;
  queryCircle(
    x: number,
    y: number,
    radius: number,
    visitRect: RectOccluderVisitor,
  ): number;
}
