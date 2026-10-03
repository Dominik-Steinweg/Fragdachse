
import {expect,it,vi} from 'vitest';
vi.mock('../src/effects/EffectUtils',()=>({registerGraphicsObject:vi.fn()}));
import {WoodlandEcologyRenderer} from '../src/arena/WoodlandEcologyRenderer';
import {createSunTuning} from '../src/effects/sunlight/SunAtmosphere';
import {DEPTH} from '../src/config';
it('thins stable atlas sprites without recreating them and shares the frozen water time',()=>{
  const objects:any[]=[];
  const scene={cameras:{main:{width:500,height:500,zoom:1,originX:0,originY:0,scrollX:0,scrollY:0,worldView:{x:0,y:0,right:500,bottom:500}}},add:{image:vi.fn((x:number,y:number)=>{
    const image={x,y,visible:true,rotation:0,setDisplaySize(){return this;},setRotation(n:number){this.rotation=n;return this;},
      depth:0,setTint(){return this;},setAlpha(){return this;},setDepth(n:number){this.depth=n;return this;},setVisible(v:boolean){this.visible=v;return this;},
      setPosition(x:number,y:number){this.x=x;this.y=y;return this;},destroy:vi.fn()};objects.push(image);return image;
  })}};
  const renderer=new WoodlandEcologyRenderer(scene as never,[{kind:'litter',frame:'leaf-litter-01',x:100,y:100,size:30,rotation:0,alpha:.5,rank:.5,floating:false},
    {kind:'pond',frame:'lily-pad-01',x:200,y:200,size:25,rotation:1,alpha:.8,rank:.5,floating:true},
    {kind:'shore',frame:'bank-01',x:220,y:230,size:24,rotation:0,alpha:1,rank:.5,floating:false}]);
  expect(objects[1].depth).toBeGreaterThan(DEPTH.WATER);
  expect(objects[2].depth).toBeLessThan(DEPTH.WATER);
  expect(objects[2].depth).toBeGreaterThan(DEPTH.DIRT);
  expect(objects[2].depth).toBeLessThan(DEPTH.GROUND_COVER);
  expect(objects[2].depth).toBeLessThan(DEPTH.GROUND_MACRO);
  const tuning=createSunTuning();let time=1;const water={getPresentationTime:()=>time};
  renderer.update(tuning,water as never,true,true);const pose=[objects[1].x,objects[1].y,objects[1].rotation];
  renderer.update(tuning,water as never,true,true);expect([objects[1].x,objects[1].y,objects[1].rotation]).toEqual(pose);
  time+=1;renderer.update(tuning,water as never,true,true);expect(objects[1].x).not.toBe(pose[0]);
  expect([objects[2].x,objects[2].y,objects[2].rotation]).toEqual([220,230,0]);
  renderer.update(tuning,water as never,true,true,.5);expect(objects.every(o=>!o.visible)).toBe(true);
  renderer.update(tuning,water as never,true,true,1);expect(objects.every(o=>o.visible)).toBe(true);
  tuning.litterDensity=0;tuning.pondFloraDensity=0;renderer.update(tuning,water as never,true,true);
  expect(objects.slice(0,2).every(o=>!o.visible)).toBe(true);
  expect(objects[2].visible).toBe(true);expect(scene.add.image).toHaveBeenCalledTimes(3);
  renderer.destroy();renderer.destroy();expect(objects.every(o=>o.destroy.mock.calls.length===1)).toBe(true);
});

it('keeps overlapping lilies at every viewport edge while moving and zooming',()=>{
 const camera={width:1664,height:936,zoom:1,originX:0,originY:0,scrollX:300,scrollY:200,
  worldView:{x:99999,y:99999,right:99999,bottom:99999}};
 const objects:any[]=[];const scene={cameras:{main:camera},add:{image:()=>{
  const image={visible:false,setDisplaySize(){return this;},setRotation(){return this;},setAlpha(){return this;},setDepth(){return this;},
   setPosition(){return this;},setVisible(v:boolean){this.visible=v;return this;},destroy(){}};objects.push(image);return image;}}};
 for(const zoom of [.5,1,1.4,2])for(const shift of [0,73]){
  camera.zoom=zoom;camera.scrollX=300+shift;camera.scrollY=200+shift;
  const {scrollX:x,scrollY:y}=camera,w=camera.width/zoom,h=camera.height/zoom;
  const placements=[[x-5,y+h/2],[x+w+5,y+h/2],[x+w/2,y-5],[x+w/2,y+h+5]].map(([x,y])=>
   ({kind:'pond' as const,frame:'lily-pad-01',x,y,size:25,rotation:0,alpha:1,rank:0,floating:true}));
  objects.length=0;const renderer=new WoodlandEcologyRenderer(scene as never,placements);
  renderer.update(createSunTuning(),null,true,true);expect(objects.every(o=>o.visible)).toBe(true);renderer.destroy();
 }
});
