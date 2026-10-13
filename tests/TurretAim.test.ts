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
  it('finishes a released manual salvo and cannot gain shots by switching control modes mid-salvo', () => {
    const weapon = WEAPON_CONFIGS.TURRET_ROCKET_BURST;
    const f = fixture({ weaponId: 'TURRET_ROCKET_BURST' });
    let held = true;
    const manual = () => ({ playerId: 'pilot', revision: 1, targetX: 200, targetY: 0, fireHeld: held, fresh: true });
    f.system.setManualControlProvider(manual);
    f.tick(0); held = false;
    const end = (weapon.turretBurst!.count - 1) * weapon.turretBurst!.intervalMs;
    for (let t = weapon.turretBurst!.intervalMs; t <= end; t += weapon.turretBurst!.intervalMs) f.tick(t);
    expect(f.fire).toHaveBeenCalledTimes(weapon.turretBurst!.count);
    f.tick(end + weapon.cooldown); expect(f.fire).toHaveBeenCalledTimes(weapon.turretBurst!.count);
    held = true; f.tick(end + weapon.cooldown + 1);
    const count = f.fire.mock.calls.length, handoff = end + weapon.cooldown + 2;
    f.system.setManualControlProvider(null); f.tick(handoff);
    f.system.setManualControlProvider(manual); f.tick(handoff + 1);
    f.tick(handoff + weapon.cooldown - 1); expect(f.fire).toHaveBeenCalledTimes(count);
    f.tick(handoff + weapon.cooldown); expect(f.fire).toHaveBeenCalledTimes(count + 1);
  });

  it('uses manual aim for secondary shots with the existing range, buffs and carrier contract', () => {
    const f = fixture({ targetRange: 100, sourceCarrierBaseId: 'carrier', skipRockIndex: 1, secondProjectileDamageFactor: 0.5 });
    const line = vi.fn(() => false);
    f.system.setLineOfFireChecker(line);
    f.system.setTurretDamageBuffProvider(() => ({ damageMultiplier: 2 }));
    f.system.setTurretDamageMultiplierProvider(() => 3);
    f.system.setManualControlProvider(() => ({ playerId: 'pilot', revision: 1, targetX: 1000, targetY: 0, fireHeld: true, fresh: true }));
    f.targets([]); f.tick(0); expect(f.fire).not.toHaveBeenCalled();
    line.mockReturnValue(true); f.tick(1);
    expect(f.fire).toHaveBeenCalledTimes(2);
    expect(line).toHaveBeenCalledWith(20, 0, 100, 0, 1, 'carrier');
    expect(f.fire.mock.calls[0].slice(6, 9)).toEqual([100, 0, 6]);
    expect(f.fire.mock.calls[1].slice(6, 9)).toEqual([100, 0, 3]);
    expect(f.fire.mock.calls[1].slice(10, 13)).toEqual([1, 1, 'carrier']);
  });
  it('manually tracks the mouse through a burst using the normal muzzle, cadence and alignment', () => {
    const f = fixture({ weaponId: 'TURRET_ROCKET_BURST', rotationSpeedDegPerSec: 90, angle: 0 });
    let targetY = 0, held = false;
    f.system.setManualControlProvider(() => ({ playerId: 'pilot', revision: 1, targetX: 200, targetY,
      fireHeld: held, fresh: true }));
    f.targets([]);
    f.tick(0); expect(f.fire).not.toHaveBeenCalled();
    held = true; f.tick(1); expect(f.fire).toHaveBeenCalledOnce();
    const interval = WEAPON_CONFIGS.TURRET_ROCKET_BURST.turretBurst!.intervalMs;
    targetY = 200;
    f.tick(1 + interval, 0); expect(f.fire).toHaveBeenCalledOnce();
    f.tick(2 + interval, 1000);
    expect(f.fire).toHaveBeenCalledTimes(2);
    expect(f.fire.mock.calls[1][7]).toBeCloseTo(200);
    expect(f.fire.mock.calls[1][0]).toBe('owner');
  });

  it('keeps automation off while occupied and preserves cooldown through control handoff', () => {
    const f = fixture({ cooldownMs: 1000 });
    f.tick(0); expect(f.fire).toHaveBeenCalledOnce();
    f.system.setManualControlProvider(() => ({ playerId: 'pilot', revision: 1, targetX: 100, targetY: 0,
      fireHeld: true, fresh: true }));
    f.tick(500); expect(f.fire).toHaveBeenCalledOnce();
    f.tick(1000); expect(f.fire).toHaveBeenCalledTimes(2);
    f.system.setManualControlProvider(null);
    f.tick(1500); expect(f.fire).toHaveBeenCalledTimes(2);
  });
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
    expect(f.fire.mock.calls.every(call => call[12] === 'carrier')).toBe(true);
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

