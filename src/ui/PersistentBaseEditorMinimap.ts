import * as Phaser from 'phaser';
import type { BaseSpec } from '../arena/BaseRegistry';
import type { WorldSpawnZone } from '../config/spawnZones';
import type { ArenaLayout } from '../types';

/** Texture pixels per map cell; the image is scaled to its panel. */
const PX_PER_CELL = 3;
const COLORS = {
  ground: '#33402b', dirt: '#4a4433', water: '#24434d', rock: '#6d6a62', tree: '#1f3320', track: '#5e4a35',
  base: '#8a6a43', persistentBase: '#d8b25a', spawnZone: '#7d4bb0', frame: '#efe4bd',
} as const;

let nextMinimapTexture = 0;

export interface PersistentBaseEditorMinimapInput {
  readonly layout: ArenaLayout;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly bases: readonly BaseSpec[];
  readonly persistentBaseId: string | null;
  readonly spawnZones: readonly WorldSpawnZone[];
  /** Inclusive cell window of the detail view. */
  readonly detail: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

export interface PersistentBaseEditorMinimap {
  readonly image: Phaser.GameObjects.Image;
  /** Screen position of a World cell centre on the minimap; routes are drawn in this space. */
  cellToScreen(gridX: number, gridY: number): { x: number; y: number };
  readonly scale: number;
  destroy(): void;
}

/**
 * Overview of the whole map for the base editor (Lagekarte), north up like the round: terrain,
 * bases, the spawn zones in the danger colour and the frame of the detail view. Drawn once per map
 * and seed; it never animates by itself.
 */
export function createPersistentBaseEditorMinimap(scene: Phaser.Scene, input: PersistentBaseEditorMinimapInput,
  panel: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): PersistentBaseEditorMinimap {
  const key = `base-editor-minimap-${++nextMinimapTexture}`;
  const width = input.widthCells * PX_PER_CELL, height = input.heightCells * PX_PER_CELL;
  const texture = scene.textures.createCanvas(key, width, height)!;
  const ctx = texture.context;
  const fill = (color: string, cells: Iterable<{ readonly gridX: number; readonly gridY: number }>, inset = 0) => {
    ctx.fillStyle = color;
    for (const cell of cells) ctx.fillRect(cell.gridX * PX_PER_CELL + inset, cell.gridY * PX_PER_CELL + inset,
      PX_PER_CELL - inset * 2, PX_PER_CELL - inset * 2);
  };
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, 0, width, height);
  fill(COLORS.dirt, input.layout.dirt);
  fill(COLORS.water, input.layout.water ?? []);
  fill(COLORS.track, input.layout.tracks);
  fill(COLORS.tree, input.layout.trees);
  fill(COLORS.rock, input.layout.rocks);
  for (const base of input.bases) {
    if (base.dormant || base.surface === 'none') continue;
    fill(base.id === input.persistentBaseId ? COLORS.persistentBase : COLORS.base, base.cells);
  }
  ctx.globalAlpha = .55;
  ctx.fillStyle = COLORS.spawnZone;
  for (const zone of input.spawnZones) {
    ctx.fillRect(zone.gridX * PX_PER_CELL, zone.gridY * PX_PER_CELL, zone.widthCells * PX_PER_CELL, zone.heightCells * PX_PER_CELL);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = COLORS.frame;
  ctx.lineWidth = 2;
  const { detail } = input;
  ctx.strokeRect(detail.minX * PX_PER_CELL + 1, detail.minY * PX_PER_CELL + 1,
    (detail.maxX - detail.minX + 1) * PX_PER_CELL - 2, (detail.maxY - detail.minY + 1) * PX_PER_CELL - 2);
  texture.refresh();

  const scale = Math.min(panel.width / width, panel.height / height);
  const displayWidth = width * scale, displayHeight = height * scale;
  const left = panel.x + (panel.width - displayWidth) / 2, top = panel.y + (panel.height - displayHeight) / 2;
  const image = scene.add.image(left, top, key).setOrigin(0).setDisplaySize(displayWidth, displayHeight);
  return {
    image,
    scale: scale * PX_PER_CELL,
    cellToScreen: (gridX, gridY) => ({ x: left + (gridX + .5) * PX_PER_CELL * scale, y: top + (gridY + .5) * PX_PER_CELL * scale }),
    destroy: () => {
      image.destroy();
      if (scene.textures.exists(key)) scene.textures.remove(key);
    },
  };
}
