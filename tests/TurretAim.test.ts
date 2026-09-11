import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Angle: { Between: (x: number, y: number, tx: number, ty: number) => Math.atan2(ty - y, tx - x) },
    Distance: { Between: (x: number, y: number, tx: number, ty: number) => Math.hypot(tx - x, ty - y) },
  },
}));

import { TurretSystem, type AutomatedTurret } from '../src/systems/TurretSystem';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, type PlaceableTurretUtilityConfig } from '../src/loadout/LoadoutConfig';
import { stepTurretAngle, turretAngleDifference } from '../src/utils/turretAngle';
import { validateTurretAimConfig } from '../src/config/turretAim';
import { validateResolvedUtility } from '../src/loadout/content/LoadoutSchemas';

const rad = (degrees: number) => degrees * Math.PI / 180;
const config = UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig;
function fixture(overrides: Partial<AutomatedTurret> = {}) {
  const source = { id: 1, x: 0, y: 0, ownerId: 'owner', ownerColor: 0xffffff,
    targetRange: 500, muzzleOffset: 20, angle: 0, ...overrides };
  let sources: AutomatedTurret[] = [source];
  let targets = [{ id: 'enemy', x: 0, y: 100 }];
  const system = new TurretSystem({ getAllPlayers: () => [] } as never,
    { isAlive: () => true, isBurrowed: () => false, canDamageTarget: () => true } as never);
  const fire = vi.fn();
  system.setTurretProvider(() => sources, (_id, angle) => { source.angle = angle; });
  system.setEnemyTargetProvider(() => targets);
  system.setFireHandler(fire);
  return { system, source, fire,
    tick: (now: number, delta = 0) => system.hostUpdate(now, config, WEAPON_CONFIGS.SPORES, delta),
    targets: (next: typeof targets) => { targets = next; },
    remove: () => { sources = []; }, restore: () => { sources = [source]; },
  };
}

