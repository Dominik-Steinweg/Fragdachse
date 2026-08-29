import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as config from '../src/config';
import { applyArenaMetricsForMode, getArenaMetricsProfile } from '../src/config';
import { COOP_DEFENSE_MAP_CONFIGS, getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import type { GameMode } from '../src/types';
import { toWorldDefinition } from '../src/config/authoring/coopDefenseAuthoringAdapter';
import { PROCEDURAL_ARENA_WORLD_DEFINITION_ID, type WorldDescriptor } from '../src/world/WorldDescriptor';
import { isCellInsideWorld, resolveWorldMetrics, worldCellOrigin } from '../src/world/WorldMetrics';
import {
  createWorldRuntimeContext,
  findWorldBase,
  isValidPersistentBaseSite,
} from '../src/world/WorldRuntimeContext';
import { resolveCoopDefenseActivityBases } from '../src/arena/BaseRegistry';

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
      // Eine World mit persistenter Basis fuehrt Freischaltung und Area-Stufe selbst: ohne die
      // Freischaltung traegt die Instanz den Kern gar nicht, ohne die Area-Stufe schlaegt der Aufbau
      // bewusst fehl (siehe eigene Tests).
      ...(mapConfig.persistentBase
        ? { parameters: { persistentBaseUnlocked: true, persistentBaseAreaStage: 0 } }
        : {}),
      ...overrides,
    }),
    metricsProfile: getArenaMetricsProfile(
      'coop_defense',
      'ARENA',
      mapConfig.arenaWidthCells,
      mapConfig.arenaHeightCells,
    ),
    definition: toWorldDefinition(mapConfig),
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
    const large = contextForMap('17');
    expect(small.metrics).not.toEqual(large.metrics);
    // Beide Werte bleiben gueltig; keiner ueberschreibt den anderen.
    expect(small.metrics.gridCols).toBe(getCoopDefenseMapConfig('1').arenaWidthCells);
    expect(large.metrics.gridCols).toBe(getCoopDefenseMapConfig('17').arenaWidthCells);
  });

  it('rechnet Rasterzellen gegen die eigene World, nicht gegen eine globale Arena', () => {
    const world = contextForMap('17');
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
    const world = contextForMap('17');
    expect(world.descriptor.definitionId).toBe('world:coop-defense:17');
    expect(world.definition?.sourceMapId).toBe('17');
    expect(world.bases.map((base) => base.id)).toContain('coop-base-rear');
    expect(findWorldBase(world, 'coop-base-rear')?.id).toBe('coop-base-rear');
    expect(findWorldBase(world, 'does-not-exist')).toBeNull();
  });

  it('traegt die Persistent Base auf allen produktiven Campaign Maps und nicht auf Map 9', () => {
    for (const mapId of [
      '2', '3', '4', '5', '6', '7', '8',
      '10', '11', '12', '13', '14', '15', '16', '17',
    ]) {
      const mapConfig = getCoopDefenseMapConfig(mapId);
      const world = contextForMap(mapId);
      expect(world.persistentBaseSite, mapId).toMatchObject({
        baseId: mapConfig.persistentBase!.baseId,
        anchor: mapConfig.persistentBase!.anchor,
      });
      expect(findWorldBase(world, mapConfig.persistentBase!.baseId), mapId).toMatchObject({
        faction: 'friendly',
        role: 'main',
      });
    }

    const map9 = contextForMap('9');
    expect(map9.persistentBaseSite).toBeNull();
    expect(map9.bases).toEqual([]);
  });

  it('loest die persistente Basisstelle aus den eigenen Basen und dem World-Parameter auf', () => {
    const withParameter = contextForMap('17', {
      parameters: { persistentBaseUnlocked: true, persistentBaseAreaStage: 1 },
    });
    expect(withParameter.persistentBaseSite).toMatchObject({
      baseId: 'coop-base-rear',
      areaStage: 1,
      buildArea: { kind: 'radius', radiusCells: 5 },
    });
    // Der Anker ist die Mittelzelle der kanonischen 5x5-Grundflaeche, also exakt der authored
    // Wert der Map – nicht die Mitte einer je Map beschriebenen Form.
    expect(withParameter.persistentBaseSite?.anchor)
      .toEqual(getCoopDefenseMapConfig('17').persistentBase?.anchor);
    expect(isValidPersistentBaseSite(withParameter.persistentBaseSite)).toBe(true);

    expect(contextForMap('17').persistentBaseSite?.areaStage).toBe(0);
    expect(contextForMap('17').persistentBaseSite?.buildArea).toEqual({ kind: 'square', sizeCells: 3 });
    // Eine World ohne authored Stelle hat auch keine.
    expect(contextForMap('1').persistentBaseSite).toBeNull();
    expect(isValidPersistentBaseSite(null)).toBe(false);
  });

  it('leitet die spaetere radiusbasierte Baubereich-Regel aus Stage 1 ab', () => {
    const mapConfig = getCoopDefenseMapConfig('17');
    const definition = toWorldDefinition({
      ...mapConfig,
      persistentBase: {
        ...mapConfig.persistentBase!,
        buildArea: { kind: 'radius', radiusCells: 2 },
      },
    });
    const world = createWorldRuntimeContext({
      descriptor: descriptorFor(definition.id, {
        parameters: { persistentBaseUnlocked: true, persistentBaseAreaStage: 1 },
      }),
      metricsProfile: getArenaMetricsProfile(
        'coop_defense',
        'ARENA',
        mapConfig.arenaWidthCells,
        mapConfig.arenaHeightCells,
      ),
      definition,
    });

    expect(world.persistentBaseSite?.buildArea).toEqual({ kind: 'radius', radiusCells: 5 });
  });

  it('traegt den Basiskern nur, wenn die World-Instanz ihn freigeschaltet mitbringt', () => {
    // Die authored Definition kennt die Stelle in beiden Faellen; ueber ihr Dasein entscheidet
    // allein der replizierte Parameter. Ein gesperrter Kern existiert gar nicht: keine
    // Basisstelle, keine Kollisionszellen, keine Reservierung.
    const locked = contextForMap('17', { parameters: { persistentBaseAreaStage: 0 } });
    expect(locked.definition?.persistentBaseSite?.baseId).toBe('coop-base-rear');
    expect(locked.persistentBaseSite).toBeNull();
    expect(locked.bases.some((base) => base.id === 'coop-base-rear')).toBe(false);

    const unlocked = contextForMap('17');
    expect(unlocked.bases.map((base) => base.id)).toContain('coop-base-rear');
    expect(unlocked.bases.find((base) => base.id === 'coop-base-rear')?.persistentReservationRadiusCells)
      .toBeGreaterThan(0);
  });

  it('erkennt eine Basisstelle, die keine eigene Hauptbasis ist', () => {
    const world = contextForMap('17');
    const site = world.persistentBaseSite!;
    expect(isValidPersistentBaseSite({ ...site, base: { ...site.base, faction: 'hostile' } })).toBe(false);
    expect(isValidPersistentBaseSite({ ...site, base: { ...site.base, role: 'outpost' } })).toBe(false);
  });

  it('beschreibt eine prozedurale Arena ohne authored Definition', () => {
    const world = createWorldRuntimeContext({
      descriptor: descriptorFor(PROCEDURAL_ARENA_WORLD_DEFINITION_ID),
      metricsProfile: getArenaMetricsProfile('deathmatch', 'ARENA'),
      definition: null,
    });
    expect(world.definition).toBeNull();
    expect(world.bases).toEqual([]);
    expect(world.persistentBaseSite).toBeNull();
  });
});

