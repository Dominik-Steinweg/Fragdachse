import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  getCoopDefenseMapConfig,
  getCoopDefenseMapScheduledXp,
  getCoopDefenseMapXpReference,
  normalizeCoopDefenseMapConfig,
  resolveCoopDefenseMapEncounterConfigs,
  type CoopBaseShape,
  resolveCoopDefenseMapPersistentSpawnConfigs,
} from '../src/config/coopDefenseMaps';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import {
  COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS,
  isCoopDefenseBaseObstacleClearanceCell,
  isPersistentBaseReservationCell,
  resolveCoopDefenseBases,
} from '../src/arena/BaseRegistry';
import {
  DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS,
} from '../src/config';
import {
  MAX_PERSISTENT_BASE_RADIUS_CELLS,
  PERSISTENT_BASE_CLEARANCE_CELLS,
} from '../src/config/persistentBase';
import { shouldDelayFirstPedestalSpawn } from '../src/powerups/PowerUpConfig';
import { formatTimeOfDay, parseTimeOfDay } from '../src/effects/TimeOfDay';
import { getMapName, getMapTutorial } from '../src/i18n/contentPresentation';
import { getLocalizedMapObjectiveLabel } from '../src/i18n/gameModePresentation';

function getShapeBounds(shape: CoopBaseShape): { width: number; height: number } {
  if (shape.kind === 'rectangle') return { width: shape.widthCells, height: shape.heightCells };
  return {
    width: Math.max(...shape.cells.map((cell) => cell.gridX)) + 1,
    height: Math.max(...shape.cells.map((cell) => cell.gridY)) + 1,
  };
}

