import { describe, expect, it } from 'vitest';
import { resolveChainLightning } from '../src/combat/rules/ChainLightningResolver';

describe('CombatSystem Chain Lightning – Characterization vor Shared-Resolver-Refactor', () => {
  it('start at the primary impact, uses 1-based falloff, radius and no repeats', () => {
    const events: Array<{ id: string; damage: number; originX: number; originY: number }> = [];
    const targets = [
      { id: 'enemy:primary', kind: 'enemy' as const, x: 10, y: 0 },
      { id: 'enemy:near', kind: 'enemy' as const, x: 35, y: 0 },
      { id: 'enemy:next', kind: 'enemy' as const, x: 60, y: 0 },
      { id: 'enemy:outside', kind: 'enemy' as const, x: 200, y: 0 },
    ];

    const result = resolveChainLightning({
      originX: 10,
      originY: 0,
      baseDamage: 10,
      config: {
        maxJumps: 3,
        searchRadius: 30,
        damageFalloffPerJump: 0.1,
        targetEnemies: true,
      },
      visitedTargetIds: new Set(['enemy:primary']),
      getCandidates: () => targets,
      hasLineOfSight: (_x1, _y1, x2, _y2) => x2 !== 60,
      onJump: ({ target, damage, originX, originY }) => events.push({
        id: target.id,
        damage,
        originX,
        originY,
      }),
    });

    expect(events).toEqual([
      { id: 'enemy:near', damage: 9, originX: 10, originY: 0 },
      // The next target is blocked by the injected LoS callback; no later target is reached.
    ]);
    expect(result.jumps).toBe(1);
    expect(result.visitedTargetIds).toEqual(new Set(['enemy:primary', 'enemy:near']));
  });

  it('preserves current first-encountered tie semantics and type-specific candidates', () => {
    const targets = [
      { id: 'enemy:first', kind: 'enemy' as const, x: 20, y: 0 },
      { id: 'player:equal', kind: 'player' as const, x: 20, y: 0 },
      { id: 'decoy:7', kind: 'decoy' as const, x: 20, y: 0 },
      { id: 'detonable:3', kind: 'detonable' as const, x: 20, y: 0 },
    ];
    const hitKinds: string[] = [];

    resolveChainLightning({
      originX: 0,
      originY: 0,
      baseDamage: 5,
      config: {
        maxJumps: 1,
        searchRadius: 25,
        damageFalloffPerJump: 0,
        targetEnemies: true,
        targetPlayers: true,
        targetDecoys: true,
        detonableTags: ['asmd_ball'],
      },
      getCandidates: () => targets,
      hasLineOfSight: () => true,
      onJump: ({ target }) => hitKinds.push(target.kind),
    });

    expect(hitKinds).toEqual(['enemy']);
  });
});

