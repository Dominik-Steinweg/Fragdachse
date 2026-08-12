/** Rechteckige Kernfläche einer Felsformation, in Gitterzellen. */
export interface SolidRockFormationRegion {
  minGridX: number;
  maxGridX: number;
  minGridY: number;
  maxGridY: number;
}

export interface SolidRockFormationCell {
  gridX: number;
  gridY: number;
  /** 0 = Kernfläche, 1 = erster Ring außerhalb, usw. */
  ring: number;
}

export interface SolidRockFormationOptions {
  region: SolidRockFormationRegion;
  /** Wie viele Ringe außerhalb der Kernfläche überhaupt betrachtet werden. */
  haloCells: number;
  /**
   * Belegungswahrscheinlichkeit je Ring, beginnend beim ersten Ring außerhalb der Kernfläche.
   * Ringe jenseits der Liste benutzen {@link outerHaloFillChance}.
   */
  haloFillChance: readonly number[];
  outerHaloFillChance: number;
  gridCols: number;
  gridRows: number;
  /** Zellen, die nie belegt werden dürfen (Gleise, reservierte Basisflächen, Freizonen). */
  isBlockedCell?: (gridX: number, gridY: number) => boolean;
}

/**
 * Erzeugt eine geschlossene Kernfläche mit organisch auslaufendem Rand.
 *
 * Ein gemeinsamer Generator für alle Stellen, die genau dieses Bild brauchen: die
 * Tutorial-Felsformation der Coop-Defense-Karte und die nahezu geschlossene Felslandschaft
 * unter dem Lobby-Mittelpanel. Die Lobby bekommt dadurch **keine** zweite Felsalgorithmik.
 *
 * Die Kernfläche ist immer vollständig belegt; für sie wird bewusst kein Zufallswert gezogen.
 * Blockierte Zellen werden übersprungen, ohne den Zufallsstrom zu berühren – die Reihenfolge
 * der `rng()`-Aufrufe ist damit allein durch Region, Halo und Blockade bestimmt und für
 * denselben Seed stabil.
 */
export function generateSolidRockFormation(
  rng: () => number,
  options: SolidRockFormationOptions,
): SolidRockFormationCell[] {
  const { region, haloCells, haloFillChance, outerHaloFillChance, gridCols, gridRows, isBlockedCell } = options;
  const cells: SolidRockFormationCell[] = [];

  const minY = Math.max(0, region.minGridY - haloCells);
  const maxY = Math.min(gridRows - 1, region.maxGridY + haloCells);
  const minX = Math.max(0, region.minGridX - haloCells);
  const maxX = Math.min(gridCols - 1, region.maxGridX + haloCells);

  for (let gridY = minY; gridY <= maxY; gridY++) {
    for (let gridX = minX; gridX <= maxX; gridX++) {
      if (isBlockedCell?.(gridX, gridY)) continue;

      const dx = gridX < region.minGridX
        ? region.minGridX - gridX
        : gridX > region.maxGridX ? gridX - region.maxGridX : 0;
      const dy = gridY < region.minGridY
        ? region.minGridY - gridY
        : gridY > region.maxGridY ? gridY - region.maxGridY : 0;
      const ring = Math.max(dx, dy);

      const fillChance = ring === 0
        ? 1
        : (haloFillChance[ring - 1] ?? outerHaloFillChance);
      if (ring === 0 || rng() < fillChance) {
        cells.push({ gridX, gridY, ring });
      }
    }
  }

  return cells;
}
