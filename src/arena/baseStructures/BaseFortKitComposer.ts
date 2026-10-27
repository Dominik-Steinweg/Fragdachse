import * as Phaser from 'phaser';
import { AutoTiler } from '../AutoTiler';
import { CELL_SIZE } from '../../config';
import { baseFortTextureKey, type BaseFortKitAsset, type BaseFortPass, type BaseFortSocket } from './BaseFortAssets';
import { maxBlend } from './BaseFortMountedHeights';

/** World cell of a base, grid coordinates plus its world centre. */
export interface FortCell { readonly gridX: number; readonly gridY: number; readonly x: number; readonly y: number }

/** One outpost's art, composed once from the kit: a square canvas round the cells. */
export interface ComposedFort {
  readonly centreX: number;
  readonly centreY: number;
  /** Canvas side in display px (whole metres). */
  readonly size: number;
  readonly sourceSize: number;
  readonly keys: Readonly<Partial<Record<BaseFortPass, string>>>;
  /** Sockets relative to the canvas centre, display px. */
  readonly sockets: readonly (readonly [string, BaseFortSocket])[];
  /**
   * Per cell, in cell order: the kit caster-height frame it was composed from (a CPU-readable image region of
   * `framePx` display px centred on the cell); absent without the caster-height pass.
   */
  readonly cellHeights?: readonly { readonly key: string; readonly frame: string; readonly framePx: number }[];
}

const MARGIN_M = 1;

/** Deterministic kit variant of a cell: neighbouring cells of one mask differ, every peer agrees. */
export function kitVariant(gridX: number, gridY: number, variants: number): number {
  return (((gridX * 73856093) ^ (gridY * 19349663)) >>> 0) % variants;
}

/**
 * Composes an outpost from the kit: every cell draws the frame of its corner-suppressed mask, centred
 * on the cell. Frames reach half a metre into their neighbours, where they are transparent (only open
 * sides carry torches and brackets), so colour passes simply layer; caster heights take the maximum.
 */
export function composeOutpost(scene: Phaser.Scene, kit: BaseFortKitAsset, id: string, cells: readonly FortCell[],
  passes: readonly BaseFortPass[]): ComposedFort | null {
  // Every pass of every variant must be decoded: the composition reads their frame grids.
  if (!kit.variants.every(variant => passes.every(pass => scene.textures.get(baseFortTextureKey(variant, pass))?.source?.[0]?.width))) return null;
  const occupied = new Set(cells.map(cell => `${cell.gridX},${cell.gridY}`));
  const minX = Math.min(...cells.map(c => c.x)), maxX = Math.max(...cells.map(c => c.x));
  const minY = Math.min(...cells.map(c => c.y)), maxY = Math.max(...cells.map(c => c.y));
  const sideM = Math.max(maxX - minX, maxY - minY) / CELL_SIZE + 1 + MARGIN_M * 2;
  const size = sideM * CELL_SIZE, centreX = (minX + maxX) / 2, centreY = (minY + maxY) / 2;
  const left = centreX - size / 2, top = centreY - size / 2;
  const sourcePerDisplay = kit.sourceSize / kit.displaySize, frameM = kit.framePx / CELL_SIZE;
  const masks = kit.variants[0].frames.map(frame => frame.mask);
  const placed = cells.map(cell => {
    const mask = AutoTiler.computeMask(cell.gridX, cell.gridY, (x, y) => occupied.has(`${x},${y}`));
    const index = masks.indexOf(mask);
    if (index < 0) throw new Error(`Outpost kit lacks mask ${mask}`);
    return { cell, index, variant: kit.variants[kitVariant(cell.gridX, cell.gridY, kit.variants.length)] };
  });
  const keys: Partial<Record<BaseFortPass, string>> = {};
  for (const pass of passes) {
    // Data passes keep their own resolution: caster heights are coarser than the colour passes.
    const sample = scene.textures.get(baseFortTextureKey(kit.variants[0], pass));
    const perDisplay = sample.source[0].width / kit.displaySize, frame = kit.framePx * perDisplay;
    const key = `base-fort-outpost:${id}:${pass}`;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const target = scene.textures.addDynamicTexture(key, Math.round(size * perDisplay), Math.round(size * perDisplay))!;
    target.clear();
    const blendMode = pass === 'caster-height' ? maxBlend(scene) : Phaser.BlendModes.NORMAL;
    for (const { cell, index, variant } of placed) {
      const source = scene.textures.get(baseFortTextureKey(variant, pass));
      const name = `kit-frame-${index}`;
      if (!source.has(name)) {
        source.add(name, 0, (index % kit.columns) * frame, Math.floor(index / kit.columns) * frame, frame, frame);
      }
      const x = ((cell.x - left) / CELL_SIZE - frameM / 2) * CELL_SIZE * perDisplay;
      const y = ((cell.y - top) / CELL_SIZE - frameM / 2) * CELL_SIZE * perDisplay;
      // Stamps read shared state when rendered: execute each before the next.
      target.stamp(source.key, name, x, y, { originX: 0, originY: 0, blendMode }).render();
    }
    keys[pass] = key;
  }
  const sockets: [string, BaseFortSocket][] = [];
  placed.forEach(({ cell, index, variant }, n) => {
    for (const [name, socket] of Object.entries(variant.frames[index].sockets)) {
      sockets.push([`${name}-${n}`, { x: cell.x + socket.x - centreX, y: cell.y + socket.y - centreY, z: socket.z }]);
    }
  });
  const cellHeights = passes.includes('caster-height') ? placed.map(({ index, variant }) =>
    ({ key: baseFortTextureKey(variant, 'caster-height'), frame: `kit-frame-${index}`, framePx: kit.framePx })) : undefined;
  return { centreX, centreY, size, sourceSize: Math.round(size * sourcePerDisplay), keys, sockets, cellHeights };
}
