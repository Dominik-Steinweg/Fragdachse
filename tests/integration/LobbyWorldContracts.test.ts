import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOBBY_SPAWN_FOCUS_CELL,
  LOBBY_WORLD_HEIGHT_CELLS,
  LOBBY_WORLD_WIDTH_CELLS,
  buildLobbyWorldLayout,
  isLobbyBaseReservedCell,
} from '../../src/arena/LobbyWorldLayout';
import { LOBBY_MERCHANT, LOBBY_MERCHANT_BASE } from '../../src/config/authoring/lobbyMerchant';
import { resolvePersistentBaseReservationRadiusCells, resolvePersistentBaseBuildAreaForStage,
  type PersistentBaseAreaStage } from '../../src/persistentBase/PersistentBaseCore';
import { RockHpRegistry } from '../../src/arena/RockHpRegistry';
import { SHOOTING_RANGE, insideRangeRect } from '../../src/shootingRange/ShootingRangeLayout';
import { getWorldDefinition } from '../../src/config/authoring/authoredScenarios';
import {
  LOBBY_PERSISTENT_BASE_ID,
  LOBBY_WORLD_DEFINITION_ID,
  getLobbyWorldDefinition,
  isLobbyWorldDefinitionId,
} from '../../src/config/authoring/lobbyWorld';
import { getPersistentBaseCoreSurfaceOffsets } from '../../src/persistentBase/PersistentBaseCore';
import { isValidPersistentBaseSite } from '../../src/world/WorldRuntimeContext';
import { CANOPY_RADIUS, CELL_SIZE, ROCK_HP_MAX } from '../../src/config';
import { CANOPY_ASSETS } from '../../src/arena/trees/CanopyAssets';
import type { GameMode } from '../../src/types';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { resolveInputPolicy } from '../../src/world/InputPolicy';
import { resolvePlayerCapabilities } from '../../src/world/PlayerCapabilities';
import { resolvePlayerRuntimeFeatures } from '../../src/world/PlayerWorldRuntime';
import { resolvePresentationPolicy } from '../../src/world/PresentationPolicy';
import { createAuthoredWorldDescriptor, generateWorldLayout } from '../../src/world/WorldLayout';
import { createWorldRuntimeContext } from '../../src/world/WorldRuntimeContext';
import { getAuthoredWorldMetricsProfile } from '../../src/config';
import { hasWorldRuntimeEntry, maySendWorldInput } from '../../src/world/WorldParticipation';
import { resolveWorldPresentation } from '../../src/world/WorldPresentation';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from '../fakePeerNetwork';

/**
 * L1: die Lobby ist eine echte World.
 *
 * Der Pflichtzustand, den diese Datei absichert:
 *
 *   Room: Lobby | World: LobbyWorld | Activity: null
 *   Participation: none | Presentation: preview
 *
 * Daraus darf ausdruecklich **nichts** entstehen, was eine Runde voraussetzt: keine
 * PlayerRuntime, kein World-Input, kein RoundState. Trotzdem ist die World zu sehen.
 */

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function lobbyWorldContextFor(mode: GameMode, persistentBaseUnlocked: boolean, areaStage: PersistentBaseAreaStage = 0) {
  const ownsPersistentBase = mode === 'coop_defense' && persistentBaseUnlocked;
  const definition = getLobbyWorldDefinition();
  return createWorldRuntimeContext({
    descriptor: createAuthoredWorldDescriptor(
      LOBBY_WORLD_DEFINITION_ID,
      ownsPersistentBase ? 9 : 10,
      ownsPersistentBase
        ? { persistentBaseUnlocked: true, persistentBaseHealthRewards: [], persistentBaseAreaStage: areaStage }
        : undefined,
    ),
    metricsProfile: getAuthoredWorldMetricsProfile(
      definition.metrics.widthCells,
      definition.metrics.heightCells,
    ),
    definition,
  });
}