describe('turret aiming and discharge', () => {
  it('preserves immediate legacy rotation, fire and cooldown even with a tolerance alone', () => {
    const f = fixture({ aimToleranceDeg: 0, cooldownMs: 100 });
    f.tick(0);
    expect(f.source.angle).toBeCloseTo(Math.PI / 2);
    expect(f.fire).toHaveBeenCalledOnce();
    f.targets([{ id: 'enemy', x: -100, y: 0 }]);
    f.tick(99);
    expect(f.source.angle).toBeCloseTo(Math.PI);
    expect(f.fire).toHaveBeenCalledOnce();
    f.tick(100);
    expect(f.fire).toHaveBeenCalledTimes(2);
  });

  it('starts at the stored pose, waits for alignment and keeps turning during cooldown', () => {
    const f = fixture({ angle: rad(-45), rotationSpeedDegPerSec: 90, aimToleranceDeg: 0, cooldownMs: 2000 });
    f.tick(0);
    expect(f.source.angle).toBeCloseTo(rad(-45));
    f.tick(500, 500);
    expect(f.source.angle).toBeCloseTo(0);
    expect(f.fire).not.toHaveBeenCalled();
    f.tick(1500, 1000);
    expect(f.fire).toHaveBeenCalledOnce();
    f.targets([{ id: 'new', x: -100, y: 0 }]);
    f.tick(2000, 500);
    expect(f.source.angle).toBeCloseTo(rad(135));
    expect(f.fire).toHaveBeenCalledOnce();
    f.targets([]);
    f.tick(3000, 1000);
    expect(f.source.angle).toBeCloseTo(rad(135));
  });

  it.each([undefined, 6])('uses the actual angle and muzzle at the tolerance boundary (%s)', tolerance => {
    const degrees = tolerance ?? 3;
    const f = fixture({ rotationSpeedDegPerSec: 90, aimToleranceDeg: tolerance, angle: rad(90 - degrees - 0.1) });
    const line = vi.fn(() => true);
    f.system.setLineOfFireChecker(line);
    f.tick(0);
    expect(f.fire).not.toHaveBeenCalled();
    f.source.angle = rad(90 - degrees);
    f.tick(1);
    const shot = f.fire.mock.calls[0];
    expect(shot[5]).toBeCloseTo(rad(90 - degrees));
    expect(shot[3]).toBeCloseTo(Math.cos(shot[5]) * 20);
    expect(shot[4]).toBeCloseTo(Math.sin(shot[5]) * 20);
    const ray = line.mock.calls.at(-1)! as unknown as number[];
    expect(ray[0]).toBeCloseTo(shot[3]);
    expect(ray[1]).toBeCloseTo(shot[4]);
    expect(ray[2]).toBeCloseTo(Math.cos(shot[5]) * 100);
    expect(ray[3]).toBeCloseTo(Math.sin(shot[5]) * 100);
  });

  it('does not consume cooldown when the real ray is blocked and preserves obstacle exceptions', () => {
    const f = fixture({ rotationSpeedDegPerSec: 90, angle: rad(88), skipRockIndex: 7, sourceCarrierBaseId: 'carrier' });
    let blocked = true;
    const line = vi.fn((_sx, _sy, ex) => !blocked || Math.abs(ex) < 1e-8);
    f.system.setLineOfFireChecker(line);
    f.tick(0);
    expect(f.fire).not.toHaveBeenCalled();
    expect(line.mock.calls.at(-1)?.slice(4)).toEqual([7, 'carrier']);
    blocked = false;
    f.tick(0);
    expect(f.fire).toHaveBeenCalledOnce();
  });

  it('retains priority and score choices even when another target is already aligned', () => {
    const f = fixture({ rotationSpeedDegPerSec: 90 });
    f.targets([{ id: 'near', x: 40, y: 0 }, { id: 'scored', x: 0, y: 100 }, { id: 'focus', x: -100, y: 0 }]);
    f.system.setTargetScoreProvider((_s, _k, id) => id === 'scored' ? 10 : 0);
    f.tick(0, 100);
    expect(f.source.angle).toBeCloseTo(rad(9));
    expect(f.fire).not.toHaveBeenCalled();
    f.system.setFocusTargetProvider(() => ({ targetType: 'enemy', targetId: 'focus' }));
    f.tick(100, 100);
    expect(f.source.angle).toBeCloseTo(rad(18));
  });

  it('keeps the frozen burst target, tracks between shots and waits without consuming a shot', () => {
    const f = fixture({ weaponId: 'TURRET_ROCKET_BURST', rotationSpeedDegPerSec: 90, angle: rad(90) });
    const interval = WEAPON_CONFIGS.TURRET_ROCKET_BURST.turretBurst!.intervalMs;
    const cooldown = WEAPON_CONFIGS.TURRET_ROCKET_BURST.cooldown;
    f.tick(0);
    f.source.angle = 0;
    f.targets([{ id: 'new', x: -100, y: 0 }]);
    f.tick(interval / 2, 100);
    expect(f.source.angle).toBeCloseTo(rad(9));
    f.tick(interval, 100);
    expect(f.fire).toHaveBeenCalledOnce();
    f.tick(interval + 1000, 1000);
    expect(f.fire).toHaveBeenCalledTimes(2);
    expect(f.fire.mock.calls[1].slice(6, 8)).toEqual([0, 100]);
    f.tick(interval + 1000 + cooldown - 1, 2000);
    expect(f.fire).toHaveBeenCalledTimes(2);
    f.tick(interval + 1000 + cooldown);
    expect(f.fire).toHaveBeenCalledTimes(3);
  });

  it('rechecks cover between burst shots while retaining the concrete carrier', () => {
    const f = fixture({ weaponId: 'TURRET_ROCKET_BURST', sourceCarrierBaseId: 'carrier' });
    const clear = vi.fn(() => true); f.system.setLineOfFireChecker(clear);
    f.tick(0);
    const interval = WEAPON_CONFIGS.TURRET_ROCKET_BURST.turretBurst!.intervalMs;
    clear.mockReturnValue(false); f.tick(interval);
    expect(f.fire).toHaveBeenCalledOnce();
    clear.mockReturnValue(true); f.tick(interval + 1);
    expect(f.fire).toHaveBeenCalledTimes(2);
    expect(f.fire.mock.calls.every(call => call.at(-1) === 'carrier')).toBe(true);
  });

  it.each([undefined, 90])('gates secondary shots only for limited turrets (%s)', speed => {
    const f = fixture({ rotationSpeedDegPerSec: speed, secondProjectileDamageFactor: 0.5, cooldownMs: 1 });
    f.targets([{ id: 'first', x: 100, y: 0 }, { id: 'second', x: 0, y: 150 }]);
    f.tick(0);
    expect(f.fire).toHaveBeenCalledTimes(speed === undefined ? 2 : 1);
    f.fire.mockClear();
    f.targets([{ id: 'first', x: 100, y: 0 }, { id: 'second', x: 150, y: 1 }]);
    f.tick(1);
    expect(f.fire).toHaveBeenCalledTimes(2);
    if (speed !== undefined) expect(f.fire.mock.calls[1][5]).toBe(0);
  });

  it('does not consume fire state without a handler and clears it on removal', () => {
    const f = fixture({ rotationSpeedDegPerSec: 90, angle: rad(90) });
    f.system.setFireHandler(null);
    f.tick(0);
    f.system.setFireHandler(f.fire);
    f.tick(0);
    expect(f.fire).toHaveBeenCalledOnce();
    f.remove(); f.tick(0); f.restore(); f.tick(0);
    expect(f.fire).toHaveBeenCalledTimes(2);
  });

  it('leaves Tesla field sources untouched', () => {
    const f = fixture({ weaponId: 'TURRET_TESLA', rotationSpeedDegPerSec: 90 });
    f.tick(1000, 1000);
    expect(f.source.angle).toBe(0);
    expect(f.fire).not.toHaveBeenCalled();
  });
});

