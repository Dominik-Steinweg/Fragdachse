import { expect, it, vi } from 'vitest';
import { canopyV9Direct, canopyHorizonWeights } from '../src/arena/trees/CanopyLightingModel';
import { SUN_TUNING_DEFAULTS as tuning, validateSunTuning } from '../src/effects/sunlight/SunTuning';

it('has no direct light at zero strength and follows the lit side',()=>{
  const east=[.8,0,.6],west=[-.8,0,.6];
  expect(canopyV9Direct(east,east,.1,.5,0,tuning)).toBe(0);
  expect(canopyV9Direct(east,east,.1,.5,1,tuning)).toBeGreaterThan(canopyV9Direct(east,west,.1,.5,1,tuning));
  expect(canopyV9Direct(west,west,.1,.5,1,tuning)).toBeGreaterThan(canopyV9Direct(west,east,.1,.5,1,tuning));
});
it('interpolates the eight horizons cyclically and normalizes weights',()=>{
  const a=[0,0,0,0],b=[0,0,0,0];
  canopyHorizonWeights([0,-1,0],a,b);expect(a).toEqual([1,0,0,0]);
  canopyHorizonWeights([1,0,0],a,b);expect(a).toEqual([0,0,1,0]);
  for(let angle=-Math.PI;angle<Math.PI;angle+=.013){
    canopyHorizonWeights([Math.sin(angle),-Math.cos(angle),0],a,b);
    expect([...a,...b].reduce((s,x)=>s+x,0)).toBeCloseTo(1);
    expect([...a,...b].every(x=>Number.isFinite(x)&&x>=0&&x<=1)).toBe(true);
  }
});
it('validates model overrides without accepting singular horizon widths',()=>{
  for(const values of [{canopyAO:NaN},{canopyWrap:-1},{canopyHorizonSoftness:0},{canopySunWeight:Infinity}])expect(()=>validateSunTuning(values)).toThrow();
  expect(validateSunTuning({canopySunWeight:0})).toEqual({canopySunWeight:0});
});

const gpu=vi.hoisted(()=>({header:'',batch:null as any,values:new Map<string,unknown>()}));
vi.mock('phaser',()=>({Renderer:{Events:{SET_PARALLEL_TEXTURE_UNITS:'units',RESIZE:'resize'},WebGL:{RenderNodes:{
 BatchHandlerQuadSingle:class {
  programManager={programs:{},addAddition:(a:any)=>{gpu.header=a.additions.fragmentHeader;},setUniform:(k:string,v:unknown)=>gpu.values.set(k,v)};
  vertexBufferLayout={buffer:{}};indexBuffer={};setupUniforms(){} updateTextureCount(){} resize(){}
  constructor(public manager:any){gpu.batch=this;}
 },RenderNode:class{constructor(public name:string,public manager:any){}}
}}},Utils:{Array:{Remove(){}}}}));
import {CanopyLighting} from '../src/arena/trees/CanopyLighting';
it('declares every material uniform and binds cloud tint on the actual canopy draw path',()=>{
 gpu.values.clear();const renderer:any={gl:{},glVAOWrappers:[],glTextureUnits:{bind(){}},off(){},deleteBuffer(){}};
 const manager={renderer,finishBatch(){},off(){},currentBatchNode:null};renderer.renderNodes=manager;
 const image:any={active:true,scene:{},x:10,y:20,displayWidth:100,displayHeight:100,rotation:0,scaleX:1,scaleY:1,flipX:false,flipY:false,
  frame:{u0:0,v0:0,u1:1,v1:1},tintTopLeft:0xffffff,tintTopRight:0xffffff,tintBottomLeft:0xffffff,tintBottomRight:0xffffff,
  customRenderNodes:{},renderNodeData:{},defaultRenderNodes:{Submitter:{run(){gpu.batch.setupUniforms({});}}},
  setTint(){},setRenderNodeRole(role:string,node:any){if(node)this.customRenderNodes[role]=node;else delete this.customRenderNodes[role];}};
 const scene={sys:{renderer},textures:{get:()=>({source:[{glTexture:{}}]})}};
 const owner=new CanopyLighting(scene as never,[{gfx:image,worldX:10,worldY:20}]);
 const clouds:any={strength:1,timeSec:0,windX:1,windY:0,tuning:{...tuning,cloudCanopyShade:[.7,.8,.9]}};
 owner.setClouds(clouds);owner.update({strength:1,sun:[1,0,1]});
 image.customRenderNodes.Submitter.run({},image,null,0,{},{},{});
 const declarations=new Set([...gpu.header.matchAll(/uniform\s+\w+\s+([^;]+);/g)].flatMap(m=>m[1].match(/\bu[A-Z]\w*/g)??[]));
 const used=new Set(gpu.header.match(/\bu[A-Z]\w*/g));
 expect([...used].filter(name=>!declarations.has(name))).toEqual([]);
 expect(declarations.has('uCloudCanopyShade')).toBe(true);
 expect(gpu.values.get('uCloudCanopyShade')).toBe(clouds.tuning.cloudCanopyShade);
 owner.destroy();expect(image.customRenderNodes.Submitter).toBeUndefined();
});
