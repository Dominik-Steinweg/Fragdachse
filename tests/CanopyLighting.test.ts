import { describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({batches:[] as any[],layouts:[] as any[]}));
vi.mock('phaser',()=>({Renderer:{Events:{SET_PARALLEL_TEXTURE_UNITS:'units',RESIZE:'resize'},WebGL:{
  Wrappers:{WebGLVertexBufferLayoutWrapper:class{buffer={viewF32:new Float32Array(256*20),update:vi.fn()};constructor(){state.layouts.push(this);}}},
  RenderNodes:{RenderNode:class{constructor(public name:string,public manager:any){}},BatchHandlerQuadSingle:class{
    instanceCount=0;vertexBufferLayout={buffer:{}};indexBuffer={};resize(){}updateTextureCount(){}
    programManager={attributeBufferLayouts:[] as any[],programs:{},addAddition:vi.fn(),setUniform:vi.fn()};
    setupUniforms(){}batchTextures(){return 0;}run(){this.instanceCount=0;}
    constructor(public manager:any,public config:any){state.batches.push(this);}
  }}}},Utils:{Array:{Remove:vi.fn()}}}));
import { CanopyLighting } from '../src/arena/trees/CanopyLighting';

function fixture(){
 const renderer={gl:{},renderNodes:{finishBatch:vi.fn(),off:vi.fn()},off:vi.fn(),deleteBuffer:vi.fn()};
 Object.assign(renderer.renderNodes,{renderer});
 const scene={sys:{renderer}},submitted:number[]=[];
 function image(x:number,tint:number){
  const fallback={name:'original',run(_c:any,object:any){
   const batch=object.customRenderNodes.BatchHandler;
   // Phaser chooses/flushes batches before calling batchTextures.
   if(batch.instanceCount===256)batch.run({});
   batch.batchTextures({},{});batch.instanceCount++;submitted.push(object.x);
  }};
  return {x,y:x+1,scene,active:true,tintTopLeft:tint,tintTopRight:tint+1,tintBottomLeft:tint+2,tintBottomRight:tint+3,
   customRenderNodes:{} as any,renderNodeData:{} as any,defaultRenderNodes:{Submitter:fallback},
   setTint(tl:number,tr=tl,bl=tl,br=tl){Object.assign(this,{tintTopLeft:tl,tintTopRight:tr,tintBottomLeft:bl,tintBottomRight:br});},
   setRenderNodeRole(role:string,node:any,data?:object){if(node){this.customRenderNodes[role]=node;this.renderNodeData[node.name]=data;}else delete this.customRenderNodes[role];},
  };
 }
 return {scene,renderer,image,submitted};
}
describe('canopy material batches',()=>{
 it('preserves submission order and image roles/tints while storing independent crown inputs through a batch boundary',()=>{
  const f=fixture(),images=Array.from({length:258},(_,i)=>f.image(i,i%2?0x808080:0xffffff));
  const owner=new CanopyLighting(f.scene as never,images.map(gfx=>({gfx,worldX:gfx.x,worldY:gfx.y})) as never);
  owner.setLighting({getAmbientColor:()=>0x202020,resolveCanopyTint:(x:number)=>x%2?0x808080:0xffffff} as never);
  const layout=state.layouts.at(-1),batch=state.batches.at(-1);
  for(const image of images){const tint=[image.tintTopLeft,image.tintTopRight,image.tintBottomLeft,image.tintBottomRight];
   image.customRenderNodes.Submitter.run({},image);
   expect([image.tintTopLeft,image.tintTopRight,image.tintBottomLeft,image.tintBottomRight]).toEqual(tint);
   expect(image.customRenderNodes.BatchHandler).toBeUndefined();
  }
  expect(f.submitted).toEqual(images.map(i=>i.x));expect(f.renderer.renderNodes.finishBatch).not.toHaveBeenCalled();
  expect(batch.instanceCount).toBe(2);expect(layout.buffer.update).toHaveBeenCalledWith(256*20*4);
  for(let vertex=0;vertex<4;vertex++)expect(Array.from(layout.buffer.viewF32.slice(vertex*5,vertex*5+2))).toEqual([256,257]);
  expect(layout.buffer.viewF32[22]).toBeLessThan(layout.buffer.viewF32[2]);
  owner.destroy();owner.destroy();expect(f.renderer.deleteBuffer.mock.calls.filter(([b])=>b===layout.buffer)).toHaveLength(1);
  expect(images.every(i=>!i.customRenderNodes.Submitter)).toBe(true);
 });
});