describe('angular motion and authoring', () => {
  it('crosses the wrap via the shortest path with deterministic half turns', () => {
    expect(stepTurretAngle(rad(179), rad(-170), 10, 500)).toBeCloseTo(rad(184));
    expect(stepTurretAngle(rad(-179), rad(170), 10, 500)).toBeCloseTo(rad(-184));
    expect(turretAngleDifference(0, Math.PI)).toBe(-Math.PI);
    expect(turretAngleDifference(0, -Math.PI)).toBe(-Math.PI);
  });
  it('is step-size independent, clamps at the target and ignores invalid durations', () => {
    let angle = 0;
    for (let i = 0; i < 10; i++) angle = stepTurretAngle(angle, 2, 90, 50);
    expect(angle).toBeCloseTo(stepTurretAngle(0, 2, 90, 500));
    expect(stepTurretAngle(0, 1, 90, 10000)).toBeCloseTo(1);
    for (const dt of [0, -1, NaN, Infinity]) expect(stepTurretAngle(0, 1, 90, dt)).toBe(0);
  });
  it('accepts absent fields and validates supplied fields through the utility boundary', () => {
    expect(validateTurretAimConfig({})).toEqual([]);
    for (const speed of [0, -1, NaN, Infinity]) {
      expect(validateResolvedUtility({ ...config, placeable: { ...config.placeable, rotationSpeedDegPerSec: speed } }))
        .toContain('$.placeable.rotationSpeedDegPerSec: positive finite number required');
    }
    for (const tolerance of [-1, 181, NaN, Infinity]) expect(validateTurretAimConfig({ aimToleranceDeg: tolerance })).not.toEqual([]);
    expect(validateResolvedUtility({ ...config, placeable: { ...config.placeable, rotationSpeedDegPerSec: 90, aimToleranceDeg: 0 } })).toEqual([]);
  });
});