describe('WorldRuntimeContext – eine Metrikquelle', () => {
  it('loest Basisgeometrie gegen dieselbe Metrik auf, die der Kontext fuehrt', () => {
    const mapConfig = getCoopDefenseMapConfig('17');
    const world = contextForMap('17');
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
    // Die Basen loesen gegen genau die Metrik auf, die dieser Kontext fuehrt; weitere Argumente
    // duerfen dazukommen, eine zweite Metrikquelle nicht.
    expect(factory).toContain('resolveWorldBases(definition, metrics,');
    expect(source).not.toContain('humanPlayerCount');
    expect((factory.match(/resolveWorldMetrics\(/g) ?? []).length).toBe(1);
  });
});

describe('WorldRuntimeContext – World-Basen und Activity-Overlays', () => {
  it('haelt Activity-Zustaende aus der World-Aufloesung heraus', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/arena/BaseRegistry.ts'), 'utf8');
    expect(source).toContain('export function resolveWorldBases(');
    expect(source).toContain('export function resolveCoopDefenseActivityBases(');

    const world = contextForMap('17');
    expect(world.bases[0]).not.toHaveProperty('startHp');
    expect(world.bases[0]).not.toHaveProperty('dormant');
    expect(world.bases[0]).not.toHaveProperty('dormantObjectiveId');
    expect(world.bases[0]?.powerUpPedestals).toEqual([]);
    expect(resolveCoopDefenseActivityBases(getCoopDefenseMapConfig('17'), 4)[0]?.hpMax)
      .toBe(world.bases[0]?.hpMax);
  });
});
describe('WorldRuntimeContext – Aufbau nur aus der eigenen World', () => {
  it('weist eine Map ab, die nicht zu dieser World-Identitaet gehoert', () => {
    // Genau der Fehler, den die Lobby-Kopplung erzeugen wuerde: die World meint Map 17, der
    // Aufbau brachte Map 16 mit.
    expect(() => createWorldRuntimeContext({
      descriptor: descriptorFor('world:coop-defense:17', {
        parameters: { persistentBaseUnlocked: true, persistentBaseAreaStage: 0 },
      }),
      metricsProfile: getArenaMetricsProfile('coop_defense', 'ARENA'),
      definition: toWorldDefinition(getCoopDefenseMapConfig('16')),
    })).toThrow(/cannot be built from/);

    expect(() => createWorldRuntimeContext({
      descriptor: descriptorFor(PROCEDURAL_ARENA_WORLD_DEFINITION_ID),
      metricsProfile: getArenaMetricsProfile('coop_defense', 'ARENA'),
      definition: toWorldDefinition(getCoopDefenseMapConfig('1')),
    })).toThrow(/cannot be built from/);
  });

  it('erfindet keine lokale Area-Stufe, wenn die World keine replizierte mitbringt', () => {
    // Ein Ersatzwert aus dem lokalen Speicher waere pro Peer verschieden – aus einem
    // Uebertragungsfehler wuerden still zwei verschiedene Welten.
    expect(() => createWorldRuntimeContext({
      descriptor: descriptorFor('world:coop-defense:17', {
        parameters: { persistentBaseUnlocked: true },
      }),
      metricsProfile: getArenaMetricsProfile('coop_defense', 'ARENA'),
      definition: toWorldDefinition(getCoopDefenseMapConfig('17')),
    })).toThrow(/no replicated area stage/);
  });
});

describe('WorldRuntimeContext – Unabhaengigkeit von der Lobby', () => {
  it('behaelt Metrik, Basen und Basisstelle trotz Aenderung des globalen Kompatibilitaetsspiegels', () => {
    const world = contextForMap('17');
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

      expect(world.metrics.gridCols).toBe(getCoopDefenseMapConfig('17').arenaWidthCells);
      expect(world.metrics.widthPx).not.toBe(config.ARENA_WIDTH);
      expect(world.bases.map((base) => base.id)).toContain('coop-base-rear');
      expect(world.persistentBaseSite?.baseId).toBe('coop-base-rear');
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