describe('LobbyWorld – Authoring', () => {
  it('ist eine regulaere WorldDefinition ohne Activity und ohne Fake-Mission', () => {
    const world = getLobbyWorldDefinition();
    expect(world.id).toBe(LOBBY_WORLD_DEFINITION_ID);
    expect(isLobbyWorldDefinitionId(world.id)).toBe(true);
    // Sie loest ueber dieselbe Registry auf wie jede adaptierte Coop-World.
    expect(getWorldDefinition(LOBBY_WORLD_DEFINITION_ID)).toBe(world);

    // Keine Coop-Map-Vorlage und keine Gleise: reine World-Geometrie.
    expect(world.sourceMapId).toBeUndefined();
    expect(world.tracks).toBeUndefined();

    // Der persistente Basiskern bleibt kanonisch; der Stand ist eine zweite World-Struktur.
    // Die Definition beschreibt den Kern nicht
    // selbst, sondern nur seine Stelle - die Form kommt aus der kanonischen Kerngeometrie.
    expect(world.persistentBaseSite?.baseId).toBe(LOBBY_PERSISTENT_BASE_ID);
    expect(world.bases.map((base) => base.id)).toEqual([LOBBY_PERSISTENT_BASE_ID, LOBBY_MERCHANT_BASE.id]);
    const core = world.bases[0];
    expect(core?.faction).toBe('friendly');
    expect(core?.role).toBe('main');
    expect(core?.shape).toEqual({
      kind: 'cells',
      cells: getPersistentBaseCoreSurfaceOffsets(),
    });
    // Der Anker der Stelle ist die Mittelzelle; der Shape-Ursprung liegt drei Zellen davor.
    expect(core?.anchor).toEqual({
      kind: 'grid',
      gridX: world.persistentBaseSite!.anchor.gridX - 3,
      gridY: world.persistentBaseSite!.anchor.gridY - 3,
    });

    // Kampf ist eine ausdrueckliche World-Policy, keine Nebenwirkung einer laufenden Activity.
    expect(world.actionPolicy?.combat).toBe(true);
    // Sie ist der erste Fall, der ohne Teilnahme sichtbar sein darf ...
    expect(world.presentationPolicy?.previewWithoutParticipation).toBe(true);
    // ... und der erste, den Raum-Mitglieder von sich aus betreten duerfen: es gibt keine
    // Activity, die ihre Besetzung taktet.
    expect(world.participationPolicy?.selfAdmit).toBe(true);
  });

  it('traegt ihr Mass selbst und passt zur vollen Lobbyflaeche', () => {
    const world = getLobbyWorldDefinition();
    expect(world.metrics).toEqual({
      widthCells: LOBBY_WORLD_WIDTH_CELLS,
      heightCells: LOBBY_WORLD_HEIGHT_CELLS,
    });

    const metricsProfile = getAuthoredWorldMetricsProfile(
      world.metrics.widthCells,
      world.metrics.heightCells,
    );
    expect(metricsProfile.arenaOffsetX).toBe(0);
    expect(metricsProfile.arenaWidth).toBe(LOBBY_WORLD_WIDTH_CELLS * 32);
    // Passive preview fits the whole World; participation follows the player vertically.
    expect(metricsProfile.usesDynamicCamera).toBe(true);
  });
});

