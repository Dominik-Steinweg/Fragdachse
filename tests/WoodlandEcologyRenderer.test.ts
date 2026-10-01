
import {expect,it,vi} from 'vitest';
vi.mock('../src/effects/EffectUtils',()=>({registerGraphicsObject:vi.fn()}));
import {WoodlandEcologyRenderer} from '../src/arena/WoodlandEcologyRenderer';
import {createSunTuning} from '../src/effects/sunlight/SunAtmosphere';
it('thins stable atlas sprites without recreating them and shares the frozen water time',()=>{
  const objects:any[]=[];
  const scene={cameras:{main:{worldView:{x:0,y:0,right:500,bottom:500}}},add:{image:vi.fn((x:number,y:number)=>{
    const image={x,y,visible:true,rotation:0,setDisplaySize(){return this;},setRotation(n:number){this.rotation=n;return this;},
      depth:0,setAlpha(){return this;},setDepth(n:number){this.depth=n;return this;},setVisible(v:boolean){this.visible=v;return this;},
      setPosition(x:number,y:number){this.x=x;this.y=y;return this;},destroy:vi.fn()};objects.push(image);return image;
  })}};
  const renderer=new WoodlandEcologyRenderer(scene as never,[{kind:'litter',frame:'leaf-litter-01',x:100,y:100,size:30,rotation:0,alpha:.5,rank:.5,floating:false},
    {kind:'pond',frame:'lily-pad-01',x:200,y:200,size:25,rotation:1,alpha:.8,rank:.5,floating:true}]);
  expect(objects[1].depth).toBeCloseTo(5.25);
  const tuning=createSunTuning();let time=1;const water={getPresentationTime:()=>time};
  renderer.update(tuning,water as never,true,true);const pose=[objects[1].x,objects[1].y,objects[1].rotation];
  renderer.update(tuning,water as never,true,true);expect([objects[1].x,objects[1].y,objects[1].rotation]).toEqual(pose);
  time+=1;renderer.update(tuning,water as never,true,true);expect(objects[1].x).not.toBe(pose[0]);
  renderer.update(tuning,water as never,true,true,.5);expect(objects.every(o=>!o.visible)).toBe(true);
  renderer.update(tuning,water as never,true,true,1);expect(objects.every(o=>o.visible)).toBe(true);
  tuning.litterDensity=0;tuning.pondFloraDensity=0;renderer.update(tuning,water as never,true,true);
  expect(objects.every(o=>!o.visible)).toBe(true);expect(scene.add.image).toHaveBeenCalledTimes(2);
  renderer.destroy();renderer.destroy();expect(objects.every(o=>o.destroy.mock.calls.length===1)).toBe(true);
});
