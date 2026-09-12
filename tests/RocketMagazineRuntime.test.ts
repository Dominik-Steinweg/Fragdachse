import { describe, expect, it, vi } from 'vitest';
import { RocketMagazineRuntime } from '../src/world/RocketMagazineRuntime';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { rocketSalvoAngles } from '../src/loadout/RocketLauncherConfig';

function fixture(capacity = 4, initialMoney = 100) {
  let config = { ...WEAPON_CONFIGS.ROCKET_LAUNCHER, cooldown: 100, adrenalinCost: 7,
    rocketLauncher: { ...WEAPON_CONFIGS.ROCKET_LAUNCHER.rocketLauncher!, magazineLevel: 1, magazineCapacities: [capacity, capacity, capacity] } };
  let money = initialMoney, cooldownUntil = 0, alive = true;
  const pay = vi.fn(() => { money -= config.adrenalinCost; });
  const fire = vi.fn((_id, _config, _aim, _count, _focus, now) => { cooldownUntil = now + config.cooldown; return { ok: true }; });
  const runtime = new RocketMagazineRuntime({ getConfig: () => config, canAct: () => alive,
    isOnCooldown: (_id, now) => now < cooldownUntil, canPay: () => money >= config.adrenalinCost, pay, fire });
  const input = (phase: 'hold' | 'release' | 'cancel', now: number, id = 1, focused = false) =>
    runtime.input('p', { id, phase, focused }, 0.4, 170, 80, now);
  return { runtime, input, fire, pay, money: () => money, block: () => { alive = false; },
    rebuild: () => { config = { ...config }; } };
}

describe('host Rocket magazine', () => {
  it('pays immediately, fires tap on release once, and enforces cooldown between gestures', () => {
    const f = fixture();
    f.input('hold', 0); f.input('hold', 0);
    expect(f.pay).toHaveBeenCalledOnce(); expect(f.fire).not.toHaveBeenCalled();
    f.input('release', 10, 1, true);
    expect(f.fire).toHaveBeenCalledExactlyOnceWith('p', expect.anything(), expect.objectContaining({ angle: 0.4 }), 1, true, 10);
    expect(f.input('release', 11).ok).toBe(false);
    f.input('hold', 12, 2); f.input('release', 13, 2);
    expect(f.pay).toHaveBeenCalledOnce(); expect(f.fire).toHaveBeenCalledOnce();
    f.input('hold', 110, 3); f.input('release', 111, 3);
    expect(f.fire).toHaveBeenCalledTimes(2); expect(f.pay).toHaveBeenCalledTimes(2);
  });

  it('fires a full salvo and repeats after the shot cooldown while held', () => {
    const f = fixture(2);
    f.input('hold', 0); f.runtime.update(99);
    expect(f.fire).not.toHaveBeenCalled();
    f.input('hold', 100, 1, true);
    expect(f.fire.mock.calls.map(c => [c[3], c[4], c[5]])).toEqual([[2, true, 100]]);
    f.runtime.update(199); expect(f.pay).toHaveBeenCalledTimes(2);
    f.runtime.update(200); f.input('hold', 300, 1, false);
    expect(f.fire.mock.calls.map(c => [c[3], c[4], c[5]])).toEqual([[2, true, 100], [2, false, 300]]);
    expect(f.money()).toBe(72);
  });

  it('fires the paid partial salvo as soon as the next rocket is unaffordable', () => {
    const f = fixture(6, 15);
    f.input('hold', 0); f.runtime.update(100);
    expect(f.fire.mock.calls.map(c => c[3])).toEqual([2]);
    expect(f.money()).toBe(1);
    f.runtime.update(200); expect(f.pay).toHaveBeenCalledTimes(2);
    f.input('release', 201); expect(f.fire).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'blocked', 'build', 'timeout', 'lifecycle', 'removed', 'destroyed'] as const)
   ('discards costs and rejects delayed input after %s', reason => {
      const f = fixture(); f.input('hold', 0);
      if (reason === 'cancel') f.input('cancel', 1);
      if (reason === 'blocked') { f.block(); f.runtime.update(1); }
      if (reason === 'build') { f.rebuild(); f.runtime.update(1); }
      if (reason === 'timeout') f.runtime.update(2001);
      if (reason === 'lifecycle') f.runtime.cancelAll();
      if (reason === 'removed') { f.block(); f.runtime.removePlayer('p'); }
      if (reason === 'destroyed') f.runtime.destroy();
      expect(f.runtime.getState('p')).toBeUndefined(); expect(f.money()).toBe(93);
      expect(f.input('hold', 2100).ok).toBe(false);
      f.input('release', 2101); expect(f.fire).not.toHaveBeenCalled(); expect(f.pay).toHaveBeenCalledOnce();
    });

  it('a newer cancel prevents an out-of-order press from creating a charge', () => {
    const f = fixture(); f.input('cancel', 0, 5);
    expect(f.input('hold', 10, 4).ok).toBe(false);
    expect(f.input('hold', 10, 5).ok).toBe(false);
    expect(f.pay).not.toHaveBeenCalled();
    expect(f.input('hold', 10, 6).ok).toBe(true);
    expect(f.input('cancel', 11, 5).ok).toBe(false);
    expect(f.runtime.getState('p')?.loaded).toBe(1);
  });

  it('keeps the central gap for even salvos and focuses the entire exact angle matrix', () => {
    const expected = [[0], [-1, 1], [-1, 0, 1], [-2, -1, 1, 2], [-2, -1, 0, 1, 2], [-3, -2, -1, 1, 2, 3]];
    for (const [i, steps] of expected.entries()) {
      for (const focus of [1, 0.25]) {
        const angles = rocketSalvoAngles(i + 1, 0.7, 4, focus);
        expect(angles).toHaveLength(i + 1);
        angles.forEach((a, j) => expect(a).toBeCloseTo(0.7 + steps[j] * 4 * Math.PI / 180 * focus));
      }
    }
  });
});


