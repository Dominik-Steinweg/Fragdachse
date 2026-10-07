import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, statfs } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { cpus, totalmem } from 'node:os';
import { createHash } from 'node:crypto';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { metric } from './metrics.mjs';
import { compactRecording } from './compact.mjs';
import { aggregateSuite } from './suite-metrics.mjs';
import { measureSuiteLoading } from './suite-load.mjs';

export const SUITE_VERSION = 1;

export async function serve(site, publicRoot) {
  const mime = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png',
    '.webp':'image/webp', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.ogg':'audio/ogg', '.mp3':'audio/mpeg', '.wav':'audio/wav' };
  const server = createServer((req,res) => { void (async () => {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    for (const root of [site, publicRoot]) {
      const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(resolve(root)+sep)) continue;
      try {
        const info=await stat(file); if (!info.isFile()) continue;
        res.writeHead(200, {'content-type':mime[extname(file)]??'application/octet-stream', 'content-length':info.size,
          'cache-control':'public, max-age=31536000, immutable'});
        createReadStream(file).on('error',()=>res.destroy()).pipe(res); return;
      } catch {}
    }
    res.writeHead(404).end();
  })().catch(()=>res.writeHead(500).end()); });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  return { url:`http://127.0.0.1:${server.address().port}/`, close:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));} };
}

// Runs in the fresh page only. No timing or random overrides in production code.
function initialize(request) {
  window.__FD_PERF_REQUEST__=request;
  let seed=16092026;
  Math.random=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
}

