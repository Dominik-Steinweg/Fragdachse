import { describe, expect, it, vi } from 'vitest';
const random=vi.hoisted(()=>({seed:1}));
vi.mock('phaser', () => ({ Geom: {Line:class {},Rectangle:class {
  constructor(public x=0,public y=0,public width=0,public height=0){}
  get centerX(){return this.x+this.width/2;}get centerY(){return this.y+this.height/2;}
  get left(){return this.x;}get right(){return this.x+this.width;}get top(){return this.y;}get bottom(){return this.y+this.height;}
},Circle:class {}}, Math: { Clamp:(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n)),Angle: { Between: (x:number,y:number,a:number,b:number)=>Math.atan2(b-y,a-x) },
  Distance: { Between: (x:number,y:number,a:number,b:number)=>Math.hypot(a-x,b-y) } },
  Utils: { Array: { Shuffle: (a:unknown[])=>{
    for(let i=a.length-1;i>0;i--){random.seed=(Math.imul(random.seed,1664525)+1013904223)>>>0;
      const j=Math.floor(random.seed/4294967296*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;
  } } } }));
import { WorldAttackDroneBinding, type WorldAttackDroneOptions } from '../../src/world/WorldAttackDroneBinding';
import { createProjectileRuntimeTestWorld } from '../ProjectileRuntimeTestHelper';
import { FlamethrowerUpgradeSystem } from '../../src/systems/FlamethrowerUpgradeSystem';
import { FireSystem } from '../../src/effects/FireSystem';
import { BurnStateMachine } from '../../src/combat/rules/BurnStateMachine';
import { computeProjectileExplosionDamage } from '../../src/utils/radialDamage';
import { CELL_SIZE, applyArenaWorldMetrics, getAuthoredWorldMetricsProfile } from '../../src/config';
import { AutomatedWeaponExecutionAdapter } from '../../src/world/AutomatedWeaponExecutionAdapter';
import { TurretSystem, type AutomatedTurret } from '../../src/systems/TurretSystem';
import { WeaponFireExecutor } from '../../src/loadout/WeaponFireExecutor';
import { WEAPON_CONFIGS, type PlaceableTurretUtilityConfig } from '../../src/loadout/LoadoutConfig';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../../src/config/coopDefenseConstructions';
import { resolveMgTurretStats } from '../../src/config/mgTurret';
import { MgAttritionRuntime } from '../../src/systems/MgAttritionRuntime';
import { getCoopDefenseResolvedEffectTotals } from '../../src/utils/coopDefenseUpgrades';
import type { ProjectileExplosionConfig, SyncedPlaceableRock } from '../../src/types';

interface Scenario {
  name:string; count?:number; radius?:number; distance?:number; stationDistance?:number; moving?:boolean;
  formation?:'dense'|'spread'|'line'; levels?:Record<string,number>; reference?:'rocket_turret'|'machine_gun_turret';
  mgUpgrades?:Record<string,number>;
}
/** Production flight, projectiles, turrets, chunks, ground and burn rules; only physics and neutral recipients are headless. */
function measure(s:Scenario) {
  random.seed=1;
  applyArenaWorldMetrics(getAuthoredWorldMetricsProfile(200,100));
  const p={x:4016,y:2000}, duration=60_000, dt=25;
  const {runtime,physics,setHostNowMs}=createProjectileRuntimeTestWorld();
  const result={name:s.name,gun:0,bombs:0,landings:0,burn:0,bleed:0,shots:0,gunHits:0,travelMs:0,serviceMs:0,cycles:0,total:0,dps:0};
  const enemies=Array.from({length:s.count??1},(_,i)=>({id:`e${i}`,
    sprite:{x:p.x+(s.distance??200)+(s.formation==='line'?i*35:(i%4)*(s.formation==='spread'?95:28)),
      y:p.y+Math.floor(i/4)*28,active:true},
    getHp:()=>1e9,isBurrowed:()=>false,isBoss:()=>false,getCollisionRadius:()=>s.radius??12}));
  const initial=enemies.map(e=>({...e.sprite}));
  const ref=(id:string)=>({kind:'enemy',id,scope:{worldRevision:1,runtimeGeneration:1},instance:{entityGeneration:1}} as const);
  const mgTotals=getCoopDefenseResolvedEffectTotals({upgrades:Object.fromEntries(Object.entries(s.mgUpgrades??{})
    .map(([id,level])=>[id,{unlocked:true,level}]))},'inspector_gadachs');
  const mg=resolveMgTurretStats(stat=>mgTotals.additive[stat]??0,stat=>mgTotals.percentage[stat]??0);
  const attrition=new MgAttritionRuntime({targets:()=>enemies.map(e=>({ref:ref(e.id),...e.sprite})),canAffect:()=>true,
    transferContact:()=>null,bleed:(_target,amount)=>{result.bleed+=amount;}});
  attrition.setOwners([{id:'p',group:'team',stats:mg}],0);
  let hostNow=0;
  const damage=(x:number,y:number,effect:ProjectileExplosionConfig,channel:'bombs'|'landings')=>{
    for(const e of enemies) {
      const center=Math.hypot(e.sprite.x-x,e.sprite.y-y);
      const distance=effect.useTargetSurfaceDistance?Math.max(0,center-e.getCollisionRadius()):center;
      if(distance<=effect.radius) result[channel]+=computeProjectileExplosionDamage(distance,effect);
    }
  };
  runtime.setProjectileTargetabilityPort({canDamage:()=>true,canDamageOwner:()=>true,isTargetCurrentlyValid:()=>true});
  runtime.setProjectileCollisionTargetQueryPort({readCollisionTargets:sink=>{
    for(const e of enemies){const {x,y}=e.sprite,r=e.getCollisionRadius();sink('enemy',e.id,'hostile',x,y,r,x-r,y-r,x+r,y+r);}
  }});
  runtime.setProjectileCombatPort({resolveDirectImpact:request=>{
    const target=ref(String(request.target.id)), turret=String(request.provenance.sourceTurretId);
    const isMg=s.reference==='machine_gun_turret';
    result.gun+=request.directHit.damage*(isMg?1+attrition.getPercent('p',turret,target,hostNow)/100:1);
    if(isMg){const e=enemies.find(e=>e.id===target.id)!;attrition.hit('p',turret,{ref:target,...e.sprite},hostNow);}
    result.gunHits++;return {accepted:true};
  },resolveExplosionCombat:request=>{damage(request.x,request.y,request.effect,'bombs');return {damagedTargetKeys:[]};}});
  const fire=new FireSystem({} as never), burn=new BurnStateMachine();
  fire.setGroundResolvers(()=>false,()=>true);
  const chunks=new FlamethrowerUpgradeSystem({getAllPlayers:()=>[]} as never,
    {getAllEnemies:()=>enemies} as never,{getTravelSamples:()=>[]},{} as never,
    {isAlive:()=>true} as never,{} as never,fire,()=>false,()=>false,()=>{},(_id,_stat,value)=>value,()=>{},
    {hasLineOfSight:()=>true,canTarget:()=>true,explode:landing=>damage(landing.x,landing.y,landing.effect,'landings')});
  const station:SyncedPlaceableRock={id:1,kind:'drone_station',constructionId:'attack_drone_station',ownerId:'p',ownerColor:1,
    gridX:(p.x-(s.stationDistance??0))/CELL_SIZE-.5,gridY:p.y/CELL_SIZE-.5,hp:200,maxHp:200,angle:0,expiresAt:0,warningStartsAt:0};
  const drone=new WorldAttackDroneBinding({metrics:{offsetX:0,offsetY:0,maxX:6400,maxY:3200},players:{getPlayer:()=>p},
    placement:{getAllRuntimeRocks:()=>[station]},bases:null,enabled:()=>true,available:()=>true,mutation:()=>null,
    enemies:()=>({getHostileEnemies:()=>enemies,getCombatTargetRef:ref,getEnemy:(id:string)=>enemies.find(e=>e.id===id)}),
    projectiles:{spawnProjectile:request=>{result.shots++;return runtime.spawnProjectile(request);}},injector:()=>null,remoteSources:()=>[],explosionFx:()=>{},
    playerCombat:{modifier:{getNumericStat:(_id:string,stat:string)=>s.levels?.[stat.split('.').at(-1)!]??0},item:{getRemoteControlDamageMultiplier:()=>1},fireChunks:chunks},
    combat:{isAlive:()=>true,runHostExecution:(fn:()=>void)=>fn(),captureWorldDamageSource:(_id:string,sourceId:string)=>({authoredSourceId:sourceId}),
      captureProjectileProvenance:(value:unknown)=>value,resolveCombatRelationship:()=>({canDamage:true}),getPlayerRuntimeDamageMultiplier:()=>1,
      applyExplosionDamage:(x:number,y:number,effect:ProjectileExplosionConfig)=>damage(x,y,effect,'bombs')},
  } as unknown as WorldAttackDroneOptions);
  const turrets=new TurretSystem({getAllPlayers:()=>[]} as never,{isAlive:()=>true,canDamageTarget:()=>true} as never);
  const executor=new WeaponFireExecutor({spawnProjectile:request=>{result.shots++;return runtime.spawnProjectile(request);},resolveHitscan:()=>false,resolveMelee:()=>false});
  const automated=new AutomatedWeaponExecutionAdapter(executor,runtime);
  const config=COOP_DEFENSE_CONSTRUCTIONS[s.reference??'rocket_turret'];
  if(config.kind!=='turret')throw new Error('Expected turret');
  const poses:AutomatedTurret[]=Array.from({length:s.reference==='machine_gun_turret'?3:1},(_,i)=>({
    ...config,id:i+1,x:p.x,y:p.y+(i-1)*32,angle:0,ownerId:'p',ownerColor:1,targetMode:'enemies',
    ...(s.reference==='machine_gun_turret'?{damage:mg.damage,cooldownMs:mg.cooldownMs,targetRange:mg.targetRange,projectileRange:mg.projectileRange}:{})}));
  turrets.setTurretProvider(()=>poses,(id,angle)=>{const pose=poses.find(t=>t.id===id)!;Object.assign(pose,{angle});});
  turrets.setEnemyTargetProvider(()=>enemies.map(e=>({id:e.id,...e.sprite})));
  turrets.setFireHandler((ownerId,ownerColor,weaponId,x,y,angle,targetX,targetY,damageMultiplier=1,rangeFactor=1,sourceTurretId)=>{
    const weapon=WEAPON_CONFIGS[weaponId];automated.fire({...weapon,range:weapon.range*rangeFactor},{x,y,angle,targetX,targetY,ownerId,ownerColor,
      options:{sourceSlot:'utility',sourceTurretId:String(sourceTurretId),directDamageMultiplier:damageMultiplier,payloadDamageMultiplier:damageMultiplier}});
  });
  let previousPhase='';
  for(let now=0;now<duration;now+=dt){
    setHostNowMs(now);
    hostNow=now;attrition.advance(now);
    enemies.forEach((e,i)=>{e.sprite.y=initial[i].y+(s.moving?Math.sin(now/1000*2)*80:0);});
    if(s.reference)turrets.hostUpdate(now,{placeable:config} as PlaceableTurretUtilityConfig,WEAPON_CONFIGS[config.weaponId],dt);
    else{
      drone.advance(now,now===0?0:dt);
      const phase=drone.system.getDiagnostics()[0].phase;
      if(phase==='returning'||phase==='catchup')result.travelMs+=dt;
      if(phase==='servicing'){result.serviceMs+=dt;if(previousPhase!==phase)result.cycles++;}
      previousPhase=phase;
    }
    for(const [id,h]of physics.handles){
      if(!h.sprite.active){physics.handles.delete(id);continue;}
      h.sprite.x+=h.body.velocity.x*dt/1000;h.sprite.y+=h.body.velocity.y*dt/1000;
    }
    runtime.runHostInteractionStage(now);
    for(const explosion of runtime.runHostProjectileStage(dt,now).projectileExplosions)damage(explosion.x,explosion.y,explosion.effect,'bombs');
    chunks.hostUpdate(now);
    for(const contribution of burn.advanceTo(now))result.burn+=contribution.damage;
    if(fire.hostUpdate(now).damageTick)for(const e of enemies){
      for(const contact of fire.collectContacts(e.sprite.x,e.sprite.y,e.getCollisionRadius(),now)){
        if(contact.burn)burn.applyHit({targetId:e.id,attackerId:contact.ownerId,sourceKey:contact.sourceKey,sourceId:contact.sourceId,
          durationMs:contact.burn.durationMs,damagePerTick:contact.burn.damagePerTick,now});
      }
    }
  }
  result.total=result.gun+result.bombs+result.landings+result.burn+result.bleed;result.dps=result.total/(duration/1000);
  drone.destroy();chunks.clear();runtime.destroy();
  return Object.fromEntries(Object.entries(result).map(([key,value])=>[key,typeof value==='number'?Math.round(value*100)/100:value]));
}

const full={selfLoader:3,service:3,flight:3,penetration:3,bombBay:1,bombCount:3,fireChunks:3};
const scenarios:Scenario[]=[
  ...[400,800].map(stationDistance=>({name:`base-station-${stationDistance}`,stationDistance})),
  {name:'rocket-reference',reference:'rocket_turret'}, {name:'three-mg-reference',reference:'machine_gun_turret'},
  ...[12,32].flatMap(radius=>[200,400].flatMap(distance=>[false,true].map(moving=>({name:`single-r${radius}-d${distance}-${moving?'moving':'static'}`,radius,distance,moving})))),
  ...[2,4,8].flatMap(count=>(['dense','spread','line'] as const).map(formation=>({name:`full-${count}-${formation}`,count,formation,levels:full}))),
  ...[800,2400].flatMap(stationDistance=>[0,1,2,3].map(selfLoader=>({name:`supply-${stationDistance}-L1-${selfLoader}`,stationDistance,levels:{selfLoader}}))),
  ...[{}, {bombCount:3}, {fireChunks:3}, {bombCount:3,fireChunks:3}].map((levels,i)=>({name:`post-boss-${i}`,count:8,levels:{selfLoader:1,service:1,flight:1,penetration:1,bombBay:1,...levels}})),
  ...[{}, {mg_bleed:3}, {mg_handoff:3}, {mg_bleed:3,mg_handoff:3}].map((upgrades,i)=>({name:`three-mg-post-boss-${i}`,count:8,
    reference:'machine_gun_turret' as const,mgUpgrades:{unlock_machine_gun_turret:1,mg_attrition:1,mg_calibration:1,
      mg_optics:1,mg_fire_superiority:1,mg_fire_control_network:1,...upgrades}})),
];
describe('attack drone 60-second production-rule benchmark',()=>{
  it('repeats a complete bomb / landing / ground / burn run deterministically',()=>{
    const scenario=scenarios.find(s=>s.name==='full-8-dense')!;
    const a=measure(scenario);expect(measure(scenario)).toEqual(a);
    expect(a.bombs).toBeGreaterThan(0);expect(a.landings).toBeGreaterThan(0);expect(a.burn).toBeGreaterThan(0);
  });
  it('reports actual hit geometry, movement and complete service cycles without retuning',()=>{
    const rows=scenarios.map(measure);
    for(const row of rows)expect(Number.isFinite(row.dps)).toBe(true);
    console.info('ATTACK_DRONE_BENCHMARK '+JSON.stringify(rows));
  },60_000);
});