describe('LobbyWorld – authored Geometrie', () => {
  const layout = buildLobbyWorldLayout();

  it('reserves the complete maximum Dawn site inside the authored World', () => {
    const site = getLobbyWorldDefinition().persistentBaseSite!;
    expect(site.maxAreaStage).toBe(11);
    expect(resolvePersistentBaseBuildAreaForStage(site.maxAreaStage!)).toEqual({ kind: 'radius', radiusCells: 15 });
    const radius = resolvePersistentBaseReservationRadiusCells(site.maxAreaStage);
    expect(radius).toBe(17);
    expect(site.anchor.gridX - radius).toBeGreaterThanOrEqual(0);
    expect(site.anchor.gridY - radius).toBeGreaterThanOrEqual(0);
    expect(site.anchor.gridX + radius).toBeLessThan(LOBBY_WORLD_WIDTH_CELLS);
    expect(site.anchor.gridY + radius).toBeLessThan(LOBBY_WORLD_HEIGHT_CELLS);
    const obstacles = [...layout.rocks, ...layout.trees, ...(layout.water ?? [])];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const x = site.anchor.gridX + dx, y = site.anchor.gridY + dy;
      expect(isLobbyBaseReservedCell(x, y)).toBe(true);
      expect(obstacles.some(cell => cell.gridX === x && cell.gridY === y), `${x}:${y}`).toBe(false);
    }
  });

  it('haelt die Standkollision ausserhalb der Basisreservierung und den dekorativen Haendler erreichbar', () => {
    const definition = getLobbyWorldDefinition();
    const site = definition.persistentBaseSite!;
    const radius = resolvePersistentBaseReservationRadiusCells(site.maxAreaStage);
    const world = lobbyWorldContextFor('coop_defense', false);
    const stall = world.bases.find(base => base.id === LOBBY_MERCHANT_BASE.id)!;
    expect(stall.surface).toBe('none');
    expect(stall.cells).toHaveLength(LOBBY_MERCHANT.stall.sizeCells ** 2);
    const occupied = [...layout.rocks, ...layout.trees, ...layout.dirt, ...(layout.water ?? []), ...(layout.decals ?? [])];
    for (const cell of stall.cells) {
      expect(Math.max(Math.abs(cell.gridX - site.anchor.gridX), Math.abs(cell.gridY - site.anchor.gridY))).toBeGreaterThan(radius);
      expect(isLobbyBaseReservedCell(cell.gridX, cell.gridY)).toBe(false);
      expect(insideRangeRect(cell.gridX, cell.gridY, SHOOTING_RANGE.clearArea)).toBe(false);
      expect(occupied.some(other => other.gridX === cell.gridX && other.gridY === cell.gridY), JSON.stringify(cell)).toBe(false);
      expect(cell.gridX).toBeGreaterThanOrEqual(0);
      expect(cell.gridX).toBeLessThan(LOBBY_WORLD_WIDTH_CELLS);
      expect(cell.gridY).toBeLessThan(LOBBY_WORLD_HEIGHT_CELLS);
    }
    // The dealer has no collision body and stays beyond the maximum reservation.
    // Ground decals may remain underneath it; obstacles and the stall must stay clear.
    const dealer = LOBBY_MERCHANT.dealer;
    const halfSizeCells = dealer.displaySize / CELL_SIZE / 2;
    expect(dealer.gridX - halfSizeCells - site.anchor.gridX).toBeGreaterThan(radius);
    expect(dealer.gridX).toBeLessThan(LOBBY_MERCHANT.stall.gridX);
    expect(dealer.gridY).toBeLessThan(LOBBY_MERCHANT.stall.gridY);
    expect(Math.hypot(dealer.gridX - site.anchor.gridX, dealer.gridY - site.anchor.gridY))
      .toBeLessThan(LOBBY_MERCHANT.nameplate.fullVisibilityCells);
    // Even a fully opaque crown must not cover the dealer when the player walks away.
    const canopyReach = CANOPY_RADIUS * Math.max(...CANOPY_ASSETS.map(asset => asset.displayScale));
    for (const tree of layout.trees) {
      expect(Math.hypot(tree.gridX - dealer.gridX, tree.gridY - dealer.gridY) * CELL_SIZE)
        .toBeGreaterThan(canopyReach + dealer.displaySize * Math.SQRT1_2);
    }
    for (let y = Math.floor(dealer.gridY + .5 - halfSizeCells); y <= Math.floor(dealer.gridY + .5 + halfSizeCells); y++) {
      for (let x = Math.floor(dealer.gridX + .5 - halfSizeCells); x <= Math.floor(dealer.gridX + .5 + halfSizeCells); x++) {
        expect([...layout.rocks, ...layout.trees, ...(layout.water ?? []), ...stall.cells]
          .some(cell => cell.gridX === x && cell.gridY === y)).toBe(false);
      }
    }
    // A walking route from spawn to the front of the stall remains open.
    const bases = lobbyWorldContextFor('coop_defense', true, 11).bases.flatMap(base => base.cells);
    const blocked = new Set([...layout.rocks, ...layout.trees, ...(layout.water ?? []), ...bases].map(cell => `${cell.gridX}:${cell.gridY}`));
    expect(blocked.has(`${LOBBY_SPAWN_FOCUS_CELL.gridX}:${LOBBY_SPAWN_FOCUS_CELL.gridY}`)).toBe(false);
    const queue: Array<{ gridX: number; gridY: number }> = [LOBBY_SPAWN_FOCUS_CELL];
    const visited = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { gridX: cell.gridX + dx, gridY: cell.gridY + dy };
        const key = `${next.gridX}:${next.gridY}`;
        if (next.gridX < 0 || next.gridY < 0 || next.gridX >= LOBBY_WORLD_WIDTH_CELLS || next.gridY >= LOBBY_WORLD_HEIGHT_CELLS || blocked.has(key) || visited.has(key)) continue;
        visited.add(key); queue.push(next);
      }
    }
    expect(visited.has(`${Math.round(dealer.gridX)}:${Math.round(dealer.gridY)}`)).toBe(true);
    for (const [x, y] of Object.values(SHOOTING_RANGE.controls)) expect(visited.has(`${x}:${y}`)).toBe(true);
    for (const rect of SHOOTING_RANGE.access) {
      for (let y = rect.minY; y <= rect.maxY; y++) for (let x = rect.minX; x <= rect.maxX; x++) {
        expect(visited.has(`${x}:${y}`), `range access ${x}:${y}`).toBe(true);
      }
    }
  });

  it('materialisiert dieselben Standzellen fuer alle Peers und ohne Freischaltung', () => {
    const cells = lobbyWorldContextFor('coop_defense', true).bases.find(base => base.id === LOBBY_MERCHANT_BASE.id)!.cells;
    for (const mode of ['coop_defense', 'deathmatch', 'team_deathmatch', 'capture_the_beer'] as const) {
      for (const unlocked of [false, true]) {
        expect(lobbyWorldContextFor(mode, unlocked).bases.find(base => base.id === LOBBY_MERCHANT_BASE.id)?.cells).toEqual(cells);
      }
    }
  });

  it('haelt den FRAGDACHSE-Schriftzug als ganz normalen, zerstoerbaren Fels', () => {
    // Der Schriftzug steht am oberen Rand der authored World.
    const titleRocks = layout.rocks.filter((rock) => rock.gridY >= 1 && rock.gridY <= 5);
    expect(titleRocks.length).toBeGreaterThan(100);
    for (const rock of titleRocks) {
      expect(rock.indestructible, `Titelfels ${rock.gridX}:${rock.gridY}`).toBeUndefined();
    }
  });

  it('enthaelt keine unzerstoerbaren UI-Rahmen mehr', () => {
    expect(layout.rocks.every(rock => !rock.indestructible)).toBe(true);
  });

  it('haelt den Schiessstand frei und belebt die verbleibende Landschaft ohne UI-Spawn-Sperren', () => {
    for (const cell of [...layout.rocks, ...layout.trees]) {
      expect(insideRangeRect(cell.gridX, cell.gridY, SHOOTING_RANGE.clearArea)).toBe(false);
    }
    const boardCells = [];
    for (let y = SHOOTING_RANGE.board.minY; y <= SHOOTING_RANGE.board.maxY; y++) {
      for (let x = SHOOTING_RANGE.board.minX; x <= SHOOTING_RANGE.board.maxX; x++) boardCells.push([x, y]);
    }
    for (const [x, y] of [...SHOOTING_RANGE.targets, ...Object.values(SHOOTING_RANGE.controls), ...boardCells]) {
      expect(layout.water?.some(cell => cell.gridX === x && cell.gridY === y)).toBe(false);
      expect(isLobbyBaseReservedCell(x, y)).toBe(false);
    }
    for (const side of [(x: number) => x >= 50]) {
      expect(layout.rocks.some(cell => side(cell.gridX) && cell.gridY > 9)).toBe(true);
      expect(layout.decals?.some(cell => side(cell.gridX) && cell.gridY > 9)).toBe(true);
    }
    expect(getLobbyWorldDefinition().spawnExclusionZones ?? []).toEqual([]);
  });

  it('traegt zwei zusammenhaengende Seen ausserhalb der Basis ohne ueberlagerte Landobjekte', () => {
    const water = layout.water ?? [];
    const key = (cell: { gridX: number; gridY: number }) => `${cell.gridX}:${cell.gridY}`;
    const remaining = new Set(water.map(key));
    const lakes: typeof water[] = [];
    while (remaining.size > 0) {
      const first = water.find(cell => remaining.has(key(cell)))!;
      const lake = [first];
      remaining.delete(key(first));
      for (let i = 0; i < lake.length; i++) {
        const cell = lake[i];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const next = { gridX: cell.gridX + dx, gridY: cell.gridY + dy };
          if (remaining.delete(key(next))) lake.push(next);
        }
      }
      lakes.push(lake);
    }
    expect(lakes).toHaveLength(2);
    const [left, right] = lakes.sort((a, b) => a[0].gridX - b[0].gridX);
    expect(left.some(cell => cell.gridX === 0 && cell.gridY === LOBBY_WORLD_HEIGHT_CELLS - 1)).toBe(true);
    expect(right.length).toBeGreaterThan(left.length);
    for (const cell of water) expect(isLobbyBaseReservedCell(cell.gridX, cell.gridY)).toBe(false);
    const waterKeys = new Set(water.map(key));
    for (const cell of [...layout.rocks, ...layout.trees, ...layout.dirt, ...(layout.decals ?? [])]) {
      expect(waterKeys.has(key(cell)), `Landobjekt im Wasser: ${key(cell)}`).toBe(false);
    }
  });

  it('haelt die Basisflaeche frei von Hindernissen, aber erlaubt Bodendetails', () => {
    for (const rock of layout.rocks) {
      expect(isLobbyBaseReservedCell(rock.gridX, rock.gridY), `Fels ${rock.gridX}:${rock.gridY}`).toBe(false);
    }
    for (const tree of layout.trees) {
      expect(isLobbyBaseReservedCell(tree.gridX, tree.gridY), `Baum ${tree.gridX}:${tree.gridY}`).toBe(false);
    }
    expect(layout.decals?.some(cell =>
      cell.surface === 'ground' && isLobbyBaseReservedCell(cell.gridX, cell.gridY),
    )).toBe(true);
  });

  it('liegt vollstaendig innerhalb ihrer eigenen Metrik und traegt keine Gleise', () => {
    expect(layout.tracks).toEqual([]);
    expect(layout.powerUpPedestals).toEqual([]);
    for (const cell of [...layout.rocks, ...layout.trees, ...layout.dirt, ...(layout.water ?? [])]) {
      expect(cell.gridX).toBeGreaterThanOrEqual(0);
      expect(cell.gridY).toBeGreaterThanOrEqual(0);
      expect(cell.gridX).toBeLessThan(LOBBY_WORLD_WIDTH_CELLS);
      expect(cell.gridY).toBeLessThan(LOBBY_WORLD_HEIGHT_CELLS);
    }
  });

  it('gibt jeder World-Instanz ihr eigenes Layout', () => {
    const first = buildLobbyWorldLayout();
    const second = buildLobbyWorldLayout();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.rocks).not.toBe(first.rocks);
    expect(second.water).not.toBe(first.water);
    expect(second.water?.[0]).not.toBe(first.water?.[0]);
    // Die Runtime haengt platzierte Konstrukte als zusaetzliche Felszellen an; das darf die
    // naechste LobbyWorld nicht erben.
    first.rocks.push({ gridX: 0, gridY: 0 });
    expect(buildLobbyWorldLayout().rocks.length).toBe(second.rocks.length);
  });
});

