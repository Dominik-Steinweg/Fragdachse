import * as Phaser from 'phaser';
import { ROCK_FOLIAGE_MATERIAL } from '../arena/rocks/RockFoliageLighting';
import { CANOPY_MATERIAL } from '../arena/trees/CanopyLighting';
import { VEGETATION_MATERIAL } from '../effects/sunlight/VegetationLighting';
import { WATER_SHADER_NAME } from '../arena/waterSurfaceShader';
import { WATER_SUN_FRAGMENT } from '../arena/WaterSunlight';
import { MOON_SKY_FRAGMENT, MOON_SKY_SHADER_NAME } from '../effects/sunlight/MoonSkyLight';
import {
  ROCK_PENETRATION_FRAGMENT, ROCK_PENETRATION_SHADER_NAME, ROCK_SHADOW_POLAR_FRAGMENT, ROCK_SHADOW_POLAR_SHADER_NAME,
} from '../effects/RockPenetrationShader';
import {
  VOID_CREEP_GLOW_FRAGMENT, VOID_CREEP_GLOW_SHADER_NAME, VOID_CREEP_GROUND_FRAGMENT, VOID_CREEP_GROUND_SHADER_NAME,
  VOID_CREEP_ROCK_FRAGMENT, VOID_CREEP_ROCK_SHADER_NAME,
} from '../effects/sunlight/VoidCreepShaders';
import { VOID_SPORE_MOTES_FRAGMENT, VOID_SPORE_MOTES_SHADER_NAME } from '../effects/sunlight/VoidSporeMoteShaders';
import { VOID_TAINT_FRAGMENT, VOID_TAINT_SHADER_NAME, VOID_TAINT_VERTEX } from '../effects/sunlight/VoidTaintShaders';
import { addCharacterMaterialAddition } from '../effects/CharacterMaterialLighting';
import { STATUS_RING_FILL_FRAGMENT_SOURCE, STATUS_RING_FILL_SHADER_NAME, STATUS_RING_FRAGMENT_SOURCE,
  STATUS_RING_SHADER_NAME } from '../effects/living/statusRingShader';
import { beginShaderPrograms } from './compileShaderPrograms';
import { getBarSdfProgramManager } from '../effects/bars/BarSdfGpu';
import { disposeShaderWarmupNode } from './disposeShaderWarmupNode';

/** Link the real lobby materials while assets load, plus the local player's first-appearance programs
 * (character material, status ring, the shared bar SDF of HUD and world health bars) that otherwise
 * link when entering the training ground or on the first damage. Only the program cache is
 * published; textures, World data, uniforms and visible draws remain with their
 * ordinary owners. The returned barrier must finish before World construction. */
export function warmupWorldMaterials(scene: Phaser.Scene): () => void {
  const renderer=scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if(!renderer?.gl)return()=>{};
  // The WebGL1 fallback uses different smooth-pixel variants; its ordinary
  // first-use path owns those rather than compiling unused desktop variants.
  if(renderer.game.config.smoothPixelArt)return()=>{};
  const batches: Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle[]=[];
  const quads:Phaser.GameObjects.Shader[]=[];
  try {
    const materials:Phaser.Types.Renderer.WebGL.ShaderAdditionConfig[]=[CANOPY_MATERIAL,VEGETATION_MATERIAL];
    if(renderer.maxTextures>=6)materials.push(ROCK_FOLIAGE_MATERIAL);
    for(const material of materials){
      const batch=new Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle(renderer.renderNodes,{name:'WorldMaterialProbe'});
      batches.push(batch);batch.programManager.addAddition(material);batch.finalizeTextureCount(1);
    }
    const character=new Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle(renderer.renderNodes,{name:'CharacterMaterialProbe'});
    batches.push(character);addCharacterMaterialAddition(character.programManager);character.finalizeTextureCount(1);
    const name=WATER_SHADER_NAME+'Sunlight';
    // Night programs first link at dusk or at the first lamp on a rock; link them while loading.
    // The void trails (E12) bring their own vertex stage; the others use Phaser's quad.
    const programs:[string,string,string?][]=[[name,WATER_SUN_FRAGMENT],[STATUS_RING_SHADER_NAME,STATUS_RING_FRAGMENT_SOURCE],
      [STATUS_RING_FILL_SHADER_NAME,STATUS_RING_FILL_FRAGMENT_SOURCE],[MOON_SKY_SHADER_NAME,MOON_SKY_FRAGMENT],
      [ROCK_PENETRATION_SHADER_NAME,ROCK_PENETRATION_FRAGMENT],[ROCK_SHADOW_POLAR_SHADER_NAME,ROCK_SHADOW_POLAR_FRAGMENT],
      [VOID_CREEP_GROUND_SHADER_NAME,VOID_CREEP_GROUND_FRAGMENT],[VOID_CREEP_ROCK_SHADER_NAME,VOID_CREEP_ROCK_FRAGMENT],
      [VOID_CREEP_GLOW_SHADER_NAME,VOID_CREEP_GLOW_FRAGMENT],[VOID_SPORE_MOTES_SHADER_NAME,VOID_SPORE_MOTES_FRAGMENT],
      [VOID_TAINT_SHADER_NAME,VOID_TAINT_FRAGMENT,VOID_TAINT_VERTEX]];
    for(const [shaderName,fragmentSource,vertexSource] of programs)
      quads.push(new Phaser.GameObjects.Shader(scene,{name:shaderName,shaderName,fragmentSource,vertexSource},0,0,1,1));
    // Renderer-lifetime batch handler: only its program is linked here, it stays for its owners.
    let bars:Phaser.Renderer.WebGL.ProgramManager|null=null;
    try{bars=getBarSdfProgramManager(scene);}catch(error){console.warn('[WorldMaterials] Bar program unavailable.',error);}
    const finish=beginShaderPrograms(renderer,[...batches.map(b=>b.programManager),...quads.map(q=>q.renderNode.programManager),
      ...(bars?[bars]:[])]);
    return ()=>{
      try{finish();}catch(error){console.warn('[WorldMaterials] Precompile failed; using normal initialization.',error);}
    };
  } catch(error) {
    console.warn('[WorldMaterials] Precompile unavailable; using normal initialization.',error);return()=>{};
  } finally {
    // No suite/VAO was requested. Keep the renderer-owned compiled programs.
    for(const batch of batches){
      (renderer.renderNodes as unknown as Phaser.Events.EventEmitter).off(Phaser.Renderer.Events.SET_PARALLEL_TEXTURE_UNITS,batch.updateTextureCount,batch);
      renderer.off(Phaser.Renderer.Events.RESIZE,batch.resize,batch);
      renderer.deleteBuffer(batch.vertexBufferLayout.buffer);renderer.deleteBuffer(batch.indexBuffer);
    }
    for(const quad of quads){disposeShaderWarmupNode(quad.renderNode);quad.destroy();}
  }
}
