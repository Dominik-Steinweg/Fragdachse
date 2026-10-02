import { describe, expect, it, vi } from 'vitest';
import { RockFormationField, FORMATION_SIDE, type FormationRock } from '../src/arena/rocks/RockFormationField';
import { CELL_SIZE } from '../src/config';
import { ROCK_BASE_PHASE_CELLS, ROCK_BASE_PHASES, ROCK_BASE_FRAME_MARGIN } from '../src/arena/RockBaseConfig';

function fixture(cells: [number,number][], detail=new Float32Array(256*256), holes:[number,number][]=[]) {
  const states:FormationRock[]=cells.map(([gridX,gridY],id)=>({id,gridX,gridY,active:true,frame:0}));
  const source={alpha:new Uint8Array(2176*1870).fill(255),detail};
  const pitch=CELL_SIZE+ROCK_BASE_FRAME_MARGIN*2;
  for(const [x,y] of holes) {
    const phase=(Math.floor(y/CELL_SIZE)%ROCK_BASE_PHASE_CELLS)*ROCK_BASE_PHASE_CELLS+Math.floor(x/CELL_SIZE)%ROCK_BASE_PHASE_CELLS;
    source.alpha[(ROCK_BASE_FRAME_MARGIN+y%CELL_SIZE)*ROCK_BASE_PHASES*pitch+phase*pitch+ROCK_BASE_FRAME_MARGIN+x%CELL_SIZE]=0;
  }
  return {states,field:new RockFormationField(1024,1024,states,source)};
}
const height=(data:Float32Array,x:number,y:number):number=>data[(Math.floor(y/2)+1)*FORMATION_SIDE+Math.floor(x/2)+1];

it('keeps incremental geometry byte-identical to full builds across explosions, gutters, holes and sun/quality changes',()=>{
  const cells:[number,number][]=[];for(let y=12;y<21;y++)for(let x=12;x<21;x++)cells.push([x,y]);
  const detail=Float32Array.from({length:65536},(_,i)=>Math.sin(i%256*.1)*Math.cos(Math.floor(i/256)*.1));
  const {field,states}=fixture(cells,detail,[[510,510],[511,510],[510,511],[511,511]]);
  field.setRimGeometry({rockRimWidth:14,rockRimHeight:12,rockRimLip:2});
  for(let cy=0;cy<2;cy++)for(let cx=0;cx<2;cx++)field.buildCached(cx,cy);
  for(const [gx,gy,angle,solar] of [[16,16,135,true],[17,15,135,true],[13,14,35,false]] as const) {
    const ids:number[]=[];
    for(const s of states)if(s.active&&Math.hypot(s.gridX-gx,s.gridY-gy)<=2.5){s.active=false;ids.push(s.id);}
    field.invalidate(ids);
    let shaded=0;
    for(let cy=0;cy<2;cy++)for(let cx=0;cx<2;cx++) {
      const actual=field.buildCached(cx,cy,angle,solar);shaded+=field.lastBuild.shadedTexels;
      const expected=field.build(cx,cy,angle,solar);
      for(const channel of ['data','occlusion','heights'] as const)
        expect(Buffer.from(actual[channel].buffer).equals(Buffer.from(expected[channel].buffer)),channel).toBe(true);
    }
    if(angle===135)expect(shaded).toBeLessThan(4*FORMATION_SIDE**2);
  }
  // An unchanged rebuild reuses every ray result, with identical bytes.
  const before=field.buildCached(0,0,35,false),again=field.buildCached(0,0,35,false);
  expect(field.lastBuild.shadedTexels).toBe(0);
  expect(Buffer.from(before.data).equals(Buffer.from(again.data))).toBe(true);
},60000);

