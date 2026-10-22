/**
 * The dealer stands in the open niche on the south face of the merchant stall (the fourth lobby
 * structure, see `LOBBY_BUILDINGS`), facing the spawn, without a collision or interaction body;
 * Shift opens the merchant from any side of the stall.
 */
export const LOBBY_MERCHANT = {
  dealer: { gridX: 55, gridY: 11.4, displaySize: 38, textureKey: 'dawn_dealer' },
  /** Distance to the nearest wall of a structure, in cells. */
  nameplate: { fullVisibilityCells: 4, hiddenAtCells: 9 },
} as const;
