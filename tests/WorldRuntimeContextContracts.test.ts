import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as config from '../src/config';
import { applyArenaMetricsForMode, getArenaMetricsProfile } from '../src/config';
import { COOP_DEFENSE_MAP_CONFIGS, getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import type { GameMode } from '../src/types';
import { PROCEDURAL_ARENA_WORLD_DEFINITION_ID, type WorldDescriptor } from '../src/world/WorldDescriptor';
import { isCellInsideWorld, resolveWorldMetrics, worldCellOrigin } from '../src/world/WorldMetrics';
import {
  createWorldRuntimeContext,
  findWorldBase,
  isValidPersistentBaseSite,
} from '../src/world/WorldRuntimeContext';

/**
 * Der kanonische Kontext einer World-Instanz.
 *
 * Zwei Aussagen tragen diesen Schritt: die World-Metrik ist derselbe Wert, den die heutigen
 * globalen Arena-Variablen fuehren – nur an eine World gebunden statt global – und die
 * world-scoped Ableitungen (Basen, persistente Basisstelle) haengen an der World, nicht an der
 * in der Lobby gewaehlten Map.
 */

const GAME_MODES: readonly GameMode[] = ['coop_defense', 'deathmatch', 'team_deathmatch', 'capture_the_beer'];

function descriptorFor(definitionId: string, overrides: Partial<WorldDescriptor> = {}): WorldDescriptor {
  return {
    worldRevision: 12,
    definitionId,
    seed: 4242,
    generatorVersion: 3,
    layoutFingerprint: 'deadbeef',
    ...overrides,
  };
}

function contextForMap(mapId: string, overrides: Partial<WorldDescriptor> = {}) {
  const mapConfig = getCoopDefenseMapConfig(mapId);
  return createWorldRuntimeContext({
    descriptor: descriptorFor(`world:coop-defense:${mapId}`, {
      // Eine World mit persistenter Basis fuehrt ihren Radius selbst; ohne ihn schlaegt der
      // Aufbau bewusst fehl (siehe eigener Test).
      ...(mapConfig.persistentBase ? { parameters: { persistentBaseRadiusCells: 4 } } : {}),
      ...overrides,
    }),
    metricsProfile: getArenaMetricsProfile(
      'coop_defense',
      'ARENA',
      mapConfig.arenaWidthCells,
      mapConfig.arenaHeightCells,
    ),
    mapConfig,
    humanPlayerCount: 1,
  });
}

describe('WorldMetrics – derselbe Wert, nur an eine World gebunden', () => {
  it('stimmt fuer jeden Modus und jede authored Map mit den globalen Arena-Variablen ueberein', () => {
    const cases: Array<{ mode: GameMode; widthCells?: number; heightCells?: number; label: string }> = [];
    for (const mode of GAME_MODES) {
      if (mode !== 'coop_defense') {
        cases.push({ mode, label: mode });
        continue;
      }
      for (const mapConfig of COOP_DEFENSE_MAP_CONFIGS) {
        cases.push({
          mode,
          widthCells: mapConfig.arenaWidthCells,
          heightCells: mapConfig.arenaHeightCells,
          label: `${mode}/${mapConfig.mapId}`,
        });
      }
    }

    for (const testCase of cases) {
      const profile = getArenaMetricsProfile(testCase.mode, 'ARENA', testCase.widthCells, testCase.heightCells);
      const metrics = resolveWorldMetrics(profile);
      // Der globale Kompatibilitaetsspiegel muss weiterhin denselben Wert ergeben.
      applyArenaMetricsForMode(testCase.mode, 'ARENA', testCase.widthCells, testCase.heightCells);
      expect(metrics, testCase.label).toEqual({
        widthPx: config.ARENA_WIDTH,
        heightPx: config.ARENA_HEIGHT,
        offsetX: config.ARENA_OFFSET_X,
        offsetY: config.ARENA_OFFSET_Y,
        maxX: config.ARENA_MAX_X,
        maxY: config.ARENA_MAX_Y,
        viewportWidth: config.ARENA_VIEWPORT_WIDTH,
        viewportHeight: config.ARENA_VIEWPORT_HEIGHT,
        gridCols: config.GRID_COLS,
        gridRows: config.GRID_ROWS,
        trackSpawnMinCol: config.TRACK_SPAWN_MIN_COL,
        trackSpawnMaxCol: config.TRACK_SPAWN_MAX_COL,
        usesDynamicCamera: profile.usesDynamicCamera,
        showStaticFrames: config.ARENA_STATIC_FRAMES_VISIBLE,
      });
    }
    // Die Lobby-Metrik zurueckstellen, damit kein Test einen fremden Weltzustand erbt.
    applyArenaMetricsForMode('deathmatch', 'LOBBY');
  });

  it('beschreibt zwei Worlds gleichzeitig, was eine globale Metrik nicht kann', () => {
    const small = contextForMap('1');
    const large = contextForMap('18');
    expect(small.metrics).not.toEqual(large.metrics);
    // Beide Werte bleiben gueltig; keiner ueberschreibt den anderen.
    expect(small.metrics.gridCols).toBe(getCoopDefenseMapConfig('1').arenaWidthCells);
    expect(large.metrics.gridCols).toBe(getCoopDefenseMapConfig('18').arenaWidthCells);
  });

  it('rechnet Rasterzellen gegen die eigene World, nicht gegen eine globale Arena', () => {
    const world = contextForMap('18');
    const origin = worldCellOrigin(world.metrics, 2, 3);
    expect(origin).toEqual({
      x: world.metrics.offsetX + 2 * config.CELL_SIZE,
      y: world.metrics.offsetY + 3 * config.CELL_SIZE,
    });
    expect(isCellInsideWorld(world.metrics, 0, 0)).toBe(true);
    expect(isCellInsideWorld(world.metrics, world.metrics.gridCols - 1, world.metrics.gridRows - 1)).toBe(true);
    expect(isCellInsideWorld(world.metrics, world.metrics.gridCols, 0)).toBe(false);
    expect(isCellInsideWorld(world.metrics, -1, 0)).toBe(false);
    expect(isCellInsideWorld(world.metrics, 1.5, 0)).toBe(false);
  });
});

describe('WorldRuntimeContext – world-scoped Ableitungen', () => {
  it('bindet Identitaet, Definition und Basen an dieselbe World', () => {
    const world = contextForMap('18');
    expect(world.descriptor.definitionId).toBe('world:coop-defense:18');
    expect(world.definition?.sourceMapId).toBe('18');
    expect(world.bases.map((base) => base.id)).toEqual(['foundation-main']);
    expect(findWorldBase(world, 'foundation-main')?.id).toBe('foundation-main');
    expect(findWorldBase(world, 'does-not-exist')).toBeNull();
  });

  it('loest die persistente Basisstelle aus den eigenen Basen und dem World-Parameter auf', () => {
    const withParameter = contextForMap('18', { parameters: { persistentBaseRadiusCells: 7 } });
    expect(withParameter.persistentBaseSite).toMatchObject({
      baseId: 'foundation-main',
      radiusCells: 7,
    });
    expect(withParameter.persistentBaseSite?.anchor).toEqual({ gridX: 24, gridY: 19 });
    expect(isValidPersistentBaseSite(withParameter.persistentBaseSite)).toBe(true);

    expect(contextForMap('18').persistentBaseSite?.radiusCells).toBe(4);
    // Eine World ohne authored Stelle hat auch keine.
    expect(contextForMap('1').persistentBaseSite).toBeNull();
    expect(isValidPersistentBaseSite(null)).toBe(false);
  });

  it('erkennt eine Basisstelle, die keine eigene Hauptbasis ist', () => {
    const world = contextForMap('18');
    const site = world.persistentBaseSite!;
    expect(isValidPersistentBaseSite({ ...site, base: { ...site.base, faction: 'hostile' } })).toBe(false);
    expect(isValidPersistentBaseSite({ ...site, base: { ...site.base, role: 'outpost' } })).toBe(false);
  });

  it('beschreibt eine prozedurale Arena ohne authored Definition', () => {
    const world = createWorldRuntimeContext({
      descriptor: descriptorFor(PROCEDURAL_ARENA_WORLD_DEFINITION_ID),
      metricsProfile: getArenaMetricsProfile('deathmatch', 'ARENA'),
      mapConfig: null,
      humanPlayerCount: 1,
    });
    expect(world.definition).toBeNull();
    expect(world.bases).toEqual([]);
    expect(world.persistentBaseSite).toBeNull();
  });
});

describe('WorldRuntimeContext – eine Metrikquelle', () => {
  it('loest Basisgeometrie gegen dieselbe Metrik auf, die der Kontext fuehrt', () => {
    const mapConfig = getCoopDefenseMapConfig('18');
    const world = contextForMap('18');
    // Der Kontext leitet die Metrik einmal ab und reicht sie an die Basisaufloesung weiter.
    // Wuerde die Aufloesung ihre eigene ableiten, koennten beide auseinanderlaufen.
    for (const base of world.bases) {
      for (const cell of base.cells) {
        expect(isCellInsideWorld(world.metrics, cell.gridX, cell.gridY), base.id).toBe(true);
      }
    }
    expect(world.metrics.gridCols).toBe(mapConfig.arenaWidthCells);
    expect(world.metrics.gridRows).toBe(mapConfig.arenaHeightCells);

    const source = readFileSync(resolve(process.cwd(), 'src/world/WorldRuntimeContext.ts'), 'utf8');
    const factoryStart = source.indexOf('export function createWorldRuntimeContext(');
    const factory = source.slice(factoryStart, source.indexOf('\n}', factoryStart));
    expect(factory).toContain('resolveCoopDefenseBases(mapConfig, input.humanPlayerCount, metrics)');
    expect((factory.match(/resolveWorldMetrics\(/g) ?? []).length).toBe(1);
  });
});

describe('WorldRuntimeContext – bekannte World-/Activity-Vermischung', () => {
  it('haelt fest, welche Felder von `bases` noch aktivitaetsabhaengig sind', () => {
    // Im Authoring liegen diese Anteile bereits in `CoopMissionBaseOverlay`. Zur Laufzeit sind
    // sie weiterhin in `BaseSpec` eingebacken; die Trennung gehoert zum Loesen der Activity
    // Runtime aus der World Runtime und nicht in diesen Schritt.
    const source = readFileSync(resolve(process.cwd(), 'src/arena/BaseRegistry.ts'), 'utf8');
    const start = source.indexOf('export interface BaseSpec {');
    const body = source.slice(start, source.indexOf('\n}', start));
    const fields = [...body.matchAll(/^ {2}readonly ([a-zA-Z][a-zA-Z0-9]*)[?]?:/gm)].map((m) => m[1]);

    // World-Anteil: Geometrie und Struktur.
    for (const worldField of ['id', 'cells', 'region', 'hpMax', 'faction', 'role', 'turrets']) {
      expect(fields, `BaseSpec lost world field ${worldField}`).toContain(worldField);
    }
    // Activity-Anteil: entsteht erst durch eine laufende Mission.
    for (const activityField of ['startHp', 'dormant', 'dormantObjectiveId', 'powerUpPedestals']) {
      expect(fields, `BaseSpec lost known activity field ${activityField}`).toContain(activityField);
    }
    // Und `hpMax` traegt die Rundenskalierung nach Spielerzahl.
    const scaled = contextForMap('18', {});
    expect(scaled.bases[0]!.hpMax).toBeGreaterThan(0);
  });
});
describe('WorldRuntimeContext – Aufbau nur aus der eigenen World', () => {
  it('weist eine Map ab, die nicht zu dieser World-Identitaet gehoert', () => {
    // Genau der Fehler, den die Lobby-Kopplung erzeugen wuerde: die World meint Map 18, der
    // Aufbau brachte Map 19 mit.
    expect(() => createWorldRuntimeContext({
      descriptor: descriptorFor('world:coop-defense:18', { parameters: { persistentBaseRadiusCells: 4 } }),
      metricsProfile: getArenaMetricsProfile('coop_defense', 'ARENA'),
      mapConfig: getCoopDefenseMapConfig('19'),
      humanPlayerCount: 1,
    })).toThrow(/cannot be built from/);

    expect(() => createWorldRuntimeContext({
      descriptor: descriptorFor(PROCEDURAL_ARENA_WORLD_DEFINITION_ID),
      metricsProfile: getArenaMetricsProfile('coop_defense', 'ARENA'),
      mapConfig: getCoopDefenseMapConfig('1'),
      humanPlayerCount: 1,
    })).toThrow(/cannot be built from/);
  });

  it('erfindet keinen lokalen Radius, wenn die World keinen replizierten mitbringt', () => {
    // Ein Ersatzwert aus dem lokalen Speicher waere pro Peer verschieden – aus einem
    // Uebertragungsfehler wuerden still zwei verschiedene Welten.
    expect(() => createWorldRuntimeContext({
      descriptor: descriptorFor('world:coop-defense:18'),
      metricsProfile: getArenaMetricsProfile('coop_defense', 'ARENA'),
      mapConfig: getCoopDefenseMapConfig('18'),
      humanPlayerCount: 1,
    })).toThrow(/no replicated radius/);
  });
});

describe('WorldRuntimeContext – Unabhaengigkeit von der Lobby', () => {
  it('behaelt Metrik, Basen und Basisstelle trotz Aenderung des globalen Kompatibilitaetsspiegels', () => {
    const world = contextForMap('18');
    try {
      // Simuliert eine nachtraegliche Lobby-Auswahl mit inkompatibler Groesse. Die bereits
      // erzeugte World behaelt ihre immutable Ableitungen.
      const foreignMap = getCoopDefenseMapConfig('1');
      applyArenaMetricsForMode(
        'coop_defense',
        'ARENA',
        foreignMap.arenaWidthCells,
        foreignMap.arenaHeightCells,
      );

      expect(world.metrics.gridCols).toBe(getCoopDefenseMapConfig('18').arenaWidthCells);
      expect(world.metrics.widthPx).not.toBe(config.ARENA_WIDTH);
      expect(world.bases.map((base) => base.id)).toEqual(['foundation-main']);
      expect(world.persistentBaseSite?.baseId).toBe('foundation-main');
    } finally {
      applyArenaMetricsForMode('deathmatch', 'LOBBY');
    }
  });

  it('verbietet der BaseRegistry einen Lobby- oder Netzwerk-Fallback', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/arena/BaseRegistry.ts'), 'utf8');
    expect(source).not.toContain("../network/bridge");
    expect(source).not.toContain('getCoopDefenseMapId');
    expect(source).not.toContain('getCoopDefenseBases');
  });
});

describe('WorldRuntimeContext – kein neuer God-Context', () => {
  it('nimmt keine Activity-Systeme als Felder auf', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/world/WorldRuntimeContext.ts'), 'utf8');
    const start = source.indexOf('export interface WorldRuntimeContext {');
    expect(start, 'WorldRuntimeContext interface must exist').toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf('\n}', start));
    const fields = [...body.matchAll(/^ {2}readonly ([a-zA-Z][a-zA-Z0-9]*)[?]?:/gm)].map((match) => match[1]);
    expect(fields.sort()).toEqual(['bases', 'definition', 'descriptor', 'metrics', 'persistentBaseSite']);

    // Missionssysteme existieren nicht, weil keine Activity laeuft – nicht, weil hier ein Feld
    // auf null steht.
    const forbidden = [
      'enemy', 'boss', 'objective', 'mission', 'encounter', 'respawn',
      'round', 'activity', 'spawnExecutor', 'director', 'powerUp',
    ];
    for (const field of fields) {
      for (const term of forbidden) {
        expect(field.toLowerCase().includes(term.toLowerCase()), `WorldRuntimeContext.${field} is activity state`)
          .toBe(false);
      }
    }
  });
});
