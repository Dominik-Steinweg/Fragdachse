import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { sha256, visiblePixels } from './lib/runtime-colours.mjs';

const manifest = JSON.parse(await readFile('src/assets/manifests/runtime-colours.json', 'utf8'));
const proof = 'build/a2-proof';
await mkdir(proof, { recursive: true });
const pairs = [], candidates = [];
for (const asset of Object.values(manifest.assets)) {
  const before = await readFile(`public/${asset.source}`), after = await readFile(`public/${asset.file}`);
  if (sha256(before) !== asset.sourceSha256 || sha256(after) !== asset.sha256) throw Error(`Stale publication: ${asset.file}`);
  const a = visiblePixels(await sharp(before).ensureAlpha().raw().toBuffer());
  const b = visiblePixels(await sharp(after).ensureAlpha().raw().toBuffer());
  if (!a.equals(b) || sha256(b) !== asset.visiblePixelSha256) throw Error(`Pixel mismatch: ${asset.file}`);
  pairs.push({ source: '/' + asset.source, target: '/' + asset.file, pma: true });
}
for (const file of ['canopy/normal-ao-thickness.png', 'canopy/horizon-0.png', 'canopy/horizon-1.png',
  'rock/mineral-height.png', 'sun/transmission.png', 'ecology/rock-contact-atlas.png']) {
  const source = `assets/environment/woodland/${file}`;
  const original = `build/a2-original/${file}`;
  const baseline = await readFile(original).catch(() => null);
  const bytes = baseline ?? await readFile(`public/${source}`);
  const {data, info} = await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const png = await sharp(bytes).png({compressionLevel:9, adaptiveFiltering:true, palette:false}).toBuffer();
  const webp = await sharp(bytes).webp({lossless:true, effort:6}).toBuffer();
  const decoded = await sharp(webp).ensureAlpha().raw().toBuffer();
  let changed = 0;
  for (let i=0;i<data.length;i++) if (decoded[i]!==data[i]) changed++;
  // Opaque two-panel packing is exact but needs an additional runtime decode/unpack and memory.
  const rgb = Buffer.alloc(info.width*info.height*6);
  for (let p=0;p<info.width*info.height;p++) {
    const x=p%info.width, y=Math.floor(p/info.width), i=(y*info.width*2+x)*3;
    data.copy(rgb,i,p*4,p*4+3); rgb.fill(data[p*4+3],i+info.width*3,i+info.width*3+3);
  }
  const packed = await sharp(rgb,{raw:{width:info.width*2,height:info.height,channels:3}}).webp({lossless:true,effort:6}).toBuffer();
  if (!(await sharp(png).ensureAlpha().raw().toBuffer()).equals(data)) throw Error(`PNG changed data: ${file}`);
  if (!(await sharp(packed).removeAlpha().raw().toBuffer()).equals(rgb)) throw Error(`Packed channels changed: ${file}`);
  candidates.push({ file, original:bytes.length, optimizedPng:png.length, webp:webp.length, webpChangedChannels:changed,
    opaquePackedWebp:packed.length, retained:'optimized lossless PNG; unchanged decode/upload contract' });
  const raw = `data-${pairs.length}.rgba`; await writeFile(`${proof}/${raw}`,data);
  pairs.push({source:baseline ? '/'+original : '/'+source,target:'/'+source,pma:false,raw});
}
await writeFile(`${proof}/pairs.json`, JSON.stringify(pairs,null,2));
await writeFile(`${proof}/data-candidates.json`, JSON.stringify(candidates,null,2));
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
 const raw=p.raw?new Uint8Array(await (await fetch(p.raw)).arrayBuffer()):a;
 let changed=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i]||b[i]!==raw[i])changed++;
 results.push({file:p.target,pma:p.pma,channels:b.length,changed});
 if(changed)throw Error('Channel mismatch: '+p.target);
 document.querySelector('#result').textContent=JSON.stringify(results,null,2);
}window.__ASSET_PROOF__={passed:true,results};document.querySelector('#result').textContent='PASS\\n'+JSON.stringify(results,null,2);
}catch(error){window.__ASSET_PROOF__={passed:false,error:String(error),results};document.querySelector('#result').textContent=JSON.stringify(window.__ASSET_PROOF__,null,2);throw error;}
</script>`);
console.log(JSON.stringify({ colours:pairs.length-candidates.length, candidates, browserProof:proof+'/index.html' },null,2));
