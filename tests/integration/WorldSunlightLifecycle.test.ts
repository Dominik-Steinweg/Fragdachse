import {describe,it,expect,vi} from 'vitest';
const resources=vi.hoisted(()=>({canopies:new Set<object>(),fields:new Set<object>(),flora:new Set<object>()}));
vi.mock('phaser',async()=>{const {createFakePhaserModule}=await import('../fakeArenaRenderScene');return {...createFakePhaserModule(),Filters:{ParallelFilters:class {},Displacement:class {}}};});
vi.mock('../../src/arena/trees/CanopyLighting',()=>({CanopyLighting:class {
 constructor(){resources.canopies.add(this);}setClouds(){}setLighting(){}update(){}destroy(){resources.canopies.delete(this);}
}}));
vi.mock('../../src/effects/sunlight/WorldSunComposite',()=>({WorldSunComposite:class {
 diagnostics={}; constructor(){resources.fields.add(this);}setEnabled(){}prepareClouds(){}destroy(){resources.fields.delete(this);}
}}));
vi.mock('../../src/arena/WoodlandEcologyRenderer',()=>({WoodlandEcologyRenderer:class {
 count=0;constructor(){resources.flora.add(this);}update(){}destroy(){resources.flora.delete(this);}
}}));
import {WorldSunlightPresentation} from '../../src/effects/sunlight/WorldSunlightPresentation';
import {WorldPresentationFrameBinding} from '../../src/world/WorldPresentationFrameBinding';
import {WorldPresentationBinding} from '../../src/world/WorldPresentationBinding';
import {WorldRuntime} from '../../src/world/WorldRuntime';
import {WorldPresentationHandoff} from '../../src/world/WorldPresentationHandoff';
import {GraphicsQualityController} from '../../src/graphics/GraphicsQuality';
import {WorldLightingMeasurement} from '../../src/dev/scenario/WorldLightingMeasurement';
import {PersistentBaseEditorWorld} from '../../src/persistentBase/PersistentBaseEditorWorld';
import {ArenaBuilder} from '../../src/arena/ArenaBuilder';

function fixture(){
 const sharedTexture={};const scene={textures:{get:()=>sharedTexture,remove:vi.fn()},add:{particles:vi.fn()},
  cameras:{main:{scrollX:0,scrollY:0,width:1280,height:720,zoom:1}},game:{loop:{delta:16}}};
 const lighting={setSunAmbient:vi.fn(),getTimeOfDayMinutes:()=>480,setDynamicOccluderSource:vi.fn(),clearDynamicOccluderSource:vi.fn()};
 const shadow={setCharacterSunlight:vi.fn(),setCharacterShadowsSuppressed:vi.fn(),setSunPath:vi.fn(),setCanopyShadows:vi.fn(),setFormationShadows:vi.fn()};
 let vegetation:unknown;const ground={setVegetationLight:vi.fn((s:any)=>{vegetation=s?.quality?.vegetationForm?s:undefined;})};
 const targets={ground,rocks:{setFormationOptions:vi.fn(),setSunTime:vi.fn(),getFormationReceiver:()=>null},
  rockOverlays:{setFormationReceiver:vi.fn(),setEcologyTuning:vi.fn()},canopies:[],
  water:{isPrepared:()=>true,getPreparedMasks:()=>[],setSunlight:vi.fn()},wildlife:{setSunlight:vi.fn(),clearLights:vi.fn()},
  lighting,shadow,postFx:{setSunGrade:vi.fn()},fog:{tuning:{opacity:.5,detail:.65},setWoodlandLight:vi.fn()},
  layout:{seed:12345,rocks:[],trees:[],dirt:[],water:[],tracks:[],decals:[],powerUpPedestals:[]},
  worldContext:{metrics:{offsetX:0,offsetY:0,widthPx:1024,heightPx:768},bases:[]}};
 const quality=new GraphicsQualityController();quality.attach(scene as never);
 const input={scene,lighting,getArenaResult:()=>({wildlife:targets.wildlife}),getWorldLayout:()=>null};
 return {scene,targets,quality,input,vegetation:()=>vegetation};
}
function expectEmpty(){expect(resources.canopies.size+resources.fields.size+resources.flora.size).toBe(0);}

