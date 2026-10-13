import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { metric } from './metrics.mjs';
import { compareImages } from '../visual/compare.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const origin = args.origin ?? 'http://127.0.0.1:8090';
if ((await fetch(origin)).status !== 200) throw Error('Existing dev server must serve HTTP 200');
const out = path.resolve(args.output ?? `build/kraken-perf/${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(out, { recursive: true });
const temp = path.join(out, 'browser-temp'); await mkdir(temp, { recursive: true });
process.env.TEMP = process.env.TMP = process.env.TMPDIR = temp;
if(args.scenario && !['kraken','regular'].includes(args.scenario))throw Error('Invalid scenario');
const qualities = (args.qualities ?? 'high,medium,low').split(',');
if (qualities.some(q => !['high','medium','low'].includes(q))) throw Error('Invalid quality');
const repeats=Number(args.runs??1);
if(!Number.isInteger(repeats)||repeats<1)throw Error('runs must be a positive integer');
const config = JSON.parse(await readFile('src/config/krakenBoss.json', 'utf8'));
const hashes = {};
for (const file of ['src/config/coopDefenseMaps/20-abgrundteich.json','src/config/krakenBoss.json','src/config/pipelineAssets.json'])
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
const report = { version: 5, seed: 12345, hashes, origin, viewport: { width: 1920, height: 1080 }, runs: [],
  environment: { platform:os.platform(), release:os.release(), cpu:os.cpus()[0]?.model, logicalCpus:os.cpus().length, memoryGiB:os.totalmem()/2**30 },
  scope: 'Fixed 60 Hz host steps. CPU: whole game callback, excluding recorder bookkeeping; GPU: asynchronous elapsed query over all callback submissions, including submission gaps (not pure GPU busy time). RAF intervals omit command pauses. Heap increases/drops are proxies, not allocation or GC pause measurements; --profile records sampled allocations and GC traces separately. Diagnostic map copies Map 20, bypasses its opening-wave boss gate and uses the existing unarmed diagnostic outpost.' };
const save = () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
report.scenario=args.scenario??'kraken';
if(report.scenario==='regular') report.scope=report.scope.slice(0,report.scope.indexOf('Diagnostic map'))+
  'Regular Map 1, fixed observer, noon, suppressed waves and frozen mission. Same recorder and viewport as Kraken.';
let parityCode;
const framebufferReference=args.rendererParity==='true'
  ? (await readFile('node_modules/phaser/src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js','utf8'))
    .match(/resize: (function \(width, height\)[\s\S]*?\r?\n    }),/)?.[1] : null;
if(args.rendererParity==='true'&&!framebufferReference)throw Error('Installed Phaser resize reference not found');
if(args.parity) {
  if(args.modules)throw Error('Parity runs use the candidate plus a reference method, not archived modules');
  const source=await readFile(path.join(args.parity,'src/effects/kraken/submersionShader.ts'),'utf8');
  const start=source.indexOf('  update(elevation:'),end=source.indexOf('\n  destroy():',start);
  if(start<0||end<0)throw Error('Reference submersion update not found');
  const {transform}=await import('esbuild');
  parityCode=(await transform(`const reference = {${source.slice(start,end)}}.update;`,{loader:'ts',target:'es2021'})).code;
}
for (let repeat = 0; repeat < repeats; repeat++) for (const quality of qualities) {
console.log(`${quality}/${repeat} starting browser`);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, args: ['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--force-color-profile=srgb','--enable-precise-memory-info'] });
report.browser = browser.version();
try {
  console.log(`${quality}/${repeat} opening scenario`);
  const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'UTC' });
  if(args.cold==='true') await page.addInitScript(()=>{
    const stats={startedAt:performance.now(),calls:{},milliseconds:{}},restores=[];
    for(const type of [globalThis.WebGLRenderingContext,globalThis.WebGL2RenderingContext])if(type)
      for(const key of ['compileShader','linkProgram','getProgramParameter','checkFramebufferStatus','createFramebuffer']) {
        const prototype=type.prototype,original=prototype[key];
        prototype[key]=function(...args){const start=performance.now();try{return Reflect.apply(original,this,args);}
          finally{stats.calls[key]=(stats.calls[key]??0)+1;stats.milliseconds[key]=(stats.milliseconds[key]??0)+performance.now()-start;}};
        restores.push(()=>{prototype[key]=original;});
      }
    globalThis.__krakenCold=()=>{for(const restore of restores)restore();return{...stats,readyAt:performance.now(),
      scope:'Fresh browser/context and HTTP profile; OS and driver caches are not cleared. Includes lobby boot and mission loading.'};};
  });
  // Optional local archive from the same Vite server for alternating A/B runs;
  // only the explicitly listed transformed modules are replaced, never assets.
  if(args.modules) {
    const files=JSON.parse((await readFile(path.join(args.modules,'manifest.json'),'utf8')).replace(/^\uFEFF/,''));
    report.moduleArchive=args.modules;
    const archived=new Map();
    for(const [i,file]of files.entries()) {
      archived.set('/'+file,await readFile(path.join(args.modules,`${i}.js`),'utf8'));
    }
    // Vite timestamps identify module instances. Mixing archived and current
    // timestamps would instantiate duplicate resource owners and serial counters.
    await page.route(url=>url.pathname.startsWith('/src/'),async route=>{
      const body=archived.get(new URL(route.request().url()).pathname) ?? await (await route.fetch()).text();
      await route.fulfill({contentType:'text/javascript',body:body.replace(/(\/src\/[^"'\s?]+)\?t=\d+(&?)/g,(_m,p,and)=>p+(and?'?':''))});
    });
  }
  await page.routeWebSocket(url => url.host === new URL(origin).host && url.searchParams.has('token'), () => {});
  page.setDefaultTimeout(180000);
  const run = { quality, repeat, phases: [], errors: [], complete: false }; report.runs.push(run);
  run.scenario = args.scenario ?? 'kraken';
  const loadStarted = performance.now();
  page.on('pageerror', e => { run.errors.push(e.stack ?? e.message); console.error(e.message); });
  page.on('console', m => { if (m.type() === 'error' || /GL_INVALID|WebGL.*error/.test(m.text())) run.errors.push(m.text()); });
  const status = () => page.evaluate(() => window.devScenario.status());
  const heartbeat = setInterval(() => { void status().then(s=>console.log(JSON.stringify({quality,state:s.state,ready:s.ready,time:s.simulationMs,pending:s.pendingSteps,phase:s.krakenResidency?.hostPhase?.kind}))).catch(()=>{}); }, 15000);
  const command = async c => {
    const r = await page.evaluate(c => window.devScenario.run(c), c);
    if (!r.ok) throw Error(`${JSON.stringify(c)}: ${r.error}`);
    return r.status;
  };
  const step = async frames => {
    while (frames > 0) {
      const n = Math.min(frames, 600); await command({ action: 'step', frames: n });
      await page.waitForFunction(() => window.devScenario.pendingSteps() === 0, null, { timeout: 60000 }); frames -= n;
    }
    return status();
  };
  const wait = async (predicate, label, limit = 2400) => {
    let s = await status();
    for (let f = 0; !predicate(s); f += 3) {
      if (f >= limit) throw Error(`${label}: timeout ${JSON.stringify(s.krakenResidency?.hostPhase)}`);
      if (s.krakenDevAction?.status === 'failed') throw Error(s.krakenDevAction.error);
      s = await step(3);
    }
    return s;
  };
  const target = async (x,y) => { await command({action:'krakenTarget',gridX:x,gridY:y}); await step(1); };
  const state = s => s.krakenResidency?.state;
  const surfaced = () => wait(s => ['surfaced','land'].includes(state(s)?.phase.kind), 'surfaced');
  const act = async name => {
    if(name !== 'lunge') await surfaced();
    if(['spines','ink','eggs'].includes(name)) await wait(s=>state(s)?.phase.kind==='land'
      || (state(s)?.phase.kind==='surfaced' && state(s).phase.nextDiveAt-s.krakenResidency.hostNow>config.dive.intervalMs*.8),'fresh attack window');
    await command({action:'krakenAct',act:name});
    return wait(s => s.krakenDevAction?.status === 'started', name);
  };
  const grid = (p,s) => ({gridX:(p.x-s.metrics.offsetX)/(s.metrics.widthPx/s.metrics.gridCols)-.5,
    gridY:(p.y-s.metrics.offsetY)/(s.metrics.heightPx/s.metrics.gridRows)-.5});
  const parity = async name => {
    if(!parityCode && args.rendererParity!=='true')return;
    const stem=`${quality}-${repeat}-${name}`;
    const zero=async()=>{await command({action:'settle',frames:8});await page.waitForFunction(()=>window.devScenario.pendingSteps()===0);};
    await page.evaluate(()=>window.__krakenParity.toggle(true));await zero();
    const before=await page.locator('canvas').first().screenshot();
    await zero();
    const control=await page.locator('canvas').first().screenshot();
    await page.evaluate(()=>window.__krakenParity.toggle(false));await zero();
    const after=await page.locator('canvas').first().screenshot();
    const baseline=await compareImages(before,control,{});
    const comparison=await compareImages(before,after,{});
    await writeFile(path.join(out,`${stem}-before.png`),before);await writeFile(path.join(out,`${stem}-after.png`),after);
    await writeFile(path.join(out,`${stem}-control.png`),control);
    await sharp(comparison.diff,{raw:{width:comparison.width,height:comparison.height,channels:4}}).png().toFile(path.join(out,`${stem}-diff.png`));
    const {diff,...result}=comparison;
    (run.parity??=[]).push({name,stable:baseline.passed,control:{changed:baseline.changed,ratio:baseline.ratio,maxDelta:baseline.maxDelta,meanDelta:baseline.meanDelta},...result});await save();
  };
  const phase = async (name, body) => {
    console.log(`${quality}/${repeat} ${name}`);
    if(args.profile==='true') await page.evaluate(name=>performance.mark(`kraken:${name}:start`),name);
    await command({action:'measureKraken',phase:name});
    let failure;
    try { await body(); } catch (e) { failure = e; }
    await command({action:'measureKraken',stop:true});
    if(args.profile==='true') await page.evaluate(name=>performance.mark(`kraken:${name}:end`),name);
    const data = await page.evaluate(() => window.devScenario.krakenPerformance());
    const s = await status(), rows = data.frames;
    const summarize = key => metric(rows.map(f=>f[key]).filter(v=>typeof v==='number'));
    const scope = name => metric(rows.map(f=>f.spans.filter(s=>s.scope===name).reduce((n,s)=>n+s.toMs-s.fromMs,0)));
    const residency = s.krakenResidency;
    const summary = { name, frames:rows.length, frameMs:summarize('frameMs'), cpuMs:summarize('cpuMs'), gpuMs:summarize('gpuMs'),
      arenaUpdateMs:scope('sceneUpdate'),renderSubmitMs:scope('renderSubmit'),
      hitches33:rows.filter(f=>f.frameMs>33).length, cpuHitches33:rows.filter(f=>f.cpuMs>33).length,
      drawCalls:summarize('drawCalls'), switches:summarize('switches'), residentMiB:(summarize('residentBytes')?.maximum??0)/1048576,
      shaderCompileLinkCalls:rows.reduce((n,f)=>n+f.shaderCompileLinkCalls,0), shaderCompileLinkMs:rows.reduce((n,f)=>n+f.shaderCompileLinkMs,0),
      heapBytes:summarize('heapBytes'), heapIncreaseBytes:0,heapDropBytes:0,
      tentaclesMax:Math.max(0,...rows.map(f=>f.tentacles)),eggsMax:Math.max(0,...rows.map(f=>f.eggs)),
      spinesMax:Math.max(0,...rows.map(f=>f.spines)),inkMax:Math.max(0,...rows.map(f=>f.ink)),
      bodyTravelPx:rows.reduce((sum,f,i)=>i&&f.bodyX!==null&&rows[i-1].bodyX!==null
        ?sum+Math.hypot(f.bodyX-rows[i-1].bodyX,f.bodyY-rows[i-1].bodyY):sum,0),
      hatchingMax:Math.max(0,...rows.map(f=>f.hatching)),enemies:summarize('enemies'),
      budgetPassed:rows.every(f=>f.residentBytes===null||f.residentBytes<=
        (f.hostPhase==='land'||name.startsWith('land-')||name==='death'?150:165)*1048576),
      workloadHash:createHash('sha256').update(JSON.stringify(rows.map(f=>[Math.round((f.simulationMs-rows[0].simulationMs)*.06),f.hostPhase,f.action,
        f.bodyX===null?null:Math.round(f.bodyX*100),f.bodyY===null?null:Math.round(f.bodyY*100),f.tentacles,f.eggs,f.enemies]))).digest('hex'),
      observedPhases:[...new Set(rows.map(f=>f.hostPhase))], observedActions:[...new Set(rows.map(f=>f.action))],
      status:s, failure:failure?.stack };
    summary.glStatus = Object.fromEntries(['framebufferStatusCalls','framebufferStatusMs','programStatusCalls','programStatusMs','framebufferCreates']
      .map(key=>[key,rows.reduce((n,f)=>n+(f[key]??0),0)]));
    summary.shaderPrograms=[...new Set(rows.flatMap(f=>f.shaderPrograms??[]))];
    // Fresh browser/context per run. Retain the slowest frames and the first
    // observed occurrence, including its next 30 simulation frames.
    summary.cold = { worst: [...rows].sort((a,b)=>b.cpuMs-a.cpuMs).slice(0,5).map(({spans,errors,...f})=>f), first: {} };
    for(const [event,predicate] of Object.entries({intro:f=>f.hostPhase==='intro',tentacles:f=>f.tentacles>0,
      ink:f=>f.ink>0,spines:f=>f.spines>0,eggs:f=>f.eggs>0,hatch:f=>f.hatching>0,ashore:f=>f.hostPhase==='ashore',land:f=>f.hostPhase==='land',death:f=>f.hostPhase==='dying'})) {
      if(run.phases.some(p=>p.cold?.first[event]))continue;
      const index=rows.findIndex(predicate);if(index<0)continue;
      const window=rows.slice(index,index+30);
      summary.cold.first[event]={simulationMs:rows[index].simulationMs,cpuMs:metric(window.map(f=>f.cpuMs)),
        compileLinkCalls:window.reduce((n,f)=>n+f.shaderCompileLinkCalls,0)};
    }
    for(let i=1;i<rows.length;i++) {const d=rows[i].heapBytes-rows[i-1].heapBytes;if(d>0)summary.heapIncreaseBytes+=d;else summary.heapDropBytes-=d;}
    if(cdp){const {profile}=await cdp.send('HeapProfiler.getSamplingProfile');
      const bytes=profile.samples.reduce((n,s)=>n+s.size,0);summary.sampledAllocationBytes=bytes-allocationTotal;allocationTotal=bytes;}
    const stem = `${quality}-${repeat}-${name}`;
    await writeFile(path.join(out,`${stem}.json`),JSON.stringify(rows));
    run.phases.push(summary); await save();
    if(args.captures!=='false' && quality==='high') await page.locator('canvas').first().screenshot({path:path.join(out,`${stem}.png`)});
    const errors=rows.flatMap(f=>f.errors);if(errors.length||residency?.errors?.length) throw Error(JSON.stringify(errors.length?errors:residency.errors));
    if(!summary.budgetPassed) throw Error(`${name}: residency budget exceeded`);
    if(failure) throw failure;
  };
  let cdp, allocationTotal=0;
  try {
    // Start exactly one World. A preceding throwaway World changes its revision
    // (part of the boss RNG seed) according to that World's loading duration.
    await page.goto(`${origin}/dev-scenario.html?visual-test=1&quality=${quality}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.devScenario?.status().lobbyReady && window.devScenario.status().paused,null,{timeout:60000});
    await page.addStyleTag({content:'#dev-scenario-panel{display:none!important} *,*::before,*::after{caret-color:transparent!important}'});
    await command(args.scenario==='regular' ? {action:'start',scenario:{version:1,classId:'dachs_nukem',mapId:'1',seed:12345,timeOfDay:720,
      player:{gridX:27,gridY:28},hideAim:true,freezeMission:true,suppressWaves:true,hideTutorial:true}} : {action:'krakenMission',performance:true});
    await page.waitForFunction(()=>{const s=window.devScenario.status();if(s.state==='error')throw Error(s.message);return s.ready&&s.paused;});
    if((await status()).quality!==quality)throw Error(`Mission did not start with requested quality ${quality}`);
    run.graphics=await page.evaluate(()=>{const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2')??canvas.getContext('webgl');
      const ext=gl.getExtension('WEBGL_debug_renderer_info');return{version:gl.getParameter(gl.VERSION),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};});
    run.loadToReadyMs=performance.now()-loadStarted;
    if(args.cold==='true') {
      run.coldStart=await page.evaluate(()=>globalThis.__krakenCold());
      run.loadingTimeline=await page.evaluate(()=>globalThis.__FD_BOOT__?.timeline?.());
    }
    await command({action:'options',values:{refillHp:true,hideAim:true,hideTutorial:true,timeOfDay:720}});
    if(args.scenario!=='regular') await target(39,36);
    await command({action:'target',gridX:35,gridY:29}); await command({action:'camera',zoom:1,focusTarget:true});
    if(parityCode)await page.evaluate(async code=>{
      const url=performance.getEntriesByType('resource').find(e=>e.name.includes('/src/effects/kraken/submersionShader.ts')).name;
      const module=await import(url),prototype=module.KrakenSubmersion.prototype,optimized=prototype.update;
      const reference=new Function('krakenWaterMask',code+'\nreturn reference;')(module.krakenWaterMask),seen=new Set();
      window.__krakenParity={toggle(old){for(const view of seen){view.signature='';view.uniform=null;}
        prototype.update=function(...args){seen.add(this);return(old?reference:optimized).apply(this,args);};}};
      window.__krakenParity.toggle(false);
    },parityCode);
    if(args.rendererParity==='true') await page.evaluate(async framebufferReference=>{
      const url=performance.getEntriesByType('resource').find(e=>/\/phaser\.js\?/.test(e.name)).name;
      const module=await import(url),Phaser=module.default??module;
      const prototype=Phaser.Renderer.WebGL.ProgramManager.prototype,original=prototype.getCurrentProgramSuite;
      let reference=false,serial=0;const ids=new WeakMap();
      const shadowUrl=performance.getEntriesByType('resource').find(e=>e.name.includes('/src/effects/kraken/KrakenShadowRenderer.ts')).name;
      const shadow=(await import(shadowUrl)).KrakenShadowRenderer.prototype,update=shadow.update,seen=new Set();
      shadow.update=function(...args){seen.add(this);return update.apply(this,args);};
      const framebuffer=Phaser.Renderer.WebGL.Wrappers.WebGLFramebufferWrapper.prototype,resize=framebuffer.resize;
      const referenceResize=new Function(`return (${framebufferReference});`)();
      const sunUrl=performance.getEntriesByType('resource').find(e=>e.name.includes('/src/effects/sunlight/SunRenderTarget.ts')).name;
      const target=(await import(sunUrl)).SunRenderTarget.prototype,draw=target.draw;
      // Exercise real attachment resizing even in a frozen pose, then render
      // at the original resolution. Only this separate image pass does extra work.
      target.draw=function(width,height){this.shader.drawingContext.resize(width+1,height);
        this.shader.drawingContext.resize(width,height);return draw.call(this,width,height);};
      // Same frozen scene: compare shared programs against separate programs
      // per manager, with precisely the same shader sources and private uniforms.
      prototype.getCurrentProgramSuite=function(){
        const base=this.currentConfig.base,name=base.name;
        if(reference && /^(KrakenShared|WaterDisturbanceShared)/.test(name)) {
          if(!ids.has(this))ids.set(this,++serial);base.name=name+'_ParityPrivate'+ids.get(this);
        }
        try{return original.call(this);}finally{base.name=name;}
      };
      window.__krakenParity={toggle(old){reference=old;framebuffer.resize=old?referenceResize:resize;
        for(const view of seen)view.signature='';}};
    },framebufferReference);
    if(args.profile==='true') {
      run.profiled=true;cdp=await page.context().newCDPSession(page);
      await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,blink.user_timing',transferMode:'ReturnAsStream'});
      await cdp.send('HeapProfiler.startSampling',{samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
      await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
    }
    if(args.scenario==='regular') {
      await phase('regular-cold',()=>step(480));
      await phase('regular-steady',()=>step(1200));
      run.coverage={regular:true};
    } else {
    await phase('intro',async()=>{await step(180);await parity('intro-rise');await step(300);});
    await phase('water',()=>step(300));
    await phase('ink',async()=>{await surfaced();await target(37,34);await act('ink');await step(72);await parity('ink-active');await step(168);});
    await phase('spines',async()=>{await surfaced();await target(45,40);await act('spines');await step(80);await parity('spines-active');await step(280);});
    await phase('eggs-hatch',async()=>{await surfaced();await target(39,36);await act('eggs');await step(100);await parity('eggs-flight');await step(220);await parity('eggs-hatch');await step(160);});
    await phase('dive-tentacles',async()=>{await surfaced();await target(37,34);await act('dive');await step(240);await parity('tentacles');await step(600);});
    await phase('water-waves',()=>step(900));
    await phase('ashore',async()=>{await surfaced();const s=await status();await command({action:'krakenHp',hp:s.krakenResidency.maxHp*config.phaseTwoHpRatio});await act('ashore');await wait(s=>state(s)?.phase.kind==='land','land');await step(60);});
    await phase('land-claw',async()=>{await command({action:'camera',zoom:1,focusTarget:false});await target(39,44);await act('lunge');await step(55);await parity('land-claw');await step(95);});
    await phase('land-spines',async()=>{await target(60,42);await act('spines');await step(80);await parity('land-spines');await step(160);});
    await phase('land-trail-waves',async()=>{await target(68,40);await step(600);await parity('land-trail');await step(600);});
    await phase('death',async()=>{await command({action:'krakenHp',hp:1});let s=await status();
      for(let i=0;state(s)?.phase.kind!=='dying'&&i<150;i++) {await command({action:'target',...grid(s.krakenResidency.hostPosition,s)});await command({action:'fire',slot:'weapon1'});s=await step(3);}
      if(state(s)?.phase.kind!=='dying')throw Error('Death not triggered by weapon damage');await step(60);await parity('death');await step(120);});
    run.coverage={intro:run.phases.some(p=>p.observedPhases.includes('intro')),
      simultaneousTentacles:run.phases.some(p=>p.tentaclesMax>=config.tentacles.maxConcurrent),
      ink:run.phases.find(p=>p.name==='ink').observedActions.includes('ink'),
      waterVolley:run.phases.find(p=>p.name==='spines').observedActions.includes('spines'),
      eggs:run.phases.find(p=>p.name==='eggs-hatch').observedActions.includes('eggs'),
      dive:run.phases.find(p=>p.name==='dive-tentacles').observedPhases.includes('submerged'),
      ashore:run.phases.find(p=>p.name==='ashore').observedPhases.includes('ashore'),
      claw:run.phases.find(p=>p.name==='land-claw').observedActions.includes('slam'),
      landVolley:run.phases.find(p=>p.name==='land-spines').observedActions.includes('spines'),
      landTrail:run.phases.find(p=>p.name==='land-trail-waves').bodyTravelPx>100,
      waves:run.phases.some(p=>p.enemies.maximum>20),
      hatch:run.phases.some(p=>p.hatchingMax>0),land:run.phases.some(p=>p.observedPhases.includes('land')),
      death:run.phases.some(p=>p.observedPhases.includes('dying')),victory:(await status()).terminated===true};
    }
    if(Object.values(run.coverage).some(v=>!v))throw Error(`Incomplete coverage: ${JSON.stringify(run.coverage)}`);
    if(run.parity?.some(p=>!p.stable||!p.passed))throw Error('Visual parity failed; inspect all checkpoint results');
    run.complete=true;
  } catch(error) {run.failure=error.stack;run.lastState=await status().catch(()=>null);console.error(error.message);}
  finally {
    clearInterval(heartbeat);
    if(cdp){
      const {profile}=await cdp.send('Profiler.stop');await writeFile(path.join(out,`${quality}-${repeat}.cpuprofile`),JSON.stringify(profile));
      const heap=await cdp.send('HeapProfiler.stopSampling');await writeFile(path.join(out,`${quality}-${repeat}.heapprofile`),JSON.stringify(heap.profile));
      const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');
      const {stream}=await complete;let raw='';
      for(;;){const chunk=await cdp.send('IO.read',{handle:stream});raw+=chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});
      await writeFile(path.join(out,`${quality}-${repeat}.trace.json`),raw);
      const events=JSON.parse(raw).traceEvents;
      for(const p of run.phases){
        const marker=events.find(e=>e.name===`kraken:${p.name}:start`),end=events.find(e=>e.name===`kraken:${p.name}:end`)?.ts;
        if(!marker||end===undefined)throw Error(`Missing trace phase marks: ${p.name}`);
        p.gcPausesMs=metric(events.filter(e=>['MinorGC','MajorGC'].includes(e.name)&&e.ph==='X'
          &&e.pid===marker.pid&&e.tid===marker.tid&&e.ts>=marker.ts&&e.ts<end).map(e=>e.dur/1000));
      }
    }
    await save();
  }
} finally { await browser.close(); }
}
if(args.compare) {
  const before=JSON.parse(await readFile(args.compare,'utf8'));
  report.comparison={source:args.compare,sameScenario:before.version===report.version&&before.seed===report.seed&&(before.scenario??before.runs[0]?.scenario??'kraken')===report.scenario,
    sameContent:JSON.stringify(before.hashes)===JSON.stringify(report.hashes),phases:[]};
  for(const run of report.runs)for(const phase of run.phases){
    const previousRun=before.runs.find(r=>r.quality===run.quality&&r.repeat===run.repeat);
    const previous=previousRun?.phases.find(p=>p.name===phase.name);
    if(!previous)continue;
    report.comparison.phases.push({quality:run.quality,repeat:run.repeat,phase:phase.name,
      sameWorkload:previous.workloadHash===phase.workloadHash,
      sameMeasurementMode:!!previousRun.profiled===!!run.profiled&&!!previousRun.parity===!!run.parity,
      before:{cpuMs:previous.cpuMs,frameMs:previous.frameMs,hitches33:previous.hitches33,residentMiB:previous.residentMiB},
      after:{cpuMs:phase.cpuMs,frameMs:phase.frameMs,hitches33:phase.hitches33,residentMiB:phase.residentMiB},
      cpuMeanChangePct:100*(phase.cpuMs.average/previous.cpuMs.average-1),frameMeanChangePct:100*(phase.frameMs.average/previous.frameMs.average-1)});
  }
  await save();
}
const lines=['# Kraken-Performance', '', report.scope, '', '| Qualität | Phase | CPU Ø / p95 / p99 ms | Frame Ø / p95 / p99 ms | >33 ms | GPU Ø ms | Draws Ø | MiB Peak | Compile/Link |','|---|---|---|---|---:|---:|---:|---:|---:|'];
const triple=m=>m?[m.average,m.p95,m.p99].map(n=>n.toFixed(2)).join(' / '):'n/a';
for(const r of report.runs)for(const p of r.phases) lines.push(`| ${r.quality} | ${p.name} | ${triple(p.cpuMs)} | ${triple(p.frameMs)} | ${p.hitches33} | ${p.gpuMs?.average.toFixed(2)??'n/a'} | ${p.drawCalls?.average.toFixed(1)} | ${p.residentMiB.toFixed(2)} | ${p.shaderCompileLinkCalls} |`);
lines.push('', '## Statusabfragen und Erstauftritte', '',
  '| Qualität | Phase | FBO neu / Status | FBO-Status ms | Programmstatus Anzahl / ms | CPU-Maximum ms |',
  '|---|---|---:|---:|---:|---:|');
