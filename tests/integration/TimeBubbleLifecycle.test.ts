import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Math: { Clamp: (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v)) },
  Geom: {
    Line: class { constructor(public x1 = 0, public y1 = 0, public x2 = 0, public y2 = 0) {} },
    Rectangle: class { constructor(public x = 0, public y = 0, public width = 0, public height = 0) {} },
    Intersects: { LineToRectangle: () => false, RectangleToRectangle: () => false },
  },
}));
import { PlayerUtilityActionRuntime } from '../../src/world/PlayerUtilityActionRuntime';
import { TimeBubbleSystem } from '../../src/systems/TimeBubbleSystem';
import { HostHeldActionSystem } from '../../src/systems/HostHeldActionSystem';
import { UTILITY_CONFIGS, type UtilityConfig } from '../../src/loadout/LoadoutConfig';
import type { ProjectileSpawnRequest } from '../../src/projectile/ProjectileSpawnRequest';
import { resolveRadialActions } from '../../src/systems/RadialActionModel';
import { WorldProjectileRuntime } from '../../src/projectile/WorldProjectileRuntime';
import { ProjectileIdentityScope } from '../../src/projectile/ProjectileIdentityScope';
import { createTechnicalPhysicsBinding, createPresentation } from '../ProjectileRuntimeTestHelper';

function fixture(focusEnabled = 1, useProjectileRuntime = false, chargeCapacity = 0) {
  const base = UTILITY_CONFIGS.TIME_BUBBLE;
  if (base.type !== 'time_bubble') throw Error('TimeBubble fixture');
  const config = { ...base, cooldown: 370, bubbleDuration: 610, focusEnabled, chargeCapacity };
  let equipped: UtilityConfig = config;
  let attempt = 0;
  let alive = true;
  let now = 1000;
  const physics = useProjectileRuntime ? createTechnicalPhysicsBinding() : null;
  const projectiles = physics ? new WorldProjectileRuntime({ physicsBinding: physics.binding,
    presentation: createPresentation(), identityScope: new ProjectileIdentityScope(1), hostNowMs: () => now }) : null;
  const spawned = new Map<number, ProjectileSpawnRequest>();
  const spawn = vi.fn((request: ProjectileSpawnRequest) => {
    const id = projectiles ? projectiles.spawnProjectile(request) : spawned.size + 1;
    if (id !== null) spawned.set(id, request);
    return id;
  });
  const focus = vi.fn();
  const discard = vi.fn();
  const cooldown = vi.fn();
  const publishState = vi.fn();
  const inventory = vi.fn();
  const used = vi.fn();
  const bubble = new TimeBubbleSystem();
  const held = new HostHeldActionSystem();
  const action = new PlayerUtilityActionRuntime({
    captureSmokeDamage: () => ({ sourceDamageMultiplier: 1 }), projectileSpawn: { spawnProjectile: spawn },
    combatSystem: {} as never,
    actor: { getPlayer: () => ({ x: 0, y: 0, color: 0x123456 }), canInteract: () => true, isAlive: () => alive, isUtilityBlocked: () => false },
    loadout: { getEquippedUtilityConfig: () => equipped, resolveUtilityConfig: (_p, c) => c, noteUtilityUsed() {} },
    heldAction: held, translocator: null, decoy: null, stinkCloud: null, gameAudioSystem: {} as never,
    network: { loadout: { publishUtilityCooldownUntil: cooldown, publishTimeBubbleUtilityState: publishState,
      publishTemporaryUtilityInstances: inventory, publishHeldUtilityId() {} }, roundStats: { recordUtilityUsed: used, recordConstructionBuilt() {} } },
    dropBeer() {}, nukeStrike: () => false, placeable: null,
    isToolAuthorized: () => true, resolveToolUtilityConfig: () => config,
  });
  bubble.setEndListener((id, now) => action.onTimeBubbleEnded(id, now));
  projectiles?.setProjectileResolvedCallback(outcome => action.onUtilityProjectileResolved(outcome.projectileId, now,
    outcome.kind === 'resolved' && outcome.grenadePayloadPending === true));
  action.setTimeBubblePort({
    create: (...args) => bubble.hostCreateBubble(...args),
    collapse: (id, request) => {
      const circle = bubble.removeBubble(id, request.nowMs);
      if (!circle) return false;
      focus({ ...circle, ...request }); return true;
    },
    remove: id => { bubble.removeBubble(id, 0, true); }, discardProjectile: discard,
  });
  const cast = (now = 1000, playerId = 'p1', temporaryUtilityInstanceId?: string) => {
    const heldActionId = `throw-${++attempt}`;
    action.startHeldAction(playerId, heldActionId, 'charged_throw', now, undefined, temporaryUtilityInstanceId);
    return action.execute({ category: 'utility', playerId, angle: 0, targetX: 50, targetY: 0, hostNowMs: now,
      attemptId: heldActionId, params: { heldActionId, temporaryUtilityInstanceId } });
  };
  const detonate = (now: number, playerId = 'p1', capturedBy?: string) => {
    const state = action.getTimeBubbleState(playerId);
    if (state?.phase !== 'flying') throw Error('Expected flying');
    const request = spawned.get(state.projectileId)!;
    action.createTimeBubbleFromGrenade({ projectileId: state.projectileId, x: 30, y: 40,
      provenance: capturedBy ? { ...request.provenance, allegiance: { ownerId: capturedBy } } : request.provenance,
      effect: request.interaction.grenadeEffect! }, now);
    action.onUtilityProjectileResolved(state.projectileId, now);
    const active = action.getTimeBubbleState(playerId);
    if (active?.phase !== 'active') throw Error('Expected active');
    return active.bubbleId;
  };
  const collapse = (id: number, now: number, playerId = 'p1', attemptId = `focus-${id}`) => action.execute({
    category: 'utility', playerId, angle: 0, targetX: 210, targetY: -30, hostNowMs: now, attemptId,
    params: { timeBubbleFocusId: id },
  });
  return { action, bubble, config, spawn, cast, detonate, collapse, focus, discard, cooldown, used, inventory, publishState, projectiles,
    stepProjectiles: (delta: number, at: number) => { now = at; return projectiles!.runHostProjectileStage(delta, at); },
    equip: (value: UtilityConfig) => { equipped = value; action.syncEquippedUtility('p1'); },
    setAlive: (value: boolean) => { alive = value; } };
}

