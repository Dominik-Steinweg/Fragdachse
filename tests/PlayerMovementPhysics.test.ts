import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import { ClientPlayerMovementBody } from '../src/entities/ClientPlayerMovementBody';
import { LocalPlayerPrediction } from '../src/systems/LocalPlayerPrediction';
import { collidePlayerWater, resolveWalkingVelocity, type PlayerMovementGeometry } from '../src/systems/PlayerMovement';
import { HostPhysicsSystem } from '../src/systems/HostPhysicsSystem';
import { WaterGeometry } from '../src/arena/WaterGeometry';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import { CELL_SIZE, PLAYER_SIZE, DASH_T1_S, DASH_T2_S } from '../src/config';
import type { PlayerEntity } from '../src/entities/PlayerEntity';
import type { PlayerInput } from '../src/types';

vi.mock('phaser', () => ({ Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
  Distance: { Between: (x: number, y: number, a: number, b: number) => Math.hypot(x - a, y - b) } } }));

// Real pinned Arcade modules work without a DOM; this verifies integration rather than mocking collision.
const require = createRequire(import.meta.url);
const arcade = (name: string) => require(fileURLToPath(new URL(`../node_modules/phaser/src/physics/arcade/${name}.js`, import.meta.url)));
const World = arcade('World'), Body = arcade('Body'), StaticBody = arcade('StaticBody');
const metrics = resolveActiveArenaWorldMetrics();

function fixture(mode: 'wall' | 'water' | 'bounds' | 'rocks' = 'wall') {
  const scene = { sys: { scale: { width: metrics.maxX, height: metrics.maxY } }, events: new EventEmitter(), physics: {} as any };
  const world = new World(scene, { fps: 120, gravity: { x: 0, y: 0 }, x: metrics.offsetX, y: metrics.offsetY,
    width: metrics.widthPx, height: metrics.heightPx });
  scene.physics = { world, add: { collider: world.addCollider.bind(world) } };
  scene.events.on('postupdate', () => world.postUpdate());
  const wallX = metrics.offsetX + 5 * CELL_SIZE;
  const wallY = metrics.offsetY + 3 * CELL_SIZE;
  const proxy: any = { x: wallX - 60, y: wallY + 32, angle: 0, rotation: 0, scaleX: 1, scaleY: 1,
    width: PLAYER_SIZE, height: PLAYER_SIZE, displayWidth: PLAYER_SIZE, displayHeight: PLAYER_SIZE,
    displayOriginX: PLAYER_SIZE / 2, displayOriginY: PLAYER_SIZE / 2, active: true,
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; } };
  const body = new Body(world, proxy); proxy.body = body;
  body.setCircle(PLAYER_SIZE / 2); body.setCollideWorldBounds(true); world.add(body);
  const wall = new StaticBody(world); wall.setSize(CELL_SIZE, CELL_SIZE * 6);
  wall.position.set(wallX, wallY); wall.center.set(wallX + CELL_SIZE / 2, wallY + CELL_SIZE * 3);
  world.add(wall);
  wall.enable = mode === 'wall';
  // Rock walls consist of separate cell bodies whose seams a sliding circle crosses.
  const cells = mode !== 'rocks' ? [] : Array.from({ length: 6 }, (_, i) => {
    const cell = new StaticBody(world); cell.setSize(CELL_SIZE, CELL_SIZE);
    cell.position.set(wallX, wallY + i * CELL_SIZE);
    cell.center.set(wallX + CELL_SIZE / 2, wallY + (i + 0.5) * CELL_SIZE);
    world.add(cell); return cell;
  });
  const obstacles = [wall, ...cells];
  const water = new WaterGeometry(mode === 'water'
    ? Array.from({ length: 6 }, (_, i) => ({ gridX: 5, gridY: 3 + i })) : [], metrics);
  const slide = { x: 0, y: 0, vx: 0, vy: 0 };
  const blocked = (x: number, y: number) => ((mode === 'wall' && wall.enable) || mode === 'rocks')
    && x === 5 && y >= 3 && y < 9 || water.hasCell(x, y);
  const geometry: PlayerMovementGeometry = { metrics, isBlockedCell: blocked,
    collide: p => {
      for (const obstacle of obstacles) if (obstacle.enable) world.collide(p, obstacle);
      collidePlayerWater(p.body as any, water, slide);
    },
    canOccupyCircle: (x, y, radius) => x - radius >= metrics.offsetX && y - radius >= metrics.offsetY
      && x + radius <= metrics.maxX && y + radius <= metrics.maxY && !water.isCircleBlocked(x, y, radius)
      && obstacles.every(o => !o.enable || Math.hypot(x - Math.max(o.left, Math.min(x, o.right)),
        y - Math.max(o.top, Math.min(y, o.bottom))) >= radius - 1e-6),
  };
  const player = { id: 'p', get x() { return proxy.x; }, get y() { return proxy.y; },
    active: true, physicsProxy: proxy, body, positionRevision: 0,
    setCollisionRadius: (r: number) => body.setCircle(r, PLAYER_SIZE / 2 - r, PLAYER_SIZE / 2 - r),
    setDashScale: vi.fn(), setWalking: vi.fn(), setMovementPresentationOffset: vi.fn() } as unknown as PlayerEntity;
  const input: PlayerInput = { dx: 1, dy: 0.5, aim: 0, movementSequence: 1, worldRevision: 1 };
  const combat = { alive: true, isAlive() { return this.alive; } };
  const system = new HostPhysicsSystem(scene as never,
    { getAllPlayers: () => [player], getPlayer: () => player } as never,
    { isHost: () => true, getPlayerInput: () => input, getWorldParticipation: () => 'interactive' } as never,
    combat as never);
  system.setRunSpeedResolver(() => 100);
  const manual = new ClientPlayerMovementBody(player, geometry);
  return { scene, world, body, proxy, wall, cells, water, slide, blocked, geometry, player, input, combat, system, manual };
}

