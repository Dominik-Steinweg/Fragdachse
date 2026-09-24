import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser',()=>({Math:{Clamp:(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n))}}));
vi.mock('../src/effects/EffectUtils',()=>({ensureCanvasTexture:()=>{},registerGraphicsObject:()=>{}}));
import { AttackDroneRenderer } from '../src/effects/AttackDroneRenderer';
import type { SyncedAttackDrone } from '../src/types';

function fixture(){
  const objects:Record<string,any>[]=[];
  const object=(x:number,y:number,texture?:string)=>{
    const item:Record<string,any>={x,y,texture,visible:true,active:true,destroyed:false};
    for(const method of ['setDepth','setDisplaySize','setRotation','setAlpha','setFillStyle','setRadius','setOrigin'])item[method]=()=>item;
    item.setFillStyle=(color:number)=>{item.color=color;return item;};
    item.setRadius=(radius:number)=>{item.radius=radius;return item;};
    item.setPosition=(x:number,y:number)=>{Object.assign(item,{x,y});return item;};
    item.setVisible=(visible:boolean)=>{item.visible=visible;return item;};
    item.setActive=(active:boolean)=>{item.active=active;return item;};
    item.setTexture=(texture:string)=>{item.texture=texture;return item;};
    item.destroy=()=>{item.destroyed=true;};objects.push(item);return item;
  };
  const scene={textures:{},add:{image:object,circle:object},cameras:{main:{worldView:{left:0,top:0,right:500,bottom:500}}}};
  const renderer=new AttackDroneRenderer(scene as never), audio={playSound:vi.fn()};renderer.setAudio(audio);
  const state:SyncedAttackDrone={id:'one',stationId:1,ownerId:'p',ownerColor:1,x:100,y:100,flightAngle:0,gunAngle:1,
    phase:'gun',phaseStartedAt:0,lastShotAt:100,shotSequence:4};
  return{renderer,audio,state,objects};
}
describe('attack drone snapshot presentation',()=>{
  it('keeps owner colors separate and only pulses during service, not dormant docking',()=>{
    const f=fixture();
    const service={...f.state,ownerColor:0x55aa44,phase:'servicing' as const,phaseStartedAt:100};
    const docked={...f.state,id:'two',stationId:2,ownerId:'other',ownerColor:0x4488cc,phase:'docked' as const};
    f.renderer.syncVisuals([service,docked],[],[],100);f.renderer.update(16,100);
    const markers=f.objects.filter(o=>o.color!==undefined);
    expect(markers.map(m=>m.color)).toEqual([service.ownerColor,docked.ownerColor]);
    const before=markers.map(m=>m.radius);f.renderer.update(16,180);
    expect(markers[0].radius).not.toBe(before[0]);expect(markers[1].radius).toBe(before[1]);
    f.renderer.syncVisuals([{...service,phase:'docked'},docked],[],[],200);f.renderer.update(16,200);
    const settled=markers[0].radius;f.renderer.update(16,280);expect(markers[0].radius).toBe(settled);
    f.renderer.destroyAll();
  });
  it('does not replay bootstrap or repeated shot events and releases drone visuals on an empty snapshot',()=>{
    const f=fixture();f.renderer.syncVisuals([f.state],[],[],100);f.renderer.update(16,100);
    expect(f.audio.playSound).not.toHaveBeenCalled();
    const next={...f.state,lastShotAt:150,shotSequence:5};
    f.renderer.syncVisuals([next],[],[],150);f.renderer.syncVisuals([next],[],[],160);
    expect(f.audio.playSound).toHaveBeenCalledOnce();
    f.renderer.syncVisuals([],[],[],200);expect(f.objects.every(o=>o.destroyed)).toBe(true);
    f.renderer.destroyAll();
  });
  it('expires falling bombs locally during packet loss, pools them and destroys the pool on teardown',()=>{
    const f=fixture(), bomb={id:'bomb',stationId:1,ownerId:'p',x:200,y:200,droppedAt:100,landsAt:350};
    f.renderer.syncVisuals([],[bomb],[],100);f.renderer.update(16,200);
    expect(f.objects[0]).toMatchObject({visible:true,active:true});
    f.renderer.update(200,400);expect(f.objects[0]).toMatchObject({visible:false,active:false});
    f.renderer.syncVisuals([],[bomb],[],400);expect(f.objects).toHaveLength(1);
    f.renderer.destroyAll();expect(f.objects[0].destroyed).toBe(true);
    expect(f.audio.playSound).not.toHaveBeenCalled();
  });
});
