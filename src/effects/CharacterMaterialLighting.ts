import * as Phaser from 'phaser';
import { CHARACTER_MATERIAL_PAGES, characterMaterialFrame } from '../assets/CharacterMaterialAssetManifest';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import type { LightingSystem } from './LightingSystem';
import { characterLocalVector, createCharacterMaterialLights, CHARACTER_MATERIAL_VIEWS, type CharacterMaterialView } from './CharacterMaterialModel';
import { CHARACTER_MATERIAL_HEADER, CHARACTER_MATERIAL_PROCESS, characterMaterialInsertionIndex } from './CharacterMaterialShader';
import { setCloudUniforms, type SunCloudState } from './sunlight/cloudShadow';

type Image = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
type Node = Phaser.Renderer.WebGL.RenderNodes.RenderNode;
type Roles = Record<string, Node | undefined>;
type SavedRole = { node: Node | null; data?: object };
type Binding = { lighting: LightingSystem; original: SavedRole; primary: boolean; release: () => void };
const owners = new WeakMap<Phaser.Scene, CharacterMaterialLighting>();
const imageOwners = new WeakMap<Image, CharacterMaterialLighting>();
const suppressed = new WeakSet<Phaser.Scene>();
const views = new WeakMap<Phaser.Scene, CharacterMaterialView>();
const sunlight = new WeakMap<Phaser.Scene, SunCloudState>();

/** Borrow only: the World owner releases this before destroying its textures. */
export function bindCharacterMaterialSunlight(scene: Phaser.Scene, clouds: SunCloudState | null): () => void {
  if (clouds) sunlight.set(scene, clouds); else sunlight.delete(scene);
  return () => { if (sunlight.get(scene)===clouds) sunlight.delete(scene); };
}
export function setCharacterMaterialSuppressed(scene: Phaser.Scene, value: boolean): void {
  if (value) suppressed.add(scene); else suppressed.delete(scene);
}
export function setCharacterMaterialView(scene: Phaser.Scene, view: CharacterMaterialView): void {
  if(!CHARACTER_MATERIAL_VIEWS.includes(view))throw new Error('Unknown character material view: '+view);
  if(view==='material')views.delete(scene);else views.set(scene,view);
}
export function characterMaterialStatus(scene: Phaser.Scene) {
  return owners.get(scene)?.status() ?? { available: false, instances: 0 };
}
export function attachCharacterMaterial(image: Image, lighting: LightingSystem): () => void {
  const scene=image.scene, renderer=scene?.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!renderer?.gl || !renderer.renderNodes) return () => {};
  let owner=owners.get(scene);
  if (!owner) { owner=new CharacterMaterialLighting(scene); owners.set(scene,owner); }
  return owner.attach(image,lighting,true);
}
/** Pooled flash images can switch between player and enemy. Restore their old
 * submitter on release/reassignment instead of retaining a player material. */
export function syncCharacterMaterialCopy(source: Image | null, copy: Image): void {
  const owner=source ? imageOwners.get(source) : undefined, previous=imageOwners.get(copy);
  if (previous===owner) return;
  previous?.detach(copy);
  if (owner && source) owner.attach(copy,owner.bindings.get(source)!.lighting,false);
}

let serial=0;
/** One shared material/program per Scene, drawn on the existing Sprite. Its
 * original Beauty texture/frame stays intact for animation, glow and snapshots. */
class CharacterMaterialLighting {
  readonly bindings=new Map<Image,Binding>();
  private readonly batch: Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle;
  private readonly submitter: Node;
  private current: Image | null=null;
  private primaryCount=0;
  private disposed=false;
  private readonly beautyUV=[0,0,1,1];
  private readonly normalScale=[1,1,1];
  private readonly world=[0,0];
  private readonly sun=[0,0,1];
  private readonly locals=createCharacterMaterialLights();
  private readonly localVectors=[[0,0,1,0],[0,0,1,0]];
  private readonly empty={};
  private readonly last={ pose:0, sun:[0,0,1], localSun:[0,0,1], strength:0, localLights:0, draws:0 };

