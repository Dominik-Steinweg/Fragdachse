// Fixed-frame parity and isolated before/after costs using actual Phaser tweens.
// Usage: node scripts/performance/suite-parity.mjs sites.json output high|low referenceCommit
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { serve } from './suite.mjs';

const [sitesFile, output, quality, reference] = process.argv.slice(2);
if (!sitesFile || !output || !['high','low'].includes(quality) || !/^[a-f0-9]{8,40}$/.test(reference ?? ''))
  throw Error('Expected sites.json output-directory high|low reference-commit');
const out = resolve(output), site = JSON.parse(await readFile(sitesFile, 'utf8'))[0];
await mkdir(out, { recursive: true });
// Allow only subvisual raster rounding, also seen when rendering the unchanged
// reference twice. Exact animation state and wire bytes are never tolerated.
const rasterLimit = { maxChannelDelta:3, maxChangedFraction:0.001 };
const report = { reference, site, quality, rasterLimit, sourceDigests:{}, screenshots: [], benchmarks: {}, errors: [] };
report.siteBuildId=createHash('sha256').update(await readFile(join(site.site,'index.html'))).digest('hex');
const source = async (path, old) => {
  const contents=old ? execFileSync('git', ['show', `${reference}:${path}`], { encoding:'utf8' }) : await readFile(path, 'utf8');
  report.sourceDigests[`${old?'reference':'candidate'}:${path}`]=createHash('sha256').update(contents.replace(/\r\n/g,'\n')).digest('hex');
  return contents;
};
const scripts = [];
for (const old of [true, false]) {
  const label = old ? 'Reference' : 'Candidate';
  const path = 'src/network/projectileFlightPathCodec.ts';
  const codec = await build({ stdin:{ contents:await source(path, old), loader:'ts', resolveDir:dirname(resolve(path)) },
    bundle:true, write:false, format:'iife', globalName:label+'Codec', target:'chrome130' });
  scripts.push(codec.outputFiles[0].text);
  const waterPath='src/arena/WaterGeometry.ts';
  const water=await build({stdin:{contents:await source(waterPath,old),loader:'ts',resolveDir:dirname(resolve(waterPath))},
    bundle:true,write:false,format:'iife',globalName:label+'Water',target:'chrome130'});
  scripts.push(water.outputFiles[0].text);
  const effect = await source('src/effects/EffectSystem.ts', old);
  const method = effect.slice(effect.indexOf('  private playDamageVignette('), effect.indexOf('  private resolveDamageVignetteAlpha(')).replace('private ', '');
  const vignette = await build({ stdin:{ contents:`import { DAMAGE_VIGNETTE_VFX } from './src/config';
    const Phaser={Math:{Clamp:(v,min,max)=>Math.max(min,Math.min(max,v))}};
    export const draw={${method}}.playDamageVignette;`, loader:'ts', resolveDir:process.cwd() },
    bundle:true, write:false, format:'iife', globalName:label+'Vignette', target:'chrome130' });
  scripts.push(vignette.outputFiles[0].text);
}
const server = await serve(site.site, site.public);
let context;
try {
  context = await chromium.launchPersistentContext(join(out, 'chrome-profile'), {
    executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:false,
    viewport:{width:1920,height:1080},deviceScaleFactor:1,
    args:['--force-device-scale-factor=1','--window-size=1940,1160','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],
  });
  await context.addInitScript(quality => {
    window.__FD_PERF_REQUEST__={schemaVersion:1,runId:'parity',caseId:'review.player',quality,warmupMs:2000,
      timeoutMs:600000,captureProfile:'reduced',systemProbe:true,localHost:true};
    let seed=16092026;
    Math.random=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
  }, quality);
  const page=context.pages()[0];
  page.on('pageerror', error=>report.errors.push(String(error)));
  await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:120000}); await page.bringToFront();
  await page.waitForFunction(()=>window.__FD_PERF__?.state==='awaiting-audio',null,{timeout:180000});
  await page.mouse.click(4,4);await page.waitForFunction(()=>window.__FD_PERF__.audioState()==='running');
  report.viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));
  await page.evaluate(()=>window.__FD_PERF__.start());
  await page.waitForFunction(()=>['review.player:measure','failed'].includes(window.__FD_PERF__?.state),null,{timeout:180000,polling:100});
  if(await page.evaluate(()=>window.__FD_PERF__.state==='failed'))throw Error(await page.evaluate(()=>window.__FD_PERF__.error));
  await page.evaluate(()=>{
    const scene=window.__FD_PERF__.probeScene;scene.game.loop.stop();
    const effects=scene.ctx.effectSystem;effects.ensureDamageVignette();
    const edges=['Top','Bottom','Left','Right'].map(side=>effects['damageVignette'+side]);
    // Keep all simulation, particles, clouds and world clocks frozen. Only a private
    // real Phaser TweenManager advances the four existing damage-vignette images.
    window.__parity={scene,effects,edges,originalTweens:scene.tweens};
  });
  for(const content of scripts) await page.addScriptTag({content});
  report.codecParity=await page.evaluate(()=>{
    const paths=[];
    for(let n=1;n<=128;n++){
      const points=Array.from({length:n},(_,i)=>({sequence:i*3+1,timeMs:100000+i*5,
        x:i===0?-0:Math.sin(i+n)*1200.321,y:i*0.173456789,vx:i<24?910.1:-0,vy:i%5?i/7:0,
        ...(i%13===0?{breakBefore:true}:{}),...(i%9===0?{bounceSequence:i+1}:{})}));
      paths.push({timeMs:100000+(n-1)*5,points,...(n%2?{ended:true}:{})});
    }
    for(const path of paths){
      const a=ReferenceCodec.encodeProjectileFlightPath(path),b=CandidateCodec.encodeProjectileFlightPath(path);
      if(a!==b)throw Error('Wire-byte mismatch');
      if(JSON.stringify(ReferenceCodec.decodeProjectileFlightPath(b))!==JSON.stringify(CandidateCodec.decodeProjectileFlightPath(a)))throw Error('Cross-decoder mismatch');
    }
    window.__parity.paths=paths;
    return {paths:paths.length,points:paths.reduce((sum,p)=>sum+p.points.length,0),wireIdentical:true,nativeBase64:typeof Uint8Array.prototype.toBase64==='function'};
  });
  report.benchmarks=await page.evaluate(()=>{
    const v=window.__parity,rows=[];
    const effect={totalDamage:20,dirX:1,dirY:0};
    const reset=()=>{
      if(v.manager){for(const t of v.manager.tweens)t.destroy();v.manager.tweens.length=0;}
      const manager=new v.originalTweens.constructor(v.scene);manager.getDelta=()=>16;
      v.manager=manager;v.scene.tweens=manager;v.effects.damageVignetteTween=null;
      for(const edge of v.edges)edge.setAlpha(0).setVisible(false);
      return manager;
    };
    v.reset=reset;
    for(let repetition=0;repetition<4;repetition++)for(const label of repetition%2?['candidate','reference']:['reference','candidate']){
      const codec=label==='reference'?ReferenceCodec:CandidateCodec;
      const start=performance.now();let bytes=0;
      for(let pass=0;pass<150;pass++)for(const path of v.paths)bytes+=codec.encodeProjectileFlightPath(path).length;
      const codecMs=performance.now()-start;
      const manager=reset();
      // Ordinary unrelated scene tweens. Update and destroy use Phaser itself.
      for(let i=0;i<2000;i++)manager.add({targets:{alpha:1},alpha:0,duration:1000,repeat:-1});
      const draw=label==='reference'?ReferenceVignette.draw:CandidateVignette.draw;
      const from=performance.now();
      for(let i=0;i<400;i++)draw.call(v.effects,effect);
      const vignetteMs=performance.now()-from;
      if(repetition)rows.push({repetition,label,codecMs,codecPaths:150*v.paths.length,bytes,vignetteMs,hits:400,unrelatedTweens:2000});
    }
    reset();return rows;
  });
  report.water=await page.evaluate(()=>{
    const metrics={gridCols:64,gridRows:40,offsetX:127.25,offsetY:-83.5};
    const cells=Array.from({length:17*12},(_,i)=>({gridX:16+i%17,gridY:16+Math.floor(i/17)}));
    const before=new ReferenceWater.WaterGeometry(cells,metrics),after=new CandidateWater.WaterGeometry(cells,metrics);
    const a={x:0,y:0,vx:0,vy:0},b={...a};let parity=0;
    const fixtures={dry:[],shore:[]};
    for(let i=0;i<4000;i++){
      const radius=i%7===0?0:i%4===0?48:14;
      const sx=metrics.offsetX+Math.random()*2048,sy=metrics.offsetY+Math.random()*1280;
      const args=[sx,sy,sx+(Math.random()-.5)*300,sy+(Math.random()-.5)*300,radius,(Math.random()-.5)*900,(Math.random()-.5)*900];
      const x=before.slideCircle(...args,a),y=after.slideCircle(...args,b);
      if(x!==y||Object.keys(a).some(k=>!Object.is(a[k],b[k])))throw Error('Water collision parity failed');
      parity++;
      if(fixtures.dry.length<100)fixtures.dry.push([sx,metrics.offsetY+64,sx+5,metrics.offsetY+72,radius,300,480]);
      if(fixtures.shore.length<100)fixtures.shore.push([metrics.offsetX+512-10,metrics.offsetY+512+i%300,metrics.offsetX+512+5,metrics.offsetY+517+i%300,radius,900,300]);
    }
    const rows=[];
    for(let repetition=0;repetition<4;repetition++)for(const label of repetition%2?['candidate','reference']:['reference','candidate'])for(const [area,inputs]of Object.entries(fixtures)){
      const geometry=label==='reference'?before:after,start=performance.now();let hits=0;
      for(let pass=0;pass<250;pass++)for(const args of inputs)hits+=Number(geometry.slideCircle(...args,a));
      if(repetition)rows.push({repetition,label,area,calls:250*inputs.length,ms:performance.now()-start,hits});
    }
    return {parityCases:parity,identical:true,rows};
  });
  report.raster=await page.evaluate(()=>{
    const now=performance.now(),date=Date.now();
    Object.defineProperty(performance,'now',{value:()=>now});Date.now=()=>date;
    window.__parity.resetRandom=()=>{
      let seed=16092026;
      Math.random=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
    };
    return {clocksFrozenAfterBenchmarks:true,dithering:window.__parity.scene.game.renderer.gl.isEnabled(window.__parity.scene.game.renderer.gl.DITHER)};
  });
  for(const [name,minute,zoom] of [['day',720,1],['dawn',360,.72],['night',60,1.25]]){
    await page.evaluate(({minute,zoom})=>{
      const v=window.__parity,sun=v.scene.arenaRuntime.flow.getWorldRuntime().presentationFrame.sunlight;
      v.scene.cameras.main.setZoom(zoom);sun.update(minute,100000);
    },{minute,zoom});
    for(const time of [0,112,320,960]){
      const pictures=[];
      for(const label of ['reference','reference-repeat','reference-repeat-2','reference-repeat-3','candidate']){
        const state=await page.evaluate(({label,time})=>{
          const v=window.__parity;v.resetRandom();
          const m=v.reset(),draw=label==='candidate'?CandidateVignette.draw:ReferenceVignette.draw;
          draw.call(v.effects,{totalDamage:20,dirX:1,dirY:0});
          for(let t=0;t<time;t+=16){
            if(t===96)draw.call(v.effects,{totalDamage:35,dirX:0,dirY:-1});
            m.step(true);
          }
          const game=v.scene.game;
          for(let i=0;i<2;i++){game.renderer.preRender();game.scene.render(game.renderer);game.renderer.postRender();}
          return v.edges.map(e=>({alpha:e.alpha,visible:e.visible}));
        },{label,time});
        // CSS transitions in the DOM HUD must be settled as well as the canvas.
        // A repeated capture of the same implementation detects capture drift.
        const control=await page.screenshot({animations:'disabled',path:join(out,`${name}-${time}-${label}-control.png`)});
        const picture=await page.screenshot({animations:'disabled',path:join(out,`${name}-${time}-${label}.png`)});
        const controlPixels=await sharp(control).ensureAlpha().raw().toBuffer();
        const pixels=await sharp(picture).ensureAlpha().raw().toBuffer();
        pictures.push({state,image:picture,stable:controlPixels.equals(pixels)});
      }
      const a=await sharp(pictures[0].image).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      const b=await sharp(pictures.at(-1).image).ensureAlpha().raw().toBuffer();
      const controls=await Promise.all(pictures.slice(1,-1).map(p=>sharp(p.image).ensureAlpha().raw().toBuffer()));
      let controlChanged=0,controlMax=0;
      let outsideReferenceRange=0,outsideReferenceMax=0;
      for(let i=0;i<a.data.length;i+=4){let d=0,outside=0;for(let c=0;c<4;c++){
        let min=a.data[i+c],max=min;
        for(const control of controls){min=Math.min(min,control[i+c]);max=Math.max(max,control[i+c]);}
        d=Math.max(d,max-min);outside=Math.max(outside,min-b[i+c],b[i+c]-max);
      }
        if(outside)outsideReferenceRange++;outsideReferenceMax=Math.max(outsideReferenceMax,outside);
        if(d)controlChanged++;controlMax=Math.max(controlMax,d);}
      const diff=Buffer.alloc(a.data.length);let changed=0,max=0;
      for(let i=0;i<a.data.length;i+=4){let delta=0;for(let c=0;c<4;c++){
        const d=Math.abs(a.data[i+c]-b[i+c]);delta=Math.max(delta,d);max=Math.max(max,d);if(c<3)diff[i+c]=Math.min(255,d*16);
      }diff[i+3]=255;if(delta)changed++;}
      await sharp(diff,{raw:{width:a.info.width,height:a.info.height,channels:4}}).png().toFile(join(out,`${name}-${time}-diff-x16.png`));
      report.screenshots.push({name,time,changed,max,controlChanged,controlMax,outsideReferenceRange,outsideReferenceMax,pixels:a.info.width*a.info.height,
        capturesStable:pictures.every(p=>p.stable),stateIdentical:pictures.every(p=>JSON.stringify(pictures[0].state)===JSON.stringify(p.state))});
    }
  }
  if(report.errors.length||report.screenshots.some(x=>x.max>rasterLimit.maxChannelDelta
    ||x.changed/x.pixels>rasterLimit.maxChangedFraction||!x.stateIdentical||!x.capturesStable))throw Error('Parity failed; inspect evidence');
  report.status='passed';
} catch(error) {report.status='failed';report.error=String(error);throw error;}
finally{
  await writeFile(join(out,'evidence.json'),JSON.stringify(report,null,2));
  try{await context?.close();}finally{await server.close();}
}
console.log(JSON.stringify(report,null,2));