describe('hostile bases as third target tier', () => {
  const faces = [{ id: 'base', x: 200, y: 0 }, { id: 'base', x: 0, y: -220 }];

  it('attacks the nearest reachable base face only without focus or figure targets', () => {
    const f = fixture({ weaponId: 'TURRET_MG', cooldownMs: 1 });
    const candidates = vi.fn(() => faces);
    f.system.setBaseTargetCandidateProvider(candidates);
    f.tick(0);
    expect(f.fire.mock.calls[0].slice(6, 8)).toEqual([0, 100]);
    expect(candidates).not.toHaveBeenCalled();

    f.targets([]);
    f.tick(10);
    expect(f.fire.mock.calls[1].slice(6, 8)).toEqual([200, 0]);
    // Eine verdeckte Fläche wird nicht durchschossen; die nächste freie Fläche derselben Basis zählt.
    f.system.setLineOfFireChecker((_sx, _sy, ex) => ex !== 200);
    f.tick(20);
    expect(f.fire.mock.calls[2].slice(6, 8)).toEqual([0, -220]);
    f.system.setLineOfFireChecker(() => false);
    f.tick(30);
    expect(f.fire).toHaveBeenCalledTimes(3);
  });

  it('lets limited turrets fire at a base face only once the barrel actually covers it', () => {
    // Raketenturm-Toleranz 18°: Figuren erreicht Homing, eine ferne Basisfläche nicht.
    const f = fixture({ weaponId: 'TURRET_MG', rotationSpeedDegPerSec: 90, aimToleranceDeg: 18, targetRange: 700, angle: 0 });
    f.targets([]);
    f.system.setBaseTargetCandidateProvider(() => [{ id: 'base', x: 0, y: 600,
      hitSegment: { x1: -12, y1: 600, x2: 12, y2: 600 } }]);
    f.tick(0, 900);
    expect(f.source.angle).toBeCloseTo(rad(81));
    expect(f.fire).not.toHaveBeenCalled();
    f.tick(1, 200);
    expect(f.source.angle).toBeCloseTo(rad(90));
    expect(f.fire).toHaveBeenCalledOnce();
  });

  it('respects the turret range for base faces', () => {
    const f = fixture({ weaponId: 'TURRET_MG', targetRange: 150 });
    f.targets([]);
    f.system.setBaseTargetCandidateProvider(() => faces);
    f.tick(0);
    expect(f.fire).not.toHaveBeenCalled();
  });

  it('rejects a grazing ray inside tolerance until further rotation hits the trimmed face', () => {
    const f = fixture({ weaponId: 'TURRET_MG', rotationSpeedDegPerSec: 90, aimToleranceDeg: 18 });
    f.targets([]);
    f.system.setBaseTargetCandidateProvider(() => [{ id: 'base', x: 100, y: 2,
      hitSegment: { x1: 100, y1: 2, x2: 100, y2: 20 } }]);
    f.tick(0);
    expect(f.fire).not.toHaveBeenCalled();
    f.tick(1, 100);
    expect(f.fire).toHaveBeenCalledOnce();
    expect(f.fire.mock.calls[0][5]).toBeCloseTo(Math.atan2(2, 100));
  });

  it('retains the hit segment for follow-up shots even when the base provider changes', () => {
    const f = fixture({ weaponId: 'TURRET_ROCKET_BURST', rotationSpeedDegPerSec: 90,
      aimToleranceDeg: 18, angle: Math.atan2(2, 100) });
    f.targets([]);
    f.system.setBaseTargetCandidateProvider(() => [{ id: 'base', x: 100, y: 2,
      hitSegment: { x1: 100, y1: 2, x2: 100, y2: 20 } }]);
    f.tick(0);
    expect(f.fire).toHaveBeenCalledOnce();
    f.system.setBaseTargetCandidateProvider(() => []);
    f.source.angle = 0;
    const interval = WEAPON_CONFIGS.TURRET_ROCKET_BURST.turretBurst!.intervalMs;
    f.tick(interval);
    expect(f.fire).toHaveBeenCalledOnce();
    f.tick(interval + 1, 100);
    expect(f.fire).toHaveBeenCalledTimes(2);
  });

  it('checks the second projectile against its own segment along the same barrel ray', () => {
    const f = fixture({ weaponId: 'TURRET_MG', rotationSpeedDegPerSec: 90, aimToleranceDeg: 18,
      secondProjectileDamageFactor: 0.5, cooldownMs: 1 });
    f.targets([{ id: 'figure', x: 80, y: 0 }]);
    f.system.setBaseTargetCandidateProvider(() => [{ id: 'base', x: 100, y: 2,
      hitSegment: { x1: 100, y1: 2, x2: 100, y2: 20 } }]);
    f.tick(0);
    expect(f.fire).toHaveBeenCalledOnce();
    f.source.angle = Math.atan2(2, 100);
    f.tick(1);
    expect(f.fire).toHaveBeenCalledTimes(3);
    expect(f.fire.mock.calls[2][5]).toBe(f.fire.mock.calls[1][5]);
  });

  it.each([
    { name: 'beyond turret range', x: 100, y: 0, angle: rad(18), range: 102, muzzle: 20,
      hitSegment: { x1: 100, y1: -50, x2: 100, y2: 50 }, fires: false },
    { name: 'behind the muzzle', x: 10, y: 0, angle: 0, range: 100, muzzle: 20,
      hitSegment: { x1: 10, y1: -5, x2: 10, y2: 5 }, fires: false },
    { name: 'parallel miss', x: 100, y: 2, angle: 0, range: 150, muzzle: 20,
      hitSegment: { x1: 100, y1: 2, x2: 120, y2: 2 }, fires: false },
    { name: 'collinear overlap', x: 100, y: 0, angle: 0, range: 150, muzzle: 20,
      hitSegment: { x1: 100, y1: 0, x2: 120, y2: 0 }, fires: true },
    { name: 'collapsed midpoint', x: 100, y: 0, angle: 0, range: 100, muzzle: 20,
      hitSegment: { x1: 100, y1: 0, x2: 100, y2: 0 }, fires: true },
  ])('handles segment intersection: $name', ({ x, y, angle, range, muzzle, hitSegment, fires }) => {
    const f = fixture({ weaponId: 'TURRET_MG', rotationSpeedDegPerSec: 90, aimToleranceDeg: 18,
      angle, targetRange: range, muzzleOffset: muzzle });
    f.targets([]);
    f.system.setBaseTargetCandidateProvider(() => [{ id: 'base', x, y, hitSegment }]);
    f.tick(0);
    expect(f.fire).toHaveBeenCalledTimes(fires ? 1 : 0);
  });

  it.each(['figure', 'focused base', 'legacy base'] as const)('preserves early discharge without segment gating: %s', kind => {
    const f = fixture({ weaponId: 'TURRET_MG', aimToleranceDeg: 18, angle: rad(75),
      ...(kind === 'legacy base' ? {} : { rotationSpeedDegPerSec: 90 }) });
    if (kind !== 'figure') f.targets([]);
    if (kind === 'focused base') {
      f.system.setFocusTargetProvider(() => ({ targetType: 'base', targetId: 'base' }));
      f.system.setFocusedBaseTargetProvider(() => ({ id: 'base', x: 0, y: 100 }));
    }
    f.system.setBaseTargetCandidateProvider(() => [{ id: 'base', x: 0, y: 100,
      hitSegment: { x1: -2, y1: 100, x2: 2, y2: 100 } }]);
    f.tick(0);
    expect(f.fire).toHaveBeenCalledOnce();
  });

  it.each(['TURRET_GRAVITY', 'TURRET_SLOW_BUBBLE'] as const)('never lets the control turret %s shoot at bases, not even in focus', weaponId => {
    const f = fixture({ weaponId });
    const candidates = vi.fn(() => faces);
    f.targets([]);
    f.system.setBaseTargetCandidateProvider(candidates);
    f.system.setFocusTargetProvider(() => ({ targetType: 'base', targetId: 'base' }));
    f.system.setFocusedBaseTargetProvider(() => ({ id: 'base', x: 200, y: 0 }));
    f.tick(0);
    expect(f.fire).not.toHaveBeenCalled();
    expect(candidates).not.toHaveBeenCalled();
    // Figurenziele bleiben unberührt.
    f.targets([{ id: 'enemy', x: 0, y: 100 }]);
    f.tick(1);
    expect(f.fire.mock.calls[0].slice(6, 8)).toEqual([0, 100]);
  });

  it('keeps a valid base focus ahead of figures for damaging turrets', () => {
    const f = fixture({ weaponId: 'TURRET_MG' });
    f.system.setFocusTargetProvider(() => ({ targetType: 'base', targetId: 'base' }));
    f.system.setFocusedBaseTargetProvider(() => ({ id: 'base', x: 200, y: 0 }));
    f.tick(0);
    expect(f.fire.mock.calls[0].slice(6, 8)).toEqual([200, 0]);
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
