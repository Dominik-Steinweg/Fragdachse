import { describe, expect, it, vi } from 'vitest';

// Der Mottle-Stempelpfad braucht von Phaser nur Konstanten, die erst *nach* dem Cache-Treffer der
// Materialtextur gelesen werden. Ein leerer Mock haelt den Test damit frei von Renderer und DOM.
vi.mock('phaser', () => ({ default: {}, BlendModes: {}, Textures: { FilterMode: {} } }));

import type * as Phaser from 'phaser';
import { CELL_SIZE } from '../src/config';
import type { RockCell } from '../src/types';
import { stampBlobSurfaceMottle } from '../src/arena/BlobSurfaceMottle';
import { ROCK_BLOB_SURFACE_PROFILE } from '../src/arena/BlobSurfaceProfile';
import { createRockOverlaySource, syncRockOverlaySource } from '../src/arena/RockOverlayRegions';

interface RecordedStamp {
  x: number;
  y: number;
  radius: number;
  rotation: number;
  alpha: number;
}

/**
 * Sammelt die Stempelbefehle beider Materiallagen, statt sie zu rastern. Der Vergleich der
 * Befehlsliste ist schaerfer als ein Pixelvergleich: Er schlaegt schon an, wenn sich eine Position
 * um einen Bruchteil eines Pixels verschiebt.
 */
function stampsOf(cells: readonly RockCell[], drawOffsetX = 0, drawOffsetY = 0): RecordedStamp[] {
  const recorded: RecordedStamp[] = [];
  const layer = {
    stamp(
      _key: string,
      _frame: string | number | undefined,
      x: number,
      y: number,
      config: { alpha: number; rotation: number; scaleX: number; scaleY: number },
    ) {
      recorded.push({
        x,
        y,
        // Die Falloff-Maske radiert den Stempel auf seinem Innkreis weg; der sichtbare Radius ist
        // damit die halbe skalierte Kantenlaenge.
        radius: Math.abs(config.scaleX) * ROCK_BLOB_SURFACE_PROFILE.mottle.textureSize * 0.5,
        rotation: config.rotation,
        alpha: config.alpha,
      });
      return layer;
    },
  };
  const scene = { textures: { exists: () => true } };

  const configs = [ROCK_BLOB_SURFACE_PROFILE.mottle, ...(ROCK_BLOB_SURFACE_PROFILE.additionalMottleLayers ?? [])];
  for (let layerIndex = 0; layerIndex < configs.length; layerIndex += 1) {
    stampBlobSurfaceMottle(
      scene as unknown as Phaser.Scene,
      layer as unknown as Phaser.GameObjects.RenderTexture,
      ROCK_BLOB_SURFACE_PROFILE,
      configs[layerIndex],
      cells,
      layerIndex,
      drawOffsetX,
      drawOffsetY,
    );
  }
  return recorded;
}

/** Reicht der Stempel in das Quadrat der genannten Zelle hinein? */
function reachesCell(stamp: RecordedStamp, gridX: number, gridY: number): boolean {
  const minX = gridX * CELL_SIZE;
  const minY = gridY * CELL_SIZE;
  const dx = Math.max(minX - stamp.x, 0, stamp.x - (minX + CELL_SIZE));
  const dy = Math.max(minY - stamp.y, 0, stamp.y - (minY + CELL_SIZE));
  return Math.hypot(dx, dy) < stamp.radius;
}

/** 6x3-Block; (2,1) ist damit vollstaendig von Fels umgeben. */
const FIELD: RockCell[] = [];
for (let gridY = 0; gridY < 3; gridY += 1) {
  for (let gridX = 0; gridX < 6; gridX += 1) FIELD.push({ gridX, gridY });
}
const DESTROYED = { gridX: 2, gridY: 1 };
const SURVIVORS = FIELD.filter((cell) => cell.gridX !== DESTROYED.gridX || cell.gridY !== DESTROYED.gridY);

describe('rock mottle placement stability', () => {
  it('is a pure function of the source cells', () => {
    expect(stampsOf(FIELD)).toEqual(stampsOf(FIELD));
  });

  it('leaves every stamp in place across a destruction', () => {
    // Die eigentliche Invariante, ueber beide beteiligten Module: Die Materialquelle schrumpft
    // nicht, also stempelt der Neubau nach der Zerstoerung exakt dieselben Flecken wie zuvor. Was
    // der gefallene Fels freigibt, entscheidet allein die Silhouettenmaske beim Backen.
    const source = createRockOverlaySource();
    syncRockOverlaySource(source, FIELD);
    const before = stampsOf(source.cells);

    syncRockOverlaySource(source, SURVIVORS);
    expect(stampsOf(source.cells)).toEqual(before);
  });

  it('shows why the source must not shrink: a cell stamps onto its neighbours', () => {
    // Die Flecken einer Zelle reichen weit ueber sie hinaus. Faellt sie aus der Quelle, verschwinden
    // Flecken mitten auf unveraenderten Nachbarfelsen – genau das sichtbare Umspringen des Materials.
    const bleeding = stampsOf([DESTROYED]).filter((stamp) =>
      reachesCell(stamp, DESTROYED.gridX + 1, DESTROYED.gridY)
      || reachesCell(stamp, DESTROYED.gridX - 1, DESTROYED.gridY));
    expect(bleeding.length).toBeGreaterThan(0);

    const full = stampsOf(FIELD);
    const survivorsOnly = stampsOf(SURVIVORS);
    for (const stamp of bleeding) {
      expect(full).toContainEqual(stamp);
      expect(survivorsOnly).not.toContainEqual(stamp);
    }
  });

  it('keeps a chunk-local bake congruent with the full bake', () => {
    // Der Chunk-Pfad stempelt dieselben Quellzellen in ein 128er-Ziel und verschiebt sie um die
    // Chunk-Ecke. Waere das nicht deckungsgleich, entstuende an jeder Chunkgrenze eine Naht.
    const full = stampsOf(FIELD);
    expect(stampsOf(FIELD, -128, -128))
      .toEqual(full.map((stamp) => ({ ...stamp, x: stamp.x - 128, y: stamp.y - 128 })));
  });
});
