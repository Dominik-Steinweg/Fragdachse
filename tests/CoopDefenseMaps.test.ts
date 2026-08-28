import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  DEFAULT_COOP_DEFENSE_MAP_ID,
  getCoopDefenseMapConfig,
  getCoopDefenseCampaignAudit,
  getCoopDefenseMapScheduledXp,
  getCoopDefenseMapXpReference,
  normalizeCoopDefenseMapConfig,
  resolveCoopDefenseMapEncounterConfigs,
  type CoopBaseShape,
  resolveCoopDefenseMapPersistentSpawnConfigs,
} from '../src/config/coopDefenseMaps';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import {
  isCoopDefenseBaseObstacleClearanceCell,
  isPersistentBaseReservationCell,
  resolveCoopDefenseBases,
} from '../src/arena/BaseRegistry';
import {
  DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  MAX_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
  MAX_COOP_DEFENSE_ARENA_WIDTH_CELLS,
} from '../src/config';
import { shouldDelayFirstPedestalSpawn } from '../src/powerups/PowerUpConfig';
import { formatTimeOfDay, parseTimeOfDay, resolveSkyState } from '../src/effects/TimeOfDay';
import { getMapName, getMapTutorial, getSecondaryObjectiveReward } from '../src/i18n/contentPresentation';
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
    expect(mapIds).toEqual([
      '0', '1', '2', '3', '4', '5', '6', '7', '8',
      '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
    ]);
    expect(DEFAULT_COOP_DEFENSE_MAP_ID).toBe('1');
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
    const map18 = getCoopDefenseMapConfig('18');
    const map19 = getCoopDefenseMapConfig('19');
    // Die Map beschreibt nur die Stelle; ihre Zellen kommen aus der kanonischen Kerngeometrie.
    expect(map18.persistentBase).toEqual({
      baseId: 'foundation-main',
      anchor: { gridX: 24, gridY: 20 },
      hpMax: 5000,
    });
    expect(map19.persistentBase?.baseId).toBe('cornerstone-main');

    const anchor18 = resolveCoopDefenseBases(map18).find((base) => base.id === 'foundation-main');
    const anchor19 = resolveCoopDefenseBases(map19).find((base) => base.id === 'cornerstone-main');
    // Der aufgeloeste Anker ist exakt der authored: Die Bounding-Box des Kerns ist immer die
    // volle 5x5-Flaeche, ihre Mitte deshalb die Ankerzelle.
    expect(anchor18).toMatchObject({ anchorGridX: 24, anchorGridY: 20 });
    expect(anchor19).toMatchObject({
      anchorGridX: map19.persistentBase!.anchor.gridX,
      anchorGridY: map19.persistentBase!.anchor.gridY,
    });
    expect(anchor18 && isPersistentBaseReservationCell(36, 20, [anchor18])).toBe(true);
    expect(anchor18 && isPersistentBaseReservationCell(37, 20, [anchor18])).toBe(false);

    // Die Kernzellen bilden das nach links geoeffnete U, nicht ein Rechteck.
    expect(anchor18!.cells).toHaveLength(13);
    expect(anchor18!.region).toEqual({
      minGridX: 22, maxGridX: 26, minGridY: 18, maxGridY: 22,
    });
    // Der Eingang liegt links: die drei mittleren Zellen der linken Spalte bleiben frei.
    for (const gridY of [19, 20, 21]) {
      expect(anchor18!.cells.some((cell) => cell.gridX === 22 && cell.gridY === gridY)).toBe(false);
    }

    // Der Kern steht nach der Normalisierung als gewoehnliche Basis in `bases`; die Rohkarte
    // beschreibt ihn nicht. Deshalb ist die Vorlage fuer die Negativfaelle die Karte ohne ihn.
    const rawMap18 = {
      ...map18,
      bases: map18.bases.filter((base) => base.id !== map18.persistentBase!.baseId),
    };

    // Eine Map darf ihre persistente Basis nicht zusaetzlich selbst beschreiben.
    expect(() => normalizeCoopDefenseMapConfig({
      ...rawMap18,
      mapId: 'persistent-anchor-validation',
      bases: [{
        id: 'foundation-main',
        hpMax: 1,
        anchor: { kind: 'grid', gridX: 1, gridY: 1 },
        shape: { kind: 'rectangle', widthCells: 1, heightCells: 1 },
      }],
    })).toThrow(/must not also be authored in bases/);

    // Und sie braucht ringsum Platz fuer die Reservierung.
    expect(() => normalizeCoopDefenseMapConfig({
      ...rawMap18,
      mapId: 'persistent-anchor-bounds',
      persistentBase: { ...map18.persistentBase!, anchor: { gridX: 3, gridY: 3 } },
    })).toThrow(/free cells around its anchor/);
  });

  it('gives every persistent-base map an anchor that the mission lifecycle can resolve', () => {
    const persistentMaps = COOP_DEFENSE_MAP_CONFIGS.filter((map) => map.persistentBase);
    expect(persistentMaps.length).toBeGreaterThan(0);
    for (const map of persistentMaps) {
      const anchorBase = resolveCoopDefenseBases(map).find((base) => base.id === map.persistentBase!.baseId);
      // ArenaLifecycleCoordinator.buildArena() wirft, wenn der Anker keine eigene Hauptbasis ist.
      expect(anchorBase, map.mapId).toBeDefined();
      expect(anchorBase!.faction, map.mapId).toBe('friendly');
      expect(anchorBase!.role, map.mapId).toBe('main');
    }
  });

  it('authors explicit rail positions while keeping the legacy center default', () => {
    const railMaps = COOP_DEFENSE_MAP_CONFIGS.filter((map) => map.trackMode !== 'void-fire');
    expect(railMaps.filter((map) => !['6', '7', '8'].includes(map.mapId)).every((map) => map.trackPosition === 'center')).toBe(true);
    expect(getCoopDefenseMapConfig('6').trackPosition).toBe('left');
    expect(getCoopDefenseMapConfig('7').trackPosition).toBe('right');
    expect(getCoopDefenseMapConfig('8').trackPosition).toBe('left');
    expect(COOP_DEFENSE_MAP_CONFIGS.filter((map) => map.trackMode === 'void-fire' && !['18', '19'].includes(map.mapId))
      .every((map) => map.trackPosition === 'center')).toBe(true);
    expect(getCoopDefenseMapConfig('18').trackPosition).toEqual({ kind: 'grid', gridX: 4 });
    expect(getCoopDefenseMapConfig('19').trackPosition).toEqual({ kind: 'grid', gridX: 48 });

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

  it('keeps the B8 Carry reward observable without changing item unlock progression', () => {
    // Kampagnen-Map statt Testarena: Map 0 ist seit Block A eine loeschbare Stressarena und
    // darf keine Regression mehr tragen.
    const carryMap = getCoopDefenseMapConfig('17');
    const carry = carryMap.secondaryObjectives?.find((objective) => objective.type === 'carry');

    expect(carryMap.itemDrop).toEqual(expect.objectContaining({ itemLevel: expect.any(Number) }));
    expect(carryMap.itemDrop?.itemLevel).toBeGreaterThan(0);
    expect(carry?.rewards?.itemMetaRewardOnComplete).toBe(true);
    // Die Belohnung muss im HUD lesbar sein und die Item-Zusage benennen; der genaue Wortlaut
    // gehoert zur Lokalisierung, nicht zu dieser Regression.
    expect(getSecondaryObjectiveReward(carry?.id ?? '', 'de')).toContain('ITEM');
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

  it('exposes the complete Map 0-19 campaign audit and key GDD semantics', () => {
    const audit = getCoopDefenseCampaignAudit();
    expect(audit.map((entry) => entry.mapId)).toEqual([
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
    ]);
    expect(audit.find((entry) => entry.mapId === '9')).toMatchObject({
      objective: 'survive',
      tutorial: false,
      bases: [],
      secondaryObjectives: [],
      train: true,
    });
    expect(audit.find((entry) => entry.mapId === '14')).toMatchObject({
      objective: 'survive',
      rockField: true,
      train: false,
    });
    expect(audit.find((entry) => entry.mapId === '9')?.targetDurationSec).toBeGreaterThan(0);
    expect(audit.find((entry) => entry.mapId === '14')?.targetDurationSec).toBeGreaterThan(0);
    expect(audit.find((entry) => entry.mapId === '17')).toMatchObject({
      objective: 'destroy-hostile-bases',
      hazards: ['beer-void-corridor'],
      secondaryObjectives: ['carry-beer-to-rear-base:carry'],
      train: false,
    });
    expect(audit.find((entry) => entry.mapId === '17')?.itemLevel).toBeGreaterThan(0);
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

  it('keeps the German labels for representative map objectives', () => {
    expect(getLocalizedMapObjectiveLabel('repel-assault', 'de')).toBe('ANGRIFF ABWEHREN');
    expect(getLocalizedMapObjectiveLabel('destroy-hostile-bases', 'de')).toBe('FEINDBASIS ZERSTÖREN');
    expect(getLocalizedMapObjectiveLabel('survive', 'de')).toBe('ÜBERLEBEN');
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

  it('keeps Map 1 as the guided advance tutorial with a finite respawn budget', () => {
    const map = getCoopDefenseMapConfig('1');
    expect(map.objective).toBe('advance');
    expect(map.respawnsPerPlayer).toBe(100);
    expect(map.persistentSpawns).toEqual([]);
    expect(map.encounters?.length).toBeGreaterThan(0);
    const rests = map.encounters?.map((encounter) => encounter.restAfterMs) ?? [];
    expect(rests.length).toBeGreaterThan(0);
    expect(rests.every((restAfterMs) => restAfterMs >= 0)).toBe(true);
    expect(map.boss).toBeUndefined();
    expect(map.bases.some((base) => base.role === 'spawn-point')).toBe(false);
    expect(map.bases.every((base) => (base.role ?? 'main') !== 'main')).toBe(true);
  });

  it('migrates Map 11 and Map 15 to finite encounter content with semantic triggers', () => {
    const bomberMap = getCoopDefenseMapConfig('11');
    expect(bomberMap.objective).toBe('repel-assault');
    expect(bomberMap.persistentSpawns).toEqual([]);
    expect(bomberMap.bases).toHaveLength(1);
    expect(bomberMap.bases[0]?.id).toBe('coop-base-middle');
    expect(bomberMap.bases[0]?.anchor).toEqual({ kind: 'center-offset', dxCells: -4, dyCells: 2 });
    expect(getShapeBounds(bomberMap.bases[0]!.shape)).toEqual({ width: 5, height: 5 });
    expect(bomberMap.bases[0]?.turrets?.map((turret) => ({
      weaponId: turret.weaponId,
      cellOffset: turret.cellOffset,
    }))).toEqual([
      { weaponId: 'BASE_SPORES', cellOffset: { gridX: 0, gridY: 4 } },
      { weaponId: 'BASE_SPORES', cellOffset: { gridX: 4, gridY: 4 } },
    ]);
    expect(bomberMap.bases[0]?.powerUpPedestals?.map((pedestal) => ({
      defId: pedestal.defId,
      cellOffset: pedestal.cellOffset,
    }))).toEqual([
      { defId: 'HEALTH_PACK', cellOffset: { gridX: 0, gridY: 2 } },
      { defId: 'ADRENALINE', cellOffset: { gridX: 4, gridY: 2 } },
    ]);
    expect(bomberMap.mapEvents?.some((event) => event.type === 'train')).toBe(false);
    expect(bomberMap.encounters?.map((encounter) => encounter.start.type)).toEqual([
      'time',
      'after-event',
      'after-previous',
      'after-previous',
      'after-previous',
    ]);

    const voidHunterMap = getCoopDefenseMapConfig('15');
    expect(voidHunterMap.objective).toBe('defeat-boss');
    expect(voidHunterMap.persistentSpawns).toEqual([]);
    expect(voidHunterMap.encounters?.some((encounter) => (
      encounter.start.type === 'boss-phase' && encounter.start.phase === 2
    ))).toBe(true);
  });

  it('authors A9 front variation while keeping Map 1 on authored spawn areas', () => {
    const map1 = getCoopDefenseMapConfig('1');
    // Auf der Routenkarte liegt jedes Randband im falschen Abschnitt: Map 1 authoriert Bereiche.
    expect(map1.encounters?.flatMap((encounter) => encounter.groups)
      .every((group) => group.spawnArea !== undefined)).toBe(true);

    const map2 = getCoopDefenseMapConfig('2');
    expect(map2.persistentSpawns).toEqual([]);
    // Map 2 traegt keine eigene Hauptbasis mehr: Ihre Hauptbasis ist der persistente Basiskern,
    // den sie ueber ihre Basisstelle platziert.
    expect(map2.persistentBase?.baseId).toBe('coop-base-rear');
    expect(map2.bases.map((base) => base.id)).toEqual(['coop-base-rear']);
    expect(map2.encounters?.flatMap((encounter) => encounter.groups)
      .every((group) => getCoopDefenseEnemyConfig(group.enemyKind).movementTarget === 'bases')).toBe(true);

    const map3 = getCoopDefenseMapConfig('3');
    expect(map3.bases[0]?.anchor).toEqual({ kind: 'center-offset', dxCells: 0, dyCells: 2 });
    expect(map3.encounters?.flatMap((encounter) => encounter.groups)
      .every((group) => group.front === 'west' || group.front === 'east')).toBe(true);
    expect(map3.encounters?.flatMap((encounter) => encounter.groups)
      .some((group) => group.enemyKind === 'spore-warden')).toBe(false);

    const map4 = getCoopDefenseMapConfig('4');
    expect(map4.encounters?.flatMap((encounter) => encounter.groups)
      .every((group) => group.front === 'west')).toBe(true);

    const map5 = getCoopDefenseMapConfig('5');
    expect(new Set(map5.encounters?.flatMap((encounter) => encounter.groups.map((group) => group.front))))
      .toEqual(new Set(['west', 'south']));

    const map6 = getCoopDefenseMapConfig('6');
    expect(map6.encounters?.flatMap((encounter) => encounter.groups)
      .some((group) => group.enemyKind === 'void-stalker')).toBe(false);
    const map6SporeGroups = map6.encounters?.flatMap((encounter) => encounter.groups)
      .filter((group) => group.enemyKind === 'spore-warden') ?? [];
    expect(map6SporeGroups.length).toBeGreaterThan(0);
    expect(map6SporeGroups.every((group) => group.count > 0)).toBe(true);

    const map7 = getCoopDefenseMapConfig('7');
    expect(map7.encounters?.flatMap((encounter) => encounter.groups)
      .every((group) => group.front === 'west')).toBe(true);
    const map7MedicGroups = map7.encounters?.flatMap((encounter) => encounter.groups)
      .filter((group) => group.enemyKind === 'plague-medic') ?? [];
    expect(map7MedicGroups.length).toBeGreaterThan(0);
    expect(map7MedicGroups.every((group) => group.count > 0)).toBe(true);

    const map10 = getCoopDefenseMapConfig('10');
    expect(map10.bases.filter((base) => (base.role ?? 'main') === 'main')).toHaveLength(1);
    expect(map10.bases[0]?.anchor).toEqual({ kind: 'center-offset', dxCells: -6, dyCells: 0 });

    const map11 = getCoopDefenseMapConfig('11');
    const map11Fronts = new Set(map11.encounters?.flatMap((encounter) => encounter.groups.map((group) => group.front)));
    expect(map11Fronts.size).toBeGreaterThan(1);

    const map14 = getCoopDefenseMapConfig('14');
    expect(new Set(map14.encounters?.flatMap((encounter) => encounter.groups.map((group) => group.front))))
      .toEqual(new Set(['west', 'north', 'south']));
  });

  it('keeps the Map 8 bastion compact, separated and independently authored', () => {
    const map8 = getCoopDefenseMapConfig('8');
    expect(map8.encounters?.flatMap((encounter) => encounter.groups)
      .some((group) => group.front === 'north')).toBe(true);
    expect(map8.bases.filter((base) => (base.role ?? 'main') === 'main')).toHaveLength(1);
    // Die Bastion traegt die komplette Turmverteidigung der Map; die Hauptbasis hat keine Tuerme mehr.
    const map8Outposts = map8.bases.filter((base) => base.id.startsWith('friendly-outpost-bastion-'));
    expect(map8Outposts.map((base) => base.id)).toEqual([
      'friendly-outpost-bastion-north',
      'friendly-outpost-bastion-center',
      'friendly-outpost-bastion-south',
    ]);
    expect(map8Outposts.every((base) => base.role === 'outpost' && base.dormant === true)).toBe(true);
    expect(map8Outposts.map((base) => base.hpMax)).toEqual([1200, 2000, 1200]);
    expect(map8Outposts.map((base) => base.startHpFactor)).toEqual([0.25, 0.25, 0.25]);
    expect(map8Outposts.flatMap((base) => base.turrets ?? []).map((turret) => turret.weaponId)).toEqual([
      'SPORE_TURRET_PLASMA',
      'TURRET_ROCKET_BURST',
      'TURRET_ROCKET_BURST',
      'SPORE_TURRET_PLASMA',
    ]);
    expect(map8Outposts.map((base) => base.anchor.kind === 'grid' ? base.anchor.gridY : null))
      .toEqual([16, 23, 31]);
    expect(map8.bases.find((base) => base.id === 'coop-base-rear')?.turrets).toEqual([]);
    expect(map8.secondaryObjectives?.[0]?.start).toEqual({ type: 'time', atMs: 0 });
    expect(map8.secondaryObjectives?.[0]?.holdUntil).toEqual({ type: 'after-encounter', encounterId: 'dimension-west' });
    expect(map8.secondaryObjectives?.[0]?.requiredSurvivors).toBe(1);
    expect(map8.secondaryObjectives?.[0]?.targets).toEqual(map8Outposts.map((base) => base.id));
  });

  it('requires the bounded survival contract on every survival map', () => {
    const survivalMaps = COOP_DEFENSE_MAP_CONFIGS.filter(({ objective }) => objective === 'survive');
    expect(survivalMaps.map((map) => map.mapId)).toEqual(['0', '9', '14', '18', '19']);
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

  it('keeps Maps 1 to 4 schedulable without snapshotting their balance totals', () => {
    for (const mapId of ['1', '2', '3', '4']) {
      const map = getCoopDefenseMapConfig(mapId);
      const scheduledXp = getCoopDefenseMapScheduledXp(map, 1);
      expect(Number.isFinite(scheduledXp), mapId).toBe(true);
      expect(scheduledXp, mapId).toBeGreaterThanOrEqual(0);
    }
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
    const authoredBalanceOffsets = new Map([
      ['friendly-outpost-bastion-north', 1],
      ['friendly-outpost-bastion-south', 3],
    ]);
    for (const base of singleTurretBases) {
      const { height } = getShapeBounds(base.shape);
      expect(base.turrets?.[0].cellOffset.gridY)
        .toBe(authoredBalanceOffsets.get(base.id) ?? Math.floor(height / 2));
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
    const map = getCoopDefenseMapConfig('13');
    const finiteXp = getCoopDefenseMapScheduledXp(map, 2);
    const persistentSpawns = resolveCoopDefenseMapPersistentSpawnConfigs(map, 2);
    expect(finiteXp).toBe(0);
    expect(persistentSpawns.length).toBeGreaterThan(0);
    expect(getCoopDefenseMapXpReference(map, persistentSpawns, 2)).toBeGreaterThan(finiteXp);
  });

  it('uses the explicit balance reference only for pressure/drop normalization', () => {
    const map = getCoopDefenseMapConfig('13');
    const persistentSpawns = resolveCoopDefenseMapPersistentSpawnConfigs(map, 1);
    const shortReference = { ...map, balanceReferenceDurationSec: 1 };
    const longReference = { ...map, balanceReferenceDurationSec: 120 };

    expect(getCoopDefenseMapXpReference(longReference, persistentSpawns, 1))
      .toBeGreaterThan(getCoopDefenseMapXpReference(shortReference, persistentSpawns, 1));
    expect(longReference.objective).toBe('destroy-hostile-bases');
    expect(longReference.boss).toBeUndefined();
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

  it('keeps authored base pickups on the enlarged bases of maps 6 and 8', () => {
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

    const map6 = getCoopDefenseMapConfig('6');
    expect(map6.bases).toHaveLength(1);
    expect(map6.bases[0]?.anchor).toEqual({ kind: 'center-offset', dxCells: 0, dyCells: 0 });
    expect(map6.bases[0]?.hpMax).toBeGreaterThan(0);
    expect(map6.bases[0]?.powerUpPedestals?.map((pedestal) => pedestal.defId)).toEqual(expect.arrayContaining([
      'HEALTH_PACK',
      'ADRENALINE',
      'ARMOR',
      'DOUBLE_DAMAGE',
    ]));
    expect(map6.bases[0]?.turrets?.map((turret) => ({
      id: turret.id,
      cellOffset: turret.cellOffset,
      weaponId: turret.weaponId,
    }))).toEqual([
      { id: 'rocket-northwest', cellOffset: { gridX: 0, gridY: 0 }, weaponId: 'TURRET_ROCKET_BURST' },
      { id: 'spore-northeast', cellOffset: { gridX: 4, gridY: 0 }, weaponId: 'BASE_SPORES' },
      { id: 'spore-southwest', cellOffset: { gridX: 0, gridY: 4 }, weaponId: 'BASE_SPORES' },
      { id: 'rocket-southeast', cellOffset: { gridX: 4, gridY: 4 }, weaponId: 'TURRET_ROCKET_BURST' },
    ]);
    expect(map6.bases[0]?.powerUpPedestals?.map((pedestal) => ({
      defId: pedestal.defId,
      cellOffset: pedestal.cellOffset,
    }))).toEqual([
      { defId: 'HEALTH_PACK', cellOffset: { gridX: 2, gridY: 0 } },
      { defId: 'ADRENALINE', cellOffset: { gridX: 0, gridY: 2 } },
      { defId: 'ARMOR', cellOffset: { gridX: 2, gridY: 4 } },
      { defId: 'DOUBLE_DAMAGE', cellOffset: { gridX: 4, gridY: 2 } },
    ]);
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

  it('keeps dynamic time authored on the stress and Void-Hunter maps', () => {
    const dynamicMaps = COOP_DEFENSE_MAP_CONFIGS
      .filter((map) => map.dynamicTimeOfDay !== undefined)
      .map((map) => map.mapId);
    // Map 0 ist die Stressarena mit laufender Tageszeit; Map 15 nutzt zusaetzlich
    // ereignisgebundene Uebergaenge fuer den Leerenjaeger.
    expect(dynamicMaps).toEqual(['0', '15']);

    const voidMap = getCoopDefenseMapConfig('15');
    expect(voidMap.dynamicTimeOfDay?.transitions).toEqual([
      {
        start: { type: 'boss-spawn' },
        targetTimeOfDay: '21:30',
        durationMs: 2_800,
      },
      {
        start: { type: 'boss-phase', phase: 2 },
        targetTimeOfDay: '23:30',
        durationMs: 0,
      },
    ]);
    expect(voidMap.boss?.spawnAtMs).toBe(2_500);
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
      dynamicTimeOfDay: {
        transitions: [{
          start: { type: 'boss-phase', phase: 2 },
          targetTimeOfDay: '23:30',
          durationMs: 100,
        }],
      },
    })).toThrow(/must be instantaneous/i);
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

  it('integrates Map 13 Destroy through dormant persistent spawn structures', () => {
    const map = getCoopDefenseMapConfig('13');
    const destroy = map.secondaryObjectives?.find((objective) => objective.type === 'destroy');

    expect(map.objective).toBe('destroy-hostile-bases');
    expect(destroy).toBeDefined();
    expect(destroy?.start).toEqual({ type: 'time', atMs: 0 });
    expect(destroy?.focusUntil).toBeUndefined();
    expect(destroy?.rewards?.xpPerTarget).toBeGreaterThan(0);

    const targets = destroy?.targets ?? [];
    const targetBases = targets.map((targetId) => map.bases.find((base) => base.id === targetId));
    const structureBoundSources = new Set(
      (map.persistentSpawns ?? [])
        .filter((spawn) => spawn.source.type === 'base')
        .map((spawn) => spawn.source.type === 'base' ? spawn.source.baseId : ''),
    );

    expect(targets.length).toBeGreaterThanOrEqual(3);
    expect(new Set(targets).size).toBe(targets.length);
    expect(targetBases.every((base) => (
      base?.dormant === true
      && base.role === 'spawn-point'
      && base.faction === 'hostile'
      && structureBoundSources.has(base.id)
    ))).toBe(true);
    expect(targetBases.some((base) => base?.role === 'main')).toBe(false);

  });

  it('uses Map 14 as a 180-second survival map with rock and Void-Fire lanes', () => {
    const map = getCoopDefenseMapConfig('14');
    expect(map.objective).toBe('survive');
    expect(map.surviveDurationSec).toBeGreaterThan(0);
    expect(map.respawnsPerPlayer).toBeGreaterThanOrEqual(0);
    expect(map.secondaryObjectives).toEqual([]);
    expect(map.trackMode).toBe('void-fire');
    expect(map.rockField).toBeDefined();
    expect(map.mapEvents.some((event) => event.type === 'ground-hazard')).toBe(true);
  });

  it('keeps the campaign secondary objectives on their authored maps', () => {
    const campaignObjectives = COOP_DEFENSE_MAP_CONFIGS
      .filter((map) => map.mapId !== '0')
      .flatMap((map) => map.secondaryObjectives ?? []);
    expect(campaignObjectives.map((objective) => `${objective.type}:${objective.id}`)).toEqual([
      'hold:hold-tutorial-outpost',
      'hold:hold-dimension-bastion',
      'destroy:destroy-brutbomben-front',
      'hold:hold-zeitzunder-middle-outpost',
      'carry:carry-beer-to-rear-base',
    ]);
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
