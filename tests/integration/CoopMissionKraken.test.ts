import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());
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
  const dive = () => { tick(config.dive.intervalMs); tick(config.dive.intervalMs + config.dive.durationMs); };
  const land = (id: number, x = 35, y = 40) => {
    const effect = { type: 'kraken_egg_land' as const, boss, castId: 'cast', eggId: `flight-${id}`,
      broodTableId: config.eggs.broodTable.id, originId: 'kraken-encounter' };
    expect(brood.reserveEgg(effect)).toBe(true); brood.released(effect, id);
    routeKrakenEggLanding({ effect, projectileId: id, ...worldCellCenter(metrics, x, y),
      provenance: { gameplaySourceId: boss.id, attributionId: boss.id, allegiance: { ownerId: boss.id } } } as never, now, brood);
    return brood.getEggs(boss).find(e => e.castId === effect.castId && manager.getEnemy(e.eggId)?.sprite.x === worldCellCenter(metrics, x, y).x)!;
  };
  return { runtime, manager, boss, system, habitat, brood, tick, dive, land, flights, metrics, ports, publish, impact, release, broodBinding, block, contacts: () => contacts };
}

describe('Coop mission Kraken composition', () => {
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
  it('joins the real host projection mid-dive with all parts and follows the terminal clear', async () => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network);
    const rooms = [hostRoom];
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'KRAKEN' });
    try {
      use(hostRoom); const host = new NetworkBridge(); host.activate(); host.publishLobbySync();
      host.publishWorldAndActivity({ worldRevision: 2, definitionId: 'world:lobby', seed: 1, generatorVersion: 3, layoutFingerprint: 'kraken' },
        { worldRevision: 2, activityRevision: 5, kind: 'coop-mission', definitionId: 'activity:coop-mission:kraken-abyss-lab' });
      const f = setup(); Object.assign(f.ports, { publish: (s: ReturnType<typeof f.system.getState>) => host.publishKrakenState(s) });
      f.dive(); const state = f.system.getState()!;
      const snapshot = gameState(state); snapshot.enemies = f.manager.getNetSnapshot();
      host.publishGameState(snapshot, true); hostRoom.room.update();
      const clientRoom = await addClientRoom(network); rooms.push(clientRoom); use(clientRoom);
      const client = new NetworkBridge(); client.activate();
      expect(client.getLatestGameState()?.kraken).toEqual(state);
      expect(client.getKrakenState()?.tentacles.length).toBeGreaterThan(1);
      use(hostRoom); f.runtime.destroy(); hostRoom.room.update();
      use(clientRoom); expect(client.getKrakenState()).toBeNull();
    } finally { for (const room of rooms) room.room.destroy(); clearActiveSession(); }
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
    f.tick(state.tentacles[0].contact.targetableFrom);
    expect(f.manager.getEnemy(f.boss.id)!.isBodyTargetable()).toBe(false);
    expect(f.contacts()!.contacts.getContacts(state.tentacles[0].contact.targetableFrom).length).toBeGreaterThan(1);
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

  it('honours an already promised tentacle hit at half HP, retires eggs, then surfaces before protected exit', () => {
    const f = setup(); f.dive(); const part = f.system.getState()!.tentacles[0], egg = f.land(1);
    f.manager.hostSetVitalsBaseline(f.boss.id, 500, 1000);
    f.tick(part.claw.attack!.strikeAt);
    expect(f.system.getState()!.phaseTwoPending).toBe(true); expect(f.manager.getEnemy(egg.eggId)).toBeUndefined();
    f.tick(part.claw.attack!.hitAt); expect(f.impact).toHaveBeenCalled();
    f.tick(part.endsAt + 1);
    const surface = f.system.getState()!.phase; expect(surface.kind).toBe('surfacing');
    if (surface.kind !== 'surfacing') throw Error();
    f.tick(surface.recoveryEndsAt); f.tick(surface.recoveryEndsAt + 1);
    expect(f.system.getState()!.phase.kind).toBe('ashore'); expect(f.manager.getEnemy(f.boss.id)!.isBodyTargetable()).toBe(false);
  });

  it('allows burst death underwater and detaches every contact, flight, brood and state reference', () => {
    const f = setup(); f.dive(); const part = f.system.getState()!.tentacles[0]; f.land(1);
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
