import { expect, it, vi } from 'vitest';
// The baked-mask path stays covered while it is disabled in production.
vi.mock('../src/effects/ShadowConfig', async (load) => ({ ...(await load<typeof import('../src/effects/ShadowConfig')>()), CHARACTER_SHADOW_MASKS_ENABLED: true }));
const state = vi.hoisted(() => ({ shaders: [] as any[], draws: [] as any[] }));
vi.mock('phaser', async () => {
  const { InstalledShader } = await import('./CharacterShadowPhaserHarness');
  return { BlendModes: { NORMAL: 0, MULTIPLY: 2 }, Textures: { FilterMode: { LINEAR: 0 } },
    Renderer: { Events: { SET_PARALLEL_TEXTURE_UNITS: 'parallel', RESIZE: 'resize' }, WebGL: { RenderNodes: { BatchHandler: class {
 manager:any; renderer:any; vertexBufferLayout:any; indexBuffer:any; programManager:any; topology:any;
 constructor(manager:any,config:any){this.manager=manager;this.renderer=manager.renderer;this.topology=config.topology;
  this.indexBuffer=(this as any)._generateElementIndices();
  this.vertexBufferLayout={buffer:{viewF32:new Float32Array(config.verticesPerInstance*3),update:vi.fn()}};
  const uniforms:any={};this.programManager={programs:{},getCurrentProgramSuite:()=>({program:{uniforms},vao:{}}),
   setUniform:(k:string,v:any)=>uniforms[k]=v,applyUniforms(){}};
 }
 onRunBegin(){} onRunEnd(){} resize(){} updateTextureCount(){}
} } } }, Utils: { Array: { Remove(){} } }, Loader: { FileTypes: { ImageFile: class {
      data:any; complete=false;error=false;
      constructor(public loader:any, public config:any) {}
      onProcessComplete(){this.complete=true;} onProcessError(){this.error=true;}
    } } }, GameObjects: { Shader: class extends InstalledShader {
      config:any;
      constructor(...args:any[]){super(...args);this.config=args[1];state.shaders.push(this);}
    } } };
});

vi.mock('../src/effects/sunlight/SunRenderTarget',async()=>{
 const Phaser=await import('phaser');
 return {ownSunShader:vi.fn(),sunShaderName:(k:string)=>k+state.shaders.length,SunRenderTarget:class {
 shader:any;
 constructor(scene:any,kind:string,fragmentSource:string,setupUniforms:any,textures:any[]=['__DEFAULT']){
  this.shader=new Phaser.GameObjects.Shader(scene,{name:kind,shaderName:kind,fragmentSource,setupUniforms},0,0,3,3,textures);
  this.shader.texture=scene.textures.get(kind+state.shaders.length);
  this.shader.renderToTexture=true;
  this.shader.drawingContext={renderer:scene.sys.renderer,state:{blend:{enabled:false}},setAutoClear:vi.fn(),setClearColor:vi.fn()};
 }
 draw(w:number,h:number){this.shader.setSize(w,h);this.shader.renderNode.run(this.shader.drawingContext,this.shader);}
 destroy(){this.shader.destroy();}
 }};
});
vi.mock('../src/effects/EffectUtils',()=>({registerGraphicsObject:vi.fn()}));
import {CharacterShadowRenderer} from '../src/effects/CharacterShadowRenderer';
import {CharacterShadowReceiver} from '../src/effects/CharacterShadowReceiver';
import {CHARACTER_SHADOW_CONFIG as config} from '../src/effects/ShadowConfig';
import {CHARACTER_SHADOW_MANIFEST as manifest} from '../src/assets/CharacterShadowAssetManifest';
import {createSunTuning} from '../src/effects/sunlight/SunAtmosphere';
import {createSunPath,resolveSunPath} from '../src/effects/sunlight/SunPath';
import {characterLightAzimuth,createCharacterShadowSelection,selectCharacterShadows,characterShadowSample} from '../src/effects/CharacterShadowModel';
import { Matrix } from './CharacterShadowPhaserHarness';
import { preloadCharacterShadowAssets, assertCharacterShadowAssetsReady } from '../src/assets/CharacterShadowAssets';
import { CHARACTER_SHADOW_FILES } from '../src/assets/CharacterShadowAssetManifest';
import { CELL_SIZE, DEPTH } from '../src/config';
import sharp from 'sharp';

