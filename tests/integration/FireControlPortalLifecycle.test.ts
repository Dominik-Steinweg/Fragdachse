import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFireControlWorldFixture } from '../FireControlTestHelper';
import type { ProjectileGrenadePayloadRequest } from '../../src/projectile/ProjectileExplosionPort';

vi.mock('../../src/network/bridge', () => ({ bridge: {
  getSynchronizedNow: () => 1000, isArenaCountdownActive: () => false,
  getActivityDescriptor: () => null, getActiveGameMode: () => 'coop_defense',
  getConnectedPlayers: () => [], getLocalPlayerId: () => 'headless',
  getPlayerHeldItemId: () => null, getPlayerInput: () => null, flushEffects() {},
  consumeFullGameStateRequest: () => false, publishGameState() {},
} }));
import { HostUpdateCoordinator } from '../../src/scenes/arena/HostUpdateCoordinator';
import { healthBarTestScene } from '../healthBarTestScene';

type Fixture = ReturnType<typeof createFireControlWorldFixture>;
let f: Fixture;
afterEach(() => f?.destroy());

const portal = () => f.action.getFireControlState('inspector', 'FIRE_CONTROL_PORTAL');
/** Brings the real device to rest and runs the projectile stage that releases its payload. */
const land = (at: number, x?: number): ProjectileGrenadePayloadRequest => {
  const state = portal();
  if (state?.phase !== 'flying') throw Error('Expected flying portal');
  const handle = f.projectile.physics.handles.get(state.projectileId)!;
  if (x !== undefined) handle.body.reset(x, handle.sprite.y);
  handle.body.setVelocity(0, 0);
  const stage = f.projectile.advance(at - f.projectile.now);
  expect(stage.grenadePayloads).toHaveLength(1);
  return stage.grenadePayloads[0];
};

