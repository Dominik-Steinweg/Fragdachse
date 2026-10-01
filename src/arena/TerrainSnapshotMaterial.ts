import { DirtSurfaceField } from './DirtSurfaceField';
import { writeTrackBallast } from './TrackGravelField';
import type { GroundMaterialSamples } from './GroundMaterialSamples';
import type { DirtCell, WaterCell } from '../types';
import type { ChunkWorldFrame } from './chunks/ArenaChunkGrid';
import type { ArenaTrackColumnSpec } from './ArenaVisualFactory';
import { ROCK_OVERLAY_CHUNK_SIZE } from './RockOverlayRegions';

export type TerrainSnapshotMaterialSource = {
  readonly seed: number; readonly frame: ChunkWorldFrame; readonly materials: GroundMaterialSamples;
} & ({ readonly kind: 'soil'; readonly dirt: readonly DirtCell[]; readonly water: readonly WaterCell[] }
  | { readonly kind: 'track'; readonly columns: readonly ArenaTrackColumnSpec[] });

/** Pure worker-side counterpart of the native material bakes. Buffers are bounded
 * to one batch and one borrowed tile, not the World size. */
export class TerrainSnapshotMaterial {
  private readonly soil: DirtSurfaceField | null;
  private readonly tile = new Uint8ClampedArray(ROCK_OVERLAY_CHUNK_SIZE ** 2 * 4);
  constructor(private readonly source: TerrainSnapshotMaterialSource) {
    this.soil = source.kind === 'soil' ? new DirtSurfaceField(source.seed, source.dirt, source.frame, source.water) : null;
  }
  /** Full-resolution visible chunk: same field, no sparse snapshot sampling. */
  writeNative(data:Uint8ClampedArray,side:number,x:number,y:number):void {
    if(!this.soil)throw new Error('Native material requires soil');
    this.soil.writeSurface(data,side,x,y,side,this.source.materials);
  }
  write(data: Uint8ClampedArray, side: number, worldX: number, worldY: number, width: number, height: number): void {
    data.fill(0);
    const source = this.source, tile = this.tile, size = ROCK_OVERLAY_CHUNK_SIZE;
    for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
      if (this.soil) this.soil.writeSurface(tile, size, worldX + x, worldY + y, size, source.materials, true);
      else if (source.kind === 'track' && source.materials.gravel) {
        writeTrackBallast(tile, size, source.seed, source.columns, source.frame,
          { worldX: worldX + x, worldY: worldY + y, size },
          { gravel: source.materials.gravel, soil: source.materials.dirt }, true);
      } else tile.fill(0);
      for (let row = 0; row < Math.min(size, side - y); row++) {
        data.set(tile.subarray(row * size * 4, (row * size + Math.min(size, side - x)) * 4), ((y + row) * side + x) * 4);
      }
    }
  }
}
