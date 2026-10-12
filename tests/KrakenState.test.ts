import { describe, expect, it } from 'vitest';
import { readKrakenState, readKrakenEggLandEffect, type KrakenState, type KrakenTentacleState } from '../src/systems/KrakenState';
import { combatDamageEventTargetKey, readCombatPartContact, type BossTargetRef } from '../src/combat/CombatPartContact';
import { normalizeEnemyClawAttack, readEnemyAreaClawEvent, type EnemyAreaClawEvent } from '../src/systems/EnemyClawAttack';
import { readCombatAreaPose } from '../src/combat/CombatAreaAttack';

const boss: BossTargetRef = { kind: 'enemy', id: 'boss', scope: { worldRevision: 2, runtimeGeneration: 3 },
  instance: { entityGeneration: 4, activityRevision: 5 } };
const part = (partId: string): KrakenTentacleState => ({
  contact: { identity: { boss, partId, partGeneration: 1, cycleId: 1 }, contactId: `${partId}:surface`,
    hitboxProfileId: 'exposed', x: 12, y: 15, angle: Math.PI / 3, targetableFrom: 10, targetableUntil: 100 },
  revision: 2, phase: 'hover', startedAt: 0, hoverAt: 10, retractAt: 80, endsAt: 120,
  claw: { revision: 1, attack: { attackId: `${partId}:slam`, weaponId: 'kraken-tentacle', presentation: 'tentacle',
    pose: { originX: 14, originY: 18, angle: Math.PI / 3, geometry: { kind: 'lane', length: 150, width: 40 } },
    startedAt: 10, strikeAt: 30, hitAt: 40, endsAt: 70 } },
});
const state = (): KrakenState => ({ boss, revision: 6, cycleId: 1, habitatId: 'pond',
  phase: { kind: 'submerged', startedAt: 0, stopSpawningAt: 100 }, phaseTwoPending: false,
  bodyTargetability: { revision: 3, effectiveAt: 0, mode: 'hidden' }, movement: 'water-anchored',
  bodyAction: null, spines: [], tentacles: [part('left'), part('right')], eggs: [], inkClouds: [],
});

describe('Kraken state boundary', () => {
  it('retains concurrent independent part slots and a hidden body, without copied HP', () => {
    const input = state(), parsed = readKrakenState(input)!;
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    input.tentacles[0].claw.attack = null;
    expect(parsed.tentacles[0].claw.attack).not.toBeNull();
    expect(readKrakenState({ ...state(), tentacles: [{ ...part('a'), hp: 100 }] })).toBeNull();
  });
  it('rejects duplicate parts, foreign scopes, stale cycles and malformed timelines', () => {
    const invalid: KrakenState[] = [];
    let s = state(); s.tentacles[1] = part('left'); invalid.push(s);
    s = state(); s.tentacles[0].contact.identity = { ...s.tentacles[0].contact.identity, cycleId: 2 }; invalid.push(s);
    s = state(); s.tentacles[0].contact.identity = { ...s.tentacles[0].contact.identity,
      boss: { ...boss, instance: { ...boss.instance, activityRevision: 99 } } }; invalid.push(s);
    s = state(); s.tentacles[0].endsAt = 50; invalid.push(s);
    s = state(); s.bodyTargetability.mode = 'exposed'; invalid.push(s);
    for (const value of invalid) expect(readKrakenState(value)).toBeNull();
  });
  it('retains pending phase two without an HP gate; death does not require surfacing', () => {
    const s = state(); s.phaseTwoPending = true;
    s.phase = { kind: 'dying', startedAt: 30, endsAt: 60, terminalPose: { x: 0, y: 0, angle: 0 }, asset: 'water', submerged: true };
    expect(readKrakenState(s)).toBeNull();
    for (const t of s.tentacles) { t.phase = 'retract'; t.claw.attack = null; }
    expect(readKrakenState(s)?.phase.kind).toBe('dying');
    s.phase = { kind: 'removed', removedAt: 60 };
    expect(readKrakenState(s)).toBeNull();
    s.tentacles = [];
    expect(readKrakenState(s)?.tentacles).toEqual([]);
  });
  it('requires the host visibility anchor before direct body damage resumes', () => {
    const s = state(); s.tentacles = [];
    s.phase = { kind: 'surfacing', startedAt: 10, vulnerableAt: 20, endsAt: 30, recoveryEndsAt: 35 };
    s.bodyTargetability = { revision: 4, mode: 'protected', effectiveAt: 10 };
    expect(readKrakenState(s)).not.toBeNull();
    s.bodyTargetability.mode = 'exposed';
    expect(readKrakenState(s)).toBeNull();
    s.bodyTargetability.effectiveAt = s.phase.vulnerableAt;
    expect(readKrakenState(s)).not.toBeNull();
  });
  it('retains an aged ink cloud after the body action clears and validates egg hatch order', () => {
    const s = state(); s.tentacles = []; s.phase = { kind: 'land', startedAt: 0 };
    s.bodyTargetability.mode = 'exposed'; s.movement = 'land';
    s.inkClouds = [{ attackId: 'ink', spitAt: 10, cloudEndsAt: 25,
      pose: { originX: 1, originY: 2, angle: 0, geometry: { kind: 'sector', range: 120, arcDegrees: 45 } } }];
    s.eggs = [{ eggId: 'egg', entityGeneration: 2, bossId: boss.id, bossGeneration: boss.instance.entityGeneration,
      castId: 'cast', originId: 'encounter', broodTableId: 'brood', enemyKind: 'rabid-badger',
      landedAt: 5, hatchStartedAt: 10, spawnAt: 12, endsAt: 15, status: 'incubating' }];
    expect(readKrakenState(s)).toEqual(s);
    s.eggs[0].spawnAt = 9;
    expect(readKrakenState(s)).toBeNull();
  });
});

