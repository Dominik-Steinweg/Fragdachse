import { describe, expect, it } from 'vitest';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../src/config/coopDefenseConstructions';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import {
  classifyFireControlSource,
  FIRE_CONTROL_ELIGIBLE_CONSTRUCTION_IDS,
  FIRE_CONTROL_ELIGIBLE_FIRE_TYPES,
  type FireControlSourceFacts,
} from '../src/systems/fireControl/FireControlEligibility';

const ownTurret: FireControlSourceFacts = Object.freeze({
  requesterId: 'inspector',
  ownerId: 'inspector',
  baseOwned: false,
  constructionId: 'rocket_turret',
  weaponFireType: 'projectile',
  combatReady: true,
  isCopy: false,
});

describe('fire control eligibility', () => {
  it.each([
    'spore_turret', 'rocket_turret', 'machine_gun_turret',
    'flame_turret', 'gravity_turret', 'slow_bubble_turret',
  ])('allows the own combat-ready original %s for both utilities', constructionId => {
    for (const weaponFireType of ['projectile', 'flamethrower']) {
      expect(classifyFireControlSource({ ...ownTurret, constructionId, weaponFireType }))
        .toEqual({ copyable: true, portalSource: true, reason: 'eligible' });
    }
  });

  it.each([
    'tesla_turret', 'attack_drone_station', 'watchtower', 'rock_barrier',
    'medic_pedestal', 'armor_pedestal', 'unknown_turret', undefined,
  ])('rejects construction %s even with an allowed fire type', constructionId => {
    expect(classifyFireControlSource({ ...ownTurret, constructionId }))
      .toEqual({ copyable: false, portalSource: false, reason: 'construction_excluded' });
  });

  it.each(['tesla_dome', 'melee', 'unknown', undefined])('rejects the weapon variant %s', weaponFireType => {
    expect(classifyFireControlSource({ ...ownTurret, weaponFireType }))
      .toEqual({ copyable: false, portalSource: false, reason: 'fire_type_excluded' });
  });

  it('rejects foreign and base-owned sources, including active copies', () => {
    for (const isCopy of [false, true]) {
      expect(classifyFireControlSource({ ...ownTurret, isCopy, copyMaterialized: true, ownerId: 'other' }))
        .toEqual({ copyable: false, portalSource: false, reason: 'foreign_owner' });
      expect(classifyFireControlSource({ ...ownTurret, isCopy, copyMaterialized: true, baseOwned: true }))
        .toEqual({ copyable: false, portalSource: false, reason: 'base_owned' });
    }
  });

  it('requires regular combat permission for originals and materialized copies', () => {
    for (const isCopy of [false, true]) {
      expect(classifyFireControlSource({ ...ownTurret, isCopy, copyMaterialized: true, combatReady: false }))
        .toEqual({ copyable: false, portalSource: false, reason: 'not_combat_ready' });
    }
  });

  it('allows materialized copies only for portals, regardless of original pause state', () => {
    expect(classifyFireControlSource({
      ...ownTurret, isCopy: true, copyMaterialized: true, pausedByCopies: true,
    })).toEqual({ copyable: false, portalSource: true, reason: 'copy_not_copyable' });
    for (const copyMaterialized of [false, undefined]) {
      expect(classifyFireControlSource({ ...ownTurret, isCopy: true, copyMaterialized }))
        .toEqual({ copyable: false, portalSource: false, reason: 'copy_materializing' });
    }
  });

  it('never wakes paused originals through either utility', () => {
    expect(classifyFireControlSource({ ...ownTurret, pausedByCopies: true }))
      .toEqual({ copyable: false, portalSource: false, reason: 'paused_original' });
    expect(classifyFireControlSource({ ...ownTurret, pausedByCopies: false, copyMaterialized: false }))
      .toEqual({ copyable: true, portalSource: true, reason: 'eligible' });
  });

  it('reports the first exclusion in stable ownership/content/combat/lifecycle order', () => {
    const facts: FireControlSourceFacts = {
      ...ownTurret, ownerId: 'other', baseOwned: true, constructionId: 'tesla_turret',
      weaponFireType: 'tesla_dome', combatReady: false, pausedByCopies: true,
    };
    expect(classifyFireControlSource(facts).reason).toBe('foreign_owner');
    const owned = { ...facts, ownerId: facts.requesterId };
    expect(classifyFireControlSource(owned).reason).toBe('base_owned');
    const personal = { ...owned, baseOwned: false };
    expect(classifyFireControlSource(personal).reason).toBe('construction_excluded');
    const allowedConstruction = { ...personal, constructionId: 'rocket_turret' };
    expect(classifyFireControlSource(allowedConstruction).reason).toBe('fire_type_excluded');
    const allowedWeapon = { ...allowedConstruction, weaponFireType: 'projectile' };
    expect(classifyFireControlSource(allowedWeapon).reason).toBe('not_combat_ready');
    expect(classifyFireControlSource({ ...allowedWeapon, combatReady: true }).reason).toBe('paused_original');
  });

  it('accepts actual default construction weapons and the spore variant, but never Tesla fire', () => {
    for (const constructionId of FIRE_CONTROL_ELIGIBLE_CONSTRUCTION_IDS) {
      const definition = COOP_DEFENSE_CONSTRUCTIONS[constructionId];
      expect(definition.kind).toBe('turret');
      if (definition.kind !== 'turret') throw new Error(`${constructionId} must define a turret weapon`);
      const weaponFireType = WEAPON_CONFIGS[definition.weaponId].fire.type;
      expect(FIRE_CONTROL_ELIGIBLE_FIRE_TYPES).toContain(weaponFireType);
      expect(classifyFireControlSource({ ...ownTurret, constructionId, weaponFireType }).copyable).toBe(true);
    }
    expect(classifyFireControlSource({
      ...ownTurret, constructionId: 'spore_turret',
      weaponFireType: WEAPON_CONFIGS.SPORE_TURRET_PLASMA.fire.type,
    }).copyable).toBe(true);
    const teslaFire = WEAPON_CONFIGS.TURRET_TESLA.fire.type;
    expect(FIRE_CONTROL_ELIGIBLE_FIRE_TYPES).not.toContain(teslaFire);
    expect(classifyFireControlSource({ ...ownTurret, weaponFireType: teslaFire }))
      .toEqual({ copyable: false, portalSource: false, reason: 'fire_type_excluded' });
  });
});
