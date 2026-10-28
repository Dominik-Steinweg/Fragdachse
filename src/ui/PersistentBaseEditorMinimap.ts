import * as Phaser from 'phaser';
import type { BaseSpec } from '../arena/BaseRegistry';
import { spawnZoneOutline, type WorldSpawnZone } from '../config/spawnZones';
import type { ArenaLayout } from '../types';
import { getBridgeDeckRect } from '../arena/BridgeGeometry';

/** Texture pixels per map cell; the image is scaled to its panel. */
const PX_PER_CELL = 3;
export const PERSISTENT_BASE_EDITOR_MINIMAP_COLORS = {
  ground: '#33402b', dirt: '#4a4433', water: '#24434d', rock: '#6d6a62', tree: '#1f3320', track: '#5e4a35',
  base: '#8a6a43', persistentBase: '#d8b25a', hostileBase: '#a45ee6', spawnZone: '#7d4bb0', frame: '#efe4bd',
  bridgeDeck: '#a8834f', bridgeRail: '#4a3624', portal: '#c58cff', portalThroat: '#1c0f29',
} as const;
/** Radius of a portal ring on the overview, in cells. */
const PORTAL_RING_CELLS = 1.7;

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
  /** Generator portals: their ends (cell coordinates, fractional) and the generators feeding them. */
  readonly portals?: { readonly ends: readonly { readonly x: number; readonly y: number }[]; readonly generatorIds: ReadonlySet<string> };
}

export interface PersistentBaseEditorMinimap {
  readonly image: Phaser.GameObjects.Image;
  /** Screen position of a World cell centre on the minimap; routes are drawn in this space. */
  cellToScreen(gridX: number, gridY: number): { x: number; y: number };
  readonly scale: number;
  /** Redraws the overview without these own bases and bridges (fallen or blown in the what-if). */
  setFallen(baseIds: ReadonlySet<string>, bridgeIds: ReadonlySet<string>): void;
  destroy(): void;
}

/**
 * Overview of the whole map for the base editor (Lagekarte), north up like the round: terrain with
 * its bridges, standing bases (the enemies' in the danger colour), portals, the spawn
 * zones and the frame of the detail view. Drawn once per map and seed and again when the what-if
 * changes which bases stand; it never animates by itself.
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
  const draw = (fallen: ReadonlySet<string>, blownBridges: ReadonlySet<string>) => {
    ctx.fillStyle = PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.ground;
    ctx.fillRect(0, 0, width, height);
    fill(PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.dirt, input.layout.dirt);
    fill(PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.water, input.layout.water ?? []);
    // Standing bridges cross the water as decks with rails along their span.
    for (const bridge of input.layout.bridges ?? []) {
      if (blownBridges.has(bridge.id)) continue;
      const deck = getBridgeDeckRect(bridge);
      const x = deck.gridX * PX_PER_CELL, y = deck.gridY * PX_PER_CELL;
      const w = deck.widthCells * PX_PER_CELL, h = deck.heightCells * PX_PER_CELL;
      ctx.fillStyle = PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.bridgeDeck;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.bridgeRail;
      if (bridge.axis === 'horizontal') { ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); }
      else { ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h); }
    }
    fill(PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.track, input.layout.tracks);
    fill(PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.tree, input.layout.trees);
    fill(PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.rock, input.layout.rocks);
    const generators = input.portals?.generatorIds;
    for (const base of input.bases) {
      if (base.dormant || fallen.has(base.id) || (base.surface === 'none' && !generators?.has(base.id))) continue;
      // The enemies' own bases, outposts, spawn structures and portal generators carry the danger colour.
      fill(base.id === input.persistentBaseId ? PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.persistentBase
        : base.faction === 'hostile' ? PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.hostileBase : PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.base, base.cells);
    }
    // Portal ends: a violet ring around a dark throat.
    for (const end of input.portals?.ends ?? []) {
      ctx.beginPath();
      ctx.arc(end.x * PX_PER_CELL, end.y * PX_PER_CELL, PORTAL_RING_CELLS * PX_PER_CELL, 0, Math.PI * 2);
      ctx.fillStyle = PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.portalThroat;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.portal;
      ctx.stroke();
    }
    ctx.globalAlpha = .55;
    ctx.fillStyle = PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.spawnZone;
    // Spawn zones are round: the organic outline the spawns and the void haze use.
    for (const zone of input.spawnZones) {
      ctx.beginPath();
      for (const point of spawnZoneOutline(zone)) ctx.lineTo(point.x * PX_PER_CELL, point.y * PX_PER_CELL);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = PERSISTENT_BASE_EDITOR_MINIMAP_COLORS.frame;
    ctx.lineWidth = 2;
    const { detail } = input;
    ctx.strokeRect(detail.minX * PX_PER_CELL + 1, detail.minY * PX_PER_CELL + 1,
      (detail.maxX - detail.minX + 1) * PX_PER_CELL - 2, (detail.maxY - detail.minY + 1) * PX_PER_CELL - 2);
    texture.refresh();
  };
  draw(new Set(), new Set());

  const scale = Math.min(panel.width / width, panel.height / height);
  const displayWidth = width * scale, displayHeight = height * scale;
  const left = panel.x + (panel.width - displayWidth) / 2, top = panel.y + (panel.height - displayHeight) / 2;
  const image = scene.add.image(left, top, key).setOrigin(0).setDisplaySize(displayWidth, displayHeight);
  return {
    image,
    scale: scale * PX_PER_CELL,
    cellToScreen: (gridX, gridY) => ({ x: left + (gridX + .5) * PX_PER_CELL * scale, y: top + (gridY + .5) * PX_PER_CELL * scale }),
    setFallen: (baseIds, bridgeIds) => { if (scene.textures.exists(key)) draw(baseIds, bridgeIds); },
    destroy: () => {
      image.destroy();
      if (scene.textures.exists(key)) scene.textures.remove(key);
    },
  };
}