function fixture(){
 state.shaders.length=0;const textures=new Map<string,any>();let pixels:Uint8Array|undefined;
 const gl={NEAREST:1,CLAMP_TO_EDGE:2,RGBA:3,TEXTURE_2D:4,UNSIGNED_BYTE:5,LINEAR:6,
   texSubImage2D:vi.fn((...args:any[])=>{pixels=Uint8Array.from(args[8]);})};
 const makeTexture=(key:string,wrapper:any)=>{const source={glTexture:wrapper};return {key,source:[source],get:()=>({source}),setFilter(){}};};
 const scene:any={sys:{renderer:{gl,createTexture2D:vi.fn((...args:any[])=>({data:args[6],width:args[7],height:args[8],pma:args[9]})),glTextureUnits:{bind:vi.fn()},
  blendModes:[{name:'normal'},null,{name:'multiply'}],glWrapper:{updateBlend:vi.fn(),updateTexturing:vi.fn()},
  projectionMatrix:{val:new Float32Array(16)},setProjectionMatrixFromDrawingContext(){},drawElements:vi.fn()}},
  add:{existing:vi.fn()},cameras:{main:{scrollX:0,scrollY:0,width:600,height:600,zoom:1,originX:.5,originY:.5}},
  textures:{exists:(key:string)=>textures.has(key),get:(key:string)=>{if(!textures.has(key))textures.set(key,makeTexture(key,{}));return textures.get(key);},
   addGLTexture:(key:string,wrapper:any)=>{const t=makeTexture(key,wrapper);textures.set(key,t);return t;},remove:vi.fn((key:string)=>textures.delete(key))}};
 scene.sys.renderer.renderNodes={renderer:scene.sys.renderer,finishBatch(){},startStandAloneRender(){}};
 scene.cameras.main.getViewMatrix=()=>new Matrix();
 const files:any[]=[];scene.load={scene,textureManager:scene.textures,addFile:(file:any)=>files.push(file)};
 const receiver=new CharacterShadowReceiver(scene,{minX:0,minY:0,maxX:640,maxY:640});
 const clouds={tuning:createSunTuning(),timeSec:123,strength:1,sunPath:resolveSunPath(720,null,createSunPath())};
 const renderer=new CharacterShadowRenderer(scene,clouds,receiver);
 return {scene,renderer,receiver,clouds,files,pixels:()=>pixels!};
}
function player(){
 const sprite:any={x:200,y:200,active:true,visible:true,alpha:1,scaleX:.3,scaleY:.3,displayWidth:38.4,displayHeight:38.4,
   rotation:0,originX:.5,originY:.5,frame:{name:'17',realWidth:128,realHeight:128},flipX:false,flipY:false};
 const weapon:any={active:true,visible:true,alpha:1,x:205,y:201,rotation:.3,scaleX:.3,scaleY:.3,originX:.2,originY:.7,
   frame:{realWidth:64,realHeight:64,u0:.1,v0:.2,u1:.3,v1:.4},texture:{key:'held'},flipX:false,flipY:false};
 return {displayObject:sprite,getHeldItemDisplayObject:()=>weapon,getBurrowPhase:()=> 'surface',isDecoyStealthedVisual:()=>false,weapon};
}
function uniforms(shader:any){const values:any={};shader.config.setupUniforms((k:string,v:any)=>{values[k]=Array.isArray(v)?[...v]:v;});return values;}
it('one draw follows the displayed frame, remote facing, recoil and paused sun without duplicating alpha',()=>{
 const f=fixture(),p=player();f.renderer.sync([p] as never,true);
 expect(state.shaders).toHaveLength(1);const shader=state.shaders[0];
 for(const pose of [17,4,36,0])for(const rotation of [0,.4,Math.PI*1.7]){
  p.displayObject.frame.name=String(pose);p.displayObject.rotation=rotation;p.weapon.x+=.2;
  f.renderer.sync([p] as never,true);const u=uniforms(shader),selected=createCharacterShadowSelection();
  selectCharacterShadows(characterLightAzimuth(...f.clouds.sunPath.direction,rotation),f.clouds.sunPath.elevation,selected);
  expect(u.uWeights).toEqual(selected.weights);expect(u.uChannels).toEqual(selected.canvases.map(c=>characterShadowSample(pose,c).channel));
  expect(u.uWeaponPose[0]).toBeCloseTo(p.weapon.x-f.clouds.sunPath.direction[0]*config.weaponGripHeight/Math.tan(f.clouds.sunPath.elevation));
  expect(Math.cos(shader.rotation)).toBeCloseTo(Math.cos(rotation));expect(Math.sin(shader.rotation)).toBeCloseTo(Math.sin(rotation));expect(u.uCloudTime).toBe(123);
 }
 expect(state.shaders).toHaveLength(1);
 f.clouds.sunPath.strength=0;f.renderer.sync([p] as never,true);
 const night=uniforms(shader);expect(night.uStrength[0]).toBe(0);expect(night.uStrength[1]).toBeGreaterThan(0);expect(night.uStrength[3]).toBe(0);
 f.renderer.destroy();expect(shader.destroyed).toBe(true);expect(f.scene.textures.remove).toHaveBeenCalledWith(f.receiver.texture.key);
});
it('excludes burrow/trapped/stealth, culls zoomed edges and removes departed player resources',()=>{
 const f=fixture(),p=player();f.renderer.sync([p] as never,true);const shader=state.shaders[0];
 for(const phase of ['underground','trapped']){p.getBurrowPhase=()=>phase;f.renderer.sync([p] as never,true);expect(shader.visible).toBe(false);}
 p.getBurrowPhase=()=> 'surface';p.isDecoyStealthedVisual=()=>true;f.renderer.sync([p] as never,true);expect(shader.visible).toBe(false);
 p.isDecoyStealthedVisual=()=>false;
 for(const zoom of [.5,1,1.4,2]){f.scene.cameras.main.zoom=zoom;p.displayObject.x=300-300/zoom+1;f.renderer.sync([p] as never,true);expect(shader.visible).toBe(true);}
 f.renderer.sync([p] as never,false);expect(shader.visible).toBe(false);f.renderer.sync([p] as never,true);expect(shader.visible).toBe(true);
 f.renderer.sync([],true);expect(shader.destroyed).toBe(true);expect(f.renderer.count).toBe(0);f.renderer.destroy();
});
it('receiver excludes actual obstacles and bases, weakens water and releases destroyed rock cells immediately',()=>{
 const f=fixture(),layout:any={rocks:[{gridX:0,gridY:0}],water:[{gridX:1,gridY:0}]};
 f.receiver.update(layout,0,0,()=>true,[],[{x:80,y:16}]);
 expect(f.pixels()[0]).toBe(0);expect(f.pixels()[4]).toBe(Math.round(config.waterResponse*255));expect(f.pixels()[8]).toBe(0);
 f.receiver.update(layout,0,0,()=>false,[],[]);expect(f.pixels()[0]).toBe(255);expect(f.pixels()[8]).toBe(255);f.renderer.destroy();
});

