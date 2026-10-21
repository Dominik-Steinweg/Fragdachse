import { getBridgeDeckWorldRect, type BridgeWorldOrigin } from '../../arena/BridgeGeometry';
import type { TerrainColorSnapshot } from '../../arena/TerrainColorSnapshot';
import { WATER_COLOR } from '../../arena/WaterSurfaceModel';
import type { ArenaBridge } from '../../types';

/** Mean albedo of the kit deck boards (pipeline asset `bridge-wood`); dust and leaves picked up on a deck take this colour. */
export const BRIDGE_DECK_GROUND_COLOR = 0x675f45;

/**
 * Writes bridge decks into the shared terrain colour snapshot (movement dust, leaf blower, burrow):
 * standing decks read as wood, collapsed ones as water again. The snapshot itself bakes authored water.
 */
export function stampBridgeTerrainColor(
  snapshot: TerrainColorSnapshot,
  bridges: readonly ArenaBridge[],
  origin: BridgeWorldOrigin,
  collapsed: ReadonlySet<string>,
): void {
  for (const bridge of bridges) {
    const color = collapsed.has(bridge.id) ? WATER_COLOR : BRIDGE_DECK_GROUND_COLOR;
    const rect = getBridgeDeckWorldRect(bridge, origin);
    const x0 = Math.max(0, Math.floor((rect.x - snapshot.worldOffsetX) / snapshot.scale));
    const y0 = Math.max(0, Math.floor((rect.y - snapshot.worldOffsetY) / snapshot.scale));
    const x1 = Math.min(snapshot.width, Math.ceil((rect.x + rect.width - snapshot.worldOffsetX) / snapshot.scale));
    const y1 = Math.min(snapshot.height, Math.ceil((rect.y + rect.height - snapshot.worldOffsetY) / snapshot.scale));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const index = (y * snapshot.width + x) * 3;
        snapshot.data[index] = (color >> 16) & 0xff;
        snapshot.data[index + 1] = (color >> 8) & 0xff;
        snapshot.data[index + 2] = color & 0xff;
      }
    }
  }
}
