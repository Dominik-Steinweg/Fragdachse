import { describe, expect, it } from 'vitest';
import { resolveCoopDefenseEnemyConfigs } from '../src/config/coopDefenseEnemies';
import { resolveEnemyLifecycleTotals } from '../src/config/coopDefenseEnemyLifecycle';

describe('shared enemy lifecycle potential', () => {
  it('keeps direct and fixed follow-up XP separate', () => {
    const enemies = resolveCoopDefenseEnemyConfigs(1), kind = Object.keys(enemies).find(k => enemies[k].deathSpawns?.length)!;
    const totals = resolveEnemyLifecycleTotals(kind, enemies);
    expect(totals.complete).toBe(true); expect(totals.directXp).toBe(enemies[kind].xp);
    expect(totals.xp).toBe(totals.directXp + totals.followXp);
    expect(totals.followXp).toBeGreaterThan(0);
  });
  it('reports cycles and unknown kinds without claiming an exact total', () => {
    const base = Object.values(resolveCoopDefenseEnemyConfigs(1))[0];
    const cycle = resolveEnemyLifecycleTotals('cycle', { cycle: { ...base, deathSpawns: [{ enemyKind: 'cycle', count: 1 }] } });
    expect(cycle.complete).toBe(false); expect(cycle.issues[0]).toContain('Zyklische'); expect(Number.isFinite(cycle.xp)).toBe(true);
    expect(resolveEnemyLifecycleTotals('missing', {}).complete).toBe(false);
  });
});
