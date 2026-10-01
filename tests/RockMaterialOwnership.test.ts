import { WOODLAND_ROCK_HEIGHT_KEY, WOODLAND_ROCK_COLOUR_KEY } from '../src/assets/WoodlandAssetManifest';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ renderers: [] as any[], formations: [] as any[] }));
vi.mock('phaser', () => ({ Scenes: { Events: { PRE_RENDER: 'prerender' } } }));
vi.mock('../src/arena/rocks/ClassicRockRenderer', () => ({ ClassicRockRenderer: class {
  state: unknown; destroy = vi.fn(); applyDirty = vi.fn(); updateVisibility = vi.fn();
  constructor(...args:unknown[]) { this.state=args[4]??args[3];f.renderers.push(this); }
  setMaterialLighting(state: unknown) { this.state = state; }
} }));
vi.mock('../src/arena/rocks/PersistentGpuWorldSystem', async () => {
  const { ClassicRockRenderer } = await import('../src/arena/rocks/ClassicRockRenderer');
  return { PersistentGpuWorldSystem: class extends ClassicRockRenderer { getDiagnostics() { return {}; } } };
});
vi.mock('../src/arena/rocks/RockFormationLighting', () => ({ RockFormationLighting: class {
  destroy = vi.fn(); tick = vi.fn(); invalidate = vi.fn(); updateView = vi.fn();
  destructionLight = () => .5;
  colourKey: unknown;
  constructor(_scene: unknown, _frame: unknown, _states: unknown, state: {colourTextureKey?: string}, readonly heightKey: string) {
    this.colourKey=state.colourTextureKey;f.formations.push(this);
  }
} }));
import { RockVisualSystem } from '../src/arena/rocks/RockVisualSystem';
import { RockVisualStateStore, resolveRockCornerTints } from '../src/arena/rocks/RockVisualState';

afterEach(() => { vi.restoreAllMocks();f.renderers.length = 0; f.formations.length = 0; });
it('changes classic mineral texture in place while retaining frames and wall images', async()=>{
  const {ClassicRockRenderer}=await vi.importActual<typeof import('../src/arena/rocks/ClassicRockRenderer')>('../src/arena/rocks/ClassicRockRenderer');
  const {ArenaVisualFactory}=await import('../src/arena/ArenaVisualFactory');
  const images:any[]=[];
  const create=vi.spyOn(ArenaVisualFactory,'createRock').mockImplementation(()=>{
    const image:any={texture:{key:'rock_base'},frame:{name:0,realWidth:32,realHeight:32},scaleX:1,scaleY:1,destroy:vi.fn(),
      setTexture(key:string,frame:number){this.texture={key};return this.setFrame(frame);},
      setPosition(){return this;},setFrame(frame:number){const size=this.texture.key===WOODLAND_ROCK_COLOUR_KEY?64:32;this.frame={name:frame,realWidth:size,realHeight:size};return this;},
      setDisplaySize(){return this;},setScale(x:number,y:number){this.scaleX=x;this.scaleY=y;return this;},setAlpha(){return this;},setTint(){return this;},setVisible(){return this;}};
    images.push(image);return image;
  });
  const layer={active:true,setDepth(){return this;},setVisible:vi.fn(),destroy:vi.fn()};
  const store=new RockVisualStateStore();
  store.add({id:0,gridX:3,gridY:4,x:112,y:144,active:true,frame:7,cornerTints:[0xffffff,0xffffff,0xffffff,0xffffff],
    damageTint:0xffffff,ownerTintStrength:0,alpha:1,scaleX:1,scaleY:1});
  store.add({...store.get(0)!,id:1,gridX:4,material:'walls'});
  const renderer=new ClassicRockRenderer({add:{layer:()=>layer}} as never,{offsetX:0,offsetY:0,width:512,height:512},store.states);
  const frames=images.map(image=>image.frame.name), wallKey=images[1].texture.key;
  for(const key of [WOODLAND_ROCK_COLOUR_KEY,WOODLAND_ROCK_COLOUR_KEY,WOODLAND_ROCK_COLOUR_KEY]) {
    renderer.setMaterialLighting({material:'mineral',colourTextureKey:key,enabled:true,normals:false,strength:1,sun:[0,0,1]});
    expect(images[0].texture.key).toBe(key);expect(images[1].texture.key).toBe(wallKey);
    expect(images.map(image=>image.frame.name)).toEqual(frames);expect(create).toHaveBeenCalledTimes(2);
    for(const image of images){expect(image.frame.realWidth*image.scaleX).toBe(32);expect(image.frame.realHeight*image.scaleY).toBe(32);}
  }
  renderer.setMaterialLighting({material:'original',enabled:false,normals:false,strength:1,sun:[0,0,1]});
  expect(images[0].texture.key).toBe('rock_base');renderer.destroy();
  for(const image of images)expect(image.destroy).toHaveBeenCalledOnce();
});

it('constructs the production formation with V7 before materializing the rock renderer',()=>{
 const events=new EventEmitter(),store=new RockVisualStateStore();
 const system=new RockVisualSystem({events} as never,{offsetX:0,offsetY:0,width:512,height:512},store,'spriteGpu',512,true);
 expect(f.formations).toHaveLength(1);expect(f.formations[0].heightKey).toBe('woodland-rock-height');
 expect(f.renderers[0].state).toMatchObject({enabled:true,material:'mineral',colourTextureKey:WOODLAND_ROCK_COLOUR_KEY});
 system.destroy();expect(f.formations[0].destroy).toHaveBeenCalledOnce();expect(events.listenerCount('prerender')).toBe(0);
});
