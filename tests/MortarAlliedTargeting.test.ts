import { describe, expect, it } from 'vitest';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { selectAlliedMortarTarget, type AlliedMortarEnemy } from '../src/systems/mortarAlliedTargeting';
import type { SyncedMortarStrike } from '../src/types';

const config = { ...getCoopDefenseEnemyConfig('mortar-badger').mortar!, minRangePx: 100,
  preferredRangeMinPx: 200, maxRangePx: 1000, impactRadiusPx: 60, overlapMarginPx: 0,
  alliedTargetCandidateLimit: 12, alliedBossWeight: 1, overlapPenalty: 4 };
const source = { id: 'mortar', sprite: { active: true, x: 0, y: 0 } };
const enemy = (id: string, x: number, y = 0, extra: Partial<AlliedMortarEnemy> = {}): AlliedMortarEnemy => ({
  id, faction: 'hostile', sprite: { active: true, x, y }, getHp: () => 100,
  isBurrowed: () => false, isBoss: () => false, ...extra,
});
const select = (enemies: AlliedMortarEnemy[], overrides = {}, strikes: SyncedMortarStrike[] = [],
  targetable: (id: string) => boolean = () => true) =>
  selectAlliedMortarTarget(source, enemies, { ...config, ...overrides }, strikes, 100, targetable);

describe('allied mortar targeting (without Phaser)', () => {
  it('chooses the densest group over the nearest isolated enemy and copies an actual target point', () => {
    const crowd = [enemy('near', 200), enemy('a', 700), enemy('b', 720), enemy('c', 740)];
    const point = select(crowd);
    expect(point).toEqual({ x: 700, y: 0 });
    expect(select([...crowd].reverse())).toEqual(point);
    crowd[1] = enemy('a', 1, 1);
    expect(point).toEqual({ x: 700, y: 0 });
  });

  it('blocks on a close valid hostile, even outside the nearest-N shortlist', () => {
    expect(select([enemy('target', 700), enemy('close', 99)], { alliedTargetCandidateLimit: 1 })).toBeNull();
    expect(select([enemy('boundary', 100)])).toEqual({ x: 100, y: 0 });
  });

  it('excludes allies, dead, inactive, burrowed and untargetable enemies from danger and density', () => {
    const invalid = [enemy('ally', 1, 0, { faction: 'allied' }), enemy('dead', 1, 0, { getHp: () => 0 }),
      enemy('inactive', 1, 0, { sprite: { active: false, x: 1, y: 0 } }),
      enemy('burrowed', 1, 0, { isBurrowed: () => true }), enemy('untargetable', 1)];
    expect(select(invalid, {}, [], id => id !== 'untargetable')).toBeNull();
    expect(select([...invalid, enemy('target', 700)], {}, [], id => id !== 'untargetable')).toEqual({ x: 700, y: 0 });
    const shifted = invalid.map(e => ({ ...e, sprite: { ...e.sprite, x: 200 } }));
    expect(select([enemy('near', 200), enemy('a', 700), enemy('b', 710), ...shifted], {}, [],
      id => id !== 'untargetable')).toEqual({ x: 700, y: 0 });
  });

  it('limits firing candidates to nearest N in range but counts neighbours beyond the shortlist', () => {
    const crowd = [enemy('a', 300), enemy('b', 700), enemy('c', 710), enemy('d', 720)];
    expect(select(crowd, { alliedTargetCandidateLimit: 1 })).toEqual({ x: 300, y: 0 });
    expect(select(crowd, { alliedTargetCandidateLimit: 2 })).toEqual({ x: 700, y: 0 });
    expect(select([enemy('far', 1001)])).toBeNull();
    expect(select([enemy('edge', 1000)])).toEqual({ x: 1000, y: 0 });
  });

  it('weights density by preferred firing range', () => {
    expect(select([enemy('near', 100), enemy('preferred', 250)])).toEqual({ x: 250, y: 0 });
    expect(select([enemy('near', 100), enemy('preferred', 250)], { preferredRangeMinPx: 100 })).toEqual({ x: 100, y: 0 });
  });

  it('uses the hostile soft overlap penalty for pending and launched strikes, never a hard reservation', () => {
    const targets = [enemy('a', 300), enemy('b', 700)];
    const strike = { id: 1, sourceEnemyId: 'other', sourceX: 0, sourceY: 0, targetX: 300, targetY: 0,
      radius: 60, armedAt: 0, launchAt: 200, impactAt: 500, faction: 'allied' } satisfies SyncedMortarStrike;
    for (const launchAt of [200, 50]) expect(select(targets, {}, [{ ...strike, launchAt }])).toEqual({ x: 700, y: 0 });
    expect(select([targets[0]], {}, [strike])).toEqual({ x: 300, y: 0 });
    expect(select(targets, {}, [{ ...strike, impactAt: 100 }])).toEqual({ x: 300, y: 0 });
    expect(select(targets, {}, [{ ...strike, sourceEnemyId: source.id }])).toEqual({ x: 300, y: 0 });
  });

  it('allows bosses without a bonus and applies their configured density weight', () => {
    const boss = enemy('boss', 300, 0, { isBoss: () => true });
    expect(select([boss])).toEqual({ x: 300, y: 0 });
    expect(select([enemy('regular', 200), boss])).toEqual({ x: 200, y: 0 });
    expect(select([boss, enemy('regular', 700)])).toEqual({ x: 300, y: 0 });
    expect(select([boss, enemy('regular', 700)], { alliedBossWeight: 0.25 })).toEqual({ x: 700, y: 0 });
  });
});
