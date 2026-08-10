import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  DEFAULT_COOP_DEFENSE_MAP_ID,
  getCoopDefenseMapConfig,
  getCoopDefenseMapScheduledXp,
  getCoopDefenseMapObjectiveLabel,
  resolveCoopDefenseMapEncounterConfigs,
  type CoopBaseShape,
  resolveCoopDefenseMapWaveConfigs,
} from '../src/config/coopDefenseMaps';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import {
  isCoopDefenseBaseObstacleClearanceCell,
  resolveCoopDefenseBases,
} from '../src/arena/BaseRegistry';
import { MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS } from '../src/config';
import { shouldDelayFirstPedestalSpawn } from '../src/powerups/PowerUpConfig';
import { formatTimeOfDay, parseTimeOfDay, resolveSkyState } from '../src/effects/TimeOfDay';

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
    expect(mapIds).toEqual([
      '0', '1', '2', '3', '4', '5', '6', '7', '8',
      '9', '10', '11', '12', '13', '14', '15', '16',
    ]);
    expect(DEFAULT_COOP_DEFENSE_MAP_ID).toBe('1');
    expect(mapIds.every((mapId) => mapId.trim().length > 0)).toBe(true);
    expect(new Set(mapIds).size).toBe(mapIds.length);
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      expect(Number.isInteger(map.arenaWidthCells), map.mapId).toBe(true);
      expect(map.arenaWidthCells, map.mapId).toBeGreaterThan(0);
      expect(map.arenaWidthCells, map.mapId).toBeLessThanOrEqual(MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS);
    }
  });

  it('keeps configured item rewards valid and non-decreasing through campaign progression', () => {
    let highestItemLevel = 0;
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      if (!map.itemDrop) continue;
      expect(Number.isInteger(map.itemDrop.itemLevel), map.mapId).toBe(true);
      expect(map.itemDrop.itemLevel, map.mapId).toBeGreaterThan(0);
      expect(map.itemDrop.itemLevel, map.mapId).toBeGreaterThanOrEqual(highestItemLevel);
      highestItemLevel = map.itemDrop.itemLevel;
    }
  });

  it('keeps map metadata usable after balancing and terminology changes', () => {
    const playableMaps = COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0');
    const displayNames = playableMaps.map((map) => map.displayName.trim());

    expect(displayNames.every((name) => name.length > 0)).toBe(true);
    expect(new Set(displayNames).size).toBe(displayNames.length);
    for (const map of playableMaps) {
      expect(map.roundDurationSec).toBeGreaterThan(0);
      if (map.tutorialText !== undefined) {
        expect(map.tutorialText.trim().length).toBeGreaterThan(0);
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
    ))).toBe(true);
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      expect(getCoopDefenseMapObjectiveLabel(map.objective).trim().length).toBeGreaterThan(0);
      if (map.boss) expect(map.objective).toBe('defeat-boss');
      if (map.objective === 'destroy-hostile-bases') {
        expect(map.bases.some((base) => base.faction === 'hostile' && (base.role ?? 'main') === 'main')).toBe(true);
        expect(map.bases.some((base) => base.faction !== 'hostile' && (base.role ?? 'main') === 'main')).toBe(true);
      }
    }
  });

  it('keeps the German labels for representative map objectives', () => {
    expect(getCoopDefenseMapObjectiveLabel('repel-assault')).toBe('ANGRIFF ABWEHREN');
    expect(getCoopDefenseMapObjectiveLabel('destroy-hostile-bases')).toBe('FEINDBASIS ZERSTÖREN');
    expect(getCoopDefenseMapObjectiveLabel('survive')).toBe('ZEIT ÜBERLEBEN');
  });

  it('calculates positive finite XP for every playable map', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0')) {
      const waves = resolveCoopDefenseMapWaveConfigs(map, 1);
      const scheduledXp = getCoopDefenseMapScheduledXp(map, waves, 1);
      expect(Number.isFinite(scheduledXp)).toBe(true);
      expect(scheduledXp).toBeGreaterThan(0);
    }
  });

  it('migrates only Map 1 to the explicit repel-assault campaign reference', () => {
    const map = getCoopDefenseMapConfig('1');
    expect(map.objective).toBe('repel-assault');
    expect(map.waves).toEqual([]);
    expect(map.encounters).toHaveLength(3);
    expect(map.encounters?.slice(0, 2).map((encounter) => encounter.restAfterMs)).toEqual([5_000, 5_000]);
    expect(map.boss).toBeUndefined();
    expect(map.bases.some((base) => base.role === 'spawn-point')).toBe(false);
  });

  it('uses the central enemy-wave resolver for Map 1 encounter XP instead of legacy waves', () => {
    const map = getCoopDefenseMapConfig('1');
    const singlePlayerXp = getCoopDefenseMapScheduledXp(map, [], 1);
    const multiplayerXp = getCoopDefenseMapScheduledXp(map, [], 2);
    const resolvedMultiplayerGroups = resolveCoopDefenseMapEncounterConfigs(map, 2)
      .flatMap((encounter) => encounter.groups);
    expect(singlePlayerXp).toBe(40);
    expect(multiplayerXp).toBe(resolvedMultiplayerGroups.reduce((sum, group) => sum + group.count, 0));
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

  it('centers single turrets vertically on their base footprints', () => {
    const singleTurretBases = COOP_DEFENSE_MAP_CONFIGS.flatMap((map) => map.bases)
      .filter((base) => (base.turrets?.length ?? 0) === 1);
    expect(singleTurretBases.length).toBeGreaterThan(0);
    for (const base of singleTurretBases) {
      const { height } = getShapeBounds(base.shape);
      expect(base.turrets?.[0].cellOffset.gridY).toBe(Math.floor(height / 2));
    }
  });

  it('uses known enemies and valid spawn settings for every wave and boss', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0')) {
      for (const wave of map.waves) {
        expect(() => getCoopDefenseEnemyConfig(wave.enemyKind)).not.toThrow();
        expect(wave.intervalMs).toBeGreaterThan(0);
        expect(wave.countPerWave).toBeGreaterThan(0);
        expect(wave.startAtMs ?? 0).toBeGreaterThanOrEqual(0);
      }
      if (map.boss) {
        expect(getCoopDefenseEnemyConfig(map.boss.enemyKind).isBoss).toBe(true);
        expect(map.boss.spawnAtMs).toBeGreaterThanOrEqual(0);
        expect(map.boss.spawnAtMs).toBeLessThan(map.roundDurationSec * 1_000);
      }
      for (const base of map.bases) {
        if (base.role !== 'spawn-point') continue;
        expect(base.spawnCenter).toBeDefined();
        expect(base.spawnWave).toBeDefined();
        expect(getCoopDefenseEnemyConfig(base.spawnWave!.enemyKind)).toBeDefined();
        expect(base.spawnWave!.intervalMs).toBeGreaterThan(0);
        expect(base.spawnWave!.countPerWave).toBeGreaterThan(0);
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
      .filter((turret) => turret.weaponId === 'FLIEGENPILZ_PLASMA');
    expect(plasmaTurrets.length).toBeGreaterThan(0);
  });

  it('includes spawn-point waves in the map XP budget with player scaling', () => {
    const map = getCoopDefenseMapConfig('13');
    const waves = resolveCoopDefenseMapWaveConfigs(map, 2);
    const withSpawnPoints = getCoopDefenseMapScheduledXp(map, waves, 2);
    const withoutSpawnPoints = getCoopDefenseMapScheduledXp({
      ...map,
      bases: map.bases.map((base) => ({ ...base, spawnWave: undefined })),
    }, waves, 2);

    expect(withSpawnPoints).toBeGreaterThan(withoutSpawnPoints);
  });

  it('keeps five-cell obstacle clearance around every role and preserves spawn-center gaps', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => ['8', '13', '14', '15', '16'].includes(mapId))) {
      const specs = resolveCoopDefenseBases(map);
      for (const spec of specs) {
        const edgeCell = {
          gridX: Math.max(0, spec.region.minGridX - 5),
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

  it('embeds health, adrenaline, and armor pickups in the enlarged rear bases of maps 6 and 8', () => {
    for (const mapId of ['6', '8']) {
      const rearBase = getCoopDefenseMapConfig(mapId).bases.find((base) => base.id === 'coop-base-rear');
      expect(rearBase).toBeDefined();
      const bounds = getShapeBounds(rearBase!.shape);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
      expect(rearBase!.powerUpPedestals?.map((pedestal) => pedestal.defId)).toEqual(expect.arrayContaining([
        'HEALTH_PACK',
        'ADRENALINE',
        'ARMOR',
      ]));
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

  it('keeps the maps with the least forgiving telegraphs out of the dark hours', () => {
    // Map 11 lebt von Luftangriffs-Telegraphen, 5 und 10 von Boss-Telegraphen. Sie dürfen
    // dämmrig sein, aber nicht in der tiefen Nacht liegen, in der ohne Taschenlampe kaum
    // etwas zu erkennen ist.
    for (const mapId of ['5', '10', '11']) {
      const sky = resolveSkyState(parseTimeOfDay(getCoopDefenseMapConfig(mapId).timeOfDay!)!);
      expect(sky.ambientColor, `map ${mapId} sits in the deep-night ambient`).not.toBe(0x161a24);
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