for(const r of report.runs)for(const p of r.phases) {
  const g=p.glStatus;
  lines.push(`| ${r.quality} | ${p.name} | ${g.framebufferCreates} / ${g.framebufferStatusCalls} | ${g.framebufferStatusMs.toFixed(2)} | ${g.programStatusCalls} / ${g.programStatusMs.toFixed(2)} | ${p.cpuMs.maximum.toFixed(2)} |`);
}
for(const r of report.runs) {
  lines.push('',`${r.quality}: Navigation bis Bereitschaft inkl. Qualitätswahl ${r.loadToReadyMs?.toFixed(0)??'nicht bereit'} ms.`);
  if(r.coldStart)lines.push(`Kaltstart: ${JSON.stringify(r.coldStart)}.`);
  for(const p of r.phases)for(const [event,first] of Object.entries(p.cold.first))
    lines.push(`- Erster ${event} (${p.name}, Simulation ${first.simulationMs.toFixed(0)} ms): CPU-Maximum der ersten ${first.cpuMs.count} Frames ${first.cpuMs.maximum.toFixed(2)} ms; Compile/Link ${first.compileLinkCalls}.`);
}
if(report.comparison){lines.push('','## Vergleich','',`Szenario identisch: ${report.comparison.sameScenario}; Inhalte identisch: ${report.comparison.sameContent}. Abweichende Workload-Hashes kennzeichnen abweichende Kampfverläufe; kein pixel- oder tickgenauer A/B-Nachweis.`,'',
  '| Qualität | Phase | CPU Ø vorher → nachher ms | Änderung | Workload / Messmodus identisch |','|---|---|---|---:|---|');
  for(const p of report.comparison.phases)lines.push(`| ${p.quality} | ${p.phase} | ${p.before.cpuMs.average.toFixed(2)} → ${p.after.cpuMs.average.toFixed(2)} | ${p.cpuMeanChangePct.toFixed(1)} % | ${p.sameWorkload} / ${p.sameMeasurementMode} |`);}
