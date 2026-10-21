import { describe, expect, it } from 'vitest';
import { buildBridgeDestructionPlan, BRIDGE_DESTRUCTION_PIECE_COUNT } from '../src/effects/bridge/BridgeDestructionPlan';
import { BRIDGE_KIT_ABUTMENT_PX, BRIDGE_KIT_CANVAS_PX, BRIDGE_KIT_RAIL_PX, BRIDGE_KIT_SPAN_CELLS, BRIDGE_KIT_WIDTH_CELLS,
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
  const width = (pieces: readonly BridgeKitPiece[]) => Math.max(...pieces.map(p => p.dy + p.sh));
  const deckLeft = (BRIDGE_KIT_CANVAS_PX - BRIDGE_KIT_SPAN_CELLS * CELL_SIZE) / 2;
  const deckTop = (BRIDGE_KIT_CANVAS_PX - BRIDGE_KIT_WIDTH_CELLS * CELL_SIZE) / 2;

  it('covers every authorable deck exactly, cutting the master only on cell lines', () => {
    for (let spanCells = 2; spanCells <= 12; spanCells++) {
      for (let widthCells = 2; widthCells <= 4; widthCells++) {
        const pieces = planBridgeKitPieces(spanCells, widthCells, `bridge-${spanCells}-${widthCells}`);
        expect(span(pieces)).toBe(spanCells * CELL_SIZE + 2 * BRIDGE_KIT_ABUTMENT_PX);
        expect(width(pieces)).toBe(widthCells * CELL_SIZE + 2 * BRIDGE_KIT_RAIL_PX);
        expect(pieces.reduce((area, p) => area + p.sw * p.sh, 0)).toBe(span(pieces) * width(pieces));
        for (const p of pieces) {
          // Only the outer abutment and rail faces are not cell lines.
          for (const x of [p.sx, p.sx + p.sw]) {
            const outer = x === deckLeft - BRIDGE_KIT_ABUTMENT_PX || x === BRIDGE_KIT_CANVAS_PX - deckLeft + BRIDGE_KIT_ABUTMENT_PX;
            expect(outer || (x - deckLeft) % CELL_SIZE === 0, `x ${x}`).toBe(true);
          }
          for (const y of [p.sy, p.sy + p.sh]) {
            const outer = y === deckTop - BRIDGE_KIT_RAIL_PX || y === BRIDGE_KIT_CANVAS_PX - deckTop + BRIDGE_KIT_RAIL_PX;
            expect(outer || (y - deckTop) % CELL_SIZE === 0, `y ${y}`).toBe(true);
          }
        }
        // Both ends always come from the master's ends: abutment, sill and newel posts.
        expect(pieces.filter(p => p.dx === 0).every(p => p.sx === deckLeft - BRIDGE_KIT_ABUTMENT_PX)).toBe(true);
        expect(pieces.filter(p => p.dx + p.sw === span(pieces))
          .every(p => p.sx + p.sw === BRIDGE_KIT_CANVAS_PX - deckLeft + BRIDGE_KIT_ABUTMENT_PX)).toBe(true);
      }
    }
  });

  it('chooses middle cells per bridge id, deterministically', () => {
    expect(planBridgeKitPieces(5, 3, 'east-river-bridge')).toEqual(planBridgeKitPieces(5, 3, 'east-river-bridge'));
    const starts = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => planBridgeKitPieces(3, 3, id)[2]!.sx));
    expect(starts.size).toBeGreaterThan(1);
    expect(() => planBridgeKitPieces(4, 5, 'too-wide')).toThrow();
    expect(() => planBridgeKitPieces(1, 3, 'too-short')).toThrow();
  });
});