describe('Coop defense map progression', () => {
  it('keeps map identifiers and arena widths valid without snapshotting balance values', () => {
    const mapIds = COOP_DEFENSE_MAP_CONFIGS.map((map) => map.mapId);
    expect(mapIds.every((mapId) => mapId.trim().length > 0)).toBe(true);
    expect(new Set(mapIds).size).toBe(mapIds.length);
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      expect(Number.isInteger(map.arenaWidthCells), map.mapId).toBe(true);
      expect(map.arenaWidthCells, map.mapId).toBeGreaterThan(0);
      expect(map.arenaWidthCells, map.mapId).toBeLessThanOrEqual(MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS);
      expect(Number.isInteger(map.arenaHeightCells), map.mapId).toBe(true);
      expect(map.arenaHeightCells, map.mapId).toBeGreaterThanOrEqual(DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS);
      expect(map.arenaHeightCells, map.mapId).toBeLessThanOrEqual(MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS);
    }
    expect(getCoopDefenseMapConfig('1').arenaHeightCells).toBeGreaterThanOrEqual(DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS);
  });

  it('validates persistent anchors and resolves map-relative reservation geometry', () => {
    const map = COOP_DEFENSE_MAP_CONFIGS.find((candidate) => candidate.persistentBase !== undefined);
    expect(map?.persistentBase).toBeDefined();

    const anchor = resolveCoopDefenseBases(map!).find((base) => base.id === map!.persistentBase?.baseId);
    expect(anchor).toMatchObject({
      anchorGridX: map!.persistentBase!.anchor.gridX,
      anchorGridY: map!.persistentBase!.anchor.gridY,
    });
    expect(anchor!.hpMax).toBeGreaterThan(0);
    const reservationRadius = MAX_PERSISTENT_BASE_RADIUS_CELLS + PERSISTENT_BASE_CLEARANCE_CELLS;
    expect(anchor && isPersistentBaseReservationCell(
      map!.persistentBase!.anchor.gridX + reservationRadius,
      map!.persistentBase!.anchor.gridY,
      [anchor],
    )).toBe(true);
    expect(anchor && isPersistentBaseReservationCell(
      map!.persistentBase!.anchor.gridX + reservationRadius + 1,
      map!.persistentBase!.anchor.gridY,
      [anchor],
    )).toBe(false);

    expect(anchor!.cells.length).toBeGreaterThan(0);
    expect(anchor!.region.maxGridX).toBeGreaterThanOrEqual(anchor!.region.minGridX);
    expect(anchor!.region.maxGridY).toBeGreaterThanOrEqual(anchor!.region.minGridY);

    // Der Kern steht nach der Normalisierung als gewoehnliche Basis in `bases`; die Rohkarte
    // beschreibt ihn nicht. Deshalb ist die Vorlage fuer die Negativfaelle die Karte ohne ihn.
    const rawMap = {
      ...map!,
      bases: map!.bases.filter((base) => base.id !== map!.persistentBase!.baseId),
    };

    // Eine Map darf ihre persistente Basis nicht zusaetzlich selbst beschreiben.
    expect(() => normalizeCoopDefenseMapConfig({
      ...rawMap,
       mapId: 'persistent-anchor-validation',
       bases: [{
         id: map!.persistentBase!.baseId,
        hpMax: 1,
        anchor: { kind: 'grid', gridX: 1, gridY: 1 },
        shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
      }],
    })).toThrow(/must not also be authored in bases/);

    // Und sie braucht ringsum Platz fuer die Reservierung.
    expect(() => normalizeCoopDefenseMapConfig({
      ...rawMap,
      mapId: 'persistent-anchor-bounds',
       persistentBase: { ...map!.persistentBase!, anchor: { gridX: 3, gridY: 3 } },
    })).toThrow(/free cells around its anchor/);
  });

  it('resolves each authored persistent base exactly once without duplicating its ownership', () => {
    const persistentMaps = COOP_DEFENSE_MAP_CONFIGS.filter((map) => map.persistentBase !== undefined);
    expect(persistentMaps.length).toBeGreaterThan(0);
    const reservationRadius = MAX_PERSISTENT_BASE_RADIUS_CELLS + PERSISTENT_BASE_CLEARANCE_CELLS;
    for (const map of persistentMaps) {
      const baseId = map.persistentBase!.baseId;
      const resolvedBases = resolveCoopDefenseBases(map);
      const persistentBase = resolvedBases.filter((base) => base.id === baseId);
      expect(persistentBase, map.mapId).toHaveLength(1);
      expect(persistentBase[0], map.mapId).toMatchObject({
        anchorGridX: map.persistentBase!.anchor.gridX,
        anchorGridY: map.persistentBase!.anchor.gridY,
        faction: 'friendly',
        role: 'main',
        persistentReservationRadiusCells: reservationRadius,
      });
      expect(persistentBase[0]!.hpMax).toBeGreaterThan(0);
      expect(persistentBase[0]!.cells.length).toBeGreaterThan(0);
      expect(persistentBase[0]!.turrets, map.mapId).toEqual([]);
      expect(persistentBase[0]!.powerUpPedestals, map.mapId).toEqual([]);
      expect(map.bases.filter((base) => base.id === baseId), map.mapId).toHaveLength(1);
    }
  });

  it('keeps the persistent reservation separate from independent authored structures', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter((candidate) => candidate.persistentBase !== undefined)) {
      const bases = resolveCoopDefenseBases(map);
      const persistentBase = bases.find((base) => base.id === map.persistentBase?.baseId);
      expect(persistentBase, map.mapId).toBeDefined();
      const independentBases = bases.filter((base) => base.id !== persistentBase!.id);
      for (const base of independentBases) {
        for (const cell of base.cells) {
          expect(
            isPersistentBaseReservationCell(cell.gridX, cell.gridY, bases),
            `${map.mapId}/${base.id} overlaps the persistent base reservation`,
          ).toBe(false);
        }
      }
    }
  });

  it('authors explicit rail positions while keeping the legacy center default', () => {
    const railMaps = COOP_DEFENSE_MAP_CONFIGS.filter((map) => map.trackMode !== 'void-fire');
    expect(railMaps.every((map) => map.trackPosition !== undefined)).toBe(true);

    const base = {
      mapId: 'track-position-test',
      displayName: 'Track position test',
      arenaWidthCells: 20,
      balanceReferenceDurationSec: 60,
      objective: 'survive' as const,
      surviveDurationSec: 60,
      respawnsPerPlayer: 0,
      bases: [],
      powerUps: [],
    };

    expect(normalizeCoopDefenseMapConfig({ ...base, trackPosition: 'left' }).trackPosition).toBe('left');
    expect(normalizeCoopDefenseMapConfig({ ...base, trackPosition: 'center' }).trackPosition).toBe('center');
    expect(normalizeCoopDefenseMapConfig({ ...base, trackPosition: 'right' }).trackPosition).toBe('right');
    expect(normalizeCoopDefenseMapConfig({ ...base, trackPosition: { kind: 'grid', gridX: 7 } }).trackPosition)
      .toEqual({ kind: 'grid', gridX: 7 });
    expect(normalizeCoopDefenseMapConfig(base).trackPosition).toBe('center');

    expect(() => normalizeCoopDefenseMapConfig({ ...base, trackPosition: { kind: 'grid', gridX: -1 } }))
      .toThrow(/Invalid trackPosition/);
    expect(() => normalizeCoopDefenseMapConfig({ ...base, trackPosition: { kind: 'grid', gridX: 60 } }))
      .toThrow(/Invalid trackPosition/);
  });

  it('keeps configured item rewards valid through campaign progression', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      if (!map.itemDrop) continue;
      expect(Number.isInteger(map.itemDrop.itemLevel), map.mapId).toBe(true);
      expect(map.itemDrop.itemLevel, map.mapId).toBeGreaterThan(0);
    }

  });

  it('keeps map metadata usable after balancing and terminology changes', () => {
    const playableMaps = COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0');
    const displayNames = playableMaps.map((map) => getMapName(map.mapId, 'de').trim());

    expect(displayNames.every((name) => name.length > 0)).toBe(true);
    expect(new Set(displayNames).size).toBe(displayNames.length);
    for (const map of playableMaps) {
      expect(map.balanceReferenceDurationSec).toBeGreaterThan(0);
      if (map.objective === 'survive') expect(map.surviveDurationSec).toBeGreaterThan(0);
      const tutorial = getMapTutorial(map.mapId, 'de');
      if (tutorial !== undefined) {
        expect(tutorial.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('assigns one valid victory objective to every map', () => {
    const objectiveByMapId = Object.fromEntries(
      COOP_DEFENSE_MAP_CONFIGS.map((map) => [map.mapId, map.objective]),
    );

    expect(Object.values(objectiveByMapId).every((objective) => (
      objective === 'repel-assault'
      || objective === 'survive'
      || objective === 'defeat-boss'
      || objective === 'destroy-hostile-bases'
      || objective === 'advance'
    ))).toBe(true);
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      expect(getLocalizedMapObjectiveLabel(map.objective, 'de').trim().length).toBeGreaterThan(0);
      if (map.boss) expect(map.objective).toBe('defeat-boss');
      if (map.objective === 'destroy-hostile-bases') {
        expect(map.bases.some((base) => base.faction === 'hostile' && (base.role ?? 'main') === 'main')).toBe(true);
        expect(map.bases.some((base) => base.faction !== 'hostile' && (base.role ?? 'main') === 'main')).toBe(true);
      }
    }
  });

  it('calculates non-negative exact finite XP for every playable map', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0')) {
      const scheduledXp = getCoopDefenseMapScheduledXp(map, 1);
      expect(Number.isFinite(scheduledXp)).toBe(true);
      expect(scheduledXp).toBeGreaterThanOrEqual(0);
    }
    const finiteEmptyMap = {
      mapId: 'finite-empty',
      displayName: 'Finite empty',
      balanceReferenceDurationSec: 60,
      objective: 'repel-assault',
      bases: [],
      powerUps: [],
    } as CoopDefenseMapConfig;
    expect(getCoopDefenseMapScheduledXp(finiteEmptyMap)).toBe(0);
  });

  it('requires the bounded survival contract on every survival map', () => {
    const survivalMaps = COOP_DEFENSE_MAP_CONFIGS.filter(({ objective }) => objective === 'survive');
    expect(survivalMaps.length).toBeGreaterThan(0);
    for (const map of survivalMaps) {
      expect(map.surviveDurationSec).toBeGreaterThan(0);
      expect(map.respawnsPerPlayer).toBeGreaterThanOrEqual(0);
    }
  });

  it('uses the central enemy-spawn resolver for Map 1 encounter XP', () => {
    const map = getCoopDefenseMapConfig('1');
    const singlePlayerXp = getCoopDefenseMapScheduledXp(map, 1);
    const multiplayerXp = getCoopDefenseMapScheduledXp(map, 2);
    const resolvedMultiplayerGroups = resolveCoopDefenseMapEncounterConfigs(map, 2)
      .flatMap((encounter) => encounter.groups);
    expect(singlePlayerXp).toBeGreaterThan(0);
    expect(multiplayerXp).toBe(resolvedMultiplayerGroups.reduce(
      (sum, group) => sum + group.count * getCoopDefenseEnemyConfig(group.enemyKind).xp,
      0,
    ));
  });

  it('uses valid visual footprints for every base', () => {
    for (const base of COOP_DEFENSE_MAP_CONFIGS
      .filter(({ mapId }) => mapId !== '0')
      .flatMap((map) => map.bases)) {
      const bounds = getShapeBounds(base.shape);
      expect(base.hpMax).toBeGreaterThan(0);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
      for (const turret of base.turrets ?? []) {
        expect(turret.cellOffset.gridX).toBeGreaterThanOrEqual(0);
        expect(turret.cellOffset.gridX).toBeLessThan(bounds.width);
        expect(turret.cellOffset.gridY).toBeGreaterThanOrEqual(0);
        expect(turret.cellOffset.gridY).toBeLessThan(bounds.height);
      }
    }
  });

  it('builds linked power-up bases symmetrically around open pedestal cells', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0')) {
      for (const base of map.bases) {
        const pedestals = base.powerUpPedestals ?? [];
        if (pedestals.length === 0) continue;
        expect(base.shape.kind).toBe('cells');
        const bounds = getShapeBounds(base.shape);
        const cells = base.shape.kind === 'cells' ? base.shape.cells : [];
        const occupied = new Set(cells.map((cell) => `${cell.gridX}:${cell.gridY}`));
        for (const pedestal of pedestals) {
          expect(pedestal.cellOffset.gridX).toBeGreaterThanOrEqual(0);
          expect(pedestal.cellOffset.gridX).toBeLessThan(bounds.width);
          expect(pedestal.cellOffset.gridY).toBeGreaterThanOrEqual(0);
          expect(pedestal.cellOffset.gridY).toBeLessThan(bounds.height);
          expect(occupied.has(`${pedestal.cellOffset.gridX}:${pedestal.cellOffset.gridY}`)).toBe(false);
        }
        for (const cell of cells) {
          expect(occupied.has(`${cell.gridX}:${bounds.height - 1 - cell.gridY}`)).toBe(true);
        }
      }
    }
  });

  it('uses known enemies and valid settings for every persistent source and boss', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0')) {
      for (const spawn of map.persistentSpawns ?? []) {
        expect(() => getCoopDefenseEnemyConfig(spawn.enemyKind)).not.toThrow();
        expect(spawn.intervalMs).toBeGreaterThan(0);
        expect(spawn.countPerTick).toBeGreaterThan(0);
        expect(spawn.startAtMs ?? 0).toBeGreaterThanOrEqual(0);
      }
      if (map.boss) {
        expect(getCoopDefenseEnemyConfig(map.boss.enemyKind).isBoss).toBe(true);
        expect(map.boss.spawnAtMs).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(map.boss.spawnAtMs)).toBe(true);
      }
      for (const base of map.bases) {
        if (base.role !== 'spawn-point') continue;
        expect(base.spawnCenter).toBeDefined();
        expect((map.persistentSpawns ?? []).some((spawn) => (
          spawn.source.type === 'base' && spawn.source.baseId === base.id
        ))).toBe(true);
      }
    }
  });

  it('keeps outpost factions and turret assignments semantically coherent', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      const outposts = map.bases.filter((base) => base.role === 'outpost');
      for (const outpost of outposts) {
        expect(outpost.faction === undefined || outpost.faction === 'friendly' || outpost.faction === 'hostile').toBe(true);
        for (const turret of outpost.turrets ?? []) {
          expect(turret.weaponId.trim().length).toBeGreaterThan(0);
          expect(turret.mountSide.trim().length).toBeGreaterThan(0);
        }
      }
    }
    const plasmaTurrets = COOP_DEFENSE_MAP_CONFIGS
      .flatMap((map) => map.bases)
      .flatMap((base) => base.turrets ?? [])
      .filter((turret) => turret.weaponId === 'SPORE_TURRET_PLASMA');
    expect(plasmaTurrets.length).toBeGreaterThan(0);
  });

  it('keeps persistent-source XP outside the exact scheduled XP budget', () => {
    const mapsWithPersistentPressure = COOP_DEFENSE_MAP_CONFIGS.filter((map) => (
      (map.persistentSpawns?.length ?? 0) > 0
    ));
    expect(mapsWithPersistentPressure.length).toBeGreaterThan(0);
    for (const map of mapsWithPersistentPressure) {
      const finiteXp = getCoopDefenseMapScheduledXp(map, 2);
      const persistentSpawns = resolveCoopDefenseMapPersistentSpawnConfigs(map, 2);
      expect(persistentSpawns.length, map.mapId).toBeGreaterThan(0);
      expect(getCoopDefenseMapXpReference(map, persistentSpawns, 2), map.mapId).toBeGreaterThanOrEqual(finiteXp);
    }
  });

  it('uses the explicit balance reference only for pressure/drop normalization', () => {
    const map = getCoopDefenseMapConfig('13');
    const persistentSpawns = resolveCoopDefenseMapPersistentSpawnConfigs(map, 1);
    const shortReference = { ...map, balanceReferenceDurationSec: 1 };
    const longReference = { ...map, balanceReferenceDurationSec: 120 };

    expect(getCoopDefenseMapXpReference(longReference, persistentSpawns, 1))
      .toBeGreaterThan(getCoopDefenseMapXpReference(shortReference, persistentSpawns, 1));
  });

  it('keeps five-cell obstacle clearance around every role and preserves spawn-center gaps', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => ['8', '13', '14', '15', '16'].includes(mapId))) {
      const specs = resolveCoopDefenseBases(map);
      for (const spec of specs) {
        const edgeCell = {
          gridX: Math.max(0, spec.region.minGridX - COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS),
          gridY: spec.region.minGridY,
        };
        expect(isCoopDefenseBaseObstacleClearanceCell(edgeCell.gridX, edgeCell.gridY, specs)).toBe(true);
        if (spec.role === 'spawn-point') {
          expect(spec.spawnCenter).toBeDefined();
          expect(spec.cells).not.toContainEqual(spec.spawnCenter);
        }
      }
    }
  });

  it('uses the canonical persistent core without legacy home-base turrets or pickups', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter((candidate) => candidate.persistentBase !== undefined)) {
      const base = map.bases.find((candidate) => candidate.id === map.persistentBase?.baseId);
      expect(base, map.mapId).toBeDefined();
      expect(getShapeBounds(base!.shape).width, map.mapId).toBeGreaterThan(0);
      expect(getShapeBounds(base!.shape).height, map.mapId).toBeGreaterThan(0);
      expect(base!.turrets, map.mapId).toEqual([]);
      expect(base!.powerUpPedestals, map.mapId).toEqual([]);
    }
  });

  it('gives every map a valid time of day', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      // Der Normalisierer schreibt den Wert immer aus, auch wenn die JSON ihn weglässt.
      expect(map.timeOfDay).toBeDefined();
      const minutes = parseTimeOfDay(map.timeOfDay!);
      expect(minutes, `map ${map.mapId} has an unparsable timeOfDay: ${map.timeOfDay}`).not.toBeNull();
      expect(formatTimeOfDay(minutes!)).toBe(map.timeOfDay);
    }
  });

  it('keeps dynamic time authoring structurally valid', () => {
    const dynamicMaps = COOP_DEFENSE_MAP_CONFIGS
      .filter((map) => map.dynamicTimeOfDay !== undefined);
    expect(dynamicMaps.length).toBeGreaterThan(0);
    for (const map of dynamicMaps) {
      expect(map.dynamicTimeOfDay?.minutesPerSecond ?? 0).toBeGreaterThanOrEqual(0);
      for (const transition of map.dynamicTimeOfDay?.transitions ?? []) {
        expect(parseTimeOfDay(transition.targetTimeOfDay)).not.toBeNull();
        expect(transition.durationMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('rejects invalid dynamic time authoring', () => {
    const base = getCoopDefenseMapConfig('0');
    expect(() => normalizeCoopDefenseMapConfig({
      ...base,
      dynamicTimeOfDay: { minutesPerSecond: -1 },
    })).toThrow(/dynamic time rate/i);
    expect(() => normalizeCoopDefenseMapConfig({
      ...base,
      dynamicTimeOfDay: {
        transitions: [{
          start: { type: 'time', atMs: 0 },
          targetTimeOfDay: '24:00',
          durationMs: 100,
        }],
      },
    })).toThrow(/dynamic time target/i);
    expect(() => normalizeCoopDefenseMapConfig({
      ...getCoopDefenseMapConfig('15'),
      persistentBase: undefined,
      dynamicTimeOfDay: {
        transitions: [{
          start: { type: 'boss-phase', phase: 2 },
          targetTimeOfDay: '23:30',
          durationMs: 100,
        }],
      },
    })).toThrow(/must be instantaneous/i);
  });

  it('keeps every authored Hold binary, bounded and aimed at a defensible outpost', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      for (const objective of map.secondaryObjectives ?? []) {
        if (objective.type !== 'hold') continue;
        expect(objective.holdUntil, `${map.mapId}:${objective.id} has no holdUntil`).toBeDefined();
        expect(objective.focusUntil).toBeUndefined();
        expect(objective.targets.length).toBeGreaterThan(0);
        expect(objective.requiredSurvivors ?? objective.targets.length)
          .toBeGreaterThanOrEqual(1);
        expect(objective.requiredSurvivors ?? objective.targets.length)
          .toBeLessThanOrEqual(objective.targets.length);

        // Nur ein bewaffneter friendly Outpost wird von Gegnern ueberhaupt angegriffen und kann
        // deshalb ein glaubwuerdiges Halteziel sein; als main base wuerde sein Fall die Runde
        // beenden.
        const targets = objective.targets.map((targetId) => map.bases.find((base) => base.id === targetId));
        expect(targets.every((target) => target?.role === 'outpost')).toBe(true);
        expect(targets.every((target) => (target?.faction ?? 'friendly') === 'friendly')).toBe(true);
      }
    }
  });

  it('binds destroy objectives only to dormant hostile base sources', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      for (const objective of map.secondaryObjectives ?? []) {
        if (objective.type !== 'destroy') continue;
        const targets = objective.targets;
        const targetBases = targets.map((targetId) => map.bases.find((base) => base.id === targetId));
        const structureBoundSources = new Set(
          (map.persistentSpawns ?? [])
            .filter((spawn) => spawn.source.type === 'base')
            .map((spawn) => spawn.source.type === 'base' ? spawn.source.baseId : ''),
        );

        expect(targets.length).toBeGreaterThan(0);
        expect(new Set(targets).size).toBe(targets.length);
        expect(targetBases.every((base) => (
          base?.dormant === true
          && base.role === 'spawn-point'
          && base.faction === 'hostile'
          && structureBoundSources.has(base.id)
        ))).toBe(true);
        expect(targetBases.some((base) => base?.role === 'main')).toBe(false);
      }
    }
  });

  it('keeps power-up respawns valid and delays the first strong pedestal spawn', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0')) {
      const freePowerUps = map.powerUps;
      const linkedPowerUps = map.bases.flatMap((base) => base.powerUpPedestals ?? []);
      for (const powerUp of [...freePowerUps, ...linkedPowerUps]) {
        expect(powerUp.spawnOnArenaStart).toBe(!shouldDelayFirstPedestalSpawn(powerUp.defId));
        expect(Number.isFinite(powerUp.respawnMs)).toBe(true);
        expect(powerUp.respawnMs).toBeGreaterThan(0);
      }
    }
  });
});
