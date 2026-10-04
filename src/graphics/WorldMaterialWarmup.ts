import * as Phaser from 'phaser';
import { ROCK_FOLIAGE_MATERIAL } from '../arena/rocks/RockFoliageLighting';
import { CANOPY_MATERIAL } from '../arena/trees/CanopyLighting';
import { VEGETATION_MATERIAL } from '../effects/sunlight/VegetationLighting';
import { WATER_SHADER_NAME } from '../arena/waterSurfaceShader';
import { WATER_SUN_FRAGMENT } from '../arena/WaterSunlight';
import { beginShaderPrograms } from './compileShaderPrograms';
import { disposeShaderWarmupNode } from './disposeShaderWarmupNode';

/** Link the real lobby materials while assets load. Only the program cache is
 * published; textures, World data, uniforms and visible draws remain with their
 * ordinary owners. The returned barrier must finish before World construction. */
export function warmupWorldMaterials(scene: Phaser.Scene): () => void {
  const renderer=scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if(!renderer?.gl)return()=>{};
  // The WebGL1 fallback uses different smooth-pixel variants; its ordinary
  // first-use path owns those rather than compiling unused desktop variants.
  if(renderer.game.config.smoothPixelArt)return()=>{};
  const batches: Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle[]=[];
  let water:Phaser.GameObjects.Shader|null=null;
  try {
    const materials:Phaser.Types.Renderer.WebGL.ShaderAdditionConfig[]=[CANOPY_MATERIAL,VEGETATION_MATERIAL];
    if(renderer.maxTextures>=6)materials.push(ROCK_FOLIAGE_MATERIAL);
    for(const material of materials){
      const batch=new Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle(renderer.renderNodes,{name:'WorldMaterialProbe'});
      batches.push(batch);batch.programManager.addAddition(material);batch.finalizeTextureCount(1);
    }
    const name=WATER_SHADER_NAME+'Sunlight';
    water=new Phaser.GameObjects.Shader(scene,{name,shaderName:name,fragmentSource:WATER_SUN_FRAGMENT},0,0,1,1);
    const finish=beginShaderPrograms(renderer,[...batches.map(b=>b.programManager),water.renderNode.programManager]);
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
    if(water){disposeShaderWarmupNode(water.renderNode);water.destroy();}
  }
}
