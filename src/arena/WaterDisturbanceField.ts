import type * as Phaser from 'phaser';
import { SunRenderTarget } from '../effects/sunlight/SunRenderTarget';

/** Surface disturbances evaluated analytically per frame: no history, no emitters. */
export type WaterDisturbanceKind = 'ring' | 'surge' | 'vortex' | 'wake' | 'splat';
export interface WaterDisturbance {
  readonly kind: WaterDisturbanceKind;
  /** World position. */
  readonly x: number; readonly y: number;
  /** Seconds since the disturbance began (the wake uses it as a running clock). */
  readonly age: number;
  readonly radius: number;
  /** 0..1 (louder disturbances win when more than SLOTS are submitted). */
  readonly strength: number;
  /** Heading in radians (wake). */
  readonly angle?: number;
  /** Kind-specific: wake length (px), vortex spin direction, surge seed. */
  readonly param?: number;
}
const KIND: Readonly<Record<WaterDisturbanceKind, number>> = { ring: 0, surge: 1, vortex: 2, wake: 3, splat: 4 };
const SLOTS = 8;
const MAX_TEXELS = 768;

const FRAGMENT = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform vec4 uRect;
${Array.from({ length: SLOTS }, (_, i) => `uniform vec4 uA${i}, uB${i};`).join('\n')}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);}
// A: x, y, age, kind. B: radius, strength, angle, param. Output height (signed), foam, churn.
void acc(vec4 A,vec4 B,vec2 p,inout float h,inout float foam,inout float churn){
  if(B.y<=0.0)return;
  vec2 d=p-A.xy; float r=length(d), age=A.z, R=B.x, k=A.w;
  float n=noise(p*.075+vec2(age*1.7,B.w*13.0));
  if(k<.5||k>3.5){
    // Rings: a short train of crests running outwards, losing height as it spreads.
    float splat=step(3.5,k), lambda=mix(24.0,12.0,splat), speed=mix(90.0,70.0,splat);
    float front=R+age*speed, x=r-front*(1.0+(n-.5)*.06);
    float env=smoothstep(-3.2*lambda,-.6*lambda,x)*(1.0-smoothstep(-.4*lambda,.5*lambda,x));
    float decay=B.y*exp(-age*mix(1.1,2.4,splat))/sqrt(1.0+front/60.0);
    float wave=sin(x*6.2831853/lambda);
    h+=wave*env*decay;
    foam+=smoothstep(.45,1.0,wave)*env*decay*smoothstep(.25,.7,n)*(1.0-smoothstep(0.0,.8,age))*1.2;
    if(splat>.5)foam+=exp(-pow(r/(R*.8),2.0))*B.y*(1.0-smoothstep(0.0,.35,age));
  } else if(k<1.5){
    // Surge: the surface heaves over something rising and pours off it as broken white water.
    float rise=smoothstep(0.0,.22,age)*(1.0-smoothstep(.45,1.5,age));
    float dome=exp(-pow(r/R,2.0)*1.7);
    h+=dome*rise*B.y*1.4;
    float rim=exp(-pow((r-R*(.65+age*.35))/(R*.24),2.0));
    foam+=rim*smoothstep(.32,.78,n)*B.y*smoothstep(0.0,.18,age)*(1.0-smoothstep(.55,1.7,age))*1.3;
    churn+=dome*B.y*(1.0-smoothstep(.3,2.2,age))*.9;
  } else if(k<2.5){
    // Vortex: the pond is dragged down into a turning funnel with torn foam spiralling in.
    float th=atan(d.y,d.x), spin=B.w>=0.0?1.0:-1.0;
    float spiral=.5+.5*sin(th*3.0*spin+r*.075-age*5.0);
    float env=exp(-pow(r/R,2.0))*B.y*smoothstep(0.0,.25,age)*(1.0-smoothstep(1.1,2.4,age));
    h+=-env*1.2+(spiral-.5)*env*.7;
    foam+=smoothstep(.62,.95,spiral)*smoothstep(.25,.65,n)*env*smoothstep(R*.12,R*.35,r)*1.3;
    churn+=env;
  } else {
    // Wake: a soft bow swell, a churned track and feathered Kelvin crests that break up and fade behind the body.
    vec2 dir=vec2(cos(B.z),sin(B.z));
    float along=-dot(d,dir), across=dot(d,vec2(-dir.y,dir.x)), len=max(B.w,1.0);
    float behind=max(along-R*.15,0.0), side=abs(across);
    float decay=B.y*(1.0-smoothstep(len*.35,len,behind))/sqrt(1.0+behind/(R*.8));
    // The arms open at about 19.5 degrees; their short crests lie obliquely and tear apart in the noise.
    float arm=side-R*.32-behind*.354, width=10.0+behind*.09;
    float armEnv=exp(-arm*arm/(2.0*width*width))*smoothstep(-R*.2,R*.3,along);
    float crest=sin((behind*.82+side*.57)*.17-age*4.2);
    float torn=smoothstep(.25,.75,noise(p*.035+vec2(age*.6,B.w*.01)));
    h+=crest*armEnv*decay*torn*.75;
    foam+=smoothstep(.45,1.0,crest)*armEnv*decay*torn*smoothstep(.35,.75,n)*.95;
    // Transverse crests curve across the track.
    float track=exp(-side*side/(R*R*.35))*smoothstep(0.0,R*.6,behind);
    h+=sin(length(vec2(behind,side*.6))*.13-age*3.6)*track*decay*.4;
    // White water churned up right behind the body.
    float churned=exp(-side*side/(R*R*(.12+behind/len*.25)))*smoothstep(-R*.3,R*.4,along)*(1.0-smoothstep(len*.15,len*.6,behind));
    foam+=churned*smoothstep(.3,.8,n)*B.y*.85; churn+=churned*B.y*.75;
    float bow=exp(-pow((along+R*.7)/(R*.38),2.0)-pow(across/(R*.75),2.0));
    h+=bow*B.y*.5; foam+=bow*smoothstep(.45,.8,n)*B.y*.35;
    churn+=exp(-pow(length(vec2(along*.8,across))/R,2.0))*B.y*.35;
  }
}
void main(){
  vec2 uv=outTexCoord, p=uRect.xy+vec2(uv.x,1.0-uv.y)*uRect.zw;
  float h=0.0, foam=0.0, churn=0.0;
${Array.from({ length: SLOTS }, (_, i) => `  acc(uA${i},uB${i},p,h,foam,churn);`).join('\n')}
  gl_FragColor=vec4(clamp(h*.5+.5,0.0,1.0),clamp(foam,0.0,1.0),clamp(churn,0.0,1.0),1.0);
}`;

const providers = new WeakMap<Phaser.Scene, () => WaterDisturbanceField | null>();

/** World-lifetime surface field over the water's bounds, owned by the water surface renderer.
 * Presentation owners submit disturbances each frame; the water shader shades them in its own light.
 * The owner registers a provider and allocates the GPU target only once something disturbs the water. */
export class WaterDisturbanceField {
  static for(scene: Phaser.Scene): WaterDisturbanceField | null { return providers.get(scene)?.() ?? null; }
  static provide(scene: Phaser.Scene, provider: () => WaterDisturbanceField | null): () => void {
    providers.set(scene, provider);
    return () => { if (providers.get(scene) === provider) providers.delete(scene); };
  }
  /** World rect x, y, width, height. */
  readonly rect: Float32Array;
  readonly width: number;
  readonly height: number;
  private readonly target: SunRenderTarget;
  private readonly a = Array.from({ length: SLOTS }, () => new Float32Array(4));
  private readonly b = Array.from({ length: SLOTS }, () => new Float32Array(4));
  private readonly sources: WaterDisturbance[] = [];
  private live = false;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, bounds: { x: number; y: number; width: number; height: number }) {
    this.rect = new Float32Array([bounds.x, bounds.y, Math.max(1, bounds.width), Math.max(1, bounds.height)]);
    const texel = Math.max(2, Math.max(bounds.width, bounds.height) / MAX_TEXELS);
    this.width = Math.max(4, Math.ceil(bounds.width / texel)); this.height = Math.max(4, Math.ceil(bounds.height / texel));
    this.target = new SunRenderTarget(scene, 'WaterDisturbance', FRAGMENT, set => {
      set('uRect', this.rect);
      for (let i = 0; i < SLOTS; i++) { set(`uA${i}`, this.a[i]); set(`uB${i}`, this.b[i]); }
    });
    scene.events.on('prerender', this.flush, this);
  }
  get active(): boolean { return this.live && !this.destroyed; }
  get textureKey(): string { return this.target.shader.texture!.key; }
  submit(disturbance: WaterDisturbance): void {
    if (!this.destroyed && disturbance.strength > 0 && this.sources.length < 64) this.sources.push(disturbance);
  }
  /** Rendered once per frame right before the scene draws its water. */
  private flush(): void {
    if (this.destroyed) return;
    const chosen = this.sources.sort((p, q) => q.strength - p.strength).slice(0, SLOTS);
    for (let i = 0; i < SLOTS; i++) {
      const d = chosen[i];
      this.a[i].set(d ? [d.x, d.y, d.age, KIND[d.kind]] : [0, 0, 0, 0]);
      this.b[i].set(d ? [d.radius, d.strength, d.angle ?? 0, d.param ?? 0] : [0, 0, 0, 0]);
    }
    this.live = chosen.length > 0;
    if (this.live) this.target.draw(this.width, this.height);
    this.sources.length = 0;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off('prerender', this.flush, this);
    this.target.destroy();
  }
}
