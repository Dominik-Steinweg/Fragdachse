import { describe, expect, it } from 'vitest';
import {
  REST_HEAL_LINK_EXIT_FACTOR, isRestHealCandidate, restHealCapacity, restHealClusterValue, selectRestHealLinks, type RestHealBody,
} from '../src/systems/enemyRestHeal';

const HEAL = { radiusPx: 150, maxLinks: 2, healPerTick: 6, tickIntervalMs: 250 };
const healer: RestHealBody = { id: 'toad', faction: 'hostile', x: 0, y: 0, hp: 50, maxHp: 180, active: true, hidden: false };
const body = (id: string, x: number, hp: number, extra: Partial<RestHealBody> = {}): RestHealBody =>
  ({ id, faction: 'hostile', x, y: 0, hp, maxHp: 100, active: true, hidden: false, ...extra });

describe('rest heal policy', () => {
  it('only links injured, living, visible allies of its own faction, never itself', () => {
    expect(isRestHealCandidate(healer, body('a', 10, 40))).toBe(true);
    expect(isRestHealCandidate(healer, healer)).toBe(false);
    expect(isRestHealCandidate(healer, body('full', 10, 100))).toBe(false);
    expect(isRestHealCandidate(healer, body('dead', 10, 0))).toBe(false);
    expect(isRestHealCandidate(healer, body('ally', 10, 40, { faction: 'allied' }))).toBe(false);
    expect(isRestHealCandidate(healer, body('buried', 10, 40, { hidden: true }))).toBe(false);
    expect(isRestHealCandidate(healer, body('gone', 10, 40, { active: false }))).toBe(false);
  });

  it('fills free links with the most injured visible allies in reach, capped at maxLinks', () => {
    const bodies = [body('slight', 20, 90), body('worst', 120, 10), body('mid', 60, 50), body('far', 400, 5), body('hidden', 30, 1)];
    const links = selectRestHealLinks(healer, bodies, [], HEAL, target => target.id !== 'hidden');
    expect(links).toEqual(['worst', 'mid']);
  });

  it('keeps an existing link at the edge but drops it once healed, out of reach or out of sight', () => {
    const edge = HEAL.radiusPx * (REST_HEAL_LINK_EXIT_FACTOR - 0.05);
    const kept = selectRestHealLinks(healer, [body('edge', edge, 50), body('new', 30, 10)], ['edge'], HEAL, () => true);
    expect(kept).toEqual(['edge', 'new']);
    expect(selectRestHealLinks(healer, [body('edge', edge, 50)], [], HEAL, () => true)).toEqual([]);
    expect(selectRestHealLinks(healer, [body('edge', 20, 100)], ['edge'], HEAL, () => true)).toEqual([]);
    expect(selectRestHealLinks(healer, [body('edge', 20, 50)], ['edge'], HEAL, () => false)).toEqual([]);
  });

  it('values a group over one badly hurt ally and counts shared targets partly', () => {
    const capacity = restHealCapacity(HEAL, 2500);
    expect(capacity).toBe(HEAL.healPerTick * 10);
    const lone = restHealClusterValue({ x: 0, y: 0 }, healer, [body('lone', 10, 1)], HEAL, capacity, new Set());
    const group = restHealClusterValue({ x: 0, y: 0 }, healer, [body('a', 10, 60), body('b', 20, 60)], HEAL, capacity, new Set());
    expect(lone).toBe(capacity);
    expect(group).toBeGreaterThan(lone);
    const shared = restHealClusterValue({ x: 0, y: 0 }, healer, [body('a', 10, 60), body('b', 20, 60)], HEAL, capacity, new Set(['a']));
    expect(shared).toBeLessThan(group);
    expect(restHealClusterValue({ x: 500, y: 0 }, healer, [body('a', 10, 60)], HEAL, capacity, new Set())).toBe(0);
  });
});