describe('Rocket magazine release on another action', () => {
  it('fires the paid partial magazine once and rejects delayed input without extra costs', () => {
    const f = fixture();
    f.input('hold', 1000, 1, true);
    f.input('hold', 1100, 1, true);
    f.runtime.releaseForAction('p', 1120);
    expect(f.fire).toHaveBeenCalledExactlyOnceWith('p', expect.anything(),
      expect.objectContaining({ angle: 0.4, targetX: 170, targetY: 80 }), 2, true, 1120);
    expect(f.runtime.getState('p')).toBeUndefined();
    f.runtime.releaseForAction('p', 1121);
    expect(f.input('hold', 1122).ok).toBe(false);
    expect(f.input('release', 1123).ok).toBe(false);
    expect(f.pay).toHaveBeenCalledTimes(2);
    expect(f.fire).toHaveBeenCalledOnce();
    f.input('hold', 1150, 2);
    expect(f.pay).toHaveBeenCalledTimes(2);
    f.runtime.update(1220);
    expect(f.pay).toHaveBeenCalledTimes(3);
  });

  it.each(['empty', 'blocked', 'build', 'timeout', 'cancelled', 'destroyed'] as const)
    ('does not fire an %s magazine during an action', reason => {
      const f = fixture(reason === 'empty' ? 1 : 4);
      f.input('hold', 1000);
      if (reason === 'blocked') f.block();
      if (reason === 'build') f.rebuild();
      if (reason === 'cancelled') f.runtime.cancelAll();
      if (reason === 'destroyed') f.runtime.destroy();
      f.fire.mockClear();
      f.runtime.releaseForAction('p', reason === 'timeout' ? 3001 : 1001);
      expect(f.fire).not.toHaveBeenCalled();
      expect(f.pay).toHaveBeenCalledOnce();
      expect(f.runtime.getState('p')).toBeUndefined();
    });
});