describe('TimeBubble utility lifetime without an Activity', () => {
  it('creates the bubble after the real projectile runtime releases the detonated grenade', () => {
    const f = fixture(1, true, 37);
    expect(f.cast().ok).toBe(true);
    const detonationTime = 1000 + f.config.fuseTime;
    const result = f.stepProjectiles(f.config.fuseTime, detonationTime);
    expect(result.grenadePayloads).toHaveLength(1);
    expect(f.projectiles!.activeCount).toBe(0);
    expect(f.action.getTimeBubbleState('p1')?.phase).toBe('flying');
    // This is the host's deferred domain stage, after projectile teardown has already run.
    f.action.createTimeBubbleFromGrenade(result.grenadePayloads[0], detonationTime);
    const state = f.action.getTimeBubbleState('p1');
    expect(state?.phase).toBe('active');
    expect(f.bubble.hostUpdate(detonationTime)).toEqual([expect.objectContaining({ ownerId: 'p1', radius: f.config.bubbleRadius,
      chargeCapacity: f.config.chargeCapacity, charge: 0 })]);
    if (state?.phase !== 'active') throw Error('Expected bubble');
    expect(f.collapse(state.bubbleId, detonationTime + 1).ok).toBe(true);
    f.action.destroy(); f.projectiles!.destroy();
  });
  it('blocks overlapping throws and starts the full cooldown at natural expiry without any upgrade', () => {
    const f = fixture(0);
    expect(f.cast().ok).toBe(true);
    expect(f.cast(1010)).toEqual({ ok: false, reason: 'blocked' });
    expect(f.action.startHeldAction('p1', 'extra', 'charged_throw', 1100)).toBe(false);
    const id = f.detonate(1200);
    expect(f.collapse(id, 1250).ok).toBe(false);
    f.setAlive(false); f.bubble.hostUpdate(1300);
    expect(f.bubble.isBubbleActive(id, 1300)).toBe(true);
    f.setAlive(true);
    const end = 1200 + f.config.bubbleDuration;
    f.bubble.hostUpdate(end + 40);
    expect(f.action.getTimeBubbleState('p1')).toMatchObject({ phase: 'cooldown', cooldownUntil: end + f.config.cooldown });
    expect(f.cast(end + f.config.cooldown - 1)).toEqual({ ok: false, reason: 'cooldown' });
    expect(f.cast(end + f.config.cooldown).ok).toBe(true);
    expect(f.focus).not.toHaveBeenCalled();
    f.action.destroy();
  });

  it('focuses once with the requested cursor and rejects stale or foreign bubble identities', () => {
    const f = fixture(); f.cast(); const id = f.detonate(1200);
    expect(f.collapse(id, 1210, 'p2').ok).toBe(false);
    expect(f.collapse(id, 1300).ok).toBe(true);
    expect(f.collapse(id, 1301).ok).toBe(true); // committed retry
    expect(f.collapse(id, 1302, 'p1', 'different-attempt').ok).toBe(false);
    expect(f.focus).toHaveBeenCalledTimes(1);
    expect(f.focus).toHaveBeenCalledWith(expect.objectContaining({ targetX: 210, targetY: -30, ownerId: 'p1' }));
    expect(f.used).toHaveBeenCalledTimes(1);
    expect(f.action.getTimeBubbleState('p1')).toMatchObject({ cooldownUntil: 1300 + f.config.cooldown });
    f.action.update(1300 + f.config.cooldown);
    expect(f.collapse(id, 2000, 'p1', 'late').ok).toBe(false);
    expect(f.spawn).toHaveBeenCalledTimes(1);
    f.action.destroy();
  });

  it('keeps independent player casts and preserves original control after a projectile capture', () => {
    const f = fixture(); f.cast(1000); f.cast(1000, 'p2');
    const first = f.detonate(1200, 'p1', 'p2'); const second = f.detonate(1200, 'p2');
    expect(f.bubble.hostUpdate(1200).map(b => b.ownerId)).toEqual(['p2', 'p2']);
    expect(f.collapse(first, 1210, 'p2').ok).toBe(false);
    expect(f.collapse(first, 1210).ok).toBe(true);
    expect(f.bubble.isBubbleActive(second, 1210)).toBe(true);
    f.action.destroy(); expect(f.bubble.hostUpdate(1220)).toEqual([]);
  });

  it('retains control after the last temporary charge and shares the lock across inventory and equipment', () => {
    const f = fixture();
    const first = f.action.addTemporaryUtility('p1', f.config, 1)!;
    const second = f.action.addTemporaryUtility('p1', f.config, 2)!;
    expect(f.cast(1000, 'p1', first).ok).toBe(true);
    expect(f.action.getTemporaryUtilityConfig('p1', first)).toBeNull();
    expect(f.cast(1010, 'p1', second).ok).toBe(false);
    const id = f.detonate(1200);
    f.equip(UTILITY_CONFIGS.STINK_CLOUD);
    const actions = resolveRadialActions({ gameMode: 'deathmatch', tools: [], temporaryUtilities: [],
      timeBubbleState: f.action.getTimeBubbleState('p1'), persistentRewardIds: [], usedCapacity: 0, capacityMax: 100,
      canUseUtility: true, canPlace: true, canManage: true, now: 1200 });
    expect(actions).toEqual([expect.objectContaining({ ref: { kind: 'temporary-utility', instanceId: first, utilityId: 'TIME_BUBBLE' }, available: true })]);
    expect(f.collapse(id, 1300).ok).toBe(true);
    f.equip(f.config);
    expect(f.cast(1310).reason).toBe('cooldown');
    expect(f.action.useInspectorUtility('p1', { kind: 'utility', id: 'TIME_BUBBLE' }, f.config, 0, 0, 0, 1310).reason).toBe('cooldown');
    expect(f.cast(1300 + f.config.cooldown, 'p1', second).ok).toBe(true);
    f.action.destroy();
  });

  it('handles failed spawns, lost grenades, expiry races and silent teardown', () => {
    const f = fixture(); f.spawn.mockReturnValueOnce(null);
    expect(f.cast().ok).toBe(false); expect(f.action.getTimeBubbleState('p1')).toBeNull();
    f.cast(1100); const flying = f.action.getTimeBubbleState('p1');
    if (flying?.phase !== 'flying') throw Error('Expected flying');
    f.action.onUtilityProjectileResolved(flying.projectileId, 1150);
    expect(f.action.getTimeBubbleState('p1')).toMatchObject({ cooldownUntil: 1150 + f.config.cooldown });
    f.cast(1150 + f.config.cooldown); const id = f.detonate(1700);
    expect(f.collapse(id, 1700 + f.config.bubbleDuration).ok).toBe(false);
    expect(f.action.getTimeBubbleState('p1')).toMatchObject({ cooldownUntil: 1700 + f.config.bubbleDuration + f.config.cooldown });
    f.action.update(3000); f.cast(3000); f.action.removePlayer('p1');
    expect(f.discard).toHaveBeenCalledTimes(1); expect(f.action.getTimeBubbleState('p1')).toBeNull();
    expect(f.focus).not.toHaveBeenCalled(); f.action.destroy();
  });
});
