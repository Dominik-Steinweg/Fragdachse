/**
 * Kompakter Terrain-Farb-Lookup auf Rasterzellen-Ebene.
 *
 * Der einzige Verbraucher der Bodenfarbe ist die Einfaerbung des Laubblaeser-Staubs
 * ({@link ../effects/LeafBlowerRenderer}). Dafuer wird eine *repraesentative* Farbe gebraucht,
 * keine pixelgenaue Rekonstruktion des fertigen Renderbildes – der bisherige Weg ueber eine
 * arenagrosse Canvas plus vollstaendiges `ImageData` hat den Speicher dagegen mit der Weltflaeche
 * skaliert (400 x 80 Zellen entsprechen 12 800 x 2 560 px, also rund 125 MiB allein fuer die
 * Pixeldaten).
 *
 * Dieser Speicher ist stattdessen O(Rasterzellen): drei Bytes je Zelle, bei 400 x 80 also 96 KiB.
 *
 * Der Aufbau bleibt dieselbe geordnete Ueberlagerung wie die sichtbaren Bodenbaender (siehe
 * `docs/ai/rendering.md`): Gras, Dirt, Ground Cover, Gleise, Basiszonen, Decals. Jeder Beitrag
 * ist ein "over" mit einer Deckkraft, die zusaetzlich den Flaechenanteil in der jeweiligen Zelle
 * traegt; ein 16-px-Decal in einer 32-px-Zelle faerbt sie also nur zu einem Viertel um. Die Klasse
 * ist bewusst frei von Phaser und DOM und damit direkt testbar – die Farbwerte selbst zieht
 * {@link ./ArenaTerrainColorSampler} aus den Texturen.
 */

export const TERRAIN_COLOR_FALLBACK = 0xc9d8b0;

export class ArenaTerrainColorGrid {
  private readonly accum: Float32Array;
  private packed: Uint8Array | null = null;

  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly cellSize: number,
    baseColor: number,
  ) {
    this.accum = new Float32Array(Math.max(0, cols * rows) * 3);
    const red = (baseColor >> 16) & 0xff;
    const green = (baseColor >> 8) & 0xff;
    const blue = baseColor & 0xff;
    for (let index = 0; index < this.accum.length; index += 3) {
      this.accum[index] = red;
      this.accum[index + 1] = green;
      this.accum[index + 2] = blue;
    }
  }

  /** Bytes des fertigen Lookups – Grundlage der Speicherzusicherung dieser Datei. */
  get byteLength(): number {
    return (this.packed ?? this.accum).byteLength;
  }

  /**
   * Legt eine Farbe ueber ein rahmenlokales Rechteck.
   *
   * Der Flaechenanteil je Zelle geht in die Deckkraft ein, damit kleine Marken eine Zelle nicht
   * vollstaendig umfaerben. Rotationen werden bewusst nicht mitgefuehrt: Fuer eine
   * repraesentative Zellfarbe ist die achsenparallele Huelle genau genug, und die Alternative
   * waere eine Rasterisierung, die den O(Zellen)-Charakter wieder aufgaebe.
   */
  paintRect(minX: number, minY: number, maxX: number, maxY: number, color: number, alpha: number): void {
    if (alpha <= 0 || maxX <= minX || maxY <= minY) return;
    const firstCol = Math.max(0, Math.floor(minX / this.cellSize));
    const lastCol = Math.min(this.cols - 1, Math.ceil(maxX / this.cellSize) - 1);
    const firstRow = Math.max(0, Math.floor(minY / this.cellSize));
    const lastRow = Math.min(this.rows - 1, Math.ceil(maxY / this.cellSize) - 1);
    if (firstCol > lastCol || firstRow > lastRow) return;

    const cellArea = this.cellSize * this.cellSize;
    const red = (color >> 16) & 0xff;
    const green = (color >> 8) & 0xff;
    const blue = color & 0xff;

    for (let row = firstRow; row <= lastRow; row += 1) {
      const cellTop = row * this.cellSize;
      const overlapY = Math.min(maxY, cellTop + this.cellSize) - Math.max(minY, cellTop);
      if (overlapY <= 0) continue;
      for (let col = firstCol; col <= lastCol; col += 1) {
        const cellLeft = col * this.cellSize;
        const overlapX = Math.min(maxX, cellLeft + this.cellSize) - Math.max(minX, cellLeft);
        if (overlapX <= 0) continue;
        const weight = Math.min(1, alpha * ((overlapX * overlapY) / cellArea));
        if (weight <= 0) continue;
        const index = (row * this.cols + col) * 3;
        this.accum[index] += (red - this.accum[index]) * weight;
        this.accum[index + 1] += (green - this.accum[index + 1]) * weight;
        this.accum[index + 2] += (blue - this.accum[index + 2]) * weight;
      }
    }
  }

  /** Deckt genau eine Rasterzelle – der Normalfall fuer Dirt- und Gleiszellen. */
  paintCell(gridX: number, gridY: number, color: number, alpha = 1): void {
    if (gridX < 0 || gridY < 0 || gridX >= this.cols || gridY >= this.rows) return;
    this.paintRect(
      gridX * this.cellSize,
      gridY * this.cellSize,
      (gridX + 1) * this.cellSize,
      (gridY + 1) * this.cellSize,
      color,
      alpha,
    );
  }

  /** Friert den Zustand in drei Bytes je Zelle ein; danach sind keine Beitraege mehr moeglich. */
  freeze(): void {
    if (this.packed) return;
    const packed = new Uint8Array(this.cols * this.rows * 3);
    for (let index = 0; index < packed.length; index += 1) {
      packed[index] = Math.max(0, Math.min(255, Math.round(this.accum[index])));
    }
    this.packed = packed;
  }

  /** Farbe an einer rahmenlokalen Pixelposition; ausserhalb des Rasters der Ersatzwert. */
  sampleLocal(localX: number, localY: number): number {
    const gridX = Math.floor(localX / this.cellSize);
    const gridY = Math.floor(localY / this.cellSize);
    if (gridX < 0 || gridY < 0 || gridX >= this.cols || gridY >= this.rows) return TERRAIN_COLOR_FALLBACK;
    const index = (gridY * this.cols + gridX) * 3;
    const source = this.packed;
    if (source) return (source[index] << 16) | (source[index + 1] << 8) | source[index + 2];
    return (Math.round(this.accum[index]) << 16)
      | (Math.round(this.accum[index + 1]) << 8)
      | Math.round(this.accum[index + 2]);
  }
}

/** Multipliziert zwei Farben kanalweise – das CPU-Gegenstueck zum MULTIPLY-Blend. */
export function multiplyTerrainColor(base: number, factor: number): number {
  const red = Math.round((((base >> 16) & 0xff) * ((factor >> 16) & 0xff)) / 255);
  const green = Math.round((((base >> 8) & 0xff) * ((factor >> 8) & 0xff)) / 255);
  const blue = Math.round(((base & 0xff) * (factor & 0xff)) / 255);
  return (red << 16) | (green << 8) | blue;
}
