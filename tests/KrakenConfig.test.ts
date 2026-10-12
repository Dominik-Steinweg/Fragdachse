import { describe, expect, it } from 'vitest';
import { KRAKEN_BOSS_DEFAULTS, normalizeKrakenBossConfig, validateKrakenBroodRegistry } from '../src/config/krakenBoss';
import { COOP_DEFENSE_ENEMY_CONFIGS, MAX_REGULAR_ENEMY_SIZE_PX, normalizeEnemyRegistry, type CoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { findWeaponConfig } from '../src/loadout/LoadoutConfig';
import { normalizeKrakenHabitat, type KrakenHabitatConfig } from '../src/config/krakenHabitat';
import { normalizeCoopDefenseMapConfig } from '../src/config/coopDefenseMapAuthoring';
import { toAuthoredScenario, toCoopDefenseMapConfig, toWorldGenerationConfig } from '../src/config/authoring/coopDefenseAuthoringAdapter';
import { KRAKEN_RISE_INTRO, getBossIntroPreset, readBossIntroState } from '../src/config/bossIntros';

const defaults = () => structuredClone(KRAKEN_BOSS_DEFAULTS);
const isMelee = (id: string) => findWeaponConfig(id)?.fire.type === 'melee';
const habitat = (): KrakenHabitatConfig => ({ id: 'pond', kind: 'water', initialAnchorId: 'center',
  waterAnchors: [{ id: 'center', cell: { gridX: 5, gridY: 5 } }],
  shores: [{ id: 'south', waterCell: { gridX: 5, gridY: 7 }, landCell: { gridX: 5, gridY: 8 } },
    { id: 'east', waterCell: { gridX: 7, gridY: 5 }, landCell: { gridX: 8, gridY: 5 } }],
  exits: [{ id: 'south-exit', fromAnchorId: 'center', shoreId: 'south', widthCells: 3,
    path: [{ gridX: 5, gridY: 5 }, { gridX: 5, gridY: 8 }, { gridX: 5, gridY: 10 }] },
  { id: 'east-exit', fromAnchorId: 'center', shoreId: 'east', widthCells: 3,
    path: [{ gridX: 5, gridY: 5 }, { gridX: 8, gridY: 5 }, { gridX: 10, gridY: 5 }] }],
});
const water = Array.from({ length: 25 }, (_, i) => ({ gridX: 3 + i % 5, gridY: 3 + Math.floor(i / 5) }));
const context = { widthCells: 20, heightCells: 20, water, bodyRadiusCells: 1 };

describe('kraken registry authoring', () => {
  it('resolves authored data and validates the brood against actual melee configs', () => {
    expect(normalizeKrakenBossConfig(defaults())).toEqual(KRAKEN_BOSS_DEFAULTS);
    expect(() => validateKrakenBroodRegistry(defaults(), COOP_DEFENSE_ENEMY_CONFIGS, isMelee, MAX_REGULAR_ENEMY_SIZE_PX)).not.toThrow();
    const c = defaults(); c.ink.damage *= 2; c.dive.intervalMs *= 1.5;
    expect(normalizeKrakenBossConfig(c)).toEqual(c);
  });
  it('validates authored travel distances and the grenade presentation reference', () => {
    const c = defaults(); c.waterShoreDistancePx += 10; c.eggs.throwDistancePx *= 1.2;
    c.eggs.minimumShoreDistancePx += 30; c.eggs.releaseSpacingMs *= 2; c.eggs.presentationPreset = 'he';
    expect(normalizeKrakenBossConfig(c)).toEqual(c);
    for (const field of ['throwDistancePx', 'minimumShoreDistancePx', 'releaseSpacingMs'] as const) {
      expect(() => normalizeKrakenBossConfig({ ...c, eggs: { ...c.eggs, [field]: 0 } })).toThrow();
    }
    expect(() => normalizeKrakenBossConfig({ ...c, waterShoreDistancePx: -1 })).toThrow();
    expect(() => normalizeKrakenBossConfig({ ...c, eggs: { ...c.eggs, presentationPreset: 'missing' } })).toThrow();
  });
  it('rejects nonfinite tuning, missing profile IDs and impossible action anchors', () => {
    const c = defaults(); c.ink.range = NaN;
    expect(() => normalizeKrakenBossConfig(c)).toThrow();
    c.ink.range = KRAKEN_BOSS_DEFAULTS.ink.range; c.tentacles.hitboxProfileId = 'unknown';
    expect(() => normalizeKrakenBossConfig(c)).toThrow();
    const d = defaults(); d.dive.submergedAtMs = d.dive.durationMs + 1;
    expect(() => normalizeKrakenBossConfig(d)).toThrow();
    expect(() => normalizeKrakenBossConfig({ ...defaults(), transfer: { ...defaults().transfer, ownHp: true } })).toThrow();
  });
  it('rejects unknown, boss, ranged and recursively spawning brood', () => {
    const c = defaults(), kind = c.eggs.broodTable.entries[0].enemyKind;
    expect(() => validateKrakenBroodRegistry(c, {}, isMelee, MAX_REGULAR_ENEMY_SIZE_PX)).toThrow();
    for (const patch of [{ isBoss: true }, { deathSpawns: [{ enemyKind: kind, count: 1, offsetPx: 1 }] },
      { weapons: [{ weaponId: 'MISSING_WEAPON', targetMode: 'all' as const }] }]) {
      expect(() => validateKrakenBroodRegistry(c, { [kind]: { ...COOP_DEFENSE_ENEMY_CONFIGS[kind], ...patch } } as Record<string, CoopDefenseEnemyConfig>, isMelee, MAX_REGULAR_ENEMY_SIZE_PX)).toThrow();
    }
  });
  it('allows only exclusive boss/stationary egg roles with valid registry references', () => {
    const c = defaults(), regular = COOP_DEFENSE_ENEMY_CONFIGS[c.eggs.broodTable.entries[0].enemyKind];
    const entries = [
      { ...regular, id: c.eggs.broodTable.entries[0].enemyKind },
      { ...regular, id: 'boss', size: c.bodyRadiusPx * 2, isBoss: true, weapons: [], krakenBoss: c },
      { ...regular, id: c.eggs.enemyKind, size: c.eggs.radiusPx * 2, maxHp: c.eggs.maxHp, xp: 0, moveSpeed: 0, weapons: [],
        krakenEgg: { assetId: c.assets.egg, stationary: true as const, drops: false as const,
          necromancy: false as const, countsForEncounter: false as const, navigation: false as const } },
    ];
    const result = normalizeEnemyRegistry({ enemies: entries });
    expect(result.boss.krakenBoss).toEqual(c);
    expect(result[c.eggs.enemyKind].moveSpeed).toBe(0);
    expect(result[c.eggs.enemyKind].weapons).toEqual([]);
    expect(() => normalizeEnemyRegistry({ enemies: entries.slice(0, 2) })).toThrow('egg reference');
    expect(() => normalizeEnemyRegistry({ enemies: entries.map(e => e.id === 'boss' ? { ...e, weapons: regular.weapons } : e) })).toThrow('exclusive');
    expect(() => normalizeEnemyRegistry({ enemies: entries.map(e => e.id === 'boss'
      ? { ...e, deathSpawns: [{ enemyKind: regular.imageKey, count: 1, offsetPx: 0 }] } : e) })).toThrow('ability owner');
  });
});

describe('water habitat authoring', () => {
  it('preserves two exits and rejects disconnected or partially covered water anchors', () => {
    expect(normalizeKrakenHabitat(habitat(), context)).toEqual(habitat());
    const h = habitat(); h.waterAnchors.push({ id: 'other', cell: { gridX: 15, gridY: 15 } });
    expect(() => normalizeKrakenHabitat(h, { ...context, water: [...water, { gridX: 15, gridY: 15 }] })).toThrow('one pond');
    expect(() => normalizeKrakenHabitat(habitat(), { ...context, bodyRadiusCells: 4 })).toThrow('full body');
  });
  it('rejects missing/duplicate references, wet exit ends and undersized corridors', () => {
    const cases = [habitat(), habitat(), habitat(), habitat()];
    cases[0].exits[0].fromAnchorId = 'absent'; cases[1].exits[1].id = cases[1].exits[0].id;
    cases[2].exits[0].path.push({ gridX: 5, gridY: 6 }); cases[3].exits[0].widthCells = 1;
    for (const h of cases) expect(() => normalizeKrakenHabitat(h, context)).toThrow();
  });
  it('round-trips habitat in the World without materializing a boss or renormalizing the map', () => {
    const map = normalizeCoopDefenseMapConfig({ mapId: 'habitat-contract', arenaWidthCells: 60, arenaHeightCells: 34,
      objective: 'survive', surviveDurationSec: 60, balanceReferenceDurationSec: 60, respawnsPerPlayer: 0,
      water, krakenHabitat: habitat(), trackMode: 'none', bases: [], powerUps: [], encounters: [] });
    const scenario = toAuthoredScenario(map);
    expect(scenario.world.krakenHabitat).toEqual(map.krakenHabitat);
    expect(scenario.activity?.boss).toBeUndefined();
    expect(toCoopDefenseMapConfig(scenario).krakenHabitat).toEqual(map.krakenHabitat);
    expect(toWorldGenerationConfig(scenario.world).krakenHabitat).toEqual(map.krakenHabitat);
  });
});

it('keeps the water intro anchor and camera return later than spawn', () => {
  const intro = { preset: 'kraken-rise', x: 5, y: 10, startedAtMs: 25, seed: 1, habitatId: 'pond', waterAnchorId: 'center' };
  expect(readBossIntroState(intro)).toEqual(intro);
  expect(readBossIntroState({ ...intro, waterAnchorId: undefined })).toBeNull();
  expect(getBossIntroPreset('kraken-rise')).toBe(KRAKEN_RISE_INTRO);
  expect(KRAKEN_RISE_INTRO.durationMs).toBeGreaterThan(KRAKEN_RISE_INTRO.emergeAtMs);
  expect(KRAKEN_RISE_INTRO.durationMs).toBe(KRAKEN_RISE_INTRO.emergeAtMs
    + KRAKEN_RISE_INTRO.camera.holdAfterEmergeMs + KRAKEN_RISE_INTRO.camera.panOutMs);
});
