import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { FogTerrainModel } from '../src/effects/groundFog/FogTerrainModel';
import { FogResidency } from '../src/effects/groundFog/FogResidency';
import { FogImpulses } from '../src/effects/groundFog/FogImpulses';
import { GroundFogSystem } from '../src/effects/groundFog/GroundFogSystem';
import { FOG, fogDensityAt } from '../src/effects/groundFog/FogConfig';
import { createMovementVisualSample } from '../src/effects/MovementStepSampler';
import { FogTrailSegments } from '../src/effects/groundFog/FogTrailSegments';
import { WorldGroundFogBinding } from '../src/world/WorldGroundFogBinding';
import { EventEmitter } from 'node:events';
import { ARENA_MAP_GRID_CHANGED_EVENT } from '../src/scenes/arena/ArenaEvents';

const frame = { offsetX: 80, offsetY: 40, width: 40960, height: 8192 };
const view = { x: 100, y: 60, width: 1000, height: 700 };
describe('ground fog bounded world state', () => {
  it('keeps melee sectors distinct and applies the projectile quality gate to hitscan', () => {
    const fog = new GroundFogSystem({ sys: { renderer: { on: vi.fn(), off: vi.fn() } } } as never, frame, 1, []);
    fog.addMelee(300, 300, 0, 90, 100); fog.addMelee(300, 300, Math.PI / 2, 90, 100);
    const sectors = fog.impulses.drain('high', view);
    expect(sectors).toHaveLength(2); expect(sectors.every(p => p.kind === 'melee')).toBe(true);
    expect(sectors[0].endX).toBeGreaterThan(sectors[0].x); expect(sectors[1].endY).toBeGreaterThan(sectors[1].y);
    fog.quality = 'low'; fog.addHitscan(300, 300, 900, 300, 2); expect(fog.impulses.size).toBe(0);
    fog.addMelee(300, 300, 0, 90, 100); expect(fog.impulses.size).toBe(1); fog.impulses.clear();
    fog.enabled = false; fog.addMelee(300, 300, 0, 90, 100); expect(fog.impulses.size).toBe(0);
    fog.enabled = true; fog.reactions = false; fog.addHitscan(300, 300, 900, 300, 2); expect(fog.impulses.size).toBe(0);
    fog.destroy();
  });
  it('coalesces confirmed straight flight per source and bins diagonal geometry without exhausting nearby tiles', () => {
    const trails = new FogTrailSegments({ offsetX: 0, offsetY: 0, width: 2048, height: 2048 });
    for (let shot = 0; shot < 40; shot++) for (let i = 0; i < 30; i++) {
      const point = (n: number) => ({ x: 100 + n * 30, y: 100 + shot * .1 + n * 30, timeMs: shot * 40 + n * 16, sequence: n + 1, vx: 1875, vy: 1875 });
      trails.addPath({ from: point(i), to: point(i + 1), ageMs: 0 }, shot, shot * 40 + (i + 1) * 16);
    }
    trails.prepare(2040); expect(trails.size).toBe(40); expect(trails.dropped).toBe(0); expect(trails.tileOverflow).toBe(0);
    // An unrelated tile inside the diagonal's bounding rectangle receives no commands.
    const offLineTile = 1 * trails.columns + 6;
    expect(trails.bins.slice(offLineTile * FOG.trailsPerTile * 4, (offLineTile + 1) * FOG.trailsPerTile * 4).some(Boolean)).toBe(false);
    trails.prepare(2040 + FOG.trailMs); expect(trails.size).toBe(0);
  });
  it('keeps bounce pivots, disconnected histories and overlapping projectile identities separate', () => {
    const trails = new FogTrailSegments(frame);
    const p = (x: number, y: number, timeMs: number) => ({ x, y, timeMs, sequence: timeMs, vx: 1000, vy: 0 });
    const add = (from: ReturnType<typeof p>, to: ReturnType<typeof p>, id = 1) => trails.addPath({ from, to, ageMs: 0 }, id, to.timeMs);
    add(p(100, 100, 0), p(120, 100, 20)); add(p(120, 100, 20), p(140, 100, 40));
    add(p(140, 100, 40), p(140, 120, 60));
    const restart = { ...p(300, 300, 70), breakBefore: true }; add(restart, restart);
    add(p(300, 300, 70), p(320, 300, 90)); add(p(300, 300, 70), p(320, 300, 90), 2);
    trails.prepare(90); expect(trails.size).toBe(4);
  });
  it('bounds fine traces, expires them on world time and clears them on teardown', () => {
    const trails = new FogTrailSegments(frame);
    const p = { x: 100, y: 100, endX: 150, endY: 100, radius: 4, strength: .1, priority: 10, kind: 'projectile' as const };
    for (let i = 0; i < FOG.trailCapacity + 10; i++) trails.add(p, 100);
    trails.prepare(100); expect(trails.size).toBe(FOG.trailCapacity); expect(trails.dropped).toBe(10);
    trails.prepare(100); expect(trails.size).toBe(FOG.trailCapacity);
    trails.prepare(100 + FOG.trailMs); expect(trails.size).toBe(0); expect(trails.bins.some(Boolean)).toBe(false);
    trails.add(p, 500); trails.clear(); trails.prepare(500); expect(trails.size).toBe(0);
  });
  it('seeds late joins, batches terrain events and disconnects all input owners before handoff', () => {
    const events = new EventEmitter(), renderer = { on: vi.fn(), off: vi.fn() };
    const scene = { game: { events }, sys: { renderer } };
    const fog = new GroundFogSystem(scene as never, frame, 1, []);
    const releaseExplosion = vi.fn(), releaseProjectile = vi.fn(), releaseCombat = vi.fn();
    const effects = { bindGroundFogExplosion: vi.fn(() => releaseExplosion), bindGroundFogCombat: vi.fn(() => releaseCombat) };
    const cell = { gridX: 1, gridY: 1 }, gone = { gridX: 2, gridY: 1 };
    const binding = new WorldGroundFogBinding(scene as never, fog, { rocks: [cell, gone] } as never,
      { rockPhysicsProxies: [{ active: true }, { active: false }] } as never, effects);
    const projectiles = { bindGroundFogSegments: vi.fn(() => releaseProjectile) };
    binding.sync(null, null, projectiles as never); fog.terrain.acknowledge();
    expect(fog.terrain.sample(80, 48)[2]).toBe(255);
    for (let i = 0; i < 20; i++) events.emit(ARENA_MAP_GRID_CHANGED_EVENT, { source: 'static_rock', obstacleId: 0, reason: 'rock_destroyed' });
    expect(fog.terrain.sample(48, 48)[0]).toBe(0);
    binding.sync(null, null, projectiles as never);
    expect(fog.terrain.changed.size).toBe(1); expect(fog.terrain.sample(48, 48)[2]).toBe(255);
    expect(projectiles.bindGroundFogSegments).toHaveBeenCalledTimes(1);
    const placement = { getAllRuntimeRocks: vi.fn(() => []) };
    events.emit(ARENA_MAP_GRID_CHANGED_EVENT, { source: 'placeable_rock', reason: 'placeable_added', obstacleId: 17, gridX: 3, gridY: 3 });
    binding.sync(placement, null, projectiles as never); expect(fog.terrain.sample(112, 112)[0]).toBe(0);
    events.emit(ARENA_MAP_GRID_CHANGED_EVENT, { source: 'placeable_rock', reason: 'placeables_batch_removed', removedObstacles: [{ id: 17, gridX: 3, gridY: 3 }] });
    binding.sync(placement, null, projectiles as never); expect(fog.terrain.sample(112, 112)[2]).toBe(255);
    expect(placement.getAllRuntimeRocks).not.toHaveBeenCalled();
    binding.destroy(); binding.destroy();
    expect(events.listenerCount(ARENA_MAP_GRID_CHANGED_EVENT)).toBe(0);
    expect(releaseExplosion).toHaveBeenCalledTimes(1); expect(releaseProjectile).toHaveBeenCalledTimes(1); expect(releaseCombat).toHaveBeenCalledTimes(1);
    expect(fog.terrain.opened.some(Boolean)).toBe(true); fog.destroy();
  });
  it('batches dirty cells, keeps overlapping blockers closed and remembers openings after acknowledgement', () => {
    const terrain = new FogTerrainModel(frame, [{ gridX: 2, gridY: 3 }]);
    const cell = { gridX: 1, gridY: 1 };
    terrain.setObstacle('a', [cell], true); terrain.setObstacle('b', [cell], true); terrain.acknowledge();
    terrain.removeObstacle('a'); expect(terrain.changed.size).toBe(0);
    terrain.removeObstacle('b'); expect(terrain.changed.size).toBe(1); expect(terrain.dirtyChunks.size).toBe(1);
    expect(terrain.sample(48, 48)).toEqual([255, 0, 255, 255]);
    terrain.acknowledge(); expect(terrain.sample(48, 48)).toEqual([255, 0, 255, 0]);
    terrain.setObstacle('a', [cell]); expect(terrain.sample(48, 48)[0]).toBe(0);
    terrain.removeObstacle('a'); expect(terrain.sample(48, 48)[2]).toBe(255);
    expect(terrain.sample(80, 112)[0]).toBe(255);
  });
  it('retains overlapping slots, caps cache and evicts on world time only', () => {
    const residency = new FogResidency(frame);
    residency.update(view, 0); const first = residency.chunks.get('0,0')!; first.fresh = false;
    residency.update({ ...view, x: 200 }, 100); expect(residency.chunks.get('0,0')).toBe(first);
    for (let x = 2000; x < 36000; x += 1400) {
      residency.update({ ...view, x }, 200);
      expect([...residency.chunks.values()].filter(c => !c.active).length).toBeLessThanOrEqual(FOG.cachedChunks);
      expect(residency.chunks.size).toBeLessThanOrEqual(FOG.activeChunks + FOG.cachedChunks);
    }
    expect(residency.chunks.has('0,0')).toBe(false);
    residency.update(view, 200); expect(residency.chunks.get('0,0')?.fresh).toBe(true);
    const size = residency.chunks.size; residency.update(view, 200); expect(residency.chunks.size).toBe(size);
    residency.update(view, 200 + FOG.cacheMs + 1); expect([...residency.chunks.values()].every(c => c.active)).toBe(true);
    residency.update({ x: 0, y: 0, width: frame.width, height: frame.height }, 9000); expect(residency.overflow).toBe(true);
    expect([...residency.chunks.values()].every(c => !c.active)).toBe(true);
    expect(residency.chunks.size).toBeLessThanOrEqual(FOG.cachedChunks);
  });
  it('saturates and prioritizes explosions/player movement without growing a queue', () => {
    const impulses = new FogImpulses();
    for (let i = 0; i < 10000; i++) impulses.add({ x: i * 20, y: 0, endX: i * 20 + 10, endY: 0,
      kind: 'projectile', radius: 4, priority: 10, strength: .1 });
    expect(impulses.size).toBeLessThanOrEqual(FOG.impulses.high * 2);
    impulses.add({ x: 50, y: 50, endX: 50, endY: 50, kind: 'explosion', radius: 300, priority: 400, strength: .9 });
    impulses.add({ x: 50, y: 50, endX: 70, endY: 50, kind: 'motion', radius: 20, priority: 90, strength: .2 });
    const drained = impulses.drain('low', { x: 0, y: 0, width: frame.width, height: frame.height });
    expect(drained.length).toBeLessThanOrEqual(FOG.impulses.low); expect(drained.slice(0, 2).map(p => p.kind)).toEqual(['explosion', 'motion']);
    expect(impulses.size).toBe(0); expect(impulses.dropped).toBeGreaterThan(0);
  });
  it('interrupts pose histories on respawn, invisibility, burrow, pause and teleports', () => {
    const renderer = { on: vi.fn(), off: vi.fn() };
    const fog = new GroundFogSystem({ sys: { renderer } } as never, frame, 1, []);
    const sample = { ...createMovementVisualSample(), x: 300, y: 200, visible: true, size: 40 };
    const source = { readMovementVisualSample: (out: typeof sample) => Object.assign(out, sample) };
    const tick = (dt = 33) => fog.captureMotion(dt, [source], [], view);
    tick(); tick(); expect(fog.impulses.size).toBe(0);
    sample.x += 10; tick(); expect(fog.impulses.size).toBe(1); fog.impulses.clear();
    sample.revision++; sample.x += 10; tick(); expect(fog.impulses.size).toBe(0);
    sample.x += 500; tick(); expect(fog.impulses.size).toBe(0);
    sample.visible = false; tick(); sample.visible = true; sample.x += 10; tick(); expect(fog.impulses.size).toBe(0);
    sample.isBurrowDash = true; tick(); sample.isBurrowDash = false; sample.x += 10; tick(); expect(fog.impulses.size).toBe(0);
    tick(0); sample.x += 10; tick(); expect(fog.impulses.size).toBe(0);
    fog.enabled = false; fog.addExplosion(500, 400, 100); fog.update(33, 360, view);
    expect(fog.getDiagnostics().bytes).toBe(0); expect(fog.impulses.size).toBe(0);
    fog.destroy(); fog.destroy(); expect(renderer.off).toHaveBeenCalledTimes(1);
  });
  it('keeps the daily curve continuous at midnight and denser over water', () => {
    expect(fogDensityAt(0)).toEqual(fogDensityAt(1440));
    for (let t = 0; t < 1440; t += 10) { const [land, water] = fogDensityAt(t); expect(water).toBeGreaterThanOrEqual(land); }
    expect(fogDensityAt(360)[0]).toBeGreaterThan(fogDensityAt(720)[0]);
  });
});
