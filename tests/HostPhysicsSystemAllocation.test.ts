import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
  },
}));

import * as Phaser from 'phaser';
import { HostPhysicsSystem } from '../src/systems/HostPhysicsSystem';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { NetworkBridge } from '../src/network/NetworkBridge';
import type { WorldCombatCore as CombatSystem } from '../src/combat/WorldCombatCore';
import type { TimeBubbleSystem } from '../src/systems/TimeBubbleSystem';
import type { PlayerEntity } from '../src/entities/PlayerEntity';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import { BURROW_DASH_IMPULSE_MULTIPLIER, BURROW_UNDERGROUND_SPEED_FACTOR, BURROW_WINDUP_DURATION_MS,
  DASH_F_MIN, DASH_T1_S, DASH_T2_S, ENEMY_DASH_F_START, PLAYER_SIZE, PLAYER_SPEED } from '../src/config';
import { BurrowSystem } from '../src/systems/BurrowSystem';
import { getPlayerDashBurstSpeedFactor } from '../src/utils/dashTiming';
import { WaterGeometry } from '../src/arena/WaterGeometry';
import { CELL_SIZE } from '../src/config';
import { CoopDefenseMissionBarrierManager } from '../src/systems/CoopDefenseMissionBarrierManager';

describe('mission barrier burrow collision', () => {
  it.each([false, true])('blocks underground players, including lazy colliders (burrow first: %s)', (burrowFirst) => {
    const h = createHarness();
    const player = createMockPlayer('p');
    h.players.set(player.id, player);
    const barrier = { setVisible: vi.fn(), setActive: vi.fn(), body: { enable: true } };
    const group = { add: vi.fn() };
    const manager = new CoopDefenseMissionBarrierManager(
      { add: { rectangle: () => barrier } } as never,
      { barriers: [{ id: 'gate', cells: [{ gridX: 1, gridY: 1 }] }] } as never,
      resolveActiveArenaWorldMetrics(),
      { physicsGroup: group as never },
    );
    h.system.setRockGroup({} as never, group as never);
    if (burrowFirst) h.system.setPlayerBurrowed('p', true);
    h.system.update();
    h.system.setPlayerBurrowed('p', true);
    const calls = vi.mocked(h.scene.physics.add.collider).mock.calls;
    const index = calls.findIndex(call => call[1] === group);
    const collider = vi.mocked(h.scene.physics.add.collider).mock.results[index].value;
    const process = calls[index][3]!;
    expect(collider.active).toBe(true);
    expect(process(player as never, barrier as never)).toBe(true);
    expect(process(player as never, {} as never)).toBe(false);
    h.system.setPlayerBurrowed('p', false);
    expect(process(player as never, {} as never)).toBe(true);
    manager.syncPresentationState({ barriers: [{ barrierId: 'gate', open: true }] } as never);
    expect(barrier.body.enable).toBe(false);
  });
});

function createMockEnemy(id: string, x = 100, y = 100, vx = 50, vy = 60) {
  const setVelocity = vi.fn();
  const setWalking = vi.fn();
  const syncBar = vi.fn();
  const getDesiredVelocity = vi.fn(() => ({ vx, vy }));
  const getKnockbackFactor = vi.fn(() => 1);
  const sprite = {
    active: true,
    x,
    y,
    body: {
      velocity: { x: vx, y: vy },
      setVelocity,
    },
  };

  return {
    id,
    sprite,
    setVelocity,
    setWalking,
    syncBar,
    getDesiredVelocity,
    getKnockbackFactor,
    getMoveSpeed: () => 100,
    setDashPhase: vi.fn(),
    setDashScale: vi.fn(),
    isBurrowed: () => false,
  } as unknown as EnemyEntity & {
    setVelocity: typeof setVelocity;
    setWalking: typeof setWalking;
    syncBar: typeof syncBar;
  };
}

