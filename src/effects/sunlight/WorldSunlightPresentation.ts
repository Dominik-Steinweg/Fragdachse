import { bindCharacterMaterialSunlight } from '../CharacterMaterialLighting';
import { loadingTimeline } from '../../diagnostics/LoadingTimeline';
import type * as Phaser from 'phaser';
import type { ArenaBuilderResult } from '../../arena/ArenaBuilder';
import type { ArenaLayout } from '../../types';
import type { WorldRuntimeContext } from '../../world/WorldRuntimeContext';
import type { ShadowSystem } from '../ShadowSystem';
import type { LightingSystem } from '../LightingSystem';
import type { GroundFogSystem } from '../groundFog/GroundFogSystem';
import type { CameraPostFxController } from '../postfx/CameraPostFxController';
import { CanopyLighting } from '../../arena/trees/CanopyLighting';
import { buildWoodlandEcology, EcologyWaterField } from '../../arena/WoodlandEcologyField';
import { WoodlandEcologyRenderer } from '../../arena/WoodlandEcologyRenderer';
import { WorldSunComposite } from './WorldSunComposite';
import { createSunTuning, resolveSunAtmosphere, SunAtmosphereClock } from './SunAtmosphere';
import { resolveSunAmbient } from './SunSky';
import { validateSunTuning, sunAtmosphereGrade, type SunTuning } from './SunTuning';
import { createSunPath, resolveSunPath } from './SunPath';
import type { SunCloudState } from './cloudShadow';
import type { FogWoodlandLight } from '../groundFog/FogWoodlandLight';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { type RockLightingState } from '../../arena/rocks/RockLightingState';
import { CANOPY_ASSETS, canopyVariant } from '../../arena/trees/CanopyAssets';

