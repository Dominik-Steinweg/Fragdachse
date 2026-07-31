import { describe, expect, it } from 'vitest';
import type { CoopBaseFaction } from '../src/config/coopDefenseMaps';
import type { BaseManager } from '../src/entities/BaseManager';
import { CoopDefenseRoundStateSystem } from '../src/systems/CoopDefenseRoundStateSystem';

interface FakeBase {
  readonly hp: number;
  readonly faction: CoopBaseFaction;
}

function createBaseManager(bases: readonly FakeBase[]): BaseManager {
  const byFaction = (faction: CoopBaseFaction) => bases.filter((base) => base.faction === faction);
  return {
    getBases: () => bases.map((base) => ({ getHp: () => base.hp })),
    getBasesByFaction: (faction: CoopBaseFaction) => byFaction(faction).map((base) => ({ getHp: () => base.hp })),
    getTotalHp: (faction: CoopBaseFaction) => byFaction(faction).reduce((sum, base) => sum + base.hp, 0),
    hasFaction: (faction: CoopBaseFaction) => byFaction(faction).length > 0,
  } as unknown as BaseManager;
}

function friendly(...hpValues: number[]): FakeBase[] {
  return hpValues.map((hp) => ({ hp, faction: 'friendly' as const }));
}

describe('CoopDefenseRoundStateSystem', () => {
  it('loses only after all friendly bases are destroyed', () => {
    expect(new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager(friendly(0, 500)),
      getSecondsLeft: () => 10,
    }).update()).toBeNull();

    expect(new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager(friendly(0, 0)),
      getSecondsLeft: () => 10,
    }).update()).toBe('defeat');
  });

  it('requires both elapsed time and a defeated boss for boss-map victory', () => {
    const bossRun = (secondsLeft: number, bossDefeated: boolean) => new CoopDefenseRoundStateSystem({
      baseManager: createBaseManager(friendly(500)),
      getSecondsLeft: () => secondsLeft,
      bossRequired: true,
      isBossDefeated: () => bossDefeated,
    }).update();

    expect(bossRun(0, false)).toBeNull();
    expect(bossRun(1, true)).toBeNull();
    expect(bossRun(0, true)).toBe('victory');
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
});