function createMockPlayer(id: string, x = 200, y = 200) {
  const setVelocity = vi.fn();
  // Die Figur traegt Position, Aktivitaet und Koerper selbst - kein Sprite mehr dazwischen.
  const player = {
    id,
    active: true,
    x,
    y,
    body: {
      velocity: { x: 0, y: 0 },
      setVelocity,
    },
    setDashScale: vi.fn(),
    setCollisionRadius: vi.fn(),
    setVelocity,
  } as unknown as PlayerEntity & { setVelocity: typeof setVelocity };
  // Der Koerper ist derselbe, egal ueber welchen Weg er gelesen wird.
  (player as unknown as { physicsProxy: unknown }).physicsProxy = player;
  return player;
}

function createHarness() {
  const players = new Map<string, PlayerEntity>();
  const enemies = new Map<string, EnemyEntity>();

  const getAllPlayers = vi.fn(() => Array.from(players.values()));
  const getPlayer = vi.fn((id: string) => players.get(id));

  const getAllEnemies = vi.fn(() => Array.from(enemies.values()));
  const forEachEnemy = vi.fn((callback: (enemy: EnemyEntity) => void) => {
    for (const enemy of enemies.values()) {
      callback(enemy);
    }
  });
  const hasEnemy = vi.fn((id: string) => enemies.has(id));
  const getEnemy = vi.fn((id: string) => enemies.get(id));

  const getPlayerInput = vi.fn(() => ({ dx: 1, dy: 0 }));
  const bridge = {
    isHost: () => true,
    getWorldParticipation: () => 'interactive',
    getPlayerInput,
  } as unknown as NetworkBridge;

  const combatSystem = {
    isAlive: () => true,
    applyDamage: vi.fn(),
  } as unknown as CombatSystem;

  const playerManager = {
    getAllPlayers,
    getPlayer,
  } as unknown as PlayerManager;

  const enemyManager = {
    getAllEnemies,
    forEachEnemy,
    hasEnemy,
    getEnemy,
  } as unknown as EnemyManager;

  const colliderDestroySpies: Array<() => void> = [];
  const scene = {
    physics: {
      world: { on: vi.fn(), off: vi.fn() },
      add: {
        collider: vi.fn(() => {
          const destroy = vi.fn();
          colliderDestroySpies.push(destroy);
          return { active: true, destroy };
        }),
      },
    },
  } as unknown as Phaser.Scene;

  const system = new HostPhysicsSystem(scene, playerManager, bridge, combatSystem);
  system.setEnemyManager(enemyManager);

  return {
    system,
    scene,
    players,
    enemies,
    playerManager,
    enemyManager,
    getAllEnemies,
    forEachEnemy,
    combatSystem,
    colliderDestroySpies,
    bridge,
    getPlayerInput,
  };
}

function createBurrowDashHarness(blocked: () => boolean = () => false) {
  const h = createHarness();
  const player = createMockPlayer('player-1');
  Object.assign(player, {
    getCollisionRadius: () => PLAYER_SIZE / 2,
    setPosition: (x: number, y: number) => { player.x = x; player.y = y; },
  });
  h.players.set(player.id, player);
  const effects = { broadcastBurrowVisual: vi.fn(), broadcastShockwaveEffect: vi.fn() };
  const burrow = new BurrowSystem(
    { getAdrenaline: () => 30, drainAdrenaline: vi.fn() } as never,
    h.playerManager, h.combatSystem, h.system,
    { getPlayerInput: h.getPlayerInput, ...effects } as never,
  );
  burrow.setWorldGeometryQueries({ isCircleBlocked: blocked } as never);
  h.system.setBurrowSystem(burrow);
  h.system.setBurrowDashExitHandler(id => burrow.tryExitBurrowForDash(id));
  h.system.setRockGroup({} as never, {} as never);
  h.system.setBaseGroup({} as never);
  h.system.update();
  const colliders = vi.mocked(h.scene.physics.add.collider).mock.results.map(result => result.value);
  const enter = () => {
    burrow.handleBurrowRequest(player.id, true);
    vi.advanceTimersByTime(BURROW_WINDUP_DURATION_MS);
    burrow.update(0);
    expect(burrow.getPhase(player.id)).toBe('underground');
  };
  return { ...h, player, burrow, effects, colliders, enter };
}

