import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {CHARACTER_SHADOW_FILES,CHARACTER_SHADOW_MANIFEST as manifest} from '../../src/assets/CharacterShadowAssetManifest';

it('published shadow pages retain source bytes, linear RGBA channels and complete displayed poses',async()=>{
 const samples=manifest.samples.filter(s=>s.pass==='shadow');
 expect(samples.length).toBe(manifest.poses.length*manifest.canvases.length);
 let independentRgb=false;
 for(const file of CHARACTER_SHADOW_FILES){
  const page=manifest.pages.find(p=>p.sha256===file.sha256)!;
  const bytes=await readFile('public/'+page.file),meta=await sharp(bytes).metadata();
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(page.sha256);
  expect(bytes.length).toBe(page.downloadBytes);expect(meta.width).toBe(page.width);expect(meta.height).toBe(page.height);
  expect(meta.channels).toBe(4);expect(meta.hasProfile).toBe(false);expect(page.premultiplied).toBe(false);
  const data=await sharp(bytes).raw().toBuffer();
  for(let i=0;i<data.length;i+=4)if(data[i+3]===0&&(data[i]||data[i+1]||data[i+2])){independentRgb=true;break;}
 }
 expect(independentRgb).toBe(true);
 for(const sample of samples){
  const canvas=manifest.canvases[sample.canvasIndex!],page=manifest.pages[sample.page];
  expect(page.pass).toBe('shadow');expect(sample.channel).toBeGreaterThanOrEqual(0);expect(sample.channel).toBeLessThan(4);
  expect(sample.rect.slice(2)).toEqual([canvas.width,canvas.height]);
  expect(sample.rect[0]+canvas.width).toBeLessThan(page.width);expect(sample.rect[1]+canvas.height).toBeLessThan(page.height);
 }
});
