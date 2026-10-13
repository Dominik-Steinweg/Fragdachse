import type { WorldBaseDefinition } from './WorldDefinition';

/**
 * East of the spawn/base anchor (36,25), beyond the maximum reservation through column 53.
 * The dry pocket below the eastern pond stays free of rocks, trees and ground clutter.
 * The dealer stands in front of the stall's northwest
 * corner, facing the spawn/base anchor, with no collision or interaction body.
 * Both the stall and the dealer's decorative footprint stay outside the reservation.
 */
export const LOBBY_MERCHANT = {
  stall: { gridX: 56, gridY: 25, sizeCells: 3, textureKey: 'construction_dawn_dealer_stall' },
  dealer: { gridX: 54.6, gridY: 22.8, displaySize: 38, textureKey: 'dawn_dealer' },
  nameplate: { fullVisibilityCells: 20, hiddenAtCells: 26, offsetYCells: -2 },
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
