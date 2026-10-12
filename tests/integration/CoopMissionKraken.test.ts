import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  return { ...phaser, Geom: { ...phaser.Geom, Line: class {} } };
});
import { EnemyManager } from '../../src/entities/EnemyManager';
import { CoopMissionRuntime } from '../../src/activity/CoopMissionRuntime';
import { CoopMissionHostUpdate } from '../../src/activity/CoopMissionHostUpdate';
import { materializeCoopMissionKraken, type CoopMissionKrakenPorts } from '../../src/activity/CoopMissionKrakenComposition';
import { KRAKEN_BOSS_DEFAULTS as config } from '../../src/config/krakenBoss';
import { resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { getCoopDefenseMapConfig } from '../../src/config/coopDefenseMaps';
import { krakenAbyssMap, registerKrakenAbyssMap, KRAKEN_MAP_ID } from '../../src/dev/scenario/krakenAbyssMap';
import { resolveCoopDefenseWorldMetrics, worldCellCenter } from '../../src/world/WorldMetrics';
import { WaterGeometry } from '../../src/arena/WaterGeometry';
import { healthBarTestScene } from '../healthBarTestScene';
import { routeKrakenEggLanding } from '../../src/projectile/KrakenEggLandingReaction';
import { encodeKrakenSnapshot, decodeKrakenSnapshot } from '../../src/network/krakenSnapshotCodec';
import { createProjectileRuntimeTestWorld } from '../ProjectileRuntimeTestHelper';
import { decodeEnemyUpserts } from '../../src/network/enemySnapshotCodec';
import type { ProjectileSpawnRequest } from '../../src/projectile/ProjectileSpawnRequest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';
import { gameState } from '../krakenNetworkFixtures';
import type { NavigationGeometrySnapshot } from '../../src/systems/navigation/NavigationGeometry';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function setup() {
  cleanups.push(registerKrakenAbyssMap());
  const map = getCoopDefenseMapConfig(KRAKEN_MAP_ID), metrics = resolveCoopDefenseWorldMetrics(70, 48);
  const { scene } = healthBarTestScene(), existing = scene.physics.add.existing;
  scene.physics.add.existing = (object: any) => { existing(object); object.body.setImmovable = (v: boolean) => { object.body.immovable = v; }; };
  const manager = new EnemyManager(scene, resolveCoopDefenseEnemyConfigs(1));
  const scope = { worldRevision: 2, runtimeGeneration: 1 };
  manager.bindCombatIdentity(scope, 5); manager.setWorldMetrics(metrics);
  manager.setWaterGeometry(new WaterGeometry(map.water!, metrics));
  const runtime = new CoopMissionRuntime({ worldRevision: 2, activityRevision: 5, kind: 'coop-mission', definitionId: 'activity:coop-mission:kraken-abyss-lab' });
  runtime.setEnemyManager(manager);
  const player = { kind: 'player' as const, id: 'p', ...worldCellCenter(metrics, 35, 40) };
  const field = { canReachCurrentGoals: () => true, destroy() {} };
  runtime.setNavigation({ enemy: field, player: field, boss: field, strategic: field,
    coordinator: { getFieldView: () => ({ version: () => ({ topology: 1 }) }), destroy() {} },
    intents: { get: () => ({ target: player }), clear() {} }, strategicTarget: { clear() {} },
    targetCatalog: { resolve: () => player, getCandidates: () => [player], clear() {} }, releaseGridChanges() {},
  } as never);
  let now = 0, nextProjectile = 0;
  const flights = new Map<number, ProjectileSpawnRequest>();
  let contacts: Parameters<CoopMissionKrakenPorts['combat']['bindPartContacts']>[0] | null = null;
  const release = vi.fn(() => { contacts = null; });
  const publish = vi.fn(), broodBinding = vi.fn(), impact = vi.fn(() => ({ accepted: true, interactions: [] }));
  const ports: CoopMissionKrakenPorts = {
    combat: { getCombatScope: () => scope, isStunned: () => false, readCollisionTargets: vi.fn(),
      bindPartContacts: binding => { contacts = binding; return release; }, resolveAreaAttack: impact },
    resolveIntentTarget: () => ({ kind: 'player', id: 'p', scope, instance: { entityGeneration: 1, lifeRevision: 1 } }),
    projectiles: { spawnProjectile: request => { flights.set(++nextProjectile, request); return nextProjectile; } },
    cancelFlights: ids => { for (const id of ids) flights.delete(id); }, bindBrood: broodBinding,
    publish, broadcastClaw: vi.fn(), broadcastHit: vi.fn(), now: () => now, diagnostic: vi.fn(),
  };
  let geometry: NavigationGeometrySnapshot = { left: metrics.offsetX, top: metrics.offsetY, right: metrics.maxX, bottom: metrics.maxY, obstacles: [] };
  const block = (x: number, y: number) => {
    const p = worldCellCenter(metrics, x, y);
    geometry = { ...geometry, obstacles: [...geometry.obstacles,
      { id: `barrier-${x}-${y}`, kind: 'barrier', shape: 'circle', ...p, radius: 32 }] };
  };
  materializeCoopMissionKraken(runtime, map, { water: map.water } as never, metrics, ports, () => geometry);
  cleanups.push(() => runtime.destroy());
  const { system, habitat, brood } = runtime.kraken!;
  const permit = habitat.reserveWaterSpawn(map.krakenHabitat!.id, config.bodyRadiusPx);
  expect(permit.status).toBe('valid'); if (permit.status !== 'valid') throw Error(permit.reason);
  const boss = manager.hostSpawnAtHabitat('abyssal-kraken', permit.value, habitat)!;
  habitat.release(permit.value.reservationId);
  system.start(boss, map.krakenHabitat!.id, 0, 0);
  const tick = (at: number) => {
    system.preMovement(at, at - now); now = at;
    manager.hostUpdateMovement(null, null, null, null, false, at, 0);
    system.hostUpdateActions(at);
  };
  const dive = () => {
    tick(config.dive.intervalMs); tick(config.dive.intervalMs + config.dive.durationMs);
    for (let i = 1; i < config.tentacles.maxConcurrent; i++) tick(config.dive.intervalMs + config.dive.durationMs + i * config.tentacles.retryMs);
    tick(config.dive.intervalMs + config.dive.durationMs + (config.tentacles.maxConcurrent - 1) * config.tentacles.retryMs + config.tentacles.riseMs);
  };
  const armFirst = () => {
    const part = system.getState()!.tentacles[0];
    // Move a valid target into range after the emergence baseline, at an oblique angle.
    player.x = part.contact.x + 80; player.y = part.contact.y + 100;
    tick(now + 1);
    return system.getState()!.tentacles[0];
  };
  const land = (id: number, x = 35, y = 40) => {
    const effect = { type: 'kraken_egg_land' as const, boss, castId: 'cast', eggId: `flight-${id}`,
      broodTableId: config.eggs.broodTable.id, originId: 'kraken-encounter' };
    expect(brood.reserveEgg(effect)).toBe(true); brood.released(effect, id);
    routeKrakenEggLanding({ effect, projectileId: id, ...worldCellCenter(metrics, x, y),
      provenance: { gameplaySourceId: boss.id, attributionId: boss.id, allegiance: { ownerId: boss.id } } } as never, now, brood);
    return brood.getEggs(boss).find(e => e.castId === effect.castId && manager.getEnemy(e.eggId)?.sprite.x === worldCellCenter(metrics, x, y).x)!;
  };
  return { runtime, manager, boss, system, habitat, brood, tick, dive, armFirst, land, flights, metrics, player, ports, publish, impact, release, broodBinding, block, contacts: () => contacts };
}

describe('Coop mission Kraken composition', () => {
  it('keeps the entire curved wandering path inside the real pond clearance', () => {
    const f = setup(); Object.assign(f.ports, { resolveIntentTarget: () => null });
    const entity = f.manager.getEnemy(f.boss.id)!;
    const start = { x: entity.sprite.x, y: entity.sprite.y };
    let previousAngle = entity.getAimAngle();
    for (let at = 20; at <= 5000; at += 20) {
      f.tick(at);
      expect(f.habitat.canWander(entity.sprite, entity.sprite)).toBe(true);
      expect(Math.abs(entity.getAimAngle() - previousAngle)).toBeLessThanOrEqual(config.waterWander.turnRateDegPerSec * Math.PI / 180 * .02 + 1e-9);
      previousAngle = entity.getAimAngle();
    }
    expect(Math.hypot(entity.sprite.x - start.x, entity.sprite.y - start.y)).toBeGreaterThan(0);
  });
  it('returns an invalid phase-two body from deep water along bounded, solid-free steps', () => {
    const f = setup(); f.manager.hostSetVitalsBaseline(f.boss.id, 400, 1000); f.tick(1);
    const exit = f.system.getState()!.phase; if (exit.kind !== 'ashore') throw Error();
    f.tick(exit.recoveryEndsAt);
    const entity = f.manager.getEnemy(f.boss.id)!;
    f.tick(exit.recoveryEndsAt + 1);
    const waterPoint = worldCellCenter(f.metrics, 35, 22);
    entity.setPosition(waterPoint.x, waterPoint.y);
    expect(f.habitat.isDryBodyFree(entity.sprite, config.bodyRadiusPx)).toBe(false);
    let steps = 0, previous = { x: entity.sprite.x, y: entity.sprite.y };
    // Recovery ends once the pose is valid for the land body (small bank overlaps are tolerated).
    for (; steps < 500 && !f.habitat.landPoseValid(entity.sprite); steps++) {
      f.tick(exit.recoveryEndsAt + (steps + 1) * 20);
      expect(Math.hypot(entity.sprite.x - previous.x, entity.sprite.y - previous.y)).toBeLessThanOrEqual(config.landMoveSpeedPxPerSec * .02 + 1e-8);
      previous = { x: entity.sprite.x, y: entity.sprite.y };
      expect(f.system.getState()!.bodyAction).toBeNull();
    }
    expect(steps).toBeGreaterThan(1); expect(steps).toBeLessThan(500);
    expect(f.habitat.landPoseValid(entity.sprite)).toBe(true);
    expect(f.system.getState()!.phase.kind).toBe('land');
  });
  it.each(['water', 'player'] as const)('stops the frozen lunge before %s', obstacle => {
      const f = setup(); f.manager.hostSetVitalsBaseline(f.boss.id, 400, 1000); f.tick(1);
      const exit = f.system.getState()!.phase; if (exit.kind !== 'ashore') throw Error();
      f.tick(exit.recoveryEndsAt);
      const entity = f.manager.getEnemy(f.boss.id)!, start = { x: entity.sprite.x, y: entity.sprite.y };
      const angle = obstacle === 'water' ? -Math.PI / 2 : 0;
      entity.faceAngle(angle);
      Object.assign(f.player, { x: start.x + Math.cos(angle) * 200, y: start.y + Math.sin(angle) * 200 });
      if (obstacle === 'player') vi.mocked(f.ports.combat.readCollisionTargets).mockImplementation(sink => sink('player', 'p', 'p',
        f.player.x, f.player.y, 16, f.player.x - 16, f.player.y - 16, f.player.x + 16, f.player.y + 16));
      f.tick(exit.recoveryEndsAt + config.actionPauseMs);
      const attack = f.system.getBodyClaw().attack!; expect(attack.presentation).toBe('slam');
      f.tick(attack.hitAt); f.tick(attack.hitAt);
      expect(f.habitat.isDryBodyFree(entity.sprite, config.bodyRadiusPx)).toBe(true);
      if (obstacle === 'player') expect(Math.hypot(entity.sprite.x - f.player.x, entity.sprite.y - f.player.y)).toBeGreaterThanOrEqual(config.bodyRadiusPx + 16 - 1e-8);
      expect(f.impact).toHaveBeenCalledOnce();
      expect(f.system.getBodyClaw().attack!.pose).toEqual(attack.pose);
  });
  it('stops the lunging body circle before a real World obstacle', () => {
    const f = setup(); f.manager.hostSetVitalsBaseline(f.boss.id, 400, 1000); f.tick(1);
    const exit = f.system.getState()!.phase; if (exit.kind !== 'ashore') throw Error();
    f.tick(exit.recoveryEndsAt);
    const entity = f.manager.getEnemy(f.boss.id)!, start = { x: entity.sprite.x, y: entity.sprite.y };
    f.player.x = start.x + config.slam.length; f.player.y = start.y; entity.faceAngle(0);
    const obstacleX = Math.floor((start.x + config.slam.lungeDistancePx - f.metrics.offsetX) / 32);
    const obstacleY = Math.floor((start.y - f.metrics.offsetY) / 32);
    const obstacle = worldCellCenter(f.metrics, obstacleX, obstacleY); f.block(obstacleX, obstacleY);
    f.tick(exit.recoveryEndsAt + config.actionPauseMs);
    const attack = f.system.getBodyClaw().attack!; expect(attack.presentation).toBe('slam');
    f.tick(attack.hitAt);
    expect(entity.sprite.x).toBeGreaterThan(start.x);
    expect(entity.sprite.x - start.x).toBeLessThan(config.slam.lungeDistancePx);
    expect(Math.hypot(entity.sprite.x - obstacle.x, entity.sprite.y - obstacle.y)).toBeGreaterThanOrEqual(config.bodyRadiusPx + 32);
    expect(f.impact).toHaveBeenCalledOnce();
  });
  it('revalidates the full exit against current World geometry and selects the other authored corridor', () => {
    const f = setup(), habitatId = krakenAbyssMap().krakenHabitat!.id;
    const first = f.habitat.reserveExit(f.boss, habitatId);
    expect(first.status).toBe('valid'); if (first.status !== 'valid') throw Error();
    f.block(32, 39);
    expect(f.habitat.revalidateExit(first.value).status).toBe('blocked');
    const second = f.habitat.reserveExit(f.boss, habitatId);
    expect(second.status).toBe('valid'); if (second.status !== 'valid') throw Error();
    expect(second.value.corridorId).not.toBe(first.value.corridorId);
    f.block(43, 39);
    expect(f.habitat.reserveExit(f.boss, habitatId).status).toBe('blocked');
  });
  it('walks around the pond instead of lunging at a target across the water', () => {
    const f = setup();
    f.manager.hostSetVitalsBaseline(f.boss.id, 400, 1000); f.tick(1);
    const exit = f.system.getState()!.phase; if (exit.kind !== 'ashore') throw Error('Expected exit');
    f.tick(exit.recoveryEndsAt);
    expect(f.system.getState()!.phase.kind).toBe('land');
    // Within the doubled claw reach, but the straight lunge line crosses the pond.
    const across = worldCellCenter(f.metrics, 35, 8);
    f.player.x = across.x; f.player.y = across.y;
    const actions = new Set<string>();
    for (let at = exit.recoveryEndsAt; at < exit.recoveryEndsAt + 6000; at += 50) {
      f.tick(at); const kind = f.system.getState()!.bodyAction?.kind; if (kind) actions.add(kind);
    }
    expect(actions.has('slam')).toBe(false);
  });
  it.each(['dive', 'ashore', 'lunge', 'spines'] as const)('joins the real host projection during %s and follows the terminal clear', async phase => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network);
    const rooms = [hostRoom];
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'KRAKEN' });
    try {
      use(hostRoom); const host = new NetworkBridge(); host.activate(); host.publishLobbySync();
      host.publishWorldAndActivity({ worldRevision: 2, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'kraken' },
        { worldRevision: 2, activityRevision: 5, kind: 'coop-mission', definitionId: 'activity:coop-mission:kraken-abyss-lab' });
      const f = setup(); Object.assign(f.ports, { publish: (s: ReturnType<typeof f.system.getState>) => host.publishKrakenState(s) });
      let projectileWorld: ReturnType<typeof createProjectileRuntimeTestWorld> | null = null;
      if (phase === 'dive') f.dive();
      else if (phase === 'spines') {
        projectileWorld = createProjectileRuntimeTestWorld();
        const world = projectileWorld;
        cleanups.push(() => world.runtime.destroy());
        Object.assign(f.ports.projectiles, { spawnProjectile: (request: ProjectileSpawnRequest) => world.runtime.spawnProjectile(request) });
        const entity = f.manager.getEnemy(f.boss.id)!;
        f.player.x = entity.sprite.x + config.spines.range - 1; f.player.y = entity.sprite.y; entity.faceAngle(0);
        world.runtime.setProjectileTargetQueryPort({ queryTargets: (_c, _owner, _x, _y, _r, emit) => emit('p', 'players', f.player.x, f.player.y) });
        f.tick(config.firstAttackDelayMs);
        const cast = f.system.getState()!.bodyAction!; if (cast.kind !== 'spines') throw Error('Expected ranged spine volley');
        for (const at of cast.releaseAt) { world.setHostNowMs(at); world.runtime.setHostFrameTime(at); f.tick(at); }
        const last = [...world.physics.handles.values()].at(-1)!;
        const before = Math.atan2(last.body.velocity.y, last.body.velocity.x);
        world.runtime.runHostProjectileStage(20, cast.releaseAt.at(-1)! + 20);
        const after = Math.atan2(last.body.velocity.y, last.body.velocity.x);
        // The fan opens off the facing; homing turns each spine towards the target (heading 0), rate-limited.
        expect(Math.abs(after)).toBeLessThan(Math.abs(before));
        expect(Math.abs(after - before)).toBeLessThanOrEqual(config.spines.turnRateDegPerSec * Math.PI / 180 * .02 + 1e-9);
        world.runtime.requestFullNetSnapshot();
      } else {
        f.manager.hostSetVitalsBaseline(f.boss.id, 400, 1000); f.tick(1);
        const exit = f.system.getState()!.phase; if (exit.kind !== 'ashore') throw Error();
        if (phase === 'ashore') f.tick((exit.gripAt + exit.heaveAt) / 2);
        else {
          f.tick(exit.recoveryEndsAt);
          const entity = f.manager.getEnemy(f.boss.id)!;
          f.player.x = entity.sprite.x + 200; f.player.y = entity.sprite.y; entity.faceAngle(0);
          f.tick(exit.recoveryEndsAt + config.actionPauseMs);
          const attack = f.system.getBodyClaw().attack!; expect(attack.presentation).toBe('slam');
          f.tick((attack.strikeAt + attack.hitAt) / 2);
          expect(entity.sprite.x).toBeGreaterThan(f.player.x - 200);
        }
      }
      const state = f.system.getState()!;
      const snapshot = gameState(state); snapshot.enemies = f.manager.getNetSnapshot();
      if (projectileWorld) snapshot.projectiles = projectileWorld.runtime.getNetSnapshot();
      host.publishGameState(snapshot, true); hostRoom.room.update();
      const clientRoom = await addClientRoom(network); rooms.push(clientRoom); use(clientRoom);
      const client = new NetworkBridge(); client.activate();
      expect(client.getLatestGameState()?.kraken).toEqual(state);
      if (phase === 'dive') expect(client.getKrakenState()?.tentacles.length).toBeGreaterThan(1);
      if (phase === 'spines') {
        const joined = client.getLatestGameState()!;
        expect(joined.kraken!.spines).toHaveLength(config.spines.volleyCount);
        expect(decodeEnemyUpserts(joined.enemies!.u).find(e => e.id === f.boss.id)?.specialAction).toBe('kraken-spines');
        expect(joined.projectiles.map(p => p.weaponSourceId)).toEqual(Array(config.spines.volleyCount).fill('kraken_spine'));
        expect(joined.projectiles).toHaveLength(config.spines.volleyCount);
      }
      if (phase === 'lunge') expect(decodeEnemyUpserts(client.getLatestGameState()!.enemies!.u).find(e => e.id === f.boss.id)?.areaClaw).toEqual(f.system.getBodyClaw());
      use(hostRoom); f.runtime.destroy(); hostRoom.room.update();
      use(clientRoom); expect(client.getKrakenState()).toBeNull();
    } finally {
      use(hostRoom); for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      for (const room of rooms) room.room.destroy(); clearActiveSession();
    }
  });
  it('updates body protection and movement before ordinary movement/queries, then executes actions', () => {
    const f = setup(), order: string[] = [];
    const pre = vi.spyOn(f.system, 'preMovement').mockImplementation(() => { order.push('protection'); });
    vi.spyOn(f.manager, 'hostUpdateMovement').mockImplementation(() => { expect(order).toEqual(['protection']); order.push('movement'); });
    vi.spyOn(f.system, 'hostUpdateActions').mockImplementation(() => { order.push('actions'); });
    const update = new CoopMissionHostUpdate({ analysisScenarioActive: true, kraken: f.runtime.kraken,
      enemyManager: f.manager } as never, { getFireSystem: () => null, getSmokeSystem: () => null } as never);
    update.run(16, 100, false, false);
    expect(order).toEqual(['protection', 'movement', 'actions']); expect(pre).toHaveBeenCalledOnce();
  });

  it('provides two body-sized exits and multiple independent contacts with an untargetable underwater body', () => {
    const f = setup(); f.dive();
    const state = f.system.getState()!;
    expect(state.phase.kind).toBe('submerged'); expect(state.tentacles.length).toBeGreaterThan(1);

    expect(f.manager.getEnemy(f.boss.id)!.isBodyTargetable()).toBe(false);
    expect(f.contacts()!.contacts.getContacts(state.tentacles.at(-1)!.hoverAt).length).toBeGreaterThan(1);
    const packet = encodeKrakenSnapshot({ worldRevision: 2, activityRevision: 5, sequence: 1, kraken: f.system.getState() });
    expect(decodeKrakenSnapshot(JSON.parse(JSON.stringify(packet)))?.kraken).toEqual(f.system.getState());
    expect(krakenAbyssMap().krakenHabitat!.exits).toHaveLength(2);
  });

  it('routes landing through incubation to one excluded hatch child and suppresses a destroyed egg', () => {
    const f = setup(), egg = f.land(1), doomed = f.land(2, 42, 40);
    expect(egg.status).toBe('incubating'); expect(f.runtime.kraken!.excluded.has(egg.eggId)).toBe(true);
    f.manager.applyDamage(doomed.eggId, config.eggs.maxHp * 2);
    f.brood.hostUpdate(egg.hatchStartedAt);
    expect(f.brood.getEggs(f.boss)[0].status).toBe('hatching');
    f.brood.hostUpdate(egg.spawnAt); f.brood.hostUpdate(egg.spawnAt);
    const children = f.manager.getAllEnemies().filter(e => e.kind === egg.enemyKind);
    expect(children).toHaveLength(1);
    expect(children[0].originId).toBe(egg.originId); expect(f.runtime.kraken!.excluded.has(children[0].id)).toBe(true);
    expect(f.manager.getEnemy(egg.eggId)!.isBodyTargetable()).toBe(false);
  });

  it('breaks an egg at an occupied landing without moving it or spawning brood', () => {
    const f = setup(), p = worldCellCenter(f.metrics, 35, 40);
    vi.mocked(f.ports.combat.readCollisionTargets).mockImplementation(sink => sink('player', 'p', 'p',
      p.x, p.y, 16, p.x - 16, p.y - 16, p.x + 16, p.y + 16));
    expect(f.land(1)).toBeUndefined(); expect(f.brood.getEggs(f.boss)).toEqual([]);
  });

  it('keeps airborne and landed eggs live through the transition and hatches both normally', () => {
    const f = setup(), landed = f.land(1);
    const effect = { type: 'kraken_egg_land' as const, boss: f.boss, castId: 'airborne', eggId: 'flying',
      broodTableId: config.eggs.broodTable.id, originId: 'kraken-encounter' };
    expect(f.brood.reserveEgg(effect)).toBe(true); f.brood.released(effect, 2);
    f.manager.hostSetVitalsBaseline(f.boss.id, 400, 1000); f.tick(1);
    routeKrakenEggLanding({ effect, projectileId: 2, ...worldCellCenter(f.metrics, 42, 40),
      provenance: { gameplaySourceId: f.boss.id, attributionId: f.boss.id, allegiance: { ownerId: f.boss.id } } } as never, 10, f.brood);
    const eggs = f.brood.getEggs(f.boss); expect(eggs).toHaveLength(2);
    expect(f.manager.getEnemy(landed.eggId)).toBeDefined();
    f.brood.hostUpdate(Math.max(...eggs.map(e => e.spawnAt)));
    expect(f.manager.getAllEnemies().filter(e => e.kind === landed.enemyKind)).toHaveLength(2);
    f.manager.applyDamage(f.boss.id, 1000000); f.tick(20);
    expect(f.brood.getEggs(f.boss)).toEqual([]);
  });

  it('honours a promised tentacle hit and preserves incubating eggs at half HP before protected exit', () => {
    const f = setup(); f.dive(); const part = f.armFirst(), egg = f.land(1);
    f.manager.hostSetVitalsBaseline(f.boss.id, 500, 1000);
    f.tick(part.claw.attack!.strikeAt);
    expect(f.system.getState()!.phaseTwoPending).toBe(true); expect(f.manager.getEnemy(egg.eggId)).toBeDefined();
    f.tick(part.claw.attack!.hitAt); expect(f.impact).toHaveBeenCalled();
    f.tick(Math.max(...f.system.getState()!.tentacles.map(p => p.endsAt)) + 1);
    const surface = f.system.getState()!.phase; expect(surface.kind).toBe('surfacing');
    if (surface.kind !== 'surfacing') throw Error();
    f.tick(surface.recoveryEndsAt); f.tick(surface.recoveryEndsAt + 1);
    expect(f.system.getState()!.phase.kind).toBe('ashore'); expect(f.manager.getEnemy(f.boss.id)!.isBodyTargetable()).toBe(false);
  });

  it('allows burst death underwater and detaches every contact, flight, brood and state reference', () => {
    const f = setup(); f.dive(); const part = f.armFirst(); f.land(1);
    f.manager.applyDamage(f.boss.id, 1000000); f.tick(part.claw.attack!.hitAt);
    expect(f.system.getState()!.phase).toMatchObject({ kind: 'dying', submerged: true });
    expect(f.system.contacts.getContacts(part.claw.attack!.hitAt)).toEqual([]);
    expect(f.brood.getEggs(f.boss)).toEqual([]); expect(f.impact).not.toHaveBeenCalled();
    f.runtime.destroy(); f.runtime.destroy();
    expect(f.runtime.kraken).toBeNull(); expect(f.contacts()).toBeNull(); expect(f.release).toHaveBeenCalledOnce();
    expect(f.broodBinding).toHaveBeenLastCalledWith(null); expect(f.publish).toHaveBeenLastCalledWith(null);
    expect(f.system.getState()).toBeNull(); expect(f.flights.size).toBe(0);
  });
});
