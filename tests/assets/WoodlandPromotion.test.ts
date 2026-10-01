import { it, expect } from 'vitest';
import sharp from 'sharp';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { woodlandAssetFiles, woodlandAssetBytes } from '../../src/assets/WoodlandAssetManifest';
const root='public/assets/environment/woodland';
const json=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
it('binds all delivered bytes to manifest hashes and reports actual boot/RGBA totals',async()=>{
  const manifests=await Promise.all(['rock/mineral','canopy/canopy','ecology/rock-colonies','ecology/ground-litter','ecology/lilies','sun/transmission'].map(p=>json('src/assets/manifests/'+p.split('/').at(-1)+'.json')));
  for(const [i,m] of manifests.entries()){
    const folder=i===0?'rock':i===1?'canopy':i===5?'sun':'ecology';
    const assets=i===0?[...m.assets,m.coverage]:i===1?m.atlases:i===5?[{...m,file:'transmission.png'}]:[m.atlas,...(m.contactAtlas?[m.contactAtlas]:[])];
    for(const a of assets){const bytes=await readFile(root+'/'+folder+'/'+a.file);expect(hash(bytes)).toBe(a.sha256);expect(bytes.length).toBe(a.downloadBytes);}
  }
  for(const limit of [4096,8192]){
    let download=0,rgba=0;for(const a of woodlandAssetFiles(limit)){const p='public/'+a.url.slice(2).split('?')[0];download+=(await readFile(p)).length;if(a.kind!=='coverage'){const m=await sharp(p).metadata();rgba+=m.width!*m.height!*4;}}
    expect(woodlandAssetBytes(limit)).toMatchObject({download,residentRGBA:rgba});
  }
},30000);

it('delivers exactly the manifest-bound production files',async()=>{
 const manifests=['rock/mineral','canopy/canopy','ecology/rock-colonies','ecology/ground-litter','ecology/lilies','sun/transmission'];
 const expected=new Set<string>();
 for(const limit of [4096,8192])for(const a of woodlandAssetFiles(limit))expected.add(a.url.split('/woodland/')[1].split('?')[0]);
 const publication=await json('src/assets/manifests/runtime-colours.json');
 for(const asset of Object.values(publication.assets) as {source:string;file:string}[]) {
   if(asset.source.includes('/woodland/'))expected.add(asset.source.split('/woodland/')[1]);
 }
 const actual:string[]=[];for(const folder of ['rock','canopy','ecology','sun'])for(const name of await readdir(root+'/'+folder))actual.push(folder+'/'+name);
 expect(actual.sort()).toEqual([...expected].sort());
});

it('does not deliver files from experimental asset directories',async()=>{
 const roots=await readdir('public/assets',{withFileTypes:true});
 for(const entry of roots.filter(e=>e.isDirectory()&&e.name.startsWith('dev-')))
   expect(await readdir('public/assets/'+entry.name)).toEqual([]);
});