describe('Water physics lifetime', () => {
  it.each([{ burrowed: false, tangent: 0 }, { burrowed: true, tangent: 0 },
    { burrowed: false, tangent: 12 }, { burrowed: true, tangent: 12 }])(
    'sweeps players and enemies while burrowed=$burrowed, retaining tangent=$tangent', ({ burrowed, tangent }) => {
    const h = createHarness();
    const m = resolveActiveArenaWorldMetrics();
    const cell = { gridX: 5, gridY: 5 };
    const water = new WaterGeometry([cell], m);
    const left = m.offsetX + cell.gridX * CELL_SIZE;
    const cy = m.offsetY + (cell.gridY + .5) * CELL_SIZE;
    const player = createMockPlayer('water-player');
    const enemy = createMockEnemy('water-enemy');
    const bodies = [player.physicsProxy.body!, enemy.sprite.body!];
    for (const b of bodies) {
      const body = b as any;
      Object.assign(body, { enable: true, halfWidth: 8, halfHeight: 8,
        velocity: { x: 180, y: tangent },
        prev: { x: left - 80, y: cy - 8 }, center: { x: left + 100, y: cy + tangent },
        position: { x: left + 92, y: cy - 8 + tangent, set(x: number, y: number) { this.x = x; this.y = y; } },
        updateCenter() { this.center.x = this.position.x + 8; this.center.y = this.position.y + 8; } });
    }
    h.players.set(player.id, player); h.enemies.set(enemy.id, enemy);
    h.system.setPlayerBurrowed(player.id, burrowed); h.system.setEnemyBurrowed(enemy.id, burrowed);
    h.system.setWaterGeometry(water);
    const on = h.scene.physics.world.on as ReturnType<typeof vi.fn>;
    const step = on.mock.calls[0][1];
    step();
    for (const b of bodies) {
      expect((b as any).center.x + 8).toBeLessThanOrEqual(left);
      expect((b as any).center.y).toBeCloseTo(cy + tangent);
      expect(b.setVelocity).toHaveBeenCalledWith(0, tangent);
    }
    const world = h.scene.physics.world;
    // The Arcade plugin clears its World before later Scene SHUTDOWN callbacks.
    (h.scene.physics as any).world = null;
    h.system.setWaterGeometry(null);
    expect(world.off).toHaveBeenCalledWith('worldstep', step);
  });
});

