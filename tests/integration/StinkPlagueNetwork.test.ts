import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';
import { plagueHarness, plagueSource, plagueTarget } from '../StinkPlagueTestHelper';
import { encodeStinkPlague, decodeStinkPlague } from '../../src/network/stinkPlagueCodec';
import { encodeEnemyUpsert, decodeEnemyUpserts } from '../../src/network/enemySnapshotCodec';
import { parseStinkCloudUtilityState } from '../../src/loadout/StinkCloudUtilityState';

describe('plague World replication', () => {
  it('bootstraps infections and use status, heals missed snapshots, and invalidates old World data', async () => {
    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'PLAGUE' });
    const connect = (room: TestRoom) => { use(room); const bridge=new NetworkBridge(); bridge.activate(); return bridge; };
    const host=connect(hostRoom);
    const world={ worldRevision:1, definitionId:'world:lobby', seed:1, generatorVersion:3, layoutFingerprint:'plague' };
    host.publishLobbySync(); host.publishWorldAndActivity(world,null); const client=connect(clientRoom);
    const { runtime }=plagueHarness(); const targets=[plagueTarget(),plagueTarget('e2',50)];
    const base: Parameters<NetworkBridge['publishGameState']>[0] = {
      roundStartTime:0,players:{},projectiles:null,enemies:null,rocks:null,
      placeableRocks:[],reinforcementMatrices:[],energyInjectorEffects:[],energyInjectorFocus:[],remoteControlTurrets:[],decoys:[],
      smokes:[],fires:[],powerups:null,pedestals:null,nukes:[],airstrikes:[],meteors:[],tunnels:[],train:null,bases:[],captureTheBeer:null,
      coopDefenseCarry:[],stinkClouds:[],timeBubbles:[],teslaDomes:[],energyShields:[],guardianSpirits:[],repairDrones:[],
      slimeTrail:{cells:[],affectedEnemies:[]},targetVulnerabilities:[],ak47StrategicTargets:[],burningGround:{cells:[]},
    };
    const publish=(now:number,full=false)=> {
      use(hostRoom); host.publishGameState({...base,stinkPlague:runtime.getSnapshot(now)},full); hostRoom.room.update(); use(clientRoom);
    };
    try {
      runtime.applyDirect(targets[0],plagueSource('p1',{pandemicEnabled:1}),0); runtime.spread(targets,0);
      publish(0,true);
      expect(client.getLatestGameState()!.stinkPlague).toEqual(runtime.getSnapshot(0));
      use(hostRoom); const active={ utilityId:'STINK_CLOUD' as const,phase:'active' as const,cloudId:2,activeUntil:4000,
        cooldownDurationMs:8000,moveSpeedBonus:.2,damageReduction:.2 };
      host.publishStinkCloudUtilityState('p1',active);
      const late=connect(await addClientRoom(network));
      expect(late.getLatestGameState()!.stinkPlague).toEqual(runtime.getSnapshot(0));
      expect(late.getPlayerStinkCloudUtilityState('p1')).toEqual(active);
      expect(late.getPlayerUtilityCooldownUntil('p1','STINK_CLOUD')).toBe(0);
      use(hostRoom); host.publishStinkCloudUtilityState('p1',{utilityId:'STINK_CLOUD',phase:'cooldown',cooldownDurationMs:8000,cooldownUntil:12000});
      expect(late.getPlayerUtilityCooldownUntil('p1','STINK_CLOUD')).toBe(12000);
      runtime.clear(); publish(100); publish(200); // No client read of the first empty state.
      expect(client.getLatestGameState()!.stinkPlague?.targets).toEqual([]);
      expect(client.getLatestGameState()!.stinkPlague?.transfers).toEqual([]);
      use(hostRoom); host.publishWorldAndActivity({...world,worldRevision:2},null); use(clientRoom);
      expect(client.getLatestGameState()).toBeUndefined(); expect(client.getPlayerStinkCloudUtilityState('p1')).toBeNull();
    } finally { clearActiveSession(); runtime.clear(); }
  });

  it('retains entity incarnation on the enemy wire and rejects malformed status records',()=>{
    const wire: (string|number)[]=[]; encodeEnemyUpsert(wire,{id:'e1',x:10,y:20,entityGeneration:45});
    expect(decodeEnemyUpserts(wire)).toEqual([{id:'e1',x:10,y:20,entityGeneration:45}]);
    const snapshot={targets:[{enemyId:'e1',entityGeneration:45,expiresAt:500,infectiousUntil:400}],transfers:[],transferSequence:0};
    expect(decodeStinkPlague(encodeStinkPlague(snapshot))).toEqual(snapshot);
    expect(decodeStinkPlague({q:0,t:[['e1',45,500,501]],e:[]}).targets).toEqual([]);
    expect(parseStinkCloudUtilityState({utilityId:'STINK_CLOUD',phase:'cooldown',cooldownDurationMs:8000,cooldownUntil:NaN})).toBeNull();
  });
});
