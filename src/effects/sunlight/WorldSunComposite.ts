import { WOODLAND_TRANSMISSION_KEY } from '../../assets/WoodlandAssetManifest';
import { SunRenderTarget, ownSunShader, sunShaderName } from './SunRenderTarget';
import { CloudFieldTexture } from './CloudFieldTexture';
import { sunRenderWorld, sunRenderSize } from './SunRenderQuality';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { CLOUD_SHADOW_GLSL, setCloudUniforms, type SunCloudState } from './cloudShadow';
import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { type RockLightingState } from '../../arena/rocks/RockLightingState';
import { getClarityCameraRegistry } from '../../scenes/arena/ClarityCameraRegistry';
import type { SunTuning } from './SunTuning';
import { FOG_VISIBILITY_BUDGET_GLSL, setFogVisibilityUniforms } from './FogVisibilityBudget';
import { SUN_VISIBILITY_GLSL, setSunVisibilityUniforms } from './sunVisibility';
import { ATMOSPHERE_DITHER_GLSL, FOG_BANK_GLSL, setFogBankUniforms } from './atmosphereNoise';
import { FOG_PATCH_GLSL } from './FogPatchField';

const HEADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform sampler2D uSunTransmission;
uniform vec2 uSceneSunOffset;
uniform vec4 uSunWorld;
uniform float uSunStrength;
${SUN_VISIBILITY_GLSL}
${CLOUD_SHADOW_GLSL}
${ATMOSPHERE_DITHER_GLSL}
${FOG_BANK_GLSL}
vec2 worldPosition() { return uSunWorld.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uSunWorld.zw; }
`;
const COMPOSITE = `${HEADER}
uniform vec3 uSunShade,uSunLit;
void main() {
  vec3 factor=mix(vec3(1.0),clamp(mix(uSunShade,uSunLit,sunVisibility(worldPosition())*cloudTransmission(worldPosition())),0.0,2.0),uSunStrength);
  // The half-scale source needs one LSB of noise to decorrelate successive MULTIPLY stages.
  // Exactly neutral at strength zero; stable world pixels, no temporal sparkle.
  factor=clamp(factor+atmosphereDither(worldPosition())*(2.0/255.0)*min(1.0,uSunStrength*8.0),0.0,2.0);
  gl_FragColor=vec4(clamp(factor*0.5+vec3(.5/255.0),0.0,1.0),0.5);
}`;
const RAYS = `${HEADER}
${FOG_VISIBILITY_BUDGET_GLSL}
${FOG_PATCH_GLSL}
uniform float uRaysAmount,uRaysLength,uRaysBreath,uRaysCloudSoftness,uRaysSamples;
uniform vec3 uRaysColor;
void main() {
  vec2 world=worldPosition();
  vec2 drift=vec2(1.0,.23)*cloudTravel(uCloudTime,uCloudSpeed)*.18;
  vec2 mist=world-drift;
  float bank=fogBank(world,uCloudTime,uCloudSpeed);
  float patch=fogPatchMask(mist,uCloudTime,bank,1.0);
  float coupling=patch*min(1.0,uFogOpticalOpacity*uFogDensity*uFogPatchDensity);
  // Exactly zero before and after dither: skip the six aperture samples in gaps.
  if(coupling<=0.0||uSunStrength<=0.0||uRaysAmount<=0.0){gl_FragColor=vec4(0.0);return;}
  float light=0.0,weights=0.0;
  float reach=uRaysLength*mix(.28,1.0,uSunStretch);
  vec2 across=vec2(-uSunDirection.y,uSunDirection.x);
  float cloudNow=cloudShadow(world,uCloudTime);
  // Finite causal exposure: deterministic under jumps, pause and frame stepping.
  float cloud=.5*cloudNow+.3*cloudShadow(world,max(0.0,uCloudTime-uRaysCloudSoftness))
    +.2*cloudShadow(world,max(0.0,uCloudTime-uRaysCloudSoftness*2.0));
  float edge=4.0*cloud*(1.0-cloud);
  for(int i=0;i<6;i++) {
    if(float(i)>=uRaysSamples)break;
    float t=float(i)/max(1.0,uRaysSamples-1.0),weight=1.0-smoothstep(.15,1.05,t);
    vec2 aperture=world+uSunDirection*(t*reach);
    // Sub-leaf wind movement affects the aperture only, never the world-fixed band axes.
    aperture+=across*sin(uCloudTime*.31+dot(aperture,across)*.009)*1.5;
    float field=sunBandField(sunAxes(aperture));
    float softness=.10+edge*.10;
    light+=weight*smoothstep(1.0-uSunOpen-softness,1.0-uSunOpen+softness,field);
    weights+=weight;
  }
  float breath=1.0+uRaysBreath*sin(uCloudTime*.19+bank*6.2831853);
  // The stricter water support is a subset of the land patches too. No shaft
  // veil in clear intervals. Replaces four old haze/breath noises with two patch noises.
  float transmission=mix(1.0,cloud,uCloudDensity*uCloudStrength);
  float amount=clamp(light/weights*breath*transmission*uRaysAmount*uSunStrength*coupling,0.0,0.16);
  // Scale the whole shaft range into its reservation; avoid a flat clipped top.
  float peak=uRaysAmount*uSunStrength*1.4*(1.0+uRaysBreath);
  amount*=min(1.0,fogRayReserve(uSunStrength)/max(.0001,peak));
  amount=clamp(amount+atmosphereDither(world)/255.0*min(1.0,amount*255.0),0.0,fogRayReserve(uSunStrength));
  vec3 tint=uRaysColor*mix(vec3(1.0),vec3(1.0,.97,.91),uSunStretch*.6);
  tint=mix(tint,vec3(dot(tint,vec3(.2126,.7152,.0722))),edge*.12);
  gl_FragColor=vec4(tint*amount,amount);
}`;

const modulateModes = new WeakMap<Phaser.Renderer.WebGL.WebGLRenderer, number>();

function modulateMode(renderer: Phaser.Renderer.WebGL.WebGLRenderer): number {
  let mode = modulateModes.get(renderer);
  if (mode === undefined) {
    const gl = renderer.gl;
    // 4.2.1 addBlendMode returns (inserted index - 1), but DrawingContext indexes
    // blendModes directly. Use the actual appended slot, not that return value.
    mode = renderer.blendModes.length;
    renderer.addBlendMode([gl.DST_COLOR, gl.SRC_COLOR], gl.FUNC_ADD);
    // removeBlendMode splices the array, invalidating other users' indices:
    // retain exactly one slot per renderer instead.
    modulateModes.set(renderer, mode);
  }
  return mode;
}

/** Expensive materials use reduced targets; final quads retain the original depth/blend. */
export class WorldSunComposite {
  private composite: Phaser.GameObjects.Shader | null = null;
  private rays: Phaser.GameObjects.Shader | null = null;
  private readonly cloudField: CloudFieldTexture | null;
  private readonly sizes = { composite: [0,0], rays: [0,0] };
  constructor(private readonly scene: Phaser.Scene, private readonly tuning: SunTuning,
    private readonly sun: RockLightingState, private readonly offset: readonly [number, number], private readonly clouds?: SunCloudState) {
    this.cloudField=clouds?new CloudFieldTexture(scene,clouds):null;
  }
  prepareClouds(x:number,y:number,width:number,height:number):void { this.cloudField?.update(x,y,width,height); }
  get diagnostics() { return { quality:getGraphicsQualityProfile(this.scene).level,
    composite:this.sizes.composite.slice(),rays:this.sizes.rays.slice(),clouds:this.cloudField?.diagnostics??null,
    raysSamples:this.rays?getGraphicsQualityProfile(this.scene).sunlight.raysSamples:0 }; }
  setEnabled(composite: boolean, rays: boolean): void {
    rays &&= getGraphicsQualityProfile(this.scene).sunlight.raysScale>0;
    if (composite && !this.composite) this.composite = this.create(false);
    if (rays && !this.rays) this.rays = this.create(true);
    if (!composite && this.composite) { this.composite.destroy(); this.composite = null;this.sizes.composite.fill(0); }
    if (!rays && this.rays) { this.rays.destroy(); this.rays = null;this.sizes.rays.fill(0); }
  }
  private create(rays: boolean): Phaser.GameObjects.Shader {
    const world = [0,0,1,1];
    const target = new SunRenderTarget(this.scene,rays?'RaysMaterial':'CompositeMaterial',rays?RAYS:COMPOSITE,set=>{
      const quality=getGraphicsQualityProfile(this.scene).sunlight;
      set('uSunTransmission',0);set('uSceneSunOffset',this.offset);set('uSunWorld',world);
      setCloudUniforms(set,this.clouds);setSunVisibilityUniforms(set,this.tuning);
      if(!quality.dapple)set('uSunDapple',0);
      set('uSunStrength',this.sun.strength);set('uSunShade',this.tuning.shade);set('uSunLit',this.tuning.sun);
      set('uRaysAmount',this.tuning.raysAmount);set('uRaysLength',this.tuning.raysLength);
      set('uRaysColor',this.tuning.raysColor);set('uRaysBreath',this.tuning.raysBreath);
      set('uRaysCloudSoftness',this.tuning.raysCloudSoftness);set('uRaysSamples',quality.raysSamples);
      setFogBankUniforms(set,this.tuning);setFogVisibilityUniforms(set,this.tuning);
    },[WOODLAND_TRANSMISSION_KEY]);
    const shaderName=sunShaderName(rays?'RaysDisplay':'CompositeDisplay');
    const quad=new Phaser.GameObjects.Shader(this.scene,{name:shaderName,shaderName,fragmentSource:
      `#pragma phaserTemplate(shaderName)
      precision highp float;
      varying vec2 outTexCoord;
      uniform sampler2D uMaterial;
      void main(){vec4 c=texture2D(uMaterial,outTexCoord);gl_FragColor=${rays?'c':'vec4(max(vec3(0.0),c.rgb-vec3(.5/255.0)),.5)'};}`,
      setupUniforms:(set:(name:string,value:unknown)=>void)=>set('uMaterial',0)},0,0,1,1,[target.shader.texture!]);
    ownSunShader(quad,shaderName);
    quad.once('destroy',()=>target.destroy());
    quad.setOrigin(0).setScrollFactor(0).setDepth(rays?DEPTH.CANOPY-.3:DEPTH.PROJECTILES-.5)
      .setBlendMode(rays?Phaser.BlendModes.SCREEN:modulateMode(this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer));
    const node=quad.renderNode,run=node.run,owner=this;
    node.run=function(context,object,parent):void {
      const camera=context.camera!,view=camera.worldView,quality=getGraphicsQualityProfile(owner.scene).sunlight;
      const pad=sunRenderWorld(world,view.x,view.y,view.width,view.height,camera.zoomX,camera.zoomY);
      const scale=rays?quality.raysScale:quality.compositeScale;
      const w=sunRenderSize(world[2],camera.zoomX,scale),h=sunRenderSize(world[3],camera.zoomY,scale);
      const size=rays?owner.sizes.rays:owner.sizes.composite;size[0]=w;size[1]=h;
      // Finish pending geometry before switching framebuffer. The destination context
      // is rebound by the display draw; no camera viewport offset is added here.
      this.manager.finishBatch();target.draw(w,h);
      quad.setPosition(-pad,-pad).setSize(world[2],world[3]);
      run.call(this,context,object,parent);
    };
    this.scene.add.existing(quad);getClarityCameraRegistry(this.scene)?.demote(quad);
    return quad;
  }
  destroy():void { this.setEnabled(false,false);this.cloudField?.destroy(); }
}
