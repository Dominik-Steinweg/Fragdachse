/** Fixed-cost, absolute-age samples; no random emissions or wall clock. */
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
    p.x+=uShape.x*.25;
    float wet=texture2D(uWater,uv).r;
    float erosion=clamp((t-uTiming.x-uTiming.y)/uTiming.z,0.0,1.0);
    float front=min(1.0,t/uTiming.x)*uShape.z;
    vec2 q=vec2(p.x/68.0,p.y/mix(51.0,35.0,wet));
    vec2 flow=vec2(field(q+vec2(-t*.18,2)),field(q+vec2(13,t*.12)));
    vec2 warp=vec2(field(q+flow*3.4),field(q+flow*3.4+27.0))-.5;
    vec2 curled=q+warp*uDetail.x*2.2;
    float n=field(curled-vec2(t*.15,0));
    float marble=.5+.5*sin(curled.y*9.0+field(curled*1.5)*15.0);
    float strands=pow(marble,7.0);
    float cloud=0.0, ridges=0.0;
    for(int i=0;i<13;i++) {
      float k=float(i), along=(k+.6)/14.0*uShape.z;
      float width=max(9.0,along*uShape.w*.85)*mix(1.0,uTiming.w,wet);
      vec2 center=vec2(along,sin(k*4.3)*width*.24);
      vec2 radii=vec2(uShape.z*(.075+k*.003),width)*(1.0+erosion*.23);
      vec2 local=(p-center)/radii+warp*mix(.95,1.45,wet)*uDetail.x;
      float d=length(local), lobe=1.0-smoothstep(.35,1.15,d);
      cloud=1.0-(1.0-cloud)*(1.0-lobe);
      ridges=max(ridges,exp(-pow((d-.72)/.19,2.0))*(.35+.65*n));
    }
    float tip=1.0-smoothstep(front-8.0,front+12.0,p.x);
    tip=mix(tip,1.0,smoothstep(uTiming.x,uTiming.x+.1,t));
    float mouth=smoothstep(-3.0,6.0,p.x);
    float axis=exp(-pow(p.y/max(5.0,10.0+p.x*.16),2.0));
    float core=axis*(1.0-smoothstep(uShape.z*.75,uShape.z*1.08,p.x))*mouth;
    float density=max(cloud*(.8+.2*n),core*.99);
    // Threshold erodes the cloud before the narrow curled filaments.
    float resistance=max(density*.8+(.5-n)*.25,strands*cloud*.99);
    float survive=smoothstep(erosion-.055,erosion+.055,resistance)*step(erosion,.999);
    alpha=density*tip*mouth*survive*smoothstep(0.0,.025,t);
    float edge=clamp((1.0-density)*1.15+ridges*.46*(1.0-axis*.85),0.0,1.0);
    color=mix(uCore,uEdge,edge);
    color+=vec3(.08,.06,.11)*ridges*(1.0-wet)*(1.0-axis*.75);
    // Oil sheen follows curled contours instead of lighting the whole pool.
    color+=vec3(.32,.29,.43)*strands*uDetail.y*wet*(1.0-axis*.8);
    float drops=0.0;
    for(int i=0;i<18;i++) {
      float k=float(i), seed=hash(vec2(k,8));
      vec2 d=normalize(vec2(1,(seed-.5)*uShape.w*1.65));
      vec2 pos=d*(front+8.0+hash(vec2(k,4))*29.0);
      float size=1.2+hash(vec2(k,5))*2.7;
      drops=max(drops,1.0-smoothstep(size*.55,size+1.0,line(p,pos,pos-d*5.0)));
    }
    drops*=smoothstep(.015,.05,t)*(1.0-smoothstep(uTiming.x*.8,uTiming.x+.09,t));
    alpha=max(alpha,drops*.9);
    // Keep the axis at the authored near-black; cloud highlights belong to its shoulders.
    color=mix(color,uCore,axis*.96);
  } else if(uMode<1.5) {
    float radius=uShape.z, life=uTiming.x, retract=uTiming.z;
    float r=length(p), theta=atan(p.y,p.x);
    float n=field(p*.06+uShape.w*7.0);
    float irregular=r*(1.0+(n-.5)*.28);
    if(uAge<0.0) {
      // Water swells over the rising arm: a dark bulge with a soft, broken bright edge.
      float grow=clamp(1.0+uAge/uTiming.y,0.0,1.0);
      float bulgeR=radius*(.2+.25*grow);
      float mound=exp(-pow(irregular/bulgeR,2.0)*1.6);
      float rim=exp(-pow((irregular-bulgeR)/(radius*.06),2.0))*(.4+.6*n);
      alpha=(mound*.35+rim*.32)*grow;
      color=mix(vec3(.02,.09,.11),vec3(.55,.74,.76),rim);
    } else {
      float end=1.0-smoothstep(life*.5,life,t);
      // Two soft, continuous ripples that thin out as they spread.
      float ripple=0.0;
      for(int i=0;i<2;i++) {
        float age=t-float(i)*.22;
        if(age<0.0) continue;
        float spread=radius*(.45+age*1.1), width=radius*(.05+age*.08);
        ripple+=exp(-pow((irregular-spread)/width,2.0))*(1.0-smoothstep(0.0,.9,age))*(1.0-float(i)*.35);
      }
      // Churned foam hugging the column, tearing apart as it ages.
      float churn=field(vec2(cos(theta),sin(theta))*r*.07+vec2(t*.4,uShape.w*3.0));
      float core=exp(-pow(irregular/(radius*(.42+t*.25)),2.0));
      float foam=core*smoothstep(.40+t*.25,.62+t*.25,churn);
      // Droplets thrown up and out in uneven clusters, slowing and fading as they fall back.
      float spray=0.0, count=min(uDetail.x,48.0);
      for(int i=0;i<48;i++) {
        float k=float(i);
        if(k>=count) break;
        float seed=k*1.37+uShape.w*91.0;
        float h1=hash(vec2(seed,1.0)), h2=hash(vec2(seed,2.0)), h3=hash(vec2(seed,3.0)), h4=hash(vec2(seed,4.0));
        float age=t-h1*.12, flight=.35+h2*.45;
        if(age<0.0 || age>flight) continue;
        float a=h3*6.2831853+sin(h1*17.0)*.4;
        vec2 d=vec2(cos(a),sin(a));
        float fall=age/flight;
        float speed=uDetail.y*(.25+.75*h4)*(retract>.5 ? .6 : 1.0);
        vec2 pos=d*(radius*(.12+.25*h2)+speed*age*(1.0-.35*fall));
        float size=.8+h2*1.6, streak=size*(1.5+3.0*(1.0-fall));
        float drop=1.0-smoothstep(size*.5,size+.8,line(p,pos,pos-d*streak));
        spray=max(spray,drop*(1.0-smoothstep(.6,1.0,fall)));
      }
      alpha=clamp(foam*.55*uTiming.w+ripple*.18+spray*.8,0.0,.9)*end;
      color=mix(vec3(.10,.28,.31),vec3(.78,.92,.94),clamp(foam*1.2+spray+ripple*.4,0.0,1.0));
    }
  } else if(uMode>3.5 && uMode<4.5) {
    float radius=uShape.z, r=length(p), theta=atan(p.y,p.x);
    float n=field(p*.05), d=r*(1.0+(n-.5)*.22);
    float diving=uShape.w;
    float active=diving>.5 ? 1.0-smoothstep(uTiming.x*.3,uTiming.x,t) : smoothstep(0.0,max(.05,uTiming.x),t);
    // A dark depression where the body sinks; foam is torn into soft swirling streaks, never clean rings.
    float hollow=exp(-pow(d/(radius*.6),2.0));
    float shadow=diving>.5 ? uTiming.y : .3;
    float swirl=theta*2.0+r/radius*5.0-t*2.2;
    vec2 sp=vec2(cos(swirl),sin(swirl))*(r*.05+1.0);
    float streaks=field(sp*1.6+vec2(t*.3,0.0)+n*2.0);
    float band=smoothstep(radius*.15,radius*.35,r)*(1.0-smoothstep(radius*.6,radius*1.0,r));
    float foam=smoothstep(.55,.75,streaks)*band*diving;
    float spread=radius*(.55+t*.8);
    float ripple=exp(-pow((d-spread)/(radius*.07+t*4.0),2.0))*(1.0-smoothstep(0.0,1.2,t))*diving;
    float bubbles=0.0;
    for(int i=0;i<10;i++) {
      float k=float(i), a=hash(vec2(k,2.0))*6.2831853, cycle=fract(t*.8+hash(vec2(k,7.0)));
      vec2 pos=vec2(cos(a),sin(a))*radius*(.08+hash(vec2(k,8.0))*.3);
      float size=(1.2+hash(vec2(k,5.0))*2.0)*sin(cycle*PI);
      bubbles=max(bubbles,exp(-pow((length(p-pos)-size)/.8,2.0))*sin(cycle*PI));
    }
    float light=(foam*.45+ripple*.2+bubbles*.5)*active*uTiming.z;
    alpha=clamp(hollow*(shadow+active*.2)+light,0.0,.75);
    color=mix(vec3(.012,.07,.085),vec3(.6,.8,.82),clamp(light/max(alpha,.001),0.0,1.0));
  } else if(uMode>4.5 && uMode<5.5) {
    float radius=uShape.z, r=length(p), theta=atan(p.y,p.x);
    if(uAge<0.0) {
      alpha=exp(-pow(r/(radius*(.65+uTiming.x*.45)),2.0))*(.3-uTiming.x*.15);
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
    alpha=max(mist*mix(.8,.4,along)*mix(1.0,tear,along),sheen*.3);
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
    float n=field(p*.075), r=length(p/vec2(uShape.z,uShape.w));
    float drag=exp(-r*r*2.0)*(.6+.4*n);
    float drops=0.0;
    for(int i=0;i<12;i++) {
      float k=float(i), a=k*2.39996;
      vec2 pos=vec2(cos(a)*uShape.z,sin(a)*uShape.w)*(1.0+hash(vec2(k,8))*.5);
      drops=max(drops,1.0-smoothstep(1.0,3.0,length(p-pos)));
    }
    alpha=(drag*.28+drops*.35)*(1.0-smoothstep(1.0,uTiming.x,t));
    color=mix(vec3(.04,.1,.095),vec3(.28,.41,.38),n);
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
    // The ember core bursting out of the shell: crimson sparks around a hot centre.
    color=mix(vec3(.30,.04,.10),vec3(1.0,.24,.10),clamp(flash+exp(-t*14.0),0.0,1.0));
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