describe('LobbyWorld – World-Aufbau ueber die kanonischen Mechanismen', () => {
  it.each([2, 6, 11] as const)('resolves stage %i and its layout identically for host and late peers', (stage) => {
    const host = lobbyWorldContextFor('coop_defense', true, stage);
    const peer = lobbyWorldContextFor('coop_defense', true, stage);
    expect(peer).toEqual(host);
    expect(host.persistentBaseSite).toMatchObject({ areaStage: stage, buildArea: resolvePersistentBaseBuildAreaForStage(stage) });
    const input = (world: typeof host) => ({ ...world.descriptor, generation: {
      metrics: world.metrics, treeCount: 0, captureTheBeerBasesActive: false, coopDefenseBasesActive: true,
    } });
    expect(generateWorldLayout(input(peer))).toEqual(generateWorldLayout(input(host)));
    expect(generateWorldLayout(input(host))).toEqual(buildLobbyWorldLayout());
  });
  it('kommt aus der World-Layout-Quelle statt aus dem prozeduralen Generator', () => {
    const world = getLobbyWorldDefinition();
    const metrics = getAuthoredWorldMetricsProfile(world.metrics.widthCells, world.metrics.heightCells);
    const layout = generateWorldLayout({
      definitionId: LOBBY_WORLD_DEFINITION_ID,
      seed: 1,
      generation: {
        metrics: {
          widthPx: metrics.arenaWidth,
          heightPx: metrics.arenaHeight,
          offsetX: metrics.arenaOffsetX,
          offsetY: metrics.arenaOffsetY,
          maxX: metrics.arenaOffsetX + metrics.arenaWidth,
          maxY: metrics.arenaOffsetY + metrics.arenaHeight,
          viewportWidth: metrics.arenaViewportWidth,
          viewportHeight: metrics.arenaViewportHeight,
          gridCols: world.metrics.widthCells,
          gridRows: world.metrics.heightCells,
          trackSpawnMinCol: 0,
          trackSpawnMaxCol: 0,
          usesDynamicCamera: false,
          showStaticFrames: false,
        },
        treeCount: 0,
        captureTheBeerBasesActive: false,
        coopDefenseBasesActive: false,
      },
    });
    // Der uebergebene Seed spielt keine Rolle: authored Geometrie wuerfelt nichts.
    expect(layout).toEqual(buildLobbyWorldLayout());
  });

  it('unterscheidet zwei Instanzen ausschliesslich in ihrer Revision', () => {
    const first = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 10);
    const second = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 11);
    expect(second).toEqual({ ...first, worldRevision: 11 });
    expect(first.definitionId).toBe(LOBBY_WORLD_DEFINITION_ID);
    expect(first.layoutFingerprint.length).toBeGreaterThan(0);
  });

  it('baut einen regulaeren WorldRuntimeContext ohne Basen und ohne persistente Basis', () => {
    // Ohne Freischaltung: Die Definition kennt die Stelle, diese Instanz besitzt sie nicht.
    const definition = getLobbyWorldDefinition();
    const world = createWorldRuntimeContext({
      descriptor: createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 7),
      metricsProfile: getAuthoredWorldMetricsProfile(
        definition.metrics.widthCells,
        definition.metrics.heightCells,
      ),
      definition,
    });
    expect(world.definition).toBe(definition);
    expect(world.bases.map(base => base.id)).toEqual([LOBBY_MERCHANT_BASE.id]);
    expect(world.persistentBaseSite).toBeNull();
    expect(world.metrics.gridCols).toBe(LOBBY_WORLD_WIDTH_CELLS);
    expect(world.metrics.gridRows).toBe(LOBBY_WORLD_HEIGHT_CELLS);
  });

  it('materialisiert den Basiskern erst mit der freigeschalteten Instanz', () => {
    const definition = getLobbyWorldDefinition();
    const world = createWorldRuntimeContext({
      descriptor: createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 8, {
        persistentBaseUnlocked: true, persistentBaseHealthRewards: [],
        persistentBaseAreaStage: 0,
      }),
      metricsProfile: getAuthoredWorldMetricsProfile(
        definition.metrics.widthCells,
        definition.metrics.heightCells,
      ),
      definition,
    });

    expect(world.bases.map((base) => base.id)).toEqual([LOBBY_PERSISTENT_BASE_ID, LOBBY_MERCHANT_BASE.id]);
    expect(world.persistentBaseSite).toMatchObject({
      baseId: LOBBY_PERSISTENT_BASE_ID,
      areaStage: 0,
      buildArea: { kind: 'square', sizeCells: 7 },
    });
    // Der Anker ist die authored Mitte der World und damit zugleich ihr Spawn-Fokus: Wer das
    // Testgelaende betritt, steht im eigenen Hof.
    expect(world.persistentBaseSite?.anchor).toEqual({
      gridX: LOBBY_SPAWN_FOCUS_CELL.gridX,
      gridY: LOBBY_SPAWN_FOCUS_CELL.gridY,
    });
    expect(isValidPersistentBaseSite(world.persistentBaseSite)).toBe(true);
    // Die vierseitig offene Kernform; der Hof bleibt begehbar.
    expect(world.bases[0]?.cells).toHaveLength(getPersistentBaseCoreSurfaceOffsets().length);
    expect(world.bases[0]?.cells.some((cell) => (
      cell.gridX === LOBBY_SPAWN_FOCUS_CELL.gridX && cell.gridY === LOBBY_SPAWN_FOCUS_CELL.gridY
    ))).toBe(false);
  });

  it('materialisiert den Kern in der Lobby nur fuer Coop mit Entitlement', () => {
    const cases: Array<{ mode: GameMode; unlocked: boolean; hasBase: boolean }> = [
      { mode: 'coop_defense', unlocked: true, hasBase: true },
      { mode: 'coop_defense', unlocked: false, hasBase: false },
      { mode: 'deathmatch', unlocked: true, hasBase: false },
      { mode: 'team_deathmatch', unlocked: true, hasBase: false },
      { mode: 'capture_the_beer', unlocked: true, hasBase: false },
    ];

    for (const testCase of cases) {
      const world = lobbyWorldContextFor(testCase.mode, testCase.unlocked);
      expect(world.persistentBaseSite !== null, `${testCase.mode}/${testCase.unlocked}`).toBe(testCase.hasBase);
      expect(world.bases.some(base => base.id === LOBBY_PERSISTENT_BASE_ID), `${testCase.mode}/${testCase.unlocked}`).toBe(testCase.hasBase);
    }

    // Der Coordinator behaelt genau diese Entscheidung im bestehenden Lobby-Reinstance-Pfad;
    // das Entitlement selbst wird dabei nicht aus dem Save entfernt.
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    expect(lifecycle).toContain('const persistentBaseUnlocked = isCoopDefenseMode(currentMode)');
    expect(lifecycle).toContain('&& getStoredPersistentBaseUnlocked();');
    expect(lifecycle).toContain('this.lobbyWorldModeAtRevision !== currentMode');
  });

  it('bindet Contributions an die persistente World und Working State nur an die Activity', () => {
    // Eine freigeschaltete LobbyWorld materialisiert und editiert den committed Stand direkt.
    // Erst eine echte Activity oeffnet den bestehenden Missions-Working-State. Die Struktur kennt
    // ohne Activity weiterhin keinen Schaden.
    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    expect(lifecycle).toContain('if (bridge.isHost() && persistentBaseSite !== null) {');
    // Genau eine Activity oeffnet genau einen Arbeitsstand - am Identity-Lifecycle und nicht im
    // lokalen World-Aufbau.
    expect(lifecycle).toContain('activityIdentity: {');
    expect(lifecycle).toContain('this.persistentBase.beginPersistentBaseTransaction(activity);');
    const buildStart = lifecycle.indexOf('  buildWorld(');
    const buildEnd = lifecycle.indexOf('  tearDownArena(', buildStart);
    expect(lifecycle.slice(buildStart, buildEnd)).not.toContain('beginTransaction(');
    const construction = read('src/world/ConstructionWorldRuntime.ts');
    expect(construction).toContain('if (registered && !context.contributions.hasActiveMission)');
    expect(construction).toContain('if (context && ownerId && removedBlueprint && !context.contributions.hasActiveMission)');
    expect(lifecycle).toContain('this.releaseWorldRuntime(preserveAuthoredPresentation);');
    // Die Bau-Runtime gibt ihre Zellen mit dem gebauten World-Zustand frei.
    expect(read('src/world/WorldMaterialization.ts')).toContain('this.placementValue?.clearRuntimeRocks();');
    expect(lifecycle).toContain('this.attachCoopMissionBaseBinding(activityDescriptor, coopMissionRuntime);');
    expect(lifecycle).not.toContain('damageBases: activityDescriptor !== null,');
  });
});

