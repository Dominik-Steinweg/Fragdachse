import type { WorldBaseDefinition } from './WorldDefinition';

/**
 * East of the spawn/base anchor (30,16), beyond the maximum reservation through column 42.
 * The dry pocket at columns 43..45, rows 22..24 beside the lake is already free of
 * rocks, trees, dirt paths and decals. The dealer stands north of it, facing the centre.
 */
export const LOBBY_MERCHANT = {
  stall: { gridX: 44, gridY: 23, sizeCells: 3, textureKey: 'construction_dawn_dealer_stall' },
  dealer: { gridX: 43.85, gridY: 20.75, displaySize: 38, textureKey: 'dawn_dealer' },
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
