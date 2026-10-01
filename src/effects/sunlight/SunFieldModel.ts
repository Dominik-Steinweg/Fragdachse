import type { SunCloudState } from './cloudShadow';
import type { SunTuning } from './SunTuning';

// CPU counterparts of the continuous shader fields, for semantic verification.
const fract=(n:number):number=>n-Math.floor(n);
const mix=(a:number,b:number,t:number):number=>a+(b-a)*t;
const smooth=(a:number,b:number,n:number):number=>{const t=Math.max(0,Math.min(1,(n-a)/(b-a)));return t*t*(3-2*t);};
const cloudHash=(x:number,y:number):number=>{
  x=fract(x*.1031);y=fract(y*.11369);const d=x*(y+19.19)+y*(x+19.19);x+=d;y+=d;
  return fract((x+y)*x);
};
function noise(x:number,y:number,hash:(x:number,y:number)=>number):number {
  const ix=Math.floor(x),iy=Math.floor(y),fx=fract(x),fy=fract(y),u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  return mix(mix(hash(ix,iy),hash(ix+1,iy),u),mix(hash(ix,iy+1),hash(ix+1,iy+1),u),v);
}
export function cloudTimeSeconds(time:number):number {return Number.isFinite(time)?Math.max(0,Math.min(1e7,time)):0;}
export function fogDetailNoise(x:number,y:number):number {return noise(x,y,cloudHash);}
export function fogDetailHash(x:number,y:number):number {return cloudHash(x,y);}
export function cloudTravel(time:number,speed:number,gust:number):number {
  return speed*(time+gust*(.65*Math.sin(time*.071)/.071+.35*Math.sin(time*.113)/.113));
}
export function cloudShadowAt(x:number,y:number,state:SunCloudState,time=state.timeSec):number {
  const t=state.tuning;
  if(!Number.isFinite(x+y)||!Number.isFinite(state.strength)||state.strength<=0||t.cloudCover<=0)return 1;
  if(t.cloudCover>=1)return 0;
  const seconds=cloudTimeSeconds(time),travel=cloudTravel(seconds,t.cloudSpeed,t.cloudGust),scale=Math.max(500,t.cloudScale);
  let px=(x-travel)/scale,py=(y-travel*.23)/scale;
  const sx=seconds*.009*t.cloudEvolution,sy=-seconds*.006*t.cloudEvolution;
  const wx=noise(px*.67+sx+3.1,py*.67+sy+3.1,cloudHash)-.5;
  const wy=noise(px*.67-sx*.71+19.7,py*.67-sy*.71+19.7,cloudHash)-.5;
  px+=wx*t.cloudWarp;py+=wy*t.cloudWarp;
  const field=.62*noise(px,py,cloudHash)+.27*noise(px*2.03+17.3+sx*1.7,py*2.03+39.1+sy*1.7,cloudHash)
    +.11*noise(px*4.11+7.7-sx*2.3,py*4.11+7.7-sy*2.3,cloudHash);
  const threshold=mix(.32,.68,t.cloudCover);let opening=smooth(threshold-t.cloudSoftness,threshold+t.cloudSoftness,field);
  const spot=smooth(.40,.78,noise(px*(scale/Math.max(80,t.cloudSpotScale))+wx*.8+53.2,py*(scale/Math.max(80,t.cloudSpotScale))+wy*.8+17.8,cloudHash));
  opening=Math.max(0,Math.min(1,opening+t.cloudSpotAmount*(spot-.40)*4*opening*(1-opening)));
  const result=mix(1,opening,smooth(0,.12,t.cloudCover))*(1-smooth(.88,1,t.cloudCover));
  return Number.isFinite(result)?result:1;
}
export function cloudSmallOpeningAt(x:number,y:number,state:SunCloudState,canopy=1):number {
  const t=state.tuning;
  if(!Number.isFinite(x+y)||!Number.isFinite(state.strength)||state.strength<=0||t.cloudCover<=0)return 0;
  if(t.cloudCover>=1)return 0;
  const seconds=cloudTimeSeconds(state.timeSec),travel=cloudTravel(seconds,t.cloudSpeed,t.cloudGust),scale=Math.max(500,t.cloudScale);
  let px=(x-travel)/scale,py=(y-travel*.23)/scale;
  const sx=seconds*.009*t.cloudEvolution,sy=-seconds*.006*t.cloudEvolution;
  const wx=noise(px*.67+sx+3.1,py*.67+sy+3.1,cloudHash)-.5;
  const wy=noise(px*.67-sx*.71+19.7,py*.67-sy*.71+19.7,cloudHash)-.5;
  px+=wx*t.cloudWarp;py+=wy*t.cloudWarp;
  const field=.62*noise(px,py,cloudHash)+.27*noise(px*2.03+17.3+sx*1.7,py*2.03+39.1+sy*1.7,cloudHash)
    +.11*noise(px*4.11+7.7-sx*2.3,py*4.11+7.7-sy*2.3,cloudHash);
  const threshold=mix(.32,.68,t.cloudCover);let opening=smooth(threshold-t.cloudSoftness,threshold+t.cloudSoftness,field);
  const spot=smooth(.54,.78,noise(px*(scale/Math.max(80,t.cloudSpotScale))+wx*.8+53.2,py*(scale/Math.max(80,t.cloudSpotScale))+wy*.8+17.8,cloudHash));
  return spot*(.65+.35*smooth(.10,.60,opening))*Math.max(0,Math.min(1,canopy));
}
/** Same opening-to-light transfer as CLOUD_SHADOW_GLSL. */
export function sunlightAt(x:number,y:number,state:SunCloudState):number {
  return mix(.5,cloudShadowAt(x,y,state),Math.max(0,Math.min(1,state.tuning.cloudDensity*2)));
}

/** CPU counterpart of FOG_BANK_GLSL. Spatial coverage is independent of density,
 * material opacity, water amplification and the sun; darkness is gated by the receiver. */
export function fogBankAt(x:number,y:number,state:SunCloudState,time=state.timeSec):number {
  if(!Number.isFinite(x+y))return 0;
  const t=state.tuning;
  if(t.fogCover<=0)return 0;if(t.fogCover>=1)return 1;
  const seconds=cloudTimeSeconds(time),travel=cloudTravel(seconds,t.cloudSpeed,t.cloudGust)*.18;
  const qx=x-travel,qy=y-travel*.23,wx=1/Math.hypot(1,.23),wy=.23*wx;
  const px=(qx*wx+qy*wy)/(t.fogBankScale*1.3),py=(-qx*wy+qy*wx)/(t.fogBankScale*.65);
  const ex=seconds*.0017,ey=-seconds*.0011;
  const ax=noise(px*.71+3.1+ex,py*.71+3.1+ey,cloudHash)-.5;
  const ay=noise(px*.71+17.3-ex,py*.71+17.3-ey,cloudHash)-.5;
  const n=.85*noise(px+ax*.6,py+ay*.6,cloudHash)+.15*noise(px*2.17+ax+23.9+ex,py*2.17+ay+23.9+ey,cloudHash)
    +(noise(qx/95+ax,qy/95+ay,cloudHash)-.5)*.035;
  const threshold=mix(.80,.20,t.fogCover),width=t.fogBankEdge/t.fogBankScale*.65;
  const result=smooth(threshold-width*.5,threshold+width*.5,n);
  return Number.isFinite(result)?result:0;
}

export function fogBankShape(bank:number,layered:number,t:SunTuning):number {
  return t.fogClearHaze+t.fogBankCore*bank*(.80+.45*layered);
}