it('retains worker cache ownership across transferable results and returns one exact repair transaction',async()=>{
  const received:any[]=[];
  const scope:any={postMessage:(message:any,options?:{transfer:Transferable[]})=>received.push(structuredClone(message,{transfer:options?.transfer??[]}))};
  vi.stubGlobal('self',scope);
  try {
    await import('../src/arena/rocks/RockFormationWorker');
    const states:FormationRock[]=[{id:0,gridX:15,gridY:4,frame:0,active:true},{id:1,gridX:16,gridY:4,frame:0,active:true}];
    const source={alpha:new Uint8Array(2176*1870).fill(255),detail:new Float32Array(65536)};
    const send=(data:unknown)=>scope.onmessage({data:structuredClone(data)});
    send({kind:'init',width:1024,height:512,states,source});
    for(const cx of [0,1])send({kind:'build',cx,cy:0,revision:0,azimuth:135,horizons:true});
    states[0].active=false;send({kind:'change',states:[states[0]]});
    send({kind:'repair',revision:1,chunks:[{cx:0,cy:0,revision:1},{cx:1,cy:0,revision:1}],azimuth:135,horizons:true});
    const batch=received.at(-1);expect(batch.kind).toBe('repair');expect(batch.results).toHaveLength(2);
    const reference=new RockFormationField(1024,512,states,source);
    for(const result of batch.results){
      expect(result.cacheHit).toBe(true);const expected=reference.build(result.cx,0);
      expect(Buffer.from(result.data).equals(Buffer.from(expected.data))).toBe(true);
      expect(Buffer.from(result.occlusion).equals(Buffer.from(expected.occlusion))).toBe(true);
    }
  } finally {vi.unstubAllGlobals();}
},30000);

