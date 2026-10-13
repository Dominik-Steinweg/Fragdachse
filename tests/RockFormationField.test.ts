import { describe, expect, it, vi } from 'vitest';
import { RockFormationField, FORMATION_SIDE, type FormationRock } from '../src/arena/rocks/RockFormationField';
import { formationSurfaceColour } from '../src/arena/rocks/rockFormationShader';
import { createSunPath, resolveSunPath } from '../src/effects/sunlight/SunPath';
import { SUN_TUNING_DEFAULTS } from '../src/config/sunlight';
import { fixture, height } from './RockFormationFieldTestFixture';
// The costly invariance sweeps live in RockFormationFieldIncremental and RockFormationFieldSolar.

it('keeps the raised lip directional: sun-facing facets stay lit and south-facing lips stay below ground exposure',()=>{
  const cells:[number,number][]=[];for(let y=5;y<10;y++)for(let x=5;x<10;x++)cells.push([x,y]);
  const {field}=fixture(cells);field.setRimGeometry(SUN_TUNING_DEFAULTS);
  const path=createSunPath();
  for(const minute of [480,720,1020]) {
    resolveSunPath(minute,null,path);
    const {data,occlusion}=field.build(0,0,path.horizonAzimuth);
    const colour=(x:number,y:number)=>{
      const p=((Math.floor(y/2)+1)*FORMATION_SIDE+Math.floor(x/2)+1)*4;
      return formationSurfaceColour(data[p]/255*2-1,data[p+1]/255*2-1,data[p+2]/255*Math.PI/2,
        {enabled:true,normals:false,strength:1,sun:path.sun,mineralResponse:true,
          clouds:{tuning:SUN_TUNING_DEFAULTS,timeSec:0,strength:1}},
        [occlusion[p]/255,occlusion[p+1]/255*Math.PI/2,occlusion[p+2]/255*Math.PI/2,occlusion[p+3]/255]);
    };
    for(const y of [315,317,319])expect(Math.max(...colour(240,y))).toBeLessThan(1);
    let lit=0;
    for(let d=1;d<=15;d+=2) {
      const c=minute===480?colour(320-d,240):minute===1020?colour(160+d,240):colour(240,160+d);
      lit=Math.max(lit,...c);
    }
    expect(lit).toBeGreaterThan(1);
  }
},15000);

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