  constructor(private readonly scene: Phaser.Scene) {
    const renderer=scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer, manager=renderer.renderNodes;
    const name=`CharacterMaterial${serial++}`;
    const batch=this.batch=new Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle(manager,{name});
    const config=batch.programManager.currentConfig as {additions: Phaser.Types.Renderer.WebGL.ShaderAdditionConfig[]};
    batch.programManager.addAddition({name:'CharacterMaterial21eV2',additions:{
      fragmentHeader:CHARACTER_MATERIAL_HEADER,fragmentProcess:CHARACTER_MATERIAL_PROCESS,
    }},characterMaterialInsertionIndex(config.additions));
    const setup=batch.setupUniforms;
    const set=(name:string,value:unknown):void=>batch.programManager.setUniform(name,value);
    batch.setupUniforms=(context):void=>{
      setup.call(batch,context);
      const image=this.current;if(!image)return;
      const clouds=sunlight.get(scene), path=clouds?.sunPath;
      const material=characterMaterialFrame(image.frame.name,getGraphicsQualityProfile(scene).level==='high');
      const frame=image.frame;
      this.beautyUV[0]=frame.u0;this.beautyUV[1]=frame.v0;this.beautyUV[2]=frame.u1-frame.u0;this.beautyUV[3]=frame.v1-frame.v0;
      this.world[0]=image.x;this.world[1]=image.y;
      // Normal inverse transpose: preserve uniform world scaling, including the
      // 64/128 Beauty source resolution. Negative scale belongs to the flips.
      const sx=Math.max(.0001,Math.abs(image.scaleX)),sy=Math.max(.0001,Math.abs(image.scaleY));
      const z=Math.sqrt(sx*sy);this.normalScale[0]=z/sx;this.normalScale[1]=z/sy;
      const flipX=image.flipX !== (image.scaleX<0),flipY=image.flipY !== (image.scaleY<0);
      characterLocalVector(path?.sun[0]??0,path?.sun[1]??0,path?.sun[2]??1,image.rotation,flipX,flipY,this.sun);
      const strength=path ? Math.max(0,path.strength) : 0;
      const lighting=this.bindings.get(image)!.lighting;
      if (strength<1) lighting.sampleCharacterMaterialLights(image.x,image.y,this.locals);
      else for (const light of this.locals) light.weight=0;
      let localCount=0;
      for(let i=0;i<2;i++) {
        const light=this.locals[i],vector=this.localVectors[i];
        characterLocalVector(light.x-image.x,light.y-image.y,light.height,image.rotation,flipX,flipY,vector);
        vector[3]=light.weight*(1-Math.min(1,strength));if(vector[3]>0)localCount++;
      }
      setCloudUniforms(set,clouds);
      set('uCharacterBeautyUV',this.beautyUV);set('uCharacterAlbedoUV',material.albedo.uv);set('uCharacterNormalUV',material.normal.uv);
      set('uCharacterWorld',this.world);set('uCharacterNormalScale',this.normalScale);
      set('uCharacterSun',this.sun);set('uCharacterStrength',strength);
      set('uCharacterView',CHARACTER_MATERIAL_VIEWS.indexOf(views.get(scene)??'material'));
      set('uCharacterLocal0',this.localVectors[0]);set('uCharacterLocal1',this.localVectors[1]);
      set('uCharacterAlbedo',1);set('uCharacterNormal',2);
      renderer.glTextureUnits.bind(scene.textures.get(material.albedo.key).source[0].glTexture,1);
      renderer.glTextureUnits.bind(scene.textures.get(material.normal.key).source[0].glTexture,2);
      this.last.pose=material.pose;this.last.strength=strength;this.last.localLights=localCount;this.last.draws++;
      for(let i=0;i<3;i++){this.last.sun[i]=path?.sun[i]??(i===2?1:0);this.last.localSun[i]=this.sun[i];}
    };
    this.submitter=new Phaser.Renderer.WebGL.RenderNodes.RenderNode(`${name}Submitter`,manager);
    this.submitter.run=(context,object,parent,element,texturer,transformer,tinter,normalMap,normalRotation):void=>{
      const image=object as Image;
      const fallback=this.bindings.get(image)?.original.node ?? (image.defaultRenderNodes as Roles).Submitter!;
      const material=characterMaterialFrame(image.frame.name,getGraphicsQualityProfile(scene).level==='high');
      if(this.disposed || suppressed.has(scene) || getGraphicsQualityProfile(scene).level==='low'
        || !sunlight.has(scene) || !scene.textures.exists(material.albedo.key) || !scene.textures.exists(material.normal.key)) {
        fallback.run(context,object,parent,element,texturer,transformer,tinter,normalMap,normalRotation);return;
      }
      manager.finishBatch();this.current=image;
      const previous=this.save(image,'BatchHandler');
      image.setRenderNodeRole('BatchHandler',batch,this.empty);
      try {fallback.run(context,object,parent,element,texturer,transformer,tinter,normalMap,normalRotation);manager.finishBatch();}
      finally {this.restore(image,'BatchHandler',previous);this.current=null;}
    };
  }
  attach(image:Image,lighting:LightingSystem,primary:boolean):()=>void {
    const prior=this.bindings.get(image);if(prior)return prior.release;
    const release=():void=>this.detach(image);
    this.bindings.set(image,{lighting,original:this.save(image,'Submitter'),primary,release});
    if(primary)this.primaryCount++;
    imageOwners.set(image,this);image.setRenderNodeRole('Submitter',this.submitter);image.once('destroy',release);
    return release;
  }
  detach(image:Image):void {
    const binding=this.bindings.get(image);if(!binding)return;
    image.off('destroy',binding.release);
    if((image.customRenderNodes as Roles).Submitter===this.submitter)this.restore(image,'Submitter',binding.original);
    this.bindings.delete(image);imageOwners.delete(image);
    if(binding.primary && --this.primaryCount===0)this.destroy();
  }
  status() {
    return {available:true,suppressed:suppressed.has(this.scene),quality:getGraphicsQualityProfile(this.scene).level,
      view:views.get(this.scene)??'material',
      active:!suppressed.has(this.scene) && getGraphicsQualityProfile(this.scene).level!=='low' && sunlight.has(this.scene),
      worldBound:sunlight.has(this.scene),loadedPages:CHARACTER_MATERIAL_PAGES.filter(p=>this.scene.textures.exists(p.key)).length,
      instances:this.primaryCount,copies:this.bindings.size-this.primaryCount,...this.last,
      players:[...this.bindings].filter(([,b])=>b.primary).map(([image])=>({pose:Number(image.frame.name),rotation:image.rotation,visible:image.visible,alpha:image.alpha}))};
  }
  private save(image:Image,role:string):SavedRole {
    const node=(image.customRenderNodes as Roles)[role];
    return {node:node??null,data:node?(image.renderNodeData as Record<string,object>)[node.name]:undefined};
  }
  private restore(image:Image,role:string,saved:SavedRole):void {
    image.setRenderNodeRole(role,null);if(saved.node)image.setRenderNodeRole(role,saved.node,saved.data??this.empty);
  }
  private destroy():void {
    if(this.disposed)return;this.disposed=true;
    for(const image of [...this.bindings.keys()])this.detach(image);
    owners.delete(this.scene);
    const batch=this.batch,manager=batch.manager,renderer=manager.renderer;
    if(manager.currentBatchNode===batch)manager.finishBatch();
    (manager as unknown as Phaser.Events.EventEmitter).off(Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS,batch.updateTextureCount,batch);
    renderer.off(Phaser.Renderer.Events.RESIZE,batch.resize,batch);
    // Programs are shared by the renderer. Only this node's buffers/VAOs belong here.
    for(const suite of Object.values(batch.programManager.programs)) {
      Phaser.Utils.Array.Remove(renderer.glVAOWrappers,suite.vao);suite.vao.destroy();
    }
    batch.programManager.programs={};renderer.deleteBuffer(batch.vertexBufferLayout.buffer);renderer.deleteBuffer(batch.indexBuffer);
  }
}
