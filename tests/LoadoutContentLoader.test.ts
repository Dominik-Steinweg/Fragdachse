import { describe, expect, it } from 'vitest';
import {
  LoadoutContentError,
  buildLoadoutRegistries,
  type LoadoutContentSource,
} from '../src/loadout/content/LoadoutContentLoader';
import { getViteLoadoutContentSources } from '../src/loadout/content/ViteContentSource';

type MutableDocument = Record<string, unknown> & {
  weapons?: Record<string, Record<string, unknown>>;
  utilities?: Record<string, Record<string, unknown>>;
  ultimates?: Record<string, Record<string, unknown>>;
  defaultLoadout?: Record<string, string>;
};

function clonedSources(): LoadoutContentSource[] {
  return getViteLoadoutContentSources().map((source) => ({
    sourceName: source.sourceName,
    document: structuredClone(source.document),
  }));
}

function documentWith(
  sources: readonly LoadoutContentSource[],
  registry: 'weapons' | 'utilities' | 'ultimates',
  id: string,
): MutableDocument {
  const document = sources
    .map((source) => source.document as MutableDocument)
    .find((candidate) => candidate[registry]?.[id]);
  if (!document) throw new Error(`${registry}.${id} fehlt in den Testquellen`);
  return document;
}

function expectContentError(run: () => unknown, fragment: string): void {
  try {
    run();
    throw new Error('LoadoutContentError erwartet');
  } catch (error) {
    expect(error).toBeInstanceOf(LoadoutContentError);
    expect((error as Error).message).toContain(fragment);
  }
}