describe('Sonnenwald production World lifetime',()=>{
 it.each([['A','B','A'],['Lobby','Arena','Lobby']])('unbinds before handoff and rebinds %s -> %s -> %s',(...names)=>{
  const f=fixture(),handoff=new WorldPresentationHandoff();let previous:WorldSunlightPresentation|null=null;
  for(let i=0;i<names.length;i++){
   const world=new WorldRuntime({descriptor:{worldRevision:i+1,definitionId:names[i]}} as never);
   const terrain=new WorldPresentationBinding(f.targets.layout as never,{} as never,{destroyPresentation:vi.fn()});
   world.setPresentation(terrain);
   const frame=new WorldPresentationFrameBinding(f.input as never);world.bindPresentationFrame(frame);
   const owner=new WorldSunlightPresentation(f.scene as never,f.targets as never);frame.bindSunlight(()=>owner);
   owner.update(480,33);expect(resources.fields.size).toBe(1);expect(resources.canopies.size).toBe(1);
   expect(f.targets.water.setSunlight).toHaveBeenLastCalledWith(owner.clouds);
   expect(f.targets.shadow.setCharacterSunlight).toHaveBeenLastCalledWith(owner.clouds);
   // An old asynchronous callback cannot clear the new world's receiver.
   previous?.destroy();previous?.update(720,999);expect(f.targets.water.setSunlight).toHaveBeenLastCalledWith(owner.clouds);
   handoff.release(world.releasePresentation());expect(frame.sunlight).toBeNull();expectEmpty();
   expect(f.targets.water.setSunlight).toHaveBeenLastCalledWith(undefined);
   expect(f.targets.fog.setWoodlandLight).toHaveBeenLastCalledWith(null);
   expect(f.targets.rockOverlays.setFormationReceiver).toHaveBeenLastCalledWith(null);
   expect(f.targets.fog.tuning).toEqual({opacity:.5,detail:.65});
   world.destroy();handoff.discard();previous=owner;
  }
  expect(f.scene.textures.remove).not.toHaveBeenCalled();f.quality.destroy();
 });
 it('keeps one writer through quality changes, pause and stale debug teardown',async()=>{
  const f=fixture(),owner=new WorldSunlightPresentation(f.scene as never,f.targets as never);
  owner.update(480,100);const path=owner.clouds.sunPath;owner.update(480,100);expect(owner.clouds.timeSec).toBe(.1);
  for(const level of ['high','low','high'] as const){f.quality.setLevel(level);owner.update(480,116);expect(!!f.vegetation()).toBe(level!=='low');expect(owner.clouds.sunPath).toBe(path);}
  const debug=new WorldLightingMeasurement(f.scene as never,()=>({...f.targets,sunlight:owner}) as never);
  expect(resources.fields.size).toBe(1);expect(owner.clouds.sunPath).toBe(path);
  debug.tuneSun({fogOpacity:.25});expect(owner.sunTuning.fogOpacity).toBe(.25);
  owner.destroy();debug.destroy();expectEmpty();f.quality.destroy();
 });
 it('closes the editor owner before the underlying world and can reopen in the same scene',()=>{
  const f=fixture();const original=ArenaBuilder.destroyDynamic;
  const destroy=vi.spyOn(ArenaBuilder,'destroyDynamic').mockImplementation(()=>{expectEmpty();});
  for(let i=0;i<2;i++){
   const owner=new WorldSunlightPresentation(f.scene as never,f.targets as never);owner.update(480,16);
   const port=()=>({destroy:vi.fn()});
   const editor=Object.assign(Object.create(PersistentBaseEditorWorld.prototype),{
    sunlight:owner,fx:port(),fog:port(),powerUps:port(),gpu:port(),animations:{clear:vi.fn()},turrets:new Map(),
    bases:port(),shadows:port(),lighting:port(),arena:{},background:{ground:port(),macro:port()},
   });
   editor.destroy();expectEmpty();
  }
  expect(destroy).toHaveBeenCalledTimes(2);destroy.mockRestore();expect(ArenaBuilder.destroyDynamic).toBe(original);f.quality.destroy();
 });
});


