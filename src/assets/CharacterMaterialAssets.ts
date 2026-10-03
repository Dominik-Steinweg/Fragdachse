import type * as Phaser from 'phaser';
import { loadingTimeline } from '../diagnostics/LoadingTimeline';
import { CHARACTER_MATERIAL_PAGES } from './CharacterMaterialAssetManifest';
import { runtimeAssetUrl } from './RuntimeAssetUrls';

export function preloadCharacterMaterialAssets(scene: Phaser.Scene): void {
  for (const page of CHARACTER_MATERIAL_PAGES) if (!scene.textures.exists(page.key)) {
    // Both passes are straight data on upload. The shader decodes albedo sRGB
    // explicitly; normal A is accessibility, never opacity or a PMA multiplier.
    const configure = (key:string, type:string, _loader:Phaser.Loader.LoaderPlugin, file:Phaser.Loader.File):void => {
      if (key!==page.key || type!=='image') return;
      const complete=file.onProcessComplete;
      file.onProcessComplete=():void=>{
        const started = loadingTimeline.start();
        try {
          const image=file.data as HTMLImageElement;
          if(image.width!==page.width || image.height!==page.height)throw new Error('Character material dimensions');
          const renderer=scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer,gl=renderer.gl;
          const wrapper=renderer.createTexture2D(0,gl.LINEAR,gl.LINEAR,gl.CLAMP_TO_EDGE,gl.CLAMP_TO_EDGE,
            gl.RGBA,image,page.width,page.height,false,false,false);
          if(!scene.textures.addGLTexture(page.key,wrapper)){wrapper.destroy();throw new Error('Character material upload');}
        } catch { file.onProcessError(); return; }
        finally { loadingTimeline.end('assets/character-material-upload', started); }
        complete.call(file);
      };
      file.addToCache=():void=>{};
    };
    // ADD is synchronous in Phaser 4.2.1: specialize this ImageFile only. Keep
    // the binary manifest/mesh math importable without a browser/Phaser singleton.
    scene.load.on('addfile',configure);
    try { scene.load.image(page.key,runtimeAssetUrl('./'+page.url)); }
    finally { scene.load.off('addfile',configure); }
  }
}
export function assertCharacterMaterialAssetsReady(scene: Phaser.Scene): void {
  for (const page of CHARACTER_MATERIAL_PAGES)
    if (!scene.textures.exists(page.key)) throw new Error(`Missing character material: ${page.key}`);
}
