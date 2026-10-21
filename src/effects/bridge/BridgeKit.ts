import { CELL_SIZE } from '../../config';

/**
 * Layout of the bridge kit masters (scripts/asset-pipeline/recipes_v2/bridge-wood.py), in
 * display pixels of the 224 px canvas: a deck of six by four cells centred on the canvas, its
 * abutments 10 px onto the banks and its railings 3 px beyond the deck edges. The render keeps a
 * joint on every cell line, so any deck is assembled from whole-cell windows of it.
 */
export const BRIDGE_KIT_CANVAS_PX = 224;
export const BRIDGE_KIT_SPAN_CELLS = 6;
export const BRIDGE_KIT_WIDTH_CELLS = 4;
export const BRIDGE_KIT_ABUTMENT_PX = 10;
export const BRIDGE_KIT_RAIL_PX = 3;

const DECK_LEFT = (BRIDGE_KIT_CANVAS_PX - BRIDGE_KIT_SPAN_CELLS * CELL_SIZE) / 2;
const DECK_TOP = (BRIDGE_KIT_CANVAS_PX - BRIDGE_KIT_WIDTH_CELLS * CELL_SIZE) / 2;
const MIDDLE_CELLS = BRIDGE_KIT_SPAN_CELLS - 2;

/** One rectangle copied from the master (`s*`) into the assembled bridge (`d*`), display px. */
export interface BridgeKitPiece {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dy: number;
}

interface Strip { readonly from: number; readonly length: number; readonly to: number }

function seededRandom(seedText: string): () => number {
  let seed = 0x9e3779b9;
  for (let i = 0; i < seedText.length; i++) seed = Math.imul(seed ^ seedText.charCodeAt(i), 0x01000193);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Along the travel axis: the master's west end (abutment plus first cell), middle cells taken as
 * contiguous runs from seeded starting points, and the east end. Every cut lies on a cell line.
 */
function spanStrips(spanCells: number, seedText: string): Strip[] {
  const end = BRIDGE_KIT_ABUTMENT_PX + CELL_SIZE;
  const strips: Strip[] = [{ from: DECK_LEFT - BRIDGE_KIT_ABUTMENT_PX, length: end, to: 0 }];
  const random = seededRandom(seedText);
  let remaining = spanCells - 2;
  let to = end;
  while (remaining > 0) {
    const run = Math.min(remaining, MIDDLE_CELLS);
    const first = 1 + Math.floor(random() * (MIDDLE_CELLS - run + 1));
    strips.push({ from: DECK_LEFT + first * CELL_SIZE, length: run * CELL_SIZE, to });
    to += run * CELL_SIZE;
    remaining -= run;
  }
  strips.push({ from: DECK_LEFT + (BRIDGE_KIT_SPAN_CELLS - 1) * CELL_SIZE, length: end, to });
  return strips;
}

/** Across the deck: the north half and the south half, each cut on the cell line nearest the middle. */
function widthStrips(widthCells: number): Strip[] {
  const north = Math.ceil(widthCells / 2), south = Math.floor(widthCells / 2);
  const northLength = BRIDGE_KIT_RAIL_PX + north * CELL_SIZE;
  const southFrom = DECK_TOP + (BRIDGE_KIT_WIDTH_CELLS - south) * CELL_SIZE;
  return [
    { from: DECK_TOP - BRIDGE_KIT_RAIL_PX, length: northLength, to: 0 },
    { from: southFrom, length: south * CELL_SIZE + BRIDGE_KIT_RAIL_PX, to: northLength },
  ];
}

/**
 * Pieces that assemble a horizontal bridge of the given size from a kit master. The result
 * covers `spanCells * CELL_SIZE + 2 * abutment` by `widthCells * CELL_SIZE + 2 * rail` exactly.
 */
export function planBridgeKitPieces(spanCells: number, widthCells: number, seedText: string): BridgeKitPiece[] {
  if (widthCells > BRIDGE_KIT_WIDTH_CELLS || spanCells < 2 || widthCells < 2) {
    throw new Error(`Bridge kit cannot assemble ${spanCells}x${widthCells}`);
  }
  const pieces: BridgeKitPiece[] = [];
  for (const column of spanStrips(spanCells, seedText)) {
    for (const row of widthStrips(widthCells)) {
      pieces.push({ sx: column.from, sy: row.from, sw: column.length, sh: row.length, dx: column.to, dy: row.to });
    }
  }
  return pieces;
}

/** Draws the planned pieces from a master image whose width spans the 224 px canvas at any resolution. */
export function drawBridgeKit(ctx: CanvasRenderingContext2D, master: CanvasImageSource & { width: number },
  pieces: readonly BridgeKitPiece[], scale: number): void {
  const source = master.width / BRIDGE_KIT_CANVAS_PX;
  for (const piece of pieces) {
    ctx.drawImage(master, piece.sx * source, piece.sy * source, piece.sw * source, piece.sh * source,
      piece.dx * scale, piece.dy * scale, piece.sw * scale, piece.sh * scale);
  }
}
