import { describe, expect, it, vi } from 'vitest';
import { WeaponFireFeedbackController } from '../src/effects/weapon/WeaponFireFeedbackController';
import { HeldWeaponFeedbackModel } from '../src/effects/weapon/HeldWeaponFeedbackModel';
import type { WeaponFeedbackProfile } from '../src/config/weaponFeedback';
import { isWeaponShotFeedbackEvent } from '../src/loadout/WeaponShotFeedbackEvent';

function fixture() {
  let now = 0, revision: number | null = 1, scale = 1, held = true;
  function player() {
    const model = new HeldWeaponFeedbackModel();
    return {
      playHeldWeaponShot: vi.fn((_id: string, p: WeaponFeedbackProfile) => model.fire(p, now) ? 'started' as const : 'refreshed' as const),
      resetHeldWeaponFeedback: vi.fn(() => model.reset()),
      stopHeldWeaponSustain: vi.fn(() => model.stopSustained(now)),
      updateHeldWeaponFeedback: vi.fn(),
    };
  }
  const local = player(), remote = player();
  const camera = vi.fn(), cancel = vi.fn();
  const controller = new WeaponFireFeedbackController({
    getPlayer: id => id === 'local' ? local : id === 'remote' ? remote : undefined,
    getLocalPlayerId: () => 'local', getWorldRevision: () => revision,
    isLocalTriggerHeld: () => held, getCameraScale: () => scale,
    requestCamera: camera, cancelCamera: cancel,
  });
  return { controller, local, remote, camera, cancel,
    time: (n: number) => { now = n; }, world: (n: number | null) => { revision = n; },
    scale: (n: number) => { scale = n; }, held: (v: boolean) => { held = v; } };
}
const shot = { shooterId: 'local', weaponId: 'GLOCK', slot: 'weapon1' as const, angle: Math.PI / 2, sequence: 1 };

describe('weapon fire presentation routing', () => {
  it('plays predictions once and never replays late confirmations after newer predictions', () => {
    const f = fixture();
    f.controller.predict({ ...shot, predictionId: 1 });
    f.controller.predict({ ...shot, predictionId: 2 });
    f.controller.confirm({ ...shot, predictionId: 1 });
    f.controller.confirm({ ...shot, sequence: 2, predictionId: 2 });
    expect(f.local.playHeldWeaponShot).toHaveBeenCalledTimes(2);
    expect(f.camera).toHaveBeenCalledTimes(2);
    expect(f.camera.mock.calls[0][0].dirY).toBeCloseTo(-1);
  });

  it('animates remote shots without camera kick and suppresses duplicate sequences', () => {
    const f = fixture();
    f.controller.confirm({ ...shot, shooterId: 'remote' });
    f.controller.confirm({ ...shot, shooterId: 'remote' });
    expect(f.remote.playHeldWeaponShot).toHaveBeenCalledTimes(1);
    expect(f.camera).not.toHaveBeenCalled();
    f.controller.confirm(shot);
    expect(f.local.playHeldWeaponShot).toHaveBeenCalledTimes(1);
  });

  it('kicks only at stream start, releases locally, and disables camera motion independently', () => {
    const f = fixture();
    f.controller.confirm({ ...shot, weaponId: 'FLAMETHROWER' });
    f.time(70);
    f.controller.confirm({ ...shot, weaponId: 'FLAMETHROWER', sequence: 2 });
    expect(f.camera).toHaveBeenCalledTimes(1);
    f.held(false); f.controller.update();
    expect(f.local.stopHeldWeaponSustain).toHaveBeenCalled();
    f.scale(0); f.controller.update();
    f.controller.confirm({ ...shot, sequence: 3 });
    expect(f.cancel).toHaveBeenCalled();
    expect(f.camera).toHaveBeenCalledTimes(1);
    expect(f.local.playHeldWeaponShot).toHaveBeenCalledTimes(3);
  });

  it('resets pose and deduplication at world and round boundaries', () => {
    const f = fixture();
    f.controller.confirm(shot);
    f.world(2); f.controller.update();
    expect(f.local.resetHeldWeaponFeedback).toHaveBeenCalledTimes(1);
    f.controller.confirm(shot);
    f.controller.reset();
    f.controller.confirm(shot);
    expect(f.local.playHeldWeaponShot).toHaveBeenCalledTimes(3);
    f.world(null); f.controller.confirm({ ...shot, sequence: 2 });
    expect(f.local.playHeldWeaponShot).toHaveBeenCalledTimes(3);
  });

  it('validates the typed shot-event boundary', () => {
    expect(isWeaponShotFeedbackEvent(shot)).toBe(true);
    for (const patch of [{ angle: NaN }, { sequence: 0 }, { predictionId: -1 }, { slot: 'utility' }]) {
      expect(isWeaponShotFeedbackEvent({ ...shot, ...patch })).toBe(false);
    }
  });
});
