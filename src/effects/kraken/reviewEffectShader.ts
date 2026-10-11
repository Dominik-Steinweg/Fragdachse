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
    float n=field(p*.085+uShape.w*7.0), irregular=r+(n-.5)*radius*.32;
    if(uAge<0.0) {
      float grow=clamp(1.0+uAge/uTiming.y,0.0,1.0);
      float bulgeR=radius*(.18+.27*grow);
      float mound=1.0-smoothstep(bulgeR*.6,bulgeR,irregular);
      float rim=exp(-pow((irregular-bulgeR*.84)/1.8,2.0))*.65;
      alpha=max(mound*.65,rim)*(.25+.75*grow);
      color=mix(vec3(.025,.105,.13),vec3(.36,.68,.7),rim);
    } else {
      float end=1.0-smoothstep(life*.55,life,t), ring=0.0;
      for(int i=0;i<3;i++) {
        float age=t-float(i)*.14, target=radius*(mix(.36,.8,uDetail.w)+max(0.0,age)*1.25);
        float broken=smoothstep(.38,.65,field(vec2(theta*9.0+float(i)*7.0,r*.06)));
        ring+=exp(-pow((irregular-target)/max(1.15,uDetail.z),2.0))*step(0.0,age)*broken*(1.0-float(i)*.2);
      }
      float swirl=theta+retract*(r/radius*6.0-t*8.0);
      vec2 foamUV=vec2(cos(swirl),sin(swirl))*r*.09;
      float cells=field(foamUV+vec2(t*.15,uShape.w));
      float footprint=1.0-smoothstep(radius*.22,radius*(.58+t*.13),irregular);
      footprint=mix(footprint,exp(-pow((irregular-radius*.78)/(radius*.16+t*4.0),2.0)),uDetail.w);
      float foam=footprint*smoothstep(.26+t*.24,.48+t*.24,cells);
      float lace=exp(-pow((cells-(.42+t*.1))/.035,2.0))*footprint;
      foam=max(foam*.65,lace*.8)*exp(-t*.9)*uTiming.w;
      float spray=0.0;
      for(int i=0;i<96;i++) {
        float k=float(i), seed=k+uShape.w*101.0, birth=hash(vec2(seed,8))*.09;
        float age=max(0.0,t-birth), flight=.24+hash(vec2(seed,9))*.36;
        float a=k*2.39996+hash(vec2(seed,3))*.7;
        vec2 d=vec2(cos(a),sin(a));
        float speed=uDetail.y*(.35+hash(vec2(seed,2))*.65);
        float z=max(0.0,age*(flight-age))*150.0;
        vec2 pos=d*(radius*mix(.17,.72,uDetail.w)+speed*age)+vec2(z*.65,0);
        float size=.65+hash(vec2(seed,4))*1.75;
        float streak=(2.0+hash(vec2(seed,6))*8.0)*(1.0-clamp(age/flight,0.0,1.0));
        float drop=1.0-smoothstep(size*.4,size+.65,line(p,pos,pos-d*streak));
        spray=max(spray,drop*step(birth,t)*(1.0-smoothstep(flight*.75,flight,age))*step(k+.5,uDetail.x));
      }
      float cavity=exp(-pow(r/(radius*.3),2.0))*exp(-t*6.0)*(1.0-uDetail.w);
      alpha=clamp(foam+ring*.24+spray*.9+cavity*.35,0.0,.95)*end;
      color=mix(vec3(.075,.24,.29),vec3(.7,.9,.93),clamp(foam*1.4+spray+ring*.45,0.0,1.0));
    }
  } else if(uMode>3.5 && uMode<4.5) {
    float radius=uShape.z, r=length(p), theta=atan(p.y,p.x);
    float n=field(p*.055), d=r+(n-.5)*radius*.2;
    float diving=uShape.w;
    float active=diving>.5 ? 1.0-smoothstep(uTiming.x*.25,uTiming.x,t) : smoothstep(0.0,max(.05,uTiming.x),t);
    float mound=exp(-pow(d/(radius*.65),2.0));
    float shadow=diving>.5 ? uTiming.y : .3;
    float swirl=theta+r/radius*8.0+t*3.5+(n-.5)*1.5;
    float spiral=pow(.5+.5*sin(swirl*3.0),14.0)*smoothstep(radius*.12,radius*.3,r)
      *(1.0-smoothstep(radius*.55,radius*1.05,r))*(.25+.75*n);
    float ring=0.0;
    for(int i=0;i<3;i++) {
      float age=t-float(i)*.18;
      ring+=exp(-pow((d-radius*(.6+max(0.0,age)*.9))/2.2,2.0))*step(0.0,age)*.25;
    }
    float bubbles=0.0;
    for(int i=0;i<24;i++) {
      float k=float(i), a=k*2.39996, cycle=fract(t*.9+hash(vec2(k,2)));
      vec2 pos=vec2(cos(a),sin(a))*radius*(.2+hash(vec2(k,8))*.58);
      float size=(1.0+hash(vec2(k,5))*2.7)*sin(cycle*PI);
      bubbles=max(bubbles,exp(-pow((length(p-pos)-size)/.65,2.0))*sin(cycle*PI));
    }
    float foam=(spiral*diving*.7*smoothstep(.28,.6,n)+ring*diving+bubbles*.65)*active*uTiming.z;
    alpha=clamp(mound*(shadow+active*.24)+foam,0.0,.8);
    color=mix(vec3(.012,.07,.085),vec3(.62,.83,.85),clamp(foam/max(alpha,.001),0.0,1.0));
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
      color=mix(vec3(.07,.095,.025),vec3(.3,.36,.1),clamp(rim+n*.3+drops,0.0,1.0));
    }
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
    float n=field(p*.055+vec2(-t*.6,0));
    float lane=exp(-pow(p.y/uShape.w,4.0))*smoothstep(-100.0,-55.0,p.x)*(1.0-smoothstep(120.0,uShape.z,p.x));
    float bow=exp(-pow((length((p-vec2(40,0))/vec2(1.0,1.4))-85.0)/5.0,2.0));
    float wake=exp(-pow((abs(p.y)-28.0-max(0.0,-p.x)*.3)/5.0,2.0))*(1.0-smoothstep(-20.0,25.0,p.x));
    float strands=pow(.5+.5*sin(p.x*.08-t*7.0+n*9.0),8.0)*lane;
    alpha=lane*.09+(bow+wake)*(.18+n*.25)+strands*.18;
    color=mix(vec3(.15,.38,.4),vec3(.69,.88,.85),clamp(bow+wake+strands,0.0,1.0));
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
    color=mix(vec3(.38,.39,.1),vec3(1.0,.39,.07),clamp(flash+exp(-t*14.0),0.0,1.0));
  } else {
    p.x+=uShape.x*.3;
    float lengthPx=uShape.z, width=uTiming.w, along=clamp(p.x/lengthPx,0.0,1.0);
    float localAge=t-along*uTiming.y;
    float lane=smoothstep(-5.0,8.0,p.x)*(1.0-smoothstep(lengthPx-8.0,lengthPx+9.0,p.x));
    if(uMode<2.5) {
      float dust=0.0, chunks=0.0, lighting=0.0;
      for(int i=0;i<24;i++) {
        float k=float(i), x=(floor(k/2.0)+.35)/12.0*lengthPx;
        float side=mod(k,2.0)*2.0-1.0, age=t-x/lengthPx*uTiming.y, seed=hash(vec2(k,3));
        vec2 center=vec2(x,curve(x)+side*(width*.22+max(0.0,age)*(22.0+seed*28.0)));
        vec2 radii=vec2(13.0+seed*9.0,9.0+seed*7.0)+max(0.0,age)*vec2(27,34);
        vec2 q=(p-center)/radii;
        float n=field(p*.055+vec2(k*3.0,-age*.6));
        float cloud=1.0-smoothstep(.25,1.2,length(q)+(n-.5)*.9);
        float life=smoothstep(0.0,.035,age)*(1.0-smoothstep(uTiming.x*.3,uTiming.x,age));
        dust=1.0-(1.0-dust)*(1.0-cloud*life*.66);
        lighting=max(lighting,cloud*n);
        float flight=.3+seed*.25;
        vec2 rock=center+vec2(sin(k*9.0)*age*36.0,side*age*seed*55.0);
        rock.x+=max(0.0,age*(flight-age))*100.0;
        float size=1.3+seed*3.2;
        float block=max(abs(p.x-rock.x),abs(p.y-rock.y)*.85)+(noise(p*.5)-.5)*1.7;
        chunks=max(chunks,(1.0-smoothstep(size*.6,size+1.0,block))*step(0.0,age)*(1.0-smoothstep(flight*.65,flight,age)));
      }
      alpha=max(dust,chunks*.95);
      color=mix(vec3(.32,.285,.24),vec3(.59,.54,.46),lighting);
      color=mix(color,vec3(.22,.18,.13),chunks*.8);
    } else {
      float center=curve(p.x), zig=sin(p.x*.15)*1.4+sin(p.x*.39)*.65;
      float crack=1.0-smoothstep(.45,1.4,abs(p.y-center-zig));
      for(int i=0;i<14;i++) {
        float k=float(i), x=(k+.5)/14.0*lengthPx, side=mod(k,2.0)*2.0-1.0;
        vec2 a=vec2(x,curve(x)), b=a+vec2(8.0+hash(vec2(k,4))*9.0,side*width*.32);
        vec2 c=b+vec2(-4.0,side*width*.15);
        crack=max(crack,(1.0-smoothstep(.35,1.15,min(line(p,a,b),line(p,b,c))))*.8);
      }
      float imprint=exp(-pow((p.y-center)/(width*(.38-.25*along)),2.0))*(.54+field(p*.09)*.26);
      alpha=max(crack*.9,imprint)*lane*step(0.0,localAge)*(1.0-smoothstep(uTiming.x*.5,uTiming.x,t));
      color=vec3(.045,.03,.022);
    }
  }
  alpha*=uOpacity;
  gl_FragColor=vec4(color*alpha,alpha);
}`;