describe('area claw contracts', () => {
  const event = (): EnemyAreaClawEvent => ({ worldRevision: 2, activityRevision: 5, enemyId: 'boss', entityGeneration: 4,
    slot: { kind: 'part', partId: 'left', partGeneration: 1, cycleId: 1 }, state: part('left').claw });
  it('preserves rotated lanes and independently addressed clears', () => {
    expect(readEnemyAreaClawEvent(event())).toEqual(event());
    const clear = { ...event(), state: { revision: 2, attack: null } };
    expect(readEnemyAreaClawEvent(clear)).toEqual(clear);
    expect(readEnemyAreaClawEvent({ ...event(), slot: { kind: 'body' } })).toBeNull();
  });
  it('normalizes legacy sectors explicitly and rejects an ink lane or ambiguous geometry', () => {
    const converted = normalizeEnemyClawAttack({ attackId: 'a', weaponId: 'w', startedAt: 0, strikeAt: 10,
      hitAt: 20, endsAt: 30, angle: 1, range: 50, arcDegrees: 60 }, { originX: 12, originY: 15 });
    expect(converted.pose).toEqual({ originX: 12, originY: 15, angle: 1, geometry: { kind: 'sector', range: 50, arcDegrees: 60 } });
    const e = event(); e.state.attack!.presentation = 'ink';
    expect(readEnemyAreaClawEvent(e)).toBeNull();
    expect(readCombatAreaPose({ ...converted.pose, geometry: { kind: 'lane', length: 20, width: 10, range: 50 } })).toBeNull();
    expect(readCombatAreaPose({ ...converted.pose, angle: Infinity })).toBeNull();
  });
});

describe('contact and landing identity', () => {
  it('deduplicates multiple contacts at the boss, while pellets, ticks and instances remain independent', () => {
    const event = { scope: boss.scope, activityRevision: 5, eventId: 'shot:pellet:tick' };
    const a = readCombatPartContact(part('a').contact)!, b = readCombatPartContact(part('b').contact)!;
    const key = combatDamageEventTargetKey(event, a.identity.boss);
    expect(combatDamageEventTargetKey(event, b.identity.boss)).toBe(key);
    expect(combatDamageEventTargetKey({ ...event, eventId: 'other-pellet' }, boss)).not.toBe(key);
    expect(combatDamageEventTargetKey({ ...event, eventId: 'next-tick' }, boss)).not.toBe(key);
    expect(combatDamageEventTargetKey(event, { ...boss, instance: { ...boss.instance, entityGeneration: 8 } })).not.toBe(key);
    expect(readCombatPartContact({ ...a, targetableUntil: a.targetableFrom })).toBeNull();
  });
  it('landing preserves boss/cast/egg/origin identity and has no damage or direct spawn payload', () => {
    const effect = { type: 'kraken_egg_land', boss, castId: 'cast', eggId: 'egg', broodTableId: 'brood', originId: 'encounter' };
    expect(readKrakenEggLandEffect(effect)).toEqual(effect);
    expect(readKrakenEggLandEffect({ ...effect, maxDamage: 20 })).toBeNull();
    expect(readKrakenEggLandEffect({ ...effect, enemyKind: 'immediate-spawn' })).toBeNull();
    expect(readKrakenEggLandEffect({ ...effect, boss: { ...boss, instance: { entityGeneration: 1 } } })).toBeNull();
  });
});
