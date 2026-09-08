/** One bounded quad: advected density, surface lighting and embedded lightning. */
export const SMOKE_SHADER_NAME = 'FragdachseSmokeCloud';
export const SMOKE_FRAGMENT_SOURCE = `
#pragma phaserTemplate(shaderName)
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 outTexCoord;
uniform sampler2D uBody;
uniform sampler2D uWisp;
uniform float uTime;
uniform float uSeed;
uniform float uDetail;
uniform float uPixels;
uniform float uOpacity;
uniform vec4 uWeatherA;
uniform vec4 uWeatherB;
uniform float uFlash;
uniform float uArcSeed;

float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
}
float field(vec2 p) {
    float v = noise(p)*.65;
    v += noise(p*2.03+13.4)*.24;
    if(uDetail > .5) v += noise(p*4.11+27.1)*.11;
    else v += .055;
    return v;
}
float billows(vec2 p) {
    vec2 cell = floor(p), local = fract(p);
    float height = 0.0;
    for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++) {
        vec2 neighbor = vec2(float(x),float(y));
        vec2 center = .15 + .7 * vec2(hash(cell+neighbor),hash(cell+neighbor+19.7));
        // Each puff rolls locally without stretching its neighbours into ribbons.
        center += .065*sin(vec2(uTime*.72,-uTime*.61)+center*17.0);
        vec2 delta = neighbor + center - local;
        // A wide radius distribution puts small puffs between occasional broad
        // volumes; varying the Gaussian coefficient only slightly looked uniform.
        float radius = mix(.33,.85,pow(hash(cell+neighbor+8.3),1.35));
        float lobe = exp(-dot(delta,delta)/(radius*radius))*mix(.84,1.0,hash(cell+neighbor+37.9));
        // A smooth maximum preserves individual rounded crowns and their creases;
        // adding every Gaussian together would wash the mass into a soft blanket.
        float blend = max(.24-abs(height-lobe),0.0)/.24;
        height = max(height,lobe) + blend*blend*.06;
    }
    return height;
}
float segment(vec2 p, vec2 a, vec2 b) {
    vec2 d = b-a;
    return length(p-a-d*clamp(dot(p-a,d)/max(dot(d,d),.0001),0.0,1.0));
}
float arc(vec2 p, vec2 start, vec2 end, float seed, float spread) {
    float nearest = 10.0;
    vec2 previous = start;
    vec2 normal = normalize(vec2(start.y-end.y,end.x-start.x)+.0001);
    for(int i=1;i<=8;i++) {
        float t = float(i)/8.0;
        vec2 next = mix(start,end,t)+normal*(hash(vec2(float(i),seed))-.5)*spread*sin(t*3.14159);
        nearest = min(nearest,segment(p,previous,next)); previous = next;
    }
    return nearest;
}
void main() {
    // Shader's default quad UVs start at (0,1); align weather with world Y.
    vec2 coord = vec2(outTexCoord.x,1.0-outTexCoord.y);
    vec2 p = coord*2.0-1.0;
    float r = length(p);
    vec2 offset = vec2(uSeed*.137,uSeed*.071);
    vec2 drift = vec2(uTime*.11,-uTime*.085);
    vec2 warp = vec2(noise(p*1.6+offset+drift),noise(p*1.6+offset-drift+17.2))-.5;
    // Small displacements preserve rounded volumes. Independent detail and veil
    // motion provides depth without the long folds of nested domain warping.
    vec2 q = p*2.85 + warp*.18 + offset + drift*.4;
    // Two independent scales recreate the less orderly overlap of several clouds
    // within one visible quad. Small puffs cross larger volumes without ribbons.
    float broad = billows(q);
    float small = billows(p*4.7+offset+23.6-drift*.62+warp*.13);
    float crown = 1.0-(1.0-broad*.87)*(1.0-small*.57);
    float folds = field(p*7.0+offset-drift*1.2+warp*.2);
    float veilDensity = field(p*3.1+offset+vec2(-drift.y,drift.x)*.8);
    // Fade subpixel noise instead of letting it sparkle at low resolution/zoom.
    float fine = 0.0;
    if(uDetail > .5) fine += (noise(q*7.3-drift*2.1)-.5)*.08*smoothstep(45.0,130.0,uPixels);
    if(uDetail > 1.5) fine += (noise(q*15.7+drift*2.4)-.5)*.04*smoothstep(100.0,240.0,uPixels);
    float h = crown*.82 + folds*.18 + fine;
    // Existing puff textures add broad, translucent grey between the crowns.
    vec2 uv = clamp(coord*.72+.14+warp*.16, .01, .99);
    h += (texture2D(uBody,uv).a-.5)*.025 + (texture2D(uWisp,vec2(1.0-uv.x,uv.y)).a-.5)*.025;
    // The same moving folds sculpt the contour, with small lobes and translucent
    // pockets. Only a narrow outer safety fade keeps the quad boundary invisible.
    float fringe = noise(p*10.5+warp*2.0+offset-drift);
    float edge = .84 + (noise(p*4.2+warp+offset+drift*.45)-.5)*.20 + (fringe-.5)*.075;
    float feather = mix(.045,.095,fringe);
    float coverage = 1.0-smoothstep(edge-feather,edge+feather,r);
    coverage *= 1.0-smoothstep(.97,1.0,r);
    vec3 normal = vec3(0,0,1);
#ifdef GL_OES_standard_derivatives
    // Illuminate the broad rolling surface; fine density must not look like metal creases.
    normal = normalize(vec3(-dFdx(crown)*uPixels*.006,-dFdy(crown)*uPixels*.006,1.0));
#endif
    float diffuse = max(0.0,dot(normal,normalize(vec3(-.55,-.65,1.1))));
    float rolling = smoothstep(.25,.86,h);
    vec3 color = mix(vec3(.150,.163,.175),vec3(.247,.262,.276),rolling);
    color *= .92 + diffuse*.10;
    color += (folds-.5)*.025 + fine*.15;
    // Compose a separately moving grey veil inside this same pass. It fills dark
    // seams and lets local opacity evolve without pulsing the complete cloud.
    float rim = smoothstep(.38,.88,r);
    float bodyAlpha = coverage*mix(.95,.65,rim)*mix(.88,1.0,rolling);
    float veilAlpha = coverage*(.30+.25*veilDensity);
    float density = bodyAlpha + veilAlpha*(1.0-bodyAlpha);
    vec3 veilColor = vec3(.200,.214,.227) + (veilDensity-.5)*.030;
    color = (color*bodyAlpha + veilColor*veilAlpha*(1.0-bodyAlpha))/max(density,.0001);
    // Local light scatters through the mass, rather than flashing a flat whole-cloud sprite.
    vec2 da = p-uWeatherA.xy, db = p-uWeatherB.xy;
    float light = exp(-dot(da,da)*7.5)*uWeatherA.z + exp(-dot(db,db)*9.0)*uWeatherB.z;
    color += vec3(.30,.47,.65)*light*(.35+.9*rolling);
    if(uFlash>.015) {
        vec2 start = uWeatherA.xy;
        vec2 end = start + vec2(hash(vec2(uArcSeed,4.1))-.5,hash(vec2(uArcSeed,8.7))-.5)*.85;
        float d = arc(p,start,end,uArcSeed,.17);
        float veil = 1.0-smoothstep(.36,.72,h);
        float core = 1.0-smoothstep(.0005,.0025,d);
        // Barely visible hairline behind the smoke; weather light carries the effect.
        color += vec3(.40,.57,.70)*core*veil*uFlash*.12;
    }
    float alpha = density*uOpacity;
    gl_FragColor = vec4(color*alpha,alpha);
}
`;

export interface SmokeWeatherState {
  readonly a: readonly [number, number, number, number];
  readonly b: readonly [number, number, number, number];
  readonly flash: number;
  readonly event: number;
}

const hash = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

/** Stateless cosmetic schedule: no damage ticks, timers, old-event replay or growing pools. */
export function sampleSmokeWeather(seconds: number, seed: number): SmokeWeatherState {
  const lane = (time: number, salt: number): readonly [number, number, number, number] => {
    const epoch = Math.floor(time / 1.7), key = epoch + seed * 19 + salt;
    const age = time - epoch * 1.7 - .15 - hash(key + 3) * .65;
    const pulse = age > 0 && age < .75 ? (1 - Math.exp(-age * 55)) * Math.exp(-age * 8)
      + Math.exp(-Math.pow((age - .13) / .035, 2)) * .23 : 0;
    const angle = hash(key + 1) * Math.PI * 2, radius = .16 + hash(key + 2) * .43;
    return [Math.cos(angle)*radius, Math.sin(angle)*radius, pulse, key];
  };
  const a = lane(seconds + seed * .173, 0), b = lane(seconds + seed * .173 + .81, 71);
  return { a, b, flash: hash(a[3] + 11) > .46 ? a[2] : 0, event: a[3] };
}
