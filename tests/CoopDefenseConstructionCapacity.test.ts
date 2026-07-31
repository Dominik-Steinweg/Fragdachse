import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_BUILD_COOLDOWN_MS,
  COOP_DEFENSE_CONSTRUCTION_CAPACITY,
  COOP_DEFENSE_CONSTRUCTIONS,
  getCoopDefenseConstructionCapacity,
  getPlaceableCapacityCost,
  getToolCapacityCost,
  sumPlaceableCapacity,
} from '../src/config/coopDefenseConstructions';
import { UTILITY_CONFIGS, type PlaceableUtilityConfig } from '../src/loadout/LoadoutConfig';
import type { ConstructionId, PlaceableKind } from '../src/types';

interface PlacedStub {
  ownerId: string;
  kind: PlaceableKind;
  constructionId?: ConstructionId;
}

const OWNER = 'inspector';
const OTHER_OWNER = 'nukem';

const turret = (constructionId: ConstructionId, ownerId = OWNER): PlacedStub =>
  ({ ownerId, kind: 'turret', constructionId });
const wall = (ownerId = OWNER): PlacedStub => ({ ownerId, kind: 'rock' });
const mushroom = (ownerId = OWNER): PlacedStub => ({ ownerId, kind: 'turret' });

describe('construction capacity costs', () => {
  it('assigns the intended cost per construct type', () => {
    expect(COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.capacityCost).toBe(30);
    expect(COOP_DEFENSE_CONSTRUCTIONS.flame_turret.capacityCost).toBe(20);
    expect(COOP_DEFENSE_CONSTRUCTIONS.machine_gun_turret.capacityCost).toBe(10);
    expect(getToolCapacityCost({ kind: 'utility', id: 'FLIEGENPILZ' })).toBe(15);
    expect(getToolCapacityCost({ kind: 'utility', id: 'FELSBAU' })).toBe(1);
  });

  it('costs nothing for utilities that are not constructs', () => {
    expect(getToolCapacityCost({ kind: 'utility', id: 'HE_GRENADE' })).toBe(0);
    expect(getToolCapacityCost({ kind: 'utility', id: 'SMOKE_GRENADE' })).toBe(0);
    expect(getToolCapacityCost({ kind: 'utility', id: 'ZEUS_TASER' })).toBe(0);
  });

  it('derives the cost of a placed object from kind and constructionId alone', () => {
    // Bewusst kein eigenes Netzwerkfeld: die Kosten muessen allein aus dem replizierten
    // Snapshot ableitbar sein, sonst kostet jede Mauer ein Feld pro Objekt.
    expect(getPlaceableCapacityCost({ kind: 'turret', constructionId: 'rocket_turret' })).toBe(30);
    expect(getPlaceableCapacityCost({ kind: 'turret' })).toBe(15);   // Fliegenpilz
    expect(getPlaceableCapacityCost({ kind: 'rock' })).toBe(1);      // Felsbau
    expect(getPlaceableCapacityCost({ kind: 'tunnel' })).toBe(0);
  });

  it('uses one uniform build cooldown so capacity stays the limiting factor', () => {
    expect(COOP_DEFENSE_BUILD_COOLDOWN_MS).toBe(500);
    expect((UTILITY_CONFIGS.FELSBAU as PlaceableUtilityConfig).cooldown)
      .toBe(COOP_DEFENSE_BUILD_COOLDOWN_MS);
    expect((UTILITY_CONFIGS.FLIEGENPILZ as PlaceableUtilityConfig).cooldown)
      .toBe(COOP_DEFENSE_BUILD_COOLDOWN_MS);
  });

  it('keeps walls and mushrooms permanent instead of expiring', () => {
    expect((UTILITY_CONFIGS.FELSBAU as PlaceableUtilityConfig).placeable.lifetimeMs).toBe(0);
    expect((UTILITY_CONFIGS.FLIEGENPILZ as PlaceableUtilityConfig).placeable.lifetimeMs).toBe(0);
  });

  it('no longer charges adrenaline for any utility', () => {
    for (const config of Object.values(UTILITY_CONFIGS)) {
      expect(config).not.toHaveProperty('inspectorAdrenalineCost');
    }
  });
});

