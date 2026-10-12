import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { krakenResidencyPlan } from '../../src/effects/kraken/KrakenResidencyPlan.ts';

const revision=process.argv[2]??'kraken-ls-pilot-2';
if(!/^kraken-ls-pilot-\d+$/.test(revision))throw Error('Invalid pilot revision');
const out=path.resolve('art/poc/kraken-v12/light-shadow-pilot');await fs.mkdir(out,{recursive:true});
const ids={water:'abyssal-kraken',land:'abyssal-kraken-land',tentacle:'abyssal-kraken-tentacle',egg:'abyssal-kraken-egg'};
const exports={};for(const [role,id]of Object.entries(ids))exports[role]=JSON.parse(await fs.readFile(`art/poc/pipeline-v2/runs/kraken-v11b/${id}/standard/export.json`));
const planHash=createHash('sha256').update(await fs.readFile('src/effects/kraken/KrakenResidencyPlan.ts')).digest('hex');
const phases=['intro','water','ashore','land'];
const desired=(phase,options={})=>{const p=krakenResidencyPlan(phase,options);return [...p.required,...p.clips];};
function audit(sizes){
  const bytes=entries=>entries.reduce((s,[role,clip])=>s+exports[role].budget.sizes[sizes[role]].clips[clip].total,0);
  const rows=phases.map(phase=>({phase,clips:desired(phase),atlasBytes:bytes(desired(phase))}));
  // A pose lease retains its two actual independently packed pages, not an entire clip.
  function maxLease(role,clips){let max=0,winner=null;
    const atlas=exports[role].atlases[sizes[role]];
    for(const clip of clips)for(const frame of atlas.color[clip].frameNames){
      const pages=['color','elevation'].map(pass=>atlas[pass][clip].pages.find(p=>p.frameNames.includes(frame)));
      const sum=pages.reduce((s,p)=>s+p.gpuBytesRGBA8,0);if(sum>max){max=sum;winner={clip,frame,pages:pages.map(p=>p.image)};}
    }return {bytes:max,...winner};
  }
  const transitions=[];
  for(let i=1;i<phases.length;i++){
    const from=phases[i-1],to=phases[i],next=new Set(desired(to).map(p=>p.join('/'))),removed=desired(from).filter(p=>!next.has(p.join('/'))),leases=[];
    // Body crossfade: one outgoing body. Up to three distinct tentacle pose pages may be held.
    for(const role of ['water','land','tentacle','egg']){
      const clips=removed.filter(p=>p[0]===role).map(p=>p[1]);if(!clips.length)continue;
      const max=maxLease(role,clips);leases.push({role,count:role==='tentacle'?3:1,...max});
    }
    // Conservative upper bound for 3 different tentacle pages, never above the removed asset total.
    const retained=leases.reduce((s,l)=>s+Math.min(l.bytes*l.count,bytes(removed.filter(p=>p[0]===l.role))),0);
    transitions.push({from,to,leases,retainedBytesUpper:retained,atlasBytesUpper:bytes(desired(to))+retained});
  }
  return {sizes,rows,transitions,waterMoveBytes:bytes(desired('water',{waterMove:true})),
    waterFullLandPrefetchBytes:bytes(desired('water',{prefetchLand:true})),
    allAssetsBytes:bytes(Object.entries(exports).flatMap(([role,e])=>Object.keys(e.budget.sizes[sizes[role]].clips).map(c=>[role,c])))};
}
const result={revision,planHash,method:'Exact existing RGBA8 atlas page bytes from v11b and the shared runtime phase plan; transition upper bound for retained pose pages. No GPU capture or unexported emission estimate.',
  native:audit({water:384,land:432,tentacle:448,egg:64}),compact:audit({water:320,land:360,tentacle:448,egg:64})};
try{
 const pilot=JSON.parse(await fs.readFile(`art/poc/pipeline-v2/runs/${revision}/ls-pilot.json`));
 result.pilot=pilot.assets.map(a=>({id:a.id,role:a.role,atlasBytes:a.gpuBytes,poses:a.poses.map(p=>({name:p.name,
  atlasBytes:p.gpuBytes,beautyReviewBytes:p.passes.beauty.gpuBytes,emissionBytes:p.passes.emission.gpuBytes,
  meshCpuBytes:p.mesh.vertexCount*12+p.mesh.triangleCount*6,meshGpuBytes:a.role==='egg'?0:p.mesh.vertexCount*12+p.mesh.triangleCount*6+4,
  shadowHighUpper:a.role==='egg'?135:(a.role==='tentacle'?256:512)**2*15,
  shadowMediumUpper:a.role==='egg'?135:(a.role==='tentacle'?128:256)**2*15,
  shadowLow:135,filterAllowancePerInstance:a.size*a.size*10+128*128*4}))}));
 // Review selects exactly one pose: four atlases, shared decoded mesh, two caster instances.
 result.reviewResourceEstimate=Math.max(...result.pilot.flatMap(a=>a.poses.map(p=>p.atlasBytes+p.beautyReviewBytes+2*(p.meshGpuBytes+p.shadowHighUpper+p.filterAllowancePerInstance))));
 result.filterCaveat='Two full-canvas RGBA8+STENCIL_INDEX8 buffers and one 128-square water mask allowed per live instance. Phaser shared DrawingContextPool retention/driver padding require browser capture; this is NOT a measured or guaranteed total GPU peak.';
 // These phase rows refer to the selected pilot poses only, NOT a 440-frame export.
 result.selectedPilotPhases=phases.map(phase=>{
  const roles=new Set(desired(phase).map(p=>p[0]));if(phase==='ashore')roles.add('tentacle');
  const atlasBytes=result.pilot.filter(a=>roles.has(a.role)).reduce((s,a)=>s+a.atlasBytes,0);
  const instanceRoles=phase==='intro'||phase==='water'?['water','tentacle','tentacle','tentacle',...Array(12).fill('egg')]
   :phase==='ashore'?['water','land','tentacle','tentacle','tentacle',...Array(12).fill('egg')]:['land',...Array(12).fill('egg')];
  const extras=instanceRoles.reduce((s,r)=>s+Math.max(...result.pilot.find(a=>a.role===r).poses.map(p=>p.meshGpuBytes+p.shadowHighUpper+p.filterAllowancePerInstance)),0);
  return {phase,atlasBytes,liveResourceAllowance:extras,resourceEstimate:atlasBytes+extras};
 });
 for(const kind of ['native','compact']){
  for(const row of result[kind].rows){row.liveResourceAllowance=result.selectedPilotPhases.find(p=>p.phase===row.phase).liveResourceAllowance;row.resourceEstimateExcludingNewEmissionAndPoolRetention=row.atlasBytes+row.liveResourceAllowance;}
  for(const row of result[kind].transitions){row.liveResourceAllowance=Math.max(...result.selectedPilotPhases.filter(p=>p.phase===row.from||p.phase===row.to).map(p=>p.liveResourceAllowance));row.resourceEstimateExcludingNewEmissionAndPoolRetention=row.atlasBytesUpper+row.liveResourceAllowance;}
 }
}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.writeFile(path.join(out,'budget.json'),JSON.stringify(result,null,2)+'\n');
for(const key of ['native','compact'])console.log(key,JSON.stringify(result[key].rows.map(r=>({phase:r.phase,atlasMiB:r.atlasBytes/1048576}))),JSON.stringify(result[key].transitions.map(r=>({transition:r.from+'->'+r.to,atlasPeakUpperMiB:r.atlasBytesUpper/1048576}))));
