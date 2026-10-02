import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ nodes: [] as any[], shaders: [] as any[], frame: 0 }));
vi.mock('phaser', () => ({ BlendModes: { MULTIPLY: 3 }, GameObjects: { Shader: class {
  renderNode: any = {}; visible = true; depth = 0; destroy = vi.fn();
  constructor(){state.shaders.push(this);}
  setDepth(v:number){this.depth=v;return this;}setBlendMode(){return this;}setVisible(v:boolean){this.visible=v;return this;}
  setPosition(){return this;}setSize(){return this;}setName(){return this;}
} } }));
vi.mock('../src/effects/EnemyMeshGpu', () => ({ EnemyMeshGpu: class {
  indexCount=6;bytes=100;destroy=vi.fn();prepare=()=>true;draw=vi.fn(()=>true);
  constructor(...args:any[]){state.nodes.push(this);this.attributes=args[7];} attributes:any;
} }));
vi.mock('../src/effects/sunlight/SunRenderTarget', () => ({ ownSunShader(){}, sunShaderName:(s:string)=>s,
  SunRenderTarget:class {shader:any;destroy=vi.fn();constructor(){this.shader={drawingContext:{setAutoClear(){},setClearColor(){}},
    renderNode:{run(){},programManager:{getCurrentProgramSuite:()=>true}},texture:{get:()=>({source:{glTexture:{}}})}};}
    draw(){this.shader.renderNode.run(this.shader.drawingContext);}
  } }));
vi.mock('../src/effects/EffectUtils',()=>({registerGraphicsObject(){}}));
vi.mock('../src/graphics/CameraWorldView',()=>({createVisibleWorldView:()=>({}),getVisibleWorldView:()=>({x:0,y:0,right:1000,bottom:1000,width:1000,height:1000})}));
vi.mock('../src/assets/EnemyMeshAssets',async load=>{
  const real=await load<any>();return {...real,getEnemyMeshAssets:()=>({prefetch(){},pump(){},inspect(){},ready:new Map(real.ENEMY_MESH_MANIFEST.assets.map((asset:any)=>
    [asset.id,{asset,positions:new Float32Array(asset.mesh.vertexCount*3*31),indices:new Uint16Array(asset.mesh.triangleCount*3)}]))})};
});
import { EnemyMeshShadowRenderer } from '../src/effects/EnemyMeshShadowRenderer';
function fixture(){
  state.nodes.length=state.shaders.length=0;state.frame=0;
  const scene:any={sys:{renderer:{shaderProgramFactory:{programs:{}}}},game:{loop:{get frame(){return state.frame}}},cameras:{main:{}},add:{existing(){}}};
  const receiver:any={destroy:vi.fn(),world:[0,0,1000,1000],texture:{}};
  const renderer=new EnemyMeshShadowRenderer(scene,{sunPath:{sun:[-1,0,.5],strength:1,elevation:.6}} as any,receiver,64);
  const enemy=(x=500):any=>({kind:'zombie-badger',getHp:()=>1,isBurrowed:()=>false,sprite:{active:true,visible:true,alpha:.7,x,y:500,
    rotation:0,scaleX:67.2/128,scaleY:67.2/128,displayWidth:67.2,displayHeight:67.2,originX:.5,originY:.5,flipX:false,flipY:false,frame:{name:19,realWidth:128,realHeight:128}}});
  const sync=(enemies:any[],visible=true)=>{state.frame++;renderer.sync(enemies,visible)};
  return {renderer,receiver,enemy,sync};
}
it('keeps ellipse ownership until all poses/programs are ready and uploads only instances afterwards',()=>{
  const f=fixture(),e=f.enemy();f.sync([e]);expect(f.renderer.handles(e)).toBe(false);
  for(let i=0;i<70;i++)f.sync([e]);expect(f.renderer.handles(e)).toBe(true);
  const allocated=state.nodes.length;e.sprite.frame.name=4;e.sprite.flipX=true;e.sprite.scaleX*=1.3;f.sync([e]);
  expect(state.nodes.length).toBe(allocated);expect(f.renderer.inspect().activeInstances).toBe(1);
  expect(f.renderer.inspect().costs.geometryDraws).toBe(1);f.renderer.destroy();
});
it('bounds atlas allocations, batches poses, culls projected bounds, releases death/burrow/hidden slots and borrows the receiver',()=>{
  const f=fixture(),enemies=Array.from({length:513},()=>f.enemy());
  for(let i=0;i<70;i++)f.sync(enemies);
  expect(f.renderer.inspect().activeInstances).toBe(512);expect(enemies.filter(e=>f.renderer.handles(e))).toHaveLength(512);
  expect(f.renderer.inspect().costs.geometryDraws).toBe(1);
  enemies[0].getHp=()=>0;enemies[1].isBurrowed=()=>true;enemies[2].sprite.visible=false;
  f.sync(enemies);expect(f.renderer.inspect().activeInstances).toBe(510);
  const projected=f.enemy(-20);f.sync([projected]);expect(f.renderer.inspect().activeInstances).toBe(1);
  projected.sprite.x=-10000;f.sync([projected]);expect(f.renderer.inspect().activeInstances).toBe(0);
  expect(f.renderer.inspect().allocatedSlots).toBe(0);expect(f.renderer.handles(projected)).toBe(true);
  f.sync([],false);f.renderer.destroy();f.renderer.destroy();
  expect(f.receiver.destroy).not.toHaveBeenCalled();for(const node of state.nodes)expect(node.destroy).toHaveBeenCalledTimes(1);
});