export interface WorldSunlightTargets {
 ground: ArenaBuilderResult['groundSurface'];
 rocks: ArenaBuilderResult['rockVisualSystem'];
 rockOverlays: ArenaBuilderResult['rockOverlaySurface'];
 canopies: ArenaBuilderResult['canopyObjects'];
 water: ArenaBuilderResult['waterSurface'];
 wildlife: ArenaBuilderResult['wildlife'];
 shadow: ShadowSystem;
 enemyShadows?: Parameters<ShadowSystem['setSunPath']>[1];
 lighting: LightingSystem;
 fog: GroundFogSystem | null;
 postFx: CameraPostFxController;
 layout: ArenaLayout;
 worldContext: WorldRuntimeContext;
}
type Targets = WorldSunlightTargets;
/** Active render resources belong to one displayed World, never its transferable terrain cache. */
export class WorldSunlightPresentation {
 private disposed=false;
 private releaseCharacterMaterial: (()=>void)|null=null;
 private lastMinute=NaN;
 private lastSceneTime=0;
 readonly sunTuning=createSunTuning();
 private readonly sunOverrides: Partial<SunTuning>={};
 private readonly atmosphereClock=new SunAtmosphereClock();
 readonly clouds: SunCloudState={tuning:this.sunTuning,timeSec:0,strength:0};
 private readonly sunPath=createSunPath();
 private readonly sunState: RockLightingState={enabled:true,normals:false,strength:0,sun:[0,0,1]};
 private readonly sunFog: FogWoodlandLight={sun:this.sunState.sun,sunCompositeTuning:this.sunTuning,clouds:this.clouds};
 private readonly ecologyQuality={rockEdgeFlora:1,rockCreviceFlora:1,rockFootFlora:1,rockFloraContact:.24,rockFloraBlend:.5};
 private readonly gradeUniforms={};
 private canopyLighting: CanopyLighting|null=null;
 private sunComposite: WorldSunComposite|null=null;
 private woodland: WoodlandEcologyRenderer|null=null;
 private woodlandLayout: Targets['layout']|null=null;
 private readonly fogBase: {opacity:number;detail:number}|null;
 private readonly landscape=(id:number):boolean=>this.targets.rocks?.store.get(id)?.material!=='walls';
 get presentationMinute():number{return this.lastMinute;}
 get sunStatus(){return {azimuth:this.sunPath.azimuth,elevation:this.sunPath.elevation*180/Math.PI,strength:this.sunPath.strength,horizonAzimuth:this.sunPath.horizonAzimuth};}
 get diagnostics(){return this.sunComposite?.diagnostics??null;}
 setDebugCompositeSuppressed(value:boolean):void {this.sunComposite?.setDebugSuppressed(value);}
 setDebugCharacterShadowsSuppressed(value:boolean):void {this.targets.shadow.setCharacterShadowsSuppressed(value);}
 setDebugCharacterShadowSolid(value:boolean):void {this.targets.shadow.setCharacterShadowSolid(value);}
 getCharacterShadowsStatus() {return this.targets.shadow.getCharacterShadowsStatus();}
 setDebugCompositeView(value:import('./WorldSunComposite').SunCompositeDebugView):void {this.sunComposite?.setDebugView(value);}
 inspectDebugCompositeMaterial(){return this.sunComposite?.inspectMaterial()??null;}
 get woodlandCount():number{return this.woodland?.count??0;}
 constructor(private readonly scene:Phaser.Scene,private readonly targets:Targets) {
  const measuredAt=loadingTimeline.start();
  this.fogBase=targets.fog?{opacity:targets.fog.tuning.opacity,detail:targets.fog.tuning.detail}:null;
  try {
  this.releaseCharacterMaterial=bindCharacterMaterialSunlight(scene,this.clouds);
  this.canopyLighting=new CanopyLighting(scene,targets.canopies);
  this.sunComposite=new WorldSunComposite(scene,this.sunTuning,this.sunState,this.clouds,targets.canopies);
  targets.rocks?.setFormationOptions(true,true,this.clouds);
  targets.rockOverlays?.setFormationReceiver(targets.rocks?.getFormationReceiver??null);
  targets.shadow.setFormationShadows(this.landscape);
  targets.shadow.setCanopyShadows(targets.canopies,true);
  this.canopyLighting.setClouds(this.clouds);this.canopyLighting.setLighting(targets.lighting);
  if(targets.fog)Object.assign(targets.fog.tuning,{opacity:.58,detail:.88});
  } catch(error){this.destroy();throw error;} finally {loadingTimeline.end('sunlight/init',measuredAt);}
 }
 update(minutes:number,presentationTimeMs:number):void {
  if(this.disposed)return;
  this.lastSceneTime=Number.isFinite(presentationTimeMs)?presentationTimeMs:0;
  this.lastMinute=this.atmosphereClock.resolve(minutes,this.lastSceneTime);
  this.sync();
 }
 /** Water masks precede ecology; canopy/cloud fields and the composite must also be published. */
 isPrepared():boolean {
  return !this.disposed && this.gradeBound && this.woodland !== null
   && this.woodlandLayout === this.targets.layout && this.sunComposite?.isPrepared() === true;
 }
 tuneSun(values:unknown,reset=false):void {
  if(this.disposed)return;
  if(reset)for(const key of Object.keys(this.sunOverrides))delete this.sunOverrides[key as keyof SunTuning];
  else Object.assign(this.sunOverrides,validateSunTuning(values));
  this.sync();
 }
 private sync():void {
  const targets=this.targets,minute=Number.isFinite(this.lastMinute)?this.lastMinute:480;
  const changed=resolveSunAtmosphere(minute,this.sunTuning,this.sunOverrides);
  const quality=getGraphicsQualityProfile(this.scene).sunlight;
  this.clouds.quality=quality;
  this.ecologyQuality.rockEdgeFlora=this.sunTuning.rockEdgeFlora*quality.ecologyDensity;
  this.ecologyQuality.rockCreviceFlora=this.sunTuning.rockCreviceFlora*quality.ecologyDensity;
  this.ecologyQuality.rockFootFlora=this.sunTuning.rockFootFlora*quality.ecologyDensity;
  this.ecologyQuality.rockFloraContact=this.sunTuning.rockFloraContact;
  this.ecologyQuality.rockFloraBlend=this.sunTuning.rockFloraBlend;
  targets.rockOverlays?.setEcologyTuning(this.ecologyQuality);
  if(minute!==this.ambientMinute){targets.lighting.setSunAmbient(resolveSunAmbient(minute));this.ambientMinute=minute;}
  if(minute!==this.sunMinute||this.azimuthOverride!==this.sunTuning.sunAzimuthOverride){
    this.clouds.sunPath=resolveSunPath(minute,this.sunTuning.sunAzimuthOverride,this.sunPath);
    this.sunState.strength=this.sunPath.strength;
    for(let i=0;i<3;i++)this.sunState.sun[i]=this.sunPath.sun[i];
    targets.rocks?.setSunTime(minute);this.sunMinute=minute;this.azimuthOverride=this.sunTuning.sunAzimuthOverride;
  }
  targets.shadow.setSunPath(this.sunPath,targets.enemyShadows);
  targets.shadow.setCharacterSunlight(this.clouds);
  this.clouds.timeSec=this.lastSceneTime/1000;this.clouds.strength=this.sunState.strength;
  this.canopyLighting!.update(this.sunState);
  targets.ground?.setVegetationLight(this.clouds);
  targets.water?.setSunlight(this.clouds);targets.wildlife?.setSunlight(this.clouds);
  this.syncWoodland(targets);
  this.sunComposite!.setEnabled(true);
  const m=targets.worldContext.metrics;
  this.sunComposite!.prepareClouds(m.offsetX,m.offsetY,m.widthPx,m.heightPx);
  this.sunFog.sunStrength=this.sunState.strength;
  this.sunFog.baseFogOpacity=this.fogBase?.opacity;
  this.sunFog.baseFogDetail=this.fogBase?.detail;
  targets.fog?.setWoodlandLight(this.sunFog);
  if(changed||!this.gradeBound){targets.postFx.setSunGrade(sunAtmosphereGrade(this.sunTuning,this.gradeUniforms),this.sunTuning.gradeOlive);this.gradeBound=true;}
 }
 private gradeBound=false;
 private ambientMinute=NaN;
 private sunMinute=NaN;
 private azimuthOverride:number|null=null;
  private syncWoodland(targets:Targets):void {
    const enabled=true;
    if(!enabled||targets.layout!==this.woodlandLayout) {
      this.woodland?.destroy();this.woodland=null;this.woodlandLayout=null;
    }
    const m=targets.worldContext?.metrics,layout=targets.layout;
    if(enabled&&!this.woodland&&m&&layout&&(!targets.water||targets.water.isPrepared())) {
      const measuredAt=loadingTimeline.start();
      const frame={offsetX:m.offsetX,offsetY:m.offsetY,width:m.widthPx,height:m.heightPx};
      const crowns=targets.canopies.map(c=>({worldX:c.worldX,worldY:c.worldY,radius:Math.max(c.gfx.displayWidth,c.gfx.displayHeight)*.46,
        conifer:CANOPY_ASSETS[canopyVariant(c.worldX,c.worldY)].conifer}));
      const water=new EcologyWaterField(targets.water?.getPreparedMasks()??[]);
      const placements=buildWoodlandEcology(layout,frame,crowns,water,targets.worldContext!.bases.flatMap(b=>b.cells));
      this.woodland=new WoodlandEcologyRenderer(this.scene,placements);this.woodlandLayout=layout;
      loadingTimeline.end('ecology/woodland',measuredAt);
    }
    this.woodland?.update(this.sunTuning,targets.water,true,true,getGraphicsQualityProfile(this.scene).sunlight.ecologyDensity);
  }


 destroy():void {
  if(this.disposed)return;this.disposed=true;
  this.releaseCharacterMaterial?.();this.releaseCharacterMaterial=null;
  const t=this.targets;
  // Unbind receivers before destroying fields; the terrain may be handed to another World.
  t.ground?.setVegetationLight(undefined);t.water?.setSunlight(undefined);t.wildlife?.setSunlight(undefined);
  t.fog?.setWoodlandLight(null);
  if(t.fog&&this.fogBase)Object.assign(t.fog.tuning,this.fogBase);
  t.rockOverlays?.setFormationReceiver(null);
  t.rocks?.setFormationOptions(true,true);
  t.shadow.setCharacterSunlight(null);
  t.shadow.setSunPath(null);t.shadow.setCanopyShadows(null);t.shadow.setFormationShadows(null);
  this.canopyLighting?.destroy();this.canopyLighting=null;this.woodland?.destroy();this.woodland=null;
  this.sunComposite?.destroy();this.sunComposite=null;this.clouds.cache=undefined;this.clouds.sunPath=undefined;
  t.lighting.setSunAmbient(null);t.postFx.setSunGrade(null);
 }
}
