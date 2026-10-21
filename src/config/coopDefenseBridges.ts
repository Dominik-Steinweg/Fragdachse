import { getBridgeAbutmentCells, getBridgeDeckCells } from '../arena/BridgeGeometry';
import type { ArenaBridge, WaterCell } from '../types';
import type { CoopDefenseMapConfig } from './coopDefenseMapAuthoring';
import { createAuthoredTerrainGuard, type AuthoredTerrainGuardConfig } from './coopDefenseWater';

/** Deck length bounds along the axis of travel; long spans would read as causeways, not bridges. */
export const MIN_BRIDGE_SPAN_CELLS = 2;
export const MAX_BRIDGE_SPAN_CELLS = 12;
/** Deck width bounds across the axis: wide enough for a badger pair, narrow enough to stay a chokepoint. */
export const MIN_BRIDGE_DECK_WIDTH_CELLS = 2;
export const MAX_BRIDGE_DECK_WIDTH_CELLS = 4;
export const MAX_WORLD_BRIDGES = 16;
const BRIDGE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type BridgeAuthoring = AuthoredTerrainGuardConfig
  & Pick<CoopDefenseMapConfig, 'bridges' | 'spawnZones' | 'krakenHabitat'>;

/**
 * Shared by authoring validation (including editor saves) and deterministic generation. Every deck
 * cell must be authored water, both abutment rows dry land, and neither may touch a reserved
 * structure, a water spawn zone or another bridge. Idempotent: normalized output validates again.
 */
export function normalizeCoopDefenseBridges(
  config: BridgeAuthoring,
  water: readonly WaterCell[],
  cols: number,
  rows: number,
): ArenaBridge[] | undefined {
  const raw = config.bridges;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error('[coopDefenseMaps] Bridges must be an array');
  if (raw.length > MAX_WORLD_BRIDGES) throw new Error(`[coopDefenseMaps] At most ${MAX_WORLD_BRIDGES} bridges per World`);
  if (raw.length > 0 && config.krakenHabitat !== undefined) {
    // The kraken's habitat rules read authored water as its pond; a deck across it is not supported.
    throw new Error('[coopDefenseMaps] Bridges cannot share a World with a kraken habitat');
  }
  const wet = new Set(water.map((cell) => `${cell.gridX}_${cell.gridY}`));
  const waterZones = (config.spawnZones ?? []).filter((zone) => zone.medium === 'water');
  const guard = createAuthoredTerrainGuard(config, cols, rows);
  const claimed = new Map<string, string>();
  const ids = new Set<string>();
  return raw.map((entry: ArenaBridge) => {
    const bridge = parseBridge(entry);
    if (ids.has(bridge.id)) throw new Error(`[coopDefenseMaps] Duplicate bridge id: ${bridge.id}`);
    ids.add(bridge.id);
    const label = `[coopDefenseMaps] Bridge ${bridge.id}`;
    const claim = (cell: WaterCell, role: string): void => {
      const key = `${cell.gridX}_${cell.gridY}`;
      if (cell.gridX < 0 || cell.gridY < 0 || cell.gridX >= cols || cell.gridY >= rows) {
        throw new Error(`${label} ${role} lies outside the arena: ${key}`);
      }
      const reason = guard(cell.gridX, cell.gridY);
      if (reason) throw new Error(`${label} ${role} ${reason}: ${key}`);
      const zone = waterZones.find((z) => cell.gridX >= z.gridX && cell.gridX < z.gridX + z.widthCells
        && cell.gridY >= z.gridY && cell.gridY < z.gridY + z.heightCells);
      if (zone) throw new Error(`${label} ${role} overlaps water spawn zone ${zone.id}: ${key}`);
      const owner = claimed.get(key);
      if (owner) throw new Error(`${label} ${role} overlaps bridge ${owner}: ${key}`);
      claimed.set(key, bridge.id);
    };
    for (const cell of getBridgeDeckCells(bridge)) {
      claim(cell, 'deck');
      if (!wet.has(`${cell.gridX}_${cell.gridY}`)) {
        throw new Error(`${label} deck must span water: ${cell.gridX}_${cell.gridY}`);
      }
    }
    const { start, end } = getBridgeAbutmentCells(bridge);
    for (const cell of [...start, ...end]) {
      claim(cell, 'abutment');
      if (wet.has(`${cell.gridX}_${cell.gridY}`)) {
        throw new Error(`${label} abutment must rest on dry land: ${cell.gridX}_${cell.gridY}`);
      }
    }
    return bridge;
  });
}

function parseBridge(entry: ArenaBridge): ArenaBridge {
  if (!entry || typeof entry !== 'object') throw new Error('[coopDefenseMaps] Bridge must be an object');
  const { id, axis, gridX, gridY, spanCells, deckWidthCells } = entry;
  if (typeof id !== 'string' || id.length > 64 || !BRIDGE_ID.test(id)) {
    throw new Error(`[coopDefenseMaps] Bridge id must be kebab-case (max 64): ${String(id)}`);
  }
  if (axis !== 'horizontal' && axis !== 'vertical') throw new Error(`[coopDefenseMaps] Bridge ${id} axis must be horizontal or vertical`);
  if (![gridX, gridY, spanCells, deckWidthCells].every(Number.isSafeInteger)) {
    throw new Error(`[coopDefenseMaps] Bridge ${id} needs integer gridX, gridY, spanCells and deckWidthCells`);
  }
  if (spanCells < MIN_BRIDGE_SPAN_CELLS || spanCells > MAX_BRIDGE_SPAN_CELLS) {
    throw new Error(`[coopDefenseMaps] Bridge ${id} spanCells must be ${MIN_BRIDGE_SPAN_CELLS}..${MAX_BRIDGE_SPAN_CELLS}`);
  }
  if (deckWidthCells < MIN_BRIDGE_DECK_WIDTH_CELLS || deckWidthCells > MAX_BRIDGE_DECK_WIDTH_CELLS) {
    throw new Error(`[coopDefenseMaps] Bridge ${id} deckWidthCells must be ${MIN_BRIDGE_DECK_WIDTH_CELLS}..${MAX_BRIDGE_DECK_WIDTH_CELLS}`);
  }
  return { id, axis, gridX, gridY, spanCells, deckWidthCells };
}