it('uses the camera framebuffer transform without applying the viewport twice',()=>{
  const f=fixture(), runtime=f.renderer as any, uniforms=new Map<string,unknown>();
  runtime.renderer.setProjectionMatrixFromDrawingContext=vi.fn();
  runtime.renderer.projectionMatrix={val:[]};
  runtime.clouds.tuning={};
  f.receiver.texture={get:()=>({source:{glTexture:{}}})};
  state.nodes[0].draw.mockImplementation((_context:any,_data:any,_count:any,_textures:any,set:any)=>{
    set((name:string,value:unknown)=>uniforms.set(name,value));return true;
  });
  const getViewMatrix=vi.fn((framebuffer:boolean)=>({a:2,b:0,c:0,d:2,tx:framebuffer?-300:-260,ty:-200}));
  runtime.drawComposite({useCanvas:false,camera:{getViewMatrix}});
  expect(getViewMatrix).toHaveBeenLastCalledWith(true);
  expect(uniforms.get('uViewMatrix')).toEqual([2,0,0,0,2,0,-300,-200,1]);
  runtime.drawComposite({useCanvas:true,camera:{getViewMatrix}});
  expect(getViewMatrix).toHaveBeenLastCalledWith(false);
  expect(uniforms.get('uViewMatrix')).toEqual([2,0,0,0,2,0,-260,-200,1]);
  f.renderer.destroy();
});

it('uses a world-space penumbra and an unblurred debug mask independently of the atlas tile',()=>{
  const f=fixture(),e=f.enemy(),runtime=f.renderer as any;
  for(let i=0;i<70;i++)f.sync([e]);
  expect(runtime.displayData[7]).toBeCloseTo(.65+.65*(1-.5));
  expect(state.nodes[2].draw).toHaveBeenCalled();
  const uniforms=new Map<string,unknown>(), texture={};
  runtime.renderer.setProjectionMatrixFromDrawingContext=vi.fn();runtime.renderer.projectionMatrix={val:[]};
  runtime.clouds.tuning={};f.receiver.texture={get:()=>({source:{glTexture:{}}})};
  runtime.raw.shader.texture={get:()=>({source:{glTexture:texture}})};
  state.nodes[0].draw.mockImplementation((_c:any,_d:any,_n:any,textures:any,set:any)=>{
    expect(textures[0]).toBe(texture);set((name:string,value:unknown)=>uniforms.set(name,value));return true;
  });
  f.renderer.setDebugSolid(true);
  runtime.drawComposite({useCanvas:true,camera:{getViewMatrix:()=>({a:1,b:0,c:0,d:1,tx:0,ty:0})}});
  expect(uniforms.get('uDebugSolid')).toBe(1);
  f.renderer.destroy();
});


it('clears quadruped contacts when a pooled display entry becomes bipedal',()=>{
  const f=fixture(),e=f.enemy(),runtime=f.renderer as any;
  for(let i=0;i<70;i++)f.sync([e]);
  expect(Array.from(runtime.displayData.slice(16,24)).some(v=>v!==0)).toBe(true);
  const mesh=runtime.assets.ready.get(e.kind),old=mesh.asset;
  mesh.asset={...old,contacts:old.contacts.map((c:any)=>({...c,feet:c.feet.slice(0,2)}))};
  f.sync([e]);expect(Array.from(runtime.displayData.slice(16,24))).toEqual([0,0,0,0,0,0,0,0]);
  expect(runtime.activeCount).toBe(1);f.renderer.destroy();
});