it('manifest pages reach a daytime draw whose real Phaser vertices match sampled world coordinates',async()=>{
 const f=fixture(),p=player();p.getHeldItemDisplayObject=()=>null as any;
 preloadCharacterShadowAssets(f.scene);
 expect(f.files).toHaveLength(CHARACTER_SHADOW_FILES.length);
 for(let i=0;i<f.files.length;i++){
  const asset=CHARACTER_SHADOW_FILES[i], file=f.files[i];
  const {data,info}=await sharp('public/'+asset.url.split('?')[0]).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  file.data={width:info.width,height:info.height,pixels:data};file.onProcessComplete();
  expect(file.complete).toBe(true);expect(file.error).toBe(false);
  expect(f.scene.textures.get(asset.key).source[0].glTexture.pma).toBe(false);
 }
 assertCharacterShadowAssetsReady(f.scene);
 f.receiver.update({rocks:[],water:[]} as never,0,0,undefined,[],[]);
 const context:any={renderer:f.scene.sys.renderer,camera:f.scene.cameras.main,state:{blend:{name:'prior'}},blendMode:0};
 for(const minute of [480,720,1020])for(const rotation of [0,Math.PI/2,Math.PI,4.7]){
  resolveSunPath(minute,null,f.clouds.sunPath);p.displayObject.rotation=rotation;
  f.renderer.sync([p] as never,true);const shader=state.shaders[0];
  shader.renderNode.run(context,shader);
  expect(f.scene.sys.renderer.drawElements).toHaveBeenCalled();
  expect(shader.visible).toBe(true);expect(shader.depth).toBeGreaterThan(DEPTH.ROCK_VEGETATION+.02);expect(shader.depth).toBeLessThan(DEPTH.PLAYERS);
  const u=uniforms(shader),verts=shader.renderNode.vertexBufferLayout.buffer.viewF32;
  // Every emitted corner must coincide with the fragment's reconstructed world position.
  // Fails with the stale 1x1 display origin even though all mock-only alpha tests passed.
  for(let i=0;i<16;i+=4){
   const lx=u.uBounds[0]+verts[i+2]*u.uBounds[2],ly=u.uBounds[1]+(1-verts[i+3])*u.uBounds[3];
   const x=u.uBody[0]+Math.cos(rotation)*lx*u.uTransform[2]-Math.sin(rotation)*ly*u.uTransform[3];
   const y=u.uBody[1]+Math.sin(rotation)*lx*u.uTransform[2]+Math.cos(rotation)*ly*u.uTransform[3];
   expect(verts[i]).toBeCloseTo(x,3);expect(verts[i+1]).toBeCloseTo(y,3);
  }
  let visibleGroundPixels=0;
  // Evaluate the actual four selected raw atlas channels on the common world canvas.
  for(let y=u.uBounds[1]+.25;y<u.uBounds[1]+u.uBounds[3];y+=1)
   for(let x=u.uBounds[0]+.25;x<u.uBounds[0]+u.uBounds[2];x+=1){
    if(Math.hypot(x,y)<25)continue; // strictly outside the body's 38.4px canvas
    let mask=0;
    for(let i=0;i<4;i++){
     const b=u['uBounds'+i],uv=u['uUv'+i],qx=(x-b[0])/b[2],qy=(y-b[1])/b[3];
     if(qx<0||qx>=1||qy<0||qy>=1)continue;
     const tex=shader.textures[i].source[0].glTexture;
     const px=Math.floor((uv[0]+qx*uv[2])*tex.width),py=Math.floor((uv[1]+qy*uv[3])*tex.height);
     mask+=tex.data.pixels[(py*tex.width+px)*4+u.uChannels[i]]/255*u.uWeights[i];
    }
    if(mask*u.uStrength[0]>.1)visibleGroundPixels++;
   }
  expect(visibleGroundPixels).toBeGreaterThan(0);
  const status=f.renderer.inspect();expect(status.activeInstances).toBe(1);
  expect(status.instances[0].opacityAtBody.effective).toBeGreaterThan(0);
  expect(status.instances[0].coreDarkeningEstimate).toBeGreaterThan(0);
  expect(status.instances[0].coreDarkeningEstimate).toBeLessThan(status.instances[0].opacityAtBody.effective);
 }
 const shader=state.shaders[0];f.renderer.setDebugSolid(true);shader.renderNode.run(context,shader);
 expect(uniforms(shader).uDebugSolid).toBe(1);expect(f.renderer.inspect().instances[0].solid).toBe(true);
 f.renderer.setVisible(false);expect(f.renderer.inspect().activeInstances).toBe(0);
 f.renderer.destroy();
});

