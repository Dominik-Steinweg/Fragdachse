import { registerDiagnosticMap, type CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import { KRAKEN_BOSS_DEFAULTS } from '../../config/krakenBoss';
import { registerKrakenDiagnosticEnemies } from '../../config/coopDefenseEnemies';
import { normalizeKrakenHabitat } from '../../config/krakenHabitat';

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
  const wet = new Set(water.map(c => `${c.gridX},${c.gridY}`));
  const south = [32, 37, 43].map(x => {
    let y = KRAKEN_CENTER.gridY;
    while (wet.has(`${x},${y + 1}`)) y++;
    return { id: `south-${x}`, waterCell: { gridX: x, gridY: y }, landCell: { gridX: x, gridY: y + 1 } };
  });
  const krakenHabitat = normalizeKrakenHabitat({ id: 'abyss-pond', kind: 'water', initialAnchorId: 'center',
    waterAnchors: [{ id: 'center', cell: KRAKEN_CENTER }], shores: south,
    exits: [south[0], south[2]].map(s => ({ id: `exit-${s.id}`, fromAnchorId: 'center', shoreId: s.id,
      widthCells: 5, path: [KRAKEN_CENTER, s.landCell, { gridX: s.landCell.gridX, gridY: 39 }] })),
  }, { widthCells: 70, heightCells: 48, water, bodyRadiusCells: KRAKEN_BOSS_DEFAULTS.bodyRadiusPx / 32 });
  return { mapId: KRAKEN_MAP_ID, arenaWidthCells: 70, arenaHeightCells: 48, timeOfDay: '12:00',
    krakenHabitat,
    boss: { enemyKind: 'abyssal-kraken', habitatId: krakenHabitat.id, spawnAtMs: 0, intro: { preset: 'kraken-rise' } },
    rockFillRatio: 0, treeCount: 0, trackMode: 'none', water,
    rockWalls: [
      { id: 'north-rocks', gridX: 16, gridY: 5, widthCells: 3, heightCells: 2 },
      { id: 'east-rocks', gridX: 61, gridY: 24, widthCells: 2, heightCells: 3 },
    ],
    tutorialDurationMs: 0, balanceReferenceDurationSec: 3600,
    objective: 'defeat-boss',
    // Coop composition expects a base owner; keep this unarmed fixture off the review surface.
    bases: [{ id: 'review-outpost', faction: 'friendly', role: 'main', hpMax: 1_000_000,
      anchor: { kind: 'grid', gridX: 65, gridY: 43 }, shape: { kind: 'rectangle', widthCells: 2, heightCells: 2 } }],
    encounters: [], persistentSpawns: [], powerUps: [], mapEvents: [],
  };
}

export const registerKrakenAbyssMap = (): (() => void) => {
  const releaseEnemies = registerKrakenDiagnosticEnemies(KRAKEN_BOSS_DEFAULTS);
  try {
    const releaseMap = registerDiagnosticMap(krakenAbyssMap());
    return () => { releaseMap(); releaseEnemies(); };
  } catch (error) { releaseEnemies(); throw error; }
};
