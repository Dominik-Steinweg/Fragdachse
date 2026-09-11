import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)) } }));
vi.mock('../../src/network/bridge', () => ({ bridge: { broadcastExplosionEffect: vi.fn() } }));
import { HostUpdateCoordinator } from '../../src/scenes/arena/HostUpdateCoordinator';
import { RockGridIndex } from '../../src/arena/RockGridIndex';
import { CELL_SIZE } from '../../src/config';
import { createGrenadeFragments } from '../../src/systems/GrenadeFragmentRules';
import { heEffect, heRequest } from '../HeGrenadeTestHelper';

describe('HE shared explosion damage', () => {
  it('uses structure surfaces for tiny shards and resolves outgoing target modifiers once with utility attribution', () => {
    const effects = [heEffect(), ...createGrenadeFragments(heEffect(), {
      x: -1, y: 0, direction: 0, speed: 0, provenance: heRequest().provenance,
    }, 'demolition', () => 0.5).slice(0, 1).map(r => r.interaction.grenadeEffect!)];
    const commits = vi.fn((_kind, _id, amount) => ({ kind: 'damage-applied', actualDamage: amount,
      resultingState: { kind: 'integrity', integrity: 1000 }, transition: { kind: 'none' } }));
    const resolve = vi.fn((_target, amount) => amount * 2);
    const aoe = vi.fn();
    const rock = { active: true, x: CELL_SIZE / 2, y: CELL_SIZE / 2,
      getBounds: () => ({ left: 0, top: 0, right: CELL_SIZE, bottom: CELL_SIZE }) };
    const combat = { applyAoeDamage: aoe, resolveExternalTargetDamage: resolve, getPlayerRuntimeDamageMultiplier: () => 2,
      captureWorldDamageSource: (ownerId: string) => ({ gameplaySource: { kind: 'player', id: ownerId },
        attribution: { kind: 'player', id: ownerId }, allegiance: { kind: 'player', ownerId, allianceId: 'coop:players' } }) };
    const coordinator = new HostUpdateCoordinator({} as never, {
      getWorldCombatCore: () => combat,
    } as never, {} as never, {} as never, {} as never);
    const world = {
        context: { metrics: { offsetX: 0, offsetY: 0 } },
        materialization: {
          arena: { rockPhysicsProxies: [rock], rockGrid: new RockGridIndex([{ gridX: 0, gridY: 0 }] as never, { cols: 3, rows: 3 }) },
          placement: { getRuntimeRock: () => ({ constructionId: 'rocket_turret', kind: 'turret', hp: 1000 }) },
        },
      };
    coordinator.setWorldFramePort({
      getWorldRuntime: () => world,
      getWorldMutationRuntime: () => ({ applyResolvedDamage: commits }),
      getTrainRuntime: () => null,
    } as never);
    for (const effect of effects) {
      commits.mockClear(); resolve.mockClear(); aoe.mockClear();
      const tiny = { ...effect, radius: 2, damageFalloff: undefined };
      (coordinator as unknown as { resolveGrenadePayload(request: unknown): void }).resolveGrenadePayload({
        projectileId: 1, x: -1, y: CELL_SIZE / 2, provenance: heRequest().provenance, effect: tiny,
      });
      // The center is outside this radius; the nearest building surface is one pixel away.
      expect(commits).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve.mock.calls[0][3]).toBe('utility');
      expect(commits.mock.calls[0][2]).toBe(resolve.mock.results[0].value);
      expect(commits.mock.calls[0][2]).toBe(Math.round(effect.damage * 2 * (effect.rockDamageMult ?? 1)) * 2);
      expect(commits.mock.calls[0][3]).toBe('p1');
      expect(commits.mock.calls[0][4]).toBe('HE_GRENADE');
      expect(aoe).toHaveBeenCalledWith(-1, CELL_SIZE / 2, 2, effect.damage, 'p1', false,
        expect.objectContaining({ sourceSlot: 'utility', baseDamageMult: effect.baseDamageMult }));
    }
  });
});
