/** Native-resolution, premultiplied gas. The radial envelope is independent of detail LOD. */
export const STINK_SHADER_NAME = 'FragdachseStinkCloud';
export const STINK_FRAGMENT_SOURCE = `
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
uniform float uTime;
uniform float uSeed;
uniform float uDetail;
uniform float uPixels;
uniform float uOpacity;
uniform vec3 uDeep;
uniform vec3 uBody;
uniform vec3 uLight;
uniform float uElectric;

float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx)*.1031);
    q += dot(q, q.yzx+33.33);
    return fract((q.x+q.y)*q.z);
}
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
}
float billows(vec2 p) {
    vec2 cell = floor(p), local = fract(p);
    float height = 0.0;
    for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++) {
        vec2 neighbor = vec2(float(x),float(y));
        vec2 center = .15+.7*vec2(hash(cell+neighbor),hash(cell+neighbor+19.7));
        center += .065*sin(vec2(uTime*.72,-uTime*.61)+center*17.0);
        vec2 delta = neighbor+center-local;
        float radius = mix(.33,.85,pow(hash(cell+neighbor+8.3),1.35));
        float lobe = exp(-dot(delta,delta)/(radius*radius));
        float blend = max(.24-abs(height-lobe),0.0)/.24;
        height = max(height,lobe)+blend*blend*.06;
    }
    return height;
}
void main() {
    vec2 p = vec2(outTexCoord.x,1.0-outTexCoord.y)*2.0-1.0;
    float r = length(p);
    if (r >= 1.0) { gl_FragColor = vec4(0.0); return; }
    vec2 offset = vec2(uSeed*.137,uSeed*.071);
    vec2 drift = vec2(uTime*.055,-uTime*.043);
    vec2 warp = vec2(noise(p*1.6+offset+drift),noise(p*1.6+offset-drift+17.2))-.5;
    vec2 q = p*2.85+offset+drift+warp*.2;
    float broad = billows(q);
    float small = billows(p*4.7+offset+23.6-drift*.62+warp*.13);
    float crown = 1.0-(1.0-broad*.87)*(1.0-small*.57);
    float folds = noise(p*7.0+offset-drift*1.2+warp*.2);
    float fine = 0.0;
    if (uDetail > .5) fine += (noise(q*7.3-drift*2.1)-.5)*.08*smoothstep(45.0,130.0,uPixels);
    if (uDetail > 1.5) fine += (noise(q*15.7+drift*2.4)-.5)*.04*smoothstep(100.0,240.0,uPixels);
    float rolling = smoothstep(.25,.86,crown*.82+folds*.18+fine);
    // Keep the entire gameplay disc occupied; only the last narrow band feathers out.
    float fringe = noise(p*9.0+offset-drift);
    float coverage = 1.0-smoothstep(.90+.045*fringe,1.0,r);
    vec3 normal = vec3(0,0,1);
#ifdef GL_OES_standard_derivatives
    normal = normalize(vec3(-dFdx(crown)*uPixels*.009,-dFdy(crown)*uPixels*.009,1.0));
#endif
    float diffuse = max(0.0,dot(normal,normalize(vec3(-.55,-.65,1.1))));
    vec3 color = mix(uDeep,uBody,rolling)*(.88+.16*diffuse);
    float veil = noise(p*3.1+offset+vec2(-drift.y,drift.x));
    color = mix(color,uLight,.07+.06*veil);
    // Broad transparency rather than an opaque core or additive neon spotlight.
    float alpha = coverage*(.23+.22*rolling+.045*veil)*uOpacity*.8;
    alpha *= mix(1.0,.64,uElectric);
    float emergence = exp(-uTime*8.0);
    color += uLight*emergence*.12;
    gl_FragColor = vec4(color*alpha,alpha);
}
`;