await writeFile(path.join(out,'report.md'),lines.join('\n')+'\n');
const shots=report.runs.flatMap(r=>r.quality==='high'?r.phases.map(p=>`${r.quality}-${r.repeat}-${p.name}`):[]);
if(args.captures!=='false'&&shots.length){const tiles=[];for(const [i,name]of shots.entries()){const tile=await sharp(path.join(out,`${name}.png`)).resize(640,360).png().toBuffer();tiles.push({input:tile,left:i%3*640,top:Math.floor(i/3)*360});}
  await sharp({create:{width:1920,height:Math.ceil(shots.length/3)*360,channels:4,background:'#17202b'}}).composite(tiles).png().toFile(path.join(out,'contact-sheet.png'));}
const parityShots=report.runs.flatMap(r=>(r.parity??[]).map(p=>`${r.quality}-${r.repeat}-${p.name}`));
if(parityShots.length){const tiles=[];for(const [row,name]of parityShots.entries())for(const [col,side]of ['before','after','diff'].entries()){
  const tile=await sharp(path.join(out,`${name}-${side}.png`)).resize(640,360).png().toBuffer();
  const label=Buffer.from(`<svg width="640" height="28"><rect width="640" height="28" fill="#17202b"/><text x="12" y="20" fill="white" font-size="16" font-family="Arial">${name} · ${side}</text></svg>`);
  tiles.push({input:label,left:col*640,top:row*388},{input:tile,left:col*640,top:row*388+28});}
  await sharp({create:{width:1920,height:parityShots.length*388,channels:4,background:'#17202b'}}).composite(tiles).png().toFile(path.join(out,'before-after-sheet.png'));}
console.log(out);
if(report.runs.some(r=>!r.complete||r.errors.length))process.exitCode=1;
