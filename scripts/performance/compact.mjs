/** Browser-safe reduction: never transfer the full object-per-span recording over CDP. */
export function compactRecording(result) {
  const capture=result.game.frameCapture,origin=capture?.startedAtPerformanceMs;
  if(!capture||capture.version!==2||capture.truncated||capture.autoStopped||result.game.series.truncated||result.game.session.eventsTruncated)
    throw Error('Incomplete or unsupported frame recording');
  const metric=values=>{
    const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;
    const q=p=>a[Math.max(0,Math.ceil(a.length*p)-1)];
    return {count:a.length,average:a.reduce((n,v)=>n+v,0)/a.length,median:q(.5),p95:q(.95),p99:q(.99),maximum:a.at(-1)};
  };
  const scopes=['gameCallback','sceneManager','scenePreUpdate','sceneSystems','sceneUpdate','gameplay','visualTail','scenePostUpdate','rendererSetup','renderSubmit'];
  const windows=result.windows.map(window=>{
    const from=window.fromMs-origin,to=window.toMs-origin;
    const frame=[],gpu=[],draw=[],cpu=Object.fromEntries(scopes.map(s=>[s,[]]));
    for(const f of capture.frames)if(f[2]>0&&f[1]-f[2]>=from&&f[1]<=to)frame.push(f[2]);
    for(const work of capture.work??[]){
      if(!work.complete||work.toMs<=from||work.fromMs>=to)continue;
      if(work.fromMs>=from&&work.toMs<=to){cpu.gameCallback.push(work.toMs-work.fromMs);draw.push(work.drawCalls);}
      for(const span of work.spans)if(cpu[span.scope]&&span.fromMs>=from&&span.toMs<=to)cpu[span.scope].push(span.toMs-span.fromMs);
    }
    for(const g of result.game.series.gpuSamples)if(g.atMs>=from&&g.submissionEndMs<=to&&g.submissionEndMs>=g.atMs)gpu.push(g.durationMs);
    const costs=Object.fromEntries(scopes.map(s=>[s,metric(cpu[s])]));
    return {...window,durationMs:window.toMs-window.fromMs,frame:metric(frame),cpu:costs.gameCallback,scopes:costs,
      gpu:metric(gpu),gpuStatus:gpu.length?'sampled':result.game.summaries.gpu.status,drawCalls:metric(draw),
      textureRgbaBytes:metric([window.load?.textureRgbaBytes])};
  });
  return {environment:result.environment,windows,attribution:result.game.summaries.attribution,gpuVfx:result.game.summaries.gpuVfx};
}
