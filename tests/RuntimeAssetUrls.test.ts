import {expect,it} from 'vitest';
import {runtimeAssetUrl,installRuntimeAssetUrls} from '../src/assets/RuntimeAssetUrls';
import {EventEmitter} from 'node:events';
it('versions published bytes, preserving keys, prefixes, external URLs and retry identity',()=>{
 const logical='./assets/sprites/rock_base.png?v=old';const target=runtimeAssetUrl(logical);
 expect(target).toMatch(/^\.\/assets\/sprites\/rock_base\.webp\?v=[a-f0-9]{64}$/);
 expect(runtimeAssetUrl(target)).toBe(target);
 expect(runtimeAssetUrl(logical.replace('./','/'))).toBe(target.slice(1));
 for(const url of ['data:image/png;base64,abc','blob:abc','https://external.test/assets/a.png','./unknown.png?x=1'])expect(runtimeAssetUrl(url)).toBe(url);
 const loader=new EventEmitter();installRuntimeAssetUrls(loader as never);installRuntimeAssetUrls(loader as never);
 expect(loader.listenerCount('addfile')).toBe(1);
 const file={url:logical,key:'stable-texture'};loader.emit('addfile',file.key,'image',loader,file);
 expect(file).toEqual({url:target,key:'stable-texture'});
});

it('reinstalls the listener after loader shutdown without accumulating callbacks',()=>{
 const loader=new EventEmitter();installRuntimeAssetUrls(loader as never);loader.removeAllListeners();
 installRuntimeAssetUrls(loader as never);const file={url:'./assets/sprites/rock_base.png'};
 loader.emit('addfile','stable','image',loader,file);expect(file.url).toContain('.webp?v=');
 expect(loader.listenerCount('addfile')).toBe(1);
});
it('gives only versioned assets immutable preview headers and versions HTML font URLs',async()=>{
 const {runtimeAssetCache}=await import('../scripts/asset-cache');const plugin=runtimeAssetCache();let handler:any;
 (plugin.configurePreviewServer as Function)({middlewares:{use:(fn:Function)=>handler=fn}});
 const headers:Record<string,string>={};let next=0;const res={setHeader:(k:string,v:string)=>headers[k]=v};
 handler({url:runtimeAssetUrl('/assets/sprites/rock_base.png')},res,()=>next++);
 expect(headers['Cache-Control']).toContain('immutable');expect(next).toBe(1);
 for(const url of ['/','/index.html','/assets/sprites/rock_base.png?v=stale','/__api']){
  delete headers['Cache-Control'];handler({url},res,()=>next++);expect(headers).toEqual({});
 }
 const html=(plugin.transformIndexHtml as {handler:Function}).handler('<link href="/assets/fonts/chakra-petch-700.woff2">');
 expect(html).toContain('.woff2?v=');
});