describe('Portal throw, usage and deployment (GDD V2 §4.1, §7.1)', () => {
  it('throws without bounces, lands at rest, opens the exit and starts cooldown at the deployment end', () => {
    f = createFireControlWorldFixture(); f.add('rocket_turret');
    expect(f.throwPortal(1000).ok).toBe(true);
    const request = f.projectile.spawn.mock.calls.at(-1)![0];
    expect(request.flight).toMatchObject({ isGrenade: true, maxBounces: 0, fuseTimeMs: f.portalConfig.fuseTime });
    expect(request.interaction.grenadeEffect).toMatchObject({ type: 'fire_control_portal' });
    expect(portal()).toMatchObject({ phase: 'flying', config: { durationMs: f.portalConfig.durationMs,
      exitClearanceRadiusPx: f.portalConfig.exitClearanceRadiusPx } });
    // A second use is rejected while flying (D45), without another spawn.
    const spawns = f.projectile.spawn.mock.calls.length;
    expect(f.throwPortal(1010)).toMatchObject({ ok: false, reason: 'blocked' });
    expect(f.projectile.spawn.mock.calls.length).toBe(spawns);

    const payload = land(1100, 240);
    expect(portal()?.phase).toBe('flying');
    f.action.createFireControlPortalFromGrenade(payload, 1100);
    expect(portal()).toMatchObject({ phase: 'active' });
    const deployment = f.binding.getFireControlSnapshot(1100).deployments[0];
    expect(deployment).toMatchObject({ kind: 'portal', ownerId: 'inspector', x: 240,
      expiresAt: 1100 + f.portalConfig.durationMs, localFireRelease: false });
    expect(f.throwPortal(1200)).toMatchObject({ ok: false, reason: 'blocked' });

    const end = 1100 + f.portalConfig.durationMs;
    f.tick(end, false);
    expect(f.binding.getFireControlSnapshot(end).deployments).toEqual([]);
    expect(portal()).toMatchObject({ phase: 'cooldown', cooldownUntil: end + f.portalConfig.cooldown });
    expect(f.cooldown).toHaveBeenLastCalledWith('inspector', end + f.portalConfig.cooldown, 'FIRE_CONTROL_PORTAL');
    expect(f.throwPortal(end + 1)).toMatchObject({ ok: false, reason: 'cooldown' });
    f.tick(end + f.portalConfig.cooldown, false);
    expect(portal()).toBeNull();
  });

  it('rejects the throw before any consumption when the owner has no fire source; a missing enemy is fine', () => {
    f = createFireControlWorldFixture();
    expect(f.throwPortal(1000)).toEqual({ ok: false, reason: 'no_fire_sources' });
    f.add('rocket_turret', 'ally');
    f.add('machine_gun_turret', 'inspector', 9);
    f.setManned(f.placement.getAllRuntimeRocks().find(r => r.ownerId === 'inspector')!.id);
    expect(f.throwPortal(1000)).toEqual({ ok: false, reason: 'no_fire_sources' });
    expect(f.projectile.spawn).not.toHaveBeenCalled();
    expect(portal()).toBeNull();
    f.setManned(null);
    expect(f.throwPortal(1000).ok).toBe(true);
  });

  it('opens at the last valid flight position when the device comes to rest on an invalid point (D34)', () => {
    f = createFireControlWorldFixture(); f.add('rocket_turret');
    f.throwPortal(1000);
    const payload = land(1100, 300);
    f.setFree(false);
    f.action.createFireControlPortalFromGrenade(payload, 1100);
    // The fixture geometry rejects every point, so the walk back ends at the release point (the throw muzzle).
    const { origin } = f.projectile.spawn.mock.calls.at(-1)![0];
    const release = origin.gameplayMuzzleOrigin ?? origin;
    expect(f.binding.getFireControlSnapshot(1100).deployments[0]).toMatchObject({ kind: 'portal', x: release.x, y: release.y });
    expect(portal()?.phase).toBe('active');
  });

  it('dispatches the payload through its explicit host branch, never through smoke', () => {
    f = createFireControlWorldFixture(); f.add('rocket_turret');
    f.throwPortal(1000);
    const payload = land(1100, 200);
    const smoke = vi.fn();
    const host = new HostUpdateCoordinator(healthBarTestScene().scene, { getWorldCombatCore: () => f.combat } as never,
      {} as never, {} as never, {} as never);
    host.setPlayerFramePort({ getPlayerGameplayRuntime: () => ({
      getPlayerCombatIntegrationPort: () => ({ utility: f.action }) }) } as never);
    host.setCombatFramePort({ getSupportGameplayRuntime: () => ({ smoke: { createCloud: smoke } }) } as never);
    (host as unknown as { resolveGrenadePayload(r: ProjectileGrenadePayloadRequest): void }).resolveGrenadePayload(payload);
    expect(smoke).not.toHaveBeenCalled();
    expect(portal()?.phase).toBe('active');
  });

  it('ends terminally with cooldown when the device is lost in flight without payload (D44)', () => {
    f = createFireControlWorldFixture(); f.add('rocket_turret');
    f.throwPortal(1000);
    const state = portal();
    if (state?.phase !== 'flying') throw Error('flying');
    f.action.onUtilityProjectileResolved(state.projectileId, 1050);
    expect(portal()).toMatchObject({ phase: 'cooldown', cooldownUntil: 1050 + f.portalConfig.cooldown });
    expect(f.binding.getFireControlSnapshot(1050).deployments).toEqual([]);
  });

  it('runs copies and portals independently; activity cleanup and owner removal clear both silently', () => {
    f = createFireControlWorldFixture(); f.add('rocket_turret'); f.add('machine_gun_turret', 'inspector', 9);
    expect(f.place(1000, 100, 0).ok).toBe(true);
    expect(f.throwPortal(1000).ok).toBe(true);
    f.action.createFireControlPortalFromGrenade(land(1100, 200), 1100);
    expect(f.binding.getFireControlSnapshot(1100).deployments.map(d => d.kind).sort()).toEqual(['copies', 'portal']);
    expect(f.action.getFireControlState('inspector')?.phase).toBe('active');
    f.action.removePlayer('inspector');
    expect(portal()).toBeNull();
    expect(f.binding.getFireControlSnapshot(1100).deployments).toEqual([]);

    // A flying device is discarded silently by activity cleanup; a late payload cannot reopen it.
    expect(f.throwPortal(1200).ok).toBe(true);
    const state = portal();
    if (state?.phase !== 'flying') throw Error('flying');
    f.binding.clearActivityBindings();
    expect(portal()).toBeNull();
    expect(f.projectile.projectiles.activeCount).toBe(0);
    f.action.createFireControlPortalFromGrenade({ projectileId: state.projectileId, x: 1, y: 1,
      provenance: f.projectile.spawn.mock.calls.at(-1)![0].provenance, effect: { type: 'fire_control_portal', ownerColor: 0 } }, 1300);
    expect(f.binding.getFireControlSnapshot(1300).deployments).toEqual([]);
  });
});