import { CharacterMeshShadowRenderer } from '../src/effects/CharacterMeshShadowRenderer';
import { preloadCharacterMeshAssets, getCharacterMeshes } from '../src/assets/CharacterMeshAssets';
import { meshForHeldTexture } from '../src/effects/CharacterMeshModel';
import { readFile } from 'node:fs/promises';
async function meshFixture(){
 const f=fixture(), binaries=new Map<string,ArrayBuffer>(), loads:any[]=[];
 f.scene.cache={binary:{exists:(k:string)=>binaries.has(k),get:(k:string)=>binaries.get(k)}};
 f.scene.load.binary=(key:string,url:string)=>loads.push({key,url});
 // Material pages are already loaded in this mesh-only renderer fixture.
 for(const page of CHARACTER_MATERIAL_PAGES)f.scene.textures.get(page.key);
 preloadCharacterMeshAssets(f.scene);
 for(const load of loads){const b=await readFile('public/'+load.url.replace(/^\.\//,'').split('?')[0]);binaries.set(load.key,Uint8Array.from(b).buffer);}
 const renderer=f.scene.sys.renderer;
 renderer.config={stencil:true};
 renderer.glWrapper.update=vi.fn();renderer.deleteBuffer=vi.fn();renderer.deleteProgram=vi.fn();renderer.off=vi.fn();
 renderer.glVAOWrappers=[];renderer.shaderProgramFactory={programs:{}};renderer.renderNodes.off=vi.fn();
 renderer.drawElements.mockImplementation((context:any,textures:any,program:any,vao:any,count:number)=>{
   state.draws.push({context,uniforms:structuredClone(program.uniforms),count,blend:context.state.blend});
 });
 state.draws.length=0;
 const meshes=getCharacterMeshes(f.scene)!;
 const meshRenderer=new CharacterMeshShadowRenderer(f.scene,f.clouds,f.receiver,meshes,128);
 return {...f,meshRenderer,meshes};
}
it('binary manifest reaches projected indexed draws and one visible receiver-masked composite',async()=>{
 const f=await meshFixture(),p=player();
 p.weapon.texture.key=meshForHeldTexture.keys().next().value!;
 Object.assign(p.weapon,{displayWidth:38.4,displayHeight:38.4});
 p.weapon.frame.realWidth=p.weapon.frame.realHeight=128;
 f.receiver.update({rocks:[],water:[]} as never,0,0,undefined,[],[]);
 for(const minute of [480,720,1020])for(const angle of [0,.123,Math.PI/2,5.9]){
  resolveSunPath(minute,null,f.clouds.sunPath);p.displayObject.rotation=angle;
  f.meshRenderer.sync([p] as never,true);
  const status=f.meshRenderer.inspect(),instance=status.instances[0];
  expect(instance.visible).toBe(true);expect(instance.pose).toBe(17);expect(instance.weapon).not.toBeNull();
  expect(instance.depth).toBeGreaterThan(DEPTH.ROCK_VEGETATION+.02);expect(instance.depth).toBeLessThan(DEPTH.PLAYERS);
  expect(instance.coreDarkeningEstimate).toBeGreaterThan(0);expect(status.costs.geometryDraws).toBe(2);
  const geometry=state.draws.filter(d=>d.uniforms.uModel);
  expect(geometry.at(-2)!.count).toBe(f.meshes.get('badger')!.indices.length);
  expect(geometry.at(-2)!.uniforms.uSun).toEqual(f.clouds.sunPath.sun);
  expect(geometry.every(d=>d.blend.enabled===false)).toBe(true); // union, never accumulated alpha
  const quad=state.shaders.at(-1),context:any={renderer:f.scene.sys.renderer,camera:f.scene.cameras.main,state:{blend:{name:'prior'}},blendMode:0};
  quad.renderNode.run(context,quad);
  const u=uniforms(quad),verts=quad.renderNode.vertexBufferLayout.buffer.viewF32;
  for(let i=0;i<16;i+=4){
   expect(verts[i]).toBeCloseTo(u.uBounds[0]+verts[i+2]*u.uBounds[2],3);
   expect(verts[i+1]).toBeCloseTo(u.uBounds[1]+(1-verts[i+3])*u.uBounds[3],3);
  }
  expect(context.state.blend).toEqual({name:'prior'});
 }
 f.meshRenderer.sync([p] as never,true);expect(f.meshRenderer.inspect().costs.uploadedBytes).toBe(0);
 expect(f.meshRenderer.inspect().costs.targetPasses).toBe(0);
 p.displayObject.frame.name='4';f.meshRenderer.sync([p] as never,true);
 expect(f.meshRenderer.inspect().costs.uploadedBytes).toBe(f.meshes.get('badger')!.spec.vertexCount*3*4);
 f.meshRenderer.destroy();
 expect(f.scene.sys.renderer.deleteBuffer).toHaveBeenCalledTimes(4);
});

it('reuses identical mesh masks but redraws pose, transform, sunlight, weapon and restored textures',async()=>{
 const f=await meshFixture(),p=player();p.getHeldItemDisplayObject=()=>null as any;
 f.meshRenderer.sync([p] as never,true);expect(f.meshRenderer.inspect().costs.targetPasses).toBe(3);
 for(const change of [()=>{p.displayObject.frame.name='4';},()=>{p.displayObject.x+=.01;},
  ()=>{p.displayObject.rotation+=.01;},()=>{f.clouds.sunPath.sun[0]+=.001;}]){
  f.meshRenderer.sync([p] as never,true);expect(f.meshRenderer.inspect().costs.targetPasses).toBe(0);
  change();f.meshRenderer.sync([p] as never,true);expect(f.meshRenderer.inspect().costs.targetPasses).toBe(3);
 }
 // The display keeps opacity/cloud updates; they do not change the union mask.
 p.displayObject.alpha=.5;f.clouds.timeSec+=1;f.meshRenderer.sync([p] as never,true);
 expect(f.meshRenderer.inspect().costs.targetPasses).toBe(0);
 expect(f.meshRenderer.inspect().instances[0].opacityAtBody.sprite).toBe(.5);
 p.weapon.texture.key=meshForHeldTexture.keys().next().value!;
 Object.assign(p.weapon,{displayWidth:38.4,displayHeight:38.4});
 p.weapon.frame.realWidth=p.weapon.frame.realHeight=128;
 p.getHeldItemDisplayObject=()=>p.weapon;
 f.meshRenderer.sync([p] as never,true);expect(f.meshRenderer.inspect().costs.targetPasses).toBe(3);
 f.meshRenderer.sync([p] as never,true);expect(f.meshRenderer.inspect().costs.targetPasses).toBe(0);
 p.getHeldItemDisplayObject=()=>null as any;
 f.meshRenderer.sync([p] as never,true);expect(f.meshRenderer.inspect().costs.targetPasses).toBe(3);
 const slot=(f.meshRenderer as any).pool[0];slot.raw.shader.glTexture={webGLTexture:{}};
 f.meshRenderer.sync([p] as never,true);expect(f.meshRenderer.inspect().costs.targetPasses).toBe(3);
 f.meshRenderer.destroy();
});
it('reuses bounded slots, excludes hidden players, supports raw-mask debug and leaves only contact at night',async()=>{
 const f=await meshFixture(),p=player();p.getHeldItemDisplayObject=()=>null as any;
 f.meshRenderer.sync([p] as never,true);const allocated=state.shaders.length;
 for(const phase of ['underground','trapped']){p.getBurrowPhase=()=>phase;f.meshRenderer.sync([p] as never,true);expect(f.meshRenderer.activeCount).toBe(0);}
 p.getBurrowPhase=()=> 'surface';p.isDecoyStealthedVisual=()=>true;f.meshRenderer.sync([p] as never,true);expect(f.meshRenderer.activeCount).toBe(0);
 p.isDecoyStealthedVisual=()=>false;f.meshRenderer.sync([],true);f.meshRenderer.sync([p] as never,true);
 expect(state.shaders.length).toBe(allocated);expect(f.meshRenderer.count).toBe(1);
 f.meshRenderer.setDebugSolid(true);f.meshRenderer.sync([p] as never,true);
 expect(f.meshRenderer.inspect().costs.targetPasses).toBe(1);
 expect(uniforms(state.shaders.at(-1)).uDebugSolid).toBe(1);
 f.meshRenderer.setDebugSolid(false);f.clouds.sunPath.strength=0;f.meshRenderer.sync([p] as never,true);
 expect(f.meshRenderer.inspect().costs.geometryDraws).toBe(0);
 expect(f.meshRenderer.inspect().instances[0].opacityAtBody.direct).toBe(0);
 expect(f.meshRenderer.inspect().instances[0].opacityAtBody.contact).toBeGreaterThan(0);
 f.meshRenderer.setVisible(false);expect(f.meshRenderer.activeCount).toBe(0);
 f.meshRenderer.destroy();expect(state.shaders.every(shader=>shader.destroyed)).toBe(true);
});

it('caps the slot pool at twelve and recycles departed assignments without allocating targets',async()=>{
 const f=await meshFixture(),players=Array.from({length:13},()=>player());
 for(const p of players)p.getHeldItemDisplayObject=()=>null as any;
 f.meshRenderer.sync(players as never,true);
 expect(f.meshRenderer.count).toBe(config.maxPlayers);expect(f.meshRenderer.activeCount).toBe(config.maxPlayers);
 expect(f.meshRenderer.inspect().costs.geometryDraws).toBe(config.maxPlayers);
 expect(f.meshRenderer.inspect().costs.targetBytes).toBe(config.maxPlayers*128*128*4*3);
 const allocated=state.shaders.length;
 f.meshRenderer.sync([players[12]] as never,true);expect(f.meshRenderer.activeCount).toBe(1);
 expect(state.shaders.length).toBe(allocated);f.meshRenderer.destroy();
});

import { CHARACTER_MATERIAL_PAGES } from '../src/assets/CharacterMaterialAssetManifest';

it('uploads receiver rows in world order even after image uploads leave flipY enabled',()=>{
 const f=fixture();
 const unpack={flipY:true,premultiplyAlpha:true};
 let uploaded=new Uint8Array();
 // Emulate the real upload conversion: CPU-only sampling misses a mirrored GPU mask.
 f.scene.sys.renderer.glWrapper.updateTexturing=({texturing}:any)=>Object.assign(unpack,texturing);
 f.scene.sys.renderer.gl.texSubImage2D.mockImplementation((_t:any,_l:any,_x:any,_y:any,w:number,h:number,_f:any,_type:any,data:Uint8Array)=>{
  uploaded=new Uint8Array(data.length);
  for(let row=0;row<h;row++){
   const source=unpack.flipY?h-row-1:row;
   uploaded.set(data.subarray(source*w*4,(source+1)*w*4),row*w*4);
  }
 });
 const layout:any={rocks:[{gridX:0,gridY:0}],water:[{gridX:1,gridY:1}]};
 for(const visible of [true,false,true]){
  unpack.flipY=true;unpack.premultiplyAlpha=true;
  f.receiver.update(layout,0,0,()=>visible,[],[{x:80,y:16}]);
  const cols=f.receiver.world[2]/CELL_SIZE,rows=f.receiver.world[3]/CELL_SIZE;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
   expect(uploaded[(row*cols+col)*4]/255).toBe(f.receiver.sample((col+.5)*CELL_SIZE,(row+.5)*CELL_SIZE));
  }
  expect(unpack).toEqual({flipY:false,premultiplyAlpha:false});
 }
 f.renderer.destroy();
});
