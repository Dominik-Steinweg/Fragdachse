import type * as Phaser from 'phaser';
import { CLOUD_SHADOW_GLSL, setCloudUniforms, type SunCloudState, type CloudFieldBinding } from './cloudShadow';
import { SunRenderTarget } from './SunRenderTarget';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { SUN_BAND_GLSL, setSunVisibilityUniforms } from './sunVisibility';

const FRAGMENT=`#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform vec4 uFieldWorld;
uniform float uFieldDelay,uFieldCanopy;
${CLOUD_SHADOW_GLSL}
${SUN_BAND_GLSL}
void main(){
  vec2 p=uFieldWorld.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uFieldWorld.zw;
  gl_FragColor=vec4(cloudShadowAnalytic(p,uCloudTime),
    cloudShadowAnalytic(p,max(0.0,uCloudTime-uFieldDelay)),
    cloudShadowAnalytic(p,max(0.0,uCloudTime-2.0*uFieldDelay)),uFieldCanopy>.5?sunBandVisibility(p):1.0);
}`;
/** One world-space cloud map for all receivers. RGB preserves the rays' causal
 * exposure samples; A stores broad canopy visibility for vegetation shadows.
 * No readback, uploads or second clock. Borrowed binding dies
 * before its target. On limited hardware retain the analytic fallback. */
export class CloudFieldTexture implements CloudFieldBinding {
  readonly world=[0,0,1,1];
  private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer;
  private readonly target: SunRenderTarget | null;
  private readonly previous=new Float64Array(20).fill(NaN);
  private builds=0;
  private dirty=false;
  private check(i:number,value:number):void {if(this.previous[i]!==value){this.previous[i]=value;this.dirty=true;}}
  private disposed=false;
  get delay():number { return this.state.tuning.raysCloudSoftness; }
  constructor(private readonly scene:Phaser.Scene,private readonly state:SunCloudState) {
    this.renderer=scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const gl=this.renderer.gl;
    this.target=gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>8?new SunRenderTarget(scene,'CloudField',FRAGMENT,set=>{
      setCloudUniforms(set,state,false);set('uFieldWorld',this.world);set('uFieldDelay',this.delay);
      setSunVisibilityUniforms(set,state.tuning);
      set('uFieldCanopy',getGraphicsQualityProfile(scene).sunlight.vegetationShadows?1:0);
    }):null;
  }
  bind():void { if(this.target&&!this.disposed)this.renderer.glTextureUnits.bind(this.target.shader.glTexture!,8); }
  update(x:number,y:number,width:number,height:number):void {
    if(!this.target||this.disposed)return;
    const t=this.state.tuning,size=getGraphicsQualityProfile(this.scene).sunlight.cloudSize;
    this.dirty=false;
    // No string keys/temporary arrays in the presentation path.
    this.check(0,this.state.strength>0&&t.cloudCover>0&&t.cloudCover<1?this.state.timeSec:0);this.check(1,this.state.strength);this.check(2,t.cloudCover);this.check(3,t.cloudSpeed);
    this.check(4,t.cloudScale);this.check(5,t.cloudEvolution);this.check(6,t.cloudGust);this.check(7,this.delay);
    this.check(8,x);this.check(9,y);this.check(10,width);this.check(11,height);
    this.check(12,this.state.sunPath?.azimuth??0);this.check(13,this.state.sunPath?.elevation??0);
    this.check(14,t.openFraction);this.check(15,t.bandAlong);this.check(16,t.bandAcross);this.check(17,t.penumbra);
    this.check(18,this.state.sunPath?1:0);
    this.check(19,getGraphicsQualityProfile(this.scene).sunlight.vegetationShadows?1:0);
    if(this.target.shader.width!==size)this.dirty=true;
    if(!this.dirty)return;
    // World bounds, not camera UVs; off-world receivers use the analytic field.
    this.world[0]=x;this.world[1]=y;this.world[2]=Math.max(1,width);this.world[3]=Math.max(1,height);
    this.renderer.renderNodes.finishBatch();
    this.renderer.glTextureUnits.bind(this.scene.textures.get('__DEFAULT').source[0].glTexture!,8);
    this.target.draw(size,size);
    this.state.cache=this;this.builds++;
  }
  get diagnostics(){return {size:this.target?.shader.width??0,builds:this.builds,rgbaBytes:(this.target?.shader.width??0)**2*4,worldTexelX:this.world[2]/Math.max(1,this.target?.shader.width??0),worldTexelY:this.world[3]/Math.max(1,this.target?.shader.height??0)};}
  destroy():void {if(this.disposed)return;this.disposed=true;if(this.state.cache===this)this.state.cache=undefined;this.target?.destroy();}
}
