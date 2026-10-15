import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { runKrakenV13 } from './kraken-v13.mjs';
import { runKrakenDraftLive } from './kraken-draft-live.mjs';
import { readPipelineRegistry } from '../asset-pipeline/pipeline-registry.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const origin = args.origin ?? 'http://127.0.0.1:8090';
if ((await fetch(origin)).status !== 200) throw Error('npm run dev:browser must serve HTTP 200 on 8090');
const out = path.resolve('build/kraken-live', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(out, { recursive: true });
const temp = path.join(out, 'browser-temp'); await mkdir(temp, { recursive: true });
process.env.TEMP = process.env.TMP = process.env.TMPDIR = temp;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: ['v13','draft-e2e'].includes(args.mode) ? { width: 1920, height: 1080 } : { width: 1536, height: 1024 }, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'UTC' });
await page.routeWebSocket(url => url.host === new URL(origin).host && url.searchParams.has('token'), () => {});
page.setDefaultTimeout(180000);
const report = { mode: args.mode ?? 'probe', revision: args.run ?? (args.mode === 'v13' ? 'kraken-v13' : 'kraken-v12'), quality: args.quality ?? 'high',
  sun: {azimuth:135,elevation:Number(args.elevation??28)}, errors: [], diagnostics: [], samples: [], captures: [], phasePeaks: {}, phaseResidentPeaks:{}, phaseAtlasPeaks:{} };
report.selection = (await readPipelineRegistry()).assets.filter(a=>a.id.startsWith('abyssal-kraken'))
  .map(a=>({id:a.id,revision:a.revision,sourceSize:a.sourceSize,material:a.materialPass}));
report.bossRequests=[];
report.draftRequests=[];
report.residencyErrors=[];
const residencySeen = new Set();
report.console=[]; report.loadFailures=[]; report.expectedMissingSpines=[];
report.errorEvents=[];
const recordError = message => {
  report.errorEvents.push({at:new Date().toISOString(),scene:report.currentScene,message});
  // v12b smoke tolerates only the known absent spine asset/clip; preserve the exact diagnostic.
  if (args.mode === 'v13' && args.smoke === 'true' && /abyssal-kraken-spine|spine-volley/.test(message)
    && /404|missing|lacks|not found|unknown|failed to load/i.test(message)) report.expectedMissingSpines.push(message);
  else report.errors.push(message);
};
page.on('pageerror', e => recordError(e.stack ?? e.message));
page.on('console', m => { if (['warning','error'].includes(m.type())) report.console.push({at:new Date().toISOString(),type:m.type(),text:m.text(),location:m.location()});
  if (m.type() === 'error' && !m.text().includes('404')) recordError(m.text());
  if (m.type() === 'warning' && /shader|GL_INVALID|WebGL.*error/i.test(m.text())) recordError(m.text());
  if (m.text().includes('[Kraken presentation]')) report.diagnostics.push(m.text()); });