describe('host player dash and Burrow transition', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('publishes one accepted start, stable identity through recovery and contacts before dash impact', () => {
    const h = createHarness(), player = createMockPlayer('p');
    let radius = PLAYER_SIZE / 2;
    Object.assign(player, { positionRevision: 0, getCollisionRadius: () => radius,
      setCollisionRadius: (value: number) => { radius = value; } });
    h.players.set('p', player);
    h.enemies.set('e', createMockEnemy('e', player.x, player.y));
    const order: string[] = [];
    const observer = { start: vi.fn(), move: vi.fn(() => order.push('zeus')), end: vi.fn() };
    h.system.setDashObserver(observer);
    h.system.setDashImpactDamageResolver(() => 1);
    vi.mocked(h.combatSystem.applyDamage).mockImplementation(() => { order.push('impact'); return undefined as never; });
    h.system.handleDashRPC('p', 0, 0);
    expect(observer.start).not.toHaveBeenCalled();
    h.system.handleDashRPC('p', 1, 0);
    const id = h.system.getDashMovement('p')!.dashId;
    h.system.handleDashRPC('p', 0, 1);
    h.system.update();
    expect(order.slice(0, 2)).toEqual(['zeus', 'impact']);
    vi.advanceTimersByTime(DASH_T1_S * 1000 + 1);
    h.system.update();
    expect(h.system.getDashMovement('p')!.dashId).toBe(id);
    vi.advanceTimersByTime(DASH_T2_S * 500);
    h.system.update();
    expect(h.system.getDashMovement('p')!.radius).toBeGreaterThan(PLAYER_SIZE / 4);
    expect(observer.start).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(DASH_T2_S * 1000);
    h.system.update();
    expect(h.system.getDashMovement('p')).toBeNull();
    expect(observer.end).toHaveBeenCalledOnce();
  });

  it('cancels active player and enemy dashes during stun and keeps the ground bonus out of dash speed', () => {
    const h = createHarness(), player = createMockPlayer('p');
    h.players.set('p', player); h.enemies.set('e', createMockEnemy('e'));
    let stunned = false;
    h.system.setStunChecker(() => stunned);
    h.system.setZeusMoveBonus(() => 0.5);
    h.system.update();
    expect(player.setVelocity).toHaveBeenLastCalledWith(PLAYER_SPEED * 1.5, 0);
    h.system.handleDashRPC('p', 1, 0); h.system.startEnemyDash('e', 1, 0);
    h.system.update();
    expect(player.setVelocity).toHaveBeenLastCalledWith(PLAYER_SPEED * getPlayerDashBurstSpeedFactor(0), 0);
    stunned = true; h.system.update();
    expect(player.setVelocity).toHaveBeenLastCalledWith(0, 0);
    expect(h.system.getDashPhase('p')).toBe(0);
    expect(h.system.isEnemyDashing('e')).toBe(false);
    expect(h.system.startEnemyDash('e', 1, 0)).toBe(false);
  });

  it('restores all obstacle colliders before a boosted surface dash and restores the full hitbox afterwards', () => {
    const h = createBurrowDashHarness();
    h.enter();
    h.system.update();
    expect(h.player.setVelocity).toHaveBeenLastCalledWith(PLAYER_SPEED * BURROW_UNDERGROUND_SPEED_FACTOR, 0);
    expect(h.colliders).toHaveLength(3);
    const allowsOrdinaryObstacle = () => vi.mocked(h.scene.physics.add.collider).mock.calls
      .every(call => call[3]!(h.player as never, {} as never));
    expect(allowsOrdinaryObstacle()).toBe(false);
    h.system.handleDashRPC(h.player.id, 1, 0);
    expect(h.burrow.getPhase(h.player.id)).toBe('recovery');
    expect(h.colliders.every(c => c.active)).toBe(true);
    expect(allowsOrdinaryObstacle()).toBe(true);
    expect(h.system.isDashBurst(h.player.id)).toBe(true);
    expect(h.system.isBurrowDash(h.player.id)).toBe(true);
    h.system.update();
    expect(h.player.setVelocity).toHaveBeenLastCalledWith(PLAYER_SPEED * getPlayerDashBurstSpeedFactor(0, BURROW_DASH_IMPULSE_MULTIPLIER), 0);
    expect(h.player.setCollisionRadius).toHaveBeenLastCalledWith(PLAYER_SIZE / 4);
    expect(h.effects.broadcastShockwaveEffect).toHaveBeenCalledOnce();
    h.system.handleDashRPC(h.player.id, 1, 0);
    expect(h.effects.broadcastShockwaveEffect).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(DASH_T1_S * 1000);
    h.system.update();
    expect(h.system.getDashPhase(h.player.id)).toBe(2);
    expect(h.system.isBurrowDash(h.player.id)).toBe(true);
    expect(h.system.isDashBurst(h.player.id)).toBe(false);
    expect(h.player.setVelocity).toHaveBeenLastCalledWith(PLAYER_SPEED * DASH_F_MIN, 0);
    vi.advanceTimersByTime(DASH_T2_S * 1000);
    h.burrow.update(0);
    h.system.update();
    expect(h.system.getDashPhase(h.player.id)).toBe(0);
    expect(h.system.isBurrowDash(h.player.id)).toBe(false);
    expect(h.player.setCollisionRadius).toHaveBeenLastCalledWith(PLAYER_SIZE / 2);
    expect(h.player.setDashScale).toHaveBeenLastCalledWith(1);
    expect(h.player.setVelocity).toHaveBeenLastCalledWith(PLAYER_SPEED, 0);
    h.system.handleDashRPC(h.player.id, 1, 0);
    expect(h.system.isDashBurst(h.player.id)).toBe(true);
    expect(h.system.isBurrowDash(h.player.id)).toBe(false);
  });

  it('does not pop out on invalid input, death, denied movement or an obstructed exit', () => {
    let blocked = true;
    const h = createBurrowDashHarness(() => blocked);
    h.enter();
    for (const [dx, dy] of [[0, 0], [NaN, 1], [Infinity, 0], [1, 0]]) {
      h.system.handleDashRPC(h.player.id, dx, dy);
      expect(h.burrow.isBurrowed(h.player.id)).toBe(true);
      expect(h.system.getDashPhase(h.player.id)).toBe(0);
      expect(h.system.isBurrowDash(h.player.id)).toBe(false);
    }
    blocked = false;
    h.system.setCanMoveResolver(() => false);
    h.system.handleDashRPC(h.player.id, 1, 0);
    expect(h.burrow.isBurrowed(h.player.id)).toBe(true);
    h.system.setCanMoveResolver(() => true);
    const alive = vi.spyOn(h.combatSystem, 'isAlive').mockReturnValue(false);
    h.system.handleDashRPC(h.player.id, 1, 0);
    expect(h.burrow.isBurrowed(h.player.id)).toBe(true);
    alive.mockReturnValue(true);
    h.system.handleDashRPC(h.player.id, 1, 0);
    expect(h.system.isDashBurst(h.player.id)).toBe(true);
  });

  it('clears the special dash origin when its player or world is removed', () => {
    for (const teardown of ['player', 'world'] as const) {
      const h = createBurrowDashHarness();
      h.enter(); h.system.handleDashRPC(h.player.id, 1, 0);
      expect(h.system.isBurrowDash(h.player.id)).toBe(true);
      if (teardown === 'player') h.system.removePlayer(h.player.id);
      else h.system.setRockGroup(null, null);
      expect(h.system.isBurrowDash(h.player.id)).toBe(false);
    }
  });

  it.each([30, 60, 120])('keeps the base cycle distance-neutral within one update step at %i Hz', (hz) => {
    const h = createBurrowDashHarness();
    h.system.handleDashRPC(h.player.id, 1, 0);
    const stepMs = 1000 / hz;
    const durationMs = (DASH_T1_S + DASH_T2_S) * 1000;
    let distance = 0;
    for (let time = 0; time < durationMs - 1e-6; time += stepMs) {
      h.system.update(false, time);
      const [vx] = h.player.setVelocity.mock.calls.at(-1)!;
      distance += vx * Math.min(stepMs, durationMs - time) / 1000;
    }
    const walkingDistance = PLAYER_SPEED * durationMs / 1000;
    const maximumStepDistance = PLAYER_SPEED * getPlayerDashBurstSpeedFactor(0) / hz;
    expect(Math.abs(distance - walkingDistance)).toBeLessThanOrEqual(maximumStepDistance);
  });

  it('applies range, run speed, recovery, holding, impact and trail upgrades to Burrow dashes without underground speed stacking', () => {
    const h = createBurrowDashHarness();
    h.enter();
    h.burrow.setUndergroundSpeedResolver(() => 99);
    h.system.setRunSpeedResolver(() => PLAYER_SPEED * 1.15);
    h.system.setDashRangeMultiplierResolver(() => 1.3);
    h.system.setDashRecoveryDurationResolver(() => DASH_T2_S / 2);
    h.system.setDashHoldEnabledResolver(() => true);
    h.getPlayerInput.mockReturnValue({ dx: 1, dy: 0, dashHeld: true } as never);
    h.system.setDashImpactDamageResolver(() => 7);
    h.system.setDashGroundFireDurationResolver(() => 1000);
    const trail = vi.fn();
    h.system.setDashGroundFireHandler(trail);
    h.enemies.set('enemy', createMockEnemy('enemy', h.player.x + PLAYER_SIZE / 2, h.player.y));
    h.system.handleDashRPC(h.player.id, 1, 0);
    h.system.update();
    expect(h.player.setVelocity).toHaveBeenLastCalledWith(PLAYER_SPEED * 1.15 * 1.3 * getPlayerDashBurstSpeedFactor(0, BURROW_DASH_IMPULSE_MULTIPLIER), 0);
    h.system.update();
    expect(h.combatSystem.applyDamage).toHaveBeenCalledOnce();
    expect(trail).toHaveBeenCalled();
    vi.advanceTimersByTime(DASH_T1_S * 1000);
    h.system.update();
    expect(h.system.getDashPhase(h.player.id)).toBe(1);
    h.getPlayerInput.mockReturnValue({ dx: 1, dy: 0, dashHeld: false } as never);
    h.system.update();
    expect(h.system.getDashPhase(h.player.id)).toBe(2);
    vi.advanceTimersByTime(DASH_T2_S * 500);
    h.system.update();
    expect(h.system.getDashPhase(h.player.id)).toBe(0);
  });

  it('retains the independent quadratic enemy curve', () => {
    const h = createHarness();
    const enemy = createMockEnemy('enemy');
    h.enemies.set(enemy.id, enemy);
    h.system.startEnemyDash(enemy.id, 1, 0);
    h.system.update(false, 0);
    expect(enemy.setVelocity).toHaveBeenLastCalledWith(enemy.getMoveSpeed() * ENEMY_DASH_F_START, 0);
    h.system.update(false, DASH_T1_S * 500);
    expect(enemy.setVelocity).toHaveBeenLastCalledWith(enemy.getMoveSpeed() * (DASH_F_MIN + (ENEMY_DASH_F_START - DASH_F_MIN) / 4), 0);
  });
});