export async function runSuite(args) {
  const options={runs:3,qualities:['high','low'],caseId:'review',timeoutMs:900_000,warmupMs:2000,cpuThrottle:1,maxCGrowthMiB:128};
  for(let i=0;i<args.length;i+=2){const key=args[i],v=args[i+1];if(!v)throw Error(`Missing value: ${key}`);
    if(key==='--sites')options.sites=v;
    else if(key==='--output-root')options.output=resolve(v);
    else if(key==='--runs' && /^\d+$/.test(v))options.runs=Number(v);
    else if(key==='--qualities')options.qualities=v.split(',');
    else if(key==='--case')options.caseId=v;
    else if(key==='--warmup-ms' && /^\d+$/.test(v))options.warmupMs=Number(v);
    else if(key==='--cpu-throttle' && /^(1|4)$/.test(v))options.cpuThrottle=Number(v);
    else if(key==='--max-c-growth-mib' && /^\d+$/.test(v) && Number(v)>=128 && Number(v)<=8192)options.maxCGrowthMiB=Number(v);
    else if(key==='--profile'&&['on','off'].includes(v))options.profile=v==='on';
    else throw Error(`Unknown suite option: ${key}`);
  }
  if(!options.sites||!options.output||options.runs<1||options.runs>100||options.warmupMs>120_000||options.qualities.some(q=>!['high','low'].includes(q)))
    throw Error('Usage: perf:chrome --suite --sites sites.json --output-root D:/... [--runs 3] [--qualities high,low] [--case review] [--cpu-throttle 1|4] [--profile on] [--max-c-growth-mib 128..8192]');
  if(options.caseId==='load'&&options.profile)throw Error('Loading probes do not support the gameplay CPU profile option');
  const sites=JSON.parse(await readFile(options.sites,'utf8'));
  for (const site of sites) site.buildId = createHash('sha256').update(await readFile(join(site.site, 'index.html'))).digest('hex');
  await mkdir(options.output,{recursive:true});
  const stopRequested=async()=>{try{await stat(join(options.output,'STOP'));return true;}catch{return false;}};
  const launch={executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,
    args:['--force-device-scale-factor=1','--window-size=1940,1160','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--enable-precise-memory-info'],
    ignoreDefaultArgs:['--mute-audio','--autoplay-policy=no-user-gesture-required']};
  const all=[],environment={version:SUITE_VERSION,options,launch,cpu:cpus()[0]?.model,memoryBytes:totalmem(),sites};
  const storageStart=await statfs('C:/');
  const minimumFreeC=Math.max(1024**3,storageStart.bavail*storageStart.bsize-options.maxCGrowthMiB*1024**2);
  // Alternate A/B order by repetition to reduce temperature/order bias.
  for(let repetition=1;repetition<=options.runs;repetition++)for(const quality of options.qualities)for(const site of repetition%2?sites:[...sites].reverse()){
    if(await stopRequested())throw Error('Stopped by output-root/STOP');
    const id=`${site.label}-${quality}-${repetition}`,directory=join(options.output,id);
    await mkdir(directory,{recursive:true});
    let saved;
    try { saved=JSON.parse(await readFile(join(directory,'run.json'),'utf8')); } catch {}
    if(saved?.status==='complete') {
      if(saved.buildId!==site.buildId||saved.caseId!==options.caseId||saved.profile!==!!options.profile||(saved.warmupMs??2000)!==options.warmupMs||(saved.cpuThrottle??1)!==options.cpuThrottle)
        throw Error(`Refusing incompatible resume: ${id}`);
      all.push(saved);console.log(`RESUME completed ${id}`);continue;
    }
    const record={id,repetition,quality,label:site.label,commit:site.commit,buildId:site.buildId,caseId:options.caseId,warmupMs:options.warmupMs,cpuThrottle:options.cpuThrottle,profile:!!options.profile,status:'running'};
    await writeFile(join(directory,'run.json'),JSON.stringify(record));
    all.push(record); console.log(`START ${id} ${options.caseId}`);
    const server=await serve(resolve(site.site),resolve(site.public));
    let context,cdp;
    const messages=[],memory=[];
    try {
      // Explicit persistent profile on the selected output drive; no large temp profile on C:.
      // An interrupted attempt may already have populated HTTP/shader caches.
      // Preserve that evidence, but never reuse it for a cold-profile retry.
      let profileDirectory=join(directory,'chrome-profile'),attempt=1;
      while(await stat(profileDirectory).then(()=>true,()=>false))profileDirectory=join(directory,`chrome-profile-${++attempt}`);
      record.profileAttempt=attempt;
      context=await chromium.launchPersistentContext(profileDirectory,{...launch,viewport:{width:1920,height:1080},deviceScaleFactor:1});
      environment.browserVersion=context.browser().version();
      const browserCdp=await context.browser().newBrowserCDPSession();
      environment.gpu=(await browserCdp.send('SystemInfo.getInfo')).gpu;
      await browserCdp.detach();
      const loading=options.caseId==='load';
      const request={schemaVersion:1,runId:id,caseId:options.caseId,timeoutMs:options.timeoutMs,captureProfile:'reduced',quality,warmupMs:options.warmupMs,localHost:true,
        ...(loading?{load:true}:{})};
      await context.addInitScript(initialize,request);
      const page=context.pages()[0]??await context.newPage();
      page.on('pageerror',e=>messages.push({type:'pageerror',text:e.stack}));
      page.on('console',m=>{if(['warning','error'].includes(m.type()) && messages.length<100)messages.push({type:m.type(),text:m.text(),location:m.location()});});
      cdp=await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:options.cpuThrottle});
      await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:120_000});await page.bringToFront();
      const deadline=Date.now()+options.timeoutMs;
      const guard=async()=>{
        if(await stopRequested())throw Error('Stopped by output-root/STOP');
        const storage=await statfs('C:/');
        if(storage.bavail*storage.bsize<minimumFreeC)throw Error(`C: free-space guard: more than ${options.maxCGrowthMiB} MiB consumed or less than 1 GiB free`);
        if(Date.now()>deadline)throw Error('Suite timeout');
        if(messages.some(m=>m.type==='pageerror'))throw Error('Page error');
      };
      if(loading){
        record.loads=await measureSuiteLoading(page,guard);
        record.windows=[];
        record.boot=await page.evaluate(()=>window.__FD_BOOT__??null);
      }else{
      let started=false,last='',profileStart;
      for(;;){
        await guard();
        const state=await page.evaluate(()=>({state:window.__FD_PERF__?.state,error:window.__FD_PERF__?.error,detail:window.__FD_PERF__?.detail,
          at:performance.now(),heap:performance.memory?.usedJSHeapSize,hidden:document.hidden,focused:document.hasFocus()}));
        if(state.state!==last){console.log(`${id}: ${state.state??'boot'}`);last=state.state;
          record.lastState=state;await writeFile(join(directory,'run.json'),JSON.stringify(record));}
        if(state.error||state.state==='failed')throw Error(state.error??'Lab failed');
        if(state.hidden)throw Error('Page hidden');
        if(Number.isFinite(state.heap))memory.push({at:state.at,bytes:state.heap});
        if(state.state==='awaiting-audio'&&!started){
          await page.mouse.click(4,4);
          await page.waitForFunction(()=>window.__FD_PERF__.audioState?.()==='running',null,{timeout:10_000});
          if(options.profile){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');profileStart=await page.evaluate(()=>performance.now());}
          await page.evaluate(()=>window.__FD_PERF__.start());started=true;
        }
        if(state.state==='complete')break;
        await page.waitForTimeout(500);
      }
      let profile;
      if(options.profile)profile=(await cdp.send('Profiler.stop')).profile;
      // Serialize only compact statistics; the raw capture stays in its owning browser.
      const recording=await page.evaluateHandle(()=>window.__FD_PERF__.result);
      let result;
      try { result=await page.evaluate(compactRecording,recording); }
      finally { await recording.dispose(); }
      record.environment=result.environment;
      record.boot=await page.evaluate(()=>window.__FD_BOOT__??null);
      record.loadingTimeline=await page.evaluate(()=>window.__FD_BOOT__?.timeline?.()??null);
      record.windows=result.windows.map(w=>({...w,
        heapBytes:metric(memory.filter(m=>m.at>=w.fromMs&&m.at<=w.toMs).map(m=>m.bytes)),
      }));
      record.attribution=result.attribution;
      record.gpuVfx=result.gpuVfx;
      if(profile){
        const nodes=new Map(profile.nodes.map(n=>[n.id,n.callFrame])),totals=new Map();let at=profileStart;
        for(let i=0;i<(profile.samples??[]).length;i++){
          const duration=profile.timeDeltas[i]/1000;at+=duration;
          const window=record.windows.find(w=>w.kind==='measurement'&&at>=w.fromMs&&at<=w.toMs);if(!window)continue;
          const frame=nodes.get(profile.samples[i]),key=JSON.stringify({caseId:window.id,...frame});totals.set(key,(totals.get(key)??0)+duration);
        }
        record.cpuProfile=[...totals].map(([key,selfMs])=>({...JSON.parse(key),selfMs})).sort((a,b)=>b.selfMs-a.selfMs).slice(0,200);
        const maps=new Map();
        for(const frame of record.cpuProfile) {
          if(!frame.url?.startsWith(server.url))continue;
          const file=new URL(frame.url).pathname.slice(1),mapPath=join(site.site,file+'.map');
          if(!maps.has(mapPath)){try{maps.set(mapPath,new TraceMap(JSON.parse(await readFile(mapPath,'utf8'))));}catch{maps.set(mapPath,null);}}
          const map=maps.get(mapPath);if(!map)continue;
          const original=originalPositionFor(map,{line:frame.lineNumber+1,column:frame.columnNumber});
          frame.source=original.source;frame.sourceLine=original.line;frame.originalName=original.name;
        }
      }
      }
      if(messages.some(m=>m.type==='pageerror'||m.type==='error'))throw Error('Browser errors; inspect run JSON');
      record.status='complete';console.log(`COMPLETE ${id}`);
    }catch(e){record.status='failed';record.error=e.stack;console.error(`FAILED ${id}: ${e.message}`);}
    finally{record.messages=messages;
      for(const close of [()=>context?.close(),()=>server.close()])try{await close();}catch(error){
        record.status='failed';record.cleanupErrors??=[];record.cleanupErrors.push(String(error));
      }
      await writeFile(join(directory,'run.json'),JSON.stringify(record));
      const groups=[...new Set(all.map(r=>`${r.label}/${r.quality}`))].map(key=>({key,cases:aggregateSuite(all.filter(r=>`${r.label}/${r.quality}`===key))}));
      await writeFile(join(options.output,'suite.json'),JSON.stringify({environment,runs:all,groups}));}
    if(record.status==='failed')throw Error(`Failed run: ${id}; evidence saved in ${directory}`);
  }
}