it('binds the production owner for all authored maps, modes, lobby and empty-feature worlds',async()=>{
 const {COOP_DEFENSE_MAP_CONFIGS}=await import('../../src/config/coopDefenseMaps');
 const {ArenaGenerator,resolveArenaGenerationInput}=await import('../../src/arena/ArenaGenerator');
 const {getArenaMetricsProfile,CELL_SIZE}=await import('../../src/config');
 const {resolveWorldMetrics}=await import('../../src/world/WorldMetrics');
 const {buildLobbyWorldLayout}=await import('../../src/arena/LobbyWorldLayout');
 const {parseTimeOfDay}=await import('../../src/effects/TimeOfDay');
 const {SUN_RENDER_QUALITY,cloudFieldSize}=await import('../../src/effects/sunlight/SunRenderQuality');
 const {writeFileSync}=await import('node:fs');
 const cases:any[]=[];
 for(const map of COOP_DEFENSE_MAP_CONFIGS){const metrics=resolveWorldMetrics(getArenaMetricsProfile('coop_defense','ARENA',map.arenaWidthCells,map.arenaHeightCells));
  cases.push({name:'Map '+map.mapId,map,metrics,layout:ArenaGenerator.generate(12345,resolveArenaGenerationInput('coop_defense',metrics),map),minute:parseTimeOfDay(map.timeOfDay!)??720});}
 for(const mode of ['deathmatch','team_deathmatch','capture_the_beer'] as const){const metrics=resolveWorldMetrics(getArenaMetricsProfile(mode,'ARENA'));
  cases.push({name:mode,metrics,layout:ArenaGenerator.generate(12345,resolveArenaGenerationInput(mode,metrics)),minute:720});}
 const lobbyMetrics=resolveWorldMetrics(getArenaMetricsProfile('deathmatch','LOBBY'));
 cases.push({name:'Lobby',metrics:lobbyMetrics,layout:buildLobbyWorldLayout(),minute:480});
 for(const missing of ['water','trees','rocks','all']){const layout=buildLobbyWorldLayout();if(missing==='all'){layout.water=[];layout.trees=[];layout.rocks=[];}else (layout as any)[missing]=[];
  cases.push({name:'Without '+missing,metrics:lobbyMetrics,layout,minute:1140});}
 const report=[];
 for(const entry of cases){const f=fixture();Object.assign(f.targets,{layout:entry.layout,worldContext:{metrics:entry.metrics,bases:[]}});
  f.targets.canopies=entry.layout.trees.map((c:any)=>({worldX:entry.metrics.offsetX+(c.gridX+.5)*CELL_SIZE,worldY:entry.metrics.offsetY+(c.gridY+.5)*CELL_SIZE,gfx:{displayWidth:120,displayHeight:120}}));
  if(!entry.layout.water?.length)f.targets.water=null as any;
  if(!entry.layout.rocks.length){f.targets.rocks=null as any;f.targets.rockOverlays=null as any;}
  const owner=new WorldSunlightPresentation(f.scene as never,f.targets as never);
  for(const level of ['high','medium','low'] as const){f.quality.setLevel(level);owner.update(entry.minute,100);owner.update(entry.minute,900);
   for(const value of Object.values(owner.sunStatus))expect(Number.isFinite(value),entry.name).toBe(true);
   expect(owner.clouds.sunPath).toBeDefined();expect(f.targets.fog.setWoodlandLight).toHaveBeenCalled();}
  const q=[0,0];cloudFieldSize(q,entry.metrics.widthPx,entry.metrics.heightPx,SUN_RENDER_QUALITY.high);
  report.push({name:entry.name,minute:entry.minute,void:entry.map?.trackMode==='void-fire',width:entry.metrics.widthPx,height:entry.metrics.heightPx,rocks:entry.layout.rocks.length,trees:entry.layout.trees.length,water:entry.layout.water?.length??0,cloudTexelX:entry.metrics.widthPx/q[0],cloudTexelY:entry.metrics.heightPx/q[1],status:'CPU owner bindings OK'});
  owner.destroy();expectEmpty();f.quality.destroy();
 }
 writeFileSync('build/sonnenwald-world-matrix.json',JSON.stringify(report,null,2));
},30000);

it('keeps semantic grade inputs through both writer orders and unbind',async()=>{
 const {CameraPostFxController}=await import('../../src/effects/postfx/CameraPostFxController');
 const {resolveBaseGrade,NEUTRAL_WORLD_GRADE}=await import('../../src/effects/postfx/worldGrade');
 const {resolveSkyState}=await import('../../src/effects/TimeOfDay');
 const fx=Object.assign(Object.create(CameraPostFxController.prototype),{baseGrade:NEUTRAL_WORLD_GRADE,sunGrade:null,sunGradeBuffer:{...NEUTRAL_WORLD_GRADE},sunOliveMatrix:new Array(20).fill(0),update:vi.fn()});
 const inputs={skyState:resolveSkyState(1290),isVoidMap:true,bossVisualProfile:'void-hunter' as const,bossPhase:1,localHpFraction:.2,gamePhase:'ARENA' as const};
 const solar={temperature:.05,saturation:1.1,contrast:1.05,brightness:.95,bloomAmount:.1};
 fx.setBaseGrade(resolveBaseGrade(inputs),inputs);fx.setSunGrade(solar);
 expect(fx.effectiveGrade).toEqual(resolveBaseGrade(inputs,solar));
 const next={...inputs,bossPhase:2};fx.setBaseGrade(resolveBaseGrade(next),next);expect(fx.effectiveGrade).toEqual(resolveBaseGrade(next,solar));
 fx.setSunGrade({...solar,temperature:.15});expect(fx.effectiveGrade.temperature).toBe(-.84);
 fx.setSunGrade(null);expect(fx.effectiveGrade).toEqual(resolveBaseGrade(next));
});
