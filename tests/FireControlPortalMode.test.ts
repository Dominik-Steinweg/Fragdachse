import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFireControlSourceFixture, fireControlConstruction } from './FireControlTestHelper';
import { toLocalTurretFireSource, type AutomatedTurret, type TurretFireContext, type TurretFireSource } from '../src/systems/TurretSystem';
import type { TurretPortalAssignment } from '../src/systems/TurretFireSource';
import { buildTurretPortalRoute, FIRE_CONTROL_ENTRY_GAP_PX } from '../src/systems/fireControl/FireControlPortalRoute';

const EXIT = { x: 1000, y: 0 };
const assignment = (overrides: Partial<TurretPortalAssignment> = {}): TurretPortalAssignment => ({
  deploymentId: 4, exitX: EXIT.x, exitY: EXIT.y, damageBonus: 0.2, localFireRelease: false, expiresAt: 1e9, ...overrides });
const participant = (turret: AutomatedTurret, portal = assignment()): TurretFireSource =>
  ({ ...toLocalTurretFireSource(turret), portal });

let f: ReturnType<typeof createFireControlSourceFixture>;
const feedback = { reportEntry: vi.fn(), noteTransport: vi.fn(), isDeploymentActive: vi.fn(() => true) };
const setup = (turret: AutomatedTurret, portal: TurretPortalAssignment = assignment()) => {
  f = createFireControlSourceFixture();
  for (const fn of Object.values(feedback)) fn.mockClear();
  feedback.isDeploymentActive.mockReturnValue(true);
  f.system.setPortalFeedback(feedback);
  let angle = turret.angle ?? 0;
  const live = () => ({ ...turret, angle });
  f.angles.mockImplementation((_source, next: number) => { angle = next; });
  const refresh = (p: TurretPortalAssignment | null = portal) =>
    f.set([live()], [p ? participant(live(), p) : toLocalTurretFireSource(live())]);
  refresh();
  return { refresh, get angle() { return angle; } };
};
const contexts = () => f.fire.mock.calls.map(call => call[13] as TurretFireContext);
const lastMode = () => feedback.reportEntry.mock.calls.at(-1)?.[3];
afterEach(() => f?.destroy());

