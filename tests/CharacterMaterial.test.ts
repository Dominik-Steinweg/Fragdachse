import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { characterFormFactor, characterLocalVector, characterLightWeight, characterLightBlockedRect } from '../src/effects/CharacterMaterialModel';
import { characterMaterialFrame, CHARACTER_MATERIAL_PAGES } from '../src/assets/CharacterMaterialAssetManifest';
import { CHARACTER_MATERIAL_HEADER, CHARACTER_MATERIAL_PROCESS, characterMaterialInsertionIndex, characterGLSLFloat } from '../src/effects/CharacterMaterialShader';
import { preloadCharacterMaterialAssets, assertCharacterMaterialAssetsReady } from '../src/assets/CharacterMaterialAssets';
import { createSunPath, resolveSunPath } from '../src/effects/sunlight/SunPath';
import { createSunTuning } from '../src/effects/sunlight/SunAtmosphere';
import { guardPhaserUnpremultiply } from '../src/graphics/PhaserAlphaZero';

it('emits GLSL floats even when tuning becomes integral',()=>{
  for(const value of [0,1,-1,2,.2,.0000001,1e21]) {
    const literal=characterGLSLFloat(value);
    expect(literal).toMatch(/[.eE]/);expect(Number(literal)).toBe(value);
  }
  for(const value of [NaN,Infinity,-Infinity])expect(()=>characterGLSLFloat(value)).toThrow();
  const tokens=CHARACTER_MATERIAL_HEADER.replace(/\/\/[^\n]*/g,'').match(/[A-Za-z_]\w*|(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?|[^\s]/g)!;
  for(let i=0;i<tokens.length;i++)if(/^\d+$/.test(tokens[i])) {
    // Constructor integers are legal; arithmetic operands require floats.
    expect([tokens[i-1],tokens[i+1]].some(t=>t!==undefined&&/^[*/+\-]$/.test(t)),tokens.slice(i-2,i+3).join(' ')).toBe(false);
  }
});

vi.mock('phaser', async () => {
  const { createRequire }=await import('node:module');
  const { resolve }=await import('node:path');
  const require=createRequire(import.meta.url);
  const Program=require(resolve('node_modules/phaser/src/renderer/webgl/ProgramManager.js'));
  return {Renderer:{Events:{SET_PARALLEL_TEXTURE_UNITS:'parallel',RESIZE:'resize'},WebGL:{RenderNodes:{
    RenderNode:class {run=()=>{};constructor(public name:string,public manager:any){}},
    BatchHandlerQuadSingle:class {
      programManager:any;vertexBufferLayout={buffer:{}};indexBuffer={};renderer:any;
      setupUniforms(){}updateTextureCount(){}resize(){}
      constructor(public manager:any){
        this.renderer=manager.renderer;this.programManager=new Program(this.renderer,[]);
        this.programManager.setBaseShader('STANDARD_SINGLE','',require(resolve('node_modules/phaser/src/renderer/webgl/shaders/Multi-frag.js')));
        for(const name of ['MakeGetTexCoordOut','MakeGetTexRes','MakeSmoothPixelArt','MakeDefineTexCount','MakeGetTexture','MakeApplyTint']) {
          const make=require(resolve('node_modules/phaser/src/renderer/webgl/shaders/additionMakers/'+name+'.js'));
          this.programManager.addAddition(make(name==='MakeDefineTexCount'?1:undefined));
        }
        this.renderer.batches.push(this);
      }
    }
  }}},Utils:{Array:{Remove(){}}}};
});
import { attachCharacterMaterial, syncCharacterMaterialCopy, bindCharacterMaterialSunlight,
  setCharacterMaterialSuppressed, characterMaterialStatus } from '../src/effects/CharacterMaterialLighting';
const quality=vi.hoisted(()=>({level:'high'}));
vi.mock('../src/graphics/GraphicsQuality',()=>({getGraphicsQualityProfile:()=>quality}));

it('flat normal is neutral under sun, clouds, night and local lights', () => {
  for (const strength of [0,.1,.6,1]) for (const sun of [[0,0,1],[.8,0,.6],[0,-.98,.2]]) {
    for (const locals of [[], [[.8,0,.6,.9],[0,.6,.8,.5]]]) {
      expect(characterFormFactor([0,0,1],sun,strength,1,locals)).toBeCloseTo(1,14);
      for(const normal of [[0,0,0],[0,0,-1],[1,0,0],[-1,0,0]]) for(const ao of [0,1]) {
        const response=characterFormFactor(normal,sun,strength,ao,locals);
        expect(Number.isFinite(response)).toBe(true);expect(response).toBeGreaterThan(0);
      }
    }
  }
  expect(characterFormFactor([1,0,0],[0,0,1],0,0)).toBe(1);
});
it('uses inverse displayed rotation with asset right/south/up axes and flip',()=>{
  const out=[0,0,0];
  for(let rotation=-7;rotation<7;rotation+=.1) {
    characterLocalVector(Math.cos(rotation),Math.sin(rotation),0,rotation,false,false,out);
    expect(out[0]).toBeCloseTo(1);expect(out[1]).toBeCloseTo(0);
  }
  characterLocalVector(0,-1,0,0,false,true,out);expect(out).toEqual([0,1,0]);
});
it('material frame resolves both resolutions and never loads D-mask pages',()=>{
  expect(CHARACTER_MATERIAL_PAGES).toHaveLength(4);
  for(const page of CHARACTER_MATERIAL_PAGES)expect(['albedo','normal']).toContain(page.pass);
  for(let pose=0;pose<37;pose++)for(const high of [false,true]) {
    const frame=characterMaterialFrame(String(pose),high);expect(frame.pose).toBe(pose);
    for(const layer of [frame.albedo,frame.normal]) {
      const page=CHARACTER_MATERIAL_PAGES.find(p=>p.key===layer.key)!;
      expect(layer.uv[2]*page.width).toBeCloseTo(high?128:64);
    }
  }
});
it('night port uses radial falloff, flashlight cone and receiver occlusion',()=>{
  const light={x:0,y:0,radiusPx:100,effectiveIntensity:1,shape:'cone',angle:0,coneAngle:Math.PI/2};
  expect(characterLightWeight(light,50,0)).toBe(.25);
  expect(characterLightWeight(light,0,50)).toBe(0);
  expect(characterLightWeight(light,0,0)).toBe(1);
  expect(characterLightWeight({...light,radiusPx:0},0,0)).toBe(0);
  expect(characterLightBlockedRect(0,0,100,0,40,-10,60,10)).toBe(true);
  expect(characterLightBlockedRect(0,0,100,0,40,10,60,20)).toBe(false);
  expect(characterLightBlockedRect(0,0,100,0,-5,-5,5,5)).toBe(false);
});

function fixture() {
  const require=createRequire(import.meta.url),Factory=require(resolve('node_modules/phaser/src/renderer/webgl/ShaderProgramFactory.js'));
  const textureMap=new Map<string,any>(),files:any[]=[],listeners=new Map<string,Function>();
  const renderer:any={gl:{LINEAR:9729,CLAMP_TO_EDGE:33071,RGBA:6408},batches:[],glVAOWrappers:[],off:vi.fn(),deleteBuffer:vi.fn(),
    glTextureUnits:{bind:vi.fn()},createTexture2D:vi.fn((...args:any[])=>({args,destroy:vi.fn()})),
    createProgram:vi.fn((vertex:string,fragment:string)=>({vertex,fragment}))};
  renderer.shaderProgramFactory=new Factory(renderer);
  const manager:any={renderer,off:vi.fn(),currentBatchNode:null,finishBatch(){this.currentBatchNode?.setupUniforms({});this.currentBatchNode=null;}};
  renderer.renderNodes=manager;
  const scene:any={sys:{renderer},textures:{exists:(key:string)=>textureMap.has(key),get:(key:string)=>textureMap.get(key),
    addGLTexture:(key:string,wrapper:any)=>{const texture={source:[{glTexture:wrapper}]};textureMap.set(key,texture);return texture;}},
    load:{on:(name:string,fn:Function)=>listeners.set(name,fn),off:(name:string)=>listeners.delete(name),image:(key:string,url:string)=>{
      const page=CHARACTER_MATERIAL_PAGES.find(p=>p.key===key)!;
      const file={loader:scene.load,data:{width:page.width,height:page.height},onProcessComplete:vi.fn(),onProcessError:vi.fn(),addToCache:vi.fn(),key,url};
      listeners.get('addfile')!(key,'image',scene.load,file);files.push(file);
    }}};
  scene.load.scene=scene;scene.load.systems={game:{}};
  const lighting:any={sampleCharacterMaterialLights:vi.fn((_x:number,_y:number,lights:any[])=>{for(const light of lights)light.weight=0;})};
  let customDraws=0,beautyDraws=0;
  const image=()=>{
    const img:any={scene,x:30,y:40,rotation:0,scaleX:.3,scaleY:.3,flipX:false,flipY:false,visible:true,alpha:.6,
      frame:{name:17,u0:.2,v0:.3,u1:.3,v1:.4},texture:{key:'Beauty'},tintTopLeft:0xff0022,
      customRenderNodes:{},renderNodeData:{},defaultRenderNodes:{Submitter:{run(){
        if(img.customRenderNodes.BatchHandler){manager.currentBatchNode=img.customRenderNodes.BatchHandler;customDraws++;}else beautyDraws++;
      }}},once:vi.fn(),off:vi.fn(),setRenderNodeRole(role:string,node:any){if(node)this.customRenderNodes[role]=node;else delete this.customRenderNodes[role];}};
    return img;
  };
  const draw=(img:any)=>(img.customRenderNodes.Submitter??img.defaultRenderNodes.Submitter).run({},img);
  const clouds={tuning:createSunTuning(),timeSec:123,strength:1,sunPath:resolveSunPath(480,null,createSunPath())};
  return {scene,renderer,files,lighting,image,draw,clouds,counts:()=>({customDraws,beautyDraws})};
}
it('manifest -> raw upload -> real assembled shader -> current-pose draw before tint; fallbacks and lifetime',()=>{
  quality.level='high';const f=fixture(),body=f.image(),copy=f.image();
  expect(()=>assertCharacterMaterialAssetsReady(f.scene)).toThrow();
  preloadCharacterMaterialAssets(f.scene);expect(f.files).toHaveLength(4);
  for(const file of f.files){expect(file.url).toMatch(/\?v=[a-f0-9]{64}$/);file.onProcessComplete();}
  assertCharacterMaterialAssetsReady(f.scene);
  for(const call of f.renderer.createTexture2D.mock.calls)expect(call.slice(9)).toEqual([false,false,false]);
  preloadCharacterMaterialAssets(f.scene);expect(f.files).toHaveLength(4);
  const release=attachCharacterMaterial(body,f.lighting);syncCharacterMaterialCopy(body,copy);
  const releaseOldWorld=bindCharacterMaterialSunlight(f.scene,{...f.clouds});
  bindCharacterMaterialSunlight(f.scene,f.clouds);releaseOldWorld();
  f.draw(body);f.draw(copy);expect(f.counts().customDraws).toBe(2);expect(f.renderer.batches).toHaveLength(1);
  const batch=f.renderer.batches[0],p=batch.programManager;
  const cfg=p.currentConfig;
  const tint=cfg.additions.find((a:any)=>a.name==='Tint');tint.additions.fragmentHeader=guardPhaserUnpremultiply(tint.additions.fragmentHeader);
  const shader=f.renderer.shaderProgramFactory.getShaderProgram(cfg.base,cfg.additions,cfg.features).fragment;
  expect(shader).not.toContain('#pragma phaserTemplate');
  expect(shader.indexOf(CHARACTER_MATERIAL_PROCESS)).toBeLessThan(shader.indexOf('fragColor = applyTint(fragColor)'));
  expect(shader).toContain('texture.a <= 0.0');
  expect(shader).toContain('return vec4(colour*beauty.a,beauty.a)');
  expect(characterMaterialInsertionIndex(cfg.additions)).toBeGreaterThan(0);
  expect(()=>characterMaterialInsertionIndex([])).toThrow();
  expect(p.uniforms.uCharacterAlbedoUV).toEqual(characterMaterialFrame(17,true).albedo.uv);
  expect(p.uniforms.uCharacterStrength).toBeGreaterThan(0);
  const direction=[...p.uniforms.uCharacterSun];body.rotation=Math.PI/2;body.frame.name=23;f.draw(body);
  expect(p.uniforms.uCharacterSun[0]).toBeCloseTo(direction[1]);expect(p.uniforms.uCharacterSun[1]).toBeCloseTo(-direction[0]);
  expect(characterMaterialStatus(f.scene)).toMatchObject({instances:1,copies:1,pose:23,loadedPages:4,worldBound:true});
  expect(body.texture.key).toBe('Beauty');expect(body.tintTopLeft).toBe(0xff0022);expect(body.alpha).toBe(.6);
  body.scaleX*=2;f.draw(body);expect(p.uniforms.uCharacterNormalScale[0]*p.uniforms.uCharacterNormalScale[1]).toBeCloseTo(1);
  expect(p.uniforms.uCharacterNormalScale[0]).toBeLessThan(p.uniforms.uCharacterNormalScale[1]);
  quality.level='medium';f.draw(body);expect(p.uniforms.uCharacterAlbedoUV).toEqual(characterMaterialFrame(23,false).albedo.uv);
  quality.level='low';f.draw(body);quality.level='high';
  setCharacterMaterialSuppressed(f.scene,true);f.draw(body);setCharacterMaterialSuppressed(f.scene,false);
  bindCharacterMaterialSunlight(f.scene,null);f.draw(body);expect(f.counts().beautyDraws).toBe(3);
  bindCharacterMaterialSunlight(f.scene,f.clouds);f.clouds.sunPath.strength=0;f.draw(body);expect(p.uniforms.uCharacterStrength).toBe(0);
  syncCharacterMaterialCopy(null,copy);expect(copy.customRenderNodes.Submitter).toBeUndefined();
  release();expect(body.customRenderNodes.Submitter).toBeUndefined();expect(f.renderer.deleteBuffer).toHaveBeenCalledTimes(2);
  expect(characterMaterialStatus(f.scene)).toMatchObject({available:false,instances:0});
  bindCharacterMaterialSunlight(f.scene,null);
});
it('raw material pages match the publication hash, encoding and dimensions',async()=>{
  const {createHash}=await import('node:crypto');const sharp=(await import('sharp')).default;
  for(const page of CHARACTER_MATERIAL_PAGES) {
    const bytes=readFileSync('public/'+page.file);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(page.sha256);
    const meta=await sharp(bytes).metadata();expect([meta.width,meta.height]).toEqual([page.width,page.height]);
    expect(page.premultiplied).toBe(false);
    expect(page.encoding).toBe(page.pass==='normal'?'unorm8-linear-rgb-normal-a-ao':'srgb8-straight-rgba');
  }
});
it('material GLSL declares all consumed uniforms and does not own colour grading or blend state',()=>{
  const declared=new Set([...CHARACTER_MATERIAL_HEADER.matchAll(/uniform\s+\w+\s+([^;]+);/g)].flatMap(m=>m[1].split(',').map(s=>s.trim())));
  for(const m of CHARACTER_MATERIAL_HEADER.replace(/\/\/[^\n]*/g,'').matchAll(/\bu[A-Z]\w*/g))expect(declared).toContain(m[0]);
  expect(CHARACTER_MATERIAL_HEADER).not.toMatch(/uSunColor|uAmbientColor/);
  const entity=readFileSync('src/entities/PlayerEntity.ts','utf8');
  expect(entity).toContain('attachCharacterMaterial(this.sprite, lighting)');
  expect(entity).toContain('[this.spawnShine, this.stealthShell, this.stealthScan]');
});

import { characterMaterialColour, characterLinear, characterSRGB } from '../src/effects/CharacterMaterialModel';
import { CHARACTER_MATERIAL_MANIFEST as materialManifest } from '../src/assets/CharacterMaterialAssetManifest';
it('37 real poses x 16 rotations x four suns retain finite radiance and calibrate noon to Beauty',async()=>{
 const sharp=(await import('sharp')).default;
 const materialPages=new Set(materialManifest.samples.filter(s=>s.pass==='albedo'||s.pass==='normal').map(s=>s.page));
 const pages=await Promise.all(materialManifest.pages.map((p,i)=>materialPages.has(i)?sharp('public/'+p.file).ensureAlpha().raw().toBuffer():null));
 const beauty=await sharp('public/assets/sprites/pipeline-v2/badger/sheet.png').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let checked=0,minFactor=Infinity,maxFactor=0,emptyOpaqueSamples=0,maxNoonError=0,minRatio=Infinity,maxRatio=0;
 for(let pose=0;pose<37;pose++) {
  const get=(pass:string)=>materialManifest.samples.find(s=>s.pose===pose&&s.pass===pass&&s.sourceSize===128)!;
  const a=get('albedo'),n=get('normal'),samples:{a:number[],n:number[],ao:number,b:number[]}[]=[];
  for(let y=0;y<128;y++)for(let x=0;x<128;x++) {
   const ai=((a.rect[1]+y)*materialManifest.pages[a.page].width+a.rect[0]+x)*4;
   const ni=((n.rect[1]+y)*materialManifest.pages[n.page].width+n.rect[0]+x)*4;
   const bi=((2+Math.floor(pose/8)*132+y)*beauty.info.width+2+pose%8*132+x)*4;
   if(beauty.data[bi+3]<241)continue;
   if(pages[a.page]![ai+3]===0)emptyOpaqueSamples++;
   samples.push({a:Array.from(pages[a.page]!.subarray(ai,ai+3),v=>v/255),
    n:Array.from(pages[n.page]!.subarray(ni,ni+3),v=>v/127.5-1),ao:pages[n.page]![ni+3]/255,
    b:Array.from(beauty.data.subarray(bi,bi+3),v=>v/255)});
  }
  for(const minute of [480,720,1020,0])for(let turn=0;turn<16;turn++) {
   const path=resolveSunPath(minute,null,createSunPath()),sun=[0,0,0];
   characterLocalVector(...path.sun,turn*Math.PI/8,false,false,sun);
   const sums=[0,0,0],reference=[0,0,0];
   for(const sample of samples) {
    const factor=characterFormFactor(sample.n,sun,path.strength,sample.ao),colour=characterMaterialColour(sample.a,factor);
    minFactor=Math.min(minFactor,factor);maxFactor=Math.max(maxFactor,factor);checked++;
    if(!Number.isFinite(factor)||factor<=0||colour.some(c=>!Number.isFinite(c)||c<0))throw Error('Invalid material at '+JSON.stringify({pose,minute,turn,sample,factor,colour}));
    if(minute===720)for(let c=0;c<3;c++){sums[c]+=colour[c];reference[c]+=sample.b[c];}
   }
   if(minute===720)for(let c=0;c<3;c++){const r=sums[c]/reference[c];minRatio=Math.min(minRatio,r);maxRatio=Math.max(maxRatio,r);maxNoonError=Math.max(maxNoonError,Math.abs(r-1));}
  }
 }
 expect(emptyOpaqueSamples).toBe(0);expect(checked).toBeGreaterThan(10_000_000);
 console.info('noon ratios',{minRatio,maxRatio});expect(maxNoonError).toBeLessThan(.05);
 expect(minFactor).toBeGreaterThan(0);expect(maxFactor).toBeLessThan(5);
 console.info('21e2 material reference', {checked,minFactor,maxFactor,maxNoonError});
},120000);
it('sRGB round trip is defined at zero and does not double-decode albedo',()=>{
 for(const c of [0,1/255,.02,.2,.5,1,2])expect(characterSRGB(characterLinear(c))).toBeCloseTo(c,12);
 expect(CHARACTER_MATERIAL_PROCESS).toContain('texCoord');
 expect(CHARACTER_MATERIAL_PROCESS).not.toContain('outTexCoord');
});
