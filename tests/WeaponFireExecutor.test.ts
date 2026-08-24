import { describe, expect, it, vi } from 'vitest';

import { getHeldWeaponGameplayMuzzleOrigin } from '../src/loadout/HeldItemVisuals';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { getTopDownMuzzleOrigin } from '../src/config';
import {
  WeaponFireExecutor,
  type HitscanShotRequest,
  type WeaponFireSink,
} from '../src/loadout/WeaponFireExecutor';

describe('WeaponFireExecutor hitscan gameplay muzzle', () => {
  it('forwards the desired gameplay muzzle and shooter origin separately', () => {
    const resolveHitscan = vi.fn((_request: HitscanShotRequest) => true);
    const sink: WeaponFireSink = {
      spawnProjectile: vi.fn(),
      resolveHitscan,
      resolveMelee: vi.fn(() => true),
    };
    const executor = new WeaponFireExecutor(sink);
    const config = WEAPON_CONFIGS.PLASMA_BURNER;
    const muzzle = getHeldWeaponGameplayMuzzleOrigin(config.id, 100, 200, 0, 32);
    if (!muzzle) throw new Error('Expected an explicit gameplay muzzle for the plasma burner');

    expect(executor.fire(config, {
      x: 100,
      y: 200,
      angle: 0,
      targetX: 500,
      targetY: 200,
      ownerId: 'player-1',
      ownerColor: 0xffffff,
      gameplayMuzzleOrigin: muzzle,
    })).toBe(true);

    const request = resolveHitscan.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      shooterX: 100,
      shooterY: 200,
      startX: muzzle.x,
      startY: muzzle.y,
      angle: 0,
      range: config.range,
      rangeLimitToCursor: true,
      targetX: 500,
      targetY: 200,
    });
  });

  it('keeps the generic top-down fallback when no gameplay muzzle is supplied', () => {
    const resolveHitscan = vi.fn((_request: HitscanShotRequest) => true);
    const executor = new WeaponFireExecutor({
      spawnProjectile: vi.fn(),
      resolveHitscan,
      resolveMelee: vi.fn(() => true),
    });
    const config = WEAPON_CONFIGS.PLASMA_BURNER;
    const fallback = getTopDownMuzzleOrigin(100, 200, 0);

    executor.fire(config, {
      x: 100,
      y: 200,
      angle: 0,
      targetX: 500,
      targetY: 200,
      ownerId: 'automated-source',
      ownerColor: 0xffffff,
    });

    expect(resolveHitscan.mock.calls[0]?.[0]).toMatchObject({
      startX: fallback.x,
      startY: fallback.y,
      shooterX: undefined,
      shooterY: undefined,
    });
  });
});