describe('RockHpRegistry – geschuetzte Struktur nimmt keinen Schaden', () => {
  it('unterscheidet explizit geschuetzte und zerstoerbare Felsen unabhaengig vom Lobby-Authoring', () => {
    const registry = new RockHpRegistry({
      ...buildLobbyWorldLayout(),
      rocks: [
        { gridX: 0, gridY: 0, indestructible: true },
        { gridX: 1, gridY: 0 },
      ],
    });
    const frameId = 0;
    const titleId = 1;

    expect(registry.applyDamage(frameId, ROCK_HP_MAX * 10)).toBe(ROCK_HP_MAX);
    expect(registry.isDestroyed(frameId)).toBe(false);
    expect(registry.isIndestructible(frameId)).toBe(true);

    expect(registry.applyDamage(titleId, ROCK_HP_MAX)).toBe(0);
    expect(registry.isDestroyed(titleId)).toBe(true);
  });
});

describe('LobbyWorld – Teilnahme none, Presentation preview', () => {
  const definition = getLobbyWorldDefinition();
  const presentation = resolveWorldPresentation({
    participation: 'none',
    worldActive: true,
    previewWithoutParticipation: definition.presentationPolicy?.previewWithoutParticipation === true,
  });

  it('zeigt die World, ohne dass jemand an ihr teilnimmt', () => {
    expect(presentation.required).toBe(true);
    expect(presentation.mode).toBe('preview');
    // Weltkamera, World-HUD, Zielhilfe und Spielerfigur gehoeren der Teilnahme, nicht der Sicht.
    expect(presentation.surfaces).not.toContain('worldCamera');
    expect(presentation.surfaces).not.toContain('worldHud');
    expect(presentation.surfaces).not.toContain('aim');
    expect(presentation.surfaces).not.toContain('localPlayerVisuals');
  });

  it('laesst die Lobby ueber der World stehen und zeigt kein Runden-HUD', () => {
    const policy = resolvePresentationPolicy({
      inLobby: true,
      worldPresentation: presentation,
      worldVisible: true,
      gameplayActive: false,
      roundRole: 'participant',
      matchTerminated: false,
      spectatorPanAvailable: false,
    });
    expect(policy.showWorld).toBe(true);
    expect(policy.worldMode).toBe('preview');
    expect(policy.showLobby).toBe(true);
    expect(policy.showHud).toBe(false);
    expect(policy.useWorldCamera).toBe(false);
    expect(policy.useSpectatorCamera).toBe(false);
  });

  it('erzeugt daraus weder PlayerRuntime noch World-Input', () => {
    expect(hasWorldRuntimeEntry('none')).toBe(false);
    expect(maySendWorldInput('none')).toBe(false);

    const capabilities = resolvePlayerCapabilities({
      participation: 'none',
      activityKind: null,
      worldCombatAllowed: definition.actionPolicy?.combat === true,
    });
    expect(capabilities).toEqual({
      canMove: false,
      canUseCombat: false,
      canPlace: false,
      canDismantle: false,
      canInteract: false,
      canUseMissionActions: false,
      canControlCamera: false,
    });

    const input = resolveInputPolicy({
      capabilities,
      gameplayActive: false,
      countdownActive: false,
      uiBlocking: false,
      diagnosticsArena: false,
    });
    expect(input).toEqual({
      movement: false,
      combat: false,
      placement: false,
      worldInteraction: false,
      cameraNavigation: false,
      aim: false,
    });

    // Auch der Host fuehrt fuer sie keinen Spielerzustand: Ohne Eintrag in der World wird gar
    // keine Runtime angehaengt, und was der Modulkontext ergaebe, kommt nie zum Tragen.
    expect(hasWorldRuntimeEntry('none')).toBe(false);
    const features = resolvePlayerRuntimeFeatures({
      isHost: true,
      participation: 'none',
    });
    // Missionsgebundene Module gibt es hier ohnehin nicht mehr; sie gehoeren der Activity.
    expect(Object.keys(features)).not.toContain('missionStatus');
  });
});

