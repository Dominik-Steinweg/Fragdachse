import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFireControlWorldFixture } from '../FireControlTestHelper';
import { holoConfig } from '../InspectorUltimatesTestHelper';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../../src/config/coopDefenseConstructions';
import { resolveMgTurretStats } from '../../src/config/mgTurret';
import { WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';

let f: ReturnType<typeof createFireControlWorldFixture>;
afterEach(() => { f?.destroy(); vi.restoreAllMocks(); });
const start = 1000;
function activate(injectorProjectionEnabled = 0) {
  expect(f.binding.getHoloOffensiveCapability()!.tryActivate({ playerId: 'inspector', nowMs: start,
    config: { ...holoConfig, injectorProjectionEnabled }, consumedRage: holoConfig.rageRequired })).toEqual({ ok: true });
}
const copies = () => f.binding.getTurretFireSources().filter(source => source.projection);
const shots = () => f.projectile.spawn.mock.calls.map(([request]) => request);

describe('Holo host identity', () => {
  it('materializes ready to fire while the original rocket salvo is still in flight', () => {
    f = createFireControlWorldFixture(); const original = f.add('rocket_turret'); f.spawnEnemy();
    f.tick(start); activate(); f.projectile.spawn.mockClear();
    const at = start + holoConfig.materializeMs;
    f.tick(at);
    const copy = copies()[0];
    expect(shots().some(shot => shot.provenance.sourceTurretId === String(original.id))).toBe(true);
    expect(shots().some(shot => shot.provenance.sourceTurretId === copy.id)).toBe(true);
    f.placement.removeRock(original.id); f.projectile.spawn.mockClear();
    const burst = WEAPON_CONFIGS.TURRET_ROCKET_BURST.turretBurst!;
    for (let index = 1; index < burst.count; index++) f.tick(at + index * burst.intervalMs);
    expect(shots().filter(shot => shot.provenance.sourceTurretId === copy.id)).toHaveLength(burst.count - 1);
  });

  it('starts independent fire sequences and MG stacks, and routes copy angles to its snapshot', () => {
    f = createFireControlWorldFixture(); const original = f.add(), enemy = f.spawnEnemy();
    f.tick(start); // Original cooldown is already running when the copy materializes.
    activate(); f.projectile.spawn.mockClear();
    const now = start + holoConfig.materializeMs;
    f.tick(now);
    const copy = copies()[0], copyShot = shots().find(shot => shot.provenance.sourceTurretId === copy.id)!;
    expect(copyShot).toBeDefined();
    expect(copyShot.presentation?.turretVisualId).toBe(copy.id);
    expect(copyShot.provenance.personalMgOwnerId).toBe('inspector');
    f.hit(enemy, copyShot);
    const perHit = resolveMgTurretStats(key => f.stats.get(key) ?? 0).perHitPercent;
    expect(f.binding.mgTurret!.score('inspector', String(copy.id), 'enemy', enemy.id, now)).toBe(perHit);
    expect(f.binding.mgTurret!.score('inspector', String(original.id), 'enemy', enemy.id, now)).toBe(0);
    const snapshot = f.binding.getFireControlSnapshot(now).deployments.find(d => d.kind === 'holo')!;
    if (snapshot.kind !== 'holo') throw Error('holo');
    expect(snapshot.copies[0].angle).toBeCloseTo(copyShot.origin.angle);
    expect(snapshot.copies[0].angle).not.toBe(0);
    expect(f.binding.getTurretDefinitions().map(t => t.id)).toEqual([original.id]);
    expect(f.binding.systems!.turret.getTurrets().map(t => t.id)).toEqual([original.id]);
    expect(f.binding.getOffensiveConstructionSources().map(t => t.id)).toEqual([original.id]);
    f.tick(start + holoConfig.spawnIntervalMs + holoConfig.materializeMs);
    const nextCopy = copies().find(source => source.id !== copy.id)!;
    expect(nextCopy).toBeDefined();
    expect(f.binding.mgTurret!.score('inspector', String(nextCopy.id), 'enemy', enemy.id, now)).toBe(0);
  });

  it.each(['destroyed', 'manned', 'paused'] as const)('copies survive an original that is %s', state => {
    f = createFireControlWorldFixture(); const original = f.add(); f.spawnEnemy();
    if (state === 'manned') f.setManned(original.id);
    if (state === 'paused') expect(f.place(start, 300).ok).toBe(true);
    activate();
    if (state === 'destroyed') f.placement.removeRock(original.id);
    f.tick(start + holoConfig.materializeMs);
    expect(shots().some(s => s.provenance.sourceTurretId === copies()[0].id)).toBe(true);
  });

  it('shares deployment IDs with relay/portal but never assigns a portal to Holo', () => {
    f = createFireControlWorldFixture({ parallelEnabled: 1 }); f.add(); f.spawnEnemy();
    expect(f.place(start, 300).ok).toBe(true); activate();
    expect(f.binding.fireControl!.activatePortal({ ownerId: 'inspector', ownerColor: 1, originX: 0, originY: 0,
      restX: 500, restY: 0, nowMs: start, config: { durationMs: f.portalConfig.durationMs,
        cooldownMs: f.portalConfig.cooldown, damageBonus: f.portalConfig.damageBonus,
        localFireRelease: f.portalConfig.localFireEnabled > 0,
        exitClearanceRadiusPx: f.portalConfig.exitClearanceRadiusPx } }).ok).toBe(true);
    f.tick(start + holoConfig.materializeMs, false);
    const deployments = f.binding.getFireControlSnapshot(start + holoConfig.materializeMs).deployments;
    expect(new Set(deployments.map(d => d.id)).size).toBe(deployments.length);
    for (const copy of copies()) expect(copy.portal).toBeUndefined();
  });

  it.each([0, 1])('applies only the frozen injector projection, without remote/location bonuses (upgrade=%s)', enabled => {
    vi.spyOn(Date, 'now').mockReturnValue(start);
    f = createFireControlWorldFixture(); const original = f.add(); f.spawnEnemy(); f.setRemoteBonus(.5);
    const effect = COOP_DEFENSE_CONSTRUCTIONS.machine_gun_turret.energyInjectorEffect!;
    if (effect.type !== 'damage_turret') throw Error('damage effect');
    // A real injector beside both sources must not amplify the projection a second time.
    for (const [id, position] of [[String(original.id), f.point(original)], ['near-copy', { x: 120, y: 0 }]] as const) {
      f.injector.applyConstructionEffect(id, 'inspector', position.x, position.y, effect,
        { durationMs: holoConfig.copyLifetimeMs, focusDurationMs: 0, vulnerabilityBonus: 0, color: 1 }, start);
    }
    activate(enabled); f.tick(start + holoConfig.materializeMs);
    const copyShot = shots().find(s => s.provenance.sourceTurretId === copies()[0].id)!;
    expect(copyShot.interaction?.directHit?.damage).toBeCloseTo(resolveMgTurretStats().damage * (enabled ? effect.damageMultiplier : 1));
    expect(copyShot.provenance.injectorEffect).toEqual(enabled ? effect : undefined);
    expect(f.injector.getEffect(String(copies()[0].id), start)).toBeNull();
  });
});