describe('loadout content loader', () => {
  it('builds the shipped unified registries and freezes every exposed value', () => {
    const built = buildLoadoutRegistries(clonedSources());
    expect(Object.keys(built.weapons)).toHaveLength(50);
    expect(Object.keys(built.utilities)).toHaveLength(14);
    expect(Object.keys(built.ultimates)).toHaveLength(5);
    expect(built.defaultLoadout.weapon1).toBe(built.weapons.GLOCK);
    expect(built.defaultLoadout.utility).toBe(built.utilities.HE_GRENADE);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.weapons)).toBe(true);
    expect(Object.isFrozen(built.weapons.ROCKET_LAUNCHER.fire)).toBe(true);
    expect(Object.isFrozen(built.catalog)).toBe(true);
    expect(typeof built.weapons.GLOCK.projectileColor).toBe('number');
  });

  it('is deterministic across source order and source renames', () => {
    const sources = clonedSources();
    const baseline = buildLoadoutRegistries(sources);
    const reordered = buildLoadoutRegistries(
      [...sources].reverse().map((source, index) => ({
        sourceName: `renamed-${index}.json`,
        document: source.document,
      })),
    );
    expect(reordered).toEqual(baseline);
  });

  it('rejects duplicate global IDs and registry-key/config-ID mismatches', () => {
    const duplicateSources = clonedSources();
    const utilityDocument = documentWith(duplicateSources, 'utilities', 'HE_GRENADE');
    utilityDocument.utilities!.GLOCK = { id: 'GLOCK' };
    expectContentError(() => buildLoadoutRegistries(duplicateSources), 'doppelte ID');

    const mismatchSources = clonedSources();
    documentWith(mismatchSources, 'weapons', 'GLOCK').weapons!.GLOCK.id = 'WRONG';
    expectContentError(() => buildLoadoutRegistries(mismatchSources), 'stimmt nicht mit Config-ID');
  });

  it('rejects unknown bases, cycles and inheritance chains longer than two edges', () => {
    const unknownSources = clonedSources();
    documentWith(unknownSources, 'weapons', 'GLOCK').weapons!.UNKNOWN_BASE_TEST = {
      id: 'UNKNOWN_BASE_TEST', baseId: 'DOES_NOT_EXIST', _notes: 'test',
    };
    expectContentError(() => buildLoadoutRegistries(unknownSources), 'unbekannte Basis');

    const cycleSources = clonedSources();
    const cycleWeapons = documentWith(cycleSources, 'weapons', 'GLOCK').weapons!;
    cycleWeapons.CYCLE_A = { id: 'CYCLE_A', baseId: 'CYCLE_B', _notes: 'test' };
    cycleWeapons.CYCLE_B = { id: 'CYCLE_B', baseId: 'CYCLE_A', _notes: 'test' };
    expectContentError(() => buildLoadoutRegistries(cycleSources), 'Vererbungszyklus');

    const deepSources = clonedSources();
    const deepWeapons = documentWith(deepSources, 'weapons', 'GLOCK').weapons!;
    deepWeapons.DEPTH_A = { id: 'DEPTH_A', baseId: 'GLOCK', _notes: 'test' };
    deepWeapons.DEPTH_B = { id: 'DEPTH_B', baseId: 'DEPTH_A', _notes: 'test' };
    deepWeapons.DEPTH_C = { id: 'DEPTH_C', baseId: 'DEPTH_B', _notes: 'test' };
    expectContentError(() => buildLoadoutRegistries(deepSources), 'maximal zwei Vererbungsstufen');
  });

  it('deep-merges objects, replaces arrays and strips raw variant metadata', () => {
    const sources = clonedSources();
    documentWith(sources, 'weapons', 'GLOCK').weapons!.GLOCK_VARIANT_TEST = {
      id: 'GLOCK_VARIANT_TEST',
      baseId: 'GLOCK',
      _notes: 'The test intentionally couples this variant to GLOCK.',
      damage: 17,
      allowedSlots: ['weapon2'],
      fire: { projectileSpeed: 777 },
    };
    const config = buildLoadoutRegistries(sources).weapons.GLOCK_VARIANT_TEST as unknown as Record<string, unknown>;
    expect(config.damage).toBe(17);
    expect(config.allowedSlots).toEqual(['weapon2']);
    expect((config.fire as Record<string, unknown>).projectileSpeed).toBe(777);
    expect((config.fire as Record<string, unknown>).projectileSize).toBe(2);
    expect(config).not.toHaveProperty('baseId');
    expect(config).not.toHaveProperty('_notes');
  });

  it('allows null to remove optional inherited fields but rejects required fields', () => {
    const optionalSources = clonedSources();
    documentWith(optionalSources, 'weapons', 'ROCKET_LAUNCHER').weapons!.ROCKET_WITHOUT_EXPLOSION_TEST = {
      id: 'ROCKET_WITHOUT_EXPLOSION_TEST',
      baseId: 'ROCKET_LAUNCHER',
      _notes: 'The optional impact explosion is intentionally removed.',
      fire: { impactExplosion: null },
    };
    const optional = buildLoadoutRegistries(optionalSources).weapons.ROCKET_WITHOUT_EXPLOSION_TEST;
    expect(optional.fire).not.toHaveProperty('impactExplosion');

    const requiredSources = clonedSources();
    documentWith(requiredSources, 'weapons', 'GLOCK').weapons!.GLOCK_WITHOUT_DAMAGE_TEST = {
      id: 'GLOCK_WITHOUT_DAMAGE_TEST', baseId: 'GLOCK', _notes: 'invalid test', damage: null,
    };
    expectContentError(() => buildLoadoutRegistries(requiredSources), 'damage');
  });

  it('rejects discriminator changes, unknown fields and malformed colors', () => {
    const discriminatorSources = clonedSources();
    documentWith(discriminatorSources, 'weapons', 'GLOCK').weapons!.GLOCK_HITSCAN_TEST = {
      id: 'GLOCK_HITSCAN_TEST', baseId: 'GLOCK', _notes: 'invalid test', fire: { type: 'hitscan' },
    };
    expectContentError(() => buildLoadoutRegistries(discriminatorSources), 'Discriminator darf nicht');

    const utilityTypeSources = clonedSources();
    documentWith(utilityTypeSources, 'utilities', 'HE_GRENADE').utilities!.HE_VARIANT_TEST = {
      id: 'HE_VARIANT_TEST', baseId: 'HE_GRENADE', _notes: 'invalid test', type: 'smoke',
    };
    expectContentError(() => buildLoadoutRegistries(utilityTypeSources), 'Discriminator darf nicht');

    const activationSources = clonedSources();
    documentWith(activationSources, 'utilities', 'HE_GRENADE').utilities!.HE_INSTANT_TEST = {
      id: 'HE_INSTANT_TEST', baseId: 'HE_GRENADE', _notes: 'invalid test', activation: { type: 'instant' },
    };
    expectContentError(() => buildLoadoutRegistries(activationSources), 'Discriminator darf nicht');

    const placeableSources = clonedSources();
    documentWith(placeableSources, 'utilities', 'FELSBAU').utilities!.FELSBAU_TURRET_TEST = {
      id: 'FELSBAU_TURRET_TEST', baseId: 'FELSBAU', _notes: 'invalid test', placeable: { kind: 'turret' },
    };
    expectContentError(() => buildLoadoutRegistries(placeableSources), 'Discriminator darf nicht');

    const ultimateSources = clonedSources();
    documentWith(ultimateSources, 'ultimates', 'AIRSTRIKE').ultimates!.AIRSTRIKE_BUFF_TEST = {
      id: 'AIRSTRIKE_BUFF_TEST', baseId: 'AIRSTRIKE', _notes: 'invalid test', type: 'buff',
    };
    expectContentError(() => buildLoadoutRegistries(ultimateSources), 'Discriminator darf nicht');

    const placementSources = clonedSources();
    documentWith(placementSources, 'ultimates', 'DACHS_TUNNEL').ultimates!.TUNNEL_PLACEMENT_TEST = {
      id: 'TUNNEL_PLACEMENT_TEST', baseId: 'DACHS_TUNNEL', _notes: 'invalid test', placement: { kind: 'rock' },
    };
    expectContentError(() => buildLoadoutRegistries(placementSources), 'Discriminator darf nicht');

    const unknownFieldSources = clonedSources();
    documentWith(unknownFieldSources, 'weapons', 'GLOCK').weapons!.GLOCK.typoDamage = 4;
    expectContentError(() => buildLoadoutRegistries(unknownFieldSources), 'unbekanntes Feld');

    const colorSources = clonedSources();
    documentWith(colorSources, 'weapons', 'GLOCK').weapons!.GLOCK.projectileColor = '#abc';
    expectContentError(() => buildLoadoutRegistries(colorSources), 'Farbe muss #RRGGBB sein');
  });

  it('requires a coupling rationale for every variant', () => {
    const sources = clonedSources();
    documentWith(sources, 'weapons', 'GLOCK').weapons!.GLOCK_VARIANT_WITHOUT_NOTES = {
      id: 'GLOCK_VARIANT_WITHOUT_NOTES', baseId: 'GLOCK', damage: 7,
    };
    expectContentError(() => buildLoadoutRegistries(sources), 'Varianten benötigen eine Begründung');
  });

  it('rejects invalid default-loadout references and slot assignments', () => {
    const sources = clonedSources();
    const defaultDocument = sources
      .map((source) => source.document as MutableDocument)
      .find((document) => document.defaultLoadout);
    if (!defaultDocument?.defaultLoadout) throw new Error('Default-Loadout-Testquelle fehlt');
    defaultDocument.defaultLoadout.weapon1 = 'ROCKET_LAUNCHER';
    expectContentError(() => buildLoadoutRegistries(sources), 'defaultLoadout.weapon1');
  });

  it('rejects implausible numbers, registry-specific slots and unknown modes', () => {
    const numberSources = clonedSources();
    documentWith(numberSources, 'weapons', 'GLOCK').weapons!.GLOCK.cooldown = -1;
    expectContentError(() => buildLoadoutRegistries(numberSources), 'negative Zahl');

    const slotSources = clonedSources();
    documentWith(slotSources, 'weapons', 'GLOCK').weapons!.GLOCK.allowedSlots = ['utility'];
    expectContentError(() => buildLoadoutRegistries(slotSources), 'allowedSlots');

    const modeSources = clonedSources();
    documentWith(modeSources, 'ultimates', 'AIRSTRIKE').ultimates!.AIRSTRIKE.allowedModes = ['unknown_mode'];
    expectContentError(() => buildLoadoutRegistries(modeSources), 'allowedModes');
  });
});