describe('LobbyWorld – normaler World-Kanal', () => {
  async function createRoom(playerCount: number): Promise<TestRoom[]> {
    const network = new FakeNetwork();
    const rooms = [await createHostRoom(network)];
    for (let i = 1; i < playerCount; i += 1) rooms.push(await addClientRoom(network));
    return rooms;
  }

  function bridgeFor(room: TestRoom): NetworkBridge {
    setActiveSession({ room: room.room, transport: room.transport, roomCode: 'LOBBY1' });
    const bridge = new NetworkBridge();
    bridge.activate();
    return bridge;
  }

  it('bootstraps the selected Coop program through Welcome for a late join', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network);
    let clientRoom: TestRoom | undefined;
    try {
      const host = bridgeFor(hostRoom);
      host.setCoopProgram({ kind: 'dawn' });
      const revision = (hostRoom.room.getGlobal('lsy') as { r: number }).r;
      clientRoom = await addClientRoom(network);
      const client = bridgeFor(clientRoom);
      expect(client.getCoopProgram()).toEqual({ kind: 'dawn' });
      expect(clientRoom.room.getGlobal('lsy')).toMatchObject({ r: revision, cpg: { kind: 'dawn' } });
      expect(client.getLobbySyncConsistency()).toEqual({ consistent: true, hostStatePresent: true, issues: [] });
    } finally {
      clearActiveSession();
      clientRoom?.room.destroy();
      hostRoom.room.destroy();
    }
  });

  it('repliziert die LobbyWorld ohne Activity und ohne Teilnehmer', async () => {
    const [hostRoom, clientRoom] = await createRoom(2);
    try {
      const host = bridgeFor(hostRoom);
      const client = bridgeFor(clientRoom);

      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'LOBBY1' });
      host.publishLobbySync();
      host.setMatchHostId();
      const descriptor = createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, 4242, {
        persistentBaseUnlocked: true, persistentBaseAreaStage: 11, persistentBaseHealthRewards: [],
      });
      host.publishWorldAndActivity(descriptor, null);

      // Der Raum bleibt in der Lobby; die World haengt an keiner Phase und an keiner Runde.
      expect(host.getGamePhase()).toBe('LOBBY');
      expect(host.getActivityDescriptor()).toBeNull();
      expect(host.getRoundState()).toBeNull();
      expect(host.getRoundParticipation()).toBeNull();

      // Host und Client meinen dieselbe World-Instanz - ueber denselben Kanal wie ein Match.
      setActiveSession({ room: clientRoom.room, transport: clientRoom.transport, roomCode: 'LOBBY1' });
      expect(client.getWorldDescriptor()).toEqual(descriptor);
      expect(client.getActivityDescriptor()).toBeNull();

      // Niemand nimmt teil: Raum-Mitgliedschaft ist keine World-Mitgliedschaft.
      expect(client.getLocalWorldParticipation()).toBe('none');
      expect(client.getWorldParticipants()).toEqual([]);
      setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'LOBBY1' });
      expect(host.getLocalWorldParticipation()).toBe('none');
      expect(host.getWorldParticipants()).toEqual([]);
    } finally {
      clearActiveSession();
    }
  });
});

