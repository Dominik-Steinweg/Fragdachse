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
  'src/arena/ArenaGenerator.ts',
  'src/arena/BaseRegistry.ts',
  'src/entities/BaseEntity.ts',
  'src/entities/BaseManager.ts',
  'src/entities/PlayerManager.ts',
  'src/scenes/arena/ArenaLifecycleCoordinator.ts',
  'src/scenes/arena/HostUpdateCoordinator.ts',
  'src/scenes/arena/PersistentBaseVisuals.ts',
  'src/scenes/arena/RockVisualHelper.ts',
  'src/systems/CombatSystem.ts',
  'src/systems/PlacementSystem.ts',
  'src/entities/EnemyManager.ts',
  'src/powerups/PowerUpSystem.ts',
  'src/train/TrainManager.ts',
  'src/systems/CoopDefenseAirstrikeEventHandler.ts',
  'src/systems/CoopDefenseGroundHazardEventHandler.ts',
  'src/systems/CoopDefenseMissionBarrierManager.ts',
  'src/systems/CoopDefenseMissionProgressSystem.ts',
  'src/systems/CoopDefenseVoidHunterSystem.ts',
  'src/systems/ArmageddonSystem.ts',
  'src/systems/DecoySystem.ts',
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
  'TRACK_SPAWN_MIN_COL',
  'TRACK_SPAWN_MAX_COL',
] as const;

/**
 * Config-Funktionen, die die mutablen Arena-Variablen intern lesen.
 *
 * Sie sind die stille Luecke der reinen Variablenpruefung: ein Modul kann laengst
 * `WorldMetrics` fuehren und trotzdem ueber einen solchen Helfer an der global aktiven Arena
 * haengen.
 */
const AMBIENT_ARENA_HELPERS = [
  'isPointInsideArena',
  'clampPointToArena',
  'clipPointToArenaRay',
  'isCaptureTheBeerBaseCell',
  'isCaptureTheBeerBaseModeActive',
  'isCoopDefenseBasesActive',
  'getCaptureTheBeerBaseWorldBounds',
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
      // Und nicht ueber Config-Helfer, die dieselben Variablen intern lesen.
      for (const helper of AMBIENT_ARENA_HELPERS) {
        expect(imported.includes(helper), `${path} still imports ambient helper ${helper}`).toBe(false);
      }
    });
  }

  it('laesst auch den dimensionsgebundenen Spawn-Executor ohne globale Arenaquelle laufen', () => {
    const source = read('src/systems/CoopDefenseSpawnExecutor.ts');
    for (const global of MUTABLE_ARENA_GLOBALS) {
      expect(source).not.toContain(global);
    }
    expect(source).not.toContain('resolveActiveArenaWorldMetrics');
  });

  it('bindet auch nicht-metrische Generatorparameter explizit', () => {
    const source = read('src/arena/ArenaGenerator.ts');
    const imported = collectConfigImports(source);
    for (const ambient of ['TREE_COUNT', 'isCaptureTheBeerBaseModeActive', 'isCoopDefenseBasesActive']) {
      expect(imported.includes(ambient), `ArenaGenerator still imports ${ambient}`).toBe(false);
    }
  });
});