describe('used construction capacity', () => {
  it('sums mixed constructs per owner and ignores foreign ones', () => {
    const placed: PlacedStub[] = [
      turret('rocket_turret'),
      turret('machine_gun_turret'),
      turret('flame_turret'),
      mushroom(),
      wall(), wall(), wall(),
      turret('rocket_turret', OTHER_OWNER),
      wall(OTHER_OWNER),
    ];
    expect(sumPlaceableCapacity(placed, OWNER)).toBe(30 + 10 + 20 + 15 + 3);
    expect(sumPlaceableCapacity(placed, OTHER_OWNER)).toBe(31);
    expect(sumPlaceableCapacity(placed, 'unknown')).toBe(0);
  });

  it('frees capacity again when a construct is removed', () => {
    const placed: PlacedStub[] = [turret('rocket_turret'), turret('rocket_turret'), wall()];
    expect(sumPlaceableCapacity(placed, OWNER)).toBe(61);
    placed.splice(0, 1);
    expect(sumPlaceableCapacity(placed, OWNER)).toBe(31);
    placed.length = 0;
    expect(sumPlaceableCapacity(placed, OWNER)).toBe(0);
  });

  it('fits the reference defence of three rocket turrets plus ten walls exactly', () => {
    const placed: PlacedStub[] = [
      ...Array.from({ length: 3 }, () => turret('rocket_turret')),
      ...Array.from({ length: 10 }, () => wall()),
    ];
    expect(sumPlaceableCapacity(placed, OWNER)).toBe(COOP_DEFENSE_CONSTRUCTION_CAPACITY);
  });

  it('blocks a fourth rocket turret but still allows a cheap one', () => {
    // Dieselbe Entscheidungsregel wie in `ArenaLifecycleCoordinator.hasFreeConstructionCapacity`:
    // sie haengt weder an Adrenalin noch an der Rundendauer.
    const placed: PlacedStub[] = Array.from({ length: 3 }, () => turret('rocket_turret'));
    const used = sumPlaceableCapacity(placed, OWNER);
    expect(used).toBe(90);
    expect(used + COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.capacityCost)
      .toBeGreaterThan(COOP_DEFENSE_CONSTRUCTION_CAPACITY);
    expect(used + COOP_DEFENSE_CONSTRUCTIONS.machine_gun_turret.capacityCost)
      .toBeLessThanOrEqual(COOP_DEFENSE_CONSTRUCTION_CAPACITY);
  });

  describe('personal capacity maximum', () => {
    it('is the base capacity without any bonus', () => {
      expect(getCoopDefenseConstructionCapacity(0)).toBe(COOP_DEFENSE_CONSTRUCTION_CAPACITY);
      // Kaputte Eingaben duerfen das Gate nicht vergiften.
      expect(getCoopDefenseConstructionCapacity(Number.NaN)).toBe(COOP_DEFENSE_CONSTRUCTION_CAPACITY);
    });

    it('raises only the maximum, never the cost of an object', () => {
      const placed: PlacedStub[] = Array.from({ length: 3 }, () => turret('rocket_turret'));
      const used = sumPlaceableCapacity(placed, OWNER);
      const raised = getCoopDefenseConstructionCapacity(30);

      expect(raised).toBe(130);
      // Derselbe Bestand, dasselbe Kostenmodell - nur das Gate faellt jetzt anders aus.
      expect(sumPlaceableCapacity(placed, OWNER)).toBe(used);
      expect(COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.capacityCost).toBe(30);
      expect(used + COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.capacityCost)
        .toBeLessThanOrEqual(raised);
    });

    it('never drops below zero', () => {
      expect(getCoopDefenseConstructionCapacity(-500)).toBe(0);
    });
  });
});
