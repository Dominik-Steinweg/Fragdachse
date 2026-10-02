import { anatomicalParts } from './mesh-shadow-repair.mjs';
import { projectMesh, rasterUnion, softMask } from './mesh-shadow-raster.mjs';
const DEG=Math.PI/180,DENSITY=2;
function boundary(mask){const {data:d,width:w,height:h}=mask,out=[];
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(d[i]&&(!d[i-1]||!d[i+1]||!d[i-w]||!d[i+w]))out.push([x,y]);}return out;
}
/** Freeze the BEFORE anatomical corridor for both masks: a filler cannot move the goalposts. */
export function gapMetric(before,after,{poses=Array.from({length:37},(_,i)=>i),elevations=[28,35,45],azimuths=Array.from({length:16},(_,i)=>i*22.5),progress=()=>{}}={}) {
  const parts=anatomicalParts(before),legs=parts.filter(p=>/^Upright hind leg(?:\.\d+)?$/.test(p.name));
  const torso=new Uint16Array(parts.filter(p=>['Pelvis','Standing torso'].includes(p.name)).flatMap(p=>Array.from(p.indices)));
  if(legs.length!==2||!torso.length)throw Error('Gap metric anatomy missing');
  const rows=[];
  for(const pose of poses){for(const elevation of elevations)for(const azimuth of azimuths){
    const xy=projectMesh(before.poses[pose],0,azimuth*DEG,elevation*DEG),fixed=projectMesh(after.poses[pose],0,azimuth*DEG,elevation*DEG);
    const xs=[],ys=[];for(let i=0;i<fixed.length;i+=2){xs.push(fixed[i]);ys.push(fixed[i+1]);}
    const bounds=[Math.floor(Math.min(...xs))-4,Math.floor(Math.min(...ys))-4,Math.ceil(Math.max(...xs))+4,Math.ceil(Math.max(...ys))+4];
    const raster=indices=>rasterUnion([{xy,indices}],bounds,DENSITY),body=raster(torso);let edgeBody=null,oldSoft=null,newSoft=null;
    const row={pose,azimuth,elevation,legs:[]};
    for(const leg of legs){const lm=raster(leg.indices);if(lm.data.some((v,i)=>v&&body.data[i]))continue;
      edgeBody??=boundary(body);const edgeLeg=boundary(lm);let best=Infinity,ends;
      for(const a of edgeLeg)for(const b of edgeBody){const d=(a[0]-b[0])**2+(a[1]-b[1])**2;if(d<best){best=d;ends=[a,b];}}
      if(!ends)throw Error('Empty projected anatomy');const gapWorld=Math.max(0,(Math.sqrt(best)-1)/DENSITY);if(!gapWorld)continue;
      oldSoft??=softMask(raster(before.indices),.45*DENSITY);
      newSoft??=softMask(rasterUnion([{xy:fixed,indices:after.indices}],bounds,DENSITY),.45*DENSITY);
      const [a,b]=ends,dx=b[0]-a[0],dy=b[1]-a[1],r=DENSITY;let missingBefore=0,missingAfter=0;
      for(let y=Math.min(a[1],b[1])-r;y<=Math.max(a[1],b[1])+r;y++)for(let x=Math.min(a[0],b[0])-r;x<=Math.max(a[0],b[0])+r;x++){
        const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/best));
        if((x-a[0]-t*dx)**2+(y-a[1]-t*dy)**2>r*r)continue;
        const i=y*body.width+x;missingBefore+=oldSoft[i]<.5?1:0;missingAfter+=newSoft[i]<.5?1:0;
      }
      row.legs.push({leg:leg.name,gapWorld,missingBeforeWorld2:missingBefore/DENSITY**2,missingAfterWorld2:missingAfter/DENSITY**2,
        corridorWorld:ends.map(p=>p.map((v,k)=>bounds[k]+(v+.5)/DENSITY))});
    }
    row.flaggedBefore=row.legs.some(l=>l.missingBeforeWorld2>=.5);row.flaggedAfter=row.legs.some(l=>l.missingAfterWorld2>=.5);rows.push(row);
  }progress(pose);}
  const summarize=rs=>({samples:rs.length,before:rs.filter(r=>r.flaggedBefore).length,after:rs.filter(r=>r.flaggedAfter).length,
    maxMissingBeforeWorld2:Math.max(0,...rs.flatMap(r=>r.legs.map(l=>l.missingBeforeWorld2))),maxMissingAfterWorld2:Math.max(0,...rs.flatMap(r=>r.legs.map(l=>l.missingAfterWorld2)))});
  return {schema:'fd-leg-gap-review',version:1,definition:{corridorWidthWorld:2,minimumMissingAreaWorld2:.5,coverageThreshold:.5,density:DENSITY,blurSigmaWorld:.45,
    corridor:'Shortest BEFORE leg-to-pelvis/torso boundary segment; fixed for before/after; overlapping anatomy excluded',
    baseline:'Quantized unfilled mesh, NOT offline Blender D coverage; counts need not equal the prior D-mask analysis'},
    ...summarize(rows),byPose:poses.map(pose=>({pose,...summarize(rows.filter(r=>r.pose===pose))})),
    byElevation:elevations.map(elevation=>({elevation,...summarize(rows.filter(r=>r.elevation===elevation))})),rows};
}
export function assertGapAcceptance(report){if(report.after)throw Error(`Leg gap gate: ${report.after}/${report.samples} combinations still exceed 0.5 world px²; inspect gap-metric.json`);}
export function repairFootprintMetric(before,after) {
  const rows=before.poses.map((p,pose)=>{const bounds=[-32,-32,32,32],density=4;
    const raster=b=>rasterUnion([{xy:projectMesh(b.poses[pose],0,0,Math.PI/2),indices:b.indices}],bounds,density);
    const a=raster(before),b=raster(after);let added=0;for(let i=0;i<a.data.length;i++)if(b.data[i]&&!a.data[i])added++;
    return {pose,addedWorld2:added/density**2};
  });
  return {definition:'Top-down hard union at 4 texels/world px; new hip volumes must stay inside body footprint',maxAddedWorld2:Math.max(...rows.map(r=>r.addedWorld2)),rows};
}