describe('World-scoped Metrik – Basisgeometrie folgt ihrer Map', () => {
  it('bindet aktive Basen und die persistente Basisstelle an den World-Kontext', () => {
    const baseManager = read('src/entities/BaseManager.ts');
    const playerManager = read('src/entities/PlayerManager.ts');
    const persistentVisuals = read('src/scenes/arena/PersistentBaseVisuals.ts');
    const combatSystem = read('src/systems/CombatSystem.ts');
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    const composition = read('src/world/WorldComposition.ts');
    const geometryBinding = read('src/world/WorldGeometryBinding.ts');
    const arenaScene = read('src/scenes/ArenaScene.ts');

    for (const [path, source] of [
      ['src/entities/BaseManager.ts', baseManager],
      ['src/entities/PlayerManager.ts', playerManager],
      ['src/scenes/arena/PersistentBaseVisuals.ts', persistentVisuals],
    ] as const) {
      expect(source.includes('getCoopDefenseBases'), `${path} resolves bases from lobby state`).toBe(false);
      expect(source.includes('resolveCoopDefenseBases'), `${path} re-resolves bases outside its World`).toBe(false);
    }

    expect(composition).toContain('new BaseManager(');
    expect(composition).toContain('const baseManager = bases.length > 0');
    expect(geometryBinding).toContain('playerManager.setWorldGeometry({');
    expect(lifecycle).toContain('this.persistentBase.reconcilePersistentBaseWorld();');
    expect(lifecycle).not.toContain('getPersistentBaseAnchor');
    expect(arenaScene).toContain('const persistentBaseSite = activeWorld?.persistentBaseSite ?? null');
    expect(combatSystem).toContain('this.playerManager.getWorldSpawnPoint(');
    expect(combatSystem).not.toMatch(/ARENA_OFFSET_[XY] \+ spawn\.[xy]/);
  });

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

describe('World-scoped Runtime – kein Lobby-Fallback nach dem Aufbau', () => {
  it('baut World-Systeme ausschliesslich aus Descriptor und WorldRuntimeContext', () => {
    const composition = read('src/world/WorldComposition.ts');
    const geometryBinding = read('src/world/WorldGeometryBinding.ts');
    const buildArena = composition + geometryBinding;

    expect(buildArena).not.toContain('bridge.getGameMode()');
    expect(buildArena).not.toContain('bridge.getCoopDefenseMapId()');
    expect(buildArena).not.toContain('roundState?.coopDefenseMapId');
    expect(buildArena).not.toMatch(/\b(?:GRID_COLS|GRID_ROWS|ARENA_OFFSET_X|ARENA_OFFSET_Y|ARENA_WIDTH|ARENA_HEIGHT)\b/);
    expect(buildArena).toContain('const mapId = toMapId(descriptor.definitionId);');
    expect(buildArena).toContain('worldOriginX: world.metrics.offsetX');
  });

  it('bindet den gemeinsamen Hindernisindex an die Bounds seines Besitzers', () => {
    const index = read('src/systems/ArenaObstacleIndex.ts');
    const combat = read('src/systems/CombatSystem.ts');

    expect(index).not.toMatch(/from ['"][^'"]*config['"]/);
    expect(index).toContain('readonly bounds: () => ArenaObstacleBounds');
    expect(combat).toContain('bounds: () => this.obstacleBounds');
    expect(combat).toContain('setWorldMetrics(metrics: WorldMetrics | null)');
  });

  it('loest den Respawn-Kontext der Arena aus der aktiven World auf', () => {
    const source = read('src/scenes/ArenaScene.ts');
    const start = source.indexOf('playerManager.setSpawnContextProvider');
    const end = source.indexOf('\n    });', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const provider = source.slice(start, end);

    expect(provider).toContain('toMapId(this.ctx.world.descriptor.definitionId)');
    expect(provider).not.toContain('getCoopDefenseMapId');
    expect(provider).not.toContain('getRoundState');
  });

  it('laesst Host-Simulation und RPC-Pruefung den aktiven Modus vor der Lobby lesen', () => {
    const hostUpdate = read('src/scenes/arena/HostUpdateCoordinator.ts');
    const rpc = read('src/scenes/arena/RpcCoordinator.ts');
    const combat = read('src/systems/CombatSystem.ts');
    const rockVisuals = read('src/scenes/arena/RockVisualHelper.ts');

    expect(hostUpdate).not.toContain('getCoopDefenseMapId');
    expect(hostUpdate).not.toContain('coopDefenseMapId');
    for (const [path, source] of [
      ['src/scenes/arena/HostUpdateCoordinator.ts', hostUpdate],
      ['src/scenes/arena/RpcCoordinator.ts', rpc],
      ['src/systems/CombatSystem.ts', combat],
      ['src/scenes/arena/RockVisualHelper.ts', rockVisuals],
    ] as const) {
      expect(source, `${path} must use the active Activity before the lobby fallback`).toContain('getActiveGameMode()');
    }
  });
});
