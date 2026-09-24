import { describe, expect, it, vi } from 'vitest';
import { WorldAttackDroneBinding, type WorldAttackDroneOptions } from '../src/world/WorldAttackDroneBinding';
import { ATTACK_DRONE_RULES as R } from '../src/config/attackDrone';
import { CELL_SIZE } from '../src/config';
import type { SyncedPlaceableRock } from '../src/types';
import type { ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';

function fixture(bombs = false) {
  const rocks: SyncedPlaceableRock[] = [{ id:1,kind:'drone_station',constructionId:'attack_drone_station',gridX:50,gridY:50,
    ownerId:'p',ownerColor:0xffaa55,hp:200,maxHp:200,expiresAt:0,warningStartsAt:0,angle:0 }];
  const position = (50.5)*CELL_SIZE, player = {x:position,y:position};
  const enemies = Array.from({length:bombs?4:1},(_,i) => ({id:`e${i}`,sprite:{x:position+80+i*45,y:position,active:true},
    getHp:()=>1000,isBurrowed:()=>false,getCollisionRadius:()=>20,isBoss:()=>false}));
  const ref = (id: string) => ({kind:'enemy',id,scope:{worldRevision:1,runtimeGeneration:1},instance:{entityGeneration:1}});
  const source = (id: string, authoredSourceId: string, origin = 'direct', provenance?: unknown) => ({
    actorId:id,authoredSourceId,origin,sourceSlot:'utility',allegiance:{ownerId:id,kind:'player'},lineage:{executionId:'test'}, provenance });
  let modifier = 1.25, remote = 1.4, alive = true, available = true;
  const spawn = vi.fn<(request: ProjectileSpawnRequest) => number>(()=>1), explode = vi.fn(), chunks = vi.fn(), fx = vi.fn();
  const options = {
    metrics:{offsetX:0,offsetY:0,maxX:5000,maxY:5000},
    players:{getPlayer:()=>player}, placement:{getAllRuntimeRocks:()=>rocks}, bases:null,
    enabled:()=>true,available:()=>available,mutation:()=>null,
    enemies:()=>({getHostileEnemies:()=>enemies,getCombatTargetRef:ref,getEnemy:(id:string)=>enemies.find(e=>e.id===id)}),
    projectiles:{spawnProjectile:spawn},
    injector:()=>({getEffect:()=>({effect:{type:'damage_turret',damageMultiplier:modifier}})}),
    remoteSources:()=>[], explosionFx:fx,
    playerCombat:{modifier:{getNumericStat:(key:string,stat:string)=>stat.endsWith('bombBay')&&bombs?1:stat.endsWith('fireChunks')&&bombs?3:0},
      item:{getRemoteControlDamageMultiplier:()=>remote},fireChunks:{hostCreateFireChunkBurst:chunks}},
    combat:{isAlive:()=>alive,runHostExecution:(fn:()=>void)=>fn(),captureWorldDamageSource:source,
      resolveCombatRelationship:()=>({canDamage:true}),captureProjectileProvenance:(p:unknown)=>p,
      getPlayerRuntimeDamageMultiplier:()=>2,applyExplosionDamage:explode},
  } as unknown as WorldAttackDroneOptions;
  const binding = new WorldAttackDroneBinding(options);
  return {binding,rocks,enemies,player,spawn,explode,chunks,fx,setBuff:(n:number)=>{modifier=n;remote=n;},setAlive:(n:boolean)=>alive=n,setAvailable:(n:boolean)=>available=n};
}
describe('world attack drone combat ownership', () => {
  it('captures station buffs once and keeps fractional bullet damage and full correlation', () => {
    const f=fixture();f.binding.advance(0,0);
    expect(f.spawn).toHaveBeenCalledOnce();
    expect(f.spawn.mock.calls[0][0]).toMatchObject({flight:{collisionFilter:{airborne:true},size:R.projectileWidth},
      interaction:{directHit:{damage:R.damage*1.25*1.4*2,adrenalinGain:0,rockDamageMult:0,trainDamageMult:0}},
      provenance:{attributionId:'p',sourceTurretId:'1',sourceSlot:'utility',correlation:{executionId:expect.any(String)}}});
    f.setAlive(false);f.binding.advance(100,100);expect(f.spawn.mock.calls.length).toBeGreaterThan(1);
  });
  it('retains dropped bombs and captured children after station destruction, but clears on teardown', () => {
    const f=fixture(true);let now=0;f.binding.advance(now,0);
    while(!f.binding.getBombSnapshot().length && now<4000) {now+=25;f.binding.advance(now,25);}
    const bomb=f.binding.getBombSnapshot()[0];expect(bomb).toBeDefined();
    f.setBuff(99);f.rocks.length=0;f.binding.advance(now+R.bombFallMs,R.bombFallMs);
    expect(f.binding.system.getSnapshot()).toEqual([]); expect(f.explode).toHaveBeenCalledOnce();
    expect(f.explode.mock.calls[0][2]).toMatchObject({maxDamage:R.bombMaxDamage*1.25*1.4*2,baseDamageMult:1,
      selfDamageMult:0,excludeFriendlyPlayers:true,rockDamageMult:0,trainDamageMult:0});
    const burst=f.chunks.mock.calls[0][3];
    expect(burst.burnDamagePerTick).toBeCloseTo(R.burnDamagePerTick*1.25*1.4*2);
    expect(burst).toMatchObject({count:3,baseDamageMult:0,
      landingExplosion:{maxDamage:R.chunkMaxDamage*1.25*1.4*2,audioSourceId:'ATTACK_DRONE_CHUNK'}});
    expect(burst).not.toHaveProperty('rocketSupport');
    expect(f.chunks.mock.calls[0][6]).toMatchObject({authoredSourceId:'ground_fire.attack_drone',sourceSlot:'utility'});
    f.binding.destroy();expect(f.binding.getBombSnapshot()).toEqual([]);
  });
  it('cancels pending impacts during combat teardown and preserves station identity across activity reset', () => {
    const f=fixture(true);let now=0;f.binding.advance(0,0);const id=f.binding.system.getSnapshot()[0].id;
    while(!f.binding.getBombSnapshot().length && now<4000) {now+=25;f.binding.advance(now,25);}
    f.binding.clearActivity();f.enemies.length=0;f.binding.advance(now+1000,1000);
    expect(f.explode).not.toHaveBeenCalled();expect(f.binding.system.getSnapshot()[0].id).toBe(id);
  });
});
