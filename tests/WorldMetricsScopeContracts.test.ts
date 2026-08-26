import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyArenaMetricsForMode, GRID_COLS, GRID_ROWS } from '../src/config';
import { COOP_DEFENSE_MAP_CONFIGS, getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';

/**
 * World-scoped Metrik statt globaler Arena-Variablen.
 *
 * `src/config.ts` haelt die aktive Arena weiterhin als mutable Modulvariablen. Sie duerfen fuer
 * die migrierten world-scoped Aufloeser keine Quelle mehr sein: sonst haengt Weltgeometrie davon
 * ab, welche Arena zufaellig zuletzt gesetzt wurde – und Lobby-Vorschau, Host und Client koennen
 * dieselbe Map unterschiedlich aufloesen.
 */

/** Module, die ihre raeumliche Grundlage ausschliesslich aus einer World beziehen. */
const WORLD_SCOPED_MODULES = [
  'src/arena/BaseRegistry.ts',
  'src/systems/PlacementSystem.ts',
] as const;

/** Mutable Arena-Variablen aus `src/config.ts`; sie beschreiben immer nur eine aktive Arena. */
const MUTABLE_ARENA_GLOBALS = [
  'GRID_COLS',
  'GRID_ROWS',
  'ARENA_WIDTH',
  'ARENA_HEIGHT',
  'ARENA_MAX_X',
  'ARENA_MAX_Y',
  'ARENA_VIEWPORT_WIDTH',
  'ARENA_VIEWPORT_HEIGHT',
  'ACTIVE_ARENA_METRICS_PROFILE',
] as const;

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/** Bezeichner, die das Modul aus `src/config` importiert. */
function collectConfigImports(source: string): string[] {
  const names: string[] = [];
  const pattern = /import\s*\{([^}]*)\}\s*from\s*'[^']*\/config'/g;
  let match = pattern.exec(source);
  while (match !== null) {
    for (const raw of match[1].split(',')) {
      const name = raw.replace(/^\s*type\s+/, '').split(' as ')[0]!.trim();
      if (name.length > 0) names.push(name);
    }
    match = pattern.exec(source);
  }
  return names;
}

describe('World-scoped Metrik – migrierte Module', () => {
  for (const path of WORLD_SCOPED_MODULES) {
    it(`${path} liest keine mutable Arena-Variable`, () => {
      const source = read(path);
      const imported = collectConfigImports(source);
      // Positive Absicherung des Parsers: das Modul importiert ueberhaupt aus der Config.
      expect(imported.length, `${path} imports nothing from config`).toBeGreaterThan(0);

      for (const global of MUTABLE_ARENA_GLOBALS) {
        expect(imported.includes(global), `${path} still imports ${global}`).toBe(false);
      }
      // Auch nicht ueber die Uebergangshilfe: die ist fuer Praesentation und Tests gedacht.
      expect(
        source.includes('resolveActiveArenaWorldMetrics'),
        `${path} must not fall back to the active arena metrics`,
      ).toBe(false);
      // `ARENA_OFFSET_X/Y` sind ebenfalls mutabel; sie duerfen nur als Wort im Kommentar stehen.
      for (const offset of ['ARENA_OFFSET_X', 'ARENA_OFFSET_Y']) {
        expect(imported.includes(offset), `${path} still imports ${offset}`).toBe(false);
      }
    });
  }
});

describe('World-scoped Metrik – Basisgeometrie folgt ihrer Map', () => {
  it('loest jede authored Map unabhaengig von der gerade aktiven Arena identisch auf', () => {
    // Referenz: jede Map einmal aufloesen, waehrend eine fremde Arena global aktiv ist.
    applyArenaMetricsForMode('deathmatch', 'LOBBY');
    const underLobbyMetrics = COOP_DEFENSE_MAP_CONFIGS.map((mapConfig) => ({
      mapId: mapConfig.mapId,
      bases: resolveCoopDefenseBases(mapConfig),
    }));

    for (const entry of underLobbyMetrics) {
      const mapConfig = getCoopDefenseMapConfig(entry.mapId);
      // Und noch einmal, waehrend genau diese Map global aktiv ist.
      applyArenaMetricsForMode(
        COOP_DEFENSE_MODE,
        'ARENA',
        mapConfig.arenaWidthCells,
        mapConfig.arenaHeightCells,
      );
      expect(resolveCoopDefenseBases(mapConfig), entry.mapId).toEqual(entry.bases);
    }

    applyArenaMetricsForMode('deathmatch', 'LOBBY');
  });

  it('haelt jede Basiszelle im Raster der eigenen Map', () => {
    applyArenaMetricsForMode('deathmatch', 'LOBBY');
    for (const mapConfig of COOP_DEFENSE_MAP_CONFIGS) {
      const metrics = resolveCoopDefenseWorldMetrics(mapConfig.arenaWidthCells, mapConfig.arenaHeightCells);
      // Die Lobby-Metrik ist absichtlich eine andere; die Aufloesung darf sie nicht benutzen.
      expect(metrics.gridCols === GRID_COLS && metrics.gridRows === GRID_ROWS).toBe(false);
      for (const base of resolveCoopDefenseBases(mapConfig)) {
        for (const cell of base.cells) {
          expect(cell.gridX, `${mapConfig.mapId}/${base.id}`).toBeGreaterThanOrEqual(0);
          expect(cell.gridX, `${mapConfig.mapId}/${base.id}`).toBeLessThan(metrics.gridCols);
          expect(cell.gridY, `${mapConfig.mapId}/${base.id}`).toBeGreaterThanOrEqual(0);
          expect(cell.gridY, `${mapConfig.mapId}/${base.id}`).toBeLessThan(metrics.gridRows);
        }
      }
    }
    applyArenaMetricsForMode('deathmatch', 'LOBBY');
  });
});
