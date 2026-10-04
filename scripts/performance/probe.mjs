/** Export distributions as compact statistics, leaving the running probe intact. */
export function readSystemProbe() {
  const report=JSON.parse(JSON.stringify(window.__FD_SYSTEM_PROBE__));
  // A private camera or shader can point back to shared Phaser objects. Their
  // inclusive scopes belong to Phaser, never to the first borrowing material.
  report.cpuAliases={};const cpu={};
  for(const [key,value] of Object.entries(report.cpu)){
    const name=key.replace(/\/.*\.sceneManager\./,'/phaser.sceneManager.')
      .replace(/\/.*\.transformerNode\./,'/phaser.sharedTransformer.');
    if(name!==key)report.cpuAliases[key]=name;
    const row=cpu[name]??={calls:0,totalMs:0,maxMs:0};
    row.calls+=value.calls;row.totalMs+=value.totalMs;row.maxMs=Math.max(row.maxMs,value.maxMs);
  }
  report.cpu=cpu;
  for(const row of Object.values(report.gpuSystems?.rows??{})){
    const values=row.samples.filter(Number.isFinite).sort((a,b)=>a-b);
    const quant=p=>values.length?values[Math.ceil((values.length-1)*p)]:null;
    row.medianMs=quant(.5);row.p95Ms=quant(.95);row.p99Ms=quant(.99);delete row.samples;
  }
  return report;
}

/** Opt-in diagnostic pass. Timings include wrapper overhead; never mix with the ordinary suite. */
export function installGlProbe() {
  const report=window.__FD_SYSTEM_PROBE__={draws:{},uploads:{},uniforms:{},programQueries:{},deletedBindings:[],programNames:{},cpu:{},frames:{}};
  const programs=new WeakMap(),deleted=new WeakMap();let next=0,program=null;
  const phase=()=>window.__FD_PERF__?.state??'boot';
  const getId=p=>{if(!p)return 'none';if(!programs.has(p))programs.set(p,String(++next));return programs.get(p);};
  report.labelPrograms=renderer=>{for(const [name,p] of Object.entries(renderer.shaderProgramFactory.programs))report.programNames[getId(p.webGLProgram)]=name;};
  for(const prototype of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]) {
    const wrap=(name,fn)=>{const original=prototype[name];if(original)prototype[name]=function(...args){return fn.call(this,original,args);};};
    wrap('useProgram',function(fn,args){program=args[0];return fn.apply(this,args);});
    wrap('getProgramParameter',function(fn,args){const start=performance.now();try{return fn.apply(this,args);}finally{
      const key=phase()+'/'+getId(args[0]),row=report.programQueries[key]??={calls:0,totalMs:0,maxMs:0},ms=performance.now()-start;
      row.calls++;row.totalMs+=ms;row.maxMs=Math.max(row.maxMs,ms);
    }});
    for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced'])wrap(name,function(fn,args){
      const key=phase()+'/'+getId(program);report.draws[key]=(report.draws[key]??0)+1;return fn.apply(this,args);
    });
    wrap('bufferSubData',function(fn,args){
      const key=phase()+'/'+getId(program),row=report.uploads[key]??={calls:0,bytes:0,totalMs:0};row.calls++;
      const source=args[2],elementBytes=source?.BYTES_PER_ELEMENT??1;
      row.bytes+=args[4]?args[4]*elementBytes:Math.max(0,(source?.byteLength??0)-(args[3]??0)*elementBytes);
      const start=performance.now();try{return fn.apply(this,args);}finally{row.totalMs+=performance.now()-start;}
    });
    for(const name of ['uniform1f','uniform2f','uniform3f','uniform4f','uniform1i','uniform2i','uniform3i','uniform4i',
      'uniform1fv','uniform2fv','uniform3fv','uniform4fv','uniform1iv','uniform2iv','uniform3iv','uniform4iv',
      'uniformMatrix2fv','uniformMatrix3fv','uniformMatrix4fv'])wrap(name,function(fn,args){
        const key=phase()+'/'+getId(program),row=report.uniforms[key]??={calls:0,totalMs:0};row.calls++;
        const start=performance.now();try{return fn.apply(this,args);}finally{row.totalMs+=performance.now()-start;}
      });
    wrap('deleteRenderbuffer',function(fn,args){if(args[0])deleted.set(args[0],new Error('Renderbuffer deleted').stack);return fn.apply(this,args);});
    wrap('bindRenderbuffer',function(fn,args){if(args[1]&&deleted.has(args[1])&&report.deletedBindings.length<10)
      report.deletedBindings.push({phase:phase(),at:performance.now(),deleted:deleted.get(args[1]),bound:new Error('Deleted renderbuffer bound').stack});
      return fn.apply(this,args);
    });
  }
}

