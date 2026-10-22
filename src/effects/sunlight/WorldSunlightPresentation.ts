import { bindCharacterMaterialSunlight } from '../CharacterMaterialLighting';
import { bindPlayerGlowEnvironment } from '../PlayerGlowPresence';
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
import { buildWoodlandEcology, EcologyWaterField, markVoidPondColonies } from '../../arena/WoodlandEcologyField';
import { buildVoidWaterStain } from '../../arena/VoidWaterStain';
import { buildVoidCreepField, buildVoidCreepHaze, voidCreepTexelRect, type VoidCreepField, type VoidCreepSource } from '../../arena/VoidCreepField';
import { VoidCreepPresentation } from './VoidCreepPresentation';
import { VoidDangerField, resolveVoidDangerSources, type ActivityVoidDanger, type VoidDangerSource } from '../../arena/VoidDangerField';
import { VoidHazeResidue } from '../../arena/VoidHazeResidue';
import { WATER_SHORE_DISTANCE } from '../../arena/WaterSurfaceModel';
import { VoidFloraGlow } from './VoidFloraGlow';
import { VoidFloraEmission } from './VoidFloraEmission';
import { voidLilyFrame } from '../../arena/VoidFloraAssets';
import type { EcologyColony } from '../../arena/rocks/RockEcologyField';
import { WoodlandEcologyRenderer } from '../../arena/WoodlandEcologyRenderer';
import { WorldSunComposite } from './WorldSunComposite';
import { createSunTuning, resolveSunAtmosphere, SunAtmosphereClock } from './SunAtmosphere';
import { resolveMoonlitAmbient, resolveSunAmbient } from './SunSky';
import { resolveSkyState } from '../TimeOfDay';
import { MoonSkyLight } from './MoonSkyLight';
import { createMoonSky, resolveMoonSky, writeMoonDirection, type WorldMoonlight } from './MoonSky';
import { MOON_TUNING } from '../../config/sunlight';
import { validateSunTuning, sunAtmosphereGrade, type SunTuning } from './SunTuning';
import { createSunPath, resolveSunPath } from './SunPath';
import type { SunCloudState } from './cloudShadow';
import { resolveFogShapeClock } from './fogShape';
import type { SurfaceLightFrame } from '../SurfaceLocalLights';
import type { FogWoodlandLight } from '../groundFog/FogWoodlandLight';
import type { FogAirBinding } from '../groundFog/FogAirBinding';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { type RockLightingState } from '../../arena/rocks/RockLightingState';
import { CANOPY_ASSETS, canopyVariant } from '../../arena/trees/CanopyAssets';
import type { LobbyStructureSunlight } from '../../arena/lobbyStructures/LobbyStructureRenderer';

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
 /** Authored World moon (map JSON); absent means the production moon. */
 moonlight?: WorldMoonlight | null;
 /** Lobby structures: relief and self-shadow under the same sun, clouds, moon and lamps as the rocks. */
 structures?: { setSunlight(sunlight: LobbyStructureSunlight | null): void } | null;
}
type Targets = WorldSunlightTargets;
/** Activity moonlight (Dawn blood moon): ambient hue and an optional override of the moon islands. */
export interface ActivityMoonlight {
 readonly tint:readonly number[];
 readonly gain:number;
 readonly openings?:{readonly cover:number;readonly light:readonly number[]};
}
/** A blood moon rises over a few seconds instead of switching the night colour. */
const MOONLIGHT_FADE_MS=4000;
/** The island clock wraps once per real day; shader precision stays well below a pixel. */
const MOON_DAY_MS=86_400_000;
/** Active render resources belong to one displayed World, never its transferable terrain cache. */
export class WorldSunlightPresentation {
 private disposed=false;
 private releaseCharacterMaterial: (()=>void)|null=null;
 private releasePlayerGlow: (()=>void)|null=null;
 private lastMinute=NaN;
 private lastSceneTime=0;
 readonly sunTuning=createSunTuning();
 private readonly sunOverrides: Partial<SunTuning>={};
 private readonly atmosphereClock=new SunAtmosphereClock();
 readonly clouds: SunCloudState={tuning:this.sunTuning,timeSec:0,strength:0};
 private readonly sunPath=createSunPath();
 private reviewSun: { azimuth: number; elevation: number; strength: number } | null = null;
 /** Explicit diagnostic override through the sole sun owner; all figure casters see the same vector. */
 setFigureReviewSun(value: { azimuth: number; elevation: number; strength: number } | null): void {
  if(this.disposed)return;
  if (value && (![value.azimuth,value.elevation,value.strength].every(Number.isFinite)
    || value.elevation<=0 || value.elevation>90 || value.strength<0 || value.strength>1)) throw Error('Invalid figure review sun');
  this.reviewSun=value;this.sunMinute=NaN;this.sync();
 }
 private readonly sunState: RockLightingState={enabled:true,normals:false,strength:0,sun:[0,0,1]};
 private readonly fogShapeClock=new Float32Array(4);
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
  this.releasePlayerGlow=bindPlayerGlowEnvironment(scene,{clouds:this.clouds,fogStrength:()=>targets.fog?.displayedStrength??0});
  this.canopyLighting=new CanopyLighting(scene,targets.canopies);
  this.sunComposite=new WorldSunComposite(scene,this.sunTuning,this.sunState,this.clouds,targets.canopies);
  targets.rocks?.setFormationOptions(true,true,this.clouds);
  targets.rocks?.setSurfaceLights((x,y,width,height,out)=>targets.lighting.sampleSurfaceLights(x,y,width,height,out));
  targets.water?.setNightLight(this.waterNight);
  targets.structures?.setSunlight(this.structureLight);
  // Lamps shape the rock front along the resident V7 contour (N-4).
  {const rocks=targets.rocks;targets.lighting.setRockCoverage(rocks?()=>rocks.getFormationCoverage():null);}
  {
    // Void marks danger only (GDD Void-Gefahrenzonen V1): PvP, the lobby and safe ground have none.
    const world=targets.worldContext,definition=world.definition;
    this.worldDanger=resolveVoidDangerSources({config:definition?.voidDanger,offsetX:world.metrics.offsetX,offsetY:world.metrics.offsetY,
      bases:world.bases,spawnZones:definition?.spawnZones,krakenHabitat:definition?.krakenHabitat});
    this.voidGlow=new VoidFloraGlow(targets.lighting);
    this.voidEmission=new VoidFloraEmission(this.scene);
    this.voidCreep=new VoidCreepPresentation(this.scene);
  }
  targets.rockOverlays?.setFormationReceiver(targets.rocks?.getFormationReceiver??null);
  targets.shadow.setFormationShadows(this.landscape);
  targets.shadow.setCanopyShadows(targets.canopies,true);
  this.canopyLighting.setClouds(this.clouds);this.canopyLighting.setLighting(targets.lighting);
  if(targets.fog)Object.assign(targets.fog.tuning,{opacity:.58,detail:.88});
  } catch(error){this.destroy();throw error;} finally {loadingTimeline.end('sunlight/init',measuredAt);}
 }
 /** Activity overlay through this sole ambient writer (Dawn blood moon); null fades back to the World sky. */
 setActivityMoonlight(moon:ActivityMoonlight|null):void {
  if(moon)this.moon=moon;
  this.moonTarget=moon?1:0;
 }
 /** The ground fog's air after this frame's step, lent to the void motes; null without simulating fog. */
 setFogAir(air:FogAirBinding|null):void {if(!this.disposed)this.voidCreep?.setAir(air);}
 /** The fog's shape after its draw this frame (shaped fog); the void dust and glow draw from it. */
 setFogShape(shape:{readonly texture:Phaser.Textures.Texture;readonly view:Float32Array}|null):void {
  if(!this.disposed)this.voidCreep?.setFogShapeBinding(shape);
 }
 /** Activity overlay of the void danger (permanent hazards, presence), pulled once per frame. */
 setActivityVoidDanger(danger:ActivityVoidDanger|null):void {this.activityDanger=danger;}
 private moon:ActivityMoonlight|null=null;
 private moonLight:MoonSkyLight|null=null;
 private readonly moonSky=createMoonSky();
 private readonly moonDirection=[0,0,1];
 /** Own cloud state of the moon islands: day field shape, night cover and drift. */
 private readonly moonClouds:SunCloudState={tuning:createSunTuning(),timeSec:0,strength:1};
 private moonTarget=0;
 private moonWeight=0;
 private worldDanger:readonly VoidDangerSource[]=[];
 private activityDanger:ActivityVoidDanger|null=null;
 /** Activity sources the current field was built from; a new array rebuilds it. */
 private activitySources:readonly VoidDangerSource[]|null=null;
 private voidField:VoidDangerField|null=null;
 /** Presence the shown haze was built with, per source id; absent = present. */
 private readonly voidPresence=new Map<string,number>();
 private voidCreepField:VoidCreepField|null=null;
 private readonly voidHazeSource:VoidCreepSource={
  intensityAt:(x,y)=>this.voidField?.intensityAt(x,y)??0,
  hazeAt:(x,y)=>this.voidField?.hazeAt(x,y,id=>this.voidPresence.get(id)??1,this.residueAt)??0,
 };
 /** Small dense patches the haze keeps over the scar of a deactivated place. */
 private voidResidue:VoidHazeResidue|null=null;
 private readonly residueAt=(x:number,y:number):number=>this.voidResidue?.at(x,y)??0;
 /** Patches follow the void plants standing now: lily colonies and rock colonies on standing rocks. */
 private refreshResidue():void {
  this.voidResidue=new VoidHazeResidue([...this.voidPondPoints,...this.voidRockPoints],
   (x,y)=>this.voidField?.intensityAt(x,y)??0,this.targets.layout.seed);
 }
 private voidGlow:VoidFloraGlow|null=null;
 private voidEmission:VoidFloraEmission|null=null;
 private voidCreep:VoidCreepPresentation|null=null;
 private readonly voidRockColonies:EcologyColony[]=[];
 /** Flat x/y pairs of void lily colonies of the current woodland layout. */
 private readonly voidPondPoints:number[]=[];
 private readonly voidRockPoints:number[]=[];
 /** Rock-overlay void revision the collected rock points/colonies belong to; -1 forces a collect. */
 private voidRockRevision=-1;
 private voidRockEmission:VoidFloraEmission|null=null;
 /** Night input of wet surfaces (water, blood): weight follows the lamps' own dusk curve, lamps are pulled per area. */
 readonly waterNight={night:0,lights:(x:number,y:number,width:number,height:number,out:SurfaceLightFrame)=>
  this.targets.lighting.sampleSurfaceLights(x,y,width,height,out,getGraphicsQualityProfile(this.scene).sunlight.surfaceLights)};
 private moonTimeSec=0;
 /** Moon direction and relief for the lobby structures, written with the rocks' moon. */
 private readonly structureMoon=new Float32Array(4);
 private readonly structureLight:LobbyStructureSunlight={state:this.sunState,clouds:this.clouds,moon:this.structureMoon,
  surfaceLights:(x,y,width,height,out)=>this.targets.lighting.sampleSurfaceLights(x,y,width,height,out,getGraphicsQualityProfile(this.scene).sunlight.surfaceLights)};
 /**
  * `synchronizedNowMs` drives the moon islands so every peer sees the same openings (N-3);
  * without it (standalone editors) the pausable presentation time is used.
  */
 update(minutes:number,presentationTimeMs:number,synchronizedNowMs?:number):void {
  if(this.disposed)return;
  const time=Number.isFinite(presentationTimeMs)?presentationTimeMs:0;
  this.moonTimeSec=synchronizedNowMs!==undefined&&Number.isFinite(synchronizedNowMs)
   ?(((synchronizedNowMs%MOON_DAY_MS)+MOON_DAY_MS)%MOON_DAY_MS)/1000:time/1000;
  const step=Math.max(0,time-this.lastSceneTime)/MOONLIGHT_FADE_MS;
  this.moonWeight=this.moonTarget>this.moonWeight?Math.min(this.moonTarget,this.moonWeight+step):Math.max(this.moonTarget,this.moonWeight-step);
  this.lastSceneTime=time;
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
  if(minute!==this.ambientMinute||this.moonWeight!==this.ambientMoonWeight){
    const sun=resolveSunAmbient(minute);
    targets.lighting.setSunAmbient(this.moon&&this.moonWeight>0
      ?resolveMoonlitAmbient(sun??resolveSkyState(minute).ambientColor,this.moon,this.moonWeight):sun);
    this.ambientMinute=minute;this.ambientMoonWeight=this.moonWeight;
  }
  if(minute!==this.sunMinute||this.azimuthOverride!==this.sunTuning.sunAzimuthOverride){
    this.clouds.sunPath=resolveSunPath(minute,this.sunTuning.sunAzimuthOverride,this.sunPath);
    if(this.reviewSun){
      const r=this.reviewSun,a=r.azimuth*Math.PI/180,e=r.elevation*Math.PI/180;
      this.sunPath.azimuth=r.azimuth;this.sunPath.elevation=e;this.sunPath.strength=r.strength;
      this.sunPath.direction[0]=Math.cos(a);this.sunPath.direction[1]=-Math.sin(a);
      this.sunPath.sun[0]=Math.cos(a)*Math.cos(e);this.sunPath.sun[1]=-Math.sin(a)*Math.cos(e);this.sunPath.sun[2]=Math.sin(e);
      this.sunPath.horizonAzimuth=r.azimuth;this.sunPath.castAzimuth=r.azimuth;
    }
    this.sunState.strength=this.sunPath.strength;
    for(let i=0;i<3;i++)this.sunState.sun[i]=this.sunPath.sun[i];
    targets.rocks?.setSunTime(minute);this.sunMinute=minute;this.azimuthOverride=this.sunTuning.sunAzimuthOverride;
  }
  targets.shadow.setSunPath(this.sunPath,targets.enemyShadows);
  this.syncMoonSky(targets,minute);
  // From the lamps' own dusk curve: sunset and dusk keep their water untouched.
  this.waterNight.night=Math.max(0,Math.min(1,(targets.lighting.getArtificialLightFactor()-.3)/.6));
  targets.shadow.setCharacterSunlight(this.clouds);
  this.clouds.timeSec=this.lastSceneTime/1000;this.clouds.strength=this.sunState.strength;
  this.canopyLighting!.update(this.sunState);
  targets.ground?.setVegetationLight(this.clouds);
  targets.water?.setSunlight(this.clouds);targets.wildlife?.setSunlight(this.clouds);
  this.syncVoidField(targets);
  this.syncWoodland(targets);
  this.syncVoidPresence();
  this.voidCreep?.setAlerts(this.activityDanger?.alerts??[]);
  const voidRevision=targets.rockOverlays?.syncVoidRevision()??-1;
  const voidRocksChanged=voidRevision===-1||voidRevision!==this.voidRockRevision;
  if(voidRocksChanged){
   if(targets.rockOverlays)targets.rockOverlays.collectVoidGlowPoints(this.voidRockPoints);else this.voidRockPoints.length=0;
   this.voidRockRevision=voidRevision;
  }
  this.voidGlow?.update(this.scene.cameras.main,this.voidPondPoints,this.voidRockPoints,this.lastSceneTime/1000);
  {
    const artificial=targets.lighting.getArtificialLightFactor(),quality=getGraphicsQualityProfile(this.scene).sunlight;
    // Shaped fog: without the fog's lent shape the haze layers evaluate it at the same clock.
    const shape=resolveFogShapeClock(this.sunTuning,this.clouds.timeSec,(targets.fog?.strength??1)-1,this.fogShapeClock);
    this.voidCreep?.setFogShape(this.sunTuning.fogStyle>.5,shape[0],shape[1],shape[2]);
    targets.lighting.setGlowLayer(this.voidCreep?.update(this.scene.cameras.main,targets.water?.getPresentationTime()??this.lastSceneTime/1000,
      Math.max(0,Math.min(1,(artificial-.1)/.6)),{rocks:quality.voidCreepRocks,glow:quality.voidCreepGlow,airborne:!!targets.fog?.carriesVoidHaze,
       motes:{layers:quality.voidMoteLayers,gradient:quality.voidMoteGradient}},
      quality.voidCreepRocks?targets.rocks?.getFormationCoverage()??null:null)??null);
  }
  if(this.voidEmission){
    if(targets.rockOverlays&&(voidRocksChanged||this.voidRockEmission!==this.voidEmission)){
     targets.rockOverlays.collectVoidColonies(this.voidRockColonies);this.voidEmission.setRockColonies(this.voidRockColonies);
     this.voidRockEmission=this.voidEmission;
    }
    // Veins and spores appear with the lamps' own dusk curve, fully at night.
    const artificial=targets.lighting.getArtificialLightFactor();
    this.voidEmission.update(Math.max(0,Math.min(1,(artificial-.1)/.6)),targets.water?.getPresentationTime()??this.lastSceneTime/1000);
  }
  this.sunComposite!.setEnabled(true);
  const m=targets.worldContext.metrics;
  this.sunComposite!.prepareClouds(m.offsetX,m.offsetY,m.widthPx,m.heightPx);
  this.sunFog.sunStrength=this.sunState.strength;
  this.sunFog.baseFogOpacity=this.fogBase?.opacity;
  this.sunFog.baseFogDetail=this.fogBase?.detail;
  targets.fog?.setWoodlandLight(this.sunFog);
  if(changed||!this.gradeBound){targets.postFx.setSunGrade(sunAtmosphereGrade(this.sunTuning,this.gradeUniforms),this.sunTuning.gradeOlive);this.gradeBound=true;}
 }
 private syncMoonSky(targets:Targets,minute:number):void {
  const sky=resolveMoonSky(minute,targets.moonlight,this.moonWeight>0?this.moon:null,this.moonWeight,this.moonSky);
  targets.rocks?.setMoonLight(writeMoonDirection(this.sunPath.castAzimuth,this.moonDirection),sky.relief);
  for(let i=0;i<3;i++)this.structureMoon[i]=this.moonDirection[i];
  this.structureMoon[3]=Number.isFinite(sky.relief)?Math.max(0,sky.relief):0;
  // The layer lives as long as this presentation: dusk and dawn only switch it, never rebuild it.
  if(!sky.active){targets.lighting.setAmbientLayer(null);return;}
  const tuning=this.moonClouds.tuning;
  for(const key of ['cloudScale','cloudEvolution','cloudGust','cloudWarp','cloudSoftness'] as const)tuning[key]=this.sunTuning[key];
  tuning.cloudSpeed=MOON_TUNING.cloudSpeed;tuning.cloudCover=sky.cover;tuning.cloudSpotAmount=0;
  this.moonClouds.timeSec=this.moonTimeSec;
  this.moonLight??=new MoonSkyLight(this.scene,this.moonClouds,this.moonSky);
  targets.lighting.setAmbientLayer(this.moonLight);
 }
 private gradeBound=false;
 private ambientMinute=NaN;
 private ambientMoonWeight=0;
 private sunMinute=NaN;
 private azimuthOverride:number|null=null;
  /** One danger field from the World and the running Activity; a changed one rebuilds the flora once. */
  private syncVoidField(targets:Targets):void {
    const sources=this.activityDanger?.sources??null;
    if(this.voidField&&sources===this.activitySources)return;
    this.activitySources=sources;
    const field=new VoidDangerField([...this.worldDanger,...(sources??[])],targets.layout.seed);
    if(field.signature===this.voidField?.signature)return;
    this.voidField=field;
    targets.rockOverlays?.setVoidFlora(field.empty?null:field);
    // Ponds, creep, water ink and spores all derive from the field.
    this.woodland?.destroy();this.woodland=null;this.woodlandLayout=null;
  }
  /** Presence of every hazy source as the Activity reports it now. */
  private readPresence(id:string):number {
    return Math.max(0,Math.min(1,this.activityDanger?.presenceOf(id)??1));
  }
  /** A place that lost or regained presence crossfades its haze; its plants stay (E7). */
  private syncVoidPresence():void {
    const field=this.voidField,creep=this.voidCreepField;
    if(!field||!creep||!this.voidCreep)return;
    for(const source of field.sources){
      if(source.haze<=0)continue;
      const present=this.readPresence(source.id),was=this.voidPresence.get(source.id)??1;
      if(Math.abs(present-was)<.01)continue;
      this.voidPresence.set(source.id,present);
      // A deactivated place is a success: its haze is lifted by a wave down to small patches.
      const lifted=present<=0&&was>0;
      if(lifted)this.refreshResidue();
      const reach=field.reachOf(source.id),rect=reach?voidCreepTexelRect(creep,reach):null;
      if(rect)this.voidCreep.fadeHaze(rect,buildVoidCreepHaze(creep,this.voidHazeSource,rect),lifted?field.extentOf(source.id):null);
    }
  }
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
      const danger=this.voidField&&!this.voidField.empty?this.voidField:null;
      markVoidPondColonies(placements,danger,voidLilyFrame);
      this.voidPondPoints.length=0;
      // One glow per colony at its first plant, with the colony's mean infestation.
      const colonies=new Map<number,{x:number;y:number;sum:number;n:number}>();
      for(const p of placements)if(p.void&&p.colony!==undefined){
        const c=colonies.get(p.colony)??{x:p.x,y:p.y,sum:0,n:0};c.sum+=p.voidAmount??1;c.n++;colonies.set(p.colony,c);}
      for(const c of colonies.values())this.voidPondPoints.push(c.x,c.y,c.sum/c.n);
      // One creep field joins ground, rock and water: the established takeover soaks the land,
      // infested ponds seep up their banks, and their pads and the creep ink the water.
      // A late joiner sees a destroyed base with only its residual patches; later changes crossfade.
      this.refreshResidue();
      this.voidPresence.clear();
      for(const source of danger?.sources??[])if(source.haze>0)this.voidPresence.set(source.id,this.readPresence(source.id));
      // The haze clings to land and banks; over open water the ink carries the void (G channel).
      const creep=danger?buildVoidCreepField(this.voidHazeSource,frame,this.voidPondPoints,(x,y)=>{
        const depth=water.distance(x-frame.offsetX,y-frame.offsetY);
        if(depth<0)return 1;
        const t=Math.min(1,depth/WATER_SHORE_DISTANCE);
        return 1-t*t*(3-2*t);
      }):null;
      this.voidCreepField=creep;
      // The airborne half rides in the ground fog: wakes cut it, stirred air blows it apart. The
      // fog lets go of the old field before it is rebuilt.
      targets.fog?.setVoidHaze(null);
      this.voidCreep?.setCreep(creep);
      targets.fog?.setVoidHaze(this.voidCreep?.airHaze??null);
      targets.water?.setVoidStain(buildVoidWaterStain(placements,frame,creep));
      this.voidEmission?.setPondPlacements(placements);
      this.woodland=new WoodlandEcologyRenderer(this.scene,placements);this.woodlandLayout=layout;
      loadingTimeline.end('ecology/woodland',measuredAt);
    }
    this.woodland?.update(this.sunTuning,targets.water,true,true,getGraphicsQualityProfile(this.scene).sunlight.ecologyDensity);
  }


 destroy():void {
  if(this.disposed)return;this.disposed=true;
  this.releaseCharacterMaterial?.();this.releaseCharacterMaterial=null;
  this.releasePlayerGlow?.();this.releasePlayerGlow=null;
  const t=this.targets;
  // Unbind receivers before destroying fields; the terrain may be handed to another World.
  t.ground?.setVegetationLight(undefined);t.water?.setSunlight(undefined);t.water?.setNightLight(null);t.water?.setVoidStain(null);t.wildlife?.setSunlight(undefined);
  t.fog?.setWoodlandLight(null);
  if(t.fog&&this.fogBase)Object.assign(t.fog.tuning,this.fogBase);
  t.rockOverlays?.setFormationReceiver(null);
  t.rocks?.setFormationOptions(true,true);t.rocks?.setSurfaceLights(null);
  t.rockOverlays?.setVoidFlora(null);this.voidGlow?.destroy();this.voidGlow=null;this.voidCreepField=null;this.voidResidue=null;
  this.voidEmission?.destroy();this.voidEmission=null;
  t.fog?.setVoidHaze(null);t.lighting.setGlowLayer(null);this.voidCreep?.destroy();this.voidCreep=null;
  t.lighting.setRockCoverage(null);
  t.shadow.setCharacterSunlight(null);
  t.shadow.setSunPath(null);t.shadow.setCanopyShadows(null);t.shadow.setFormationShadows(null);
  this.canopyLighting?.destroy();this.canopyLighting=null;this.woodland?.destroy();this.woodland=null;
  this.sunComposite?.destroy();this.sunComposite=null;this.clouds.cache=undefined;this.clouds.sunPath=undefined;
  t.lighting.setSunAmbient(null);t.postFx.setSunGrade(null);
  t.rocks?.setMoonLight(this.moonDirection,0);
  t.structures?.setSunlight(null);
  if(this.moonLight){t.lighting.setAmbientLayer(null);this.moonLight.destroy();this.moonLight=null;}
 }
}
