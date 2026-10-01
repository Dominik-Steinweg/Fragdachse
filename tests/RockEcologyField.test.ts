import {describe,expect,it} from 'vitest';
import {generateRockEcology,ecologyEdges,ROCK_ECOLOGY_DEFAULTS,type EcologyFieldOptions} from '../src/arena/rocks/RockEcologyField';
import {rockCellKey} from '../src/arena/RockOverlayRegions';
import {ROCK_ECOLOGY_ASSETS} from '../src/arena/rocks/RockEcologyAssets';

const rocks=Array.from({length:800},(_,i)=>({gridX:i%40,gridY:Math.floor(i/40),hp:100}));
const options:EcologyFieldOptions={rocks:rocks as never,frame:{offsetX:37,offsetY:-19,width:1280,height:640},seed:12345,
  tuning:ROCK_ECOLOGY_DEFAULTS,moss:[],height:(x,y)=>4*Math.sin(x/11)*Math.cos(y/13)};

describe('rock ecology contours and colonies',()=>{
  it('extracts continuous exterior runs, including concave and convex ends',()=>{
    const edges=ecologyEdges([{gridX:0,gridY:0},{gridX:1,gridY:0},{gridX:0,gridY:1}]);
    expect(edges.reduce((n,e)=>n+e.length,0)).toBe(8*32);
    expect(edges.some(e=>e.startConcave||e.endConcave)).toBe(true);
    expect(edges.some(e=>!e.startConcave&&!e.endConcave)).toBe(true);
    for(const e of edges){expect(Math.hypot(e.nx,e.ny)).toBe(1);expect(e.nx*e.tx+e.ny*e.ty).toBe(0);}
  });
  it('is deterministic regardless of enumeration order; keeps source and all anchors intact',()=>{
    const before=JSON.stringify(options),a=generateRockEcology(options);
    expect(a).toEqual(generateRockEcology({...options,rocks:[...options.rocks].reverse()}));
    expect(JSON.stringify(options)).toBe(before);
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toEqual(generateRockEcology({...options,seed:12346}));
    const anchors=new Set(rocks.map(rockCellKey));
    for(const c of a){
      expect(anchors.has(c.anchorKey)).toBe(true);
      expect([c.worldX,c.worldY,c.lengthPx,c.bandPx,c.rotation,c.alpha].every(Number.isFinite)).toBe(true);
      const asset=ROCK_ECOLOGY_ASSETS.find(a=>a.name===c.frame)!;
      expect(c.bandPx/c.lengthPx).toBeCloseTo(asset.height/asset.width);
      expect(c.frame).not.toBe('crevice-herb-04');
    }
  });
  it('gives small isolated blocks only accents instead of a framing ring',()=>{
    const blocks=[{gridX:60,gridY:5,hp:100},{gridX:70,gridY:5,hp:100},{gridX:71,gridY:5,hp:100},{gridX:70,gridY:6,hp:100}];
    for(let seed=1;seed<40;seed++){
      const all=generateRockEcology({...options,seed,rocks:blocks as never,height:undefined,
        tuning:{rockEdgeFlora:2,rockCreviceFlora:0,rockFootFlora:2}});
      expect(all.filter(c=>c.anchorKey===rockCellKey(blocks[0])).length).toBeLessThanOrEqual(1);
      expect(all.filter(c=>c.anchorKey!==rockCellKey(blocks[0])).length).toBeLessThanOrEqual(2);
    }
  });
  it('leaves real gaps along long edges even at maximum density and bounds complete overhangs',()=>{
    const all=generateRockEcology({...options,tuning:{rockEdgeFlora:2,rockCreviceFlora:0,rockFootFlora:2}});
    const edges=ecologyEdges(options.rocks);
    for(const [run,e] of edges.entries()){
      const colonies=all.filter(c=>c.edgeRun===run);
      expect(colonies.length).toBeGreaterThan(0);
      for(const c of colonies){
        const dx=c.worldX-options.frame.offsetX-e.x,dy=c.worldY-options.frame.offsetY-e.y;
        const reach=(Math.abs(e.nx*Math.cos(c.rotation)+e.ny*Math.sin(c.rotation))*c.lengthPx+
          Math.abs(-e.nx*Math.sin(c.rotation)+e.ny*Math.cos(c.rotation))*c.bandPx)/2;
        expect(dx*e.nx+dy*e.ny+reach).toBeLessThanOrEqual(12.00001);
      }
      const edge=colonies.filter(c=>c.kind!=='foot-cluster').sort((a,b)=>(a.worldX-b.worldX)*e.tx+(a.worldY-b.worldY)*e.ty);
      for(let i=1;i<edge.length;i++){
        const a=edge[i-1],b=edge[i];
        const radius=(c:typeof a)=>(Math.abs(e.tx*Math.cos(c.rotation)+e.ty*Math.sin(c.rotation))*c.lengthPx+
          Math.abs(-e.tx*Math.sin(c.rotation)+e.ty*Math.cos(c.rotation))*c.bandPx)/2;
        expect((b.worldX-a.worldX)*e.tx+(b.worldY-a.worldY)*e.ty-radius(a)-radius(b)).toBeGreaterThan(0);
        expect(a.rotation).not.toBe(b.rotation);
      }
    }
  });
  it('seeds plateau herbs in height cavities, never on flat height; zero tuning disables all colonies',()=>{
    const all=generateRockEcology(options),plateau=all.filter(c=>c.edgeRun===undefined);
    expect(plateau.some(c=>c.kind==='crevice-herb')).toBe(true);
    for(const c of plateau){
      const x=c.worldX-options.frame.offsetX,y=c.worldY-options.frame.offsetY,h=options.height!;
      expect((h(x-7,y)+h(x+7,y)+h(x,y-7)+h(x,y+7))/4-h(x,y)).toBeGreaterThan(0);
    }
    expect(generateRockEcology({...options,height:()=>0}).every(c=>c.edgeRun!==undefined)).toBe(true);
    expect(generateRockEcology({...options,tuning:{rockEdgeFlora:0,rockCreviceFlora:0,rockFootFlora:0}})).toEqual([]);
  });
});
