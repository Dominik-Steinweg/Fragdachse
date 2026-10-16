/** Fixed-cost, absolute-age samples; no random emissions or wall clock. */
/** Ink quad around the sector: from just behind the mouth to the farthest flung specks (shader inkSplatter). */
export function krakenInkQuad(range: number, halfAngle: number): { width: number; height: number; shift: number } {
  const reach = range * 1.32 + 16, back = 48, spread = Math.min(Math.PI / 2, halfAngle * 1.55 + .08);
  return { width: reach + back, height: 2 * (reach * Math.sin(spread) + 40), shift: (reach - back) / 2 };
}
/** Stable per-cloud splatter pattern. */
export function krakenInkSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 997 * .37;
}
export const KRAKEN_REVIEW_FX_SHADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uWater;
uniform float uMode;
uniform float uAge;
uniform float uOpacity;
uniform vec3 uCore;
uniform vec3 uEdge;
uniform vec4 uShape;
uniform vec4 uTiming;
uniform vec4 uDetail;
const float PI=3.14159265;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
}
float field(vec2 p) { return noise(p)*.53+noise(p*2.03+17.0)*.28+noise(p*4.1+9.0)*.13+noise(p*8.2)*.06; }
float line(vec2 p,vec2 a,vec2 b) { vec2 v=b-a; return length(p-a-v*clamp(dot(p-a,v)/max(dot(v,v),.001),0.0,1.0)); }
float curve(float x) { return sin(clamp(x/uShape.z,0.0,1.0)*PI*4.0)*uTiming.z; }
void main() {
  vec2 uv=vec2(outTexCoord.x,1.0-outTexCoord.y);
  vec2 p=(uv-.5)*uShape.xy;
  float t=max(0.0,uAge), alpha=0.0;
  vec3 color=vec3(0.0);
  if(uMode<.5) {
    // Ink cloud. uDetail: warp, sheen, per-cloud seed, quad shift to the mouth.
    p.x+=uDetail.w;
    float wet=texture2D(uWater,uv).r;
    float erosion=clamp((t-uTiming.x-uTiming.y)/uTiming.z,0.0,1.0);
    // Dissolving ink keeps moving: on water it spreads, curls and thins out; on land it soaks in and dulls.
    float diffuse=erosion*erosion*(3.0-2.0*erosion);
    float front=min(1.0,t/uTiming.x)*uShape.z;
    vec2 q=vec2(p.x/68.0,p.y/mix(51.0,35.0,wet))+uDetail.z;
    float drift=t*.15+diffuse*mix(.25,.9,wet);
    vec2 flow=vec2(field(q+vec2(-drift*1.2,2)),field(q+vec2(13,drift*.8)));
    vec2 warp=vec2(field(q+flow*3.4),field(q+flow*3.4+27.0))-.5;
    vec2 curled=q+warp*uDetail.x*(2.2+diffuse*mix(.6,2.0,wet));
    float n=field(curled-vec2(drift,0));
    float marble=.5+.5*sin(curled.y*9.0+field(curled*1.5)*15.0);
    float strands=pow(marble,7.0);
    float cloud=0.0, ridges=0.0, swell=1.0+erosion*.12+diffuse*mix(.12,.6,wet);
    for(int i=0;i<13;i++) {
      float k=float(i), along=(k+.6)/14.0*uShape.z;
      float width=max(9.0,along*uShape.w*.85)*mix(1.0,uTiming.w,wet);
      vec2 center=vec2(along,sin(k*4.3+uDetail.z)*width*.24);
      vec2 radii=vec2(uShape.z*(.075+k*.003),width)*swell;
      vec2 local=(p-center)/radii+warp*mix(.95,1.45,wet)*uDetail.x*(1.0+diffuse*.5);
      float d=length(local), lobe=1.0-smoothstep(.35,1.15+diffuse*.35,d);
      cloud=1.0-(1.0-cloud)*(1.0-lobe);
      ridges=max(ridges,exp(-pow((d-.72)/.19,2.0))*(.35+.65*n));
    }
    float tip=1.0-smoothstep(front-8.0,front+12.0,p.x);
    tip=mix(tip,1.0,smoothstep(uTiming.x,uTiming.x+.1,t));
    float mouth=smoothstep(-3.0,6.0,p.x);
    float axis=exp(-pow(p.y/max(5.0,10.0+p.x*.16),2.0));
    // The thick jet along the axis drains first, so the fade never leaves a black line behind.
    float core=axis*(1.0-smoothstep(uShape.z*.75,uShape.z*1.08,p.x))*mouth*(1.0-smoothstep(0.0,.55,erosion));
    float density=max(cloud*(.8+.2*n),core*.99);
    // Erosion eats the thin cloud before the curled filaments; its band widens so the last wisps blur out
    // instead of crumbling, and the remaining ink thins as a whole until it is gone before the end time.
    float resistance=max(density*.8+(.5-n)*.25,strands*cloud*.99);
    float band=.07+.3*diffuse;
    float survive=smoothstep(erosion*.7-band,erosion*.7+band,resistance);
    float thin=1.0-smoothstep(.1,1.0,erosion);
    alpha=density*tip*mouth*survive*thin*mix(1.0,.75,diffuse*wet)*smoothstep(0.0,.025,t);
    float edge=clamp((1.0-density)*1.15+ridges*.46*(1.0-axis*.85),0.0,1.0);
    color=mix(uCore,uEdge,edge);
    // Glossy rims on land go dull as the ink soaks in.
    color+=vec3(.08,.06,.11)*ridges*(1.0-wet)*(1.0-axis*.75)*(1.0-diffuse);
    // Oil sheen follows curled contours instead of lighting the whole pool, and lingers as it spreads thin.
    color+=vec3(.32,.29,.43)*strands*uDetail.y*wet*(1.0-axis*.8)*(1.0+diffuse*.8);
    // Spreading ink turns into a violet haze in the water and into a dull stain on land.
    color=mix(color,uEdge*mix(.9,1.3,n),diffuse*wet*.55);
    color=mix(color,uCore*1.4+vec3(.012,.01,.008),diffuse*(1.0-wet)*.5);
    float drops=0.0;
    for(int i=0;i<18;i++) {
      float k=float(i), seed=hash(vec2(k,8.0+uDetail.z));
      vec2 d=normalize(vec2(1,(seed-.5)*uShape.w*1.65));
      vec2 pos=d*(front+8.0+hash(vec2(k,4))*29.0);
      float size=1.2+hash(vec2(k,5))*2.7;
      drops=max(drops,1.0-smoothstep(size*.55,size+1.0,line(p,pos,pos-d*5.0)));
    }
    drops*=smoothstep(.015,.05,t)*(1.0-smoothstep(uTiming.x*.8,uTiming.x+.09,t));
    alpha=max(alpha,drops*.9);
    // Keep the axis at the authored near-black; cloud highlights belong to its shoulders.
    color=mix(color,uCore,axis*.96*(1.0-diffuse));
  } else if(uMode<1.5) {
    // Only what is thrown above the surface: a soft mist veil and round droplets that rise and fall back.
    // Swell, rings and foam belong to the water surface itself (WaterDisturbanceField).
    float radius=uShape.z, life=uTiming.x;
    float end=1.0-smoothstep(life*.45,life,t);
    float n=field(p*.05+vec2(t*.6,uShape.w*3.0));
    float mistR=radius*(.30+t*.85);
    float mist=exp(-pow(length(p)/mistR,2.0))*smoothstep(.25,.75,n)*(1.0-smoothstep(0.0,life*.7,t));
    float drops=0.0, count=min(uDetail.x,36.0);
    for(int i=0;i<36;i++) {
      float k=float(i);
      if(k>=count) break;
      float seed=k*1.37+uShape.w*91.0;
      float h1=hash(vec2(seed,1.0)), h2=hash(vec2(seed,2.0)), h3=hash(vec2(seed,3.0)), h4=hash(vec2(seed,4.0));
      float age=t-h1*.15, flight=.45+h2*.5;
      if(age<0.0 || age>flight) continue;
      float a=h3*6.2831853, u=age/flight, lift=4.0*u*(1.0-u);
      vec2 pos=vec2(cos(a),sin(a))*(radius*(.12+.3*h2)+uDetail.y*(.15+.5*h4)*age);
      float size=(.9+h2*1.3)*(1.0+lift*.7);
      drops=max(drops,exp(-dot(p-pos,p-pos)/(size*size))*(1.0-smoothstep(.7,1.0,u)));
    }
    alpha=clamp(mist*.26+drops*.55,0.0,.7)*end;
    color=mix(vec3(.52,.70,.72),vec3(.74,.88,.89),clamp(drops,0.0,1.0));
  } else if(uMode>3.5 && uMode<4.5) {
    float radius=uShape.z, r=length(p), theta=atan(p.y,p.x);
    float n=field(p*.05), d=r*(1.0+(n-.5)*.22);
    float diving=uShape.w;
    float active=diving>.5 ? 1.0-smoothstep(uTiming.x*.3,uTiming.x,t) : smoothstep(0.0,max(.05,uTiming.x),t);
    // A dark depression where the body sinks; foam is torn into soft swirling streaks, never clean rings.
    float hollow=exp(-pow(d/(radius*.6),2.0));
    float shadow=diving>.5 ? uTiming.y : .3;
    // Foam, rings and the funnel are part of the water surface now; this layer is the body's shadow
    // under the surface and the soft bubbles that escape it.
    float bubbles=0.0;
    for(int i=0;i<10;i++) {
      float k=float(i), a=hash(vec2(k,2.0))*6.2831853, cycle=fract(t*.8+hash(vec2(k,7.0)));
      vec2 pos=vec2(cos(a),sin(a))*radius*(.08+hash(vec2(k,8.0))*.3);
      float size=(1.2+hash(vec2(k,5.0))*2.0)*sin(cycle*PI);
      bubbles=max(bubbles,exp(-pow((length(p-pos)-size)/.8,2.0))*sin(cycle*PI));
    }
    float light=bubbles*.45*active*uTiming.z;
    alpha=clamp(hollow*(shadow+active*.2)+light,0.0,.75);
    color=mix(vec3(.012,.07,.085),vec3(.6,.8,.82),clamp(light/max(alpha,.001),0.0,1.0));
  } else if(uMode>4.5 && uMode<5.5) {
    float radius=uShape.z, r=length(p), theta=atan(p.y,p.x);
    if(uAge<0.0) {
      // Egg-sized contact shadow that softens and widens as the egg climbs (it is offset towards the sun's far side).
      alpha=exp(-pow(r/(radius*(.4+uTiming.x*.3)),2.0))*(.38-uTiming.x*.16);
      color=vec3(.02,.025,.018);
    } else {
      float n=field(p*.16+uShape.w*5.0);
      float edge=radius*(.7+.18*sin(theta*7.0)+.12*sin(theta*11.0))*(.6+.4*min(1.0,t*9.0));
      float pool=1.0-smoothstep(edge*.6,edge+2.0,r);
      float rim=exp(-pow((r-edge*.78)/1.7,2.0))*n;
      float drops=0.0;
      for(int i=0;i<12;i++) {
        float k=float(i), a=k*2.39996+uShape.w, speed=22.0+hash(vec2(k,3))*45.0;
        vec2 pos=vec2(cos(a),sin(a))*(radius*.3+min(t,.4)*speed);
        drops=max(drops,(1.0-smoothstep(1.0,2.7,length(p-pos)))*(1.0-smoothstep(.3,.65,t)));
      }
      alpha=max(pool*.62+rim*.25,drops*.8);
      // Dark plum brood ichor with a wet violet sheen on its rim, the egg's own palette.
      color=mix(vec3(.05,.015,.06),vec3(.36,.14,.32),clamp(rim+n*.3+drops,0.0,1.0));
    }
  } else if(uMode>10.5) {
    // Spine wake: dark violet ichor bleeding off a homing spine, bent along its turn, widening and tearing
    // into wisps with distance; only a faint sheen right behind the spine. The quad's front edge is the spine.
    float lengthPx=uShape.z, width=uShape.w, behind=uShape.x*.5-p.x-uTiming.x;
    float along=clamp(behind/max(lengthPx,1.0),0.0,1.0);
    float centre=-.5*uTiming.y*behind*behind;
    float dy=abs(p.y-centre);
    vec2 q=vec2(behind*.06-t*2.2,(p.y-centre)*.2)+uTiming.z;
    float n=field(q), m=field(q*2.3+5.0);
    float spread=mix(1.6,width,pow(along,.55))*(.7+.6*n);
    float start=smoothstep(-2.0,4.0,behind), end=1.0-smoothstep(lengthPx*.45,lengthPx,behind);
    float mist=exp(-pow(dy/spread,2.0))*start*end;
    float tear=smoothstep(.25+along*.35,.55+along*.35,n*.7+m*.3);
    float edge=smoothstep(.25,1.0,dy/spread);
    float sheen=exp(-pow(dy/1.3,2.0))*start*(1.0-smoothstep(0.0,22.0,behind));
    alpha=max(mist*mix(.62,.3,along)*mix(1.0,tear,along),sheen*.3);
    color=mix(vec3(.05,.012,.07),vec3(.34,.18,.46),clamp(edge*.8+m*.25,0.0,1.0));
    color=mix(color,vec3(.58,.48,.68),sheen*.45);
  } else if(uMode>9.5) {
    // Soft elongated shore area: filled gradient with no contour or damage colour.
    float n=field(p*.035);
    float footprint=exp(-pow(p.x/92.0,4.0)-pow(p.y/68.0,4.0));
    alpha=footprint*(.07+.07*n);
    color=vec3(.40,.58,.53);
  } else if(uMode>8.5) {
    // Shore-facing wall and two uneven arm contacts; no radial spray distribution.
    float mist=0.0, drops=0.0;
    for(int i=0;i<19;i++) {
      float k=float(i), seed=hash(vec2(k,12)), birth=hash(vec2(k,3))*.12;
      float age=max(0.0,t-birth);
      vec2 center=vec2(-18.0+seed*54.0, (hash(vec2(k,7))-.5)*166.0);
      center+=vec2(-20.0-seed*28.0, (seed-.5)*55.0)*age;
      vec2 radius=vec2(12.0+seed*20.0,9.0+hash(vec2(k,9))*18.0)*(1.0+age*1.2);
      float n=field(p*.065+vec2(k,age*.4));
      float cloud=1.0-smoothstep(.15,1.3,length((p-center)/radius)+(n-.5)*1.1);
      mist=max(mist,cloud*smoothstep(0.0,.06,t-birth)*(1.0-smoothstep(.18,1.1,age)));
    }
    for(int i=0;i<55;i++) {
      float k=float(i), seed=hash(vec2(k,31)), birth=hash(vec2(k,6))*.16;
      float age=max(0.0,t-birth), life=.28+seed*.46;
      vec2 origin=vec2(hash(vec2(k,8))*45.0-8.0,(hash(vec2(k,9))-.5)*150.0);
      vec2 velocity=vec2(-35.0+hash(vec2(k,4))*105.0,(seed-.5)*145.0);
      vec2 pos=origin+velocity*age;
      float size=1.0+hash(vec2(k,5))*2.3;
      float drop=exp(-pow(length((p-pos)/vec2(1.3,1.0))/size,2.0));
      drops=max(drops,drop*step(birth,t)*(1.0-smoothstep(life*.45,life,age)));
    }
    alpha=mist*.62+drops*.65;
    color=mix(vec3(.42,.66,.67),vec3(.76,.88,.86),clamp(mist*.7+drops,0.0,1.0));
  } else if(uMode>7.5) {
    // Slime the kraken leaves on land: a dark violet wet film soaking the ground, glossy strands stretched
    // along its path (x) and sparse glints, drying out from the edges inwards.
    float life=uTiming.x, dry=smoothstep(life*.45,life,t), seed=uDetail.y;
    float n=field(p*.055+seed*13.0), m=field(vec2(p.x*.022,p.y*.12)+seed*7.0);
    float r=length(p/vec2(uShape.z,uShape.w))*(1.0+(n-.5)*.55);
    float film=exp(-r*r*1.7)*(1.0-dry*smoothstep(.0,.9,1.0-exp(-r*r*1.7)+dry*.4));
    float rim=film*(1.0-smoothstep(.12,.55,film));
    float gloss=smoothstep(.58,.92,m)*film;
    float glint=smoothstep(.86,.98,field(p*.24+vec2(seed*3.0,0.0)))*film*(1.0-dry);
    alpha=(film*.40+rim*.10+gloss*.24+glint*.6)*uOpacity;
    color=mix(vec3(.030,.020,.040),vec3(.085,.055,.105),n);
    color=mix(color,vec3(.42,.36,.52),clamp(gloss*.7/max(alpha,.001),0.0,1.0));
    color=mix(color,vec3(.82,.78,.88),clamp(glint*.45/max(alpha,.001),0.0,1.0));
  } else if(uMode>6.5) {
    float n=field(p*.06+vec2(t*.65,0)), swimming=uDetail.x;
    float front=exp(-pow((p.x-95.0)/62.0,2.0)-pow(p.y/74.0,4.0));
    float mound=front*(.45+.55*n);
    float strips=pow(.5+.5*sin(p.x*.12+n*9.0-t*2.0),6.0)*front*smoothstep(.4,.64,n);
    float behind=max(0.0,-p.x), spread=37.0+behind*.24+behind*behind*.0008;
    float fringe=abs(p.y)-spread-(n-.5)*30.0;
    float wake=exp(-pow(fringe/(9.0+behind*.028),2.0))*smoothstep(12.0,65.0,behind)
      *(1.0-smoothstep(140.0,265.0,behind))*smoothstep(.34,.66,n)*swimming;
    alpha=mound*.10+strips*.17+wake*.34;
    color=mix(vec3(.13,.32,.33),vec3(.62,.78,.76),clamp(strips+wake*2.0,0.0,1.0));
  } else if(uMode>5.5) {
    float r=length(p), radius=uShape.z;
    float flash=exp(-pow(r/(radius*(.4+t*2.0)),2.0))*exp(-t*17.0);
    float sparks=0.0;
    for(int i=0;i<14;i++) {
      float k=float(i), a=k*2.39996+uShape.w;
      vec2 d=vec2(cos(a),sin(a)), pos=d*(radius*.2+t*(25.0+hash(vec2(k,6))*70.0));
      sparks=max(sparks,exp(-pow(line(p,pos,pos-d*4.0)/1.2,2.0)));
    }
    alpha=max(flash,sparks*(1.0-smoothstep(.05,.5,t))*.65);
    // The brood's void light bursting out of the shell: violet sparks around a pale, hot centre.
    color=mix(vec3(.16,.03,.28),vec3(.78,.46,1.0),clamp(flash+exp(-t*14.0),0.0,1.0));
  } else {
    p.x+=uShape.x*.3;
    float lengthPx=uShape.z, width=uTiming.w, along=clamp(p.x/lengthPx,0.0,1.0);
    float localAge=t-along*uTiming.y;
    float lane=smoothstep(-5.0,8.0,p.x)*(1.0-smoothstep(lengthPx-8.0,lengthPx+9.0,p.x));
    if(uMode<2.5) {
      // Dust kicks up where the arm lands hardest (towards its tip), thinning out quickly; no smears along the lane.
      float dust=0.0, chunks=0.0, lighting=0.0;
      for(int i=0;i<14;i++) {
        float k=float(i), seed=hash(vec2(k,3.0));
        float x=(.45+.55*hash(vec2(k,11.0)))*lengthPx, side=mod(k,2.0)*2.0-1.0;
        float age=t-x/lengthPx*uTiming.y;
        vec2 center=vec2(x,curve(x)+side*(width*.15+max(0.0,age)*(16.0+seed*22.0)));
        vec2 radii=vec2(10.0+seed*8.0,8.0+seed*6.0)+max(0.0,age)*vec2(22,26);
        float nn=field(p*.06+vec2(k*3.0,-age*.6));
        float cloud=1.0-smoothstep(.3,1.15,length((p-center)/radii)+(nn-.5)*.8);
        float life=smoothstep(0.0,.04,age)*(1.0-smoothstep(uTiming.x*.25,uTiming.x*.75,age));
        dust=1.0-(1.0-dust)*(1.0-cloud*life*.45);
        lighting=max(lighting,cloud*nn);
        float flight=.25+seed*.2;
        vec2 rock=center+vec2(sin(k*9.0)*age*30.0,side*age*seed*45.0);
        float size=1.0+seed*2.2;
        float block=max(abs(p.x-rock.x),abs(p.y-rock.y)*.85)+(noise(p*.5)-.5)*1.5;
        chunks=max(chunks,(1.0-smoothstep(size*.6,size+1.0,block))*step(0.0,age)*(1.0-smoothstep(flight*.6,flight,age)));
      }
      alpha=max(dust,chunks*.8);
      color=mix(vec3(.36,.33,.26),vec3(.58,.55,.46),lighting);
      color=mix(color,vec3(.24,.2,.15),chunks*.7);
    } else {
      // A soft, short-lived imprint of the arm; no crack lines left on the grass.
      float center=curve(p.x);
      float imprint=exp(-pow((p.y-center)/(width*(.32-.18*along)),2.0))*(.6+field(p*.08)*.4);
      alpha=imprint*.22*lane*step(0.0,localAge)*(1.0-smoothstep(uTiming.x*.25,uTiming.x*.6,t));
      color=vec3(.06,.05,.035);
    }
  }
  alpha*=uOpacity;
  gl_FragColor=vec4(color*alpha,alpha);
}`;
