import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) },
  Geom: { Rectangle: class {
    left: number; top: number; right: number; bottom: number; centerX: number; centerY: number;
    constructor(x: number, y: number, w: number, h: number) {
      this.left = x; this.top = y; this.right = x + w; this.bottom = y + h;
      this.centerX = x + w / 2; this.centerY = y + h / 2;
    }
  } },
}));
import { BaseVoidFireSystem, collectBaseFireContacts, type VoidFireBase } from '../src/systems/BaseVoidFireSystem';
import { FireSystem } from '../src/effects/FireSystem';
import { BURN_TICK_INTERVAL_MS, CELL_SIZE, ARENA_OFFSET_X, ARENA_OFFSET_Y } from '../src/config';
import type { GroundFireContact } from '../src/effects/FireSystem';
import type { CombatSource } from '../src/combat/CombatScope';

const source: CombatSource = { gameplaySource: { kind: 'environment', id: 'hazard' },
  attribution: { kind: 'world', id: 'hazard' }, allegiance: { ownerId: 'hazard', kind: 'world' }, origin: 'burn' };
const testConfig = { damagePerSecond: { friendly: 100, hostile: 133 }, afterburnMs: 1000 };
function harness(hp = 2000, faction: VoidFireBase['faction'] = 'friendly', config = testConfig) {
  let contacts: GroundFireContact[] = [];
  let burning = false;
  let eligible = true;
  let permitted = true;
  const damage: number[] = [];
  const base: VoidFireBase = { id: 'base', faction,
    isDamageable: () => eligible && hp > 0, setVoidBurning: value => { burning = value; } };
  const system = new BaseVoidFireSystem({ getBases: () => [base], getContacts: () => contacts,
    captureSource: () => source, canDamage: () => permitted,
    damage: (_id, amount) => { hp = Math.max(0, hp - amount); damage.push(amount); },
  }, config);
  return { system, damage, hp: () => hp, burning: () => burning,
    eligible: (value: boolean) => { eligible = value; }, permitted: (value: boolean) => { permitted = value; },
    contact: (count = 1, style: 'normal' | 'void' = 'void') => {
      contacts = Array.from({ length: count }, (_, i) => ({ sourceKey: String(i), x: 0, y: 0,
        ownerId: 'hazard', damagePerTick: 0, allowTeamDamage: false, sourceId: 'void',
        visualStyle: style, damageTarget: 'players' as const, combatSource: source }));
    },
  };
}

describe('finite base void burn', () => {
  it.each(['friendly', 'hostile'] as const)('uses the %s damage rate without rounding fractional ticks', faction => {
    const config = { damagePerSecond: { friendly: 13, hostile: 37 }, afterburnMs: 1000 };
    const h = harness(2000, faction, config);
    h.contact(); h.system.hostUpdate(0); h.contact(0);
    h.system.hostUpdate(BURN_TICK_INTERVAL_MS);
    const tickDamage = config.damagePerSecond[faction] * BURN_TICK_INTERVAL_MS / 1000;
    expect(h.damage).toEqual([tickDamage]);
    expect(h.hp()).toBeCloseTo(2000 - tickDamage);
    h.system.hostUpdate(config.afterburnMs);
    expect(h.hp()).toBeCloseTo(2000 - config.damagePerSecond[faction] * config.afterburnMs / 1000);
    expect(h.burning()).toBe(false);
  });
  it.each(['friendly', 'hostile'] as const)('keeps one %s damage stream during sustained overlapping contact', faction => {
    const h = harness(2000, faction);
    const contactDurationMs = testConfig.afterburnMs * 3;
    h.contact(20); h.system.hostUpdate(0);
    for (let now = BURN_TICK_INTERVAL_MS; now <= contactDurationMs; now += BURN_TICK_INTERVAL_MS) {
      h.system.hostUpdate(now);
      expect(h.burning()).toBe(true);
    }
    h.contact(0);
    h.system.hostUpdate(contactDurationMs + testConfig.afterburnMs);
    expect(h.hp()).toBeCloseTo(2000 - testConfig.damagePerSecond[faction]
      * (contactDurationMs + testConfig.afterburnMs) / 1000);
    expect(h.burning()).toBe(false);
  });
  it('samples occupied cells of a concave footprint without igniting through its courtyard', () => {
    const fire = new FireSystem({} as never);
    const metrics = { offsetX: ARENA_OFFSET_X, offsetY: ARENA_OFFSET_Y };
    const shape = [{ gridX: 0, gridY: 0 }, { gridX: 1, gridY: 0 }, { gridX: 0, gridY: 1 }];
    const options = { sourceKey: 'test', ownerId: 'hazard', damagePerTick: 0, durationMs: 1000,
      visualStyle: 'void' as const, sourceId: 'test' };
    fire.hostRefreshGroundCell(metrics.offsetX + CELL_SIZE * 1.5, metrics.offsetY + CELL_SIZE * 1.5, options, 0);
    expect(collectBaseFireContacts(fire, shape, metrics, 0)).toEqual([]);
    fire.hostRefreshGroundCell(metrics.offsetX + CELL_SIZE / 2, metrics.offsetY + CELL_SIZE / 2, options, 0);
    expect(collectBaseFireContacts(fire, shape, metrics, 0)).toHaveLength(1);
    fire.destroyAll();
  });
  it('burns after a brief contact and expires without inventing damage in a late frame', () => {
    const h = harness(); h.contact(); h.system.hostUpdate(0); h.contact(0);
    expect(h.burning()).toBe(true);
    h.system.hostUpdate(10000);
    expect(h.hp()).toBe(1900); expect(h.burning()).toBe(false);
    h.system.hostUpdate(20000); expect(h.hp()).toBe(1900);
  });
  it('refreshes duration, not damage, across overlapping cells and independent sources', () => {
    const h = harness(); h.contact(20); h.system.hostUpdate(0);
    h.system.hostUpdate(500); h.contact(0); h.system.hostUpdate(1500);
    expect(h.hp()).toBe(1850); expect(h.burning()).toBe(false);
  });
  it('restarts after expiry without retroactive ticks in the contact gap', () => {
    const h = harness(); h.contact(); h.system.hostUpdate(0); h.system.hostUpdate(10000);
    expect(h.hp()).toBe(1900); h.contact(0); h.system.hostUpdate(11000);
    expect(h.hp()).toBe(1800);
  });
  it('does not ignite normal fire, protected factions or inactive bases', () => {
    const h = harness(); h.contact(1, 'normal'); h.system.hostUpdate(0);
    expect(h.burning()).toBe(false);
    h.contact(); h.permitted(false); h.system.hostUpdate(250); expect(h.burning()).toBe(false);
    h.permitted(true); h.eligible(false); h.system.hostUpdate(500); expect(h.burning()).toBe(false);
    expect(h.damage).toEqual([]);
  });
  it('stops at destruction and clears both status and subsequent writes on teardown', () => {
    const h = harness(25); h.contact(); h.system.hostUpdate(0); h.system.hostUpdate(5000);
    expect(h.hp()).toBe(0); expect(h.damage).toEqual([25]); expect(h.burning()).toBe(false);
    const active = harness(); active.contact(); active.system.hostUpdate(0); active.system.destroy();
    active.system.hostUpdate(1000); expect(active.damage).toEqual([]); expect(active.burning()).toBe(false);
  });
});
