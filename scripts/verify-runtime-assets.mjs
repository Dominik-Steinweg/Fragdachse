import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { sha256, visiblePixels } from './lib/runtime-colours.mjs';

// Offline pixel proof of every lossless publication, plus a browser page that repeats the game's
// Blob -> HTMLImageElement -> WebGL upload for the source and published file of each pair.
// Serve public/ at / and build/ at /build/, open /build/a2-proof/index.html; it sets window.__ASSET_PROOF__.
const manifest = JSON.parse(await readFile('src/assets/manifests/runtime-colours.json', 'utf8'));
const proof = 'build/a2-proof';
await mkdir(proof, { recursive: true });
const pairs = [], skipped = {};
for (const asset of Object.values(manifest.assets)) {
  if (asset.category !== 'colour' && asset.category !== 'data') { skipped[asset.category] = (skipped[asset.category] ?? 0) + 1; continue; }
  const before = await readFile(`public/${asset.source}`), after = await readFile(`public/${asset.file}`);
  if (sha256(before) !== asset.sourceSha256 || sha256(after) !== asset.sha256) throw Error(`Stale publication: ${asset.file}`);
  const a = await sharp(before).ensureAlpha().raw().toBuffer();
  const b = await sharp(after).ensureAlpha().raw().toBuffer();
  if (asset.category === 'data') {
    // Data keeps every channel: compare raw RGBA, then both upload modes in the browser.
    if (!a.equals(b) || sha256(b) !== asset.pixelSha256) throw Error(`Data mismatch: ${asset.file}`);
    pairs.push({ source: '/' + asset.source, target: '/' + asset.file, pma: false });
  } else if (!visiblePixels(a).equals(visiblePixels(b)) || sha256(visiblePixels(b)) !== asset.visiblePixelSha256) throw Error(`Pixel mismatch: ${asset.file}`);
  pairs.push({ source: '/' + asset.source, target: '/' + asset.file, pma: true });
}
await writeFile(`${proof}/pairs.json`, JSON.stringify(pairs, null, 2));
await writeFile(`${proof}/index.html`, `<!doctype html><meta charset="utf-8"><title>Runtime asset channel proof</title>
<pre id="result">Running ImageFile-style Blob -> HTMLImageElement -> WebGL upload comparison...</pre>
<script type="module">
const pairs=await (await fetch('./pairs.json')).json(), results=[];
const canvas=document.createElement('canvas'), gl=canvas.getContext('webgl2');
if(!gl)throw Error('WebGL2 required');
async function upload(path,pma){
 const blob=await (await fetch(path)).blob(), url=URL.createObjectURL(blob), img=new Image();
 try{await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src=url});}finally{URL.revokeObjectURL(url)}
 if(img.width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||img.height>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw Error('MAX_TEXTURE_SIZE too small for '+path);
 const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
 gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,pma);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
 const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
 if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete framebuffer');
 const data=new Uint8Array(img.width*img.height*4);gl.readPixels(0,0,img.width,img.height,gl.RGBA,gl.UNSIGNED_BYTE,data);
 const error=gl.getError();gl.deleteFramebuffer(f);gl.deleteTexture(t);if(error)throw Error('GL '+error);return data;
}
try{for(const p of pairs){
 const a=await upload(p.source,p.pma), b=await upload(p.target,p.pma);
 let changed=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;
 results.push({file:p.target,pma:p.pma,channels:b.length,changed});
 if(changed)throw Error('Channel mismatch: '+p.target);
 document.querySelector('#result').textContent=results.length+' / '+pairs.length;
}window.__ASSET_PROOF__={passed:true,results};document.querySelector('#result').textContent='PASS\\n'+JSON.stringify(results,null,2);
}catch(error){window.__ASSET_PROOF__={passed:false,error:String(error),results};document.querySelector('#result').textContent=JSON.stringify(window.__ASSET_PROOF__,null,2);throw error;}
</script>`);
console.log(JSON.stringify({ pairs: pairs.length, nonPma: pairs.filter(p => !p.pma).length, skipped, browserProof: proof + '/index.html' }, null, 2));
