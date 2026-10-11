import { registerDiagnosticMap, type CoopDefenseMapConfig } from '../../config/coopDefenseMaps';

export const KRAKEN_MAP_ID = 'kraken-abyss-lab';
export const KRAKEN_CENTER = { gridX: 35, gridY: 22 };
export const KRAKEN_SHORE = { gridX: 35, gridY: 32.4 };
export const KRAKEN_PLAYER = { gridX: 39, gridY: 36 };

export function krakenAbyssMap(): CoopDefenseMapConfig {
  const water: { gridX: number; gridY: number }[] = [];
  for (let y = 10; y <= 34; y++) for (let x = 20; x <= 50; x++) {
    const dx = (x - KRAKEN_CENTER.gridX) / 13.5, dy = (y - KRAKEN_CENTER.gridY) / 10.5;
    const angle = Math.atan2(dy, dx);
    const shore = 1 + .045 * Math.sin(angle * 5) + .025 * Math.cos(angle * 3);
    if (dx * dx + dy * dy <= shore * shore) water.push({ gridX: x, gridY: y });
  }
  return { mapId: KRAKEN_MAP_ID, arenaWidthCells: 70, arenaHeightCells: 48, timeOfDay: '12:00',
    rockFillRatio: 0, treeCount: 0, trackMode: 'none', water,
    rockWalls: [
      { id: 'north-rocks', gridX: 16, gridY: 5, widthCells: 3, heightCells: 2 },
      { id: 'east-rocks', gridX: 61, gridY: 24, widthCells: 2, heightCells: 3 },
    ],
    tutorialDurationMs: 0, surviveDurationSec: 3600, balanceReferenceDurationSec: 3600,
    objective: 'survive', respawnsPerPlayer: 0,
    // Coop composition expects a base owner; keep this unarmed fixture off the review surface.
    bases: [{ id: 'review-outpost', faction: 'hostile', role: 'outpost', hpMax: 1_000_000,
      anchor: { kind: 'grid', gridX: 65, gridY: 43 }, shape: { kind: 'rectangle', widthCells: 2, heightCells: 2 } }],
    encounters: [], persistentSpawns: [], powerUps: [], mapEvents: [],
  };
}

export const registerKrakenAbyssMap = (): (() => void) => registerDiagnosticMap(krakenAbyssMap());