describe('continuous visual rock formation height',()=>{
  it('makes a wide formation higher inside, and an isolated rock lower without a fixed flat cap',()=>{
    const cells:[number,number][]=[];
    for(let y=2;y<9;y++)for(let x=2;x<9;x++)cells.push([x,y]);
    cells.push([12,5]);
    const {field}=fixture(cells),built=field.build(0,0);
    const centre=height(built.heights,176,176),edge=height(built.heights,66,176),single=height(built.heights,400,176);
    expect(centre).toBeGreaterThan(single);expect(single).toBeGreaterThan(edge);expect(edge).toBeGreaterThan(0);
    expect(height(built.heights,396,174)).not.toBeCloseTo(height(built.heights,388,174));
    expect(built.heights.every(Number.isFinite)).toBe(true);
  });
  it('uses the same height for surface normals and a shadow horizon on neighbouring bare ground',()=>{
    const {field}=fixture([[3,3],[4,3],[3,4],[4,4]]),{data,heights}=field.build(0,0);
    let groundShadow=0,lightFacing=0,awayFacing=0;
    for(let i=0;i<heights.length;i++) {
      if(data[i*4+3]===0 && data[i*4+2]>0)groundShadow++;
      if(data[i*4+3]>0 && data[i*4]<110)lightFacing++;
      if(data[i*4+3]>0 && data[i*4]>145)awayFacing++;
    }
    expect(groundShadow).toBeGreaterThan(0);expect(lightFacing).toBeGreaterThan(0);expect(awayFacing).toBeGreaterThan(0);
  });
  it('keeps shared chunk samples identical and is deterministic',()=>{
    const cells:[number,number][]=[],holes:[number,number][]=[];
    for(let y=6;y<12;y++)for(let x=12;x<21;x++)cells.push([x,y]);
    for(let y=238;y<242;y++)for(let x=510;x<514;x++)holes.push([x,y]);
    const detail=Float32Array.from({length:256*256},(_,i)=>Math.sin(i%256*.1)*Math.cos(Math.floor(i/256)*.1));
    const {field}=fixture(cells,detail,holes),a=field.build(0,0),b=field.build(1,0);
    let mismatches=0;
    for(let y=0;y<FORMATION_SIDE;y++)for(let x=0;x<2;x++)for(let c=0;c<4;c++) {
      if(a.data[(y*FORMATION_SIDE+FORMATION_SIDE-2+x)*4+c]!==b.data[(y*FORMATION_SIDE+x)*4+c])mismatches++;
    }
    expect(mismatches).toBe(0);expect(field.build(0,0).data).toEqual(a.data);
    for(let y=0;y<FORMATION_SIDE;y++)for(let x=0;x<2;x++)for(let c=0;c<4;c++) {
      expect(a.occlusion[(y*FORMATION_SIDE+FORMATION_SIDE-2+x)*4+c]).toBe(b.occlusion[(y*FORMATION_SIDE+x)*4+c]);
    }
  });
  it('removes destroyed terrain, excludes built walls, and ignores non-geometric updates',()=>{
    const {field,states}=fixture([[3,3],[8,8]]);
    expect(field.coverage(100,100)).toBe(1);
    expect(field.invalidate([0])).toEqual([]);
    states[0].active=false;expect(field.invalidate([0])).toHaveLength(1);
    states[1].material='walls';field.invalidate([1]);
    expect(field.coverage(100,100)).toBe(0);expect(field.coverage(260,260)).toBe(0);
    const result=field.build(0,0);expect(result.heights.every(h=>h===0)).toBe(true);
    expect(result.data.filter((_,i)=>i%4===2).every(v=>v===0)).toBe(true);
    expect(result.occlusion.filter((_,i)=>i%4===0).every(v=>v===255)).toBe(true);
    expect(result.occlusion.filter((_,i)=>i%4===3).every(v=>v===255)).toBe(true);
  });
  it('occludes nearby ground without a fixed dark outline or affecting distant empty space',()=>{
    const {field}=fixture([[3,3],[4,3],[3,4],[4,4]]),{occlusion}=field.build(0,0);
    const sky=(x:number,y:number)=>occlusion[((Math.floor(y/2)+1)*FORMATION_SIDE+Math.floor(x/2)+1)*4];
    expect(sky(162,128)).toBeLessThan(sky(200,128));
    expect(sky(230,128)).toBe(255);
    const contact=(x:number,y:number)=>occlusion[((Math.floor(y/2)+1)*FORMATION_SIDE+Math.floor(x/2)+1)*4+3];
    const falling=[contact(160,128),contact(164,128),contact(168,128),contact(176,128),contact(200,128)];
    expect(falling[0]).toBeLessThan(falling[1]);
    expect(falling[1]).toBeLessThan(falling[2]);
    expect(falling[2]).toBeLessThan(falling[3]);
    expect(falling[4]).toBe(255);
    // The occupied seam between two cells is an upper face, not a ground foot.
    expect(contact(128,128)).toBeGreaterThan(contact(160,128));
  });
  it('repairs geometric pinholes while preserving visible alpha, open cracks and medium cavities',()=>{
    const cells:[number,number][]=[],holes:[number,number][]=[];
    for(let y=2;y<9;y++)for(let x=2;x<9;x++)cells.push([x,y]);
    for(let y=174;y<178;y++)for(let x=174;x<178;x++)holes.push([x,y]);
    for(let y=172;y<192;y++)for(let x=210;x<230;x++)holes.push([x,y]);
    for(let y=64;y<190;y++)for(let x=140;x<142;x++)holes.push([x,y]);
    const {field}=fixture(cells,undefined,holes),built=field.build(0,0);
    expect(field.coverage(176,176)).toBe(0);
    expect(built.data[((176/2+1)*FORMATION_SIDE+176/2+1)*4+3]).toBe(0);
    expect(height(built.heights,176,176)).toBeGreaterThan(0);
    expect(height(built.heights,220,182)).toBe(0);
    expect(height(built.heights,140,176)).toBe(0);
    // The cached cell sampling must preserve the conservative displayed alpha,
    // including authored pinholes and every chunk gutter sample.
    let alphaMismatches=0;
    for(let y=0;y<FORMATION_SIDE;y++)for(let x=0;x<FORMATION_SIDE;x++) {
      const wx=(x-1)*2,wy=(y-1)*2;
      const expected=Math.round(255*Math.max(field.coverage(wx+.5,wy+.5),field.coverage(wx+1.5,wy+.5),
        field.coverage(wx+.5,wy+1.5),field.coverage(wx+1.5,wy+1.5)));
      if(built.data[(y*FORMATION_SIDE+x)*4+3]!==expected)alphaMismatches++;
    }
    expect(alphaMismatches).toBe(0);
  });
  it('prefilters sub-sample relief while retaining extended grooves and medium cavities',()=>{
    const cells:[number,number][]=[];
    for(let y=2;y<9;y++)for(let x=2;x<15;x++)cells.push([x,y]);
    const detail=new Float32Array(256*256);
    detail[175*256+175]=-16;
    for(let y=160;y<192;y++)for(let x=208;x<232;x++)detail[y*256+x]=-16;
    for(let y=110;y<230;y++)for(let x=140;x<146;x++)detail[y*256+x]=-16;
    // Same impulse translated to the wrapped part of the periodic filter.
    detail[175*256+1]=-16;
    const plain=fixture(cells).field.build(0,0),relief=fixture(cells,detail).field.build(0,0);
    const tiny=height(plain.heights,174,174)-height(relief.heights,174,174);
    const broad=height(plain.heights,218,174)-height(relief.heights,218,174);
    const groove=height(plain.heights,142,174)-height(relief.heights,142,174);
    const seam=height(plain.heights,256,174)-height(relief.heights,256,174);
    expect(tiny).toBeGreaterThan(0);
    expect(broad).toBeGreaterThan(tiny*2);
    expect(groove).toBeGreaterThan(tiny*2);
    expect(seam).toBeCloseTo(tiny, 4);
  });
  it('keeps microrelief in normals without treating it as a nearby solar blocker',()=>{
    const cells:[number,number][]=[];
    for(let y=2;y<12;y++)for(let x=2;x<12;x++)cells.push([x,y]);
    const nearDetail=new Float32Array(256*256),farDetail=new Float32Array(256*256);
    for(let y=172;y<174;y++)for(let x=172;x<174;x++)nearDetail[y*256+x]=16;
    for(let y=162;y<168;y++)for(let x=162;x<168;x++)farDetail[y*256+x]=16;
    const plain=fixture(cells).field.build(0,0),near=fixture(cells,nearDetail).field.build(0,0),far=fixture(cells,farDetail).field.build(0,0);
    const p=((174/2+1)*FORMATION_SIDE+174/2+1)*4;
    expect(near.data[p]).not.toBe(plain.data[p]);
    expect(near.data[p+2]).toBeLessThanOrEqual(plain.data[p+2]);
    expect(far.data[p+2]).toBeGreaterThan(near.data[p+2]);
    expect(near.occlusion[p]).toBeLessThan(plain.occlusion[p]);
  });
});

