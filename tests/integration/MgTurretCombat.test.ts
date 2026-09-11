import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url), root = require.resolve('phaser/package.json').replace(/package\.json$/, '');
  const Line = require(root + 'src/geom/line/Line.js');
  const Rectangle = require(root + 'src/geom/rectangle/Rectangle.js');
  const GetLineToRectangle = require(root + 'src/geom/intersects/GetLineToRectangle.js');
  return { ...phaser, Utils: { Array: { Shuffle: <T>(a:T[])=>a } }, Math: { ...phaser.Math,
    Distance: { ...phaser.Math.Distance, Squared: (a:number,b:number,c:number,d:number)=>(a-c)**2+(b-d)**2 } },
  Geom: { ...phaser.Geom, Rectangle, Intersects: { GetLineToRectangle },
    Line: Object.assign(Line, { Length: (l:{x1:number;y1:number;x2:number;y2:number})=>Math.hypot(l.x2-l.x1,l.y2-l.y1) }) } };
});
import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { WorldMgTurretBinding } from '../../src/world/WorldMgTurretBinding';
import { WorldObjectMutationRuntime } from '../../src/world/WorldObjectMutationRuntime';
import { EnemyManager } from '../../src/entities/EnemyManager';
import { BaseManager } from '../../src/entities/BaseManager';
import { TargetStatusSystem, VULNERABILITY_INCOMING_DAMAGE_BONUS } from '../../src/systems/TargetStatusSystem';
import { COOP_DEFENSE_ENEMY_KINDS, resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { resolveCoopDefenseWorldMetrics } from '../../src/world/WorldMetrics';
import { createSingleOwnerProvenance, type ProjectileProvenance } from '../../src/projectile/ProjectileSpawnRequest';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';
import { mgOwner } from '../MgTurretTestHelper';

function fixture(damageable = true) {
  let now = 0, owners = [mgOwner('p1', { network: true, perHitPercent: 3, bleedLevel: 3, transferFraction: .6 })];
  const scene = healthBarTestScene().scene, kind = COOP_DEFENSE_ENEMY_KINDS[0];
  const configs = resolveCoopDefenseEnemyConfigs(1);
  configs[kind] = { ...configs[kind], glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
  const enemies = new EnemyManager(scene, configs), player = fakeEntity({ id:'p1', x:150, y:100, color:0xffffff });
  Object.assign(player, { body: { enable:true } });
  const players = { getPlayer: (id:string)=>id==='p1'?player:undefined, getAllPlayers:()=>[player] };
  const effects = vi.fn();
  const combat = new WorldCombatCore(players as never, { isHost:()=>true, getPlayerProfile:players.getPlayer,
    areTeammates:()=>false, getLocalPlayerId:()=> 'p1', isEnemyPair:()=>true, broadcastEffect:effects } as never);
  combat.bindPlayerVitalsScope({ worldRevision:7300, runtimeGeneration:1 });
  combat.bindHostExecutionSources({ nowMs:()=>now, random:()=>.25 }); combat.initPlayer('p1'); combat.setEnemyManager(enemies);
  const status = new TargetStatusSystem();
  combat.setTargetIncomingDamageMultiplierResolver((target,time)=>status.getIncomingDamageMultiplier(target,time));
  const metrics = resolveCoopDefenseWorldMetrics(20,20);
  const bases = new BaseManager(scene, [{ id:'base', hpMax:1000, startHp:1000, faction:'hostile', role:'main',
    cells:[{gridX:1,gridY:1}], region:{minGridX:1,maxGridX:1,minGridY:1,maxGridY:1}, turrets:[],powerUpPedestals:[] }], metrics, {}, false, damageable);
  const base = bases.getBase('base')!;
  for (const cell of base.getCellBodies()) Object.assign(cell, { getBounds:()=>({ left:cell.x-cell.width/2,
    right:cell.x+cell.width/2, top:cell.y-cell.height/2, bottom:cell.y+cell.height/2 }) });
  combat.setBaseManager(bases);
  combat.setBaseObstacles(base.getCellBodies());
  const mutation = new WorldObjectMutationRuntime({ scope:combat.getCombatScope(), metrics, bases, train:null } as never);
  const binding = new WorldMgTurretBinding({ combat, getEnemies:()=>enemies, bases, getMutation:()=>mutation, owners:()=>owners });
  combat.setBaseDamageCallback((id,damage,attacker,slot,source) => {
    const target = mutation.resolveTarget('base',id)!;
    return mutation.applyResolvedDamage('base',id,damage*(source?binding.multiplier(source,target,now):1),attacker,
      source?.authoredSourceId??'test',source?.origin==='ground'?'ground':'direct',slot,source);
  });
  const spawn = (x=300,y=100)=> { const enemy=enemies.hostSpawnAtWorld(x,y,kind); enemy.setHp(1000,1000,true);
    (enemy.sprite.body as any).halfWidth=enemy.getStatusVisualTarget().bodySize/2; return enemy; };
  const source = (extra:Partial<ProjectileProvenance>={}) => ({ ...createSingleOwnerProvenance('p1', {
    weaponSourceId:'TURRET_MG',sourceSlot:'utility',sourceTurretId:'removed-turret', personalMgOwnerId:'p1',personalMgScope:combat.getCombatScope() }),...extra });
  let projectileId=0;
  const hit = (enemy:ReturnType<typeof spawn>, provenance=source(),damage=5) => combat.resolveDirectImpact({ projectileId:++projectileId,
    target:{kind:'enemy',id:enemy.id},impact:{x:enemy.sprite.x,y:enemy.sprite.y},velocity:{x:1,y:0},provenance,directHit:{damage},augments:[] });
  const baseHit = (damage=5)=>combat.applyProjectileBaseDamage('base',{ projectileId:++projectileId,ownerId:'p1',provenance:source(),
    x:base.getCellBodies()[0].x,y:base.getCellBodies()[0].y,velocityX:1,velocityY:0,color:0xffffff,sourceId:'TURRET_MG',sourceSlot:'utility',damage });
  binding.advance(0);
  return {combat,enemies,binding,status,spawn,hit,source,base,baseHit,mutation,effects,
    advance:(t:number)=>{now=t;binding.advance(t);}, setOwners:(next:typeof owners)=>{owners=next;},
    destroy:()=>{binding.destroy();mutation.destroy();enemies.destroy();bases.destroy();} };
}

describe('MG confirmed combat integration',()=>{
  it('scales the actual target once, then adds the confirmed hit even after the turret disappeared',()=>{
    const f=fixture();try {
      const a=f.spawn(), b=f.spawn(350); f.advance(0);
      expect(f.hit(a).actualDamage).toBe(5);
      expect(f.hit(a).actualDamage).toBeCloseTo(5*1.03);
      expect(f.hit(b).actualDamage).toBe(5);
      expect(f.binding.score('p1','removed-turret','enemy',a.id,0)).toBe(6);
      f.hit(a,f.source({personalMgOwnerId:undefined}));
      f.hit(a,f.source({lineage:{reflected:true}}));
      f.hit(a,f.source({personalMgScope:{worldRevision:999,runtimeGeneration:1}}));
      expect(f.binding.score('p1','removed-turret','enemy',a.id,0)).toBe(6);
      f.setOwners([]); f.advance(1); expect(f.hit(a).actualDamage).toBe(5);
      expect(f.binding.runtime.snapshot(1).targets).toEqual([]);
    }finally{f.destroy();}
  });
  it('adds a lethal hit before transfer and recognizes a later death caused by another source',()=>{
    const f=fixture();try {
      const a=f.spawn(), b=f.spawn(350), c=f.spawn(400); f.advance(0);
      a.setHp(1,1000,true); expect(f.hit(a).becameDead).toBe(true);
      expect(f.binding.score('p1','any','enemy',b.id,0)).toBeCloseTo(3*.6);
      f.combat.applyDamage(b.id,2000,false,undefined,'environment');
      expect(f.binding.score('p1','any','enemy',c.id,0)).toBeCloseTo(3*.6+3*.6*.6);
      expect(f.binding.runtime.snapshot(0).transfers).toHaveLength(3);
    }finally{f.destroy();}
  });
  it('rejects protected or zero-damage hits and keeps bleed separate from owner bonuses and hit effects',()=>{
    const f=fixture();try {
      const enemy=f.spawn(); f.advance(0);
      expect(f.hit(enemy,f.source(),0).actualDamage??0).toBe(0);
      expect(f.binding.runtime.snapshot(0).targets).toEqual([]);
      f.hit(enemy);
      f.status.setVulnerabilityContribution('other',{targetType:'enemy',targetId:enemy.id},10000);
      const outgoing=vi.fn((_id,_target,amount:number)=>({amount:amount*20,isCritical:true}));
      f.combat.setPlayerOutgoingDamageResolver(outgoing);
      const observed=vi.fn(); f.combat.addDamageDealtObserver(observed);
      f.effects.mockClear(); const hp=enemy.getHp(); f.advance(250);
      expect(hp-enemy.getHp()).toBeCloseTo(.03*3*.25*(1+VULNERABILITY_INCOMING_DAMAGE_BONUS));
      expect(outgoing).not.toHaveBeenCalled(); expect(observed).toHaveBeenCalledTimes(1);
      expect(f.effects.mock.calls.filter(([e])=>e.type==='hit')).toHaveLength(0);
      expect(f.binding.score('p1','any','enemy',enemy.id,250)).toBe(3);
      f.binding.clear(); expect(f.binding.runtime.snapshot(250).targets).toEqual([]);
    }finally{f.destroy();}
  });
  it('uses real base receipts and contour distance for a terminal transfer',()=>{
    const f=fixture();try {
      const cell=f.base.getCellBodies()[0], edge=cell.x+cell.width/2;
      const enemy=f.spawn(edge+149,cell.y); f.advance(0);
      f.baseHit(); expect(f.base.getHp()).toBe(995);
      f.baseHit(); expect(f.base.getHp()).toBeCloseTo(995-5*1.03);
      const before=f.base.getHp(); f.advance(250);
      expect(before-f.base.getHp()).toBeCloseTo(.06*3*.25);
      f.baseHit(2000);
      expect(f.binding.score('p1','any','enemy',enemy.id,250)).toBeCloseTo(9*.6);
      expect(f.binding.runtime.snapshot(250).transfers).toHaveLength(1);
    }finally{f.destroy();}
  });
  it('does not build attrition on an invulnerable base',()=>{
    const f=fixture(false);try {f.baseHit();expect(f.binding.runtime.snapshot(0).targets).toEqual([]);}finally{f.destroy();}
  });
  it('blocks handoffs at actual intervening walls while permitting contact with a recipient base contour',()=>{
    const f=fixture();try {
      const cell=f.base.getCellBodies()[0],x=cell.x+cell.width/2+149,y=cell.y;
      const a=f.spawn(x,y),b=f.spawn(x+50,y); f.advance(0);
      const bounds={x:x+20,y:y-100,width:10,height:200,left:x+20,right:x+30,top:y-100,bottom:y+100};
      f.combat.setBarrierObstacles([{active:true,getBounds:()=>bounds} as never]);
      a.setHp(1,1000,true); f.hit(a);
      expect(f.binding.score('p1','any','enemy',b.id,0)).toBe(0);
      expect(f.binding.score('p1','any','base','base',0)).toBeCloseTo(3*.6);
      expect(f.binding.runtime.snapshot(0).transfers).toHaveLength(1);
    }finally{f.destroy();}
  });
  it('rejects burrow protection and applies attrition after the otherwise applicable outgoing damage',()=>{
    const f=fixture();try {
      const a=f.spawn();f.advance(0);a.setBurrowed(true);
      expect(f.hit(a).actualDamage??0).toBe(0);expect(f.binding.runtime.snapshot(0).targets).toEqual([]);
      a.setBurrowed(false);f.hit(a);
      f.combat.setPlayerOutgoingDamageResolver((_id,_target,amount)=>({amount:(amount+2)*2,isCritical:true}));
      expect(f.hit(a).actualDamage).toBeCloseTo((5+2)*2*1.03);
    }finally{f.destroy();}
  });
});