export function installSceneProbe() {
  const scene=window.__FD_PERF__.probeScene,report=window.__FD_SYSTEM_PROBE__;
  const phase=()=>window.__FD_PERF__?.state??'boot';let seen=new WeakMap();const wrapped=new WeakSet();
  // These World submissions precede Phaser's PRE_RENDER timer. Sample them
  // separately, never nest timer queries or infer whole-frame GPU time from it.
  const gl=scene.renderer.gl,extension=gl instanceof WebGL2RenderingContext
    ?gl.getExtension('EXT_disjoint_timer_query_webgl2'):null;
  const gpu=report.gpuSystems={status:extension?'available':'unavailable',discarded:0,rows:{}};
  const pending=[];let frame=0;
  const gpuMethods=new Set(['world.syncGroundFog','world.syncWorldShadows','world.syncWorldLighting']);
  function beginGpu(name,owner){
    if(!extension||frame%8!==0||!phase().endsWith(':measure')||!gpuMethods.has(name)
      ||pending.length>=48||gl.isContextLost()||gl.getQuery(extension.TIME_ELAPSED_EXT,gl.CURRENT_QUERY))return null;
    if(name==='world.syncGroundFog'&&owner.input?.groundFog?.getSystem()?.measureGpu)return null;
    const query=gl.createQuery();if(!query)return null;
    gl.beginQuery(extension.TIME_ELAPSED_EXT,query);return{query,key:phase()+'/'+name};
  }
  const clearGpu=()=>{for(const item of pending)gl.deleteQuery(item.query);pending.length=0;};
  function pollGpu(){
    if(!extension)return;
    if(gl.isContextLost()||gl.getParameter(extension.GPU_DISJOINT_EXT)){gpu.discarded+=pending.length;clearGpu();return;}
    for(let i=pending.length-1;i>=0;i--){const item=pending[i];
      if(!gl.getQueryParameter(item.query,gl.QUERY_RESULT_AVAILABLE))continue;
      const ns=gl.getQueryParameter(item.query,gl.QUERY_RESULT);
      if(typeof ns==='number'&&Number.isFinite(ns)&&ns>=0){
        const ms=ns/1e6,row=gpu.rows[item.key]??={count:0,totalMs:0,maxMs:0,samples:[]};
        row.count++;row.totalMs+=ms;row.maxMs=Math.max(row.maxMs,ms);row.samples.push(ms);
      }else gpu.discarded++;
      gl.deleteQuery(item.query);pending.splice(i,1);
    }
  }
  scene.events.once('shutdown',clearGpu);scene.events.once('destroy',clearGpu);
  const methods=/^(update|sync|draw|render|tick|sampleCharacterMaterialLights|drawComposite|renderBatch|run|prepare|upload|updateInstances|syncGroundFog|syncWorldShadows|syncWorldLighting)$/;
  function wrap(owner,path,depth=0) {
    if(!owner||typeof owner!=='object'||(seen.get(owner)??Infinity)<=depth)return;seen.set(owner,depth);
    if(!wrapped.has(owner))for(const key of new Set([...Object.getOwnPropertyNames(Object.getPrototypeOf(owner)??{}),...Object.keys(owner)])){
      if(!methods.test(key)||typeof owner[key]!=='function')continue;
      const original=owner[key];owner[key]=function(...args){const query=beginGpu(path+'.'+key,owner),start=performance.now();try{return original.apply(this,args);}finally{
        const id=phase()+'/'+path+'.'+key,row=report.cpu[id]??={calls:0,totalMs:0,maxMs:0};const ms=performance.now()-start;
        row.calls++;row.totalMs+=ms;row.maxMs=Math.max(row.maxMs,ms);
        if(query){gl.endQuery(extension.TIME_ELAPSED_EXT);pending.push(query);}
      }};
    }
    wrapped.add(owner);
    if(depth<3)for(const [key,value] of Object.entries(owner))if(value&&typeof value==='object'
      &&!['scene','renderer','game','ctx','flow','events','manager','sys','programManager','display','shader',
        'displayList','systems','defaultRenderNodes','customRenderNodes','parentContainer','input','anims','body'].includes(key)
      &&!Array.isArray(value)&&!(value instanceof Map)&&!(value instanceof Set)&&!ArrayBuffer.isView(value))wrap(value,path+'.'+key,depth+1);
  }
  // Own shared renderer roots before walking borrowers. A later shallower path
  // may still expose children beyond an earlier path's depth limit.
  const shared=()=>{for(const key of ['lighting','gpuVfx','shadow'])wrap(scene.renderers?.[key],'renderers.'+key);};
  shared();
  // Own the canonical World paths first. Phaser GameObjects can point through
  // their display list to shared Scene systems; those are not a local FX cost.
  wrap(scene.arenaRuntime?.flow?.getWorldRuntime()?.presentationFrame,'world');
  for(const [key,value] of Object.entries(scene.renderers??{}))wrap(value,'renderers.'+key);
  for(const key of ['arenaRuntime','combatPresentation','worldPresentation','effectOrchestrator'])wrap(scene[key],key,2);
  let previous='';
  scene.events.on('postupdate',()=>{frame++;pollGpu();const p=phase();report.frames[p]=(report.frames[p]??0)+1;report.labelPrograms(scene.renderer);
    if(p!==previous){previous=p;seen=new WeakMap();shared();
      wrap(scene.arenaRuntime?.flow?.getWorldRuntime()?.presentationFrame,'world');
      for(const [key,value] of Object.entries(scene.renderers??{}))wrap(value,'renderers.'+key);
    }
  });
  return {sceneKeys:Object.keys(scene),rendererKeys:Object.keys(scene.renderers??{})};
}
