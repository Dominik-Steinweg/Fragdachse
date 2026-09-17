import { registerDiagnosticMap, type CoopDefenseMapConfig } from '../../config/coopDefenseMaps';

export const PERFORMANCE_MAP_ID = 'performance-reference';
export const REFERENCE_SEED = 16092026;

/** Fixed authored fixture; its load is never scaled to the measuring device. */
export function referenceMap(mapId = PERFORMANCE_MAP_ID): CoopDefenseMapConfig {
  const water: { gridX: number; gridY: number }[] = [];
  for (const [cx, cy, rx, ry] of [[60, 20, 12, 6], [110, 25, 15, 8], [100, 72, 16, 9]]) {
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) water.push({ gridX: x, gridY: y });
    }
  }
  return { mapId, arenaWidthCells: 160, arenaHeightCells: 96, timeOfDay: '12:00',
    rockFillRatio: 0, treeCount: 72, trackMode: 'rails', trackPosition: { kind: 'grid', gridX: 30 },
    water, rockWalls: [
      { id: 'west-reserve', gridX: 2, gridY: 2, widthCells: 20, heightCells: 92 },
      { id: 'east-reserve', gridX: 134, gridY: 2, widthCells: 24, heightCells: 92 },
      { id: 'nuke-field', gridX: 44, gridY: 43, widthCells: 20, heightCells: 16 },
      { id: 'bfg-field', gridX: 80, gridY: 43, widthCells: 20, heightCells: 16 },
    ], surviveDurationSec: 3600, balanceReferenceDurationSec: 3600, objective: 'survive', respawnsPerPlayer: 0,
    // The productive Coop composition requires a BaseManager for events and enemy behaviours.
    // This ordinary unarmed hostile structure is outside the fixtures and is never persistent.
    bases: [{ id: 'reference-outpost', faction: 'hostile', role: 'outpost', hpMax: 1_000_000,
      anchor: { kind: 'grid', gridX: 127, gridY: 90 }, shape: { kind: 'rectangle', widthCells: 2, heightCells: 2 } }],
    encounters: [], persistentSpawns: [],
    powerUps: [
      // These pickups deliberately use the productive delayed first-spawn rule.
      { defId: 'NUKE', anchor: { gridX: 40, gridY: 50 }, region: 'middle', respawnMs: 5000 },
      { defId: 'BFG', anchor: { gridX: 76, gridY: 50 }, region: 'middle', respawnMs: 5000 },
    ],
    mapEvents: mapId.endsWith('-train') ? [{ id: 'reference-train', type: 'train', start: { type: 'time', atMs: 5000 }, delayMs: 0 }] : [],
  };
}

export function registerReferenceMap(): () => void {
  const removers: (() => void)[] = [];
  try { for (const id of [PERFORMANCE_MAP_ID, `${PERFORMANCE_MAP_ID}-train`]) removers.push(registerDiagnosticMap(referenceMap(id))); }
  catch (error) { removers.reverse().forEach(remove => remove()); throw error; }
  return () => removers.reverse().forEach(remove => remove());
}