page.on('requestfailed', r => { const error=`${r.failure()?.errorText} ${r.url()}`; report.loadFailures.push(error); recordError(error); });
page.on('response', r => {
  if(r.url().includes('/pipeline-v2/drafts/')) report.draftRequests.push({url:r.url(),status:r.status(),at:new Date().toISOString()});
  if(r.url().includes('/sprites/pipeline-v2/abyssal-kraken'))report.bossRequests.push({url:r.url(),status:r.status()});
  if (r.status() >= 400) { const error=`HTTP ${r.status()} ${r.url()}`;report.loadFailures.push(error);
    if (!(r.status() === 404 && r.url().endsWith('/atlas.json'))) recordError(error); }
});
const save = async () => {
  const temporary = path.join(out, 'report.pending.json');
  await writeFile(temporary, JSON.stringify(report, null, 2));
  await rename(temporary, path.join(out, 'report.json'));
};
const status = () => page.evaluate(() => window.devScenario.status());
const command = async c => {
  report.lastCommand = c;
  const r = await page.evaluate(c => window.devScenario.run(c), c);
  if (!r.ok) throw Error(`${JSON.stringify(c)}: ${r.error}`);
  if (['step', 'settle'].includes(c.action)) {
    try { await page.waitForFunction(() => window.devScenario.status().pendingSteps === 0, null, {timeout:30000}); }
    catch (error) {
      report.blockedState = await status();
      throw Error(`${c.action} did not finish: ${report.errors.join('; ') || error.message}`);
    }
  }
  return r.status;
};
const settle = async () => {
  const deadline = performance.now() + 60000;
  for (let i = 0; i < 500; i++) {
    await command({ action: 'settle', frames: 12 });
    const s = await status(); if (s.loading.work.renderReady && !s.loading.work.pending) return;
    if (performance.now() > deadline) throw Error(`Render work did not settle within 60s: ${JSON.stringify(s.loading.work)}`);
  }
  throw Error('Render work did not settle');
};
const sample = async () => {
  const s = await status();
  for (const error of s.krakenResidency?.errors ?? []) {
    const key = JSON.stringify([report.currentScene,error]);
    if (!residencySeen.has(key)) { residencySeen.add(key); report.residencyErrors.push({scene:report.currentScene,
      at:new Date().toISOString(),simulationMs:s.simulationMs,phase:s.krakenResidency.hostPhase,error}); }
  }
  report.samples.push(report.mode === 'v13' || report.mode === 'draft-e2e'
    ? Object.fromEntries(['simulationMs','terminated','krakenResidency','krakenDevAction','krakenDevGeometry','krakenAssets','player','enemies','effects','camera'].map(k => [k,s[k]])) : s);
  if (s.krakenDevAction?.status === 'failed') throw Error(s.krakenDevAction.error);
  for (const [phase, bytes] of Object.entries(s.krakenResidency?.phasePeaks ?? {})) report.phasePeaks[phase] = Math.max(report.phasePeaks[phase] ?? 0, bytes);
  for(const key of ['phaseResidentPeaks','phaseAtlasPeaks'])for(const [phase,bytes]of Object.entries(s.krakenResidency?.[key]??{}))report[key][phase]=Math.max(report[key][phase]??0,bytes);
  if (report.errors.length) throw Error(report.errors.join('\n'));
  return s;
};
const step = async frames => { await command({ action: 'step', frames }); if (!(await status()).terminated) await settle(); return sample(); };
const grid = (p, s) => ({ gridX: (p.x - s.metrics.offsetX) / (s.metrics.widthPx/s.metrics.gridCols) - .5,
  gridY: (p.y - s.metrics.offsetY) / (s.metrics.heightPx/s.metrics.gridRows) - .5 });
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const boards = async () => {
  for (const group of new Set(report.captures.map(c => c.group))) for (const view of ['game', 'close']) {
    const captures = report.captures.filter(c => c.group === group), tiles = [];
    for (const [i,c] of captures.entries()) {
      const image = await sharp(path.join(out, `${c.name}-${view}.png`)).resize(640, 360).extend({top:28,bottom:0,left:0,right:0,background:'#17202b'})
        .composite([{input:Buffer.from(`<svg width="640" height="28"><text x="8" y="19" fill="white" font-size="14">${escape(c.name)} t=${(c.simulationMs/1000).toFixed(3)}</text></svg>`),left:0,top:0}]).png().toBuffer();
      tiles.push({input:image,left:i%3*640,top:Math.floor(i/3)*388});
    }
    await sharp({create:{width:1920,height:Math.ceil(captures.length/3)*388,channels:4,background:'#17202b'}}).composite(tiles).png().toFile(path.join(out,`${group}-${view}-sheet.png`));
  }
};
const capture = async (group, s, focus) => {
  const n = report.captures.filter(c => c.group === group).length, name = `${group}-${String(n).padStart(2,'0')}`;
  if(args.captures==='false'){report.captures.push({group,name,at:new Date().toISOString(),simulationMs:s.simulationMs,phase:s.krakenResidency?.hostPhase});return;}
  const p = focus ?? s.krakenResidency?.hostPosition ?? {x:1136,y:880};
  const views = {};
  await command({ action:'target', ...grid(p,s) });
  for (const [view,zoom] of [['game',1],['close',group.startsWith('egg-')?4:2]]) {
    if (view === 'close' && group.includes('spines')) await command({action:'target',...grid(s.krakenResidency.hostPosition,s)});
    report.captureStage = {group,name,view,stage:'settle'}; await save();
    await command({action:'camera',zoom,focusTarget:true}); await settle();
    const current = await status();
    views[view] = {camera:current.camera,rendererSize:current.rendererSize};
    if (['v13','draft-e2e'].includes(report.mode)) {
      report.captureStage.stage = 'screenshot'; await save();
      const canvas = page.locator('#game-container canvas').first(), box = await canvas.boundingBox();
      if (!box || Math.abs(box.width-current.rendererSize.width)>.5 || Math.abs(box.height-current.rendererSize.height)>.5) throw Error('Game canvas is not displayed at native 1:1 pixels');
      // Locator screenshots wait for two animation frames of stability. The visual-test
      // clock is intentionally paused here, so capture the observed canvas rectangle directly.
      await page.screenshot({path:path.join(out,`${name}-${view}.png`),clip:box,timeout:20000});
    } else await page.screenshot({path:path.join(out,`${name}-${view}.png`)});
  }
  await command({action:'camera',zoom:1,focusTarget:true});
  report.captures.push({group,name,at:new Date().toISOString(),simulationMs:s.simulationMs,phase:s.krakenResidency?.hostPhase,action:s.krakenResidency?.state?.bodyAction,views});
  await save();
};
const heartbeat = setInterval(() => { void status().then(s => console.log(JSON.stringify({out,state:s.state,time:s.simulationMs,phase:s.krakenResidency?.hostPhase?.kind,action:s.krakenResidency?.state?.bodyAction?.kind,capture:report.captureStage,pending:s.pendingSteps,work:s.loading.work}))).catch(()=>{}); },15000);
try {
  const scenario = {version:1,classId:'dachs_nukem',mapId:'kraken-abyss-lab',seed:12345,timeOfDay:720,player:{gridX:39,gridY:36},suppressWaves:true,freezeMission:true,hideAim:true,hideTutorial:true};
  await page.goto(`${origin}/dev-scenario.html?visual-test=1#scenario=${encodeURIComponent(JSON.stringify(scenario))}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.devScenario?.status().ready && window.devScenario.status().paused);
  await page.evaluate(()=>document.fonts.ready);
  await page.addStyleTag({content:'#dev-scenario-panel{display:none!important} *,*::before,*::after{caret-color:transparent!important}'});
  if (report.mode === 'draft-e2e') {
    await runKrakenDraftLive({args,page,report,out,command,status,step,settle,grid,capture,boards,save});
  } else if (report.mode === 'v13') {
    await runKrakenV13({args,page,report,out,command,status,step,settle,grid,capture,boards,save});
  } else if (report.mode === 'shadow') {
    await command({action:'step',frames:240}); await settle();
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map(e=>e.name).findLast(u=>u.includes('/src/effects/kraken/KrakenShadowRenderer.ts'));
      const {KrakenShadowRenderer} = await import(url), update=KrakenShadowRenderer.prototype.update;
      window.krakenMeasuredCasters=new Map(); window.krakenShadowDisabled=false;
      KrakenShadowRenderer.prototype.update=function(...args){ update.apply(this,args);window.krakenMeasuredCasters.set(this,args[0]);if(window.krakenShadowDisabled)this.hide(); };
    });
    report.rings=[];
    for (const quality of ['high','medium','low']) for (const elevation of [28,45]) for (const night of [false,true]) {
      await command({action:'krakenReview',pilot:report.revision,pose:'abyssal-kraken-land/idle-0',quality,azimuth:135,elevation,night,shore:false});
      await step(30);
      const name=`shadow-${quality}-${elevation}-${night?'night':'day'}`;
      const on=await page.screenshot();await writeFile(path.join(out,`${name}.png`),on);
      const geometry=await page.evaluate(()=>{
        const result=[];
        for(const [caster,sprite]of window.krakenMeasuredCasters){
          if(caster.destroyed||!sprite.active||!sprite.visible)continue;
          const camera=sprite.scene.cameras.main, f=sprite.frame,c=document.createElement('canvas');c.width=f.realWidth;c.height=f.realHeight;
          c.getContext('2d').drawImage(f.source.image,f.cutX,f.cutY,f.cutWidth,f.cutHeight,f.x,f.y,f.cutWidth,f.cutHeight);
          const rect=sprite.scene.game.canvas.getBoundingClientRect(),wp=[camera.getWorldPoint(0,0),camera.getWorldPoint(1,0),camera.getWorldPoint(0,1)];
          result.push({alpha:c.toDataURL(),x:sprite.x,y:sprite.y,rotation:sprite.rotation,w:sprite.displayWidth,h:sprite.displayHeight,
            originX:sprite.originX,originY:sprite.originY,world:wp,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},canvas:{w:sprite.scene.game.canvas.width,h:sprite.scene.game.canvas.height},shadow:caster.inspect()});
        }
        window.krakenShadowDisabled=true;return result;
      });
      await settle();const off=await page.screenshot();await writeFile(path.join(out,`${name}-without-shadow.png`),off);
      await page.evaluate(()=>{window.krakenShadowDisabled=false;});await settle();
      const {data:a,info}=await sharp(on).ensureAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(off).ensureAlpha().raw().toBuffer();
      for(const g of geometry){
        const {data:mask,info:mi}=await sharp(Buffer.from(g.alpha.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        const alpha=(x,y)=>x>=0&&y>=0&&x<mi.width&&y<mi.height?mask[(Math.floor(y)*mi.width+Math.floor(x))*4+3]:0;
        let count=0,sum=0,shadowed=0,darkSum=0;
        for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
          const sx=(x+.5-g.rect.x)*g.canvas.w/g.rect.width,sy=(y+.5-g.rect.y)*g.canvas.h/g.rect.height;
          const wx=g.world[0].x+sx*(g.world[1].x-g.world[0].x)+sy*(g.world[2].x-g.world[0].x)-g.x;
          const wy=g.world[0].y+sx*(g.world[1].y-g.world[0].y)+sy*(g.world[2].y-g.world[0].y)-g.y;
          const u=(wx*Math.cos(g.rotation)+wy*Math.sin(g.rotation))/g.w*mi.width+g.originX*mi.width;
          const v=(-wx*Math.sin(g.rotation)+wy*Math.cos(g.rotation))/g.h*mi.height+g.originY*mi.height;
          if(u< -12||v< -12||u>mi.width+12||v>mi.height+12||alpha(u,v)>32)continue;
          let near=false;for(let dy=-10;dy<=10&&!near;dy+=2)for(let dx=-10;dx<=10;dx+=2)if(dx*dx+dy*dy<=100&&alpha(u+dx,v+dy)>=128){near=true;break;}
          if(!near)continue;
          const i=(y*info.width+x)*4,L=p=>.2126*p[i]+.7152*p[i+1]+.0722*p[i+2],base=L(b),delta=base-L(a);
          if(base<5)continue;count++;sum+=delta/base;if(delta>1){shadowed++;darkSum+=delta/base;}
        }
        report.rings.push({name,bodyX:g.x,quality,elevation,night,method:'0–10 native px outside color alpha (>128), antialias <=32 excluded; paired unchanged scene with only Kraken shadows hidden; relative sRGB luma',pixels:count,meanDarkening:sum/count,shadowedPixels:shadowed,meanDarkeningWhereVisible:darkSum/shadowed,shadow:g.shadow});
      }
      await save();
    }
  } else {
    await command({action:'quality',level:report.quality});
    await command({action:'krakenMission',skipIntro:args.skipIntro==='true'||args.phase==='land',...(args.phase==='land'?{hp:1}:{})});
    await page.waitForFunction(()=>window.devScenario.status().ready);
    await command({action:'quality',level:args.quality??'high'});
    await command({action:'figureSun',azimuth:135,elevation:Number(args.elevation??28)});
    await command({action:'options',values:{refillHp:true,hideAim:true,hideTutorial:true,timeOfDay:720}});
    await command({action:'teleport',gridX:39,gridY:36});
    await command({action:'target',gridX:35,gridY:29});await command({action:'camera',zoom:1,focusTarget:true});
    const start=(await status()).simulationMs, schedules=new Map(), events={};report.events=events;
    const schedule=(name,time,offsets,focus)=>{if(!schedules.has(name))schedules.set(name,{time,offsets,next:0,focus});};
    if(report.mode==='live')schedule('intro',start,[250,750,1250,1750,2250,2750,3250,4000,4750],{x:1136,y:880});
    let eggShot=null,tentShot=null,prefetchAt=null,exitAt=null,landAt=null,deathShotAt=null;
    for(let i=0;i<Number(args.seconds??100)*10;i++){
      let s=await step(6);const k=s.krakenResidency, st=k?.state, now=k?.hostNow ?? 1700000000000+s.simulationMs;
      if(s.terminated){report.terminal=s;await page.screenshot({path:path.join(out,'victory.png')});break;}
      if(report.mode==='live'&&st){
        const phase=st.phase.kind, a=st.bodyAction, local=t=>s.simulationMs+t-now;
        if(st.movement==='water-approach')schedule('water-move',s.simulationMs,[0,200,400,600,800,1000,1300,1600,2000]);
        if(a?.kind==='ink')schedule(phase==='land'?'land-ink':'ink',local(a.startedAt),[0,300,650,950,1180,1350,1630,1950,2350]);
        if(a?.kind==='eggs')schedule(phase==='land'?'land-eggs':'eggs',local(a.startedAt),[0,600,800,1100,1600,2100,3500,5200,6100]);
        if(phase==='diving')schedule('dive',local(st.phase.startedAt),[0,600,1100,1600,2000,2350,2750,3300,8600],{x:1136,y:1104});
        if(phase==='ashore'){
          const p=st.phase,relative=t=>t-p.startedAt;
          schedule('ashore',local(p.startedAt),[0,450,relative(p.moveAt),relative(p.gripAt)-100,
            relative(p.gripAt)+50,relative(p.gripAt)+250,relative(p.heaveAt),relative(p.endsAt),relative(p.recoveryEndsAt)-50]);
        }
        if(phase==='land'&&landAt===null){landAt=s.simulationMs;schedule('land-move',landAt,[0,200,400,600,800,1000,1300,1600,2000]);}
        if(a?.kind==='slam'&&k.claw?.attack) schedule('land-claw',local(k.claw.attack.startedAt),[0,200,400,450,530,610,750,1050,1400]);
        if(st.eggs.length&&!schedules.has('egg-life')){
          const egg=st.eggs[0],entity=s.enemies.find(e=>e.id===egg.eggId);
          if(entity){schedule('egg-life',local(egg.landedAt),[0,500,1200,2400,3300,3500,3700,3950,4250],entity);events.hatchingEgg={...egg,position:entity};}
        }
        if(!eggShot&&st.eggs.length&&schedules.get('eggs')?.next===9){
          const egg=st.eggs.find(e=>e.status==='incubating'), entity=egg&&s.enemies.find(e=>e.id===egg.eggId);
          if(entity){
            let placed=false;
            for(const [dx,dy]of [[0,80],[80,0],[-80,0],[0,-80]]){
              const c={action:'teleport',...grid({x:entity.x+dx,y:entity.y+dy},s)};
              const r=await page.evaluate(c=>window.devScenario.run(c),c);if(r.ok){placed=true;break;}
            }
            if(!placed)throw Error('No valid player position near the destructible egg');
            eggShot={id:egg.eggId,hp:entity.hp,startedAt:s.simulationMs,endsAt:egg.endsAt};events.eggShot=eggShot;
            schedule('egg-destroy',s.simulationMs,[0,100,200,300,400,600,900,1200,1600],entity);
            await command({action:'target',...grid(entity,s)});await command({action:'fire',slot:'weapon1'});
          }
        }
        if(eggShot&&!eggShot.result){
          const entity=s.enemies.find(e=>e.id===eggShot.id);
          if(entity&&s.simulationMs-eggShot.startedAt<1400){await command({action:'target',...grid(entity,s)});await command({action:'fire',slot:'weapon1'});}
          if(!entity||s.simulationMs>eggShot.startedAt+1500){eggShot.result={present:!!entity,now,beforeHatch:now<eggShot.endsAt};await command({action:'teleport',gridX:39,gridY:36});}
        }
        if(!tentShot&&phase==='submerged'){
          const t=st.tentacles.find(t=>t.phase==='hover');
          if(t){const p={x:t.contact.x+Math.cos(t.contact.angle)*70,y:t.contact.y+Math.sin(t.contact.angle)*70};
            tentShot={hpBefore:k.hp,startedAt:s.simulationMs,part:t.contact};events.tentacleShot=tentShot;
            await command({action:'target',...grid(p,s)});await command({action:'fire',slot:'weapon1'});
          }
        }
        if(tentShot&&!tentShot.result&&s.simulationMs>tentShot.startedAt+700)tentShot.result={hpAfter:k.hp,phase};
        if(prefetchAt===null&&s.simulationMs-start>36000&&phase==='surfaced'){
          await command({action:'krakenHp',hp:Math.floor(k.maxHp*.64)});prefetchAt=s.simulationMs;events.prefetch={at:prefetchAt};
        }
        if(prefetchAt!==null&&exitAt===null&&s.simulationMs-prefetchAt>3500){
          events.prefetch.residency=k;await command({action:'teleport',gridX:53,gridY:39});
          await command({action:'krakenHp',hp:Math.floor(k.maxHp*.49)});exitAt=s.simulationMs;
        }
        if(landAt!==null&&s.simulationMs-landAt>3000&&!events.landObserver){
          await command({action:'teleport',gridX:48,gridY:40});events.landObserver=s.simulationMs;
        }
        if(landAt!==null&&deathShotAt===null&&s.simulationMs-landAt>22000&&schedules.get('land-claw')?.next===9){
          await command({action:'krakenHp',hp:1});deathShotAt=s.simulationMs;events.deathShot={at:deathShotAt};
        }
        if(deathShotAt!==null&&phase==='land'){
          await command({action:'target',...grid(k.hostPosition,s)});await command({action:'fire',slot:'weapon1'});
        }
        if(phase==='dying')schedule('death',local(st.phase.startedAt),[0,100,250,450,650,850,1100,1400],st.phase.terminalPose);
        for(const [name,q]of schedules)if(q.next<q.offsets.length&&s.simulationMs>=q.time+q.offsets[q.next]){await capture(name,s,q.focus);q.next++;}
        if(phase==='removed'&&schedules.get('death')?.next>=6)break;
      }
      if(i%50===0)await save();
    }
    report.schedules=Object.fromEntries(schedules);
    if(report.mode==='performance'){
      if(args.phase==='land'){
        for(let i=0;i<300&&(await status()).krakenResidency?.hostPhase?.kind!=='land';i++)await step(6);
        if((await status()).krakenResidency?.hostPhase?.kind!=='land')throw Error('Performance fixture did not reach land');
      }
      await command({action:'resume'});
      report.performance=await page.evaluate(async()=>{
        for(let i=0;i<60;i++)await new Promise(r=>requestAnimationFrame(r));
        const phase=window.devScenario.status().krakenResidency?.hostPhase;
        const times=[],fps=[];for(let i=0;i<180;i++){await new Promise(r=>requestAnimationFrame(r));times.push(performance.now());fps.push(window.devScenario.status().measuredFps);}
        const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2'),debug=gl?.getExtension('WEBGL_debug_renderer_info');
        return {method:'60 warmup + 180 native browser frames, running host combat; concurrent GPU applications must be reported separately',phase,wallMs:times.at(-1)-times[0],rafFps:(times.length-1)*1000/(times.at(-1)-times[0]),phaserFps:fps,
          renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,jsHeapBytes:performance.memory?.usedJSHeapSize??null};
      });
      await command({action:'pause'});await sample();
    }
    if(report.mode==='live'&&args.captures!=='false')await boards();
    if(report.mode==='live'){
      const required=['intro','water-move','ink','eggs','egg-life','egg-destroy','dive','ashore','land-move','land-claw','land-ink','land-eggs','death'];
      report.coverage=Object.fromEntries(required.map(name=>[name,report.captures.filter(c=>c.group===name).length]));
      if(Object.values(report.coverage).some(n=>n<6||n>9))throw Error('Incomplete live contact-sheet timeline: '+JSON.stringify(report.coverage));
      if(!report.terminal)throw Error('Boss death did not reach mission completion');
      if(events.eggShot?.result?.present!==false||!events.eggShot.result.beforeHatch)throw Error('Egg destruction before hatch not demonstrated');
      if(!(events.tentacleShot?.result?.hpAfter<events.tentacleShot?.hpBefore)||events.tentacleShot.result.phase!=='submerged')throw Error('Tentacle damage transfer not demonstrated');
      const hatch=events.hatchingEgg;
      const evidence=report.samples.find(s=>s.krakenResidency?.hostNow>=hatch.spawnAt&&s.krakenResidency.hostNow<hatch.endsAt+500
        &&s.enemies.some(e=>e.kind==='rabid-badger'&&Math.hypot(e.x-hatch.position.x,e.y-hatch.position.y)<64));
      if(!evidence)throw Error('Hatch into nearby rabid-badger not observed');
      report.hatchEvidence={simulationMs:evidence.simulationMs,enemies:evidence.enemies.filter(e=>e.kind==='rabid-badger')};
      if(!events.prefetch?.residency?.options?.prefetchLand)throw Error('65% prefetch missing');
      if(report.bossRequests.some(r=>/\/(idle|sheet)\.png/.test(r.url)))throw Error('Duplicate generic boss image loaded');
      if(report.quality==='low'&&report.bossRequests.some(r=>r.url.includes('.bin')))throw Error('Low downloaded mesh geometry');
      if(report.terminal.krakenResidency?.atlasBytes!==0||report.terminal.krakenResidency?.cpuMeshBytes!==0
        ||report.terminal.krakenResidency?.reservedBytes!==0)throw Error('Boss residency retained after mission completion');
      for(const phase of ['intro','water','ashore','land'])if(!(report.phaseResidentPeaks[phase]>0)||report.phaseResidentPeaks[phase]>(['intro','water'].includes(phase)?165:150)*1048576)throw Error('Invalid actual phase peak including CPU mesh cache: '+phase);
    }
  }
  if(report.sceneFailures?.length)throw Error('Kraken review scenes failed: '+report.sceneFailures.map(f=>f.group).join(', '));
  if(report.errors.length||report.diagnostics.length||report.residencyErrors.length)throw Error('Kraken review errors: '+JSON.stringify({errors:report.errors,diagnostics:report.diagnostics,residencyErrors:report.residencyErrors.length}));
  await save(); console.log(`KRAKEN LIVE REPORT: ${out}`);
} catch(e){report.failure=e.stack;await save();throw e;}
finally{clearInterval(heartbeat);await browser.close();}
