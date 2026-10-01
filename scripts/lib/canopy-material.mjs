/** Canonical offline crown material bake. No review, candidate or V8 dependencies. */
const S=512,C=S*S,PI=Math.PI;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{let t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const lin=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const q=v=>Math.round(clamp(v)*255);
function box(src,r){
 const temp=new Float32Array(C),out=new Float32Array(C),n=2*r+1;
 for(let y=0;y<S;y++){let v=0;for(let k=-r;k<=r;k++)v+=src[y*S+clamp(k,0,S-1)];
  for(let x=0;x<S;x++){temp[y*S+x]=v/n;v+=src[y*S+clamp(x+r+1,0,S-1)]-src[y*S+clamp(x-r,0,S-1)];}}
 for(let x=0;x<S;x++){let v=0;for(let k=-r;k<=r;k++)v+=temp[clamp(k,0,S-1)*S+x];
  for(let y=0;y<S;y++){out[y*S+x]=v/n;v+=temp[clamp(y+r+1,0,S-1)*S+x]-temp[clamp(y-r,0,S-1)*S+x];}}
 return out;
}
// Three-box Gaussian approximation: actual sigma = sqrt(r*(r+1)).
function blur(src,sigma){if(sigma<=0)return new Float32Array(src);const r=Math.max(1,Math.round(sigma-.5));return box(box(box(src,r),r),r);}
function edt1(f){
 const n=f.length,v=new Int32Array(n),z=new Float64Array(n+1),out=new Float32Array(n);let k=0;z[0]=-Infinity;z[1]=Infinity;
 for(let j=1;j<n;j++){let t;do{t=((f[j]+j*j)-(f[v[k]]+v[k]*v[k]))/(2*j-2*v[k]);if(t>z[k])break;k--;}while(k>=0);k++;v[k]=j;z[k]=t;z[k+1]=Infinity;}
 k=0;for(let j=0;j<n;j++){while(z[k+1]<j)k++;out[j]=(j-v[k])**2+f[v[k]];}return out;
}
function distance(mask){
 const t=new Float32Array(C),out=new Float32Array(C),f=new Float64Array(S);
 for(let y=0;y<S;y++){for(let x=0;x<S;x++)f[x]=mask[y*S+x]?1e8:0;t.set(edt1(f),y*S);}
 for(let x=0;x<S;x++){for(let y=0;y<S;y++)f[y]=t[y*S+x];const d=edt1(f);for(let y=0;y<S;y++)out[y*S+x]=Math.sqrt(d[y]);}return out;
}
const lum=(d,i)=>.2126*lin(d[i*4]/255)+.7152*lin(d[i*4+1]/255)+.0722*lin(d[i*4+2]/255);
function filtered(logWeighted,alpha,sigma){
 const n=blur(logWeighted,sigma),d=blur(alpha,sigma);for(let i=0;i<C;i++)n[i]/=Math.max(.001,d[i]);return n;
}
function derive(data,P){
 const alpha=Float32Array.from({length:C},(_,i)=>data[4*i+3]/255);
 const mask=Uint8Array.from(blur(alpha,5),v=>v>.45?1:0),dist=blur(distance(mask),16);
 let maxD=0;for(const d of dist)maxD=Math.max(maxD,d);
 const weighted=Float32Array.from({length:C},(_,i)=>Math.log(Math.max(.004,lum(data,i)))*alpha[i]);
 const large=filtered(weighted,alpha,P.massSigma),base=filtered(weighted,alpha,P.broadSigma),group=filtered(weighted,alpha,P.groupSigma),groupBase=filtered(weighted,alpha,P.groupBroad);
 const height=new Float32Array(C),ao=new Float32Array(C),thickness=new Float32Array(C);
 for(let i=0;i<C;i++){
  const d=clamp(dist[i]/maxD),big=clamp(large[i]-base[i],-.8,.8),small=clamp(group[i]-groupBase[i],-.6,.6),edge=smooth(0,18,dist[i]);
  height[i]=alpha[i]>.03?Math.max(0,P.dome*Math.sqrt(Math.max(0,2*d-d*d))+(P.mass*big+P.group*small)*edge):0;
  ao[i]=clamp((1-P.core*d**.65)*Math.exp(P.cavity*Math.min(0,small+.5*big)),.42,1);
  thickness[i]=clamp(smooth(0,70,dist[i])*(.8+.2*ao[i]));
 }
 const h=blur(height,2),dataMap=Buffer.alloc(C*4),heightImage=Buffer.alloc(C*4);
 const at=(x,y)=>h[clamp(y,0,S-1)*S+clamp(x,0,S-1)];
 for(let y=0;y<S;y++)for(let x=0;x<S;x++){
  const i=y*S+x,nx=-(at(x+1,y)-at(x-1,y))/2,ny=-(at(x,y+1)-at(x,y-1))/2,z=1/Math.hypot(nx,ny,1);
  dataMap[4*i]=q(nx*z*.5+.5);dataMap[4*i+1]=q(ny*z*.5+.5);dataMap[4*i+2]=q(ao[i]);dataMap[4*i+3]=q(thickness[i]);
  heightImage[4*i]=heightImage[4*i+1]=heightImage[4*i+2]=q(h[i]/256);heightImage[4*i+3]=data[4*i+3];
 }
 return {height:h,dataMap,heightImage};
}
function sample(h,x,y,size=S){
 if(x<0||y<0||x>=size-1||y>=size-1)return 0;
 const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;
 return h[iy*size+ix]*(1-tx)*(1-ty)+h[iy*size+ix+1]*tx*(1-ty)+h[(iy+1)*size+ix]*(1-tx)*ty+h[(iy+1)*size+ix+1]*tx*ty;
}
// Offline horizon bake, reaching across the ENTIRE crown. Runtime never marches.
// Grid spacing 4px is finer than the smallest retained height group (sigma>=8).
function bakeHorizon(height){
 const H=128,coarse=Array.from({length:8},()=>new Float32Array(H*H));
 for(let dir=0;dir<8;dir++){
  const a=dir*PI/4,dx=Math.sin(a),dy=-Math.cos(a);
  for(let gy=0;gy<H;gy++)for(let gx=0;gx<H;gx++){
   const x=(gx+.5)*4-.5,y=(gy+.5)*4-.5,h=sample(height,x,y);let slope=0;
   for(let t=4;t<=512;t+=t<128?4:8){
    const xx=x+dx*t,yy=y+dy*t;if(xx<0||yy<0||xx>=511||yy>=511)break;
    slope=Math.max(slope,(sample(height,xx,yy)-h)/t);
   }
   coarse[dir][gy*H+gx]=Math.atan(slope)/(PI/2);
  }
 }
 const maps=[Buffer.alloc(C*4),Buffer.alloc(C*4)];
 for(let y=0;y<S;y++)for(let x=0;x<S;x++){
  const xx=clamp((x+.5)/4-.5,0,H-1.001),yy=clamp((y+.5)/4-.5,0,H-1.001);
  for(let dir=0;dir<8;dir++)maps[Math.floor(dir/4)][(y*S+x)*4+dir%4]=q(sample(coarse[dir],xx,yy,H));
 }
 return maps;
}

export function deriveCanopyMaterial(albedo,parameters) {
 const m=derive(albedo,parameters);return {albedo,data:m.dataMap,horizons:bakeHorizon(m.height)};
}
