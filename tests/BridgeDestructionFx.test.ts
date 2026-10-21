import { describe, expect, it } from 'vitest';
import { buildBridgeDestructionPlan, BRIDGE_DESTRUCTION_PIECE_COUNT } from '../src/effects/bridge/BridgeDestructionPlan';

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
