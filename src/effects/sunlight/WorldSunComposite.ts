import {getVisibleWorldView,createVisibleWorldView} from '../../graphics/CameraWorldView';
import { SunRenderTarget, ownSunShader, sunShaderName } from './SunRenderTarget';
import type { SunCanopy } from './SunCanopyMask';
import { CloudFieldTexture } from './CloudFieldTexture';
import { sunRenderWorld, sunRenderSize } from './SunRenderQuality';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { CLOUD_SHADOW_GLSL, setCloudUniforms, type SunCloudState } from './cloudShadow';
import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { type RockLightingState } from '../../arena/rocks/RockLightingState';
import { getClarityCameraRegistry } from '../../scenes/arena/ClarityCameraRegistry';
import type { SunTuning } from './SunTuning';
import { SUN_VISIBILITY_GLSL, SUN_COMPOSITE_FACTOR_GLSL } from './sunVisibility';
import { ATMOSPHERE_DITHER_GLSL } from './atmosphereNoise';

const HEADER = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform vec4 uSunWorld;
uniform float uSunStrength;
${CLOUD_SHADOW_GLSL}
${SUN_VISIBILITY_GLSL}
${ATMOSPHERE_DITHER_GLSL}
${SUN_COMPOSITE_FACTOR_GLSL}
vec2 worldPosition() { return uSunWorld.xy+vec2(outTexCoord.x,1.0-outTexCoord.y)*uSunWorld.zw; }
`;
export const SUN_COMPOSITE_FRAGMENT = `${HEADER}
uniform vec3 uSunShade,uSunDaylight,uSunLit;
void main() {
  // The half-scale source needs one LSB of noise to decorrelate successive MULTIPLY stages.
  // Exactly neutral at strength zero; stable world pixels, no temporal sparkle.
  vec2 light=sunLightSample(worldPosition());
  vec3 factor=sunCompositeFactor(uSunShade,uSunDaylight,uSunLit,light.r,uSunStrength,atmosphereDither(worldPosition()),light.g,uCloudSpotAmount*uCloudCached);
  gl_FragColor=vec4(clamp(factor*0.5+vec3(.5/255.0),0.0,1.0),0.5);
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
  private readonly cloudField: CloudFieldTexture | null;
  private readonly sizes = { composite: [0,0] };
  constructor(private readonly scene: Phaser.Scene, private readonly tuning: SunTuning,
    private readonly sun: RockLightingState, private readonly clouds?: SunCloudState,canopies:readonly SunCanopy[]=[]) {
    this.cloudField=clouds?new CloudFieldTexture(scene,clouds,canopies):null;
  }
  prepareClouds(x:number,y:number,width:number,height:number):void { this.cloudField?.update(x,y,width,height); }
  get diagnostics() { return { quality:getGraphicsQualityProfile(this.scene).level,
    composite:this.sizes.composite.slice(),clouds:this.cloudField?.diagnostics??null }; }
  setEnabled(composite: boolean): void {
    if (composite && !this.composite) this.composite = this.create();
    if (!composite && this.composite) { this.composite.destroy(); this.composite = null;this.sizes.composite.fill(0); }
  }
  private create(): Phaser.GameObjects.Shader {
    const world = [0,0,1,1],visibleWorld=createVisibleWorldView();
    const target = new SunRenderTarget(this.scene,'CompositeMaterial',SUN_COMPOSITE_FRAGMENT,set=>{
      set('uSunWorld',world);setCloudUniforms(set,this.clouds);
      set('uSunStrength',this.sun.strength);set('uSunShade',this.tuning.shade);set('uSunLit',this.tuning.sun);set('uSunDaylight',this.tuning.daylight);
    });
    const shaderName=sunShaderName('CompositeDisplay');
    const quad=new Phaser.GameObjects.Shader(this.scene,{name:shaderName,shaderName,fragmentSource:
      `#pragma phaserTemplate(shaderName)
      precision highp float;
      varying vec2 outTexCoord;
      uniform sampler2D uMaterial;
      void main(){vec4 c=texture2D(uMaterial,outTexCoord);gl_FragColor=vec4(max(vec3(0.0),c.rgb-vec3(.5/255.0)),.5);}`,
      setupUniforms:(set:(name:string,value:unknown)=>void)=>set('uMaterial',0)},0,0,1,1,[target.shader.texture!]);
    ownSunShader(quad,shaderName);
    quad.once('destroy',()=>target.destroy());
    quad.setOrigin(0).setScrollFactor(0).setDepth(DEPTH.PROJECTILES-.5)
      .setBlendMode(modulateMode(this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer));
    const node=quad.renderNode,run=node.run,owner=this;
    node.run=function(context,object,parent):void {
      const camera=context.camera!,view=getVisibleWorldView(camera,visibleWorld),quality=getGraphicsQualityProfile(owner.scene).sunlight;
      const pad=sunRenderWorld(world,view.x,view.y,view.width,view.height,camera.zoomX,camera.zoomY);
      const scale=quality.compositeScale;
      const w=sunRenderSize(world[2],camera.zoomX,scale),h=sunRenderSize(world[3],camera.zoomY,scale);
      const size=owner.sizes.composite;size[0]=w;size[1]=h;
      // Finish pending geometry before switching framebuffer. The destination context
      // is rebound by the display draw; no camera viewport offset is added here.
      this.manager.finishBatch();target.draw(w,h);
      quad.setPosition(-pad,-pad).setSize(world[2],world[3]);
      run.call(this,context,object,parent);
    };
    this.scene.add.existing(quad);getClarityCameraRegistry(this.scene)?.demote(quad);
    return quad;
  }
  destroy():void { this.setEnabled(false);this.cloudField?.destroy(); }
}
