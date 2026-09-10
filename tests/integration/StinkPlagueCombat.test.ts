import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  class Line { constructor(public x1=0,public y1=0,public x2=0,public y2=0) {}
    setTo(x1:number,y1:number,x2:number,y2:number) { Object.assign(this,{x1,y1,x2,y2}); return this; } }
  return { ...phaser, Utils: { Array: { Shuffle: <T>(values:T[])=>values } }, Math: { ...phaser.Math, Distance: { ...phaser.Math.Distance, Squared: (a:number,b:number,c:number,d:number)=>(a-c)**2+(b-d)**2 } }, Geom: { ...phaser.Geom, Line } };
});
import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { WorldStinkPlagueBinding } from '../../src/world/WorldStinkPlagueBinding';
import { EnemyManager } from '../../src/entities/EnemyManager';
import { TargetStatusSystem, VULNERABILITY_INCOMING_DAMAGE_BONUS } from '../../src/systems/TargetStatusSystem';
import { SlimeTrailSystem } from '../../src/systems/SlimeTrailSystem';
import { getSlimeTrailBaseline } from '../../src/loadout/SlimeTrailConfig';
import { COOP_DEFENSE_ENEMY_KINDS, resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';
import { plagueSource } from '../StinkPlagueTestHelper';

function fixture(boss = false) {
  let now=0, present=true;
  const scene=healthBarTestScene().scene, kind=COOP_DEFENSE_ENEMY_KINDS[0];
  const configs=resolveCoopDefenseEnemyConfigs(1);
  configs[kind]={ ...configs[kind], isBoss: boss, glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
  const enemies=new EnemyManager(scene,configs);
  const player=fakeEntity({ id:'p1',x:150,y:100,color:0xffffff });
  Object.assign(player,{body:{enable:true}});
  const players={ getPlayer: (id:string)=> id==='p1' && present ? player : undefined, getAllPlayers:()=> present ? [player] : [] };
  const combat=new WorldCombatCore(players as never, { isHost:()=>true, getPlayerProfile:players.getPlayer,
    areTeammates:()=>false, getLocalPlayerId:()=> 'p1', isEnemyPair:()=>true, broadcastEffect() {} } as never);
  combat.bindPlayerVitalsScope({worldRevision:7300,runtimeGeneration:1}); combat.bindHostExecutionSources({nowMs:()=>now,random:()=>.25});
  combat.initPlayer('p1'); combat.setEnemyManager(enemies); combat.applyDamage('p1',50,true);
  const status=new TargetStatusSystem();
  combat.setTargetIncomingDamageMultiplierResolver((target,time)=>status.getIncomingDamageMultiplier(target,time));
  const baseline=getSlimeTrailBaseline();
  const slimeProfiles = new Map<string, Record<string, number>>();
  const slime=new SlimeTrailSystem(players as never,enemies,combat,(id,stat,base)=>slimeProfiles.get(id)?.[stat.split('.').at(-1)!] ?? base,()=>false);
  slime.setValidCellChecker((x,y,size)=>x-size/2>=0 && y-size/2>=0 && x+size/2<=1000 && y+size/2<=1000);
  const burst=vi.fn();
  const binding=new WorldStinkPlagueBinding({ combat,getEnemies:()=>enemies,getNavigation:()=>({hasWalkableCircleLine:()=>true}) as never,
    status,slimeTrail:slime,isPlayerPresent:()=>present,areAllies:()=>true,deathBurst:(id,x,y,time,p)=>slime.handleEnemyDeath(id,x,y,time,p),publishBurst:burst });
  combat.setEnemyDeathCallback((id,x,y)=> { const result=slime.handleEnemyDeath(id,x,y,now); if(result)burst(result); });
  const spawn=(x=300,y=100)=> {
    const enemy=enemies.hostSpawnAtWorld(x,y,kind);
    (enemy.sprite.body as any).halfWidth=enemy.getStatusVisualTarget().bodySize/2;
    return enemy;
  };
  const infect=(enemy:ReturnType<typeof spawn>,source=plagueSource('p1',{lifeLeechFraction:.3,deathChunkCount:3}))=> {
    binding.advance(now);
    binding.applyPrimaryContact({cloudId:1,kind:'player-primary',plague:source,tickAt:now,x:enemy.sprite.x,y:enemy.sprite.y,radius:5,
      ownerId:'p1',damage:3,rockDamageMult:0,trainDamageMult:0,baseDamageMult:1,visualVariant:'stink'},now);
  };
  return {combat,enemies,binding,status,slime,burst,baseline,spawn,infect,slimeProfiles,setNow:(t:number)=>{now=t;},detach:()=>{present=false;},
    destroy:()=>{binding.destroy();slime.clear();enemies.destroy();}};
}

describe('plague confirmed combat and slime integration',()=> {
  it('redirects normal movement while retaining attack phases and higher-priority controls',()=> {
    const f=fixture(); try {
      const carrier=f.spawn(300,300); f.spawn(450,300);
      const source=plagueSource('p1',{pandemicEnabled:1});
      f.infect(carrier,source);
      f.binding.spread(0);
      const flow={hasGoalCells:()=>true,worldToGrid:()=>null};
      const move=(locked=false,special:any=null,smoke:any=null,decoy:any=null)=>f.enemies.hostUpdateMovement(flow as never,null,null,null,
        locked,100,1000,null,null,null,null,null,special,smoke,decoy);
      carrier.pauseAttackMovement(0,.5,500);move();
      expect(carrier.getDesiredVelocity().vx).toBeGreaterThan(0);
      expect(carrier.getDesiredVelocity().vx/carrier.getMoveSpeed()).toBeCloseTo(.5*(1+source.config.pursuitMoveSpeedBonus),2);
      expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(true);
      expect(carrier.isAttackMovementPaused(100)).toBe(true);
      move(true);expect(carrier.getDesiredVelocity()).toEqual({vx:0,vy:0});
      expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(false);
      move(false,{getMovementOverride:()=>({vx:0,vy:17})});expect(carrier.getDesiredVelocity()).toEqual({vx:0,vy:17});
      expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(false);
      move(false,null,{getConfusion:()=>({fraction:.5})});expect(carrier.getDesiredVelocity()).toEqual({vx:0,vy:0});
      expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(false);
      move(false,null,null,{getTarget:()=>({x:300,y:450}),getMovementField:()=>flow});expect(carrier.getDesiredVelocity()).toEqual({vx:0,vy:0});
      expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(false);
      carrier.pauseAttackMovement(100,0,500);move();expect(carrier.getDesiredVelocity()).toEqual({vx:0,vy:0});
      expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(false);
      f.binding.clearTargets();expect(f.binding.runtime.getSnapshot(100).targets).toEqual([]);
    } finally {f.destroy();}
  });

  it('never redirects a boss even with a nearby healthy target',()=> {
    const f=fixture(true);try {
      const carrier=f.spawn(300,300);f.spawn(450,300);f.infect(carrier,plagueSource('p1',{pandemicEnabled:1}));f.binding.spread(0);
      const positioning={getMovementOverride:()=>({vx:0,vy:11})};
      f.enemies.hostUpdateMovement({hasGoalCells:()=>true} as never,null,null,null,false,100,1000,null,null,null,null,positioning);
      expect(carrier.getDesiredVelocity()).toEqual({vx:0,vy:11});
      expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(false);
      expect(f.slime.hostUpdate(100).cells).not.toHaveLength(0);
      expect(f.slime.getEnemyMovementFactor(carrier.id,100)).toBeCloseTo(1-f.baseline.slowFraction);
    } finally {f.destroy();}
  });

  it('grants speed and clears slime damage/slow only while pursuing a healthy target',()=> {
    const f=fixture();try {
      const source=plagueSource('p1',{pandemicEnabled:1});
      const carrier=f.spawn(100,300), target=f.spawn(100+source.config.searchRadius*.75,300);
      f.infect(carrier,source);f.binding.spread(0);
      // Before movement starts, the carrier can be affected by its own trail.
      f.slime.hostUpdate(0);
      expect(f.slime.getEnemyMovementFactor(carrier.id,0)).toBeCloseTo(1-f.baseline.slowFraction);
      const flow={hasGoalCells:()=>true,worldToGrid:()=>null};
      f.enemies.hostUpdateMovement(flow as never,null,null,null,false,100,1000);
      expect(carrier.getDesiredVelocity().vx/carrier.getMoveSpeed()).toBeCloseTo(1+source.config.pursuitMoveSpeedBonus,2);
      expect(f.slime.getEnemyMovementFactor(carrier.id,100)).toBe(1);
      const hp=carrier.getHp(), tick=f.baseline.tickIntervalMs;
      f.setNow(tick);
      expect(f.slime.hostUpdate(tick).affectedEnemies.some(e=>e.enemyId===carrier.id)).toBe(false);
      expect(carrier.getHp()).toBe(hp);

      // A healthy goal becoming infected ends immunity immediately, before another AI step.
      f.infect(target,source);
      expect(f.enemies.isPursuingPlagueTarget(carrier.id,tick)).toBe(false);
      expect(f.slime.hostUpdate(tick).affectedEnemies.some(e=>e.enemyId===carrier.id)).toBe(true);
      expect(f.slime.getEnemyMovementFactor(carrier.id,tick)).toBeCloseTo(1-f.baseline.slowFraction);
      const before=carrier.getHp();f.setNow(tick*2);f.slime.hostUpdate(tick*2);
      expect(before-carrier.getHp()).toBeCloseTo(f.baseline.damagePerTick);
    }finally{f.destroy();}
  });

  it('releases pursuit on target death, dash, movement lock and world cleanup',()=> {
    const f=fixture();try {
      const carrier=f.spawn(300,300), target=f.spawn(700,300);
      f.infect(carrier,plagueSource('p1',{pandemicEnabled:1}));f.binding.spread(0);
      const flow={hasGoalCells:()=>true,worldToGrid:()=>null};
      const move=(locked=false)=>f.enemies.hostUpdateMovement(flow as never,null,null,null,locked,100,1000);
      move();expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(true);
      carrier.setDashPhase(1);expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(false);
      carrier.setDashPhase(0);move(true);expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(false);
      f.slime.hostUpdate(100);expect(f.slime.getEnemyMovementFactor(carrier.id,100)).toBeLessThan(1);
      move();expect(f.slime.getEnemyMovementFactor(carrier.id,100)).toBe(1);
      f.enemies.hostRemoveEnemy(target.id);
      expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(false);
      f.spawn(700,300);f.binding.spread(100);move();
      expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(true);
      f.binding.clearTargets();expect(f.enemies.isPursuingPlagueTarget(carrier.id,100)).toBe(false);
      f.slime.clear();expect(f.slime.hostUpdate(100).cells).toEqual([]);
    }finally{f.destroy();}
  });

  it('paints valid continuous trails only for Pandemic, without bridging teleports or expired infections',()=> {
    const f=fixture();try {
      const size=f.baseline.cellSize, x=size*2.5, y=size*2.5, carrier=f.spawn(x,y);
      carrier.setHp(1000,1000,true);
      f.infect(carrier);expect(f.slime.hostUpdate(0).cells).toEqual([]);
      const source=plagueSource('p1',{pandemicEnabled:1});
      f.infect(carrier,source);
      expect(f.slime.hostUpdate(0).cells).toHaveLength(1);
      // Simulated physics movement keeps positionRevision; explicit setPosition denotes a teleport.
      carrier.sprite.x+=size*3;
      f.slime.setValidCellChecker((cx,cy)=>cy===y && cx!==x+size);
      const trail=f.slime.hostUpdate(1).cells;
      expect(trail.map(cell=>cell.x).sort((a,b)=>a-b)).toEqual([x,x+size*2,x+size*3]);
      carrier.setPosition(x+size*8,y);
      expect(f.slime.hostUpdate(2).cells).toHaveLength(trail.length+1);
      f.slime.hostUpdate(source.config.directDurationMs);
      carrier.sprite.x=x+size*14;
      f.setNow(source.config.directDurationMs+1);f.infect(carrier,source);
      const resumed=f.slime.hostUpdate(source.config.directDurationMs+1).cells;
      expect(resumed.some(cell=>cell.x>x+size*8&&cell.x<x+size*14)).toBe(false);
      expect(resumed.some(cell=>cell.x===carrier.sprite.x)).toBe(true);
      f.detach();f.binding.advance(source.config.directDurationMs+2);
      f.slime.clear();expect(f.slime.hostUpdate(source.config.directDurationMs+2).cells).toEqual([]);
    }finally{f.destroy();}
  });

  it('uses purchased slime values for Pandemic trails and only chains deaths with Slime Bloom',()=> {
    const f=fixture();try {
      const profile={...f.baseline,enabled:1,damagePerTick:f.baseline.damagePerTick*2,slowFraction:.7,deathBurstPatchCount:2};
      f.slimeProfiles.set('p1',profile);
      const carrier=f.spawn();f.infect(carrier,plagueSource('p1',{pandemicEnabled:1}));
      const snapshot=f.slime.hostUpdate(0);
      const victim=f.spawn(snapshot.cells[0].x,snapshot.cells[0].y);
      f.slime.hostUpdate(0);
      expect(f.slime.getEnemyMovementFactor(victim.id,0)).toBeCloseTo(1-profile.slowFraction);
      const hp=victim.getHp();f.setNow(profile.tickIntervalMs);f.slime.hostUpdate(profile.tickIntervalMs);
      expect(hp-victim.getHp()).toBeCloseTo(profile.damagePerTick);
      f.combat.applyDamage(victim.id,victim.getHp()*100,false,'p1');
      expect(f.burst).toHaveBeenCalledOnce();expect(f.burst.mock.calls[0][0].targets).toHaveLength(profile.deathBurstPatchCount);
      expect(f.binding.runtime.getSnapshot(profile.tickIntervalMs).targets.map(t=>t.enemyId)).toEqual([carrier.id]);
    }finally{f.destroy();}
  });

  it('adds slime bloom and plague bursts once, preserving source profiles and valid cells',()=> {
    const f=fixture(); try {
      const profile={ ...f.baseline, enabled:1, deathBurstPatchCount:2, damagePerTick:7 };
      f.slimeProfiles.set('p2',profile);
      const seed=f.slime.handleEnemyDeath('seed',300,300,0,{ownerId:'p2',count:1})!;
      const victim=f.spawn(seed.targets[0].x,seed.targets[0].y);
      f.slime.hostUpdate(0); f.infect(victim);
      f.combat.applyDamage(victim.id,victim.getHp()*100,false,'p1');
      expect(f.burst).toHaveBeenCalledOnce();
      const targets=f.burst.mock.calls[0][0].targets;
      expect(targets).toHaveLength(2+3);
      expect(new Set(targets.map((t:any)=>t.x+':'+t.y)).size).toBe(targets.length);
      expect(targets.every((t:any)=>t.x>=f.baseline.cellSize/2&&t.y>=f.baseline.cellSize/2)).toBe(true);
      const chain=f.spawn(targets[0].x,targets[0].y);
      f.slime.hostUpdate(1); f.combat.applyDamage(chain.id,chain.getHp()*100,false,'p1');
      expect(f.burst).toHaveBeenCalledTimes(2);
      expect(f.burst.mock.calls[1][0].targets).toHaveLength(profile.deathBurstPatchCount);
      expect(f.binding.runtime.getSnapshot(1).targets).toEqual([]);
    } finally {f.destroy();}
  });

  it('never heals a dead caster from surviving infections',()=> {
    const f=fixture(); try {
      const enemy=f.spawn(); f.infect(enemy);
      f.combat.applyDamage('p1',f.combat.getMaxHp('p1')*100,true);
      expect(f.combat.isAlive('p1')).toBe(false);
      f.setNow(500); f.binding.advance(500);
      expect(f.combat.isAlive('p1')).toBe(false);expect(f.combat.getHP('p1')).toBe(0);
    } finally { f.destroy(); }
  });

  it('secures leech and one BR burst before a lethal first primary hit, without overkill healing',()=>{
    const f=fixture(); try {
      const enemy=f.spawn(); const hp=enemy.getHp(), before=f.combat.getHP('p1');
      f.combat.setPlayerLifeLeechFractionResolver(()=>.1); f.infect(enemy);
      f.combat.applyDamage(enemy.id,hp*100,false,'p1','weapon.stink_cloud');
      expect(f.combat.getHP('p1')-before).toBeCloseTo(Math.min(f.combat.getMaxHp('p1')-before,hp*.4));
      expect(f.burst).toHaveBeenCalledOnce(); expect(f.burst.mock.calls[0][0].targets).toHaveLength(3);
      expect(f.binding.runtime.getSnapshot(0).targets).toEqual([]);
      const cell=f.slime.hostUpdate(0).cells[0], next=f.spawn(cell.x,cell.y);
      f.slime.hostUpdate(1); expect(f.slime.getEnemyMovementFactor(next.id,1)).toBeCloseTo(1-f.baseline.slowFraction);
      const nextHp=next.getHp(); f.setNow(1+f.baseline.tickIntervalMs); f.slime.hostUpdate(1+f.baseline.tickIntervalMs);
      expect(nextHp-next.getHp()).toBeCloseTo(f.baseline.damagePerTick);
      f.combat.applyDamage(next.id,next.getHp()*100,false,'p1');
      expect(f.burst).toHaveBeenCalledOnce(); // Baseline BR slime has no bloom chain.
    } finally { f.destroy(); }
  });

  it('applies captured DoT modifiers once and preserves fractional and terminal-tick healing',()=>{
    const f=fixture(); try {
      const enemy=f.spawn(); const source=plagueSource('p1',{damagePerTick:.2,lifeLeechFraction:.3,vulnerabilityEnabled:1,directDurationMs:500},2);
      f.infect(enemy,source); const outgoing=vi.fn((_id,_target,amount:number)=>({amount:amount*20,isCritical:false}));
      f.combat.setPlayerOutgoingDamageResolver(outgoing);
      const hp=enemy.getHp(), before=f.combat.getHP('p1'); f.setNow(500); f.binding.advance(500);
      const expected=.2*2*(1+VULNERABILITY_INCOMING_DAMAGE_BONUS);
      expect(hp-enemy.getHp()).toBeCloseTo(expected);
      expect(f.combat.getHP('p1')-before).toBeCloseTo(expected*.3);
      expect(outgoing).not.toHaveBeenCalled(); expect(f.binding.runtime.getSnapshot(500).targets).toEqual([]);
    } finally { f.destroy(); }
  });

  it('keeps unrelated vulnerability, blocks uncredited healing and removes detached contributions',()=>{
    const f=fixture(); try {
      const enemy=f.spawn(); f.status.setVulnerabilityContribution('other',{targetType:'enemy',targetId:enemy.id},10000);
      f.infect(enemy,plagueSource('p1',{vulnerabilityEnabled:1,lifeLeechFraction:.3,directDurationMs:500}));
      const before=f.combat.getHP('p1'); f.combat.applyDamage(enemy.id,1,false,undefined,'environment');
      expect(f.combat.getHP('p1')).toBe(before);
      f.detach(); f.setNow(500); f.binding.advance(500);
      expect(f.binding.runtime.getSnapshot(500).targets).toEqual([]);
      expect(f.status.getIncomingDamageMultiplier({targetType:'enemy',targetId:enemy.id},500)).toBe(1+VULNERABILITY_INCOMING_DAMAGE_BONUS);
      f.binding.destroy(); f.combat.applyDamage(enemy.id,1,false,'p1'); expect(f.combat.getHP('p1')).toBe(before);
    } finally { f.destroy(); }
  });
});
