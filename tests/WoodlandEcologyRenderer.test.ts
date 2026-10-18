import {expect,it,vi} from 'vitest';
vi.mock('../src/effects/EffectUtils',()=>({registerGraphicsObject:vi.fn()}));
import {WoodlandEcologyRenderer} from '../src/arena/WoodlandEcologyRenderer';
import {createSunTuning} from '../src/effects/sunlight/SunAtmosphere';
import {DEPTH} from '../src/config';

type Anim={base:number;amplitude:number;duration:number;delay:number};
function fakeScene(camera:Record<string,unknown>) {
  const layers:any[]=[];
  const texture={get:()=>({realWidth:64,realHeight:64})};
  const scene={cameras:{main:camera},textures:{get:()=>texture},add:{spriteGPULayer:vi.fn((_texture:unknown,size:number)=>{
    const layer={size,texture,depth:0,visible:true,timeElapsed:0,timePaused:false,memberCount:0,members:[] as any[],
      setDepth(n:number){this.depth=n;return this;},setVisible(v:boolean){this.visible=v;return this;},
      setTimerPaused(p:boolean){this.timePaused=p;return this;},resetTimer(ms:number){this.timeElapsed=ms;return this;},
      addMember(m:any){this.members[this.memberCount++]={...m};return this;},destroy:vi.fn()};
    layers.push(layer);return layer;
  })}};
  return {scene,layers};
}
/** CPU twin of the GPU yoyo Sine.easeInOut, as Phaser's SpriteGPULayer shader evaluates it. */
function evaluate(value:number|Anim,timeMs:number):number {
  if(typeof value==='number')return value;
  const raw=timeMs/value.duration-value.delay/value.duration;
  return value.base+value.amplitude*(0.5-0.5*Math.cos(Math.PI*raw));
}

it('thins stable GPU pages without recreating them and shares the frozen water time',()=>{
  const {scene,layers}=fakeScene({width:500,height:500,zoom:1,originX:0,originY:0,scrollX:0,scrollY:0});
  const renderer=new WoodlandEcologyRenderer(scene as never,[{kind:'litter',frame:'leaf-litter-01',x:100,y:100,size:30,rotation:0,alpha:.5,rank:.5,floating:false},
    {kind:'pond',frame:'lily-pad-01',x:200,y:200,size:25,rotation:1,alpha:.8,rank:.5,floating:true},
    {kind:'shore',frame:'bank-01',x:220,y:230,size:24,rotation:0,alpha:1,rank:.5,floating:false}]);
  const [litterLayer,pondLayer,shoreLayer]=layers;
  expect(pondLayer.depth).toBeGreaterThan(DEPTH.WATER);
  expect(shoreLayer.depth).toBeLessThan(DEPTH.WATER);
  expect(shoreLayer.depth).toBeGreaterThan(DEPTH.DIRT);
  expect(shoreLayer.depth).toBeLessThan(DEPTH.GROUND_COVER);
  expect(shoreLayer.depth).toBeLessThan(DEPTH.GROUND_MACRO);
  expect(layers.every(layer=>layer.timePaused)).toBe(true);
  const tuning=createSunTuning();let time=1;const water={getPresentationTime:()=>time};
  renderer.update(tuning,water as never,true,true);const clock=pondLayer.timeElapsed;
  renderer.update(tuning,water as never,true,true);expect(pondLayer.timeElapsed).toBe(clock);
  time+=1;renderer.update(tuning,water as never,true,true);expect(pondLayer.timeElapsed).not.toBe(clock);
  const shore=shoreLayer.members[0];
  expect([shore.x,shore.y,shore.rotation]).toEqual([220,230,0]);
  expect(shore.scaleX).toBeCloseTo(24/64);
  expect(shore.tintBlend).toBe(1);
  renderer.update(tuning,water as never,true,true,.5);expect(layers.every(layer=>!layer.visible&&layer.memberCount===0)).toBe(true);
  renderer.update(tuning,water as never,true,true,1);expect(layers.every(layer=>layer.visible&&layer.memberCount===1)).toBe(true);
  tuning.litterDensity=0;tuning.pondFloraDensity=0;renderer.update(tuning,water as never,true,true);
  expect([litterLayer.visible,pondLayer.visible]).toEqual([false,false]);
  expect(shoreLayer.visible).toBe(true);expect(scene.add.spriteGPULayer).toHaveBeenCalledTimes(3);
  renderer.destroy();renderer.destroy();expect(layers.every(layer=>layer.destroy.mock.calls.length===1)).toBe(true);
});

it('bobs floating lilies on the GPU exactly like the former per-frame sine pose',()=>{
  const {scene,layers}=fakeScene({width:500,height:500,zoom:1,originX:0,originY:0,scrollX:0,scrollY:0});
  const p={kind:'pond' as const,frame:'lily-pad-01',x:210,y:190,size:25,rotation:1,alpha:.8,rank:0,floating:true};
  const renderer=new WoodlandEcologyRenderer(scene as never,[p]);
  renderer.update(createSunTuning(),{getPresentationTime:()=>0} as never,true,true);
  const member=layers[0].members[0],phase=p.x*.005+p.y*.007;
  for(const seconds of [0,1.3,7.7,19,42.5]) {
    const ms=seconds*1000;
    expect(evaluate(member.x,ms)).toBeCloseTo(p.x+Math.sin(seconds*.21+phase)*.7,5);
    expect(evaluate(member.y,ms)).toBeCloseTo(p.y+Math.cos(seconds*.17+phase)*.5,5);
    expect(evaluate(member.rotation,ms)).toBeCloseTo(p.rotation+Math.sin(seconds*.18+phase)*.025,5);
  }
  renderer.destroy();
});

it('keeps overlapping lilies at every viewport edge while moving and zooming',()=>{
 const camera={width:1664,height:936,zoom:1,originX:0,originY:0,scrollX:300,scrollY:200,
  worldView:{x:99999,y:99999,right:99999,bottom:99999}};
 for(const zoom of [.5,1,1.4,2])for(const shift of [0,73]){
  camera.zoom=zoom;camera.scrollX=300+shift;camera.scrollY=200+shift;
  const {scrollX:x,scrollY:y}=camera,w=camera.width/zoom,h=camera.height/zoom;
  for(const [px,py] of [[x-5,y+h/2],[x+w+5,y+h/2],[x+w/2,y-5],[x+w/2,y+h+5]]) {
   const {scene,layers}=fakeScene(camera);
   const renderer=new WoodlandEcologyRenderer(scene as never,[{kind:'pond',frame:'lily-pad-01',x:px,y:py,size:25,rotation:0,alpha:1,rank:0,floating:true}]);
   renderer.update(createSunTuning(),null,true,true);expect(layers.every(layer=>layer.visible)).toBe(true);renderer.destroy();
  }
 }
});
