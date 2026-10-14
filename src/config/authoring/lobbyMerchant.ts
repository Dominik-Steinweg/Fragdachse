import type { WorldBaseDefinition } from './WorldDefinition';

/**
 * East of the spawn/base anchor (30,16), beyond the maximum reservation through column 42.
 * The dry pocket at columns 43..45, rows 22..24 beside the lake is already free of
 * rocks, trees, dirt paths and decals. The dealer stands in front of its northwest
 * corner, facing the spawn/base anchor, with no collision or interaction body.
 * Its decorative footprint may overlap the reservation edge; the stall collision may not.
 */
export const LOBBY_MERCHANT = {
  stall: { gridX: 44, gridY: 23, sizeCells: 3, textureKey: 'construction_dawn_dealer_stall' },
  dealer: { gridX: 42.6, gridY: 20.8, displaySize: 38, textureKey: 'dawn_dealer' },
  nameplate: { fullVisibilityCells: 6, hiddenAtCells: 12, offsetYCells: -2 },
} as const;

export const LOBBY_MERCHANT_BASE: WorldBaseDefinition = {
  id: 'lobby-merchant-stall',
  surface: 'none',
  faction: 'friendly',
  role: 'outpost',
  // World structures without an Activity are invulnerable and have no health bar.
  hpMax: 1,
  anchor: {
    kind: 'grid',
    gridX: LOBBY_MERCHANT.stall.gridX - 1,
    gridY: LOBBY_MERCHANT.stall.gridY - 1,
  },
  shape: { kind: 'rectangle', widthCells: LOBBY_MERCHANT.stall.sizeCells, heightCells: LOBBY_MERCHANT.stall.sizeCells },
};