describe('Decoy physics boundaries', () => {
  it('filters friendly impulses before applying existing resistance and leaves walk bonuses out of dashes', () => {
    const h = createHarness();
    const owner = createMockPlayer('owner', 100, 100), ally = createMockEnemy('ally', 120, 100),
      hostile = createMockEnemy('hostile', 120, 100);
    h.players.set('owner', owner); h.enemies.set('ally', ally); h.enemies.set('hostile', hostile);
    const recoil = vi.spyOn(h.system, 'addRecoil');
    h.system.applyRadialImpulse(100, 100, 150, 500, 'owner', 0, 260, id => id === 'hostile');
    expect(recoil).toHaveBeenCalledTimes(1);
    expect(recoil.mock.calls[0][0]).toBe('hostile');
    h.system.setRunSpeedResolver(() => 100);
    h.system.setWalkingSpeedMultiplierResolver(() => 1.3);
    h.system.update(false, 1000);
    expect(owner.setVelocity).toHaveBeenLastCalledWith(130, 0);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      h.system.handleDashRPC('owner', 1, 0);
      h.system.update(false, 1000);
      const withBonus = owner.setVelocity.mock.calls.at(-1);
      h.system.setWalkingSpeedMultiplierResolver(() => 1);
      h.system.update(false, 1000);
      expect(owner.setVelocity.mock.calls.at(-1)).toEqual(withBonus);
      expect(withBonus![0]).toBeGreaterThan(100);
    } finally { clock.mockRestore(); }
  });
});
describe('HostPhysicsSystem Allocation Optimization', () => {
  it('uses forEachEnemy instead of getAllEnemies in update() per-frame enemy loop', () => {
    const { system, enemies, getAllEnemies, forEachEnemy } = createHarness();
    const enemy1 = createMockEnemy('enemy-1', 100, 100, 40, 30);
    const enemy2 = createMockEnemy('enemy-2', 150, 150, -20, 10);
    enemies.set('enemy-1', enemy1);
    enemies.set('enemy-2', enemy2);

    system.update(false);

    expect(forEachEnemy).toHaveBeenCalledTimes(1);
    expect(getAllEnemies).not.toHaveBeenCalled();
    expect(enemy1.setVelocity).toHaveBeenCalledWith(40, 30);
    expect(enemy2.setVelocity).toHaveBeenCalledWith(-20, 10);
  });

  it('stops only enemy propulsion while retaining recoil, slow and player movement', () => {
    const { system, enemies, players } = createHarness();
    const enemy = createMockEnemy('e1', 200, 200, 100, 50);
    const player = createMockPlayer('p1');
    enemies.set(enemy.id, enemy);
    players.set(player.id, player);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      system.setRunSpeedResolver(() => 100);
      system.setEnemyMovementFactorResolver(() => 0.5);
      system.setEnemyHitStaggerResolver((_id, now) => now < 1080);
      system.update(false, 1000);
      expect(enemy.setVelocity).toHaveBeenLastCalledWith(0, 0);
      expect(player.setVelocity).toHaveBeenLastCalledWith(100, 0);
      system.addRecoil(enemy.id, 200, 100, 80);
      system.update(false, 1000);
      expect(enemy.setVelocity).toHaveBeenLastCalledWith(100, 50);
      // The supplied host time, not the still-frozen wall clock, ends both effects.
      system.update(false, 1080);
      expect(enemy.setVelocity).toHaveBeenLastCalledWith(50, 25);
    } finally {
      clock.mockRestore();
    }
  });

  it('suppresses dash movement without pausing its phases or extending its lifetime', () => {
    const { system, enemies } = createHarness();
    const enemy = createMockEnemy('e1', 200, 200, 100, 50);
    enemies.set(enemy.id, enemy);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      system.setEnemyHitStaggerResolver(() => true);
      expect(system.startEnemyDash(enemy.id, 1, 0)).toBe(true);
      system.update(false, 1000);
      expect(enemy.setVelocity).toHaveBeenLastCalledWith(0, 0);
      expect(system.isEnemyDashing(enemy.id)).toBe(true);
      const recoveryStart = 1000 + DASH_T1_S * 1000 + 1;
      system.update(false, recoveryStart);
      expect(enemy.setDashPhase).toHaveBeenLastCalledWith(2);
      expect(enemy.setVelocity).toHaveBeenLastCalledWith(0, 0);
      system.update(false, recoveryStart + DASH_T2_S * 1000 + 1);
      expect(system.isEnemyDashing(enemy.id)).toBe(false);
      expect(enemy.setVelocity).toHaveBeenLastCalledWith(0, 0);
      system.setEnemyHitStaggerResolver(null);
      system.update(false, recoveryStart + DASH_T2_S * 1000 + 2);
      expect(enemy.setVelocity).toHaveBeenLastCalledWith(100, 50);
    } finally {
      clock.mockRestore();
    }
  });

  it('uses forEachEnemy instead of getAllEnemies in applyRadialImpulse()', () => {
    const { system, enemies, getAllEnemies, forEachEnemy } = createHarness();
    const enemy1 = createMockEnemy('enemy-1', 100, 100);
    enemies.set('enemy-1', enemy1);

    system.applyRadialImpulse(100, 100, 50, 200);

    expect(forEachEnemy).toHaveBeenCalledTimes(1);
    expect(getAllEnemies).not.toHaveBeenCalled();
  });

  it('safely cleans up orphan enemy colliders during keys iteration when enemies disappear', () => {
    const { system, enemies, scene } = createHarness();
    const mockRockGroup = {} as Phaser.Physics.Arcade.StaticGroup;
    system.setRockGroup(mockRockGroup, null);

    const enemy1 = createMockEnemy('enemy-1', 100, 100);
    const enemy2 = createMockEnemy('enemy-2', 150, 150);
    enemies.set('enemy-1', enemy1);
    enemies.set('enemy-2', enemy2);

    // First update creates lazy colliders for enemy1 and enemy2
    system.update(false);
    expect(scene.physics.add.collider).toHaveBeenCalledTimes(2);

    // enemy1 dies / is removed from enemyManager
    enemies.delete('enemy-1');

    // Second update iterates this.enemyColliders.keys() directly and cleans up enemy1
    expect(() => system.update(false)).not.toThrow();
  });

  it('applies time bubble scaling accurately to both players and enemies without wrapper allocations', () => {
    const { system, players, enemies } = createHarness();
    const player1 = createMockPlayer('player-1', 100, 100);
    players.set('player-1', player1);

    const enemy1 = createMockEnemy('enemy-1', 200, 200, 100, 50);
    enemies.set('enemy-1', enemy1);

    const timeBubbleSystem = {
      getPlayerMovementFactorAt: vi.fn((x: number, y: number, _now: number, playerId?: string) => {
        if (playerId === 'player-1') return 0.5;
        if (x === 200 && y === 200) return 0.25;
        return 1;
      }),
    } as unknown as TimeBubbleSystem;

    system.setTimeBubbleSystem(timeBubbleSystem);
    system.setRunSpeedResolver(() => 100);

    system.update(false);

    // Player velocity with input dx=1, speed=100, factor=0.5 => 50
    expect(player1.setVelocity).toHaveBeenCalledWith(50, 0);

    // Enemy velocity vx=100, vy=50, factor=0.25 => vx=25, vy=12.5
    expect(enemy1.setVelocity).toHaveBeenCalledWith(25, 12.5);
  });

  it('correctly handles recoil impulses and forced movement', () => {
    const { system, players } = createHarness();
    const player1 = createMockPlayer('player-1', 100, 100);
    players.set('player-1', player1);

    system.setRunSpeedResolver(() => 100);

    // Recoil captures wall-clock time; updates consume explicit host timestamps. Pin the
    // creation instant so even a millisecond of test-runner scheduling cannot decay it early.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      system.addRecoil('player-1', 200, 100, 1000);
      system.update(false, 1000);

      // Base movement (100, 0) + the full initial impulse (200, 100).
      expect(player1.setVelocity).toHaveBeenCalledWith(300, 100);

      system.setForcedMovement('player-1', -50, -50);
      player1.setVelocity.mockClear();
      system.update(false, 1250);

      // At one quarter of the duration the quadratic decay retains 0.75² of the impulse.
      expect(player1.setVelocity).toHaveBeenCalledWith(62.5, 6.25);
    } finally {
      clock.mockRestore();
    }
  });

  it.each(['rocks', 'water'])('applies the same corner assistance to normal input near %s', terrain => {
    const { system, players, getPlayerInput } = createHarness();
    const metrics = resolveActiveArenaWorldMetrics();
    const player1 = createMockPlayer(
      'player-1',
      metrics.offsetX + 16,
      metrics.offsetY + 16,
    );
    players.set('player-1', player1);
    getPlayerInput.mockReturnValue({ dx: 1, dy: 1 });

    system.setWorldMetrics(metrics);
    if (terrain === 'water') system.setWaterGeometry(new WaterGeometry([
      { gridX: 1, gridY: 1 }, { gridX: 1, gridY: 0 },
    ], metrics));
    else system.setMovementBlockedCellResolver((gridX, gridY) => (
      (gridX === 1 && gridY === 1) || (gridX === 1 && gridY === 0)
    ));
    system.setRunSpeedResolver(() => 100);
    system.update(false);

    const [vx, vy] = player1.setVelocity.mock.calls[0];
    expect(vx).toBeLessThan(vy);
    expect(Math.hypot(vx, vy)).toBeCloseTo(100);
  });

  it('does not apply corner assistance to dash or forced movement', () => {
    const { system, players, getPlayerInput } = createHarness();
    const metrics = resolveActiveArenaWorldMetrics();
    const player1 = createMockPlayer(
      'player-1',
      metrics.offsetX + 16,
      metrics.offsetY + 16,
    );
    players.set('player-1', player1);
    getPlayerInput.mockReturnValue({ dx: 1, dy: 1 });
    system.setWorldMetrics(metrics);
    system.setMovementBlockedCellResolver(() => true);
    system.setRunSpeedResolver(() => 100);

    system.handleDashRPC('player-1', 1, 1);
    system.update(false);
    const [dashVx, dashVy] = player1.setVelocity.mock.calls[0];
    expect(dashVx).toBeCloseTo(dashVy);
    expect(dashVx).toBeGreaterThan(0);

    player1.setVelocity.mockClear();
    system.setForcedMovement('player-1', -50, -25);
    system.update(false);
    expect(player1.setVelocity).toHaveBeenCalledWith(-50, -25);
  });

  it('does not call enemy.syncBar() during update – visual sync is deferred to EnemyManager.syncHostVisuals()', () => {
    const { system, enemies } = createHarness();
    const enemy1 = createMockEnemy('enemy-1', 100, 100, 40, 30);
    const enemy2 = createMockEnemy('enemy-2', 200, 200, -10, 20);
    enemies.set('enemy-1', enemy1);
    enemies.set('enemy-2', enemy2);

    system.update(false);

    // Physics must still set velocity and walking state
    expect(enemy1.setVelocity).toHaveBeenCalled();
    expect(enemy2.setVelocity).toHaveBeenCalled();
    expect(enemy1.setWalking).toHaveBeenCalled();
    expect(enemy2.setWalking).toHaveBeenCalled();

    // syncBar must NOT be called – it's handled centrally by EnemyManager.syncHostVisuals()
    // after combat resolution and status updates have been applied in the same frame.
    expect(enemy1.syncBar).not.toHaveBeenCalled();
    expect(enemy2.syncBar).not.toHaveBeenCalled();
  });
});