describe('isolated client Arcade movement', () => {
  it('keeps burst and recovery host-controlled even when both finish between snapshots', () => {
    const f = fixture('bounds'); f.system.setWorldMetrics(metrics);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      const step = (now: number) => {
        f.system.update(false, now); f.world.update(now, 1000 / 120); f.scene.events.emit('postupdate');
      };
      step(0); const original = f.system.getMovementPredictionState('p', 0)!;
      f.system.handleDashRPC('p', 1, 0);
      step(0); expect(f.system.getDashPhase('p')).toBe(1);
      expect(f.system.getMovementPredictionState('p', 0)?.canPredict).toBe(false);
      const recoveryStart = DASH_T1_S * 1000 + 1;
      step(recoveryStart); expect(f.system.getDashPhase('p')).toBe(2);
      expect(f.system.getMovementPredictionState('p', recoveryStart)?.canPredict).toBe(false);
      const end = recoveryStart + DASH_T2_S * 1000 + 1;
      step(end); expect(f.system.getDashPhase('p')).toBe(0);
      const resumed = f.system.getMovementPredictionState('p', end)!;
      expect(resumed.canPredict).toBe(true); expect(resumed.revision).toBeGreaterThan(original.revision);
    } finally { clock.mockRestore(); f.system.setWorldMetrics(null); }
  });

  it.each(['death', 'stun', 'burrow-windup', 'burrow-recovery', 'self-push', 'recoil', 'forced', 'mounted', 'countdown'])(
    'disables prediction during %s and starts a new revision afterwards', mode => {
      const f = fixture('bounds'); f.system.setWorldMetrics(metrics);
      const step = (locked = false) => {
        f.system.update(locked, 1000);
        f.world.update(1000, 1000 / 120); f.scene.events.emit('postupdate');
      };
      step(); const before = f.system.getMovementPredictionState('p', 1000)!;
      expect(before.canPredict).toBe(true);
      let interrupted = true;
      if (mode === 'death') f.combat.alive = false;
      if (mode === 'stun') f.system.setStunChecker(() => interrupted);
      if (mode.startsWith('burrow')) f.system.setBurrowSystem({
        isStunned: () => false, isBurrowed: () => false, getMovementSpeedFactor: () => 1,
        getPhase: () => interrupted ? mode.slice(7) : 'idle',
      } as never);
      if (mode === 'self-push') f.system.setLoadoutManager({ getSpeedMultiplier: () => 1,
        getHeldSelfPushVelocity: () => interrupted ? { vx: 20, vy: 0 } : null } as never);
      if (mode === 'recoil') { vi.spyOn(Date, 'now').mockReturnValue(0); f.system.addRecoil('p', 20, 0, 2000); }
      if (mode === 'forced') f.system.setForcedMovement('p', 20, 0);
      if (mode === 'mounted') f.system.setPlayerMounted('p', { x: f.player.x, y: f.player.y });
      // Also catches actions after velocity selection but before a snapshot in the same frame.
      if (mode !== 'countdown') expect(f.system.getMovementPredictionState('p', 1000)?.canPredict).toBe(false);
      step(mode === 'countdown');
      expect(f.system.getMovementPredictionState('p', 1000)?.canPredict).toBe(false);
      interrupted = false;
      f.combat.alive = true;
      if (mode === 'forced') f.system.clearForcedMovement('p');
      if (mode === 'mounted') f.system.setPlayerMounted('p', null);
      if (mode === 'recoil') f.system.update(false, 3000); // Expire the impulse before resuming.
      step();
      expect(f.system.getMovementPredictionState('p', 1000)?.canPredict).toBe(true);
      expect(f.system.getMovementPredictionState('p', 1000)!.revision).toBeGreaterThan(before.revision);
      f.system.setWorldMetrics(null); vi.restoreAllMocks();
    });

  it.each(['wall', 'water', 'bounds'] as const)('matches normal host collision against %s', mode => {
    const host = fixture(mode), client = fixture(mode);
    if (mode === 'bounds') {
      host.body.reset(metrics.maxX - 40, metrics.maxY - 40);
      client.body.reset(metrics.maxX - 40, metrics.maxY - 40);
    }
    host.world.addCollider(host.proxy, host.wall);
    host.world.on('worldstep', () => collidePlayerWater(host.body, host.water, host.slide));
    client.manual.control(true);
    const velocity = { dx: 0, dy: 0 };
    for (let i = 0; i < 120; i++) {
      resolveWalkingVelocity(host.proxy.x, host.proxy.y, 1, 0.5, 100, metrics, host.blocked, velocity);
      host.body.setVelocity(velocity.dx, velocity.dy);
      host.world.update(i * 1000 / 120, 1000 / 120); host.world.postUpdate();
      client.manual.step(1, 0.5, 100, 1000 / 120);
    }
    expect(client.proxy.x).toBeCloseTo(host.proxy.x, 6);
    expect(client.proxy.y).toBeCloseTo(host.proxy.y, 6);
    expect(client.world.bodies.has(client.body)).toBe(false);
    const before = client.proxy.x;
    client.world.update(2000, 100); client.world.postUpdate();
    expect(client.proxy.x).toBe(before);
    client.manual.control(false);
    expect(client.world.bodies.has(client.body)).toBe(true);
    expect(client.body.velocity.length()).toBe(0);
  });

  it('reads removed obstacles on the next replay and rejects cosmetic paths through walls', () => {
    const f = fixture(); f.manual.control(true);
    expect(f.manual.canCorrectTo(f.wall.right + 30, f.proxy.y)).toBe(false);
    for (let i = 0; i < 30; i++) f.manual.step(1, 0, 100, 50);
    expect(f.proxy.x + PLAYER_SIZE / 2).toBeLessThanOrEqual(f.wall.left + 1e-6);
    f.wall.enable = false;
    expect(f.manual.canCorrectTo(f.wall.right + 30, f.proxy.y)).toBe(true);
    f.manual.step(1, 0, 100, 50);
    expect(f.proxy.x + PLAYER_SIZE / 2).toBeGreaterThan(f.wall.left);
  });

  it('uses the same corner assist to pass a clipped wall edge', () => {
    const host = fixture(), client = fixture();
    for (const f of [host, client]) f.body.reset(f.wall.left - 30, f.wall.top - 10);
    host.world.addCollider(host.proxy, host.wall); client.manual.control(true);
    const velocity = { dx: 0, dy: 0 };
    for (let i = 0; i < 120; i++) {
      resolveWalkingVelocity(host.player.x, host.player.y, 1, 0, 100, metrics, host.blocked, velocity);
      host.body.setVelocity(velocity.dx, velocity.dy);
      host.world.update(i * 1000 / 120, 1000 / 120); host.world.postUpdate();
      client.manual.step(1, 0, 100, 1000 / 120);
    }
    expect(client.player.x).toBeGreaterThan(client.wall.right);
    expect(client.player.y).toBeLessThanOrEqual(client.wall.top - PLAYER_SIZE / 2 + 0.1);
    expect(client.player.x).toBeCloseTo(host.player.x, 6);
    expect(client.player.y).toBeCloseTo(host.player.y, 6);
  });

  it.each([[60, 0], [144, 0.2], [100, 0.3]])(
    'predicts sliding along rock seams without corrections (client %s FPS, jitter %s)', (fps, jitter) => {
      const host = fixture('rocks'), client = fixture('rocks');
      for (const f of [host, client]) f.body.reset(f.wall.left - 40, f.wall.top + 5);
      for (const cell of host.cells) host.world.addCollider(host.proxy, cell);
      host.system.setWorldMetrics(metrics); host.system.setMovementBlockedCellResolver(host.blocked);
      const clientInput = { ...client.input, dx: 1, dy: 1 };
      const prediction = new LocalPlayerPrediction(1, {
        getInput: () => clientInput,
        restartInput: confirmed => { clientInput.movementSequence = Math.max(clientInput.movementSequence!, confirmed) + 1; },
      });
      prediction.setBody(client.manual);
      const inFlight: { at: number; deliver(): void }[] = [];
      const latencyMs = 45;
      let snapshot: Parameters<LocalPlayerPrediction['update']>[0], version = 0, hostNow = 0, clientNow = 0;
      let seed = 7; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const errors: number[] = [];
      for (let frame = 0; hostNow < 1400; frame++) {
        // Host: UPDATE (fixed Arcade steps), scene update, POST_UPDATE at 60 Hz.
        hostNow += 1000 / 60;
        host.world.update(hostNow, 1000 / 60);
        host.system.update(false, hostNow);
        host.scene.events.emit('postupdate');
        if (frame % 3 === 0) {
          const state = { x: host.player.x, y: host.player.y, alive: true, positionRevision: 0,
            movementPrediction: host.system.getMovementPredictionState('p', hostNow) };
          inFlight.push({ at: hostNow + latencyMs, deliver: () => { snapshot = state; version++; } });
        }
        // Client renders at its own jittered rate and sends every input sample to the host.
        while (clientNow < hostNow) {
          const dt = 1000 / fps * (1 + (random() - 0.5) * jitter);
          clientNow += dt;
          while (inFlight[0] && inFlight[0].at <= clientNow) inFlight.shift()!.deliver();
          const before = version;
          prediction.update(snapshot, version, dt, clientNow, true);
          if (before === version && errors.length < version) errors.push(prediction.lastReconciliationError);
          const sent = { ...clientInput };
          inFlight.push({ at: clientNow + latencyMs, deliver: () => Object.assign(host.input, sent) });
          inFlight.sort((a, b) => a.at - b.at);
        }
      }
      expect(host.player.x + PLAYER_SIZE / 2).toBeLessThanOrEqual(host.wall.left + 1e-6);
      expect(host.player.y).toBeGreaterThan(host.wall.top + CELL_SIZE * 3); // Crossed several seams.
      // The first confirmations after the start restart still carry the pre-restart path.
      expect(Math.max(...errors.slice(6))).toBeLessThan(1e-6);
    });

  it('keeps the actual Phaser UPDATE / scene update / POST_UPDATE pose and ACK coherent', () => {
    const f = fixture('bounds'); f.system.setWorldMetrics(metrics);
    f.input.dy = 0; f.system.update(false, 0);
    f.world.update(0, 1000 / 120);
    expect(f.system.getMovementPredictionState('p')?.canPredict).toBe(false);
    f.scene.events.emit('postupdate');
    const x = f.player.x;
    const first = f.system.getMovementPredictionState('p')!;
    expect(first).toMatchObject({ sequence: 1, canPredict: true });
    expect(first.appliedMs).toBeCloseTo(1000 / 120);
    f.world.update(10, 1000 / 120);
    f.input.movementSequence = 2; f.input.dx = 0; f.input.dy = 1;
    f.system.update(false, 10);
    expect(f.player.x).toBe(x);
    expect(f.system.getMovementPredictionState('p')).toEqual(first);
    f.scene.events.emit('postupdate');
    expect(f.player.x).toBeGreaterThan(x);
    expect(f.system.getMovementPredictionState('p')).toMatchObject({ sequence: 1, canPredict: true });
    f.world.update(20, 1000 / 120); f.scene.events.emit('postupdate');
    expect(f.system.getMovementPredictionState('p')).toMatchObject({ sequence: 2, canPredict: true });
    expect(f.system.getMovementPredictionState('p')?.appliedMs).toBeCloseTo(1000 / 120);
    const confirmed = f.system.getMovementPredictionState('p');
    f.world.update(21, 1); // Render frame without a fixed Arcade step.
    f.input.movementSequence = 3; f.system.update(false, 21); f.scene.events.emit('postupdate');
    expect(f.system.getMovementPredictionState('p')).toEqual(confirmed);
    f.system.setWorldMetrics(null);
    expect(f.scene.events.listenerCount('postupdate')).toBe(1);
  });
});
