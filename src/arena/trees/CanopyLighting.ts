import { CLOUD_SHADOW_GLSL, setCloudUniforms, type SunCloudState } from '../../effects/sunlight/cloudShadow';
import * as Phaser from 'phaser';
import { CANOPY_ATLASES } from './CanopyAssets';
import { CANOPY_V9_GLSL, canopyHorizonWeights, canopyLinear } from './CanopyLightingModel';
import { SUN_TUNING_DEFAULTS } from '../../effects/sunlight/SunTuning';
import type { LightingSystem } from '../../effects/LightingSystem';
import { updateRockLightingSun, type RockLightingState } from '../../arena/rocks/RockLightingState';

type SunState = Pick<RockLightingState, 'strength' | 'sun'>;
type Canopy = { gfx: Phaser.GameObjects.Image; worldX: number; worldY: number };
type Node = Phaser.Renderer.WebGL.RenderNodes.RenderNode;
type SavedRole = { node: Node | null; data: object | undefined };

// Phaser 4.2.1 declares these role maps only as `object`; RenderNodes.js uses
// string-keyed node/data maps, and RenderNodeManager extends EventEmitter.
type RoleMap = Record<string, Node | undefined>;

const HEADER = `
uniform vec4 uCrownUV, uCrownTransform;
uniform vec3 uCrownSun;
uniform float uCrownStrength;
uniform vec4 uCrownWorld;
uniform vec3 uCloudCanopyShade;
${CLOUD_SHADOW_GLSL}
${CANOPY_V9_GLSL}
`;
const NEUTRAL_CLOUD_SHADE=[1,1,1] as const;
let nextId=0;

/** Shared material on existing images: no filters, new images, texture uploads,
 * or frame listeners. Phaser retains frame, tint, alpha and image transforms. */
export class CanopyLighting {
  private readonly state: RockLightingState = {enabled:true,normals:false,strength:0,sun:[0,0,1]};
  private readonly originals=new Map<Phaser.GameObjects.Image,SavedRole>();
  private batch: Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle | null=null;
  private submitter: Node | null=null;
  private current: Phaser.GameObjects.Image | null=null;
  private disposed=false;
  private readonly uv=[0,0,1,1];
  private readonly transform=[1,0,1,1];
  private readonly crownWorld=[0,0,1,1];
  private clouds?: SunCloudState;
  private lighting?: LightingSystem;
  private readonly weights0=[0,0,0,0];
  private readonly weights1=[0,0,0,0];
  private readonly model=[.12,1,.12,.07];
  private readonly ambient=[0,0,0];
  private readonly sunColour=[1,1,1];
  private readonly batchRole: SavedRole={node:null,data:undefined};
  private readonly emptyRoleData={};

