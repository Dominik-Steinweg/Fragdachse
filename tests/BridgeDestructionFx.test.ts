import { describe, expect, it } from 'vitest';
import { buildBridgeDestructionPlan, BRIDGE_DESTRUCTION_PIECE_COUNT } from '../src/effects/bridge/BridgeDestructionPlan';
import { BRIDGE_KIT_ABUTMENT_PX, BRIDGE_KIT_CANVAS_PX, BRIDGE_KIT_DECK_CENTRES, BRIDGE_KIT_RAIL_PX, BRIDGE_KIT_SPAN_CELLS,
  planBridgeKitPieces, type BridgeKitPiece } from '../src/effects/bridge/BridgeKit';
import { CELL_SIZE } from '../src/config';

describe('bridge collapse plan', () => {
  const deck = { x: 320, y: 384, width: 128, height: 96 };

  it('has a fixed, deterministic size independent of the span', () => {
    const plan = buildBridgeDestructionPlan(deck, true);
    expect(plan).toHaveLength(BRIDGE_DESTRUCTION_PIECE_COUNT);
    expect(buildBridgeDestructionPlan({ ...deck, width: 384 }, true)).toHaveLength(BRIDGE_DESTRUCTION_PIECE_COUNT);
    expect(buildBridgeDestructionPlan(deck, true)).toEqual(plan);
    expect(buildBridgeDestructionPlan({ ...deck, width: 0 }, true)).toEqual([]);
  });

  it('starts every piece on the deck and leaves splash rings where they land', () => {
    for (const horizontal of [true, false]) {
      for (const piece of buildBridgeDestructionPlan(deck, horizontal)) {
        expect(piece.x).toBeGreaterThanOrEqual(deck.x);
        expect(piece.x).toBeLessThanOrEqual(deck.x + deck.width);
        expect(piece.y).toBeGreaterThanOrEqual(deck.y);
        expect(piece.y).toBeLessThanOrEqual(deck.y + deck.height);
        if (piece.material === 'splash') expect([piece.endX, piece.endY]).toEqual([piece.x, piece.y]);
        expect(piece.lifeMs).toBeGreaterThan(piece.flightMs);
      }
    }
  });
});

describe('bridge kit assembly', () => {
  const span = (pieces: readonly BridgeKitPiece[]) => Math.max(...pieces.map(p => p.dx + p.sw));
  const deckLeft = (BRIDGE_KIT_CANVAS_PX - BRIDGE_KIT_SPAN_CELLS * CELL_SIZE) / 2;
  const westFace = deckLeft - BRIDGE_KIT_ABUTMENT_PX, eastFace = BRIDGE_KIT_CANVAS_PX - westFace;

  it('covers every authorable deck exactly from the deck of its width, cutting only on cell lines', () => {
    for (let spanCells = 2; spanCells <= 12; spanCells++) {
      for (let widthCells = 2; widthCells <= 4; widthCells++) {
        const pieces = planBridgeKitPieces(spanCells, widthCells, `bridge-${spanCells}-${widthCells}`);
        const centre = BRIDGE_KIT_DECK_CENTRES[widthCells]!;
        expect(span(pieces)).toBe(spanCells * CELL_SIZE + 2 * BRIDGE_KIT_ABUTMENT_PX);
        expect(pieces.map(p => p.dx)).toEqual(pieces.map((_, i) => pieces.slice(0, i).reduce((x, p) => x + p.sw, 0)));
        for (const p of pieces) {
          // One row: the whole deck of that width, rail face to rail face, never cut across.
          expect([p.sy, p.sh, p.dy]).toEqual([centre - widthCells * CELL_SIZE / 2 - BRIDGE_KIT_RAIL_PX,
            widthCells * CELL_SIZE + 2 * BRIDGE_KIT_RAIL_PX, 0]);
          for (const x of [p.sx, p.sx + p.sw]) {
            expect(x === westFace || x === eastFace || (x - deckLeft) % CELL_SIZE === 0, `x ${x}`).toBe(true);
          }
        }
        // Both ends always come from the master's ends: abutment, sill and newel posts.
        expect(pieces[0]!.sx).toBe(westFace);
        expect(pieces.at(-1)!.sx + pieces.at(-1)!.sw).toBe(eastFace);
      }
    }
  });

  it('chooses middle cells per bridge id, deterministically', () => {
    expect(planBridgeKitPieces(5, 3, 'east-river-bridge')).toEqual(planBridgeKitPieces(5, 3, 'east-river-bridge'));
    const starts = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => planBridgeKitPieces(3, 3, id)[1]!.sx));
    expect(starts.size).toBeGreaterThan(1);
    expect(() => planBridgeKitPieces(4, 5, 'too-wide')).toThrow();
    expect(() => planBridgeKitPieces(4, 1, 'too-narrow')).toThrow();
    expect(() => planBridgeKitPieces(1, 3, 'too-short')).toThrow();
  });
});
