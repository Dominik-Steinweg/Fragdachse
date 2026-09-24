import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, dropConnection, type TestRoom } from '../fakePeerNetwork';
import { droneHarness, droneGroup } from '../AttackDroneTestHarness';

describe('attack drone World replication', () => {
  it('replicates attacks and service, heals skipped snapshots, bootstraps late join and rejects an old World', async () => {
    const network = new FakeNetwork(), hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network, [], 'attack-drone-client-resume-token');
    const use=(room:TestRoom)=>setActiveSession({room:room.room,transport:room.transport,roomCode:'DRONES'});
    const connect=(room:TestRoom)=>{use(room);const bridge=new NetworkBridge();bridge.activate();return bridge;};
    const host=connect(hostRoom), world={worldRevision:1,definitionId:'world:lobby',seed:1,generatorVersion:3,layoutFingerprint:'drone'};
    host.publishLobbySync();host.publishWorldAndActivity(world,null);const client=connect(clientRoom);
    const base: Parameters<NetworkBridge['publishGameState']>[0]={roundStartTime:0,players:{},projectiles:null,enemies:null,rocks:null,
      placeableRocks:[],reinforcementMatrices:[],energyInjectorEffects:[],energyInjectorFocus:[],remoteControlTurrets:[],decoys:[],smokes:[],fires:[],powerups:null,pedestals:null,
      nukes:[],airstrikes:[],meteors:[],tunnels:[],train:null,bases:[],captureTheBeer:null,coopDefenseCarry:[],stinkClouds:[],timeBubbles:[],teslaDomes:[],energyShields:[],
      guardianSpirits:[],repairDrones:[],slimeTrail:{cells:[],affectedEnemies:[]},targetVulnerabilities:[],ak47StrategicTargets:[],burningGround:{cells:[]}};
    const h=droneHarness({bombBay:1});h.targets.splice(0,1,...droneGroup());h.tick(0);
    const publish=()=>{use(hostRoom);host.publishGameState({...base,attackDrones:h.system.getSnapshot(),attackDroneBombs:h.bombs.slice(-1).map(b=>({
      id:b.attackId,stationId:b.stationId,ownerId:b.ownerId,x:b.x,y:b.y,droppedAt:b.at,landsAt:b.at+250}))},true);hostRoom.room.update();use(clientRoom);};
    try {
      while(!h.bombs.length&&h.now<4000)h.tick();publish();
      expect(client.getLatestGameState()!.attackDrones).toEqual(h.system.getSnapshot());
      expect(client.getLatestGameState()!.attackDroneBombs).toHaveLength(1);
      const late=connect(await addClientRoom(network));expect(late.getLatestGameState()!.attackDrones).toEqual(h.system.getSnapshot());
      expect(late.getLatestGameState()!.attackDroneBombs).toEqual(client.getLatestGameState()!.attackDroneBombs);
      clientRoom.transport.reconnectEnabled = false; dropConnection(clientRoom);
      const resumedRoom = await addClientRoom(network, [], 'attack-drone-client-resume-token');
      expect(resumedRoom.room.getLocalPlayerId()).toBe(clientRoom.room.getLocalPlayerId());
      const resumed = connect(resumedRoom);
      expect(resumed.getLatestGameState()!.attackDrones).toEqual(h.system.getSnapshot());
      expect(resumed.getLatestGameState()!.attackDroneBombs).toEqual(late.getLatestGameState()!.attackDroneBombs);
      // Several host updates intentionally have no publication. The next complete projection heals the gap.
      h.run(2000);h.owner.available=false;h.run(1500);publish();
      use(resumedRoom); expect(resumed.getLatestGameState()!.attackDrones).toEqual(h.system.getSnapshot());
      const oldSnapshot = resumedRoom.room.getGlobal('gsi');
      h.system.clear();h.bombs.length=0;publish();
      use(resumedRoom); expect(resumed.getLatestGameState()!.attackDrones).toEqual([]);expect(resumed.getLatestGameState()!.attackDroneBombs).toEqual([]);
      use(hostRoom);host.publishWorldAndActivity({...world,worldRevision:2},null);use(resumedRoom);
      expect(resumed.getLatestGameState()).toBeUndefined();
      // Re-delivery after a World change must never resurrect old drones or falling bombs.
      hostRoom.room.setGlobal('gs', oldSnapshot, true); hostRoom.room.update();
      expect(resumed.getLatestGameState()).toBeUndefined();
    } finally {clearActiveSession();}
  });
});
