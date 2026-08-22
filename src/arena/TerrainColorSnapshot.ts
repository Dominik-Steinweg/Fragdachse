/**
 * Ein einmalig erzeugter, opaker Terrain-Farb-Snapshot fuer den LeafBlower.
 * Die Koordinaten liegen in einem festen Weltfenster; die Daten sind RGB, weil jede Terrain-
 * Schicht den Untergrund vollstaendig opak aufbaut.
 */
export class TerrainColorSnapshot {
  readonly scale = 4;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly worldOffsetX: number,
    readonly worldOffsetY: number,
    readonly data: Uint8Array,
  ) {
    if (data.length !== width * height * 3) {
      throw new Error(`[TerrainColorSnapshot] Erwartet ${width * height * 3} RGB-Bytes, erhielt ${data.length}.`);
    }
  }

  sample(worldX: number, worldY: number): number {
    const x = Math.floor((worldX - this.worldOffsetX) / this.scale);
    const y = Math.floor((worldY - this.worldOffsetY) / this.scale);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0xc9d8b0;

    const index = (y * this.width + x) * 3;
    return (this.data[index] << 16) | (this.data[index + 1] << 8) | this.data[index + 2];
  }
}