describe('LobbyWorld – keine zweite Lobby-Simulation', () => {
  it('haelt in src/lobby/ nur noch Raum-Fachlogik', () => {
    const files = readdirSync(resolve(process.cwd(), 'src/lobby')).sort();
    expect(files).toEqual(['LobbyRosterLayout.ts']);
  });

  it('ersetzt den Systemcursor nur dort, wo es die Zielhilfe ueberhaupt gibt', () => {
    // In der Lobby steht der normale Cursor; das Fadenkreuz gehoert der Teilnahme.
    const aimPresentation = read('src/scenes/arena/ArenaAimPresentationController.ts');
    const inputBindings = read('src/scenes/arena/ArenaInputBindings.ts');
    expect(aimPresentation).toContain('getAimPresentationState(frame.worldInteractive, frame.spectator, frame.optionsOpen)');
    expect(aimPresentation).toContain('frame.inArena && !frame.spectator');
    expect(inputBindings).toContain('const cursorVisible = worldInteractive && !optionsOpen && !spectator;');
    expect(inputBindings).toContain('return { aimVisible, cursorVisible };');
  });

  it('laesst die Scene die Lobby ueber den World-Lifecycle bauen statt ueber eine Vorschau', () => {
    const scene = read('src/scenes/ArenaScene.ts');
    expect(scene).not.toContain('MenuArenaPreview');
    expect(scene).not.toContain('LobbyAmbient');
    expect(scene).toContain('this.arenaRuntime.hostSyncLobbyWorld();');

    const lifecycle = read('src/scenes/arena/ArenaLifecycleCoordinator.ts');
    // Die LobbyWorld nimmt denselben Weg wie jede andere World-Instanz.
    expect(lifecycle).toContain('this.worldLifecycle.beginCreate(');
    expect(lifecycle).toContain('createAuthoredWorldDescriptor(');
    expect(lifecycle).toContain('LOBBY_WORLD_DEFINITION_ID,');
    // Und sie ist keine Activity.
    expect(lifecycle).not.toContain("kind: 'lobby'");
  });
});
