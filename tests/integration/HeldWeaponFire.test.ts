import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const base = (await import('../fakeArenaRenderScene')).createFakePhaserModule() as any;
  class Line {
    constructor(public x1 = 0, public y1 = 0, public x2 = 0, public y2 = 0) {}
    setTo(x1: number, y1: number, x2: number, y2: number) {
      Object.assign(this, { x1, y1, x2, y2 }); return this;
    }
    static Length(l: Line) { return Math.hypot(l.x2 - l.x1, l.y2 - l.y1); }
  }
  class Rectangle {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
    setTo(x: number, y: number, width: number, height: number) {
      Object.assign(this, { x, y, width, height }); return this;
    }
  }
  return {
    ...base,
    BlendModes: { ADD: 1, NORMAL: 0 },
    Geom: { Line, Rectangle, Circle: class {
      setTo(x: number, y: number, radius: number) { Object.assign(this, { x, y, radius }); return this; }
    }, Intersects: {
      GetLineToCircle: (l: Line, c: { x: number; y: number; radius: number }, out: { x: number; y: number }[] = []) => {
        const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
        const x = l.x1 - c.x, y = l.y1 - c.y;
        const a = dx * dx + dy * dy, b = 2 * (x * dx + y * dy);
        const d = b * b - 4 * a * (x * x + y * y - c.radius * c.radius);
        if (a > 0 && d >= 0) for (const t of [(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)]) {
          if (t >= 0 && t <= 1) out.push({ x: l.x1 + t * dx, y: l.y1 + t * dy });
        }
        return out;
      },
      GetLineToRectangle: (l: Line, r: Rectangle, out: { x: number; y: number }[] = []) => {
        const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
        for (const x of [r.x, r.x + r.width]) {
          const t = (x - l.x1) / dx, y = l.y1 + t * dy;
          if (t >= 0 && t <= 1 && y >= r.y && y <= r.y + r.height) out.push({ x, y });
        }
        for (const y of [r.y, r.y + r.height]) {
          const t = (y - l.y1) / dy, x = l.x1 + t * dx;
          if (t >= 0 && t <= 1 && x >= r.x && x <= r.x + r.width) out.push({ x, y });
        }
        return out;
      },
    } },
    Math: {
      ...base.Math,
      Clamp: (n: number, min: number, max: number) => Math.max(min, Math.min(max, n)),
      Distance: { Between: (x: number, y: number, tx: number, ty: number) => Math.hypot(tx - x, ty - y) },
    },
  };
});

const network = vi.hoisted(() => ({
  isHost: () => true,
  getLocalPlayerId: () => 'shooter',
  getCurrentWorldRevision: () => 1,
  getLatestGameState: () => ({ worldRevision: 1, players: {} }),
  isArenaCountdownActive: () => false,
  getActiveGameMode: () => 'deathmatch',
  getPlayerCurrentLoadoutSnapshot: () => null,
  registerLoadoutUseHandler: vi.fn(),
}));
vi.mock('../../src/network/bridge', () => ({ bridge: network }));

