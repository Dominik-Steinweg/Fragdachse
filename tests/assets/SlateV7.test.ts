import {expect,it} from 'vitest';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {slateV7Geometry,slateV7WeatheredGeometry} from '../../scripts/lib/slate-v7-geometry.mjs';
import {ROCK_BASE_FRAME_SIZE as CELL,ROCK_BASE_PHASE_CELLS as N,ROCK_BASE_PHASES as PHASES,
  ROCK_BASE_FRAME_MARGIN as MARGIN,ROCK_BASE_AUTOTILE_SLOTS as SLOTS} from '../../src/arena/RockBaseConfig';

it('keeps V7 material coverage, phase coordinates and extruded frame borders compatible with the shared renderer',async()=>{
  const directory='public/assets/environment/woodland/rock';
  const meta=JSON.parse(await readFile(`${directory}/mineral.json`,'utf8'));
  const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
  expect(hash(await readFile(meta.source))).toBe(meta.sourceSha256);
  expect(hash(await readFile(meta.coverageSource))).toBe(meta.coverageSha256);
  for(const asset of meta.assets){
    const bytes=await readFile(`${directory}/${asset.file}`);
    expect(hash(bytes)).toBe(asset.sha256);
    expect(await sharp(bytes).metadata()).toMatchObject({width:asset.width,height:asset.height,hasAlpha:true});
  }
  const [baseline,colour]=await Promise.all([meta.coverageSource,`${directory}/mineral-colour.png`]
    .map(path=>sharp(path).ensureAlpha().raw().toBuffer()));
  expect(colour.length).toBe(baseline.length);
  let coverageErrors=0,extrusionErrors=0,phaseErrors=0;
  for(let i=3;i<colour.length;i+=4)coverageErrors+=Number(colour[i]!==baseline[i]);
  const pitch=CELL+MARGIN*2,width=PHASES*pitch;
  for(let slot=0;slot<SLOTS;slot++)for(let phase=0;phase<PHASES;phase++){
    for(let y=-MARGIN;y<CELL+MARGIN;y++)for(let x=-MARGIN;x<CELL+MARGIN;x++){
      const p=((slot*pitch+MARGIN+y)*width+phase*pitch+MARGIN+x)*4;
      const q=((slot*pitch+MARGIN+Math.max(0,Math.min(CELL-1,y)))*width+phase*pitch+MARGIN+Math.max(0,Math.min(CELL-1,x)))*4;
      if(x<0||y<0||x>=CELL||y>=CELL)for(let c=0;c<4;c++)extrusionErrors+=Number(colour[p+c]!==colour[q+c]);
      const first=((MARGIN+y)*width+phase*pitch+MARGIN+x)*4;
      for(let c=0;c<3;c++)phaseErrors+=Number(colour[p+c]!==colour[first+c]);
    }
  }
  expect(coverageErrors).toBe(0);expect(extrusionErrors).toBe(0);expect(phaseErrors).toBe(0);
  expect(meta.period).toBe(CELL*N);
});

it('adds high-density mineral grain without changing normalized frames or any coverage pixel',async()=>{
  const directory='public/assets/environment/woodland/rock';
  const [low,high]=await Promise.all(['mineral-colour','mineral-colour-2x'].map(name=>
    sharp(`${directory}/${name}.png`).raw().toBuffer({resolveWithObject:true})));
  expect(high.info.width).toBe(low.info.width*2);expect(high.info.height).toBe(low.info.height*2);
  let coverageErrors=0,edgeErrors=0;
  for(let y=0;y<high.info.height;y++)for(let x=0;x<high.info.width;x++){
    const highAlpha=high.data[(y*high.info.width+x)*4+3];
    const lowAlpha=low.data[(Math.floor(y/2)*low.info.width+Math.floor(x/2))*4+3];
    coverageErrors+=Number(highAlpha!==lowAlpha);
  }
  const size=CELL*2,margin=MARGIN*2,pitch=size+2*margin,width=high.info.width;
  for(let slot=0;slot<SLOTS;slot++)for(let phase=0;phase<PHASES;phase++){
    for(let y=-margin;y<size+margin;y++)for(let x=-margin;x<size+margin;x++){
      if(x>=0&&y>=0&&x<size&&y<size)continue;
      const p=((slot*pitch+margin+y)*width+phase*pitch+margin+x)*4;
      const q=((slot*pitch+margin+Math.max(0,Math.min(size-1,y)))*width+phase*pitch+margin+Math.max(0,Math.min(size-1,x)))*4;
      for(let c=0;c<4;c++)edgeErrors+=Number(high.data[p+c]!==high.data[q+c]);
    }
  }
  expect(coverageErrors).toBe(0);expect(edgeErrors).toBe(0);
});

it('reproduces the encoded V7 height independently of pigment with deterministic wrapping',async()=>{
  const directory='public/assets/environment/woodland/rock';
  const meta=JSON.parse(await readFile(`${directory}/mineral.json`,'utf8'));
  expect(meta.heightFromAlbedo).toBe(false);
  expect(createHash('sha256').update((await readFile(meta.geometrySource,'utf8')).replace(/\r\n/g,'\n')).digest('hex')).toBe(meta.geometrySha256);
  const geometry=meta.variant==='weathered'?slateV7WeatheredGeometry(meta.heightPeriod,meta.seed,meta.geometryScale,meta.geometryChips):slateV7Geometry(meta.heightPeriod,meta.seed,meta.variant);
  const {data,info}=await sharp(`${directory}/mineral-height.png`).raw().toBuffer({resolveWithObject:true});
  let invalid=0,mismatch=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const p=(y%meta.heightPeriod)*meta.heightPeriod+x%meta.heightPeriod,i=(y*info.width+x)*4,z=geometry.field[p];
    invalid+=Number(!Number.isFinite(z)||z< -32||z>32);
    mismatch+=Number(data[i]*256+data[i+1]!==Math.round((z+32)/64*65535)||data[i+3]!==255);
  }
  expect(invalid).toBe(0);expect(mismatch).toBe(0);
  const repeat=meta.variant==='weathered'?slateV7WeatheredGeometry(meta.heightPeriod,meta.seed,meta.geometryScale,meta.geometryChips):slateV7Geometry(meta.heightPeriod,meta.seed,meta.variant);
  expect(repeat.field).toEqual(geometry.field);
},30000); // Full PNG/data-channel validation shares CPUs with all other asset decoders.