describe('Portal mode in the TurretSystem (GDD V2 §4.3–4.6)', () => {
  it('scenario 6: hits a target at the exit far outside the source range over several fire cycles', () => {
    const turret = fireControlConstruction({ targetRange: 300 });
    const s = setup(turret);
    f.setEnemies([{ id: 'far', x: EXIT.x + 200, y: 0 }]);
    for (let now = 1000; now <= 3200; now += 1100) { s.refresh(); f.tick(now); }
    expect(f.fire).toHaveBeenCalledTimes(3);
    for (const context of contexts()) {
      expect(context.route).toMatchObject({ deploymentId: 4, exit: EXIT, damageBonus: 0.2 });
      expect(context.route!.entry.x).toBeCloseTo(FIRE_CONTROL_ENTRY_GAP_PX);
    }
    // The weapon's cursor reach is measured over the real sections only, never over the jump.
    expect(f.fire.mock.calls[0][6]).toBeCloseTo(FIRE_CONTROL_ENTRY_GAP_PX + 200);
    expect(feedback.noteTransport).toHaveBeenCalledTimes(3);
    expect(lastMode()).toBe('portal');
  });

  it('scenario 7: rotates with the normal speed towards exit → target; the entry follows the muzzle', () => {
    const turret = fireControlConstruction({ rotationSpeedDegPerSec: 90, aimToleranceDeg: 5, muzzleOffset: 20 });
    const s = setup(turret);
    f.setEnemies([{ id: 'north', x: EXIT.x, y: EXIT.y + 300 }]);
    f.tick(1000, 100);
    expect(f.fire).not.toHaveBeenCalled();
    expect(s.angle).toBeCloseTo(Math.PI / 20);
    const [, , , mode, x, y, angle] = feedback.reportEntry.mock.calls.at(-1)!;
    expect(mode).toBe('portal');
    expect(angle).toBeCloseTo(s.angle);
    expect(Math.hypot(x, y)).toBeCloseTo(20 + FIRE_CONTROL_ENTRY_GAP_PX);
    for (let now = 1100; now <= 2000 && !f.fire.mock.calls.length; now += 100) { s.refresh(); f.tick(now, 100); }
    expect(f.fire).toHaveBeenCalledOnce();
    expect(f.fire.mock.calls[0][5]).toBeCloseTo(Math.PI / 2, 1);
  });

  it('scenario 8: only the real sections need a free line of fire; the exit section has no source exceptions', () => {
    const turret = fireControlConstruction({ skipRockIndex: 3 });
    const checks: [number, number, number | undefined][] = [];
    let blockMuzzle = false;
    setup(turret);
    // A wall between entry and exit (x 100…900) never blocks; exceptions only help the source section.
    f.system.setLineOfFireChecker((sx, _sy, ex, _ey, skip) => {
      checks.push([sx, ex, skip]);
      if (sx >= EXIT.x - 1) return skip === undefined;
      return !blockMuzzle;
    });
    f.setEnemies([{ id: 'e', x: EXIT.x + 100, y: 0 }]);
    f.tick(1000);
    expect(f.fire).toHaveBeenCalledOnce();
    expect(checks.some(([sx, , skip]) => sx >= EXIT.x - 1 && skip !== undefined)).toBe(false);
    expect(checks.some(([sx, ex, skip]) => sx < 100 && ex < 100 && skip === 3)).toBe(true);
    blockMuzzle = true;
    f.tick(3000);
    expect(f.fire).toHaveBeenCalledOnce();
    expect(lastMode()).toBe('portal');
  });

  it('scenario 10: without the boss node a source without exit target stays silent despite a local target', () => {
    setup(fireControlConstruction());
    f.setEnemies([{ id: 'local', x: 100, y: 0 }]);
    f.tick(1000);
    expect(f.fire).not.toHaveBeenCalled();
    expect(lastMode()).toBe('waiting');
  });

  it('scenario 10: the boss node fights locally without an exit target and returns without a cooldown reset', () => {
    const s = setup(fireControlConstruction(), assignment({ localFireRelease: true }));
    f.setEnemies([{ id: 'local', x: 100, y: 0 }]);
    f.tick(1000);
    expect(contexts()[0].route).toBeUndefined();
    expect(lastMode()).toBe('local');
    f.setEnemies([{ id: 'local', x: 100, y: 0 }, { id: 'exit', x: EXIT.x + 100, y: 0 }]);
    s.refresh(); f.tick(1500);
    // An exit target exists: no local extra shot while reloading, and the sequence is not reset.
    expect(f.fire).toHaveBeenCalledOnce();
    expect(lastMode()).toBe('portal');
    s.refresh(); f.tick(2000);
    expect(f.fire).toHaveBeenCalledTimes(2);
    expect(contexts()[1].route).toMatchObject({ exit: EXIT });
  });

  it('D35/D12: a portal burst stays on its route, follows the barrel and ends with the deployment', () => {
    const turret = fireControlConstruction({ weaponId: 'TURRET_ROCKET_BURST', cooldownMs: 1800 });
    const s = setup(turret);
    f.setEnemies([{ id: 'e', x: EXIT.x + 100, y: 0 }]);
    f.tick(1000);
    expect(contexts()[0].route).toBeDefined();
    f.setEnemies([]);
    s.refresh(); f.tick(1200);
    expect(f.fire).toHaveBeenCalledTimes(2);
    expect(contexts()[1].route).toMatchObject({ exit: EXIT });

    // Deployment ended mid-burst: the rest is aborted and the regular cooldown is booked.
    f.setEnemies([{ id: 'e', x: EXIT.x + 100, y: 0 }]);
    s.refresh(); f.tick(3000);
    expect(f.fire).toHaveBeenCalledTimes(3);
    feedback.isDeploymentActive.mockReturnValue(false);
    s.refresh(null); f.tick(3200);
    f.setEnemies([{ id: 'local', x: 100, y: 0 }]);
    f.tick(3300);
    expect(f.fire).toHaveBeenCalledTimes(3);
    f.tick(3200 + 1800);
    expect(f.fire).toHaveBeenCalledTimes(4);
    expect(contexts()[3].route).toBeUndefined();
  });

  it('E14/D40: builds no route that the projectile runtime would reject', () => {
    const base = { deploymentId: 1, sourceX: 0, sourceY: 0, angle: 0, muzzleOffset: 10, exitX: 500, exitY: 0,
      targetX: 600, targetY: 0, damageBonus: 0, effectiveRangePx: 400 };
    expect(buildTurretPortalRoute(base)).toMatchObject({ entry: { x: 10 + FIRE_CONTROL_ENTRY_GAP_PX, y: 0 },
      rangeTargetX: 10 + FIRE_CONTROL_ENTRY_GAP_PX + 100 });
    expect(buildTurretPortalRoute({ ...base, effectiveRangePx: FIRE_CONTROL_ENTRY_GAP_PX })).toBeNull();
    expect(buildTurretPortalRoute({ ...base, damageBonus: -0.1 })).toBeNull();
    expect(buildTurretPortalRoute({ ...base, exitX: Number.NaN })).toBeNull();
  });
});