import { ArenaInputBindings, type ArenaInputBindingsInput } from '../../src/scenes/arena/ArenaInputBindings';
import { ClientUpdateCoordinator } from '../../src/scenes/arena/ClientUpdateCoordinator';
import { RpcCoordinator } from '../../src/scenes/arena/RpcCoordinator';
import { PlayerWeaponActivationRuntime } from '../../src/world/PlayerWeaponActivationRuntime';
import { PlayerActionRuntime } from '../../src/world/PlayerActionRuntime';
import { WorldWeaponExecutionRuntime } from '../../src/world/WorldWeaponExecutionRuntime';
import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { LoadoutManager } from '../../src/loadout/LoadoutManager';
import type { BaseWeapon } from '../../src/loadout/BaseWeapon';
import { WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { EffectSystem } from '../../src/effects/EffectSystem';
import { fakeEntity } from '../fakeEntity';
import { healthBarTestScene } from '../healthBarTestScene';
import { PlayerEntity } from '../../src/entities/PlayerEntity';
import { CameraFeedbackController } from '../../src/effects/camera/CameraFeedbackController';
import type { SyncedHitscanTrace, LoadoutUseParams, LoadoutUseResult, WeaponSlot } from '../../src/types';
import { WeaponFireFeedbackController } from '../../src/effects/weapon/WeaponFireFeedbackController';
import type { WeaponShotFeedbackEvent } from '../../src/loadout/WeaponShotFeedbackEvent';

// Compose the real input, prediction, RPC, activation, cooldown, combat and trace-dedupe paths.
// Only renderer/audio and the transport delivery are headless ports.
function fixture(remote = false, weaponId = 'ASMD_PRIM', pelletCount?: number) {
  let now = 1_000;
  let processingDelay = 0;
  let processingHost = false;
  let resourceCost = 0;
  vi.spyOn(network, 'isHost').mockImplementation(() => !remote || processingHost);
  vi.spyOn(network, 'getLocalPlayerId').mockImplementation(() => remote && processingHost ? 'host' : 'shooter');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const config = pelletCount === undefined ? WEAPON_CONFIGS[weaponId] : { ...WEAPON_CONFIGS[weaponId], pelletCount };
  const fireSlot = config.allowedSlots.includes('weapon1') ? 'weapon1' : 'weapon2';
  const players = [
    fakeEntity({ id: 'shooter', x: 300, y: 200, color: 0xffffff, rotation: 0 }),
    fakeEntity({ id: 'target', x: 500, y: 200, color: 0xffffff, rotation: 0 }),
  ];
  const playerManager = {
    getAllPlayers: () => players,
    getPlayer: (id: string) => players.find(p => p.id === id),
  };
  function effects(localId: string) {
    const effect = Object.create(EffectSystem.prototype);
    Object.assign(effect, {
      bridge: { getLocalPlayerId: () => localId },
      scene: { time: { now: 0 } },
      pendingPredictedTracerIds: new Map(), processedSyncedTracerKeys: new Map(),
      // Same dedupe storage as the live EffectSystem, without allocating renderers.
      audioSystem: { playSound: vi.fn(), playLocalSound: vi.fn() },
      playHitscanTracer: vi.fn(),
    });
    return effect as EffectSystem & { audioSystem: { playSound: ReturnType<typeof vi.fn>; playLocalSound: ReturnType<typeof vi.fn> } };
  }
  function weaponView() {
    const { scene } = healthBarTestScene();
    Object.defineProperty(scene.time, 'now', { get: () => now });
    const addImage = scene.add.image;
    scene.add.image = (...args: unknown[]) => {
      const image = addImage(...args);
      Object.assign(image.frame, { cutWidth: 32, cutHeight: 32 });
      const setSize = image.setDisplaySize.bind(image);
      image.setDisplaySize = (w: number, h: number) => {
        image.scaleX = w / image.frame.cutWidth;
        image.scaleY = h / image.frame.cutHeight;
        return setSize(w, h);
      };
      return image;
    };
    const player = new PlayerEntity(scene, { id: 'shooter', name: 'Shooter', colorHex: 0xffffff },
      300, 200, false, null, { spawnEffect: false });
    player.setRotation(0); // aim east; PlayerEntity applies the sprite's north-facing offset
    player.setHeldItemId('GLOCK');
    vi.spyOn(player, 'playHeldWeaponShot');
    const camera = new CameraFeedbackController(scene, {
      getListener: () => ({ x: player.x, y: player.y }), getMotionScale: () => 1,
    });
    const viewport = { scrollX: 0, scrollY: 0 };
    const request = vi.fn(camera.request.bind(camera));
    return { player, camera, viewport, request };
  }
  const localView = weaponView(), remoteView = weaponView();
  const localWeapon = localView.player, remoteWeapon = remoteView.player;
  const localKick = localView.request, remoteKick = remoteView.request;
  const feedback = (localId: string, view: ReturnType<typeof weaponView>) => new WeaponFireFeedbackController({
    getPlayer: id => id === 'shooter' ? view.player : undefined, getLocalPlayerId: () => localId,
    getWorldRevision: () => 1, isLocalTriggerHeld: () => true,
    requestCamera: view.request, cancelCamera: () => view.camera.cancel('weapon:local-shot'),
  });
  const localFeedback = feedback('shooter', localView);
  const remoteFeedback = feedback('target', remoteView);
  const shotEvents: WeaponShotFeedbackEvent[] = [];
  const projectiles: unknown[] = [];
  const localEffects = effects('shooter');
  const remoteEffects = effects('target');
  const traces: SyncedHitscanTrace[] = [];
  const combat = new WorldCombatCore(playerManager as never, {
    getLatestGameState: () => null,
    isHost: () => true,
    areTeammates: () => false,
    getPlayerProfile: () => undefined,
    broadcastEffect: vi.fn(),
    broadcastHitscanTracer: (...args: unknown[]) => {
      const [startX, startY, endX, endY, color, thickness, impactKind, visualPreset, shooterId, shotId, shotAudioKey, visualStartX, visualStartY] = args;
      const trace = { startX, startY, endX, endY, color, thickness, impactKind, visualPreset, shooterId, shotId, shotAudioKey, visualStartX, visualStartY } as SyncedHitscanTrace;
      traces.push(trace);
      localEffects.playSyncedHitscanTracer(trace);
      remoteEffects.playSyncedHitscanTracer(trace);
    },
  } as never);
  combat.bindHostExecutionSources({ nowMs: () => now + processingDelay, random: () => 0.5 });
  combat.setPlayerMaxHpResolver(() => config.damage * 100);
  players.forEach(p => combat.initPlayer(p.id as string));
  const prediction = Object.create(ClientUpdateCoordinator.prototype) as ClientUpdateCoordinator;
  const aim = vi.fn();
  const hud = vi.fn();
  Object.assign(prediction, {
    ctx: { playerManager, getWorldCombatCore: () => combat, effectSystem: localEffects,
      visualFeedback: { weaponFire: localFeedback },
      aimSystem: { notifyShot: aim }, leftPanel: { flashSlot: hud } },
    weaponLastFired: { weapon1: 0, weapon2: 0 },
    localFirePredictions: { weapon1: [], weapon2: [] },
    pendingAdrenalineSpends: new Map(), authoritativeAdrenaline: null,
    nextPredictionId: 1, nextPrimaryPredictionId: 1, nextPredictedHitscanShotId: 1,
    getLocalWeaponConfig: () => config,
  });
  const loadout = new LoadoutManager({} as never, { getGameMode: () => 'deathmatch' });
  loadout.assignDefaultLoadout('shooter', { [fireSlot]: config });
  const item = (loadout as unknown as { loadouts: Map<string, Record<WeaponSlot, BaseWeapon>> }).loadouts.get('shooter')![fireSlot];
  const commits = vi.spyOn(item, 'recordUse');
  const execution = new WorldWeaponExecutionRuntime({ combatSystem: combat, projectileSpawn: {
    spawnProjectile: (request: unknown) => { projectiles.push(request); return { uid: projectiles.length }; },
  } as never });
  const activation = new PlayerWeaponActivationRuntime({
    playerManager: playerManager as never,
    loadout,
    resourceSystem: { getAdrenaline: () => 100, resolveAdrenalineCost: () => resourceCost, drainAdrenaline: vi.fn() },
    weaponExecution: execution, specializedWeaponExecution: { fire: () => false },
    broadcastShotFx: (event) => { shotEvents.push(event); localFeedback.confirm(event); remoteFeedback.confirm(event); },
  });
  const playerAction = new PlayerActionRuntime({
    getPlayer: playerManager.getPlayer as never,
    canInteract: () => true, isAlive: () => true,
    isWeaponBlocked: () => false, isDashBurst: () => false,
  }, loadout, null, activation);
  const capabilities = { canInteract: true, canUseCombat: true };
  const rpc = Object.create(RpcCoordinator.prototype);
  Object.assign(rpc, {
    clientUpdate: prediction,
    capabilities: { get: () => capabilities },
    getHostNowMs: () => now + processingDelay,
    playerLoadout: {
      usePlayerAction: playerAction.execute.bind(playerAction),
      getAdrenaline: () => 100, getAdrenalineRevision: () => 1,
    },
  });
  rpc.registerLoadoutUseHandler();
  const handler = network.registerLoadoutUseHandler.mock.calls.at(-1)![0];
  let fire!: (...args: any[]) => void;
  const replies: (() => void)[] = [];
  const inputSystem = new Proxy({ setupLoadoutListener: (listener: typeof fire) => { fire = listener; } }, {
    get: (target, key) => Reflect.get(target, key) ?? vi.fn(),
  });
  const actions = new Proxy({
    getPlayerCapabilities: () => capabilities,
    isLocalPlayerAlive: () => true, isLocalPlayerBurrowed: () => false,
    isHost: () => network.isHost(),
    getLocalWeaponConfig: () => config,
    getWeaponLastFired: (slot: WeaponSlot) => prediction.weaponLastFiredRecord()[slot],
    notifyLoadoutFired: prediction.notifyLoadoutFired.bind(prediction),
    rollbackRejectedLoadoutFire: prediction.rollbackRejectedLoadoutFire.bind(prediction),
    sendLoadoutUse: (slot: WeaponSlot, angle: number, tx: number, ty: number, shotId: number, params: unknown, _x: unknown, _y: unknown, awaitResult: boolean, predictionId?: number) => {
      processingHost = true;
      let result: LoadoutUseResult;
      try { result = handler(slot, angle, tx, ty, 'shooter', shotId, params, undefined, undefined, predictionId); }
      finally { processingHost = false; }
      if (!remote) return Promise.resolve(result);
      if (!awaitResult) return Promise.resolve(null);
      return new Promise<LoadoutUseResult>(resolve => replies.push(() => resolve(result)));
    },
  }, { get: (target, key) => Reflect.get(target, key) ?? vi.fn() });
  const input = new ArenaInputBindings({ inputSystem, actions, audioSystem: { playLocalSound: vi.fn() } } as unknown as ArenaInputBindingsInput);
  // Bind only the loadout listener; keyboard/UI setup is unrelated to held-fire dispatch.
  (input as any).setupActionBindings();
  return {
    config, item, commits, combat, traces, localEffects, remoteEffects, aim, hud, prediction, actions, replies,
    shotEvents, localWeapon, remoteWeapon, localKick, remoteKick, projectiles,
    localViewport: localView.viewport, remoteViewport: remoteView.viewport,
    present: (time: number) => {
      now = time;
      for (const [view, feedback] of [[localView, localFeedback], [remoteView, remoteFeedback]] as const) {
        // Stationary-player syncs, including an older held-slot snapshot.
        view.player.setVisible(true);
        view.player.setBurrowPhase('idle', false);
        view.player.setHeldItemId('GLOCK');
        view.player.syncBar();
        feedback.update();
        view.camera.applyToCamera(view.viewport as never, 0, 0, 1000 / 60);
      }
    },
    setResourceCost: (cost: number) => { resourceCost = cost; },
    shoot: (time: number, delay: number, inputStarted = false, angle = 0, params?: LoadoutUseParams) => {
      now = time; processingDelay = delay;
      fire(fireSlot, angle, 600, 200, { inputStarted, ...params });
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('held weapon fire at the authoritative cooldown boundary', () => {
  it.each([false, true])('moves the rendered weapon and local camera for a stationary shooter (client=%s)', (remote) => {
    const f = fixture(remote, 'GLOCK');
    const rest = { x: 0, y: 0, rotation: 0, itemId: '' };
    expect(f.localWeapon.readHeldWeaponPose(rest)).toBe(true);
    const body = { x: f.localWeapon.x, y: f.localWeapon.y, rotation: f.localWeapon.rotation };
    f.shoot(1000, 0, true);
    f.present(1000);
    // The triggering frame must already carry camera feedback, even when firing every frame.
    expect(f.localViewport.scrollX).toBeLessThan(0);
    f.present(1000 + 1000 / 30);
    const local = { ...rest }, observer = { ...rest };
    expect(f.localWeapon.readHeldWeaponPose(local)).toBe(true);
    expect(f.remoteWeapon.readHeldWeaponPose(observer)).toBe(true);
    // Whole-pixel displacement at native player size: a subpixel pulse was imperceptible.
    expect(rest.x - local.x).toBeGreaterThan(1);
    expect(local.rotation).toBeGreaterThan(rest.rotation);
    expect(observer).toEqual(local);
    expect(-f.localViewport.scrollX).toBeGreaterThan(1);
    expect(f.remoteViewport).toEqual({ scrollX: 0, scrollY: 0 });
    expect({ x: f.localWeapon.x, y: f.localWeapon.y, rotation: f.localWeapon.rotation }).toEqual(body);
    f.present(2000);
    f.localWeapon.readHeldWeaponPose(local);
    expect(local).toEqual(rest);
    expect(f.localViewport).toEqual({ scrollX: 0, scrollY: 0 });
  });

  it('presents one recoil for a confirmed predicted shot and one for an entire shotgun blast', async () => {
    const client = fixture(true);
    client.shoot(1000, 0, true);
    client.replies.shift()!();
    await Promise.resolve();
    expect(client.shotEvents).toHaveLength(1);
    expect(client.shotEvents[0].predictionId).toBeDefined();
    expect(client.localWeapon.playHeldWeaponShot).toHaveBeenCalledTimes(1);
    expect(client.remoteWeapon.playHeldWeaponShot).toHaveBeenCalledTimes(1);
    expect(client.localKick).toHaveBeenCalledTimes(1);
    expect(client.remoteKick).not.toHaveBeenCalled();
    const shotgun = fixture(false, 'SHOTGUN', 5);
    shotgun.shoot(1000, 0, true);
    expect(shotgun.projectiles.length).toBeGreaterThan(1);
    expect(shotgun.shotEvents).toHaveLength(1);
    expect(shotgun.localWeapon.playHeldWeaponShot).toHaveBeenCalledTimes(1);
  });

  it('keeps host resource rejections and scope holds silent without reserving a predicted cooldown', async () => {
    const f = fixture();
    f.setResourceCost(101);
    f.shoot(1_000, 0);
    expect(f.commits).not.toHaveBeenCalled();
    expect(f.traces).toHaveLength(0);
    expect(f.localEffects.playHitscanTracer).not.toHaveBeenCalled();
    expect(f.localEffects.audioSystem.playSound).not.toHaveBeenCalled();
    expect(f.aim).not.toHaveBeenCalled();
    expect(f.hud).not.toHaveBeenCalled();
    f.setResourceCost(0);
    f.shoot(1_001, 0, false, 0, { scopeHolding: true });
    expect(f.commits).not.toHaveBeenCalled();
    expect(f.hud).not.toHaveBeenCalled();
    f.shoot(1_002, 0);
    expect(f.commits).toHaveBeenCalledTimes(1);
    expect(f.localEffects.audioSystem.playSound).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(f.hud).toHaveBeenCalledTimes(1);
  });
  it('never displays a rejected host attempt and fires immediately once authoritative readiness permits', async () => {
    const f = fixture();
    const start = 1_000;
    f.shoot(start, 7, true);
    const initialHp = f.combat.getMaxHp('target');
    expect(f.commits).toHaveBeenCalledTimes(1);
    expect(f.traces[0]).toMatchObject({ impactKind: 'player' });
    expect(f.combat.getHP('target')).toBe(initialHp - f.config.damage);
    expect(f.localEffects.playHitscanTracer).toHaveBeenCalledTimes(1);
    f.shoot(start + f.config.cooldown, 1);
    expect(f.commits).toHaveBeenCalledTimes(1);
    expect(f.combat.getHP('target')).toBe(initialHp - f.config.damage);
    expect(f.localEffects.playHitscanTracer).toHaveBeenCalledTimes(1);
    f.shoot(start + f.config.cooldown + 6, 1);
    expect(f.commits).toHaveBeenCalledTimes(2);
    expect(f.traces).toHaveLength(2);
    expect(f.combat.getHP('target')).toBe(initialHp - 2 * f.config.damage);
    expect(f.remoteEffects.playHitscanTracer).toHaveBeenCalledTimes(2);
    expect(f.aim).toHaveBeenCalledTimes(2);
    expect(f.hud).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(f.localEffects.playHitscanTracer).toHaveBeenCalledTimes(2);
    expect(f.localEffects.audioSystem.playSound).toHaveBeenCalledTimes(2);
    expect(f.remoteEffects.audioSystem.playSound).toHaveBeenCalledTimes(2);
    expect(f.prediction.weaponLastFiredRecord().weapon1).toBe(0);
  });

  it('keeps host commits, HP and both presentations in lockstep under changing processing delays', async () => {
    const f = fixture();
    f.shoot(1_000, 7, true);
    let accepted = 1;
    for (const delay of [1, 9, 2, 5, 0, 8, 3, 6]) {
      const ready = f.item.getLastUsedAt() + f.config.cooldown;
      f.shoot(ready - delay - 1, delay);
      expect(f.commits).toHaveBeenCalledTimes(accepted);
      expect(f.localEffects.playHitscanTracer).toHaveBeenCalledTimes(accepted);
      f.shoot(ready - delay, delay);
      accepted++;
      // All assertions precede Promise callbacks: no additional host frame/round trip.
      expect(f.commits).toHaveBeenCalledTimes(accepted);
      expect(f.traces).toHaveLength(accepted);
      expect(f.localEffects.playHitscanTracer).toHaveBeenCalledTimes(accepted);
      expect(f.remoteEffects.playHitscanTracer).toHaveBeenCalledTimes(accepted);
      expect(f.localEffects.audioSystem.playSound).toHaveBeenCalledTimes(accepted);
      expect(f.aim).toHaveBeenCalledTimes(accepted);
      expect(f.hud).toHaveBeenCalledTimes(accepted);
      expect(f.combat.getHP('target')).toBe(f.combat.getMaxHp('target') - accepted * f.config.damage);
    }
    await Promise.resolve();
    expect(f.localEffects.playHitscanTracer).toHaveBeenCalledTimes(accepted);
    const hp = f.combat.getHP('target');
    f.shoot(f.item.getLastUsedAt() + f.config.cooldown, 0, false, Math.PI / 2);
    expect(f.commits).toHaveBeenCalledTimes(accepted + 1);
    expect(f.localEffects.playHitscanTracer).toHaveBeenCalledTimes(accepted + 1);
    expect(f.combat.getHP('target')).toBe(hp); // A real miss still has shot feedback.
  });

  it('corrects held client rejections without waiting another cooldown and deduplicates confirmed predictions', async () => {
    const f = fixture(true);
    f.shoot(1_000, 7, true);
    f.replies.shift()!();
    await Promise.resolve();
    const t = 1_000 + f.config.cooldown;
    f.shoot(t, 1);
    expect(f.commits).toHaveBeenCalledTimes(1);
    expect(f.replies).toHaveLength(1); // Held input must request the rejection too.
    f.replies.shift()!();
    await Promise.resolve();
    f.shoot(t + 6, 1);
    expect(f.commits).toHaveBeenCalledTimes(2);
    f.replies.shift()!();
    await Promise.resolve();
    for (let i = 1; i <= 5; i++) {
      f.shoot(t + 6 + i * f.config.cooldown, 1);
      f.replies.shift()!();
      await Promise.resolve();
    }
    expect(f.commits).toHaveBeenCalledTimes(7);
    expect(f.traces).toHaveLength(7);
    expect(f.remoteEffects.playHitscanTracer).toHaveBeenCalledTimes(7);
    expect(f.localWeapon.playHeldWeaponShot).toHaveBeenCalledTimes(8);
    expect(f.remoteWeapon.playHeldWeaponShot).toHaveBeenCalledTimes(7);
    // One rejected prediction remains visible, but confirmations never replay prediction FX.
    expect(f.localEffects.playHitscanTracer).toHaveBeenCalledTimes(8);
    expect(f.localEffects.audioSystem.playSound).toHaveBeenCalledTimes(8);
    expect(f.aim).toHaveBeenCalledTimes(8);
    expect(f.hud).toHaveBeenCalledTimes(8);
    expect(f.combat.getHP('target')).toBe(f.combat.getMaxHp('target') - 7 * f.config.damage);
  });

  it('does not roll back a newer client prediction when an older held rejection arrives late', async () => {
    const f = fixture(true);
    f.shoot(1_000, 7, true);
    f.replies.shift()!();
    await Promise.resolve();
    const t = 1_000 + f.config.cooldown;
    f.shoot(t, 1);
    const rejectOld = f.replies.shift()!;
    f.shoot(t + f.config.cooldown, 1);
    f.replies.shift()!();
    await Promise.resolve();
    rejectOld();
    await Promise.resolve();
    expect(f.prediction.weaponLastFiredRecord().weapon1).toBe(t + f.config.cooldown);
    f.shoot(t + f.config.cooldown + 1, 1);
    expect(f.localEffects.playHitscanTracer).toHaveBeenCalledTimes(3);
    expect(f.commits).toHaveBeenCalledTimes(2);
  });
});
