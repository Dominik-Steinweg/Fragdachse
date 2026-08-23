import { describe, expect, it } from 'vitest';
import type { CoopBaseFaction } from '../src/config/coopDefenseMaps';
import type { BaseManager } from '../src/entities/BaseManager';
import { CoopDefenseRoundStateSystem } from '../src/systems/CoopDefenseRoundStateSystem';

interface FakeBase {
  readonly hp: number;
  readonly faction: CoopBaseFaction;
  readonly role?: 'main' | 'outpost' | 'spawn-point';
}

function createBaseManager(bases: readonly FakeBase[]): BaseManager {
  const byFaction = (faction: CoopBaseFaction) => bases.filter((base) => base.faction === faction);
  const mainByFaction = (faction: CoopBaseFaction) => byFaction(faction)
    .filter((base) => (base.role ?? 'main') === 'main');
  return {
    getBases: () => bases.map((base) => ({ getHp: () => base.hp })),
    getBasesByFaction: (faction: CoopBaseFaction) => byFaction(faction).map((base) => ({ getHp: () => base.hp })),
    getTotalHp: (faction: CoopBaseFaction) => byFaction(faction).reduce((sum, base) => sum + base.hp, 0),
    hasFaction: (faction: CoopBaseFaction) => byFaction(faction).length > 0,
    getMainBasesByFaction: (faction: CoopBaseFaction) => mainByFaction(faction)
      .map((base) => ({ id: `${base.faction}-${base.role ?? 'main'}`, getHp: () => base.hp })),
    getTotalMainBaseHp: (faction: CoopBaseFaction) => mainByFaction(faction)
      .reduce((sum, base) => sum + base.hp, 0),
  } as unknown as BaseManager;
}

function friendly(...hpValues: number[]): FakeBase[] {
  return hpValues.map((hp) => ({ hp, faction: 'friendly' as const }));
}

describe('CoopDefenseRoundStateSystem', () => {
  it('does not lose a survival map when its optional base anchor is destroyed', () => {
    expect(new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager(friendly(0, 500)),
      objective: 'survive',
      getSecondsLeft: () => 10,
    }).update()).toBeNull();

    expect(new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager(friendly(0, 0)),
      objective: 'survive',
      getSecondsLeft: () => 10,
    }).update()).toBeNull();
  });

  it('wins a survive map when the timer expires', () => {
    expect(new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager(friendly(500)),
      objective: 'survive',
      getSecondsLeft: () => 0,
    }).update()).toBe('victory');
  });

  it('wins a boss map as soon as the boss is defeated', () => {
    const bossRun = (secondsLeft: number, bossDefeated: boolean) => new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager(friendly(500)),
      objective: 'defeat-boss',
      getSecondsLeft: () => secondsLeft,
      isBossDefeated: () => bossDefeated,
    }).update();

    expect(bossRun(30, false)).toBeNull();
    expect(bossRun(0, false)).toBeNull();
    expect(bossRun(30, true)).toBe('victory');
  });

  it('wins a repel-assault map only after the director reports the full assault clear', () => {
    let assaultRepelled = false;
    const system = new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager(friendly(500)),
      objective: 'repel-assault',
      getSecondsLeft: () => 0,
      isAssaultRepelled: () => assaultRepelled,
    });

    expect(system.update()).toBeNull();
    assaultRepelled = true;
    expect(system.update()).toBe('victory');
  });

  it('keeps base defeat ahead of a completed repel assault', () => {
    expect(new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager(friendly(0)),
      objective: 'repel-assault',
      getSecondsLeft: () => 10,
      isAssaultRepelled: () => true,
    }).update()).toBe('defeat');
  });

  it('prefers a survival team wipe over the time-limit victory', () => {
    expect(new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager(friendly(500)),
      objective: 'survive',
      getSecondsLeft: () => 0,
      isTeamWipedOut: () => true,
    }).update()).toBe('defeat');
  });

  it('does not apply the survival team-wipe rule to other objectives', () => {
    expect(new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager(friendly(500)),
      objective: 'repel-assault',
      getSecondsLeft: () => 10,
      isTeamWipedOut: () => true,
    }).update()).toBeNull();
  });
});

describe('CoopDefenseRoundStateSystem with a hostile base', () => {
  const attackRun = (friendlyHp: number, hostileHp: number, secondsLeft: number) => (
    new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager([
        ...friendly(friendlyHp),
        { hp: hostileHp, faction: 'hostile' },
      ]),
      objective: 'destroy-hostile-bases',
      getSecondsLeft: () => secondsLeft,
    }).update()
  );

  it('wins once the hostile base falls', () => {
    expect(attackRun(500, 400, 10)).toBeNull();
    expect(attackRun(500, 0, 10)).toBe('victory');
  });

  it('never grants victory through the timer', () => {
    expect(attackRun(500, 400, 0)).toBeNull();
    expect(attackRun(500, 400, -30)).toBeNull();
  });

  it('still loses when the friendly bases fall, even with the hostile base standing', () => {
    expect(attackRun(0, 400, 10)).toBe('defeat');
  });

  it('prefers defeat when both sides fall in the same frame', () => {
    expect(attackRun(0, 0, 10)).toBe('defeat');
  });

  it('does not win instantly when no hostile base exists', () => {
    expect(new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager(friendly(500)),
      objective: 'destroy-hostile-bases',
      getSecondsLeft: () => 0,
    }).update()).toBeNull();
  });

  it('concludes only once', () => {
    const system = new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager([...friendly(500), { hp: 0, faction: 'hostile' }]),
      objective: 'destroy-hostile-bases',
      getSecondsLeft: () => 10,
    });
    expect(system.update()).toBe('victory');
    expect(system.update()).toBeNull();
  });

  it('ignores tactical outposts for victory and defeat', () => {
    expect(new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager([
        { hp: 500, faction: 'friendly' },
        { hp: 0, faction: 'friendly', role: 'outpost' },
        { hp: 400, faction: 'hostile' },
        { hp: 0, faction: 'hostile', role: 'outpost' },
      ]),
      objective: 'destroy-hostile-bases',
      getSecondsLeft: () => 10,
    }).update()).toBeNull();

    expect(new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager([
        { hp: 500, faction: 'friendly' },
        { hp: 0, faction: 'friendly', role: 'outpost' },
        { hp: 0, faction: 'hostile' },
        { hp: 400, faction: 'hostile', role: 'outpost' },
      ]),
      objective: 'destroy-hostile-bases',
      getSecondsLeft: () => 10,
    }).update()).toBe('victory');

    expect(new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager([
        { hp: 0, faction: 'friendly' },
        { hp: 500, faction: 'friendly', role: 'outpost' },
        { hp: 0, faction: 'hostile' },
      ]),
      objective: 'destroy-hostile-bases',
      getSecondsLeft: () => 10,
    }).update()).toBe('defeat');
  });
});
