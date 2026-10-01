import manifest from '../../../public/assets/environment/woodland/canopy/canopy.json';
export const CANOPY_ATLASES=manifest.atlases.map(a=>({...a,key:`woodland-canopy-${a.kind}`}));
export const CANOPY_ASSETS=manifest.assets;
export const CANOPY_FRAMES=Object.fromEntries(CANOPY_ASSETS.map(a=>[String(a.index),{frame:a.frame}]));
const total=CANOPY_ASSETS.reduce((s,a)=>s+a.weight,0);
export function canopyVariant(x:number,y:number):number {
  let seed=Math.imul(Math.round(x),73856093)^Math.imul(Math.round(y),19349663);
  seed=Math.imul(seed^(seed>>>16),2246822507);seed^=seed>>>13;
  let pick=(seed>>>0)/4294967296*total;
  for(let i=0;i<CANOPY_ASSETS.length;i++){pick-=CANOPY_ASSETS[i].weight;if(pick<0)return i;}
  return CANOPY_ASSETS.length-1;
}
