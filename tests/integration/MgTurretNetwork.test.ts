import { describe, expect, it } from 'vitest';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';
import { mgHarness, mgOwner, mgTarget } from '../MgTurretTestHelper';
import { encodeMgAttrition, decodeMgAttrition } from '../../src/network/mgAttritionCodec';

describe('MG World replication',()=>{
  it('bootstraps state, refreshes missed changes and explicitly clears the projection',async()=>{
    const network=new FakeNetwork(),hostRoom=await createHostRoom(network),clientRoom=await addClientRoom(network);
    const use=(room:TestRoom)=>setActiveSession({room:room.room,transport:room.transport,roomCode:'MG'});
    const connect=(room:TestRoom)=>{use(room);const bridge=new NetworkBridge();bridge.activate();return bridge;};
    const host=connect(hostRoom),world={worldRevision:1,definitionId:'world:lobby',seed:1,generatorVersion:3,layoutFingerprint:'mg'};
    host.publishLobbySync();host.publishWorldAndActivity(world,null);const client=connect(clientRoom);
    const h=mgHarness([mgOwner('p1',{network:true,bleedLevel:1,transferFraction:.6})]);
    const base:Parameters<NetworkBridge['publishGameState']>[0]={roundStartTime:0,players:{},projectiles:null,enemies:null,rocks:null,
      placeableRocks:[],reinforcementMatrices:[],energyInjectorEffects:[],energyInjectorFocus:[],remoteControlTurrets:[],decoys:[],
      smokes:[],fires:[],powerups:null,pedestals:null,nukes:[],airstrikes:[],meteors:[],tunnels:[],train:null,bases:[],captureTheBeer:null,
      coopDefenseCarry:[],stinkClouds:[],timeBubbles:[],teslaDomes:[],energyShields:[],guardianSpirits:[],repairDrones:[],
      slimeTrail:{cells:[],affectedEnemies:[]},targetVulnerabilities:[],ak47StrategicTargets:[],burningGround:{cells:[]}};
    const publish=(now:number,full=false)=>{use(hostRoom);host.publishGameState({...base,mgAttrition:h.runtime.snapshot(now)},full);hostRoom.room.update();use(clientRoom);};
    try {
      h.runtime.hit('p1','t1',h.target,0);publish(0,true);
      expect(client.getLatestGameState()!.mgAttrition).toEqual(h.runtime.snapshot(0));
      const late=connect(await addClientRoom(network));expect(late.getLatestGameState()!.mgAttrition).toEqual(h.runtime.snapshot(0));
      const recipient=mgTarget('next',50);h.setTargets([recipient]);h.runtime.death(h.target,100);
      publish(100);publish(101);
      expect(client.getLatestGameState()!.mgAttrition).toEqual(h.runtime.snapshot(101));
      h.runtime.clear();publish(200);publish(201);
      expect(client.getLatestGameState()!.mgAttrition?.targets).toEqual([]);
      expect(client.getLatestGameState()!.mgAttrition?.transfers).toEqual([]);
      use(hostRoom);host.publishWorldAndActivity({...world,worldRevision:2},null);use(clientRoom);
      expect(client.getLatestGameState()).toBeUndefined();
    }finally{clearActiveSession();h.runtime.clear();}
  });
  it('round-trips complete target instances and rejects malformed records',()=>{
    const target={...mgTarget('same',0,'enemy',19).ref,instance:{entityGeneration:19,activityRevision:4,lifeRevision:7}};
    const snapshot={targets:[{target,expiresAt:4000,bleedUntil:3900}],transfers:[],transferSequence:0};
    expect(decodeMgAttrition(encodeMgAttrition(snapshot))).toEqual(snapshot);
    expect(decodeMgAttrition({q:0,t:[['enemy','same',1,1,1,null,null,4000,4001]],e:[]}).targets).toEqual([]);
    expect(decodeMgAttrition({q:1,t:[],e:[[2,0,0,0,0,0],[1,0,NaN,0,0,0]]}).transfers).toEqual([]);
  });
});
