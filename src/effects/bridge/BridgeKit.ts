import { CELL_SIZE } from '../../config';

/**
 * Layout of the bridge kit masters (scripts/asset-pipeline/recipes_v2/bridge-wood.py), in
 * display pixels of the 352 px canvas: three decks of eight cells, four, three and two cells
 * wide, stacked across the canvas. Each has its abutments 10 px onto the banks and its railings
 * 3 px beyond the deck edges. The render keeps a joint on every cell line along the span, so a
 * deck of any length is assembled from whole-cell windows of the deck of its width.
 */
export const BRIDGE_KIT_CANVAS_PX = 352;
export const BRIDGE_KIT_SPAN_CELLS = 8;
export const BRIDGE_KIT_ABUTMENT_PX = 10;
export const BRIDGE_KIT_RAIL_PX = 3;
/** Deck centre line in canvas px for each authorable deck width (recipe: y = +3, -1, -4 BU). */
export const BRIDGE_KIT_DECK_CENTRES: Readonly<Record<number, number>> = { 4: 80, 3: 208, 2: 304 };

const DECK_LEFT = (BRIDGE_KIT_CANVAS_PX - BRIDGE_KIT_SPAN_CELLS * CELL_SIZE) / 2;
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
 * Pieces that assemble a horizontal bridge of the given size from a kit master: the west end of
 * the deck of that width (abutment plus first cell), its middle cells as contiguous runs from
 * seeded starting points, and its east end. Every cut lies on a cell line. The result covers
 * `spanCells * CELL_SIZE + 2 * abutment` by `widthCells * CELL_SIZE + 2 * rail` exactly.
 */
export function planBridgeKitPieces(spanCells: number, widthCells: number, seedText: string): BridgeKitPiece[] {
  const centre = BRIDGE_KIT_DECK_CENTRES[widthCells];
  if (centre === undefined || spanCells < 2) throw new Error(`Bridge kit cannot assemble ${spanCells}x${widthCells}`);
  const sy = centre - (widthCells * CELL_SIZE) / 2 - BRIDGE_KIT_RAIL_PX;
  const sh = widthCells * CELL_SIZE + 2 * BRIDGE_KIT_RAIL_PX;
  const end = BRIDGE_KIT_ABUTMENT_PX + CELL_SIZE;
  const pieces: BridgeKitPiece[] = [{ sx: DECK_LEFT - BRIDGE_KIT_ABUTMENT_PX, sy, sw: end, sh, dx: 0, dy: 0 }];
  const random = seededRandom(seedText);
  let remaining = spanCells - 2;
  let dx = end;
  while (remaining > 0) {
    const run = Math.min(remaining, MIDDLE_CELLS);
    const first = 1 + Math.floor(random() * (MIDDLE_CELLS - run + 1));
    pieces.push({ sx: DECK_LEFT + first * CELL_SIZE, sy, sw: run * CELL_SIZE, sh, dx, dy: 0 });
    dx += run * CELL_SIZE;
    remaining -= run;
  }
  pieces.push({ sx: DECK_LEFT + (BRIDGE_KIT_SPAN_CELLS - 1) * CELL_SIZE, sy, sw: end, sh, dx, dy: 0 });
  return pieces;
}

/** Draws the planned pieces from a master image whose width spans the kit canvas at any resolution. */
export function drawBridgeKit(ctx: CanvasRenderingContext2D, master: CanvasImageSource & { width: number },
  pieces: readonly BridgeKitPiece[], scale: number): void {
  const source = master.width / BRIDGE_KIT_CANVAS_PX;
  for (const piece of pieces) {
    ctx.drawImage(master, piece.sx * source, piece.sy * source, piece.sw * source, piece.sh * source,
      piece.dx * scale, piece.dy * scale, piece.sw * scale, piece.sh * scale);
  }
}
