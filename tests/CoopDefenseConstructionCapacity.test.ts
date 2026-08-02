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
    for (const construction of Object.values(COOP_DEFENSE_CONSTRUCTIONS)) {
      expect(Number.isFinite(construction.capacityCost), construction.id).toBe(true);
      expect(construction.capacityCost, construction.id).toBeGreaterThanOrEqual(0);
    }
    expect(getToolCapacityCost({ kind: 'utility', id: 'FLIEGENPILZ' })).toBeGreaterThan(0);
    expect(getToolCapacityCost({ kind: 'utility', id: 'FELSBAU' })).toBeGreaterThan(0);
  });

  it('costs nothing for utilities that are not constructs', () => {
    expect(getToolCapacityCost({ kind: 'utility', id: 'HE_GRENADE' })).toBe(0);
    expect(getToolCapacityCost({ kind: 'utility', id: 'SMOKE_GRENADE' })).toBe(0);
    expect(getToolCapacityCost({ kind: 'utility', id: 'ZEUS_TASER' })).toBe(0);
  });

  it('derives the cost of a placed object from kind and constructionId alone', () => {
    // Bewusst kein eigenes Netzwerkfeld: die Kosten muessen allein aus dem replizierten
    // Snapshot ableitbar sein, sonst kostet jede Mauer ein Feld pro Objekt.
    expect(getPlaceableCapacityCost({ kind: 'turret', constructionId: 'rocket_turret' }))
      .toBe(COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.capacityCost);
    expect(getPlaceableCapacityCost({ kind: 'turret' }))
      .toBe(getToolCapacityCost({ kind: 'utility', id: 'FLIEGENPILZ' }));
    expect(getPlaceableCapacityCost({ kind: 'rock' }))
      .toBe(getToolCapacityCost({ kind: 'utility', id: 'FELSBAU' }));
    expect(getPlaceableCapacityCost({ kind: 'tunnel' })).toBe(0);
  });

  it('keeps construction cooldown separate from normal and Coop utility cooldowns', () => {
    expect(COOP_DEFENSE_BUILD_COOLDOWN_MS).toBeGreaterThan(0);
    expect((UTILITY_CONFIGS.FELSBAU as PlaceableUtilityConfig).cooldown).toBeGreaterThan(0);
    expect((UTILITY_CONFIGS.FLIEGENPILZ as PlaceableUtilityConfig).cooldown).toBeGreaterThan(0);
    expect((UTILITY_CONFIGS.FELSBAU_COOP as PlaceableUtilityConfig).cooldown)
      .toBe(COOP_DEFENSE_BUILD_COOLDOWN_MS);
    expect((UTILITY_CONFIGS.FLIEGENPILZ_COOP as PlaceableUtilityConfig).cooldown)
      .toBe(COOP_DEFENSE_BUILD_COOLDOWN_MS);
  });

  it('keeps normal placeables finite and Coop placeables permanent', () => {
    expect((UTILITY_CONFIGS.FELSBAU as PlaceableUtilityConfig).placeable.lifetimeMs).toBeGreaterThan(0);
    expect((UTILITY_CONFIGS.FLIEGENPILZ as PlaceableUtilityConfig).placeable.lifetimeMs).toBeGreaterThan(0);
    expect((UTILITY_CONFIGS.FELSBAU_COOP as PlaceableUtilityConfig).placeable.lifetimeMs).toBe(0);
    expect((UTILITY_CONFIGS.FLIEGENPILZ_COOP as PlaceableUtilityConfig).placeable.lifetimeMs).toBe(0);
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
    const expectedOwnerCapacity = (
      COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.capacityCost
      + COOP_DEFENSE_CONSTRUCTIONS.machine_gun_turret.capacityCost
      + COOP_DEFENSE_CONSTRUCTIONS.flame_turret.capacityCost
      + getToolCapacityCost({ kind: 'utility', id: 'FLIEGENPILZ' })
      + 3 * getToolCapacityCost({ kind: 'utility', id: 'FELSBAU' })
    );
    const expectedOtherCapacity = (
      COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.capacityCost
      + getToolCapacityCost({ kind: 'utility', id: 'FELSBAU' })
    );
    expect(sumPlaceableCapacity(placed, OWNER)).toBe(expectedOwnerCapacity);
    expect(sumPlaceableCapacity(placed, OTHER_OWNER)).toBe(expectedOtherCapacity);
    expect(sumPlaceableCapacity(placed, 'unknown')).toBe(0);
  });

  it('frees capacity again when a construct is removed', () => {
    const placed: PlacedStub[] = [turret('rocket_turret'), turret('rocket_turret'), wall()];
    const rocketCost = COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.capacityCost;
    const wallCost = getToolCapacityCost({ kind: 'utility', id: 'FELSBAU' });
    expect(sumPlaceableCapacity(placed, OWNER)).toBe(2 * rocketCost + wallCost);
    placed.splice(0, 1);
    expect(sumPlaceableCapacity(placed, OWNER)).toBe(rocketCost + wallCost);
    placed.length = 0;
    expect(sumPlaceableCapacity(placed, OWNER)).toBe(0);
  });

  it('sums a mixed construction inventory against the configured capacity', () => {
    const placed: PlacedStub[] = [
      ...Array.from({ length: 3 }, () => turret('rocket_turret')),
      ...Array.from({ length: 10 }, () => wall()),
    ];
    const expected = (
      3 * COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.capacityCost
      + 10 * getToolCapacityCost({ kind: 'utility', id: 'FELSBAU' })
    );
    expect(sumPlaceableCapacity(placed, OWNER)).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it('blocks the next expensive turret while allowing a cheaper one when it fits', () => {
    // Dieselbe Entscheidungsregel wie in `ArenaLifecycleCoordinator.hasFreeConstructionCapacity`:
    // sie haengt weder an Adrenalin noch an der Rundendauer.
    const placed: PlacedStub[] = [];
    const rocketCost = COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.capacityCost;
    expect(rocketCost).toBeGreaterThan(0);
    while (sumPlaceableCapacity(placed, OWNER) + rocketCost <= COOP_DEFENSE_CONSTRUCTION_CAPACITY) {
      placed.push(turret('rocket_turret'));
    }
    const used = sumPlaceableCapacity(placed, OWNER);
    expect(used).toBeLessThanOrEqual(COOP_DEFENSE_CONSTRUCTION_CAPACITY);
    expect(used + rocketCost)
      .toBeGreaterThan(COOP_DEFENSE_CONSTRUCTION_CAPACITY);
    const cheapCost = COOP_DEFENSE_CONSTRUCTIONS.machine_gun_turret.capacityCost;
    if (cheapCost <= COOP_DEFENSE_CONSTRUCTION_CAPACITY - used) {
      expect(used + cheapCost).toBeLessThanOrEqual(COOP_DEFENSE_CONSTRUCTION_CAPACITY);
    }
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

      expect(raised).toBe(COOP_DEFENSE_CONSTRUCTION_CAPACITY + 30);
      // Derselbe Bestand, dasselbe Kostenmodell - nur das Gate faellt jetzt anders aus.
      expect(sumPlaceableCapacity(placed, OWNER)).toBe(used);
      expect(COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.capacityCost).toBeGreaterThan(0);
      expect(used + COOP_DEFENSE_CONSTRUCTIONS.rocket_turret.capacityCost)
        .toBeLessThanOrEqual(raised);
    });

    it('never drops below zero', () => {
      expect(getCoopDefenseConstructionCapacity(-500)).toBe(0);
    });
  });
});
