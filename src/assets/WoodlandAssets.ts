import { loadingTimeline } from '../diagnostics/LoadingTimeline';
import * as Phaser from 'phaser';
import { ROCK_BASE_FRAME_SIZE, ROCK_BASE_FRAME_MARGIN, ROCK_BASE_FRAME_SPACING } from '../arena/RockBaseConfig';
import { woodlandAssetFiles, type WoodlandAsset } from './WoodlandAssetManifest';

function maximumTextureSize(scene: Phaser.Scene): number {
  const gl=(scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl;
  return gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) as number : 0;
}
/** Standard Loader file lifecycle (XHR, decode, progress, loaderror), with a
 * controlled upload for non-colour channels. All caches are game-owned. */
export class WoodlandImageFile extends Phaser.Loader.FileTypes.ImageFile {
  constructor(loader: Phaser.Loader.LoaderPlugin, private readonly asset: WoodlandAsset) {
    super(loader,{key:asset.key,url:asset.url});
    if(asset.kind==='coverage') this.cache=loader.cacheManager.binary;
  }
  onProcessComplete(): void {
    const measuredAt = loadingTimeline.start();
    try {
      const a=this.asset,image=this.data as HTMLImageElement;
      if(image.width!==a.width||image.height!==a.height) throw new Error('Invalid woodland image dimensions: '+a.key);
      const textures=this.loader.textureManager;
      if(a.kind==='coverage') {
        const canvas=document.createElement('canvas');canvas.width=a.width;canvas.height=a.height;
        try {
          const context=canvas.getContext('2d',{willReadFrequently:true});
          if(!context)throw new Error('Coverage decoder unavailable');
          context.drawImage(image,0,0);
          const rgba=context.getImageData(0,0,a.width,a.height).data, alpha=new Uint8Array(a.width*a.height);
          for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];
          this.loader.cacheManager.binary.add(a.key,alpha);
        } finally {canvas.width=canvas.height=0;}
      } else {
        if(a.kind==='data') {
          // A encodes thickness/horizon, not transparency. No canvas or PMA conversion.
          const renderer=this.loader.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer,gl=renderer.gl;
          const wrapper=renderer.createTexture2D(0,gl.LINEAR,gl.LINEAR,gl.CLAMP_TO_EDGE,gl.CLAMP_TO_EDGE,
            gl.RGBA,image,a.width,a.height,false,false,false);
          if(!textures.addGLTexture(a.key,wrapper)) {wrapper.destroy();throw new Error('Woodland data upload failed');}
        } else if(a.kind==='atlas') textures.addAtlas(a.key,image,{frames:a.frames});
        else if(a.kind==='sheet') {
          const scale=a.scale??1;
          textures.addSpriteSheet(a.key,image,{frameWidth:ROCK_BASE_FRAME_SIZE*scale,frameHeight:ROCK_BASE_FRAME_SIZE*scale,
            margin:ROCK_BASE_FRAME_MARGIN*scale,spacing:ROCK_BASE_FRAME_SPACING*scale});
        } else textures.addImage(a.key,image);
        if(!textures.exists(a.key))throw new Error('Woodland texture upload failed: '+a.key);
        if(a.linear||a.kind==='data')textures.get(a.key).setFilter(Phaser.Textures.FilterMode.LINEAR);
      }
    } catch {
      // A failed decode/upload must finish the Loader error path, never stall its queue.
      if(this.asset.kind==='coverage')this.loader.cacheManager.binary.remove(this.asset.key);
      else if(this.loader.textureManager.exists(this.asset.key))this.loader.textureManager.remove(this.asset.key);
      this.onProcessError();return;
    }
    loadingTimeline.end('woodland/upload-or-coverage/' + this.asset.key, measuredAt);
    super.onProcessComplete();
  }
  // Upload is validated before reporting completion; no second automatic image upload.
  addToCache(): void {}
}
export function preloadWoodlandAssets(scene: Phaser.Scene): void {
  for(const asset of woodlandAssetFiles(maximumTextureSize(scene))) {
    const exists=asset.kind==='coverage'?scene.cache.binary.exists(asset.key):scene.textures.exists(asset.key);
    if(!exists)scene.load.addFile(new WoodlandImageFile(scene.load,asset));
  }
}
/** Run inside BootPreparation so failures use the existing failed/retry screen. */
export function assertWoodlandAssetsReady(scene: Phaser.Scene): void {
  for(const asset of woodlandAssetFiles(maximumTextureSize(scene))) {
    const exists=asset.kind==='coverage'?scene.cache.binary.exists(asset.key):scene.textures.exists(asset.key);
    if(!exists)throw new Error('Waldgrafik konnte nicht geladen werden: '+asset.url);
  }
}
