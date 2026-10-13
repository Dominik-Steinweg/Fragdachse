import { RockFormationField, FORMATION_SIDE, type FormationRock } from '../src/arena/rocks/RockFormationField';
import { CELL_SIZE } from '../src/config';
import { ROCK_BASE_PHASE_CELLS, ROCK_BASE_PHASES, ROCK_BASE_FRAME_MARGIN } from '../src/arena/RockBaseConfig';

/** Shared RockFormationField fixture: a 1024² field over the given rock cells, optional detail and alpha holes. */
export function fixture(cells: [number,number][], detail=new Float32Array(256*256), holes:[number,number][]=[]) {
  const states:FormationRock[]=cells.map(([gridX,gridY],id)=>({id,gridX,gridY,active:true,frame:0}));
  const source={alpha:new Uint8Array(2176*1870).fill(255),detail};
  const pitch=CELL_SIZE+ROCK_BASE_FRAME_MARGIN*2;
  for(const [x,y] of holes) {
    const phase=(Math.floor(y/CELL_SIZE)%ROCK_BASE_PHASE_CELLS)*ROCK_BASE_PHASE_CELLS+Math.floor(x/CELL_SIZE)%ROCK_BASE_PHASE_CELLS;
    source.alpha[(ROCK_BASE_FRAME_MARGIN+y%CELL_SIZE)*ROCK_BASE_PHASES*pitch+phase*pitch+ROCK_BASE_FRAME_MARGIN+x%CELL_SIZE]=0;
  }
  return {states,field:new RockFormationField(1024,1024,states,source)};
}
/** Height sample of a formation chunk at local pixel (x, y). */
export const height=(data:Float32Array,x:number,y:number):number=>data[(Math.floor(y/2)+1)*FORMATION_SIDE+Math.floor(x/2)+1];
