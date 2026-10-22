/**
 * The dealer stands at the merchant structure's `staff` socket, between wagon and counter inside the
 * outline (see `src/assets/manifests/lobby-structures.json`), without a collision or interaction body;
 * Shift opens the merchant from any side of the stall.
 */
export const LOBBY_MERCHANT = {
  dealer: { displaySize: 38 },
  /** Distance to the nearest wall of a structure, in cells. */
  nameplate: { fullVisibilityCells: 4, hiddenAtCells: 9 },
} as const;
