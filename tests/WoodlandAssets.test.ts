import { it, expect, vi, afterEach } from 'vitest';
vi.mock('phaser',()=>({Textures:{FilterMode:{LINEAR:0}},Loader:{FileTypes:{ImageFile:class {
  data:any; cache:any; key:string; url:string; complete=false;error=false;
  constructor(public loader:any,config:any){this.key=config.key;this.url=config.url;}
  onProcessComplete(){this.complete=true;}onProcessError(){this.error=true;}
}}}}));
import { preloadWoodlandAssets, assertWoodlandAssetsReady, WoodlandImageFile } from '../src/assets/WoodlandAssets';
import { woodlandAssetFiles, woodlandAssetBytes, WOODLAND_ROCK_COLOUR_KEY, WOODLAND_ROCK_COVERAGE_KEY } from '../src/assets/WoodlandAssetManifest';
afterEach(()=>vi.unstubAllGlobals());
function fixture(limit=8192){
  const entries=new Map(),binaryEntries=new Map(),files:any[]=[];
  const binary={exists:(k:string)=>binaryEntries.has(k),add:(k:string,v:any)=>binaryEntries.set(k,v),remove:(k:string)=>binaryEntries.delete(k)};
  const textures:any={exists:(k:string)=>entries.has(k),get:(k:string)=>entries.get(k),remove:vi.fn((k:string)=>entries.delete(k))};
  for(const method of ['addImage','addAtlas','addSpriteSheet','addGLTexture'])textures[method]=vi.fn((key:string)=>{const t={setFilter:vi.fn()};entries.set(key,t);return t;});
  const renderer={gl:{MAX_TEXTURE_SIZE:1,getParameter:()=>limit,LINEAR:2,CLAMP_TO_EDGE:3,RGBA:4},createTexture2D:vi.fn(()=>({destroy:vi.fn()}))};
  const scene:any={sys:{renderer},textures,cache:{binary}};
  scene.load={scene,textureManager:textures,cacheManager:{binary},addFile:(f:any)=>files.push(f)};
  return {scene,files,entries,binaryEntries,renderer,textures};
}
it.each([4096,4351,4352,8192])('downloads one selected V7 atlas and scales every frame parameter at limit %i',limit=>{
  const f=fixture(limit);preloadWoodlandAssets(f.scene);const files=woodlandAssetFiles(limit);
  expect(f.files.map(x=>x.url)).toEqual(files.map(x=>x.url));
  const colour=f.files.filter(x=>x.key===WOODLAND_ROCK_COLOUR_KEY);expect(colour).toHaveLength(1);
  const scale=limit>=4352?2:1;expect(colour[0].url.endsWith(scale===2?'mineral-colour-2x.png':'mineral-colour.png')).toBe(true);
  colour[0].data={width:2176*scale,height:1870*scale};colour[0].onProcessComplete();
  expect(f.textures.addSpriteSheet.mock.lastCall[2]).toEqual({frameWidth:32*scale,frameHeight:32*scale,margin:scale,spacing:2*scale});
  expect(colour[0].complete).toBe(true);
});
it('uploads data channels once with linear filtering, no canvas, no PMA; reuses game caches',()=>{
  const f=fixture();for(const asset of woodlandAssetFiles(8192).filter(a=>a.kind==='data')){
    const file:any=new WoodlandImageFile(f.scene.load,asset);file.data={width:asset.width,height:asset.height};file.onProcessComplete();file.addToCache();
    expect(file.complete).toBe(true);expect(file.error).toBe(false);
    expect(f.renderer.createTexture2D.mock.lastCall).toEqual([0,2,2,3,3,4,file.data,asset.width,asset.height,false,false,false]);
  }
  expect(f.textures.addImage).not.toHaveBeenCalled();expect(f.textures.addGLTexture).toHaveBeenCalledTimes(3);
  preloadWoodlandAssets(f.scene);expect(f.files.some(x=>x.asset.kind==='data')).toBe(false);
});
it('stores exact coverage alpha in the CPU cache, never on the GPU',()=>{
  const f=fixture();const canvas:any={getContext:()=>({drawImage:vi.fn(),getImageData:()=>({data:new Uint8ClampedArray([255,255,255,0,255,255,255,123,255,255,255,255])})})};
  vi.stubGlobal('document',{createElement:()=>canvas});
  const file:any=new WoodlandImageFile(f.scene.load,{key:WOODLAND_ROCK_COVERAGE_KEY,url:'coverage.png',kind:'coverage',width:3,height:1,downloadBytes:1});
  file.data={width:3,height:1};file.onProcessComplete();expect(file.complete).toBe(true);
  expect([...f.binaryEntries.get(WOODLAND_ROCK_COVERAGE_KEY)]).toEqual([0,123,255]);expect(f.entries.size).toBe(0);expect(canvas.width).toBe(0);
});
it('finishes processing errors and fails readiness for the existing BootPreparation retry path',()=>{
  const f=fixture(),asset=woodlandAssetFiles(8192).find(a=>a.kind==='data')!;
  const file:any=new WoodlandImageFile(f.scene.load,asset);file.data={width:1,height:1};file.onProcessComplete();
  expect(file.error).toBe(true);expect(file.complete).toBe(false);expect(()=>assertWoodlandAssetsReady(f.scene)).toThrow('Waldgrafik');
  file.data={width:asset.width,height:asset.height};f.renderer.createTexture2D.mockImplementationOnce(()=>{throw Error('GPU');});
  file.onProcessComplete();expect(f.entries.has(asset.key)).toBe(false);
  file.error=false;file.onProcessComplete();expect(file.complete).toBe(true);expect(file.error).toBe(false);
  for(const a of woodlandAssetFiles(8192))if(a.kind==='coverage')f.binaryEntries.set(a.key,new Uint8Array(1));else f.entries.set(a.key,{});
  expect(()=>assertWoodlandAssetsReady(f.scene)).not.toThrow();preloadWoodlandAssets(f.scene);expect(f.files).toHaveLength(0);
  expect(woodlandAssetBytes(8192).coverageCPU).toBe(2176*1870);
});