it('keeps the geometric shoulder monotone, bounded and its ambient foot compact',async()=>{
  const {rockRimHeight,rockContactVisibility}=await import('../src/arena/rocks/RockRimGeometry');
  for(const width of [4,9,18])for(const height of [0,12,24])for(const lip of [.5,2,4]){
    const rim={rockRimWidth:width,rockRimHeight:height,rockRimLip:lip};let previous=0;
    for(let d=-2;d<=width+2;d+=.125){const h=rockRimHeight(d,rim);expect(h).toBeGreaterThanOrEqual(previous-1e-10);expect(h).toBeLessThanOrEqual(height+1e-10);previous=h;}
    expect(rockRimHeight(0,rim)).toBe(0);expect(rockRimHeight(width,rim)).toBeCloseTo(height,10);
  }
  let previous=0;
  for(let d=0;d<=30;d+=.5){const v=rockContactVisibility(d);expect(v).toBeGreaterThanOrEqual(previous);expect(v).toBeLessThanOrEqual(1);previous=v;}
  expect(rockContactVisibility(0)).toBe(0);expect(rockContactVisibility(10)).toBe(1);
});
it('raises geometric relief without changing coverage, then restores the exact baseline',()=>{
  const {field,states}=fixture([[3,3],[4,3],[3,4],[4,4]]);
  const base=field.build(0,0),rim={rockRimWidth:9,rockRimHeight:12,rockRimLip:2};
  field.setRimGeometry(rim);const raised=field.build(0,0);let strongerHorizon=0;
  for(let i=0;i<raised.heights.length;i++){
    expect(raised.data[i*4+3]).toBe(base.data[i*4+3]);
    expect(raised.heights[i]).toBeGreaterThanOrEqual(base.heights[i]);
    expect(raised.heights[i]-base.heights[i]).toBeLessThanOrEqual(rim.rockRimHeight+.0001);
    if(!raised.data[i*4+3]&&raised.data[i*4+2]>base.data[i*4+2])strongerHorizon++;
  }
  expect(strongerHorizon).toBeGreaterThan(0);
  const contact=(x:number)=>raised.occlusion[((128/2+1)*FORMATION_SIDE+Math.floor(x/2)+1)*4+3];
  expect(contact(160)).toBeLessThan(contact(164));expect(contact(164)).toBeLessThan(contact(168));expect(contact(172)).toBe(255);
  field.setRimGeometry(null);expect(field.build(0,0)).toEqual(base);
  field.setRimGeometry(rim);states[0].active=false;field.invalidate([0]);const destroyed=field.build(0,0);
  expect(height(destroyed.heights,110,110)).toBe(0);expect(field.coverage(110,110)).toBe(0);
  expect(height(destroyed.heights,134,110)).toBeLessThan(height(raised.heights,134,110));
},30000); // Multiple full-resolution field rebuilds; preserve gutter/horizon coverage in parallel suites.
it('keeps rim normals, contact and horizon bytes identical in adjacent chunk gutters',()=>{
  const cells:[number,number][]=[];for(let y=6;y<12;y++)for(let x=12;x<21;x++)cells.push([x,y]);
  const {field}=fixture(cells);field.setRimGeometry({rockRimWidth:11,rockRimHeight:14,rockRimLip:3});
  const a=field.build(0,0),b=field.build(1,0);let differences=0;
  for(let y=0;y<FORMATION_SIDE;y++)for(let x=0;x<2;x++)for(let c=0;c<4;c++){
    const i=(y*FORMATION_SIDE+FORMATION_SIDE-2+x)*4+c,j=(y*FORMATION_SIDE+x)*4+c;
    if(a.data[i]!==b.data[j]||a.occlusion[i]!==b.occlusion[j])differences++;
  }
  expect(differences).toBe(0);
});

