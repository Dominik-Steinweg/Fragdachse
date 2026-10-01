import { loadingTimeline } from '../../diagnostics/LoadingTimeline';
import type * as Phaser from 'phaser';
import { CLOUD_SHADOW_GLSL, setCloudUniforms, type SunCloudState, type CloudFieldBinding } from './cloudShadow';
import { SunRenderTarget } from './SunRenderTarget';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { cloudFieldSize } from './SunRenderQuality';

export const CLOUD_FIELD_FRAGMENT=`#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform vec4 uFieldWorld;
${CLOUD_SHADOW_GLSL}
void main(){
  vec2 p=uFieldWorld.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uFieldWorld.zw;
  float opening=cloudShadowAnalytic(p,uCloudTime);
  gl_FragColor=vec4(vec3(opening),sunlightFromCloud(opening));
}`;
/** One current-time, world-space cloud evaluation for every receiver. RGB holds
 * the smooth opening, A its direct-light response for vegetation shadows.
 * No readback, temporal history or independent clock. Limited hardware uses the
 * identical analytic fallback. The borrowed binding dies before its target. */
export class CloudFieldTexture implements CloudFieldBinding {
  readonly world=[0,0,1,1];
  private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer;
  private readonly target: SunRenderTarget | null;
  private readonly previous=new Float64Array(14).fill(NaN);
  private readonly size=[0,0];
  private builds=0;
  private dirty=false;
  private check(i:number,value:number):void {if(this.previous[i]!==value){this.previous[i]=value;this.dirty=true;}}
  private disposed=false;
  constructor(private readonly scene:Phaser.Scene,private readonly state:SunCloudState) {
    this.renderer=scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const gl=this.renderer.gl;
    this.target=gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)>8?new SunRenderTarget(scene,'CloudField',CLOUD_FIELD_FRAGMENT,set=>{
      setCloudUniforms(set,state,false);set('uFieldWorld',this.world);
    }):null;
  }
  bind():void { if(this.target&&!this.disposed)this.renderer.glTextureUnits.bind(this.target.shader.glTexture!,8); }
  update(x:number,y:number,width:number,height:number):void {
    if(!this.target||this.disposed)return;
    const t=this.state.tuning,quality=getGraphicsQualityProfile(this.scene).sunlight;
    cloudFieldSize(this.size,width,height,quality);this.dirty=false;
    // Solar azimuth/elevation never invalidate the pattern. Colour and form light
    // still follow the sun in receivers. Paused presentation time keeps this RT.
    this.check(0,this.state.strength>0&&t.cloudCover>0&&t.cloudCover<1?this.state.timeSec:0);
    this.check(1,this.state.strength>0?1:0);this.check(2,t.cloudCover);this.check(3,t.cloudSpeed);
    this.check(4,t.cloudScale);this.check(5,t.cloudEvolution);this.check(6,t.cloudGust);
    this.check(7,t.cloudWarp);this.check(8,t.cloudSoftness);this.check(9,t.cloudDensity);
    this.check(10,this.size[0]);this.check(11,this.size[1]);this.check(12,t.cloudSpotAmount);this.check(13,t.cloudSpotScale);
    if(this.world[0]!==x||this.world[1]!==y||this.world[2]!==width||this.world[3]!==height)this.dirty=true;
    if(!this.dirty)return;
    this.world[0]=x;this.world[1]=y;this.world[2]=Math.max(1,width);this.world[3]=Math.max(1,height);
    this.renderer.renderNodes.finishBatch();
    this.renderer.glTextureUnits.bind(this.scene.textures.get('__DEFAULT').source[0].glTexture!,8);
    const measuredAt=loadingTimeline.start();
    this.target.draw(this.size[0],this.size[1]);
    loadingTimeline.end('cloud/field-submit',measuredAt);
    this.state.cache=this;this.builds++;
  }
  get diagnostics(){const width=this.target?.shader.width??0,height=this.target?.shader.height??0;
    return {width,height,builds:this.builds,rgbaBytes:width*height*4,
      worldTexelX:this.world[2]/Math.max(1,width),worldTexelY:this.world[3]/Math.max(1,height)};}
  destroy():void {if(this.disposed)return;this.disposed=true;if(this.state.cache===this)this.state.cache=undefined;this.target?.destroy();}
}
