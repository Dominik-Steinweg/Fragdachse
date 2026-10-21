import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { CELL_SIZE } from '../src/config';
import { BRIDGE_DEMOLITION_RULES } from '../src/config/bridges';
import { resolveBridgeChargeDenial } from '../src/systems/BridgeDemolitionRules';
import { bridgeChargeCandidates } from '../src/systems/BridgeInteraction';
import type { ArenaBridge } from '../src/types';
import type { BridgeRuntimeState } from '../src/world/WorldBridgeRuntime';

const BRIDGE: ArenaBridge = { id: 'river-bridge', axis: 'horizontal', gridX: 10, gridY: 8, spanCells: 4, deckWidthCells: 3 };
const origin = { offsetX: 0, offsetY: 0 };
const eastEdge = { x: 14 * CELL_SIZE, y: 9.5 * CELL_SIZE };

describe('bridge demolition rule', () => {
  it('reports the first reason a charge cannot be planted', () => {
    const ok = { phase: 'standing' as const, carryingExplosive: true, distancePx: 10, allowed: true };
    expect(resolveBridgeChargeDenial(ok)).toBeNull();
    expect(resolveBridgeChargeDenial({ ...ok, phase: 'collapsed' })).toBe('collapsed');
    expect(resolveBridgeChargeDenial({ ...ok, phase: 'charged' })).toBe('charged');
    expect(resolveBridgeChargeDenial({ ...ok, allowed: false })).toBe('not-allowed');
    expect(resolveBridgeChargeDenial({ ...ok, distancePx: BRIDGE_DEMOLITION_RULES.interactRangePx + 1 })).toBe('out-of-range');
    expect(resolveBridgeChargeDenial({ ...ok, carryingExplosive: false })).toBe('no-explosive');
  });
});

describe('bridge Shift candidates', () => {
  const states = new Map<string, BridgeRuntimeState>();
  const input = (overrides: object = {}) => ({
    bridges: [BRIDGE], readState: (id: string) => states.get(id) ?? null, origin,
    player: { x: eastEdge.x + 20, y: eastEdge.y }, carryingExplosive: true, explosivesInPlay: true, worldRevision: 7, ...overrides,
  });

  it('offers standing bridges in reach and frames the whole deck', () => {
    const [candidate] = bridgeChargeCandidates(input());
    expect(candidate).toMatchObject({ kind: 'bridge-charge', bridgeId: BRIDGE.id, x: eastEdge.x, y: eastEdge.y, worldRevision: 7,
      footprint: { left: 10 * CELL_SIZE, top: 8 * CELL_SIZE, right: 14 * CELL_SIZE, bottom: 11 * CELL_SIZE } });
    expect(candidate!.blocked).toBeUndefined();
    expect(bridgeChargeCandidates(input({ player: { x: eastEdge.x + 200, y: eastEdge.y } }))).toEqual([]);
  });

  it('names missing explosives, and leaves bridges as plain floor without explosives in the round', () => {
    expect(bridgeChargeCandidates(input({ carryingExplosive: false }))[0]!.blocked).toBeTruthy();
    expect(bridgeChargeCandidates(input({ carryingExplosive: false, explosivesInPlay: false }))).toEqual([]);
    states.set(BRIDGE.id, { phase: 'charged', detonatesAt: 1 });
    expect(bridgeChargeCandidates(input())).toEqual([]);
    states.clear();
  });
});