it('rotates only solar horizons while retaining normals, coverage, height and ambient cavities',()=>{
  const {field}=fixture([[5,5],[6,5],[5,6],[6,6]]),east=field.build(0,0,0),west=field.build(0,0,180);
  expect(east.heights).toEqual(west.heights);
  let eastX=0,eastWeight=0,westX=0,westWeight=0;
  for(let i=0;i<east.data.length;i+=4){
    expect(east.data[i]).toBe(west.data[i]);expect(east.data[i+1]).toBe(west.data[i+1]);expect(east.data[i+3]).toBe(west.data[i+3]);
    expect(east.occlusion[i]).toBe(west.occlusion[i]);expect(east.occlusion[i+3]).toBe(west.occlusion[i+3]);
    if(!east.data[i+3]){const x=(i/4)%FORMATION_SIDE;eastX+=x*east.data[i+2];eastWeight+=east.data[i+2];westX+=x*west.data[i+2];westWeight+=west.data[i+2];}
  }
  expect(eastWeight).toBeGreaterThan(0);expect(westWeight).toBeGreaterThan(0);expect(eastX/eastWeight).toBeLessThan(westX/westWeight);
  expect(field.build(0,0).data).toEqual(field.build(0,0,135).data);
},30000); // Multiple full-resolution field rebuilds; preserve gutter/horizon coverage in parallel suites.
