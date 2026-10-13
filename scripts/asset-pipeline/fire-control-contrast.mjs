// Native-size body/woodland contrast. One fixed, geometry-derived HQ3 mask is
// reused for all versions; optical glass AND emissive geometry are excluded.
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [current, previous, drafts, masks, output, mode] = process.argv.slice(2);
if (!output) throw Error('Usage: <HQ4 run or preview-prefix> <HQ3 run> <draft root> <mask folder> <output.json> [preview]');
const ids=['fire-control-relay','held-fire-control-relay','held-fire-control-portal','fire-control-portal-flight'];
const sizes=[48,128,128,34], display=[24,32,32,16];
const sources={};
async function read(file) { const data=await fs.readFile(file);sources[path.resolve(file)]=createHash('sha256').update(data).digest('hex');return data; }
async function native(file,i) {
  const src=await sharp(await read(file)).resize(sizes[i],sizes[i]).png().toBuffer();
  return sharp(src).resize(display[i],display[i]).ensureAlpha().raw().toBuffer();
}
const bg=await sharp(await read('public/assets/sprites/dirt_material.png')).extract({left:0,top:0,width:448,height:128})
  .modulate({brightness:.48,saturation:.6}).removeAlpha().raw().toBuffer();
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const luminance=rgb=>rgb.reduce((sum,v,i)=>sum+linear(v/255)*[.2126,.7152,.0722][i],0);
const report={method:'Mean signed CIE relative-luminance difference Y(composited body) - Y(ground), linear sRGB / D65. Fixed HQ3 geometry mask excludes optical glass and both emissives; native pixels require white-mask value>=253/255 and alpha>=128/255. Same woodland crop at (102,60), same mask and selected-source-to-display Lanczos3 reduction for every version. Flight 16.32px canvas rasterized to 16px.',sources,assets:[]};
for(let i=0;i<4;i++) {
  const id=ids[i], frame='frame-0000.png';
  const draft=i===1?path.join(drafts,'v1-h-authoring/art/poc/pipeline-v2/runs/fc-v1-h-draft',id,'standard/masters',frame):path.join(drafts,id,'preview',frame);
  const next=mode==='preview'?path.join(current+'-'+id,id,frame):path.join(current,id,'standard/masters',frame);
  const images=await Promise.all([draft,path.join(previous,id,'standard/masters',frame),next].map(file=>native(file,i)));
  const mask=await native(path.join(masks,id+'.png'),i), n=display[i];
  const selected=[];
  for(let pixel=0;pixel<n*n;pixel++) if(mask[pixel*4]>=253&&mask[pixel*4+3]>=128) selected.push(pixel);
  if(!selected.length)throw Error('Empty hardware mask: '+id);
  const versions={};
  for(let v=0;v<3;v++){
    let contrast=0,bodyY=0,groundY=0;
    for(const pixel of selected){
      const x=pixel%n,y=Math.floor(pixel/n),b=((60-n/2+y)*448+102-n/2+x)*3;
      const ground=Array.from(bg.subarray(b,b+3)),alpha=images[v][pixel*4+3]/255;
      const body=ground.map((g,c)=>images[v][pixel*4+c]*alpha+g*(1-alpha));
      const gy=luminance(ground),by=luminance(body);contrast+=by-gy;bodyY+=by;groundY+=gy;
    }
    versions[['Draft','HQ3','HQ4'][v]]={contrast:contrast/selected.length,bodyY:bodyY/selected.length,groundY:groundY/selected.length};
  }
  report.assets.push({id,displaySize:n,bodyPixels:selected.length,maskPixelIndices:selected,versions,passed:versions.HQ4.contrast>=versions.Draft.contrast});
}
report.passed=report.assets.every(a=>a.passed);
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.assets.map(a=>({id:a.id,pixels:a.bodyPixels,contrast:Object.fromEntries(Object.entries(a.versions).map(([k,v])=>[k,v.contrast])),passed:a.passed})),null,2));
if(!report.passed)process.exitCode=2;