  constructor(private readonly scene: Phaser.Scene, private readonly canopies: readonly Canopy[]) {
    const renderer=scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if(!renderer?.gl || !renderer.renderNodes) return;
    const manager=renderer.renderNodes,name=`CanopySunlight${nextId++}`;
    const batch=new Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle(manager,{name});
    this.batch=batch;
    // The renderer caches this material across world lifetimes. Nodes own their
    // VAOs/buffers, but never the program shared through ShaderProgramFactory.
    batch.programManager.addAddition({name:'CanopySunlightMaterialV9',additions:{fragmentHeader:HEADER,fragmentProcess:`
      if(fragColor.a>0.0) {
        fragColor.rgb=crownV9(fragColor.rgb/fragColor.a,outTexCoord,uCrownWorld.xy)*fragColor.a;
      }
    `}});
    const setCloud=(name:string,value:unknown)=>batch.programManager.setUniform(name,value);
    const setup=batch.setupUniforms;
    batch.setupUniforms=(context):void=>{
      setup.call(batch,context);
      const image=this.current;if(!image)return;
      const frame=image.frame;
      this.uv[0]=frame.u0;this.uv[1]=frame.v0;this.uv[2]=frame.u1-frame.u0;this.uv[3]=frame.v1-frame.v0;
      this.transform[0]=Math.cos(image.rotation);this.transform[1]=Math.sin(image.rotation);
      this.transform[2]=(image.flipX?-1:1)*(image.scaleX<0?-1:1);
      this.transform[3]=(image.flipY?-1:1)*(image.scaleY<0?-1:1);
      const programs=batch.programManager;
      setCloudUniforms(setCloud,this.clouds);
      this.crownWorld[0]=image.x;this.crownWorld[1]=image.y;
      this.crownWorld[2]=image.displayWidth;this.crownWorld[3]=image.displayHeight;
      programs.setUniform('uCrownWorld',this.crownWorld);
      programs.setUniform('uCloudCanopyShade',this.clouds?.tuning.cloudCanopyShade??NEUTRAL_CLOUD_SHADE);
      programs.setUniform('uCrownUV',this.uv);programs.setUniform('uCrownTransform',this.transform);
      programs.setUniform('uCrownHorizons',this.clouds?.quality?.horizons===false?0:1);
      {
        const t=this.clouds?.tuning??SUN_TUNING_DEFAULTS;
        canopyHorizonWeights(this.state.sun,this.weights0,this.weights1);
        this.model[0]=t.canopyWrap;this.model[1]=t.canopyAO;this.model[2]=t.canopyTranslucency;this.model[3]=t.canopyHorizonSoftness;
        programs.setUniform('uHorizonWeights0',this.weights0);programs.setUniform('uHorizonWeights1',this.weights1);
        programs.setUniform('uCrownModel',this.model);programs.setUniform('uCrownAmbient',this.ambient);
        programs.setUniform('uCrownSunColor',this.sunColour);programs.setUniform('uCrownSunWeight',t.canopySunWeight);
        programs.setUniform('uCrownData',1);programs.setUniform('uCrownH0',2);programs.setUniform('uCrownH1',3);
        for(let i=1;i<4;i++)renderer.glTextureUnits.bind(this.scene.textures.get(CANOPY_ATLASES[i].key).source[0].glTexture,i);
      }
      programs.setUniform('uCrownSun',this.state.sun);
      programs.setUniform('uCrownStrength',this.state.strength);
    };
    const submitter=new Phaser.Renderer.WebGL.RenderNodes.RenderNode(`${name}Submitter`,manager);
    this.submitter=submitter;
    submitter.run=(context,gameObject,parentMatrix,element,texturer,transformer,tinter,normalMap,normalRotation):void=>{
      const image=gameObject as Phaser.GameObjects.Image;
      const fallback=this.originals.get(image)?.node ?? (image.defaultRenderNodes as RoleMap).Submitter!;
      if(this.disposed){fallback.run(context,gameObject,parentMatrix,element,texturer,transformer,tinter,normalMap,normalRotation);return;}
      manager.finishBatch();this.current=image;
      const previous=this.batchRole,node=(image.customRenderNodes as RoleMap).BatchHandler;
      previous.node=node??null;previous.data=node?(image.renderNodeData as Record<string,object|undefined>)[node.name]:undefined;
      const tl=image.tintTopLeft,tr=image.tintTopRight,bl=image.tintBottomLeft,br=image.tintBottomRight;
      {
        // Existing tint/lightmap owns the ambient + local-light budget. Consume it
        // once as irradiance, then submit white vertex tint (alpha/fade unchanged).
        const sky=this.lighting?.getAmbientColor()??0xffffff;
        const lit=this.lighting?.resolveCanopyTint(image.x,image.y)??tl;
        const t=this.clouds?.tuning??SUN_TUNING_DEFAULTS;
        for(let c=0;c<3;c++) {
          const shift=(2-c)*8,a=canopyLinear(((sky>>>shift)&255)/255),l=canopyLinear(((lit>>>shift)&255)/255);
          this.ambient[c]=a*(1+(t.canopyAmbientWeight-1)*this.state.strength)+Math.max(0,l-a);
          this.sunColour[c]=a*(c===0?1:c===1?.93:.78);
        }
        image.setTint(0xffffff);
      }
      image.setRenderNodeRole('BatchHandler',batch,this.emptyRoleData);
      try {fallback.run(context,gameObject,parentMatrix,element,texturer,transformer,tinter,normalMap,normalRotation);manager.finishBatch();}
      finally {image.setTint(tl,tr,bl,br);this.restoreRole(image,'BatchHandler',previous);this.current=null;}
    };
    for(const {gfx} of canopies) {
      if(!gfx.active || this.originals.has(gfx))continue;
      this.originals.set(gfx,this.saveRole(gfx,'Submitter'));
      gfx.setRenderNodeRole('Submitter',submitter);
    }
  }

  setClouds(clouds?: SunCloudState): void { this.clouds=clouds; }
  setLighting(lighting?: LightingSystem): void { this.lighting=lighting; }

  update(time: number | SunState): void {
    if(this.disposed)return;
    if(typeof time==='number')updateRockLightingSun(this.state,time);
    else {this.state.strength=time.strength;this.state.sun[0]=time.sun[0];this.state.sun[1]=time.sun[1];this.state.sun[2]=time.sun[2];}
  }

  private saveRole(image: Phaser.GameObjects.Image, role: string): SavedRole {
    const node=(image.customRenderNodes as RoleMap)[role];
    return {node:node??null,data:node?(image.renderNodeData as Record<string,object | undefined>)[node.name]:undefined};
  }

  private restoreRole(image: Phaser.GameObjects.Image, role: string, saved: SavedRole): void {
    image.setRenderNodeRole(role,null);
    if(saved.node)image.setRenderNodeRole(role,saved.node,saved.data??this.emptyRoleData);
  }

  destroy(): void {
    if(this.disposed)return;this.disposed=true;
    for(const [image,saved] of this.originals) {
      if(image.scene && (image.customRenderNodes as RoleMap)?.Submitter===this.submitter)this.restoreRole(image,'Submitter',saved);
    }
    this.originals.clear();this.current=null;
    const batch=this.batch;if(!batch)return;
    const manager=batch.manager,renderer=manager.renderer;
    if(manager.currentBatchNode===batch)manager.finishBatch();
    (manager as unknown as Phaser.Events.EventEmitter).off(Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS,batch.updateTextureCount,batch);
    renderer.off(Phaser.Renderer.Events.RESIZE,batch.resize,batch);
    for(const suite of Object.values(batch.programManager.programs)) {
      Phaser.Utils.Array.Remove(renderer.glVAOWrappers,suite.vao);suite.vao.destroy();
    }
    batch.programManager.programs={};renderer.deleteBuffer(batch.vertexBufferLayout.buffer);renderer.deleteBuffer(batch.indexBuffer);
    this.batch=null;this.submitter=null;
  }
}
